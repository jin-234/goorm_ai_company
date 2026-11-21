import { describe, expect, test } from "vitest";
import { newDraft, newWeeklyReport } from "./models";
import { Office } from "./office";
import { Organization, Rank } from "./organization";
import { monthStats, OfficeError } from "./rules";
import { seatStatusOf } from "./seat-status";
import { friday, makeOffice, monday, officeAtCheckout, task, workingOffice } from "./test-helpers";
import { at, hm, makeDay, weekdayName } from "./time";
import { firstLine, localWeeklyReply } from "../solar/weekly-fallback";

describe("18:00 퇴근 점검", () => {
  test("모두 끝냈으면 정시 퇴근", () => {
    const office = officeAtCheckout([3, 2, 1]);
    expect(office.carryReportTargets).toHaveLength(0);
    expect(office.overtimeTargets).toHaveLength(0);
    expect(office.submitCheckout()).toEqual({ kind: "offAllDone" });
    expect(office.day.phase).toBe("off");
    expect(hm(office.day.checkoutAt!)).toBe("18:00");
    expect(office.pendingCarry).toHaveLength(0);
    expect(office.inbox.some((m) => m.subject === "[근태] 퇴근 확인 18:00")).toBe(true);
    expect(seatStatusOf(office)).toEqual({ kind: "off" });
  });

  test("1단계만 남으면 이월 보고 후 정시 퇴근", () => {
    const office = officeAtCheckout([3, 2]);
    const target = office.carryReportTargets[0];
    expect(target.title).toBe("관심 기업 세 곳 저장");
    expect(office.overtimeTargets).toHaveLength(0);

    expect(() => office.submitCheckout()).toThrow(
      expect.objectContaining({ code: "carryReportMissing", details: ["관심 기업 세 곳 저장"] }),
    );
    expect(() => office.submitCheckout({ [target.id]: { reason: "시간 부족", plan: " " } })).toThrow(OfficeError);
    expect(office.day.phase).toBe("checkoutReview");

    const report = { reason: "공고를 읽는 데 시간이 더 걸렸습니다", plan: "오전 10시까지 세 곳을 저장하겠습니다" };
    expect(office.submitCheckout({ [target.id]: report })).toEqual({ kind: "offWithCarry", count: 1 });
    expect(office.day.phase).toBe("off");

    const sent = office.sent.find((m) => m.kind === "carryReport")!;
    expect(sent.body).toContain(report.reason);
    expect(sent.body).toContain(report.plan);
    expect(office.inbox.some((m) => m.kind === "carryAccepted")).toBe(true);

    expect(task(office, 1).status).toBe("carried");
    expect(office.pendingCarry).toHaveLength(1);
    expect(office.pendingCarry[0].carriedFrom).toEqual(monday);
    expect(office.pendingCarry[0].carryCount).toBe(1);
    expect(office.pendingCarry[0].status).toBe("open");
  });

  test("2단계가 남으면 저녁시간과 추가근무", () => {
    const office = officeAtCheckout([3, 1]);
    expect(office.overtimeTargets.map((t) => t.title)).toEqual(["포트폴리오 한 문단 초안"]);
    expect(office.submitCheckout()).toEqual({ kind: "overtimeAssigned", count: 1, carried: 0 });
    expect(office.day.phase).toBe("dinner");
    const dinner = office.activeAllowance!;
    expect(dinner.kind).toBe("dinner");
    expect([hm(dinner.start), hm(dinner.end)]).toEqual(["18:00", "19:00"]);
    expect(seatStatusOf(office)).toEqual({ kind: "dinner", until: dinner.end });
    expect(office.isMonitoring).toBe(false);
    const mail = office.inbox.find((m) => m.kind === "overtimeAssigned")!;
    expect(mail.subject).toBe("[근태] 추가근무 배정 19:00~22:00");
    expect(mail.body).toContain("3단계 업무부터 진행합니다");

    office.observe("absent");
    expect(office.day.awaySpans).toHaveLength(0);

    office.observe("present");
    expect(hm(office.skipHour()!.to)).toBe("19:00");
    expect(office.day.phase).toBe("overtime");
    expect(office.activeAllowance).toBeNull();
    expect(office.isMonitoring).toBe(true);
  });

  test("2·3단계가 함께 남아도 추가근무는 한 구간이고 3단계가 먼저", () => {
    const office = officeAtCheckout([]);
    const carryTarget = office.carryReportTargets[0];
    expect(office.overtimeTargets.map((t) => t.level)).toEqual([3, 2]);
    expect(() => office.submitCheckout()).toThrow(OfficeError);
    const outcome = office.submitCheckout({
      [carryTarget.id]: { reason: "2·3단계에 시간을 썼습니다", plan: "내일 오전에 저장하겠습니다" },
    });
    expect(outcome).toEqual({ kind: "overtimeAssigned", count: 2, carried: 1 });
    expect(office.day.allowances.filter((a) => a.kind === "dinner")).toHaveLength(1);
    expect(office.overtimeTasks.map((t) => t.title)).toEqual(["지원서 최종 검토", "포트폴리오 한 문단 초안"]);
    expect(office.pendingCarry.map((t) => t.title)).toEqual(["관심 기업 세 곳 저장"]);
    expect(office.inbox.filter((m) => m.kind === "overtimeAssigned")).toHaveLength(1);
  });

  test("점검을 늦게 제출하면 바로 추가근무로 이어진다", () => {
    const office = officeAtCheckout([1]);
    office.advance(at(monday, 19 * 60 + 20));
    expect(office.day.phase).toBe("checkoutReview");
    office.submitCheckout();
    expect(office.day.phase).toBe("overtime");
    expect(office.day.events.some((e) => e.kind === "overtimeStart" && hm(e.at) === "19:00")).toBe(true);
  });

  test("퇴근 시각에 열려 있던 허용과 자리 비움은 닫는다", () => {
    const office = workingOffice();
    office.advance(at(monday, 17 * 60 + 40));
    office.observe("absent");
    office.advance(at(monday, 17 * 60 + 50));
    office.registerAway("전화");
    office.advance(at(monday, 18 * 60 + 2));
    expect(office.day.phase).toBe("checkoutReview");
    expect(office.activeAllowance).toBeNull();
    expect(hm(office.day.allowances[0].endedAt!)).toBe("18:00");
    expect(office.day.awaySpans.every((s) => s.end != null)).toBe(true);
    expect(office.unauthorizedAwayMinutes).toBe(10);
  });

  test("점검 중에도 결과물을 올리고 완료할 수 있다", () => {
    const office = officeAtCheckout([3, 1]);
    const remaining = task(office, 2);
    office.setDeliverable(remaining.id, "portfolio.md 3문단");
    office.setTask(remaining.id, true);
    expect(office.submitCheckout()).toEqual({ kind: "offAllDone" });
    expect(task(office, 2).deliverable).toBe("portfolio.md 3문단");
    office.setTask(remaining.id, false);
    expect(task(office, 2).status).toBe("done");
  });
});

