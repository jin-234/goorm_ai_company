import AppKit
import SceneKit

/// 사무실 치수. X는 오른쪽, Z는 앞쪽(문 쪽), Y는 위. 단위는 대략 미터.
enum Layout {
    static let halfWidth: CGFloat = 7
    static let halfDepth: CGFloat = 5
    static let wallHeight: CGFloat = 3.0
    static let lowWall: CGFloat = 1.0
    static let thickness: CGFloat = 0.24

    // 오른쪽 벽의 큰 창
    /// 창은 화장실 칸(뒤 오른쪽 구석) 앞에서 시작한다.
    static let windowZ0: CGFloat = -3.15
    static let windowZ1: CGFloat = 3.4
    static let windowY0: CGFloat = 0.95
    static let windowY1: CGFloat = 2.70

    // 앞벽의 출입문
    static let doorX0: CGFloat = -1.5
    static let doorX1: CGFloat = -0.1
    static let doorHeight: CGFloat = 2.25

    // 뒤 왼쪽의 유리 회의실
    static let meetingX0: CGFloat = -7
    static let meetingX1: CGFloat = -2.3
    static let meetingZ0: CGFloat = -5
    static let meetingZ1: CGFloat = -1.2
    /// 회의 탁자 가운데.
    static let meetingCenterX: CGFloat = (meetingX0 + meetingX1) / 2 - 0.1
    static let meetingCenterZ: CGFloat = (meetingZ0 + meetingZ1) / 2 - 0.1

    // 자리. 값은 의자(사람)가 있는 곳.
    // 팀원은 책상을 마주 붙인 섬(한 줄 세 자리, 두 줄)에 앉고, 섬 머리(창 쪽 +X 끝)에 팀장이 팀원을 보고 앉는다.
    // 부장은 뒤쪽 가운데에서 방 전체를 본다.
    /// 섬 가운데 칸막이의 Z.
    static let islandZ: CGFloat = 1.0
    /// 섬 자리의 X. index 0이 팀장에 가장 가깝다.
    static let islandX: [CGFloat] = [1.9, 0.5, -0.9]
    static let islandDeskWidth: CGFloat = 1.4
    static let islandDeskDepth: CGFloat = 0.75
    /// 의자에서 책상 가운데까지.
    static let islandDeskOffset: CGFloat = 0.6
    /// 안쪽 줄(먼 줄, 문 쪽을 보고 앉음).
    static func innerSeat(_ index: Int) -> SCNVector3 {
        SCNVector3(islandX[index], 0, islandZ - islandDeskDepth / 2 - islandDeskOffset)
    }
    /// 바깥쪽 줄(가까운 줄, 뒤쪽을 보고 앉음).
    static func outerSeat(_ index: Int) -> SCNVector3 {
        SCNVector3(islandX[index], 0, islandZ + islandDeskDepth / 2 + islandDeskOffset)
    }
    /// 섬 머리. 팀원 쪽(-X)을 본다.
    static let leaderSeat = SCNVector3(4.2, 0, islandZ)
    /// 부장 자리. 방 쪽(+Z)을 본다.
    static let directorSeat = SCNVector3(1.2, 0, -3.9)
    /// 내 자리. 바깥쪽 줄 문 쪽 끝.
    static let mySeat = outerSeat(2)

    /// 문 바로 밖. 출근 전에 내가 서 있는 곳.
    static let outsideDoor = SCNVector3((doorX0 + doorX1) / 2, 0, halfDepth + 1.15)
    /// 문 안쪽 통로.
    static let insideDoor = SCNVector3((doorX0 + doorX1) / 2, 0, halfDepth - 1.3)

