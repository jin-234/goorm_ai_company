import AppKit
import SceneKit
import simd

/// 기본 도형으로 만든 둥근 3등신 사람.
///
/// 원점은 두 발 사이 바닥이고 -Z를 본다. 단위는 미터(키 약 1.1).
/// 비율과 동작 수치는 귀여운 3D 캐릭터 조사 결과를 시작값으로 썼다.
/// 표절을 피하려고 가로로 긴 알약 눈, 코 없음, 정수리 모양으로 사람을 구분한다.
@MainActor
final class Person {

    enum HairStyle {
        /// 정수리 똥머리. 김서울.
        case bun
        /// 옆 가르마 짧은 머리. 팀장.
        case sidePart
        /// 후드를 쓴 머리. 동기 이하준.
        case hoodUp
        /// 단발과 등 뒤 후드. 동기 박서윤.
        case bob
        /// 짧은 머리에 야구 모자. 택배 기사.
        case cap
        /// 단정한 짧은 머리, 희끗함. 부장.
        case neat
        /// 단발 반묶음. 과장.
        case halfUp
        /// 앞머리를 올린 짧은 머리. 대리.
        case quiff
        /// 긴 머리를 낮게 묶음. 선배 사원.
        case lowTail
    }

    struct Look {
        var hair: NSColor
        var style: HairStyle
        var top: NSColor
        var pants = NSColor(hex: 0x3D4860)
        var skin = NSColor(hex: 0xF9D2BC)
        /// 동작 빠르기. 사람마다 조금씩 달라야 로봇처럼 안 보인다.
        var rate: Double = 1
        var phase: Double = 0
    }

    enum Activity: Equatable {
        case hidden
        /// 앉아서 타자를 친다.
        case sitTyping
        /// 앉아서 타자를 치다가 가끔 머그컵을 든다.
        case sitTypingWithMug
        /// 서서 쉰다.
        case stand
        /// 서서 머그컵을 마신다.
        case standMug
        /// 가방을 앞에 들고 퇴근 준비.
        case standBag
        /// 손을 흔든다.
        case wave
        /// 걷는다. 위치는 `walk(along:)`가 옮긴다.
        case walk
        /// 회의 자리에 앉아 발표를 듣는다. 가끔 고개를 끄덕인다.
        case sitListen
        /// 서서 발표한다. 한 손으로 화면을 가리키며 말한다.
        case present
        /// 창가에서 전화 통화.
        case phone
        /// 기지개를 켠다.
        case stretch
        /// 택배 상자를 든다.
        case standBox
        /// 정수기·커피 기계 앞에서 컵을 받친다(왼손으로 버튼).
        case fillCup
        /// 서서 종이컵으로 물을 마신다.
        case drinkCup
        /// 걸상에 앉아 간식을 먹는다.
        case sitEat
        /// 손을 앞으로 뻗는다(냉장고 문 열기, 간식 고르기).
        case reach
        /// 책상 앞에 서서 짐을 챙긴다.
        case packUp
        /// 고개 숙여 인사한다.
        case bow
        /// 상자를 내민다(건네기·받기).
        case offerBox
        /// 서류를 가슴께에 들고 선다(보고하러 가는 길, 기다림).
        case holdPaper
        /// 서류를 두 손으로 내민다.
        case offerPaper
        /// 서서 고개를 끄덕이며 듣는다.
        case nod
        /// 앉아서 받은 서류를 읽는다(상사).
        case sitReview
        /// 앉아서 손짓하며 설명한다(상사의 피드백).
        case sitExplain
    }

    /// 차례로 하는 일. 자리 비움, 동료의 잠깐 외출, 택배 기사, 퇴근 연출에 쓴다.
    enum Step {
        /// 경로를 따라 걷는다. 문을 지나면 무대가 문 여닫기를 끼워 넣는다.
        case walk([SCNVector3], speed: Float = 1.15)
        /// 문 검사 없이 그대로 걷는다.
        case rawWalk([SCNVector3], speed: Float)
        /// 그 동작을 몇 초 한다. `.infinity`면 다음 지시까지 계속.
        case act(Activity, Double)
        /// 그 방향(도)을 본다.
        case face(CGFloat)
        /// 그 자리로 옮긴다.
        case place(SCNVector3)
        /// 바로 실행한다.
        case run(@MainActor () -> Void)
        /// 투명도를 몇 초에 걸쳐 바꾼다.
        case fade(CGFloat, Double)
        /// 문 앞(열기, true)이나 문 지난 뒤(닫기, false). 무대가 그때 상황을 보고 할 일을 끼워 넣는다.
        /// 세 번째 값은 문을 지나는 방향(도).
        case door(Int, Bool, CGFloat)
        /// 문 앞 줄. 앞사람이 지나는 중이면 뒤에 서서 기다린다(문 번호, 문 앞 자리, 지나는 방향).
        case doorQueue(Int, SCNVector3, CGFloat)
        /// 조건이 맞을 때까지(길어야 몇 초) 서서 기다린다.
        case waitUntil(@MainActor () -> Bool, Double)
    }

    /// 줄 단계에서 끼워 넣을 할 일(무대가 넣어 준다).
    var queueHandler: ((Person, Int, SCNVector3, CGFloat) -> [Step])?

    /// 걷기를 문 여닫기가 들어간 할 일로 바꾼다(무대가 넣어 준다). 문을 안 지나면 nil.
    var walkExpander: ((Person, [SCNVector3], Float) -> [Step]?)?

    /// 지금 위치와 앞으로 걸을 점들(사무실 좌표 XZ). 다른 사람이 문을 닫아도 되는지 볼 때 쓴다.
    func upcomingPoints(in space: SCNNode) -> [SIMD2<Float>] {
        let here = root.convertPosition(SCNVector3Zero, to: space)
        var result = [SIMD2<Float>(Float(here.x), Float(here.z))]
        if activity == .walk { result += path.map { SIMD2<Float>($0.x, $0.z) } }
        for step in steps {
            switch step {
            case .walk(let points, _), .rawWalk(let points, _): result += points.map { SIMD2<Float>(Float($0.x), Float($0.z)) }
            default: break
            }
        }
        return result
    }

    /// 문 단계에서 끼워 넣을 할 일을 정한다(무대가 넣어 준다).
    var doorHandler: ((Person, Int, Bool, CGFloat) -> [Step])?

    /// 앞으로 그 문을 지날 예정인지.
    func willPass(door index: Int) -> Bool {
        steps.contains { if case .door(let d, true, _) = $0 { return d == index }; return false }
    }

    let root = SCNNode()
    let look: Look
    /// 조직도의 id(예: "manager"). 택배 기사는 빈 문자열.
    var memberID = ""
    private(set) var activity: Activity = .stand

    // 관절
    private let hips = SCNNode()
    private let torso = SCNNode()
    private let headPivot = SCNNode()
    private let armL = SCNNode()
    private let armR = SCNNode()
    private let legL = SCNNode()
    private let legR = SCNNode()
    private let handR = SCNNode()
    private let handL = SCNNode()
    private var phone: SCNNode?
    private var box: SCNNode?
    /// 오른손 종이컵, 간식.
    private var paperCup: SCNNode?
    private var snack: SCNNode?
    /// 가방 멜빵(앞쪽). 등 가방과 함께 보인다.
    private var straps: SCNNode?
    /// 서류철을 들고 있는지.
    var holdsPaper = false {
        didSet { if oldValue != holdsPaper { setActivity(activity) } }
    }
    private var paperFile: SCNNode?

