/**
 * 프롬프트 평가(docs/ai-colleague/AI동료_프롬프트.md 11장)를 실제 Solar로 한꺼번에 돌린다.
 * 사용자 답은 부록 A 가상 사용자 프롬프트로 만든다(답변 방식은 부록 A 가중치대로 무작위).
 * 프롬프트·검사 규칙을 바꾼 뒤 이것으로 다시 확인한다. 비용이 들어 평소 시험에서는 돌지 않는다.
 *
 *   EVAL_COLLEAGUE=1 UPSTAGE_API_KEY=… npx vitest run src/lib/colleague/v2/colleague-v2-eval.test.ts
 *
 * 결과는 docs/ai-colleague/평가결과.md에 쓴다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type ColleagueDept, emptyColleagueRecent, type ShareTurn } from "@/lib/office/models";
import type { Office } from "@/lib/office/office";
import { makeOffice } from "@/lib/office/test-helpers";
import { SolarClient, solarConfigFromEnv } from "@/lib/solar/client";
import { DEPT_INFO } from "./catalog";
import { advanceShare, speak } from "./engine";
import { historyOf } from "./prompt";
import { GLOSSARY, PROMPT_BLOCKS } from "./prompt-data.generated";

const root = join(__dirname, "../../../..");
const doc = readFileSync(join(root, "docs/ai-colleague/AI동료_프롬프트.md"), "utf8");
/** 부록 A 가상 사용자 프롬프트(코드 블록 원문). */
const USER_PROMPT = doc.slice(doc.indexOf("## 부록 A")).match(/```text\n([\s\S]*?)\n```/)![1];

/** 부록 A 시나리오 5개. 사실은 팀이 정한 시연용 사실(이 밖의 것은 가상 사용자가 지어내지 않는다). */
const SCENARIOS: { name: string; task: string; facts: string; submission?: string }[] = [
  {
    name: "날씨 조회 화면",
    task: "날씨 조회 화면",
    facts: "- React로 도시 이름 입력칸과 검색 버튼을 만들었다\n- 검색을 누르면 fetch로 날씨 API를 부르고 기온·날씨를 카드로 보여 준다\n- 서울·부산으로만 직접 확인했다\n- 실패했을 때 안내 문구는 아직 없다\n- 불러오는 중 표시는 없다",
    submission: "const res = await fetch(`/weather?city=${city}`); setWeather(await res.json());",
  },
  {
    name: "회원가입 폼",
    task: "회원가입 폼",
    facts: "- 이메일·비밀번호·비밀번호 확인 칸이 있는 폼을 만들었다\n- 이메일 형식이 틀리면 칸 테두리가 빨갛게 된다\n- 비밀번호가 8자 미만이면 제출 버튼이 비활성화된다\n- 제출하면 콘솔에 값을 찍을 뿐 서버로 보내지는 않는다\n- 화면낭독기로는 확인하지 않았다",
  },
  {
    name: "할 일 목록 앱",
    task: "할 일 목록",
    facts: "- 할 일을 적고 추가를 누르면 목록 아래에 붙는다\n- 각 항목에 삭제 버튼이 있다\n- localStorage에 저장해 새로고침해도 남는다\n- 할 일이 하나도 없을 때 화면은 그냥 비어 있다\n- 같은 할 일을 두 번 넣는 것은 막지 않았다",
  },
  {
    name: "상품 검색 필터",
    task: "상품 검색 필터",
    facts: "- 가격대·카테고리 필터를 고르면 상품 목록이 걸러진다\n- 필터는 화면에서만 걸러지고 서버에는 요청하지 않는다\n- 결과가 0개면 '결과 없음'만 보인다\n- 모바일 화면에서는 필터가 화면 밖으로 밀린다는 걸 알았지만 못 고쳤다",
  },
  {
    name: "useEffect 학습",
    task: "useEffect 공부",
    facts: "- 오늘은 만든 결과 없이 useEffect 문서를 읽고 예제를 따라 쳐 봤다\n- 의존성 배열을 비우면 처음 한 번만 실행된다는 걸 알았다\n- 정리(clean-up) 함수가 언제 실행되는지는 아직 헷갈린다",
  },
];

