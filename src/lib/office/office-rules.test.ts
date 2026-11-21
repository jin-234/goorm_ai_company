import { describe, expect, test } from "vitest";
import { newDraft } from "./models";
import { Office } from "./office";
import { LateFee, monthStats, OfficeError } from "./rules";
import { seatStatusOf } from "./seat-status";
import { friday, makeOffice, monday, sampleDrafts, workingOffice } from "./test-helpers";
import {
  addDays,
  at,
  Clock,
  dayKeyOf,
  hm,
  isFriday,
  isWeekend,
  koreanShort,
  makeDay,
  minuteOfDay,
  mondayOfWeek,
  nextWorkday,
  weekdayName,
  weekLabel,
} from "./time";

describe("날짜와 시각", () => {
  test("요일과 다음 근무일", () => {
    expect(weekdayName(monday)).toBe("월");
    expect(isFriday(friday)).toBe(true);
    expect(nextWorkday(monday)).toEqual(makeDay(2026, 11, 17));
    expect(nextWorkday(friday)).toEqual(makeDay(2026, 11, 23));
    expect(isWeekend(makeDay(2026, 11, 21))).toBe(true);
    expect(mondayOfWeek(makeDay(2026, 11, 19))).toEqual(monday);
    expect(mondayOfWeek(makeDay(2026, 11, 22))).toEqual(monday);
  });

  test("달이 바뀌는 근무일", () => {
    const lastFriday = makeDay(2026, 10, 30);
    expect(isFriday(lastFriday)).toBe(true);
    expect(nextWorkday(lastFriday)).toEqual(makeDay(2026, 11, 2));
    expect(nextWorkday(makeDay(2026, 12, 31))).toEqual(makeDay(2027, 1, 1));
  });

  test("시각 표기", () => {
    expect(hm(at(monday, 9 * 60 + 5))).toBe("09:05");
    expect(minuteOfDay(at(monday, 18 * 60))).toBe(1080);
    expect(Clock.minutesFromHM("15:00")).toBe(900);
    expect(Clock.minutesFromHM("9:30")).toBe(570);
    expect(Clock.minutesFromHM("25:00")).toBeNull();
    expect(Clock.minutesFromHM("오후 3시")).toBeNull();
    expect(Clock.korean(15 * 60)).toBe("오후 3시");
    expect(Clock.korean(9 * 60 + 30)).toBe("오전 9시 30분");
    expect(Clock.duration(65)).toBe("1시간 5분");
    expect(koreanShort(monday)).toBe("11월 16일(월)");
    expect(weekLabel(monday)).toBe("11월 3주차");
  });

  test("시연 시작은 이번 주 월요일 08:55", () => {
    const start = Office.demoStart(at(makeDay(2026, 11, 18), 14 * 60));
    expect(dayKeyOf(start)).toEqual(monday);
    expect(hm(start)).toBe("08:55");
    // 토요일(본선 날)에 켜도 그 주 월요일에서 시작한다.
    expect(dayKeyOf(Office.demoStart(at(makeDay(2026, 11, 21), 10 * 60)))).toEqual(monday);
  });
});

