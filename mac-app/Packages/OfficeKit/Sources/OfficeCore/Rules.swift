import Foundation

/// 근무 시간 규칙. 단일 엄격 관리 기준이다.
public enum WorkRules {
    /// 시연 기본 출근 시각 09:00
    public static let defaultWorkStart = 9 * 60
    /// 시연 기본 퇴근 시각 18:00
    public static let defaultWorkEnd = 18 * 60
    /// 시연을 시작하는 시각 08:55
    public static let demoStartMinute = 8 * 60 + 55
    /// 승인된 점심 1시간
    public static let lunchMinutes = 60
    /// 등록한 자리 비움 건당 15분
    public static let awayMinutes = 15
    /// 추가근무 전 저녁시간 1시간 (18:00~19:00)
    public static let dinnerMinutes = 60
    /// 추가근무 3시간 (19:00~22:00)
    public static let overtimeMinutes = 180
}

/// 지각비. 시연에서는 예상액으로만 보여 주고 실제로 청구하지 않는다.
public enum LateFee {
    /// 지각 1회 = 1점
    public static let pointsPerLate = 1
    /// 무단결근 1회 = 3점
    public static let pointsPerAbsence = 3
    /// 월 누적 2점까지 0원
    public static let freePoints = 2
    /// 초과 1점당 1,000원
    public static let wonPerPoint = 1_000
    /// 월 최대 5,000원
    public static let monthlyCap = 5_000

    public static func points(late: Int, absent: Int) -> Int {
        max(0, late) * pointsPerLate + max(0, absent) * pointsPerAbsence
    }

    public static func estimate(points: Int) -> Int {
        min(monthlyCap, max(0, points - freePoints) * wonPerPoint)
    }

    public static func estimate(late: Int, absent: Int) -> Int {
        estimate(points: points(late: late, absent: absent))
    }

    /// 예: 3,000원
    public static func won(_ amount: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = Locale(identifier: "ko_KR")
        return (formatter.string(from: NSNumber(value: amount)) ?? "\(amount)") + "원"
    }
}

/// 이번 달 근태 집계.
public struct MonthStats: Sendable, Equatable {
    public var late: Int
    public var absent: Int

    public init(late: Int = 0, absent: Int = 0) {
        self.late = late
        self.absent = absent
    }

    public var points: Int { LateFee.points(late: late, absent: absent) }
    public var estimatedFee: Int { LateFee.estimate(points: points) }
}

public enum OfficeError: Error, Equatable, Sendable {
    /// 지금 단계에서는 할 수 없는 일.
    case notAllowedNow(String)
    /// 확정하려는 업무에 비어 있는 칸이 있음. 업무별 빠진 칸 설명.
    case draftIncomplete([String])
    case noTasks
    case lunchAlreadyUsed
    /// 이미 점심이나 자리 비움 시간 안에 있음.
    case allowanceActive
    case emptyReason
    /// 1단계 업무 이월 보고가 빠짐. 업무명 목록.
    case carryReportMissing([String])
    case weeklyNotFriday
    case weeklyIncomplete([String])
    case weeklyAlreadySubmitted
}

extension OfficeError: LocalizedError {
    public var errorDescription: String? {
        switch self {
        case .notAllowedNow(let why):
            why
        case .draftIncomplete(let rows):
            "확인이 필요한 칸이 남아 있습니다.\n" + rows.joined(separator: "\n")
        case .noTasks:
            "확정할 업무가 없습니다.\n업무를 한 건 이상 넣어 주세요."
        case .lunchAlreadyUsed:
            "오늘 점심은 이미 사용했습니다."
        case .allowanceActive:
            "이미 허용된 시간 안에 있습니다.\n복귀한 뒤 다시 요청해 주세요."
        case .emptyReason:
            "자리를 비우는 사유를 적어 주세요."
        case .carryReportMissing(let titles):
            "1단계 업무의 미완료 이유와 다음 근무일 계획을 적어 주세요.\n" + titles.map { "· \($0)" }.joined(separator: "\n")
        case .weeklyNotFriday:
            "주간보고서는 금요일에 제출합니다."
        case .weeklyIncomplete(let sections):
            "아직 쓰지 않은 칸이 있습니다.\n" + sections.map { "· \($0)" }.joined(separator: "\n")
        case .weeklyAlreadySubmitted:
            "이번 주 주간보고서는 이미 제출했습니다."
        }
    }
}
