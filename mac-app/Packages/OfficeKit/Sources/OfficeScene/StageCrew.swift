import AppKit
import OfficeCore
import SceneKit

/// 3D 사무실에서 내 캐릭터가 보이는 모습. 앱이 근태 상태(SeatStatus)를 이 값으로 바꿔 넘긴다.
public enum MyAvatar: Equatable, Sendable {
    /// 출근 전. 문 밖 매트 위에 서 있다.
    case outside
    /// 자리에 앉아 일한다.
    case seated
    /// 아침 PT. 회의실 화면 옆에 서서 발표한다.
    case presenting
    /// 사유를 등록한 자리 비움. 사유에 맞는 곳으로 걸어가 그 일을 한다.
    case away(reason: String)
    /// 승인된 점심. 문밖으로 나가고 책상에 '점심 중' 팻말.
    case lunch
    /// 추가근무 전 저녁시간. 문밖으로 나가고 책상에 '저녁시간' 팻말.
    case dinner
    /// 허용 시간 밖 자리 비움. 빈 의자만 보인다.
    case empty
    /// 카메라 꺼짐. 자리 비움과 구분해 책상에 '카메라 확인 중' 팻말.
    case cameraOff
    /// 퇴근.
    case off
}

/// 동기·팀장의 지금 상태.
enum CoworkerState: Equatable {
    /// 출근 전.
    case absent
    /// 자리에서 일함.
    case working
    /// 퇴근 준비(가방 챙기기).
    case packing
    /// 사무실 밖(퇴근, 저녁 식사).
    case out
}

/// 내 캐릭터가 있는 곳.
enum MeSpot: Equatable {
    /// 출근 전 문 밖.
    case outside
    /// 내 자리 의자.
    case seat
    /// 커피 자리.
    case coffee
    /// 창가(전화, 기지개).
    case window
    /// 출입문 안쪽(택배 받기).
    case door
    /// 회의실 화면 옆(아침 PT 발표).
    case meeting
    /// 문밖으로 나감(점심, 저녁). 보이지 않는다.
    case gone
    /// 탕비 구역 정수기 앞(물).
    case water
    /// 탕비 구역 냉장고 앞(음료).
    case fridge
    /// 탕비 구역 전자레인지 앞(데우기, 도시락).
    case microwave
    /// 간식 탁자 걸상(간식).
    case snack
    /// 뒷벽 화장실 문 안. 보이지 않는다.
    case restroom
    /// 그 자리에서 보이지 않음(자리 비움, 카메라 꺼짐, 퇴근).
    case hidden
}

/// 사람이 가는 곳. 모두 통로를 거쳐 이어진다.
enum Place: Hashable {
    case seat(String)
    case water, coffee, fridge, microwave, counter, stool(Int), restroom, window, window2, door, outside, meeting
    /// 상사 자리 옆(보고하러 가서 서는 곳).
    case report(String)
}

/// 자리 비움 사유를 읽어 갈 곳과 할 일을 정한다.
enum AwayPlan {
    static func plan(for reason: String) -> (spot: MeSpot, activity: Person.Activity) {
        let text = reason.replacingOccurrences(of: " ", with: "")
        func has(_ words: [String]) -> Bool { words.contains { text.contains($0) } }
        if has(["화장실", "손씻", "양치", "볼일"]) { return (.restroom, .stand) }
        if has(["택배", "배달", "우편", "등기", "문앞", "손님"]) { return (.door, .standBox) }
        if has(["전화", "통화", "연락", "콜"]) { return (.window, .phone) }
        if has(["스트레칭", "기지개", "운동", "체조", "몸풀", "허리", "산책", "바람"]) { return (.window, .stretch) }
        if has(["전자레인지", "데우", "데워", "도시락", "렌지"]) { return (.microwave, .stand) }
        if has(["간식", "과자", "빵", "배고", "출출", "초콜릿", "사탕", "탕비"]) { return (.snack, .sitEat) }
        if has(["냉장고", "음료", "우유", "주스", "탄산", "콜라"]) { return (.fridge, .drinkCup) }
        if has(["물", "정수기", "목말", "목이말"]) { return (.water, .drinkCup) }
        // 커피, 차와 그 밖의 사유는 커피 자리에서 한 잔.
        return (.coffee, .drinkCup)
    }
}

/// 영화처럼 따라가는 카메라.
enum FilmShot {
    /// 한 자리에서 본다.
    case fixed(OfficeStage.Pose)
    /// 사람을 따라간다.
    case follow(Person, yaw: CGFloat, pitch: CGFloat, distance: CGFloat, fov: CGFloat)
}

extension OfficeStage {

    // MARK: - 자리 잡기

    func seatCrew() {
        for person in coworkers {
            stations[person.memberID]?.addChildNode(person.root)
            sit(person)
        }
        parts.root.addChildNode(me.root)
        parts.root.addChildNode(courier.root)
        courier.setActivity(.hidden)
        placeMe(animated: false)
    }

    /// 자기 자리 의자에 앉힌다. 사람은 자리 노드 안에 있다.
    func sit(_ person: Person) {
        if let key = stationKey(person), let station = stations[key], person.root.parent !== station {
            person.root.removeFromParentNode()
            station.addChildNode(person.root)
        }
        person.root.opacity = 1
        person.root.position = SCNVector3(0, Person.seatedRootY, -0.05 + deskPull(stationKey(person) ?? ""))
        person.face(0)
        if let key = stationKey(person) { setChair(key, .normal) }
    }

    /// 책상이 섬 책상(0.6m)보다 멀리 놓인 자리(팀장·부장 0.72m)는 앉을 때 그만큼 책상 쪽으로 당긴다.
    /// 안 당기면 팔이 키보드에 닿지 않는다.
    func deskPull(_ key: String) -> CGFloat {
        guard let desk = stations[key]?.childNode(withName: "desk", recursively: false) else { return 0 }
        return min(0, desk.position.z + Layout.islandDeskOffset)
    }

    func stationKey(_ person: Person) -> String? {
        person.memberID.isEmpty ? nil : person.memberID
    }

    // MARK: - 길 찾기

    enum Aisle { case front, back }

    /// 앞 통로(책상 줄과 출입문 사이)와 뒤 통로(책상 줄과 회의실·팀장 자리 사이).
    private func aisleZ(_ aisle: Aisle) -> CGFloat { aisle == .front ? 2.85 : -0.85 }

    /// 책상 줄 오른쪽 끝의 세로길. 앞·뒤 통로를 잇는다.
    private var laneX: CGFloat { 5.0 }

    /// 그곳에 가려면 어느 통로의 어디에서 꺾어 들어가, 어떤 점들을 지나는지. 마지막 점이 그곳이다.
    func approach(_ place: Place) -> (aisle: Aisle, x: CGFloat, points: [SCNVector3]) {
        switch place {
        case .seat(let key):
            if key == "me" { return (.front, hub.x, [hub]) }
            let up = standUpPoint(key)
            switch Organization.member(key)?.seat {
            case .departmentHead: return (.back, 2.5, [SCNVector3(2.5, 0, up.z), up])
            // 팀장 자리는 오른쪽 세로길(x 5.0) 바로 옆이라, 앞·뒤 통로 어느 쪽이든 세로길로 바로 나간다
            // (전에는 앞 통로에 묶여 뒤쪽으로 갈 때 앞 통로까지 내려갔다가 다시 올라왔다).
            case .islandHead: return (.front, laneX, [SCNVector3(laneX, 0, up.z), up])
            case .inner: return (.back, up.x, [up])
            default: return (.front, up.x, [up])
            }
        // 탕비실 안의 곳은 모두 출입구 → 탕비실 가운데를 거친다(안에서 옮겨 다닐 때는 밖으로 나가지 않는다).
        case .water: return pantry(standPoints[.water] ?? SCNVector3(-6.3, 0, Layout.waterZ))
        case .coffee: return pantry(standPoints[.coffee] ?? SCNVector3(-6.05, 0, Layout.coffeeZ))
        case .fridge: return pantry(standPoints[.fridge] ?? SCNVector3(-5.95, 0, Layout.fridgeZ))
        case .microwave: return pantry(standPoints[.microwave] ?? SCNVector3(-6.2, 0, Layout.microwaveZ))
        case .counter: return pantry(standPoints[.counter] ?? SCNVector3(-6.2, 0, Layout.microwaveZ))
        case .stool(let index):
            let seat = stoolSeat(index)
            let side: CGFloat = index == 0 ? -0.45 : 0.45
            return pantry(SCNVector3(seat.x + side, 0, seat.z))
        case .restroom:
            // 화장실 칸 앞 → 문 → 칸 안(숨는 곳).
            let x = Layout.restroomX
            return (.back, x, [SCNVector3(x, 0, Layout.restroomZ1 + 0.7), SCNVector3(x, 0, Layout.restroomZ1 - 0.85)])
        case .window: return (.front, 5.6, [SCNVector3(6.1, 0, 0.3)])
        case .window2: return (.front, 5.6, [SCNVector3(6.1, 0, 1.55)])
        case .door: return (.front, Layout.insideDoor.x, [SCNVector3(Layout.insideDoor.x, 0, Layout.halfDepth - 1.3)])
        case .report(let boss):
            let spot = reportSpot(boss)
            switch Organization.member(boss)?.seat {
            case .islandHead: return (.front, laneX, [SCNVector3(laneX, 0, spot.z), spot])
            case .departmentHead: return (.back, 2.5, [SCNVector3(2.5, 0, spot.z), spot])
            case .outer: return (.front, spot.x, [spot])
            default: return (.back, spot.x, [spot])
            }
        case .outside:
            return (.front, Layout.insideDoor.x, [Layout.insideDoor, SCNVector3(Layout.outsideDoor.x, 0, Layout.outsideDoor.z - 0.1), hallEnd])
        case .meeting:
            // 발표 자리로 가는 길은 앞줄 의자 등(z 약 -2.0)에서 띄워 유리벽 쪽(z -1.55)으로 간다.
            // -1.8이면 앉아 있는 사람 등 바로 뒤를 스쳐 비비며 지나가 보인다.
            // 문을 지나 곧장 유리벽 쪽 길로 꺾는다(문 안쪽 점 -1.9까지 들어갔다 돌아 나오면 앞줄에서 나오는 사람과 만난다).
            return (.back, meetingDoorOut.x, [SCNVector3(meetingDoorOut.x, 0, -1.55), SCNVector3(-6.3, 0, -1.55), SCNVector3(-6.3, 0, -3.2)])
        }
    }

