/**
 * 예시 응답(AI 연결 전, Solar 키가 없을 때)과 AI 실패 때의 정해진 응답.
 * 문서 데이터(질문 은행 신호·부서 용어집·렌즈·질문 형식)로 10장 형식 응답을 만든다. 화면은 '예시 응답' 꼬리표를 붙인다.
 * 모델이 아니므로 사용자의 말을 붙잡는 방식은 단순하다: 마지막 말의 앞부분을 앵커로, 신호 단어가 겹치는 질문 은행 항목을 관점으로.
 */
import type { ColleagueDept, ColleagueMeetingRole, ColleagueReply, ShareTurn, UnderstandingCheck } from "@/lib/office/models";
import type { Office } from "@/lib/office/office";
import { DEPT_INFO, bankOf, glossaryOf, lensesOf, personaById } from "./catalog";
import { askedTerm, termAppears } from "./validate";
import { QUESTION_TYPES } from "./prompt-data.generated";

const REASON: Record<ColleagueDept, string> = {
  dev_lead: "회의 전에 개발 관점에서 설명할 수 있는지 같이 확인하려고요.",
  designer: "제가 화면 상태와 사용자 흐름을 정리해야 해서요.",
  marketer: "제가 고객 안내 메시지와 성과 지표를 준비해야 해서요.",
  planner: "제가 기능 정의서와 사용자 안내 초안을 써야 해서요.",
};

const TYPES_BY_DIFFICULTY: Record<number, string[]> = {
  1: ["Q01", "Q14", "Q13", "Q12"],
  2: ["Q02", "Q08", "Q03", "Q13", "Q16", "Q09"],
  3: ["Q04", "Q06", "Q05", "Q11", "Q15"],
};

/** 부서별 변화구 기법 순서(문서 CURVEBALL 블록)와 예시 문장. 앞에 앵커 인용을 붙인다. */
const CURVE_PREF: Record<ColleagueDept, string[]> = {
  designer: ["C04", "C10", "C11"],
  marketer: ["C06", "C09", "C03"],
  planner: ["C07", "C08", "C12"],
  dev_lead: ["C01", "C02", "C12"],
};
const CURVE_TEXT: Record<string, string> = {
  C01: "제가 만들고 당신이 다른 팀이라면, 이 결과에서 제일 먼저 고쳐 달라고 할 건 뭐예요?",
  C02: "이 기능을 100만 명이 동시에 쓴다면 가장 먼저 달라지는 건 뭘까요?",
  C03: "1년 뒤 이 기능을 없앤다면 누가 가장 먼저 아쉬워할까요?",
  C04: "화면 없이 전화로만 이 기능을 안내해야 한다면 첫 문장은 뭐라고 할래요?",
  C05: "이 기능이 도서관의 무엇이라면 어떤 역할일까요?",
  C06: "'편리하다', '쉽다', '빠르다'를 빼고 이 결과의 장점을 말해 보면 어떻게 될까요?",
  C07: "이 기능 때문에 문제가 생겼다는 기사가 난다면 제목은 뭘까요?",
  C08: "이 기능을 절대 쓰지 않을 사람은 누구일까요?",
  C09: "이 기능만 따로 판다면 얼마를 받을 수 있다고 봐요?",
  C10: "이 기능을 정반대로 동작하게 만든다면 오히려 좋아지는 건 뭘까요?",
  C11: "사용자가 이 화면을 아주 잠깐만 본다면 머릿속에 남는 한 가지는 뭘까요?",
  C12: "이 결과를 유지하려면 앞으로 누가 무엇을 계속 해야 할까요?",
};

/** 따옴표로 받은 말 뒤 조사: 받침이 있으면 '이라고', 없으면 '라고'. */
export function quoteSaid(said: string): string {
  const anchor = said.trim().replace(/[.!?。]+$/, "");
  const last = anchor.slice(-1);
  const code = last.charCodeAt(0) - 0xac00;
  const batchim = code >= 0 && code < 11172 && code % 28 !== 0;
  return `'${anchor}'${batchim ? "이라고" : "라고"} 하셨는데,`;
}

const words = (s: string) => (s.match(/[A-Za-z]{2,}|[가-힣]{2,}/g) ?? []).map((w) => w.replace(/(했다고|한다고|했고|해요|했어요|합니다|함|을|를|이|가|은|는|에|에서|으로|로|와|과|도)$/, "")).filter((w) => w.length >= 2);
const overlap = (a: string, b: string) => {
  const bw = new Set(words(b));
  return words(a).filter((w) => [...bw].some((x) => x.includes(w) || w.includes(x))).length;
};

