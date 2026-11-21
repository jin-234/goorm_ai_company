/**
 * VISION COMPANY 데이터 모델(개정 기획서 4.5).
 * 근태·통제 대신 실행·설명·기록을 남긴다. 카메라·지각·강제 추가근무는 없다.
 */
import { WorkRules } from "./rules";
import type { DayKey, Instant } from "./time";

/** 저장 상태의 형식 번호. 형식이 바뀌면 옛 상태는 버리고 새로 시작한다. */
export const STATE_VERSION = 2;

// MARK: 사원(Profile)

export interface EmployeeProfile {
  name: string;
  /** 희망 직무. 예: 프런트엔드 개발 */
  targetRole: string;
  /** 현재 경험. 예: React 독학 3개월, 팀 프로젝트 1회 */
  experience: string;
  /** 사용자가 정한 활동 시작 시각(자정 기준 분). 강제하지 않고 안내에만 쓴다. */
  activityStart: number;
  /** 사용자가 정한 활동 마감 시각(자정 기준 분). 지나면 '마감할 때'라고 안내만 한다. */
  activityEnd: number;
}

export function defaultProfile(name = "김서울"): EmployeeProfile {
  return {
    name,
    targetRole: "",
    experience: "",
    activityStart: WorkRules.defaultActivityStart,
    activityEnd: WorkRules.defaultActivityEnd,
  };
}

// MARK: 하루의 단계

/** 단계는 사용자 행동으로만 넘어간다. 시각에 따른 강제 이동은 없다. */
export type Phase = "beforeCheckIn" | "morningPT" | "working" | "sharing" | "checkoutReview" | "off";

export const PHASES: Phase[] = ["beforeCheckIn", "morningPT", "working", "sharing", "checkoutReview", "off"];

export const PHASE_LABEL: Record<Phase, string> = {
  beforeCheckIn: "출근 전",
  morningPT: "아침보고",
  working: "수행 중",
  sharing: "기획팀 공유",
  checkoutReview: "하루 마감",
  off: "마감 완료",
};

// MARK: 과제(Task)

/** draft는 아침보고 초안(화면이 들고 있음), 서버에는 confirmed부터 저장한다. */
export type TaskStatus = "confirmed" | "in_progress" | "submitted" | "incomplete" | "reviewed";

/** 마감 때 제출하지 못한 과제의 처리. */
export type TaskOutcome = "adjust" | "carryOver" | "endToday";

export const TASK_OUTCOMES: TaskOutcome[] = ["adjust", "carryOver", "endToday"];

export const TASK_OUTCOME_LABEL: Record<TaskOutcome, string> = {
  adjust: "범위 조정",
  carryOver: "다음 활동일로 이월",
  endToday: "오늘 종료",
};

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  confirmed: "확정",
  in_progress: "진행 중",
  submitted: "제출함",
  incomplete: "미완료",
  reviewed: "마감 확인",
};

export interface WorkTask {
  id: string;
  title: string;
  /** 완료 기준. 무엇이 되면 끝인지. */
  completionCriteria: string;
  /** 공유 형태. 예: 화면 캡처와 3줄 설명 */
  shareForm: string;
  status: TaskStatus;
  confirmedAt: Instant;
  /** 이월된 과제라면 처음 확정한 날. */
  carriedFrom: DayKey | null;
  /** 이월 원본 ID. 여러 번 이월돼도 맨 처음 과제의 ID를 유지한다. */
  carriedFromTaskId: string | null;
  carryCount: number;
  /** 마감 때 고른 처리. 제출한 과제는 null. */
  outcome: TaskOutcome | null;
  /** 미완료 사유(선택). */
  outcomeReason: string;
}

export interface TaskInput {
  title: string;
  completionCriteria: string;
  shareForm: string;
}

export function newTask(fields: TaskInput & Partial<WorkTask> & { confirmedAt: Instant }): WorkTask {
  return {
    id: crypto.randomUUID(),
    status: "confirmed",
    carriedFrom: null,
    carriedFromTaskId: null,
    carryCount: 0,
    outcome: null,
    outcomeReason: "",
    ...fields,
  };
}

// MARK: 제출물(Submission)

