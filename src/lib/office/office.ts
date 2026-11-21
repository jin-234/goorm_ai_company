/**
 * 가상회사의 상태와 규칙.
 *
 * 근태와 퇴근·추가근무 판정은 모두 이 객체의 가상 시계(`now`)를 쓴다.
 * 화면·카메라·네트워크와 무관한 순수 로직이라 그대로 시험할 수 있다.
 * 상태는 `toJSON()`으로 꺼내 DB에 저장하고 `Office.fromJSON()`으로 되살린다.
 */
import { MailTemplates } from "./mail-templates";
import {
  type Allowance,
  type AllowanceKind,
  ALLOWANCE_LABEL,
  type AttendanceEventKind,
  attendanceOf,
  type AwaySpan,
  type CarryReport,
  type DayRecord,
  type DraftSource,
  defaultProfile,
  type EmployeeProfile,
  isCarriedDraft,
  isCarryReportComplete,
  isIncoming,
  type Mail,
  missingFields,
  missingSections,
  newDraft,
  newMail,
  newTask,
  newWeeklyReport,
  newWorkDay,
  overtimeEndOf,
  overtimeStartOf,
  type OvertimeOutcome,
  type PresenceState,
  type ReplySource,
  type TaskDraft,
  type WeeklyReport,
  type WorkDay,
  type WorkTask,
} from "./models";
import { type MonthStats, monthStats, OfficeError, WorkRules } from "./rules";
import {
  type DayKey,
  type Instant,
  addDays,
  addMinutes,
  at,
  Clock,
  dayKeyOf,
  hm,
  isFriday,
  minuteOfDay,
  minutesBetween,
  mondayOfWeek,
  nextWorkday,
  sameDay,
} from "./time";

/** DB에 저장하는 회사 상태 전체. */
export interface OfficeState {
  profile: EmployeeProfile;
  /** 입사 안내를 확인했는지. */
  onboarded: boolean;
  /** 가상 시계의 현재 시각. */
  now: Instant;
  day: WorkDay;
  history: DayRecord[];
  mails: Mail[];
  /** 이월이 확정되어 다음 근무일 목록에 들어갈 업무. */
  pendingCarry: WorkTask[];
  weeklyReports: WeeklyReport[];
  /** 작성 중인 주간보고서. 제출 전까지 보존한다. */
  weeklyDraft: WeeklyReport;
  /** 카메라가 마지막으로 본 자리 상태. */
  presence: PresenceState;
}

export interface SkipResult {
  from: Instant;
  to: Instant;
  /** 다음 정각까지 가지 않고 일과 시각에서 멈췄다면 그 이유. */
  stoppedFor: string | null;
}

export type CheckoutOutcome =
  | { kind: "offAllDone" }
  | { kind: "offWithCarry"; count: number }
  | { kind: "offNoTasks" }
  | { kind: "overtimeAssigned"; count: number; carried: number };

const titleKey = (title: string | null | undefined): string | null => {
  const key = (title ?? "").replace(/[\s\p{P}]/gu, "");
  return key ? key : null;
};

export class Office implements OfficeState {
  profile: EmployeeProfile;
  onboarded: boolean;
  now: Instant;
  day: WorkDay;
  history: DayRecord[];
  mails: Mail[];
  pendingCarry: WorkTask[];
  weeklyReports: WeeklyReport[];
  weeklyDraft: WeeklyReport;
  presence: PresenceState;

  constructor(startingAt: Instant, profile: EmployeeProfile = defaultProfile()) {
    this.profile = profile;
    this.onboarded = false;
    this.now = startingAt;
    this.day = newWorkDay(dayKeyOf(startingAt));
    this.history = [];
    this.mails = [];
    this.pendingCarry = [];
    this.weeklyReports = [];
    this.weeklyDraft = newWeeklyReport(mondayOfWeek(dayKeyOf(startingAt)));
    this.presence = "unknown";
  }

  static fromJSON(state: OfficeState): Office {
    const office = Object.create(Office.prototype) as Office;
    Object.assign(office, structuredClone(state));
    return office;
  }

  toJSON(): OfficeState {
    return {
      profile: this.profile,
      onboarded: this.onboarded,
      now: this.now,
      day: this.day,
      history: this.history,
      mails: this.mails,
      pendingCarry: this.pendingCarry,
      weeklyReports: this.weeklyReports,
      weeklyDraft: this.weeklyDraft,
      presence: this.presence,
    };
  }

