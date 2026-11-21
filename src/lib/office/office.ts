/**
 * VISION COMPANY의 상태와 규칙(개정 기획서 3.1·4.5·6장 1단계).
 *
 * 하루: 입사 → 출근 → 아침보고(과제 확정) → 수행·제출 → 회의실 발표 → 하루 마감 → (다음 활동일)
 *
 * 관리 강도(참여자가 고름, 기본 보통):
 * - 가볍게: 단계는 사용자 행동으로만 넘어간다. 지각·착석 확인·추가근무가 없다.
 * - 보통: 출근 시각으로 지각·결근 후보를 기록하고, 근무 중 착석을 확인한다.
 *   마감 시각에 퇴근 점검을 하고 2·3단계 과제가 남으면 저녁시간 → 추가근무(3시간) → 추가근무 점검으로 넘어간다.
 * - 엄격: 보통에 더해 허용 밖 자리 비움을 짧아도 기록·경고하고, 마감 시각 전 마감에 사유를 받는다.
 * 놓친 날 복귀: 미리 알린 쉬는 날은 세지 않고, 돌아온 날은 지각으로 세지 않는다.
 *
 * 화면·네트워크와 무관한 순수 로직이라 그대로 시험할 수 있다.
 * 상태는 `toJSON()`으로 꺼내 저장하고 `Office.fromJSON()`으로 되살린다(새로고침 후 복원).
 */
import { MailTemplates } from "./mail-templates";
import {
  type ActivityEventKind,
  type Allowance,
  type AllowanceKind,
  ALLOWANCE_LABEL,
  attendanceDefaults,
  type AwaySpan,
  isTaskLevel,
  type OvertimeOutcome,
  type PresenceState,
  type CheckInMethod,
  type ColleagueSource,
  type DayRecord,
  defaultProfile,
  type EmployeeProfile,
  isIncoming,
  type Mail,
  MEETING_HOST,
  MEETING_ORDER,
  type MeetingRoleId,
  newTask,
  newWorkDay,
  type PlannerReply,
  readScopeOf,
  type Review,
  STATE_VERSION,
  type Submission,
  type SubmissionKind,
  TASK_OUTCOME_LABEL,
  type TaskInput,
  type TaskOutcome,
  type TaskStatus,
  type WorkDay,
  type WorkTask,
} from "./models";
import {
  DEFAULT_ENFORCEMENT,
  ENFORCEMENT,
  type EnforcementInfo,
  type EnforcementLevel,
  isEnforcementLevel,
  type MonthStats,
  OfficeError,
  WorkRules,
} from "./rules";
import {
  type DayKey,
  type Instant,
  addDays,
  addMinutes,
  at,
  Clock,
  dayKeyOf,
  dayString,
  hm,
  minuteOfDay,
  minutesBetween,
  mondayOfWeek,
  nextWorkday,
  sameDay,
} from "./time";

