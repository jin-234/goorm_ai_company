import AppKit
import SceneKit
import simd

/// 손으로 여닫는 문. 문을 지나는 길이면 문 앞에서 손을 뻗어 열고, 지나간 뒤 뒤따라오는 사람이 없으면 돌아서서 닫는다.
struct HandDoor {
    /// 여닫이 문의 경첩(자동문은 쓰지 않음).
    let pivot: SCNNode
    /// 활짝 열렸을 때 각도(라디안).
    let openAngle: CGFloat
    /// 문이 선 면(Z)과 그 면에서 문이 차지하는 X 범위.
    let planeZ: CGFloat
    let x0: CGFloat
    let x1: CGFloat
    var isOpen = false
    /// 지금 문을 지나는 사람. 둘이 한꺼번에 문에 끼지 않게 한 사람씩.
    var crossing: ObjectIdentifier?
    weak var crosser: Person?
    /// 문 앞에서 차례를 기다리는 사람들(먼저 온 순서).
    var queue: [Person] = []
    /// 자동 미닫이문인지. 사람이 다가가면 저절로 열린다.
    var automatic = false
    /// 미닫이 짝들(노드, 닫혔을 때 X, 열렸을 때 X).
    var panels: [(node: SCNNode, closedX: CGFloat, openX: CGFloat)] = []
    /// 미닫이가 열린 정도 0~1.
    var fraction: CGFloat = 0

    var center: SCNVector3 { SCNVector3((x0 + x1) / 2, 0, planeZ) }
}

/// 의자 자리.
enum ChairPose {
    /// 책상 밑으로 밀어 넣음(퇴근, 출근 전).
    case tucked
    /// 앉아 있음.
    case normal
    /// 일어나서 뒤로 빠짐.
    case out
}

extension OfficeStage {

    func setUpHandDoors() {
        let hd = Layout.halfDepth, t = Layout.thickness
        // 0 출입문(자동), 1 회의실(자동), 2 화장실(손으로 여닫음).
        var main = HandDoor(pivot: parts.doorPivot, openAngle: 0, planeZ: hd + t / 2, x0: Layout.doorX0, x1: Layout.doorX1)
        main.automatic = true
        let width = Layout.doorX1 - Layout.doorX0
        for (name, closed, open) in [("door.left", width / 4, width / 4 - width / 2 + 0.06), ("door.right", width * 3 / 4, width * 3 / 4 + width / 2 - 0.06)] {
            if let node = parts.doorPivot.childNode(withName: name, recursively: false) { main.panels.append((node, closed, open)) }
        }
        handDoors = [main]
        if let meeting = meetingDoorPivot {
            var door = HandDoor(pivot: meeting, openAngle: 0, planeZ: Layout.meetingZ1,
                                x0: Layout.meetingX1 - 1.25, x1: Layout.meetingX1 - 0.12)
            door.automatic = true
            door.panels = meetingDoorPanels
            handDoors.append(door)
        }
        if let restroom = restroomDoor {
            handDoors.append(HandDoor(pivot: restroom, openAngle: rad(95), planeZ: Layout.restroomZ1,
                                      x0: Layout.restroomX - 0.45, x1: Layout.restroomX + 0.45))
        }
        for person in [me, courier] + coworkers {
            person.avoidance = { [weak self] person in self?.avoid(person) ?? (1, 0) }
            person.walkExpander = { [weak self] person, points, speed in self?.expandWalk(person, points, speed) }
            person.doorHandler = { [weak self] person, index, opening, heading in
                self?.handleDoor(person, index, opening, heading) ?? []
            }
            person.queueHandler = { [weak self] person, index, spot, heading in
                self?.handleQueue(person, index, spot, heading) ?? []
            }
        }
    }