  /** 시연을 시작하는 시각. 실제 오늘이 속한 주의 월요일 08:55. */
  static demoStart(realNow: Instant = Date.now()): Instant {
    return at(mondayOfWeek(dayKeyOf(realNow)), WorkRules.demoStartMinute);
  }

  // MARK: 시각

  get today(): DayKey {
    return this.day.date;
  }
  get workStartDate() {
    return at(this.day.date, this.profile.workStart);
  }
  get workEndDate() {
    return at(this.day.date, this.profile.workEnd);
  }
  get overtimeStartDate() {
    return at(this.day.date, overtimeStartOf(this.profile));
  }
  get overtimeEndDate() {
    return at(this.day.date, overtimeEndOf(this.profile));
  }
  private get lastMinuteOfDay() {
    return at(this.day.date, 24 * 60 - 1);
  }

  // MARK: 입사

  completeOnboarding(name: string): void {
    const trimmed = name.trim();
    if (trimmed) this.profile.name = trimmed;
    if (this.onboarded) return;
    this.onboarded = true;
    const early = at(this.day.date, Math.max(0, this.profile.workStart - 30));
    this.post(MailTemplates.welcome(this.profile.name, this.profile, addMinutes(early, -1)));
    this.post(MailTemplates.morningNotice(this.day.date, this.profile, [], early));
  }

  // MARK: 출근

  /** 지금 출근을 기록할 수 있는지. */
  get canCheckIn(): boolean {
    return this.day.phase === "beforeCheckIn" && !this.day.absentCandidate && this.now < this.workEndDate;
  }

  /** 카메라에 사람이 보여 출근을 기록한다. */
  checkIn(): "onTime" | "late" {
    if (this.day.phase !== "beforeCheckIn") throw OfficeError.notAllowedNow("오늘은 이미 출근을 기록했습니다.");
    if (!this.canCheckIn) {
      throw OfficeError.notAllowedNow("근무시간이 끝나 출근을 기록할 수 없습니다.\n다음 근무일에 출근해 주세요.");
    }
    this.day.checkInAt = this.now;
    // 분 단위로 본다. 09:00:59까지는 정시, 09:01부터 지각.
    this.day.isLate = minuteOfDay(this.now) > this.profile.workStart;
    this.day.phase = "morningPT";
    this.presence = "present";
    this.log("checkIn", `출근 ${hm(this.now)}`);
    if (this.day.isLate) {
      this.log("late", `지각 · 기준 ${Clock.hm(this.profile.workStart)}`);
      this.post(MailTemplates.lateRecorded(this.now, this.profile, this.monthStats, this.now));
    }
    return this.day.isLate ? "late" : "onTime";
  }

  // MARK: 아침 PT

  setTranscript(text: string): void {
    this.day.transcript = text;
  }

  /** 전사문으로 만든 초안을 넣는다. 이월된 업무는 그대로 두고, 이월 업무와 이름이 같은 새 초안은 뺀다. */
  replaceDrafts(drafts: TaskDraft[], source: DraftSource): void {
    const carried = this.day.drafts.filter(isCarriedDraft);
    const carriedTitles = new Set(carried.map((d) => titleKey(d.title)).filter((k): k is string => k != null));
    const fresh = drafts.filter((draft) => {
      if (isCarriedDraft(draft)) return false;
      const key = titleKey(draft.title);
      return key == null || !carriedTitles.has(key);
    });
    this.day.drafts = [...carried, ...fresh];
    this.day.draftSource = source;
  }

  addDraft(): TaskDraft {
    const draft = newDraft();
    this.day.drafts.push(draft);
    if (this.day.draftSource == null) this.day.draftSource = "manual";
    return draft;
  }

  /** 초안 한 줄을 고친다. 이월 업무도 칸은 고칠 수 있다(지울 수만 없다). */
  updateDraft(id: string, patch: Partial<Pick<TaskDraft, "title" | "level" | "due" | "doneCriteria">>): void {
    const draft = this.day.drafts.find((d) => d.id === id);
    if (!draft) return;
    Object.assign(draft, patch);
  }

  /** 초안에서 업무를 뺀다. 이월된 업무는 뺄 수 없다. */
  removeDraft(id: string): void {
    this.day.drafts = this.day.drafts.filter((d) => !(d.id === id && !isCarriedDraft(d)));
  }

