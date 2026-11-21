import Foundation

/// 직급. 위에서 아래 순서.
public enum Rank: Int, Sendable, CaseIterable, Comparable, Codable {
    case departmentHead = 0
    case teamLeader = 1
    case manager = 2
    case assistantManager = 3
    case staff = 4

    public static func < (lhs: Rank, rhs: Rank) -> Bool { lhs.rawValue < rhs.rawValue }

    /// 예: 부장
    public var title: String {
        switch self {
        case .departmentHead: "부장"
        case .teamLeader: "팀장"
        case .manager: "과장"
        case .assistantManager: "대리"
        case .staff: "사원"
        }
    }
}

/// 사무실에서 앉는 자리.
///
/// 팀원은 책상을 마주 붙인 '섬' 하나에 앉는다(한 줄에 세 자리, 두 줄).
/// 섬의 한쪽 끝(머리)에 팀장 책상이 팀원을 보고 놓이고, 부장 책상은 사무실 뒤쪽에서 방 전체를 본다.
public enum DeskSeat: Sendable, Equatable, Codable {
    /// 사무실 뒤쪽 가운데, 방 전체를 보는 자리.
    case departmentHead
    /// 섬 머리. 팀원 쪽을 본다.
    case islandHead
    /// 섬 안쪽 줄(카메라에서 먼 줄, 앞쪽=문 쪽을 보고 앉음). index 0이 팀장에 가장 가깝다.
    case inner(index: Int)
    /// 섬 바깥쪽 줄(카메라에 가까운 줄, 뒤쪽을 보고 앉음). index 0이 팀장에 가장 가깝다.
    case outer(index: Int)
}

/// 회사 사람 한 명. 나(김서울)를 뺀 모두가 AI다.
public struct Member: Sendable, Identifiable, Equatable {
    /// 장면·코드에서 쓰는 영문 이름. 예: "manager"
    public var id: String
    public var name: String
    public var rank: Rank
    /// 하는 일 한 줄. 조직도에 보인다.
    public var role: String
    /// 외형 느낌(성별·나이대·인상). 3D 캐릭터를 만들 때 참고한다.
    public var look: String
    /// 대표 옷 색(0xRRGGBB).
    public var outfit: UInt32
    /// 머리카락 색(0xRRGGBB).
    public var hair: UInt32
    public var seat: DeskSeat
    /// 야근하는 날이 얼마나 잦은지 0~1.
    public var overtimeTendency: Double
    /// 아침 PT를 들으러 회의실에 오는지.
    public var attendsMorningPT: Bool
    /// 누구에게 보고하는지(상사의 id). 맨 위는 nil.
    public var reportsTo: String?
    /// 사람(사용자)인지. 김서울만 true.
    public var isHuman: Bool

    /// 예: 한정민 팀장
    public var displayName: String { "\(name) \(rank.title)" }
}

/// 가상회사 1팀 조직도.
public enum Organization {
    public static let members: [Member] = [
        Member(id: "director", name: "오진혁", rank: .departmentHead,
               role: "1팀을 이끈다. 아침 PT를 듣고 한 주 방향을 정한다.",
               look: "50대 초반 남성, 희끗한 짧은 머리, 회색 정장과 남색 넥타이, 안경, 차분하고 넉넉한 인상",
               outfit: 0x5B6170, hair: 0x8C8A86, seat: .departmentHead,
               overtimeTendency: 0.2, attendsMorningPT: true, reportsTo: nil, isHuman: false),
        Member(id: "manager", name: Cast.managerName, rank: .teamLeader,
               role: "팀원의 업무를 배정하고 확인한다. 사내 메일로 공지·승인·주간 피드백을 보낸다.",
               look: "30대 후반 남성, 옆 가르마 짧은 머리, 버건디 카디건과 흰 셔츠, 서류철",
               outfit: 0x8A3B4B, hair: 0x32323A, seat: .islandHead,
               overtimeTendency: 0.35, attendsMorningPT: true, reportsTo: "director", isHuman: false),
        Member(id: "kwajang", name: "윤서희", rank: .manager,
               role: "팀의 일정과 시간 관리를 맡는다. 업무가 밀리면 순서를 다시 잡아 준다.",
               look: "30대 중반 여성, 어깨 길이 단발을 반묶음, 겨자색 카디건, 또렷한 인상",
               outfit: 0xC9963A, hair: 0x3B2A25, seat: .inner(index: 0),
               overtimeTendency: 0.5, attendsMorningPT: true, reportsTo: "manager", isHuman: false),
        Member(id: "daeri", name: "강민재", rank: .assistantManager,
               role: "공부 방법과 자료를 챙긴다. 막힌 과제를 작게 쪼개 준다.",
               look: "20대 후반 남성, 짧은 머리에 앞머리를 올림, 하늘색 셔츠와 남색 넥타이, 사원증",
               outfit: 0x8FB7DE, hair: 0x2A2624, seat: .inner(index: 1),
               overtimeTendency: 0.55, attendsMorningPT: true, reportsTo: "kwajang", isHuman: false),
        Member(id: "senior", name: "정다은", rank: .staff,
               role: "1년 먼저 입사한 선배 사원. 사내 규칙과 요령을 알려 준다.",
               look: "20대 후반 여성, 긴 머리를 낮게 묶음, 민트색 니트, 큰 머그컵",
               outfit: 0x6FB59A, hair: 0x4A3226, seat: .inner(index: 2),
               overtimeTendency: 0.3, attendsMorningPT: false, reportsTo: "daeri", isHuman: false),
        Member(id: "peerA", name: Cast.peerNames[0], rank: .staff,
               role: "입사 동기. 자격증을 준비한다.",
               look: "20대 중반 남성, 보라 후드를 씀",
               outfit: 0x7A5CC8, hair: 0x32323A, seat: .outer(index: 0),
               overtimeTendency: 0.42, attendsMorningPT: false, reportsTo: "daeri", isHuman: false),
        Member(id: "peerB", name: Cast.peerNames[1], rank: .staff,
               role: "입사 동기. 포트폴리오를 만든다.",
               look: "20대 중반 여성, 갈색 단발, 빨간 후드",
               outfit: 0xE2594B, hair: 0x6B4630, seat: .outer(index: 1),
               overtimeTendency: 0.42, attendsMorningPT: false, reportsTo: "daeri", isHuman: false),
        Member(id: "me", name: "김서울", rank: .staff,
               role: "나. 스스로 정한 취업 준비를 업무로 한다.",
               look: "20대 중반, 똥머리, 파란 셔츠, 사원증 노란 줄, 남색 가방",
               outfit: 0x3B78CC, hair: 0x3B2A25, seat: .outer(index: 2),
               overtimeTendency: 0, attendsMorningPT: false, reportsTo: "daeri", isHuman: true),
    ]

    public static func member(_ id: String) -> Member? {
        members.first { $0.id == id }
    }

    /// 아침 PT를 듣는 상사들. 위 직급부터.
    public static var morningPTAudience: [Member] {
        members.filter(\.attendsMorningPT).sorted { $0.rank < $1.rank }
    }

    /// 바로 아래 사람들.
    public static func reports(of id: String) -> [Member] {
        members.filter { $0.reportsTo == id }.sorted { $0.rank < $1.rank }
    }

    /// 맨 위 사람.
    public static var head: Member? { members.first { $0.reportsTo == nil } }
}