    /// 택배 상자를 들고 있는지(걷거나 내밀 때 보인다).
    var holdsBox = false {
        didSet { if oldValue != holdsBox { setActivity(activity) } }
    }
    /// 차례로 할 일.
    private var steps: [Step] = []
    private var stepStarted = false
    private var stepEnd: Double?
    private var fadeFrom: CGFloat = 1
    private var stepBegan: Double = 0
    private var hurrying = false
    private var now: Double = 0
    private var cupTilt: Double = 0
    private var walkPace: Float = 1
    /// 걷는 길 위의 실제 위치(비켜 걷는 만큼은 빼고).
    private var walkBase: SIMD3<Float>?
    private var sideOffset: Float = 0
    /// 다른 사람을 피하는 규칙(무대가 넣어 준다): 속도 배수와 오른쪽으로 비켜설 거리.
    var avoidance: ((Person) -> (slow: Float, side: Float))?

    /// 지금 보는 방향(사무실 XZ, 길이 1).
    var forward: SIMD2<Float> { SIMD2<Float>(-sin(heading), -cos(heading)) }

    /// 걷는 중인지.
    var isWalking: Bool { activity == .walk && !path.isEmpty }

    private var lastWalkEnd: Double = -10
    /// 할 일 목록이 바뀔 때마다 늘어난다. 실행 도중 목록이 바뀌었는지 알아보려고.
    private var stepGeneration = 0
    /// 퇴근길에 가방을 앞에 들고 걷는지(동기).
    var holdsBag = false
    /// 등에 가방을 메고 있는지(출근·퇴근 길). 사무실 안에서 움직일 때는 내려놓는다.
    var carriesBackpack = true {
        didSet { setActivity(activity) }
    }

    /// 손에 드는 머그컵. 마실 때만 보인다.
    private let mug: SCNNode
    /// 앞에 드는 가방. 퇴근 준비 때만 보인다.
    private var heldBag: SCNNode?
    /// 등에 메는 가방. 걷거나 서 있을 때만 보인다(김서울).
    private var backBag: SCNNode?

    // 치수
    static let legLength: CGFloat = 0.25
    static let hipHeight: CGFloat = 0.27
    static let shoulderY: CGFloat = 0.30
    static let headR: CGFloat = 0.2
    /// 앉았을 때 원점 높이. 의자 좌판 윗면이 0.47이다.
    static let seatedRootY: CGFloat = 0.47 - hipHeight + 0.015

    // 걷기
    private var path: [SIMD3<Float>] = []
    private var walkSpeed: Float = 0.85
    private var onArrive: (@MainActor () -> Void)?
    private var heading: Float = 0
    private var lastTime: Double?

    init(_ look: Look, accessory: (Person) -> Void = { _ in }) {
        self.look = look
        mug = Furniture.mug(color: look.style == .bob ? NSColor(hex: 0xE9B94F) : Palette.mug)
        build()
        accessory(self)
    }

    // MARK: - 짓기

    private func build() {
        let skin = Mat.matte(look.skin, roughness: 0.62)
        let cloth = Mat.matte(look.top, roughness: 0.9)
        let pants = Mat.matte(look.pants, roughness: 0.92)
        let shoe = Mat.satin(NSColor(hex: 0x2E2A28), roughness: 0.5)

        root.name = "person"
        hips.position = SCNVector3(0, Self.hipHeight, 0)
        root.addChildNode(hips)

        // 다리. 엉덩이에서 아래로 매달린다.
        for (pivot, x) in [(legL, CGFloat(-0.072)), (legR, CGFloat(0.072))] {
            pivot.position = SCNVector3(x, 0.04, 0)
            hips.addChildNode(pivot)
            Shape.capsule(radius: 0.058, height: Self.legLength + 0.04, pants).at(0, -Self.legLength / 2 + 0.01, 0).into(pivot)
            Shape.box(0.11, 0.07, 0.15, round: 0.035, shoe).at(0, -Self.legLength - 0.005, -0.025).into(pivot)
        }

        // 몸통. 아래가 넓은 종 모양.
        hips.addChildNode(torso)
        let profile = Shape.smooth([(0, 0), (0.12, 0.004), (0.152, 0.05), (0.15, 0.17), (0.128, 0.29), (0.09, 0.355), (0, 0.37)])
        Shape.lathe(profile, segments: 36, cloth).into(torso)

        // 팔. 어깨를 몸통에 파묻고 소매 끝에 벙어리장갑 손.
        for (pivot, x) in [(armL, CGFloat(-0.118)), (armR, CGFloat(0.118))] {
            pivot.position = SCNVector3(x, Self.shoulderY, 0)
            torso.addChildNode(pivot)
            Shape.capsule(radius: 0.05, height: 0.25, cloth).at(0, -0.1, 0).into(pivot)
            let hand = pivot === armR ? handR : handL
            hand.position = SCNVector3(0, -0.235, 0)
            pivot.addChildNode(hand)
            Shape.sphere(0.056, skin, segments: 24).scaled(1, 1.05, 0.9).into(hand)
            Shape.sphere(0.024, skin, segments: 16).at(x > 0 ? -0.04 : 0.04, 0.005, -0.03).into(hand)
        }
        mug.scaled(1.45)
        mug.position = SCNVector3(0, -0.01, -0.05)
        mug.isHidden = true
        handR.addChildNode(mug)

        // 머리. 목 없이 몸통 위에 얹는다.
        headPivot.position = SCNVector3(0, 0.345, 0)
        torso.addChildNode(headPivot)
        let head = SCNNode.group("head").at(0, Self.headR - 0.01, 0).into(headPivot)
        Shape.sphere(Self.headR, skin, segments: 40).scaled(1.08, 1, 1).into(head)
        buildFace(on: head)
        buildHair(on: head)
    }

    /// 가로로 긴 알약 눈, 옅은 볼, 작은 입. 코는 없다.
    private func buildFace(on head: SCNNode) {
        let eye = Mat.satin(NSColor(hex: 0x1E1E22), roughness: 0.1)
        for x in [CGFloat(-0.083), CGFloat(0.083)] {
            Shape.capsule(radius: 0.021, height: 0.062, eye, segments: 16)
                .turned(z: 90).scaled(1, 1, 0.55).at(x, -0.012, -0.182).into(head)
        }
        let cheek = Mat.matte(NSColor(hex: 0xEE8F8F), roughness: 0.8)
        for x in [CGFloat(-0.125), CGFloat(0.125)] {
            Shape.sphere(0.034, cheek, segments: 16).scaled(1.25, 0.7, 0.35).at(x, -0.058, -0.158).into(head)
        }
        Shape.capsule(radius: 0.011, height: 0.04, Mat.matte(NSColor(hex: 0x8A4A4A), roughness: 0.6), segments: 12)
            .turned(z: 90).scaled(1, 1, 0.6).at(0, -0.07, -0.19).into(head)
    }