describe("19:00~22:00 추가근무", () => {
  function officeInOvertime(): Office {
    const office = officeAtCheckout([1]);
    office.submitCheckout();
    office.skipHour();
    expect(office.day.phase).toBe("overtime");
    return office;
  }

  test("종료 시각까지 못 끝낸 업무는 다음 근무일로 이월", () => {
    const office = officeInOvertime();
    office.setTask(task(office, 3).id, true);
    const times: string[] = [];
    while (office.canSkipHour) {
      office.skipHour();
      times.push(hm(office.now));
    }
    expect(times).toEqual(["20:00", "21:00", "22:00"]);
    expect(office.day.phase).toBe("overtimeReview");

    expect(office.submitOvertimeReview()).toBe("ranToEnd");
    expect(office.day.phase).toBe("off");
    expect(office.day.overtime).toBe("ranToEnd");
    expect(task(office, 2).status).toBe("carried");
    expect(office.pendingCarry.map((t) => t.title)).toEqual(["포트폴리오 한 문단 초안"]);
    expect(office.inbox.some((m) => m.subject.includes("추가근무 종료 및 이월 1건"))).toBe(true);
  });

  test("종료 점검에서 결과물을 올리면 완료로 친다", () => {
    const office = officeInOvertime();
    while (office.canSkipHour) office.skipHour();
    for (const item of office.overtimeTasks) {
      office.setDeliverable(item.id, "완료본");
      office.setTask(item.id, true);
    }
    expect(office.submitOvertimeReview()).toBe("completed");
    expect(office.pendingCarry).toHaveLength(0);
  });

  test("모두 끝내고 일찍 마치면 정상 종료", () => {
    const office = officeInOvertime();
    office.advance(at(monday, 20 * 60 + 15));
    for (const item of office.overtimeTasks) office.setTask(item.id, true);
    expect(office.endOvertimeEarly()).toBe("completed");
    expect(office.day.phase).toBe("off");
    expect(hm(office.day.checkoutAt!)).toBe("20:15");
    expect(office.day.events.some((e) => e.kind === "supplementMissed")).toBe(false);
    expect(office.inbox.some((m) => m.subject === "[근태] 추가근무 종료 확인 20:15")).toBe(true);
  });

  test("남은 업무를 두고 먼저 종료하면 보충근무 미이행", () => {
    const office = officeInOvertime();
    office.advance(at(monday, 20 * 60 + 30));
    expect(office.endOvertimeEarly()).toBe("abandoned");
    expect(office.day.overtime).toBe("abandoned");
    expect(office.day.events.some((e) => e.kind === "supplementMissed")).toBe(true);
    expect(office.pendingCarry.map((t) => t.level)).toEqual([3, 2]);
    expect(office.inbox.some((m) => m.kind === "supplementMissed" && m.body.includes("보충근무 미이행으로 기록합니다"))).toBe(true);
  });

  test("저녁시간에 추가근무 없이 가도 보충근무 미이행", () => {
    const office = officeAtCheckout([1]);
    office.submitCheckout();
    expect(office.day.phase).toBe("dinner");
    expect(office.endOvertimeEarly()).toBe("abandoned");
    expect(office.day.phase).toBe("off");
  });

  test("추가근무 중에도 자리 비움을 확인한다", () => {
    const office = officeInOvertime();
    office.observe("absent");
    office.advance(at(monday, 19 * 60 + 9));
    expect(office.unauthorizedAwayMinutes).toBe(9);
    expect(hm(office.registerAway("물 가지러 자리 비웁니다").end)).toBe("19:24");
    expect(() => office.requestLunch()).toThrow(OfficeError);
  });
});

