/** 내 자리의 지금 상태. 내 책상 화면과 3D 사무실의 내 캐릭터가 이 값을 따른다. */
import { overtimeEndOf, overtimeStartOf } from "./models";
import type { Office } from "./office";
import { type Instant, Clock, hm, minutesBetween } from "./time";

export type SeatStatus =
  | { kind: "beforeCheckIn" }
  | { kind: "absentCandidate" }
  | { kind: "seated" }
  | { kind: "checking" }
  | { kind: "emptyBeforeWork" }
  | { kind: "lunch"; until: Instant }
  | { kind: "away"; until: Instant; reason: string }
  | { kind: "dinner"; until: Instant }
  | { kind: "unauthorizedAway"; since: Instant }
  | { kind: "cameraOff" }
  | { kind: "review" }
  | { kind: "off" };

const TITLES: Record<SeatStatus["kind"], string> = {
  beforeCheckIn: "출근 전",
  absentCandidate: "결근 후보",
  seated: "착석",
  checking: "자리 확인 중",
  emptyBeforeWork: "자리 비어 있음",
  lunch: "점심",
  away: "자리 비움 (등록됨)",
  dinner: "저녁시간",
  unauthorizedAway: "근무 중 자리 비움",
  cameraOff: "카메라 꺼짐",
  review: "점검 중",
  off: "퇴근",
};

export const seatTitle = (s: SeatStatus) => TITLES[s.kind];

const minutesLeft = (until: Instant, now: Instant) => Math.max(0, Math.ceil((until - now) / 60000));

/** 한두 줄 설명. 의미 단위로 줄을 나눈다. */
export function seatDetail(s: SeatStatus, now: Instant): string {
  switch (s.kind) {
    case "beforeCheckIn":
      return "카메라 앞에 앉아\n출근 버튼을 눌러 주세요.";
    case "absentCandidate":
      return "오늘은 출근 기록이 없습니다.\n다음 근무일에 출근해 주세요.";
    case "seated":
      return "카메라에 사람이 보입니다.";
    case "checking":
      return "카메라로 자리를 확인하고 있습니다.";
    case "emptyBeforeWork":
      return "근무 시작 전이라 기록하지 않습니다.";
    case "lunch":
      return `${hm(s.until)}까지 착석 확인을 쉽니다.\n남은 시간 ${Clock.duration(minutesLeft(s.until, now))}`;
    case "away":
      return `사유: ${s.reason}\n${hm(s.until)}까지 착석 확인을 쉽니다. 남은 시간 ${Clock.duration(minutesLeft(s.until, now))}`;
    case "dinner":
      return `${hm(s.until)}에 추가근무를 시작합니다.`;
    case "unauthorizedAway":
      return `${hm(s.since)}부터 자리가 비어 있습니다.\n기록 중 · ${Clock.duration(Math.max(0, minutesBetween(s.since, now)))}`;
    case "cameraOff":
      return "자리 비움으로 세지 않습니다.\n확인한 뒤 근태를 확정합니다.";
    case "review":
      return "결과물과 미완료 업무를 확인해 주세요.";
    case "off":
      return "오늘 근무를 마쳤습니다.";
  }
}

/** 주의가 필요한 상태인지. */
export const seatIsWarning = (s: SeatStatus) => s.kind === "unauthorizedAway" || s.kind === "cameraOff" || s.kind === "absentCandidate";

/** 내 캐릭터가 책상에 앉아 일하는 모습으로 보여야 하는지. */
export const seatShowsWorkingAvatar = (s: SeatStatus) => s.kind === "seated" || s.kind === "checking" || s.kind === "review";

export function seatStatusOf(office: Office): SeatStatus {
  switch (office.day.phase) {
    case "beforeCheckIn":
      return office.day.absentCandidate ? { kind: "absentCandidate" } : { kind: "beforeCheckIn" };
    case "off":
      return { kind: "off" };
    case "checkoutReview":
    case "overtimeReview":
      return { kind: "review" };
  }
  const allowance = office.activeAllowance;
  if (allowance) {
    if (allowance.kind === "lunch") return { kind: "lunch", until: allowance.end };
    if (allowance.kind === "away") return { kind: "away", until: allowance.end, reason: allowance.reason };
    return { kind: "dinner", until: allowance.end };
  }
  switch (office.presence) {
    case "present":
      return { kind: "seated" };
    case "absent":
      return office.isMonitoring
        ? { kind: "unauthorizedAway", since: office.openSpan("unauthorized")?.start ?? office.now }
        : { kind: "emptyBeforeWork" };
    case "cameraOff":
      return { kind: "cameraOff" };
    case "unknown":
      return { kind: "checking" };
  }
}

/** 화면 위쪽에 보여 줄 지금 단계 한 줄. */
export function phaseHeadline(office: Office): string {
  const p = office.profile;
  switch (office.day.phase) {
    case "beforeCheckIn":
      return office.day.absentCandidate ? "결근 후보 · 다음 근무일에 출근" : `출근 전 · ${Clock.hm(p.workStart)}까지 출근`;
    case "morningPT":
      return "아침 PT · 회의실에서 오늘 업무 확정";
    case "working":
      return `근무 중 · ${Clock.hm(p.workEnd)} 퇴근 점검`;
    case "checkoutReview":
      return "퇴근 점검 · 결과물과 미완료 업무 확인";
    case "dinner":
      return `저녁시간 · ${Clock.hm(overtimeStartOf(p))} 추가근무 시작`;
    case "overtime":
      return `추가근무 · ${Clock.hm(overtimeEndOf(p))}까지, 3단계부터`;
    case "overtimeReview":
      return "추가근무 종료 · 결과물 올리기";
    case "off":
      return "퇴근 · 오늘 근무를 마쳤습니다";
  }
}
