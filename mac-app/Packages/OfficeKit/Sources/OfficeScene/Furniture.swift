import AppKit
import SceneKit

/// 가구와 소품. 모두 원점이 바닥 가운데에 오도록 만든다.
@MainActor
enum Furniture {

    // MARK: 책상

    struct Desk {
        let node: SCNNode
        /// 모니터 화면. 켜고 끌 때 그림을 바꾼다.
        let screen: SCNNode
        /// 화면에서 나오는 빛. 내 책상에만 둔다(광원 수를 줄이려고).
        let screenLight: SCNNode?
        /// 스탠드 전구. 없을 수도 있다.
        let lampBulb: SCNNode?
        let lampLight: SCNNode?
        /// 책상 위 머그컵을 두는 자리.
        let mugSpot: SCNVector3
    }

    /// 책상 한 벌. 앉는 사람은 +Z 쪽에서 -Z를 보고 앉는다. 화면은 +Z를 향한다.
    static func desk(width: CGFloat = 1.75, depth: CGFloat = 0.86, lamp: Bool, lampLit: Bool = false,
                     drawerOnLeft: Bool = false, monitorX: CGFloat = -0.06, screenGlow: Bool = false,
                     screenSeed: UInt64 = 1) -> Desk {
        let root = SCNNode.group("desk")
        let topY: CGFloat = 0.74
        // 상판
        Shape.box(width, 0.07, depth, round: 0.03, Mat.matte(Palette.deskTop, roughness: 0.6)).at(0, topY, 0).into(root)
        // 다리. 흰 금속 틀.
        let legMaterial = Mat.satin(Palette.white, roughness: 0.45)
        for x in [-width / 2 + 0.1, width / 2 - 0.1] {
            for z in [-depth / 2 + 0.1, depth / 2 - 0.1] {
                Shape.box(0.055, topY - 0.03, 0.055, round: 0.012, legMaterial).at(x, (topY - 0.03) / 2, z).into(root)
            }
            Shape.box(0.045, 0.045, depth - 0.2, round: 0.01, legMaterial).at(x, 0.16, 0).into(root)
        }
        // 서랍장
        let drawerX = (drawerOnLeft ? -1 : 1) * (width / 2 - 0.3)
        let drawer = SCNNode.group().at(drawerX, 0, 0.02).into(root)
        Shape.box(0.42, 0.52, 0.6, round: 0.025, Mat.matte(Palette.white, roughness: 0.6)).at(0, 0.3, 0).into(drawer)
        for index in 0..<3 {
            let y = 0.14 + CGFloat(index) * 0.16
            Shape.box(0.36, 0.008, 0.008, round: 0, Mat.matte(Palette.wallCap)).at(0, y + 0.075, 0.302).into(drawer)
            Shape.capsule(radius: 0.012, height: 0.12, Mat.metal(Palette.brass)).turned(z: 90).at(0, y, 0.31).into(drawer)
        }

        // 모니터. 책상 뒤쪽 가장자리.
        let monitor = SCNNode.group("monitor").at(monitorX, topY + 0.035, -depth / 2 + 0.2).into(root)
        Shape.cylinder(radius: 0.13, height: 0.02, Mat.satin(Palette.graphite, roughness: 0.35)).at(0, 0.01, 0).into(monitor)
        Shape.box(0.05, 0.24, 0.04, round: 0.012, Mat.satin(Palette.graphite, roughness: 0.35)).at(0, 0.13, -0.02).into(monitor)
        Shape.box(0.80, 0.50, 0.045, round: 0.03, Mat.satin(Palette.charcoal, roughness: 0.35)).at(0, 0.46, 0).into(monitor)
        let screen = Shape.plane(0.74, 0.44, Mat.image(Textures.screenDocument(seed: screenSeed), emissive: true), corner: 0.015)
        screen.at(0, 0.465, 0.0235).named("screen").noShadow().into(monitor)

        // 화면 빛. 앉은 사람과 책상을 은은하게 비춘다.
        var screenLight: SCNNode?
        if screenGlow {
            let glow = SCNLight()
            glow.type = .omni
            glow.color = Palette.screenOn
            glow.intensity = 0
            // 앉은 사람 얼굴과 키보드까지만. 멀리 닿으면 밤에 의자 뒤 바닥이 하얗게 번진다.
            glow.attenuationStartDistance = 0.2
            glow.attenuationEndDistance = 1.0
            glow.attenuationFalloffExponent = 2
            let node = SCNNode()
            node.light = glow
            node.at(0, 0.5, 0.45).into(monitor)
            screenLight = node
        }

        // 키보드와 마우스. 앉은 사람 손이 닿게 책상 앞쪽에 둔다.
        Shape.box(0.46, 0.022, 0.16, round: 0.01, Mat.satin(Palette.white, roughness: 0.5)).at(monitorX, topY + 0.046, depth / 2 - 0.11).into(root)
        Shape.box(0.42, 0.006, 0.12, round: 0.002, Mat.matte(NSColor(hex: 0xDAD5C9))).at(monitorX, topY + 0.058, depth / 2 - 0.11).into(root)
        Shape.capsule(radius: 0.034, height: 0.11, Mat.satin(Palette.white, roughness: 0.4))
            .turned(x: 90).scaled(1, 1, 0.6).at(monitorX + 0.38, topY + 0.05, depth / 2 - 0.11).into(root)

        // 공책
        Shape.box(0.24, 0.02, 0.32, round: 0.006, Mat.matte(Palette.green.lighter(0.08))).turned(y: 12).at(-0.58, topY + 0.045, 0.12).into(root)
        Shape.box(0.22, 0.01, 0.30, round: 0.004, Mat.matte(Palette.paper)).turned(y: 12).at(-0.58, topY + 0.058, 0.12).into(root)

        var bulb: SCNNode?
        var lampLight: SCNNode?
        if lamp {
            let built = deskLamp(withLight: lampLit)
            built.node.at(width / 2 - 0.2, topY + 0.035, -depth / 2 + 0.2).turned(y: -35).into(root)
            bulb = built.bulb
            lampLight = built.light
        }
        return Desk(node: root, screen: screen, screenLight: screenLight, lampBulb: bulb, lampLight: lampLight,
                    mugSpot: SCNVector3(0.56, topY + 0.035, 0.2))
    }