describe("이월과 다음 근무일", () => {
  test("이월된 업무가 다음 근무일 목록에 들어간다", () => {
    const office = officeAtCheckout([3, 2]);
    const target = office.carryReportTargets[0];
    office.submitCheckout({ [target.id]: { reason: "시간 부족", plan: "오전에 끝냄" } });
    expect(office.canStartNextWorkday).toBe(true);
    office.startNextWorkday();

    expect(office.today).toEqual(makeDay(2026, 11, 17));
    expect(hm(office.now)).toBe("08:55");
    expect(office.day.phase).toBe("beforeCheckIn");
    expect(office.pendingCarry).toHaveLength(0);
    expect(office.day.drafts).toHaveLength(1);
    expect(office.day.drafts[0].title).toBe("관심 기업 세 곳 저장");
    expect(office.day.drafts[0].carriedFrom).toEqual(monday);

    const record = office.history.at(-1)!;
    expect(record.date).toEqual(monday);
    expect(record.attendance).toBe("onTime");
    expect(record.tasks.filter((t) => t.status === "done")).toHaveLength(2);
    expect(record.tasks.filter((t) => t.status === "carried")).toHaveLength(1);

    const notice = office.inbox.find((m) => m.kind === "notice" && m.subject.includes("11월 17일(화)"))!;
    expect(notice.body).toContain("이월된 업무 1건");

    office.checkIn();
    office.replaceDrafts([newDraft({ title: "자기소개서 첫 문단", level: 2, due: 14 * 60, doneCriteria: "초안 저장" })], "manual");
    office.confirmTasks();
    expect(office.day.tasks).toHaveLength(2);
    expect(office.day.tasks.some((t) => t.carriedFrom?.day === 16 && t.carryCount === 1)).toBe(true);
  });

  test("두 번 이월하면 처음 날짜와 횟수를 유지한다", () => {
    const office = officeAtCheckout([3, 2]);
    let target = office.carryReportTargets[0];
    office.submitCheckout({ [target.id]: { reason: "시간 부족", plan: "내일" } });
    office.startNextWorkday();
    office.checkIn();
    office.confirmTasks();
    while (office.canSkipHour) office.skipHour();
    target = office.carryReportTargets[0];
    office.submitCheckout({ [target.id]: { reason: "또 밀림", plan: "모레" } });
    expect(office.pendingCarry[0].carriedFrom).toEqual(monday);
    expect(office.pendingCarry[0].carryCount).toBe(2);
  });

  test("결근한 날의 이월 업무도 사라지지 않는다", () => {
    const office = officeAtCheckout([3, 2]);
    const target = office.carryReportTargets[0];
    office.submitCheckout({ [target.id]: { reason: "시간 부족", plan: "내일" } });
    office.startNextWorkday();
    while (office.canSkipHour) office.skipHour();
    expect(office.day.absentCandidate).toBe(true);
    office.startNextWorkday();
    expect(office.today).toEqual(makeDay(2026, 11, 18));
    expect(office.day.drafts.map((d) => d.title)).toEqual(["관심 기업 세 곳 저장"]);
    expect(office.history.map((r) => r.attendance)).toEqual(["onTime", "absentCandidate"]);
  });

  test("근무 중에는 다음 근무일로 넘어갈 수 없다", () => {
    const office = workingOffice();
    expect(office.canStartNextWorkday).toBe(false);
    office.startNextWorkday();
    expect(office.today).toEqual(monday);
  });

  test("금요일 다음 근무일은 월요일", () => {
    const office = makeOffice(8 * 60 + 55, friday);
    office.checkIn();
    while (office.canSkipHour) office.skipHour();
    office.submitCheckout();
    office.startNextWorkday();
    expect(office.today).toEqual(makeDay(2026, 11, 23));
    expect(weekdayName(office.today)).toBe("월");
  });
});

