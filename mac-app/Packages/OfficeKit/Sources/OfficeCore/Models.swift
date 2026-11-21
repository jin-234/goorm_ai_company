import Foundation

// MARK: - 사원

public struct EmployeeProfile: Codable, Sendable, Equatable {
    public var name: String
    /// 배정된 근무 시작 시각(자정 기준 분). 시연 기본값 09:00.
    public var workStart: Int
    /// 배정된 근무 종료 시각(자정 기준 분). 시연 기본값 18:00.
    public var workEnd: Int

    public init(name: String = "김서울", workStart: Int = WorkRules.defaultWorkStart, workEnd: Int = WorkRules.defaultWorkEnd) {
        self.name = name
        self.workStart = workStart
        self.workEnd = workEnd
    }

    /// 저녁시간이 끝나고 추가근무가 시작되는 시각.
    public var overtimeStart: Int { workEnd + WorkRules.dinnerMinutes }
    /// 추가근무가 끝나는 시각.
    public var overtimeEnd: Int { overtimeStart + WorkRules.overtimeMinutes }
}

// MARK: - 하루의 단계

public enum Phase: String, Codable, Sendable, CaseIterable {
    /// 출근 전. 사무실 문이 닫혀 있다.
    case beforeCheckIn
    /// 출근은 했고 아침 PT로 업무를 확정하기 전.
    case morningPT
    /// 업무를 확정하고 근무하는 중.
    case working
    /// 퇴근 시각이 되어 결과물과 미완료 업무를 점검하는 중.
    case checkoutReview
    /// 추가근무 전 저녁시간.
    case dinner
    /// 추가근무.
    case overtime
    /// 추가근무 종료 시각이 되어 결과물을 올리는 중.
    case overtimeReview
    /// 퇴근.
    case off

    public var label: String {
        switch self {
        case .beforeCheckIn: "출근 전"
        case .morningPT: "아침 PT"
        case .working: "근무 중"
        case .checkoutReview: "퇴근 점검"
        case .dinner: "저녁시간"
        case .overtime: "추가근무"
        case .overtimeReview: "추가근무 종료"
        case .off: "퇴근"
        }
    }
}

// MARK: - 업무

/// 업무 중요도 3단계.
public enum TaskLevel: Int, Codable, Sendable, CaseIterable, Comparable {
    /// 1단계 · 이월 가능
    case carryable = 1
    /// 2단계 · 당일 완료
    case sameDay = 2
    /// 3단계 · 필수 마감
    case mustFinish = 3

    public static func < (lhs: TaskLevel, rhs: TaskLevel) -> Bool { lhs.rawValue < rhs.rawValue }

    /// 예: 3단계
    public var short: String { "\(rawValue)단계" }

    /// 예: 필수 마감
    public var meaning: String {
        switch self {
        case .carryable: "이월 가능"
        case .sameDay: "당일 완료"
        case .mustFinish: "필수 마감"
        }
    }

    /// 예: 3단계 · 필수 마감
    public var label: String { "\(short) · \(meaning)" }

    /// 퇴근 시각에 끝나지 않았을 때 어떻게 되는지.
    public var ruleAtWorkEnd: String {
        switch self {
        case .carryable: "미완료 이유와 다음 근무일 계획을 메일로 보고하고 이월합니다."
        case .sameDay: "저녁시간 뒤 추가근무에서 끝냅니다."
        case .mustFinish: "추가근무에서 가장 먼저 진행합니다."
        }
    }
}

public enum TaskStatus: String, Codable, Sendable {
    case open
    case done
    /// 다음 근무일로 이월됨.
    case carried
}

/// 아침 PT에서 확정한 업무.
public struct WorkTask: Identifiable, Codable, Sendable, Hashable {
    public var id: UUID
    public var title: String
    public var level: TaskLevel
    /// 마감 시각(자정 기준 분).
    public var due: Int
    public var doneCriteria: String
    public var status: TaskStatus
    public var doneAt: Date?
    /// 결과물. 메모, 링크, 파일 이름 등.
    public var deliverable: String
    /// 이월된 업무라면 처음 확정한 날.
    public var carriedFrom: DayKey?
    /// 이월된 횟수.
    public var carryCount: Int

    public init(id: UUID = UUID(), title: String, level: TaskLevel, due: Int, doneCriteria: String,
                status: TaskStatus = .open, doneAt: Date? = nil, deliverable: String = "",
                carriedFrom: DayKey? = nil, carryCount: Int = 0) {
        self.id = id
        self.title = title
        self.level = level
        self.due = due
        self.doneCriteria = doneCriteria
        self.status = status
        self.doneAt = doneAt
        self.deliverable = deliverable
        self.carriedFrom = carriedFrom
        self.carryCount = carryCount
    }