    /// 초록 책상 스탠드.
    static func deskLamp(withLight: Bool) -> (node: SCNNode, bulb: SCNNode, light: SCNNode?) {
        let root = SCNNode.group("lamp")
        let green = Mat.satin(Palette.green, roughness: 0.38)
        Shape.cylinder(radius: 0.105, height: 0.03, green).at(0, 0.015, 0).into(root)
        let arm1 = SCNNode.group().at(0, 0.03, 0).turned(z: -14).into(root)
        Shape.capsule(radius: 0.017, height: 0.42, Mat.metal(Palette.brass)).at(0, 0.2, 0).into(arm1)
        let arm2 = SCNNode.group().at(0, 0.4, 0).turned(z: 62).into(arm1)
        Shape.capsule(radius: 0.015, height: 0.36, Mat.metal(Palette.brass)).at(0, 0.17, 0).into(arm2)
        Shape.sphere(0.03, Mat.metal(Palette.brass)).into(arm2)
        // 갓. 받침(-14°)과 둘째 팔(+62°)을 더하면 48°라, 갓을 -62° 돌려야 열린 쪽(-Y)이 책상을 향해
        // 약간 앞으로 기울어 아래를 본다(전에는 +104°라 합이 152°, 열린 쪽이 위로 뒤집혀 있었다).
        let head = SCNNode.group().at(0, 0.34, 0).turned(z: -62).into(arm2)
        Shape.cone(top: 0.045, bottom: 0.125, height: 0.16, green).at(0, 0, 0).into(head)
        let bulb = Shape.sphere(0.052, Mat.glow(Palette.lampWarm, strength: 0))
        // 꺼졌을 때 등갓 안이 까만 구멍처럼 보이지 않게 젖빛 전구 색.
        bulb.geometry?.firstMaterial?.diffuse.contents = NSColor(hex: 0x9C968A)
        bulb.at(0, -0.05, 0).named("lamp.bulb").noShadow().into(head)

        guard withLight else { return (root, bulb, nil) }
        let light = SCNLight()
        light.type = .spot
        light.color = Palette.lampWarm
        light.intensity = 0
        // 책상 위만 비춘다. 넓게(100°)·멀리(2.6m) 퍼지면 밤에 책상 앞 바닥에 하얀 원이 찍힌다.
        // 가장자리가 부드럽게 퍼지도록 넓게(좁으면 동그란 빛 자국이 또렷하게 맺힌다).
        light.spotInnerAngle = 30
        light.spotOuterAngle = 95
        light.attenuationStartDistance = 0.3
        light.attenuationEndDistance = 1.5
        light.attenuationFalloffExponent = 2
        light.castsShadow = false
        let lightNode = SCNNode()
        lightNode.light = light
        // 스포트라이트는 -Z를 비춘다. 갓의 아래쪽(-Y)을 향하게 한다.
        lightNode.at(0, -0.04, 0).turned(x: -90).named("lamp.light").into(head)
        return (root, bulb, lightNode)
    }