    // 탕비실: 앞 왼쪽 구석의 방. 오른쪽 벽(x = pantryX1)에 출입구가 있다.
    static let pantryX1: CGFloat = -3.7
    static let pantryZ0: CGFloat = 0.2
    /// 탕비실 출입구 가운데 Z(앞 통로와 같은 줄).
    static let pantryDoorZ: CGFloat = 2.85
    static let fridgeZ: CGFloat = 0.75
    static let microwaveZ: CGFloat = 1.75
    static let waterZ: CGFloat = 2.75
    static let coffeeZ: CGFloat = 3.95
    static let snackTable = SCNVector3(-4.9, 0, 1.0)
    /// 탕비실 안 가운데(여기서 각 자리로 간다).
    static let pantryHub = SCNVector3(-5.3, 0, 2.85)
    // 화장실: 뒤 오른쪽 구석의 지붕 있는 칸. 앞벽(z = restroomZ1)에 문.
    static let restroomX0: CGFloat = 5.0
    static let restroomZ1: CGFloat = -3.4
    static let restroomX: CGFloat = 6.0
    /// 사람이 서서 쓰는 곳.

    /// 화면에 보이는 것의 분류값.
    static let visibleCategory = 1
    /// 누르는 영역의 분류값.
    static let hitCategory = 4
}

/// 벽, 바닥, 창, 문.
@MainActor
struct RoomParts {
    let root = SCNNode.group("room")
    /// 문짝. 경첩을 축으로 돈다.
    let doorPivot = SCNNode.group("door.pivot")
    /// 출근 전 실내를 가리는 앞벽 윗부분. 들어온 뒤에는 내려간다.
    let frontUpper = SCNNode.group("wall.frontUpper")
    /// 창밖 하늘판. 시간대에 따라 색을 바꾼다.
    let sky = SCNNode()
    /// 창밖 건물들.
    var buildings: [SCNNode] = []
    /// 건물 창의 불빛.
    var cityLights: [SCNNode] = []
    let terminalScreen: SCNNode
    let signNode: SCNNode
    let glassPanes = SCNNode.group("window.glass")

    init() {
        terminalScreen = Shape.plane(0.30, 0.40, Mat.image(
            Textures.terminal(title: "출근", detail: "카메라 앞에 앉기", checked: false), emissive: true), corner: 0.02)
        signNode = Shape.box(1.9, 0.5, 0.08, round: 0.03, Mat.matte(Palette.green))
        buildFloor()
        buildBackWall()
        buildRightWall()
        buildLeftWall()
        buildFrontWall()
        buildDoor()
        buildOutside()
        buildShadowOnlyCover()
    }

    // MARK: 바닥

    private func buildFloor() {
        let w = Layout.halfWidth * 2 + Layout.thickness * 2
        let l = Layout.halfDepth * 2 + Layout.thickness * 2
        let slab = SCNBox(width: w, height: 0.5, length: l, chamferRadius: 0.03)
        let top = Mat.image(Textures.oakFloor(), roughness: 0.62)
        top.diffuse.wrapS = .repeat
        top.diffuse.wrapT = .repeat
        top.diffuse.contentsTransform = SCNMatrix4MakeScale(6, 4.4, 1)
        let side = Mat.matte(Palette.base)
        // 앞, 오른쪽, 뒤, 왼쪽, 위, 아래
        slab.materials = [side, side, side, side, top, side]
        SCNNode(geometry: slab).at(0, -0.25, 0).named("floor").into(root)

        // 문 밖 복도 조각
        let hall = Shape.box(5.2, 0.5, 2.6, round: 0.03, Mat.matte(NSColor(hex: 0xBFB29C), roughness: 0.75))
        hall.at(Layout.outsideDoor.x + 0.6, -0.27, Layout.halfDepth + Layout.thickness + 1.25).into(root)
        // 현관 매트
        Shape.box(1.5, 0.03, 0.9, round: 0.012, Mat.matte(Palette.greenLight.darker(0.1), roughness: 0.95))
            .at(Layout.outsideDoor.x, 0.0, Layout.halfDepth + 0.95).into(root)
    }

    // MARK: 벽 조각

