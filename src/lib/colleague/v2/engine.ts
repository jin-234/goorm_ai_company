/**
 * 회의실 발표 진행(docs/ai-colleague/AI동료_프롬프트.md 13장).
 *   ① review: 질문 수 < 2면 review 호출 → 질문이 있고 can_finish가 아니면 답 대기, 아니면 confirm 호출 → 컨펌 카드
 *   ② meeting: 직전에 질문한 부서가 있으면 그 부서 feedback → 다음 부서 ask → 한 바퀴 끝나면 진행자 close → 회의록
 * 응답은 13.3으로 검사해 걸리면 사유를 [반려]에 넣어 1회 다시 요청한다. 두 번째도 걸리면 고쳐서 쓰고 로그에 남긴다.
 * Solar 키가 없으면 예시 응답(sample), 호출이 실패하면 정해진 응답(manual)으로 이어 간다.
 */
import type { ColleagueDept, ColleagueMeetingRole, ColleagueReply, ColleagueSource, ShareTurn } from "@/lib/office/models";
import type { Office, Random } from "@/lib/office/office";
import { REVIEW_QUESTION_LIMIT } from "@/lib/office/office";
import { type SolarClient, SolarError } from "@/lib/solar/client";
import { aiModeOf } from "../colleague";
import { buildMinutes, minutesPrompt, readSummary } from "./minutes";
import { buildPrompt, contextOf, historyOf } from "./prompt";
import { sampleReply } from "./sample";
import { type CheckContext, normalizeReply, parseJsonReply, rejectReasons, sanitizeReply } from "./validate";

export interface SpeakResult {
  reply: ColleagueReply;
  source: ColleagueSource;
  /** 1회 재요청에 쓴 반려 사유(없으면 []). 두 번째도 걸리면 rejectedTwice. */
  rejected: string[];
  rejectedTwice: boolean;
  solarError: ReturnType<SolarError["toJSON"]> | null;
}

/** 동료 한 명의 발언 한 번. */
export async function speak(
  office: Office,
  client: SolarClient,
  s: { dept: ColleagueDept; persona: string; meetingRole: ColleagueMeetingRole; curveball: boolean; random?: Random },
): Promise<SpeakResult> {
  const share = office.day.share;
  const stage = s.meetingRole === "review" || s.meetingRole === "confirm" ? "review" : "meeting";
  const check: CheckContext = {
    dept: s.dept,
    meetingRole: s.meetingRole,
    userTexts: share.turns.filter((t) => t.stage === stage && t.role === "user").map((t) => t.text ?? ""),
    usedLenses: [...new Set([...share.usedLenses, ...office.colleagueRecent.lenses])],
    usedQuestionTypes: [...new Set([...share.usedQuestionTypes, ...office.colleagueRecent.questionTypes])],
    curveball: s.curveball,
    usedCurveballs: [...new Set([...share.usedCurveballs, ...office.colleagueRecent.curveballs])],
  };
  const offline = (source: ColleagueSource, solarError: SpeakResult["solarError"]): SpeakResult => ({
    reply: sanitizeReply(sampleReply({ office, ...s }), check),
    source,
    rejected: [],
    rejectedTwice: false,
    solarError,
  });
  if (aiModeOf(client) === "sample") return offline("sample", null);

  const history = historyOf(share.turns, stage, share.meeting?.host ?? null);
  const context = contextOf(office, s);
  const ask = async (rejectNote: string | null) => {
    const p = buildPrompt({ dept: s.dept, persona: s.persona, meetingRole: s.meetingRole, curveball: s.curveball, context }, history, rejectNote);
    const content = await client.completeJSON({ system: p.system, messages: [{ role: "user", content: p.user }], temperature: 0.6, maxTokens: 1400 });
    const raw = parseJsonReply(content);
    return raw ? normalizeReply(raw, s.dept, s.persona) : null;
  };
  try {
    let reply = await ask(null);
    let reasons = reply ? rejectReasons(reply, check) : ["JSON이 아니다"];
    const first = reasons;
    if (reasons.length > 0) {
      reply = await ask(reasons.join("; "));
      reasons = reply ? rejectReasons(reply, check) : ["JSON이 아니다"];
    }
    if (!reply) return offline("manual", new SolarError("malformed", { message: "JSON이 아닙니다" }).toJSON());
    if (reasons.length > 0) console.warn("[colleague] 재요청 뒤에도 검사에 걸림", s.dept, s.meetingRole, reasons);
    return { reply: sanitizeReply(reply, check), source: "solar", rejected: first, rejectedTwice: reasons.length > 0, solarError: null };
  } catch (error) {
    if (!(error instanceof SolarError)) throw error;
    return offline("manual", error.toJSON());
  }
}

