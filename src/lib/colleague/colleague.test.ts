import { describe, expect, it } from "vitest";
import type { PlannerReply, ShareTurn, Submission } from "@/lib/office/models";
import { SolarClient } from "@/lib/solar/client";
import {
  firstQuestion, guardPlannerReply, guardReview, manualPlannerReply, MANUAL_QUESTIONS, materialsOf, plannerReply, proposeScope,
} from "./colleague";
import { SKIP_MESSAGE } from "./prompts";

const reply = (over: Partial<PlannerReply> = {}): PlannerReply => ({
  acknowledgement: "설명 고맙습니다.",
  question: "이 화면으로 사용자는 무엇을 할 수 있나요?",
  question_reason: "안내 첫 문장에 필요합니다.",
  question_basis: "role_need",
  basis_ref: "",
  known_facts: ["도시를 입력하면 날씨가 나온다"],
  open_questions: [],
  evidence_refs: ["턴 1"],
  can_finish: false,
  ...over,
});
const userTurn = (text: string): ShareTurn => ({ id: crypto.randomUUID(), role: "user", at: 0, text });
const plannerTurn = (question: string): ShareTurn => ({ id: crypto.randomUUID(), role: "planner", at: 0, reply: reply({ question }), source: "solar" });
const sub = (id: string, kind: "text" | "link", readScope: "read" | "notRead"): Submission => ({ id, taskId: "t", kind, content: "내용", at: 0, readScope });

describe("기획자 응답 안전장치", () => {
  it("여러 질문을 몰아넣으면 첫 질문만 남긴다", () => {
    expect(firstQuestion("누가 쓰나요? 그리고 언제 쓰나요?")).toBe("누가 쓰나요?");
  });

  it("이미 한 질문을 다시 하면 질문을 지우고 마무리한다", () => {
    const turns = [userTurn("날씨 화면을 만들었습니다."), plannerTurn("이 화면으로 사용자는 무엇을 할 수 있나요?"), userTurn("도시별 날씨를 봅니다.")];
    const out = guardPlannerReply(reply(), { turns, questionCount: 1, maxQuestions: 3, submissions: [] });
    expect(out.question).toBe("");
    expect(out.can_finish).toBe(true);
  });

  it("상한에 닿으면 더 묻지 않는다", () => {
    const out = guardPlannerReply(reply({ question: "실패하면 어떻게 되나요?" }), { turns: [userTurn("a")], questionCount: 3, maxQuestions: 3, submissions: [] });
    expect(out.question).toBe("");
    expect(out.can_finish).toBe(true);
  });

  it("건너뛴 질문은 남은 질문에 둔다", () => {
    const turns = [userTurn("a"), plannerTurn("아직 안 되는 범위는 무엇인가요?"), userTurn(SKIP_MESSAGE)];
    const out = guardPlannerReply(reply({ question: "주의점이 있나요?" }), { turns, questionCount: 1, maxQuestions: 3, submissions: [] });
    expect(out.open_questions).toContain("아직 안 되는 범위는 무엇인가요?");
  });

  it("근거는 실제 대화 턴과 읽은 제출물만", () => {
    const out = guardPlannerReply(reply({ evidence_refs: ["턴 1", "턴 9", "제출물 s1", "제출물 s2"] }), {
      turns: [userTurn("a")], questionCount: 0, maxQuestions: 3, submissions: [sub("s1", "text", "read"), sub("s2", "link", "notRead")],
    });
    expect(out.evidence_refs).toEqual(["턴 1", "제출물 s1"]);
  });
});

describe("마감 요약 안전장치", () => {
  it("읽은 자료가 없으면 설명 기준으로 표시하고, 검증 완료라고 쓰지 않는다", () => {
    const out = guardReview({
      reported_work: "날씨 화면을 만들고 정상 동작 검증 완료", explained_learning: "", artifact_observations: "코드가 잘 짜였다",
      shared_scope_and_limits: "", open_questions: [], job_connection: "", next_action: "", evidence_refs: ["제출물 x"],
    }, { turns: [], submissions: [sub("x", "link", "notRead")] });
    expect(out.artifact_observations).toBe("읽은 자료 없음(설명 기준).");
    expect(out.reported_work).not.toMatch(/검증/);
    expect(out.evidence_refs).toEqual([]);
  });

  it("링크는 읽은 자료로 보내지 않는다", () => {
    const m = materialsOf([sub("a", "text", "read"), sub("b", "link", "notRead")]);
    expect(m.shared_materials.map((s) => s.id)).toEqual(["제출물 a"]);
    expect(m.links_not_read.map((s) => s.id)).toEqual(["제출물 b"]);
  });
});

describe("Solar 호출 실패(키는 있음)", () => {
  const down = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
  const failing = new SolarClient({ apiKey: "k", baseURL: "https://example.invalid", model: "m", timeout: 5 }, down);

  it("팀장 제안은 서버 안 규칙 초안(manual)으로, 무엇이 실패했는지 알린다", async () => {
    const out = await proposeScope(failing, { goal: "날씨 API 배우고 조회 화면 만들기", targetRole: "프런트엔드", availableMinutes: 240, carried: [] });
    expect(out.source).toBe("manual");
    expect(out.value.tasks.length).toBeGreaterThan(0);
    expect(out.solarError).not.toBeNull();
  });

  it("수동 양식은 정해진 질문을 차례로, 상한에서 끝낸다", () => {
    expect(manualPlannerReply({ questionCount: 0, maxQuestions: 3, openQuestions: [], knownFacts: [] }).question).toBe(MANUAL_QUESTIONS[0]);
    const last = manualPlannerReply({ questionCount: 3, maxQuestions: 3, openQuestions: [], knownFacts: [] });
    expect(last.question).toBe("");
    expect(last.can_finish).toBe(true);
    expect(last.acknowledgement).toBe("");
  });

  it("Solar가 이상한 답을 주면 수동 양식으로 돌아간다", async () => {
    const fake = (async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "이건 JSON 아님" } }] }), { status: 200 })) as typeof fetch;
    const client = new SolarClient({ apiKey: "k", baseURL: "https://example.invalid", model: "m", timeout: 5 }, fake);
    const office = {
      profile: { targetRole: "프런트엔드", experience: "" },
      day: { goal: "g", tasks: [], submissions: [], share: { turns: [userTurn("만들었습니다")], questionCount: 0, maxQuestions: 3, knownFacts: [], openQuestions: [] } },
    } as unknown as Parameters<typeof plannerReply>[1];
    const out = await plannerReply(client, office);
    expect(out.source).toBe("manual");
    expect(out.solarError?.kind).toBe("malformed");
    expect(out.value.question).toBe(MANUAL_QUESTIONS[0]);
  });
});
