import AppKit
import SceneKit

/// 탕비실·휴게 공간의 편의시설. 모두 원점이 바닥 가운데이고, 사람이 쓰는 앞면은 +Z다.
/// 사람 키가 약 1.1이라 실물보다 조금 작게 만든다(책상 상판 0.74, 커피 수납장 상판 0.87에 맞춤).
@MainActor
enum Amenities {

    // MARK: 사람이 서는 자리

    /// 각 모델을 쓸 때 사람이 서는 지점(모델 로컬 좌표, 바닥 높이). 사람은 이 점에서 −Z(모델 쪽)를 본다.
    enum StandPoint {
        static let waterPurifier = SCNVector3(0, 0, 0.5)
        static let fridge = SCNVector3(0.15, 0, 0.75)        // 문이 왼쪽 경첩으로 열리므로 살짝 오른쪽
        static let microwave = SCNVector3(0, 0, 0.55)        // 전자레인지 원점 기준(조리대 앞)
        static func pantry(_ pantry: Pantry, x: CGFloat) -> SCNVector3 { SCNVector3(x, 0, 0.6) }
        static let restroomDoor = SCNVector3(0, 0, 0.55)     // 문 앞. 들어갈 때는 (0, 0, −0.5)까지 걸어간다.
        /// 간식 탁자 스툴 자리(앉는 높이 0.46). 왼쪽 사람은 +X, 오른쪽 사람은 −X를 본다.
        static let snackSeats = [SCNVector3(-0.47, 0.46, 0), SCNVector3(0.47, 0.46, 0)]
    }

    // MARK: 내 자리 칸막이

    /// 섬 책상 가운데 내 자리만 구분하는 낮은 칸막이. 책상(Furniture.desk) 안쪽 좌표로 만든다.
    /// 상판 위로 28cm만 올라와 앉은 내 모습과 모니터는 가리지 않는다. 오른쪽(+X, 옆 동료 쪽) 한 면에만 세운다.
    /// 양면에 '내 자리' 이름판, 내 쪽 면에 메모지를 붙인다.
    static func myDeskPartition(deskWidth: CGFloat, deskDepth: CGFloat, topY: CGFloat = 0.775) -> SCNNode {
        let root = SCNNode.group("myDesk.partition")
        let height: CGFloat = 0.28, thickness: CGFloat = 0.035
        let length = deskDepth - 0.06
        let x = deskWidth / 2 - thickness / 2 - 0.005
        let panel = Mat.matte(Palette.green.lighter(0.22), roughness: 0.95)
        Shape.box(thickness, height, length, round: 0.012, panel).at(x, topY + height / 2, 0).into(root)
        // 위 손잡이 띠(오크)와 받침 두 개
        Shape.box(thickness + 0.012, 0.022, length + 0.01, round: 0.008, Mat.matte(Palette.oak.lighter(0.04), roughness: 0.6))
            .at(x, topY + height + 0.011, 0).into(root)
        for z in [-length / 2 + 0.08, length / 2 - 0.08] {
            Shape.box(0.09, 0.012, 0.05, round: 0.004, Mat.metal(Palette.steel)).at(x, topY + 0.006, z).into(root)
        }
        // 이름판: 앞쪽 끝, 양면
        let plate = Mat.image(Textures_restroom.namePlate("내 자리"), roughness: 0.5)
        for side in [1.0, -1.0] as [CGFloat] {
            Shape.plane(0.27, 0.1, plate, corner: 0.012).turned(y: side * 90)
                .at(x + side * (thickness / 2 + 0.002), topY + height - 0.085, length / 2 - 0.17).noShadow().into(root)
        }
        // 내 쪽(-X) 면의 메모지
        let notes: [(CGFloat, CGFloat, NSColor, CGFloat)] = [
            (-0.12, 0.13, NSColor(hex: 0xF7E3A1), 5), (0.02, 0.15, NSColor(hex: 0xCFE6D6), -4), (-0.04, 0.07, Palette.paper, 3),
        ]
        for (z, y, color, tilt) in notes {
            Shape.plane(0.075, 0.075, Mat.matte(color, roughness: 0.9)).turned(y: -90, z: tilt)
                .at(x - thickness / 2 - 0.003, topY + y, z).noShadow().into(root)
        }
        return root
    }

    // MARK: 정수기

    /// 바닥에 서는 직수형 정수기와 옆에 붙은 종이컵 디스펜서.
    /// - Returns: cupSpot은 꼭지 바로 아래 컵을 놓는 자리(빈 노드, 받침대 윗면 높이).
    static func waterPurifier() -> (node: SCNNode, cupSpot: SCNNode) {
        let root = SCNNode.group("waterPurifier")
        let white = Mat.satin(Palette.white, roughness: 0.35)
        let silver = Mat.metal(NSColor(hex: 0xC9CCCD), roughness: 0.28)
        let width: CGFloat = 0.32, depth: CGFloat = 0.34
        let front = depth / 2

        // 바닥 받침
        Shape.box(width + 0.04, 0.06, depth + 0.02, round: 0.02, Mat.satin(Palette.graphite, roughness: 0.5))
            .at(0, 0.03, 0).into(root)
        // 아래 몸통
        Shape.box(width, 0.56, depth, round: 0.035, white).at(0, 0.06 + 0.28, 0).into(root)
        // 물 받는 자리: 앞이 파인 칸. 뒤판과 양옆 볼만 둔다.
        let nicheBottom: CGFloat = 0.62, nicheTop: CGFloat = 0.86
        let nicheHeight = nicheTop - nicheBottom
        Shape.box(width, nicheHeight, 0.16, round: 0.01, Mat.satin(NSColor(hex: 0x8E9496), roughness: 0.4))
            .at(0, nicheBottom + nicheHeight / 2, -depth / 2 + 0.08).into(root)
        for x in [-width / 2 + 0.015, width / 2 - 0.015] {
            Shape.box(0.03, nicheHeight, depth, round: 0.01, white).at(x, nicheBottom + nicheHeight / 2, 0).into(root)
        }
        // 물받이 그릴
        Shape.box(width - 0.06, 0.025, 0.15, round: 0.008, silver).at(0, nicheBottom + 0.0125, front - 0.09).into(root)
        for index in 0..<5 {
            Shape.box(width - 0.09, 0.004, 0.008, round: 0, Mat.matte(Palette.graphite))
                .at(0, nicheBottom + 0.026, front - 0.15 + CGFloat(index) * 0.026).into(root)
        }
        // 윗 몸통과 은색 앞판
        Shape.box(width, 0.22, depth, round: 0.035, white).at(0, nicheTop + 0.11, 0).into(root)
        Shape.box(width - 0.04, 0.17, 0.012, round: 0.01, silver).at(0, nicheTop + 0.105, front + 0.002).into(root)
        // 꼭지
        let faucet = Shape.cylinder(radius: 0.016, height: 0.06, silver, segments: 18)
        faucet.at(0, nicheTop - 0.03, front - 0.08).into(root)
        Shape.cylinder(radius: 0.011, height: 0.01, Mat.matte(Palette.charcoal), segments: 14)
            .at(0, nicheTop - 0.062, front - 0.08).into(root)
        // 냉수(파랑)·온수(빨강) 버튼과 표시등
        let buttons: [(CGFloat, NSColor)] = [(-0.06, NSColor(hex: 0x3D8BEA)), (0.06, NSColor(hex: 0xE5534B))]
        for (x, color) in buttons {
            Shape.cylinder(radius: 0.026, height: 0.012, Mat.satin(color.lighter(0.1), roughness: 0.3))
                .turned(x: 90).at(x, nicheTop + 0.12, front + 0.01).into(root)
            Shape.sphere(0.008, Mat.glow(color.lighter(0.25), strength: 1.2)).at(x, nicheTop + 0.17, front + 0.01).noShadow().into(root)
        }
        // 위 뚜껑
        Shape.box(width + 0.01, 0.025, depth + 0.01, round: 0.012, Mat.satin(Palette.graphite, roughness: 0.45))
            .at(0, nicheTop + 0.23, 0).into(root)

        // 종이컵 디스펜서: 오른쪽 옆면에 붙은 투명 통, 아래로 한 개씩 뽑는다.
        let dispenser = SCNNode.group("cupDispenser").at(width / 2 + 0.05, 0, front - 0.08).into(root)
        Shape.box(0.012, 0.42, 0.06, round: 0.004, silver).at(-0.045, 0.66, 0).into(dispenser)
        Shape.tube(inner: 0.040, outer: 0.044, height: 0.36, Mat.glass(NSColor(hex: 0xE8F2F0), opacity: 0.35))
            .at(0, 0.66, 0).noShadow().into(dispenser)
        Shape.tube(inner: 0.036, outer: 0.046, height: 0.03, silver).at(0, 0.47, 0).into(dispenser)
        Shape.cylinder(radius: 0.046, height: 0.015, silver).at(0, 0.848, 0).into(dispenser)
        for index in 0..<11 {
            paperCup().at(0, 0.48 + CGFloat(index) * 0.03, 0).into(dispenser)
        }

        let cupSpot = SCNNode.group("waterPurifier.cupSpot").at(0, nicheBottom + 0.025, front - 0.08).into(root)
        return (root, cupSpot)
    }