const STYLES: [string, number][] = [
  ["구체적으로 답함", 3],
  ["짧고 서툴게 답함", 2],
  ["질문 핵심을 비껴감", 1],
  ["잘 모르겠다고 함", 1],
  ["확인 안 한 것을 된다고 함", 1],
  ["용어만 말하고 과정은 못 풂", 2],
];
function pickStyle(): string {
  const total = STYLES.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [name, w] of STYLES) if ((r -= w) < 0) return name;
  return STYLES[0][0];
}

/** [금지 질문] 블록의 따옴표 속 예시 문장. */
const BANNED = [...PROMPT_BLOCKS.BANNED.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((q) => q.length >= 6 && !q.includes("도시를"));
const FAKE_CASE = /실제\s*(기획자|디자이너|마케터|개발자|팀장)[가-힣]*\s*(가|이)?\s*(했던|하는)\s*질문|현업에서\s*실제로/;

async function virtualUser(client: SolarClient, s: (typeof SCENARIOS)[number], situation: string, office: Office, stage: "review" | "meeting", first: boolean) {
  const style = pickStyle();
  const transcript = historyOf(office.day.share.turns, stage, office.day.share.meeting?.host ?? null)
    .map((h) => `${h.speaker}: ${h.text}`)
    .join("\n");
  const prompt = USER_PROMPT.replace("{situation}", situation).replace("{facts}", s.facts).replace("{style}", style).replace("{transcript}", transcript || "(아직 없음)");
  const content = await client.completeJSON({
    system: "가상 사용자 역할. 지시대로 말 한 덩어리만 만든다. 출력은 {\"say\": \"말\"} JSON 하나.",
    messages: [{ role: "user", content: `${prompt}\n\n${first ? "(첫 설명일 때 규칙을 따른다)" : "(답변일 때 규칙을 따른다)"}` }],
    temperature: 0.8,
    maxTokens: 300,
  });
  const said = (JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, "")) as { say?: string }).say?.trim();
  return { said: said || "잘 모르겠어요.", style };
}

interface Row {
  scenario: string;
  turns: number;
  firstPass: number;
  fixedAfterTwo: number;
  seconds: number[];
  issues: string[];
}

const live = solarConfigFromEnv();
const enabled = !!live.apiKey && process.env.EVAL_COLLEAGUE === "1";

