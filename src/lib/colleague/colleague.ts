/**
 * AI 동료(팀장 제안·기획자 대화·마감 요약). 개정 기획서 4.3~4.4.
 * - 맥락(D)은 지금 대화에 필요한 범위만 골라 보낸다.
 * - Solar 응답은 서버에서 다시 지킨다: 질문 하나, 반복 금지, 상한, 건너뛰기, 읽지 않은 자료는 근거로 쓰지 않음.
 * - Solar가 없거나 실패하면 정해진 양식(manual)을 돌려준다. 화면은 이것을 AI가 말한 것처럼 보이지 않게 한다.
 */
import type { Office } from "@/lib/office/office";
import type { PlannerReply, Review, ShareTurn, Submission } from "@/lib/office/models";
import { plannerReplyOf, reviewOf } from "@/lib/server/actions";
import { SolarClient, SolarError } from "@/lib/solar/client";
import {
  leaderSystem, PLANNER_SCHEMA, PLANNER_SCHEMA_NAME, plannerSystem, PROPOSAL_SCHEMA, PROPOSAL_SCHEMA_NAME,
  REVIEW_SCHEMA, REVIEW_SCHEMA_NAME, reviewSystem, SKIP_MESSAGE,
} from "./prompts";

export type Source = "solar" | "manual";

export interface ProposedTask {
  title: string;
  completionCriteria: string;
  shareForm: string;
}

export interface LeaderProposal {
  tasks: ProposedTask[];
  question: string;
}