    /// 종이컵 하나. 원점은 바닥 가운데.
    static func paperCup() -> SCNNode {
        let root = SCNNode.group("paperCup")
        let paper = Mat.matte(Palette.paper, roughness: 0.7)
        Shape.cone(top: 0.034, bottom: 0.025, height: 0.075, paper, segments: 24).at(0, 0.0375, 0).into(root)
        Shape.torus(ring: 0.034, pipe: 0.0025, paper).at(0, 0.075, 0).into(root)
        // 초록 띠
        Shape.cone(top: 0.0335, bottom: 0.0305, height: 0.016, Mat.matte(Palette.green.lighter(0.15)), segments: 24)
            .scaled(1.02, 1, 1.02).at(0, 0.048, 0).into(root)
        return root
    }

    // MARK: 냉장고

    /// 작은 2도어 냉장고(위 냉동, 아래 냉장). 높이 약 1.45.
    /// - Returns: doorPivot은 아래(냉장) 문의 경첩 축(왼쪽 앞 모서리). eulerAngles.y를 음수로 돌리면 앞으로 열린다(−100도쯤이 활짝).
    static func fridge() -> (node: SCNNode, doorPivot: SCNNode) {
        let root = SCNNode.group("fridge")
        let width: CGFloat = 0.62, depth: CGFloat = 0.58, height: CGFloat = 1.45
        let shell = Mat.satin(NSColor(hex: 0xEFE9DD), roughness: 0.32)
        let liner = Mat.satin(NSColor(hex: 0xF7F7F4), roughness: 0.5)
        let wall: CGFloat = 0.035
        let bodyDepth = depth - 0.05
        let bodyCenterZ = -0.025 - (depth - bodyDepth) / 2 + 0.025

        // 껍데기: 문이 열리면 안이 보이도록 앞이 뚫린 상자로 짓는다.
        Shape.box(width, wall, bodyDepth, round: 0.01, shell).at(0, 0.05 + wall / 2, bodyCenterZ).into(root)
        Shape.box(width, wall, bodyDepth, round: 0.02, shell).at(0, height - wall / 2, bodyCenterZ).into(root)
        for x in [-width / 2 + wall / 2, width / 2 - wall / 2] {
            Shape.box(wall, height - 0.05, bodyDepth, round: 0.01, shell).at(x, 0.05 + (height - 0.05) / 2, bodyCenterZ).into(root)
        }
        Shape.box(width, height - 0.05, wall, round: 0.01, shell).at(0, 0.05 + (height - 0.05) / 2, bodyCenterZ - bodyDepth / 2 + wall / 2).into(root)
        // 다리 받침
        Shape.box(width - 0.04, 0.05, bodyDepth - 0.04, round: 0.01, Mat.matte(Palette.charcoal)).at(0, 0.025, bodyCenterZ).into(root)

        // 안쪽: 냉동·냉장 칸 나눔, 선반, 음식
        let innerWidth = width - wall * 2
        let innerDepth = bodyDepth - wall
        let innerZ = bodyCenterZ + wall / 2
        let lowerTop: CGFloat = 0.98
        Shape.box(innerWidth, 0.04, innerDepth, round: 0.005, liner).at(0, lowerTop + 0.02, innerZ).into(root)
        Shape.box(innerWidth - 0.01, height - 0.12, 0.004, round: 0, liner).at(0, 0.05 + (height - 0.05) / 2, bodyCenterZ - bodyDepth / 2 + wall + 0.003).into(root)
        let shelfGlass = Mat.glass(NSColor(hex: 0xDDEFF2), opacity: 0.45)
        for y in [0.36, 0.66] as [CGFloat] {
            Shape.box(innerWidth - 0.01, 0.012, innerDepth - 0.04, round: 0.003, shelfGlass).at(0, y, innerZ - 0.02).noShadow().into(root)
        }
        // 채소칸
        Shape.box(innerWidth - 0.04, 0.2, innerDepth - 0.08, round: 0.02, Mat.glass(NSColor(hex: 0xCFE6DD), opacity: 0.55))
            .at(0, 0.19, innerZ - 0.02).noShadow().into(root)
        // 음료병과 반찬통
        let bottleColors: [NSColor] = [NSColor(hex: 0x7FBF8A), NSColor(hex: 0xE9B94F), NSColor(hex: 0xBFD9EF)]
        for (index, color) in bottleColors.enumerated() {
            let x = -innerWidth / 2 + 0.08 + CGFloat(index) * 0.09
            Shape.capsule(radius: 0.032, height: 0.2, Mat.satin(color, roughness: 0.25)).at(x, 0.67 + 0.1, innerZ - 0.06).into(root)
            Shape.cylinder(radius: 0.014, height: 0.02, Mat.matte(Palette.white)).at(x, 0.67 + 0.205, innerZ - 0.06).into(root)
        }
        Shape.box(0.2, 0.08, 0.15, round: 0.02, Mat.satin(Palette.white, roughness: 0.4)).at(0.12, 0.37 + 0.04, innerZ - 0.05).into(root)
        Shape.box(0.19, 0.012, 0.14, round: 0.004, Mat.satin(Palette.green, roughness: 0.4)).at(0.12, 0.37 + 0.086, innerZ - 0.05).into(root)
        Shape.box(0.14, 0.11, 0.12, round: 0.02, Mat.matte(NSColor(hex: 0xF6E2B8))).at(-0.13, 0.37 + 0.055, innerZ - 0.05).into(root)
        // 안쪽 등(문을 열면 은은하게 보인다)
        Shape.box(0.12, 0.012, 0.04, round: 0.004, Mat.glow(NSColor(hex: 0xF3FAFF), strength: 0.9))
            .at(0, lowerTop - 0.01, innerZ - innerDepth / 2 + 0.05).noShadow().into(root)

        let frontZ = bodyCenterZ + bodyDepth / 2
        let doorThickness: CGFloat = 0.05
        let handle = Mat.metal(Palette.steel, roughness: 0.3)

        // 위 냉동실 문(고정)
        let upperHeight = height - lowerTop - 0.03
        Shape.box(width, upperHeight, doorThickness, round: 0.025, shell)
            .at(0, lowerTop + 0.02 + upperHeight / 2, frontZ + doorThickness / 2).into(root)
        Shape.box(0.022, 0.16, 0.03, round: 0.01, handle).at(width / 2 - 0.06, lowerTop + 0.12, frontZ + doorThickness + 0.015).into(root)

        // 아래 냉장실 문: 왼쪽 경첩에서 돈다.
        let doorPivot = SCNNode.group("fridge.doorPivot").at(-width / 2, 0, frontZ).into(root)
        let lowerHeight = lowerTop - 0.06
        let door = SCNNode.group("fridge.door").at(width / 2, 0.06 + lowerHeight / 2, doorThickness / 2).into(doorPivot)
        Shape.box(width, lowerHeight, doorThickness, round: 0.025, shell).into(door)
        // 문 안쪽 칸(문이 열리면 보인다)
        Shape.box(width - 0.1, 0.06, 0.06, round: 0.01, liner).at(0, 0.15, -doorThickness / 2 - 0.03).into(door)
        Shape.box(width - 0.1, 0.06, 0.06, round: 0.01, liner).at(0, -0.15, -doorThickness / 2 - 0.03).into(door)
        Shape.capsule(radius: 0.022, height: 0.15, Mat.satin(NSColor(hex: 0xE58B6B), roughness: 0.3)).at(0.12, -0.04, -doorThickness / 2 - 0.04).into(door)
        // 손잡이와 메모 자석
        Shape.box(0.022, 0.32, 0.03, round: 0.01, handle).at(width / 2 - 0.06, lowerHeight / 2 - 0.22, doorThickness / 2 + 0.015).into(door)
        Shape.box(0.11, 0.13, 0.004, round: 0, Mat.matte(NSColor(hex: 0xF7E3A1))).turned(z: 4).at(-0.1, 0.12, doorThickness / 2 + 0.003).into(door)
        Shape.cylinder(radius: 0.014, height: 0.01, Mat.satin(Palette.terracotta)).turned(x: 90).at(-0.1, 0.17, doorThickness / 2 + 0.008).into(door)
        return (root, doorPivot)
    }

