/**
 * 화면에서 보내는 행동 하나를 규칙 엔진에 적용한다(분담표 3.3 계약).
 * 입력 모양 검증은 여기서 하고(BadRequest), 규칙 위반은 OfficeError로 던진다.
 */
import {
  CHECK_IN_METHODS,
  type CheckInMethod,
  type PlannerReply,
  REVIEW_LIST_FIELDS,
  REVIEW_TEXT_FIELDS,
  type Review,
  SUBMISSION_KINDS,
  type SubmissionKind,
  TASK_OUTCOMES,
  type TaskOutcome,
} from "../office/models";
import type { ConfirmInput, Office, OnboardInput } from "../office/office";
import { OfficeError, WorkRules } from "../office/rules";
import { Clock } from "../office/time";

export class BadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequest";
  }
}

type Json = Record<string, unknown>;

const str = (body: Json, key: string, required = true): string => {
  const value = body[key];
  if (typeof value === "string") return value;
  if (!required && value == null) return "";
  throw new BadRequest(`${key}는 문자열이어야 합니다.`);
};

const optStr = (body: Json, key: string): string | undefined => (body[key] == null ? undefined : str(body, key));

const obj = (value: unknown, key: string): Json => {
  if (typeof value !== "object" || value == null || Array.isArray(value)) throw new BadRequest(`${key}는 객체여야 합니다.`);
  return value as Json;
};

const strList = (value: unknown, key: string): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new BadRequest(`${key}는 문자열 목록이어야 합니다.`);
  return (value as string[]).map((v) => v.slice(0, WorkRules.maxFieldLength)).slice(0, 20);
};

/** 분(number) 또는 "HH:MM". */
function minutes(body: Json, key: string): number | undefined {
  const v = body[key];
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 24 * 60) return v;
  if (typeof v === "string" && Clock.minutesFromHM(v) != null) return Clock.minutesFromHM(v)!;
  throw new BadRequest(`${key}는 HH:MM 형식이나 자정 기준 분으로 적어 주세요.`);
}

function onboardInput(body: Json): OnboardInput {
  return {
    name: str(body, "name", false),
    targetRole: optStr(body, "targetRole"),
    experience: optStr(body, "experience"),
    activityStart: minutes(body, "activityStart"),
    activityEnd: minutes(body, "activityEnd"),
  };
}

function confirmInput(body: Json): ConfirmInput {
  if (!Array.isArray(body.tasks)) throw new BadRequest("tasks는 목록이어야 합니다.");
  return {
    goal: optStr(body, "goal"),
    tasks: body.tasks.map((raw, i) => {
      const t = obj(raw, `tasks[${i}]`);
      return {
        title: str(t, "title", false),
        completionCriteria: str(t, "completionCriteria", false),
        shareForm: str(t, "shareForm", false),
        ...(t.carryId != null ? { carryId: str(t, "carryId") } : {}),
      };
    }),
  };
}

/** 마감 요약 8개 필드. 없는 칸은 빈 값으로 채우고, 모양이 틀리면 BadRequest. */
export function reviewOf(value: unknown): Review {
  const r = obj(value, "review");
  const review = {} as Review;
  for (const key of REVIEW_TEXT_FIELDS) {
    const v = r[key] ?? "";
    if (typeof v !== "string") throw new BadRequest(`review.${key}는 문자열이어야 합니다.`);
    review[key] = v.slice(0, WorkRules.maxFieldLength);
  }
  for (const key of REVIEW_LIST_FIELDS) review[key] = strList(r[key], `review.${key}`);
  return review;
}

/** AI 기획자 응답(개정 기획서 4.3 E). */
export function plannerReplyOf(value: unknown): PlannerReply {
  const r = obj(value, "reply");
  const text = (key: string) => {
    const v = r[key] ?? "";
    if (typeof v !== "string") throw new BadRequest(`reply.${key}는 문자열이어야 합니다.`);
    return v.slice(0, WorkRules.maxFieldLength);
  };
  return {
    acknowledgement: text("acknowledgement"),
    question: text("question"),
    question_reason: text("question_reason"),
    known_facts: strList(r.known_facts, "reply.known_facts"),
    open_questions: strList(r.open_questions, "reply.open_questions"),
    evidence_refs: strList(r.evidence_refs, "reply.evidence_refs"),
    can_finish: r.can_finish === true,
  };
}

function choicesOf(body: Json): Record<string, TaskOutcome> {
  const raw = obj(body.choices ?? {}, "choices");
  const out: Record<string, TaskOutcome> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (!TASK_OUTCOMES.includes(v as TaskOutcome)) throw new BadRequest("choices 값은 adjust, carryOver, endToday 중 하나입니다.");
    out[id] = v as TaskOutcome;
  }
  return out;
}