    // MARK: 의자

    /// 초록 사무 의자. 앉는 사람은 -Z를 본다.
    static func chair(color: NSColor = Palette.green) -> SCNNode {
        let root = SCNNode.group("chair")
        let fabric = Mat.matte(color, roughness: 0.8)
        let metal = Mat.metal(Palette.steel, roughness: 0.4)
        // 다섯 갈래 받침
        for index in 0..<5 {
            let arm = SCNNode.group().turned(y: CGFloat(index) * 72).into(root)
            Shape.box(0.05, 0.035, 0.3, round: 0.014, metal).at(0, 0.075, 0.15).into(arm)
            Shape.sphere(0.04, Mat.satin(Palette.charcoal, roughness: 0.4)).at(0, 0.04, 0.29).into(arm)
        }
        Shape.cylinder(radius: 0.032, height: 0.3, metal).at(0, 0.22, 0).into(root)
        // 좌판
        Shape.box(0.5, 0.1, 0.48, round: 0.05, fabric).at(0, 0.42, 0).into(root)
        // 등받이. 낮게 해서 앉은 사람의 머리와 어깨가 보이게 한다.
        Shape.box(0.05, 0.3, 0.035, round: 0.012, metal).at(0, 0.56, 0.22).into(root)
        Shape.box(0.46, 0.34, 0.085, round: 0.045, fabric).turned(x: 8).at(0, 0.78, 0.25).into(root)
        return root
    }

    /// 회의실 의자. 팔걸이 없는 작은 의자.
    static func meetingChair() -> SCNNode {
        let root = SCNNode.group("meetingChair")
        let fabric = Mat.matte(Palette.green, roughness: 0.8)
        let wood = Mat.matte(Palette.oakDeep, roughness: 0.6)
        for x in [-0.17, 0.17] as [CGFloat] {
            for z in [-0.16, 0.16] as [CGFloat] {
                Shape.cylinder(radius: 0.02, height: 0.4, wood).at(x, 0.2, z).into(root)
            }
        }
        Shape.box(0.44, 0.07, 0.42, round: 0.035, fabric).at(0, 0.43, 0).into(root)
        Shape.box(0.42, 0.3, 0.06, round: 0.03, fabric).turned(x: 6).at(0, 0.72, 0.19).into(root)
        return root
    }

    // MARK: 화분