    /// 머리카락은 덩어리로. 사람마다 정수리에서 본 모양이 다르다.
    private func buildHair(on head: SCNNode) {
        let hair = Mat.satin(look.hair, roughness: 0.48)
        func cap(_ lift: CGFloat, _ back: CGFloat, radius: CGFloat = 0.212, _ material: SCNMaterial) {
            Shape.sphere(radius, material, segments: 40).scaled(1.08, 1, 1).at(0, lift, back).into(head)
        }
        func bangs(_ material: SCNMaterial, _ pieces: [(CGFloat, CGFloat, CGFloat, CGFloat)]) {
            for (x, y, size, tilt) in pieces {
                Shape.sphere(size, material, segments: 20).scaled(1.35, 0.62, 0.55)
                    .turned(z: tilt).at(x, y - 0.008, -0.162).into(head)
            }
        }

        // 캡 앞 가장자리와 앞머리 사이에 살색 띠가 드러나지 않게 머리선을 덮는 얇은 덩어리.
        func hairline() {
            Shape.sphere(0.15, hair, segments: 32).scaled(1.38, 0.42, 0.75).at(0, 0.142, -0.075).into(head)
        }

        switch look.style {
        case .bun:
            hairline()
            cap(0.016, 0.026, hair)
            bangs(hair, [(-0.07, 0.118, 0.07, -14), (0.055, 0.128, 0.064, 18), (0.0, 0.14, 0.05, 0)])
            Shape.sphere(0.088, hair, segments: 28).at(0, 0.215, 0.05).into(head)
            Shape.torus(ring: 0.055, pipe: 0.017, Mat.satin(Palette.green, roughness: 0.4))
                .turned(x: -20).at(0, 0.17, 0.035).into(head)
        case .sidePart:
            cap(0.04, 0.03, radius: 0.208, hair)
            // 옆으로 넘긴 앞머리 덩어리. 가르마 반대쪽 옆머리는 머리에 붙여 귀처럼 튀어나오지 않게 한다.
            Shape.sphere(0.12, hair, segments: 28).scaled(1.25, 0.5, 0.9).turned(z: -16).at(0.04, 0.155, -0.08).into(head)
            Shape.sphere(0.07, hair, segments: 20).scaled(0.7, 0.9, 1).at(-0.15, 0.075, -0.05).into(head)
        case .hoodUp:
            let hood = Mat.matte(look.top, roughness: 0.92)
            // 앞머리는 이마를 가로지르는 한 덩어리로. 두 덩어리로 두면 이마에 얹은 선글라스처럼 보인다.
            Shape.sphere(0.12, hair, segments: 28).scaled(1.25, 0.42, 0.6).turned(z: -6).at(0.01, 0.112, -0.135).into(head)
            cap(0.012, 0.045, radius: 0.236, hood)
            // 후드 테두리
            Shape.torus(ring: 0.175, pipe: 0.03, Mat.matte(look.top.darker(0.08), roughness: 0.92))
                .scaled(1.1, 1.08, 1).turned(x: 90).turned(x: 98).at(0, 0.01, -0.15).into(head)
        case .bob:
            // 캡을 뒤로 너무 빼면 이마 위 정수리 앞쪽에 살색이 드러난다.
            // 캡을 앞으로 당기면 얼굴을 덮는다. 뒤로 빼 두고 정수리 앞 빈 곳은 앞머리 덩어리로 채운다.
            cap(-0.004, 0.022, radius: 0.214, hair)
            hairline()
            Shape.sphere(0.214, hair, segments: 36).scaled(1.12, 0.62, 0.95).at(0, -0.075, 0.06).into(head)
            bangs(hair, [(-0.06, 0.12, 0.072, -8), (0.045, 0.124, 0.07, 10), (0.12, 0.09, 0.05, 30), (-0.005, 0.15, 0.06, 0)])
        case .neat:
            cap(0.03, 0.03, radius: 0.208, hair)
            // 옆으로 단정히 빗은 앞머리와 짧은 구레나룻
            Shape.sphere(0.115, hair, segments: 28).scaled(1.3, 0.42, 0.85).turned(z: 8).at(-0.02, 0.16, -0.085).into(head)
            for x in [CGFloat(-0.19), CGFloat(0.19)] {
                Shape.sphere(0.045, hair, segments: 16).scaled(0.6, 1.1, 1).at(x, 0.02, -0.02).into(head)
            }
        case .halfUp:
            cap(-0.004, 0.024, radius: 0.214, hair)
            hairline()
            Shape.sphere(0.214, hair, segments: 36).scaled(1.13, 0.6, 0.96).at(0, -0.07, 0.06).into(head)
            bangs(hair, [(-0.075, 0.12, 0.07, -12), (0.06, 0.13, 0.068, 14), (0.0, 0.15, 0.055, 0)])
            // 뒤통수에 작게 묶은 머리와 머리끈
            Shape.sphere(0.07, hair, segments: 22).scaled(1.1, 0.9, 1).at(0, 0.11, 0.2).into(head)
            Shape.torus(ring: 0.035, pipe: 0.013, Mat.satin(NSColor(hex: 0x2B3A67), roughness: 0.4)).turned(x: 70).at(0, 0.12, 0.165).into(head)
        case .quiff:
            cap(0.02, 0.03, radius: 0.206, hair)
            // 이마 위로 세워 올린 앞머리 덩어리
            Shape.sphere(0.11, hair, segments: 28).scaled(1.35, 0.7, 0.8).turned(x: -25).at(0, 0.2, -0.1).into(head)
        case .lowTail:
            cap(-0.002, 0.024, radius: 0.214, hair)
            hairline()
            bangs(hair, [(-0.08, 0.12, 0.072, -16), (0.075, 0.125, 0.07, 18), (0.0, 0.15, 0.055, 0)])
            // 목덜미에서 낮게 묶어 등으로 내려온 머리
            Shape.capsule(radius: 0.06, height: 0.26, hair, segments: 20).turned(x: 12).at(0, -0.16, 0.19).into(head)
            Shape.torus(ring: 0.05, pipe: 0.014, Mat.satin(NSColor(hex: 0xE9B94F), roughness: 0.4)).turned(x: 80).at(0, -0.06, 0.2).into(head)
        case .cap:
            cap(-0.01, 0.03, radius: 0.208, hair)
            let fabric = Mat.matte(look.top.darker(0.18), roughness: 0.85)
            Shape.sphere(0.214, fabric, segments: 36).scaled(1.1, 0.62, 1.06).at(0, 0.075, 0.0).into(head)
            Shape.cylinder(radius: 0.13, height: 0.016, fabric).scaled(1.15, 1, 1).at(0, 0.09, -0.19).into(head)
            Shape.sphere(0.018, fabric, segments: 12).at(0, 0.21, 0.0).into(head)
        }
    }

    // MARK: - 소품

    /// 사원증 목걸이. 노란 줄은 뒤에서도 보인다.
    func addBadge(cardY: CGFloat = 0.2) {
        let strap = Mat.matte(NSColor(hex: 0xF4C534), roughness: 0.7)
        Shape.torus(ring: 0.098, pipe: 0.013, strap).scaled(1, 1, 1.15).turned(x: -14).at(0, 0.33, 0.004).into(torso)
        let card = Shape.box(0.1, 0.13, 0.012, round: 0.012, Mat.image(Textures.badge(), roughness: 0.5))
        card.turned(x: -10).at(0, cardY, -0.152).into(torso)
        let clip = 0.33 - cardY - 0.065
        Shape.box(0.015, clip, 0.006, round: 0.003, strap).at(0, cardY + 0.065 + clip / 2, -0.142).turned(x: -18).into(torso)
    }

    /// 등에 메는 가방. 몸통보다 조금 넓다.
    func addBackpack(color: NSColor = NSColor(hex: 0x2B3A67)) {
        let bag = backpack(color: color)
        bag.position = SCNVector3(0, 0.17, 0.17)
        torso.addChildNode(bag)
        backBag = bag
        // 어깨에 걸친 멜빵. 없으면 가방이 등에 떠 있는 것처럼 보인다.
        let belt = SCNNode.group("straps").into(torso)
        let material = Mat.matte(color.darker(0.15), roughness: 0.85)
        for x in [CGFloat(-0.085), CGFloat(0.085)] {
            Shape.torus(ring: 0.07, pipe: 0.014, material).scaled(0.6, 1, 1.25).turned(z: 90).at(x, 0.27, 0.0).into(belt)
        }
        straps = belt
    }