    /// 탕비실 안 한 곳까지: 앞 통로에서 출입구를 지나 탕비실 가운데를 거쳐 그곳으로.
    private func pantry(_ stand: SCNVector3) -> (aisle: Aisle, x: CGFloat, points: [SCNVector3]) {
        (.front, Layout.pantryX1 + 0.5, [SCNVector3(Layout.pantryX1 - 0.5, 0, Layout.pantryDoorZ), Layout.pantryHub, stand])
    }

    /// 보고하러 가서 서는 곳: 상사 의자 옆.
    func reportSpot(_ boss: String) -> SCNVector3 {
        // 팀장·부장은 책상 옆이 넓어 의자 옆에 선다. 섬 자리는 옆자리와 1.4m라 의자 옆에 서면 두 사람 의자 사이에 끼므로
        // 의자 등받이 옆 조금 뒤에 선다(더 뒤로 가면 통로로 지나가는 사람과 스친다).
        let local: SCNVector3
        switch Organization.member(boss)?.seat {
        case .departmentHead: local = SCNVector3(-0.75, 0, 0.1)
        case .islandHead: local = SCNVector3(0.72, 0, 0.1)
        default: local = SCNVector3(0.5, 0, 0.32)
        }
        guard let station = stations[boss] else { return hub }
        let point = station.convertPosition(local, to: parts.root)
        return SCNVector3(point.x, 0, point.z)
    }

    /// 복도 끝. 문밖으로 나간 사람은 여기서 흐려지며 사라진다.
    var hallEnd: SCNVector3 { SCNVector3(2.15, 0, Layout.outsideDoor.z + 0.35) }

    /// 출입문 바로 밖에서 돌아서는 곳.
    var justOutside: SCNVector3 { SCNVector3(Layout.outsideDoor.x, 0, Layout.outsideDoor.z - 0.1) }

    /// 간식 탁자 걸상의 사무실 좌표(앉는 면 높이 포함).
    func stoolSeat(_ index: Int) -> SCNVector3 {
        let table = Layout.snackTable
        return SCNVector3(table.x + (index == 0 ? -0.47 : 0.47), 0.46, table.z)
    }

    /// 두 곳 사이를 통로로 잇는 길. 첫 점은 출발지 다음 점, 마지막 점은 도착지.
    func route(from: Place, to: Place) -> [SCNVector3] {
        let a = approach(from), b = approach(to)
        // 같은 방 안(같은 입구 점들을 공유)이면 통로로 나가지 않고 공유하는 마지막 점에서 갈라진다.
        var shared = 0
        while shared < min(a.points.count, b.points.count) - 1,
              abs(a.points[shared].x - b.points[shared].x) < 0.01, abs(a.points[shared].z - b.points[shared].z) < 0.01 {
            shared += 1
        }
        if shared > 0 {
            return Array(a.points[(shared - 1)...].reversed().dropFirst()) + Array(b.points[shared...])
        }
        var path = Array(a.points.reversed().dropFirst())
        let za = aisleZ(a.aisle), zb = aisleZ(b.aisle)
        if a.aisle != b.aisle {
            // 책상 사이 세로 길 중 덜 돌아가는 곳으로 건넌다.
            let connectors: [CGFloat] = [-2.6, laneX]
            var best = connectors.min { abs(a.x - $0) + abs(b.x - $0) < abs(a.x - $1) + abs(b.x - $1) } ?? -1.3
            // 출발지나 도착지가 세로길 바로 옆이면 그 세로길로 건넌다(가로 거리가 같아도 통로까지 내려갔다 올 일이 없다).
            if let lane = connectors.first(where: { abs(a.x - $0) < 0.05 || abs(b.x - $0) < 0.05 }) { best = lane }
            // 세로길 위에서 출발하거나 도착하면 통로 끝까지 갔다가 되돌아오지 않고 세로길로 바로 간다.
            let aOnLane = abs(a.x - best) < 0.05, bOnLane = abs(b.x - best) < 0.05
            if !aOnLane {
                path.append(SCNVector3(a.x, 0, za))
                path.append(SCNVector3(best, 0, za))
            }
            if !bOnLane {
                path.append(SCNVector3(best, 0, zb))
                path.append(SCNVector3(b.x, 0, zb))
            }
        } else {
            path.append(SCNVector3(a.x, 0, za))
            path.append(SCNVector3(b.x, 0, zb))
        }
        path += b.points
        // 겹치는 점은 뺀다.
        var cleaned: [SCNVector3] = []
        for point in path {
            if let last = cleaned.last, abs(last.x - point.x) < 0.02, abs(last.z - point.z) < 0.02 { continue }
            cleaned.append(point)
        }
        return cleaned
    }

    /// 그곳에 도착해서 바라보는 방향(도).
    func facing(_ place: Place) -> CGFloat {
        switch place {
        case .water, .coffee, .fridge, .microwave, .counter: 90
        case .stool(let index): index == 0 ? -90 : 90
        case .window, .window2: -90
        case .door: 180
        case .meeting: -70
        case .restroom: 0
        default: 0
        }
    }

    private func place(of spot: MeSpot) -> Place? {
        switch spot {
        case .outside, .gone: .outside
        case .seat: .seat("me")
        case .coffee: .coffee
        case .window: .window
        case .door: .door
        case .meeting: .meeting
        case .water: .water
        case .fridge: .fridge
        case .microwave: .microwave
        case .snack: .stool(0)
        case .restroom: .restroom
        case .hidden: nil
        }
    }

    // MARK: - 동기·팀장의 하루

    /// 날짜에 맞춰 동기·팀장의 퇴근·야근 일정을 정한다. 날마다 다르게, 같은 날은 늘 같게.
    public func setDay(seed: Int) {
        guard seed != daySeed else { return }
        daySeed = seed
        coworkerStates = [:]
        errandRandom = SeededRandom(UInt64(truncatingIfNeeded: seed &* 7 &+ 3))
        nextErrand = [:]
        occupied = [:]
        deskParcel?.isHidden = true
        parcelAtDesk = false
        courier.stopSteps()
        courier.setActivity(.hidden)
        for person in coworkers where person.isBusy {
            person.stopSteps()
            sit(person)
        }
        updateCoworkers()
    }

    struct CoworkerPlan {
        /// 오늘 야근하는지.
        var overtime: Bool
        /// 사무실을 나가는 시각(자정 기준 분).
        var leave: Double
        /// 야근하는 날 저녁 먹으러 나가는 시각(18:00 뒤 몇 분).
        var dinnerOut: Double
        /// 점심 먹으러 나가는 시각과 돌아오는 시각(자정 기준 분). 자리에서 먹는 날은 nil.
        var lunch: (out: Double, back: Double)?
    }