export type SubmissionKind = "text" | "link" | "code";
export const SUBMISSION_KINDS: SubmissionKind[] = ["text", "link", "code"];

/**
 * 실제로 읽은 범위. 링크는 주소만 적은 것이라 본문을 읽지 않았다(notRead).
 * 글·코드는 붙여 넣은 내용 자체를 읽을 수 있다(read).
 */
export type ReadScope = "read" | "notRead";

export interface Submission {
  id: string;
  taskId: string;
  kind: SubmissionKind;
  content: string;
  at: Instant;
  readScope: ReadScope;
}

export const readScopeOf = (kind: SubmissionKind): ReadScope => (kind === "link" ? "notRead" : "read");

// MARK: 기획팀 공유(ReportTurn)

export type ShareState = "awaiting_explanation" | "clarifying" | "ready_to_summarize" | "user_confirmed";

/**
 * 기획자 질문의 근거 종류(사용자 원칙 2026-11-21).
 * - role_need: 기획자가 결정·책임지는 일(사용자 안내·화면 흐름·출시 범위)에 필요한 정보. 질문의 목적.
 * - ux_guide: 공개 UX·접근성 가이드로 구성한 시나리오(빈 화면·오류·로딩·입력처럼 놓치기 쉬운 상황). 질문의 소재.
 * - collected_case: 현직자 인터뷰 등에서 실제로 수집한 사례. 현실성 검증용.
 * 가이드로 만든 질문을 '실제 기획자가 했던 질문'으로 포장하지 않는다.
 */
export type QuestionBasis = "role_need" | "ux_guide" | "collected_case";
export const QUESTION_BASES: QuestionBasis[] = ["role_need", "ux_guide", "collected_case"];
/** 수집한 인터뷰 사례 데이터가 아직 없다. 생기기 전까지 collected_case는 ux_guide로 낮춘다(실제 사례인 척 방지). */
export const COLLECTED_CASES_AVAILABLE = false;

/** AI 기획자 응답(개정 기획서 4.3 E). */
export interface PlannerReply {
  acknowledgement: string;
  /** 질문이 필요 없거나 끝낼 때는 빈 문자열. */
  question: string;
  question_reason: string;
  /** 질문의 근거 종류. question이 비면 "". */
  question_basis: QuestionBasis | "";
  /** 근거 출처 이름(예: "W3C 오류·성공 알림 가이드"). 없거나 question이 비면 "". */
  basis_ref: string;
  known_facts: string[];
  open_questions: string[];
  evidence_refs: string[];
  can_finish: boolean;
}

/**
 * solar = AI가 답함.
 * sample = AI 연결 전 예시 응답(Solar 키가 없을 때). 대화는 실제처럼 이어지지만 화면에 '예시 응답(AI 연결 전)'으로 표시한다.
 * manual = AI를 부르다 실패해 정해진 안내 문구(AI가 말한 것처럼 표시하지 않는다).
 */
export type ColleagueSource = "solar" | "sample" | "manual";

export interface ShareTurn {
  id: string;
  role: "user" | "planner";
  at: Instant;
  /** 사용자가 쓴 글. */
  text?: string;
  /** 기획자 응답. */
  reply?: PlannerReply;
  source?: ColleagueSource;
}

/** AI 기획자 질문 상한(기본은 1~2개). 프롬프트와 규칙이 같이 쓴다. */
export const MAX_SHARE_QUESTIONS = WorkRules.maxShareQuestions;

export interface ShareSession {
  state: ShareState | null;
  questionCount: number;
  maxQuestions: number;
  turns: ShareTurn[];
  /** 기획자가 지금까지 알게 된 사실(마지막 응답의 known_facts). 반복 질문을 줄이는 데 쓴다. */
  knownFacts: string[];
  /** 아직 남은 질문(마지막 응답의 open_questions). */
  openQuestions: string[];
  /** 공유를 끝낸 방식. */
  endedBy: "done" | "userStopped" | "skipped" | null;
}

export function newShareSession(): ShareSession {
  return { state: null, questionCount: 0, maxQuestions: MAX_SHARE_QUESTIONS, turns: [], knownFacts: [], openQuestions: [], endedBy: null };
}