describe("금요일 주간보고", () => {
  const report = {
    completed: "지원서 최종 검토를 끝내고 제출본을 저장했습니다.",
    incomplete: "관심 기업 저장은 두 곳만 했습니다. 공고 읽는 데 시간이 걸렸습니다.",
    nextGoals: "포트폴리오 프로젝트 설명 두 개 쓰기",
  };

  test("금요일에만 제출한다", () => {
    const office = workingOffice();
    expect(office.canSubmitWeekly).toBe(false);
    expect(() => office.submitWeeklyReport(report)).toThrow(expect.objectContaining({ code: "weeklyNotFriday" }));
  });

  test("출근하고 세 칸을 모두 써야 제출된다", () => {
    const office = makeOffice(8 * 60 + 55, friday);
    expect(office.canSubmitWeekly).toBe(false);
    expect(() => office.submitWeeklyReport(report)).toThrow(OfficeError);
    office.checkIn();
    expect(office.canSubmitWeekly).toBe(true);

    expect(() => office.submitWeeklyReport({ ...report, nextGoals: "  " })).toThrow(
      expect.objectContaining({ code: "weeklyIncomplete", details: ["다음 주 목표"] }),
    );

    const submitted = office.submitWeeklyReport(report);
    expect(hm(submitted.submittedAt!)).toBe("08:55");
    expect(office.day.weeklySubmitted).toBe(true);
    const mail = office.sent.find((m) => m.kind === "weeklyReport")!;
    expect(mail.subject).toBe("[주간보고] 11월 3주차 · 김서울");
    for (const heading of ["1. 이번 주 완료한 업무와 결과물", "2. 미완료 업무와 이유", "3. 다음 주 목표"]) {
      expect(mail.body).toContain(heading);
    }
    expect(() => office.submitWeeklyReport(report)).toThrow(expect.objectContaining({ code: "weeklyAlreadySubmitted" }));
  });

  test("상사 답장은 따뜻한 메일로 한 번만 들어온다", () => {
    const office = makeOffice(8 * 60 + 55, friday);
    office.checkIn();
    const submitted = office.submitWeeklyReport(report);
    expect(office.weeklyAwaitingReply?.id).toBe(submitted.id);

    const reply = localWeeklyReply(submitted, "김서울");
    expect(reply.achievement).toBe("지원서 최종 검토를 끝내고 제출본을 저장했습니다");
    expect(reply.body).toContain("포트폴리오 프로젝트 설명 두 개 쓰기");
    expect(reply.body.endsWith("한정민 드림")).toBe(true);

    office.receiveWeeklyFeedback(submitted.id, reply.subject, reply.body, "localTemplate");
    office.receiveWeeklyFeedback(submitted.id, reply.subject, reply.body, "solar");
    const feedback = office.inbox.filter((m) => m.kind === "weeklyFeedback");
    expect(feedback).toHaveLength(1);
    expect(feedback[0].isWarm).toBe(true);
    expect(feedback[0].replySource).toBe("localTemplate");
    expect(office.weeklyAwaitingReply).toBeNull();
    expect(office.mails.filter((m) => m.kind !== "weeklyFeedback").every((m) => !m.isWarm)).toBe(true);
  });

  test("금요일 장면으로 바로 가면 남은 업무를 이월한다", () => {
    const office = workingOffice();
    office.advance(at(monday, 11 * 60));
    office.setTask(task(office, 3).id, true);
    expect(office.canJumpToFriday).toBe(true);
    office.jumpToFriday();
    expect(office.today).toEqual(friday);
    expect(hm(office.now)).toBe("08:55");
    expect(office.day.phase).toBe("beforeCheckIn");
    expect(office.day.drafts).toHaveLength(2);
    expect(office.history.map((r) => r.date)).toEqual([monday]);
    expect(office.monthStats).toEqual(monthStats());
    expect(office.canJumpToFriday).toBe(false);
    const notice = office.inbox.find((m) => m.kind === "notice" && m.subject.includes("11월 20일(금)"))!;
    expect(notice.body).toContain("주간보고서");
  });

  test("글머리 기호를 떼고 첫 줄을 읽는다", () => {
    expect(firstLine("- 지원서 제출.\n- 포트폴리오")).toBe("지원서 제출");
    expect(firstLine("\n\n1. 자격증 접수\n2. 기출 풀이")).toBe("자격증 접수");
    expect(firstLine("   ")).toBeNull();
  });
});

