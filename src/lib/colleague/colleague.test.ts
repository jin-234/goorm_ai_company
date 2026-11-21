/** 공용 안전장치·아침 팀장 제안·마감 요약 시험. 회의실 발표 시험은 v2/*.test.ts. */
import { describe, expect, it } from "vitest";
import type { Review, Submission } from "@/lib/office/models";
import { makeOffice } from "@/lib/office/test-helpers";
import { SolarClient } from "@/lib/solar/client";
import { activityTypeOf, aiModeOf, firstQuestion, guardReview, isRepeatQuestion, materialsOf, proposeScope, reviewDraft, sampleProposal, stripJudgement } from "./colleague";

const sub = (id: string, kind: "text" | "link" | "code", readScope: "read" | "notRead"): Submission => ({ id, taskId: "t", kind, content: "내용", at: 0, readScope });
const noKey = new SolarClient({ apiKey: null, baseURL: "https://example.invalid", model: "m", timeout: 5 });
const down = (async () => new Response("bad gateway", { status: 502 })) as typeof fetch;
const failing = new SolarClient({ apiKey: "k", baseURL: "https://example.invalid", model: "m", timeout: 5 }, down);

describe("공용 안전장치", () => {
  it("여러 질문을 몰아넣으면 첫 질문만, 말만 바꾼 같은 질문은 반복으로 본다", () => {
    expect(firstQuestion("누가 쓰나요? 그리고 언제 쓰나요?")).toBe("누가 쓰나요?");
    expect(isRepeatQuestion("이 화면으로 사용자가 무엇을 할 수 있나요?", ["이 화면으로 사용자는 무엇을 할 수 있나요?"])).toBe(true);
    expect(isRepeatQuestion("도시 이름을 잘못 쓰면 어떻게 되나요?", ["이 화면으로 사용자는 무엇을 할 수 있나요?"])).toBe(false);
  });

  it("판정 문장은 빼고, 사용자의 '테스트 통과' 설명은 남긴다", () => {
    expect(stripJudgement("화면을 만들었습니다. 성실도가 높습니다.")).toBe("화면을 만들었습니다.");
    expect(stripJudgement("사용자는 테스트가 통과했다고 설명했습니다.")).toBe("사용자는 테스트가 통과했다고 설명했습니다.");
  });

  it("링크는 읽은 자료로 보내지 않고, 글만 냈으면 explain·아무것도 없으면 learning_only", () => {
    const m = materialsOf([sub("a", "text", "read"), sub("b", "link", "notRead")]);
    expect(m.shared_materials.map((s) => s.id)).toEqual(["제출물 a"]);
    expect(m.links_not_read.map((s) => s.id)).toEqual(["제출물 b"]);
    expect(activityTypeOf([])).toBe("learning_only");
    expect(activityTypeOf([sub("a", "text", "read")])).toBe("explain");
    expect(activityTypeOf([sub("a", "code", "read")])).toBe("build");
  });

  it("마감 요약은 읽은 자료가 없으면 설명 기준, 검증·판정 표현을 뺀다", () => {
    const raw: Review = {
      reported_work: "날씨 화면을 만들고 정상 동작 검증 완료", explained_learning: "", artifact_observations: "코드가 잘 짜였다",
      shared_scope_and_limits: "", open_questions: [], job_connection: "역량 수준은 상위 10%입니다.", next_action: "", evidence_refs: ["제출물 x"],
    };
    const out = guardReview(raw, { turns: [], submissions: [sub("x", "link", "notRead")] });
    expect(out.artifact_observations).toBe("읽은 자료 없음(설명 기준).");
    expect(out.reported_work).not.toMatch(/검증/);
    expect(out.job_connection).toBe("");
    expect(out.evidence_refs).toEqual([]);
  });
});

describe("AI 모드와 아침 팀장 제안", () => {
  it("키가 없거나 OFFICE_AI_MODE=sample이면 예시 응답", () => {
    expect(aiModeOf(noKey, {})).toBe("sample");
    expect(aiModeOf(failing, { OFFICE_AI_MODE: "sample" })).toBe("sample");
    expect(aiModeOf(failing, {})).toBe("solar");
  });

  it("예시 팀장은 목표 문장을 1~3개 과제로 나누고, 호출이 실패하면 서버 안 규칙 초안(manual)", async () => {
    expect(sampleProposal("React 상태 관리 공부하고 할 일 목록 만들기").tasks.map((t) => t.title)).toEqual(["React 상태 관리 공부", "할 일 목록 만들기"]);
    const out = await proposeScope(failing, { goal: "날씨 API 배우고 조회 화면 만들기", targetRole: "프런트엔드", availableMinutes: 240, carried: [] });
    expect(out.source).toBe("manual");
    expect(out.value.tasks.length).toBeGreaterThan(0);
  });

  it("마감 요약 예시는 회의실 발표에서 사용자가 한 말을 옮긴다", async () => {
    const office = makeOffice();
    office.checkIn();
    office.confirmTasks({ tasks: [{ title: "날씨 화면", completionCriteria: "도시 입력 시 날씨", shareForm: "" }] });
    office.startSharing("", () => 0);
    office.recordUserTurn("도시를 입력하면 날씨를 보여주는 화면을 만들었습니다.");
    office.endSharing("done");
    const out = await reviewDraft(noKey, office);
    expect(out.source).toBe("sample");
    expect(out.value.reported_work).toContain("도시를 입력하면");
  });
});
