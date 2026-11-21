/**
 * VISION COMPANY 데이터 모델(개정 기획서 4.5).
 * 실행·설명·기록이 중심이고, 지각·착석 확인·추가근무는 참여자가 고른 관리 강도에 따라서만 켜진다.
 */
import { DEFAULT_ENFORCEMENT, type EnforcementLevel, WorkRules } from "./rules";
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
  /** 관리 강도. 입사 때 고르고 설정에서 언제든 바꾼다. */
  enforcement: EnforcementLevel;
}

export function defaultProfile(name = "김서울"): EmployeeProfile {
  return {
    name,
    targetRole: "",
    experience: "",
    activityStart: WorkRules.defaultActivityStart,
    activityEnd: WorkRules.defaultActivityEnd,
    enforcement: DEFAULT_ENFORCEMENT,
  };
}

// MARK: 하루의 단계

/**
 * 가볍게: 단계는 사용자 행동으로만 넘어간다.
 * 보통·엄격: 마감 시각이 되면 퇴근 점검(checkout)으로, 2·3단계가 남으면 저녁시간 → 추가근무 → 추가근무 점검으로 시각에 따라 넘어간다.
 * 퇴근 점검·추가근무가 끝나면 수행(working)으로 돌아와 회의실 발표와 하루 마감을 한다.
 */
export type Phase =
  | "beforeCheckIn"
  | "morningPT"
  | "working"
  | "checkout"
  | "dinner"
  | "overtime"
  | "overtimeReview"
  | "sharing"
  | "checkoutReview"
  | "off";

export const PHASES: Phase[] = ["beforeCheckIn", "morningPT", "working", "checkout", "dinner", "overtime", "overtimeReview", "sharing", "checkoutReview", "off"];

export const PHASE_LABEL: Record<Phase, string> = {
  beforeCheckIn: "출근 전",
  morningPT: "아침보고",
  working: "수행 중",
  checkout: "퇴근 점검",
  dinner: "저녁시간",
  overtime: "추가근무",
  overtimeReview: "추가근무 점검",
  sharing: "회의실 발표",
  checkoutReview: "하루 마감",
  off: "마감 완료",
};

// MARK: 근태(보통·엄격)

export type AllowanceKind = "lunch" | "away" | "dinner";
export const ALLOWANCE_LABEL: Record<AllowanceKind, string> = { lunch: "점심", away: "자리 비움", dinner: "저녁시간" };

/** 착석 확인을 쉬는 허용 시간. */
export interface Allowance {
  id: string;
  kind: AllowanceKind;
  reason: string;
  start: Instant;
  end: Instant;
  /** 실제로 끝난 시각(일찍 복귀하면 end보다 이르다). */
  endedAt: Instant | null;
}

/** 자리 상태. 근무 중 카메라 판정(브라우저 안)이 바뀔 때만 이 값을 보낸다. 영상은 서버로 오지 않는다. */
export type PresenceState = "present" | "absent" | "cameraOff" | "unknown";
export const PRESENCE_STATES: PresenceState[] = ["present", "absent", "cameraOff", "unknown"];

/** 허용 시간 밖 자리 비움, 또는 카메라가 꺼져 있던 구간. */
export interface AwaySpan {
  id: string;
  kind: "unauthorized" | "cameraOff";
  start: Instant;
  end: Instant | null;
}

/** 추가근무 결과. completed = 다 끝냄, ranToEnd = 종료 시각까지 함, abandoned = 일찍 그만둠(보충근무 미이행), lowered = 강도를 낮춰 끝냄. */
export type OvertimeOutcome = "completed" | "ranToEnd" | "abandoned" | "lowered";

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
  /** 중요도(보통·엄격). 가볍게에서는 1로 둔다. 2·3단계가 마감 시각에 남으면 추가근무 대상이다. */
  level: TaskLevel;
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
  /** 중요도. 보통·엄격에서는 꼭 정한다. */
  level?: TaskLevel | null;
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
    level: fields.level ?? 1,
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