/** 마지막 사용자 말에서 앵커로 쓸 앞부분(그대로 들어 있어야 검증을 통과한다). */
export function anchorOf(text: string): string {
  const first = text.trim().split(/(?<=[.!?。])\s+|\n/)[0] ?? text.trim();
  const clause = first.split(/,\s*|는데\s|지만\s/)[0];
  const base = clause.length >= 6 ? clause : first;
  return base.replace(/[.!?。]+$/, "").slice(0, 28).trim();
}

const snippet = (t: string, n = 40) => {
  const s = t.trim().split(/(?<=[.!?。])\s+|\n/)[0] ?? t.trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
};

function judgeAnswer(answer: string): UnderstandingCheck {
  const how = /누르|입력|치면|하면|순서|다음에|그러면|호출|요청|보내|받아|저장/.test(answer);
  const why = /때문|이유|그래서|위해|대신|골랐/.test(answer);
  const layer = why ? "why" : how ? "how" : "what";
  if (/모르|몰라|잘 모르겠|건너뛸/.test(answer) || answer.trim().length < 8) {
    return { layer, status: "unclear", gap: "이번 질문이 다룬 부분은 아직 설명되지 않았어요." };
  }
  if (answer.trim().length >= 40 && (how || why)) return { layer, status: "clear", gap: "" };
  return { layer, status: "partial", gap: layer === "what" ? "결과는 말했지만 안에서 일어나는 과정은 아직 비어 있어요." : "과정은 말했지만 그렇게 고른 이유는 아직 비어 있어요." };
}

interface Ctx {
  office: Office;
  dept: ColleagueDept;
  persona: string;
  meetingRole: ColleagueMeetingRole;
  curveball: boolean;
}

function stageTurns(office: Office, meetingRole: ColleagueMeetingRole): ShareTurn[] {
  const stage = meetingRole === "review" || meetingRole === "confirm" ? "review" : "meeting";
  return office.day.share.turns.filter((t) => t.stage === stage);
}

function baseReply(c: Ctx): ColleagueReply {
  return {
    department: c.dept,
    persona_id: c.persona,
    acknowledgement: "",
    feedback: null,
    question: "",
    question_reason: "",
    anchor_quote: "",
    lens_id: "",
    question_type: "",
    bank_id: "",
    basis: { type: "role_reasoning", source_ids: [c.dept === "marketer" ? "S06" : "S01"], note: "직무 책임에서 질문 목적을 끌어냄(예시 응답)" },
    understanding_check: null,
    difficulty: c.office.day.share.difficulty,
    known_facts: [],
    open_questions: [...c.office.day.share.openQuestions],
    evidence_refs: [],
    term_explain: null,
    terms_used: [],
    can_finish: false,
  };
}

