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
      withOffice("a", (o) => applyAction(o, { type: "confirmTasks" }), { store, realNow: realStart + 1000 }),
    ).rejects.toMatchObject({ code: "notAllowedNow" });
    expect((await store.load("a"))?.clockAnchor).toBe(realStart);
  });
});

describe("행동 API로 하루 보내기", () => {
  test("입사 → 출근 → 초안 → 확정 → 다음 정각 → 퇴근 점검 → 이월 보고 퇴근", async () => {
    const store = new MemoryStore();
    let t = realStart;
    const act = async (body: Record<string, unknown>) =>
      (await withOffice("a", (o) => applyAction(o, body), { store, realNow: (t += 1000) })).office;

    await act({ type: "onboard", name: "박취준" });
    let office = await act({ type: "checkIn" });
    expect(office.day.phase).toBe("morningPT");

    office = await act({ type: "addDraft" });
    const id = office.day.drafts[0].id;
    await expect(act({ type: "updateDraft", id, due: "25:00" })).rejects.toBeInstanceOf(BadRequest);
    await act({ type: "updateDraft", id, title: "자기소개서 초안", level: 1, due: "17:00", doneCriteria: "한 문단 저장" });
    office = await act({ type: "confirmTasks" });
    expect(office.day.tasks[0]).toMatchObject({ title: "자기소개서 초안", level: 1, due: 17 * 60 });

    while (office.canSkipHour) office = await act({ type: "skipHour" });
    expect(office.day.phase).toBe("checkoutReview");

    const view = officeView(office);
    expect(view.checkout.carryReportTargetIds).toHaveLength(1);
    office = await act({
      type: "submitCheckout",
      carryReports: { [view.checkout.carryReportTargetIds[0]]: { reason: "자료 조사가 길어짐", plan: "오전에 마무리" } },
    });
    expect(office.day.phase).toBe("off");
    expect(office.pendingCarry).toHaveLength(1);

    office = await act({ type: "startNextWorkday" });
    expect(office.day.drafts[0].title).toBe("자기소개서 초안");
    expect(officeView(office).mail.inbox[0].subject).toContain("11월 17일(화)");
  });

  test("알 수 없는 행동과 잘못된 값은 BadRequest", async () => {
    const store = new MemoryStore();
    await expect(withOffice("a", (o) => applyAction(o, { type: "fly" }), { store })).rejects.toBeInstanceOf(BadRequest);
    await expect(withOffice("a", (o) => applyAction(o, { type: "observePresence", state: "sleeping" }), { store })).rejects.toBeInstanceOf(
      BadRequest,
    );
  });

  test("화면용 상태에는 자리 상태 문구와 가능 여부가 들어 있다", async () => {
    const store = new MemoryStore();
    const { office } = await withOffice("a", (o) => o.completeOnboarding("김서울"), { store, realNow: realStart });
    const view = officeView(office);
    expect(view.phase.headline).toBe("출근 전 · 09:00까지 출근");
    expect(view.seat.title).toBe("출근 전");
    expect(view.can.checkIn).toBe(true);
    expect(view.mail.unreadCount).toBe(2);
    expect(JSON.parse(JSON.stringify(view)).state.profile.name).toBe("김서울");
  });
});
