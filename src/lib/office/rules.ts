/**
 * 활동 규칙 값. 정해진 09시·18시를 강제하지 않고 사용자가 정한 시각을 쓴다(개정 기획서 3.1).
 * 지각비·카메라 착석 판정·자동 추가근무는 없다.
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
} as const;

export type OfficeErrorCode =
  | "notAllowedNow"
  | "noTasks"
  | "taskIncomplete"
  | "taskNotFound"
  | "emptySubmission"
  | "noSubmission"
  | "shareQuestionLimit"
  | "choiceMissing"
  | "invalidProfile";

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
    }
  }
}
