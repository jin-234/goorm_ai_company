import Foundation

/// 카메라가 본 자리 상태.
///
/// rawValue는 OfficeCore의 `PresenceState`와 같다. 앱에서는
/// `PresenceState(rawValue: monitor.presence.rawValue)`로 바꿔 `office.observe(_:)`에 넣는다.
public enum SeatPresence: String, Sendable, CaseIterable {
    /// 사람이 보인다.
    case present
    /// 사람이 보이지 않는다(잠깐 안 잡힌 것은 `SeatPresenceFilter.absentHold`초 동안 무시한다).
    case absent
    /// 카메라가 꺼져 있거나 영상을 받지 못한다. 자리 비움과 다른 상태다.
    /// 권한 거부, 카메라 없음, 연결 끊김, 영상이 안 들어옴을 모두 포함한다. 이유는 `SeatMonitor.offReason`.
    case cameraOff
    /// 아직 확인 전.
    case unknown

    /// 짧은 이름.
    public var title: String {
        switch self {
        case .present: "사람 있음"
        case .absent: "사람 없음"
        case .cameraOff: "카메라 꺼짐"
        case .unknown: "확인 중"
        }
    }
}

/// 한 장면을 본 결과.
public struct SeatDetection: Sendable, Equatable {
    /// 찾은 사람(상반신) 수.
    public var people: Int
    /// 찾은 얼굴 수.
    public var faces: Int
    /// 가장 확실했던 값(0~1).
    public var confidence: Float

    public init(people: Int, faces: Int, confidence: Float) {
        self.people = people
        self.faces = faces
        self.confidence = confidence
    }

    /// 사람이 보였는지. 고개를 숙여 얼굴이 안 보여도 상반신이 보이면 있다고 본다.
    public var isSomeoneThere: Bool { people > 0 || faces > 0 }
}

/// 장면마다의 판정을 자리 상태로 바꾼다. 시각을 받아서 계산하므로 시험할 수 있다.
///
/// - 사람이 `confirmHits`번 이어서 보이면 `present`.
/// - 마지막으로 보인 뒤 `absentHold`초가 지나야 `absent`. 한두 장면 놓쳐도 뒤집히지 않는다.
/// - 영상이 `frameTimeout`초 동안 안 들어오면 `cameraOff`.
public struct SeatPresenceFilter: Sendable {
    public var absentHold: TimeInterval
    public var frameTimeout: TimeInterval
    public var confirmHits: Int

    public private(set) var presence: SeatPresence = .unknown
    /// 영상이 안 들어와서 `cameraOff`가 됐는지.
    public private(set) var isStalled = false

    private var startedAt: Date?
    private var lastFrameAt: Date?
    private var lastSeenAt: Date?
    private var hits = 0

    public init(absentHold: TimeInterval = 3, frameTimeout: TimeInterval = 3, confirmHits: Int = 2) {
        self.absentHold = absentHold
        self.frameTimeout = frameTimeout
        self.confirmHits = max(1, confirmHits)
    }

    /// 카메라를 켠 시각. 상태를 처음으로 돌린다.
    public mutating func begin(at time: Date) {
        startedAt = time
        lastFrameAt = nil
        lastSeenAt = nil
        hits = 0
        isStalled = false
        presence = .unknown
    }

    /// 한 장면을 본 결과를 넣는다.
    public mutating func frame(seen: Bool, at time: Date) {
        guard startedAt != nil else { return }
        if isStalled {
            // 영상이 다시 들어오면 그때부터 새로 센다.
            isStalled = false
            startedAt = time
            lastSeenAt = nil
            hits = 0
            presence = .unknown
        }
        lastFrameAt = time
        if seen {
            hits += 1
            lastSeenAt = time
            if hits >= confirmHits { presence = .present }
        } else {
            hits = 0
            checkAbsent(at: time)
        }
    }

    /// 영상이 없어도 시간이 흐른 것을 반영한다. 0.5초마다 부른다.
    public mutating func tick(at time: Date) {
        guard let startedAt else { return }
        if time.timeIntervalSince(lastFrameAt ?? startedAt) >= frameTimeout {
            isStalled = true
            hits = 0
            presence = .cameraOff
            return
        }
        checkAbsent(at: time)
    }

    private mutating func checkAbsent(at time: Date) {
        guard presence != .absent, let startedAt, hits == 0 else { return }
        if time.timeIntervalSince(lastSeenAt ?? startedAt) >= absentHold {
            presence = .absent
        }
    }
}
