import AppKit
import Metal
import OfficeScene
import SceneKit

/// 시연 영상에 붙일 3D 사무실 디테일 장면을 초당 30장으로 뽑는다(자막은 그림에 직접 그린다).
/// 사용법: render-shots <폴더> 1920x1190 movie
/// 결과: <폴더>/m-00000.jpg … 를 ffmpeg로 묶는다.
/// 0xRRGGBB 색.
private func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

@MainActor
enum Movie {
    @MainActor struct Recorder {
        let device: MTLDevice
        let folder: URL
        let size: CGSize
        var frame = 0

        /// 한 장면: 새 사무실에서 시작해 seconds 초 동안 매 프레임 찍는다.
        mutating func scene(minute: Double, caption: String, seconds: Double,
                            setup: (OfficeStage) -> Void, events: [(Double, (OfficeStage) -> Void)] = [],
                            skipUntil: ((OfficeStage) -> Bool)? = nil) throws {
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
            var clock = 0.0, now = minute
            func step() {
                now += 1.0 / 30 / 60
                stage.setTime(minutes: now, animated: true)
                stage.update(deltaTime: 1.0 / 30)
                clock += 1.0 / 30
            }
            for _ in 0..<15 { step() }
            setup(stage)
            // 기다릴 조건이 있으면(예: 동료가 퇴근을 시작할 때까지) 찍지 않고 시간만 보낸다.
            if let skipUntil {
                var guardCount = 0
                while !skipUntil(stage), guardCount < 30 * 60 * 15 { step(); guardCount += 1 }
            }
            var pending = events.sorted { $0.0 < $1.0 }
            let total = Int(seconds * 30)
            for index in 0..<total {
                let t = Double(index) / 30
                while let first = pending.first, first.0 <= t {
                    first.1(stage)
                    pending.removeFirst()
                }
                step()
                SCNTransaction.flush()
                // 한 장마다 임시 메모리를 비운다. 안 비우면 수천 장에서 메모리가 차 강제 종료된다(137).
                try autoreleasepool {
                    let image = renderer.snapshot(atTime: clock, with: size, antialiasingMode: .multisampling4X)
                    try write(image, caption: caption)
                }
            }
            print(String(format: "장면 %@ · %d장", caption, total))
        }

        /// 제목 카드.
        mutating func title(_ text: String, sub: String, seconds: Double) throws {
            let image = NSImage(size: size)
            image.lockFocus()
            rgb(0xF3EEE3).setFill()
            NSRect(origin: .zero, size: size).fill()
            let style = NSMutableParagraphStyle()
            style.alignment = .center
            (text as NSString).draw(in: NSRect(x: 0, y: size.height / 2 - 10, width: size.width, height: 90),
                                    withAttributes: [.font: NSFont.systemFont(ofSize: 64, weight: .bold),
                                                     .foregroundColor: rgb(0x1F5A45), .paragraphStyle: style])
            (sub as NSString).draw(in: NSRect(x: 0, y: size.height / 2 - 80, width: size.width, height: 60),
                                   withAttributes: [.font: NSFont.systemFont(ofSize: 30, weight: .medium),
                                                    .foregroundColor: rgb(0x4A4F52), .paragraphStyle: style])
            image.unlockFocus()
            for _ in 0..<Int(seconds * 30) { try autoreleasepool { try save(image) } }
        }

        private mutating func write(_ image: NSImage, caption: String) throws {
            let framed = NSImage(size: size)
            framed.lockFocus()
            image.draw(in: NSRect(origin: .zero, size: size))
            // 앱 자막과 같은 모양: 아래 가운데 어두운 알약 안에 흰 글자.
            let font = NSFont.systemFont(ofSize: 30, weight: .semibold)
            let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]
            let textSize = (caption as NSString).size(withAttributes: attributes)
            let pill = NSRect(x: (size.width - textSize.width) / 2 - 28, y: 46, width: textSize.width + 56, height: textSize.height + 24)
            rgb(0x1C2621, 0.82).setFill()
            NSBezierPath(roundedRect: pill, xRadius: pill.height / 2, yRadius: pill.height / 2).fill()
            (caption as NSString).draw(at: NSPoint(x: pill.minX + 28, y: pill.minY + 12), withAttributes: attributes)
            framed.unlockFocus()
            try save(framed)
        }

