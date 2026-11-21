/** 개정 기획서 6장 1단계 '실행과 기록' 통과 기준과 3.1 하루 흐름을 시험한다. */
import { describe, expect, test } from "vitest";
import { emptyReview, PART_MAX_QUESTIONS, type PlannerReply, type Review, sharePartsOf } from "./models";
import { Office } from "./office";
import { OfficeError } from "./rules";
import { makeOffice, monday, sampleTasks, workingOffice } from "./test-helpers";
import { at, hm, makeDay, sameDay } from "./time";

const review = (next = "실패 안내 상태 추가"): Review => ({ ...emptyReview(), reported_work: "날씨 화면을 만들었다", next_action: next });

const reply = (fields: Partial<PlannerReply> = {}): PlannerReply => ({
  acknowledgement: "설명 고맙습니다.",
  question: "아직 지원하지 않는 것은 무엇인가요?",
  question_reason: "사용자 안내에 한계를 적어야 해서요.",
  question_basis: "role_need",
  basis_ref: "",
  known_facts: ["도시를 입력하면 날씨가 보인다"],
  open_questions: ["실패 안내"],
  evidence_refs: [],
  can_finish: false,
  ...fields,
});

/** 수행 → 공유 → 마감 직전까지. */
function atReview(): Office {
  const office = workingOffice();
  office.startSharing();
  office.recordShareTurn({ role: "user", text: "도시를 입력하면 날씨를 보여주는 화면을 만들었습니다." });
  office.endSharing("done");
  return office;
}

describe("입사와 출근", () => {
  test("입사에 희망 직무·경험·활동 시작·마감 시각을 저장한다", () => {
    const office = makeOffice();
    expect(office.profile).toMatchObject({ name: "김서울", targetRole: "프런트엔드 개발", activityStart: 540, activityEnd: 1080 });
    expect(office.mails.map((m) => m.kind)).toEqual(["welcome", "notice"]);
    expect(office.mails[0].body).toContain("가상 역할");
  });

  test("마감 시각이 시작보다 이르면 입사할 수 없다", () => {
    const office = new Office(at(monday, 8 * 60));
    expect(() => office.completeOnboarding({ name: "a", activityStart: 600, activityEnd: 540 })).toThrow(OfficeError);
    expect(office.onboarded).toBe(false);
  });

  test("가볍게: 정해진 09시가 아니어도 지각 판정 없이 출근하고 시작 시각만 남긴다", () => {
    const office = makeOffice();
    office.advance(at(monday, 13 * 60 + 7));
    expect(office.checkIn()).toEqual({ checkInAt: office.now, method: null, late: false });
    expect(office.day.phase).toBe("morningPT");
    expect(office.day.events.map((e) => e.kind)).toEqual(["checkIn"]);
    expect(office.day.isLate).toBe(false);
    expect(office.mails.some((m) => m.kind === "attendance")).toBe(false);
  });

  test("가볍게: 시각이 흘러도 단계는 사용자 행동으로만 넘어가고, 마감 시각이 지나면 안내만 한다", () => {
    const office = workingOffice();
    office.advance(at(monday, 23 * 60));
    expect(office.day.phase).toBe("working");
    expect(office.pastActivityEnd).toBe(true);
  });
});

describe("아침보고 확정", () => {
  test("과제마다 완료 기준이 있어야 확정한다(공유 형태는 선택)", () => {
    const office = makeOffice();
    office.checkIn();
    expect(() => office.confirmTasks({ tasks: [] })).toThrow(expect.objectContaining({ code: "noTasks" }));
    expect(() => office.confirmTasks({ tasks: [{ title: "a", completionCriteria: " ", shareForm: "" }] })).toThrow(
      expect.objectContaining({ code: "taskIncomplete" }),
    );
    const tasks = office.confirmTasks({ goal: "목표", tasks: [{ title: "a", completionCriteria: "b", shareForm: "" }] });
    expect(tasks[0]).toMatchObject({ status: "confirmed", carriedFrom: null, carriedFromTaskId: null });
    expect(office.day.goal).toBe("목표");
    expect(office.day.phase).toBe("working");
  });

  test("출근 전에는 목표 저장과 확정을 할 수 없다", () => {
    const office = makeOffice();
    expect(() => office.saveGoal("x")).toThrow(OfficeError);
    expect(() => office.confirmTasks({ tasks: sampleTasks() })).toThrow(OfficeError);
  });
});