    // MARK: 전자레인지

    /// 조리대 위에 올리는 전자레인지.
    /// - Returns: glow는 안 창. 돌아갈 때 `glow.geometry?.firstMaterial?.emission.intensity`를 1쯤으로 올린다(기본 0.05).
    static func microwave() -> (node: SCNNode, glow: SCNNode) {
        let root = SCNNode.group("microwave")
        let width: CGFloat = 0.44, height: CGFloat = 0.26, depth: CGFloat = 0.32
        Shape.box(width, height, depth, round: 0.025, Mat.satin(Palette.white, roughness: 0.4)).at(0, 0.012 + height / 2, 0).into(root)
        for x in [-width / 2 + 0.05, width / 2 - 0.05] {
            for z in [-depth / 2 + 0.05, depth / 2 - 0.05] {
                Shape.cylinder(radius: 0.014, height: 0.012, Mat.matte(Palette.charcoal), segments: 12).at(x, 0.006, z).into(root)
            }
        }
        let front = depth / 2
        // 문(검은 테두리)과 창
        let doorWidth = width * 0.68
        let doorX = -width / 2 + doorWidth / 2 + 0.015
        Shape.box(doorWidth, height - 0.03, 0.012, round: 0.012, Mat.satin(Palette.charcoal, roughness: 0.3))
            .at(doorX, 0.012 + height / 2, front + 0.004).into(root)
        let window = Mat.glow(NSColor(hex: 0xFFD58A), strength: 0.05)
        let glow = Shape.plane(doorWidth - 0.07, height - 0.1, window, corner: 0.012)
        glow.at(doorX, 0.012 + height / 2, front + 0.0105).named("microwave.glow").noShadow().into(root)
        Shape.box(0.016, height - 0.08, 0.02, round: 0.006, Mat.metal(Palette.steel)).at(doorX + doorWidth / 2 - 0.025, 0.012 + height / 2, front + 0.018).into(root)
        // 조작판: 표시창, 다이얼, 버튼
        let panelX = doorX + doorWidth / 2 + (width / 2 - (doorX + doorWidth / 2)) / 2
        Shape.box(0.08, 0.03, 0.006, round: 0.004, Mat.glow(NSColor(hex: 0x6EE0A8), strength: 0.8)).at(panelX, 0.012 + height - 0.045, front + 0.003).noShadow().into(root)
        Shape.cylinder(radius: 0.026, height: 0.02, Mat.satin(Palette.graphite, roughness: 0.35)).turned(x: 90).at(panelX, 0.012 + height / 2, front + 0.01).into(root)
        for index in 0..<2 {
            Shape.box(0.06, 0.018, 0.008, round: 0.004, Mat.satin(Palette.steel, roughness: 0.4))
                .at(panelX, 0.012 + 0.05 + CGFloat(index) * 0.03, front + 0.004).into(root)
        }
        return (root, glow)
    }

    // MARK: 탕비실 조리대