  /** 확정할 수 없는 이유. 확정할 수 있으면 null. */
  get confirmBlocker(): OfficeError | null {
    if (this.day.phase !== "morningPT") return OfficeError.notAllowedNow("업무 확정은 출근한 뒤 아침 PT에서 합니다.");
    if (this.day.drafts.length === 0) return new OfficeError("noTasks");
    const rows = this.day.drafts.flatMap((draft, index) => {
      const missing = missingFields(draft);
      if (missing.length === 0) return [];
      const name = (draft.title ?? "").trim();
      return [`· ${name || `${index + 1}번째 업무`}: ${missing.join(", ")}`];
    });
    return rows.length === 0 ? null : new OfficeError("draftIncomplete", rows);
  }

  /** '확정하고 근무 시작'. 이 목록을 퇴근 판단에 쓴다. */
  confirmTasks(): void {
    const blocker = this.confirmBlocker;
    if (blocker) throw blocker;
    const tasks = this.day.drafts.map((d) =>
      newTask({
        title: (d.title ?? "").trim(),
        level: d.level ?? 1,
        due: d.due ?? this.profile.workEnd,
        doneCriteria: (d.doneCriteria ?? "").trim(),
        carriedFrom: d.carriedFrom,
        carryCount: d.carryCount,
      }),
    );
    this.day.tasks = Office.sorted(tasks);
    this.day.confirmedAt = this.now;
    this.day.phase = "working";
    this.log("tasksConfirmed", `업무 ${tasks.length}건 확정 · 근무 시작`);
    this.post(MailTemplates.tasksConfirmed(this.day.tasks, this.profile, this.now));
    this.reconcilePresence(this.now);
  }

  /** 중요도가 높은 순서, 같으면 마감이 이른 순서. 같으면 원래 순서. */
  static sorted(tasks: WorkTask[]): WorkTask[] {
    return [...tasks].sort((a, b) => (a.level !== b.level ? b.level - a.level : a.due - b.due));
  }

  // MARK: 업무 진행

  /** 업무 완료 표시와 결과물을 바꿀 수 있는 단계인지. */
  get canEditTasks(): boolean {
    return ["working", "checkoutReview", "dinner", "overtime", "overtimeReview"].includes(this.day.phase);
  }

  setTask(id: string, done: boolean): void {
    const task = this.day.tasks.find((t) => t.id === id);
    if (!this.canEditTasks || !task || task.status === "carried") return;
    task.status = done ? "done" : "open";
    task.doneAt = done ? this.now : null;
  }

  setDeliverable(id: string, text: string): void {
    const task = this.day.tasks.find((t) => t.id === id);
    if (!this.canEditTasks || !task) return;
    task.deliverable = text;
  }

  get openTasks(): WorkTask[] {
    return this.day.tasks.filter((t) => t.status === "open");
  }
  get doneTasks(): WorkTask[] {
    return this.day.tasks.filter((t) => t.status === "done");
  }

  /** 추가근무에 배정된 업무. 3단계가 먼저다. */
  get overtimeTasks(): WorkTask[] {
    return Office.sorted(this.day.tasks.filter((t) => this.day.overtimeTaskIds.includes(t.id)));
  }

  // MARK: 점심과 자리 비움

  /** 지금 적용 중인 허용 시간. */
  get activeAllowance(): Allowance | null {
    for (let i = this.day.allowances.length - 1; i >= 0; i--) {
      if (this.day.allowances[i].endedAt == null) return this.day.allowances[i];
    }
    return null;
  }

  get canRequestLunch(): boolean {
    return this.day.phase === "working" && !this.day.lunchUsed && this.activeAllowance == null;
  }

  /** 사내 메일로 점심을 요청한다. 수락되면 1시간(퇴근 시각을 넘지 않게)을 부여한다. 하루 한 번. */
  requestLunch(): Allowance {
    if (this.day.phase !== "working") throw OfficeError.notAllowedNow("점심 요청은 근무 중에 할 수 있습니다.");
    if (this.day.lunchUsed) throw new OfficeError("lunchAlreadyUsed");
    if (this.activeAllowance) throw new OfficeError("allowanceActive");

    const end = Math.min(addMinutes(this.now, WorkRules.lunchMinutes), this.workEndDate);
    const allowance = this.makeAllowance("lunch", "점심", this.now, end);
    this.closeSpans(this.now);
    this.day.allowances.push(allowance);
    this.day.lunchUsed = true;
    this.post(MailTemplates.lunchRequest(this.profile.name, this.now));
    this.post(MailTemplates.lunchApproval(allowance, this.now));
    this.log("lunchStart", `점심 승인 ${hm(allowance.start)}~${hm(allowance.end)}`);
    return allowance;
  }