    /// 자동문: 누가 문 가까이 있거나 지나는 중이면 열고, 아니면 닫는다. 매 화면 부른다.
    func updateAutoDoors(_ delta: Double) {
        let people = [me, courier] + coworkers
        for index in handDoors.indices where handDoors[index].automatic {
            var want: CGFloat = 0
            let enabled = index != 0 || doorAuto
            // 지나간 사람이 멀어졌으면 차례를 푼다.
            if let crosser = handDoors[index].crosser, !(crosser.isBusy && !crosser.root.isHidden && distance(crosser, to: handDoors[index].center) < 1.3) {
                handDoors[index].crossing = nil
                handDoors[index].crosser = nil
            }
            if enabled {
                let center = handDoors[index].center
                // 회의실 문은 걷는 사람이 닿기 전에 활짝 열려 있도록 1.8m 앞에서부터 연다.
                // 출입문은 택배를 기다리며 서는 자리(문에서 약 1.4m)에서 계속 열려 있지 않게 1.3m.
                let radius: CGFloat = index == 0 ? 1.3 : 1.8
                let near = people.contains { person in
                    guard !person.root.isHidden, person.root.opacity > 0.05 else { return false }
                    return distance(person, to: center) < radius
                }
                if near || handDoors[index].crossing != nil { want = 1 }
            }
            let k = CGFloat(min(1, delta * 8))
            handDoors[index].fraction += (want - handDoors[index].fraction) * k
            let f = smoothstep(0, 1, Double(handDoors[index].fraction))
            for panel in handDoors[index].panels {
                panel.node.position.x = panel.closedX + (panel.openX - panel.closedX) * CGFloat(f)
            }
        }
    }

    /// 문을 연다·닫는다.
    func setHandDoor(_ index: Int, open: Bool, animated: Bool = true) {
        guard handDoors.indices.contains(index) else { return }
        if handDoors[index].automatic {
            if !animated { handDoors[index].fraction = open ? 1 : 0 }
            return
        }
        handDoors[index].isOpen = open
        let pivot = handDoors[index].pivot
        let from = pivot.eulerAngles.y, to = open ? handDoors[index].openAngle : 0
        guard animated else { pivot.eulerAngles.y = to; return }
        tween(0.5) { t in pivot.eulerAngles.y = from + (to - from) * CGFloat(t) }
    }

    /// 모든 문을 닫고 지나는 사람 기록을 지운다(시각이 건너뛸 때).
    func resetHandDoors() {
        for index in handDoors.indices {
            handDoors[index].crossing = nil
            handDoors[index].queue = []
            setHandDoor(index, open: false, animated: false)
        }
    }

    // MARK: 문 지나기

    /// 사람 위치 → 경로에서 문을 지나는 곳을 찾아, 문 앞에서 멈춰 여는 단계와 지난 뒤 닫는 단계를 끼운다.
    func expandWalk(_ person: Person, _ points: [SCNVector3], _ speed: Float) -> [Person.Step]? {
        let start = person.root.convertPosition(SCNVector3Zero, to: parts.root)
        var previous = SIMD2<Float>(Float(start.x), Float(start.z))
        var pending: [SCNVector3] = []
        var steps: [Person.Step] = []
        var crossed = false
        // 문 앞 줄은 걸어온 방향 뒤로 늘어선다(문을 지나는 방향이 아니라).
        var lastDirection: SIMD2<Float>?
        for point in points {
            let next = SIMD2<Float>(Float(point.x), Float(point.z))
            if let (index, hit) = doorCrossing(from: previous, to: next) {
                crossed = true
                let direction = simd_normalize(next - previous)
                let before = min(0.55, max(0, simd_length(hit - previous) - 0.02))
                let after = min(0.6, simd_length(next - hit))
                let a = hit - direction * before, b = hit + direction * after
                pending.append(SCNVector3(CGFloat(a.x), 0, CGFloat(a.y)))
                let heading = CGFloat(atan2(-direction.x, -direction.y)) * 180 / .pi
                let doorSpot = SCNVector3(CGFloat(a.x), 0, CGFloat(a.y))
                // 문 앞 0.6m에서 차례를 확인한다.
                let back = max(0, min(0.6, simd_length(a - previous) - 0.02))
                let q = a - direction * back
                pending.removeLast()
                pending.append(SCNVector3(CGFloat(q.x), 0, CGFloat(q.y)))
                steps.append(.rawWalk(pending, speed: speed))
                // 손으로 여는 문(화장실)만 한 사람씩 줄을 선다. 자동문은 간격만 지키며 이어 들어간다.
                if !handDoors[index].automatic {
                    steps.append(.doorQueue(index, doorSpot, heading))
                }
                pending = [doorSpot]
                steps.append(.rawWalk(pending, speed: speed))
                steps.append(.door(index, true, heading))
                steps.append(.rawWalk([SCNVector3(CGFloat(b.x), 0, CGFloat(b.y))], speed: speed * 0.85))
                steps.append(.door(index, false, heading))
                pending = []
                previous = b
                if simd_length(next - b) > 0.02 { pending.append(point) }
                previous = next
                continue
            }
            pending.append(point)
            if simd_length(next - previous) > 0.01 { lastDirection = simd_normalize(next - previous) }
            previous = next
        }
        guard crossed else { return nil }
        if !pending.isEmpty { steps.append(.rawWalk(pending, speed: speed)) }
        return steps
    }