    struct Pantry {
        let node: SCNNode
        /// 전자레인지를 올릴 자리(상판 윗면, 왼쪽).
        let microwaveSpot: SCNVector3
        /// 과자 바구니 자리(이미 놓여 있다).
        let basketSpot: SCNVector3
        /// 티슈 자리(이미 놓여 있다).
        let tissueSpot: SCNVector3
    }

    /// 하부장과 상판(높이 0.85), 위 벽 선반의 과자 상자·컵라면. 과자 바구니와 티슈는 상판에 놓여 있다.
    /// 뒤쪽(−Z) 끝이 벽에 닿는다. 선반은 뒤쪽 끝에 붙어 있다.
    static func pantryCounter(width: CGFloat = 1.6) -> Pantry {
        let root = SCNNode.group("pantry")
        let depth: CGFloat = 0.55
        let topY: CGFloat = 0.85
        let cabinet = Mat.matte(Palette.white, roughness: 0.6)
        // 걸레받이, 하부장, 상판
        Shape.box(width - 0.04, 0.08, depth - 0.06, round: 0.01, Mat.matte(Palette.skirting)).at(0, 0.04, -0.02).into(root)
        Shape.box(width, topY - 0.11, depth - 0.02, round: 0.025, cabinet).at(0, 0.08 + (topY - 0.11) / 2, -0.01).into(root)
        Shape.box(width + 0.04, 0.04, depth + 0.02, round: 0.015, Mat.matte(Palette.oak.lighter(0.04), roughness: 0.55))
            .at(0, topY - 0.02, 0).into(root)
        // 문짝 줄과 손잡이
        let doors = max(2, Int((width / 0.42).rounded()))
        let doorWidth = width / CGFloat(doors)
        let front = depth / 2 - 0.02
        for index in 0..<doors {
            let x = -width / 2 + doorWidth * (CGFloat(index) + 0.5)
            if index > 0 {
                Shape.box(0.006, topY - 0.17, 0.006, round: 0, Mat.matte(Palette.wallCap)).at(x - doorWidth / 2, 0.08 + (topY - 0.11) / 2, front + 0.002).into(root)
            }
            let handleX = x + (index % 2 == 0 ? 1 : -1) * (doorWidth / 2 - 0.06)
            Shape.capsule(radius: 0.011, height: 0.12, Mat.metal(Palette.brass)).at(handleX, topY - 0.2, front + 0.012).into(root)
        }

        // 상판 위: 과자 바구니(오른쪽 앞), 티슈(오른쪽 끝)
        let basketSpot = SCNVector3(width / 2 - 0.42, topY, 0.04)
        snackBasket().at(basketSpot.x, basketSpot.y, basketSpot.z).turned(y: -8).into(root)
        let tissueSpot = SCNVector3(width / 2 - 0.14, topY, -0.06)
        tissueBox().at(tissueSpot.x, tissueSpot.y, tissueSpot.z).turned(y: 14).into(root)
        let microwaveSpot = SCNVector3(-width / 2 + 0.32, topY, -0.06)

        // 벽 선반: 상판 위 0.55, 받침쇠 두 개
        let shelfY = topY + 0.58
        let shelfDepth: CGFloat = 0.24
        let shelfZ = -depth / 2 + shelfDepth / 2 + 0.01
        let shelfWidth = min(width, 1.3)
        Shape.box(shelfWidth, 0.035, shelfDepth, round: 0.012, Mat.matte(Palette.oak.lighter(0.04), roughness: 0.6)).at(0, shelfY, shelfZ).into(root)
        for x in [-shelfWidth / 2 + 0.12, shelfWidth / 2 - 0.12] {
            Shape.box(0.025, 0.12, 0.025, round: 0.006, Mat.metal(Palette.brass)).at(x, shelfY - 0.075, -depth / 2 + 0.025).into(root)
            Shape.box(0.025, 0.025, shelfDepth - 0.04, round: 0.006, Mat.metal(Palette.brass)).turned(x: 35).at(x, shelfY - 0.07, shelfZ - 0.02).into(root)
        }
        // 선반 위: 과자 상자 셋, 컵라면 넷
        let boxes: [(CGFloat, CGFloat, NSColor)] = [(0.13, 0.2, NSColor(hex: 0xE5534B)), (0.11, 0.17, NSColor(hex: 0xE9B94F)), (0.12, 0.22, Palette.greenLight)]
        var x = -shelfWidth / 2 + 0.1
        for (index, box) in boxes.enumerated() {
            let node = Shape.box(box.0, box.1, 0.07, round: 0.008, Mat.matte(box.2, roughness: 0.65))
            node.turned(y: index == 1 ? -6 : 0).at(x + box.0 / 2, shelfY + 0.0175 + box.1 / 2, shelfZ).into(root)
            // 앞면 띠
            Shape.box(box.0 * 0.8, box.1 * 0.22, 0.004, round: 0, Mat.matte(Palette.paper)).at(x + box.0 / 2, shelfY + 0.0175 + box.1 * 0.62, shelfZ + 0.037).into(root)
            x += box.0 + 0.025
        }
        x += 0.05
        for index in 0..<4 {
            let cup = snack(.cupRamen).scaled(1.15)
            if index == 3 {
                cup.at(x - 0.17, shelfY + 0.0175 + 0.098 * 1.15, shelfZ - 0.01).into(root) // 두 개 위에 하나 얹음
            } else {
                cup.at(x, shelfY + 0.0175, shelfZ + (index % 2 == 0 ? 0.02 : -0.02)).into(root)
                x += 0.12
            }
        }

        return Pantry(node: root, microwaveSpot: microwaveSpot, basketSpot: basketSpot, tissueSpot: tissueSpot)
    }

    /// 과자 봉지가 담긴 등나무 느낌 바구니.
    static func snackBasket() -> SCNNode {
        let root = SCNNode.group("snackBasket")
        let wicker = Mat.matte(NSColor(hex: 0xC99A5E), roughness: 0.85)
        Shape.box(0.3, 0.1, 0.2, round: 0.03, wicker).at(0, 0.05, 0).into(root)
        Shape.box(0.27, 0.01, 0.17, round: 0.004, Mat.matte(NSColor(hex: 0x8C6A3E))).at(0, 0.098, 0).into(root)
        for index in 0..<3 {
            Shape.box(0.31, 0.008, 0.21, round: 0.004, Mat.matte(NSColor(hex: 0xB0834B))).at(0, 0.025 + CGFloat(index) * 0.03, 0).into(root)
        }
        let picks: [(SnackKind, CGFloat, CGFloat, CGFloat)] = [(.chipBag, -0.07, 0, -12), (.chipBag, 0.06, -0.02, 15), (.banana, 0.02, 0.05, 70)]
        for (index, pick) in picks.enumerated() {
            let item = snack(pick.0, colorIndex: index)
            item.turned(x: pick.0 == .chipBag ? -18 : 0, y: pick.3).at(pick.1, 0.08, pick.2).into(root)
        }
        return root
    }

