import AppKit
import SceneKit

/// 캐릭터 확인용 장면. 네 사람을 나란히 세워 얼굴과 실루엣을 본다(그림 뽑기 전용).
@MainActor
public enum Lineup {
    public static func make(angle: CGFloat = 0, pitch: CGFloat = 12) -> (scene: SCNScene, camera: SCNNode) {
        let scene = SCNScene()
        scene.background.contents = NSColor(hex: 0xEFE7D6)
        let floor = Shape.box(8, 0.1, 6, round: 0, Mat.matte(Palette.oak, roughness: 0.7))
        floor.position = SCNVector3(0, -0.05, 0)
        scene.rootNode.addChildNode(floor)

        // 조직도 순서(부장, 팀장, 과장, 대리, 선배, 동기 둘, 나)와 택배 기사.
        let ids = ["director", "manager", "kwajang", "daeri", "senior", "peerA", "peerB", "me"]
        let people = ids.map { Crew.make($0) } + [Crew.courier()]
        for (index, person) in people.enumerated() {
            person.root.position = SCNVector3(CGFloat(index) * 0.62 - CGFloat(people.count - 1) * 0.31, 0, 0)
            person.face(180 + angle)
            person.setActivity(.stand)
            person.animate(time: 1.3)
            person.animate(time: 1.31)
            scene.rootNode.addChildNode(person.root)
        }

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .directional
        key.light?.intensity = 1300
        key.light?.castsShadow = true
        key.light?.shadowRadius = 4
        key.light?.shadowSampleCount = 16
        key.position = SCNVector3(-3, 6, 5)
        key.look(at: SCNVector3(0, 0.5, 0))
        scene.rootNode.addChildNode(key)
        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.intensity = 420
        ambient.light?.color = NSColor(hex: 0xFFF4E2)
        scene.rootNode.addChildNode(ambient)
        scene.lightingEnvironment.contents = Textures.environment(top: .white, bottom: NSColor(hex: 0xC9C2B4))
        scene.lightingEnvironment.intensity = 0.5

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 24
        camera.camera?.wantsHDR = true
        camera.camera?.exposureOffset = 0.3
        camera.camera?.whitePoint = 1.5
        let distance: CGFloat = 13
        let p = rad(pitch)
        camera.position = SCNVector3(0, 0.6 + distance * sin(p), distance * cos(p))
        camera.look(at: SCNVector3(0, 0.6, 0))
        scene.rootNode.addChildNode(camera)
        return (scene, camera)
    }
}