    /// 손에 드는 가방(퇴근 준비).
    func addHeldBag(color: NSColor) {
        let bag = backpack(color: color).scaled(0.85)
        bag.position = SCNVector3(0, 0.08, -0.26)
        bag.isHidden = true
        torso.addChildNode(bag)
        heldBag = bag
    }

    private func backpack(color: NSColor) -> SCNNode {
        let node = SCNNode.group("bag")
        let body = Mat.matte(color, roughness: 0.85)
        Shape.box(0.31, 0.3, 0.13, round: 0.06, body).into(node)
        Shape.box(0.22, 0.13, 0.05, round: 0.03, Mat.matte(color.lighter(0.12), roughness: 0.85)).at(0, -0.06, 0.075).into(node)
        Shape.capsule(radius: 0.012, height: 0.11, Mat.metal(Palette.brass)).turned(z: 90).at(0, 0.0, 0.1).into(node)
        Shape.torus(ring: 0.04, pipe: 0.012, body).turned(x: 90).at(0, 0.16, 0).into(node)
        return node
    }

    /// 휴대전화(왼손)와 택배 상자. 자리 비움 동작에 쓴다.
    func addAwayProps() {
        let device = SCNNode.group("phone")
        Shape.box(0.06, 0.11, 0.014, round: 0.01, Mat.satin(Palette.charcoal, roughness: 0.3)).into(device)
        device.turned(y: 90).at(0.02, 0.0, -0.01)
        device.isHidden = true
        handL.addChildNode(device)
        phone = device

        let parcel = SCNNode.group("box")
        let cardboard = Mat.matte(NSColor(hex: 0xC9A06A), roughness: 0.9)
        Shape.box(0.34, 0.24, 0.26, round: 0.015, cardboard).into(parcel)
        Shape.box(0.345, 0.03, 0.08, round: 0.004, Mat.matte(NSColor(hex: 0xE8D9B8), roughness: 0.7)).at(0, 0.11, 0).into(parcel)
        Shape.box(0.1, 0.07, 0.005, round: 0.003, Mat.matte(Palette.paper)).at(0.08, 0.02, -0.132).into(parcel)
        parcel.position = SCNVector3(0, 0.12, -0.27)
        parcel.isHidden = true
        torso.addChildNode(parcel)
        box = parcel
        addSnackProps()
    }

    /// 종이컵과 간식 봉지. 오른손에 든다.
    func addSnackProps() {
        guard paperCup == nil else { return }
        let cup = SCNNode.group("paperCup")
        let paper = Mat.matte(Palette.paper, roughness: 0.7)
        Shape.cone(top: 0.042, bottom: 0.032, height: 0.1, paper).at(0, 0.05, 0).into(cup)
        Shape.tube(inner: 0.04, outer: 0.044, height: 0.012, paper).at(0, 0.1, 0).into(cup)
        Shape.cylinder(radius: 0.039, height: 0.004, Mat.satin(NSColor(hex: 0xBFE3F2), roughness: 0.1)).at(0, 0.088, 0).into(cup)
        cup.position = SCNVector3(0, -0.02, -0.05)
        cup.isHidden = true
        handR.addChildNode(cup)
        paperCup = cup

        let bag = SCNNode.group("snack")
        Shape.box(0.11, 0.14, 0.04, round: 0.018, Mat.satin(NSColor(hex: 0xE5603F), roughness: 0.35)).into(bag)
        Shape.box(0.112, 0.03, 0.042, round: 0.008, Mat.satin(NSColor(hex: 0xF4C534), roughness: 0.35)).at(0, 0.035, 0).into(bag)
        bag.position = SCNVector3(0, -0.03, -0.06)
        bag.isHidden = true
        handR.addChildNode(bag)
        snack = bag

        // 보고용 서류철(초록 표지에 흰 종이)
        let file = SCNNode.group("paper")
        Shape.box(0.2, 0.26, 0.018, round: 0.006, Mat.matte(Palette.green.lighter(0.1), roughness: 0.7)).into(file)
        Shape.box(0.18, 0.24, 0.01, round: 0.003, Mat.matte(Palette.paper, roughness: 0.8)).at(0.004, 0.004, -0.012).into(file)
        file.position = SCNVector3(0.0, -0.05, -0.07)
        file.isHidden = true
        handR.addChildNode(file)
        paperFile = file
    }

    /// 카디건 앞섶과 단추. 팀장.
    func addCardigan() {
        let shirt = Mat.matte(Palette.paper, roughness: 0.85)
        let band = Shape.lathe(Shape.smooth([(0.147, 0.06), (0.152, 0.17), (0.131, 0.28), (0.095, 0.345)]),
                               segments: 40, arc: 26, center: 0, shirt)
        band.into(torso)
        for y in [CGFloat(0.12), 0.19, 0.26] {
            Shape.sphere(0.012, Mat.satin(Palette.brass, roughness: 0.35), segments: 12)
                .at(0.045, y, -sqrt(max(0, 0.152 * 0.152 - 0.045 * 0.045)) - 0.004).into(torso)
        }
    }

    /// 등 뒤로 내린 후드 덩어리. 박서윤.
    func addHoodDown() {
        let hood = Mat.matte(look.top.darker(0.06), roughness: 0.92)
        Shape.sphere(0.13, hood, segments: 28).scaled(1.35, 0.8, 0.75).at(0, 0.32, 0.105).into(torso)
        // 후드 끈
        for x in [CGFloat(-0.04), CGFloat(0.04)] {
            Shape.capsule(radius: 0.009, height: 0.09, Mat.matte(Palette.paper), segments: 10)
                .at(x * 1.6, 0.27, -0.13).into(torso)
        }
    }

    /// 안경. 부장.
    func addGlasses() {
        guard let head = root.childNode(withName: "head", recursively: true) else { return }
        let frame = Mat.satin(NSColor(hex: 0x3A3330), roughness: 0.3)
        for x in [CGFloat(-0.083), CGFloat(0.083)] {
            Shape.torus(ring: 0.042, pipe: 0.007, frame).turned(x: 90).at(x, -0.012, -0.192).into(head)
        }
        Shape.capsule(radius: 0.006, height: 0.06, frame, segments: 8).turned(z: 90).at(0, -0.006, -0.2).into(head)
    }

    /// 넥타이. 부장·대리.
    func addTie(color: NSColor, jacket: NSColor? = nil) {
        let shirt = Mat.matte(jacket == nil ? look.top.lighter(0.1) : Palette.paper, roughness: 0.85)
        if let jacket {
            // 정장: 앞섶을 열어 흰 셔츠를 보이고 그 위에 넥타이.
            Shape.lathe(Shape.smooth([(0.148, 0.12), (0.152, 0.2), (0.131, 0.285), (0.095, 0.345)]),
                        segments: 40, arc: 40, center: 0, shirt).into(torso)
            _ = jacket
        } else {
            // 셔츠 깃
            for side in [CGFloat(-1), CGFloat(1)] {
                Shape.box(0.06, 0.03, 0.02, round: 0.008, shirt).turned(z: side * 25).at(side * 0.035, 0.335, -0.1).into(torso)
            }
        }
        let tie = Mat.satin(color, roughness: 0.5)
        Shape.box(0.034, 0.03, 0.02, round: 0.008, tie).at(0, 0.315, -0.128).into(torso)
        Shape.box(0.04, 0.11, 0.012, round: 0.012, tie).turned(x: -12).at(0, 0.245, -0.148).into(torso)
    }

