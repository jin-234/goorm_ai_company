import AppKit
import Metal
import OfficeScene
import SceneKit

/// 사무실 장면을 창 없이 그림 파일로 뽑는다.
///
/// 사용법: render-shots <출력 폴더> [가로x세로] [이름 일부]
/// 예:     render-shots docs/shots 1600x1000 overview
@main
@MainActor
struct RenderShots {
    struct Shot {
        var name: String
        var minute: Double
        var view: OfficeView
        var beforeCheckIn = false
        var deskActive = true
        var avatar: MyAvatar? = nil
    }

    static let shots: [Shot] = [
        // 기획서의 첫 디자인 시안: 같은 사무실, 같은 구도, 09:00과 20:00.
        Shot(name: "overview-0900", minute: 9 * 60, view: .overview),
        Shot(name: "overview-2000", minute: 20 * 60, view: .overview),
        Shot(name: "overview-1230", minute: 12 * 60 + 30, view: .overview),
        Shot(name: "overview-1800", minute: 18 * 60, view: .overview),
        Shot(name: "overview-1900", minute: 19 * 60, view: .overview),
        Shot(name: "door-0855", minute: 8 * 60 + 55, view: .door, beforeCheckIn: true, deskActive: false),
        Shot(name: "door-2200", minute: 22 * 60, view: .door),
        Shot(name: "overview-1530", minute: 15 * 60 + 30, view: .overview),
        Shot(name: "spot-mydesk-1030", minute: 10 * 60 + 30, view: .spot(.myDesk)),
        Shot(name: "spot-manager-1030", minute: 10 * 60 + 30, view: .spot(.manager)),
        Shot(name: "spot-meeting-0900", minute: 9 * 60, view: .spot(.meeting)),
        Shot(name: "people-mydesk-1030", minute: 10 * 60 + 30, view: .people),
        Shot(name: "people-door-0855", minute: 8 * 60 + 55, view: .door, beforeCheckIn: true, deskActive: false),
        Shot(name: "people-pack-1810", minute: 18 * 60 + 10, view: .overview),
        Shot(name: "people-lunch-1230", minute: 12 * 60 + 30, view: .spot(.myDesk), avatar: .lunch),
        Shot(name: "people-away-1400", minute: 14 * 60, view: .overview, avatar: .away(reason: "물 가지러 자리 비웁니다")),
    ]