    public var isDone: Bool { status == .done }
    public var isOpen: Bool { status == .open }
}

/// 아침 PT 초안의 업무 한 줄. 전사문에 없는 값은 nil이고 화면에 '확인 필요'로 보인다.
public struct TaskDraft: Identifiable, Codable, Sendable, Hashable {
    public var id: UUID
    public var title: String?
    public var level: TaskLevel?
    public var due: Int?
    public var doneCriteria: String?
    public var carriedFrom: DayKey?
    public var carryCount: Int

    public init(id: UUID = UUID(), title: String? = nil, level: TaskLevel? = nil, due: Int? = nil,
                doneCriteria: String? = nil, carriedFrom: DayKey? = nil, carryCount: Int = 0) {
        self.id = id
        self.title = title
        self.level = level
        self.due = due
        self.doneCriteria = doneCriteria
        self.carriedFrom = carriedFrom
        self.carryCount = carryCount
    }

    public var isCarried: Bool { carriedFrom != nil }

    /// 아직 채우지 않은 칸의 이름.
    public var missingFields: [String] {
        var missing: [String] = []
        if (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append("업무명") }
        if level == nil { missing.append("중요도") }
        if due == nil { missing.append("마감") }
        if (doneCriteria ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append("완료 기준") }
        return missing
    }

    public var isComplete: Bool { missingFields.isEmpty }
}

/// 업무 초안을 누가 만들었는지.
public enum DraftSource: String, Codable, Sendable {
    /// Upstage Solar가 전사문을 정리함.
    case solar
    /// Solar에 연결하지 못해 기기 안 규칙으로 정리함.
    case localRules
    /// 사용자가 직접 입력함.
    case manual

    public var label: String {
        switch self {
        case .solar: "Solar가 정리한 초안"
        case .localRules: "기기 안 규칙으로 정리한 초안 (Solar 미연결)"
        case .manual: "직접 입력"
        }
    }
}

// MARK: - 근태

/// 허용된 자리 비움. 이 시간 안에는 착석 확인을 쉰다.
public enum AllowanceKind: String, Codable, Sendable {
    case lunch
    case away
    case dinner

    public var label: String {
        switch self {
        case .lunch: "점심"
        case .away: "자리 비움"
        case .dinner: "저녁시간"
        }
    }
}

public struct Allowance: Identifiable, Codable, Sendable, Equatable {
    public var id: UUID
    public var kind: AllowanceKind
    public var reason: String
    public var start: Date
    /// 등록된 종료 시각. 시연 시간을 건너뛰어도 이 시각에 만료한다.
    public var end: Date
    /// 실제로 끝난 시각. 먼저 복귀했으면 `end`보다 이르다.
    public var endedAt: Date?

    public init(id: UUID = UUID(), kind: AllowanceKind, reason: String, start: Date, end: Date, endedAt: Date? = nil) {
        self.id = id
        self.kind = kind
        self.reason = reason
        self.start = start
        self.end = end
        self.endedAt = endedAt
    }

    public var isActive: Bool { endedAt == nil }
}

/// 카메라가 본 자리 상태.
public enum PresenceState: String, Codable, Sendable {
    /// 사람이 보인다.
    case present
    /// 사람이 보이지 않는다.
    case absent
    /// 카메라가 꺼져 있거나 영상을 받지 못한다. 자리 비움과 다른 상태다.
    case cameraOff
    /// 아직 확인 전.
    case unknown
}

/// 허용 시간 밖에서 자리가 비었거나 카메라가 꺼져 있던 구간.
public struct AwaySpan: Identifiable, Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable {
        /// 근무 중 자리 비움.
        case unauthorized
        /// 카메라 꺼짐. 확인한 뒤 근태를 확정한다.
        case cameraOff
    }

    public var id: UUID
    public var kind: Kind
    public var start: Date
    public var end: Date?

    public init(id: UUID = UUID(), kind: Kind, start: Date, end: Date? = nil) {
        self.id = id
        self.kind = kind
        self.start = start
        self.end = end
    }

    public func minutes(until now: Date) -> Int {
        let finish = end ?? now
        return max(0, Int(finish.timeIntervalSince(start) / 60))
    }
}