    /// 형광 띠를 두른 조끼. 택배 기사.
    func addVest() {
        let vest = Shape.lathe(Shape.smooth([(0.154, 0.05), (0.157, 0.17), (0.134, 0.28), (0.1, 0.34)]),
                               segments: 40, Mat.matte(NSColor(hex: 0x2F4F5A), roughness: 0.9))
        vest.into(torso)
        let band = Shape.lathe([(0.159, 0.12), (0.16, 0.15)], segments: 40, Mat.matte(NSColor(hex: 0xE8F05A), roughness: 0.5))
        band.into(torso)
    }

    /// 후드 앞 주머니. 이하준.
    func addHoodiePocket() {
        let pocket = Shape.lathe(Shape.smooth([(0.153, 0.06), (0.153, 0.13), (0.146, 0.18)]),
                                 segments: 40, arc: 70, center: 0, Mat.matte(look.top.darker(0.07), roughness: 0.92))
        pocket.scaled(1.03, 1, 1.03).into(torso)
    }

    /// 서류철을 든다(팀장이 서 있을 때).
    func addFolder() {
        let folder = Furniture.folder().scaled(0.9)
        folder.turned(x: 70).at(0.02, -0.03, -0.08)
        folder.name = "held.folder"
        handR.addChildNode(folder)
    }

    // MARK: - 동작

    func setActivity(_ next: Activity) {
        activity = next
        root.isHidden = next == .hidden
        mug.isHidden = !(next == .sitTypingWithMug || next == .standMug)
        if next == .hidden { root.opacity = 1 }
        heldBag?.isHidden = !(next == .standBag || (next == .walk && holdsBag))
        let bagOn = carriesBackpack && (next == .walk || next == .stand || next == .wave || next == .packUp || next == .bow)
        backBag?.isHidden = !bagOn
        straps?.isHidden = !bagOn
        phone?.isHidden = next != .phone
        box?.isHidden = !(next == .standBox || (holdsBox && (next == .walk || next == .offerBox)))
        paperCup?.isHidden = !(next == .fillCup || next == .drinkCup)
        snack?.isHidden = next != .sitEat && !(next == .reach && holdsSnackWhileReaching)
        root.childNode(withName: "held.folder", recursively: true)?.isHidden = !(next == .stand || next == .wave) || holdsPaper
        paperFile?.isHidden = !holdsPaper || next == .hidden
    }

    /// 퇴근할 때 손에 드는 가방이 있는지.
    var hasHeldBag: Bool { heldBag != nil }

    /// 간식을 고르는 중에 이미 손에 들었는지.
    var holdsSnackWhileReaching = false

    // MARK: - 차례로 하는 일

    /// 할 일을 새로 맡긴다. 하던 일은 버린다.
    func play(_ next: [Step]) {
        stepGeneration += 1
        steps = next
        stepStarted = false
        stepEnd = nil
        hurrying = false
        runSteps()
    }

    /// 할 일이 남았는지.
    var isBusy: Bool { !steps.isEmpty }

    /// 남은 동작을 짧게 줄여 서둘러 끝낸다(걷기는 그대로).
    func hurry() {
        guard !steps.isEmpty else { return }
        hurrying = true
        if case .act = steps.first, let end = stepEnd { stepEnd = min(end, now + 0.3) }
    }

    /// 할 일을 모두 버린다.
    func stopSteps() {
        stepGeneration += 1
        steps = []
        stepStarted = false
        stepEnd = nil
        hurrying = false
    }

    private func runSteps() {
        while let step = steps.first {
            let generation = stepGeneration
            if !stepStarted {
                stepStarted = true
                stepBegan = now
                switch step {
                case .walk(let points, let speed):
                    if points.isEmpty { break }
                    if let expanded = walkExpander?(self, points, speed) {
                        guard generation == stepGeneration else { return }
                        steps.removeFirst()
                        steps.insert(contentsOf: expanded, at: 0)
                        stepStarted = false
                        continue
                    }
                    walk(along: points, speed: speed)
                case .rawWalk(let points, let speed):
                    if points.isEmpty { break }
                    walk(along: points, speed: speed)
                case .act(let next, let seconds):
                    setActivity(next)
                    stepEnd = now + (hurrying ? min(seconds, 0.3) : seconds)
                case .face(let degrees): face(degrees)
                case .place(let point): root.position = point
                case .run(let action): action()
                case .fade(_, let seconds):
                    fadeFrom = root.opacity
                    stepEnd = now + seconds
                case .waitUntil(_, let seconds):
                    setActivity(.stand)
                    stepEnd = now + seconds
                case .door(let index, let opening, let heading):
                    // 이 단계를 할 일들로 바꿔 끼운다.
                    let extra = doorHandler?(self, index, opening, heading) ?? []
                    guard generation == stepGeneration else { return }
                    steps.removeFirst()
                    steps.insert(contentsOf: extra, at: 0)
                    stepStarted = false
                    continue
                case .doorQueue(let index, let spot, let heading):
                    let extra = queueHandler?(self, index, spot, heading) ?? []
                    guard generation == stepGeneration else { return }
                    steps.removeFirst()
                    steps.insert(contentsOf: extra, at: 0)
                    stepStarted = false
                    continue
                }
                // run 안에서 play·stopSteps로 할 일이 바뀌었으면 새 목록은 그쪽에서 이미 시작했다.
                // 여기서 옛 단계를 끝냈다고 지우면 새 목록의 첫 단계가 지워진다.
                if generation != stepGeneration { return }
            }
            switch step {
            case .walk(let points, _), .rawWalk(let points, _):
                if !points.isEmpty, activity == .walk { return }
            case .act:
                if let end = stepEnd, now < end { return }
            case .waitUntil(let ready, _):
                if !ready(), let end = stepEnd, now < end { return }
            case .fade(let target, let seconds):
                let t = min(1, (now - stepBegan) / max(0.01, seconds))
                root.opacity = fadeFrom + (target - fadeFrom) * CGFloat(smoothstep(0, 1, t))
                if t < 1 { return }
            default:
                break
            }
            steps.removeFirst()
            stepStarted = false
            stepEnd = nil
        }
    }

    /// 경로를 따라 걷는다. 도착하면 `arrive`를 부른다.
    func walk(along points: [SCNVector3], speed: Float = 0.85, arrive: (@MainActor () -> Void)? = nil) {
        path = points.map { SIMD3<Float>(Float($0.x), 0, Float($0.z)) }
        if walkBase == nil || now - lastWalkEnd > 0.15 {
            walkBase = SIMD3<Float>(Float(root.position.x), 0, Float(root.position.z))
            sideOffset = 0
        }
        // 방금까지 걷던 중이면(나뉜 길) 속도를 이어 가고, 서 있다가 출발하면 천천히 시작한다.
        if now - lastWalkEnd > 0.15 { walkPace = 0.3 }
        root.position.y = 0
        walkSpeed = speed
        onArrive = arrive
        setActivity(.walk)
    }

    /// 바라보는 방향(도). 0이면 -Z.
    func face(_ degrees: CGFloat) {
        heading = Float(rad(degrees))
        root.simdOrientation = simd_quatf(angle: heading, axis: [0, 1, 0])
    }