/** 한 번에 보내는 자료 글자 수 상한(필요한 범위만 보낸다). */
const MATERIAL_LIMIT = 2400;
const TEXT_LIMIT = 400;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…(이하 생략)` : s);

// MARK: - 맥락(4.3 D)

/** 제출물을 '읽은 자료'와 '주소만 받은 자료'로 나눈다. 링크는 열지 않았다. */
export function materialsOf(submissions: Submission[]) {
  const read = submissions.filter((s) => s.readScope === "read");
  const notRead = submissions.filter((s) => s.readScope !== "read");
  return {
    shared_materials: read.map((s) => ({ id: `제출물 ${s.id}`, kind: s.kind, content: clip(s.content, MATERIAL_LIMIT) })),
    links_not_read: notRead.map((s) => ({ id: `제출물 ${s.id}`, kind: s.kind, address: clip(s.content, 300), note: "주소만 받음. 열어 보지 않았다." })),
    readable_scope: read.length > 0 ? "붙여 넣은 글·코드만 읽었다. 실행하지 않았다." : "읽은 자료 없음(설명 기준).",
  };
}

/** 대화 기록을 턴 번호와 함께. */
export function historyOf(turns: ShareTurn[]) {
  return turns.map((t, i) => ({
    turn: `턴 ${i + 1}`,
    role: t.role === "user" ? "사용자" : "기획자",
    text: t.role === "user" ? clip(t.text ?? "", TEXT_LIMIT) : [t.reply?.acknowledgement, t.reply?.question].filter(Boolean).join(" "),
  }));
}

function plannerContext(office: Office) {
  const day = office.day;
  return {
    user_profile: { target_role: office.profile.targetRole, experience: clip(office.profile.experience ?? "", 300) },
    daily_goal: day.goal,
    tasks: day.tasks.map((t) => ({ title: t.title, completion_criteria: t.completionCriteria, share_form: t.shareForm, status: t.status })),
    ...materialsOf(day.submissions),
    conversation_history: historyOf(day.share.turns),
    colleague_known_facts: day.share.knownFacts,
    unanswered_questions: day.share.openQuestions,
    role_followup_task: "개발팀이 공유한 내용을 바탕으로 사용자 안내 초안을 준비한다.",
    question_count: day.share.questionCount,
    max_questions: day.share.maxQuestions,
  };
}

// MARK: - 서버 쪽 안전장치

const normalize = (q: string) => q.replace(/[\s?？.!,~·'"“”‘’()]/g, "").toLowerCase();

/** 질문 안에 여러 질문을 몰아넣었으면 첫 질문만 남긴다. */
export function firstQuestion(q: string): string {
  const text = q.trim();
  const at = text.search(/[?？]/);
  return at >= 0 ? text.slice(0, at + 1).trim() : text;
}

/** 이전에 한 질문들. */
function askedQuestions(turns: ShareTurn[]): string[] {
  return turns.filter((t) => t.role === "planner" && t.reply?.question).map((t) => t.reply!.question);
}

/**
 * 모델 응답을 규칙에 맞게 다듬는다.
 * - 질문 하나, 이미 한 질문 반복 금지, 상한 도달 시 질문 없이 마무리
 * - 사용자가 건너뛴 질문은 남은 질문으로 남김
 * - 근거는 실제 대화 턴과 읽은 제출물만
 */
export function guardPlannerReply(raw: PlannerReply, ctx: { turns: ShareTurn[]; questionCount: number; maxQuestions: number; submissions: Submission[] }): PlannerReply {
  const reply: PlannerReply = { ...raw, known_facts: [...raw.known_facts], open_questions: [...raw.open_questions], evidence_refs: [...raw.evidence_refs] };
  const asked = askedQuestions(ctx.turns);
  let question = firstQuestion(reply.question);
  if (question && asked.some((q) => normalize(q) === normalize(question))) question = "";
  if (ctx.questionCount >= ctx.maxQuestions) question = "";
  reply.question = question;
  if (!question) {
    reply.question_reason = "";
    reply.can_finish = true;
  }

  // 건너뛰기: 바로 앞 질문을 남은 질문에 둔다.
  const lastUser = [...ctx.turns].reverse().find((t) => t.role === "user");
  if (lastUser?.text?.trim() === SKIP_MESSAGE) {
    const skipped = asked[asked.length - 1];
    if (skipped && !reply.open_questions.some((q) => normalize(q) === normalize(skipped))) reply.open_questions.push(skipped);
  }

  const turnCount = ctx.turns.length;
  const readIds = new Set(ctx.submissions.filter((s) => s.readScope === "read").map((s) => `제출물 ${s.id}`));
  reply.evidence_refs = reply.evidence_refs.filter((ref) => {
    const turn = /^턴\s*(\d+)$/.exec(ref.trim());
    if (turn) return Number(turn[1]) >= 1 && Number(turn[1]) <= turnCount;
    return readIds.has(ref.trim());
  });
  return reply;
}

/** 요약에서 근거 없는 확인 표현을 막고, 근거는 실제 턴·읽은 제출물만 남긴다. */
export function guardReview(raw: Review, ctx: { turns: ShareTurn[]; submissions: Submission[] }): Review {
  const review: Review = { ...raw, open_questions: [...raw.open_questions], evidence_refs: [...raw.evidence_refs] };
  const readIds = new Set(ctx.submissions.filter((s) => s.readScope === "read").map((s) => `제출물 ${s.id}`));
  review.evidence_refs = review.evidence_refs.filter((ref) => {
    const turn = /^턴\s*(\d+)$/.exec(ref.trim());
    if (turn) return Number(turn[1]) >= 1 && Number(turn[1]) <= ctx.turns.length;
    return readIds.has(ref.trim());
  });
  if (readIds.size === 0) review.artifact_observations = "읽은 자료 없음(설명 기준).";
  // 실행하지 않았으므로 '검증 완료'류 표현은 '설명 기준'으로 바꾼다.
  for (const key of ["reported_work", "artifact_observations", "shared_scope_and_limits", "job_connection"] as const) {
    review[key] = review[key].replace(/(정상\s*)?동작\s*(검증|확인)\s*(완료|됨|했습니다)?|검증\s*완료/g, "설명 기준");
  }
  return review;
}

// MARK: - 수동 양식(AI 미연결)

/** AI가 없을 때 차례로 보여 줄 정해진 질문(기획자 역할 지침의 '파악할 정보'). */
export const MANUAL_QUESTIONS = [
  "이 결과로 누가 무엇을 할 수 있게 됐나요?",
  "지금 가능한 범위와 아직 안 되는 범위는 무엇인가요?",
  "안내를 쓸 때 꼭 알아야 할 주의점이나 아직 정하지 않은 것이 있나요?",
];

export function manualPlannerReply(ctx: { questionCount: number; maxQuestions: number; openQuestions: string[]; knownFacts: string[] }): PlannerReply {
  const next = ctx.questionCount < Math.min(ctx.maxQuestions, MANUAL_QUESTIONS.length) ? MANUAL_QUESTIONS[ctx.questionCount] : "";
  return {
    acknowledgement: "",
    question: next,
    question_reason: next ? "사용자 안내 초안에 들어갈 항목입니다(정해진 양식)." : "",
    known_facts: ctx.knownFacts,
    open_questions: ctx.openQuestions,
    evidence_refs: [],
    can_finish: !next,
  };
}

export function manualReview(office: Office): Review {
  const day = office.day;
  const said = day.share.turns.filter((t) => t.role === "user" && t.text && t.text !== SKIP_MESSAGE).map((t) => t.text!.trim());
  const read = day.submissions.filter((s) => s.readScope === "read").length;
  return {
    reported_work: clip(said.join("\n"), 1200),
    explained_learning: "",
    artifact_observations: read > 0 ? `붙여 넣은 제출물 ${read}건(요약은 직접 적어 주세요).` : "읽은 자료 없음(설명 기준).",
    shared_scope_and_limits: "",
    open_questions: [...day.share.openQuestions],
    job_connection: "",
    next_action: "",
    evidence_refs: day.share.turns.map((_, i) => `턴 ${i + 1}`).filter((_, i) => day.share.turns[i].role === "user"),
  };
}

export function manualProposal(goal: string): LeaderProposal {
  const title = goal.trim().split("\n")[0].slice(0, 80);
  return {
    tasks: title ? [{ title, completionCriteria: "", shareForm: "" }] : [],
    question: "완료 기준과 저녁에 공유할 형태를 직접 적어 주세요.",
  };
}

// MARK: - Solar 호출

function parse(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new SolarError("malformed", { message: "JSON이 아닙니다" });
  }
}

export interface Outcome<T> {
  source: Source;
  value: T;
  solarError: ReturnType<SolarError["toJSON"]> | null;
}

/** AI 팀장: 오늘 목표를 작은 과제·완료 기준·공유 형태로 제안. 상태는 바꾸지 않는다. */
export async function proposeScope(client: SolarClient, input: { goal: string; targetRole: string; availableMinutes: number | null; carried: string[] }): Promise<Outcome<LeaderProposal>> {
  try {
    const content = await client.completeJSON({
      system: leaderSystem(),
      messages: [{
        role: "user",
        content: JSON.stringify({
          daily_goal: clip(input.goal, 1500),
          target_role: input.targetRole,
          available_minutes: input.availableMinutes,
          carried_from_before: input.carried,
        }),
      }],
      schemaName: PROPOSAL_SCHEMA_NAME,
      schema: PROPOSAL_SCHEMA,
      temperature: 0.3,
      maxTokens: 900,
    });
    const value = parse(content) as { tasks?: unknown; question?: unknown };
    const tasks = (Array.isArray(value.tasks) ? value.tasks : [])
      .map((t) => t as Record<string, unknown>)
      .map((t) => ({
        title: String(t.title ?? "").trim().slice(0, 120),
        completionCriteria: String(t.completionCriteria ?? "").trim().slice(0, 300),
        shareForm: String(t.shareForm ?? "").trim().slice(0, 200),
      }))
      .filter((t) => t.title)
      .slice(0, 3);
    if (tasks.length === 0) throw new SolarError("malformed", { message: "과제가 비어 있습니다" });
    return { source: "solar", value: { tasks, question: firstQuestion(String(value.question ?? "")) }, solarError: null };
  } catch (error) {
    if (!(error instanceof SolarError)) throw error;
    return { source: "manual", value: manualProposal(input.goal), solarError: error.toJSON() };
  }
}

/** AI 기획자: 사용자의 마지막 말까지 기록된 상태에서 다음 응답 하나. */
export async function plannerReply(client: SolarClient, office: Office): Promise<Outcome<PlannerReply>> {
  const share = office.day.share;
  const guardCtx = { turns: share.turns, questionCount: share.questionCount, maxQuestions: share.maxQuestions, submissions: office.day.submissions };
  try {
    const content = await client.completeJSON({
      system: plannerSystem(share.maxQuestions, share.questionCount),
      messages: [{ role: "user", content: JSON.stringify(plannerContext(office)) }],
      schemaName: PLANNER_SCHEMA_NAME,
      schema: PLANNER_SCHEMA,
      temperature: 0.4,
      maxTokens: 900,
    });
    const value = guardPlannerReply(plannerReplyOf(parse(content)), guardCtx);
    return { source: "solar", value, solarError: null };
  } catch (error) {
    if (!(error instanceof SolarError)) throw error;
    const value = manualPlannerReply({ questionCount: share.questionCount, maxQuestions: share.maxQuestions, openQuestions: share.openQuestions, knownFacts: share.knownFacts });
    return { source: "manual", value, solarError: error.toJSON() };
  }
}

/** 마감 요약 초안. */
export async function reviewDraft(client: SolarClient, office: Office): Promise<Outcome<Review>> {
  const day = office.day;
  const guardCtx = { turns: day.share.turns, submissions: day.submissions };
  try {
    const content = await client.completeJSON({
      system: reviewSystem(),
      messages: [{
        role: "user",
        content: JSON.stringify({
          ...plannerContext(office),
          share_ended_by: day.share.endedBy,
        }),
      }],
      schemaName: REVIEW_SCHEMA_NAME,
      schema: REVIEW_SCHEMA,
      temperature: 0.2,
      maxTokens: 1400,
    });
    return { source: "solar", value: guardReview(reviewOf(parse(content)), guardCtx), solarError: null };
  } catch (error) {
    if (!(error instanceof SolarError)) throw error;
    return { source: "manual", value: manualReview(office), solarError: error.toJSON() };
  }
}
