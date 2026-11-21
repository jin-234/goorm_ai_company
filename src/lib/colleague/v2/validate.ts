/**
 * 응답 다듬기와 검증(docs/ai-colleague/AI동료_프롬프트.md 10장 형식, 13.3 검사).
 * 걸리면 사유를 [반려]에 넣어 1회 다시 요청하고, 두 번째도 걸리면 고칠 수 있는 것만 고쳐서 쓴다(로그에 남김).
 */
import type { ColleagueDept, ColleagueMeetingRole, ColleagueReply, TermUse } from "@/lib/office/models";
import { firstQuestion, stripJudgement } from "../colleague";
import { BASIS_SOURCE_IDS, BASIS_TYPES, DECISIONS, glossaryOf } from "./catalog";
import { QUESTION_BANK } from "./prompt-data.generated";
import { INTERVIEW_CASES } from "./prompt";

type Json = Record<string, unknown>;
const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, n = 8) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, 300)).filter(Boolean).slice(0, n) : []);
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

/** 모델이 준 JSON(또는 코드펜스로 감싼 JSON)을 읽는다. 못 읽으면 null. */
export function parseJsonReply(content: string): Json | null {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return obj(JSON.parse(text));
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return obj(JSON.parse(m[0]));
    } catch {
      return null;
    }
  }
}

/** 10장 형식으로 모양을 맞춘다(빠진 칸은 빈 값). 판단은 하지 않는다. */
export function normalizeReply(raw: Json, dept: ColleagueDept, persona: string): ColleagueReply {
  const fb = obj(raw.feedback);
  const uc = obj(raw.understanding_check);
  const te = obj(raw.term_explain);
  const basis = obj(raw.basis) ?? {};
  const conf = obj(raw.confirm);
  const layer = str(uc?.layer);
  const status = str(uc?.status);
  const decision = str(conf?.decision);
  return {
    department: dept,
    persona_id: persona,
    acknowledgement: str(raw.acknowledgement),
    feedback: fb ? { strength: str(fb.strength), perspective: str(fb.perspective), try_next: str(fb.try_next) } : null,
    question: str(raw.question, 400),
    question_reason: str(raw.question_reason, 300),
    anchor_quote: str(raw.anchor_quote, 200),
    lens_id: str(raw.lens_id, 10),
    question_type: str(raw.question_type, 10),
    bank_id: str(raw.bank_id, 20),
    basis: { type: str(basis.type, 30), source_ids: strs(basis.source_ids, 6), note: str(basis.note, 300) },
    understanding_check:
      uc && ["what", "how", "why"].includes(layer) && ["clear", "partial", "unclear"].includes(status)
        ? { layer: layer as "what" | "how" | "why", status: status as "clear" | "partial" | "unclear", gap: str(uc.gap, 300) }
        : null,
    difficulty: [1, 2, 3].includes(Number(raw.difficulty)) ? Number(raw.difficulty) : 2,
    known_facts: strs(raw.known_facts, 12),
    open_questions: strs(raw.open_questions, 8),
    evidence_refs: strs(raw.evidence_refs, 8),
    term_explain: te
      ? { id: str(te.id, 20), term: str(te.term, 60), plain: str(te.plain, 300), example: str(te.example, 300), why_we_use: str(te.why_we_use, 300) }
      : null,
    terms_used: (Array.isArray(raw.terms_used) ? raw.terms_used : [])
      .map((t) => obj(t))
      .filter((t): t is Json => t != null)
      .map((t) => ({ id: str(t.id, 20), term: str(t.term, 60), plain: str(t.plain, 200) }))
      .slice(0, 5),
    can_finish: raw.can_finish === true,
    ...(conf
      ? {
          confirm: {
            decision: (DECISIONS.includes(decision as never) ? decision : "approved_with_notes") as "approved" | "approved_with_notes" | "revise",
            summary: str(conf.summary, 400),
            notes: strs(conf.notes, 3),
          },
        }
      : {}),
  };
}

export interface CheckContext {
  dept: ColleagueDept;
  meetingRole: ColleagueMeetingRole;
  /** 이번 단계에서 사용자가 한 말 전부(앵커 확인용). */
  userTexts: string[];
  usedLenses: string[];
  usedQuestionTypes: string[];
  curveball: boolean;
  usedCurveballs: string[];
}

