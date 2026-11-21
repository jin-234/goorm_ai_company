/**
 * 프롬프트 조립(docs/ai-colleague/AI동료_프롬프트.md 3장). 블록 원문은 prompt-data.generated.ts에서 그대로 가져온다.
 * 순서: COMMON → UNDERSTANDING → TONE → (REVIEW|MEETING) → PROVENANCE → SOURCES → QTYPES → CURVEBALL → PROCEDURE
 *       → BANNED → QUALITY → DIFFICULTY → FEEDBACK → ROLE_<부서> → PERSONA_<id> → QBANK_<부서> → JARGON → GLOSSARY_<부서>
 *       → CASES → RESPONSE → [이번 요청 맥락] → [지금까지 대화] → 마지막 지시문
 */
import type { ColleagueDept, ColleagueMeetingRole, ShareTurn } from "@/lib/office/models";
import type { Office } from "@/lib/office/office";
import { materialsOf } from "../colleague";
import { DEPT_INFO, REVIEW_MAX_QUESTIONS } from "./catalog";
import { PROMPT_BLOCKS } from "./prompt-data.generated";

const BASE = ["COMMON", "UNDERSTANDING", "TONE"];
const TAIL = ["PROVENANCE", "SOURCES", "QTYPES", "CURVEBALL", "PROCEDURE", "BANNED", "QUALITY", "DIFFICULTY", "FEEDBACK"];

export interface PromptState {
  dept: ColleagueDept;
  persona: string;
  meetingRole: ColleagueMeetingRole;
  curveball: boolean;
  context: Record<string, unknown>;
}

export interface HistoryLine {
  speaker: string;
  text: string;
}

/** 문서 3.4 buildPrompt를 그대로 옮겼다. 앞부분(블록)은 system, 뒷부분은 user 메시지로 나눠 보낸다. */
export function buildPrompt(s: PromptState, history: HistoryLine[], rejectNote?: string | null): { system: string; user: string } {
  const mode = s.meetingRole === "review" || s.meetingRole === "confirm" ? "REVIEW" : "MEETING";
  const order = [
    ...BASE,
    mode,
    ...TAIL,
    `ROLE_${s.dept}`,
    `PERSONA_${s.persona}`,
    `QBANK_${s.dept}`,
    "JARGON",
    `GLOSSARY_${s.dept}`,
    "CASES",
    "RESPONSE",
  ];
  const missing = order.filter((k) => PROMPT_BLOCKS[k] == null);
  if (missing.length > 0) throw new Error(`프롬프트 블록이 없습니다: ${missing.join(", ")}`);
  const system = order.map((k) => PROMPT_BLOCKS[k]).join("\n\n");
  let p = `[이번 요청 맥락]\n${JSON.stringify(s.context, null, 1)}`;
  p += `\n\n[지금까지 대화]\n${history.map((h) => `${h.speaker}: ${h.text}`).join("\n")}`;
  const modeName = mode === "REVIEW" ? "[팀장 사전 보고 모드]" : "[공유 회의 모드]";
  p += `\n\n[이번 발언] 당신의 meeting_role은 ${s.meetingRole}이다. ${modeName}의 해당 출력 규칙을 따른다.`;
  if (s.curveball) p += "\n\n[이번 질문] curveball이 true다. [변화구 질문] 규칙대로, used_curveballs에 없는 C 기법 하나로 신박하지만 당신 업무와 이어지는 질문을 하라.";
  if (rejectNote) p += `\n\n[반려] 직전 초안은 다음 이유로 반려됐다: ${rejectNote}. 규칙을 지켜 다시 작성하라.`;
  const user = p + "\n\n위 대화의 마지막 사용자 발화에 대한 당신의 다음 응답을 [응답 형식]의 JSON 하나로만 출력하라. 코드펜스와 설명 문장 없이 JSON만.";
  return { system, user };
}

/** 대화 기록 한 줄로: 화자 이름 + 말. 동료 발언은 받아들임 → 피드백 → 질문 순서로 잇는다. */
export function historyOf(turns: ShareTurn[], stage: "review" | "meeting", host: ColleagueDept | null): HistoryLine[] {
  return turns
    .filter((t) => t.stage === stage)
    .map((t) => {
      if (t.role === "user") return { speaker: "사용자", text: t.text ?? "" };
      if (t.role === "system") return { speaker: DEPT_INFO[stage === "review" ? "dev_lead" : (host ?? "planner")].name, text: t.text ?? "" };
      const r = t.reply!;
      const fb = r.feedback ? [r.feedback.strength, r.feedback.perspective, r.feedback.try_next].filter(Boolean).join(" ") : "";
      return { speaker: DEPT_INFO[t.dept!].name, text: [r.acknowledgement, fb, r.question].filter(Boolean).join(" ") };
    });
}

/** 요청 맥락 변수(3.2). */
export function contextOf(office: Office, s: { dept: ColleagueDept; persona: string; meetingRole: ColleagueMeetingRole; curveball: boolean; random?: () => number }) {
  const share = office.day.share;
  const recent = office.colleagueRecent;
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const meeting = share.meeting;
  return {
    department: s.dept,
    persona_id: s.persona,
    meeting_role: s.meetingRole,
    ...(meeting && s.meetingRole !== "review" && s.meetingRole !== "confirm"
      ? { participants: meeting.participants.map((p) => DEPT_INFO[p.dept].team), host: DEPT_INFO[meeting.host].team }
      : {}),
    review_question_count: share.review?.questionCount ?? 0,
    max_questions: s.meetingRole === "review" || s.meetingRole === "confirm" ? REVIEW_MAX_QUESTIONS : 1,
    difficulty: share.difficulty,
    used_lenses: uniq([...share.usedLenses, ...recent.lenses]),
    used_question_types: uniq([...share.usedQuestionTypes, ...recent.questionTypes]),
    curveball: s.curveball,
    used_curveballs: uniq([...share.usedCurveballs, ...recent.curveballs]),
    variation_seed: Math.floor((s.random ?? Math.random)() * 1_000_000),
    explained_terms: share.explainedTerms,
    interview_cases: INTERVIEW_CASES,
    user_profile: { target_role: office.profile.targetRole, experience: office.profile.experience.slice(0, 300) },
    daily_goal: office.day.goal,
    colleague_known_facts: share.knownFacts,
    unanswered_questions: share.openQuestions,
    ...materialsOf(office.day.submissions),
  };
}

/**
 * 인터뷰 사례(9장). 등록된 사례가 없으면 []이고, 그때는 interview_case 근거를 쓰지 않는다.
 * 팀이 동의받은 사례를 9장 양식으로 옮기면 여기에 넣는다.
 */
export const INTERVIEW_CASES: { id: string; role: string; situation: string; gap: string; asked: string; collected_at: string; consent: string }[] = [];