// MARK: 회의실 발표(ReportTurn) — 과제(파트)마다 그 일을 이어받을 부서 한 곳과 짧게 대화한다

/** 회의실에 오는 타 부서 AI 동료. */
export type MeetingRoleId = "planner" | "designer" | "operations";
/** 회의에 올 수 있는 부서. 파트를 맡길 부서를 고를 때 점수가 같으면 이 순서를 따른다. */
export const MEETING_ORDER: MeetingRoleId[] = ["planner", "designer", "operations"];
/** 회의 진행자. 어느 부서에도 맞지 않는 파트는 기획자가 듣는다. */
export const MEETING_HOST: MeetingRoleId = "planner";
/** 화면과 프롬프트가 같이 쓰는 이름. */
export const MEETING_ROLE_NAME: Record<MeetingRoleId, { title: string; department: string; short: string }> = {
  planner: { title: "AI 기획자", department: "서비스 기획팀", short: "기획자" },
  designer: { title: "AI 디자이너", department: "디자인팀", short: "디자이너" },
  operations: { title: "AI 운영 담당자", department: "운영팀", short: "운영 담당자" },
};

/**
 * 발표 한 파트(사용자 결정 2026-11-21: 세 부서 모두에게 설명하지 않고, 한 파트는 한 부서와 대화한다).
 * 파트는 오늘 확정한 과제 하나이고, 그 과제를 이어받을 부서 한 곳이 듣는다.
 */
export interface SharePart {
  taskId: string | null;
  title: string;
  role: MeetingRoleId;
}

/** 한 파트에서 부서가 할 수 있는 질문 수. 다 묻거나 더 물을 것이 없으면 마무리하고 다음 파트로 넘긴다. */
export const PART_MAX_QUESTIONS = 2;

/** 파트를 맡길 부서를 고르는 단서. 맞는 것이 없으면 기획자(MEETING_HOST)가 듣는다. */
const DEPARTMENT_HINTS: [MeetingRoleId, RegExp][] = [
  ["designer", /화면|UI|UX|디자인|레이아웃|버튼|페이지|컴포넌트|스타일|CSS|반응형|접근성|애니메이션|입력창|폼/gi],
  ["operations", /배포|운영|오류|에러|장애|로그|모니터|알림|서버|권한|보안|성능|백업|문의|이용\s*제한/gi],
];

/** 과제 글(제목·완료 기준)로 부서마다 점수를 매긴다. 제목은 두 배로 센다. */
function departmentScores(task: { title: string; completionCriteria?: string }): Record<MeetingRoleId, number> {
  const scores: Record<MeetingRoleId, number> = { planner: 0, designer: 0, operations: 0 };
  for (const [role, re] of DEPARTMENT_HINTS) {
    scores[role] += 2 * (task.title.match(re)?.length ?? 0) + (task.completionCriteria?.match(re)?.length ?? 0);
  }
  return scores;
}

/**
 * 과제마다 파트를 만들고 맡을 부서를 정한다. 가장 맞는 부서를 고르되, 이미 다른 파트를 맡은 부서보다
 * 단서가 있는 다른 부서를 먼저 고른다(같은 부서가 모든 파트를 듣지 않게). 과제가 없으면 기획자에게 한 파트.
 */
export function sharePartsOf(tasks: { id?: string; title: string; completionCriteria?: string }[]): SharePart[] {
  if (tasks.length === 0) return [{ taskId: null, title: "오늘 한 일", role: MEETING_HOST }];
  const used = new Set<MeetingRoleId>();
  return tasks.map((task) => {
    const scores = departmentScores(task);
    const ranked = MEETING_ORDER.filter((r) => scores[r] > 0).sort((a, b) => scores[b] - scores[a]);
    const role = ranked.find((r) => !used.has(r)) ?? ranked[0] ?? MEETING_HOST;
    used.add(role);
    return { taskId: task.id ?? null, title: task.title, role };
  });
}

