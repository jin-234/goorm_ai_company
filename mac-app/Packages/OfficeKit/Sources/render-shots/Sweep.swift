import AppKit
import Metal
import OfficeScene
import SceneKit

/// 모든 시간대 조명 점검: 여러 시각 × 여러 구도를 찍는다.
/// 사용법: render-shots <폴더> 800x500 sweep[:시각,시각]  (시각은 0630 꼴)
@MainActor
enum Sweep {
    struct Angle {
        var name: String
        var view: OfficeView?
        var camera: (SCNVector3, CGFloat, CGFloat, CGFloat)?
    }

    static let angles: [Angle] = [
        Angle(name: "overview", view: .overview),
        Angle(name: "door", view: .door),
        Angle(name: "mydesk", view: .spot(.myDesk)),
        Angle(name: "manager", view: .spot(.manager)),
        Angle(name: "meeting", view: .spot(.meeting)),
        Angle(name: "pantry", camera: (SCNVector3(-5.2, 0.6, 1.8), 48, 32, 6.5)),
        Angle(name: "restroom", camera: (SCNVector3(5.2, 0.9, -2.4), -20, 24, 8)),
        Angle(name: "backwall", camera: (SCNVector3(2.0, 0.95, -4.8), -20, 18, 2.6)),
        Angle(name: "entrance", camera: (SCNVector3(-0.6, 0.8, 4.0), -32, 22, 8)),
    ]

    static func render(_ spec: String, device: MTLDevice, folder: URL, size: CGSize) throws {
        var minutes: [Double] = [390, 480, 540, 630, 750, 870, 960, 1020, 1080, 1110, 1140, 1200, 1290, 1380]
        if !spec.isEmpty {
            minutes = spec.split(separator: ",").compactMap { Double($0) }.map { floor($0 / 100) * 60 + $0.truncatingRemainder(dividingBy: 100) }
        }
        let only = ProcessInfo.processInfo.environment["SWEEP_ANGLES"]?.split(separator: ",").map(String.init)
        for minute in minutes {
            let stage = OfficeStage(quality: ProcessInfo.processInfo.environment["OFFICE_QUALITY"].flatMap(StageQuality.init(rawValue:)) ?? .full)
            let renderer = SCNRenderer(device: device, options: nil)
            renderer.scene = stage.scene
            renderer.pointOfView = stage.cameraNode
            stage.setDay(seed: 2026_11_20)
            stage.setFrontWallRaised(false, animated: false)
            stage.setDoorOpen(true, animated: false)
            stage.setTime(minutes: minute, animated: false)
            stage.setMyDeskActive(true)
            stage.setMyAvatar(minute < 9 * 60 || minute >= 18 * 60 + 30 && minute < 19 * 60 ? .off : .seated)
            stage.setView(.overview, animated: false)
            for _ in 0..<60 { stage.update(deltaTime: 1.0 / 30) }
            for angle in angles where only == nil || only!.contains(angle.name) {
                if let view = angle.view {
                    stage.setView(view, animated: false)
                } else if let c = angle.camera {
                    stage.debugCamera(target: c.0, yaw: c.1, pitch: c.2, distance: c.3, fov: 24)
                }
                for _ in 0..<3 { stage.update(deltaTime: 1.0 / 30) }
                SCNTransaction.flush()
                let image = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
                let label = String(format: "%02d%02d", Int(minute) / 60, Int(minute) % 60)
                if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                   let png = bitmap.representation(using: .png, properties: [:]) {
                    try png.write(to: folder.appendingPathComponent("\(label)-\(angle.name).png"))
                }
                print(label, angle.name)
            }
        }
    }
}
