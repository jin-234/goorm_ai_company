import Foundation

/// 내 자리의 지금 상태. 내 책상 화면과 3D 사무실의 내 캐릭터가 이 값을 따른다.
public enum SeatStatus: Sendable, Equatable {
    /// 출근 전.
    case beforeCheckIn
    /// 출근 기록 없이 근무시간이 끝남.
    case absentCandidate
    /// 자리에 앉아 있음.
    case seated
    /// 자리 상태를 확인하는 중.
    case checking
    /// 근무를 시작하기 전(아침 PT) 자리가 비어 있음. 기록하지 않는다.
    case emptyBeforeWork
    /// 승인된 점심시간.
    case lunch(until: Date)
    /// 사유를 등록한 자리 비움.
    case away(until: Date, reason: String)
    /// 추가근무 전 저녁시간.
    case dinner(until: Date)
    /// 허용 시간 밖에서 자리가 비어 있음. 근무 중 자리 비움으로 기록한다.
    case unauthorizedAway(since: Date)
    /// 카메라가 꺼져 있음. 자리 비움과 다른 상태이며 확인한 뒤 근태를 확정한다.
    case cameraOff
    /// 퇴근 점검 또는 추가근무 종료 점검 중.
    case review
    /// 퇴근.
    case off

    /// 짧은 이름.
    public var title: String {
        switch self {
        case .beforeCheckIn: "출근 전"
        case .absentCandidate: "결근 후보"
        case .seated: "착석"
        case .checking: "자리 확인 중"
        case .emptyBeforeWork: "자리 비어 있음"
        case .lunch: "점심"
        case .away: "자리 비움 (등록됨)"
        case .dinner: "저녁시간"
        case .unauthorizedAway: "근무 중 자리 비움"
        case .cameraOff: "카메라 꺼짐"
        case .review: "점검 중"
        case .off: "퇴근"
        }
    }

    /// 한두 줄 설명. 의미 단위로 줄을 나눈다.
    public func detail(now: Date) -> String {
        switch self {
        case .beforeCheckIn:
            return "카메라 앞에 앉아\n출근 버튼을 눌러 주세요."
        case .absentCandidate:
            return "오늘은 출근 기록이 없습니다.\n다음 근무일에 출근해 주세요."
        case .seated:
            return "카메라에 사람이 보입니다."
        case .checking:
            return "카메라로 자리를 확인하고 있습니다."
        case .emptyBeforeWork:
            return "근무 시작 전이라 기록하지 않습니다."
        case .lunch(let until):
            return "\(until.hm)까지 착석 확인을 쉽니다.\n남은 시간 \(Clock.duration(Self.minutesLeft(until, now)))"
        case .away(let until, let reason):
            return "사유: \(reason)\n\(until.hm)까지 착석 확인을 쉽니다. 남은 시간 \(Clock.duration(Self.minutesLeft(until, now)))"
        case .dinner(let until):
            return "\(until.hm)에 추가근무를 시작합니다."
        case .unauthorizedAway(let since):
            let minutes = max(0, Int(now.timeIntervalSince(since) / 60))
            return "\(since.hm)부터 자리가 비어 있습니다.\n기록 중 · \(Clock.duration(minutes))"
        case .cameraOff:
            return "자리 비움으로 세지 않습니다.\n확인한 뒤 근태를 확정합니다."
        case .review:
            return "결과물과 미완료 업무를 확인해 주세요."
        case .off:
            return "오늘 근무를 마쳤습니다."
        }
    }

    /// 주의가 필요한 상태인지.
    public var isWarning: Bool {
        switch self {
        case .unauthorizedAway, .cameraOff, .absentCandidate: true
        default: false
        }
    }

    /// 내 캐릭터가 책상에 앉아 일하는 모습으로 보여야 하는지.
    public var showsWorkingAvatar: Bool {
        switch self {
        case .seated, .checking, .review: true
        default: false
        }
    }

    private static func minutesLeft(_ until: Date, _ now: Date) -> Int {
        max(0, Int((until.timeIntervalSince(now) / 60).rounded(.up)))
    }
}

public extension Office {
    var seatStatus: SeatStatus {
        switch day.phase {
        case .beforeCheckIn:
            return day.absentCandidate ? .absentCandidate : .beforeCheckIn
        case .off:
            return .off
        case .checkoutReview, .overtimeReview:
            return .review
        case .morningPT, .working, .dinner, .overtime:
            break
        }
        if let allowance = activeAllowance {
            switch allowance.kind {
            case .lunch: return .lunch(until: allowance.end)
            case .away: return .away(until: allowance.end, reason: allowance.reason)
            case .dinner: return .dinner(until: allowance.end)
            }
        }
        switch presence {
        case .present:
            return .seated
        case .absent:
            if isMonitoring { return .unauthorizedAway(since: openSpan(.unauthorized)?.start ?? now) }
            return .emptyBeforeWork
        case .cameraOff:
            return .cameraOff
        case .unknown:
            return .checking
        }
    }

    /// 화면 위쪽에 보여 줄 지금 단계 한 줄.
    var phaseHeadline: String {
        switch day.phase {
        case .beforeCheckIn:
            return day.absentCandidate ? "결근 후보 · 다음 근무일에 출근" : "출근 전 · \(Clock.hm(profile.workStart))까지 출근"
        case .morningPT:
            return "아침 PT · 회의실에서 오늘 업무 확정"
        case .working:
            return "근무 중 · \(Clock.hm(profile.workEnd)) 퇴근 점검"
        case .checkoutReview:
            return "퇴근 점검 · 결과물과 미완료 업무 확인"
        case .dinner:
            return "저녁시간 · \(Clock.hm(profile.overtimeStart)) 추가근무 시작"
        case .overtime:
            return "추가근무 · \(Clock.hm(profile.overtimeEnd))까지, 3단계부터"
        case .overtimeReview:
            return "추가근무 종료 · 결과물 올리기"
        case .off:
            return "퇴근 · 오늘 근무를 마쳤습니다"
        }
    }
}
