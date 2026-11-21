/**
 * 내 자리의 지금 상태와 위 막대 한 줄 안내. 3D 사무실의 내 캐릭터가 이 값을 따른다.
 * 가볍게에서는 단계만 보고 정하고, 보통·엄격에서는 착석 확인·점심·자리 비움·저녁시간을 반영한다.
 */
import { ENFORCEMENT } from "./rules";
import type { Office } from "./office";
import { type Instant, Clock, hm, minutesBetween } from "./time";

export type SeatStatus =
  | { kind: "beforeCheckIn" }
  | { kind: "absentCandidate" }
  /** 아침보고·수행 중(자리에 있음) */
  | { kind: "seated" }
  /** 자리 상태를 아직 모름 */
  | { kind: "checking" }
  | { kind: "lunch"; until: Instant }
  | { kind: "away"; until: Instant; reason: string }
  | { kind: "dinner"; until: Instant }
  | { kind: "unauthorizedAway"; since: Instant }
  | { kind: "cameraOff" }
  /** 회의실 발표 중(기획팀·디자인팀 담당자가 듣는다) */
  | { kind: "sharing" }
  /** 퇴근 점검·추가근무 점검·하루 마감 작성 중 */
  | { kind: "review" }
  | { kind: "off" };

const TITLES: Record<SeatStatus["kind"], string> = {
  beforeCheckIn: "출근 전",
  absentCandidate: "결근 후보",
  seated: "활동 중",
  checking: "자리 확인 중",
  lunch: "점심",
  away: "자리 비움 (등록됨)",
  dinner: "저녁시간",
  unauthorizedAway: "자리 비움",
  cameraOff: "카메라 꺼짐",
  sharing: "회의실 발표 중",
  review: "점검 중",
  off: "마감 완료",
};

export const seatTitle = (s: SeatStatus) => TITLES[s.kind];

const minutesLeft = (until: Instant, now: Instant) => Math.max(0, Math.ceil((until - now) / 60000));

export function seatStatusOf(office: Office): SeatStatus {
  const phase = office.day.phase;
  switch (phase) {
    case "beforeCheckIn":
      return office.day.absentCandidate ? { kind: "absentCandidate" } : { kind: "beforeCheckIn" };
    case "sharing":
      return { kind: "sharing" };
    case "checkout":
    case "overtimeReview":
    case "checkoutReview":
      return { kind: "review" };
    case "off":
      return { kind: "off" };
    case "morningPT":
      return { kind: "seated" };
  }
  const allowance = office.activeAllowance;
  if (allowance) {
    if (allowance.kind === "lunch") return { kind: "lunch", until: allowance.end };
    if (allowance.kind === "away") return { kind: "away", until: allowance.end, reason: allowance.reason };
    return { kind: "dinner", until: allowance.end };
  }
  if (!office.rules.seatCheck) return { kind: "seated" };
  switch (office.day.presence) {
    case "present":
      return { kind: "seated" };
    case "absent":
      return { kind: "unauthorizedAway", since: office.openSpan("unauthorized")?.start ?? office.now };
    case "cameraOff":
      return { kind: "cameraOff" };
    case "unknown":
      return { kind: "checking" };
  }
}

export function seatDetail(s: SeatStatus, now: Instant): string {
  switch (s.kind) {
    case "beforeCheckIn":
      return "출근 버튼을 누르면 오늘 활동을 시작합니다.";
    case "absentCandidate":
      return "오늘은 출근 기록이 없습니다.\n다음 활동일에 돌아오면 그날은 지각으로 세지 않습니다.";
    case "seated":
      return "확정한 과제를 수행하고 결과물을 제출합니다.";
    case "checking":
      return "자리에 있는지 알려 주세요.";
    case "lunch":
      return `${hm(s.until)}까지 착석 확인을 쉽니다.\n남은 시간 ${Clock.duration(minutesLeft(s.until, now))}`;
    case "away":
      return `사유: ${s.reason}\n${hm(s.until)}까지 착석 확인을 쉽니다. 남은 시간 ${Clock.duration(minutesLeft(s.until, now))}`;
    case "dinner":
      return `${hm(s.until)}에 추가근무를 시작합니다.`;
    case "unauthorizedAway":
      return `${hm(s.since)}부터 자리가 비어 있습니다 · ${Clock.duration(Math.max(0, minutesBetween(s.since, now)))}`;
    case "cameraOff":
      return "카메라가 꺼진 시간은 자리 비움으로 세지 않습니다.";
    case "sharing":
      return "회의실에서 기획팀·디자인팀 담당자에게 오늘 한 일을 발표하고 있습니다.";
    case "review":
      return "남은 과제와 오늘 한 일을 확인하고 있습니다.";
    case "off":
      return "오늘 활동을 마감했습니다.";
  }
}

/** 주의가 필요한 상태인지. 보통의 자리 비움은 15분이 넘었을 때만. */
export function seatIsWarning(s: SeatStatus, office: Office): boolean {
  if (s.kind === "unauthorizedAway") return office.awayWarning;
  return s.kind === "cameraOff" || s.kind === "absentCandidate";
}

/** 내 캐릭터가 책상에 앉아 일하는 모습으로 보여야 하는지. */
export const seatShowsWorkingAvatar = (s: SeatStatus) => s.kind === "seated" || s.kind === "checking" || s.kind === "review";

/** 위 막대 한 줄. */
export function phaseHeadline(office: Office): string {
  const end = Clock.hm(office.profile.activityEnd);
  const start = Clock.hm(office.profile.activityStart);
  const strictTime = ENFORCEMENT[office.level].attendance;
  const late = office.pastActivityEnd;
  switch (office.day.phase) {
    case "beforeCheckIn":
      if (office.day.absentCandidate) return "결근 후보 · 다음 활동일에 다시 오면 됩니다";
      if (office.day.dayOff) return "오늘은 쉬는 날 · 다음 활동일로 넘어가세요";
      return strictTime ? `출근 전 · ${start}까지 출근` : `출근 전 · 활동 시작 ${start}`;
    case "morningPT":
      return "아침보고 · 오늘 끝낼 범위 정하기";
    case "working":
      if (office.day.checkoutAt != null) return "퇴근 점검 완료 · 회의실 발표와 하루 마감";
      if (office.rules.checkoutAndOvertime) return `수행 중 · ${end} 퇴근 점검`;
      return late ? `수행 중 · 마감 시각 ${end}이 지났습니다` : `수행 중 · 마감 ${end}`;
    case "checkout":
      return `퇴근 점검 · ${end} 남은 과제 확인`;
    case "dinner":
      return `저녁시간 · ${hm(office.dinnerEndDate)} 추가근무 시작`;
    case "overtime":
      return `추가근무 · ${hm(office.overtimeEndDate)}까지, 3단계부터`;
    case "overtimeReview":
      return "추가근무 점검 · 남은 과제 확인";
    case "sharing":
      return "회의실 발표 · 오늘 한 일 발표하기";
    case "checkoutReview":
      return "하루 마감 · 해낸 일과 다음 행동 확인";
    case "off":
      return "마감 완료 · 수고하셨습니다";
  }
}
