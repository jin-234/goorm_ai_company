/**
 * 화면에서 보내는 행동 하나를 규칙 엔진에 적용한다.
 * 입력 검증은 여기서 하고, 규칙 위반은 OfficeError로 던진다.
 */
import { type CarryReport, isTaskLevel, PRESENCE_STATES, type PresenceState, type TaskDraft } from "../office/models";
import type { Office } from "../office/office";
import { OfficeError } from "../office/rules";
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

const bool = (body: Json, key: string): boolean => {
  if (typeof body[key] !== "boolean") throw new BadRequest(`${key}는 true/false여야 합니다.`);
  return body[key] as boolean;
};

/** 초안 칸 고치기. due는 분(number) 또는 "HH:MM"을 받는다. */
function draftPatch(body: Json): Partial<Pick<TaskDraft, "title" | "level" | "due" | "doneCriteria">> {
  const patch: Partial<Pick<TaskDraft, "title" | "level" | "due" | "doneCriteria">> = {};
  if ("title" in body) patch.title = body.title == null ? null : str(body, "title");
  if ("doneCriteria" in body) patch.doneCriteria = body.doneCriteria == null ? null : str(body, "doneCriteria");
  if ("level" in body) {
    if (body.level != null && !isTaskLevel(body.level)) throw new BadRequest("level은 1, 2, 3 중 하나여야 합니다.");
    patch.level = (body.level as TaskDraft["level"]) ?? null;
  }
  if ("due" in body) {
    const due = body.due;
    if (due == null) patch.due = null;
    else if (typeof due === "number" && Number.isInteger(due) && due >= 0 && due <= 24 * 60) patch.due = due;
    else if (typeof due === "string" && Clock.minutesFromHM(due) != null) patch.due = Clock.minutesFromHM(due);
    else throw new BadRequest("due는 HH:MM 형식으로 적어 주세요.");
  }
  return patch;
}

function carryReports(body: Json): Record<string, CarryReport> {
  const raw = body.carryReports ?? {};
  if (typeof raw !== "object" || raw == null) throw new BadRequest("carryReports는 객체여야 합니다.");
  const reports: Record<string, CarryReport> = {};
  for (const [id, value] of Object.entries(raw as Json)) {
    const r = (value ?? {}) as Json;
    reports[id] = { reason: typeof r.reason === "string" ? r.reason : "", plan: typeof r.plan === "string" ? r.plan : "" };
  }
  return reports;
}

export const ACTION_TYPES = [
  "onboard",
  "checkIn",
  "setTranscript",
  "addDraft",
  "updateDraft",
  "removeDraft",
  "confirmTasks",
  "setTaskDone",
  "setDeliverable",
  "requestLunch",
  "registerAway",
  "returnFromAllowance",
  "observePresence",
  "skipHour",
  "submitCheckout",
  "endOvertimeEarly",
  "submitOvertimeReview",
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
      office.completeOnboarding(str(body, "name", false));
      return null;
    case "checkIn":
      return { attendance: office.checkIn() };
    case "setTranscript":
      office.setTranscript(str(body, "transcript"));
      return null;
    case "addDraft":
      return { draft: office.addDraft() };
    case "updateDraft":
      if (office.day.phase !== "morningPT") throw OfficeError.notAllowedNow("업무 초안은 아침 PT에서 고칩니다.");
      office.updateDraft(str(body, "id"), draftPatch(body));
      return null;
    case "removeDraft":
      office.removeDraft(str(body, "id"));
      return null;
    case "confirmTasks":
      office.confirmTasks();
      return null;
    case "setTaskDone":
      office.setTask(str(body, "id"), bool(body, "done"));
      return null;
    case "setDeliverable":
      office.setDeliverable(str(body, "id"), str(body, "text"));
      return null;
    case "requestLunch":
      return { allowance: office.requestLunch() };
    case "registerAway":
      return { allowance: office.registerAway(str(body, "reason")) };
    case "returnFromAllowance":
      office.returnFromAllowance();
      return null;
    case "observePresence": {
      const state = body.state as PresenceState;
      if (!PRESENCE_STATES.includes(state)) throw new BadRequest("state는 present, absent, cameraOff, unknown 중 하나입니다.");
      office.observe(state);
      return null;
    }
    case "skipHour": {
      const result = office.skipHour();
      if (!result) throw OfficeError.notAllowedNow("지금 점검을 먼저 제출해 주세요.");
      return { skip: result };
    }
    case "submitCheckout":
      return { checkout: office.submitCheckout(carryReports(body)) };
    case "endOvertimeEarly":
      return { overtime: office.endOvertimeEarly() };
    case "submitOvertimeReview":
      return { overtime: office.submitOvertimeReview() };
    case "saveWeeklyDraft":
      office.saveWeeklyDraft({
        ...("completed" in body ? { completed: str(body, "completed") } : {}),
        ...("incomplete" in body ? { incomplete: str(body, "incomplete") } : {}),
        ...("nextGoals" in body ? { nextGoals: str(body, "nextGoals") } : {}),
      });
      return null;
    case "submitWeeklyReport": {
      // 본문에 칸이 있으면 그 값으로, 없으면 저장해 둔 초안으로 제출한다.
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
      if (!office.canStartNextWorkday) throw OfficeError.notAllowedNow("퇴근한 뒤에 다음 근무일로 넘어갈 수 있습니다.");
      office.startNextWorkday();
      return null;
    case "jumpToFriday":
      if (!office.canJumpToFriday) throw OfficeError.notAllowedNow("이미 금요일입니다.");
      office.jumpToFriday();
      return null;
    default:
      throw new BadRequest(`알 수 없는 행동입니다: ${String(type)}`);
  }
}