  get canRegisterAway(): boolean {
    return (this.day.phase === "working" || this.day.phase === "overtime") && this.activeAllowance == null;
  }

  /** 사유를 등록하고 자리를 비운다. 건당 15분. */
  registerAway(reason: string): Allowance {
    if (this.day.phase !== "working" && this.day.phase !== "overtime") {
      throw OfficeError.notAllowedNow("자리 비움 등록은 근무 중에 할 수 있습니다.");
    }
    const trimmed = reason.trim();
    if (!trimmed) throw new OfficeError("emptyReason");
    if (this.activeAllowance) throw new OfficeError("allowanceActive");

    const boundary = this.day.phase === "overtime" ? this.overtimeEndDate : this.workEndDate;
    const end = Math.min(addMinutes(this.now, WorkRules.awayMinutes), boundary);
    const allowance = this.makeAllowance("away", trimmed, this.now, end);
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
    this.log(allowance.kind === "lunch" ? "lunchEnd" : "awayEnd", `${ALLOWANCE_LABEL[allowance.kind]} 복귀 ${hm(this.now)} · 착석 확인 재개`);
    this.reconcilePresence(this.now);
  }

  private makeAllowance(kind: AllowanceKind, reason: string, start: Instant, end: Instant): Allowance {
    return { id: crypto.randomUUID(), kind, reason, start, end, endedAt: null };
  }

  // MARK: 카메라 착석 확인

  /** 지금 착석 여부를 판정하는 중인지. 허용 시간 안에서는 쉰다. */
  get isMonitoring(): boolean {
    return (this.day.phase === "working" || this.day.phase === "overtime") && this.activeAllowance == null;
  }

  /** 카메라(브라우저)가 본 자리 상태를 알린다. */
  observe(state: PresenceState): void {
    if (state === this.presence) return;
    this.presence = state;
    this.reconcilePresence(this.now);
  }

  /** 허용 시간 밖에서 자리가 비어 있던 시간(분). */
  get unauthorizedAwayMinutes(): number {
    return this.spanMinutes("unauthorized");
  }

  /** 카메라가 꺼져 있던 시간(분). 확인한 뒤 근태를 확정한다. */
  get cameraOffMinutes(): number {
    return this.spanMinutes("cameraOff");
  }

  private spanMinutes(kind: AwaySpan["kind"]): number {
    return this.day.awaySpans
      .filter((s) => s.kind === kind)
      .reduce((sum, s) => sum + Math.max(0, minutesBetween(s.start, s.end ?? this.now)), 0);
  }

  openSpan(kind: AwaySpan["kind"]): AwaySpan | null {
    for (let i = this.day.awaySpans.length - 1; i >= 0; i--) {
      const span = this.day.awaySpans[i];
      if (span.kind === kind && span.end == null) return span;
    }
    return null;
  }

  private reconcilePresence(time: Instant): void {
    this.syncSpan("unauthorized", this.isMonitoring && this.presence === "absent", time);
    this.syncSpan("cameraOff", this.isMonitoring && this.presence === "cameraOff", time);
  }

  private syncSpan(kind: AwaySpan["kind"], wanted: boolean, time: Instant): void {
    const open = this.openSpan(kind);
    if (wanted && !open) {
      this.day.awaySpans.push({ id: crypto.randomUUID(), kind, start: time, end: null });
      if (kind === "unauthorized") this.log("unauthorizedAwayStart", `근무 중 자리 비움 시작 ${hm(time)}`, time);
      else this.log("cameraOff", `카메라 꺼짐 ${hm(time)} · 확인 필요`, time);
    } else if (!wanted && open) {
      this.closeSpan(open, time);
    }
  }

  private closeSpan(span: AwaySpan, time: Instant): void {
    if (span.end != null) return;
    const end = Math.max(time, span.start);
    span.end = end;
    const minutes = Math.max(0, minutesBetween(span.start, end));
    if (span.kind === "unauthorized") {
      this.log("unauthorizedAwayEnd", `복귀 ${hm(end)} · 자리 비움 ${Clock.duration(minutes)}`, end);
    } else {
      this.log("cameraOn", `카메라 다시 확인 ${hm(end)} · 꺼짐 ${Clock.duration(minutes)}`, end);
    }
  }

  private closeSpans(time: Instant): void {
    for (const span of this.day.awaySpans) if (span.end == null) this.closeSpan(span, time);
  }

  // MARK: 가상 시계