    func plan(for person: Person) -> CoworkerPlan {
        let index = coworkers.firstIndex { $0 === person } ?? 0
        var random = SeededRandom(UInt64(truncatingIfNeeded: daySeed &* 131 &+ index &* 17 &+ 5))
        _ = random.next()
        let overtime = random.next() < (Organization.member(person.memberID)?.overtimeTendency ?? 0.4)
        // 가상 시계는 실제 시간처럼 흐르므로 정시 퇴근은 짧은 사이(18:01~18:12)에 몰아 둔다.
        let leave = overtime ? 20 * 60 + 30 + random.range(0, 85) : 18 * 60 + 1 + random.range(0, 11)
        let dinnerOut = random.range(1, 9)
        // 점심은 대개 12시 조금 넘어 나가 1시 조금 전에 돌아온다. 가끔 자리에서 먹는다.
        let lunch: (Double, Double)? = random.next() < 0.85
            ? (12 * 60 + random.range(0.5, 5), 12 * 60 + 52 + random.range(0, 6)) : nil
        return CoworkerPlan(overtime: overtime, leave: leave, dinnerOut: dinnerOut, lunch: lunch)
    }

    func state(for person: Person, at minute: Double) -> CoworkerState {
        let plan = plan(for: person)
        if minute < 8 * 60 { return .absent }
        if let lunch = plan.lunch, minute >= lunch.out, minute < lunch.back { return .out }
        if plan.overtime {
            if minute < 18 * 60 + plan.dinnerOut { return .working }
            // 저녁 먹으러 나갔다가 19시에 돌아온다.
            if minute < 19 * 60 + 1 { return .out }
        }
        return minute < plan.leave ? .working : .out
    }

    /// 아침 PT를 듣는 상사들.
    /// 지금 회의에 들어오는 사람들. 평소엔 아침 PT 청중(부장·팀장·과장·대리), 금요일 주간 회의엔 부장·팀장.
    var audience: [Person] {
        (meetingAttendees ?? Organization.morningPTAudience.map(\.id)).map { coworker($0) }
    }

    /// 회의를 들을 사람이 모두 자리에서 일하는 중인지(회의를 열 수 있는지).
    var everyoneWorking: Bool {
        audience.allSatisfy { state(for: $0, at: shownMinute) == .working && !$0.isBusy }
    }

    func workActivity(_ person: Person) -> Person.Activity {
        ["senior", "peerA", "peerB"].contains(person.memberID) ? .sitTypingWithMug : .sitTyping
    }

    /// 동기와 팀장이 일정대로 일하고, 짐을 챙기고, 문으로 나가고, 저녁 뒤 돌아온다.
    /// 모니터와 스탠드는 그 사람이 자리에 있을 때만 켠다.
    func updateCoworkers() {
        let minute = shownMinute
        let look = DayCycle.look(at: minute)
        if meetingOn, !audience.allSatisfy({ state(for: $0, at: minute) == .working }) { endMeetingImmediately() }
        let inMeeting = Set(audience.map { ObjectIdentifier($0) })
        for (index, person) in coworkers.enumerated() {
            let want = state(for: person, at: minute)
            let id = ObjectIdentifier(person)
            // 화면은 자리에 앉아 있거나 잠깐 자리를 비운 동안 켜 둔다.
            let atDesk = (coworkerStates[id] ?? want) == .working || coworkerStates[id] == .packing
            let desk = desks[person.memberID]
            setScreen(desk, on: atDesk, image: Textures.screenDocument(seed: UInt64(5 + index * 4)))
            desk?.lampBulb?.geometry?.firstMaterial?.emission.intensity = atDesk ? look.deskLamp * 1.5 : 0
            if (meetingOn && inMeeting.contains(id)) || (scripted && person === manager) { continue }
            let had = coworkerStates[id]
            guard want != had else { continue }
            if instantCoworkers || catchingUp {
                if courier.activity != .hidden { dismissCourier() }
                coworkerStates[id] = want
                person.stopSteps()
                person.holdsBag = false
                if want == .working {
                    sit(person)
                    person.setActivity(workActivity(person))
                } else {
                    person.setActivity(.hidden)
                    setChair(person.memberID, .tucked, animated: false)
                }
                continue
            }
            // 잠깐 자리를 비운 중이면 서둘러 돌아오게 하고, 앉은 뒤에 바꾼다.
            if person.isBusy {
                person.hurry()
                continue
            }
            coworkerStates[id] = want
            move(person, from: had, to: want)
        }
        if meetingWanted, !meetingOn, !scripted, everyoneWorking { gatherMeeting(animated: true) }
    }

    private func move(_ person: Person, from had: CoworkerState?, to want: CoworkerState) {
        let key = stationKey(person) ?? "manager"
        switch want {
        case .absent:
            person.stopSteps()
            person.setActivity(.hidden)
            setChair(key, .tucked, animated: false)
        case .working:
            if had == .out {
                // 복도 끝에서 나타나 문으로 들어와 자리에 앉는다.
                toWorld(person)
                person.holdsBag = false
                person.root.position = hallEnd
                person.root.opacity = 0
                person.setActivity(.hidden)
                // 같이 저녁을 먹고 와도 한 몸처럼 겹치지 않게 2.5초씩 띄워 들어온다.
                let wait = max(0, doorFreeAt - clock)
                doorFreeAt = clock + wait + 2.5
                person.play([
                    .act(.hidden, wait),
                    .run { person.root.opacity = 0; person.setActivity(.stand) },
                    .fade(1, 0.5),
                    .walk(route(from: .outside, to: .seat(key)), speed: 1.15),
                    .run { [weak self] in
                        guard let self else { return }
                        self.sit(person)
                        person.setActivity(self.workActivity(person))
                        self.updateCoworkers()
                    },
                ])
            } else {
                sit(person)
                person.setActivity(workActivity(person))
            }
        case .packing:
            person.setActivity(person.hasHeldBag ? .standBag : .packUp)
        case .out:
            guard had == .working || had == .packing else {
                person.stopSteps()
                person.setActivity(.hidden)
                return
            }
            // 여럿이 한꺼번에 나가면 문에서 겹친다. 문을 쓰는 차례를 4초씩 띄운다.
            let wait = max(0, doorFreeAt - clock)
            doorFreeAt = clock + wait + 4.0
            // 퇴근이 아니면(점심·저녁 외출) 가방·영상·인사 없이 잠깐 나간다.
            let goingHome = shownMinute >= plan(for: person).leave
            guard wait > 0.05 else { leave(person, key: key, home: goingHome); return }
            tween(wait) { [weak self] t in
                guard t >= 1, let self, self.coworkerStates[ObjectIdentifier(person)] == .out, !person.isBusy else { return }
                self.leave(person, key: key, home: goingHome)
            }
        }
    }

    /// 일어나 2초쯤 짐을 챙기고, 가방을 들고 문으로 걸어 나간다. 문밖에서 돌아서 인사하고 복도로 사라진다.
    private func leave(_ person: Person, key: String, home: Bool) {
        guard home else {
            toWorld(person)
            person.root.position = standUpPoint(key)
            person.play([
                .act(.stand, 0.6),
                .walk(route(from: .seat(key), to: .outside), speed: 1.15),
                .fade(0, 0.5),
                .run { person.setActivity(.hidden) },
            ])
            return
        }
        toWorld(person)
        person.root.position = packPoint(key)
        person.face(stations[key].map { $0.eulerAngles.y * 180 / .pi } ?? 0)
        let filming = canFilm
        let turn = stations[key].map { $0.eulerAngles.y * 180 / .pi } ?? 0
        // 책상 너머(모니터 쪽)에서 짐 챙기는 얼굴을 본다.
        if filming { startFilm(packShot(person, turn: turn)) }
        let pack: Person.Activity = person.hasHeldBag ? .standBag : .packUp
        let toDoor = route(from: .seat(key), to: .outside).dropLast(3)
        person.play([
            .act(pack, 2.2),
            .run { [weak self] in
                guard let self else { return }
                person.holdsBag = person.hasHeldBag
                // 가방을 들고 돌아서며 의자를 책상 밑으로 밀어 넣는다.
                self.setChair(key, .tucked)
                if filming { self.startFilm(walkShot(person)) }
            },
            .walk(Array(toDoor), speed: 1.15),
            .run { [weak self] in
                guard let self, filming else { return }
                self.startFilm(.fixed(self.doorShot))
            },
            .walk([Layout.insideDoor, justOutside], speed: 1.05),
            .face(0),
            .act(.bow, 0.9),
            .walk([hallEnd], speed: 1.15),
            .fade(0, 0.5),
            .run { [weak self] in
                person.setActivity(.hidden)
                person.holdsBag = false
                if filming { self?.endFilm() }
            },
        ])
    }