export interface ShareStepResult {
  turns: ShareTurn[];
  source: ColleagueSource;
  solarError: SpeakResult["solarError"];
}

/**
 * 사용자 말을 기록한 뒤(recordUserTurn) 부른다. 필요한 동료 발언을 차례로 만들어 기록하고,
 * 회의가 한 바퀴 끝나면 진행자 정리와 회의록까지 만든다.
 */
export async function advanceShare(office: Office, client: SolarClient, opts: { lowered?: boolean; random?: Random } = {}): Promise<ShareStepResult> {
  const random = opts.random ?? Math.random;
  const share = office.day.share;
  const before = share.turns.length;
  let source: ColleagueSource = aiModeOf(client) === "sample" ? "sample" : "solar";
  let solarError: SpeakResult["solarError"] = null;
  const say = async (dept: ColleagueDept, persona: string, meetingRole: ColleagueMeetingRole, curveball = false) => {
    const r = await speak(office, client, { dept, persona, meetingRole, curveball, random });
    if (r.source !== "solar") source = r.source;
    solarError ??= r.solarError;
    office.recordColleagueTurn(dept, meetingRole, r.reply, r.source);
    return r.reply;
  };

  if (share.stage === "review" && share.review) {
    const lead = share.review.personaId;
    if (share.review.questionCount < REVIEW_QUESTION_LIMIT) {
      // 두 번째 질문에서 약 35% 확률로 변화구(13.2). "모르겠다" 직후나 난이도 1에서는 배정하지 않는다.
      const curve = share.review.questionCount === 1 && !opts.lowered && share.difficulty > 1 && random() < 0.35;
      const reply = await say("dev_lead", lead, "review", curve);
      if (!reply.question || reply.can_finish) await say("dev_lead", lead, "confirm");
    } else {
      await say("dev_lead", lead, "confirm");
    }
  } else if (share.stage === "meeting" && share.meeting) {
    const meeting = share.meeting;
    if (meeting.awaitingFeedback) {
      const p = meeting.participants.find((x) => x.dept === meeting.awaitingFeedback)!;
      await say(p.dept, p.personaId, "feedback");
    }
    while (meeting.nextAsk < meeting.participants.length) {
      const p = meeting.participants[meeting.nextAsk];
      const curve = p.dept === meeting.curveballDept && !opts.lowered && share.difficulty > 1;
      const reply = await say(p.dept, p.personaId, "ask", curve);
      if (reply.question) break;
      meeting.awaitingFeedback = null; // 물을 것이 없으면 다음 부서로
    }
    if (meeting.nextAsk >= meeting.participants.length && !meeting.awaitingFeedback) {
      const host = meeting.participants.find((x) => x.dept === meeting.host)!;
      await say(host.dept, host.personaId, "close");
      office.setMinutes(await makeMinutes(office, client));
    }
  }
  return { turns: share.turns.slice(before), source, solarError };
}

/** 회의록: MINUTES 프롬프트로 요약하고, 실패하거나 AI가 없으면 기록만으로 만든다. */
export async function makeMinutes(office: Office, client: SolarClient) {
  if (aiModeOf(client) === "sample") return buildMinutes(office, null);
  try {
    const content = await client.completeJSON({
      system: "회의록 정리 담당. 지시대로 JSON 하나만 출력한다.",
      messages: [{ role: "user", content: minutesPrompt(office) }],
      temperature: 0.2,
      maxTokens: 1800,
    });
    return buildMinutes(office, readSummary(parseJsonReply(content)));
  } catch (error) {
    if (!(error instanceof SolarError)) throw error;
    return buildMinutes(office, null);
  }
}
