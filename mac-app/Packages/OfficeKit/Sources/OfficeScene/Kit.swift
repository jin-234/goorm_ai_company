import AppKit
import SceneKit

// 장면을 코드로 짓기 위한 작은 도구 모음.
// 외부 3D 모델 파일 없이 기본 도형만으로 사무실과 사람을 만든다.

extension NSColor {
    /// 0xRRGGBB
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                  green: CGFloat((hex >> 8) & 0xFF) / 255,
                  blue: CGFloat(hex & 0xFF) / 255,
                  alpha: alpha)
    }

    /// 두 색을 섞는다. t = 0이면 자신, 1이면 other.
    func mixed(_ other: NSColor, _ t: CGFloat) -> NSColor {
        let a = usingColorSpace(.sRGB) ?? self
        let b = other.usingColorSpace(.sRGB) ?? other
        let k = max(0, min(1, t))
        return NSColor(srgbRed: a.redComponent + (b.redComponent - a.redComponent) * k,
                       green: a.greenComponent + (b.greenComponent - a.greenComponent) * k,
                       blue: a.blueComponent + (b.blueComponent - a.blueComponent) * k,
                       alpha: a.alphaComponent + (b.alphaComponent - a.alphaComponent) * k)
    }

    func darker(_ amount: CGFloat) -> NSColor { mixed(.black, amount) }
    func lighter(_ amount: CGFloat) -> NSColor { mixed(.white, amount) }
}

/// 재질.
enum Mat {
    /// 무광. 점토나 도색한 나무 같은 느낌.
    static func matte(_ color: NSColor, roughness: CGFloat = 0.86) -> SCNMaterial {
        let material = SCNMaterial()
        material.lightingModel = .physicallyBased
        material.diffuse.contents = color
        material.roughness.contents = roughness
        material.metalness.contents = 0.0
        return material
    }

    /// 은은한 광택. 도자기, 플라스틱.
    static func satin(_ color: NSColor, roughness: CGFloat = 0.42) -> SCNMaterial {
        matte(color, roughness: roughness)
    }

    /// 금속.
    static func metal(_ color: NSColor, roughness: CGFloat = 0.38) -> SCNMaterial {
        let material = matte(color, roughness: roughness)
        material.metalness.contents = 0.85
        return material
    }

    /// 스스로 빛나는 면. 화면, 전구, 창밖.
    static func glow(_ color: NSColor, strength: CGFloat = 1) -> SCNMaterial {
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = NSColor.black
        material.emission.contents = color
        material.emission.intensity = strength
        return material
    }

    /// 유리.
    static func glass(_ tint: NSColor = NSColor(hex: 0xDDEFEA), opacity: CGFloat = 0.22) -> SCNMaterial {
        let material = SCNMaterial()
        material.lightingModel = .constant
        material.diffuse.contents = tint
        material.transparency = opacity
        material.transparencyMode = .aOne
        material.blendMode = .alpha
        material.isDoubleSided = true
        material.writesToDepthBuffer = false
        return material
    }

    /// 그림을 붙인 면.
    static func image(_ image: NSImage, roughness: CGFloat = 0.8, emissive: Bool = false) -> SCNMaterial {
        let material = SCNMaterial()
        if emissive {
            material.lightingModel = .constant
            material.diffuse.contents = NSColor.black
            material.emission.contents = image
        } else {
            material.lightingModel = .physicallyBased
            material.diffuse.contents = image
            material.roughness.contents = roughness
            material.metalness.contents = 0.0
        }
        material.diffuse.mipFilter = .linear
        material.emission.mipFilter = .linear
        return material
    }
}

