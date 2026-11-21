/**
 * 화면에 보내는 회사 상태. 저장 상태(state)에 화면이 바로 쓸 수 있는 계산 값을 붙인다.
 * 화면은 이 값만 보고 그리면 되고, 규칙을 다시 계산하지 않는다.
 */
import { DRAFT_SOURCE_LABEL, mailTag, missingFields, PHASE_LABEL, partyName } from "../office/models";
import type { Office } from "../office/office";
import { phaseHeadline, seatDetail, seatIsWarning, seatShowsWorkingAvatar, seatStatusOf, seatTitle } from "../office/seat-status";
import { dayString, hm, isFriday, koreanLong, koreanShort, weekLabel } from "../office/time";

export function officeView(office: Office) {
  const seat = seatStatusOf(office);
  const blocker = office.day.phase === "morningPT" ? office.confirmBlocker : null;
  const name = office.profile.name;
  return {
    state: office.toJSON(),
    clock: {
      now: office.now,
      hm: hm(office.now),
      date: dayString(office.today),
      dateShort: koreanShort(office.today),
      dateLong: koreanLong(office.today),
      weekLabel: weekLabel(office.today),
      isFriday: isFriday(office.today),
    },
    phase: { value: office.day.phase, label: PHASE_LABEL[office.day.phase], headline: phaseHeadline(office) },
    seat: {
      ...seat,
      title: seatTitle(seat),
      detail: seatDetail(seat, office.now),
      isWarning: seatIsWarning(seat),
      showsWorkingAvatar: seatShowsWorkingAvatar(seat),
    },
    monthStats: office.monthStats,
    can: {
      checkIn: office.canCheckIn,
      confirmTasks: blocker == null && office.day.phase === "morningPT",
      editTasks: office.canEditTasks,
      requestLunch: office.canRequestLunch,
      registerAway: office.canRegisterAway,
      skipHour: office.canSkipHour,
      submitWeekly: office.canSubmitWeekly,
      startNextWorkday: office.canStartNextWorkday,
      jumpToFriday: office.canJumpToFriday,
    },
    morningPT: {
      draftSource: office.day.draftSource,
      draftSourceLabel: office.day.draftSource ? DRAFT_SOURCE_LABEL[office.day.draftSource] : null,
      drafts: office.day.drafts.map((d) => ({ ...d, isCarried: d.carriedFrom != null, missingFields: missingFields(d) })),
      blocker: blocker ? { code: blocker.code, message: blocker.message, details: blocker.details } : null,
    },
    checkout: {
      carryReportTargetIds: office.carryReportTargets.map((t) => t.id),
      overtimeTargetIds: office.overtimeTargets.map((t) => t.id),
    },
    overtimeTaskIds: office.overtimeTasks.map((t) => t.id),
    activeAllowance: office.activeAllowance,
    attendance: {
      unauthorizedAwayMinutes: office.unauthorizedAwayMinutes,
      cameraOffMinutes: office.cameraOffMinutes,
    },
    mail: {
      unreadCount: office.unreadCount,
      inbox: office.inbox.map((m) => ({ ...m, tag: mailTag(m.kind), fromName: partyName(m.from, name), toName: partyName(m.to, name) })),
      sent: office.sent.map((m) => ({ ...m, tag: mailTag(m.kind), fromName: partyName(m.from, name), toName: partyName(m.to, name) })),
    },
    weekly: {
      draft: office.weeklyDraft,
      awaitingReplyId: office.weeklyAwaitingReply?.id ?? null,
    },
  };
}

export type OfficeView = ReturnType<typeof officeView>;