    /// 큰 잎 화분.
    static func leafyPlant(height: CGFloat = 1.2, seed: UInt64 = 3) -> SCNNode {
        let root = SCNNode.group("plant")
        var random = SeededRandom(seed)
        let pot = Mat.matte(Palette.terracotta, roughness: 0.75)
        Shape.cone(top: 0.2, bottom: 0.15, height: 0.3, pot).at(0, 0.15, 0).into(root)
        Shape.torus(ring: 0.2, pipe: 0.022, pot).at(0, 0.3, 0).into(root)
        Shape.cylinder(radius: 0.185, height: 0.02, Mat.matte(NSColor(hex: 0x5B4634))).at(0, 0.29, 0).into(root)
        let leafCount = 9
        for index in 0..<leafCount {
            let angle = CGFloat(index) / CGFloat(leafCount) * 360 + CGFloat(random.range(-14, 14))
            let lean = CGFloat(random.range(18, 46))
            let length = height * CGFloat(random.range(0.55, 0.95))
            let stem = SCNNode.group().at(0, 0.3, 0).turned(y: angle).into(root)
            let tilt = SCNNode.group().turned(z: lean).into(stem)
            Shape.capsule(radius: 0.012, height: length, Mat.matte(Palette.leafDeep)).at(0, length / 2, 0).into(tilt)
            let color = index % 2 == 0 ? Palette.leaf : Palette.leafDeep
            Shape.sphere(0.17, Mat.matte(color, roughness: 0.7))
                .scaled(0.9, 1.5, 0.16).turned(z: 12).at(0.02, length, 0).into(tilt)
        }
        return root
    }

    /// 둥근 잎 덩어리의 키 큰 화분.
    static func tallPlant(height: CGFloat = 1.7) -> SCNNode {
        let root = SCNNode.group("plant")
        let pot = Mat.matte(Palette.white, roughness: 0.55)
        Shape.cone(top: 0.2, bottom: 0.16, height: 0.36, pot).at(0, 0.18, 0).into(root)
        Shape.cylinder(radius: 0.185, height: 0.02, Mat.matte(NSColor(hex: 0x5B4634))).at(0, 0.35, 0).into(root)
        Shape.capsule(radius: 0.028, height: height - 0.5, Mat.matte(Palette.walnut)).at(0, 0.35 + (height - 0.5) / 2, 0).into(root)
        let blobs: [(CGFloat, CGFloat, CGFloat, CGFloat)] = [
            (0, height - 0.18, 0, 0.36), (0.22, height - 0.42, 0.08, 0.27), (-0.2, height - 0.36, -0.1, 0.29),
            (0.02, height - 0.5, -0.2, 0.24), (-0.05, height + 0.04, 0.12, 0.25),
        ]
        for (index, blob) in blobs.enumerated() {
            Shape.sphere(blob.3, Mat.matte(index % 2 == 0 ? Palette.leaf : Palette.leafDeep, roughness: 0.75))
                .at(blob.0, blob.1, blob.2).into(root)
        }
        return root
    }

    /// 창대에 올리는 작은 화분.
    static func smallPlant() -> SCNNode {
        let root = SCNNode.group("plant")
        Shape.cone(top: 0.08, bottom: 0.06, height: 0.11, Mat.matte(Palette.terracotta)).at(0, 0.055, 0).into(root)
        for (x, z, r) in [(0.0, 0.0, 0.085), (0.06, 0.03, 0.06), (-0.05, -0.02, 0.065)] as [(CGFloat, CGFloat, CGFloat)] {
            Shape.sphere(r, Mat.matte(Palette.leaf, roughness: 0.75)).at(x, 0.15 + r * 0.4, z).into(root)
        }
        return root
    }

    // MARK: 머그컵

    static func mug(color: NSColor = Palette.mug) -> SCNNode {
        let root = SCNNode.group("mug")
        let body = Mat.satin(color, roughness: 0.3)
        Shape.tube(inner: 0.036, outer: 0.044, height: 0.09, body).at(0, 0.045, 0).into(root)
        Shape.cylinder(radius: 0.04, height: 0.01, body).at(0, 0.006, 0).into(root)
        Shape.cylinder(radius: 0.036, height: 0.004, Mat.satin(NSColor(hex: 0x5A3A27), roughness: 0.3)).at(0, 0.075, 0).into(root)
        Shape.torus(ring: 0.026, pipe: 0.008, body).turned(x: 90).at(0.05, 0.045, 0).into(root)
        return root
    }