/// 도형.
enum Shape {
    static func box(_ width: CGFloat, _ height: CGFloat, _ length: CGFloat, round: CGFloat = 0.02,
                    _ material: SCNMaterial) -> SCNNode {
        let geometry = SCNBox(width: width, height: height, length: length,
                              chamferRadius: min(round, min(width, height, length) / 2))
        geometry.chamferSegmentCount = round > 0.03 ? 6 : 3
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    static func cylinder(radius: CGFloat, height: CGFloat, _ material: SCNMaterial, segments: Int = 36) -> SCNNode {
        let geometry = SCNCylinder(radius: radius, height: height)
        geometry.radialSegmentCount = segments
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    static func cone(top: CGFloat, bottom: CGFloat, height: CGFloat, _ material: SCNMaterial, segments: Int = 36) -> SCNNode {
        let geometry = SCNCone(topRadius: top, bottomRadius: bottom, height: height)
        geometry.radialSegmentCount = segments
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    static func sphere(_ radius: CGFloat, _ material: SCNMaterial, segments: Int = 40) -> SCNNode {
        let geometry = SCNSphere(radius: radius)
        geometry.segmentCount = segments
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    static func capsule(radius: CGFloat, height: CGFloat, _ material: SCNMaterial, segments: Int = 32) -> SCNNode {
        let geometry = SCNCapsule(capRadius: radius, height: max(height, radius * 2))
        geometry.radialSegmentCount = segments
        geometry.capSegmentCount = segments / 2
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    static func torus(ring: CGFloat, pipe: CGFloat, _ material: SCNMaterial) -> SCNNode {
        let geometry = SCNTorus(ringRadius: ring, pipeRadius: pipe)
        geometry.ringSegmentCount = 40
        geometry.pipeSegmentCount = 16
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    static func tube(inner: CGFloat, outer: CGFloat, height: CGFloat, _ material: SCNMaterial) -> SCNNode {
        let geometry = SCNTube(innerRadius: inner, outerRadius: outer, height: height)
        geometry.radialSegmentCount = 36
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    /// 바닥에 눕힌 평면. 위를 향한다.
    static func floorPlane(_ width: CGFloat, _ length: CGFloat, _ material: SCNMaterial) -> SCNNode {
        let geometry = SCNPlane(width: width, height: length)
        geometry.materials = [material]
        let node = SCNNode(geometry: geometry)
        node.eulerAngles.x = -.pi / 2
        return node
    }

    /// 세워 둔 평면. +Z를 향한다.
    static func plane(_ width: CGFloat, _ height: CGFloat, _ material: SCNMaterial, corner: CGFloat = 0) -> SCNNode {
        let geometry = SCNPlane(width: width, height: height)
        geometry.cornerRadius = corner
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    /// 세로축을 중심으로 옆모습 선을 돌려 만든 도형. 종 모양 몸통처럼 기본 도형으로 안 되는 둥근 덩어리에 쓴다.
    /// - Parameters:
    ///   - profile: 아래에서 위로 가는 (반지름, 높이) 점들.
    ///   - arc: 도는 범위(도). 앞(−Z)이 가운데다. 360이면 한 바퀴, 60이면 앞쪽에만 붙는 띠.
    ///   - center: 범위의 가운데가 향하는 방향(도). 0이면 앞(−Z), 180이면 뒤(+Z), 90이면 오른쪽(+X).
    static func lathe(_ profile: [(r: CGFloat, y: CGFloat)], segments: Int = 40, arc: CGFloat = 360,
                      center: CGFloat = 0, _ material: SCNMaterial) -> SCNNode {
        guard profile.count >= 2 else { return SCNNode() }
        let full = arc >= 359.9
        let steps = full ? segments : max(4, Int((CGFloat(segments) * arc / 360).rounded(.up)))
        // 각도 0이 +X, −90이 앞(−Z)이다.
        let middle = rad(center - 90)
        let start = middle - rad(arc) / 2
        var vertices: [SCNVector3] = []
        var normals: [SCNVector3] = []
        for (index, point) in profile.enumerated() {
            let before = profile[max(0, index - 1)], after = profile[min(profile.count - 1, index + 1)]
            var dr = after.r - before.r, dy = after.y - before.y
            let length = max(0.000_001, (dr * dr + dy * dy).squareRoot())
            dr /= length
            dy /= length
            // 옆모습 선에 수직인 바깥 방향.
            let outward = dy, upward = -dr
            for step in 0...steps {
                let angle = start + rad(arc) * CGFloat(step) / CGFloat(steps)
                vertices.append(SCNVector3(point.r * cos(angle), point.y, point.r * sin(angle)))
                normals.append(SCNVector3(outward * cos(angle), upward, outward * sin(angle)))
            }
        }
        let stride = steps + 1
        var indices: [Int32] = []
        for row in 0..<(profile.count - 1) {
            for step in 0..<steps {
                let a = Int32(row * stride + step), b = a + 1
                let c = Int32((row + 1) * stride + step), d = c + 1
                indices.append(contentsOf: [a, c, b, b, c, d])
            }
        }
        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: vertices), SCNGeometrySource(normals: normals)],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }

    /// 몇 개의 점을 부드러운 곡선으로 잇는다(옆모습 선을 손쉽게 그리려고).
    static func smooth(_ points: [(r: CGFloat, y: CGFloat)], steps: Int = 6) -> [(r: CGFloat, y: CGFloat)] {
        guard points.count >= 3 else { return points }
        var result: [(r: CGFloat, y: CGFloat)] = []
        for index in 0..<(points.count - 1) {
            let p0 = points[max(0, index - 1)], p1 = points[index]
            let p2 = points[index + 1], p3 = points[min(points.count - 1, index + 2)]
            for step in 0..<steps {
                let t = CGFloat(step) / CGFloat(steps), t2 = t * t, t3 = t2 * t
                func blend(_ a: CGFloat, _ b: CGFloat, _ c: CGFloat, _ d: CGFloat) -> CGFloat {
                    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
                }
                result.append((r: max(0, blend(p0.r, p1.r, p2.r, p3.r)), y: blend(p0.y, p1.y, p2.y, p3.y)))
            }
        }
        if let last = points.last { result.append(last) }
        return result
    }

    /// 네 점을 잇는 한쪽 면짜리 판. 앞면은 (p3 − p0) × (p1 − p0) 방향을 향한다.
    static func quad(_ p0: SCNVector3, _ p1: SCNVector3, _ p2: SCNVector3, _ p3: SCNVector3,
                     _ material: SCNMaterial) -> SCNNode {
        let a = SCNVector3(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z)
        let b = SCNVector3(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
        var normal = SCNVector3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
        let length = max(0.000_001, (normal.x * normal.x + normal.y * normal.y + normal.z * normal.z).squareRoot())
        normal = SCNVector3(normal.x / length, normal.y / length, normal.z / length)
        let indices: [Int32] = [0, 3, 1, 1, 3, 2]
        let geometry = SCNGeometry(
            sources: [SCNGeometrySource(vertices: [p0, p1, p2, p3]),
                      SCNGeometrySource(normals: [normal, normal, normal, normal])],
            elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
        geometry.materials = [material]
        return SCNNode(geometry: geometry)
    }
}

extension SCNNode {
    @discardableResult
    func at(_ x: CGFloat, _ y: CGFloat, _ z: CGFloat) -> SCNNode {
        position = SCNVector3(x, y, z)
        return self
    }

    /// 도 단위 회전.
    @discardableResult
    func turned(x: CGFloat = 0, y: CGFloat = 0, z: CGFloat = 0) -> SCNNode {
        eulerAngles = SCNVector3(x * .pi / 180, y * .pi / 180, z * .pi / 180)
        return self
    }

    @discardableResult
    func scaled(_ x: CGFloat, _ y: CGFloat, _ z: CGFloat) -> SCNNode {
        scale = SCNVector3(x, y, z)
        return self
    }

    @discardableResult
    func scaled(_ uniform: CGFloat) -> SCNNode {
        scale = SCNVector3(uniform, uniform, uniform)
        return self
    }

    @discardableResult
    func named(_ value: String) -> SCNNode {
        name = value
        return self
    }

    @discardableResult
    func adding(_ children: SCNNode...) -> SCNNode {
        children.forEach(addChildNode)
        return self
    }

    @discardableResult
    func into(_ parent: SCNNode) -> SCNNode {
        parent.addChildNode(self)
        return self
    }

    /// 그림자를 드리우지 않게 한다. 발광면, 유리 등.
    @discardableResult
    func noShadow() -> SCNNode {
        castsShadow = false
        enumerateChildNodes { child, _ in child.castsShadow = false }
        return self
    }

    static func group(_ name: String? = nil) -> SCNNode {
        let node = SCNNode()
        node.name = name
        return node
    }
}

/// 각도(도) → 라디안.
func rad(_ degrees: CGFloat) -> CGFloat { degrees * .pi / 180 }

/// 부드럽게 0→1.
func smoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    guard edge1 != edge0 else { return x < edge0 ? 0 : 1 }
    let t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
}

func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

/// 그림 그리기 도우미. 원점은 왼쪽 아래.
func drawImage(width: Int, height: Int, _ draw: (CGContext, CGSize) -> Void) -> NSImage {
    let size = CGSize(width: width, height: height)
    let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        return NSImage(size: size)
    }
    draw(context, size)
    guard let image = context.makeImage() else { return NSImage(size: size) }
    return NSImage(cgImage: image, size: size)
}

/// 글자를 그림에 그린다. 한글 포함.
func drawText(_ text: String, in rect: CGRect, context: CGContext, size: CGFloat, weight: NSFont.Weight = .semibold,
              color: NSColor, alignment: NSTextAlignment = .center) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    let attributes: [NSAttributedString.Key: Any] = [
        .font: NSFont.systemFont(ofSize: size, weight: weight),
        .foregroundColor: color,
        .paragraphStyle: paragraph,
    ]
    let graphics = NSGraphicsContext(cgContext: context, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    let attributed = NSAttributedString(string: text, attributes: attributes)
    let bounds = attributed.boundingRect(with: rect.size, options: [.usesLineFragmentOrigin])
    let origin = CGPoint(x: rect.minX, y: rect.midY - bounds.height / 2)
    attributed.draw(with: CGRect(origin: origin, size: CGSize(width: rect.width, height: bounds.height)),
                    options: [.usesLineFragmentOrigin])
    NSGraphicsContext.restoreGraphicsState()
}

/// 고정된 씨앗으로 같은 무늬를 다시 만드는 난수.
struct SeededRandom {
    private var state: UInt64

    init(_ seed: UInt64) { state = seed &* 0x9E3779B97F4A7C15 | 1 }

    mutating func next() -> Double {
        state ^= state << 13
        state ^= state >> 7
        state ^= state << 17
        return Double(state % 1_000_000) / 1_000_000
    }

    mutating func range(_ low: Double, _ high: Double) -> Double { low + (high - low) * next() }
}