    /// 시각(초)에 맞춰 자세를 만든다. 매 화면마다 부른다.
    func animate(time: Double) {
        let delta = lastTime.map { max(0, min(0.1, time - $0)) } ?? 0
        lastTime = time
        now = time
        if activity == .walk { advanceWalk(delta) }
        runSteps()
        guard activity != .hidden else { return }
        let t = time * look.rate + look.phase

        // 숨쉬기와 머리 까딱임. 주기를 서로 배수가 안 되게 잡는다.
        let breath = sin(t * 2 * .pi / 3.7)
        torso.scale = SCNVector3(1 - 0.01 * breath, 1 + 0.022 * breath, 1 - 0.01 * breath)
        var headPitch = 0.16 + 0.035 * sin(t * 2 * .pi / 6.3 + 0.7)
        var headYaw = 0.05 * sin(t * 2 * .pi / 11.0)
        var torsoPitch = 0.0
        var bounce = 0.0
        var left = Arm(pitch: 0.12, yaw: 0, roll: -0.12)
        var right = Arm(pitch: 0.12, yaw: 0, roll: 0.12)
        var legPitchL = 0.0, legPitchR = 0.0

        switch activity {
        case .hidden:
            return
        case .sitTyping, .sitTypingWithMug:
            // 팔이 짧아(어깨→손 0.235m) 몸을 앞으로 숙이고 팔을 거의 수평으로 들어야 손이 책상 위 키보드에 닿는다.
            // 팔을 덜 들면 손이 상판 밑에서 오간다.
            torsoPitch = -0.16
            legPitchL = .pi / 2 - 0.05
            legPitchR = .pi / 2 + 0.03
            headPitch -= 0.06
            // 양손을 번갈아 두드리고 몇 초마다 잠깐 멈춘다.
            let pause = (sin(t * 0.83) + sin(t * 0.31 + 1.3)) > 1.25 ? 0.0 : 1.0
            let tapL = pause * pow(abs(sin(t * 2 * .pi / 0.34)), 3) * 0.09
            let tapR = pause * pow(abs(sin(t * 2 * .pi / 0.29 + 1.1)), 3) * 0.09
            left = Arm(pitch: 1.72 - tapL, yaw: -0.3, roll: -0.05)
            right = Arm(pitch: 1.72 - tapR, yaw: 0.3, roll: 0.05)
            if activity == .sitTypingWithMug {
                // 15초마다 머그컵을 0.45초에 들고, 1.8초 마시고, 0.45초에 내린다.
                let cycle = (t / 15).truncatingRemainder(dividingBy: 1) * 15
                let lift = smoothstep(9, 9.45, cycle) * (1 - smoothstep(11.25, 11.7, cycle))
                mug.isHidden = lift < 0.02
                right = right.mixed(with: Arm(pitch: 2.25, yaw: 0.62, roll: 0.05), lift)
                headPitch += 0.12 * lift
            }
        case .stand, .standMug, .wave:
            if activity == .standMug {
                let cycle = (t / 7).truncatingRemainder(dividingBy: 1) * 7
                let lift = 0.35 + 0.65 * smoothstep(3, 3.45, cycle) * (1 - smoothstep(5, 5.45, cycle))
                right = Arm(pitch: 0.9 + 1.35 * lift, yaw: 0.55, roll: 0.05)
                headPitch += 0.1 * lift
            }
            if activity == .wave {
                right = Arm(pitch: 0.1, yaw: 0, roll: 2.55 + 0.28 * sin(t * 2 * .pi / 0.55))
                headYaw += 0.12
            }
        case .sitListen:
            torsoPitch = -0.04
            legPitchL = .pi / 2 - 0.04
            legPitchR = .pi / 2 + 0.02
            left = Arm(pitch: 1.0, yaw: -0.38, roll: -0.05)
            right = Arm(pitch: 1.0, yaw: 0.38, roll: 0.05)
            // 9초마다 두 번 끄덕인다.
            let cycle = (t / 9).truncatingRemainder(dividingBy: 1) * 9
            let nod = cycle < 1.2 ? sin(cycle / 1.2 * 2 * .pi * 2) : 0
            headPitch += 0.1 * max(0, nod) - 0.05
        case .present:
            let talk = sin(t * 2 * .pi / 2.3)
            right = Arm(pitch: 1.15 + 0.3 * talk, yaw: 0.15, roll: 0.35 + 0.1 * sin(t * 2 * .pi / 3.1))
            left = Arm(pitch: 0.35 + 0.15 * max(0, -talk), yaw: -0.1, roll: -0.18)
            headYaw += 0.28 * sin(t * 2 * .pi / 5.5)
            bounce = 0.006 * sin(t * 2 * .pi / 1.15)
        case .phone:
            left = Arm(pitch: 0.35, yaw: 0, roll: -2.55)
            right = Arm(pitch: 0.25, yaw: 0.2, roll: 0.15)
            headYaw += 0.15 * sin(t * 2 * .pi / 4.2)
            hips.eulerAngles.z = CGFloat(0.03 * sin(t * 2 * .pi / 3.3))
        case .stretch:
            let reach = 0.18 * sin(t * 2 * .pi / 2.8)
            left = Arm(pitch: 0.1, yaw: 0, roll: -2.85 - reach)
            right = Arm(pitch: 0.1, yaw: 0, roll: 2.85 + reach)
            headPitch += 0.12
            hips.eulerAngles.z = CGFloat(0.09 * sin(t * 2 * .pi / 5.6))
        case .standBox:
            left = Arm(pitch: 1.05, yaw: -0.45, roll: 0)
            right = Arm(pitch: 1.05, yaw: 0.45, roll: 0)
            headPitch -= 0.04
        case .fillCup:
            // 오른손으로 컵을 꼭지 아래에 받치고, 왼손 검지로 버튼을 누른다.
            right = Arm(pitch: 1.2, yaw: 0.2, roll: 0.05)
            let press = pow(max(0, sin(t * 2 * .pi / 1.6)), 4)
            left = Arm(pitch: 1.45 + 0.12 * press, yaw: -0.05, roll: -0.05)
            headPitch -= 0.14
            torsoPitch = -0.05
        case .drinkCup:
            // 가슴께에 들고 있다가 6초마다 한 모금. 마실 때 고개를 젖힌다.
            let cycle = (t / 6).truncatingRemainder(dividingBy: 1) * 6
            let sip = smoothstep(1.5, 2.0, cycle) * (1 - smoothstep(3.2, 3.7, cycle))
            right = Arm(pitch: 1.05, yaw: 0.35, roll: 0.05).mixed(with: Arm(pitch: 2.3, yaw: 0.6, roll: 0.05), sip)
            left = Arm(pitch: 0.2, yaw: 0, roll: -0.14)
            headPitch += 0.2 * sip
            // 마실 때 컵을 입 쪽으로 기울인다.
            cupTilt = 0.6 * sip
        case .sitEat:
            torsoPitch = -0.06
            legPitchL = .pi / 2 - 0.04
            legPitchR = .pi / 2 + 0.02
            left = Arm(pitch: 1.05, yaw: -0.4, roll: -0.05)
            // 5초마다 한 입. 입에 넣은 뒤 오물거린다.
            let cycle = (t / 5).truncatingRemainder(dividingBy: 1) * 5
            let bite = smoothstep(0.6, 1.0, cycle) * (1 - smoothstep(1.4, 1.8, cycle))
            right = Arm(pitch: 1.05, yaw: 0.35, roll: 0.05).mixed(with: Arm(pitch: 2.25, yaw: 0.62, roll: 0.05), bite)
            let chew = cycle > 1.6 && cycle < 3.6 ? 0.025 * sin(cycle * 2 * .pi * 2.2) : 0
            headPitch += chew + 0.06 * bite - 0.03
        case .reach:
            right = Arm(pitch: 1.4 + 0.08 * sin(t * 2 * .pi / 1.9), yaw: 0.1, roll: 0.1)
            left = Arm(pitch: 0.25, yaw: 0, roll: -0.14)
            headPitch -= 0.06
            torsoPitch = -0.08
        case .packUp:
            // 책상 위 물건을 챙긴다. 양손이 번갈아 앞으로 나간다.
            let shuffle = sin(t * 2 * .pi / 1.3)
            right = Arm(pitch: 1.0 + 0.25 * shuffle, yaw: 0.3, roll: 0.05)
            left = Arm(pitch: 1.0 - 0.25 * shuffle, yaw: -0.3, roll: -0.05)
            headPitch -= 0.18
            torsoPitch = -0.12
        case .bow:
            torsoPitch = -0.38
            headPitch -= 0.1
            left = Arm(pitch: 0.15, yaw: 0, roll: -0.08)
            right = Arm(pitch: 0.15, yaw: 0, roll: 0.08)
        case .offerBox:
            left = Arm(pitch: 1.35, yaw: -0.45, roll: 0)
            right = Arm(pitch: 1.35, yaw: 0.45, roll: 0)
        case .holdPaper:
            right = Arm(pitch: 1.0, yaw: 0.35, roll: 0.05)
            left = Arm(pitch: 0.75, yaw: -0.3, roll: -0.05)
            headPitch -= 0.05
        case .offerPaper:
            right = Arm(pitch: 1.4, yaw: 0.15, roll: 0.05)
            left = Arm(pitch: 1.25, yaw: -0.2, roll: -0.05)
            torsoPitch = -0.14
            headPitch -= 0.06
        case .nod:
            // 손을 앞에 모으고 1.4초마다 고개를 끄덕인다.
            right = Arm(pitch: 0.55, yaw: 0.5, roll: 0.05)
            left = Arm(pitch: 0.55, yaw: -0.5, roll: -0.05)
            let beat = (t / 1.4).truncatingRemainder(dividingBy: 1)
            headPitch -= 0.14 * max(0, sin(beat * .pi * 2)) + 0.04
        case .sitReview, .sitExplain:
            torsoPitch = -0.06
            legPitchL = .pi / 2 - 0.05
            legPitchR = .pi / 2 + 0.03
            if activity == .sitReview {
                // 서류를 들어 읽고, 가끔 넘긴다.
                let flip = smoothstep(0, 0.3, (t / 3.1).truncatingRemainder(dividingBy: 1)) * (1 - smoothstep(0.3, 0.6, (t / 3.1).truncatingRemainder(dividingBy: 1)))
                right = Arm(pitch: 1.45, yaw: 0.3, roll: 0.05)
                left = Arm(pitch: 1.2 + 0.25 * flip, yaw: -0.25, roll: -0.05)
                headPitch -= 0.1
            } else {
                let talk = sin(t * 2 * .pi / 1.7)
                right = Arm(pitch: 1.0 + 0.25 * talk, yaw: 0.15, roll: 0.35 + 0.1 * sin(t * 2 * .pi / 2.3))
                left = Arm(pitch: 1.15, yaw: -0.3, roll: -0.05)
                headYaw += 0.12 * sin(t * 2 * .pi / 4.1)
                headPitch += 0.03
            }
        case .standBag:
            left = Arm(pitch: 0.95, yaw: -0.35, roll: 0)
            right = Arm(pitch: 0.95, yaw: 0.35, roll: 0)
            bounce = 0.008 * sin(t * 2 * .pi / 1.4)
            headPitch -= 0.05
        case .walk:
            // 걸음당 0.32초. 다리와 팔이 엇갈리고 몸이 살짝 튄다.
            let step = time * 2 * .pi / 0.64
            let swing = sin(step)
            legPitchL = 0.5 * swing
            legPitchR = -0.5 * swing
            left = Arm(pitch: -0.4 * swing + 0.1, yaw: 0, roll: -0.16)
            right = Arm(pitch: 0.4 * swing + 0.1, yaw: 0, roll: 0.16)
            bounce = 0.04 * abs(sin(step))
            torsoPitch = -0.05
            hips.eulerAngles.z = CGFloat(0.04 * swing)
            if holdsBox {
                left = Arm(pitch: 1.05, yaw: -0.45, roll: 0)
                right = Arm(pitch: 1.05, yaw: 0.45, roll: 0)
            } else if holdsPaper {
                right = Arm(pitch: 1.0, yaw: 0.35, roll: 0.05)
            }
        }

        if activity != .walk, activity != .phone, activity != .stretch { hips.eulerAngles.z = 0 }
        hips.position.y = Self.hipHeight + CGFloat(bounce)
        hips.eulerAngles.x = CGFloat(torsoPitch)
        legL.eulerAngles.x = CGFloat(legPitchL - torsoPitch)
        legR.eulerAngles.x = CGFloat(legPitchR - torsoPitch)
        // 앉은 자세에서 먼저 움직이는 몸과 머리 뒤로 팔이 따라온다(팔 각도는 몸 기울기에 더해진다).
        left.apply(to: armL)
        right.apply(to: armR)
        box?.position = SCNVector3(0, activity == .offerBox ? 0.17 : 0.12, activity == .offerBox ? -0.33 : -0.27)
        // 컵은 팔이 어떻게 돌아도 똑바로 선 채로 든다.
        mug.simdOrientation = armR.simdOrientation.inverse
        if let cup = paperCup, !cup.isHidden {
            let tilt = activity == .drinkCup ? Float(cupTilt) : 0
            cup.simdOrientation = armR.simdOrientation.inverse * simd_quatf(angle: tilt, axis: [1, 0, 0])
        }
        snack?.simdOrientation = armR.simdOrientation.inverse
        // 서류철은 손에서 몸 쪽으로 세워 든다. 읽을 때는 얼굴 쪽으로 기울인다.
        paperFile?.simdOrientation = armR.simdOrientation.inverse * simd_quatf(angle: activity == .sitReview ? 0.9 : 0.25, axis: [1, 0, 0])
        headPivot.simdOrientation = simd_quatf(angle: Float(headYaw), axis: [0, 1, 0])
            * simd_quatf(angle: Float(headPitch - torsoPitch * 0.6), axis: [1, 0, 0])
    }