    // MARK: 책장

    static func bookshelf(width: CGFloat = 2.4, height: CGFloat = 1.9) -> SCNNode {
        let root = SCNNode.group("bookshelf")
        var random = SeededRandom(5)
        let wood = Mat.matte(Palette.oak.lighter(0.06), roughness: 0.65)
        let depth: CGFloat = 0.36
        Shape.box(width, height, 0.03, round: 0.008, Mat.matte(Palette.oakDeep, roughness: 0.7)).at(0, height / 2, -depth / 2 + 0.015).into(root)
        for x in [-width / 2 + 0.025, width / 2 - 0.025] {
            Shape.box(0.05, height, depth, round: 0.012, wood).at(x, height / 2, 0).into(root)
        }
        let shelves = 4
        let gap = (height - 0.05) / CGFloat(shelves)
        for index in 0...shelves {
            Shape.box(width, 0.05, depth, round: 0.012, wood).at(0, 0.025 + CGFloat(index) * gap, 0).into(root)
        }
        let spines: [NSColor] = [Palette.green, Palette.greenLight, Palette.paper, NSColor(hex: 0xD9A441),
                                 Palette.terracotta, NSColor(hex: 0xE8DCC2), NSColor(hex: 0x7C8F86), Palette.white]
        for shelf in 0..<shelves {
            var x = -width / 2 + 0.09
            let baseY = 0.05 + CGFloat(shelf) * gap
            while x < width / 2 - 0.2 {
                let roll = random.next()
                if roll < 0.12 {
                    // 빈칸에 작은 화분이나 상자
                    if random.next() < 0.5 {
                        smallPlant().at(x + 0.1, baseY, 0.02).into(root)
                    } else {
                        Shape.box(0.24, 0.16, 0.22, round: 0.02, Mat.matte(Palette.creamLower)).at(x + 0.12, baseY + 0.08, 0.02).into(root)
                    }
                    x += 0.3
                    continue
                }
                let thickness = CGFloat(random.range(0.045, 0.085))
                let bookHeight = min(gap - 0.09, CGFloat(random.range(0.25, 0.37)))
                let color = spines[Int(random.next() * Double(spines.count)) % spines.count]
                let lean: CGFloat = random.next() < 0.1 ? 10 : 0
                Shape.box(thickness, bookHeight, 0.25, round: 0.006, Mat.matte(color, roughness: 0.75))
                    .turned(z: lean).at(x + thickness / 2, baseY + bookHeight / 2, 0.02).into(root)
                x += thickness + 0.006
            }
        }
        return root
    }

    // MARK: 조명

    /// 공중에 매달린 등. 줄은 화면 밖 위로 이어진다.
    static func pendant(cordLength: CGFloat = 1.5) -> (node: SCNNode, bulb: SCNNode) {
        let root = SCNNode.group("pendant")
        // 천장이 없는 모형이라 줄은 짧게 두고 위로 갈수록 옅어지게 한다.
        let pieces = 6
        let piece = cordLength / CGFloat(pieces)
        for index in 0..<pieces {
            let cord = Shape.cylinder(radius: 0.009, height: piece, Mat.matte(Palette.graphite), segments: 10)
            cord.at(0, 0.2 + piece * (CGFloat(index) + 0.5), 0).noShadow().into(root)
            cord.opacity = 1 - CGFloat(index) / CGFloat(pieces - 1) * 0.95
        }
        Shape.cylinder(radius: 0.03, height: 0.08, Mat.metal(Palette.brass)).at(0, 0.2, 0).noShadow().into(root)
        Shape.cone(top: 0.05, bottom: 0.21, height: 0.2, Mat.satin(Palette.white, roughness: 0.45)).at(0, 0.08, 0).noShadow().into(root)
        let bulb = Shape.sphere(0.075, Mat.glow(Palette.lampWarm, strength: 0))
        bulb.at(0, -0.02, 0).named("pendant.bulb").noShadow().into(root)
        return (root, bulb)
    }