// MARK: 하루 마감(DailyReview)

/** 마감 요약(개정 기획서 4.3 E). */
export interface Review {
  reported_work: string;
  explained_learning: string;
  artifact_observations: string;
  shared_scope_and_limits: string;
  open_questions: string[];
  job_connection: string;
  next_action: string;
  evidence_refs: string[];
}

export const REVIEW_TEXT_FIELDS = [
  "reported_work",
  "explained_learning",
  "artifact_observations",
  "shared_scope_and_limits",
  "job_connection",
  "next_action",
] as const;
export const REVIEW_LIST_FIELDS = ["open_questions", "evidence_refs"] as const;

export function emptyReview(): Review {
  return {
    reported_work: "",
    explained_learning: "",
    artifact_observations: "",
    shared_scope_and_limits: "",
    open_questions: [],
    job_connection: "",
    next_action: "",
    evidence_refs: [],
  };
}

export interface DayReview {
  /** 지금 화면에 보이는 초안(사용자 수정 포함). */
  draft: Review | null;
  /** 초안을 처음 만든 곳. solar = AI 초안, manual = AI 미연결 수동 양식. */
  draftSource: ColleagueSource | null;
  /** AI가 만든 원래 초안. 사용자 수정과 구분해 보존한다. */
  aiDraft: Review | null;
  /** 사용자가 초안을 고쳤는지. */
  editedByUser: boolean;
  confirmed: Review | null;
  confirmedAt: Instant | null;
  choices: Record<string, TaskOutcome>;
}

export function newDayReview(): DayReview {
  return { draft: null, draftSource: null, aiDraft: null, editedByUser: false, confirmed: null, confirmedAt: null, choices: {} };
}

// MARK: 활동 기록(ActivityEvent)

export type ActivityEventKind =
  | "checkIn"
  | "goalSaved"
  | "tasksConfirmed"
  | "taskStatus"
  | "submission"
  | "shareStart"
  | "shareTurn"
  | "shareEnd"
  | "reviewDraft"
  | "reviewConfirmed"
  | "carryOver"
  | "endToday"
  | "adjust"
  | "timeSkip"
  | "weeklyReport"
  | "note";

export interface ActivityEvent {
  id: string;
  at: Instant;
  kind: ActivityEventKind;
  text: string;
  /** 대상 과제·제출물 ID. */
  targetId?: string;
}

// MARK: 오늘(DailySession)

/**
 * 출근 방식. 출입문에서 카메라로 자리에 앉은 얼굴을 확인했는지(camera), 카메라 없이 출근했는지(noCamera).
 * 기록만 하고 규칙·점수에 쓰지 않는다. 카메라 미사용은 불이익이 없다(개정 기획서 5장).
 */
export type CheckInMethod = "camera" | "noCamera";
export const CHECK_IN_METHODS: CheckInMethod[] = ["camera", "noCamera"];

export interface WorkDay {
  date: DayKey;
  phase: Phase;
  checkInAt: Instant | null;
  /** 출근 방식. 옛 저장 상태나 방식을 보내지 않은 출근은 null. */
  checkInMethod?: CheckInMethod | null;
  /** 아침보고에 쓴 오늘 목표 원문. */
  goal: string;
  tasks: WorkTask[];
  confirmedAt: Instant | null;
  submissions: Submission[];
  share: ShareSession;
  review: DayReview;
  events: ActivityEvent[];
  closedAt: Instant | null;
  weeklySubmitted: boolean;
}

export function newWorkDay(date: DayKey): WorkDay {
  return {
    date,
    phase: "beforeCheckIn",
    checkInAt: null,
    checkInMethod: null,
    goal: "",
    tasks: [],
    confirmedAt: null,
    submissions: [],
    share: newShareSession(),
    review: newDayReview(),
    events: [],
    closedAt: null,
    weeklySubmitted: false,
  };
}

/** 지난 활동일 기록. 출근하지 않은 날(휴식일)은 남기지 않는다. */
export interface DayRecord {
  date: DayKey;
  checkInAt: Instant;
  closedAt: Instant | null;
  goal: string;
  tasks: WorkTask[];
  submissions: Submission[];
  shareTurns: ShareTurn[];
  review: Review | null;
  /** 활동 인정 기준 초안: 제출물 또는 공유 설명이 있고 마감을 확정한 날. */
  counted: boolean;
}