    func animateCrew(at time: Double) {
        me.animate(time: time)
        for person in coworkers { person.animate(time: time) }
        courier.animate(time: time)
    }

    /// 그림 뽑기처럼 화면 없이 그릴 때, 사람들의 자세를 그 시각으로 맞춘다.
    public func pose(at time: Double) {
        clock = time
        animateCrew(at: time)
        animateCrew(at: time + 0.016)
    }

    // MARK: - 동료의 잠깐 외출

    /// 일하던 동료가 가끔 일어나 물을 마시고, 화장실에 가고, 간식을 먹고, 기지개를 켠다.
    func updateErrands() {
        guard !scripted, !meetingOn, !meetingWanted, !catchingUp else { return }
        let minute = shownMinute
        for person in coworkers {
            let id = ObjectIdentifier(person)
            guard let due = nextErrand[id] else {
                nextErrand[id] = clock + errandRandom.range(15, 120)
                continue
            }
            guard clock >= due else { continue }
            // 일곱 명이라 한 사람은 2~4분에 한 번쯤만 일어난다.
            nextErrand[id] = clock + errandRandom.range(110, 240)
            let plan = plan(for: person)
            guard coworkerStates[id] == .working, state(for: person, at: minute) == .working, !person.isBusy,
                  !reservedBosses.contains(person.memberID),
                  person.activity == workActivity(person) || person.activity == .sitTyping,
                  minute >= 9 * 60 + 3, minute < plan.leave - 3,
                  !(plan.lunch.map { minute > $0.out - 3 && minute < $0.back + 2 } ?? false),
                  !(plan.overtime && minute > 18 * 60 + plan.dinnerOut - 3 && minute < 19 * 60 + 3)
            else { continue }
            startErrand(person)
        }
    }

    private func startErrand(_ person: Person) {
        guard let key = stationKey(person) else { return }
        let id = ObjectIdentifier(person)
        // 셋에 하나꼴로 서류를 들고 직속 상사에게 보고하러 간다.
        if errandRandom.next() < 0.35, let bossID = Organization.member(key)?.reportsTo, startReport(person, to: bossID) { return }
        let roll = errandRandom.next()
        var target: Place
        var steps: [Person.Step] = []
        var afterTarget: [Person.Step] = []
        var finalPlace: Place
        if roll < 0.3 {
            target = .water
            afterTarget = [.act(.fillCup, 2.4)] + stepBack(from: .water) + [.act(.drinkCup, errandRandom.range(6, 10))]
            finalPlace = .water
        } else if roll < 0.52 {
            target = .restroom
            afterTarget = [.run { person.setActivity(.hidden) }, .act(.hidden, errandRandom.range(14, 26)), .act(.stand, 0.6)]
            finalPlace = .restroom
        } else if roll < 0.72 {
            // 탕비 조리대에서 과자를 집어 걸상에 앉아 먹는다.
            let stool: Place = occupied[.stool(1)] == nil ? .stool(1) : .stool(0)
            guard occupied[.counter] == nil, occupied[stool] == nil else { return }
            target = .counter
            let seat = stoolSeat(stool == .stool(1) ? 1 : 0)
            afterTarget = [
                .act(.reach, 1.3),
                .run { person.holdsSnackWhileReaching = true },
                .act(.reach, 0.4),
                .run { [weak self] in self?.occupied[.counter] = nil; self?.occupied[stool] = id },
                .walk(route(from: .counter, to: stool), speed: 1.1),
                .run { person.root.position = SCNVector3(seat.x, seat.y - Person.hipHeight + 0.015, seat.z) },
                .face(facing(stool)),
                .act(.sitEat, errandRandom.range(14, 22)),
                .run { person.holdsSnackWhileReaching = false },
                .place(approach(stool).points.last ?? SCNVector3Zero),
            ]
            finalPlace = stool
        } else if roll < 0.86 {
            target = .coffee
            afterTarget = [.act(.fillCup, 2.4)] + stepBack(from: .coffee) + [.act(.drinkCup, errandRandom.range(6, 10))]
            finalPlace = .coffee
        } else {
            target = .window2
            afterTarget = [.act(.stretch, errandRandom.range(4, 7))]
            finalPlace = .window2
        }
        guard occupied[target] == nil, meTarget != target else { return }
        occupied[target] = id
        toWorld(person)
        person.root.position = standUpPoint(key)
        steps = [.walk(route(from: .seat(key), to: target), speed: 1.05), .face(facing(target))] + afterTarget
        steps += [
            .walk(route(from: finalPlace, to: .seat(key)), speed: 1.05),
            .run { [weak self] in
                guard let self else { return }
                self.occupied = self.occupied.filter { $0.value != id }
                self.sit(person)
                person.setActivity(self.workActivity(person))
                self.updateCoworkers()
            },
        ]
        person.play(steps)
    }

    // MARK: - 보고와 피드백

    /// 상사가 자리에 앉아 일하는 중인지(보고를 받을 수 있는지).
    private func available(_ boss: Person) -> Bool {
        coworkerStates[ObjectIdentifier(boss)] == .working && !boss.isBusy && boss.root.parent === stations[boss.memberID]
            && !reservedBosses.contains(boss.memberID)
    }

    /// 서류를 챙겨 상사 자리 옆으로 가서 건네고, 상사가 읽고 손짓하며 피드백하는 동안 끄덕이고, 인사하고 돌아온다.
    @discardableResult
    func startReport(_ person: Person, to bossID: String) -> Bool {
        guard let key = stationKey(person), Organization.member(bossID) != nil else { return false }
        let boss = coworker(bossID)
        guard available(boss), occupied[.report(bossID)] == nil else { return false }
        let id = ObjectIdentifier(person)
        reservedBosses.insert(bossID)
        occupied[.report(bossID)] = id
        toWorld(person)
        person.root.position = standUpPoint(key)
        let spot = reportSpot(bossID)
        let bossPoint = stations[bossID].map { $0.convertPosition(SCNVector3Zero, to: parts.root) } ?? spot
        let faceBoss = atan2(-(bossPoint.x - spot.x), -(bossPoint.z - spot.z)) * 180 / .pi
        let finish: @MainActor () -> Void = { [weak self] in
            guard let self else { return }
            self.reservedBosses.remove(bossID)
            self.occupied = self.occupied.filter { $0.value != id }
            person.holdsPaper = false
            self.sit(person)
            person.setActivity(self.workActivity(person))
            self.updateCoworkers()
        }
        person.play([
            .act(.reach, 0.7),
            .run { person.holdsPaper = true },
            .act(.holdPaper, 0.3),
            .walk(route(from: .seat(key), to: .report(bossID)), speed: 1.05),
            .face(faceBoss),
            .run { [weak self] in
                guard let self else { return }
                // 그새 상사가 자리를 떴으면 그냥 돌아간다.
                guard boss.root.parent === self.stations[bossID], self.coworkerStates[ObjectIdentifier(boss)] == .working else {
                    person.play([.act(.holdPaper, 0.6), .walk(self.route(from: .report(bossID), to: .seat(key)), speed: 1.05), .run(finish)])
                    return
                }
                // 상사는 의자째 보고하는 사람 쪽으로 돈다.
                let local = self.stations[bossID]?.convertPosition(spot, from: self.parts.root) ?? SCNVector3(1, 0, 0)
                let turn = atan2(-local.x, -local.z) * 180 / .pi * 0.75
                boss.play([
                    .face(turn),
                    .act(.sitTyping, 1.0),
                    .run { person.holdsPaper = false; boss.holdsPaper = true },
                    .act(.sitReview, 3.6),
                    .act(.sitExplain, 3.4),
                    .run { boss.holdsPaper = false; person.holdsPaper = true },
                    .act(.sitExplain, 0.8),
                    .face(0),
                    .run { [weak self] in
                        guard let self else { return }
                        boss.setActivity(self.workActivity(boss))
                    },
                ])
            },
            .act(.offerPaper, 1.0),
            .act(.holdPaper, 3.6),
            .act(.nod, 3.4),
            .act(.bow, 0.8),
            .walk(route(from: .report(bossID), to: .seat(key)), speed: 1.05),
            .run(finish),
        ])
        return true
    }

    // MARK: - 아침 PT 회의