    /// 티슈 상자.
    static func tissueBox() -> SCNNode {
        let root = SCNNode.group("tissue")
        Shape.box(0.22, 0.09, 0.12, round: 0.012, Mat.matte(NSColor(hex: 0xCFE6D6), roughness: 0.7)).at(0, 0.045, 0).into(root)
        Shape.box(0.12, 0.004, 0.03, round: 0.002, Mat.matte(NSColor(hex: 0x6F8179))).at(0, 0.091, 0).into(root)
        Shape.sphere(0.04, Mat.matte(Palette.paper, roughness: 0.9)).scaled(1.2, 0.8, 0.45).at(0, 0.115, 0).into(root)
        return root
    }

    // MARK: 간식 탁자

    /// 작은 원형 탁자와 스툴 두 개. 원점은 탁자 중심, 스툴은 ±X 0.47(스툴 포함 폭 약 1.24).
    /// 앉는 자리는 `StandPoint.snackSeats`.
    static func snackTable() -> SCNNode {
        let root = SCNNode.group("snackTable")
        let topY: CGFloat = 0.7
        let wood = Mat.matte(Palette.oak.lighter(0.05), roughness: 0.55)
        Shape.cylinder(radius: 0.3, height: 0.04, wood, segments: 48).at(0, topY - 0.02, 0).into(root)
        Shape.torus(ring: 0.3, pipe: 0.02, wood).at(0, topY - 0.02, 0).into(root)
        Shape.cylinder(radius: 0.035, height: topY - 0.06, Mat.satin(Palette.green, roughness: 0.4)).at(0, (topY - 0.06) / 2 + 0.02, 0).into(root)
        Shape.cylinder(radius: 0.2, height: 0.025, Mat.satin(Palette.green, roughness: 0.4)).at(0, 0.0125, 0).into(root)
        // 탁자 위 작은 화분
        Furniture.smallPlant().scaled(0.8).at(0.08, topY, -0.06).into(root)
        for side in [-1.0, 1.0] as [CGFloat] {
            stool().at(side * 0.47, 0, 0).into(root)
        }
        return root
    }

    /// 둥근 스툴. 앉는 높이 0.46.
    static func stool() -> SCNNode {
        let root = SCNNode.group("stool")
        let legs = Mat.matte(Palette.oakDeep, roughness: 0.6)
        for index in 0..<3 {
            let leg = SCNNode.group().turned(y: CGFloat(index) * 120 + 30).into(root)
            Shape.cylinder(radius: 0.016, height: 0.46, legs, segments: 12).turned(x: 8).at(0, 0.22, 0.1).into(leg)
        }
        Shape.torus(ring: 0.11, pipe: 0.01, Mat.metal(Palette.brass)).at(0, 0.17, 0).into(root)
        Shape.cylinder(radius: 0.15, height: 0.06, Mat.matte(Palette.green, roughness: 0.8)).at(0, 0.43, 0).into(root)
        Shape.torus(ring: 0.13, pipe: 0.025, Mat.matte(Palette.green, roughness: 0.8)).at(0, 0.445, 0).into(root)
        return root
    }

    // MARK: 화장실 문