  /** 시계를 `target`까지 흐르게 한다. 뒤로 가지 않고 하루를 넘기지 않는다. */
  advance(target: Instant): void {
    if (target <= this.now) return;
    this.now = Math.min(target, this.lastMinuteOfDay);
    this.catchUp();
  }

  /** '다음 정각'을 쓸 수 있는지. 점검을 제출해야 하는 단계와 퇴근 뒤에는 쓸 수 없다. */
  get canSkipHour(): boolean {
    switch (this.day.phase) {
      case "checkoutReview":
      case "overtimeReview":
      case "off":
        return false;
      case "beforeCheckIn":
        return !this.day.absentCandidate;
      default:
        return true;
    }
  }

  /** 지금 단계가 끝나는 시각. */
  private get phaseBoundary(): { date: Instant; why: string } | null {
    switch (this.day.phase) {
      case "beforeCheckIn":
        return this.day.absentCandidate ? null : { date: this.workEndDate, why: "퇴근 시각" };
      case "morningPT":
      case "working":
        return { date: this.workEndDate, why: "퇴근 점검 시각" };
      case "dinner":
        return { date: this.overtimeStartDate, why: "추가근무 시작 시각" };
      case "overtime":
        return { date: this.overtimeEndDate, why: "추가근무 종료 시각" };
      default:
        return null;
    }
  }

  /**
   * 시연 시간을 다음 정각으로 보낸다. 다음 정각까지 30분이 안 남았으면 그다음 정각(08:55 → 10:00).
   * 퇴근 점검·추가근무 시작·추가근무 종료 시각이 그 사이에 있으면 그 시각에서 멈춘다.
   * 건너뛴 시간에는 카메라로 본 것이 없으므로 자리 비움을 세지 않는다.
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
    // 건너뛴 뒤에는 카메라가 다시 알려 줄 때까지 자리 상태를 모르는 것으로 둔다.
    this.presence = "unknown";
    this.now = Math.min(target, this.lastMinuteOfDay);
    this.catchUp();
    return { from, to: this.now, stoppedFor };
  }

  /** 시각이 바뀐 뒤 만료와 단계 전환을 반영한다. */
  private catchUp(): void {
    this.expireAllowances();

    if (this.day.phase === "beforeCheckIn" && !this.day.absentCandidate && this.now >= this.workEndDate) {
      this.day.absentCandidate = true;
      this.log("absentCandidate", "출근 기록 없음 · 결근 후보", this.workEndDate);
      this.post(MailTemplates.absentCandidate(this.day.date, this.profile, this.monthStats, this.workEndDate));
    }

    if ((this.day.phase === "morningPT" || this.day.phase === "working") && this.now >= this.workEndDate) {
      if (this.day.phase === "morningPT") this.day.noMorningPT = true;
      this.endActiveAllowance(this.workEndDate);
      this.closeSpans(this.workEndDate);
      this.day.phase = "checkoutReview";
      this.log("checkoutReview", `${Clock.hm(this.profile.workEnd)} 퇴근 점검`, this.workEndDate);
    }

    if (this.day.phase === "dinner" && this.now >= this.overtimeStartDate) {
      this.endActiveAllowance(this.overtimeStartDate);
      this.day.phase = "overtime";
      this.log("overtimeStart", `${Clock.hm(overtimeStartOf(this.profile))} 추가근무 시작 · 3단계부터 진행`, this.overtimeStartDate);
      this.reconcilePresence(this.overtimeStartDate);
    }

    if (this.day.phase === "overtime" && this.now >= this.overtimeEndDate) {
      this.endActiveAllowance(this.overtimeEndDate);
      this.closeSpans(this.overtimeEndDate);
      this.day.phase = "overtimeReview";
      this.log("overtimeEnd", `${Clock.hm(overtimeEndOf(this.profile))} 추가근무 종료`, this.overtimeEndDate);
    }
  }

  /** 등록된 종료 시각이 지난 허용 시간을 만료한다. 저녁시간은 단계 전환에서 끝낸다. */
  private expireAllowances(): void {
    for (const allowance of this.day.allowances) {
      if (allowance.endedAt != null || allowance.end > this.now || allowance.kind === "dinner") continue;
      allowance.endedAt = allowance.end;
      const end = allowance.end;
      if (allowance.kind === "lunch") this.log("lunchEnd", `점심시간 종료 ${hm(end)} · 착석 확인 재개`, end);
      else this.log("awayEnd", `자리 비움 허용 종료 ${hm(end)} · 착석 확인 재개`, end);
      this.reconcilePresence(end);
    }
  }

