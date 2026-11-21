/** 관리 강도(가볍게·보통·엄격)와 놓친 날 복귀 장치를 시험한다. */
import { describe, expect, test } from "vitest";
import { emptyReview } from "./models";
import { Office } from "./office";
import { LateFee, OfficeError } from "./rules";
import { makeOffice, monday, sampleTasks, workingOffice } from "./test-helpers";
import { addDays, at, hm, nextWorkday } from "./time";

const leveled = (levels: (1 | 2 | 3)[]) => sampleTasks().map((t, i) => ({ ...t, level: levels[i] }));

/** 보통·엄격에서 출근하고 과제를 확정한 상태. 첫 과제 3단계, 둘째 1단계. */
const standardWorking = () => workingOffice("standard");

describe("입사 때 관리 강도 고르기", () => {
  test("기본은 보통이고, 입사·설정에서 바꿀 수 있다", () => {
    const office = new Office(at(monday, 8 * 60));
    expect(office.profile.enforcement).toBe("standard");
    office.completeOnboarding({ name: "김서울", enforcement: "strict" });
    expect(office.profile.enforcement).toBe("strict");
    expect(office.mails[0].body).toContain("관리 강도: 엄격");
    office.setEnforcement("light");
    expect(office.level).toBe("light");
  });

  test("가볍게 입사 메일에는 지각·추가근무가 없다고 적는다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "light");
    expect(office.mails[0].body).toContain("지각·착석 확인·추가근무가 없습니다");
  });
});

describe("출근과 지각(보통·엄격)", () => {
  test("시작 시각보다 늦으면 지각으로 기록하고 지각비 예상액 메일을 보낸다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.advance(at(monday, 9 * 60 + 10));
    expect(office.checkIn().late).toBe(true);
    expect(office.day.isLate).toBe(true);
    const mail = office.mails.find((m) => m.kind === "attendance")!;
    expect(mail.subject).toContain("지각 기록 09:10");
    expect(mail.body).toContain("청구하지 않습니다");
  });

  test("09:00:59까지는 지각이 아니다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.advance(at(monday, 9 * 60) + 59_000);
    expect(office.checkIn().late).toBe(false);
  });

  test("마감 시각까지 출근하지 않으면 결근 후보가 되고 출근할 수 없다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.advance(at(monday, 18 * 60));
    expect(office.day.absentCandidate).toBe(true);
    expect(office.canCheckIn).toBe(false);
    expect(() => office.checkIn()).toThrow(OfficeError);
    expect(office.mails.at(-1)!.subject).toContain("결근 후보");
  });

  test("쉬는 날로 미리 알리면 결근 후보로 세지 않는다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.setDayOff(true);
    office.advance(at(monday, 20 * 60));
    expect(office.day.absentCandidate).toBe(false);
    office.startNextWorkday();
    expect(office.history[0]).toMatchObject({ dayOff: true, absentCandidate: false });
    expect(office.monthStats.points).toBe(0);
  });

  test("다음 활동일을 쉬는 날로 미리 알릴 수 있다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.setDayOff(true, nextWorkday(monday));
    office.checkIn();
    office.confirmTasks({ tasks: leveled([1, 1]) });
    office.endSharing();
    office.confirmReview(emptyReview(), Object.fromEntries(office.unsubmittedTasks.map((t) => [t.id, "endToday" as const])));
    office.startNextWorkday();
    expect(office.day.dayOff).toBe(true);
    expect(() => office.setDayOff(true, monday)).toThrow(OfficeError);
  });

  test("가볍게는 늦어도, 출근하지 않아도 기록하지 않는다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "light");
    office.advance(at(monday, 19 * 60));
    expect(office.day.absentCandidate).toBe(false);
    office.startNextWorkday();
    expect(office.history).toHaveLength(0);
  });
});