describe.skipIf(!enabled)("프롬프트 평가(11장, 실제 Solar)", { timeout: 1_800_000 }, () => {
  it("시나리오 5개 × 팀장 보고 → 회의 한 바퀴 + T1·T2", async () => {
    const client = new SolarClient(live);
    const rows: Row[] = [];
    const transcripts: string[] = [];

    for (const s of SCENARIOS) {
      const office = makeOffice();
      office.checkIn();
      office.confirmTasks({ goal: s.task, tasks: [{ title: s.task, completionCriteria: "시연 가능", shareForm: "3줄 설명", level: 1 }] });
      if (s.submission) office.submitWork(office.day.tasks[0].id, "code", s.submission);
      office.startSharing();
      const row: Row = { scenario: s.name, turns: 0, firstPass: 0, fixedAfterTwo: 0, seconds: [], issues: [] };
      let first = true;
      for (let i = 0; i < 12 && office.day.share.stage !== "closed"; i++) {
        if (office.day.share.stage === "confirm") {
          office.enterMeeting();
          first = true;
          continue;
        }
        const stage = office.day.share.stage === "review" ? "review" : "meeting";
        const last = office.day.share.turns.filter((t) => t.role === "colleague").at(-1);
        const situation =
          stage === "review"
            ? "부서 회의에 들어가기 전에 직속 상사인 개발팀장에게 오늘 한 일을 먼저 보고하는 중이다."
            : `디자인·마케팅·기획팀이 참석한 개발 공유 회의에서 오늘 한 일을 설명하는 중이다. 지금 질문한 사람: ${last?.dept ? DEPT_INFO[last.dept].name : "없음"}`;
        const { said, style } = await virtualUser(client, s, situation, office, stage, first);
        first = false;
        const { lowered } = office.recordUserTurn(said);
        const t0 = Date.now();
        const r = await advanceShare(office, client, { lowered });
        row.seconds.push((Date.now() - t0) / 1000);
        for (const c of r.checks) {
          row.turns++;
          if (c.rejected.length === 0) row.firstPass++;
          if (c.rejectedTwice) row.fixedAfterTwo++;
          for (const why of c.rejected) row.issues.push(`${c.dept}:${c.meetingRole} ${why}`);
        }
        const userSaid = office.day.share.turns.filter((x) => x.role === "user").map((x) => x.text ?? "").join(" ");
        for (const t of r.turns) check(t, row, userSaid);
        transcripts.push(`- (${style}) 나: ${said}`, ...r.turns.map((t) => `  - ${DEPT_INFO[t.dept!].name}[${t.meetingRole}]: ${[t.reply!.acknowledgement, t.reply!.question].filter(Boolean).join(" ")}`));
      }
      if (office.day.share.stage !== "closed") row.issues.push(`회의가 끝나지 않음(stage=${office.day.share.stage})`);
      if (!office.day.share.minutes) row.issues.push("회의록 없음");
      rows.push(row);
      transcripts.push("");
    }

    // T1: 같은 설명을 같은 부서(팀장)에 새 세션 5번 → 첫 질문 렌즈×형식 조합이 4번 이상 달라야 한다.
    // 같은 사용자의 새 세션이므로 최근 사용 기록(13.4, colleagueRecent)을 이어 받는다.
    const combos: string[] = [];
    let recent = emptyColleagueRecent();
    for (let i = 0; i < 5; i++) {
      const office = makeOffice();
      office.colleagueRecent = recent;
      office.checkIn();
      office.confirmTasks({ tasks: [{ title: "날씨 조회 화면", completionCriteria: "시연", shareForm: "", level: 1 }] });
      office.startSharing();
      office.recordUserTurn("도시를 입력하면 날씨를 보여주는 화면을 만들었어요. 검색을 누르면 API를 불러서 카드로 보여줘요.");
      const r = await speak(office, client, { dept: "dev_lead", persona: office.day.share.review!.personaId, meetingRole: "review", curveball: false });
      office.recordColleagueTurn("dev_lead", "review", r.reply, r.source);
      recent = office.colleagueRecent;
      combos.push(`${r.reply.lens_id}×${r.reply.question_type}`);
    }
    const t1 = new Set(combos).size;

    // T2: 같은 설명을 디자이너·마케터·기획자에게 → 질문 관점(렌즈 머리글자)이 부서 직무와 맞고 서로 달라야 한다.
    const t2: string[] = [];
    const t2Lens: string[] = [];
    const t2Q: string[] = [];
    for (const dept of ["designer", "marketer", "planner"] as ColleagueDept[]) {
      const office = makeOffice();
      office.checkIn();
      office.confirmTasks({ tasks: [{ title: "할 일 목록", completionCriteria: "시연", shareForm: "", level: 1 }] });
      office.startSharing();
      office.enterMeeting();
      office.recordUserTurn("할 일 목록 앱을 만들었어요. 추가를 누르면 목록에 붙고 새로고침해도 남아요.");
      const p = office.day.share.meeting!.participants.find((x) => x.dept === dept)!;
      const r = await speak(office, client, { dept, persona: p.personaId, meetingRole: "ask", curveball: false });
      t2.push(`${DEPT_INFO[dept].team}: ${r.reply.lens_id} · ${r.reply.question}`);
      t2Lens.push(r.reply.lens_id);
      t2Q.push(r.reply.question);
    }
    // 렌즈 머리글자: 디자이너 D, 마케터 K, 기획자 P(문서 6장).
    const t2ok = t2Lens.every((l, i) => l.startsWith(["D", "K", "P"][i])) && new Set(t2Q).size === 3;

    const total = rows.reduce((a, r) => ({ turns: a.turns + r.turns, first: a.first + r.firstPass, two: a.two + r.fixedAfterTwo }), { turns: 0, first: 0, two: 0 });
    const secs = rows.flatMap((r) => r.seconds).sort((a, b) => a - b);
    const issues = rows.flatMap((r) => r.issues);
    const count = (re: RegExp) => issues.filter((x) => re.test(x)).length;
    const report = [
      `# AI 동료 프롬프트 평가 결과`,
      "",
      `- 실행: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · 모델 ${live.model} · 가상 사용자: 부록 A 프롬프트`,
      `- 시나리오 ${rows.length}개, 동료 발언 ${total.turns}개`,
      `- 13.3 검사 첫 응답 통과 ${total.first}/${total.turns} (${Math.round((total.first / Math.max(1, total.turns)) * 100)}%) · 재요청 뒤에도 걸려 고쳐서 쓴 발언 ${total.two}개`,
      `- 사용자 한 마디당 응답 시간: 중앙 ${secs[Math.floor(secs.length / 2)]?.toFixed(1)}초 · 최대 ${secs.at(-1)?.toFixed(1)}초`,
      "",
      "## 11장 평가 사례",
      "",
      "| 번호 | 기준 | 결과 |",
      "|---|---|---|",
      `| T1 | 같은 설명·같은 부서 5회, 첫 질문 렌즈×형식 4번 이상 다름 | ${t1}가지 (${combos.join(", ")}) ${t1 >= 4 ? "통과" : "미달"} |`,
      `| T2 | 디자이너·마케터·기획자 관점이 직무와 맞고 서로 다름 | ${t2ok ? "통과" : "확인 필요"} |`,
      `| T8 | 사례 0건에서 interview_case 근거·'실제 ○○가 했던 질문' 0회 | 위반 ${count(/interview_case|실제 사례/)}회 |`,
      `| T27 | 다른 부서 용어 사용 0회 | 위반 ${count(/다른 부서 용어/)}회 |`,
      `| 질문 하나 | 최종 질문에 물음표 2개 이상 0회 | 위반 ${count(/최종 질문 물음표/)}회 |`,
      `| 금지 질문 | [금지 질문] 예시 문장 그대로 0회 | 위반 ${count(/금지 질문/)}회 |`,
      "",
      "### T2 질문",
      ...t2.map((x) => `- ${x}`),
      "",
      "## 시나리오별",
      "",
      "| 시나리오 | 동료 발언 | 첫 응답 통과 | 고쳐서 씀 |",
      "|---|---|---|---|",
      ...rows.map((r) => `| ${r.scenario} | ${r.turns} | ${r.firstPass} | ${r.fixedAfterTwo} |`),
      "",
      "## 반려 사유(재요청 전)·문제",
      "",
      ...Object.entries(issues.reduce<Record<string, number>>((m, x) => ((m[x.replace(/^\S+ /, "").replace(/ [A-Z]\d+.*$/, "").replace(/'[^']*'/g, "'…'")] = (m[x.replace(/^\S+ /, "").replace(/ [A-Z]\d+.*$/, "").replace(/'[^']*'/g, "'…'")] ?? 0) + 1), m), {}))
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `- ${k}: ${v}회`),
      "",
      "## 대화 기록",
      "",
      ...transcripts,
    ].join("\n");
    writeFileSync(join(root, "docs/ai-colleague/평가결과.md"), report);
    console.log(report.split("## 대화 기록")[0]);
    expect(rows.length).toBe(5);
  });
});