  private endActiveAllowance(time: Instant): void {
    for (const allowance of this.day.allowances) {
      if (allowance.endedAt == null) allowance.endedAt = Math.min(time, allowance.end);
    }
  }

  // MARK: 퇴근 점검

  /** 퇴근 점검에서 이월 보고가 필요한 1단계 미완료 업무. */
  get carryReportTargets(): WorkTask[] {
    return this.openTasks.filter((t) => t.level === 1);
  }

  /** 추가근무 대상이 되는 2·3단계 미완료 업무. */
  get overtimeTargets(): WorkTask[] {
    return Office.sorted(this.openTasks.filter((t) => t.level !== 1));
  }

  /**
   * 퇴근 점검을 제출한다.
   * 1단계만 남으면 이월 보고 후 정시 퇴근하고, 2·3단계가 남으면 저녁시간과 추가근무로 간다.
   */
  submitCheckout(carryReports: Record<string, CarryReport> = {}): CheckoutOutcome {
    if (this.day.phase !== "checkoutReview") throw OfficeError.notAllowedNow("퇴근 점검은 퇴근 시각에 진행합니다.");
    const carryTargets = this.carryReportTargets;
    const heavy = this.overtimeTargets;
    const missing = carryTargets.filter((t) => !isCarryReportComplete(carryReports[t.id]));
    if (missing.length > 0) throw new OfficeError("carryReportMissing", missing.map((t) => t.title));

    if (carryTargets.length > 0) {
      this.post(MailTemplates.carryReport(this.profile.name, carryTargets, carryReports, this.now));
      this.carry(carryTargets.map((t) => t.id));
      this.post(MailTemplates.carryAccepted(carryTargets, nextWorkday(this.day.date), this.now));
      this.log("carryOver", `1단계 ${carryTargets.length}건 이월 보고`);
    }

    if (heavy.length === 0) {
      this.day.phase = "off";
      this.day.checkoutAt = this.now;
      if (this.day.tasks.length === 0) {
        this.post(MailTemplates.offWithoutTasks(this.now));
        this.log("off", `퇴근 ${hm(this.now)} · 아침 PT 미진행`);
        return { kind: "offNoTasks" };
      }
      this.post(MailTemplates.offConfirmed(this.doneTasks.length, carryTargets.length, this.now));
      this.log("off", `퇴근 ${hm(this.now)}`);
      return carryTargets.length === 0 ? { kind: "offAllDone" } : { kind: "offWithCarry", count: carryTargets.length };
    }

    this.day.phase = "dinner";
    this.day.overtimeTaskIds = heavy.map((t) => t.id);
    this.day.allowances.push(this.makeAllowance("dinner", "저녁시간", this.workEndDate, this.overtimeStartDate));
    this.post(MailTemplates.overtimeAssigned(heavy, this.profile, this.now));
    this.log(
      "dinnerStart",
      `저녁시간 ${Clock.hm(this.profile.workEnd)}~${Clock.hm(overtimeStartOf(this.profile))} · 추가근무 배정`,
    );
    // 점검을 늦게 제출해 이미 추가근무 시각을 넘겼다면 바로 이어 간다.
    this.catchUp();
    return { kind: "overtimeAssigned", count: heavy.length, carried: carryTargets.length };
  }

  // MARK: 추가근무

  /** 추가근무를 종료 시각 전에 끝낸다. 남은 업무가 있으면 보충근무 미이행으로 기록하고 이월한다. */
  endOvertimeEarly(): OvertimeOutcome {
    if (this.day.phase !== "dinner" && this.day.phase !== "overtime") throw OfficeError.notAllowedNow("추가근무 중이 아닙니다.");
    const remaining = this.openTasks;
    let outcome: OvertimeOutcome;
    this.endActiveAllowance(this.now);
    this.closeSpans(this.now);
    if (remaining.length === 0) {
      outcome = "completed";
      this.post(MailTemplates.overtimeCompleted(this.overtimeTasks, this.now));
      this.log("overtimeEnd", `추가근무 완료 ${hm(this.now)}`);
    } else {
      outcome = "abandoned";
      this.carry(remaining.map((t) => t.id));
      this.post(MailTemplates.supplementMissed(remaining, nextWorkday(this.day.date), this.profile, this.now));
      this.log("supplementMissed", `보충근무 미이행 · ${remaining.length}건 이월`);
    }
    this.finishDay(outcome);
    return outcome;
  }

