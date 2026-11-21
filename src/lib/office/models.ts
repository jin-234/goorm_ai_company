import { WorkRules } from "./rules";
import type { DayKey, Instant } from "./time";

// MARK: 사원

export interface EmployeeProfile {
  name: string;
  /** 근무 시작 시각(자정 기준 분). 기본 09:00 */
  workStart: number;
  /** 근무 종료 시각(자정 기준 분). 기본 18:00 */
  workEnd: number;
}

export function defaultProfile(name = "김서울"): EmployeeProfile {
  return { name, workStart: WorkRules.defaultWorkStart, workEnd: WorkRules.defaultWorkEnd };
}

/** 저녁시간이 끝나고 추가근무가 시작되는 시각. */
export const overtimeStartOf = (p: EmployeeProfile) => p.workEnd + WorkRules.dinnerMinutes;
/** 추가근무가 끝나는 시각. */
export const overtimeEndOf = (p: EmployeeProfile) => overtimeStartOf(p) + WorkRules.overtimeMinutes;

// MARK: 하루의 단계

export type Phase =
  | "beforeCheckIn"
  | "morningPT"
  | "working"
  | "checkoutReview"
  | "dinner"
  | "overtime"
  | "overtimeReview"
  | "off";

export const PHASE_LABEL: Record<Phase, string> = {
  beforeCheckIn: "출근 전",
  morningPT: "아침 PT",
  working: "근무 중",
  checkoutReview: "퇴근 점검",
  dinner: "저녁시간",
  overtime: "추가근무",
  overtimeReview: "추가근무 종료",
  off: "퇴근",
};

// MARK: 업무

/** 업무 중요도. 1 이월 가능 / 2 당일 완료 / 3 필수 마감 */
export type TaskLevel = 1 | 2 | 3;

export const isTaskLevel = (value: unknown): value is TaskLevel => value === 1 || value === 2 || value === 3;

export const TaskLevelInfo = {
  short: (level: TaskLevel) => `${level}단계`,
  meaning: (level: TaskLevel) => ({ 1: "이월 가능", 2: "당일 완료", 3: "필수 마감" })[level],
  label: (level: TaskLevel) => `${level}단계 · ${TaskLevelInfo.meaning(level)}`,
  ruleAtWorkEnd: (level: TaskLevel) =>
    ({
      1: "미완료 이유와 다음 근무일 계획을 메일로 보고하고 이월합니다.",
      2: "저녁시간 뒤 추가근무에서 끝냅니다.",
      3: "추가근무에서 가장 먼저 진행합니다.",
    })[level],
};

export type TaskStatus = "open" | "done" | "carried";

/** 아침 PT에서 확정한 업무. */
export interface WorkTask {
  id: string;
  title: string;
  level: TaskLevel;
  /** 마감 시각(자정 기준 분). */
  due: number;
  doneCriteria: string;
  status: TaskStatus;
  doneAt: Instant | null;
  /** 결과물. 메모, 링크, 파일 이름 등. */
  deliverable: string;
  /** 이월된 업무라면 처음 확정한 날. */
  carriedFrom: DayKey | null;
  carryCount: number;
}

export function newTask(fields: Pick<WorkTask, "title" | "level" | "due" | "doneCriteria"> & Partial<WorkTask>): WorkTask {
  return {
    id: crypto.randomUUID(),
    status: "open",
    doneAt: null,
    deliverable: "",
    carriedFrom: null,
    carryCount: 0,
    ...fields,
  };
}

/** 아침 PT 초안의 업무 한 줄. 전사문에 없는 값은 null이고 화면에 '확인 필요'로 보인다. */
export interface TaskDraft {
  id: string;
  title: string | null;
  level: TaskLevel | null;
  due: number | null;
  doneCriteria: string | null;
  carriedFrom: DayKey | null;
  carryCount: number;
}

export function newDraft(fields: Partial<TaskDraft> = {}): TaskDraft {
  return {
    id: crypto.randomUUID(),
    title: null,
    level: null,
    due: null,
    doneCriteria: null,
    carriedFrom: null,
    carryCount: 0,
    ...fields,
  };
}

export const isCarriedDraft = (d: TaskDraft) => d.carriedFrom != null;

/** 아직 채우지 않은 칸의 이름. */
export function missingFields(d: TaskDraft): string[] {
  const missing: string[] = [];
  if (!(d.title ?? "").trim()) missing.push("업무명");
  if (d.level == null) missing.push("중요도");
  if (d.due == null) missing.push("마감");
  if (!(d.doneCriteria ?? "").trim()) missing.push("완료 기준");
  return missing;
}

/** 업무 초안을 누가 만들었는지. */
export type DraftSource = "solar" | "localRules" | "manual";