/** 최종으로 쓴 발언 하나를 11장 기준으로 본다. */
function check(t: ShareTurn, row: Row, userSaid: string) {
  const r = t.reply!;
  const text = [r.acknowledgement, r.question, r.feedback?.strength, r.feedback?.perspective, r.feedback?.try_next].filter(Boolean).join(" ");
  if (r.basis.type === "interview_case") row.issues.push(`${t.dept}:${t.meetingRole} interview_case 근거`);
  if (FAKE_CASE.test(text)) row.issues.push(`${t.dept}:${t.meetingRole} 실제 사례처럼 말함`);
  if ((r.question.match(/[?？]/g) ?? []).length >= 2) row.issues.push(`${t.dept}:${t.meetingRole} 최종 질문 물음표 2개`);
  for (const b of BANNED) if (r.question.replace(/\s/g, "").includes(b.replace(/\s/g, ""))) row.issues.push(`${t.dept}:${t.meetingRole} 금지 질문 '${b}'`);
  for (const g of GLOSSARY) {
    if (g.dept === t.dept) continue;
    const head = g.term.split(/\s*\/\s*|\(/)[0].trim();
    // 사용자가 먼저 쓴 말을 받아 말한 것은 세지 않는다.
    if (head.length >= 3 && text.includes(head) && !userSaid.includes(head) && !GLOSSARY.some((x) => x.dept === t.dept && x.term.includes(head))) {
      row.issues.push(`${t.dept}:${t.meetingRole} 다른 부서 용어 '${head}'`);
    }
  }
}