    /// 뒷벽에 붙이는 화장실 문. 문틀 포함 폭 0.95, 높이 2.1. 앞면 +Z, 벽(두께 0.24) 가운데가 z = 0, 벽 앞면 z = 0.12.
    /// - Returns: doorPivot은 왼쪽 경첩 축. eulerAngles.y를 양수로 돌리면 안쪽(−Z)으로 열린다(+95도쯤이 활짝).
    ///   sign은 문 오른쪽 벽에 붙는 '화장실' 표지판. 문 뒤에는 열었을 때 보이는 작은 안쪽 공간(restroom.inside)이 있다.
    ///   벽에는 폭 0.95 × 높이 2.1 구멍이 필요하다.
    static func restroomDoor() -> (node: SCNNode, doorPivot: SCNNode, sign: SCNNode) {
        let root = SCNNode.group("restroomDoor")
        let outerWidth: CGFloat = 0.95, outerHeight: CGFloat = 2.1
        let frameWidth: CGFloat = 0.06
        let frameDepth: CGFloat = 0.28 // 벽 두께 0.24를 덮는다
        let frame = Mat.matte(Palette.white, roughness: 0.55)
        // 문틀
        for x in [-outerWidth / 2 + frameWidth / 2, outerWidth / 2 - frameWidth / 2] {
            Shape.box(frameWidth, outerHeight, frameDepth, round: 0.012, frame).at(x, outerHeight / 2, 0).into(root)
        }
        Shape.box(outerWidth, frameWidth, frameDepth, round: 0.012, frame).at(0, outerHeight - frameWidth / 2, 0).into(root)

        // 문짝
        let doorWidth = outerWidth - frameWidth * 2 - 0.01
        let doorHeight = outerHeight - frameWidth - 0.015
        let doorThickness: CGFloat = 0.045
        let doorPivot = SCNNode.group("restroom.doorPivot").at(-doorWidth / 2, 0.01, -0.01).into(root)
        let door = SCNNode.group("restroom.door").at(doorWidth / 2, doorHeight / 2, 0).into(doorPivot)
        let doorColor = Palette.green.lighter(0.06)
        Shape.box(doorWidth, doorHeight, doorThickness, round: 0.012, Mat.matte(doorColor, roughness: 0.65)).into(door)
        // 문 앞면 판 장식 두 칸
        for (y, h) in [(0.42, 0.62), (-0.48, 0.72)] as [(CGFloat, CGFloat)] {
            Shape.box(doorWidth - 0.2, h, 0.008, round: 0.01, Mat.matte(doorColor.lighter(0.08), roughness: 0.6))
                .at(0, y, doorThickness / 2 + 0.003).into(door)
        }
        // 손잡이(레버)와 잠금 표시
        let handleX = doorWidth / 2 - 0.09
        for side in [1.0, -1.0] as [CGFloat] {
            Shape.cylinder(radius: 0.03, height: 0.012, Mat.metal(Palette.brass)).turned(x: 90).at(handleX, -0.05, side * (doorThickness / 2 + 0.006)).into(door)
            Shape.capsule(radius: 0.012, height: 0.12, Mat.metal(Palette.brass)).turned(z: 90).at(handleX - 0.05, -0.05, side * (doorThickness / 2 + 0.03)).into(door)
        }
        Shape.cylinder(radius: 0.018, height: 0.01, Mat.glow(NSColor(hex: 0x6EE0A8), strength: 0.7)).turned(x: 90)
            .at(handleX, 0.06, doorThickness / 2 + 0.006).named("restroom.vacant").noShadow().into(door)
        // 문 위 작은 표지
        let plate = Shape.plane(0.16, 0.16, Mat.image(Textures_restroom.pictogramTile(), roughness: 0.5), corner: 0.02)
        plate.at(0, 0.32 + 0.42, doorThickness / 2 + 0.009).noShadow().into(door)

        // 안쪽 공간: 문이 열렸을 때 까만 구멍 대신 타일 벽이 보이게.
        let inside = SCNNode.group("restroom.inside").at(0, 0, -frameDepth / 2).into(root)
        let tile = Mat.image(Textures_restroom.tiles(), roughness: 0.4)
        let innerWidth = outerWidth - frameWidth * 2
        // 들어간 사람은 문에서 0.85m 안에 선다. 그 뒤에 변기가 들어가게 깊게 판다. 1.4면 사무실 뒷벽 몰딩(6cm 돌출)이 타일을 뚫고 띠로 보인다.
        let innerDepth: CGFloat = 1.36
        Shape.plane(innerWidth, outerHeight - frameWidth, tile).at(0, (outerHeight - frameWidth) / 2, -innerDepth).into(inside)
        for side in [-1.0, 1.0] as [CGFloat] {
            Shape.plane(innerDepth, outerHeight - frameWidth, tile).turned(y: -side * 90)
                .at(side * innerWidth / 2, (outerHeight - frameWidth) / 2, -innerDepth / 2).into(inside)
        }
        Shape.floorPlane(innerWidth, innerDepth, Mat.matte(NSColor(hex: 0xC9CDCB), roughness: 0.5)).at(0, 0.002, -innerDepth / 2).into(inside)
        Shape.box(0.34, 0.012, 0.14, round: 0.004, Mat.glow(NSColor(hex: 0xFFFFFF), strength: 1.4))
            .turned(x: 90).at(0, outerHeight - frameWidth - 0.15, -innerDepth + 0.01).noShadow().into(inside)
        // 변기: 문을 열면 빈 타일 벽만 보이던 것. 서 있는 사람(문에서 0.85m) 뒤, 뒷벽에 붙여 둔다.
        let porcelain = Mat.satin(Palette.white, roughness: 0.3)
        let toilet = SCNNode.group("restroom.toilet").at(0, 0, -innerDepth).into(inside)
        Shape.box(0.38, 0.4, 0.15, round: 0.04, porcelain).at(0, 0.66, 0.08).into(toilet)            // 물탱크
        Shape.box(0.34, 0.36, 0.3, round: 0.08, porcelain).at(0, 0.18, 0.3).into(toilet)             // 몸통
        Shape.cylinder(radius: 0.18, height: 0.04, porcelain).scaled(1, 1, 1.1).at(0, 0.38, 0.32).into(toilet) // 뚜껑
        Shape.capsule(radius: 0.012, height: 0.07, Mat.metal(Palette.brass)).turned(z: 90).at(-0.12, 0.8, 0.165).into(toilet)
        // 오른쪽 벽 휴지걸이
        Shape.cylinder(radius: 0.055, height: 0.1, Mat.satin(Palette.paper, roughness: 0.6)).turned(z: 90)
            .at(innerWidth / 2 - 0.07, 0.72, -innerDepth + 0.45).into(inside)

        // 벽 표지판: 문 오른쪽, 눈높이보다 조금 위
        let sign = SCNNode.group("restroom.sign").at(outerWidth / 2 + 0.26, 1.42, 0.12).into(root)
        Shape.box(0.36, 0.46, 0.025, round: 0.02, Mat.matte(Palette.green, roughness: 0.6)).at(0, 0, 0.0125).into(sign)
        Shape.plane(0.32, 0.42, Mat.image(Textures_restroom.sign(), roughness: 0.55), corner: 0.015).at(0, 0, 0.0265).noShadow().into(sign)
        return (root, doorPivot, sign)
    }

    // MARK: 간식

    enum SnackKind: CaseIterable {
        case cupRamen, chipBag, banana
    }

    /// 손에 드는 간식. 원점은 바닥 가운데(바나나는 가운데).
    static func snack(_ kind: SnackKind, colorIndex: Int = 0) -> SCNNode {
        let root = SCNNode.group("snack")
        switch kind {
        case .cupRamen:
            root.name = "snack.cupRamen"
            let colors = [NSColor(hex: 0xE5534B), NSColor(hex: 0xE9B94F)]
            let color = colors[colorIndex % colors.count]
            Shape.cone(top: 0.05, bottom: 0.038, height: 0.085, Mat.satin(Palette.paper, roughness: 0.55), segments: 28).at(0, 0.0425, 0).into(root)
            Shape.cone(top: 0.0505, bottom: 0.044, height: 0.04, Mat.satin(color, roughness: 0.5), segments: 28).at(0, 0.06, 0).into(root)
            Shape.cylinder(radius: 0.052, height: 0.006, Mat.metal(NSColor(hex: 0xD8D4CA), roughness: 0.4), segments: 28).at(0, 0.088, 0).into(root)
            Shape.box(0.03, 0.003, 0.02, round: 0, Mat.metal(NSColor(hex: 0xD8D4CA), roughness: 0.4)).at(0.055, 0.088, 0).into(root)
        case .chipBag:
            root.name = "snack.chipBag"
            let colors = [NSColor(hex: 0xE9B94F), NSColor(hex: 0x3D8BEA), NSColor(hex: 0xE5534B)]
            let color = colors[colorIndex % colors.count]
            let foil = Mat.satin(color, roughness: 0.3)
            // 납작한 봉지 + 가운데가 부푼 볼록면, 위아래는 눌러 붙인 톱니 띠
            Shape.box(0.1, 0.13, 0.026, round: 0.012, foil).at(0, 0.075, 0).into(root)
            Shape.sphere(0.05, foil, segments: 28).scaled(0.95, 1.25, 0.42).at(0, 0.075, 0).into(root)
            for y in [0.006, 0.144] as [CGFloat] {
                Shape.box(0.1, 0.014, 0.008, round: 0.003, Mat.satin(color.darker(0.15), roughness: 0.35)).at(0, y, 0).into(root)
            }
            // 이름표 띠와 과자 그림
            Shape.box(0.07, 0.03, 0.004, round: 0.002, Mat.matte(Palette.paper)).at(0, 0.1, 0.022).into(root)
            Shape.sphere(0.012, Mat.matte(NSColor(hex: 0xF2CF4A))).scaled(1.3, 1, 0.4).at(0, 0.058, 0.02).into(root)
        case .banana:
            root.name = "snack.banana"
            let peel = Mat.satin(NSColor(hex: 0xF4D35E), roughness: 0.55)
            peel.isDoubleSided = true
            // 호를 따라 휜 관: 가운데 굵고 양끝 가늘다. 단면은 둥근 오각형에 가까워 바나나 모서리가 은은하게 보인다.
            let radius: CGFloat = 0.1, sweep: CGFloat = 80
            let body = bentTube(arcRadius: radius, sweepDegrees: sweep, steps: 28, sides: 15) { t in
                let r = 0.004 + 0.015 * pow(sin(t * .pi), 0.7)
                return r
            } ridge: { angle in 1 + 0.06 * cos(angle * 5) }
            body.geometry?.materials = [peel]
            body.at(0, 0.019, 0).into(root)
            // 꼭지(오른쪽 끝)와 꽁지(왼쪽 끝)
            let tipAngle = rad(sweep / 2)
            let stem = Mat.matte(NSColor(hex: 0x6B5A2E))
            Shape.cylinder(radius: 0.0055, height: 0.022, stem, segments: 10).turned(z: -(90 - sweep / 2) + 30)
                .at(sin(tipAngle) * radius + 0.009, radius - cos(tipAngle) * radius + 0.027, 0).into(root)
            Shape.sphere(0.0055, stem, segments: 10).at(-sin(tipAngle) * radius, radius - cos(tipAngle) * radius + 0.019, 0).into(root)
        }
        return root
    }