function reasonsOf(body: Json): Record<string, string> {
  const raw = obj(body.reasons ?? {}, "reasons");
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    if (typeof v !== "string") throw new BadRequest("reasons 값은 문자열이어야 합니다.");
    out[id] = v;
  }
  return out;
}

export const ACTION_TYPES = [
  "onboard",
  "checkIn",
  "saveGoal",
  "confirmTasks",
  "setTaskStatus",
  "submitWork",
  "startSharing",
  "recordShareTurn",
  "endSharing",
  "saveReviewDraft",
  "confirmReview",
  "skipHour",
  "saveWeeklyDraft",
  "submitWeeklyReport",
  "markMailRead",
  "startNextWorkday",
  "jumpToFriday",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/** 행동을 적용하고, 화면에 알릴 결과(있으면)를 돌려준다. */
export function applyAction(office: Office, body: Json): unknown {
  const type = body.type;
  switch (type as ActionType) {
    case "onboard":
      office.completeOnboarding(onboardInput(body));
      return null;
    case "checkIn": {
      const method = body.method ?? null;
      if (method !== null && !CHECK_IN_METHODS.includes(method as CheckInMethod)) {
        throw new BadRequest("method는 camera 또는 noCamera입니다.");
      }
      return office.checkIn(method as CheckInMethod | null);
    }
    case "saveGoal":
      office.saveGoal(str(body, "goal"));
      return null;
    case "confirmTasks":
      return { tasks: office.confirmTasks(confirmInput(body)) };
    case "setTaskStatus": {
      const status = body.status;
      if (status !== "in_progress" && status !== "submitted" && status !== "incomplete") {
        throw new BadRequest("status는 in_progress, submitted, incomplete 중 하나입니다.");
      }
      office.setTaskStatus(str(body, "taskId"), status);
      return null;
    }
    case "submitWork": {
      const kind = body.kind as SubmissionKind;
      if (!SUBMISSION_KINDS.includes(kind)) throw new BadRequest("kind는 text, link, code 중 하나입니다.");
      return { submission: office.submitWork(str(body, "taskId"), kind, str(body, "content")) };
    }
    case "startSharing":
      office.startSharing();
      return null;
    case "recordShareTurn": {
      // 화면은 사용자 턴만 보낸다. 기획자 턴은 /api/office/share(서버)가 AI 응답을 받아 남긴다.
      if (body.role !== "user") throw new BadRequest("화면에서는 role이 user인 턴만 남길 수 있습니다.");
      office.recordShareTurn({ role: "user", text: str(body, "text") });
      return null;
    }
    case "endSharing": {
      const reason = body.reason ?? "done";
      if (reason !== "done" && reason !== "userStopped") throw new BadRequest("reason은 done 또는 userStopped입니다.");
      office.endSharing(reason);
      return null;
    }
    case "saveReviewDraft":
      office.saveReviewDraft(reviewOf(body.review), "user");
      return null;
    case "confirmReview":
      return { close: office.confirmReview(reviewOf(body.review), choicesOf(body), reasonsOf(body)) };
    case "skipHour": {
      const result = office.skipHour();
      if (!result) throw OfficeError.notAllowedNow("지금은 시간을 넘길 수 없습니다.");
      return { skip: result };
    }
    case "saveWeeklyDraft":
      office.saveWeeklyDraft({
        ...("completed" in body ? { completed: str(body, "completed") } : {}),
        ...("incomplete" in body ? { incomplete: str(body, "incomplete") } : {}),
        ...("nextGoals" in body ? { nextGoals: str(body, "nextGoals") } : {}),
      });
      return null;
    case "submitWeeklyReport": {
      const draft = office.weeklyDraft;
      const report = {
        completed: "completed" in body ? str(body, "completed") : draft.completed,
        incomplete: "incomplete" in body ? str(body, "incomplete") : draft.incomplete,
        nextGoals: "nextGoals" in body ? str(body, "nextGoals") : draft.nextGoals,
      };
      office.saveWeeklyDraft(report);
      return { report: office.submitWeeklyReport(report) };
    }
    case "markMailRead":
      office.markRead(str(body, "id"));
      return null;
    case "startNextWorkday":
      office.startNextWorkday();
      return null;
    case "jumpToFriday":
      office.jumpToFriday();
      return null;
    default:
      throw new BadRequest(`알 수 없는 행동입니다: ${String(type)}`);
  }
}
