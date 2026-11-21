import AppKit
import Metal
import OfficeScene
import SceneKit

/// 편의시설 모델 확인용. 한 줄로 세운 전체(정면·위 35도, 문 닫힘·열림)와 모델별 가까운 컷을 뽑는다.
@MainActor
enum AmenityPreview {
    static func render(device: MTLDevice, size: CGSize, to folder: URL) throws {
        var shots: [(String, SCNScene, SCNNode)] = []
        for (name, pitch, open) in [("amenity-front", 8.0, false), ("amenity-above", 35.0, false), ("amenity-open", 35.0, true)] {
            let built = AmenityShowcase.make(angle: 0, pitch: CGFloat(pitch), open: open)
            shots.append((name, built.scene, built.camera))
        }
        let names = ["purifier", "fridge", "pantry", "table", "restroom", "snacks"]
        for (index, name) in names.enumerated() {
            let built = AmenityShowcase.closeUp(index: index, open: name == "fridge" || name == "restroom" || name == "pantry")
            shots.append(("amenity-\(index)-\(name)", built.scene, built.camera))
        }
        for (name, scene, camera) in shots {
            let renderer = SCNRenderer(device: device, options: nil)
            renderer.scene = scene
            renderer.pointOfView = camera
            let image = renderer.snapshot(atTime: 0, with: size, antialiasingMode: .multisampling4X)
            guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else { continue }
            try png.write(to: folder.appendingPathComponent("\(name).png"))
            print(name)
        }
    }
}