    /// 팀장과 동기가 회의실에 앉는 자리. (사람, 의자 위치, 바라보는 방향)
    private var meetingSeats: [(Person, SCNVector3, CGFloat)] {
        let x = Layout.meetingCenterX, z = Layout.meetingCenterZ
        let chairs: [(SCNVector3, CGFloat)] = [
            // 의자 방향(안쪽 줄 180, 바깥 줄 0)에서 발표자 쪽으로 조금만 튼다. 많이 틀면 몸이 등받이에 묻힌다.
            (SCNVector3(x + 0.62, 0, z - 0.92), 168), (SCNVector3(x - 0.62, 0, z - 0.92), 172),
            (SCNVector3(x + 0.62, 0, z + 0.92), 12), (SCNVector3(x - 0.62, 0, z + 0.92), 15),
        ]
        // 먼저 도착하는 사람(자리가 회의실 문에 가까운 사람)이 안쪽·먼 의자부터 채운다.
        // 문 가까운 의자에 먼저 앉으면 뒤에 온 사람이 그 사람이 의자를 빼고 앉는 동안 등 뒤에서 기다린다.
        let door = meetingDoorOut
        let arrivals = audience.sorted { a, b in
            let pa = standUpPoint(stationKey(a) ?? ""), pb = standUpPoint(stationKey(b) ?? "")
            return hypot(pa.x - door.x, pa.z - door.z) < hypot(pb.x - door.x, pb.z - door.z)
        }
        let inside = meetingDoorIn
        let farFirst = chairs.sorted { a, b in
            // 안쪽 줄 먼저, 같은 줄에서는 문에서 먼 의자 먼저.
            if (a.0.z < z) != (b.0.z < z) { return a.0.z < z }
            return hypot(a.0.x - inside.x, a.0.z - inside.z) > hypot(b.0.x - inside.x, b.0.z - inside.z)
        }
        return zip(arrivals, farFirst).map { ($0, $1.0, $1.1) }
    }

    /// 회의에 들어오는 상사들이 모두 앉았는지(아무도 회의실로 걷고 있지 않은지).
    var audienceSeated: Bool {
        audience.allSatisfy { $0.activity == .sitListen || $0.activity == .hidden || !$0.isBusy }
    }

    /// 회의에 있던 사람들이 모두 회의실과 회의실 문 앞을 빠져나갔는지.
    var audienceLeftMeetingRoom: Bool {
        audience.allSatisfy { person in
            let p = person.root.convertPosition(SCNVector3Zero, to: parts.root)
            let inside = p.x < Layout.meetingX1 + 0.1 && p.z < Layout.meetingZ1 + 0.1
            let atDoor = hypot(p.x - meetingDoorOut.x, p.z - meetingDoorOut.z) < 1.4
            return !(inside || atDoor) || person.root.isHidden
        }
    }

    /// 회의실 문 밖·안.
    var meetingDoorOut: SCNVector3 { SCNVector3(-2.95, 0, -0.85) }
    var meetingDoorIn: SCNVector3 { SCNVector3(-2.95, 0, -1.9) }

    /// 회의실 문 안에서 의자 뒤까지.
    private func routeToChair(_ person: Person, chair: SCNVector3) -> [SCNVector3] {
        if chair.z < Layout.meetingCenterZ {
            // 안쪽 줄: 탁자 끝을 돌아 의자 뒤로.
            // 탁자 끝(x -3.55)에서 0.5m 띄워 돈다. -3.35면 모서리를 스치며 돈다.
            return [SCNVector3(-3.05, 0, chair.z - 0.6), SCNVector3(chair.x, 0, chair.z - 0.6)]
        }
        return [SCNVector3(chair.x, 0, chair.z + 0.6)]
    }

    /// 의자 뒤쪽 방향(안쪽 줄 -Z, 바깥 줄 +Z).
    private func chairBack(_ chair: SCNVector3) -> CGFloat { chair.z < Layout.meetingCenterZ ? -1 : 1 }

    /// 그 자리의 회의실 의자 노드.
    private func meetingChair(at chair: SCNVector3) -> SCNNode? {
        meetingChairs.min { hypot($0.position.x - chair.x, $0.position.z - chair.z) < hypot($1.position.x - chair.x, $1.position.z - chair.z) }
    }

    /// 의자(와 앉은 사람)를 의자 뒤쪽으로 offset만큼 옮긴다(0.35초).
    private func slideChair(_ chair: SCNVector3, to offset: CGFloat, with person: Person? = nil) {
        guard let node = meetingChair(at: chair) else { return }
        let back = chairBack(chair)
        let from = node.position.z, to = chair.z + back * offset
        let personFrom = person?.root.position.z ?? 0
        tween(0.35) { t in
            let z = from + (to - from) * CGFloat(t)
            node.position.z = z
            if let person { person.root.position.z = personFrom + (z - from) }
        }
    }

    /// 자기 자리에서 회의실 문 안쪽까지.
    private func routeToMeetingRoom(_ person: Person) -> [SCNVector3] {
        guard let key = stationKey(person) else { return [] }
        // 회의실 문 밖 점까지는 길찾기, 그다음 문 안쪽 점으로.
        let path = route(from: .seat(key), to: .meeting)
        let outside = path.prefix { !(abs($0.x - meetingDoorOut.x) < 0.01 && abs($0.z - meetingDoorOut.z) < 0.01) }
        return Array(outside) + [meetingDoorOut, meetingDoorIn]
    }

    /// 아침 PT 동안 회의실에 모인다. 앱이 단계에 맞춰 부른다.
    /// 금요일 주간 회의: 부장·팀장이 회의실에 앉고, 나는 화면 옆에서 이번 주를 보고한다(내 캐릭터는 setMyAvatar(.presenting)).
    public func setWeeklyMeeting(_ on: Bool, animated: Bool) {
        if on {
            guard !meetingWanted else { return }
            meetingAttendees = ["director", "manager"]
            setMeeting(true, animated: animated)
        } else {
            setMeeting(false, animated: animated)
            // 흩어지는 동작은 위에서 이미 정해졌으니 이제 평소 청중으로 되돌린다.
            meetingAttendees = nil
        }
    }

    public func setMeeting(_ on: Bool, animated: Bool) {
        guard on != meetingWanted else { return }
        meetingWanted = on
        guard !scripted else { return }
        if on {
            for person in audience where person.isBusy { person.hurry() }
            if everyoneWorking { gatherMeeting(animated: animated) }
        } else if meetingOn {
            disperseMeeting(animated: animated)
        }
    }

    func gatherMeeting(animated: Bool) {
        meetingOn = true
        // 회의실 문에 가까운 사람부터 1.5초씩 띄워 일어난다(문 앞에서 몰리지 않게). 차례가 올 때까지는 자리에서 일한다.
        let door = meetingDoorOut
        let order = meetingSeats.sorted { a, b in
            let pa = standUpPoint(stationKey(a.0) ?? ""), pb = standUpPoint(stationKey(b.0) ?? "")
            return hypot(pa.x - door.x, pa.z - door.z) < hypot(pb.x - door.x, pb.z - door.z)
        }
        for (rank, (person, chair, facing)) in order.enumerated() {
            let back = chairBack(chair)
            // 의자를 뒤로 빼고, 앉고, 의자째 당겨 들어간다.
            let sitDown: @MainActor () -> Void = { [weak self] in
                person.root.position = SCNVector3(chair.x, Person.seatedRootY, chair.z + back * 0.28)
                person.face(facing)
                person.setActivity(.sitListen)
                self?.slideChair(chair, to: 0, with: person)
            }
            person.stopSteps()
            guard animated else { toWorld(person); sitDown(); continue }
            let key = stationKey(person) ?? "manager"
            person.play([
                .act(person.activity == .hidden ? .hidden : workActivity(person), Double(rank) * 1.5),
                .run { [weak self] in
                    guard let self else { return }
                    self.toWorld(person)
                    person.root.position = self.standUpPoint(key)
                },
                .walk(routeToMeetingRoom(person) + routeToChair(person, chair: chair), speed: 1.15),
                .face(facing),
                .run { [weak self] in self?.slideChair(chair, to: 0.28) },
                .act(.reach, 0.4),
                .run(sitDown),
            ])
        }
    }