describe("지각비와 회복", () => {
  test("지각 1점·결근 후보 3점, 2점까지 면제, 1점당 1,000원, 월 5,000원 상한", () => {
    expect(LateFee.estimateFromPoints(2)).toBe(0);
    expect(LateFee.estimateFromPoints(4)).toBe(2000);
    expect(LateFee.estimateFromPoints(20)).toBe(5000);
  });

  test("출근하지 않고 다음 날로 넘기면 결근 후보, 돌아온 날은 늦어도 지각이 아니고 환영 메일을 받는다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.checkIn();
    office.confirmTasks({ tasks: leveled([1, 1]) });
    office.endSharing();
    office.confirmReview(emptyReview(), Object.fromEntries(office.unsubmittedTasks.map((t) => [t.id, "carryOver" as const])));
    office.startNextWorkday(); // 화요일
    office.startNextWorkday(); // 화요일을 출근하지 않고 넘김 → 결근 후보
    expect(office.history.at(-1)).toMatchObject({ absentCandidate: true });
    expect(office.day.returning).toBe(true);
    expect(office.mails.at(-1)!.kind).toBe("returnWelcome");
    expect(office.mails.at(-1)!.body).toContain("다시 와서 반갑습니다");
    office.advance(at(office.today, 11 * 60));
    expect(office.checkIn().late).toBe(false);
    expect(office.monthStats).toMatchObject({ absent: 1, late: 0, points: 3, estimatedFee: 1000 });
  });

  test("연속 3일 제시간에 출근하면 1점을 덜어 준다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    const closeDay = () => {
      office.confirmTasks({ tasks: leveled([1, 1]) });
      office.endSharing();
      office.confirmReview(emptyReview(), Object.fromEntries(office.unsubmittedTasks.map((t) => [t.id, "endToday" as const])));
      office.startNextWorkday();
    };
    office.advance(at(monday, 9 * 60 + 30));
    office.checkIn(); // 월 지각
    closeDay();
    for (let i = 0; i < 3; i++) {
      office.checkIn(); // 화·수·목 제시간
      closeDay();
    }
    expect(office.monthStats).toMatchObject({ late: 1, recovered: 1, points: 0 });
  });
});

describe("아침보고 중요도", () => {
  test("보통·엄격에서는 과제마다 중요도를 정해야 확정한다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.checkIn();
    expect(() => office.confirmTasks({ tasks: sampleTasks() })).toThrow(/중요도/);
    office.confirmTasks({ tasks: leveled([3, 1]) });
    expect(office.day.tasks.map((t) => t.level)).toEqual([3, 1]);
  });

  test("가볍게에서는 중요도 없이 1단계로 둔다", () => {
    const office = workingOffice("light");
    expect(office.day.tasks.map((t) => t.level)).toEqual([1, 1]);
  });
});

describe("퇴근 점검과 추가근무(보통·엄격)", () => {
  test("마감 시각에 퇴근 점검, 2·3단계가 남으면 저녁시간 → 추가근무 → 점검 → 공유·마감", () => {
    const office = standardWorking();
    office.advance(at(monday, 18 * 60));
    expect(office.day.phase).toBe("checkout");
    expect(office.canSkipHour).toBe(false);
    expect(office.submitCheckout()).toEqual({ kind: "overtime", count: 1 });
    expect(office.day.phase).toBe("dinner");
    expect(office.mails.at(-1)!.subject).toContain("추가근무 배정 19:00~22:00");

    expect(office.skipHour()).toMatchObject({ stoppedFor: null });
    expect(hm(office.now)).toBe("19:00");
    expect(office.day.phase).toBe("overtime");
    office.advance(at(monday, 22 * 60));
    expect(office.day.phase).toBe("overtimeReview");
    expect(office.endOvertime()).toBe("ranToEnd");
    expect(office.day.phase).toBe("working");

    // 퇴근 점검을 마쳤으니 다시 점검으로 가지 않고, 공유·마감으로 이어 간다.
    office.advance(at(monday, 22 * 60 + 30));
    expect(office.day.phase).toBe("working");
    office.endSharing();
    expect(office.day.phase).toBe("checkoutReview");
  });

  test("2·3단계가 다 제출됐으면 추가근무 없이 공유·마감으로", () => {
    const office = standardWorking();
    const heavy = office.day.tasks[0];
    office.submitWork(heavy.id, "text", "화면을 만들었습니다");
    office.setTaskStatus(heavy.id, "submitted");
    office.advance(at(monday, 18 * 60 + 5));
    expect(office.submitCheckout()).toEqual({ kind: "noOvertime" });
    expect(office.day.phase).toBe("working");
    expect(office.unsubmittedTasks.map((t) => t.level)).toEqual([1]);
  });

  test("추가근무 중에 배정 과제를 다 내고 끝내면 완료, 남기고 끝내면 보충근무 미이행", () => {
    const done = standardWorking();
    done.advance(at(monday, 18 * 60));
    done.submitCheckout();
    done.advance(at(monday, 19 * 60 + 30));
    const heavy = done.day.tasks[0];
    done.submitWork(heavy.id, "text", "마무리");
    done.setTaskStatus(heavy.id, "submitted");
    expect(done.endOvertime()).toBe("completed");

    const quit = standardWorking();
    quit.advance(at(monday, 18 * 60));
    quit.submitCheckout();
    quit.advance(at(monday, 19 * 60 + 30));
    expect(quit.endOvertime()).toBe("abandoned");
    expect(quit.mails.at(-1)!.kind).toBe("supplementMissed");
  });

  test("다음 정각은 퇴근 점검 시각에서 멈춘다", () => {
    const office = standardWorking();
    office.advance(at(monday, 17 * 60 + 10));
    expect(office.skipHour()).toMatchObject({ stoppedFor: null });
    expect(hm(office.now)).toBe("18:00");
    expect(office.day.phase).toBe("checkout");
  });

  test("아침보고 중에 마감 시각이 되면 과제 없이 퇴근 점검 뒤 하루 마감으로", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.checkIn();
    office.advance(at(monday, 18 * 60));
    expect(office.day.phase).toBe("checkout");
    office.submitCheckout();
    expect(office.day.phase).toBe("checkoutReview");
  });
});