const squash = (s: string) => s.replace(/[\s"'“”‘’「」『』.,!?~…·]/g, "");

/** 용어가 문장에 실제로 나오는지: "완료의 정의(DoD)" → "완료의 정의"·"DoD" 중 하나, "알럿 / 컨펌" → 둘 중 하나. */
export function termAppears(term: string, text: string): boolean {
  const alts = term
    .split(/\s*\/\s*|[()]/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  return alts.some((a) => squash(text).toLowerCase().includes(squash(a).toLowerCase()));
}

const EXPERIENCE = /실제\s*(기획자|디자이너|마케터|개발자|팀장)|현업에서\s*실제로|제가\s*예전에|저희\s*팀에서\s*실제로|제가\s*겪어\s*보니|제가\s*겪어보니/;
const ASKS_TERM = /뭐예요|뭔가요|뭐에요|무슨\s*뜻|무슨\s*말|모르겠/;

/** 사용자가 마지막 말에서 뜻을 물은 그 부서 용어(없으면 null). */
export function askedTerm(dept: ColleagueDept, lastUser: string) {
  if (!ASKS_TERM.test(lastUser)) return null;
  return glossaryOf(dept).find((g) => termAppears(g.term, lastUser)) ?? null;
}

/** 13.3 반려 사유. 통과하면 []. */
export function rejectReasons(r: ColleagueReply, c: CheckContext): string[] {
  const out: string[] = [];
  const asking = c.meetingRole === "review" || c.meetingRole === "ask";
  const q = r.question.trim();
  if (asking && q) {
    if ((q.match(/[?？]/g) ?? []).length >= 2) out.push("질문에 물음표가 2개 이상이다(질문 하나 원칙)");
    if (r.lens_id && c.usedLenses.includes(r.lens_id)) out.push(`lens_id ${r.lens_id}는 최근에 쓴 렌즈다`);
    if (r.question_type && c.usedQuestionTypes.includes(r.question_type)) out.push(`question_type ${r.question_type}는 최근에 쓴 질문 형식이다`);
    if (r.anchor_quote && !c.userTexts.some((t) => squash(t).includes(squash(r.anchor_quote)))) out.push("anchor_quote가 사용자 발화에 없다");
    if (!r.anchor_quote) out.push("anchor_quote가 비어 있다");
    if (r.bank_id && !QUESTION_BANK.some((b) => b.id === r.bank_id && b.dept === c.dept)) out.push(`bank_id ${r.bank_id}는 이 부서 질문 은행에 없다`);
    if (c.curveball && !r.question_type.startsWith("C")) out.push("curveball이 true인데 question_type이 C로 시작하지 않는다");
    if (c.curveball && c.usedCurveballs.includes(r.question_type)) out.push(`변화구 기법 ${r.question_type}는 최근에 썼다`);
  }
  const allowed = new Set([...BASIS_SOURCE_IDS, ...INTERVIEW_CASES.map((x) => x.id)]);
  const badIds = r.basis.source_ids.filter((id) => !allowed.has(id));
  if (badIds.length) out.push(`basis.source_ids에 쓸 수 없는 ID가 있다: ${badIds.join(", ")}(S18~S21은 terms_used에만)`);
  if (r.basis.type && !BASIS_TYPES.includes(r.basis.type as never)) out.push(`basis.type ${r.basis.type}는 정해진 다섯 가지가 아니다`);
  if (r.basis.type === "interview_case" && INTERVIEW_CASES.length === 0) out.push("등록된 인터뷰 사례가 없는데 basis.type이 interview_case다");
  const lastUser = c.userTexts[c.userTexts.length - 1] ?? "";
  const asked = askedTerm(c.dept, lastUser);
  if (asked && !r.term_explain) out.push(`사용자가 '${asked.term}'의 뜻을 물었는데 term_explain이 비어 있다`);
  const spoken = [r.acknowledgement, r.question, r.feedback?.strength, r.feedback?.perspective, r.feedback?.try_next].filter(Boolean).join(" ");
  if (r.terms_used.length >= 3) out.push("terms_used가 3개 이상이다");
  const dict = new Map(glossaryOf(c.dept).map((g) => [g.id, g]));
  for (const t of r.terms_used) {
    const g = dict.get(t.id);
    if (!g) out.push(`terms_used의 ${t.id || t.term}는 이 부서 용어집에 없다`);
    else if (!termAppears(g.term, spoken)) out.push(`terms_used의 '${g.term}'이 문장에 실제로 나오지 않는다`);
  }
  if (EXPERIENCE.test(spoken)) out.push("실제 사례·경험담으로 들리는 표현이 있다");
  if (c.meetingRole === "confirm" && !r.confirm) out.push("confirm 단계인데 confirm 필드가 없다");
  return out;
}

/** 두 번째도 걸렸을 때: 고칠 수 있는 것만 고친다. 판정 표현(점수·합격 등)은 늘 뺀다. */
export function sanitizeReply(r: ColleagueReply, c: CheckContext): ColleagueReply {
  const out: ColleagueReply = structuredClone(r);
  const asking = c.meetingRole === "review" || c.meetingRole === "ask";
  if (!asking) out.question = "";
  else out.question = firstQuestion(out.question);
  const allowed = new Set([...BASIS_SOURCE_IDS, ...INTERVIEW_CASES.map((x) => x.id)]);
  out.basis.source_ids = out.basis.source_ids.filter((id) => allowed.has(id));
  if (!BASIS_TYPES.includes(out.basis.type as never) || (out.basis.type === "interview_case" && INTERVIEW_CASES.length === 0)) {
    out.basis = { type: "team_design", source_ids: [], note: out.basis.note || "근거 표시를 확인하지 못함" };
  }
  if (out.bank_id && !QUESTION_BANK.some((b) => b.id === out.bank_id && b.dept === c.dept)) out.bank_id = "";
  const dict = new Map(glossaryOf(c.dept).map((g) => [g.id, g]));
  const spoken = [out.acknowledgement, out.question, out.feedback?.strength, out.feedback?.perspective, out.feedback?.try_next].filter(Boolean).join(" ");
  out.terms_used = out.terms_used
    .filter((t) => dict.has(t.id) && termAppears(dict.get(t.id)!.term, spoken))
    .slice(0, 2)
    .map((t): TermUse => ({ id: t.id, term: dict.get(t.id)!.term, plain: t.plain || dict.get(t.id)!.plain }));
  const clean = (s: string) => stripJudgement(s);
  out.acknowledgement = clean(out.acknowledgement);
  if (out.feedback) out.feedback = { strength: clean(out.feedback.strength), perspective: clean(out.feedback.perspective), try_next: clean(out.feedback.try_next) };
  if (EXPERIENCE.test(out.acknowledgement)) out.acknowledgement = "";
  return out;
}