    private func disperseMeeting(animated: Bool) {
        meetingOn = false
        // 문에 가까운 사람부터 1.4초씩 띄워 일어난다. 한꺼번에 일어나면 문 앞에서 겹친다.
        let door = meetingDoorIn
        let order = meetingSeats.sorted { hypot($0.1.x - door.x, $0.1.z - door.z) < hypot($1.1.x - door.x, $1.1.z - door.z) }
        for (rank, (person, chair, _)) in order.enumerated() {
            guard animated, person.activity != .hidden else {
                person.stopSteps()
                sit(person)
                person.setActivity(workActivity(person))
                continue
            }
            let key = stationKey(person) ?? "manager"
            // 아직 자리에서 일어나지 않았으면 그대로 일한다.
            if person.root.parent !== parts.root {
                person.stopSteps()
                sit(person)
                person.setActivity(workActivity(person))
                continue
            }
            // 회의실로 가던 중이면 그 자리에서 바로 돌아선다. 전에는 문 앞에 멈춰 서서 나가는 사람을 막다가
            // 의자 뒤로 옮겨진 뒤 다시 걸어 나왔다.
            if person.activity != .sitListen {
                let forward = [standUpPoint(key)] + routeToMeetingRoom(person) + routeToChair(person, chair: chair)
                let here = person.root.position
                var nearest = 0, best = CGFloat.greatestFiniteMagnitude
                for index in 0..<(forward.count - 1) {
                    let d = distanceToSegment(here, forward[index], forward[index + 1])
                    if d < best { best = d; nearest = index }
                }
                person.stopSteps()
                person.play([
                    .walk(Array(forward[0...nearest].reversed()), speed: 1.15),
                    .run { [weak self] in
                        guard let self else { return }
                        self.sit(person)
                        person.setActivity(self.workActivity(person))
                    },
                ])
                continue
            }
            let back = (routeToMeetingRoom(person) + routeToChair(person, chair: chair)).reversed()
            let side = chairBack(chair)
            person.play([
                .act(.sitListen, Double(rank) * 1.4),
                // 의자째 뒤로 빠지고, 일어나 한 걸음 물러선 뒤, 의자를 밀어 넣고 나간다.
                .run { [weak self] in self?.slideChair(chair, to: 0.28, with: person) },
                .act(.sitListen, 0.4),
                .run {
                    person.root.position = SCNVector3(chair.x, 0, chair.z + side * 0.6)
                    person.setActivity(.stand)
                },
                .act(.reach, 0.35),
                .run { [weak self] in self?.slideChair(chair, to: 0) },
                .walk(Array(back.dropFirst()) + [standUpPoint(stationKey(person) ?? "manager")], speed: 1.15),
                .run { [weak self] in
                    guard let self else { return }
                    self.sit(person)
                    person.setActivity(self.workActivity(person))
                },
            ])
        }
    }