/// 근태 기록 한 줄.
public struct AttendanceEvent: Identifiable, Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable {
        case checkIn
        case late
        case absentCandidate
        case tasksConfirmed
        case lunchStart
        case lunchEnd
        case awayStart
        case awayEnd
        case unauthorizedAwayStart
        case unauthorizedAwayEnd
        case cameraOff
        case cameraOn
        case checkoutReview
        case carryOver
        case dinnerStart
        case overtimeStart
        case overtimeEnd
        case supplementMissed
        case off
        case timeSkip
        case weeklyReport
        case note
    }

    public var id: UUID
    public var at: Date
    public var kind: Kind
    public var text: String

    public init(id: UUID = UUID(), at: Date, kind: Kind, text: String) {
        self.id = id
        self.at = at
        self.kind = kind
        self.text = text
    }

    /// 주의가 필요한 기록인지. 색만으로 구분하지 않도록 화면에서 표시를 함께 붙인다.
    public var isWarning: Bool {
        switch kind {
        case .late, .absentCandidate, .unauthorizedAwayStart, .cameraOff, .supplementMissed: true
        default: false
        }
    }
}

/// 하루의 출근 판정.
public enum Attendance: String, Codable, Sendable {
    case onTime
    case late
    /// 당일 출근 기록이 없음. 월말에 확인·정정한 뒤 확정한다.
    case absentCandidate

    public var label: String {
        switch self {
        case .onTime: "정상 출근"
        case .late: "지각"
        case .absentCandidate: "결근 후보"
        }
    }
}

public enum OvertimeOutcome: String, Codable, Sendable {
    /// 추가근무에서 남은 업무를 모두 끝냄.
    case completed
    /// 추가근무 종료 시각까지 근무했고 남은 업무는 이월함.
    case ranToEnd
    /// 남은 업무를 두고 먼저 종료함. 보충근무 미이행.
    case abandoned

    public var label: String {
        switch self {
        case .completed: "추가근무 완료"
        case .ranToEnd: "추가근무 종료 시각까지 근무"
        case .abandoned: "보충근무 미이행"
        }
    }
}

// MARK: - 오늘

public struct WorkDay: Codable, Sendable, Equatable {
    public var date: DayKey
    public var phase: Phase
    public var checkInAt: Date?
    public var isLate: Bool
    public var absentCandidate: Bool

    /// 아침 PT 전사문. 연결에 실패해도 지우지 않는다.
    public var transcript: String
    public var drafts: [TaskDraft]
    public var draftSource: DraftSource?

    public var tasks: [WorkTask]
    public var confirmedAt: Date?

    public var allowances: [Allowance]
    public var lunchUsed: Bool
    public var awaySpans: [AwaySpan]
    public var events: [AttendanceEvent]

    public var checkoutAt: Date?
    /// 퇴근 점검에서 추가근무에 배정된 업무.
    public var overtimeTaskIDs: [UUID]
    public var overtime: OvertimeOutcome?
    public var noMorningPT: Bool
    public var weeklySubmitted: Bool

    public init(date: DayKey) {
        self.overtimeTaskIDs = []
        self.date = date
        self.phase = .beforeCheckIn
        self.checkInAt = nil
        self.isLate = false
        self.absentCandidate = false
        self.transcript = ""
        self.drafts = []
        self.draftSource = nil
        self.tasks = []
        self.confirmedAt = nil
        self.allowances = []
        self.lunchUsed = false
        self.awaySpans = []
        self.events = []
        self.checkoutAt = nil
        self.overtime = nil
        self.noMorningPT = false
        self.weeklySubmitted = false
    }

    public var attendance: Attendance? {
        if checkInAt != nil { return isLate ? .late : .onTime }
        return absentCandidate ? .absentCandidate : nil
    }
}

/// 마감한 근무일의 요약.
public struct DayRecord: Identifiable, Codable, Sendable, Equatable {
    public var id: DayKey { date }
    public var date: DayKey
    public var attendance: Attendance
    public var checkInAt: Date?
    public var checkoutAt: Date?
    public var tasks: [WorkTask]
    public var unauthorizedAwayMinutes: Int
    public var cameraOffMinutes: Int
    public var overtime: OvertimeOutcome?
    public var noMorningPT: Bool
    public var events: [AttendanceEvent]

    public init(date: DayKey, attendance: Attendance, checkInAt: Date?, checkoutAt: Date?, tasks: [WorkTask],
                unauthorizedAwayMinutes: Int, cameraOffMinutes: Int, overtime: OvertimeOutcome?,
                noMorningPT: Bool, events: [AttendanceEvent]) {
        self.date = date
        self.attendance = attendance
        self.checkInAt = checkInAt
        self.checkoutAt = checkoutAt
        self.tasks = tasks
        self.unauthorizedAwayMinutes = unauthorizedAwayMinutes
        self.cameraOffMinutes = cameraOffMinutes
        self.overtime = overtime
        self.noMorningPT = noMorningPT
        self.events = events
    }

    public var doneTasks: [WorkTask] { tasks.filter(\.isDone) }
    public var carriedTasks: [WorkTask] { tasks.filter { $0.status == .carried } }
}

// MARK: - 사내 메일