describe("출근과 지각", () => {
  test("정시 전 출근은 정상", () => {
    const office = makeOffice(8 * 60 + 55);
    expect(office.checkIn()).toBe("onTime");
    expect(office.day.phase).toBe("morningPT");
    expect(hm(office.day.checkInAt!)).toBe("08:55");
    expect(office.day.isLate).toBe(false);
    expect(office.presence).toBe("present");
  });

  test("09:00 정각은 정상이고 09:01은 지각", () => {
    expect(makeOffice(9 * 60).checkIn()).toBe("onTime");

    // 09:00:59도 분 단위로 보면 09:00이라 정상이다.
    const almost = makeOffice();
    almost.advance(at(monday, 9 * 60) + 59_000);
    expect(almost.checkIn()).toBe("onTime");

    const late = makeOffice(9 * 60 + 1);
    expect(late.checkIn()).toBe("late");
    expect(late.day.isLate).toBe(true);
    expect(late.day.events.some((e) => e.kind === "late")).toBe(true);
    expect(late.inbox.some((m) => m.subject.includes("지각 기록 09:01"))).toBe(true);
    expect(late.monthStats).toEqual(monthStats(1, 0));
  });

  test("출근은 하루에 한 번", () => {
    const office = makeOffice();
    office.checkIn();
    expect(() => office.checkIn()).toThrow(OfficeError);
  });

  test("출근 기록 없이 퇴근 시각이 되면 결근 후보", () => {
    const office = makeOffice();
    let last = null;
    while (office.canSkipHour) last = office.skipHour();
    expect(hm(office.now)).toBe("18:00");
    expect(last?.stoppedFor).toBeNull();
    expect(office.day.absentCandidate).toBe(true);
    expect(seatStatusOf(office)).toEqual({ kind: "absentCandidate" });
    expect(office.canCheckIn).toBe(false);
    expect(() => office.checkIn()).toThrow(OfficeError);
    expect(office.inbox.some((m) => m.subject.includes("결근 후보"))).toBe(true);
    expect(office.monthStats.points).toBe(3);
    expect(office.monthStats.estimatedFee).toBe(1_000);

    expect(office.canStartNextWorkday).toBe(true);
    office.startNextWorkday();
    expect(office.today).toEqual(makeDay(2026, 11, 17));
    expect(office.history.at(-1)?.attendance).toBe("absentCandidate");
    expect(office.monthStats.points).toBe(3);
  });

  test("늦게라도 퇴근 시각 전이면 출근할 수 있다", () => {
    const office = makeOffice();
    for (let i = 0; i < 5; i++) office.skipHour();
    expect(hm(office.now)).toBe("14:00");
    expect(office.checkIn()).toBe("late");
  });
});

describe("지각비 예상액", () => {
  test("기획서 기준", () => {
    expect(LateFee.estimate(0, 0)).toBe(0);
    expect(LateFee.estimate(1, 0)).toBe(0);
    expect(LateFee.estimate(2, 0)).toBe(0);
    expect(LateFee.estimate(3, 0)).toBe(1_000);
    expect(LateFee.estimate(5, 0)).toBe(3_000);
    expect(LateFee.points(0, 1)).toBe(3);
    expect(LateFee.estimate(0, 1)).toBe(1_000);
    expect(LateFee.estimate(1, 1)).toBe(2_000);
    expect(LateFee.estimate(7, 0)).toBe(5_000);
    expect(LateFee.estimate(30, 4)).toBe(5_000);
    expect(LateFee.won(3_000)).toBe("3,000원");
  });

  test("달이 바뀌면 새로 센다", () => {
    const office = makeOffice(9 * 60 + 10, makeDay(2026, 10, 30));
    office.checkIn();
    expect(office.monthStats.late).toBe(1);
    while (office.canSkipHour) office.skipHour();
    office.submitCheckout();
    office.startNextWorkday();
    expect(office.today).toEqual(makeDay(2026, 11, 2));
    expect(office.monthStats).toEqual(monthStats());
  });
});

describe("아침 PT와 업무 확정", () => {
  test("출근 전에는 확정할 수 없다", () => {
    const office = makeOffice();
    office.replaceDrafts(sampleDrafts(), "manual");
    expect(() => office.confirmTasks()).toThrow(OfficeError);
  });

  test("확인 필요 칸이 남으면 확정할 수 없다", () => {
    const office = makeOffice();
    office.checkIn();
    expect(office.confirmBlocker?.code).toBe("noTasks");

    office.replaceDrafts(
      [
        newDraft({ title: "지원서 최종 검토", level: 3, due: null, doneCriteria: "제출본 저장" }),
        newDraft({ title: null, level: null, due: 17 * 60, doneCriteria: null }),
      ],
      "solar",
    );
    const blocker = office.confirmBlocker!;
    expect(blocker.code).toBe("draftIncomplete");
    const rows = blocker.details;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("지원서 최종 검토");
    expect(rows[0]).toContain("마감");
    for (const word of ["2번째 업무", "업무명", "중요도", "완료 기준"]) expect(rows[1]).toContain(word);
    expect(() => office.confirmTasks()).toThrow(OfficeError);
    expect(office.day.phase).toBe("morningPT");
  });

  test("수정하고 확정한 목록으로 근무를 시작한다", () => {
    const office = makeOffice();
    office.checkIn();
    office.replaceDrafts([...sampleDrafts()].reverse(), "solar");
    office.day.drafts[0].level = 2;
    office.day.drafts[0].due = 16 * 60;
    office.confirmTasks();

    expect(office.day.phase).toBe("working");
    expect(office.day.tasks.map((t) => t.title)).toEqual(["지원서 최종 검토", "관심 기업 세 곳 저장", "포트폴리오 한 문단 초안"]);
    expect(office.day.tasks.map((t) => t.level)).toEqual([3, 2, 2]);
    expect(office.day.tasks[1].due).toBe(16 * 60);
    expect(office.inbox.some((m) => m.kind === "tasksConfirmed")).toBe(true);
    expect(() => office.confirmTasks()).toThrow(OfficeError);
  });

  test("초안을 다시 만들어도 이월 업무는 남는다", () => {
    const office = makeOffice();
    office.checkIn();
    office.day.drafts = [
      newDraft({ title: "어제 남은 일", level: 2, due: 600, doneCriteria: "끝내기", carriedFrom: addDays(monday, -3), carryCount: 1 }),
    ];
    office.replaceDrafts(sampleDrafts(), "localRules");
    expect(office.day.drafts).toHaveLength(4);
    expect(office.day.drafts[0].carriedFrom).not.toBeNull();
    office.removeDraft(office.day.drafts[0].id);
    expect(office.day.drafts).toHaveLength(4);
    office.removeDraft(office.day.drafts[1].id);
    expect(office.day.drafts).toHaveLength(3);
  });
});

