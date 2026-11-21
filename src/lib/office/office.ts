/**
 * VISION COMPANY의 상태와 규칙(개정 기획서 3.1·4.5·6장 1단계).
 *
 * 하루: 입사 → 출근 → 아침보고(과제 확정) → 수행·제출 → 기획팀 공유 → 하루 마감 → (다음 활동일)
 * 단계는 사용자 행동으로만 넘어간다. 시각은 '마감할 때가 됐다'는 안내에만 쓴다.
 * 카메라 착석 판정·지각·자동 추가근무는 없다.
 *
 * 화면·네트워크와 무관한 순수 로직이라 그대로 시험할 수 있다.
 * 상태는 `toJSON()`으로 꺼내 저장하고 `Office.fromJSON()`으로 되살린다(새로고침 후 복원).
 */
import { MailTemplates } from "./mail-templates";
import {
  type ActivityEventKind,
  type CheckInMethod,
  type ColleagueSource,
  type DayRecord,
  defaultProfile,
  type EmployeeProfile,
  isIncoming,
  type Mail,
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
import { OfficeError, WorkRules } from "./rules";
import { type DayKey, type Instant, addMinutes, at, dayKeyOf, hm, minuteOfDay, mondayOfWeek, nextWorkday, sameDay } from "./time";

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
}

export interface SkipResult {
  from: Instant;
  to: Instant;
  /** 이제는 단계 경계에서 멈추지 않는다. 화면 호환을 위해 항상 null. */
  stoppedFor: string | null;
}

export interface OnboardInput {
  name: string;
  targetRole?: string;
  experience?: string;
  activityStart?: number;
  activityEnd?: number;
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

/** 진행 중으로 보는 과제 상태(아직 마감 처리를 하지 않음). */
const OPEN_STATUSES: TaskStatus[] = ["confirmed", "in_progress", "submitted", "incomplete"];

export class Office implements OfficeState {
  version: number;
  profile: EmployeeProfile;
  onboarded: boolean;
  now: Instant;
  day: WorkDay;
  history: DayRecord[];
  mails: Mail[];
  pendingCarry: WorkTask[];

  constructor(startingAt: Instant, profile: EmployeeProfile = defaultProfile()) {
    this.version = STATE_VERSION;
    this.profile = profile;
    this.onboarded = false;
    this.now = startingAt;
    this.day = newWorkDay(dayKeyOf(startingAt));
    this.history = [];
    this.mails = [];
    this.pendingCarry = [];
  }

  /** 저장된 상태가 지금 형식인지. 옛 근태 형식이면 false(새로 시작한다). */
  static isCurrent(state: unknown): state is OfficeState {
    return typeof state === "object" && state != null && (state as { version?: unknown }).version === STATE_VERSION;
  }

  static fromJSON(state: OfficeState): Office {
    const office = Object.create(Office.prototype) as Office;
    Object.assign(office, structuredClone(state));
    return office;
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
    };
  }

  /** 시연을 시작하는 시각. 실제 오늘이 속한 주의 월요일, 기본 활동 시작 5분 전. */
  static demoStart(realNow: Instant = Date.now()): Instant {
    return at(mondayOfWeek(dayKeyOf(realNow)), WorkRules.defaultActivityStart - WorkRules.minutesBeforeStart);
  }

  // MARK: 시각

  get today(): DayKey {
    return this.day.date;
  }

  get activityEndDate(): Instant {
    return at(this.day.date, this.profile.activityEnd);
  }

  /** 사용자가 정한 마감 시각이 지났는지. 안내만 하고 단계를 바꾸지 않는다. */
  get pastActivityEnd(): boolean {
    return this.day.phase !== "off" && this.day.phase !== "beforeCheckIn" && this.now >= this.activityEndDate;
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
    if (!(next.activityStart >= 0 && next.activityEnd <= 24 * 60 && next.activityStart < next.activityEnd)) {
      throw new OfficeError("invalidProfile", ["활동 마감 시각은 시작 시각보다 늦어야 합니다."]);
    }
    this.profile = next;
    if (this.onboarded) return;
    this.onboarded = true;
    // 처음 시작한 날이면 시계를 사용자가 정한 시작 시각 5분 전으로 맞춘다(출근 전일 때만).
    if (this.day.phase === "beforeCheckIn") {
      const start = at(this.day.date, Math.max(0, this.profile.activityStart - WorkRules.minutesBeforeStart));
      if (start > this.now) this.now = start;
    }
    this.post(MailTemplates.welcome(this.profile, addMinutes(this.now, -1)));
    this.post(MailTemplates.morningNotice(this.day.date, this.profile, this.pendingCarry, this.now));
  }

