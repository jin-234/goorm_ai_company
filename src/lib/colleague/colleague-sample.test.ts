/**
 * 예시 응답(AI 연결 전). Solar 키가 없거나 OFFICE_AI_MODE=sample이면 AI 팀장·기획자·마감 요약이 예시 응답으로 이어진다.
 * 사용자 결정(2026-11-21): AI 연결은 맨 마지막에 한다. 화면은 source "sample"에 '예시 응답(AI 연결 전)' 꼬리표를 붙인다.
 */
import { describe, expect, it } from "vitest";
import { makeOffice } from "@/lib/office/test-helpers";
import { SolarClient } from "@/lib/solar/client";
import { aiModeOf, isRepeatQuestion, plannerReply, proposeScope, reviewDraft, sampleProposal } from "./colleague";
import { ROLES, SKIP_MESSAGE } from "./prompts";

const noKey = new SolarClient({ apiKey: null, baseURL: "https://example.invalid", model: "m", timeout: 5 });
const withKey = new SolarClient({ apiKey: "k", baseURL: "https://example.invalid", model: "m", timeout: 5 });

function sharing(submit?: { kind: "text" | "link" | "code"; content: string }) {
  const office = makeOffice();
  office.checkIn();
  office.confirmTasks({ tasks: [{ title: "날씨 조회 화면", completionCriteria: "도시 입력 시 날씨 표시", shareForm: "캡처" }] });
  if (submit) office.submitWork(office.day.tasks[0].id, submit.kind, submit.content);
  office.startSharing();
  return office;
}

/** 공유 경로(/api/office/share)와 같은 순서: 사용자 턴 기록 → 응답 → 기획자 턴 기록. */
async function say(office: ReturnType<typeof sharing>, text: string) {
  office.recordShareTurn({ role: "user", text });
  const out = await plannerReply(noKey, office);
  office.recordShareTurn({ role: "planner", reply: out.value, source: out.source });
  return out;
}

describe("언제 예시 응답을 쓰나", () => {
  it("키가 없거나 OFFICE_AI_MODE=sample이면 sample, 키가 있으면 solar", () => {
    expect(aiModeOf(noKey, {})).toBe("sample");
    expect(aiModeOf(withKey, { OFFICE_AI_MODE: "sample" })).toBe("sample");
    expect(aiModeOf(withKey, {})).toBe("solar");
  });
});

describe("예시 팀장", () => {
  it("문장 세 개 목표는 과제 세 개로, 완료 기준·공유 형태·확인 질문 하나를 채운다", async () => {
    const out = await proposeScope(noKey, {
      goal: "fetch로 API 요청을 공부한다. 도시별 날씨 조회 화면을 만든다. 에러 안내 문구를 추가한다.",
      targetRole: "프런트엔드",
      availableMinutes: 240,
      carried: [],
    });
    expect(out.source).toBe("sample");
    expect(out.solarError).toBeNull();
    expect(out.value.tasks).toHaveLength(3);
    expect(out.value.tasks.every((t) => t.title && t.completionCriteria && t.shareForm)).toBe(true);
    expect(out.value.tasks[0].completionCriteria).toContain("3줄 정리");
    expect(out.value.tasks[1].completionCriteria).toContain("동작을 확인");
    expect(out.value.question.match(/\?/g)).toHaveLength(1);
  });

  it("쉼표·'하고'로 이어 쓴 목표도 나누고, 세 개를 넘지 않는다", () => {
    expect(sampleProposal("React 상태 관리 공부하고 할 일 목록 만들기").tasks.map((t) => t.title)).toEqual(["React 상태 관리 공부", "할 일 목록 만들기"]);
    expect(sampleProposal("a1, b2, c3, d4, e5").tasks).toHaveLength(3);
  });
});