describe("마감 시각 전 마감", () => {
  test("보통: 2·3단계가 남아 있으면 마감 시각 전에는 공유·마감으로 넘어갈 수 없다", () => {
    const office = standardWorking();
    expect(() => office.startSharing()).toThrow(/2·3단계/);
    const heavy = office.day.tasks[0];
    office.submitWork(heavy.id, "text", "완료");
    office.setTaskStatus(heavy.id, "submitted");
    office.startSharing();
    expect(office.day.phase).toBe("sharing");
    expect(office.day.events.some((e) => e.kind === "earlyLeave")).toBe(true);
    // 일찍 마감했으니 마감 시각이 지나도 퇴근 점검으로 끌려가지 않는다.
    office.endSharing();
    office.advance(at(monday, 18 * 60 + 30));
    expect(office.day.phase).toBe("checkoutReview");
  });

  test("엄격: 마감 시각 전 마감에는 사유가 필요하다", () => {
    const office = workingOffice("strict");
    const heavy = office.day.tasks[0];
    office.submitWork(heavy.id, "text", "완료");
    office.setTaskStatus(heavy.id, "submitted");
    expect(() => office.endSharing("done")).toThrow(/사유/);
    office.endSharing("done", "병원 예약");
    expect(office.day.earlyLeaveReason).toBe("병원 예약");
    expect(office.day.phase).toBe("checkoutReview");
  });

  test("가볍게는 언제든 마감한다", () => {
    const office = workingOffice("light");
    office.startSharing();
    expect(office.day.phase).toBe("sharing");
  });
});

describe("착석 확인과 자리 비움", () => {
  test("보통: 15분보다 짧은 자리 비움은 기록하지 않고, 길면 기록한다", () => {
    const office = standardWorking();
    office.advance(at(monday, 10 * 60));
    office.observePresence("absent");
    office.advance(at(monday, 10 * 60 + 5));
    office.observePresence("present");
    expect(office.day.awaySpans).toHaveLength(0);

    office.observePresence("absent");
    office.advance(at(monday, 10 * 60 + 25));
    expect(office.awayWarning).toBe(true);
    office.observePresence("present");
    expect(office.unauthorizedAwayMinutes).toBe(20);
    expect(office.day.events.some((e) => e.kind === "unauthorizedAwayEnd")).toBe(true);
  });

  test("엄격: 짧아도 기록하고 바로 경고한다", () => {
    const office = workingOffice("strict");
    office.advance(at(monday, 10 * 60));
    office.observePresence("absent");
    expect(office.awayWarning).toBe(true);
    office.advance(at(monday, 10 * 60 + 3));
    office.observePresence("present");
    expect(office.unauthorizedAwayMinutes).toBe(3);
  });

  test("카메라가 꺼진 시간은 자리 비움으로 세지 않는다", () => {
    const office = standardWorking();
    office.observePresence("cameraOff");
    office.advance(at(monday, 10 * 60));
    office.observePresence("present");
    expect(office.unauthorizedAwayMinutes).toBe(0);
    expect(office.cameraOffMinutes).toBeGreaterThan(0);
  });

  test("점심·자리 비움을 등록하면 그동안 확인을 쉬고, 끝나면 다시 확인한다", () => {
    const office = standardWorking();
    office.advance(at(monday, 12 * 60));
    office.requestLunch();
    expect(() => office.requestLunch()).toThrow(OfficeError);
    office.observePresence("absent");
    expect(office.isMonitoring).toBe(false);
    office.advance(at(monday, 13 * 60 + 30));
    expect(office.isMonitoring).toBe(true);
    expect(office.unauthorizedAwayMinutes).toBe(30);

    office.observePresence("present");
    expect(() => office.registerAway(" ")).toThrow(OfficeError);
    office.registerAway("택배");
    expect(office.activeAllowance?.kind).toBe("away");
    office.returnFromAllowance();
    expect(office.activeAllowance).toBeNull();
  });

  test("가볍게에서는 착석 확인과 점심 등록을 하지 않는다", () => {
    const office = workingOffice("light");
    expect(() => office.observePresence("absent")).toThrow(OfficeError);
    expect(office.canRequestLunch).toBe(false);
  });
});