    /// 걷기. 출발할 때 서서히 빨라지고, 멈출 곳에서 서서히 느려지며, 모퉁이 앞에서 미리 몸을 돌린다.
    private func advanceWalk(_ delta: Double) {
        guard !path.isEmpty else { return }
        var position = walkBase ?? SIMD3<Float>(Float(root.position.x), 0, Float(root.position.z))
        walkPace = min(1, walkPace + Float(delta) * 3.2)
        let avoid = avoidance?(self) ?? (slow: 1, side: 0)
        // 남은 거리. 다음 할 일도 걷기면(문 앞에서 나뉜 길) 멈추지 않으므로 늦추지 않는다.
        var remaining = simd_length(path[0] - position)
        for (a, b) in zip(path, path.dropFirst()) { remaining += simd_length(b - a) }
        let slow: Float = continuesWalking ? 1 : max(0.35, min(1, remaining / 0.45))
        var budget = walkSpeed * walkPace * slow * avoid.slow * Float(delta)
        while budget > 0, let target = path.first {
            let gap = target - position
            let distance = simd_length(gap)
            if distance <= budget {
                position = target
                budget -= distance
                path.removeFirst()
            } else {
                position += gap / distance * budget
                budget = 0
            }
        }
        // 비켜 걷기: 멈출 곳이 가까우면 길 위로 돌아온다.
        let wantSide = (remaining < 0.7 && !continuesWalking) ? 0 : avoid.side
        sideOffset += (wantSide - sideOffset) * min(1, Float(delta) * 4)
        walkBase = position
        let right = SIMD3<Float>(cos(heading), 0, -sin(heading))
        let shown = position + right * sideOffset
        root.position = SCNVector3(CGFloat(shown.x), root.position.y, CGFloat(shown.z))
        guard let target = path.first else {
            lastWalkEnd = now
            if !continuesWalking {
                walkBase = nil
                sideOffset = 0
                root.position = SCNVector3(CGFloat(position.x), root.position.y, CGFloat(position.z))
            }
            let arrive = onArrive
            onArrive = nil
            setActivity(.stand)
            arrive?()
            return
        }
        // 진행 방향으로 부드럽게 돈다. 꺾이는 곳 0.45m 앞부터 다음 방향으로 미리 돈다.
        var aim = target - position
        if path.count > 1 {
            let near = simd_length(aim)
            if near < 0.45 {
                let next = simd_normalize(path[1] - target)
                aim = simd_normalize(aim) * near / 0.45 + next * (1 - near / 0.45)
            }
        }
        if simd_length(aim) > 0.0001 {
            let want = atan2(-aim.x, -aim.z)
            var turn = want - heading
            while turn > .pi { turn -= 2 * .pi }
            while turn < -.pi { turn += 2 * .pi }
            heading += turn * min(1, Float(delta) * 10)
            root.simdOrientation = simd_quatf(angle: heading, axis: [0, 1, 0])
        }
    }