describe("수행과 제출", () => {
  test("제출과 완료는 다르다: 제출물을 올려도 상태는 진행 중, 제출 완료는 따로 표시한다", () => {
    const office = workingOffice();
    const [task] = office.day.tasks;
    expect(() => office.setTaskStatus(task.id, "submitted")).toThrow(expect.objectContaining({ code: "noSubmission" }));
    office.submitWork(task.id, "text", "화면을 만들었다");
    expect(task.status).toBe("in_progress");
    office.setTaskStatus(task.id, "submitted");
    expect(task.status).toBe("submitted");
    office.setTaskStatus(task.id, "in_progress");
    expect(task.status).toBe("in_progress");
  });

  test("링크는 본문을 읽지 않은 것(notRead)으로, 글·코드는 읽은 것으로 남긴다", () => {
    const office = workingOffice();
    const id = office.day.tasks[0].id;
    expect(office.submitWork(id, "link", "https://github.com/me/weather").readScope).toBe("notRead");
    expect(office.submitWork(id, "code", "const a = 1;\n\n").readScope).toBe("read");
    expect(() => office.submitWork(id, "link", "그냥 글")).toThrow(OfficeError);
    expect(() => office.submitWork(id, "text", "   ")).toThrow(expect.objectContaining({ code: "emptySubmission" }));
    expect(office.day.submissions).toHaveLength(2);
  });
});

