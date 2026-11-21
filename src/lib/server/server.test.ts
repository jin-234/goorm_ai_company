import { describe, expect, test } from "vitest";
import { at, hm, makeDay } from "../office/time";
import { applyAction, BadRequest } from "./actions";
import { CLOCK_PAUSE_AFTER_MS, withOffice } from "./session";
import { MemoryStore } from "./store";
import { officeView } from "./view";

const monday = makeDay(2026, 11, 16);
const realStart = at(makeDay(2026, 11, 18), 14 * 60); // 수요일에 처음 켬 → 그 주 월요일 08:55에서 시작

describe("서버 세션과 가상 시계", () => {
  test("처음 열면 이번 주 월요일 08:55에서 시작하고 저장된다", async () => {
    const store = new MemoryStore();
    const { office } = await withOffice("a", () => null, { store, realNow: realStart });
    expect(office.today).toEqual(monday);
    expect(hm(office.now)).toBe("08:55");
    expect((await store.load("a"))?.clockAnchor).toBe(realStart);
  });

  test("요청 사이 흐른 실제 시간만큼 시계가 간다", async () => {
    const store = new MemoryStore();
    await withOffice("a", (o) => o.completeOnboarding("김서울"), { store, realNow: realStart });
    const { office } = await withOffice("a", () => null, { store, realNow: realStart + 90_000 });
    expect(hm(office.now)).toBe("08:56"); // 08:55 + 1분 30초
  });

  test("오래 요청이 없으면 시계를 멈춰 둔 것으로 본다", async () => {
    const store = new MemoryStore();
    await withOffice("a", () => null, { store, realNow: realStart });
    const { office } = await withOffice("a", () => null, { store, realNow: realStart + CLOCK_PAUSE_AFTER_MS + 1 });
    expect(hm(office.now)).toBe("08:55");
  });

  test("규칙 위반이면 저장하지 않는다", async () => {
    const store = new MemoryStore();
    await withOffice("a", () => null, { store, realNow: realStart });
    await expect(
      withOffice("a", (o) => applyAction(o, { type: "confirmTasks", tasks: [] }), { store, realNow: realStart + 1000 }),
    ).rejects.toMatchObject({ code: "notAllowedNow" });
    expect((await store.load("a"))?.clockAnchor).toBe(realStart);
  });
});