describe("점심과 자리 비움", () => {
  test("점심은 메일로 요청하고 한 시간을 받는다", () => {
    const office = workingOffice();
    office.advance(at(monday, 12 * 60 + 10));
    const lunch = office.requestLunch();
    expect(hm(lunch.start)).toBe("12:10");
    expect(hm(lunch.end)).toBe("13:10");
    expect(seatStatusOf(office)).toEqual({ kind: "lunch", until: lunch.end });
    expect(office.isMonitoring).toBe(false);
    expect(office.sent.some((m) => m.kind === "lunchRequest")).toBe(true);
    expect(office.inbox.find((m) => m.kind === "lunchApproval")?.subject).toBe("[근태] 점심 승인 12:10~13:10");
    office.returnFromAllowance();
    expect(() => office.requestLunch()).toThrow(expect.objectContaining({ code: "lunchAlreadyUsed" }));
  });

  test("점심 중 자리가 비어도 기록하지 않는다", () => {
    const office = workingOffice();
    office.advance(at(monday, 12 * 60 + 10));
    office.requestLunch();
    office.observe("absent");
    office.advance(at(monday, 12 * 60 + 50));
    expect(office.day.awaySpans).toHaveLength(0);
    expect(office.unauthorizedAwayMinutes).toBe(0);
  });

  test("허용 시간이 끝난 뒤에도 비어 있으면 근무 중 자리 비움", () => {
    const office = workingOffice();
    office.advance(at(monday, 10 * 60 + 20));
    const away = office.registerAway("물 가지러 자리 비웁니다");
    expect(hm(away.end)).toBe("10:35");
    expect(seatStatusOf(office)).toEqual({ kind: "away", until: away.end, reason: "물 가지러 자리 비웁니다" });
    office.observe("absent");

    office.advance(at(monday, 10 * 60 + 34));
    expect(office.day.awaySpans).toHaveLength(0);
    office.advance(at(monday, 10 * 60 + 40));
    expect(office.activeAllowance).toBeNull();
    const span = office.openSpan("unauthorized")!;
    expect(hm(span.start)).toBe("10:35");
    expect(office.unauthorizedAwayMinutes).toBe(5);
    expect(seatStatusOf(office)).toEqual({ kind: "unauthorizedAway", since: span.start });

    office.observe("present");
    expect(office.openSpan("unauthorized")).toBeNull();
    expect(hm(office.day.awaySpans[0].end!)).toBe("10:40");
    expect(seatStatusOf(office)).toEqual({ kind: "seated" });
  });

  test("시연 시간을 건너뛰어도 등록된 종료 시각에 만료한다", () => {
    const office = workingOffice();
    office.advance(at(monday, 10 * 60 + 20));
    office.registerAway("물 가지러 자리 비웁니다");
    office.observe("absent");
    expect(hm(office.skipHour()!.to)).toBe("11:00");
    expect(hm(office.day.allowances[0].endedAt!)).toBe("10:35");
    expect(office.day.awaySpans).toHaveLength(0);
    expect(office.presence).toBe("unknown");
    office.observe("absent");
    expect(hm(office.openSpan("unauthorized")!.start)).toBe("11:00");
  });

  test("한 시간 점심도 건너뛴 뒤 정확히 끝난다", () => {
    const office = workingOffice();
    office.advance(at(monday, 12 * 60 + 10));
    office.requestLunch();
    office.skipHour();
    expect(hm(office.now)).toBe("13:00");
    expect(office.activeAllowance).not.toBeNull();
    office.skipHour();
    expect(hm(office.now)).toBe("14:00");
    expect(office.activeAllowance).toBeNull();
    expect(hm(office.day.allowances[0].endedAt!)).toBe("13:10");
    expect(office.day.events.some((e) => e.kind === "lunchEnd" && hm(e.at) === "13:10")).toBe(true);
  });

  test("사유 없이는 자리 비움을 등록할 수 없다", () => {
    const office = workingOffice();
    expect(() => office.registerAway("   ")).toThrow(expect.objectContaining({ code: "emptyReason" }));
    office.registerAway("화장실");
    expect(() => office.registerAway("전화")).toThrow(expect.objectContaining({ code: "allowanceActive" }));
    expect(() => office.requestLunch()).toThrow(expect.objectContaining({ code: "allowanceActive" }));
  });

  test("먼저 복귀하면 착석 확인을 재개한다", () => {
    const office = workingOffice();
    office.advance(at(monday, 11 * 60));
    office.registerAway("택배 받기");
    office.advance(at(monday, 11 * 60 + 5));
    office.returnFromAllowance();
    expect(office.activeAllowance).toBeNull();
    expect(hm(office.day.allowances[0].endedAt!)).toBe("11:05");
    expect(office.isMonitoring).toBe(true);
    expect(hm(office.registerAway("전화 받기").end)).toBe("11:20");
  });

  test("등록 없이 자리를 비우면 바로 기록한다", () => {
    const office = workingOffice();
    office.advance(at(monday, 14 * 60));
    office.observe("absent");
    office.advance(at(monday, 14 * 60 + 12));
    expect(office.unauthorizedAwayMinutes).toBe(12);
    office.registerAway("급한 전화");
    expect(hm(office.day.awaySpans[0].end!)).toBe("14:12");
    office.advance(at(monday, 14 * 60 + 20));
    expect(office.unauthorizedAwayMinutes).toBe(12);
  });

  test("카메라 꺼짐은 자리 비움과 따로 기록한다", () => {
    const office = workingOffice();
    office.advance(at(monday, 15 * 60));
    office.observe("cameraOff");
    expect(seatStatusOf(office)).toEqual({ kind: "cameraOff" });
    office.advance(at(monday, 15 * 60 + 8));
    expect(office.cameraOffMinutes).toBe(8);
    expect(office.unauthorizedAwayMinutes).toBe(0);
    expect(office.day.events.some((e) => e.kind === "cameraOff")).toBe(true);
    office.observe("present");
    expect(office.openSpan("cameraOff")).toBeNull();
    expect(office.day.events.some((e) => e.kind === "cameraOn")).toBe(true);
  });

  test("근무를 시작하기 전에는 자리 비움을 세지 않는다", () => {
    const office = makeOffice();
    office.checkIn();
    office.observe("absent");
    office.advance(at(monday, 9 * 60 + 20));
    expect(office.day.awaySpans).toHaveLength(0);
    expect(seatStatusOf(office)).toEqual({ kind: "emptyBeforeWork" });
  });

  test("퇴근 시각이 가까우면 허용도 퇴근 시각에 끝난다", () => {
    const office = workingOffice();
    office.advance(at(monday, 17 * 60 + 30));
    expect(hm(office.requestLunch().end)).toBe("18:00");
  });
});