/**
 * 대화 기록으로 지금 몇 번째 파트인지 계산한다. 부서가 질문 없이 말하면(마무리) 그 파트가 끝난다.
 * turnPart[i]는 i번째 턴이 속한 파트. 모든 파트가 끝난 뒤의 턴은 마지막 파트로 센다.
 */
export function sharePartState(parts: SharePart[], turns: ShareTurn[]): { index: number; done: boolean; askedInPart: number; turnPart: number[] } {
  const last = Math.max(0, parts.length - 1);
  let index = 0;
  let asked = 0;
  const turnPart: number[] = [];
  for (const t of turns) {
    turnPart.push(Math.min(index, last));
    if (t.role !== "planner") continue;
    if (t.reply?.question?.trim()) asked += 1;
    else {
      index += 1;
      asked = 0;
    }
  }
  const done = index >= parts.length;
  return { index: Math.min(index, last), done, askedInPart: done ? 0 : asked, turnPart };
}

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

/** 타 부서 AI 동료 응답(개정 기획서 4.3 E). */
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
  /** planner = 타 부서 AI 동료의 말(이름은 옛 기록과 맞추려고 그대로 둔다). 누가 말했는지는 speaker. */
  role: "user" | "planner";
  /** 말한 부서. 없으면(옛 기록) 기획자. */
  speaker?: MeetingRoleId;
  at: Instant;
  /** 사용자가 쓴 글. */
  text?: string;
  /** 동료 응답. */
  reply?: PlannerReply;
  source?: ColleagueSource;
}

/** 회의 전체 질문 상한의 기본값(파트 하나). 발표를 시작할 때 파트 수 × PART_MAX_QUESTIONS로 다시 정한다. */
export const MAX_SHARE_QUESTIONS = PART_MAX_QUESTIONS;

/** 동료 턴을 말한 부서. */
export const speakerOf = (t: ShareTurn): MeetingRoleId => t.speaker ?? "planner";

export interface ShareSession {
  state: ShareState | null;
  questionCount: number;
  maxQuestions: number;
  /** 발표 파트(과제마다 한 부서). 발표를 시작할 때 정한다. 없으면(옛 기록) 과제로 다시 만든다. */
  parts?: SharePart[];
  turns: ShareTurn[];
  /** 동료들이 지금까지 알게 된 사실(파트마다 마지막 응답의 known_facts를 이어 붙임). 반복 질문을 줄이는 데 쓴다. */
  knownFacts: string[];
  /** 아직 남은 질문(파트마다 마지막 응답의 open_questions를 이어 붙임). */
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
  | "note"
  | "enforcement"
  | "late"
  | "absentCandidate"
  | "dayOff"
  | "returned"
  | "lunchStart"
  | "lunchEnd"
  | "awayStart"
  | "awayEnd"
  | "unauthorizedAwayStart"
  | "unauthorizedAwayEnd"
  | "cameraOff"
  | "cameraOn"
  | "checkout"
  | "earlyLeave"
  | "dinnerStart"
  | "overtimeStart"
  | "overtimeEnd"
  | "supplementMissed";

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

  // 근태(보통·엄격). 가볍게에서는 비어 있다.
  /** 이 날 적용하는 강도. 출근할 때 정해지고, 설정에서 바꾸면 따라 바뀐다. */
  level: EnforcementLevel | null;
  /** 쉰 날 다음에 돌아온 날. 이 날은 지각으로 세지 않는다. */
  returning: boolean;
  /** 미리 알린 쉬는 날. 결근 후보로 세지 않는다. */
  dayOff: boolean;
  isLate: boolean;
  absentCandidate: boolean;
  presence: PresenceState;
  allowances: Allowance[];
  lunchUsed: boolean;
  awaySpans: AwaySpan[];
  /** 퇴근 점검을 마친 시각. */
  checkoutAt: Instant | null;
  /** 마감 시각 전에 마감할 때 적은 사유(엄격). */
  earlyLeaveReason: string;
  overtimeTaskIds: string[];
  overtime: OvertimeOutcome | null;
}