    /// 선분이 어느 문을 지나는지와 그 점.
    private func doorCrossing(from p: SIMD2<Float>, to q: SIMD2<Float>) -> (Int, SIMD2<Float>)? {
        for (index, door) in handDoors.enumerated() {
            let z = Float(door.planeZ)
            let dp = p.y - z, dq = q.y - z
            guard dp * dq < 0 else { continue }
            let t = dp / (dp - dq)
            let hit = p + (q - p) * t
            if hit.x >= Float(door.x0) - 0.3, hit.x <= Float(door.x1) + 0.3 { return (index, hit) }
        }
        return nil
    }

    /// 문 앞 줄에서 할 일. 문이 비었고 내 차례면 문을 잡고 나아간다. 아니면 앞사람 뒤 0.6m 간격으로 서서 기다린다.
    func handleQueue(_ person: Person, _ index: Int, _ spot: SCNVector3, _ heading: CGFloat) -> [Person.Step] {
        guard handDoors.indices.contains(index) else { return [] }
        let center = handDoors[index].center
        // 할 일을 그만뒀거나 멀어진 사람은 줄에서 뺀다.
        handDoors[index].queue.removeAll { $0 !== person && (!$0.isBusy || distance($0, to: center) > 4.5) }
        // 앞사람이 문에서 1.3m 넘게 멀어져야 다음 사람이 들어선다(문 바로 안에서 길이 엇갈려도 겹치지 않게).
        if let crosser = handDoors[index].crosser, crosser !== person, !(crosser.isBusy && !crosser.root.isHidden && distance(crosser, to: center) < 1.3) {
            handDoors[index].crossing = nil
            handDoors[index].crosser = nil
        }
        let free = handDoors[index].crossing == nil || handDoors[index].crossing == ObjectIdentifier(person)
        let first = handDoors[index].queue.first.map { $0 === person } ?? true
        if free && first {
            handDoors[index].queue.removeAll { $0 === person }
            handDoors[index].crossing = ObjectIdentifier(person)
            handDoors[index].crosser = person
            return []
        }
        if !handDoors[index].queue.contains(where: { $0 === person }) { handDoors[index].queue.append(person) }
        let order = handDoors[index].queue.firstIndex { $0 === person } ?? 0
        let h = Float(rad(heading))
        let direction = SIMD2<Float>(-sin(h), -cos(h))
        let gap = 0.6 * Float(order + 1)
        let wait = SCNVector3(spot.x - CGFloat(direction.x * gap), 0, spot.z - CGFloat(direction.y * gap))
        return [.rawWalk([wait], speed: 0.9), .face(heading), .act(.stand, 0.3), .doorQueue(index, spot, heading)]
    }