    /// XY 평면의 호(가운데가 가장 낮음)를 따라 단면을 이어 붙인 관. 바나나처럼 휜 덩어리에 쓴다.
    /// - Parameters:
    ///   - thickness: 0...1 위치별 단면 반지름.
    ///   - ridge: 단면 각도별 반지름 배율(모서리 느낌).
    static func bentTube(arcRadius: CGFloat, sweepDegrees: CGFloat, steps: Int, sides: Int,
                         thickness: (CGFloat) -> CGFloat, ridge: (CGFloat) -> CGFloat = { _ in 1 }) -> SCNNode {
        var vertices: [SCNVector3] = []
        var normals: [SCNVector3] = []
        for step in 0...steps {
            let t = CGFloat(step) / CGFloat(steps)
            let a = rad((t - 0.5) * sweepDegrees)
            let center = SCNVector3(sin(a) * arcRadius, arcRadius - cos(a) * arcRadius, 0)
            // 호의 바깥(아래) 방향과 Z축이 단면 평면을 이룬다.
            let outward = SCNVector3(sin(a), -cos(a), 0)
            let r = thickness(t)
            for side in 0...sides {
                let phi = CGFloat(side) / CGFloat(sides) * 2 * .pi
                let k = ridge(phi)
                let nx = outward.x * cos(phi), ny = outward.y * cos(phi), nz = sin(phi)
                vertices.append(SCNVector3(center.x + nx * r * k, center.y + ny * r * k, nz * r * k))
                normals.append(SCNVector3(nx, ny, nz))
            }
        }
        var indices: [Int32] = []
        let stride = sides + 1
        for step in 0..<steps {
            for side in 0..<sides {
                let a = Int32(step * stride + side), b = a + 1
                let c = Int32((step + 1) * stride + side), d = c + 1
                indices.append(contentsOf: [a, b, c, b, d, c])
            }
        }
        let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: vertices), SCNGeometrySource(normals: normals)],
                                   elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        let material = SCNMaterial()
        material.isDoubleSided = true
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }
}