    static func main() throws {
        let arguments = CommandLine.arguments
        guard arguments.count >= 2 else {
            print("사용법: render-shots <출력 폴더> [가로x세로] [이름 일부]")
            exit(2)
        }
        let outputFolder = URL(fileURLWithPath: arguments[1])
        var size = CGSize(width: 1600, height: 1000)
        if arguments.count >= 3 {
            let parts = arguments[2].split(separator: "x").compactMap { Double($0) }
            if parts.count == 2 { size = CGSize(width: parts[0], height: parts[1]) }
        }
        let filter = arguments.count >= 4 ? arguments[3] : nil

        guard let device = MTLCreateSystemDefaultDevice() else {
            print("Metal 장치를 찾지 못했습니다.")
            exit(1)
        }
        try FileManager.default.createDirectory(at: outputFolder, withIntermediateDirectories: true)

        // OFFICE_QUALITY=light 로 느린 맥용 품질을 확인할 수 있다.
        let quality = ProcessInfo.processInfo.environment["OFFICE_QUALITY"].flatMap(StageQuality.init(rawValue:)) ?? .full
        let stage = OfficeStage(quality: quality)
        let renderer = SCNRenderer(device: device, options: nil)
        renderer.scene = stage.scene
        renderer.pointOfView = stage.cameraNode

        // 캐릭터 확인용: 정면 눈높이, 위에서 35도, 뒤에서 35도.
        for (name, angle, pitch) in [("lineup-front", 0.0, 12.0), ("lineup-above", 0.0, 35.0), ("lineup-back", 180.0, 35.0)]
            where filter == nil || name.contains(filter ?? "") {
            let lineup = Lineup.make(angle: CGFloat(angle), pitch: CGFloat(pitch))
            let lineupRenderer = SCNRenderer(device: device, options: nil)
            lineupRenderer.scene = lineup.scene
            lineupRenderer.pointOfView = lineup.camera
            let image = lineupRenderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
            if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
               let png = bitmap.representation(using: .png, properties: [:]) {
                try png.write(to: outputFolder.appendingPathComponent("\(name).png"))
                print(name)
            }
        }

        // 자리 비움 사유별 목적지: 자리에서 걸어가 도착한 모습(12초 뒤).
        if let filter, filter.contains("goto") {
            let reasons = ["물 가지러 자리 비웁니다", "냉장고에서 음료 꺼내기", "도시락 데우러 전자레인지", "간식 먹고 올게요",
                           "화장실 다녀오겠습니다", "커피 한 잔", "택배를 받으러 갑니다", "엄마 전화 통화", "허리 스트레칭"]
            for (index, reason) in reasons.enumerated() {
                let stage = OfficeStage(quality: quality)
                let renderer = SCNRenderer(device: device, options: nil)
                renderer.scene = stage.scene
                renderer.pointOfView = stage.cameraNode
                stage.setFrontWallRaised(false, animated: false)
                stage.setDoorOpen(true, animated: false)
                stage.setTime(minutes: 10 * 60 + 30, animated: false)
                stage.setMyAvatar(.seated)
                stage.setView(.overview, animated: false)
                stage.update(deltaTime: 1.0 / 30)
                stage.setMyAvatar(.away(reason: reason))
                for _ in 0..<(30 * 14) { stage.update(deltaTime: 1.0 / 30) }
                SCNTransaction.flush()
                let image = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
                if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                   let png = bitmap.representation(using: .png, properties: [:]) {
                    try png.write(to: outputFolder.appendingPathComponent(String(format: "goto-%02d.png", index)))
                }
                print("goto \(index) \(reason)")
            }
            return
        }

        // 시연 영상용 3D 디테일 장면.
        if filter == "movie" {
            try Movie.render(device: device, folder: outputFolder, size: size)
            return
        }

        // 모든 시간대 조명 점검.
        if let filter, filter.hasPrefix("sweep") {
            try Sweep.render(String(filter.dropFirst("sweep".count).drop { $0 == ":" }), device: device, folder: outputFolder, size: size)
            return
        }

        // 시간을 흘려 가며 여러 경우 확인.
        if let filter, filter.hasPrefix("scene:") {
            try Scenario.run(String(filter.dropFirst("scene:".count)), device: device, folder: outputFolder, size: size)
            return
        }

        // 편의시설 모델 확인(옆 세션 담당 AmenityPreview).
        if let filter, filter.contains("amenity") {
            try AmenityPreview.render(device: device, size: size, to: outputFolder)
            return
        }

        // 퇴근 장면: 2026-11-20(금) 18:01:50부터 1.5초마다. 팀장·박서윤 퇴근, 이하준 야근.
        if let filter, filter.contains("leave") {
            let leave = OfficeStage(quality: quality)
            let leaveRenderer = SCNRenderer(device: device, options: nil)
            leaveRenderer.scene = leave.scene
            leaveRenderer.pointOfView = leave.cameraNode
            leave.setDay(seed: 2026 * 10_000 + 11 * 100 + 20)
            leave.setFrontWallRaised(false, animated: false)
            leave.setDoorOpen(true, animated: false)
            leave.setMyAvatar(.off)
            leave.setTime(minutes: 18 * 60 + 2 + 5.0 / 60, animated: false)
            leave.setView(.overview, animated: false)
            var minute = 18 * 60 + 2 + 5.0 / 60
            for index in 0..<16 {
                for _ in 0..<36 {
                    minute += 1.0 / 30 / 60
                    leave.setTime(minutes: minute, animated: false)
                    leave.update(deltaTime: 1.0 / 30)
                }
                SCNTransaction.flush()
                let image = leaveRenderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
                if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                   let png = bitmap.representation(using: .png, properties: [:]) {
                    try png.write(to: outputFolder.appendingPathComponent(String(format: "leave-%02d.png", index)))
                }
            }
            print("leave 완료")
        }

        // 입장 장면: 출근 버튼을 누른 뒤 0.5초, 2초, 4초, 6초, 9초.
        if filter == nil || "entrance".contains(filter ?? "") || (filter ?? "").contains("entrance") {
            let entrance = OfficeStage(quality: quality)
            let entranceRenderer = SCNRenderer(device: device, options: nil)
            entranceRenderer.scene = entrance.scene
            entranceRenderer.pointOfView = entrance.cameraNode
            entrance.setTime(minutes: 8 * 60 + 58, animated: false)
            entrance.setFrontWallRaised(true, animated: false)
            entrance.setDoorOpen(false, animated: false)
            entrance.setMyAvatar(.outside)
            entrance.setView(.door, animated: false)
            SCNTransaction.flush()
            entrance.playEntrance()
            var elapsed = 0.0
            for mark in [0.5, 2.0, 4.0, 6.0, 9.0] {
                while elapsed < mark {
                    entrance.update(deltaTime: 1.0 / 30)
                    elapsed += 1.0 / 30
                }
                SCNTransaction.flush()
                let image = entranceRenderer.snapshot(atTime: elapsed, with: size, antialiasingMode: .multisampling4X)
                if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                   let png = bitmap.representation(using: .png, properties: [:]) {
                    try png.write(to: outputFolder.appendingPathComponent(String(format: "entrance-%04.1f.png", mark)))
                    print(String(format: "entrance %.1f초 · 입장 중 %@", mark, entrance.isPlayingEntrance ? "예" : "아니오"))
                }
            }
        }

        for shot in shots where filter == nil || shot.name.contains(filter ?? "") {
            stage.setTime(minutes: shot.minute, animated: false)
            stage.setFrontWallRaised(shot.beforeCheckIn, animated: false)
            stage.setDoorOpen(!shot.beforeCheckIn, animated: false)
            stage.setMyDeskActive(shot.deskActive)
            stage.setChecklist(shot.deskActive ? [(3, true), (2, false), (1, false)] : [])
            stage.setMyAvatar(shot.avatar ?? (shot.beforeCheckIn ? .outside : .seated))
            stage.setView(shot.view, animated: false)
            stage.pose(at: 9.2)
            SCNTransaction.flush()

            let started = Date()
            let image = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                print("그림 변환 실패: \(shot.name)")
                continue
            }
            try png.write(to: outputFolder.appendingPathComponent("\(shot.name).png"))
            print(String(format: "%@ · %.2f초", shot.name, Date().timeIntervalSince(started)))
        }
    }
}
