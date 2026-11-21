/** 근무 시간 규칙. 단일 엄격 관리 기준이다. */
export const WorkRules = {
  /** 시연 기본 출근 시각 09:00 */
  defaultWorkStart: 9 * 60,
  /** 시연 기본 퇴근 시각 18:00 */
  defaultWorkEnd: 18 * 60,
  /** 시연을 시작하는 시각 08:55 */
  demoStartMinute: 8 * 60 + 55,
  /** 승인된 점심 1시간 */
  lunchMinutes: 60,
  /** 등록한 자리 비움 건당 15분 */
  awayMinutes: 15,
  /** 추가근무 전 저녁시간 1시간 (18:00~19:00) */
  dinnerMinutes: 60,
  /** 추가근무 3시간 (19:00~22:00) */
  overtimeMinutes: 180,
} as const;

/** 지각비. 시연에서는 예상액으로만 보여 주고 실제로 청구하지 않는다. */
export const LateFee = {
  pointsPerLate: 1,
  pointsPerAbsence: 3,
  freePoints: 2,
  wonPerPoint: 1_000,
  monthlyCap: 5_000,

  points(late: number, absent: number): number {
    return Math.max(0, late) * this.pointsPerLate + Math.max(0, absent) * this.pointsPerAbsence;
  },

  estimateFromPoints(points: number): number {
    return Math.min(this.monthlyCap, Math.max(0, points - this.freePoints) * this.wonPerPoint);
  },

  estimate(late: number, absent: number): number {
    return this.estimateFromPoints(this.points(late, absent));
  },

  /** 예: 3,000원 */
  won(amount: number): string {
    return amount.toLocaleString("ko-KR") + "원";
  },
};

/** 이번 달 근태 집계. */
export interface MonthStats {
  late: number;
  absent: number;
  points: number;
  estimatedFee: number;
}

export function monthStats(late = 0, absent = 0): MonthStats {
  const points = LateFee.points(late, absent);
  return { late, absent, points, estimatedFee: LateFee.estimateFromPoints(points) };
}

export type OfficeErrorCode =
  | "notAllowedNow"
  | "draftIncomplete"
  | "noTasks"
  | "lunchAlreadyUsed"
  | "allowanceActive"
  | "emptyReason"
  | "carryReportMissing"
  | "weeklyNotFriday"
  | "weeklyIncomplete"
  | "weeklyAlreadySubmitted";

/** 규칙상 할 수 없는 일. 메시지는 화면에 그대로 보여 줄 수 있는 한국어다. */
export class OfficeError extends Error {
  constructor(
    public readonly code: OfficeErrorCode,
    /** notAllowedNow: 이유 한 줄 / draftIncomplete: 업무별 빠진 칸 / carryReportMissing: 업무명 / weeklyIncomplete: 칸 이름 */
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
      case "draftIncomplete":
        return "확인이 필요한 칸이 남아 있습니다.\n" + details.join("\n");
      case "noTasks":
        return "확정할 업무가 없습니다.\n업무를 한 건 이상 넣어 주세요.";
      case "lunchAlreadyUsed":
        return "오늘 점심은 이미 사용했습니다.";
      case "allowanceActive":
        return "이미 허용된 시간 안에 있습니다.\n복귀한 뒤 다시 요청해 주세요.";
      case "emptyReason":
        return "자리를 비우는 사유를 적어 주세요.";
      case "carryReportMissing":
        return "1단계 업무의 미완료 이유와 다음 근무일 계획을 적어 주세요.\n" + bullets;
      case "weeklyNotFriday":
        return "주간보고서는 금요일에 제출합니다.";
      case "weeklyIncomplete":
        return "아직 쓰지 않은 칸이 있습니다.\n" + bullets;
      case "weeklyAlreadySubmitted":
        return "이번 주 주간보고서는 이미 제출했습니다.";
    }
  }
}