    /// 문 단계에서 할 일.
    func handleDoor(_ person: Person, _ index: Int, _ opening: Bool, _ heading: CGFloat) -> [Person.Step] {
        guard handDoors.indices.contains(index) else { return [] }
        let id = ObjectIdentifier(person)
        if opening {
            // 자동문이라도 반대쪽에서 누가 지나오는 중이면 문 앞에서 비켜서서 기다린다(문틀 사이에서 마주치면 비킬 곳이 없다).
            let myDirection = SIMD2<Float>(-sin(Float(rad(heading))), -cos(Float(rad(heading))))
            if handDoors[index].automatic, let crosser = handDoors[index].crosser, crosser !== person,
               crosser.isBusy, crosser.isWalking, !crosser.root.isHidden, distance(crosser, to: handDoors[index].center) < 1.3,
               simd_dot(crosser.forward, myDirection) < -0.3 {
                let h = Float(rad(heading))
                let dir = SIMD2<Float>(-sin(h), -cos(h)), right = SIMD2<Float>(-dir.y, dir.x)
                let here = SIMD2<Float>(Float(person.root.position.x), Float(person.root.position.z))
                var aside = here - dir * 0.45 + right * 0.5
                if !isOpenFloor(CGFloat(aside.x), CGFloat(aside.y), margin: 0.15) { aside = here - dir * 0.45 - right * 0.5 }
                return [.rawWalk([SCNVector3(CGFloat(aside.x), 0, CGFloat(aside.y))], speed: 0.9), .face(heading), .act(.stand, 0.4), .door(index, true, heading)]
            }
            handDoors[index].crossing = id
            handDoors[index].crosser = person
            // 자동문은 다가가면 열려 있다. 멈추지 않고 지나간다.
            if handDoors[index].automatic || handDoors[index].isOpen { return [] }
            return [.face(heading), .act(.reach, 0.5), .run { [weak self] in self?.setHandDoor(index, open: true) }, .act(.reach, 0.25)]
        }
        // 자동문은 지나간 사람이 충분히 멀어질 때까지 차례를 쥐고 있는다(handleQueue에서 풀린다).
        if handDoors[index].automatic { return [] }
        if handDoors[index].crossing == id {
            handDoors[index].crossing = nil
            handDoors[index].crosser = nil
        }
        // 뒤따라 문을 지날 사람이 있으면 열어 둔다. 마지막 사람이 돌아서서 닫는다.
        if someoneElseComing(through: index, except: person) { return [] }
        guard handDoors[index].isOpen else { return [] }
        return [.face(heading + 180), .act(.reach, 0.45), .run { [weak self] in self?.setHandDoor(index, open: false) }, .act(.stand, 0.15)]
    }

    private func distance(_ person: Person, to point: SCNVector3) -> CGFloat {
        let p = person.root.convertPosition(SCNVector3Zero, to: parts.root)
        return hypot(p.x - point.x, p.z - point.z)
    }

    /// 다른 사람이 곧(걸어서 6미터 안) 이 문을 지날 예정인지.
    private func someoneElseComing(through index: Int, except person: Person) -> Bool {
        if let other = handDoors[index].crossing, other != ObjectIdentifier(person) { return true }
        if handDoors[index].queue.contains(where: { $0 !== person }) { return true }
        for other in [me, courier] + coworkers where other !== person && !other.root.isHidden {
            let route = other.upcomingPoints(in: parts.root)
            guard route.count >= 2 else { continue }
            var travelled: Float = 0
            for (a, b) in zip(route, route.dropFirst()) {
                if doorCrossing(from: a, to: b)?.0 == index { return travelled < 6 }
                travelled += simd_length(b - a)
                if travelled > 6 { break }
            }
        }
        return false
    }

    // MARK: 사람끼리 피하기