    /// 다음 할 일이 이어서 걷기인지(문 앞에서 길이 나뉜 경우).
    private var continuesWalking: Bool {
        guard steps.count > 1 else { return false }
        switch steps[1] {
        case .walk, .rawWalk, .door, .doorQueue: return true
        default: return false
        }
    }

    /// 팔 하나의 각도. 매달린 팔을 앞(pitch)·안쪽(yaw)·옆(roll)으로 돌린다.
    struct Arm {
        var pitch: Double
        var yaw: Double
        var roll: Double

        func mixed(with other: Arm, _ t: Double) -> Arm {
            Arm(pitch: lerp(pitch, other.pitch, t), yaw: lerp(yaw, other.yaw, t), roll: lerp(roll, other.roll, t))
        }

        @MainActor
        func apply(to node: SCNNode) {
            // 옆으로 벌린 뒤 앞으로 들고, 마지막에 안쪽으로 모은다.
            node.simdOrientation = simd_quatf(angle: Float(-yaw), axis: [0, 1, 0])
                * simd_quatf(angle: Float(pitch), axis: [1, 0, 0])
                * simd_quatf(angle: Float(roll), axis: [0, 0, 1])
        }
    }
}

/// 사무실 사람들. 나를 뺀 모두가 AI다.
@MainActor
enum Crew {
    static func me() -> Person {
        let person = Person(Person.Look(hair: NSColor(hex: 0x3B2A25), style: .bun, top: NSColor(hex: 0x3B78CC),
                                        rate: 1, phase: 0)) { person in
            person.addBadge()
            person.addBackpack()
            person.addAwayProps()
        }
        person.root.name = "person.me"
        return person
    }

    static func manager() -> Person {
        let person = Person(Person.Look(hair: NSColor(hex: 0x32323A), style: .sidePart, top: NSColor(hex: 0x8A3B4B),
                                        pants: NSColor(hex: 0x3A3A44), rate: 0.94, phase: 3.1)) { person in
            person.addCardigan()
            person.addBadge(cardY: 0.19)
            person.addFolder()
            person.addSnackProps()
        }
        person.root.name = "person.manager"
        return person
    }

    static func peerA() -> Person {
        let person = Person(Person.Look(hair: NSColor(hex: 0x32323A), style: .hoodUp, top: NSColor(hex: 0x7A5CC8),
                                        rate: 1.07, phase: 1.7)) { person in
            person.addHoodiePocket()
            person.addBadge(cardY: 0.235)
            person.addHeldBag(color: NSColor(hex: 0x3F6B5A))
            person.addSnackProps()
        }
        person.root.name = "person.peerA"
        return person
    }

    static func peerB() -> Person {
        let person = Person(Person.Look(hair: NSColor(hex: 0x6B4630), style: .bob, top: NSColor(hex: 0xE2594B),
                                        rate: 0.96, phase: 5.3)) { person in
            person.addHoodDown()
            person.addBadge(cardY: 0.17)
            person.addHeldBag(color: NSColor(hex: 0xD9A441))
            person.addSnackProps()
        }
        person.root.name = "person.peerB"
        return person
    }

    /// 조직도 사람 한 명의 3D 캐릭터.
    static func make(_ id: String) -> Person {
        let person: Person
        switch id {
        case "manager": person = manager()
        case "peerA": person = peerA()
        case "peerB": person = peerB()
        case "director":
            person = Person(Person.Look(hair: NSColor(hex: 0x8C8A86), style: .neat, top: NSColor(hex: 0x5B6170),
                                        pants: NSColor(hex: 0x4A4F5C), rate: 0.9, phase: 4.4)) { person in
                person.addTie(color: NSColor(hex: 0x2B3A67), jacket: NSColor(hex: 0x5B6170))
                person.addBadge(cardY: 0.105)
                person.addGlasses()
                person.addHeldBag(color: NSColor(hex: 0x4A3426))
                person.addSnackProps()
            }
        case "kwajang":
            person = Person(Person.Look(hair: NSColor(hex: 0x3B2A25), style: .halfUp, top: NSColor(hex: 0xC9963A),
                                        pants: NSColor(hex: 0x3A3A44), rate: 1.02, phase: 0.9)) { person in
                person.addCardigan()
                person.addBadge(cardY: 0.19)
                person.addHeldBag(color: NSColor(hex: 0x8A5A3B))
                person.addSnackProps()
            }
        case "daeri":
            person = Person(Person.Look(hair: NSColor(hex: 0x2A2624), style: .quiff, top: NSColor(hex: 0x8FB7DE),
                                        pants: NSColor(hex: 0x3D4860), rate: 1.05, phase: 6.1)) { person in
                person.addTie(color: NSColor(hex: 0x2B3A67))
                person.addBadge(cardY: 0.11)
                person.addHeldBag(color: NSColor(hex: 0x2B3A67))
                person.addSnackProps()
            }
        case "senior":
            person = Person(Person.Look(hair: NSColor(hex: 0x4A3226), style: .lowTail, top: NSColor(hex: 0x6FB59A),
                                        rate: 0.98, phase: 2.6)) { person in
                person.addBadge(cardY: 0.2)
                person.addHeldBag(color: NSColor(hex: 0xD9C2A0))
                person.addSnackProps()
            }
        default: person = me()
        }
        person.memberID = id
        person.root.name = "person.\(id)"
        return person
    }

    /// 택배 기사. 사원이 아니라 사원증이 없고, 모자와 조끼로 구분한다.
    static func courier() -> Person {
        let person = Person(Person.Look(hair: NSColor(hex: 0x2A2522), style: .cap, top: NSColor(hex: 0x3E7C8C),
                                        pants: NSColor(hex: 0x4A4A50), rate: 1.03, phase: 2.2)) { person in
            person.addVest()
            person.addAwayProps()
        }
        person.root.name = "person.courier"
        person.carriesBackpack = false
        return person
    }
}