    /// 문 옆 복도등.
    static func hallLight() -> (node: SCNNode, bulb: SCNNode) {
        let root = SCNNode.group("hallLight")
        Shape.cylinder(radius: 0.12, height: 0.03, Mat.metal(Palette.brass)).at(0, 0.015, 0).into(root)
        Shape.capsule(radius: 0.016, height: 1.5, Mat.metal(Palette.brass)).at(0, 0.76, 0).into(root)
        Shape.cone(top: 0.1, bottom: 0.17, height: 0.24, Mat.matte(NSColor(hex: 0xE6DCC8))).at(0, 1.58, 0).into(root)
        let bulb = Shape.sphere(0.07, Mat.glow(Palette.lampWarm, strength: 0))
        bulb.at(0, 1.5, 0).named("hall.bulb").noShadow().into(root)
        return (root, bulb)
    }

    // MARK: 벽에 다는 것

    /// 벽시계. 바늘이 가상 시각을 가리킨다.
    static func wallClock() -> (node: SCNNode, hour: SCNNode, minute: SCNNode) {
        let root = SCNNode.group("clock")
        Shape.cylinder(radius: 0.34, height: 0.05, Mat.satin(Palette.green, roughness: 0.4)).turned(x: 90).into(root)
        Shape.plane(0.6, 0.6, Mat.image(Textures.clockFace(), roughness: 0.6), corner: 0.3).at(0, 0, 0.027).noShadow().into(root)
        let hour = SCNNode.group("clock.hour").at(0, 0, 0.035).into(root)
        Shape.box(0.035, 0.17, 0.012, round: 0.005, Mat.matte(Palette.greenDark)).at(0, 0.075, 0).noShadow().into(hour)
        let minute = SCNNode.group("clock.minute").at(0, 0, 0.045).into(root)
        Shape.box(0.024, 0.25, 0.012, round: 0.005, Mat.matte(Palette.greenDark)).at(0, 0.115, 0).noShadow().into(minute)
        Shape.cylinder(radius: 0.022, height: 0.02, Mat.metal(Palette.brass)).turned(x: 90).at(0, 0, 0.05).noShadow().into(root)
        return (root, hour, minute)
    }

    /// 틀이 있는 판. 게시판이나 벽 화면.
    static func framedBoard(width: CGFloat, height: CGFloat, image: NSImage, frame: NSColor, emissive: Bool) -> (node: SCNNode, face: SCNNode) {
        let root = SCNNode.group("board")
        Shape.box(width + 0.1, height + 0.1, 0.05, round: 0.02, Mat.matte(frame)).into(root)
        let face = Shape.plane(width, height, Mat.image(image, roughness: 0.7, emissive: emissive))
        face.at(0, 0, 0.027).noShadow().into(root)
        return (root, face)
    }

    // MARK: 커피 자리