describe("오늘만 한 단계 낮추기", () => {
  test("추가근무 중에 낮추면 추가근무 없이 공유·마감으로 가고, 다음 날 원래 강도로 돌아온다", () => {
    const office = standardWorking();
    office.advance(at(monday, 18 * 60));
    office.submitCheckout();
    office.advance(at(monday, 19 * 60 + 10));
    office.lowerToday();
    expect(office.level).toBe("light");
    expect(office.day.phase).toBe("working");
    expect(office.day.overtime).toBe("lowered");
    expect(office.canLowerToday).toBe(false);
    office.endSharing();
    office.confirmReview(emptyReview(), Object.fromEntries(office.unsubmittedTasks.map((t) => [t.id, "carryOver" as const])));
    office.startNextWorkday();
    expect(office.level).toBe("standard");
    expect(office.history[0].level).toBe("light");
  });

  test("출근 전에 낮추면 늦어도 지각이 아니다. 엄격은 보통으로 내려가 지각은 남는다", () => {
    const light = makeOffice(8 * 60 + 55, monday, "standard");
    light.lowerToday();
    light.advance(at(monday, 10 * 60));
    expect(light.checkIn().late).toBe(false);

    const strict = makeOffice(8 * 60 + 55, monday, "strict");
    strict.lowerToday();
    expect(strict.level).toBe("standard");
    strict.advance(at(monday, 10 * 60));
    expect(strict.checkIn().late).toBe(true);
  });

  test("결근 후보가 된 뒤에는 낮춰서 지울 수 없다", () => {
    const office = makeOffice(8 * 60 + 55, monday, "standard");
    office.advance(at(monday, 18 * 60));
    expect(office.canLowerToday).toBe(false);
  });
});

describe("저장 형식", () => {
  test("관리 강도가 생기기 전에 저장한 상태는 지우지 않고 기본값을 채운다", () => {
    const office = workingOffice("light");
    const old = JSON.parse(JSON.stringify(office.toJSON()));
    delete old.profile.enforcement;
    delete old.daysOff;
    for (const key of ["level", "isLate", "presence", "allowances", "awaySpans", "checkoutAt", "overtimeTaskIds"]) delete old.day[key];
    for (const t of old.day.tasks) delete t.level;
    const restored = Office.fromJSON(old);
    expect(restored.profile.enforcement).toBe("standard");
    // 이미 시작한 하루는 지각·추가근무를 거슬러 적용하지 않는다.
    expect(restored.level).toBe("light");
    expect(restored.day.tasks.map((t) => t.level)).toEqual([1, 1]);
    restored.advance(at(monday, 18 * 60));
    expect(restored.day.phase).toBe("working");
    expect(restored.daysOff).toEqual([]);
  });

  test("되살린 뒤에도 강도·근태 기록이 그대로다", () => {
    const office = standardWorking();
    office.advance(at(addDays(monday, 0), 12 * 60));
    office.requestLunch();
    const restored = Office.fromJSON(office.toJSON());
    expect(restored.activeAllowance?.kind).toBe("lunch");
    expect(restored.level).toBe("standard");
  });
});