    /// 앞에 같은 쪽으로 걷는 사람이 있으면 간격을 두고 따라가고, 마주 오거나 서 있는 사람은 오른쪽으로 비켜 간다.
    func avoid(_ person: Person) -> (slow: Float, side: Float) {
        guard person.root.parent === parts.root else { return (1, 0) }
        let me2 = SIMD2<Float>(Float(person.root.position.x), Float(person.root.position.z))
        let dir = person.forward
        var slow: Float = 1, side: Float = 0
        var needSide = false
        for other in [me, courier] + coworkers where other !== person {
            guard !other.root.isHidden, other.root.opacity > 0.3, other.root.parent === parts.root else { continue }
            // 의자·걸상에 앉은 사람은 길 위에 있지 않다(회의실 의자 옆을 지날 때 괜히 멈칫하던 것).
            if [.sitTyping, .sitTypingWithMug, .sitListen, .sitEat, .sitReview, .sitExplain].contains(other.activity) { continue }
            let p = SIMD2<Float>(Float(other.root.position.x), Float(other.root.position.z))
            let v = p - me2
            let ahead = simd_dot(v, dir)
            let lateral = abs(v.x * dir.y - v.y * dir.x)
            guard ahead > -0.1, ahead < 1.2, lateral < 0.5 else { continue }
            if other.isWalking, simd_dot(other.forward, dir) > 0.4 {
                // 같은 쪽: 0.6m 간격을 지킨다.
                slow = min(slow, max(0, min(1, (ahead - 0.62) / 0.35)))
            } else if other.isWalking, simd_dot(other.forward, dir) > -0.4, ahead < 0.9 {
                // 길이 엇갈림: 정해진 한 사람만 양보해 늦춘다(둘 다 멈추지 않게).
                // 주인공(나)은 양보하지 않는다. 동료끼리는 정해진 한 사람만.
                let yields = person !== me && (other === me || ObjectIdentifier(person).hashValue < ObjectIdentifier(other).hashValue)
                if yields {
                    slow = min(slow, max(0.05, (ahead - 0.45) / 0.45))
                }
            } else {
                // 마주 오거나 서 있음: 비켜 간다.
                needSide = true
                if ahead < 0.5 { slow = min(slow, 0.5) }
            }
        }
        if needSide {
            // 오른쪽이 벽·가구면 왼쪽으로, 둘 다 막히면 비키지 않고 멈춰 기다린다.
            let right = SIMD2<Float>(-dir.y, dir.x)
            let probe = me2 + dir * 0.4
            let r = probe + right * 0.42, l = probe - right * 0.42
            if isOpenFloor(CGFloat(r.x), CGFloat(r.y), margin: 0.3) { side = 0.42 }
            else if isOpenFloor(CGFloat(l.x), CGFloat(l.y), margin: 0.3) { side = -0.42 }
            else { slow = min(slow, 0.15) }
        }
        return (slow, side)
    }

    // MARK: 의자

    /// 자리의 의자를 밀어 넣거나, 뒤로 빼거나, 제자리에 둔다.
    func setChair(_ key: String, _ pose: ChairPose, animated: Bool = true) {
        guard let chair = stations[key]?.childNode(withName: "chair", recursively: false) else { return }
        let z: CGFloat, turn: CGFloat
        switch pose {
        case .tucked: z = -0.16; turn = 0
        case .normal: z = 0.02 + deskPull(key); turn = 0
        case .out: z = 0.3; turn = key.count % 2 == 0 ? 14 : -14
        }
        let fromZ = chair.position.z, fromTurn = chair.eulerAngles.y
        let toTurn = rad(turn)
        guard animated else {
            chair.position.z = z
            chair.eulerAngles.y = toTurn
            return
        }
        tween(0.4) { t in
            chair.position.z = fromZ + (z - fromZ) * CGFloat(t)
            chair.eulerAngles.y = fromTurn + (toTurn - fromTurn) * CGFloat(t)
        }
    }
}