// MARK: 사내 메일

export type MailParty = "me" | "manager" | "hr";

export type MailKind = "welcome" | "notice" | "tasksConfirmed" | "dayClosed" | "weeklyReport" | "weeklyFeedback";

export function mailTag(kind: MailKind): string {
  switch (kind) {
    case "welcome":
      return "안내";
    case "notice":
      return "공지";
    case "tasksConfirmed":
    case "dayClosed":
      return "업무";
    case "weeklyReport":
      return "주간보고";
    case "weeklyFeedback":
      return "주간 피드백";
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
  isWarm: boolean;
  replySource: ReplySource | null;
}

export function newMail(fields: Pick<Mail, "sentAt" | "from" | "to" | "kind" | "subject" | "body"> & Partial<Mail>): Mail {
  return { id: crypto.randomUUID(), isRead: false, isWarm: false, replySource: null, ...fields };
}

export const isIncoming = (m: Mail) => m.to === "me";

// MARK: 등장인물

/** 사무실 사람들. 나를 뺀 모두가 AI이고, 가상 역할이다. */
export const Cast = {
  managerName: "한정민",
  plannerName: "윤기획",
  plannerTeam: "서비스 기획팀",
  peerNames: ["이하준", "박서윤"],
  teamName: "개발팀",
  companyName: "VISION COMPANY",
} as const;

export function partyName(party: MailParty, myName: string): string {
  switch (party) {
    case "me":
      return `${myName} 사원`;
    case "manager":
      return `${Cast.managerName} 팀장 (AI)`;
    case "hr":
      return "인사팀";
  }
}

// MARK: 주간보고

export interface WeeklyReport {
  id: string;
  weekOf: DayKey;
  submittedAt: Instant | null;
  completed: string;
  incomplete: string;
  nextGoals: string;
  replyMailId: string | null;
}

export function newWeeklyReport(weekOf: DayKey, fields: Partial<WeeklyReport> = {}): WeeklyReport {
  return { id: crypto.randomUUID(), weekOf, submittedAt: null, completed: "", incomplete: "", nextGoals: "", replyMailId: null, ...fields };
}

export function missingSections(r: Pick<WeeklyReport, "completed" | "incomplete" | "nextGoals">): string[] {
  const missing: string[] = [];
  if (!r.completed.trim()) missing.push("이번 주 완료한 업무와 결과물");
  if (!r.incomplete.trim()) missing.push("미완료 업무와 이유");
  if (!r.nextGoals.trim()) missing.push("다음 주 목표");
  return missing;
}

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

// MARK: 옛 아침 PT 초안(전사문 → 업무 목록)
// pt-parser와 Solar checklist가 아직 이 모양을 쓴다. 새 흐름의 과제는 위 TaskInput이다.

/** @deprecated 옛 업무 중요도. 새 흐름에서는 쓰지 않는다. */
export type TaskLevel = 1 | 2 | 3;
export const isTaskLevel = (value: unknown): value is TaskLevel => value === 1 || value === 2 || value === 3;

/** @deprecated 옛 아침 PT 초안 한 줄. */
export interface TaskDraft {
  id: string;
  title: string | null;
  level: TaskLevel | null;
  due: number | null;
  doneCriteria: string | null;
  carriedFrom: DayKey | null;
  carryCount: number;
}

/** @deprecated */
export function newDraft(fields: Partial<TaskDraft> = {}): TaskDraft {
  return { id: crypto.randomUUID(), title: null, level: null, due: null, doneCriteria: null, carriedFrom: null, carryCount: 0, ...fields };
}

/** @deprecated */
export function missingFields(d: TaskDraft): string[] {
  const missing: string[] = [];
  if (!(d.title ?? "").trim()) missing.push("업무명");
  if (d.level == null) missing.push("중요도");
  if (d.due == null) missing.push("마감");
  if (!(d.doneCriteria ?? "").trim()) missing.push("완료 기준");
  return missing;
}