    private func slab(_ x0: CGFloat, _ x1: CGFloat, _ y0: CGFloat, _ y1: CGFloat, _ z0: CGFloat, _ z1: CGFloat,
                      _ material: SCNMaterial, round: CGFloat = 0.012) -> SCNNode {
        Shape.box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0), round: round, material)
            .at((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    }

    private func buildBackWall() {
        let hw = Layout.halfWidth, hd = Layout.halfDepth, t = Layout.thickness, h = Layout.wallHeight
        let wall = Mat.matte(Palette.cream, roughness: 0.92)
        // 화장실 문 자리는 벽을 뚫어 둔다(문틀이 구멍 가장자리를 덮는다).
        // 화장실은 방 안의 칸으로 옮겨서 뒷벽에 구멍이 없다.
        let holeX0: CGFloat = 99, holeX1: CGFloat = 99, holeTop: CGFloat = 2.1
        func around(_ x0: CGFloat, _ x1: CGFloat, _ y0: CGFloat, _ y1: CGFloat, _ z0: CGFloat, _ z1: CGFloat, _ material: SCNMaterial) {
            guard y0 < holeTop, holeX0 < x1 else {
                slab(x0, x1, y0, y1, z0, z1, material).into(root)
                return
            }
            slab(x0, holeX0, y0, y1, z0, z1, material).into(root)
            slab(holeX1, x1, y0, y1, z0, z1, material).into(root)
            if y1 > holeTop { slab(holeX0, holeX1, holeTop, y1, z0, z1, material).into(root) }
        }
        around(-hw - t, hw + t, 0, h, -hd - t, -hd, wall)
        // 아래 징두리와 몰딩
        around(-hw, hw, 0, 0.92, -hd, -hd + 0.035, Mat.matte(Palette.creamLower, roughness: 0.9))
        around(-hw, hw, 0.92, 0.985, -hd, -hd + 0.06, Mat.matte(Palette.white, roughness: 0.7))
        around(-hw, hw, 0, 0.11, -hd, -hd + 0.075, Mat.matte(Palette.skirting, roughness: 0.8))
        // 윗면
        slab(-hw - t - 0.03, hw + t + 0.03, h, h + 0.06, -hd - t - 0.03, -hd + 0.03, Mat.matte(Palette.wallCap)).into(root)
    }

    private func buildRightWall() {
        let hw = Layout.halfWidth, hd = Layout.halfDepth, t = Layout.thickness, h = Layout.wallHeight
        let z0 = Layout.windowZ0, z1 = Layout.windowZ1, y0 = Layout.windowY0, y1 = Layout.windowY1
        let wall = Mat.matte(Palette.cream, roughness: 0.92)
        // 창 아래, 창 위, 양쪽 기둥
        slab(hw, hw + t, 0, y0, -hd, hd, wall).into(root)
        slab(hw, hw + t, y1, h, -hd, hd, wall).into(root)
        slab(hw, hw + t, y0, y1, -hd, z0, wall).into(root)
        slab(hw, hw + t, y0, y1, z1, hd, wall).into(root)
        slab(hw - 0.035, hw, 0, 0.92, -hd, hd, Mat.matte(Palette.creamLower, roughness: 0.9)).into(root)
        slab(hw - 0.075, hw, 0, 0.11, -hd, hd, Mat.matte(Palette.skirting, roughness: 0.8)).into(root)
        slab(hw - 0.03, hw + t + 0.03, h, h + 0.06, -hd - t - 0.03, hd + t + 0.03, Mat.matte(Palette.wallCap)).into(root)

        // 창틀
        let frame = Mat.satin(Palette.white, roughness: 0.5)
        let depth: CGFloat = t + 0.08
        let fx0 = hw - 0.04
        slab(fx0, fx0 + depth, y0 - 0.06, y0 + 0.05, z0 - 0.06, z1 + 0.06, frame).into(root)
        slab(fx0, fx0 + depth, y1 - 0.05, y1 + 0.06, z0 - 0.06, z1 + 0.06, frame).into(root)
        slab(fx0, fx0 + depth, y0, y1, z0 - 0.06, z0 + 0.05, frame).into(root)
        slab(fx0, fx0 + depth, y0, y1, z1 - 0.05, z1 + 0.06, frame).into(root)
        // 창대. 화분을 올릴 수 있게 안쪽으로 나와 있다.
        slab(hw - 0.26, hw + 0.02, y0 - 0.075, y0 - 0.015, z0 - 0.12, z1 + 0.12, frame, round: 0.02).into(root)
        // 창살: 세로 5개, 가로 1개
        let columns = 6
        for index in 1..<columns {
            let z = z0 + (z1 - z0) * CGFloat(index) / CGFloat(columns)
            slab(hw + 0.07, hw + 0.15, y0, y1, z - 0.035, z + 0.035, frame, round: 0.008).into(root)
        }
        let midY = y0 + (y1 - y0) * 0.56
        slab(hw + 0.07, hw + 0.15, midY - 0.035, midY + 0.035, z0, z1, frame, round: 0.008).into(root)

        // 유리
        let glass = Shape.box(0.02, y1 - y0, z1 - z0, round: 0, Mat.glass(NSColor(hex: 0xEAF6F3), opacity: 0.16))
        glass.at(hw + 0.11, (y0 + y1) / 2, (z0 + z1) / 2).noShadow().into(glassPanes)
        glassPanes.into(root)
    }

    private func buildLeftWall() {
        let hw = Layout.halfWidth, hd = Layout.halfDepth, t = Layout.thickness, low = Layout.lowWall
        let wall = Mat.matte(Palette.cream, roughness: 0.92)
        slab(-hw - t, -hw, 0, low, -hd, hd + t, wall).named("wall.left").into(root)
        slab(-hw - t - 0.03, -hw + 0.03, low, low + 0.06, -hd, hd + t + 0.03, Mat.matte(Palette.wallCap)).into(root)
        slab(-hw, -hw + 0.075, 0, 0.11, -hd, hd, Mat.matte(Palette.skirting, roughness: 0.8)).into(root)
    }

    private func buildFrontWall() {
        let hw = Layout.halfWidth, hd = Layout.halfDepth, t = Layout.thickness, low = Layout.lowWall
        let h = Layout.wallHeight
        let wall = Mat.matte(Palette.cream, roughness: 0.92)
        let cap = Mat.matte(Palette.wallCap)
        let dx0 = Layout.doorX0 - 0.12, dx1 = Layout.doorX1 + 0.12
        // 문 양쪽의 낮은 벽
        slab(-hw, dx0, 0, low, hd, hd + t, wall).named("wall.frontLeft").into(root)
        slab(dx1, hw + t, 0, low, hd, hd + t, wall).named("wall.frontRight").into(root)
        slab(-hw, dx0, low, low + 0.06, hd - 0.03, hd + t + 0.03, cap).into(root)
        slab(dx1, hw + t + 0.03, low, low + 0.06, hd - 0.03, hd + t + 0.03, cap).into(root)
        slab(-hw, dx0, 0, 0.11, hd - 0.075, hd, Mat.matte(Palette.skirting, roughness: 0.8)).into(root)
        slab(dx1, hw, 0, 0.11, hd - 0.075, hd, Mat.matte(Palette.skirting, roughness: 0.8)).into(root)

        // 출근 전에 실내를 가리는 윗부분. 문틀 위쪽까지 덮는다.
        let tall = h + 2.4
        slab(-hw - t, dx0, low + 0.06, tall, hd, hd + t, wall).into(frontUpper)
        slab(dx1, hw + t, low + 0.06, tall, hd, hd + t, wall).into(frontUpper)
        slab(dx0, dx1, Layout.doorHeight + 0.14, tall, hd, hd + t, wall).into(frontUpper)
        // 바깥쪽 징두리 몰딩
        slab(-hw - t, dx0, 0.92, 0.985, hd + t, hd + t + 0.03, Mat.matte(Palette.white, roughness: 0.7)).into(frontUpper)
        slab(dx1, hw + t, 0.92, 0.985, hd + t, hd + t + 0.03, Mat.matte(Palette.white, roughness: 0.7)).into(frontUpper)
        _ = cap
        frontUpper.into(root)
    }

    // MARK: 문

    private func buildDoor() {
        let hd = Layout.halfDepth, t = Layout.thickness
        let x0 = Layout.doorX0, x1 = Layout.doorX1, height = Layout.doorHeight
        let frame = Mat.satin(Palette.white, roughness: 0.5)
        // 문틀
        slab(x0 - 0.12, x0, 0, height + 0.12, hd - 0.04, hd + t + 0.04, frame, round: 0.02).into(root)
        slab(x1, x1 + 0.12, 0, height + 0.12, hd - 0.04, hd + t + 0.04, frame, round: 0.02).into(root)
        slab(x0 - 0.12, x1 + 0.12, height, height + 0.14, hd - 0.04, hd + t + 0.04, frame, round: 0.02).into(root)

        // 간판. 문 위 바깥쪽.
        signNode.at((x0 + x1) / 2, height + 0.52, hd + t + 0.05).into(root)
        let signFace = Shape.plane(1.8, 0.42, Mat.image(Textures.sign("가상회사"), roughness: 0.6))
        signFace.at(0, 0, 0.042).noShadow().into(signNode)
        let signBack = Shape.plane(1.8, 0.42, Mat.image(Textures.sign("가상회사"), roughness: 0.6))
        signBack.at(0, 0, -0.042).turned(y: 180).noShadow().into(signNode)

        // 유리 자동문. 두 짝이 양옆으로 미끄러져 열린다(OfficeStage.updateAutoDoors).
        doorPivot.at(x0, 0, hd + t / 2).into(root)
        let width = x1 - x0
        let rim = Mat.satin(Palette.green, roughness: 0.4)
        let glass = Mat.glass(NSColor(hex: 0xDDEFEA), opacity: 0.22)
        for (name, center) in [("door.left", width / 4), ("door.right", width * 3 / 4)] {
            let panel = SCNNode.group(name).at(center, 0, 0).into(doorPivot)
            let w = width / 2 - 0.02, h = height - 0.04
            Shape.box(w - 0.08, h - 0.08, 0.02, round: 0, glass).at(0, h / 2 + 0.02, 0).noShadow().into(panel)
            for (bw, bh, bx, by) in [(w, 0.05, 0, h), (w, 0.07, 0, 0.055), (0.05, h, -w / 2 + 0.025, h / 2 + 0.02), (0.05, h, w / 2 - 0.025, h / 2 + 0.02)]
                as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
                Shape.box(bw, bh, 0.05, round: 0.012, rim).at(bx, by, 0).into(panel)
            }
            // 손잡이 대신 가운데 세로 띠
            Shape.box(0.012, 0.5, 0.055, round: 0.004, Mat.metal(Palette.brass)).at(name == "door.left" ? w / 2 - 0.06 : -w / 2 + 0.06, 1.05, 0).into(panel)
        }
        // 문 위 감지기
        Shape.box(0.32, 0.08, 0.1, round: 0.02, Mat.satin(Palette.charcoal, roughness: 0.4)).at(width / 2, height - 0.1, -0.12).into(doorPivot)
        Shape.sphere(0.018, Mat.glow(NSColor(hex: 0x7DE3B0), strength: 1.2)).at(width / 2 + 0.1, height - 0.11, -0.175).noShadow().into(doorPivot)
    }

    // MARK: 문 밖

    private func buildOutside() {
        let hd = Layout.halfDepth, t = Layout.thickness
        // 출근 단말기. 문 오른쪽 벽에 붙어 있다.
        let terminal = SCNNode.group("terminal")
        terminal.at(Layout.doorX1 + 0.62, 1.32, hd + t + 0.02).into(root)
        Shape.box(0.42, 0.56, 0.07, round: 0.035, Mat.satin(Palette.charcoal, roughness: 0.4)).at(0, 0, 0.03).into(terminal)
        terminalScreen.at(0, 0.02, 0.068).named("terminal.screen").noShadow().into(terminal)
        // 카메라 눈
        Shape.cylinder(radius: 0.022, height: 0.012, Mat.satin(NSColor(hex: 0x0E1112), roughness: 0.15)).turned(x: 90).at(0, 0.245, 0.068).into(terminal)
        // 벽 고정판
        Shape.box(0.5, 0.66, 0.02, round: 0.02, Mat.matte(Palette.white)).at(0, 0, 0).into(terminal)
    }

    // MARK: 햇빛 가림막

    /// 천장이 없는 모형이라, 화면에는 보이지 않고 햇빛만 막는 가림판을 둔다.
    /// 덕분에 햇빛이 창으로만 들어와 바닥에 창 모양으로 떨어진다.
    ///
    /// 해는 늘 창밖(+X)에 있으므로 방에 닿는 햇빛은 모두 오른쪽 벽의 면(x = 벽 바깥면)을 지난다.
    /// 그 면에서 창을 뺀 나머지를 한쪽 면짜리 판으로 막는다. 판의 앞면이 해를 향하므로
    /// 해가 볼 때는 그려져 그림자를 드리우고, 방 안쪽에 있는 카메라에는 뒷면이라 그려지지 않는다.
    /// (카메라에 안 보이는 분류값으로 숨기면 그림자도 함께 사라져서 이 방법을 쓴다.)
    private func buildShadowOnlyCover() {
        let hd = Layout.halfDepth, h = Layout.wallHeight
        let x = Layout.halfWidth + Layout.thickness + 0.01
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = NSColor.black
        material.isDoubleSided = false
        material.cullMode = .back
        let cover = SCNNode.group("shadowOnly")
        let reach: CGFloat = 16
        // 벽 위. 해가 높이 떠도 방 왼쪽 끝까지 가려지도록 높게 세운다.
        Shape.quad(SCNVector3(x, h - 0.06, -reach), SCNVector3(x, h - 0.06, reach),
                   SCNVector3(x, 30, reach), SCNVector3(x, 30, -reach), material).into(cover)
        // 낮은 앞벽 너머로 비스듬히 새는 빛.
        Shape.quad(SCNVector3(x, -0.5, hd), SCNVector3(x, -0.5, reach),
                   SCNVector3(x, h, reach), SCNVector3(x, h, hd), material).into(cover)
        cover.enumerateHierarchy { node, _ in node.castsShadow = true }
        cover.into(root)
    }
}