  /** 추가근무 종료 시각의 점검을 제출한다. 남은 업무는 다음 근무일로 이월한다. */
  submitOvertimeReview(): OvertimeOutcome {
    if (this.day.phase !== "overtimeReview") {
      throw OfficeError.notAllowedNow("추가근무 종료 점검은 추가근무가 끝나는 시각에 진행합니다.");
    }
    const remaining = this.openTasks;
    let outcome: OvertimeOutcome;
    if (remaining.length === 0) {
      outcome = "completed";
      this.post(MailTemplates.overtimeCompleted(this.overtimeTasks, this.now));
      this.log("overtimeEnd", `추가근무 완료 ${hm(this.now)}`);
    } else {
      outcome = "ranToEnd";
      this.carry(remaining.map((t) => t.id));
      this.post(MailTemplates.overtimeRanToEnd(remaining, nextWorkday(this.day.date), this.profile, this.now));
      this.log("carryOver", `남은 업무 ${remaining.length}건 다음 근무일로 이월`);
    }
    this.finishDay(outcome);
    return outcome;
  }

  private finishDay(outcome: OvertimeOutcome): void {
    this.day.overtime = outcome;
    this.day.phase = "off";
    this.day.checkoutAt = this.now;
    this.log("off", `퇴근 ${hm(this.now)}`);
  }

  /** 업무를 다음 근무일로 넘긴다. 처음 날짜를 유지하고 횟수를 늘린다. */
  private carry(ids: string[]): void {
    for (const id of ids) {
      const task = this.day.tasks.find((t) => t.id === id);
      if (!task || task.status !== "open") continue;
      task.status = "carried";
      this.pendingCarry.push({
        ...task,
        id: crypto.randomUUID(),
        status: "open",
        doneAt: null,
        deliverable: "",
        carriedFrom: task.carriedFrom ?? this.day.date,
        carryCount: task.carryCount + 1,
      });
    }
  }

  // MARK: 주간보고

  /** 금요일에 출근했고 아직 제출하지 않았을 때 제출할 수 있다. */
  get canSubmitWeekly(): boolean {
    return isFriday(this.day.date) && this.day.checkInAt != null && !this.day.weeklySubmitted;
  }

  /** 작성 중인 주간보고서를 저장한다(제출 전까지 보존). */
  saveWeeklyDraft(fields: Partial<Pick<WeeklyReport, "completed" | "incomplete" | "nextGoals">>): void {
    if (this.weeklyDraft.submittedAt != null) return;
    Object.assign(this.weeklyDraft, fields);
  }

  /** 직접 작성한 주간보고서를 올린다. 답장은 따로 받는다. */
  submitWeeklyReport(report: Pick<WeeklyReport, "completed" | "incomplete" | "nextGoals">): WeeklyReport {
    if (!isFriday(this.day.date)) throw new OfficeError("weeklyNotFriday");
    if (this.day.checkInAt == null) throw OfficeError.notAllowedNow("주간보고서는 출근한 뒤에 제출할 수 있습니다.");
    if (this.day.weeklySubmitted) throw new OfficeError("weeklyAlreadySubmitted");
    const missing = missingSections(report);
    if (missing.length > 0) throw new OfficeError("weeklyIncomplete", missing);

    const submitted: WeeklyReport = {
      ...this.weeklyDraft,
      completed: report.completed,
      incomplete: report.incomplete,
      nextGoals: report.nextGoals,
      submittedAt: this.now,
      weekOf: mondayOfWeek(this.day.date),
    };
    this.weeklyReports.push(submitted);
    this.weeklyDraft = structuredClone(submitted);
    this.day.weeklySubmitted = true;
    this.post(MailTemplates.weeklyReport(this.profile.name, submitted, this.day.date, this.now));
    this.log("weeklyReport", `주간보고서 제출 ${hm(this.now)}`);
    return submitted;
  }

  /** 답장을 아직 받지 못한 주간보고서. */
  get weeklyAwaitingReply(): WeeklyReport | null {
    for (let i = this.weeklyReports.length - 1; i >= 0; i--) {
      const r = this.weeklyReports[i];
      if (r.submittedAt != null && r.replyMailId == null) return r;
    }
    return null;
  }

  /** 상사의 주간보고 답장을 메일함에 넣는다. 보고서 하나에 한 번만. */
  receiveWeeklyFeedback(reportId: string, subject: string, body: string, source: ReplySource): void {
    const report = this.weeklyReports.find((r) => r.id === reportId);
    if (!report || report.replyMailId != null) return;
    const mail = newMail({ sentAt: this.now, from: "manager", to: "me", kind: "weeklyFeedback", subject, body, isWarm: true, replySource: source });
    report.replyMailId = mail.id;
    this.post(mail);
  }