export const DRAFT_SOURCE_LABEL: Record<DraftSource, string> = {
  solar: "Solar가 정리한 초안",
  localRules: "서버 안 규칙으로 정리한 초안 (Solar 미연결)",
  manual: "직접 입력",
};

// MARK: 근태

export type AllowanceKind = "lunch" | "away" | "dinner";
export const ALLOWANCE_LABEL: Record<AllowanceKind, string> = { lunch: "점심", away: "자리 비움", dinner: "저녁시간" };

/** 허용된 자리 비움. 이 시간 안에는 착석 확인을 쉰다. */
export interface Allowance {
  id: string;
  kind: AllowanceKind;
  reason: string;
  start: Instant;
  /** 등록된 종료 시각. 시연 시간을 건너뛰어도 이 시각에 만료한다. */
  end: Instant;
  /** 실제로 끝난 시각. 먼저 복귀했으면 end보다 이르다. */
  endedAt: Instant | null;
}

/** 카메라가 본 자리 상태. */
export type PresenceState = "present" | "absent" | "cameraOff" | "unknown";
export const PRESENCE_STATES: PresenceState[] = ["present", "absent", "cameraOff", "unknown"];

/** 허용 시간 밖에서 자리가 비었거나(unauthorized) 카메라가 꺼져 있던(cameraOff) 구간. */
export interface AwaySpan {
  id: string;
  kind: "unauthorized" | "cameraOff";
  start: Instant;
  end: Instant | null;
}

export type AttendanceEventKind =
  | "checkIn"
  | "late"
  | "absentCandidate"
  | "tasksConfirmed"
  | "lunchStart"
  | "lunchEnd"
  | "awayStart"
  | "awayEnd"
  | "unauthorizedAwayStart"
  | "unauthorizedAwayEnd"
  | "cameraOff"
  | "cameraOn"
  | "checkoutReview"
  | "carryOver"
  | "dinnerStart"
  | "overtimeStart"
  | "overtimeEnd"
  | "supplementMissed"
  | "off"
  | "timeSkip"
  | "weeklyReport"
  | "note";

/** 근태 기록 한 줄. */
export interface AttendanceEvent {
  id: string;
  at: Instant;
  kind: AttendanceEventKind;
  text: string;
}

const WARNING_EVENTS: AttendanceEventKind[] = ["late", "absentCandidate", "unauthorizedAwayStart", "cameraOff", "supplementMissed"];
export const isWarningEvent = (e: AttendanceEvent) => WARNING_EVENTS.includes(e.kind);

/** 하루의 출근 판정. */
export type Attendance = "onTime" | "late" | "absentCandidate";
export const ATTENDANCE_LABEL: Record<Attendance, string> = { onTime: "정상 출근", late: "지각", absentCandidate: "결근 후보" };

export type OvertimeOutcome = "completed" | "ranToEnd" | "abandoned";
export const OVERTIME_LABEL: Record<OvertimeOutcome, string> = {
  completed: "추가근무 완료",
  ranToEnd: "추가근무 종료 시각까지 근무",
  abandoned: "보충근무 미이행",
};

// MARK: 오늘

export interface WorkDay {
  date: DayKey;
  phase: Phase;
  checkInAt: Instant | null;
  isLate: boolean;
  absentCandidate: boolean;
  /** 아침 PT 전사문. 연결에 실패해도 지우지 않는다. */
  transcript: string;
  drafts: TaskDraft[];
  draftSource: DraftSource | null;
  tasks: WorkTask[];
  confirmedAt: Instant | null;
  allowances: Allowance[];
  lunchUsed: boolean;
  awaySpans: AwaySpan[];
  events: AttendanceEvent[];
  checkoutAt: Instant | null;
  /** 퇴근 점검에서 추가근무에 배정된 업무. */
  overtimeTaskIds: string[];
  overtime: OvertimeOutcome | null;
  noMorningPT: boolean;
  weeklySubmitted: boolean;
}

export function newWorkDay(date: DayKey): WorkDay {
  return {
    date,
    phase: "beforeCheckIn",
    checkInAt: null,
    isLate: false,
    absentCandidate: false,
    transcript: "",
    drafts: [],
    draftSource: null,
    tasks: [],
    confirmedAt: null,
    allowances: [],
    lunchUsed: false,
    awaySpans: [],
    events: [],
    checkoutAt: null,
    overtimeTaskIds: [],
    overtime: null,
    noMorningPT: false,
    weeklySubmitted: false,
  };
}

export function attendanceOf(day: WorkDay): Attendance | null {
  if (day.checkInAt != null) return day.isLate ? "late" : "onTime";
  return day.absentCandidate ? "absentCandidate" : null;
}

