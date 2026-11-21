import Foundation

/// 가상회사의 상태와 규칙.
///
/// 근태와 퇴근·추가근무 판정은 모두 이 구조체의 가상 시계(`now`)를 쓴다.
/// 화면, 카메라, 네트워크와 무관한 순수 로직이라 그대로 시험할 수 있다.
public struct Office: Codable, Sendable, Equatable {
    public var profile: EmployeeProfile
    /// 입사 안내를 확인했는지.
    public var onboarded: Bool
    /// 가상 시계의 현재 시각.
    public var now: Date
    public var day: WorkDay
    public var history: [DayRecord]
    public var mails: [Mail]
    /// 이월이 확정되어 다음 근무일 목록에 들어갈 업무.
    public var pendingCarry: [WorkTask]
    public var weeklyReports: [WeeklyReport]
    /// 작성 중인 주간보고서. 제출 전까지 보존한다.
    public var weeklyDraft: WeeklyReport
    /// 카메라가 마지막으로 본 자리 상태.
    public var presence: PresenceState

    public init(startingAt now: Date, profile: EmployeeProfile = EmployeeProfile()) {
        self.profile = profile
        self.onboarded = false
        self.now = now
        self.day = WorkDay(date: DayKey(now))
        self.history = []
        self.mails = []
        self.pendingCarry = []
        self.weeklyReports = []
        self.weeklyDraft = WeeklyReport(weekOf: DayKey(now).mondayOfWeek())
        self.presence = .unknown
    }

    /// 시연을 시작하는 시각. 실제 오늘이 속한 주의 월요일 08:55.
    public static func demoStart(realNow: Date = Date()) -> Date {
        DayKey(realNow).mondayOfWeek().at(WorkRules.demoStartMinute)
    }

    // MARK: - 시각

    public var today: DayKey { day.date }
    public var workStartDate: Date { day.date.at(profile.workStart) }
    public var workEndDate: Date { day.date.at(profile.workEnd) }
    public var overtimeStartDate: Date { day.date.at(profile.overtimeStart) }
    public var overtimeEndDate: Date { day.date.at(profile.overtimeEnd) }

    // MARK: - 입사

    public mutating func completeOnboarding(name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { profile.name = trimmed }
        guard !onboarded else { return }
        onboarded = true
        let early = day.date.at(max(0, profile.workStart - 30))
        post(MailTemplates.welcome(name: profile.name, profile: profile, at: early.addingTimeInterval(-60)))
        post(MailTemplates.morningNotice(day: day.date, profile: profile, carried: [], at: early))
    }

    // MARK: - 출근

    /// 지금 출근을 기록할 수 있는지.
    public var canCheckIn: Bool {
        day.phase == .beforeCheckIn && !day.absentCandidate && now < workEndDate
    }

    /// 카메라에 사람이 보여 출근을 기록한다.
    @discardableResult
    public mutating func checkIn() throws(OfficeError) -> Attendance {
        guard day.phase == .beforeCheckIn else {
            throw .notAllowedNow("오늘은 이미 출근을 기록했습니다.")
        }
        guard canCheckIn else {
            throw .notAllowedNow("근무시간이 끝나 출근을 기록할 수 없습니다.\n다음 근무일에 출근해 주세요.")
        }
        day.checkInAt = now
        // 분 단위로 본다. 09:00:59까지는 정시, 09:01부터 지각.
        day.isLate = now.minuteOfDay > profile.workStart
        day.phase = .morningPT
        presence = .present
        log(.checkIn, "출근 \(now.hm)")
        if day.isLate {
            log(.late, "지각 · 기준 \(Clock.hm(profile.workStart))")
            post(MailTemplates.lateRecorded(checkIn: now, profile: profile, stats: monthStats, at: now))
        }
        return day.isLate ? .late : .onTime
    }

    // MARK: - 아침 PT

    public mutating func setTranscript(_ text: String) {
        day.transcript = text
    }

