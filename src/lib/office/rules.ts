/**
 * 활동 규칙 값. 시각은 사용자가 정한 활동 시작·마감 시각을 쓴다(개정 기획서 3.1).
 * 지각·착석 확인·점심·자리 비움·퇴근 점검·추가근무는 관리 강도(Enforcement)가 켤 때만 동작한다.
 */
export const WorkRules = {
  /** 입사 때 따로 정하지 않았을 때의 활동 시작 시각 09:00 */
  defaultActivityStart: 9 * 60,
  /** 입사 때 따로 정하지 않았을 때의 활동 마감 시각 18:00 */
  defaultActivityEnd: 18 * 60,
  /** @deprecated 옛 아침 PT 초안(Solar checklist·pt-parser)의 기본 마감. 새 흐름에서는 activityEnd를 쓴다. */
  defaultWorkEnd: 18 * 60,
  /** 시연을 시작하는 시각: 활동 시작 5분 전 */
  minutesBeforeStart: 5,
  /** AI 기획자 질문 상한(기본은 1~2개). */
  maxShareQuestions: 3,
  /** 제출물 한 건의 최대 글자 수. */
  maxSubmissionLength: 20_000,
  /** 목표·요약 칸 하나의 최대 글자 수. */
  maxFieldLength: 4_000,
  /** 하루에 확정할 수 있는 과제 수. 작게 끝내는 것이 목적이라 넉넉히만 막는다. */
  maxTasksPerDay: 10,
  /** 승인된 점심 1시간(보통·엄격). */
  lunchMinutes: 60,
  /** 등록한 자리 비움 건당 15분(보통·엄격). */
  awayMinutes: 15,
  /** 보통 강도에서 이보다 짧은 허용 밖 자리 비움은 기록하지 않는다. */
  standardAwayGraceMinutes: 15,
  /** 추가근무 전 저녁시간 1시간(마감 시각부터). */
  dinnerMinutes: 60,
  /** 추가근무 3시간(저녁시간 다음부터). */
  overtimeMinutes: 180,
  /** 이 횟수만큼 연속으로 제시간에 출근하면 지각 점수 1점을 덜어 준다. */
  recoveryStreak: 3,
} as const;

/** 관리 강도. 자리를 지키게 하는 장치의 세기를 참여자가 고른다. */
export type EnforcementLevel = "light" | "standard" | "strict";

export const ENFORCEMENT_LEVELS: EnforcementLevel[] = ["light", "standard", "strict"];

export const DEFAULT_ENFORCEMENT: EnforcementLevel = "standard";

export interface EnforcementInfo {
  label: string;
  summary: string;
  /** 출근 시각을 보고 지각·결근 후보를 기록한다. */
  attendance: boolean;
  /** 지각비 예상액을 계산한다(시연용, 청구하지 않음). */
  lateFee: boolean;
  /** 착석 확인(지금은 버튼, 카메라는 브라우저 안 판정). */
  seatCheck: boolean;
  /** 점심·자리 비움 등록. */
  allowances: boolean;
  /** 허용 밖 자리 비움을 짧아도 기록하고 경고한다. */
  strictAway: boolean;
  /** 마감 시각에 퇴근 점검으로 넘어가고, 2·3단계가 남으면 저녁시간·추가근무를 배정한다. */
  checkoutAndOvertime: boolean;
  /** 마감 시각 전에 마감하려면 사유를 적어야 한다. */
  earlyLeaveReason: boolean;
  /** 아침보고 과제에 중요도(1~3단계)를 정한다. */
  taskLevels: boolean;
}

export const ENFORCEMENT: Record<EnforcementLevel, EnforcementInfo> = {
  light: {
    label: "가볍게",
    summary: "출근 버튼만 누릅니다. 지각·착석 확인·추가근무 없이 언제든 마감합니다.",
    attendance: false,
    lateFee: false,
    seatCheck: false,
    allowances: false,
    strictAway: false,
    checkoutAndOvertime: false,
    earlyLeaveReason: false,
    taskLevels: false,
  },
  standard: {
    label: "보통",
    summary: "출근 시각과 지각을 기록하고 착석을 확인합니다. 마감 시각에 퇴근 점검을 하고, 중요한 과제가 남으면 추가근무를 합니다.",
    attendance: true,
    lateFee: true,
    seatCheck: true,
    allowances: true,
    strictAway: false,
    checkoutAndOvertime: true,
    earlyLeaveReason: false,
    taskLevels: true,
  },
  strict: {
    label: "엄격",
    summary: "보통에 더해, 등록하지 않은 자리 비움을 짧아도 경고하고 마감 시각 전에 마감하려면 사유를 적습니다.",
    attendance: true,
    lateFee: true,
    seatCheck: true,
    allowances: true,
    strictAway: true,
    checkoutAndOvertime: true,
    earlyLeaveReason: true,
    taskLevels: true,
  },
};