/** 마감한 근무일의 요약. */
export interface DayRecord {
  date: DayKey;
  attendance: Attendance;
  checkInAt: Instant | null;
  checkoutAt: Instant | null;
  tasks: WorkTask[];
  unauthorizedAwayMinutes: number;
  cameraOffMinutes: number;
  overtime: OvertimeOutcome | null;
  noMorningPT: boolean;
  events: AttendanceEvent[];
}

// MARK: 사내 메일

export type MailParty = "me" | "manager" | "hr";

export type MailKind =
  | "welcome"
  | "notice"
  | "tasksConfirmed"
  | "lunchRequest"
  | "lunchApproval"
  | "carryReport"
  | "carryAccepted"
  | "overtimeAssigned"
  | "overtimeResult"
  | "supplementMissed"
  | "offConfirmed"
  | "attendance"
  | "weeklyReport"
  | "weeklyFeedback";

/** 메일 목록에 붙는 분류 이름. */
export function mailTag(kind: MailKind): string {
  switch (kind) {
    case "welcome":
      return "인사";
    case "notice":
      return "공지";
    case "tasksConfirmed":
    case "carryReport":
    case "carryAccepted":
      return "업무";
    case "weeklyReport":
      return "주간보고";
    case "weeklyFeedback":
      return "주간 피드백";
    default:
      return "근태";
  }
}

/** 답장을 누가 썼는지. 주간 피드백에만 쓴다. */
export type ReplySource = "solar" | "localTemplate";

export interface Mail {
  id: string;
  sentAt: Instant;
  from: MailParty;
  to: MailParty;
  kind: MailKind;
  subject: string;
  body: string;
  isRead: boolean;
  /** 주간보고 답장처럼 따뜻한 문체로 쓴 메일인지. 평소 업무 메일은 건조하게 쓴다. */
  isWarm: boolean;
  replySource: ReplySource | null;
}

export function newMail(fields: Pick<Mail, "sentAt" | "from" | "to" | "kind" | "subject" | "body"> & Partial<Mail>): Mail {
  return { id: crypto.randomUUID(), isRead: false, isWarm: false, replySource: null, ...fields };
}

export const isIncoming = (m: Mail) => m.to === "me";

// MARK: 등장인물

/** 사무실 사람들. 나를 뺀 모두가 AI다. */
export const Cast = {
  managerName: "한정민",
  peerNames: ["이하준", "박서윤"],
  teamName: "가상회사 1팀",
} as const;

export function partyName(party: MailParty, myName: string): string {
  switch (party) {
    case "me":
      return `${myName} 사원`;
    case "manager":
      return `${Cast.managerName} 팀장`;
    case "hr":
      return "인사팀";
  }
}

// MARK: 주간보고

export interface WeeklyReport {
  id: string;
  weekOf: DayKey;
  submittedAt: Instant | null;
  /** 이번 주 완료한 업무와 결과물 */
  completed: string;
  /** 미완료 업무와 이유 */
  incomplete: string;
  /** 다음 주 목표 */
  nextGoals: string;
  /** 상사 답장 메일. 아직 받지 못했으면 null. */
  replyMailId: string | null;
}

export function newWeeklyReport(weekOf: DayKey, fields: Partial<WeeklyReport> = {}): WeeklyReport {
  return {
    id: crypto.randomUUID(),
    weekOf,
    submittedAt: null,
    completed: "",
    incomplete: "",
    nextGoals: "",
    replyMailId: null,
    ...fields,
  };
}

/** 아직 쓰지 않은 칸의 이름. */
export function missingSections(r: Pick<WeeklyReport, "completed" | "incomplete" | "nextGoals">): string[] {
  const missing: string[] = [];
  if (!r.completed.trim()) missing.push("이번 주 완료한 업무와 결과물");
  if (!r.incomplete.trim()) missing.push("미완료 업무와 이유");
  if (!r.nextGoals.trim()) missing.push("다음 주 목표");
  return missing;
}

/** 메일과 Solar에 보내는 본문. */
export function weeklyBodyText(r: Pick<WeeklyReport, "completed" | "incomplete" | "nextGoals">): string {
  return [
    "1. 이번 주 완료한 업무와 결과물",
    r.completed.trim(),
    "",
    "2. 미완료 업무와 이유",
    r.incomplete.trim(),
    "",
    "3. 다음 주 목표",
    r.nextGoals.trim(),
  ].join("\n");
}

// MARK: 1단계 이월 보고

export interface CarryReport {
  /** 미완료 이유 */
  reason: string;
  /** 다음 근무일 완료 계획 */
  plan: string;
}

export const isCarryReportComplete = (r: CarryReport | undefined) => !!r && !!r.reason.trim() && !!r.plan.trim();
