import AppKit
import Metal
import OfficeScene
import SceneKit

/// 시간을 실제로 흘려 가며 여러 경우를 찍는다. 사용법: render-shots <폴더> 800x500 scene:<이름>
@MainActor
enum Scenario {
    @MainActor struct Run {
        let stage: OfficeStage
        let renderer: SCNRenderer
        let folder: URL
        let size: CGSize
        let name: String
        var minute: Double
        var frame = 0

        /// 지금까지 본 가장 가까운 두 사람.
        var closest = (99.0, "")
        /// 사람별 1초 전 위치(멈칫 검사).
        var trail: [String: [CGPoint]] = [:]
        var tick = 0

        mutating func advance(_ seconds: Double) {
            var left = seconds
            while left > 0 {
                let dt = min(1.0 / 30, left)
                minute += dt / 60
                stage.setTime(minutes: minute, animated: true)
                stage.update(deltaTime: dt)
                let pair = stage.debugClosestPair
                if pair.0 < closest.0 { closest = pair }
                if pair.0 < 0.3 { print(String(format: "겹침 %.2fm %@ (%.0f분)", pair.0, pair.1, minute)) }
                if let ids = ProcessInfo.processInfo.environment["TRACE"]?.split(separator: ","), ids.count == 2, pair.0 < 0.9,
                   pair.1.hasPrefix("\(ids[0])-\(ids[1])") || pair.1.hasPrefix("\(ids[1])-\(ids[0])") {
                    print(String(format: "추적 %.2fm", pair.0), stage.debugState(String(ids[0])), stage.debugState(String(ids[1])))
                }
                for hit in stage.debugWallHits { print("벽 통과", hit, String(format: "(%.1f분)", minute)) }
                for hit in stage.debugDoorPanelHits { print("문짝 통과", hit, String(format: "(%.1f분)", minute)) }
                tick += 1
                if tick % 3 == 0 {
                    // 걷는 중인데 1초 동안 0.3m도 못 가면 멈칫.
                    var now: [String: [CGPoint]] = [:]
                    for (name, p) in stage.debugWalkers {
                        var list = (trail[name] ?? []) + [p]
                        if list.count > 10 { list.removeFirst(list.count - 10) }
                        if list.count == 10, let first = list.first, hypot(p.x - first.x, p.y - first.y) < 0.3 {
                            print(String(format: "멈칫 %@ (%.2f,%.2f) (%.1f분)", name, Double(p.x), Double(p.y), minute), stage.debugSummary)
                            list.removeAll()
                        }
                        now[name] = list
                    }
                    trail = now
                }
                left -= dt
            }
        }

        mutating func shot(_ note: String = "") throws {
            SCNTransaction.flush()
            let image = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
            if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
               let png = bitmap.representation(using: .png, properties: [:]) {
                try png.write(to: folder.appendingPathComponent(String(format: "%@-%03d.png", name, frame)))
            }
            print(String(format: "%@ %03d %@ · %@", name, frame, note, stage.debugSummary))
            frame += 1
        }

        /// seconds 동안 every 초마다 찍는다.
        mutating func film(_ seconds: Double, every: Double, _ note: String = "") throws {
            var elapsed = 0.0
            while elapsed < seconds - 0.001 {
                advance(every)
                elapsed += every
                try shot(note)
            }
        }
    }

    static func make(_ name: String, device: MTLDevice, folder: URL, size: CGSize, minute: Double) -> Run {
        let stage = OfficeStage(quality: .full)
        let renderer = SCNRenderer(device: device, options: nil)
        renderer.scene = stage.scene
        renderer.pointOfView = stage.cameraNode
        stage.setDay(seed: 2026_11_20)
        stage.setFrontWallRaised(false, animated: false)
        stage.setDoorOpen(true, animated: false)
        stage.setTime(minutes: minute, animated: false)
        stage.setMyDeskActive(true)
        stage.setMyAvatar(.seated)
        stage.setView(.overview, animated: false)
        var run = Run(stage: stage, renderer: renderer, folder: folder, size: size, name: name, minute: minute)
        run.advance(0.5)
        return run
    }