export const isEnforcementLevel = (v: unknown): v is EnforcementLevel => v === "light" || v === "standard" || v === "strict";

/** 한 단계 낮춘 강도. 가볍게는 그대로. */
export function lowerLevel(level: EnforcementLevel): EnforcementLevel {
  return level === "strict" ? "standard" : "light";
}

/** 지각비. 시연에서는 예상액으로만 보여 주고 실제로 청구하지 않는다. */
export const LateFee = {
  pointsPerLate: 1,
  pointsPerAbsence: 3,
  freePoints: 2,
  wonPerPoint: 1_000,
  monthlyCap: 5_000,

  estimateFromPoints(points: number): number {
    return Math.min(this.monthlyCap, Math.max(0, points - this.freePoints) * this.wonPerPoint);
  },

  /** 예: 3,000원 */
  won(amount: number): string {
    return amount.toLocaleString("ko-KR") + "원";
  },
};

/** 이번 달 근태 집계. recovered는 연속 출근으로 덜어 준 점수. */
export interface MonthStats {
  late: number;
  absent: number;
  recovered: number;
  points: number;
  estimatedFee: number;
}

export type OfficeErrorCode =
  | "notAllowedNow"
  | "noTasks"
  | "taskIncomplete"
  | "taskNotFound"
  | "emptySubmission"
  | "noSubmission"
  | "shareQuestionLimit"
  | "choiceMissing"
  | "invalidProfile"
  | "lunchAlreadyUsed"
  | "allowanceActive"
  | "emptyReason"
  | "heavyTasksLeft"
  | "earlyLeaveReason";

/** 규칙상 할 수 없는 일. 메시지는 화면에 그대로 보여 줄 수 있는 한국어다. */
export class OfficeError extends Error {
  constructor(
    public readonly code: OfficeErrorCode,
    /** notAllowedNow: 이유 한 줄 / taskIncomplete: 과제별 빠진 칸 / choiceMissing: 과제명 */
    public readonly details: string[] = [],
  ) {
    super(OfficeError.describe(code, details));
    this.name = "OfficeError";
  }

  static notAllowedNow(why: string) {
    return new OfficeError("notAllowedNow", [why]);
  }

  static describe(code: OfficeErrorCode, details: string[]): string {
    const bullets = details.map((d) => `· ${d}`).join("\n");
    switch (code) {
      case "notAllowedNow":
        return details[0] ?? "";
      case "noTasks":
        return "확정할 과제가 없습니다.\n오늘 끝낼 과제를 한 건 이상 넣어 주세요.";
      case "taskIncomplete":
        return "확인이 필요한 칸이 남아 있습니다.\n" + details.join("\n");
      case "taskNotFound":
        return "그 과제를 찾지 못했습니다.\n화면을 새로고침해 주세요.";
      case "emptySubmission":
        return "제출할 내용을 적어 주세요.";
      case "noSubmission":
        return "제출물이 아직 없습니다.\n글·코드·링크 중 하나를 먼저 올려 주세요.";
      case "shareQuestionLimit":
        return "질문 상한에 닿았습니다.\n지금까지 설명한 내용으로 공유를 마칠 수 있습니다.";
      case "choiceMissing":
        return "제출하지 못한 과제의 처리를 골라 주세요.\n(범위 조정 · 다음 활동일로 이월 · 오늘 종료)\n" + bullets;
      case "invalidProfile":
        return details[0] ?? "입사 정보를 확인해 주세요.";
      case "lunchAlreadyUsed":
        return "오늘 점심은 이미 사용했습니다.";
      case "allowanceActive":
        return "지금 점심이나 자리 비움 중입니다.\n복귀한 뒤 다시 요청해 주세요.";
      case "emptyReason":
        return "자리 비움 사유를 적어 주세요.";
      case "heavyTasksLeft":
        return "2·3단계 과제가 아직 남아 있어 마감 시각 전에는 마감할 수 없습니다.\n제출하거나 마감 시각의 퇴근 점검을 기다려 주세요.\n" + bullets;
      case "earlyLeaveReason":
        return "마감 시각 전에 마감하려면 사유를 적어 주세요.";
    }
  }
}