    /// 수납장 위의 커피 기계와 머그컵.
    static func coffeeCorner() -> SCNNode {
        let root = SCNNode.group("coffee")
        Shape.box(1.5, 0.82, 0.5, round: 0.03, Mat.matte(Palette.white, roughness: 0.6)).at(0, 0.41, 0).into(root)
        Shape.box(1.56, 0.05, 0.56, round: 0.02, Mat.matte(Palette.deskTop, roughness: 0.6)).at(0, 0.845, 0).into(root)
        for x in [-0.37, 0.37] as [CGFloat] {
            Shape.capsule(radius: 0.012, height: 0.14, Mat.metal(Palette.brass)).at(x * 0.25, 0.5, 0.262).into(root)
        }
        Shape.box(0.008, 0.7, 0.008, round: 0, Mat.matte(Palette.wallCap)).at(0, 0.42, 0.252).into(root)
        // 커피 기계
        let machine = SCNNode.group().at(-0.38, 0.87, 0).into(root)
        Shape.box(0.34, 0.42, 0.34, round: 0.04, Mat.satin(Palette.green, roughness: 0.4)).at(0, 0.21, 0).into(machine)
        Shape.box(0.24, 0.05, 0.2, round: 0.015, Mat.metal(Palette.steel)).at(0, 0.03, 0.12).into(machine)
        Shape.cylinder(radius: 0.03, height: 0.08, Mat.metal(Palette.steel)).at(0, 0.24, 0.13).into(machine)
        Shape.sphere(0.022, Mat.glow(NSColor(hex: 0xFFB45A), strength: 1.2)).at(0.11, 0.34, 0.172).noShadow().into(machine)
        // 머그컵 줄
        let colors: [NSColor] = [Palette.mug, NSColor(hex: 0xE9B94F), Palette.greenLight, NSColor(hex: 0xE58B6B)]
        for (index, color) in colors.enumerated() {
            mug(color: color).turned(y: CGFloat(index) * 40).at(0.05 + CGFloat(index) * 0.16, 0.87, 0.02).into(root)
        }
        return root
    }

    // MARK: 회의 탁자

    static func meetingTable() -> SCNNode {
        let root = SCNNode.group("meetingTable")
        Shape.box(2.4, 0.07, 1.15, round: 0.035, Mat.matte(Palette.white, roughness: 0.5)).at(0, 0.73, 0).into(root)
        for x in [-0.9, 0.9] as [CGFloat] {
            Shape.box(0.1, 0.7, 0.75, round: 0.03, Mat.matte(Palette.oak, roughness: 0.6)).at(x, 0.35, 0).into(root)
        }
        // 탁상 마이크. 아침 PT에서 쓴다.
        let mic = SCNNode.group("mic").at(0.25, 0.765, 0.05).into(root)
        Shape.cylinder(radius: 0.085, height: 0.022, Mat.satin(Palette.charcoal, roughness: 0.4)).at(0, 0.011, 0).into(mic)
        Shape.capsule(radius: 0.012, height: 0.26, Mat.metal(Palette.steel)).turned(x: -18).at(0, 0.14, 0.035).into(mic)
        Shape.capsule(radius: 0.038, height: 0.12, Mat.satin(Palette.graphite, roughness: 0.6)).turned(x: -18).at(0, 0.3, 0.085).into(mic)
        Shape.sphere(0.012, Mat.glow(NSColor(hex: 0x6EE0A8), strength: 1.4)).at(0.05, 0.03, 0.05).named("mic.led").noShadow().into(mic)
        // 종이
        Shape.box(0.21, 0.004, 0.3, round: 0, Mat.image(Textures.paperSheet(), roughness: 0.8)).turned(y: -14).at(-0.45, 0.768, 0.12).into(root)
        return root
    }

    // MARK: 서류

    static func paperStack(sheets: Int = 6) -> SCNNode {
        let root = SCNNode.group("papers")
        var random = SeededRandom(UInt64(sheets) + 30)
        for index in 0..<sheets {
            Shape.box(0.22, 0.012, 0.31, round: 0.002, Mat.matte(Palette.paper, roughness: 0.85))
                .turned(y: CGFloat(random.range(-9, 9))).at(0, 0.006 + CGFloat(index) * 0.012, 0).into(root)
        }
        return root
    }

    /// 서류철. 팀장이 들고 있다.
    static func folder() -> SCNNode {
        let root = SCNNode.group("folder")
        Shape.box(0.24, 0.32, 0.03, round: 0.012, Mat.matte(NSColor(hex: 0xD9A441), roughness: 0.7)).into(root)
        Shape.box(0.2, 0.27, 0.012, round: 0.004, Mat.image(Textures.paperSheet(), roughness: 0.8)).at(0, -0.005, 0.02).into(root)
        Shape.box(0.1, 0.035, 0.02, round: 0.008, Mat.metal(Palette.steel)).at(0, 0.145, 0.022).into(root)
        return root
    }
}