    static func run(_ which: String, device: MTLDevice, folder: URL, size: CGSize) throws {
        let all = ["water", "restroom", "parcel", "snack", "fridge", "microwave", "coffee", "lunch", "errands", "leave", "peerleave", "meeting", "dinnerback", "entrancept", "lunchcrowd", "skip", "report", "errandsall", "mespeed", "metrace", "weekly"]
        for name in all where which == "all" || which.split(separator: ",").contains(Substring(name)) {
            try play(name, device: device, folder: folder, size: size)
        }
    }

    static func play(_ name: String, device: MTLDevice, folder: URL, size: CGSize) throws {
        defer { print("== \(name) 끝") }
        switch name {
        case "water", "fridge", "microwave", "coffee":
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60)
            run.stage.debugCamera(target: SCNVector3(-4.6, 0.7, 1.2), yaw: 62, pitch: 22, distance: 8.5)
            if ProcessInfo.processInfo.environment["CLOSE"] != nil {
                run.stage.debugCamera(target: SCNVector3(-6.2, 0.75, 0.6), yaw: 35, pitch: 12, distance: 4.5)
            }
            let reason = ["water": "물 마시러", "fridge": "냉장고 음료", "microwave": "도시락 데우러", "coffee": "커피 한 잔"][name]!
            run.stage.setMyAvatar(.away(reason: reason))
            try run.film(12, every: 1.0, "가는 중")
            try run.film(8, every: 2.0, "그곳")
            run.stage.setMyAvatar(.seated)
            try run.film(8, every: 1.0, "돌아옴")
        case "restroom":
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60)
            run.stage.debugCamera(target: SCNVector3(4.6, 0.9, -3.2), yaw: -20, pitch: 18, distance: 9)
            if ProcessInfo.processInfo.environment["CLOSE"] != nil {
                run.stage.debugCamera(target: SCNVector3(6.0, 0.7, -4.4), yaw: 0, pitch: 18, distance: 3.2, fov: 34)
            }
            run.stage.setMyAvatar(.away(reason: "화장실 다녀올게요"))
            try run.film(12, every: 1.0, "가는 중")
            try run.film(4, every: 2.0, "안")
            run.stage.setMyAvatar(.seated)
            try run.film(9, every: 1.0, "돌아옴")
        case "parcel":
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60)
            run.stage.debugCamera(target: SCNVector3(-0.5, 0.8, 4.8), yaw: -35, pitch: 20, distance: 8)
            run.stage.setMyAvatar(.away(reason: "택배 받으러"))
            try run.film(14, every: 0.7, "받기")
            run.stage.setMyAvatar(.seated)
            try run.film(7, every: 1.0, "돌아옴")
        case "snack":
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60)
            run.stage.debugCamera(target: SCNVector3(-4.8, 0.7, 2.4), yaw: 40, pitch: 22, distance: 8.5)
            run.stage.setMyAvatar(.away(reason: "간식 먹으러"))
            try run.film(14, every: 1.0, "가는 중")
            try run.film(6, every: 1.5, "먹기")
            run.stage.setMyAvatar(.seated)
            try run.film(8, every: 1.0, "돌아옴")
        case "lunch":
            var run = make(name, device: device, folder: folder, size: size, minute: 12 * 60)
            run.stage.debugCamera(target: SCNVector3(-0.3, 0.8, 4.0), yaw: -30, pitch: 24, distance: 10)
            run.stage.setMyAvatar(.lunch)
            try run.film(8, every: 1.0, "나감")
            run.stage.setMyAvatar(.seated)
            try run.film(8, every: 1.0, "들어옴")
        case "errands":
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60)
            for index in 0..<3 { run.stage.debugErrandNow(index) }
            run.advance(0.1)
            try run.film(40, every: 2.5, "동료 외출")
        case "leave":
            var run = make(name, device: device, folder: folder, size: size, minute: 18 * 60 + 20)
            run.advance(2)
            run.stage.setMyDeskActive(false)
            run.stage.setMyAvatar(.off)
            run.stage.setView(.spot(.myDesk), animated: true)
            try run.film(24, every: 1.0, "퇴근")
        case "peerleave":
            // 18:00부터 12분. 누가 움직일 때만 찍는다.
            var run = make(name, device: device, folder: folder, size: size, minute: 18 * 60)
            for _ in 0..<480 {
                run.advance(1.5)
                if run.stage.isPlayingFilm { try run.shot("동료 퇴근") }
            }
        case "dinnerback":
            // 야근하는 사람이 저녁을 먹고 19시에 돌아온다.
            var run = make(name, device: device, folder: folder, size: size, minute: 19 * 60 + 0.5)
            // 야근하는 사람이 있는 날을 고른다.
            var seed = 2026_11_20
            while run.stage.debugWorkingCount(at: 19 * 60 + 30) < 2 { seed += 1; run.stage.setDay(seed: seed) }
            run.stage.setTime(minutes: 19 * 60 + 0.5, animated: false)
            print("날 \(seed)")
            for _ in 0..<60 {
                run.advance(2)
                if run.stage.debugSummary.contains("walk") { try run.shot("복귀") }
            }
            print(run.stage.debugSummary)
        case "entrancept":
            // 출근 입장 도중 앱이 아침 PT 발표로 바꾸면, 입장이 끝난 뒤 회의실로 가야 한다. 확정 뒤에는 자리로.
            var run = make(name, device: device, folder: folder, size: size, minute: 8 * 60 + 58)
            run.stage.setMyAvatar(.outside)
            run.stage.setFrontWallRaised(true, animated: false)
            run.stage.setDoorOpen(false, animated: false)
            run.stage.playEntrance()
            run.stage.setMeeting(true, animated: true)
            run.stage.setMyAvatar(.presenting)
            // 실제 앱처럼 상사들이 모두 앉고 발표가 시작된 뒤에 끝낸다(말하기·확정에 적어도 수십 초가 걸린다).
            try run.film(45, every: 2, "입장→발표")
            run.stage.setMeeting(false, animated: true)
            run.stage.setMyAvatar(.seated)
            try run.film(16, every: 2, "확정→자리")
        case "lunchcrowd":
            // 동료들이 12시 조금 넘어 점심 먹으러 나가고 1시 조금 전에 돌아온다.
            var run = make(name, device: device, folder: folder, size: size, minute: 12 * 60)
            for _ in 0..<200 {
                run.advance(2)
                if run.stage.debugSummary.contains("walk") { try run.shot("점심 나감") }
            }
            run.minute = 12 * 60 + 51
            run.stage.setTime(minutes: run.minute, animated: false)
            for _ in 0..<300 {
                run.advance(2)
                if run.stage.debugSummary.contains("walk") { try run.shot("점심 복귀") }
            }
            print(run.stage.debugSummary)
        case "skip":
            // '+1시간': 11:58 → 12:58(점심 나갔다 돌아오는 사이를 건너뜀), 17:58 → 18:58(퇴근·저녁 외출을 건너뜀).
            let jumps: [(Double, Double)] = [(718, 778), (1078, 1138)]
            for (from, to) in jumps {
                var run = make(name, device: device, folder: folder, size: size, minute: from)
                run.advance(1)
                run.minute = to
                run.stage.setTime(minutes: to, animated: true)
                try run.film(3, every: 0.5, "건너뜀")
                print(run.stage.debugSummary)
            }
        case "report":
            // 동기가 대리에게, 과장이 팀장에게 서류를 들고 보고한다.
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60 + 20)
            run.stage.debugCamera(target: SCNVector3(1.6, 0.8, 0.2), yaw: 150, pitch: 26, distance: 8)
            print("보고 시작", run.stage.debugReport("peerA"), run.stage.debugReport("kwajang"))
            try run.film(26, every: 1.0, "보고")
            run.stage.debugReleaseCamera()
            print("부장 보고", run.stage.debugReport("manager"))
            run.stage.debugCamera(target: SCNVector3(2.4, 0.7, -2.2), yaw: -30, pitch: 28, distance: 10)
            try run.film(30, every: 1.5, "팀장→부장")
        case "errandsall":
            // 모든 동료에게 잠깐 외출을 여러 번 시킨다(10:00~10:20).
            var run = make(name, device: device, folder: folder, size: size, minute: 10 * 60)
            for round in 0..<8 {
                for index in 0..<7 { run.stage.debugErrandNow(index + round) }
                run.advance(75)
            }
            print(run.stage.debugSummary)
        case "weekly":
            // 금요일 주간 회의: 부장·팀장만 회의실에 앉고 나는 화면 옆에서 보고한다.
            var run = make(name, device: device, folder: folder, size: size, minute: 16 * 60)
            if ProcessInfo.processInfo.environment["CLOSE"] != nil {
                run.stage.debugCamera(target: SCNVector3(-4.4, 0.6, -2.9), yaw: 24, pitch: 42, distance: 9.5)
            }
            run.stage.setWeeklyMeeting(true, animated: true)
            run.stage.setMyAvatar(.presenting)
            try run.film(40, every: 1.0, "주간 회의로")
            run.stage.setWeeklyMeeting(false, animated: true)
            run.stage.setMyAvatar(.seated)
            try run.film(25, every: 1.0, "자리로")
            print(run.stage.debugSummary)
        case "metrace":
            // 출근 입장 → 아침 PT 발표: 내 위치·동작을 0.5초마다.
            var run = make(name, device: device, folder: folder, size: size, minute: 8 * 60 + 58)
            run.stage.setMyAvatar(.outside)
            run.stage.setFrontWallRaised(true, animated: false)
            run.stage.setDoorOpen(false, animated: false)
            run.stage.playEntrance()
            run.stage.setMeeting(true, animated: true)
            run.stage.setMyAvatar(.presenting)
            for i in 0..<70 {
                run.advance(0.5)
                print(String(format: "%.1f초", Double(i + 1) * 0.5), run.stage.debugSummary.components(separatedBy: " | ").first ?? "")
            }
        case "mespeed":
            // 아침 PT 발표하러 회의실에 갈 때 내 걸음 속도를 0.2초마다 잰다(버벅임 확인).
            var run = make(name, device: device, folder: folder, size: size, minute: 9 * 60 + 1)
            run.stage.setMeeting(true, animated: true)
            run.stage.setMyAvatar(.presenting)
            var last = run.stage.debugMePosition
            var line = ""
            for _ in 0..<110 {
                run.advance(0.2)
                let p = run.stage.debugMePosition
                let speed = hypot(p.x - last.x, p.y - last.y) / 0.2
                line += String(format: "%.2f(%.1f,%.1f) ", speed, p.x, p.y)
                last = p
            }
            print(line)
        case "meeting":
            var run = make(name, device: device, folder: folder, size: size, minute: 9 * 60 + 2)
            if ProcessInfo.processInfo.environment["CLOSE"] != nil {
                run.stage.debugCamera(target: SCNVector3(-4.4, 0.6, -2.9), yaw: 24, pitch: 42, distance: 9.5)
            }
            run.stage.setMeeting(true, animated: true)
            run.stage.setMyAvatar(.presenting)
            try run.film(40, every: 0.5, "회의실로")
            run.stage.setView(.spot(.meeting), animated: false)
            try run.shot("회의 중")
            run.stage.setView(.overview, animated: false)
            run.stage.setMeeting(false, animated: true)
            run.stage.setMyAvatar(.seated)
            try run.film(16, every: 0.5, "자리로")
        default:
            print("모르는 장면: \(name)")
        }
    }
}