/** 저장된 하루에 없는 근태 칸(이전 형식)을 채울 기본값. */
export function attendanceDefaults(): Pick<
  WorkDay,
  | "level"
  | "returning"
  | "dayOff"
  | "isLate"
  | "absentCandidate"
  | "presence"
  | "allowances"
  | "lunchUsed"
  | "awaySpans"
  | "checkoutAt"
  | "earlyLeaveReason"
  | "overtimeTaskIds"
  | "overtime"
> {
  return {
    level: null,
    returning: false,
    dayOff: false,
    isLate: false,
    absentCandidate: false,
    presence: "unknown",
    allowances: [],
    lunchUsed: false,
    awaySpans: [],
    checkoutAt: null,
    earlyLeaveReason: "",
    overtimeTaskIds: [],
    overtime: null,
  };
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
    ...attendanceDefaults(),
  };
}

/**
 * 지난 활동일 기록. 출근한 날, 그리고 근태 집계에 필요한 날(결근 후보·미리 알린 쉬는 날)을 남긴다.
 * 가볍게에서 출근하지 않은 날은 남기지 않는다.
 */
export interface DayRecord {
  date: DayKey;
  checkInAt: Instant | null;
  closedAt: Instant | null;
  goal: string;
  tasks: WorkTask[];
  submissions: Submission[];
  shareTurns: ShareTurn[];
  review: Review | null;
  /** 활동 인정 기준 초안: 제출물 또는 공유 설명이 있고 마감을 확정한 날. */
  counted: boolean;
  /** 이 날 실제로 적용한 강도. 옛 기록은 없을 수 있다. */
  level?: EnforcementLevel | null;
  isLate?: boolean;
  absentCandidate?: boolean;
  dayOff?: boolean;
  overtime?: OvertimeOutcome | null;
  /** 허용 밖 자리 비움 합계(분). */
  unauthorizedAwayMinutes?: number;
}

// MARK: 사내 메일

export type MailParty = "me" | "manager" | "hr";

export type MailKind =
  | "welcome"
  | "notice"
  | "tasksConfirmed"
  | "dayClosed"
  | "attendance"
  | "lunchRequest"
  | "lunchApproval"
  | "overtimeAssigned"
  | "overtimeResult"
  | "supplementMissed"
  | "returnWelcome";

export function mailTag(kind: MailKind): string {
  switch (kind) {
    case "welcome":
      return "안내";
    case "notice":
      return "공지";
    case "tasksConfirmed":
    case "dayClosed":
      return "업무";
    case "attendance":
    case "lunchRequest":
    case "lunchApproval":
    case "overtimeAssigned":
    case "overtimeResult":
    case "supplementMissed":
      return "근태";
    case "returnWelcome":
      return "안내";
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

// MARK: 옛 아침 PT 초안(전사문 → 업무 목록)
// pt-parser와 Solar checklist가 아직 이 모양을 쓴다. 새 흐름의 과제는 위 TaskInput이다.

/** 과제 중요도(보통·엄격). 3단계가 가장 중요하다. 2·3단계가 마감 시각에 남으면 추가근무 대상이다. */
export type TaskLevel = 1 | 2 | 3;
export const TASK_LEVELS: TaskLevel[] = [1, 2, 3];
export const isTaskLevel = (value: unknown): value is TaskLevel => value === 1 || value === 2 || value === 3;
export const TASK_LEVEL_LABEL: Record<TaskLevel, string> = {
  1: "1단계 · 남으면 이월",
  2: "2단계 · 남으면 추가근무",
  3: "3단계 · 추가근무 때 먼저",
};

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