    /// 전사문으로 만든 초안을 넣는다. 이월된 업무는 그대로 둔다.
    public mutating func replaceDrafts(_ drafts: [TaskDraft], source: DraftSource) {
        let carried = day.drafts.filter(\.isCarried)
        // 이월된 업무를 PT에서 다시 말하면 같은 업무가 두 번 들어가므로, 이름이 같은 새 초안은 뺀다.
        let carriedTitles = Set(carried.compactMap { Self.titleKey($0.title) })
        let fresh = drafts.filter { draft in
            guard !draft.isCarried else { return false }
            guard let key = Self.titleKey(draft.title) else { return true }
            return !carriedTitles.contains(key)
        }
        day.drafts = carried + fresh
        day.draftSource = source
    }

    /// 업무명 비교용: 띄어쓰기와 문장부호를 빼고 비교한다.
    static func titleKey(_ title: String?) -> String? {
        let key = (title ?? "").filter { !$0.isWhitespace && !$0.isPunctuation }
        return key.isEmpty ? nil : key
    }

    @discardableResult
    public mutating func addDraft() -> TaskDraft {
        let draft = TaskDraft()
        day.drafts.append(draft)
        if day.draftSource == nil { day.draftSource = .manual }
        return draft
    }

    /// 초안에서 업무를 뺀다. 이월된 업무는 뺄 수 없다.
    public mutating func removeDraft(_ id: UUID) {
        day.drafts.removeAll { $0.id == id && !$0.isCarried }
    }