function makeDayFromString(key: string): DayKey {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** 저장하는 회사 상태 전체. */
export interface OfficeState {
  version: number;
  profile: EmployeeProfile;
  onboarded: boolean;
  /** 가상 시계의 현재 시각. */
  now: Instant;
  day: WorkDay;
  history: DayRecord[];
  mails: Mail[];
  /** 마감에서 이월을 고른 과제. 다음 활동일 아침보고 확정 때 목록 앞에 붙는다. */
  pendingCarry: WorkTask[];
  /** 미리 알린 쉬는 날("YYYY-MM-DD"). 결근 후보로 세지 않는다. */
  daysOff: string[];
}

export interface SkipResult {
  from: Instant;
  to: Instant;
  /** 보통·엄격에서 퇴근 점검·추가근무 시작·종료 시각에 멈추면 그 이유. 가볍게에서는 항상 null. */
  stoppedFor: string | null;
}

export type CheckoutResult = { kind: "noOvertime" } | { kind: "overtime"; count: number };

export interface OnboardInput {
  name: string;
  targetRole?: string;
  experience?: string;
  activityStart?: number;
  activityEnd?: number;
  enforcement?: EnforcementLevel;
}

export interface ConfirmInput {
  goal?: string;
  tasks: (TaskInput & { carryId?: string })[];
}

export interface ShareTurnInput {
  role: "user" | "planner";
  text?: string;
  reply?: PlannerReply;
  source?: ColleagueSource;
}

export interface CloseOutcome {
  submitted: number;
  adjusted: number;
  carried: number;
  ended: number;
}

/** a가 b보다 뒤 날짜인지. */
const dayAfter = (a: DayKey, b: DayKey) => at(a, 0) > at(b, 0);

/** 진행 중으로 보는 과제 상태(아직 마감 처리를 하지 않음). */
const OPEN_STATUSES: TaskStatus[] = ["confirmed", "in_progress", "submitted", "incomplete"];

/** 퇴근 점검·추가근무 단계. 가볍게로 낮추면 이 단계에서 빠져나온다. */
const OVERTIME_PHASES = ["checkout", "dinner", "overtime", "overtimeReview"] as const;

const isUnsubmitted = (t: WorkTask) => t.status !== "submitted" && t.status !== "reviewed";

export class Office implements OfficeState {
  version: number;
  profile: EmployeeProfile;
  onboarded: boolean;
  now: Instant;
  day: WorkDay;
  history: DayRecord[];
  mails: Mail[];
  pendingCarry: WorkTask[];
  daysOff: string[];

  constructor(startingAt: Instant, profile: EmployeeProfile = defaultProfile()) {
    this.version = STATE_VERSION;
    this.profile = profile;
    this.onboarded = false;
    this.now = startingAt;
    this.day = newWorkDay(dayKeyOf(startingAt));
    this.history = [];
    this.mails = [];
    this.pendingCarry = [];
    this.daysOff = [];
  }

  /** 저장된 상태가 지금 형식인지. 옛 근태 형식이면 false(새로 시작한다). */
  static isCurrent(state: unknown): state is OfficeState {
    return typeof state === "object" && state != null && (state as { version?: unknown }).version === STATE_VERSION;
  }

  static fromJSON(state: OfficeState): Office {
    const office = Object.create(Office.prototype) as Office;
    Object.assign(office, structuredClone(state));
    office.fillMissing();
    office.realNow = null;
    return office;
  }

  /** 관리 강도가 생기기 전에 저장한 상태에 없는 칸을 채운다. 기록은 지우지 않는다. */
  private fillMissing(): void {
    if (!isEnforcementLevel(this.profile.enforcement)) this.profile.enforcement = DEFAULT_ENFORCEMENT;
    const hadAttendance = "level" in this.day;
    this.day = { ...attendanceDefaults(), ...this.day };
    // 이미 시작한 하루는 지각·추가근무를 거슬러 적용하지 않는다.
    if (!hadAttendance && this.day.checkInAt != null) this.day.level = "light";
    for (const t of [...this.day.tasks, ...this.pendingCarry]) if (!isTaskLevel(t.level)) t.level = 1;
    this.daysOff ??= [];
  }

  toJSON(): OfficeState {
    return {
      version: this.version,
      profile: this.profile,
      onboarded: this.onboarded,
      now: this.now,
      day: this.day,
      history: this.history,
      mails: this.mails,
      pendingCarry: this.pendingCarry,
      daysOff: this.daysOff,
    };
  }

  /**
   * 이번 요청의 실제 시각(저장하지 않음). 세션이 요청마다 넣어 준다.
   * 다음 활동일로 넘어갈 때 실제 날짜가 이미 바뀌었는지 보는 데 쓴다.
   */
  realNow: Instant | null = null;

  // MARK: 시각

  get today(): DayKey {
    return this.day.date;
  }

  get activityEndDate(): Instant {
    return at(this.day.date, this.profile.activityEnd);
  }

  /** 사용자가 정한 마감 시각이 지났는지. 가볍게에서는 안내에만 쓴다. */
  get pastActivityEnd(): boolean {
    return this.day.phase !== "off" && this.day.phase !== "beforeCheckIn" && this.now >= this.activityEndDate;
  }

  /** 하루 시계가 멈추는 마지막 분(23:59). 저녁시간·추가근무는 자정을 넘기지 않는다. */
  private get lastMinuteDate(): Instant {
    return at(this.day.date, 24 * 60 - 1);
  }

  get dinnerEndDate(): Instant {
    return Math.min(addMinutes(this.activityEndDate, WorkRules.dinnerMinutes), this.lastMinuteDate);
  }

  get overtimeEndDate(): Instant {
    return Math.min(addMinutes(this.dinnerEndDate, WorkRules.overtimeMinutes), this.lastMinuteDate);
  }

  // MARK: 관리 강도

  /** 지금 적용하는 강도. 출근 전에는 입사·설정에서 고른 강도. */
  get level(): EnforcementLevel {
    return this.day.level ?? this.profile.enforcement;
  }

  get rules(): EnforcementInfo {
    return ENFORCEMENT[this.level];
  }

  /** 관리 강도를 바꾼다. 출근한 뒤라면 오늘부터 적용한다(이미 남은 지각·결근 기록은 지우지 않는다). */
  setEnforcement(level: EnforcementLevel): void {
    if (!isEnforcementLevel(level)) throw new OfficeError("invalidProfile", ["관리 강도는 가볍게·보통·엄격 중 하나입니다."]);
    if (this.profile.enforcement === level) return;
    this.profile.enforcement = level;
    if (this.day.checkInAt != null && this.day.phase !== "off") this.day.level = level;
    this.log("enforcement", `관리 강도 ${ENFORCEMENT[level].label}로 변경`);
    this.applyLevelChange();
  }

  /** 강도가 바뀐 뒤 지금 단계를 맞춘다. 가볍게가 되면 착석 확인·퇴근 점검·추가근무에서 빠져나온다. */
  private applyLevelChange(): void {
    const r = this.rules;
    if (!r.seatCheck) {
      this.endActiveAllowance(this.now);
      this.closeSpans(this.now);
    }
    const phase = this.day.phase;
    if (!r.checkoutAndOvertime && (OVERTIME_PHASES as readonly string[]).includes(phase)) {
      this.endActiveAllowance(this.now);
      this.closeSpans(this.now);
      if (phase !== "checkout") {
        this.day.overtime = "lowered";
        this.log("overtimeEnd", "강도를 낮춰 추가근무 없이 마감으로");
      }
      this.day.checkoutAt ??= this.now;
      this.day.phase = this.day.tasks.length > 0 ? "working" : "checkoutReview";
    }
    this.reconcilePresence(this.now);
    this.catchUp();
  }

  // MARK: 쉬는 날·복귀

  private isDayOff(date: DayKey): boolean {
    return this.daysOff.includes(dayString(date));
  }

  /** 쉬는 날을 미리 알린다(오늘 또는 앞으로의 날). 오늘이면 출근 전·결근 후보가 되기 전에만 된다. */
  setDayOff(off: boolean, date: DayKey = this.day.date): void {
    const key = dayString(date);
    const today = sameDay(date, this.day.date);
    if (!today && at(date, 0) < at(this.day.date, 0)) throw OfficeError.notAllowedNow("지난 날은 쉬는 날로 바꿀 수 없습니다.");
    if (today && (this.day.phase !== "beforeCheckIn" || this.day.absentCandidate)) {
      throw OfficeError.notAllowedNow("쉬는 날은 출근하기 전에, 결근 후보가 되기 전에 알려 주세요.");
    }
    this.daysOff = this.daysOff.filter((d) => d !== key);
    if (off) this.daysOff.push(key);
    if (today) {
      this.day.dayOff = off;
      this.log("dayOff", off ? "오늘은 쉬는 날로 알림" : "쉬는 날 알림 취소");
    }
  }

  // MARK: 근태 집계

  /** 이번 달 지각·결근 후보 횟수. */
  get monthStats(): MonthStats {
    const inMonth = (d: DayKey) => d.year === this.today.year && d.month === this.today.month;
    const days = [
      ...this.history.filter((r) => inMonth(r.date) && !sameDay(r.date, this.today)),
      { checkInAt: this.day.checkInAt, isLate: this.day.isLate, absentCandidate: this.day.absentCandidate },
    ];
    let late = 0;
    let absent = 0;
    for (const d of days) {
      if (d.absentCandidate) absent++;
      else if (d.checkInAt != null && d.isLate) late++;
    }
    return { late, absent };
  }

  // MARK: 입사

  /** 입사 정보를 저장한다. 입사 뒤에도 설정에서 다시 고칠 수 있다. */
  completeOnboarding(input: OnboardInput | string): void {
    const fields: OnboardInput = typeof input === "string" ? { name: input } : input;
    const next: EmployeeProfile = { ...this.profile };
    if (fields.name.trim()) next.name = fields.name.trim().slice(0, 40);
    if (fields.targetRole != null) next.targetRole = fields.targetRole.trim().slice(0, 100);
    if (fields.experience != null) next.experience = fields.experience.trim().slice(0, WorkRules.maxFieldLength);
    if (fields.activityStart != null) next.activityStart = fields.activityStart;
    if (fields.activityEnd != null) next.activityEnd = fields.activityEnd;
    if (fields.enforcement != null) {
      if (!isEnforcementLevel(fields.enforcement)) throw new OfficeError("invalidProfile", ["관리 강도는 가볍게·보통·엄격 중 하나입니다."]);
      next.enforcement = fields.enforcement;
    }
    if (!(next.activityStart >= 0 && next.activityEnd <= 24 * 60 && next.activityStart < next.activityEnd)) {
      throw new OfficeError("invalidProfile", ["활동 마감 시각은 시작 시각보다 늦어야 합니다."]);
    }
    const levelChanged = this.onboarded && next.enforcement !== this.profile.enforcement;
    const nextLevel = next.enforcement;
    next.enforcement = this.profile.enforcement;
    this.profile = next;
    if (levelChanged) this.setEnforcement(nextLevel);
    else this.profile.enforcement = nextLevel;
    if (this.onboarded) return;
    this.onboarded = true;
    this.post(MailTemplates.welcome(this.profile, addMinutes(this.now, -1)));
    this.post(MailTemplates.morningNotice(this.day.date, this.profile, this.pendingCarry, this.now));
  }

  // MARK: 출근

  get canCheckIn(): boolean {
    return this.onboarded && this.day.phase === "beforeCheckIn" && !this.day.absentCandidate;
  }

  /**
   * 출근한다. 출근 방식(camera·noCamera)은 기록만 한다.
   * 보통·엄격에서는 시작 시각보다 늦으면 지각으로 기록한다. 쉰 날 다음에 돌아온 날은 지각으로 세지 않는다.
   * 쉬는 날로 알렸어도 출근하면 알림을 거둔다.
   */
  checkIn(method: CheckInMethod | null = null): { checkInAt: Instant; method: CheckInMethod | null; late: boolean } {
    if (this.day.phase !== "beforeCheckIn") throw OfficeError.notAllowedNow("오늘은 이미 활동을 시작했습니다.");
    if (!this.onboarded) throw OfficeError.notAllowedNow("입사 정보를 먼저 확인해 주세요.");
    if (this.day.absentCandidate) throw OfficeError.notAllowedNow("오늘은 마감 시각까지 출근 기록이 없어 결근 후보로 남았습니다.\n다음 활동일에 출근해 주세요.");
    if (this.day.dayOff) this.setDayOff(false);
    this.day.level = this.profile.enforcement;
    this.day.checkInAt = this.now;
    this.day.checkInMethod = method;
    this.day.phase = "morningPT";
    this.day.presence = "present";
    const late = this.rules.attendance && !this.day.returning && minuteOfDay(this.now) > this.profile.activityStart;
    this.day.isLate = late;
    this.log("checkIn", `활동 시작 ${hm(this.now)}${method === "camera" ? " · 카메라 확인" : method === "noCamera" ? " · 카메라 없이" : ""}`);
    if (this.day.returning) this.log("returned", "다시 돌아옴 · 오늘은 지각으로 세지 않음");
    if (late) {
      this.log("late", `지각 · 기준 ${Clock.hm(this.profile.activityStart)}`);
      if (this.rules.attendance) this.post(MailTemplates.lateRecorded(this.now, this.profile, this.monthStats, this.now));
    }
    return { checkInAt: this.now, method, late };
  }

  // MARK: 아침보고

  /** 오늘 목표 원문을 저장한다(새로고침 후 복원용). */
  saveGoal(goal: string): void {
    if (this.day.phase !== "morningPT" && this.day.phase !== "working") {
      throw OfficeError.notAllowedNow("오늘 목표는 출근한 뒤 아침보고에서 적습니다.");
    }
    this.day.goal = goal.slice(0, WorkRules.maxFieldLength);
  }

  get canConfirmTasks(): boolean {
    return this.day.phase === "morningPT";
  }

  /**
   * 아침보고에서 오늘 과제를 확정한다.
   * 이월된 과제(pendingCarry)는 원본 ID를 보존한 채 목록 앞에 붙는다. 입력에 carryId로 같은 과제를 보내면 그 칸 값으로 고친다.
   */
  confirmTasks(input: ConfirmInput): WorkTask[] {
    if (!this.canConfirmTasks) throw OfficeError.notAllowedNow("과제 확정은 출근한 뒤 아침보고에서 합니다.");
    if (input.goal != null) this.day.goal = input.goal.slice(0, WorkRules.maxFieldLength);

    const edits = new Map(input.tasks.filter((t) => t.carryId).map((t) => [t.carryId!, t]));
    const fresh = input.tasks.filter((t) => !t.carryId);
    const rows: (TaskInput & { carried?: WorkTask })[] = [
      ...this.pendingCarry.map((c) => ({ ...c, ...(edits.get(c.id) ?? {}), carried: c })),
      ...fresh,
    ];
    if (rows.length === 0) throw new OfficeError("noTasks");
    if (rows.length > WorkRules.maxTasksPerDay) {
      throw OfficeError.notAllowedNow(`하루 과제는 ${WorkRules.maxTasksPerDay}건까지 확정할 수 있습니다.\n오늘 끝낼 작은 범위로 줄여 주세요.`);
    }
    const needLevel = this.rules.taskLevels;
    const missing = rows.flatMap((r, i) => {
      const lacks = [!r.title.trim() && "과제명", !r.completionCriteria.trim() && "완료 기준", needLevel && !isTaskLevel(r.level) && "중요도"].filter(Boolean);
      return lacks.length ? [`· ${r.title.trim() || `${i + 1}번째 과제`}: ${lacks.join(", ")}`] : [];
    });
    if (missing.length > 0) throw new OfficeError("taskIncomplete", missing);

    const clip = (s: string) => s.trim().slice(0, WorkRules.maxFieldLength);
    this.day.tasks = rows.map((r) =>
      newTask({
        title: clip(r.title),
        completionCriteria: clip(r.completionCriteria),
        shareForm: clip(r.shareForm ?? ""),
        level: isTaskLevel(r.level) ? r.level : (r.carried?.level ?? 1),
        confirmedAt: this.now,
        carriedFrom: r.carried?.carriedFrom ?? null,
        carriedFromTaskId: r.carried?.carriedFromTaskId ?? null,
        carryCount: r.carried?.carryCount ?? 0,
      }),
    );
    this.pendingCarry = [];
    this.day.confirmedAt = this.now;
    this.day.phase = "working";
    this.log("tasksConfirmed", `과제 ${this.day.tasks.length}건 확정 · 수행 시작`);
    this.post(MailTemplates.tasksConfirmed(this.day.tasks, this.now, needLevel));
    this.reconcilePresence(this.now);
    return this.day.tasks;
  }

  // MARK: 수행과 제출

  /** 과제 상태·제출물을 바꿀 수 있는 단계인지. */
  get canEditTasks(): boolean {
    return ["working", "checkout", "dinner", "overtime", "overtimeReview", "sharing", "checkoutReview"].includes(this.day.phase);
  }

  private taskOf(taskId: string): WorkTask {
    const task = this.day.tasks.find((t) => t.id === taskId);
    if (!task) throw new OfficeError("taskNotFound");
    return task;
  }

  submissionsOf(taskId: string): Submission[] {
    return this.day.submissions.filter((s) => s.taskId === taskId);
  }

  /**
   * 진행 상태를 바꾼다. in_progress로 되돌리기도 된다.
   * submitted는 제출물이 하나 이상 있어야 한다(제출과 완료는 다르다: 완료는 마감 확정 때 reviewed가 된다).
   */
  setTaskStatus(taskId: string, status: "in_progress" | "submitted" | "incomplete"): void {
    if (!this.canEditTasks) throw OfficeError.notAllowedNow("과제 상태는 과제를 확정한 뒤 마감 전까지 바꿀 수 있습니다.");
    const task = this.taskOf(taskId);
    if (task.status === status) return;
    if (status === "submitted" && this.submissionsOf(taskId).length === 0) throw new OfficeError("noSubmission");
    task.status = status;
    this.log("taskStatus", `${task.title} · ${{ in_progress: "진행 중", submitted: "제출 완료", incomplete: "미완료로 표시" }[status]}`, taskId);
  }

  /** 결과물을 제출한다. 여러 번 낼 수 있고, 상태는 바꾸지 않는다. 링크는 본문을 읽지 않은 것(notRead)으로 남긴다. */
  submitWork(taskId: string, kind: SubmissionKind, content: string): Submission {
    if (!this.canEditTasks) throw OfficeError.notAllowedNow("결과물은 과제를 확정한 뒤 마감 전까지 제출할 수 있습니다.");
    const task = this.taskOf(taskId);
    const body = kind === "code" ? content.replace(/\s+$/, "") : content.trim();
    if (!body.trim()) throw new OfficeError("emptySubmission");
    if (body.length > WorkRules.maxSubmissionLength) {
      throw OfficeError.notAllowedNow(`제출물은 ${WorkRules.maxSubmissionLength.toLocaleString("ko-KR")}자까지 올릴 수 있습니다.`);
    }
    if (kind === "link" && !/^https?:\/\/\S+$/i.test(body)) {
      throw OfficeError.notAllowedNow("링크는 http:// 또는 https://로 시작하는 주소 하나만 적어 주세요.");
    }
    const submission: Submission = { id: crypto.randomUUID(), taskId, kind, content: body, at: this.now, readScope: readScopeOf(kind) };
    this.day.submissions.push(submission);
    if (task.status === "confirmed") task.status = "in_progress";
    const what = { text: "글", code: "코드", link: "링크(본문은 읽지 않음)" }[kind];
    this.log("submission", `${task.title} · ${what} 제출`, submission.id);
    return submission;
  }

  // MARK: 회의실 발표

  get canStartSharing(): boolean {
    return this.day.phase === "working" && this.day.tasks.length > 0;
  }

  /**
   * 보통·엄격에서 마감 시각 전에 공유·마감으로 넘어가려 할 때 막아야 할 이유. 넘어가도 되면 null.
   * 2·3단계 과제가 남아 있으면 넘어갈 수 없고, 엄격에서는 사유를 받는다.
   */
  earlyLeaveBlocker(reason = ""): OfficeError | null {
    if (!this.isEarlyLeave) return null;
    const heavy = this.overtimeTargets;
    if (heavy.length > 0) return new OfficeError("heavyTasksLeft", heavy.map((t) => t.title));
    if (this.rules.earlyLeaveReason && !reason.trim()) return new OfficeError("earlyLeaveReason");
    return null;
  }

  /** 지금 마감으로 넘어가면 마감 시각 전 마감인지(보통·엄격, 퇴근 점검 전). */
  get isEarlyLeave(): boolean {
    return this.rules.checkoutAndOvertime && this.day.phase === "working" && this.day.checkoutAt == null && this.now < this.activityEndDate;
  }

  private leaveEarly(reason: string): void {
    if (!this.isEarlyLeave) return;
    const blocker = this.earlyLeaveBlocker(reason);
    if (blocker) throw blocker;
    this.day.checkoutAt = this.now;
    this.day.earlyLeaveReason = reason.trim().slice(0, WorkRules.maxFieldLength);
    this.endActiveAllowance(this.now);
    this.closeSpans(this.now);
    this.log("earlyLeave", `마감 시각(${Clock.hm(this.profile.activityEnd)}) 전 마감${this.day.earlyLeaveReason ? ` · ${this.day.earlyLeaveReason}` : ""}`);
  }

  startSharing(earlyReason = ""): void {
    if (!this.canStartSharing) throw OfficeError.notAllowedNow("회의실 발표는 과제를 확정하고 수행한 뒤에 시작합니다.");
    this.leaveEarly(earlyReason);
    this.closeSpans(this.now);
    this.day.phase = "sharing";
    this.day.share.state = "awaiting_explanation";
    this.log("shareStart", `회의실 발표 시작 ${hm(this.now)}`);
  }

  /**
   * 회의실에서 다음에 말할 동료. 기획자 → 디자이너 → 운영 담당자 순서로 한 번씩 말하고(질문은 하나까지),
   * 모두 말한 뒤에는 진행자(기획자)가 질문 없이 마무리한다.
   */
  get shareSpeaker(): { role: MeetingRoleId; canAsk: boolean } {
    const spoken = this.day.share.turns.filter((t) => t.role === "planner").length;
    return spoken < MEETING_ORDER.length ? { role: MEETING_ORDER[spoken], canAsk: true } : { role: MEETING_HOST, canAsk: false };
  }

  /**
   * 공유 대화 한 턴을 남긴다. 동료 턴은 차례(shareSpeaker)대로 말한 부서를 붙이고, 차례가 아닌 질문은 받지 않는다.
   * 사용자가 이미 답한 질문을 다시 묻지 않는 판단은 AI 쪽에서 하고, 여기서는 기록과 차례·상한만 지킨다.
   */
  recordShareTurn(input: ShareTurnInput): void {
    if (this.day.phase !== "sharing") throw OfficeError.notAllowedNow("발표 대화는 회의실 발표 중에만 남깁니다.");
    const share = this.day.share;
    if (input.role === "user") {
      const text = (input.text ?? "").trim();
      if (!text) throw OfficeError.notAllowedNow("설명할 내용을 적어 주세요.");
      share.turns.push({ id: crypto.randomUUID(), role: "user", at: this.now, text: text.slice(0, WorkRules.maxFieldLength) });
      if (share.state === "awaiting_explanation") share.state = "clarifying";
      this.log("shareTurn", "회의실에서 발표");
      return;
    }
    const reply = input.reply;
    if (!reply) throw OfficeError.notAllowedNow("동료 응답이 비어 있습니다.");
    const { role: speaker, canAsk } = this.shareSpeaker;
    const asks = reply.question.trim().length > 0;
    if (asks && (!canAsk || share.questionCount >= share.maxQuestions)) throw new OfficeError("shareQuestionLimit");
    share.turns.push({ id: crypto.randomUUID(), role: "planner", speaker, at: this.now, reply, source: input.source ?? "manual" });
    if (asks) share.questionCount += 1;
    share.knownFacts = [...reply.known_facts];
    share.openQuestions = [...reply.open_questions];
    // 질문이 없으면 다음 부서 차례로 넘어간다. 마지막 부서까지 말했고 질문이 없으면 정리할 수 있다.
    share.state = !asks && !this.shareSpeaker.canAsk ? "ready_to_summarize" : "clarifying";
  }

  /** 공유를 끝내고 하루 마감으로 간다. 수행 중에 바로 부르면 공유를 건너뛴 것으로 남긴다(공유가 맞지 않는 학습). */
  endSharing(reason: "done" | "userStopped" = "done", earlyReason = ""): void {
    const share = this.day.share;
    if (this.day.phase === "working" && this.day.tasks.length > 0) {
      this.leaveEarly(earlyReason);
      this.closeSpans(this.now);
      share.endedBy = "skipped";
      this.log("shareEnd", "회의실 발표 건너뜀");
    } else if (this.day.phase === "sharing") {
      share.endedBy = reason;
      if (share.turns.length > 0) share.state = "user_confirmed";
      this.log("shareEnd", reason === "done" ? "회의실 발표 마침" : "회의실 발표를 사용자가 종료");
    } else {
      throw OfficeError.notAllowedNow("회의실 발표 중이 아닙니다.");
    }
    this.day.phase = "checkoutReview";
  }

  // MARK: 하루 마감

  /** 마감 때 처리를 골라야 하는 과제(제출하지 않은 과제). */
  get unsubmittedTasks(): WorkTask[] {
    return this.day.tasks.filter(isUnsubmitted);
  }

  /**
   * 마감 요약 초안을 저장한다.
   * origin이 solar·manual이면 새 초안(AI 원본은 aiDraft에 따로 보존), user면 사용자 수정.
   */
  saveReviewDraft(review: Review, origin: ColleagueSource | "user" = "user"): void {
    if (this.day.phase !== "checkoutReview") throw OfficeError.notAllowedNow("마감 요약은 하루 마감에서 씁니다.");
    const r = this.day.review;
    if (origin === "user") {
      r.draft = structuredClone(review);
      r.editedByUser = true;
      if (r.draftSource == null) r.draftSource = "manual";
    } else {
      r.draft = structuredClone(review);
      r.draftSource = origin;
      r.aiDraft = origin === "manual" ? null : structuredClone(review);
      r.editedByUser = false;
    }
    this.log("reviewDraft", origin === "user" ? "마감 요약 수정 저장" : origin === "solar" ? "AI 마감 요약 초안" : "수동 마감 양식");
  }

  /**
   * 하루 마감을 확정한다. 제출한 과제는 reviewed가 되고, 제출하지 못한 과제는 고른 처리를 따른다.
   * - adjust: 오늘 범위를 줄인 것으로 보고 마감 확인(reviewed)
   * - carryOver: 미완료로 남기고 다음 활동일 목록에 원본 ID를 보존해 붙인다
   * - endToday: 미완료로 남기고 오늘 종료 기록만 남긴다
   */
  confirmReview(review: Review, choices: Record<string, TaskOutcome>, reasons: Record<string, string> = {}): CloseOutcome {
    if (this.day.phase !== "checkoutReview") throw OfficeError.notAllowedNow("하루 마감은 공유를 마친 뒤에 확정합니다.");
    const pending = this.unsubmittedTasks;
    const missing = pending.filter((t) => !choices[t.id]);
    if (missing.length > 0) throw new OfficeError("choiceMissing", missing.map((t) => t.title));

    const result: CloseOutcome = { submitted: 0, adjusted: 0, carried: 0, ended: 0 };
    for (const task of this.day.tasks) {
      if (task.status === "submitted") {
        task.status = "reviewed";
        result.submitted++;
        continue;
      }
      if (task.status === "reviewed") continue;
      const choice = choices[task.id];
      task.outcome = choice;
      task.outcomeReason = (reasons[task.id] ?? "").trim().slice(0, WorkRules.maxFieldLength);
      if (choice === "adjust") {
        task.status = "reviewed";
        result.adjusted++;
        this.log("adjust", `${task.title} · 범위 조정`, task.id);
      } else {
        task.status = "incomplete";
        if (choice === "carryOver") {
          result.carried++;
          this.pendingCarry.push({
            ...task,
            id: crypto.randomUUID(),
            status: "confirmed",
            outcome: null,
            outcomeReason: "",
            carriedFrom: task.carriedFrom ?? this.day.date,
            carriedFromTaskId: task.carriedFromTaskId ?? task.id,
            carryCount: task.carryCount + 1,
          });
          this.log("carryOver", `${task.title} · 다음 활동일로 이월`, task.id);
        } else {
          result.ended++;
          this.log("endToday", `${task.title} · 오늘 종료`, task.id);
        }
      }
    }
    const r = this.day.review;
    r.choices = { ...choices };
    r.confirmed = structuredClone(review);
    r.confirmedAt = this.now;
    if (r.draft == null) r.draft = structuredClone(review);
    this.day.phase = "off";
    this.day.closedAt = this.now;
    this.log("reviewConfirmed", `하루 마감 확정 ${hm(this.now)}`);
    this.post(MailTemplates.dayClosed(this.day.date, this.day.tasks, review.next_action, this.now));
    return result;
  }

  // MARK: 점심과 자리 비움(보통·엄격)

  /** 지금 적용 중인 허용 시간. */
  get activeAllowance(): Allowance | null {
    for (let i = this.day.allowances.length - 1; i >= 0; i--) {
      if (this.day.allowances[i].endedAt == null) return this.day.allowances[i];
    }
    return null;
  }

  get canRequestLunch(): boolean {
    return this.rules.allowances && this.day.phase === "working" && !this.day.lunchUsed && this.activeAllowance == null;
  }

  /** 사내 메일로 점심을 요청한다. 수락되면 1시간(마감 시각을 넘지 않게). 하루 한 번. */
  requestLunch(): Allowance {
    if (!this.rules.allowances) throw OfficeError.notAllowedNow("지금 관리 강도에서는 점심을 따로 등록하지 않습니다.");
    if (this.day.phase !== "working") throw OfficeError.notAllowedNow("점심 요청은 근무 중에 할 수 있습니다.");
    if (this.day.lunchUsed) throw new OfficeError("lunchAlreadyUsed");
    if (this.activeAllowance) throw new OfficeError("allowanceActive");
    const limit = this.activityEndDate > this.now ? this.activityEndDate : Infinity;
    const allowance = this.makeAllowance("lunch", "점심", this.now, Math.min(addMinutes(this.now, WorkRules.lunchMinutes), limit));
    this.closeSpans(this.now);
    this.day.allowances.push(allowance);
    this.day.lunchUsed = true;
    this.post(MailTemplates.lunchRequest(this.profile.name, this.now));
    this.post(MailTemplates.lunchApproval(allowance, this.now));
    this.log("lunchStart", `점심 승인 ${hm(allowance.start)}~${hm(allowance.end)}`);
    return allowance;
  }

  get canRegisterAway(): boolean {
    return this.rules.allowances && (this.day.phase === "working" || this.day.phase === "overtime") && this.activeAllowance == null;
  }

  /** 사유를 등록하고 자리를 비운다. 건당 15분. */
  registerAway(reason: string): Allowance {
    if (!this.rules.allowances) throw OfficeError.notAllowedNow("지금 관리 강도에서는 자리 비움을 등록하지 않아도 됩니다.");
    if (this.day.phase !== "working" && this.day.phase !== "overtime") throw OfficeError.notAllowedNow("자리 비움 등록은 근무 중에 할 수 있습니다.");
    const trimmed = reason.trim().slice(0, 100);
    if (!trimmed) throw new OfficeError("emptyReason");
    if (this.activeAllowance) throw new OfficeError("allowanceActive");
    const boundary = this.day.phase === "overtime" ? this.overtimeEndDate : this.activityEndDate;
    const limit = boundary > this.now ? boundary : Infinity;
    const allowance = this.makeAllowance("away", trimmed, this.now, Math.min(addMinutes(this.now, WorkRules.awayMinutes), limit));
    this.closeSpans(this.now);
    this.day.allowances.push(allowance);
    this.log("awayStart", `자리 비움 등록 ${hm(allowance.start)}~${hm(allowance.end)} · ${trimmed}`);
    return allowance;
  }

  /** 허용 시간이 끝나기 전에 복귀한다. 저녁시간은 정해진 시각에 끝난다. */
  returnFromAllowance(): void {
    const allowance = this.activeAllowance;
    if (!allowance || allowance.kind === "dinner") return;
    allowance.endedAt = this.now;
    this.log(allowance.kind === "lunch" ? "lunchEnd" : "awayEnd", `${ALLOWANCE_LABEL[allowance.kind]} 복귀 ${hm(this.now)}`);
    this.reconcilePresence(this.now);
  }

  private makeAllowance(kind: AllowanceKind, reason: string, start: Instant, end: Instant): Allowance {
    return { id: crypto.randomUUID(), kind, reason, start, end, endedAt: null };
  }

  /** 등록한 종료 시각이 지난 허용 시간을 끝낸다. 저녁시간은 단계 전환에서 끝낸다. */
  private expireAllowances(): void {
    for (const allowance of this.day.allowances) {
      if (allowance.endedAt != null || allowance.end > this.now || allowance.kind === "dinner") continue;
      allowance.endedAt = allowance.end;
      this.log(allowance.kind === "lunch" ? "lunchEnd" : "awayEnd", `${ALLOWANCE_LABEL[allowance.kind]} 허용 종료 ${hm(allowance.end)} · 착석 확인 재개`, undefined, allowance.end);
      this.reconcilePresence(allowance.end);
    }
  }

  private endActiveAllowance(time: Instant): void {
    for (const allowance of this.day.allowances) {
      if (allowance.endedAt == null) allowance.endedAt = Math.max(allowance.start, Math.min(time, allowance.end));
    }
  }

  // MARK: 착석 확인(보통·엄격)

  /** 지금 착석을 확인하는 중인지. 허용 시간 안에서는 쉰다. */
  get isMonitoring(): boolean {
    return this.rules.seatCheck && (this.day.phase === "working" || this.day.phase === "overtime") && this.activeAllowance == null;
  }

  /**
   * 자리 상태를 알린다. 화면의 착석 확인 카메라(SeatMonitor)가 판정이 바뀔 때만 보낸다.
   * 영상은 서버로 오지 않는다. 카메라가 꺼진 시간은 자리 비움으로 세지 않는다.
   */
  observePresence(state: PresenceState): void {
    if (!this.rules.seatCheck) throw OfficeError.notAllowedNow("지금 관리 강도에서는 착석을 확인하지 않습니다.");
    if (state === this.day.presence) return;
    this.day.presence = state;
    this.reconcilePresence(this.now);
  }

  /** 허용 밖에서 자리가 비어 있던 시간(분). */
  get unauthorizedAwayMinutes(): number {
    return this.spanMinutes("unauthorized");
  }

  get cameraOffMinutes(): number {
    return this.spanMinutes("cameraOff");
  }

  private spanMinutes(kind: AwaySpan["kind"]): number {
    return this.day.awaySpans.filter((s) => s.kind === kind).reduce((sum, s) => sum + Math.max(0, minutesBetween(s.start, s.end ?? this.now)), 0);
  }

  openSpan(kind: AwaySpan["kind"]): AwaySpan | null {
    for (let i = this.day.awaySpans.length - 1; i >= 0; i--) {
      const span = this.day.awaySpans[i];
      if (span.kind === kind && span.end == null) return span;
    }
    return null;
  }

  /** 지금 허용 밖 자리 비움을 경고로 보여야 하는지. 보통은 15분이 넘었을 때만, 엄격은 바로. */
  get awayWarning(): boolean {
    const open = this.openSpan("unauthorized");
    if (!open) return false;
    return this.rules.strictAway || minutesBetween(open.start, this.now) >= WorkRules.standardAwayGraceMinutes;
  }

  private reconcilePresence(time: Instant): void {
    this.syncSpan("unauthorized", this.isMonitoring && this.day.presence === "absent", time);
    this.syncSpan("cameraOff", this.isMonitoring && this.day.presence === "cameraOff", time);
  }

  private syncSpan(kind: AwaySpan["kind"], wanted: boolean, time: Instant): void {
    const open = this.openSpan(kind);
    if (wanted && !open) {
      this.day.awaySpans.push({ id: crypto.randomUUID(), kind, start: time, end: null });
      if (kind === "cameraOff") this.log("cameraOff", `카메라 꺼짐 ${hm(time)} · 자리 비움으로 세지 않음`, undefined, time);
      else if (this.rules.strictAway) this.log("unauthorizedAwayStart", `등록하지 않은 자리 비움 시작 ${hm(time)}`, undefined, time);
    } else if (!wanted && open) {
      this.closeSpan(open, time);
    }
  }

  /** 구간을 닫는다. 보통에서 15분보다 짧은 허용 밖 자리 비움은 기록하지 않고 지운다. */
  private closeSpan(span: AwaySpan, time: Instant): void {
    if (span.end != null) return;
    const end = Math.max(time, span.start);
    const minutes = Math.max(0, minutesBetween(span.start, end));
    if (span.kind === "unauthorized" && !this.rules.strictAway && minutes < WorkRules.standardAwayGraceMinutes) {
      this.day.awaySpans = this.day.awaySpans.filter((s) => s.id !== span.id);
      return;
    }
    span.end = end;
    if (span.kind === "unauthorized") this.log("unauthorizedAwayEnd", `복귀 ${hm(end)} · 등록하지 않은 자리 비움 ${Clock.duration(minutes)}`, undefined, end);
    else this.log("cameraOn", `카메라 다시 켜짐 ${hm(end)} · 꺼짐 ${Clock.duration(minutes)}`, undefined, end);
  }

  private closeSpans(time: Instant): void {
    for (const span of [...this.day.awaySpans]) if (span.end == null) this.closeSpan(span, time);
  }

  // MARK: 퇴근 점검과 추가근무(보통·엄격)

  /** 추가근무 대상: 제출하지 않은 2·3단계 과제. 3단계가 먼저다. */
  get overtimeTargets(): WorkTask[] {
    return this.day.tasks.filter((t) => isUnsubmitted(t) && t.level >= 2).sort((a, b) => b.level - a.level);
  }

  /** 추가근무에 배정된 과제. */
  get overtimeTasks(): WorkTask[] {
    return this.day.tasks.filter((t) => this.day.overtimeTaskIds.includes(t.id)).sort((a, b) => b.level - a.level);
  }

  /**
   * 퇴근 점검을 제출한다. 2·3단계가 남지 않았으면 회의실 발표와 하루 마감으로,
   * 남았으면 저녁시간(마감 시각부터 1시간) 뒤 추가근무(3시간)로 간다. 1단계는 하루 마감에서 처리를 고른다.
   */
  submitCheckout(): CheckoutResult {
    if (this.day.phase !== "checkout") throw OfficeError.notAllowedNow("퇴근 점검은 마감 시각에 진행합니다.");
    const heavy = this.overtimeTargets;
    this.day.checkoutAt = this.now;
    if (heavy.length === 0) {
      this.day.phase = this.day.tasks.length > 0 ? "working" : "checkoutReview";
      this.log("checkout", "퇴근 점검 · 추가근무 없음");
      return { kind: "noOvertime" };
    }
    this.day.phase = "dinner";
    this.day.overtimeTaskIds = heavy.map((t) => t.id);
    this.day.allowances.push(this.makeAllowance("dinner", "저녁시간", this.activityEndDate, this.dinnerEndDate));
    this.post(MailTemplates.overtimeAssigned(heavy, [this.activityEndDate, this.dinnerEndDate], [this.dinnerEndDate, this.overtimeEndDate], this.now));
    this.log("dinnerStart", `저녁시간 ${hm(this.activityEndDate)}~${hm(this.dinnerEndDate)} · 추가근무 ${heavy.length}건 배정`);
    this.catchUp();
    return { kind: "overtime", count: heavy.length };
  }

  get canEndOvertime(): boolean {
    return this.day.phase === "dinner" || this.day.phase === "overtime" || this.day.phase === "overtimeReview";
  }

  /**
   * 추가근무를 끝낸다. 배정 과제를 다 냈으면 완료, 종료 시각이 지나 점검 중이면 종료 시각까지 한 것,
   * 그 전에 그만두면 보충근무 미이행으로 기록한다. 끝나면 회의실 발표·하루 마감으로 간다.
   */
  endOvertime(): OvertimeOutcome {
    if (!this.canEndOvertime) throw OfficeError.notAllowedNow("추가근무 중이 아닙니다.");
    const remaining = this.overtimeTasks.filter(isUnsubmitted);
    const reviewing = this.day.phase === "overtimeReview";
    this.endActiveAllowance(this.now);
    this.closeSpans(this.now);
    let outcome: OvertimeOutcome;
    if (remaining.length === 0) {
      outcome = "completed";
      this.post(MailTemplates.overtimeResult(true, [], this.now));
      this.log("overtimeEnd", `추가근무 완료 ${hm(this.now)}`);
    } else if (reviewing) {
      outcome = "ranToEnd";
      this.post(MailTemplates.overtimeResult(false, remaining, this.now));
      this.log("overtimeEnd", `추가근무 종료 · 남은 과제 ${remaining.length}건`);
    } else {
      outcome = "abandoned";
      this.post(MailTemplates.supplementMissed(remaining, this.overtimeEndDate, this.now));
      this.log("supplementMissed", `보충근무 미이행 · 남은 과제 ${remaining.length}건`);
    }
    this.day.overtime = outcome;
    this.day.phase = "working";
    return outcome;
  }

  // MARK: 가상 시계

  /** 시계를 `target`까지 흐르게 한다. 뒤로 가지 않고 하루를 넘기지 않는다. 보통·엄격에서는 시각에 따른 단계 전환을 반영한다. */
  advance(target: Instant): void {
    if (target <= this.now) return;
    this.now = Math.min(target, at(this.day.date, 24 * 60 - 1));
    this.catchUp();
  }

  get canSkipHour(): boolean {
    if (!this.onboarded || minuteOfDay(this.now) >= 23 * 60) return false;
    switch (this.day.phase) {
      case "off":
      case "checkout":
      case "overtimeReview":
        return false;
      case "beforeCheckIn":
        return !this.day.absentCandidate;
      default:
        return true;
    }
  }

  /** 지금 단계가 시각으로 끝나는 경계(보통·엄격). */
  private get phaseBoundary(): { date: Instant; why: string } | null {
    if (!this.rules.attendance && !this.rules.checkoutAndOvertime) return null;
    switch (this.day.phase) {
      case "beforeCheckIn":
        return this.rules.attendance && !this.day.absentCandidate && !this.day.dayOff ? { date: this.activityEndDate, why: "마감 시각" } : null;
      case "morningPT":
      case "working":
        return this.rules.checkoutAndOvertime && this.day.checkoutAt == null ? { date: this.activityEndDate, why: "퇴근 점검 시각" } : null;
      case "dinner":
        return { date: this.dinnerEndDate, why: "추가근무 시작 시각" };
      case "overtime":
        return { date: this.overtimeEndDate, why: "추가근무 종료 시각" };
      default:
        return null;
    }
  }

  /**
   * 시연용: 다음 정각으로 보낸다. 다음 정각까지 30분이 안 남았으면 그다음 정각.
   * 보통·엄격에서 퇴근 점검·추가근무 시작·종료 시각이 그 사이에 있으면 그 시각에서 멈춘다.
   * 건너뛴 시간은 자리를 본 것이 없으므로 자리 비움으로 세지 않는다.
   */
  skipHour(): SkipResult | null {
    if (!this.canSkipHour) return null;
    const from = this.now;
    const minute = minuteOfDay(from);
    let nextHour = (Math.floor(minute / 60) + 1) * 60;
    if (nextHour - minute < 30) nextHour += 60;
    let target = at(this.day.date, Math.min(nextHour, 24 * 60 - 1));
    let stoppedFor: string | null = null;
    const boundary = this.phaseBoundary;
    if (boundary && from < boundary.date && boundary.date <= target) {
      stoppedFor = boundary.date < target ? boundary.why : null;
      target = boundary.date;
    }
    this.closeSpans(from);
    this.now = Math.min(target, at(this.day.date, 24 * 60 - 1));
    this.catchUp();
    this.reconcilePresence(this.now);
    return { from, to: this.now, stoppedFor };
  }

  /** 시각이 바뀐 뒤 허용 시간 만료와 단계 전환(보통·엄격)을 반영한다. */
  private catchUp(): void {
    this.expireAllowances();
    const r = this.rules;
    const end = this.activityEndDate;

    if (this.day.phase === "beforeCheckIn" && this.onboarded && r.attendance && !this.day.absentCandidate && !this.day.dayOff && this.now >= end) {
      this.markAbsent(end);
    }

    if (r.checkoutAndOvertime && (this.day.phase === "morningPT" || this.day.phase === "working") && this.day.checkoutAt == null && this.now >= end) {
      this.endActiveAllowance(end);
      this.closeSpans(end);
      this.day.phase = "checkout";
      this.log("checkout", `${Clock.hm(this.profile.activityEnd)} 퇴근 점검`, undefined, end);
    }

    if (this.day.phase === "dinner" && this.now >= this.dinnerEndDate) {
      this.endActiveAllowance(this.dinnerEndDate);
      this.day.phase = "overtime";
      this.log("overtimeStart", `${hm(this.dinnerEndDate)} 추가근무 시작 · 3단계부터 진행`, undefined, this.dinnerEndDate);
      this.reconcilePresence(this.dinnerEndDate);
    }

    if (this.day.phase === "overtime" && this.now >= this.overtimeEndDate) {
      this.endActiveAllowance(this.overtimeEndDate);
      this.closeSpans(this.overtimeEndDate);
      this.day.phase = "overtimeReview";
      this.log("overtimeEnd", `${hm(this.overtimeEndDate)} 추가근무 종료 시각`, undefined, this.overtimeEndDate);
    }
  }

  private markAbsent(time: Instant): void {
    this.day.absentCandidate = true;
    this.log("absentCandidate", "출근 기록 없음 · 결근 후보", undefined, time);
    if (this.rules.attendance) this.post(MailTemplates.absentCandidate(this.day.date, this.profile, this.monthStats, time));
  }

  // MARK: 다음 활동일

  /** 마감했거나, 오늘 활동을 시작하지 않았으면(휴식일) 다음 활동일로 넘어갈 수 있다. */
  get canStartNextWorkday(): boolean {
    return this.onboarded && (this.day.phase === "off" || this.day.phase === "beforeCheckIn");
  }

  /**
   * 다음 활동일로 간다. 보통·엄격에서 출근하지 않고 넘기면(쉬는 날로 알리지 않았다면) 결근 후보로 남긴다.
   * 출근하지 않은 날 다음 날은 '돌아온 날'로 시작한다.
   */
  startNextWorkday(): void {
    if (!this.canStartNextWorkday) throw OfficeError.notAllowedNow("하루 마감을 확정한 뒤에 다음 활동일로 넘어갈 수 있습니다.");
    const missed = this.day.checkInAt == null;
    if (missed && this.rules.attendance && !this.day.dayOff && !this.day.absentCandidate) this.markAbsent(this.now);
    const real = this.realNow;
    // 며칠 앱을 열지 않았다가 돌아온 경우도 '돌아온 날'이다. 열지 않은 날은 결근 후보로 세지 않는다.
    const skippedDays = real != null && dayAfter(dayKeyOf(real), nextWorkday(this.day.date));
    const everCheckedIn = this.day.checkInAt != null || this.history.some((r) => r.checkInAt != null);
    const returning = (missed && (everCheckedIn || this.day.returning)) || (skippedDays && everCheckedIn);
    this.archiveDay();
    // 실제 날짜(한국 시각)가 이미 지났으면 실제 오늘·지금 시각으로 시작한다.
    // 같은 날 시연으로 누르면 다음 근무일 활동 시작 5분 전으로 건너뛴다(그만큼 실제보다 앞서 간다).
    if (real != null && dayAfter(dayKeyOf(real), this.day.date)) {
      this.beginDay(dayKeyOf(real), Math.max(real, this.now), returning);
    } else {
      const next = nextWorkday(this.day.date);
      this.beginDay(next, at(next, Math.max(0, this.profile.activityStart - WorkRules.minutesBeforeStart)), returning);
    }
  }

  private archiveDay(): void {
    if (this.day.checkInAt == null && !this.day.absentCandidate && !this.day.dayOff) return;
    const shareTurns = this.day.share.turns;
    const record: DayRecord = {
      date: this.day.date,
      checkInAt: this.day.checkInAt,
      closedAt: this.day.closedAt,
      goal: this.day.goal,
      tasks: this.day.tasks,
      submissions: this.day.submissions,
      shareTurns,
      review: this.day.review.confirmed,
      counted: this.day.closedAt != null && (this.day.submissions.length > 0 || shareTurns.some((t) => t.role === "user")),
      level: this.day.checkInAt != null ? this.level : null,
      isLate: this.day.isLate,
      absentCandidate: this.day.absentCandidate,
      dayOff: this.day.dayOff,
      overtime: this.day.overtime,
      unauthorizedAwayMinutes: this.unauthorizedAwayMinutes,
    };
    this.history = this.history.filter((r) => !sameDay(r.date, record.date));
    this.history.push(record);
  }

  private beginDay(date: DayKey, now: Instant, returning = false): void {
    this.day = newWorkDay(date);
    this.day.dayOff = this.isDayOff(date);
    this.day.returning = returning;
    this.daysOff = this.daysOff.filter((d) => at(makeDayFromString(d), 0) >= at(date, 0));
    this.now = now;
    this.post(
      returning
        ? MailTemplates.returnWelcome(date, this.profile, this.pendingCarry, this.now)
        : MailTemplates.morningNotice(date, this.profile, this.pendingCarry, this.now),
    );
  }

  // MARK: 사내 메일

  get inbox(): Mail[] {
    return this.mails.filter(isIncoming).sort((a, b) => b.sentAt - a.sentAt);
  }

  get sent(): Mail[] {
    return this.mails.filter((m) => !isIncoming(m)).sort((a, b) => b.sentAt - a.sentAt);
  }

  get unreadCount(): number {
    return this.mails.filter((m) => isIncoming(m) && !m.isRead).length;
  }

  markRead(id: string): void {
    const mail = this.mails.find((m) => m.id === id);
    if (mail) mail.isRead = true;
  }

  private post(mail: Mail): void {
    this.mails.push(mail);
  }

  private log(kind: ActivityEventKind, text: string, targetId?: string, time: Instant = this.now): void {
    this.day.events.push({ id: crypto.randomUUID(), at: time, kind, text, ...(targetId ? { targetId } : {}) });
  }
}

export { TASK_OUTCOME_LABEL };
