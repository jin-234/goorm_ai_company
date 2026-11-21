/**
 * AI 동료 v2 목록(docs/ai-colleague/AI동료_프롬프트.md 2·10장, 부록 B).
 * 흐름: ① 개발팀장 사전 보고 → ② 부서 회의(디자인·마케팅·기획, 진행 기획팀) → ③ 회의록.
 */
import { FIXED_TEXT, GLOSSARY, LENSES, PERSONAS, QUESTION_BANK, SOURCE_NAMES } from "./prompt-data.generated";

export type DeptId = "dev_lead" | "designer" | "marketer" | "planner";
export const DEPTS: DeptId[] = ["dev_lead", "designer", "marketer", "planner"];

export const DEPT_INFO: Record<DeptId, { name: string; team: string }> = {
  dev_lead: { name: "AI 팀장", team: "개발팀" },
  designer: { name: "AI 디자이너", team: "디자인팀" },
  marketer: { name: "AI 마케터", team: "마케팅팀" },
  planner: { name: "AI 기획자", team: "서비스 기획팀" },
};

/** 회의 참석 부서(문서 1장 순서)와 진행자. */
export const MEETING_DEPTS: DeptId[] = ["designer", "marketer", "planner"];
export const MEETING_HOST: DeptId = "planner";

/** 팀장 사전 보고 질문 상한(13.1). */
export const REVIEW_MAX_QUESTIONS = 2;
/** 반복 방지로 기억하는 최근 개수(13.4). */
export const RECENT_LIMIT = 12;

export type MeetingRole = "review" | "confirm" | "ask" | "feedback" | "close";

export type BasisType = "role_reasoning" | "guide_scenario" | "practitioner_source" | "interview_case" | "team_design";
export const BASIS_TYPES: BasisType[] = ["role_reasoning", "guide_scenario", "practitioner_source", "interview_case", "team_design"];

/** 화면 '근거: …' 한 줄의 앞부분. 가이드 기반을 실제 사례처럼 보이지 않게 이름을 붙인다. */
export const BASIS_LABEL: Record<BasisType, string> = {
  role_reasoning: "직무 책임에서 끌어낸 질문",
  guide_scenario: "공식 가이드를 바탕으로 구성한 상황",
  practitioner_source: "공개된 실무 자료",
  interview_case: "등록된 인터뷰 사례",
  team_design: "팀이 설계한 관점(외부 근거 없음)",
};

/** 근거(basis.source_ids)로 쓸 수 있는 자료 ID. S18~S21 용어집은 근거가 아니라 terms_used에만(13.3). */
export const BASIS_SOURCE_IDS = Object.keys(SOURCE_NAMES).filter((id) => /^S(0\d|1[0-7])$/.test(id));

export type Decision = "approved" | "approved_with_notes" | "revise";
export const DECISIONS: Decision[] = ["approved", "approved_with_notes", "revise"];

/** 부록 B '컨펌 결정 표시'. */
export const DECISION_LABEL: Record<Decision, string> = (() => {
  const out = {} as Record<Decision, string>;
  for (const m of (FIXED_TEXT["컨펌 결정 표시"] ?? "").matchAll(/(\w+) → "([^"]+)"/g)) out[m[1] as Decision] = m[2];
  return out;
})();

export function basisLabel(basis: { type: string; source_ids: string[] } | null | undefined): string {
  if (!basis) return "";
  const type = BASIS_LABEL[basis.type as BasisType] ?? "근거 표시 없음";
  const names = basis.source_ids.map((id) => SOURCE_NAMES[id] ?? id).filter(Boolean);
  return `근거: ${type}${names.length ? ` · ${names.join(" · ")}` : ""}`;
}

/** 부록 B 인사말. */
export const greetings = {
  review: () => FIXED_TEXT["팀장 사전 보고 시작"],
  meeting: (host: DeptId, participants: DeptId[]) =>
    (FIXED_TEXT["부서 회의 시작 (진행자)"] ?? "")
      .replace("{진행 부서}", DEPT_INFO[host].team)
      .replace("{참석 부서}", participants.map((d) => DEPT_INFO[d].team.replace(/^서비스 /, "")).join("·")),
};

export const personasOf = (dept: DeptId) => PERSONAS.filter((p) => p.dept === dept);
export const personaById = (id: string) => PERSONAS.find((p) => p.id === id) ?? null;
export const lensesOf = (dept: DeptId) => LENSES.filter((l) => l.dept === dept);
export const bankOf = (dept: DeptId) => QUESTION_BANK.filter((q) => q.dept === dept);
export const glossaryOf = (dept: DeptId) => GLOSSARY.filter((g) => g.dept === dept);
export const glossaryById = (id: string) => GLOSSARY.find((g) => g.id === id) ?? null;
export const bankById = (id: string) => QUESTION_BANK.find((q) => q.id === id) ?? null;
