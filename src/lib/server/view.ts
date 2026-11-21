/**
 * 화면에 보내는 회사 상태(officeView). 화면은 이 값만 보고 그리고 규칙을 다시 계산하지 않는다.
 * 모양은 78(2D 패널)과 맞춘 계약이다. 이름을 바꾸려면 먼저 78·f4·e2에 알린다.
 */
import { mailTag, PHASE_LABEL, partyName, TASK_OUTCOME_LABEL, TASK_STATUS_LABEL } from "../office/models";
import type { Office } from "../office/office";
import { phaseHeadline, seatDetail, seatStatusOf, seatTitle } from "../office/seat-status";
import { dayString, hm, isFriday, koreanLong, koreanShort, weekLabel } from "../office/time";

export function officeView(office: Office) {
  const seat = seatStatusOf(office);
  const name = office.profile.name;
  const day = office.day;
  const mailView = (m: Office["mails"][number]) => ({ ...m, tag: mailTag(m.kind), fromName: partyName(m.from, name), toName: partyName(m.to, name) });
  const taskView = (t: Office["day"]["tasks"][number]) => ({
    ...t,
    statusLabel: TASK_STATUS_LABEL[t.status],
    outcomeLabel: t.outcome ? TASK_OUTCOME_LABEL[t.outcome] : null,
    submissionCount: day.submissions.filter((s) => s.taskId === t.id).length,
  });
  return {
    onboarded: office.onboarded,
    profile: office.profile,
    clock: {
      now: office.now,
      hm: hm(office.now),
      date: dayString(office.today),
      dateShort: koreanShort(office.today),
      dateLong: koreanLong(office.today),
      weekLabel: weekLabel(office.today),
      isFriday: isFriday(office.today),
    },
    phase: { value: day.phase, label: PHASE_LABEL[day.phase], headline: phaseHeadline(office) },
    pastActivityEnd: office.pastActivityEnd,
    day: {
      date: dayString(day.date),
      checkInAt: day.checkInAt,
      checkInMethod: day.checkInMethod ?? null,
      goal: day.goal,
      tasks: day.tasks.map(taskView),
      submissions: day.submissions,
      share: day.share,
      review: day.review,
      /** 마감 때 처리를 골라야 하는 과제 ID(제출하지 않은 과제). */
      unsubmittedTaskIds: office.unsubmittedTasks.map((t) => t.id),
      events: day.events,
    },
    pendingCarry: office.pendingCarry.map(taskView),
    can: {
      checkIn: office.canCheckIn,
      confirmTasks: office.canConfirmTasks,
      editTasks: office.canEditTasks,
      startSharing: office.canStartSharing,
      endSharing: day.phase === "sharing" || office.canStartSharing,
      confirmReview: day.phase === "checkoutReview",
      startNextWorkday: office.canStartNextWorkday,
      skipHour: office.canSkipHour,
    },
    mail: {
      unreadCount: office.unreadCount,
      inbox: office.inbox.map(mailView),
      sent: office.sent.map(mailView),
    },
    history: office.history.map((r) => ({ date: dayString(r.date), dateShort: koreanShort(r.date), tasks: r.tasks, review: r.review, counted: r.counted })),
    /** 3D 사무실(e2) 호환: 내 캐릭터 위치. 카메라 판정이 없어 단계만 반영한다. */
    seat: { ...seat, title: seatTitle(seat), detail: seatDetail(seat), isWarning: false, showsWorkingAvatar: seat.kind === "seated" },
    /** 3D 사무실(e2) 호환: 예전처럼 view.state.now를 읽는 코드용. 새 코드는 clock.now를 쓴다. */
    state: { now: office.now },
  };
}

export type OfficeView = ReturnType<typeof officeView>;