public enum MailParty: String, Codable, Sendable {
    case me
    case manager
    case hr

    public func displayName(myName: String) -> String {
        switch self {
        case .me: "\(myName) 사원"
        case .manager: "\(Cast.managerName) 팀장"
        case .hr: "인사팀"
        }
    }
}

public enum MailKind: String, Codable, Sendable {
    case welcome
    case notice
    case tasksConfirmed
    case lunchRequest
    case lunchApproval
    case carryReport
    case carryAccepted
    case overtimeAssigned
    case overtimeResult
    case supplementMissed
    case offConfirmed
    case attendance
    case weeklyReport
    case weeklyFeedback

    /// 메일 목록에 붙는 분류 이름.
    public var tag: String {
        switch self {
        case .welcome: "인사"
        case .notice: "공지"
        case .tasksConfirmed, .carryReport, .carryAccepted: "업무"
        case .lunchRequest, .lunchApproval, .overtimeAssigned, .overtimeResult,
             .supplementMissed, .offConfirmed, .attendance: "근태"
        case .weeklyReport: "주간보고"
        case .weeklyFeedback: "주간 피드백"
        }
    }
}

/// 답장을 누가 썼는지. 주간 피드백에만 쓴다.
public enum ReplySource: String, Codable, Sendable {
    case solar
    case localTemplate
}

public struct Mail: Identifiable, Codable, Sendable, Equatable {
    public var id: UUID
    public var sentAt: Date
    public var from: MailParty
    public var to: MailParty
    public var kind: MailKind
    public var subject: String
    public var body: String
    public var isRead: Bool
    /// 주간보고 답장처럼 따뜻한 문체로 쓴 메일인지. 평소 업무 메일은 건조하게 쓴다.
    public var isWarm: Bool
    public var replySource: ReplySource?

    public init(id: UUID = UUID(), sentAt: Date, from: MailParty, to: MailParty, kind: MailKind,
                subject: String, body: String, isRead: Bool = false, isWarm: Bool = false,
                replySource: ReplySource? = nil) {
        self.id = id
        self.sentAt = sentAt
        self.from = from
        self.to = to
        self.kind = kind
        self.subject = subject
        self.body = body
        self.isRead = isRead
        self.isWarm = isWarm
        self.replySource = replySource
    }

    public var isIncoming: Bool { to == .me }
}

// MARK: - 주간보고

public struct WeeklyReport: Identifiable, Codable, Sendable, Equatable {
    public var id: UUID
    public var weekOf: DayKey
    public var submittedAt: Date?
    /// 이번 주 완료한 업무와 결과물
    public var completed: String
    /// 미완료 업무와 이유
    public var incomplete: String
    /// 다음 주 목표
    public var nextGoals: String
    /// 상사 답장 메일. 아직 받지 못했으면 nil.
    public var replyMailID: UUID?

    public init(id: UUID = UUID(), weekOf: DayKey, submittedAt: Date? = nil,
                completed: String = "", incomplete: String = "", nextGoals: String = "",
                replyMailID: UUID? = nil) {
        self.id = id
        self.weekOf = weekOf
        self.submittedAt = submittedAt
        self.completed = completed
        self.incomplete = incomplete
        self.nextGoals = nextGoals
        self.replyMailID = replyMailID
    }

    /// 아직 쓰지 않은 칸의 이름.
    public var missingSections: [String] {
        var missing: [String] = []
        if completed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append("이번 주 완료한 업무와 결과물") }
        if incomplete.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append("미완료 업무와 이유") }
        if nextGoals.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { missing.append("다음 주 목표") }
        return missing
    }

    /// 메일과 Solar에 보내는 본문.
    public var bodyText: String {
        """
        1. 이번 주 완료한 업무와 결과물
        \(completed.trimmingCharacters(in: .whitespacesAndNewlines))

        2. 미완료 업무와 이유
        \(incomplete.trimmingCharacters(in: .whitespacesAndNewlines))

        3. 다음 주 목표
        \(nextGoals.trimmingCharacters(in: .whitespacesAndNewlines))
        """
    }
}

// MARK: - 등장인물

/// 사무실 사람들. 나를 뺀 모두가 AI다.
public enum Cast {
    public static let managerName = "한정민"
    public static let peerNames = ["이하준", "박서윤"]
    public static let teamName = "가상회사 1팀"
}

// MARK: - 1단계 이월 보고

public struct CarryReport: Codable, Sendable, Equatable {
    /// 미완료 이유
    public var reason: String
    /// 다음 근무일 완료 계획
    public var plan: String

    public init(reason: String = "", plan: String = "") {
        self.reason = reason
        self.plan = plan
    }

    public var isComplete: Bool {
        !reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !plan.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