  // MARK: 다음 근무일

  get canStartNextWorkday(): boolean {
    return this.day.phase === "off" || (this.day.phase === "beforeCheckIn" && this.day.absentCandidate);
  }

  /** 하루를 마감하고 다음 근무일 아침으로 간다. 이월된 업무가 새 목록에 들어간다. */
  startNextWorkday(): void {
    if (!this.canStartNextWorkday) return;
    this.archiveDay();
    this.beginDay(nextWorkday(this.day.date));
  }

  /** 금요일이 아닌 날에 금요일 장면으로 바로 갈 수 있다(시연 도구). */
  get canJumpToFriday(): boolean {
    return this.onboarded && !isFriday(this.day.date);
  }

  /** 시연용. 진행 중인 하루를 불이익 없이 마감하고 이번 주 금요일 아침으로 간다. 남은 업무는 이월한다. */
  jumpToFriday(): void {
    if (!this.canJumpToFriday) return;
    this.endActiveAllowance(this.now);
    this.closeSpans(this.now);
    this.carry(this.openTasks.map((t) => t.id));
    if (this.day.checkInAt != null || this.day.absentCandidate) {
      if (this.day.checkInAt != null && this.day.checkoutAt == null) this.day.checkoutAt = this.now;
      this.archiveDay();
    }
    let friday = addDays(this.day.date, 1);
    while (!isFriday(friday)) friday = addDays(friday, 1);
    this.beginDay(friday);
  }

  private archiveDay(): void {
    const attendance = attendanceOf(this.day);
    if (!attendance) return;
    const record: DayRecord = {
      date: this.day.date,
      attendance,
      checkInAt: this.day.checkInAt,
      checkoutAt: this.day.checkoutAt,
      tasks: this.day.tasks,
      unauthorizedAwayMinutes: this.unauthorizedAwayMinutes,
      cameraOffMinutes: this.cameraOffMinutes,
      overtime: this.day.overtime,
      noMorningPT: this.day.noMorningPT,
      events: this.day.events,
    };
    this.history = this.history.filter((r) => !sameDay(r.date, record.date));
    this.history.push(record);
  }

  private beginDay(date: DayKey): void {
    // 확정하지 못하고 지나간 날의 이월 업무도 그대로 다음 근무일로 넘긴다.
    if (this.day.confirmedAt == null) {
      const leftover = this.day.drafts.filter(isCarriedDraft).map((d) =>
        newTask({
          title: d.title ?? "",
          level: d.level ?? 1,
          due: d.due ?? this.profile.workEnd,
          doneCriteria: d.doneCriteria ?? "",
          carriedFrom: d.carriedFrom,
          carryCount: d.carryCount,
        }),
      );
      this.pendingCarry = [...leftover, ...this.pendingCarry];
    }
    const carried = this.pendingCarry;
    const next = newWorkDay(date);
    next.drafts = carried.map((t) =>
      newDraft({ title: t.title, level: t.level, due: t.due, doneCriteria: t.doneCriteria, carriedFrom: t.carriedFrom, carryCount: t.carryCount }),
    );
    this.pendingCarry = [];
    this.day = next;
    this.now = at(date, WorkRules.demoStartMinute);
    this.presence = "unknown";
    if (this.weeklyDraft.submittedAt != null || !sameDay(this.weeklyDraft.weekOf, mondayOfWeek(date))) {
      this.weeklyDraft = newWeeklyReport(mondayOfWeek(date));
    }
    this.post(MailTemplates.morningNotice(date, this.profile, carried, at(date, Math.max(0, this.profile.workStart - 30))));
  }

  // MARK: 근태 집계와 지각비 예상액

  /** 이번 달 지각과 결근 후보 횟수. 오늘 기록을 포함한다. */
  get monthStats(): MonthStats {
    let late = 0;
    let absent = 0;
    const { year, month } = this.day.date;
    for (const r of this.history) {
      if (r.date.year !== year || r.date.month !== month || sameDay(r.date, this.day.date)) continue;
      if (r.attendance === "late") late++;
      if (r.attendance === "absentCandidate") absent++;
    }
    const today = attendanceOf(this.day);
    if (today === "late") late++;
    if (today === "absentCandidate") absent++;
    return monthStats(late, absent);
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

  private log(kind: AttendanceEventKind, text: string, time?: Instant): void {
    this.day.events.push({ id: crypto.randomUUID(), at: time ?? this.now, kind, text });
  }
}