describe("회의실 발표", () => {
  test("과제마다 맡은 부서 한 곳과 대화하고, 그 부서가 마무리하면 다음 파트의 부서로 넘어간다", () => {
    const office = workingOffice();
    expect(() => office.recordShareTurn({ role: "user", text: "x" })).toThrow(OfficeError);
    office.startSharing();
    expect(office.day.share.state).toBe("awaiting_explanation");
    // 화면 과제는 디자인팀, API 정리 과제는 기획팀이 듣는다.
    expect(office.day.share.parts?.map((p) => p.role)).toEqual(["designer", "planner"]);
    expect(office.day.share.maxQuestions).toBe(2 * PART_MAX_QUESTIONS);
    expect(office.shareSpeaker).toEqual({ role: "designer", canAsk: true, part: 0 });

    for (let i = 0; i < PART_MAX_QUESTIONS; i++) {
      office.recordShareTurn({ role: "user", text: "설명" });
      office.recordShareTurn({ role: "planner", reply: reply({ known_facts: ["화면 순서"] }), source: "solar" });
      expect(office.day.share.turns.at(-1)?.speaker).toBe("designer");
      expect(office.day.share.state).toBe("clarifying");
    }
    office.recordShareTurn({ role: "user", text: "답" });
    // 이 파트에서 물을 수 있는 만큼 물었으면 질문을 받지 않고, 마무리만 받는다.
    expect(office.shareSpeaker).toEqual({ role: "designer", canAsk: false, part: 0 });
    expect(() => office.recordShareTurn({ role: "planner", reply: reply(), source: "solar" })).toThrow(
      expect.objectContaining({ code: "shareQuestionLimit" }),
    );
    office.recordShareTurn({ role: "planner", reply: reply({ question: "", can_finish: true, known_facts: ["화면 순서"] }), source: "solar" });
    expect(office.day.share.state).toBe("clarifying");
    expect(office.shareSpeaker).toEqual({ role: "planner", canAsk: true, part: 1 });

    office.recordShareTurn({ role: "user", text: "fetch 흐름을 정리했습니다." });
    office.recordShareTurn({ role: "planner", reply: reply({ question: "", can_finish: true, known_facts: ["요청 흐름"], open_questions: [] }), source: "solar" });
    expect(office.day.share.turns.at(-1)?.speaker).toBe("planner");
    expect(office.day.share.questionCount).toBe(PART_MAX_QUESTIONS);
    expect(office.day.share.state).toBe("ready_to_summarize");
    // 다음 부서가 정리해도 앞 파트에서 알게 된 것·남은 질문은 지워지지 않는다.
    expect(office.day.share.knownFacts).toEqual(["화면 순서", "요청 흐름"]);
    expect(office.day.share.openQuestions).toEqual(["실패 안내"]);
  });

  test("물을 것이 없으면 바로 다음 파트로 넘어가고, 마지막 파트를 마치면 정리하며, 사용자가 언제든 끝낼 수 있다", () => {
    const office = workingOffice();
    office.startSharing();
    office.recordShareTurn({ role: "user", text: "설명" });
    office.recordShareTurn({ role: "planner", reply: reply({ question: "", can_finish: true }), source: "manual" });
    expect(office.day.share.state).toBe("clarifying");
    expect(office.shareSpeaker.role).toBe("planner");
    office.recordShareTurn({ role: "user", text: "설명" });
    office.recordShareTurn({ role: "planner", reply: reply({ question: "", can_finish: true }), source: "manual" });
    expect(office.day.share.questionCount).toBe(0);
    expect(office.day.share.state).toBe("ready_to_summarize");
    office.endSharing("userStopped");
    expect(office.day.share).toMatchObject({ endedBy: "userStopped", state: "user_confirmed" });
    expect(office.day.phase).toBe("checkoutReview");
  });

  test("파트를 맡을 부서는 과제 글로 정하고, 단서가 있으면 아직 안 맡은 부서를 먼저 고른다", () => {
    expect(sharePartsOf([]).map((p) => p.role)).toEqual(["planner"]);
    expect(
      sharePartsOf([
        { title: "로그인 화면 만들기" },
        { title: "Vercel 배포와 오류 로그 확인" },
        { title: "React 상태 관리 공부" },
      ]).map((p) => p.role),
    ).toEqual(["designer", "operations", "planner"]);
    // 두 과제 모두 화면이지만 둘째 과제에 운영 단서(오류)가 있으면 운영팀이 듣는다.
    expect(sharePartsOf([{ title: "목록 화면" }, { title: "상세 화면", completionCriteria: "오류가 나면 안내를 보여 준다" }]).map((p) => p.role)).toEqual([
      "designer",
      "operations",
    ]);
    // 다른 단서가 없으면 같은 부서가 두 파트를 들을 수 있다.
    expect(sharePartsOf([{ title: "목록 화면" }, { title: "상세 화면" }]).map((p) => p.role)).toEqual(["designer", "designer"]);
  });

  test("공유가 맞지 않는 학습은 수행 중에 바로 마감으로 건너뛸 수 있다", () => {
    const office = workingOffice();
    office.endSharing();
    expect(office.day.share.endedBy).toBe("skipped");
    expect(office.day.phase).toBe("checkoutReview");
  });
});

describe("하루 마감", () => {
  test("AI 초안은 따로 보존하고, 사용자 수정은 구분해 남긴다", () => {
    const office = atReview();
    office.saveReviewDraft(review("AI 제안"), "solar");
    office.saveReviewDraft(review("내가 고친 다음 행동"), "user");
    expect(office.day.review).toMatchObject({ draftSource: "solar", editedByUser: true });
    expect(office.day.review.aiDraft?.next_action).toBe("AI 제안");
    expect(office.day.review.draft?.next_action).toBe("내가 고친 다음 행동");
  });

  test("제출하지 않은 과제는 처리를 골라야 마감되고, 사유는 선택이다", () => {
    const office = atReview();
    const [a, b] = office.day.tasks;
    office.submitWork(a.id, "text", "결과");
    office.setTaskStatus(a.id, "submitted");
    expect(() => office.confirmReview(review(), {})).toThrow(expect.objectContaining({ code: "choiceMissing", details: [b.title] }));
    const result = office.confirmReview(review(), { [b.id]: "endToday" });
    expect(result).toEqual({ submitted: 1, adjusted: 0, carried: 0, ended: 1 });
    expect(a.status).toBe("reviewed");
    expect(b).toMatchObject({ status: "incomplete", outcome: "endToday", outcomeReason: "" });
    expect(office.day.phase).toBe("off");
    expect(office.pendingCarry).toHaveLength(0);
  });

  test("범위 조정은 오늘 마감 확인으로, 오늘 종료·이월은 별도 기록으로 남긴다", () => {
    const office = atReview();
    const [a, b] = office.day.tasks;
    office.confirmReview(review(), { [a.id]: "adjust", [b.id]: "carryOver" }, { [b.id]: "자료 조사가 길어짐" });
    expect(a).toMatchObject({ status: "reviewed", outcome: "adjust" });
    expect(b).toMatchObject({ status: "incomplete", outcome: "carryOver", outcomeReason: "자료 조사가 길어짐" });
    expect(office.day.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["adjust", "carryOver", "reviewConfirmed"]));
  });
});

