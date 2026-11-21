/**
 * 내 자리의 지금 상태와 위 막대 한 줄 안내.
 * 카메라 착석 판정을 없앴으므로 단계만 보고 정한다. 3D 사무실의 내 캐릭터가 이 값을 따른다.
 * kind 이름은 3D 쪽 호환을 위해 예전 값 가운데 일부를 그대로 쓴다.
 */
import type { Office } from "./office";
import { Clock } from "./time";

export type SeatStatus =
  | { kind: "beforeCheckIn" }
  /** 아침보고·수행 중 */
  | { kind: "seated" }
  /** 회의실 발표 중(기획팀·디자인팀·운영팀 담당자가 듣는다) */
  | { kind: "sharing" }
  /** 하루 마감 작성 중 */
  | { kind: "review" }
  | { kind: "off" };

const TITLES: Record<SeatStatus["kind"], string> = {
  beforeCheckIn: "출근 전",
  seated: "활동 중",
  sharing: "회의실 발표 중",
  review: "마감 작성 중",
  off: "마감 완료",
};

export const seatTitle = (s: SeatStatus) => TITLES[s.kind];

export function seatStatusOf(office: Office): SeatStatus {
  switch (office.day.phase) {
    case "beforeCheckIn":
      return { kind: "beforeCheckIn" };
    case "morningPT":
    case "working":
      return { kind: "seated" };
    case "sharing":
      return { kind: "sharing" };
    case "checkoutReview":
      return { kind: "review" };
    case "off":
      return { kind: "off" };
  }
}

export function seatDetail(s: SeatStatus): string {
  switch (s.kind) {
    case "beforeCheckIn":
      return "출근 버튼을 누르면 오늘 활동을 시작합니다.";
    case "seated":
      return "확정한 과제를 수행하고 결과물을 제출합니다.";
    case "sharing":
      return "회의실에서 기획팀·디자인팀·운영팀 담당자에게 오늘 한 일을 발표하고 있습니다.";
    case "review":
      return "해낸 일과 다음 행동을 확인하고 있습니다.";
    case "off":
      return "오늘 활동을 마감했습니다.";
  }
}

/** 위 막대 한 줄. 시각은 사용자가 정한 활동 시간을 안내에만 쓴다. */
export function phaseHeadline(office: Office): string {
  const end = Clock.hm(office.profile.activityEnd);
  const start = Clock.hm(office.profile.activityStart);
  const late = office.pastActivityEnd;
  switch (office.day.phase) {
    case "beforeCheckIn":
      return `출근 전 · 활동 시작 ${start}`;
    case "morningPT":
      return "아침보고 · 오늘 끝낼 범위 정하기";
    case "working":
      return late ? `수행 중 · 마감 시각 ${end}이 지났습니다` : `수행 중 · 마감 ${end}`;
    case "sharing":
      return "회의실 발표 · 오늘 한 일 발표하기";
    case "checkoutReview":
      return "하루 마감 · 해낸 일과 다음 행동 확인";
    case "off":
      return "마감 완료 · 수고하셨습니다";
  }
}
