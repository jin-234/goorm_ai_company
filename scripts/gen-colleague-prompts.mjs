// docs/ai-colleague/AI동료_프롬프트.md에서 AI 동료 프롬프트 원문과 데이터를 뽑아
// src/lib/colleague/v2/prompt-data.generated.ts로 쓴다. 문서를 고치면 `node scripts/gen-colleague-prompts.mjs`로 다시 만든다.
// 프롬프트 블록(<!-- prompt:ID --> 아래 코드 블록)은 한 글자도 바꾸지 않는다(문서 머리말 지침).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = readFileSync(join(root, "docs/ai-colleague/AI동료_프롬프트.md"), "utf8").replace(/\r\n/g, "\n");

// 1) 프롬프트 블록
const blocks = {};
const re = /<!-- prompt:([A-Za-z0-9_]+) -->\n```text\n([\s\S]*?)\n```/g;
for (const m of doc.matchAll(re)) {
  if (blocks[m[1]]) throw new Error(`블록이 두 번 나옵니다: ${m[1]}`);
  blocks[m[1]] = m[2];
}

const rowsOf = (id) =>
  blocks[id]
    .split("\n")
    .filter((l) => /^[A-Z]{2}-[A-Z]{3}-\d{2} \| /.test(l))
    .map((l) => l.split(" | ").map((c) => c.trim()));

// 2) 질문 은행: ID | 신호 | 질문 관점 | 출처 | 근거 유형 | 잘 맞는 페르소나
const DEPTS = ["dev_lead", "designer", "marketer", "planner"];
const questionBank = DEPTS.flatMap((dept) =>
  rowsOf(`QBANK_${dept}`).map(([id, signal, angle, sourceId, basisType, personaFit]) => ({ id, dept, signal, angle, sourceId, basisType, personaFit })),
);

// 3) 용어집: ID | 용어 | 쉬운 뜻 | 질문 속 쓰임 예 | 출처
const glossary = DEPTS.flatMap((dept) =>
  rowsOf(`GLOSSARY_${dept}`).map(([id, term, plain, usage, sourceId]) => ({ id, dept, term, plain, usage, sourceId })),
);

// 4) 페르소나: [페르소나 카드: P_dev_A 품질 중심 리드] / 주력 렌즈: M1, M3
const personas = Object.keys(blocks)
  .filter((k) => k.startsWith("PERSONA_"))
  .map((k) => {
    const id = k.slice("PERSONA_".length);
    const label = blocks[k].match(/^\[페르소나 카드: \S+ (.+)\]/)[1].trim();
    const lenses = (blocks[k].match(/주력 렌즈: (.+)/)?.[1] ?? "").split(/,\s*/).filter(Boolean);
    const dept = { dev: "dev_lead", des: "designer", mkt: "marketer", pln: "planner" }[id.split("_")[1]];
    return { id, dept, label, lenses };
  });

// 5) 렌즈: 역할 지침의 "M1 완료의 정의: …", "D01 첫 화면: …"
const lenses = DEPTS.flatMap((dept) =>
  blocks[`ROLE_${dept}`]
    .split("\n")
    .map((l) => l.match(/^([A-Z]\d{1,2}) ([^:]+):/))
    .filter(Boolean)
    .map((m) => ({ id: m[1], dept, name: m[2].trim() })),
);

// 6) 자료 이름: "S01 GOV.UK 서비스팀 역할 안내" / "S07 Google 코드 리뷰 가이드: …"
const sources = {};
for (const l of blocks.SOURCES.split("\n")) {
  const m = l.match(/^(S\d{2}(?:~S\d{2})?) ([^:\n]+?)(?::|$)/);
  if (m) sources[m[1]] = m[2].trim();
}

// 7) 질문 형식·변화구 기법 ID
const questionTypes = [...blocks.QTYPES.matchAll(/^(Q\d{2}) /gm)].map((m) => m[1]);
const curveballs = [...blocks.CURVEBALL.matchAll(/^(C\d{2}) /gm)].map((m) => m[1]);

// 8) 부록 B 고정 문구
const fixed = {};
for (const l of doc.slice(doc.indexOf("## 부록 B")).split("\n")) {
  const m = l.match(/^\| (.+?) \| (.+) \|$/);
  if (m && m[1] !== "상황" && !m[1].startsWith("---")) fixed[m[1].trim()] = m[2].trim();
}

const out = `// 자동 생성 파일입니다. 직접 고치지 마세요.
// 원본: docs/ai-colleague/AI동료_프롬프트.md · 다시 만들기: node scripts/gen-colleague-prompts.mjs
/* eslint-disable */

/** 프롬프트 블록 원문(문서의 <!-- prompt:ID --> 아래 코드 블록 그대로). */
export const PROMPT_BLOCKS: Record<string, string> = ${JSON.stringify(blocks, null, 2)};

type Dept = "dev_lead" | "designer" | "marketer" | "planner";
export interface BankItem { id: string; dept: Dept; signal: string; angle: string; sourceId: string; basisType: "role_reasoning" | "guide_scenario" | "practitioner_source" | "interview_case" | "team_design"; personaFit: string }
export interface GlossaryItem { id: string; dept: Dept; term: string; plain: string; usage: string; sourceId: string }
export interface PersonaCard { id: string; dept: Dept; label: string; lenses: string[] }
export interface Lens { id: string; dept: Dept; name: string }

export const QUESTION_BANK: BankItem[] = ${JSON.stringify(questionBank, null, 2)};

export const GLOSSARY: GlossaryItem[] = ${JSON.stringify(glossary, null, 2)};

export const PERSONAS: PersonaCard[] = ${JSON.stringify(personas, null, 2)};

export const LENSES: Lens[] = ${JSON.stringify(lenses, null, 2)};

/** 자료 ID → 이름(14장 자료 목록이 비어 있어 [자료 요약] 블록에서 뽑음). */
export const SOURCE_NAMES: Record<string, string> = ${JSON.stringify(sources, null, 2)};

export const QUESTION_TYPES: string[] = ${JSON.stringify(questionTypes)};
export const CURVEBALLS: string[] = ${JSON.stringify(curveballs)};

/** 부록 B 고정 안내 문구. */
export const FIXED_TEXT: Record<string, string> = ${JSON.stringify(fixed, null, 2)};
`;
const target = join(root, "src/lib/colleague/v2/prompt-data.generated.ts");
writeFileSync(target, out);
console.log(
  `블록 ${Object.keys(blocks).length}개 · 질문 은행 ${questionBank.length} · 용어 ${glossary.length} · 페르소나 ${personas.length} · 렌즈 ${lenses.length} · 자료 ${Object.keys(sources).length} · 질문 형식 ${questionTypes.length} · 변화구 ${curveballs.length} · 고정 문구 ${Object.keys(fixed).length}`,
);