    /// 확정할 수 없는 이유. 확정할 수 있으면 nil.
    public var confirmBlocker: OfficeError? {
        guard day.phase == .morningPT else {
            return .notAllowedNow("업무 확정은 출근한 뒤 아침 PT에서 합니다.")
        }
        guard !day.drafts.isEmpty else { return .noTasks }
        let rows = day.drafts.enumerated().compactMap { index, draft -> String? in
            let missing = draft.missingFields
            guard !missing.isEmpty else { return nil }
            let name = (draft.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let label = name.isEmpty ? "\(index + 1)번째 업무" : name
            return "· \(label): \(missing.joined(separator: ", "))"
        }
        return rows.isEmpty ? nil : .draftIncomplete(rows)
    }

    /// '확정하고 근무 시작'. 이 목록을 퇴근 판단에 쓴다.
    public mutating func confirmTasks() throws(OfficeError) {
        if let blocker = confirmBlocker { throw blocker }
        let tasks = day.drafts.map { draft in
            WorkTask(title: (draft.title ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                     level: draft.level ?? .carryable,
                     due: draft.due ?? profile.workEnd,
                     doneCriteria: (draft.doneCriteria ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                     carriedFrom: draft.carriedFrom,
                     carryCount: draft.carryCount)
        }
        day.tasks = Self.sorted(tasks)
        day.confirmedAt = now
        day.phase = .working
        log(.tasksConfirmed, "업무 \(tasks.count)건 확정 · 근무 시작")
        post(MailTemplates.tasksConfirmed(tasks: day.tasks, profile: profile, at: now))
        reconcilePresence(at: now)
    }

    /// 중요도가 높은 순서, 같으면 마감이 이른 순서.
    public static func sorted(_ tasks: [WorkTask]) -> [WorkTask] {
        tasks.enumerated().sorted { lhs, rhs in
            if lhs.element.level != rhs.element.level { return lhs.element.level > rhs.element.level }
            if lhs.element.due != rhs.element.due { return lhs.element.due < rhs.element.due }
            return lhs.offset < rhs.offset
        }.map(\.element)
    }

    // MARK: - 업무 진행

    /// 업무 완료 표시와 결과물을 바꿀 수 있는 단계인지.
    public var canEditTasks: Bool {
        switch day.phase {
        case .working, .checkoutReview, .dinner, .overtime, .overtimeReview: true
        case .beforeCheckIn, .morningPT, .off: false
        }
    }

    public mutating func setTask(_ id: UUID, done: Bool) {
        guard canEditTasks, let index = day.tasks.firstIndex(where: { $0.id == id }),
              day.tasks[index].status != .carried else { return }
        day.tasks[index].status = done ? .done : .open
        day.tasks[index].doneAt = done ? now : nil
    }

    public mutating func setDeliverable(_ id: UUID, text: String) {
        guard canEditTasks, let index = day.tasks.firstIndex(where: { $0.id == id }) else { return }
        day.tasks[index].deliverable = text
    }

    public var openTasks: [WorkTask] { day.tasks.filter(\.isOpen) }
    public var doneTasks: [WorkTask] { day.tasks.filter(\.isDone) }

    /// 추가근무에 배정된 업무. 3단계가 먼저다.
    public var overtimeTasks: [WorkTask] {
        Self.sorted(day.tasks.filter { day.overtimeTaskIDs.contains($0.id) })
    }

    // MARK: - 점심과 자리 비움

    /// 지금 적용 중인 허용 시간.
    public var activeAllowance: Allowance? {
        day.allowances.last(where: \.isActive)
    }

    public var canRequestLunch: Bool {
        day.phase == .working && !day.lunchUsed && activeAllowance == nil
    }

    /// 사내 메일로 점심을 요청한다. 수락되면 1시간을 부여한다.
    @discardableResult
    public mutating func requestLunch() throws(OfficeError) -> Allowance {
        guard day.phase == .working else {
            throw .notAllowedNow("점심 요청은 근무 중에 할 수 있습니다.")
        }
        guard !day.lunchUsed else { throw .lunchAlreadyUsed }
        guard activeAllowance == nil else { throw .allowanceActive }

        let end = min(now.addingTimeInterval(TimeInterval(WorkRules.lunchMinutes * 60)), workEndDate)
        let allowance = Allowance(kind: .lunch, reason: "점심", start: now, end: end)
        closeSpans(at: now)
        day.allowances.append(allowance)
        day.lunchUsed = true
        post(MailTemplates.lunchRequest(name: profile.name, at: now))
        post(MailTemplates.lunchApproval(allowance: allowance, at: now))
        log(.lunchStart, "점심 승인 \(allowance.start.hm)~\(allowance.end.hm)")
        return allowance
    }

    public var canRegisterAway: Bool {
        (day.phase == .working || day.phase == .overtime) && activeAllowance == nil
    }

    /// 사유를 등록하고 자리를 비운다. 건당 15분을 부여한다.
    @discardableResult
    public mutating func registerAway(reason: String) throws(OfficeError) -> Allowance {
        guard day.phase == .working || day.phase == .overtime else {
            throw .notAllowedNow("자리 비움 등록은 근무 중에 할 수 있습니다.")
        }
        let trimmed = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw .emptyReason }
        guard activeAllowance == nil else { throw .allowanceActive }

        let boundary = day.phase == .overtime ? overtimeEndDate : workEndDate
        let end = min(now.addingTimeInterval(TimeInterval(WorkRules.awayMinutes * 60)), boundary)
        let allowance = Allowance(kind: .away, reason: trimmed, start: now, end: end)
        closeSpans(at: now)
        day.allowances.append(allowance)
        log(.awayStart, "자리 비움 등록 \(allowance.start.hm)~\(allowance.end.hm) · \(trimmed)")
        return allowance
    }

    /// 허용 시간이 끝나기 전에 복귀한다. 저녁시간은 정해진 시각에 끝난다.
    public mutating func returnFromAllowance() {
        guard let index = day.allowances.lastIndex(where: \.isActive),
              day.allowances[index].kind != .dinner else { return }
        day.allowances[index].endedAt = now
        let allowance = day.allowances[index]
        log(allowance.kind == .lunch ? .lunchEnd : .awayEnd,
            "\(allowance.kind.label) 복귀 \(now.hm) · 착석 확인 재개")
        reconcilePresence(at: now)
    }

    // MARK: - 카메라 착석 확인

    /// 지금 착석 여부를 판정하는 중인지. 허용 시간 안에서는 쉰다.
    public var isMonitoring: Bool {
        (day.phase == .working || day.phase == .overtime) && activeAllowance == nil
    }

    /// 카메라가 본 자리 상태를 알린다.
    public mutating func observe(_ state: PresenceState) {
        guard state != presence else { return }
        presence = state
        reconcilePresence(at: now)
    }

    /// 허용 시간 밖에서 자리가 비어 있던 시간(분).
    public var unauthorizedAwayMinutes: Int {
        day.awaySpans.filter { $0.kind == .unauthorized }.reduce(0) { $0 + $1.minutes(until: now) }
    }

    /// 카메라가 꺼져 있던 시간(분). 확인한 뒤 근태를 확정한다.
    public var cameraOffMinutes: Int {
        day.awaySpans.filter { $0.kind == .cameraOff }.reduce(0) { $0 + $1.minutes(until: now) }
    }

    public func openSpan(_ kind: AwaySpan.Kind) -> AwaySpan? {
        day.awaySpans.last { $0.kind == kind && $0.end == nil }
    }

    private mutating func reconcilePresence(at time: Date) {
        sync(.unauthorized, wanted: isMonitoring && presence == .absent, at: time)
        sync(.cameraOff, wanted: isMonitoring && presence == .cameraOff, at: time)
    }

    private mutating func sync(_ kind: AwaySpan.Kind, wanted: Bool, at time: Date) {
        let openIndex = day.awaySpans.lastIndex { $0.kind == kind && $0.end == nil }
        if wanted, openIndex == nil {
            day.awaySpans.append(AwaySpan(kind: kind, start: time))
            switch kind {
            case .unauthorized: log(.unauthorizedAwayStart, "근무 중 자리 비움 시작 \(time.hm)", at: time)
            case .cameraOff: log(.cameraOff, "카메라 꺼짐 \(time.hm) · 확인 필요", at: time)
            }
        } else if !wanted, let index = openIndex {
            closeSpan(at: index, time: time)
        }
    }

    private mutating func closeSpan(at index: Int, time: Date) {
        guard day.awaySpans[index].end == nil else { return }
        let end = max(time, day.awaySpans[index].start)
        day.awaySpans[index].end = end
        let minutes = day.awaySpans[index].minutes(until: end)
        switch day.awaySpans[index].kind {
        case .unauthorized: log(.unauthorizedAwayEnd, "복귀 \(end.hm) · 자리 비움 \(Clock.duration(minutes))", at: end)
        case .cameraOff: log(.cameraOn, "카메라 다시 확인 \(end.hm) · 꺼짐 \(Clock.duration(minutes))", at: end)
        }
    }

    private mutating func closeSpans(at time: Date) {
        for index in day.awaySpans.indices where day.awaySpans[index].end == nil {
            closeSpan(at: index, time: time)
        }
    }

    // MARK: - 가상 시계

    /// 시계를 `target`까지 흐르게 한다. 하루를 넘기지 않는다.
    public mutating func advance(to target: Date) {
        guard target > now else { return }
        now = min(target, day.date.at(24 * 60 - 1))
        catchUp()
    }

    public struct SkipResult: Sendable, Equatable {
        public var from: Date
        public var to: Date
        /// 한 시간을 다 가지 않고 일과 시각에서 멈췄다면 그 이유.
        public var stoppedFor: String?
    }

    /// '+1시간'을 쓸 수 있는지. 점검을 제출해야 하는 단계와 퇴근 뒤에는 쓸 수 없다.
    public var canSkipHour: Bool {
        switch day.phase {
        case .checkoutReview, .overtimeReview, .off: false
        case .beforeCheckIn: !day.absentCandidate
        case .morningPT, .working, .dinner, .overtime: true
        }
    }

    /// 지금 단계가 끝나는 시각.
    private var phaseBoundary: (date: Date, why: String)? {
        switch day.phase {
        case .beforeCheckIn: day.absentCandidate ? nil : (workEndDate, "퇴근 시각")
        case .morningPT, .working: (workEndDate, "퇴근 점검 시각")
        case .dinner: (overtimeStartDate, "추가근무 시작 시각")
        case .overtime: (overtimeEndDate, "추가근무 종료 시각")
        case .checkoutReview, .overtimeReview, .off: nil
        }
    }

    /// 시연 시간을 다음 정각으로 보낸다. 다음 정각까지 30분이 안 남았으면 그다음 정각으로 간다(08:55 → 10:00).
    /// 60분을 그대로 더하면 08:55에서 시작한 하루가 11:55·17:55처럼 어정쩡한 시각에 서고,
    /// 17:55에서는 퇴근 점검이 아직 열리지 않아 헤맨다.
    /// 퇴근 점검, 추가근무 시작, 추가근무 종료 시각이 그 사이에 있으면 그 시각에서 멈춘다.
    /// 건너뛴 시간에는 카메라로 본 것이 없으므로 자리 비움을 세지 않는다.
    /// 점심과 등록한 자리 비움은 등록된 종료 시각에 만료한다.
    @discardableResult
    public mutating func skipHour() -> SkipResult? {
        guard canSkipHour else { return nil }
        let from = now
        let minute = from.minuteOfDay
        var nextHour = (minute / 60 + 1) * 60
        if nextHour - minute < 30 { nextHour += 60 }
        var target = day.date.at(min(nextHour, 24 * 60 - 1))
        var stoppedFor: String?
        if let boundary = phaseBoundary, from < boundary.date, boundary.date <= target {
            stoppedFor = boundary.date < target ? boundary.why : nil
            target = boundary.date
        }
        closeSpans(at: from)
        // 건너뛴 뒤에는 카메라가 다시 알려 줄 때까지 자리 상태를 모르는 것으로 둔다.
        presence = .unknown
        now = min(target, day.date.at(24 * 60 - 1))
        catchUp()
        return SkipResult(from: from, to: now, stoppedFor: stoppedFor)
    }

    /// 시각이 바뀐 뒤 만료와 단계 전환을 반영한다.
    private mutating func catchUp() {
        expireAllowances()

        if day.phase == .beforeCheckIn, !day.absentCandidate, now >= workEndDate {
            day.absentCandidate = true
            log(.absentCandidate, "출근 기록 없음 · 결근 후보", at: workEndDate)
            post(MailTemplates.absentCandidate(day: day.date, profile: profile, stats: monthStats, at: workEndDate))
        }

        if day.phase == .morningPT || day.phase == .working, now >= workEndDate {
            if day.phase == .morningPT { day.noMorningPT = true }
            endActiveAllowance(at: workEndDate)
            closeSpans(at: workEndDate)
            day.phase = .checkoutReview
            log(.checkoutReview, "\(Clock.hm(profile.workEnd)) 퇴근 점검", at: workEndDate)
        }

        if day.phase == .dinner, now >= overtimeStartDate {
            endActiveAllowance(at: overtimeStartDate)
            day.phase = .overtime
            log(.overtimeStart, "\(Clock.hm(profile.overtimeStart)) 추가근무 시작 · 3단계부터 진행", at: overtimeStartDate)
            reconcilePresence(at: overtimeStartDate)
        }

        if day.phase == .overtime, now >= overtimeEndDate {
            endActiveAllowance(at: overtimeEndDate)
            closeSpans(at: overtimeEndDate)
            day.phase = .overtimeReview
            log(.overtimeEnd, "\(Clock.hm(profile.overtimeEnd)) 추가근무 종료", at: overtimeEndDate)
        }
    }

    /// 등록된 종료 시각이 지난 허용 시간을 만료한다.
    private mutating func expireAllowances() {
        for index in day.allowances.indices where day.allowances[index].isActive && day.allowances[index].end <= now {
            guard day.allowances[index].kind != .dinner else { continue }
            let end = day.allowances[index].end
            day.allowances[index].endedAt = end
            switch day.allowances[index].kind {
            case .lunch: log(.lunchEnd, "점심시간 종료 \(end.hm) · 착석 확인 재개", at: end)
            case .away: log(.awayEnd, "자리 비움 허용 종료 \(end.hm) · 착석 확인 재개", at: end)
            case .dinner: break
            }
            reconcilePresence(at: end)
        }
    }

    private mutating func endActiveAllowance(at time: Date) {
        for index in day.allowances.indices where day.allowances[index].isActive {
            day.allowances[index].endedAt = min(time, day.allowances[index].end)
        }
    }

    // MARK: - 퇴근 점검

    public enum CheckoutOutcome: Sendable, Equatable {
        /// 확정한 업무를 모두 끝내고 정시 퇴근.
        case offAllDone
        /// 1단계만 남아 이월 보고 후 정시 퇴근.
        case offWithCarry(count: Int)
        /// 확정한 업무 없이 퇴근.
        case offNoTasks
        /// 2·3단계가 남아 저녁시간과 추가근무를 배정.
        case overtimeAssigned(count: Int, carried: Int)
    }

    /// 퇴근 점검에서 이월 보고가 필요한 1단계 미완료 업무.
    public var carryReportTargets: [WorkTask] {
        openTasks.filter { $0.level == .carryable }
    }

    /// 추가근무 대상이 되는 2·3단계 미완료 업무.
    public var overtimeTargets: [WorkTask] {
        Self.sorted(openTasks.filter { $0.level != .carryable })
    }

    /// 퇴근 점검을 제출한다.
    /// 1단계만 남으면 이월 보고 후 정시 퇴근하고, 2·3단계가 남으면 저녁시간과 추가근무로 간다.
    @discardableResult
    public mutating func submitCheckout(carryReports: [UUID: CarryReport] = [:]) throws(OfficeError) -> CheckoutOutcome {
        guard day.phase == .checkoutReview else {
            throw .notAllowedNow("퇴근 점검은 퇴근 시각에 진행합니다.")
        }
        let carryTargets = carryReportTargets
        let heavy = overtimeTargets
        let missing = carryTargets.filter { !(carryReports[$0.id]?.isComplete ?? false) }
        guard missing.isEmpty else { throw .carryReportMissing(missing.map(\.title)) }

        if !carryTargets.isEmpty {
            post(MailTemplates.carryReport(name: profile.name, tasks: carryTargets, reports: carryReports, at: now))
            carry(carryTargets.map(\.id))
            post(MailTemplates.carryAccepted(tasks: carryTargets, nextDay: day.date.nextWorkday(), at: now))
            log(.carryOver, "1단계 \(carryTargets.count)건 이월 보고")
        }

        if heavy.isEmpty {
            day.phase = .off
            day.checkoutAt = now
            if day.tasks.isEmpty {
                post(MailTemplates.offWithoutTasks(at: now))
                log(.off, "퇴근 \(now.hm) · 아침 PT 미진행")
                return .offNoTasks
            }
            post(MailTemplates.offConfirmed(done: doneTasks.count, carried: carryTargets.count, at: now))
            log(.off, "퇴근 \(now.hm)")
            return carryTargets.isEmpty ? .offAllDone : .offWithCarry(count: carryTargets.count)
        }

        day.phase = .dinner
        day.overtimeTaskIDs = heavy.map(\.id)
        day.allowances.append(Allowance(kind: .dinner, reason: "저녁시간", start: workEndDate, end: overtimeStartDate))
        post(MailTemplates.overtimeAssigned(tasks: heavy, profile: profile, at: now))
        log(.dinnerStart, "저녁시간 \(Clock.hm(profile.workEnd))~\(Clock.hm(profile.overtimeStart)) · 추가근무 배정")
        // 점검을 늦게 제출해 이미 추가근무 시각을 넘겼다면 바로 이어 간다.
        catchUp()
        return .overtimeAssigned(count: heavy.count, carried: carryTargets.count)
    }

    // MARK: - 추가근무

    /// 추가근무를 종료 시각 전에 끝낸다.
    /// 남은 업무가 없으면 정상 종료, 남아 있으면 보충근무 미이행으로 기록하고 이월한다.
    @discardableResult
    public mutating func endOvertimeEarly() throws(OfficeError) -> OvertimeOutcome {
        guard day.phase == .dinner || day.phase == .overtime else {
            throw .notAllowedNow("추가근무 중이 아닙니다.")
        }
        let remaining = openTasks
        let outcome: OvertimeOutcome
        endActiveAllowance(at: now)
        closeSpans(at: now)
        if remaining.isEmpty {
            outcome = .completed
            post(MailTemplates.overtimeCompleted(done: overtimeTasks, at: now))
            log(.overtimeEnd, "추가근무 완료 \(now.hm)")
        } else {
            outcome = .abandoned
            carry(remaining.map(\.id))
            post(MailTemplates.supplementMissed(carried: remaining, nextDay: day.date.nextWorkday(), profile: profile, at: now))
            log(.supplementMissed, "보충근무 미이행 · \(remaining.count)건 이월")
        }
        day.overtime = outcome
        day.phase = .off
        day.checkoutAt = now
        log(.off, "퇴근 \(now.hm)")
        return outcome
    }

    /// 추가근무 종료 시각의 점검을 제출한다. 남은 업무는 다음 근무일로 이월한다.
    @discardableResult
    public mutating func submitOvertimeReview() throws(OfficeError) -> OvertimeOutcome {
        guard day.phase == .overtimeReview else {
            throw .notAllowedNow("추가근무 종료 점검은 추가근무가 끝나는 시각에 진행합니다.")
        }
        let remaining = openTasks
        let outcome: OvertimeOutcome
        if remaining.isEmpty {
            outcome = .completed
            post(MailTemplates.overtimeCompleted(done: overtimeTasks, at: now))
            log(.overtimeEnd, "추가근무 완료 \(now.hm)")
        } else {
            outcome = .ranToEnd
            carry(remaining.map(\.id))
            post(MailTemplates.overtimeRanToEnd(carried: remaining, nextDay: day.date.nextWorkday(), profile: profile, at: now))
            log(.carryOver, "남은 업무 \(remaining.count)건 다음 근무일로 이월")
        }
        day.overtime = outcome
        day.phase = .off
        day.checkoutAt = now
        log(.off, "퇴근 \(now.hm)")
        return outcome
    }

    /// 업무를 다음 근무일로 넘긴다.
    private mutating func carry(_ ids: [UUID]) {
        for id in ids {
            guard let index = day.tasks.firstIndex(where: { $0.id == id }), day.tasks[index].isOpen else { continue }
            day.tasks[index].status = .carried
            var next = day.tasks[index]
            next.id = UUID()
            next.status = .open
            next.doneAt = nil
            next.deliverable = ""
            next.carriedFrom = day.tasks[index].carriedFrom ?? day.date
            next.carryCount += 1
            pendingCarry.append(next)
        }
    }

    // MARK: - 주간보고

    /// 금요일에 출근했고 아직 제출하지 않았을 때 제출할 수 있다.
    public var canSubmitWeekly: Bool {
        day.date.isFriday && day.checkInAt != nil && !day.weeklySubmitted
    }

    /// 직접 작성한 주간보고서를 올린다. 답장은 따로 받는다.
    @discardableResult
    public mutating func submitWeeklyReport(_ report: WeeklyReport) throws(OfficeError) -> WeeklyReport {
        guard day.date.isFriday else { throw .weeklyNotFriday }
        guard day.checkInAt != nil else {
            throw .notAllowedNow("주간보고서는 출근한 뒤에 제출할 수 있습니다.")
        }
        guard !day.weeklySubmitted else { throw .weeklyAlreadySubmitted }
        let missing = report.missingSections
        guard missing.isEmpty else { throw .weeklyIncomplete(missing) }

        var submitted = report
        submitted.submittedAt = now
        submitted.weekOf = day.date.mondayOfWeek()
        weeklyReports.append(submitted)
        weeklyDraft = submitted
        day.weeklySubmitted = true
        post(MailTemplates.weeklyReport(name: profile.name, report: submitted, day: day.date, at: now))
        log(.weeklyReport, "주간보고서 제출 \(now.hm)")
        return submitted
    }

    /// 답장을 아직 받지 못한 주간보고서.
    public var weeklyAwaitingReply: WeeklyReport? {
        weeklyReports.last { $0.submittedAt != nil && $0.replyMailID == nil }
    }

    /// 상사의 주간보고 답장을 메일함에 넣는다.
    public mutating func receiveWeeklyFeedback(reportID: UUID, subject: String, body: String, source: ReplySource) {
        guard let index = weeklyReports.firstIndex(where: { $0.id == reportID }),
              weeklyReports[index].replyMailID == nil else { return }
        let mail = Mail(sentAt: now, from: .manager, to: .me, kind: .weeklyFeedback,
                        subject: subject, body: body, isWarm: true, replySource: source)
        weeklyReports[index].replyMailID = mail.id
        post(mail)
    }

    // MARK: - 다음 근무일

    public var canStartNextWorkday: Bool {
        day.phase == .off || (day.phase == .beforeCheckIn && day.absentCandidate)
    }

    /// 하루를 마감하고 다음 근무일 아침으로 간다. 이월된 업무가 새 목록에 들어간다.
    public mutating func startNextWorkday() {
        guard canStartNextWorkday else { return }
        archiveDay()
        beginDay(day.date.nextWorkday())
    }

    /// 금요일이 아닌 날에 금요일 장면으로 바로 갈 수 있다(시연 도구).
    public var canJumpToFriday: Bool { onboarded && !day.date.isFriday }

    /// 시연용. 진행 중인 하루를 불이익 없이 마감하고 이번 주 금요일 아침으로 간다.
    /// 남은 업무는 이월한다. 사이의 날은 기록하지 않는다.
    public mutating func jumpToFriday() {
        guard canJumpToFriday else { return }
        endActiveAllowance(at: now)
        closeSpans(at: now)
        carry(openTasks.map(\.id))
        if day.checkInAt != nil || day.absentCandidate {
            if day.checkInAt != nil, day.checkoutAt == nil { day.checkoutAt = now }
            archiveDay()
        }
        var friday = day.date.adding(days: 1)
        while !friday.isFriday { friday = friday.adding(days: 1) }
        beginDay(friday)
    }

    private mutating func archiveDay() {
        guard let attendance = day.attendance else { return }
        let record = DayRecord(date: day.date, attendance: attendance, checkInAt: day.checkInAt,
                               checkoutAt: day.checkoutAt, tasks: day.tasks,
                               unauthorizedAwayMinutes: unauthorizedAwayMinutes,
                               cameraOffMinutes: cameraOffMinutes, overtime: day.overtime,
                               noMorningPT: day.noMorningPT, events: day.events)
        history.removeAll { $0.date == record.date }
        history.append(record)
    }

    private mutating func beginDay(_ date: DayKey) {
        // 확정하지 못하고 지나간 날의 이월 업무도 그대로 다음 근무일로 넘긴다.
        if day.confirmedAt == nil {
            let leftover = day.drafts.filter(\.isCarried).map { draft in
                WorkTask(title: draft.title ?? "", level: draft.level ?? .carryable,
                         due: draft.due ?? profile.workEnd, doneCriteria: draft.doneCriteria ?? "",
                         carriedFrom: draft.carriedFrom, carryCount: draft.carryCount)
            }
            pendingCarry = leftover + pendingCarry
        }
        let carried = pendingCarry
        var next = WorkDay(date: date)
        next.drafts = carried.map {
            TaskDraft(title: $0.title, level: $0.level, due: $0.due, doneCriteria: $0.doneCriteria,
                      carriedFrom: $0.carriedFrom, carryCount: $0.carryCount)
        }
        pendingCarry = []
        day = next
        now = date.at(WorkRules.demoStartMinute)
        presence = .unknown
        if weeklyDraft.submittedAt != nil || weeklyDraft.weekOf != date.mondayOfWeek() {
            weeklyDraft = WeeklyReport(weekOf: date.mondayOfWeek())
        }
        post(MailTemplates.morningNotice(day: date, profile: profile, carried: carried,
                                         at: date.at(max(0, profile.workStart - 30))))
    }

    // MARK: - 근태 집계와 지각비 예상액

    /// 이번 달 지각과 결근 후보 횟수. 오늘 기록을 포함한다.
    public var monthStats: MonthStats {
        var stats = MonthStats()
        for record in history where record.date.year == day.date.year && record.date.month == day.date.month
            && record.date != day.date {
            switch record.attendance {
            case .late: stats.late += 1
            case .absentCandidate: stats.absent += 1
            case .onTime: break
            }
        }
        switch day.attendance {
        case .late: stats.late += 1
        case .absentCandidate: stats.absent += 1
        case .onTime, .none: break
        }
        return stats
    }

    // MARK: - 사내 메일

    public var inbox: [Mail] {
        mails.filter(\.isIncoming).sorted { $0.sentAt > $1.sentAt }
    }

    public var sent: [Mail] {
        mails.filter { !$0.isIncoming }.sorted { $0.sentAt > $1.sentAt }
    }

    public var unreadCount: Int {
        mails.filter { $0.isIncoming && !$0.isRead }.count
    }

    public mutating func markRead(_ id: UUID) {
        guard let index = mails.firstIndex(where: { $0.id == id }) else { return }
        mails[index].isRead = true
    }

    private mutating func post(_ mail: Mail) {
        mails.append(mail)
    }

    private mutating func log(_ kind: AttendanceEvent.Kind, _ text: String, at time: Date? = nil) {
        day.events.append(AttendanceEvent(at: time ?? now, kind: kind, text: text))
    }
}