describe("행동 API로 하루 보내기", () => {
  test("입사 → 출근 → 아침보고 확정 → 제출 → 공유 → 마감 → 다음 날 이월, 새로고침마다 복원", async () => {
    const store = new MemoryStore();
    let t = realStart;
    const act = async (body: Record<string, unknown>) =>
      (await withOffice("a", (o) => applyAction(o, body), { store, realNow: (t += 1000) })).office;

    await expect(act({ type: "onboard", name: "박취준", activityStart: "25:00" })).rejects.toBeInstanceOf(BadRequest);
    let office = await act({ type: "onboard", name: "박취준", targetRole: "프런트엔드", experience: "독학", activityStart: "10:00", activityEnd: "19:00" });
    expect(hm(office.now)).toBe("09:55");
    office = await act({ type: "checkIn" });
    expect(office.day.phase).toBe("morningPT");

    await act({ type: "saveGoal", goal: "날씨 화면 만들기" });
    await expect(act({ type: "confirmTasks", tasks: "x" })).rejects.toBeInstanceOf(BadRequest);
    office = await act({
      type: "confirmTasks",
      goal: "날씨 화면 만들기",
      tasks: [
        { title: "날씨 조회 화면", completionCriteria: "도시 입력 시 날씨 표시", shareForm: "캡처" },
        { title: "에러 안내", completionCriteria: "실패 문구 표시", shareForm: "" },
      ],
    });
    const [a, b] = office.day.tasks;
    await act({ type: "submitWork", taskId: a.id, kind: "link", content: "https://example.com/weather" });
    office = await act({ type: "setTaskStatus", taskId: a.id, status: "submitted" });
    expect(office.day.submissions[0].readScope).toBe("notRead");

    await act({ type: "startSharing" });
    await expect(act({ type: "recordShareTurn", role: "planner", reply: {} })).rejects.toBeInstanceOf(BadRequest);
    office = await act({ type: "recordShareTurn", role: "user", text: "도시를 입력하면 날씨를 보여줍니다." });
    expect(office.day.share.turns).toHaveLength(1);
    office = await act({ type: "endSharing", reason: "done" });
    expect(office.day.phase).toBe("checkoutReview");

    await act({ type: "saveReviewDraft", review: { reported_work: "날씨 화면", next_action: "에러 안내 만들기", open_questions: ["실패 문구"] } });
    await expect(act({ type: "confirmReview", review: {}, choices: { [b.id]: "later" } })).rejects.toBeInstanceOf(BadRequest);
    await expect(act({ type: "confirmReview", review: {}, choices: {} })).rejects.toMatchObject({ code: "choiceMissing" });
    office = await act({ type: "confirmReview", review: { next_action: "에러 안내 만들기" }, choices: { [b.id]: "carryOver" }, reasons: { [b.id]: "" } });
    expect(office.day.phase).toBe("off");

    const view = officeView(office);
    expect(view.pendingCarry[0]).toMatchObject({ title: "에러 안내", carriedFromTaskId: b.id });
    expect(view.day.review.confirmed?.next_action).toBe("에러 안내 만들기");

    office = await act({ type: "startNextWorkday" });
    expect(officeView(office).mail.inbox[0].subject).toContain("11월 17일(화)");
    expect(officeView(office).history[0]).toMatchObject({ counted: true });
  });

  test("출근 방식(camera·noCamera)은 기록만 하고, 다른 값은 BadRequest", async () => {
    const store = new MemoryStore();
    await withOffice("a", (o) => applyAction(o, { type: "onboard", name: "김서울" }), { store });
    await expect(withOffice("a", (o) => applyAction(o, { type: "checkIn", method: "face" }), { store })).rejects.toBeInstanceOf(BadRequest);
    const { office } = await withOffice("a", (o) => applyAction(o, { type: "checkIn", method: "noCamera" }), { store });
    expect(officeView(office).day.checkInMethod).toBe("noCamera");
    expect(office.day.events[0].text).toContain("카메라 없이");
    expect(office.day.phase).toBe("morningPT");
  });

  test("알 수 없는 행동과 잘못된 값은 BadRequest", async () => {
    const store = new MemoryStore();
    await expect(withOffice("a", (o) => applyAction(o, { type: "fly" }), { store })).rejects.toBeInstanceOf(BadRequest);
    await expect(withOffice("a", (o) => applyAction(o, { type: "observePresence", state: "absent" }), { store })).rejects.toBeInstanceOf(
      BadRequest,
    );
    await expect(withOffice("a", (o) => applyAction(o, { type: "submitWork", taskId: "x", kind: "file", content: "a" }), { store })).rejects.toBeInstanceOf(
      BadRequest,
    );
  });

  test("옛 근태 형식으로 저장된 상태는 버리고 새로 시작한다", async () => {
    const store = new MemoryStore();
    await store.save("a", { state: { profile: { name: "옛", workStart: 540 }, day: { phase: "dinner" } } as never, clockAnchor: realStart });
    const { office } = await withOffice("a", () => null, { store, realNow: realStart + 1000 });
    expect(office.onboarded).toBe(false);
    expect(office.day.phase).toBe("beforeCheckIn");
  });

  test("화면용 상태(78과 맞춘 모양)", async () => {
    const store = new MemoryStore();
    const { office } = await withOffice("a", (o) => o.completeOnboarding("김서울"), { store, realNow: realStart });
    const view = officeView(office);
    expect(view.phase).toMatchObject({ value: "beforeCheckIn", label: "출근 전", headline: "출근 전 · 활동 시작 09:00" });
    expect(view.seat.kind).toBe("beforeCheckIn");
    expect(view.can).toMatchObject({ checkIn: true, confirmTasks: false, startNextWorkday: true });
    expect(view.mail.unreadCount).toBe(2);
    expect(view.weekly.lastSubmitted).toBeNull();
    expect(JSON.parse(JSON.stringify(view)).profile.name).toBe("김서울");
    expect(JSON.stringify(view)).not.toMatch(/monthStats|lateFee|presence|overtime/);
  });
});