        private mutating func save(_ image: NSImage) throws {
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let jpg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.9]) else { return }
            try jpg.write(to: folder.appendingPathComponent(String(format: "m-%05d.jpg", frame)))
            frame += 1
        }
    }

    static func render(device: MTLDevice, folder: URL, size: CGSize) throws {
        var r = Recorder(device: device, folder: folder, size: size)
        try r.title("가까이 보는 사무실의 하루", sub: "나를 뺀 모두가 AI인 동료들이 스스로 움직입니다", seconds: 2.5)

        // 0. 아침 PT 모임
        try r.scene(minute: 9 * 60 + 1, caption: "아침 PT: 부장·팀장·과장·대리가 차례로 앉고, 나는 문 옆에서 기다렸다 발표합니다", seconds: 30, setup: { stage in
            stage.debugCamera(target: SCNVector3(-3.8, 0.8, -1.9), yaw: 26, pitch: 34, distance: 9.5, fov: 24)
            stage.setMeeting(true, animated: true)
            stage.setMyAvatar(.presenting)
        })
        // 1. 정수기
        try r.scene(minute: 10 * 60, caption: "자리 비움 '물': 정수기에서 받아 돌아서서 마십니다", seconds: 15, setup: { stage in
            stage.debugCamera(target: SCNVector3(-5.4, 0.75, 2.6), yaw: 58, pitch: 22, distance: 6.5, fov: 24)
            stage.setMyAvatar(.away(reason: "물 가지러 자리 비웁니다"))
        })
        // 2. 택배
        try r.scene(minute: 10 * 60, caption: "택배: 기사가 오면 자동문 앞에서 받아 자리에서 뜯습니다", seconds: 20, setup: { stage in
            stage.debugCamera(target: SCNVector3(-0.6, 0.8, 4.0), yaw: -32, pitch: 22, distance: 8, fov: 24)
            stage.setMyAvatar(.away(reason: "택배 받으러 잠깐 나갑니다"))
        })
        // 3. 화장실
        try r.scene(minute: 10 * 60, caption: "화장실: 문을 열고 들어가 닫고, 나올 때 다시 열고 닫습니다", seconds: 20, setup: { stage in
            stage.debugCamera(target: SCNVector3(5.2, 0.9, -2.4), yaw: -20, pitch: 24, distance: 8, fov: 24)
            stage.setMyAvatar(.away(reason: "화장실 다녀올게요"))
        }, events: [(13, { $0.setMyAvatar(.seated) })])
        // 4. 탕비실 간식
        try r.scene(minute: 10 * 60, caption: "탕비실: 과자를 집어 걸상에 앉아 먹습니다", seconds: 18, setup: { stage in
            stage.debugCamera(target: SCNVector3(-5.2, 0.6, 1.8), yaw: 48, pitch: 32, distance: 6.5, fov: 24)
            stage.setMyAvatar(.away(reason: "간식 먹으러"))
        })
        // 5. 보고와 피드백
        try r.scene(minute: 10 * 60 + 20, caption: "보고: 동기가 서류를 들고 대리에게 가서 피드백을 받습니다", seconds: 17, setup: { stage in
            stage.debugCamera(target: SCNVector3(0.9, 0.8, 0.4), yaw: 150, pitch: 24, distance: 6.5, fov: 24)
            stage.debugReport("peerA")
        })
        try r.scene(minute: 10 * 60 + 20, caption: "보고: 팀장이 부장에게 보고하고 지시를 받습니다", seconds: 17, setup: { stage in
            stage.debugCamera(target: SCNVector3(2.6, 0.8, -2.6), yaw: -28, pitch: 24, distance: 7.5, fov: 24)
            stage.debugReport("manager")
        })
        // 5-1. 금요일 주간 회의
        try r.scene(minute: 16 * 60, caption: "금요일 주간 회의: 부장·팀장 앞에서 이번 주를 보고합니다", seconds: 34, setup: { stage in
            stage.debugCamera(target: SCNVector3(-4.4, 0.6, -2.9), yaw: 24, pitch: 40, distance: 9.5, fov: 24)
            stage.setWeeklyMeeting(true, animated: true)
            stage.setMyAvatar(.presenting)
        })
        // 6. 내 퇴근
        try r.scene(minute: 18 * 60 + 0.3, caption: "퇴근: 짐을 챙기고 문으로 나가 손을 흔듭니다", seconds: 21, setup: { stage in
            stage.setMyDeskActive(false)
            stage.setMyAvatar(.off)
        })
        // 7. 동료 퇴근(화면이 비어 있을 때만 카메라가 따라간다)
        try r.scene(minute: 18 * 60, caption: "동료도 그날 일정대로 짐을 챙겨 퇴근합니다", seconds: 16, setup: { _ in },
                    skipUntil: { $0.isPlayingFilm })
        try r.title("끝", sub: "AI 상사 가상회사", seconds: 1.5)
        print("영상 장면 \(r.frame)장")
    }
}