/// 창밖. 하늘과 먼 건물.
@MainActor
enum Outdoors {
    /// 하늘판 크기. 창으로만 보이고 벽 위나 옆으로는 보이지 않게 잡는다.
    /// 창(z -3.15~3.4)에서 양쪽으로 0.95m씩만 넓힌다. 더 넓으면 비스듬한 전경에서
    /// 오른쪽 벽 앞 끝 바깥으로 파란 띠가 튀어나와 보인다.
    static let skyWidth: CGFloat = 8.45
    /// 하늘판이 벽 안쪽 면에서 떨어진 거리. 멀수록 비스듬히 볼 때 벽 옆으로 새어 나온다.
    static let skyGap: CGFloat = 0.6
    static var skyCenterZ: CGFloat { (Layout.windowZ0 + Layout.windowZ1) / 2 }
    static let skyHeight: CGFloat = 3.4
    static let skyBase: CGFloat = -0.9

    /// 세로 그라데이션 판. 정점 색으로 칠한다.
    static func skyGeometry(width: CGFloat, height: CGFloat, top: NSColor, middle: NSColor, bottom: NSColor) -> SCNGeometry {
        let w = Float(width / 2), h = Float(height), m = Float(height * 0.42)
        let vertices = [
            SCNVector3(CGFloat(-w), 0, 0), SCNVector3(CGFloat(w), 0, 0),
            SCNVector3(CGFloat(-w), CGFloat(m), 0), SCNVector3(CGFloat(w), CGFloat(m), 0),
            SCNVector3(CGFloat(-w), CGFloat(h), 0), SCNVector3(CGFloat(w), CGFloat(h), 0),
        ]
        var colors: [Float] = []
        for color in [bottom, bottom, middle, middle, top, top] {
            let c = color.usingColorSpace(.sRGB) ?? color
            colors.append(contentsOf: [linear(c.redComponent), linear(c.greenComponent), linear(c.blueComponent), 1])
        }
        let colorData = colors.withUnsafeBufferPointer { Data(buffer: $0) }
        let colorSource = SCNGeometrySource(data: colorData, semantic: .color, vectorCount: 6, usesFloatComponents: true,
                                            componentsPerVector: 4, bytesPerComponent: MemoryLayout<Float>.size,
                                            dataOffset: 0, dataStride: MemoryLayout<Float>.size * 4)
        let indices: [Int32] = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]
        let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: vertices), colorSource],
                                   elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = NSColor.white
        material.isDoubleSided = true
        geometry.materials = [material]
        return geometry
    }

    /// sRGB 성분을 선형 값으로.
    private static func linear(_ value: CGFloat) -> Float {
        let v = Double(value)
        return Float(v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4))
    }

    /// 창밖에 하늘판과 건물을 세운다.
    static func build(into parts: inout RoomParts) {
        let hw = Layout.halfWidth
        let outside = SCNNode.group("outdoors")
        outside.into(parts.root)

        // 하늘판. 방 안(-X)을 향해 서 있다.
        parts.sky.geometry = skyGeometry(width: Outdoors.skyWidth, height: Outdoors.skyHeight, top: NSColor(hex: 0x9CCBEA),
                                         middle: NSColor(hex: 0xCFE6F2), bottom: NSColor(hex: 0xF3E6CF))
        parts.sky.at(hw + Outdoors.skyGap, Outdoors.skyBase, Outdoors.skyCenterZ).turned(y: -90).named("sky").noShadow().into(outside)

        // 건물들
        var random = SeededRandom(11)
        // 건물은 하늘판 바로 앞, 하늘판 폭 안에만 둔다.
        let zMin = Outdoors.skyCenterZ - Outdoors.skyWidth / 2 + 0.05
        let zMax = Outdoors.skyCenterZ + Outdoors.skyWidth / 2 - 0.05
        var z: CGFloat = zMin
        while z < zMax - 0.6 {
            let width = min(CGFloat(random.range(0.6, 1.3)), zMax - z)
            let height = CGFloat(random.range(1.0, 2.25))
            let material = SCNMaterial()
            material.lightingModel = .constant
            material.diffuse.contents = NSColor(hex: 0xB9CBD6)
            let building = SCNNode(geometry: SCNBox(width: 0.3, height: height, length: width, chamferRadius: 0.02))
            building.geometry?.materials = [material]
            building.at(hw + Outdoors.skyGap - 0.17, Outdoors.skyBase + height / 2, z + width / 2).noShadow().into(outside)
            parts.buildings.append(building)

            // 건물 창
            let rows = Int(height / 0.34)
            let columns = max(1, Int(width / 0.3))
            for row in 0..<rows {
                for column in 0..<columns where random.next() < 0.55 {
                    let lightMaterial = Mat.glow(NSColor(hex: 0xFFD98A), strength: 1.4)
                    let light = SCNNode(geometry: SCNPlane(width: 0.11, height: 0.14))
                    light.geometry?.materials = [lightMaterial]
                    light.turned(y: -90).at(-0.16, -height / 2 + 0.3 + CGFloat(row) * 0.34,
                                           -width / 2 + (CGFloat(column) + 0.5) * width / CGFloat(columns))
                    light.opacity = 0
                    light.noShadow().into(building)
                    parts.cityLights.append(light)
                }
            }
            z += width + CGFloat(random.range(0.06, 0.4))
        }
    }
}
