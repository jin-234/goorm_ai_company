import { describe, expect, test } from "vitest";
import { at, hm, makeDay } from "../office/time";
import { applyAction, BadRequest } from "./actions";
import { withOffice } from "./session";
import { MemoryStore } from "./store";
import { officeView } from "./view";

const wednesday = makeDay(2026, 11, 18);
const realStart = at(wednesday, 14 * 60); // 실제 시각: 2026-11-18(수) 14:00 KST

describe("서버 세션과 회사 시계(한국 표준시)", () => {
  test("새 회사는 실제 지금 시각(KST)에서 시작하고 저장된다", async () => {
    const store = new MemoryStore();
    const { office } = await withOffice("a", () => null, { store, realNow: realStart });
    expect(office.today).toEqual(wednesday);
    expect(hm(office.now)).toBe("14:00");
    expect((await store.load("a"))?.clockAnchor).toBe(realStart);
  });

  test("서버 시간대와 무관하게 한국 시각으로 표시한다(UTC 자정 직전 = KST 아침 9시 직전)", async () => {
    const store = new MemoryStore();
    const utcLate = Date.UTC(2026, 10, 19, 23, 59); // UTC 11/19 23:59 = KST 11/20(금) 08:59
    const { office } = await withOffice("a", () => null, { store, realNow: utcLate });
    const view = officeView(office);
    expect(view.clock).toMatchObject({ hm: "08:59", dateShort: "11월 20일(금)", isFriday: true });
  });

  test("요청 사이 흐른 실제 시간만큼 시계가 가고, 입사해도 시각을 바꾸지 않는다", async () => {
    const store = new MemoryStore();
    await withOffice("a", (o) => o.completeOnboarding({ name: "김서울", activityStart: 9 * 60 }), { store, realNow: realStart });
    const { office } = await withOffice("a", () => null, { store, realNow: realStart + 90_000 });
    expect(hm(office.now)).toBe("14:01"); // 14:00 + 1분 30초
  });

  test("오래 비워 둬도 멈추지 않고 실제 시각을 따른다", async () => {
    const store = new MemoryStore();
    await withOffice("a", () => null, { store, realNow: realStart });
    const { office } = await withOffice("a", () => null, { store, realNow: realStart + 3 * 60 * 60 * 1000 });
    expect(hm(office.now)).toBe("17:00");
  });

  test("[다음 정각]으로 건너뛴 만큼만 실제보다 앞서 간다", async () => {
    const store = new MemoryStore();
    await withOffice("a", (o) => o.completeOnboarding("김서울"), { store, realNow: realStart });
    await withOffice("a", (o) => applyAction(o, { type: "skipHour" }), { store, realNow: realStart }); // 14:00 → 15:00
    const { office } = await withOffice("a", () => null, { store, realNow: realStart + 10 * 60 * 1000 });
    expect(hm(office.now)).toBe("15:10");
  });

  test("날짜가 바뀐 뒤 다음 활동일을 시작하면 실제 오늘·지금 시각으로 간다", async () => {
    const store = new MemoryStore();
    await withOffice("a", (o) => o.completeOnboarding("김서울"), { store, realNow: realStart });
    const nextMorning = at(makeDay(2026, 11, 19), 8 * 60 + 30);
    const { office } = await withOffice("a", (o) => applyAction(o, { type: "startNextWorkday" }), { store, realNow: nextMorning });
    expect(office.today).toEqual(makeDay(2026, 11, 19));
    expect(hm(office.now)).toBe("08:30");
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
    await expect(act({ type: "onboard", name: "박취준", enforcement: "loose" })).rejects.toBeInstanceOf(BadRequest);
    let office = await act({
      type: "onboard",
      name: "박취준",
      targetRole: "프런트엔드",
      experience: "독학",
      activityStart: "10:00",
      activityEnd: "19:00",
      enforcement: "light",
    });
    expect(office.profile.enforcement).toBe("light");
    expect(hm(office.now)).toBe("14:00"); // 입사해도 실제 시각 그대로
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
    expect(officeView(office).mail.inbox[0].subject).toContain("11월 19일(목)");
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
    await expect(withOffice("a", (o) => applyAction(o, { type: "observePresence", state: "sleeping" }), { store })).rejects.toBeInstanceOf(
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
    // 기본 관리 강도는 보통이다.
    expect(view.enforcement).toMatchObject({ chosen: "standard", level: "standard", lowered: false });
    expect(view.phase).toMatchObject({ value: "beforeCheckIn", label: "출근 전", headline: "출근 전 · 09:00까지 출근" });
    expect(view.seat.kind).toBe("beforeCheckIn");
    expect(view.can).toMatchObject({ checkIn: true, confirmTasks: false, startNextWorkday: true });
    expect(view.mail.unreadCount).toBe(2);
    expect("weekly" in view).toBe(false);
    expect(JSON.parse(JSON.stringify(view)).profile.name).toBe("김서울");
    expect(view.attendance.month).toMatchObject({ late: 0, absent: 0, points: 0, estimatedFee: 0 });
    expect(JSON.stringify(view)).not.toMatch(/submitWeekly|jumpToFriday/);
  });
});