describe("이월과 다음 활동일", () => {
  test("이월한 과제는 원본 ID를 보존해 다음 활동일 확정 목록 앞에 붙는다", () => {
    const office = atReview();
    const [a, b] = office.day.tasks;
    office.confirmReview(review(), { [a.id]: "carryOver", [b.id]: "endToday" });
    expect(office.pendingCarry[0]).toMatchObject({ title: a.title, carriedFromTaskId: a.id, carryCount: 1, status: "confirmed" });

    office.startNextWorkday();
    expect(sameDay(office.today, makeDay(2026, 11, 17))).toBe(true);
    expect(hm(office.now)).toBe("08:55");
    expect(office.history[0]).toMatchObject({ counted: true, review: expect.objectContaining({ next_action: "실패 안내 상태 추가" }) });
    expect(office.mails.at(-1)?.body).toContain("이월한 과제 1건");

    office.checkIn();
    const carriedId = office.pendingCarry[0].id;
    const tasks = office.confirmTasks({
      tasks: [{ carryId: carriedId, title: "날씨 화면 실패 안내", completionCriteria: "에러 문구가 보인다", shareForm: "" }, sampleTasks()[1]],
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ title: "날씨 화면 실패 안내", carriedFromTaskId: a.id, carryCount: 1, carriedFrom: monday });
    expect(office.pendingCarry).toHaveLength(0);

    // 두 번 이월해도 맨 처음 과제의 ID를 유지한다.
    office.endSharing();
    office.confirmReview(review(), { [tasks[0].id]: "carryOver", [tasks[1].id]: "endToday" });
    expect(office.pendingCarry[0]).toMatchObject({ carriedFromTaskId: a.id, carryCount: 2, carriedFrom: monday });
  });

  test("출근하지 않은 날은 휴식일로 넘길 수 있고 기록에 남기지 않는다", () => {
    const office = makeOffice();
    office.startNextWorkday();
    expect(office.history).toHaveLength(0);
  });

  test("접속·출근만 한 날은 활동으로 인정하지 않는다", () => {
    const office = makeOffice();
    office.checkIn();
    office.confirmTasks({ tasks: sampleTasks() });
    office.endSharing();
    office.confirmReview(review(), Object.fromEntries(office.day.tasks.map((t) => [t.id, "endToday" as const])));
    office.startNextWorkday();
    expect(office.history[0].counted).toBe(false);
  });
});

describe("새로고침 후 복원", () => {
  test("저장했다 되살리면 과제·제출물·대화·초안이 그대로다", () => {
    const office = workingOffice();
    const id = office.day.tasks[0].id;
    office.submitWork(id, "link", "https://example.com/a");
    office.startSharing();
    office.recordShareTurn({ role: "user", text: "설명" });
    office.recordShareTurn({ role: "planner", reply: reply(), source: "solar" });
    const restored = Office.fromJSON(JSON.parse(JSON.stringify(office.toJSON())));
    expect(restored.toJSON()).toEqual(office.toJSON());
    expect(restored.day.share.questionCount).toBe(1);
    expect(Office.isCurrent(office.toJSON())).toBe(true);
    expect(Office.isCurrent({ profile: {}, day: {} })).toBe(false);
  });
});

describe("시연 도구", () => {
  test("다음 정각은 단계를 바꾸지 않는다", () => {
    const office = workingOffice();
    const r = office.skipHour();
    expect(r?.stoppedFor).toBeNull();
    expect(hm(office.now)).toBe("10:00");
    expect(office.day.phase).toBe("working");
  });
});
