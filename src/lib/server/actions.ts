/**
 * 화면에서 보내는 행동 하나를 규칙 엔진에 적용한다(분담표 3.3 계약).
 * 입력 모양 검증은 여기서 하고(BadRequest), 규칙 위반은 OfficeError로 던진다.
 */
import {
  isTaskLevel,
  COLLECTED_CASES_AVAILABLE,
  QUESTION_BASES,
  type QuestionBasis,
  CHECK_IN_METHODS,
  type CheckInMethod,
  type PlannerReply,
  PRESENCE_STATES,
  type PresenceState,
  REVIEW_LIST_FIELDS,
  REVIEW_TEXT_FIELDS,
  type Review,
  SUBMISSION_KINDS,
  type SubmissionKind,
  TASK_OUTCOMES,
  type TaskOutcome,
} from "../office/models";
import type { ConfirmInput, Office, OnboardInput } from "../office/office";
import { type EnforcementLevel, isEnforcementLevel, OfficeError, WorkRules } from "../office/rules";
import { Clock, type DayKey } from "../office/time";

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
    enforcement: body.enforcement == null ? undefined : enforcementOf(body.enforcement),
  };
}

function enforcementOf(value: unknown): EnforcementLevel {
  if (!isEnforcementLevel(value)) throw new BadRequest("enforcement는 light, standard, strict 중 하나입니다.");
  return value;
}

/** "YYYY-MM-DD" → DayKey. 없으면 undefined(오늘). */
function dayOf(body: Json, key: string): DayKey | undefined {
  const v = body[key];
  if (v == null) return undefined;
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (!m) throw new BadRequest(`${key}는 YYYY-MM-DD 형식이어야 합니다.`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
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
        level: t.level == null ? null : isTaskLevel(t.level) ? t.level : badLevel(),
        ...(t.carryId != null ? { carryId: str(t, "carryId") } : {}),
      };
    }),
  };
}

function badLevel(): never {
  throw new BadRequest("level은 1, 2, 3 중 하나입니다.");
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

/** 타 부서 동료 응답(개정 기획서 4.3 E). */
export function plannerReplyOf(value: unknown): PlannerReply {
  const r = obj(value, "reply");
  const text = (key: string) => {
    const v = r[key] ?? "";
    if (typeof v !== "string") throw new BadRequest(`reply.${key}는 문자열이어야 합니다.`);
    return v.slice(0, WorkRules.maxFieldLength);
  };
  const question = text("question");
  let basis = (typeof r.question_basis === "string" ? r.question_basis : "") as QuestionBasis | "";
  if (basis !== "" && !QUESTION_BASES.includes(basis)) basis = "role_need";
  // 수집한 사례 데이터가 없으면 AI가 '실제 사례'라고 해도 공개 가이드 기반 시나리오로 낮춘다.
  if (basis === "collected_case" && !COLLECTED_CASES_AVAILABLE) basis = "ux_guide";
  if (question.trim() && basis === "") basis = "role_need";
  return {
    acknowledgement: text("acknowledgement"),
    question,
    question_reason: text("question_reason"),
    question_basis: question.trim() ? basis : "",
    basis_ref: question.trim() ? text("basis_ref").slice(0, 120) : "",
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
  "markMailRead",
  "startNextWorkday",
  "setEnforcement",
  "setDayOff",
  "observePresence",
  "requestLunch",
  "registerAway",
  "returnFromAllowance",
  "submitCheckout",
  "endOvertime",
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
      office.startSharing(str(body, "earlyReason", false));
      return null;
    case "recordShareTurn": {
      // 화면은 사용자 턴만 보낸다. 동료 턴은 /api/office/share(서버)가 AI 응답을 받아 남긴다.
      if (body.role !== "user") throw new BadRequest("화면에서는 role이 user인 턴만 남길 수 있습니다.");
      office.recordShareTurn({ role: "user", text: str(body, "text") });
      return null;
    }
    case "endSharing": {
      const reason = body.reason ?? "done";
      if (reason !== "done" && reason !== "userStopped") throw new BadRequest("reason은 done 또는 userStopped입니다.");
      office.endSharing(reason, str(body, "earlyReason", false));
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
    case "markMailRead":
      office.markRead(str(body, "id"));
      return null;
    case "startNextWorkday":
      office.startNextWorkday();
      return null;
    case "setEnforcement":
      office.setEnforcement(enforcementOf(body.level));
      return null;
    case "setDayOff":
      office.setDayOff(body.off !== false, dayOf(body, "date"));
      return null;
    case "observePresence": {
      const state = body.state as PresenceState;
      if (!PRESENCE_STATES.includes(state)) throw new BadRequest("state는 present, absent, cameraOff, unknown 중 하나입니다.");
      office.observePresence(state);
      return null;
    }
    case "requestLunch":
      return { allowance: office.requestLunch() };
    case "registerAway":
      return { allowance: office.registerAway(str(body, "reason")) };
    case "returnFromAllowance":
      office.returnFromAllowance();
      return null;
    case "submitCheckout":
      return { checkout: office.submitCheckout() };
    case "endOvertime":
      return { overtime: office.endOvertime() };
    default:
      throw new BadRequest(`알 수 없는 행동입니다: ${String(type)}`);
  }
}