describe("가상 시계", () => {
  test("한 시간씩 가다가 퇴근 점검에서 멈춘다", () => {
    const office = workingOffice();
    expect(hm(office.now)).toBe("08:55");
    const times: string[] = [];
    const stops: (string | null)[] = [];
    while (office.canSkipHour) {
      const result = office.skipHour();
      times.push(hm(office.now));
      stops.push(result?.stoppedFor ?? null);
    }
    expect(times).toEqual(["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"]);
    expect(stops.every((s) => s === null)).toBe(true);
    expect(office.day.phase).toBe("checkoutReview");
    expect(office.skipHour()).toBeNull();
  });

  test("어중간한 시각에서도 다음 정각으로 간다", () => {
    const office = makeOffice(9 * 60 + 20);
    office.checkIn();
    office.replaceDrafts(sampleDrafts(), "manual");
    office.confirmTasks();
    expect(hm(office.skipHour()!.to)).toBe("10:00");
    expect(hm(office.skipHour()!.to)).toBe("11:00");
  });

  test("정각에 딱 맞으면 멈춘 것으로 치지 않는다", () => {
    const office = makeOffice(9 * 60);
    office.checkIn();
    office.replaceDrafts(sampleDrafts(), "manual");
    office.confirmTasks();
    for (let i = 0; i < 8; i++) office.skipHour();
    expect(hm(office.now)).toBe("17:00");
    const result = office.skipHour()!;
    expect(hm(result.to)).toBe("18:00");
    expect(result.stoppedFor).toBeNull();
    expect(office.day.phase).toBe("checkoutReview");
  });

  test("퇴근 시각 사이에 걸리면 그 시각에서 멈췄다고 알린다", () => {
    // 근무시간을 17:30까지로 바꾸면 17:00 → 17:30에서 멈춘다.
    const office = makeOffice(9 * 60);
    office.profile.workEnd = 17 * 60 + 30;
    office.checkIn();
    office.replaceDrafts(sampleDrafts(), "manual");
    office.confirmTasks();
    for (let i = 0; i < 8; i++) office.skipHour();
    const result = office.skipHour()!;
    expect(hm(result.to)).toBe("17:30");
    expect(result.stoppedFor).toBe("퇴근 점검 시각");
  });

  test("실제로 흐른 시간도 퇴근 점검을 연다", () => {
    const office = workingOffice();
    office.advance(at(monday, 17 * 60 + 59));
    expect(office.day.phase).toBe("working");
    office.advance(at(monday, 18 * 60) + 1000);
    expect(office.day.phase).toBe("checkoutReview");
    expect(office.day.events.some((e) => e.kind === "checkoutReview" && hm(e.at) === "18:00")).toBe(true);
  });

  test("시계는 뒤로 가지 않고 하루를 넘기지 않는다", () => {
    const office = makeOffice();
    office.advance(at(monday, 8 * 60));
    expect(hm(office.now)).toBe("08:55");
    office.advance(at(addDays(monday, 2), 10 * 60));
    expect(office.today).toEqual(monday);
    expect(hm(office.now)).toBe("23:59");
  });

  test("아침 PT 없이 퇴근 시각이 되면 미진행으로 기록한다", () => {
    const office = makeOffice();
    office.checkIn();
    while (office.canSkipHour) office.skipHour();
    expect(office.day.phase).toBe("checkoutReview");
    expect(office.day.noMorningPT).toBe(true);
    expect(office.submitCheckout()).toEqual({ kind: "offNoTasks" });
    expect(office.day.phase).toBe("off");
    expect(office.inbox.some((m) => m.subject.includes("아침 PT 미진행"))).toBe(true);
  });

  test("이월된 업무를 PT에서 다시 말해도 두 번 들어가지 않는다", () => {
    const office = new Office(at(monday, 8 * 60 + 55));
    office.day.drafts = [
      newDraft({ title: "관심 기업 세 곳 저장", level: 1, due: 18 * 60, doneCriteria: "링크 모으기", carriedFrom: makeDay(2026, 11, 13), carryCount: 1 }),
    ];
    office.replaceDrafts(
      [
        newDraft({ title: "관심기업 세 곳 저장", level: 1, due: 18 * 60, doneCriteria: "링크" }),
        newDraft({ title: "포트폴리오 한 문단", level: 2, due: 17 * 60, doneCriteria: "문단" }),
      ],
      "localRules",
    );
    expect(office.day.drafts.map((d) => d.title)).toEqual(["관심 기업 세 곳 저장", "포트폴리오 한 문단"]);
    expect(office.day.drafts[0].carriedFrom).not.toBeNull();
  });
});