    /// 바닥 위 점에서 선분까지 거리(x·z만).
    private func distanceToSegment(_ p: SCNVector3, _ a: SCNVector3, _ b: SCNVector3) -> CGFloat {
        let dx = b.x - a.x, dz = b.z - a.z
        let length2 = dx * dx + dz * dz
        let t = length2 < 1e-6 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2))
        return hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
    }

    private func endMeetingImmediately() {
        meetingOn = false
        for (_, chair, _) in meetingSeats { meetingChair(at: chair)?.position.z = chair.z }
        for (person, _, _) in meetingSeats {
            person.stopSteps()
            sit(person)
            coworkerStates[ObjectIdentifier(person)] = nil
        }
    }

    /// 자기 의자 뒤(일어서는 곳)의 사무실 좌표.
    func standUpPoint(_ key: String) -> SCNVector3 {
        if key == "me" { return hub }
        guard let station = stations[key] else { return SCNVector3Zero }
        let point = station.convertPosition(SCNVector3(0, 0, 0.6), to: parts.root)
        return SCNVector3(point.x, 0, point.z)
    }

    /// 짐을 챙길 때 서는 곳. 의자 옆, 책상 앞(의자 등받이에 몸이 가리지 않게).
    func packPoint(_ key: String) -> SCNVector3 {
        let local = SCNVector3(0.62, 0, -0.12)
        guard let station = stations[key] else { return hub }
        let point = station.convertPosition(local, to: parts.root)
        return SCNVector3(point.x, 0, point.z)
    }

    /// 자리 노드에서 꺼내 사무실 좌표로 옮긴다(걸어 다니려고).
    func toWorld(_ person: Person) {
        guard person.root.parent !== parts.root else { return }
        // 일어나면 의자가 뒤로 빠진다.
        if let key = stationKey(person), person.root.parent === stations[key] { setChair(key, .out) }
        let position = person.root.convertPosition(SCNVector3Zero, to: parts.root)
        let heading = person.root.convertVector(SCNVector3(0, 0, -1), to: parts.root)
        person.root.removeFromParentNode()
        parts.root.addChildNode(person.root)
        person.root.position = SCNVector3(position.x, 0, position.z)
        person.face(atan2(-heading.x, -heading.z) * 180 / .pi)
    }

    // MARK: - 내 캐릭터

    public func setMyAvatar(_ avatar: MyAvatar) {
        guard avatar != myAvatar else { return }
        myAvatar = avatar
        guard !scripted else { return }
        placeMe(animated: true)
    }

    /// 내 자리 의자 뒤. 여기를 거쳐 어디로든 간다.
    var hub: SCNVector3 { SCNVector3(Layout.mySeat.x, 0, Layout.mySeat.z + 0.62) }

    /// 내가 지금 가려는 곳(동료가 피하도록).
    var meTarget: Place? {
        guard me.isBusy || meSpot != .seat else { return nil }
        return place(of: meSpot)
    }

    func placeMe(animated: Bool) {
        var target: MeSpot
        var activity: Person.Activity = .stand
        var sign: String?
        switch myAvatar {
        case .outside: target = .outside
        case .seated: target = .seat; activity = .sitTyping
        case .presenting: target = .meeting; activity = .present
        case .away(let reason):
            let plan = AwayPlan.plan(for: reason)
            target = plan.spot
            activity = plan.activity
            sign = "자리 비움"
        case .lunch: target = .gone; sign = "점심 중"
        case .dinner: target = .gone; sign = "저녁시간"
        case .empty, .off: target = .hidden
        case .cameraOff: target = .hidden; sign = "카메라 확인 중"
        }
        setMyDeskSign(sign)

        var from = meSpot
        // 택배를 자리로 가져와 뜯는 중이면 이미 내 자리 옆에 있다.
        if from == .door, parcelAtDesk {
            parcelAtDesk = false
            from = .seat
            meSpot = .seat
            if target == .seat {
                me.play([.rawWalk([hub], speed: 0.8), .run { [weak self] in self?.arrive(at: .seat, activity: activity) }])
                setMyDeskSign(sign)
                return
            }
        }
        // 퇴근: 자리에서 짐을 챙겨 문으로 걸어 나가는 모습을 가까이서 보여 준다.
        if myAvatar == .off, animated, from != .hidden, from != .outside, from != .gone, from != .restroom {
            playLeaving(from: from)
            return
        }
        me.carriesBackpack = target == .outside
        if from == target, me.isBusy || from == .seat { return }
        let canWalk = animated && from != target && from != .hidden && target != .hidden && target != .outside && from != .outside
        meSpot = target
        if let place = place(of: target), let holder = occupied[place],
           let other = coworkers.first(where: { ObjectIdentifier($0) == holder }) {
            other.hurry()
        }
        guard canWalk, let fromPlace = place(of: from), let toPlace = place(of: target) else {
            me.stopSteps()
            me.holdsBox = false
            arrive(at: target, activity: activity)
            return
        }

        var steps: [Person.Step] = []
        // 지금 자리에서 걸을 준비.
        switch from {
        case .seat:
            if !(me.activity == .packUp) { me.root.position = hub }
            setChair("me", .out)
        case .gone:
            me.root.position = hallEnd
            me.root.opacity = 0
            me.setActivity(.stand)
            steps.append(.fade(1, 0.5))
        case .restroom:
            me.root.position = approach(.restroom).points.last ?? hub
            me.setActivity(.stand)
            steps.append(.act(.stand, 0.5))
        case .snack:
            me.holdsSnackWhileReaching = false
            me.root.position = approach(.stool(0)).points.last ?? hub
            me.setActivity(.stand)
        case .door:
            // 택배를 받았으면 상자를 들고 돌아간다.
            me.holdsBox = me.activity == .standBox || me.activity == .offerBox
        case .meeting:
            // 회의가 끝나면 문 가까운 동료부터 1.4초 간격으로 나간다. 발표자가 같이 출발하면 문 앞에서 부딪히므로
            // 상사들이 다 빠져나간 뒤에 나간다(정해진 몇 초로는 모자라 문 안쪽에서 서로 기다렸다).
            // 발표 자리에 아직 못 갔으면(문 안쪽에서 기다리던 중 등) 그 자리에서 발표 몸짓을 하지 않는다. 문을 막는다.
            if let spot = approach(.meeting).points.last, hypot(me.root.position.x - spot.x, me.root.position.z - spot.z) < 0.4 {
                // 발표를 마무리하는 몸짓을 하다가, 상사들이 회의실과 문 앞을 다 빠져나간 뒤(길어야 15초) 나간다.
                steps.append(.act(.present, 1.5))
                steps.append(.waitUntil({ [weak self] in self?.audienceLeftMeetingRoom ?? true }, 15))
            }
        default: break
        }
        if from == .microwave { microwaveGlow?.geometry?.firstMaterial?.emission.intensity = 0.05 }
        if from == .fridge { setFridgeOpen(false) }

        if target == .snack {
            // 조리대에서 과자를 집고 걸상에 앉는다.
            let seat = stoolSeat(0)
            steps += [
                .walk(route(from: fromPlace, to: .counter), speed: 1.3), .face(90),
                .act(.reach, 1.1), .run { [weak self] in self?.me.holdsSnackWhileReaching = true }, .act(.reach, 0.4),
                .walk(route(from: .counter, to: .stool(0)), speed: 1.2),
                .run { [weak self] in self?.me.root.position = SCNVector3(seat.x, seat.y - Person.hipHeight + 0.015, seat.z) },
                .face(facing(.stool(0))),
                .act(.sitEat, .infinity),
            ]
        } else {
            var path = route(from: fromPlace, to: toPlace)
            if target == .meeting, let split = path.firstIndex(where: { abs($0.x - meetingDoorOut.x) < 0.01 && abs($0.z - meetingDoorOut.z) < 0.01 }) {
                // 발표자는 회의실 문 밖에서 상사들이 다 앉을 때까지(길어야 25초) 기다렸다 들어간다.
                // 앞줄 의자 뒤 통로가 좁아, 상사가 의자를 빼고 앉는 동안 그 뒤를 지나면 부딪힌다.
                // 기다리는 자리는 문 앞 길에서 비켜선 곳(탕비실 벽 쪽). 문 앞에 서 있으면 들어오는 상사들과 겹친다.
                let aside = SCNVector3(Layout.pantryX1 + 0.2, 0, meetingDoorOut.z + 0.3)
                steps.append(.walk(Array(path[..<split]) + [aside], speed: 1.3))
                steps.append(.face(-150))
                steps.append(.waitUntil({ [weak self] in self?.audienceSeated ?? true }, 25))
                path = Array(path[split...])
            }
            steps.append(.walk(path, speed: 1.3))
            steps += afterArrival(target, activity: activity)
        }
        me.play(steps)
    }

    /// 도착한 뒤 하는 일.
    private func afterArrival(_ spot: MeSpot, activity: Person.Activity) -> [Person.Step] {
        let place = place(of: spot) ?? .seat("me")
        switch spot {
        case .seat:
            return [.run { [weak self] in
                guard let self else { return }
                if self.me.holdsBox {
                    // 받은 택배는 책상 옆에 내려놓는다.
                    self.me.holdsBox = false
                    self.deskParcel?.isHidden = false
                }
                self.arrive(at: .seat, activity: activity)
            }]
        case .water, .coffee:
            return [.face(facing(place)), .act(.fillCup, 2.6)] + stepBack(from: place) + [.act(.drinkCup, .infinity)]
        case .fridge:
            return [.face(90), .run { [weak self] in self?.setFridgeOpen(true) }, .act(.reach, 1.6),
                    .run { [weak self] in self?.setFridgeOpen(false) }] + stepBack(from: place) + [.act(.drinkCup, .infinity)]
        case .microwave:
            return [.face(90), .act(.reach, 0.9),
                    .run { [weak self] in self?.microwaveGlow?.geometry?.firstMaterial?.emission.intensity = 1 },
                    .act(.stand, 8),
                    .run { [weak self] in self?.microwaveGlow?.geometry?.firstMaterial?.emission.intensity = 0.05 },
                    .act(.reach, 0.9), .act(.stand, .infinity)]
        case .restroom:
            return [.run { [weak self] in self?.me.setActivity(.hidden) }, .act(.hidden, .infinity)]
        case .door:
            return [.face(180), .run { [weak self] in self?.callCourier() }, .act(.stand, .infinity)]
        case .gone:
            return [.fade(0, 0.5), .act(.hidden, .infinity)]
        case .meeting, .window:
            return [.face(facing(place)), .act(activity, .infinity)]
        default:
            return [.face(facing(place)), .act(activity, .infinity)]
        }
    }

    /// 컵을 받은 뒤 한 걸음 물러나 방 쪽(카메라 쪽)으로 돌아선다. 벽을 보고 마시면 컵이 안 보인다.
    func stepBack(from place: Place) -> [Person.Step] {
        // 물러나면 탕비실 가운데 길을 막는다. 그 자리에서 방 쪽(카메라 쪽)으로 돌아서기만 한다.
        guard approach(place).points.last != nil else { return [] }
        return [.face(150)]
    }

    /// 걷지 않고 바로 그 자리에 둔다.
    func arrive(at spot: MeSpot, activity: Person.Activity) {
        me.root.opacity = 1
        switch spot {
        case .hidden, .gone, .restroom:
            me.setActivity(.hidden)
            if spot == .gone { me.root.position = hallEnd }
            if spot == .restroom { me.root.position = approach(.restroom).points.last ?? hub }
        case .outside:
            me.root.position = SCNVector3(Layout.outsideDoor.x, 0, Layout.outsideDoor.z - 0.2)
            me.face(0)
            me.setActivity(.stand)
            setChair("me", .tucked, animated: false)
        case .seat:
            let seat = Layout.mySeat
            me.root.position = SCNVector3(seat.x, Person.seatedRootY, seat.z - 0.05)
            me.face(0)
            me.setActivity(activity)
            setChair("me", .normal)
        case .snack:
            let seat = stoolSeat(0)
            me.root.position = SCNVector3(seat.x, seat.y - Person.hipHeight + 0.015, seat.z)
            me.face(facing(.stool(0)))
            me.holdsSnackWhileReaching = true
            me.setActivity(.sitEat)
        default:
            guard let place = place(of: spot) else { return }
            me.root.position = approach(place).points.last ?? hub
            me.face(facing(place))
            me.setActivity(activity)
        }
    }

    /// 내 책상 앞쪽에 세우는 작은 팻말. 작은 화면에서도 읽히게 크게 만든다.
    private func setMyDeskSign(_ text: String?) {
        myDeskSign?.removeFromParentNode()
        myDeskSign = nil
        guard let text, let desk = myDesk else { return }
        let sign = SCNNode.group("desk.sign")
        let face = Shape.plane(0.5, 0.2, Mat.image(Textures.deskSign(text), roughness: 0.7), corner: 0.03)
        face.at(0, 0.13, 0).turned(x: -18).noShadow().into(sign)
        Shape.box(0.5, 0.2, 0.015, round: 0.01, Mat.matte(Palette.green)).at(0, 0.13, 0.012).turned(x: -18).into(sign)
        sign.at(-0.2, 0.775, 0.3).into(desk.node)
        myDeskSign = sign
    }

    // MARK: - 택배

    /// 택배 기사가 복도 끝에서 상자를 들고 와 문 앞에서 건네고 인사한 뒤 돌아간다.
    func callCourier() {
        guard courier.activity == .hidden || !courier.isBusy else { return }
        let handoff = SCNVector3(Layout.outsideDoor.x, 0, Layout.halfDepth + 0.62)
        courier.root.position = hallEnd
        courier.root.opacity = 0
        courier.holdsBox = true
        courier.setActivity(.stand)
        courier.play([
            .fade(1, 0.4),
            .walk([SCNVector3(0.6, 0, hallEnd.z), handoff], speed: 1.1),
            .face(0),
            .run { [weak self] in self?.handOverParcel(at: handoff) },
            // 받을 사람이 끝내 안 오면(그새 자리로 돌아갔거나 다른 일을 함) 8초 뒤 상자를 든 채 돌아간다.
            .act(.offerBox, 8),
            .act(.stand, 0.5),
            .walk([SCNVector3(0.6, 0, hallEnd.z), hallEnd], speed: 1.15),
            .fade(0, 0.4),
            .run { [weak self] in self?.courier.setActivity(.hidden) },
        ])
    }

    /// 택배 기사를 바로 돌려보낸다(시각을 건너뛰거나 새 날).
    func dismissCourier() {
        courier.stopSteps()
        courier.holdsBox = false
        courier.setActivity(.hidden)
    }

    private func handOverParcel(at handoff: SCNVector3) {
        // 내가 아직 문 앞에서 기다리면 한 걸음 다가가 받는다. 그새 자리로 돌아갔으면 문 앞에 두고 간다.
        let waiting = meSpot == .door && (me.activity == .stand || me.activity == .walk)
        let leave: [Person.Step] = [
            .act(.bow, 0.8),
            .walk([SCNVector3(0.6, 0, hallEnd.z), hallEnd], speed: 1.15),
            .fade(0, 0.4),
            .run { [weak self] in self?.courier.setActivity(.hidden) },
        ]
        guard waiting else {
            // 받을 사람이 없으면 상자를 든 채 돌아간다.
            courier.play([.act(.stand, 1.2), .walk([SCNVector3(0.6, 0, hallEnd.z), hallEnd], speed: 1.15),
                          .fade(0, 0.4), .run { [weak self] in self?.courier.setActivity(.hidden) }])
            return
        }
        let doorPoint = approach(.door).points.last ?? Layout.insideDoor
        me.play([
            // 자동문이 열리면 문 앞으로 다가가 받는다.
            .rawWalk([SCNVector3(doorPoint.x, 0, Layout.halfDepth - 0.12)], speed: 0.9),
            .face(180),
            .act(.reach, 0.35),
            .run { [weak self] in
                // 상자가 기사 손에서 내 손으로 넘어온다.
                guard let self else { return }
                self.courier.holdsBox = false
                self.me.holdsBox = true
                self.courier.play([.act(.offerBox, 0.5)] + leave)
            },
            .act(.offerBox, 0.6),
            .act(.standBox, 0.4),
            // 상자를 들고 자리로 돌아가 책상 옆에 내려놓고 뜯는다(늘 카메라에 보이는 곳).
            .walk([doorPoint] + route(from: .door, to: .seat("me")) + [packPoint("me")], speed: 1.0),
            .face(0),
            .run { [weak self] in
                guard let self else { return }
                self.me.holdsBox = false
                self.deskParcel?.isHidden = false
                self.parcelAtDesk = true
            },
            .act(.packUp, .infinity),
        ])
    }

    // MARK: - 퇴근 연출

    /// 자리에서 일어나 짐을 챙기고, 문으로 걸어 나가 돌아서 손을 흔들고 복도로 사라진다.
    private func playLeaving(from: MeSpot) {
        meSpot = .gone
        doorFreeAt = max(doorFreeAt, clock + 9)
        setMyDeskSign(nil)
        holdDeskOn = true
        if !myScreenOn {
            myScreenOn = true
            myLampOn = true
            applyLook()
        }
        startFilm(packShot(me, turn: 0))
        var steps: [Person.Step] = []
        if from == .seat {
            me.root.position = packPoint("me")
            me.face(0)
            setChair("me", .out)
        } else if let place = place(of: from) {
            if from == .snack { me.root.position = approach(.stool(0)).points.last ?? hub }
            me.holdsSnackWhileReaching = false
            me.holdsBox = false
            me.setActivity(.stand)
            steps.append(.walk(route(from: place, to: .seat("me")) + [packPoint("me")], speed: 1.3))
            steps.append(.face(0))
        }
        let toDoor = route(from: .seat("me"), to: .outside).dropLast(3)
        steps += [
            .act(.packUp, 2.2),
            .run { [weak self] in self?.me.carriesBackpack = true },
            .act(.packUp, 0.9),
            .run { [weak self] in
                guard let self else { return }
                // 모니터와 스탠드를 끄고 돌아선다.
                self.holdDeskOn = false
                self.myScreenOn = false
                self.myLampOn = false
                self.applyLook()
            },
            .act(.stand, 0.5),
            .run { [weak self] in
                guard let self else { return }
                self.startFilm(self.walkShot(self.me))
                self.setChair("me", .tucked)
            },
            .walk(Array(toDoor), speed: 1.15),
            .run { [weak self] in
                guard let self else { return }
                self.startFilm(.fixed(self.doorShot))
            },
            .walk([Layout.insideDoor, justOutside], speed: 1.05),
            .face(0),
            .act(.wave, 1.8),
            .walk([hallEnd], speed: 1.1),
            .fade(0, 0.6),
            .run { [weak self] in
                guard let self else { return }
                self.me.setActivity(.hidden)
                self.endFilm()
            },
            .act(.hidden, .infinity),
        ]
        me.play(steps)
    }

    /// 짐 챙기는 사람을 보는 구도. 섬 자리는 통로 쪽 비스듬히 뒤에서(마주 본 모니터가 가리지 않게),
    /// 팀장·부장은 책상 너머 앞에서(뒤는 벽이라).
    func packShot(_ person: Person, turn: CGFloat) -> FilmShot {
        switch Organization.member(person.memberID)?.seat {
        case .islandHead, .departmentHead:
            return .follow(person, yaw: turn + 192, pitch: 30, distance: 6.6, fov: 24)
        default:
            return .follow(person, yaw: turn - 35, pitch: 30, distance: 6.2, fov: 24)
        }
    }

    /// 걸어가는 사람을 앞 왼쪽 위에서 따라간다. 앞벽과 왼쪽 벽이 낮아서 어디서든 가리지 않는다.
    func walkShot(_ person: Person) -> FilmShot {
        .follow(person, yaw: -28, pitch: 32, distance: 10, fov: 24)
    }

    /// 사무실 안에서 출입문을 바라보는 구도.
    var doorShot: Pose {
        Pose(target: SCNVector3(Layout.outsideDoor.x + 0.3, 0.75, Layout.halfDepth + 0.6), yaw: 165, pitch: 28, distance: 6.8, fov: 26)
    }

    /// 지금 동료 퇴근을 찍어도 되는지. 사람이 다른 화면을 보고 있으면 카메라를 빼앗지 않는다.
    var canFilm: Bool { !filmActive && view == .overview && panelShiftValue == 0 && !scripted }

    // MARK: - 입장 장면

    /// 출근하면 문이 열리고 내 캐릭터가 걸어 들어가 자리에 앉는다. 팀장은 일어나 손을 흔든다.
    public func playEntrance(completion: (@MainActor () -> Void)? = nil) {
        scripted = true
        setMyDeskSign(nil)
        me.stopSteps()
        me.carriesBackpack = true
        me.root.opacity = 1
        me.root.position = SCNVector3(Layout.outsideDoor.x, 0, Layout.outsideDoor.z - 0.2)
        me.face(0)
        me.setActivity(.stand)
        doorAuto = true
        // 앞벽이 내려가며 카메라가 사무실 전체로 물러난다. 문은 내 캐릭터가 손을 뻗어 열고 들어가 닫는다.
        let wall = parts.frontUpper, sign = parts.signNode
        let wallDrop = -(Layout.wallHeight - Layout.lowWall)
        tween(1.3, delay: 0.5) { t in
            wall.position.y = wallDrop * CGFloat(t)
            wall.opacity = 1 - CGFloat(t)
            sign.opacity = 1 - CGFloat(t)
        }
        glideView(to: .overview, duration: 2.2, delay: 0.4)
        if state(for: manager, at: shownMinute) == .working, !meetingOn, !manager.isBusy {
            toWorld(manager)
            manager.root.position = standUpPoint("manager")
            manager.face(-60)
            manager.setActivity(.wave)
        }
        let seat = Layout.mySeat
        me.play([
            .act(.stand, 0.6),
            .walk([Layout.insideDoor, SCNVector3(seat.x - 0.35, 0, seat.z + 1.0), hub], speed: 1.0),
            // 의자에 가방을 내려놓는다.
            .act(.packUp, 0.7),
            .run { [weak self] in
                guard let self else { return }
                self.me.carriesBackpack = false
                self.meSpot = .seat
                // 곧바로 다른 곳(예: 아침 PT 발표)으로 가야 하면 앉지 않고 선 채로 이어서 간다.
                // 앉았다 바로 일어나 되돌아가면 문 앞에서 멈칫하는 것처럼 보인다.
                if self.myAvatar == .seated { self.arrive(at: .seat, activity: .sitTyping) }
                self.scripted = false
                if self.manager.activity == .wave {
                    self.sit(self.manager)
                    self.manager.setActivity(.sitTyping)
                    self.coworkerStates[ObjectIdentifier(self.manager)] = .working
                }
                self.updateCoworkers()
                if self.meetingWanted, !self.meetingOn, self.everyoneWorking {
                    self.gatherMeeting(animated: true)
                }
                // 그 사이 앱이 바꿔 둔 내 상태(예: 아침 PT 발표)로 이어서 간다.
                if self.myAvatar != .seated { self.placeMe(animated: true) }
                completion?()
            },
        ])
    }

    /// 입장 장면이 진행 중인지.
    public var isPlayingEntrance: Bool { scripted }
}