describe("예시 회의실 동료", () => {
  it("받은 말을 짚고, 파트를 맡은 부서가 질문을 두 개까지 한 뒤 마무리한다", async () => {
    // 화면 과제 하나 → 디자인팀이 듣는 파트 하나.
    const office = sharing({ kind: "code", content: "fetch(url).then(r => r.json())" });
    const a = await say(office, "도시를 입력하면 날씨를 보여주는 화면을 만들었습니다.");
    expect(a.source).toBe("sample");
    expect(office.day.share.turns.at(-1)?.speaker).toBe("designer");
    expect(a.value.acknowledgement).toContain("도시를 입력하면");
    expect(a.value.question).toBe(ROLES.designer.manualQuestions[0]);
    expect(a.value.question_reason).toBe(ROLES.designer.need);
    expect(a.value.can_finish).toBe(false);

    const b = await say(office, "검색 → 결과 화면 순서입니다.");
    expect(office.day.share.turns.at(-1)?.speaker).toBe("designer");
    expect(b.value.question).toBe(ROLES.designer.manualQuestions[1]);
    expect(isRepeatQuestion(b.value.question, [a.value.question])).toBe(false);

    const c = await say(office, "실패 안내는 아직 없습니다.");
    expect(office.day.share.turns.at(-1)?.speaker).toBe("designer");
    expect(c.value.question).toBe("");
    expect(c.value.can_finish).toBe(true);
    expect(c.value.acknowledgement).toContain(ROLES.designer.wrapUp);
    expect(c.value.acknowledgement).toContain("오늘 발표는 여기까지");
    expect(office.day.share).toMatchObject({ questionCount: 2, state: "ready_to_summarize" });
    expect(c.value.known_facts).toHaveLength(3);
    expect(c.value.evidence_refs).toEqual(["턴 1", "턴 3", "턴 5"]);
  });

  it("한 파트를 마무리하면 다음 파트를 맡은 부서에 넘기고, 그 부서는 자기 질문부터 한다", async () => {
    const office = makeOffice();
    office.checkIn();
    office.confirmTasks({
      tasks: [
        { title: "날씨 조회 화면", completionCriteria: "도시 입력 시 날씨 표시", shareForm: "캡처" },
        { title: "Vercel 배포", completionCriteria: "배포 주소에서 열린다", shareForm: "주소" },
      ],
    });
    office.startSharing();
    await say(office, "날씨 화면을 만들었습니다.");
    await say(office, "검색 → 결과 순서입니다.");
    const wrap = await say(office, "불러오는 중에는 회색 상자가 보입니다.");
    expect(wrap.value.question).toBe("");
    expect(wrap.value.acknowledgement).toContain("다음 파트는 운영팀에서 이어서 들을게요");
    expect(office.day.share.state).toBe("clarifying");

    const ops = await say(office, "Vercel에 배포했습니다.");
    expect(office.day.share.turns.at(-1)?.speaker).toBe("operations");
    expect(ops.value.question).toBe(ROLES.operations.manualQuestions[0]);
    // 앞 파트의 말은 이 부서의 정리에 섞지 않는다.
    expect(ops.value.known_facts).toEqual(["Vercel에 배포했습니다."]);
    expect(office.day.share.knownFacts).toContain("날씨 화면을 만들었습니다.");
  });

  it("건너뛴 질문은 남은 질문으로 두고 다음 질문으로 넘어간다", async () => {
    const office = sharing();
    const a = await say(office, "fetch와 Promise를 공부했습니다.");
    expect(a.value.question_reason).toContain("가상으로 적용");
    const b = await say(office, SKIP_MESSAGE);
    expect(b.value.acknowledgement).toContain("남은 질문");
    expect(b.value.open_questions).toContain(a.value.question);
    expect(b.value.question).not.toBe(a.value.question);
  });
});

describe("예시 마감 요약", () => {
  it("들은 말과 읽은 자료만 옮기고, 판정·검증 표현 없이 다음 행동 하나를 낸다", async () => {
    const office = sharing({ kind: "link", content: "https://github.com/me/weather" });
    await say(office, "도시를 입력하면 날씨를 보여주는 화면을 만들었습니다.");
    await say(office, "이 질문은 건너뛸게요.");
    office.endSharing("done");
    const out = await reviewDraft(noKey, office);
    expect(out.source).toBe("sample");
    expect(out.value.reported_work).toContain("도시를 입력하면");
    expect(out.value.artifact_observations).toBe("읽은 자료 없음(설명 기준).");
    expect(out.value.next_action).toMatch(/^".+"에 대한 답을 정리해 둔다$/);
    expect(out.value.job_connection).toContain("프런트엔드");
    expect(JSON.stringify(out.value)).not.toMatch(/검증\s*완료|합격|점수|등급/);

    office.saveReviewDraft(out.value, out.source);
    expect(office.day.review).toMatchObject({ draftSource: "sample", editedByUser: false });
    expect(office.day.review.aiDraft).not.toBeNull();
  });
});