describe("상태 저장", () => {
  test("JSON으로 저장했다가 다시 읽어도 같다", () => {
    const office = officeAtCheckout([3]);
    const target = office.carryReportTargets[0];
    office.submitCheckout({ [target.id]: { reason: "이유", plan: "계획" } });
    const restored = Office.fromJSON(JSON.parse(JSON.stringify(office)));
    expect(restored.toJSON()).toEqual(office.toJSON());
    expect(restored.day.phase).toBe("dinner");
    // 되살린 객체도 규칙대로 움직인다.
    expect(hm(restored.skipHour()!.to)).toBe("19:00");
    expect(restored.day.phase).toBe("overtime");
  });

  test("주간보고 초안은 제출 전까지 보존한다", () => {
    const office = makeOffice(8 * 60 + 55, friday);
    office.saveWeeklyDraft({ completed: "쓰는 중" });
    const restored = Office.fromJSON(JSON.parse(JSON.stringify(office)));
    expect(restored.weeklyDraft.completed).toBe("쓰는 중");
    expect(newWeeklyReport(friday).completed).toBe("");
  });
});

describe("조직도", () => {
  test("맨 위는 부장 한 명이다", () => {
    const heads = Organization.members.filter((m) => m.reportsTo == null);
    expect(heads).toHaveLength(1);
    expect(heads[0].rank).toBe(Rank.departmentHead);
  });

  test("모두 부장까지 이어진다", () => {
    for (const member of Organization.members) {
      let current = member;
      for (let steps = 0; current.reportsTo && steps < 10; steps++) current = Organization.member(current.reportsTo)!;
      expect(current.id, member.name).toBe("director");
    }
  });

  test("자리가 겹치지 않는다", () => {
    const seats = Organization.members.map((m) => JSON.stringify(m.seat));
    expect(new Set(seats).size).toBe(seats.length);
  });

  test("상사가 부하보다 직급이 높거나 같다", () => {
    for (const member of Organization.members) {
      const boss = member.reportsTo ? Organization.member(member.reportsTo) : null;
      if (boss) expect(boss.rank, member.name).toBeLessThanOrEqual(member.rank);
    }
  });

  test("아침 PT는 상사 넷이 듣는다", () => {
    expect(Organization.morningPTAudience().map((m) => m.rank)).toEqual([
      Rank.departmentHead,
      Rank.teamLeader,
      Rank.manager,
      Rank.assistantManager,
    ]);
  });

  test("사람은 김서울 한 명이다", () => {
    expect(Organization.members.filter((m) => m.isHuman).map((m) => m.name)).toEqual(["김서울"]);
  });
});