/** 질문 하나 만들기(review·ask). */
function makeQuestion(c: Ctx, r: ColleagueReply, lastUser: string): void {
  const share = c.office.day.share;
  const used = new Set([...share.usedLenses, ...c.office.colleagueRecent.lenses]);
  const usedTypes = new Set([...share.usedQuestionTypes, ...c.office.colleagueRecent.questionTypes]);
  const usedBank = new Set(share.turns.map((t) => t.reply?.bank_id).filter(Boolean));
  const persona = personaById(c.persona);
  const lenses = lensesOf(c.dept);
  const lens = [...(persona?.lenses ?? []).map((id) => lenses.find((l) => l.id === id)!).filter(Boolean), ...lenses].find((l) => !used.has(l.id)) ?? lenses[0];
  const anchor = anchorOf(lastUser);
  r.anchor_quote = anchor;
  r.lens_id = lens.id;
  r.question_reason = REASON[c.dept];

  if (c.curveball) {
    const usedCurves = new Set([...share.usedCurveballs, ...c.office.colleagueRecent.curveballs]);
    const cb = [...CURVE_PREF[c.dept], ...Object.keys(CURVE_TEXT)].find((id) => !usedCurves.has(id)) ?? CURVE_PREF[c.dept][0];
    r.question_type = cb;
    r.question = `${quoteSaid(anchor)} ${CURVE_TEXT[cb]}`;
    r.basis = { type: "team_design", source_ids: [], note: "변화구 질문" };
    return;
  }

  const bank = bankOf(c.dept)
    .filter((b) => !usedBank.has(b.id))
    .map((b) => ({ b, score: overlap(b.signal, lastUser) }))
    .sort((x, y) => y.score - x.score)[0];
  if (bank && bank.score > 0) {
    r.bank_id = bank.b.id;
    r.basis = { type: bank.b.basisType, source_ids: [bank.b.sourceId], note: `질문 은행 ${bank.b.id} 관점(예시 응답)` };
  }
  const types = [...(TYPES_BY_DIFFICULTY[share.difficulty] ?? TYPES_BY_DIFFICULTY[2]), ...QUESTION_TYPES];
  r.question_type = types.find((t) => !usedTypes.has(t)) ?? types[0];

  // 부서 용어 하나를 섞은 질문(용어집 '질문 속 쓰임' 중 물음표가 하나인 문장). 이미 풀어 준 용어는 피한다.
  const glossary = glossaryOf(c.dept).filter((g) => (g.usage.match(/\?/g) ?? []).length === 1 && termAppears(g.term, g.usage) && !share.explainedTerms.includes(g.id));
  const pick =
    glossary.map((g) => ({ g, score: overlap(`${g.term} ${g.plain} ${g.usage}`, lastUser) + (bank && bank.score > 0 ? overlap(g.usage, bank.b.angle) : 0) })).sort((x, y) => y.score - x.score)[0]?.g ??
    glossaryOf(c.dept)[0];
  const gloss = share.difficulty === 1 ? `(${pick.plain})` : "";
  const core = gloss ? pick.usage.replace(pick.term.split(/\s*\/\s*|\(/)[0].trim(), (m) => `${m}${gloss}`) : pick.usage;
  r.question = `${quoteSaid(anchor)} ${core}`;
  if (termAppears(pick.term, r.question)) r.terms_used = [{ id: pick.id, term: pick.term, plain: pick.plain }];
}

/** 예시 응답 하나. */
export function sampleReply(c: Ctx): ColleagueReply {
  const r = baseReply(c);
  const turns = stageTurns(c.office, c.meetingRole);
  const users = turns.filter((t) => t.role === "user");
  const lastUser = users[users.length - 1]?.text ?? "";
  r.known_facts = users.map((t) => snippet(t.text ?? "", 60));
  r.evidence_refs = users.map((t) => `turn_${turns.indexOf(t) + 1}`);
  const mine = turns.filter((t) => t.role === "colleague" && t.dept === c.dept && t.reply?.question);
  const answered = mine.length > 0 && turns.indexOf(mine[mine.length - 1]) < turns.indexOf(users[users.length - 1]);

  // 사용자가 용어 뜻을 물었다(JARGON 4-1).
  const asked = askedTerm(c.dept, lastUser);
  if (asked && (c.meetingRole === "review" || c.meetingRole === "ask" || c.meetingRole === "feedback")) {
    const prev = mine[mine.length - 1]?.reply?.question ?? "";
    r.acknowledgement = "좋은 질문이에요. 모르는 말은 바로 물어보는 게 맞아요.";
    r.term_explain = {
      id: asked.id,
      term: asked.term,
      plain: asked.plain,
      example: `지금 설명하신 '${anchorOf(users[0]?.text ?? lastUser)}'로 치면, 그 작업에 이 말을 대어 보는 거예요.`,
      why_we_use: `${DEPT_INFO[c.dept].team}에서는 일을 나누고 확인할 때 이 말로 서로 같은 기준을 맞춰요.`,
    };
    r.terms_used = [{ id: asked.id, term: asked.term, plain: asked.plain }];
    if (c.meetingRole !== "feedback" && prev) {
      r.question = `쉽게 다시 여쭤보면, ${prev.replace(/^'[^']*'(이)?라고 하셨는데,\s*/, "")}`;
      r.anchor_quote = anchorOf(users[0]?.text ?? lastUser);
      r.question_reason = REASON[c.dept];
      r.lens_id = "";
      r.question_type = "";
    }
    if (!termAppears(asked.term, [r.acknowledgement, r.question].join(" "))) r.acknowledgement = `'${asked.term}' 말씀이시죠. 모르는 말은 바로 물어보는 게 맞아요.`;
    return r;
  }

  if (answered || c.meetingRole === "feedback" || c.meetingRole === "confirm") {
    const check = judgeAnswer(lastUser);
    r.understanding_check = check;
    const lens = lensesOf(c.dept).find((l) => l.id === mine[mine.length - 1]?.reply?.lens_id) ?? lensesOf(c.dept)[0];
    r.feedback = {
      strength: check.status === "unclear" ? "" : `${quoteSaid(snippet(lastUser, 30)).replace(/ 하셨는데,$/, "")} 구체적으로 짚어 주셔서 제 업무에 바로 쓸 수 있어요.`,
      perspective: `제 업무에서는 '${lens.name}'도 같이 봐요.`,
      try_next: check.status === "clear" ? "다음 설명에서도 지금처럼 순서와 이유를 함께 말해 보세요." : "다음에 설명할 때는 버튼을 누른 뒤 안에서 일어나는 일을 순서대로 한 번 말해 보세요.",
    };
    if (check.status === "unclear") r.acknowledgement = "지금 확인이 필요한 부분을 찾았네요.";
    else r.acknowledgement = `${DEPT_INFO[c.dept].team} 입장에서 잘 들었어요.`;
  }

  if (c.meetingRole === "confirm") {
    const checks = c.office.day.share.turns
      .filter((t) => t.stage === "review" && t.role === "colleague" && t.reply?.understanding_check)
      .map((t) => t.reply!.understanding_check!)
      .concat(r.understanding_check ? [r.understanding_check] : []);
    const decision = checks.some((x) => x.status === "unclear") ? "revise" : checks.some((x) => x.status === "partial") || checks.length === 0 ? "approved_with_notes" : "approved";
    const gaps = checks.map((x) => x.gap).filter(Boolean);
    r.confirm = {
      decision,
      summary: `오늘 '${anchorOf(users[0]?.text ?? "")}' 작업을 회의에서 공유하실 거죠. 들은 대로라면 ${snippet(users[users.length - 1]?.text ?? "", 50)}까지 설명해 주셨어요.`,
      notes: gaps.length ? [...new Set(gaps)].slice(0, 3) : ["회의에서는 직접 확인한 것과 추측한 것을 나눠 말하기"],
    };
    if (decision === "revise") r.acknowledgement = "핵심 동작을 조금 더 정리하면 좋겠어요. 그래도 회의는 진행할 수 있어요.";
    r.can_finish = true;
    return r;
  }

  if (c.meetingRole === "close") {
    const meeting = c.office.day.share.meeting;
    const first = users[0]?.text ?? "";
    r.acknowledgement = `오늘 '${anchorOf(first)}' 작업을 공유해 주셨어요. 부서마다 물은 것에 답해 주셨고, 남은 확인은 아래에 정리했어요.`;
    const open = c.office.day.share.turns
      .filter((t) => t.stage === "meeting" && t.role === "colleague" && t.meetingRole === "feedback" && t.reply?.understanding_check && t.reply.understanding_check.status !== "clear")
      .map((t) => `${DEPT_INFO[t.dept!].team}: ${t.reply!.understanding_check!.gap}`);
    r.open_questions = open.length ? [...new Set(open)] : (meeting?.participants ?? []).map((p) => `${DEPT_INFO[p.dept].team}: 회의에서 나온 답을 문서에 옮겨 두기`);
    r.feedback = { strength: "", perspective: "", try_next: open.length ? `${open[0].replace(/^[^:]+:\s*/, "")} 이 부분부터 확인해 보세요.` : "오늘 받은 질문과 답을 기능 정의서에 한 줄씩 옮겨 보세요." };
    r.can_finish = true;
    return r;
  }

  if (c.meetingRole === "feedback") {
    r.can_finish = true;
    return r;
  }

  // review·ask: 질문 하나
  if (c.meetingRole === "ask" && !r.acknowledgement) r.acknowledgement = `${DEPT_INFO[c.dept].team}이에요. 저는 ${{ designer: "화면 쪽", marketer: "고객에게 알릴 쪽", planner: "정의서와 안내 쪽", dev_lead: "구현 쪽" }[c.dept]}이 궁금해서요.`;
  if (c.meetingRole === "review" && !r.acknowledgement) r.acknowledgement = "좋아요, 들은 것부터 정리해 볼게요.";
  makeQuestion(c, r, lastUser);
  return r;
}