/// 편의시설 그림(화장실 표지·타일). Textures.swift는 옆 세션 담당이라 여기 따로 둔다.
private enum Textures_restroom {
    /// 남녀 픽토그램 한 쌍(정사각).
    static func pictogramTile() -> NSImage {
        drawImage(width: 256, height: 256) { context, size in
            context.setFillColor(Palette.paper.cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            drawPeople(context: context, in: CGRect(x: 20, y: 30, width: size.width - 40, height: size.height - 60))
        }
    }

    /// 벽 표지판: 위 픽토그램, 아래 '화장실'.
    static func sign() -> NSImage {
        drawImage(width: 384, height: 504) { context, size in
            let rect = CGRect(origin: .zero, size: size)
            context.addPath(CGPath(roundedRect: rect, cornerWidth: 28, cornerHeight: 28, transform: nil))
            context.setFillColor(Palette.paper.cgColor)
            context.fillPath()
            drawPeople(context: context, in: CGRect(x: 36, y: 170, width: size.width - 72, height: 290))
            context.setFillColor(Palette.green.cgColor)
            context.fill(CGRect(x: 40, y: 158, width: size.width - 80, height: 5))
            drawText("화장실", in: CGRect(x: 0, y: 30, width: size.width, height: 120), context: context,
                     size: 84, weight: .heavy, color: Palette.greenDark)
        }
    }

    /// 남자(파랑, 왼쪽)·여자(빨강, 오른쪽)와 가운데 세로줄.
    private static func drawPeople(context: CGContext, in rect: CGRect) {
        let half = rect.width / 2
        let blue = NSColor(hex: 0x2F6FC4).cgColor
        let red = NSColor(hex: 0xD9483F).cgColor
        let headR = rect.height * 0.1
        // 가운데 줄
        context.setFillColor(NSColor(hex: 0x9AAFA5).cgColor)
        context.fill(CGRect(x: rect.midX - 3, y: rect.minY, width: 6, height: rect.height))

        // 남자
        let mx = rect.minX + half / 2
        context.setFillColor(blue)
        context.fillEllipse(in: CGRect(x: mx - headR, y: rect.maxY - headR * 2, width: headR * 2, height: headR * 2))
        let shoulder = rect.maxY - headR * 2 - rect.height * 0.05
        let bodyW = half * 0.5
        context.addPath(CGPath(roundedRect: CGRect(x: mx - bodyW / 2, y: rect.minY + rect.height * 0.42, width: bodyW,
                                                   height: shoulder - (rect.minY + rect.height * 0.42)),
                               cornerWidth: bodyW * 0.25, cornerHeight: bodyW * 0.25, transform: nil))
        context.fillPath()
        let legW = bodyW * 0.4
        for dx in [-bodyW / 2 + legW / 2, bodyW / 2 - legW / 2] {
            context.addPath(CGPath(roundedRect: CGRect(x: mx + dx - legW / 2, y: rect.minY, width: legW, height: rect.height * 0.46),
                                   cornerWidth: legW / 2, cornerHeight: legW / 2, transform: nil))
            context.fillPath()
        }

        // 여자: 머리, 삼각 치마, 다리
        let fx = rect.maxX - half / 2
        context.setFillColor(red)
        context.fillEllipse(in: CGRect(x: fx - headR, y: rect.maxY - headR * 2, width: headR * 2, height: headR * 2))
        let skirtTop = shoulder
        let skirtBottom = rect.minY + rect.height * 0.32
        context.move(to: CGPoint(x: fx - bodyW * 0.32, y: skirtTop))
        context.addLine(to: CGPoint(x: fx + bodyW * 0.32, y: skirtTop))
        context.addLine(to: CGPoint(x: fx + bodyW * 0.72, y: skirtBottom))
        context.addLine(to: CGPoint(x: fx - bodyW * 0.72, y: skirtBottom))
        context.closePath()
        context.fillPath()
        for dx in [-bodyW * 0.22, bodyW * 0.22] {
            context.addPath(CGPath(roundedRect: CGRect(x: fx + dx - legW / 2, y: rect.minY, width: legW, height: rect.height * 0.36),
                                   cornerWidth: legW / 2, cornerHeight: legW / 2, transform: nil))
            context.fillPath()
        }
    }

    /// 칸막이 이름판. 크림 바탕에 초록 글자.
    static func namePlate(_ text: String) -> NSImage {
        drawImage(width: 400, height: 150) { context, size in
            let rect = CGRect(origin: .zero, size: size)
            context.addPath(CGPath(roundedRect: rect, cornerWidth: 22, cornerHeight: 22, transform: nil))
            context.setFillColor(Palette.paper.cgColor)
            context.fillPath()
            context.setStrokeColor(Palette.green.cgColor)
            context.setLineWidth(8)
            context.addPath(CGPath(roundedRect: rect.insetBy(dx: 8, dy: 8), cornerWidth: 16, cornerHeight: 16, transform: nil))
            context.strokePath()
            drawText(text, in: rect, context: context, size: 70, weight: .heavy, color: Palette.greenDark)
        }
    }

    /// 안쪽 벽 흰 타일.
    static func tiles() -> NSImage {
        drawImage(width: 512, height: 512) { context, size in
            context.setFillColor(NSColor(hex: 0xEEF1EF).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.setFillColor(NSColor(hex: 0xC9D0CC).cgColor)
            let step: CGFloat = 64
            var p: CGFloat = 0
            while p <= size.width {
                context.fill(CGRect(x: p - 1.5, y: 0, width: 3, height: size.height))
                context.fill(CGRect(x: 0, y: p - 1.5, width: size.width, height: 3))
                p += step
            }
        }
    }
}

// MARK: 확인용 장면

/// 편의시설 모델을 한 줄로 세운 확인용 장면(그림 뽑기 전용). render-shots의 AmenityPreview가 쓴다.
@MainActor
public enum AmenityShowcase {
    /// - Parameters:
    ///   - angle: 위에서 본 방향(도). 0이면 정면.
    ///   - pitch: 내려다보는 각도(도).
    ///   - open: 냉장고·화장실 문을 열고, 전자레인지 창을 켠다.
    public static func make(angle: CGFloat = 0, pitch: CGFloat = 12, open: Bool = false) -> (scene: SCNScene, camera: SCNNode) {
        let scene = SCNScene()
        scene.background.contents = NSColor(hex: 0xEFE7D6)
        let floor = Shape.box(12, 0.1, 6, round: 0, Mat.matte(Palette.oak, roughness: 0.7))
        floor.position = SCNVector3(0, -0.05, 0)
        scene.rootNode.addChildNode(floor)
        // 화장실 문 뒤 벽(구멍 양옆)
        let wallMaterial = Mat.matte(Palette.cream, roughness: 0.9)

        let row = SCNNode.group().turned(y: angle).into(scene.rootNode)

        let purifier = Amenities.waterPurifier()
        purifier.node.at(-4.3, 0, 0).into(row)
        Amenities.paperCup().at(0, 0, 0).into(purifier.cupSpot)

        let fridge = Amenities.fridge()
        fridge.node.at(-3.4, 0, 0).into(row)
        if open { fridge.doorPivot.eulerAngles.y = -rad(100) }

        let pantry = Amenities.pantryCounter(width: 1.6)
        pantry.node.at(-1.75, 0, 0).into(row)
        let microwave = Amenities.microwave()
        microwave.node.at(pantry.microwaveSpot.x, pantry.microwaveSpot.y, pantry.microwaveSpot.z).into(pantry.node)
        if open { microwave.glow.geometry?.firstMaterial?.emission.intensity = 1.0 }

        Amenities.snackTable().at(0.55, 0, 0.2).into(row)

        let restroom = Amenities.restroomDoor()
        restroom.node.at(2.75, 0, -0.3).into(row)
        if open { restroom.doorPivot.eulerAngles.y = rad(95) }
        for x in [2.75 - 0.475 - 0.6, 2.75 + 0.475 + 0.6] as [CGFloat] {
            Shape.box(1.2, 2.4, 0.24, round: 0, wallMaterial).at(x, 1.2, -0.3).into(row)
        }
        Shape.box(0.95, 0.3, 0.24, round: 0, wallMaterial).at(2.75, 2.25, -0.3).into(row)

        // 간식과 종이컵
        let snacks = SCNNode.group().at(4.2, 0, 0.3).into(row)
        for (index, kind) in Amenities.SnackKind.allCases.enumerated() {
            Amenities.snack(kind, colorIndex: index).scaled(2.5).at(CGFloat(index) * 0.32 - 0.32, 0, 0).into(snacks)
        }
        Amenities.paperCup().scaled(2.5).at(0.64, 0, 0).into(snacks)

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
        ambient.light?.intensity = 450
        ambient.light?.color = NSColor(hex: 0xFFF4E2)
        scene.rootNode.addChildNode(ambient)
        scene.lightingEnvironment.contents = Textures.environment(top: .white, bottom: NSColor(hex: 0xC9C2B4))
        scene.lightingEnvironment.intensity = 0.5

        let camera = SCNNode()
        camera.camera = SCNCamera()
        camera.camera?.fieldOfView = 36
        camera.camera?.wantsHDR = true
        camera.camera?.exposureOffset = 0.3
        camera.camera?.whitePoint = 1.5
        let distance: CGFloat = 10.5
        let p = rad(pitch)
        camera.position = SCNVector3(0, 0.8 + distance * sin(p), distance * cos(p))
        camera.look(at: SCNVector3(0, 0.8, 0))
        scene.rootNode.addChildNode(camera)
        return (scene, camera)
    }

    /// 한 가지 모델에 다가간 장면. 0 정수기, 1 냉장고, 2 조리대, 3 간식 탁자, 4 화장실 문, 5 간식.
    public static func closeUp(index: Int, open: Bool) -> (scene: SCNScene, camera: SCNNode) {
        let built = make(angle: 0, pitch: 20, open: open)
        let targets: [(x: CGFloat, y: CGFloat, distance: CGFloat)] = [
            (-4.3, 0.6, 2.6), (-3.4, 0.75, 3.0), (-1.75, 1.0, 3.2), (0.55, 0.45, 2.6), (2.75, 1.1, 4.0), (4.2, 0.2, 1.8),
        ]
        let target = targets[max(0, min(targets.count - 1, index))]
        let p = rad(20)
        built.camera.position = SCNVector3(target.x + target.distance * 0.25, target.y + target.distance * sin(p), target.distance * cos(p))
        built.camera.look(at: SCNVector3(target.x, target.y, 0))
        return built
    }
}