  // MARK: 출근

  get canCheckIn(): boolean {
    return this.onboarded && this.day.phase === "beforeCheckIn";
  }

  /** 버튼으로 활동을 시작한다. 시작 시각만 기록하고 지각을 판정하지 않는다. */
  checkIn(method: CheckInMethod | null = null): { checkInAt: Instant; method: CheckInMethod | null } {
    if (this.day.phase !== "beforeCheckIn") throw OfficeError.notAllowedNow("오늘은 이미 활동을 시작했습니다.");
    if (!this.onboarded) throw OfficeError.notAllowedNow("입사 정보를 먼저 확인해 주세요.");
    this.day.checkInAt = this.now;
    this.day.checkInMethod = method;
    this.day.phase = "morningPT";
    this.log("checkIn", `활동 시작 ${hm(this.now)}${method === "camera" ? " · 카메라 확인" : method === "noCamera" ? " · 카메라 없이" : ""}`);
    return { checkInAt: this.now, method };
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
    const missing = rows.flatMap((r, i) => {
      const lacks = [!r.title.trim() && "과제명", !r.completionCriteria.trim() && "완료 기준"].filter(Boolean);
      return lacks.length ? [`· ${r.title.trim() || `${i + 1}번째 과제`}: ${lacks.join(", ")}`] : [];
    });
    if (missing.length > 0) throw new OfficeError("taskIncomplete", missing);

    const clip = (s: string) => s.trim().slice(0, WorkRules.maxFieldLength);
    this.day.tasks = rows.map((r) =>
      newTask({
        title: clip(r.title),
        completionCriteria: clip(r.completionCriteria),
        shareForm: clip(r.shareForm ?? ""),
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
    this.post(MailTemplates.tasksConfirmed(this.day.tasks, this.now));
    return this.day.tasks;
  }

  // MARK: 수행과 제출

  /** 과제 상태·제출물을 바꿀 수 있는 단계인지. */
  get canEditTasks(): boolean {
    return this.day.phase === "working" || this.day.phase === "sharing" || this.day.phase === "checkoutReview";
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

  // MARK: 기획팀 공유

  get canStartSharing(): boolean {
    return this.day.phase === "working" && this.day.tasks.length > 0;
  }

  startSharing(): void {
    if (!this.canStartSharing) throw OfficeError.notAllowedNow("기획팀 공유는 과제를 확정하고 수행한 뒤에 시작합니다.");
    this.day.phase = "sharing";
    this.day.share.state = "awaiting_explanation";
    this.log("shareStart", `기획팀 공유 시작 ${hm(this.now)}`);
  }

  /**
   * 공유 대화 한 턴을 남긴다. 기획자 질문 수를 세고 상한을 넘는 질문은 받지 않는다.
   * 사용자가 이미 답한 질문을 다시 묻지 않는 판단은 AI 쪽(f4)에서 하고, 여기서는 기록과 상한만 지킨다.
   */
  recordShareTurn(input: ShareTurnInput): void {
    if (this.day.phase !== "sharing") throw OfficeError.notAllowedNow("공유 대화는 기획팀 공유 중에만 남깁니다.");
    const share = this.day.share;
    if (input.role === "user") {
      const text = (input.text ?? "").trim();
      if (!text) throw OfficeError.notAllowedNow("설명할 내용을 적어 주세요.");
      share.turns.push({ id: crypto.randomUUID(), role: "user", at: this.now, text: text.slice(0, WorkRules.maxFieldLength) });
      if (share.state === "awaiting_explanation") share.state = "clarifying";
      this.log("shareTurn", "기획팀에 설명");
      return;
    }
    const reply = input.reply;
    if (!reply) throw OfficeError.notAllowedNow("기획자 응답이 비어 있습니다.");
    const asks = reply.question.trim().length > 0;
    if (asks && share.questionCount >= share.maxQuestions) throw new OfficeError("shareQuestionLimit");
    share.turns.push({ id: crypto.randomUUID(), role: "planner", at: this.now, reply, source: input.source ?? "manual" });
    if (asks) share.questionCount += 1;
    share.knownFacts = [...reply.known_facts];
    share.openQuestions = [...reply.open_questions];
    share.state = !asks || reply.can_finish || share.questionCount >= share.maxQuestions ? "ready_to_summarize" : "clarifying";
  }

  /** 공유를 끝내고 하루 마감으로 간다. 수행 중에 바로 부르면 공유를 건너뛴 것으로 남긴다(공유가 맞지 않는 학습). */
  endSharing(reason: "done" | "userStopped" = "done"): void {
    const share = this.day.share;
    if (this.day.phase === "working" && this.day.tasks.length > 0) {
      share.endedBy = "skipped";
      this.log("shareEnd", "기획팀 공유 건너뜀");
    } else if (this.day.phase === "sharing") {
      share.endedBy = reason;
      if (share.turns.length > 0) share.state = "user_confirmed";
      this.log("shareEnd", reason === "done" ? "기획팀 공유 마침" : "기획팀 공유를 사용자가 종료");
    } else {
      throw OfficeError.notAllowedNow("기획팀 공유 중이 아닙니다.");
    }
    this.day.phase = "checkoutReview";
  }

  // MARK: 하루 마감

  /** 마감 때 처리를 골라야 하는 과제(제출하지 않은 과제). */
  get unsubmittedTasks(): WorkTask[] {
    return this.day.tasks.filter((t) => t.status !== "submitted" && t.status !== "reviewed");
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

  // MARK: 가상 시계

  /** 시계를 `target`까지 흐르게 한다. 뒤로 가지 않고 하루를 넘기지 않는다. 단계는 바꾸지 않는다. */
  advance(target: Instant): void {
    if (target <= this.now) return;
    this.now = Math.min(target, at(this.day.date, 24 * 60 - 1));
  }

  get canSkipHour(): boolean {
    return this.onboarded && this.day.phase !== "off" && minuteOfDay(this.now) < 23 * 60;
  }

  /** 시연용: 다음 정각으로 보낸다. 다음 정각까지 30분이 안 남았으면 그다음 정각. */
  skipHour(): SkipResult | null {
    if (!this.canSkipHour) return null;
    const from = this.now;
    const minute = minuteOfDay(from);
    let nextHour = (Math.floor(minute / 60) + 1) * 60;
    if (nextHour - minute < 30) nextHour += 60;
    this.advance(at(this.day.date, Math.min(nextHour, 24 * 60 - 1)));
    return { from, to: this.now, stoppedFor: null };
  }

  // MARK: 다음 활동일

  /** 마감했거나, 오늘 활동을 시작하지 않았으면(휴식일) 다음 활동일로 넘어갈 수 있다. */
  get canStartNextWorkday(): boolean {
    return this.onboarded && (this.day.phase === "off" || this.day.phase === "beforeCheckIn");
  }

  startNextWorkday(): void {
    if (!this.canStartNextWorkday) throw OfficeError.notAllowedNow("하루 마감을 확정한 뒤에 다음 활동일로 넘어갈 수 있습니다.");
    this.archiveDay();
    this.beginDay(nextWorkday(this.day.date));
  }

  private archiveDay(): void {
    if (this.day.checkInAt == null) return;
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
    };
    this.history = this.history.filter((r) => !sameDay(r.date, record.date));
    this.history.push(record);
  }

  private beginDay(date: DayKey): void {
    this.day = newWorkDay(date);
    this.now = at(date, Math.max(0, this.profile.activityStart - WorkRules.minutesBeforeStart));
    this.post(MailTemplates.morningNotice(date, this.profile, this.pendingCarry, this.now));
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

  private log(kind: ActivityEventKind, text: string, targetId?: string): void {
    this.day.events.push({ id: crypto.randomUUID(), at: this.now, kind, text, ...(targetId ? { targetId } : {}) });
  }
}

export { TASK_OUTCOME_LABEL };
