import AppKit
import OfficeCore
import SceneKit

/// 사무실에서 누를 수 있는 장소.
public enum OfficeSpot: String, CaseIterable, Sendable, Identifiable {
    case myDesk
    case manager
    case meeting

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .myDesk: "내 책상"
        case .manager: "팀장 자리"
        case .meeting: "회의실"
        }
    }

    /// 누르면 무엇이 열리는지.
    public var hint: String {
        switch self {
        case .myDesk: "체크리스트와 착석 상태"
        case .manager: "사내 메일함"
        case .meeting: "아침 PT"
        }
    }
}

/// 카메라 구도.
public enum OfficeView: Sendable, Equatable {
    /// 출근 전. 닫힌 문 앞.
    case door
    /// 사무실 전체를 비스듬히 내려다본다.
    case overview
    /// 한 장소로 가까이 간다.
    case spot(OfficeSpot)
    /// 시안 확인용. 사람들을 가까이서 본다.
    case people
}

/// 그림 품질. 느린 맥에서는 `light`를 쓴다.
public enum StageQuality: String, Sendable, CaseIterable {
    case full
    case light
}

/// 3D 미니어처 사무실.
/// 화면(SwiftUI)과 그림 뽑는 도구가 같은 장면을 쓴다.
@MainActor
public final class OfficeStage {
    public let scene = SCNScene()
    public let cameraNode = SCNNode()
    public let quality: StageQuality

    var parts: RoomParts
    private let cameraPivot = SCNNode()
    private let cameraTilt = SCNNode()

    // 빛
    private let sunNode = SCNNode()
    private let fillNode = SCNNode()
    private let ambientNode = SCNNode()
    private let pendantLightNode = SCNNode()
    private let hallLightNode = SCNNode()
    private var pendantBulbs: [SCNNode] = []
    private var hallBulb: SCNNode?
    private var meetingBoardFace: SCNNode?

    // 자리
    var myDesk: Furniture.Desk?
    /// 동료 책상(조직도 id별).
    var desks: [String: Furniture.Desk] = [:]
    private var clockHands: (hour: SCNNode, minute: SCNNode)?
    private var highlights: [OfficeSpot: SCNNode] = [:]
    private var hitNodes: [OfficeSpot: SCNNode] = [:]

    // 사람
    let me = Crew.make("me")
    /// 나를 뺀 회사 사람들(조직도 순서).
    let coworkers: [Person] = Organization.members.filter { !$0.isHuman }.map { Crew.make($0.id) }
    let courier = Crew.courier()
    /// 팀장.
    var manager: Person { coworker("manager") }
    func coworker(_ id: String) -> Person { coworkers.first { $0.memberID == id } ?? coworkers[0] }
    var stations: [String: SCNNode] = [:]
    var myDeskSign: SCNNode?
    var clock: Double = 0
    public internal(set) var myAvatar: MyAvatar = .outside
    /// 입장 장면처럼 내 캐릭터를 직접 움직이는 중이면 true. 그동안은 상태로 위치를 덮어쓰지 않는다.
    var scripted = false
    /// 장면 시계로 움직이는 짧은 변화(입장 장면). 화면 없이 그림을 뽑을 때도 창에서 볼 때와 똑같이 움직인다.
    struct Tween {
        var start: Double
        var duration: Double
        var step: @MainActor (Double) -> Void
    }
    var tweens: [Tween] = []
    /// 내 캐릭터가 지금 있는 곳.
    var meSpot: MeSpot = .outside
    /// 아침 PT 회의 중인지(앱이 원하는 값과 실제로 모인 상태).
    var meetingWanted = false
    var meetingOn = false
    /// 날마다 동기·팀장의 퇴근·야근 일정을 바꾸는 씨앗.
    var daySeed = 0
    /// 동기·팀장이 지금 무엇을 하는지(바뀔 때만 움직이려고).
    var coworkerStates: [ObjectIdentifier: CoworkerState] = [:]
    /// 동료의 잠깐 외출 일정과 누가 어디를 쓰는지.
    var errandRandom = SeededRandom(3)
    var nextErrand: [ObjectIdentifier: Double] = [:]
    var occupied: [Place: ObjectIdentifier] = [:]
    /// 보고를 받는 중이거나 곧 받을 상사(그동안 자리를 뜨지 않는다).
    var reservedBosses: Set<String> = []
    /// 편의시설에서 사람이 서는 곳(사무실 좌표).
    var standPoints: [Place: SCNVector3] = [:]
    var fridgeDoor: SCNNode?
    var microwaveGlow: SCNNode?
    var restroomDoor: SCNNode?
    /// 받은 택배를 책상 옆에 내려놓은 상자.
    var deskParcel: SCNNode?
    /// 택배를 자리로 가져와 뜯는 중인지(자리 비움은 아직 '택배').
    var parcelAtDesk = false
    /// 손으로 여닫는 문들: 0 출입문, 1 회의실 유리문, 2 화장실 문.
    var handDoors: [HandDoor] = []
    var meetingDoorPivot: SCNNode?
    var meetingDoorPanels: [(node: SCNNode, closedX: CGFloat, openX: CGFloat)] = []
    /// 이번 회의에 들어오는 사람(nil이면 아침 PT 청중).
    var meetingAttendees: [String]?
    /// 회의실 의자(당겨 앉고 빼고 일어나려고).
    var meetingChairs: [SCNNode] = []
    /// 동료를 걷게 하지 않고 바로 옮길 때 true.
    var instantCoworkers = false
    /// 크게 건너뛴 시각을 따라가는 중.
    var catchingUp = false
    /// 이 시각(장면 시계)까지는 누가 문을 쓰고 있다(퇴근 차례).
    var doorFreeAt: Double = 0
    /// 출근한 뒤에는 사람이 다가가면 문이 저절로 열리고 닫힌다.
    var doorAuto = false
    /// 퇴근 연출 동안 모니터와 스탠드를 켜 둔다.
    var holdDeskOn = false
    /// 영화처럼 움직이는 카메라.
    var filmActive = false
    var film: FilmShot?
    var filmPose = Pose(target: SCNVector3Zero, yaw: 0, pitch: 30, distance: 20, fov: 20)

    // 시각
    private(set) var shownMinute: Double = 9 * 60
    private var targetMinute: Double = 9 * 60
    var myScreenOn = false
    var myLampOn = false
    private var checklist: [(level: Int, done: Bool)] = []

    public private(set) var view: OfficeView = .overview
    /// 오른쪽에 화면 패널이 떠 있을 때 장면을 왼쪽으로 미는 양(미터).
    private var panelShift: CGFloat = 0
    var panelShiftValue: CGFloat { panelShift }

    public init(quality: StageQuality = .full) {
        self.quality = quality
        var built = RoomParts()
        Outdoors.build(into: &built)
        parts = built
        scene.rootNode.addChildNode(parts.root)
        furnish()
        setUpHandDoors()
        buildLights()
        buildCamera()
        buildSpots()
        seatCrew()
        setTime(minutes: 9 * 60, animated: false)
        setView(.overview, animated: false)
    }

    // MARK: - 가구 놓기

    /// 한 자리. 원점은 의자이고 앉는 사람은 -Z를 본다.
    private func station(at seat: SCNVector3, turn: CGFloat, desk: Furniture.Desk, chairTurn: CGFloat = 0, deskOffset: CGFloat = 0.72) -> SCNNode {
        let node = SCNNode.group("station")
        node.position = seat
        node.eulerAngles.y = rad(turn)
        desk.node.at(0, 0, -deskOffset).into(node)
        Furniture.chair().turned(y: chairTurn).at(0, 0, 0.02).named("chair").into(node)
        return node
    }

    private func furnish() {
        let root = parts.root
        let hw = Layout.halfWidth, hd = Layout.halfDepth

        // 섬 아래 러그
        let rugMaterial = Mat.image(Textures.rug(), roughness: 0.95)
        Shape.box(7.6, 0.02, 3.7, round: 0.01, rugMaterial).at(1.05, 0.011, Layout.islandZ).named("rug").noShadow().into(root)

        // 섬 책상. 사람마다 책상 위 소품을 조금씩 다르게.
        for member in Organization.members {
            let isMe = member.isHuman
            var seat: SCNVector3
            var turn: CGFloat
            var desk: Furniture.Desk
            var offset = Layout.islandDeskOffset
            let seed = UInt64(member.id.unicodeScalars.reduce(0) { $0 + Int($1.value) } % 40 + 3)
            switch member.seat {
            case .inner(let index), .outer(let index):
                let inner: Bool
                if case .inner = member.seat { inner = true } else { inner = false }
                seat = inner ? Layout.innerSeat(index) : Layout.outerSeat(index)
                turn = inner ? 180 : 0
                desk = Furniture.desk(width: Layout.islandDeskWidth, depth: Layout.islandDeskDepth, lamp: false,
                                      drawerOnLeft: index % 2 == 1, screenSeed: isMe ? 2 : seed)
            case .islandHead:
                seat = Layout.leaderSeat
                turn = 90
                offset = 0.72
                desk = Furniture.desk(width: 1.7, depth: 0.85, lamp: true, monitorX: -0.42, screenSeed: 14)
                Furniture.paperStack(sheets: 8).at(0.5, 0.775, 0.05).into(desk.node)
                Furniture.paperStack(sheets: 3).turned(y: 20).at(0.18, 0.775, 0.16).into(desk.node)
            case .departmentHead:
                seat = Layout.directorSeat
                turn = 180
                desk = Furniture.desk(width: 2.05, depth: 0.95, lamp: true, monitorX: 0.45, screenSeed: 21)
                offset = 0.72
                Furniture.paperStack(sheets: 5).at(-0.55, 0.775, 0.1).into(desk.node)
                Furniture.smallPlant().at(-0.85, 0.775, -0.25).into(desk.node)
            }
            stations[member.id] = station(at: seat, turn: turn, desk: desk, deskOffset: offset).named("station.\(member.id)").into(root)
            if isMe {
                Furniture.mug(color: Palette.mug).at(0.52, 0.775, 0.05).into(desk.node)
                // 섬 책상 가운데 내 자리만 낮은 칸막이와 '내 자리' 이름판으로 구분한다.
                Amenities.myDeskPartition(deskWidth: Layout.islandDeskWidth, deskDepth: Layout.islandDeskDepth).into(desk.node)
                myDesk = desk
            } else {
                desks[member.id] = desk
                switch member.id {
                case "peerA", "daeri": Furniture.paperStack(sheets: 4).at(0.5, 0.775, -0.05).into(desk.node)
                case "peerB", "kwajang": Furniture.smallPlant().at(-0.52, 0.775, -0.18).into(desk.node)
                case "senior": Furniture.mug(color: NSColor(hex: 0x6FB59A)).scaled(1.25).at(0.5, 0.775, 0.0).into(desk.node)
                default: break
                }
            }
        }
        // 섬 가운데 칸막이. 모니터보다 낮게.
        let islandMinX = Layout.islandX.min()! - Layout.islandDeskWidth / 2, islandMaxX = Layout.islandX.max()! + Layout.islandDeskWidth / 2
        Shape.box(islandMaxX - islandMinX, 0.32, 0.035, round: 0.012, Mat.matte(Palette.green.lighter(0.12), roughness: 0.95))
            .at((islandMinX + islandMaxX) / 2, 0.74 + 0.035 + 0.16, Layout.islandZ).named("island.partition").into(root)

        // 부장 뒤 게시판
        let board = Furniture.framedBoard(width: 1.9, height: 1.15, image: Textures.corkboard(), frame: Palette.oakDeep, emissive: false)
        board.node.at(3.35, 1.78, -hd + 0.03).into(root)

        // 책장과 벽시계
        Furniture.bookshelf().at(-0.75, 0, -hd + 0.2).into(root)
        let clock = Furniture.wallClock()
        clock.node.at(1.42, 2.3, -hd + 0.03).into(root)
        clockHands = (clock.hour, clock.minute)

        // 화분
        Furniture.leafyPlant(height: 1.25, seed: 4).at(6.25, 0, 4.2).into(root)
        Furniture.leafyPlant(height: 1.0, seed: 8).at(4.3, 0, -4.55).into(root)
        Furniture.tallPlant(height: 1.45).at(-2.45, 0, 4.5).into(root)
        for z in [-2.7, 0.35, 2.3] as [CGFloat] {
            Furniture.smallPlant().at(hw - 0.12, Layout.windowY0 - 0.015, z).into(root)
        }

        // 커피 자리. 왼쪽 벽 앞.
        Furniture.coffeeCorner().turned(y: 90).at(-hw + 0.3, 0, Layout.coffeeZ).into(root)
        buildPantry()

        // 매다는 천장 등은 두지 않는다. 천장이 없어 위에서 내려다보면 줄이 허공에 떠 있고
        // 등갓이 바닥에 놓인 것처럼 보인다. 천장 빛은 방향광(pendantLightNode)이 맡는다.

        // 복도등. 문 안쪽 옆.
        let hall = Furniture.hallLight()
        hall.node.at(Layout.doorX1 + 0.75, 0, hd - 0.45).into(root)
        hallBulb = hall.bulb

        buildMeetingRoom()
    }

    /// 탕비 구역(왼쪽 벽: 냉장고, 조리대와 전자레인지, 정수기), 간식 탁자, 화장실 문.
    /// 모델은 앞면이 +Z라서 왼쪽 벽에 붙일 때 90도 돌린다(앞면이 +X, 방 안쪽).
    private func buildPantry() {
        let root = parts.root
        let wallX = -Layout.halfWidth
        func stand(_ node: SCNNode, _ local: SCNVector3) -> SCNVector3 {
            let point = node.convertPosition(local, to: root)
            return SCNVector3(point.x, 0, point.z)
        }

        let fridge = Amenities.fridge()
        fridge.node.turned(y: 90).at(wallX + 0.3, 0, Layout.fridgeZ).named("pantry.fridge").into(root)
        fridgeDoor = fridge.doorPivot
        standPoints[.fridge] = stand(fridge.node, Amenities.StandPoint.fridge)

        let counter = Amenities.pantryCounter(width: 1.1)
        counter.node.turned(y: 90).at(wallX + 0.275, 0, Layout.microwaveZ).named("pantry.counter").into(root)
        let microwave = Amenities.microwave()
        microwave.node.at(counter.microwaveSpot.x, counter.microwaveSpot.y, counter.microwaveSpot.z).into(counter.node)
        microwaveGlow = microwave.glow
        standPoints[.microwave] = stand(microwave.node, Amenities.StandPoint.microwave)
        standPoints[.counter] = stand(counter.node, SCNVector3(counter.basketSpot.x, 0, 0.6))

        let water = Amenities.waterPurifier()
        water.node.turned(y: 90).at(wallX + 0.24, 0, Layout.waterZ).named("pantry.water").into(root)
        standPoints[.water] = stand(water.node, Amenities.StandPoint.waterPurifier)
        standPoints[.coffee] = SCNVector3(wallX + 0.95, 0, Layout.coffeeZ)

        Amenities.snackTable().at(Layout.snackTable.x, 0, Layout.snackTable.z).named("snackTable").into(root)
        buildPantryWalls()

        // 화장실 칸. 지붕이 있어 들어간 사람은 보이지 않는다.
        buildRestroomBooth()
        let restroom = Amenities.restroomDoor()
        restroom.node.at(Layout.restroomX, 0, Layout.restroomZ1).named("restroom").into(root)
        restroomDoor = restroom.doorPivot

        // 받은 택배를 내려놓는 자리. 내 책상 오른쪽 옆 바닥.
        let parcel = SCNNode.group("desk.parcel")
        let cardboard = Mat.matte(NSColor(hex: 0xC9A06A), roughness: 0.9)
        Shape.box(0.34, 0.24, 0.26, round: 0.015, cardboard).at(0, 0.12, 0).into(parcel)
        Shape.box(0.345, 0.03, 0.08, round: 0.004, Mat.matte(NSColor(hex: 0xE8D9B8), roughness: 0.7)).at(0, 0.235, 0).into(parcel)
        parcel.turned(y: 12).at(Layout.mySeat.x - 0.85, 0, Layout.mySeat.z + 0.1).into(root)
        parcel.isHidden = true
        deskParcel = parcel
    }

    /// 탕비실 벽: 뒤(z = pantryZ0)와 오른쪽(x = pantryX1, 출입구 있음). 앞·왼쪽은 사무실 바깥벽.
    private func buildPantryWalls() {
        let root = parts.root
        let wall = Mat.matte(Palette.cream, roughness: 0.92)
        let lower = Mat.matte(Palette.creamLower, roughness: 0.9)
        let cap = Mat.matte(Palette.white, roughness: 0.6)
        let x0 = -Layout.halfWidth, x1 = Layout.pantryX1, z0 = Layout.pantryZ0, z1 = Layout.halfDepth
        // 바깥 벽처럼 낮게(허리 높이) 둔다. 높으면 섬 앞을 걷는 사람과 탕비실 안이 가린다.
        let height: CGFloat = 1.15, thick: CGFloat = 0.1
        let doorZ0 = Layout.pantryDoorZ - 0.5, doorZ1 = Layout.pantryDoorZ + 0.5
        func panel(_ ax: CGFloat, _ bx: CGFloat, _ az: CGFloat, _ bz: CGFloat, _ y0: CGFloat, _ y1: CGFloat) {
            Shape.box(max(abs(bx - ax), thick), y1 - y0, max(abs(bz - az), thick), round: 0.01, wall)
                .at((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2).into(root)
            // 아래 징두리. 벽보다 2cm씩 나오게: 1cm만 나오고 모서리를 1cm 둥글리면 윗모서리가 벽면과 겹쳐 점선처럼 깜빡인다.
            if y0 < 0.9 {
                Shape.box(max(abs(bx - ax), thick) + 0.04, min(0.9, y1) - y0, max(abs(bz - az), thick) + 0.04, round: 0.004, lower)
                    .at((ax + bx) / 2, (y0 + min(0.9, y1)) / 2, (az + bz) / 2).into(root)
            }
        }
        // 뒤 벽
        panel(x0, x1 + thick / 2, z0, z0, 0, height)
        // 오른쪽 벽: 출입구 앞뒤와 위
        panel(x1, x1, z0, doorZ0, 0, height)
        panel(x1, x1, doorZ1, z1, 0, height)
        // 출입구 양옆 기둥
        for z in [doorZ0, doorZ1] {
            Shape.box(thick + 0.06, height + 0.25, thick + 0.06, round: 0.02, cap).at(x1, (height + 0.25) / 2, z).into(root)
        }
        // 윗면 띠
        Shape.box(x1 - x0 + thick, 0.05, thick + 0.04, round: 0.01, cap).at((x0 + x1) / 2, height + 0.025, z0).into(root)
        Shape.box(thick + 0.04, 0.05, z1 - z0, round: 0.01, cap).at(x1, height + 0.025, (z0 + z1) / 2).into(root)
        // '탕비실' 표지: 출입구 옆 낮은 벽 바깥면에 붙인 명판(섬 쪽을 본다).
        // 전에는 기둥 위(1.4~1.7m)에 세워 두어, 걸상에 앉아 간식 먹는 사람을 통째로 가렸다.
        let sign = SCNNode.group("pantry.sign").at(x1 + thick / 2 + 0.05, 0.78, doorZ1 + 0.62).into(root)
        Shape.box(0.06, 0.3, 0.9, round: 0.02, Mat.matte(Palette.green, roughness: 0.6)).into(sign)
        Shape.plane(0.86, 0.22, Mat.image(Textures.sign("탕비실"), roughness: 0.6), corner: 0.02).turned(y: 90).at(0.032, 0, 0).noShadow().into(sign)
        // 바닥 타일
        let tileImage = drawImage(width: 256, height: 256) { context, size in
            context.setFillColor(NSColor(hex: 0xEDE7DA).cgColor)
            context.fill(CGRect(origin: .zero, size: size))
            context.setStrokeColor(NSColor(hex: 0xD6CDBB).cgColor)
            context.setLineWidth(3)
            for i in 0...4 {
                let v = CGFloat(i) * size.width / 4
                context.move(to: CGPoint(x: v, y: 0)); context.addLine(to: CGPoint(x: v, y: size.height))
                context.move(to: CGPoint(x: 0, y: v)); context.addLine(to: CGPoint(x: size.width, y: v))
            }
            context.strokePath()
        }
        let tile = Mat.image(tileImage, roughness: 0.55)
        tile.diffuse.wrapS = .repeat
        tile.diffuse.wrapT = .repeat
        tile.diffuse.contentsTransform = SCNMatrix4MakeScale(3, 4.5, 1)
        Shape.box(x1 - x0 - 0.12, 0.012, z1 - z0 - 0.12, round: 0.004, tile)
            .at((x0 + x1) / 2, 0.007, (z0 + z1) / 2).noShadow().into(root)
        // 간식 탁자 아래 둥근 깔개, 구석 화분, 분리수거함
        Shape.cylinder(radius: 0.75, height: 0.012, Mat.matte(Palette.greenLight.lighter(0.55), roughness: 0.95), segments: 48)
            .at(Layout.snackTable.x, 0.016, Layout.snackTable.z).noShadow().into(root)
        Furniture.leafyPlant(height: 0.95, seed: 6).at(x1 - 0.75, 0, z1 - 0.7).into(root)
        for (index, color) in [NSColor(hex: 0x3B78CC), NSColor(hex: 0xE9B94F), NSColor(hex: 0x6AA86A)].enumerated() {
            let bin = SCNNode.group("pantry.bin").at(x1 - 0.3 - CGFloat(index) * 0.32, 0, z0 + 0.3).into(root)
            Shape.box(0.28, 0.5, 0.3, round: 0.04, Mat.satin(color, roughness: 0.45)).at(0, 0.25, 0).into(bin)
            Shape.box(0.3, 0.04, 0.32, round: 0.02, Mat.satin(color.darker(0.15), roughness: 0.45)).at(0, 0.52, 0).into(bin)
        }
    }

    /// 화장실 칸: 뒤 오른쪽 구석. 앞벽과 왼벽, 지붕. 앞벽 가운데에 문.
    private func buildRestroomBooth() {
        let root = parts.root
        let wall = Mat.matte(Palette.cream, roughness: 0.92)
        let lower = Mat.matte(Palette.creamLower, roughness: 0.9)
        let x0 = Layout.restroomX0, x1 = Layout.halfWidth, z0 = -Layout.halfDepth, z1 = Layout.restroomZ1
        // 사무실 벽 높이에 맞춰 건물 구석에 붙은 방처럼 보이게(지붕이 따로 솟아 보이지 않게).
        let height: CGFloat = Layout.wallHeight, thick: CGFloat = 0.12
        let doorX0 = Layout.restroomX - 0.475, doorX1 = Layout.restroomX + 0.475, doorTop: CGFloat = 2.1
        func box(_ ax: CGFloat, _ bx: CGFloat, _ az: CGFloat, _ bz: CGFloat, _ y0: CGFloat, _ y1: CGFloat) {
            Shape.box(max(abs(bx - ax), thick), y1 - y0, max(abs(bz - az), thick), round: 0.01, wall)
                .at((ax + bx) / 2, (y0 + y1) / 2, (az + bz) / 2).into(root)
            if y0 < 0.9 {
                Shape.box(max(abs(bx - ax), thick) + 0.04, 0.9 - y0, max(abs(bz - az), thick) + 0.04, round: 0.004, lower)
                    .at((ax + bx) / 2, (y0 + 0.9) / 2, (az + bz) / 2).into(root)
            }
        }
        // 앞벽(문 양옆과 위)
        box(x0, doorX0, z1, z1, 0, height)
        box(doorX1, x1, z1, z1, 0, height)
        box(doorX0, doorX1, z1, z1, doorTop, height)
        // 왼벽
        box(x0, x0, z0, z1, 0, height)
        // 지붕
        Shape.box(x1 - x0 + 0.06, 0.06, z1 - z0 + 0.06, round: 0.01, Mat.matte(Palette.wallCap)).at((x0 + x1) / 2 - 0.03, height + 0.03, (z0 + z1) / 2 - 0.03).into(root)
    }

    /// 냉장고 문을 연다(0.35초).
    func setFridgeOpen(_ open: Bool) {
        guard let door = fridgeDoor else { return }
        let from = door.eulerAngles.y, to = open ? -rad(100) : 0
        tween(0.35) { t in door.eulerAngles.y = from + (to - from) * CGFloat(t) }
    }

    // MARK: - 영화 카메라

    /// 카메라를 그 장면으로 부드럽게 옮긴다. 앱이 바꾸는 구도는 끝난 뒤에 따른다.
    func startFilm(_ shot: FilmShot) {
        if !filmActive { filmPose = currentPose() }
        filmActive = true
        film = shot
    }

    /// 원래 구도로 돌아간다.
    func endFilm() {
        film = nil
    }

    private func updateFilm(_ delta: Double) {
        guard filmActive else { return }
        let want: Pose
        switch film {
        case .fixed(let pose): want = pose
        case .follow(let person, let yaw, let pitch, let distance, let fov):
            let p = person.root.convertPosition(SCNVector3Zero, to: parts.root)
            want = Pose(target: SCNVector3(p.x, 0.55, p.z), yaw: yaw, pitch: pitch, distance: distance, fov: fov)
        case nil: want = shiftedPose(for: view)
        }
        let k = CGFloat(1 - exp(-delta * (film == nil ? 2.0 : 2.4)))
        func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * k }
        var yaw = want.yaw
        while yaw - filmPose.yaw > 180 { yaw -= 360 }
        while yaw - filmPose.yaw < -180 { yaw += 360 }
        filmPose = Pose(target: SCNVector3(mix(filmPose.target.x, want.target.x), mix(filmPose.target.y, want.target.y), mix(filmPose.target.z, want.target.z)),
                        yaw: mix(filmPose.yaw, yaw), pitch: mix(filmPose.pitch, want.pitch),
                        distance: mix(filmPose.distance, want.distance), fov: mix(filmPose.fov, want.fov))
        place(camera: filmPose)
        // 가까이 볼 때는 넓은 밝은 바닥이 번져 뿌옇게 보이므로 번짐을 줄인다.
        if quality == .full { cameraNode.camera?.bloomIntensity = film == nil ? 0.38 : 0.12 }
        // 가까이 다가가면 카메라 앞 천장등이 잘려 반투명 조각처럼 보인다. 가까운 면을 당긴다.
        cameraNode.camera?.zNear = film == nil ? 2 : 0.3
        if film == nil, abs(filmPose.distance - want.distance) < 0.05, abs(filmPose.yaw - yaw) < 0.2,
           abs(filmPose.target.x - want.target.x) < 0.02, abs(filmPose.target.z - want.target.z) < 0.02 {
            filmActive = false
            place(camera: want)
        }
    }

    /// 영화 장면이 진행 중인지(퇴근 연출).
    public var isPlayingFilm: Bool { filmActive }

    /// 유리 회의실. 프레임은 짙은 초록.
    private func buildMeetingRoom() {
        let root = SCNNode.group("meetingRoom").into(parts.root)
        let x0 = Layout.meetingX0, x1 = Layout.meetingX1, z0 = Layout.meetingZ0, z1 = Layout.meetingZ1
        let top: CGFloat = 2.5
        let green = Mat.satin(Palette.green, roughness: 0.45)
        // 유리가 탁하면 안에 앉은 사람이 회색으로 바래 보인다. 맑게 둔다.
        let glass = Mat.glass(NSColor(hex: 0xEAF7F1), opacity: 0.012)
        let post: CGFloat = 0.11

        func bar(_ ax: CGFloat, _ ay: CGFloat, _ az: CGFloat, _ bx: CGFloat, _ by: CGFloat, _ bz: CGFloat) {
            Shape.box(max(abs(bx - ax), post), max(abs(by - ay), post), max(abs(bz - az), post), round: 0.02, green)
                .at((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2).into(root)
        }
        func pane(_ ax: CGFloat, _ az: CGFloat, _ bx: CGFloat, _ bz: CGFloat, from y0: CGFloat) {
            Shape.box(max(abs(bx - ax), 0.02), top - y0 - 0.06, max(abs(bz - az), 0.02), round: 0, glass)
                .at((ax + bx) / 2, (y0 + top) / 2, (az + bz) / 2).noShadow().into(root)
        }

        let doorX0 = x1 - 1.25, doorX1 = x1 - 0.12
        // 기둥
        bar(x1, 0, z1, x1, top, z1)
        bar(x1, 0, z0 + 0.05, x1, top, z0 + 0.05)
        bar(x0 + 0.05, Layout.lowWall, z1, x0 + 0.05, top, z1)
        bar(doorX0, 0, z1, doorX0, top, z1)
        for x in [x0 + (doorX0 - x0) / 3, x0 + (doorX0 - x0) * 2 / 3] {
            bar(x, 0, z1, x, top, z1)
        }
        bar(x1, 0, (z0 + z1) / 2, x1, top, (z0 + z1) / 2)
        // 위 테두리
        bar(x0, top, z1, x1, top, z1)
        bar(x1, top, z0, x1, top, z1)
        bar(x0 + 0.05, top, z0, x0 + 0.05, top, z1)
        // 아래 받침
        bar(x0, 0.05, z1, doorX0, 0.05, z1)
        bar(x1, 0.05, z0, x1, 0.05, z1)
        // 유리
        pane(x0 + 0.1, z1, doorX0, z1, from: 0.1)
        pane(x1, z0 + 0.1, x1, z1, from: 0.1)
        pane(x0 + 0.05, z0, x0 + 0.05, z1, from: Layout.lowWall + 0.06)
        // 유리 자동 미닫이문. 두 짝이 양옆 유리벽 쪽으로 미끄러진다(updateAutoDoors).
        let door = SCNNode.group("meeting.door").at(doorX0, 0, z1).into(root)
        meetingDoorPivot = door
        let span = doorX1 - doorX0
        let panelWidth = span / 2 - 0.02, panelHeight = top - 0.16
        meetingDoorPanels = []
        for (index, center) in [span / 4, span * 3 / 4].enumerated() {
            // 두 짝 모두 왼쪽(회의실 유리벽 쪽)으로 겹쳐 밀린다. 오른쪽 짝은 앞에서 지나간다.
            let panel = SCNNode.group("meeting.door.\(index)").at(center, 0, index == 0 ? 0.05 : 0.1).into(door)
            Shape.box(panelWidth - 0.08, panelHeight - 0.08, 0.02, round: 0, glass).at(0, panelHeight / 2 + 0.04, 0).noShadow().into(panel)
            let rim: CGFloat = 0.045
            for (w, h, x, y) in [(panelWidth, rim, 0, panelHeight + 0.02), (panelWidth, rim, 0, 0.06),
                                 (rim, panelHeight, -panelWidth / 2 + rim / 2, panelHeight / 2 + 0.04),
                                 (rim, panelHeight, panelWidth / 2 - rim / 2, panelHeight / 2 + 0.04)] as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
                Shape.box(w, h, 0.04, round: 0.01, green).at(x, y, 0).into(panel)
            }
            // 열리면 두 짝 모두 문틀 밖(왼쪽 유리벽 앞)으로 완전히 빠져 문 폭 전체가 빈다.
            // 오른쪽 짝이 문틀 왼쪽 절반에 남으면 지나가는 사람이 유리를 뚫고 나가 보인다.
            let open = -span / 4 + (index == 0 ? 0.04 : 0.1)
            meetingDoorPanels.append((panel, center, open))
        }

        // 탁자와 의자
        let centerX = (x0 + x1) / 2 - 0.1, centerZ = (z0 + z1) / 2 - 0.1
        Furniture.meetingTable().at(centerX, 0, centerZ).into(root)
        for x in [centerX - 0.62, centerX + 0.62] {
            meetingChairs.append(Furniture.meetingChair().turned(y: 180).at(x, 0, centerZ - 0.92).into(root))
            meetingChairs.append(Furniture.meetingChair().at(x, 0, centerZ + 0.92).into(root))
        }
        // 벽 화면
        let board = Furniture.framedBoard(width: 2.2, height: 1.24, image: Textures.meetingBoard(), frame: Palette.charcoal, emissive: true)
        board.node.at(centerX, 1.72, z0 + 0.03).named("meeting.board").into(root)
        meetingBoardFace = board.face
        // 회의실 러그
        Shape.box(3.6, 0.02, 2.6, round: 0.01, Mat.matte(Palette.rugLine.lighter(0.25), roughness: 0.95))
            .at(centerX, 0.011, centerZ).noShadow().into(root)
    }

    // MARK: - 빛

    private func buildLights() {
        let sun = SCNLight()
        sun.type = .directional
        sun.castsShadow = true
        // forward 방식이라 햇빛만 가려진다. 화면이나 전구 같은 발광면은 어두워지지 않는다.
        sun.shadowMode = .forward
        sun.shadowRadius = quality == .full ? 5 : 3
        sun.shadowSampleCount = quality == .full ? 24 : 8
        sun.shadowMapSize = quality == .full ? CGSize(width: 4096, height: 4096) : CGSize(width: 2048, height: 2048)
        sun.shadowBias = 3
        // 그림자 범위를 직접 잡는다. 방 전체와 그 위의 가림판까지 들어가야 한다.
        sun.automaticallyAdjustsShadowProjection = false
        sun.shadowCascadeCount = 1
        sun.zNear = 1
        sun.zFar = 90
        sun.orthographicScale = 12
        sun.categoryBitMask = Layout.visibleCategory
        sunNode.light = sun
        scene.rootNode.addChildNode(sunNode)

        let fill = SCNLight()
        fill.type = .directional
        fill.castsShadow = false
        fill.categoryBitMask = Layout.visibleCategory
        fillNode.light = fill
        // 카메라 쪽에서 낮게 비춘다. 벽은 밝히고 바닥은 덜 밝혀서 창으로 든 햇빛이 바닥에서 도드라진다.
        fillNode.position = SCNVector3(-12, 7.5, 14)
        fillNode.look(at: SCNVector3(1, 0.5, -1))
        scene.rootNode.addChildNode(fillNode)

        let ambient = SCNLight()
        ambient.type = .ambient
        ambient.categoryBitMask = Layout.visibleCategory
        ambientNode.light = ambient
        scene.rootNode.addChildNode(ambientNode)

        let pendant = SCNLight()
        pendant.type = .directional
        pendant.color = Palette.lampWarm
        pendant.intensity = 0
        pendant.castsShadow = false
        pendant.categoryBitMask = Layout.visibleCategory
        pendantLightNode.light = pendant
        // 천장 등 여러 개의 빛을 위에서 아래로 고르게 비추는 빛 하나로 대신한다.
        // 점광원 하나로 대신하면 방 가운데만 하얗게 타고 가장자리가 어두워진다(사용자 지적).
        // 살짝 기울여 벽 아랫부분과 가구 옆면도 조금 밝힌다.
        pendantLightNode.eulerAngles = SCNVector3(-rad(78), rad(20), 0)
        scene.rootNode.addChildNode(pendantLightNode)

        let hall = SCNLight()
        hall.type = .omni
        hall.color = Palette.lampWarm
        hall.intensity = 0
        // 문 주변만 따뜻하게. 멀리 퍼지면 저녁에 방 앞쪽 가운데가 하얗게 뜬다.
        hall.attenuationStartDistance = 0.4
        hall.attenuationEndDistance = 3.2
        hall.attenuationFalloffExponent = 2
        hall.categoryBitMask = Layout.visibleCategory
        hallLightNode.light = hall
        hallLightNode.position = SCNVector3(Layout.doorX1 + 1.1, 2.2, Layout.halfDepth - 1.3)
        scene.rootNode.addChildNode(hallLightNode)

        // 광택 있는 표면에 비치는 은은한 환경
        scene.lightingEnvironment.contents = Textures.environment(top: NSColor(hex: 0xFFFFFF), bottom: NSColor(hex: 0xC9C2B4))
        scene.lightingEnvironment.intensity = 0.55
    }

    // MARK: - 카메라

    private func buildCamera() {
        let camera = SCNCamera()
        camera.fieldOfView = 20
        camera.zNear = 2
        camera.zFar = 160
        camera.categoryBitMask = Layout.visibleCategory
        camera.wantsHDR = true
        camera.wantsExposureAdaptation = false
        // 중간 밝기는 올리고, 햇빛이 닿은 곳이 하얗게 타지 않도록 흰색 기준을 높게 잡는다.
        camera.exposureOffset = 0.5
        camera.whitePoint = 1.5
        camera.averageGray = 0.18
        if quality == .full {
            // 편향값을 낮게 두면 벽 몰딩 같은 얕은 단차에 계단 모양 얼룩이 생긴다.
            // 반경이 크면 몰딩 아래·탕비실 벽 윗머리·냉장고 모서리에 계단 점선이 모든 시간대에 보였다.
            // 반경을 줄이고 편향을 올려 가구 밑 접지 그림자만 남긴다.
            camera.screenSpaceAmbientOcclusionIntensity = 0.55
            camera.screenSpaceAmbientOcclusionRadius = 0.22
            camera.screenSpaceAmbientOcclusionBias = 0.16
            camera.screenSpaceAmbientOcclusionDepthThreshold = 0.2
            camera.screenSpaceAmbientOcclusionNormalThreshold = 0.3
            camera.bloomIntensity = 0.38
            camera.bloomThreshold = 0.92
            camera.bloomBlurRadius = 9
        }
        camera.vignettingIntensity = 0.22
        camera.vignettingPower = 0.7
        camera.saturation = 1.06
        camera.contrast = 0.04
        cameraNode.camera = camera
        cameraNode.name = "camera"

        scene.rootNode.addChildNode(cameraPivot)
        cameraPivot.addChildNode(cameraTilt)
        cameraTilt.addChildNode(cameraNode)
    }

    struct Pose {
        var target: SCNVector3
        /// 좌우로 도는 각(도). 음수면 왼쪽 앞에서 본다.
        var yaw: CGFloat
        /// 내려다보는 각(도).
        var pitch: CGFloat
        var distance: CGFloat
        var fov: CGFloat
    }

    private func pose(for view: OfficeView) -> Pose {
        switch view {
        case .door:
            return Pose(target: SCNVector3(Layout.outsideDoor.x + 0.35, 1.3, Layout.halfDepth + 0.3),
                        yaw: 14, pitch: 7, distance: 9.4, fov: 26)
        case .overview:
            return Pose(target: SCNVector3(0.35, 0.2, 0.25), yaw: -33, pitch: 34, distance: 42, fov: 20)
        case .spot(.myDesk):
            return Pose(target: SCNVector3(-0.6, 0.75, 1.5), yaw: -22, pitch: 47, distance: 14.5, fov: 20)
        case .people:
            return Pose(target: SCNVector3(2.2, 1.0, 1.2), yaw: 168, pitch: 30, distance: 8.5, fov: 20)
        case .spot(.manager):
            return Pose(target: SCNVector3(3.7, 0.9, 1.0), yaw: -30, pitch: 30, distance: 14.5, fov: 20)
        case .spot(.meeting):
            // 앞 왼쪽에서 보면 탕비실 벽이 가린다. 앞 오른쪽 위에서 본다.
            return Pose(target: SCNVector3(-4.6, 0.9, -3.1), yaw: 24, pitch: 40, distance: 15, fov: 20)
        }
    }

    /// 카메라 구도를 바꾼다.
    public func setView(_ view: OfficeView, animated: Bool, duration: TimeInterval = 1.1) {
        self.view = view
        // 영화 장면 중이면 끝난 뒤 이 구도로 돌아간다.
        guard !filmActive else { return }
        applyPose(animated: animated, duration: duration)
    }

    /// 오른쪽 패널에 가려지지 않게 장면을 왼쪽으로 민다. 단위는 화면 폭에 대한 비율(0~0.5).
    public func setPanelShift(_ fraction: CGFloat, animated: Bool) {
        panelShift = max(0, min(0.5, fraction))
        guard !filmActive else { return }
        applyPose(animated: animated, duration: 0.45)
    }

    /// 장면 시계에 맞춰 `duration`초 동안 0→1(부드럽게)을 넘긴다.
    func tween(_ duration: Double, delay: Double = 0, _ step: @escaping @MainActor (Double) -> Void) {
        tweens.append(Tween(start: clock + delay, duration: max(0.01, duration), step: step))
    }

    private func runTweens() {
        guard !tweens.isEmpty else { return }
        tweens = tweens.filter { tween in
            let raw = (clock - tween.start) / tween.duration
            guard raw >= 0 else { return true }
            tween.step(smoothstep(0, 1, min(1, raw)))
            return raw < 1
        }
    }

    /// 구도를 장면 시계로 옮긴다(입장 장면).
    func glideView(to next: OfficeView, duration: Double, delay: Double = 0) {
        let from = currentPose()
        view = next
        let to = shiftedPose(for: next)
        tween(duration, delay: delay) { [weak self] t in
            guard let self else { return }
            func mix(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * CGFloat(t) }
            self.place(camera: Pose(
                target: SCNVector3(mix(from.target.x, to.target.x), mix(from.target.y, to.target.y), mix(from.target.z, to.target.z)),
                yaw: mix(from.yaw, to.yaw), pitch: mix(from.pitch, to.pitch),
                distance: mix(from.distance, to.distance), fov: mix(from.fov, to.fov)))
        }
    }

    func currentPose() -> Pose {
        Pose(target: cameraPivot.position, yaw: cameraPivot.eulerAngles.y * 180 / .pi,
             pitch: -cameraTilt.eulerAngles.x * 180 / .pi, distance: cameraNode.position.z,
             fov: cameraNode.camera?.fieldOfView ?? 20)
    }

    func place(camera pose: Pose) {
        cameraPivot.position = pose.target
        cameraPivot.eulerAngles = SCNVector3(0, rad(pose.yaw), 0)
        cameraTilt.eulerAngles = SCNVector3(-rad(pose.pitch), 0, 0)
        cameraNode.position = SCNVector3(0, 0, pose.distance)
        cameraNode.camera?.fieldOfView = pose.fov
    }

    func shiftedPose(for view: OfficeView) -> Pose {
        var pose = self.pose(for: view)
        if panelShift > 0, view != .door {
            let visibleHeight = 2 * pose.distance * tan(rad(pose.fov) / 2)
            let visibleWidth = visibleHeight * 1.6
            let shift = visibleWidth * panelShift * 0.5
            let yaw = rad(pose.yaw)
            pose.target = SCNVector3(pose.target.x + cos(yaw) * shift, pose.target.y, pose.target.z - sin(yaw) * shift)
        }
        return pose
    }

    private func applyPose(animated: Bool, duration: TimeInterval) {
        var pose = self.pose(for: view)
        if panelShift > 0, view != .door {
            // 화면에 보이는 가로 폭(미터)을 구해 그 비율만큼 카메라를 오른쪽으로 옮긴다.
            let visibleHeight = 2 * pose.distance * tan(rad(pose.fov) / 2)
            let visibleWidth = visibleHeight * 1.6
            let shift = visibleWidth * panelShift * 0.5
            let yaw = rad(pose.yaw)
            pose.target = SCNVector3(pose.target.x + cos(yaw) * shift, pose.target.y, pose.target.z - sin(yaw) * shift)
        }
        SCNTransaction.begin()
        SCNTransaction.animationDuration = animated ? duration : 0
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        cameraPivot.position = pose.target
        cameraPivot.eulerAngles = SCNVector3(0, rad(pose.yaw), 0)
        cameraTilt.eulerAngles = SCNVector3(-rad(pose.pitch), 0, 0)
        cameraNode.position = SCNVector3(0, 0, pose.distance)
        cameraNode.camera?.fieldOfView = pose.fov
        SCNTransaction.commit()
    }

    // MARK: - 누르는 장소

    private func buildSpots() {
        let areas: [(OfficeSpot, SCNVector3, SCNVector3)] = [
            (.myDesk, SCNVector3(-0.9, 0.85, 1.75), SCNVector3(1.5, 1.9, 1.75)),
            (.manager, SCNVector3(3.95, 0.95, 1.0), SCNVector3(1.8, 2.1, 2.2)),
            (.meeting, SCNVector3(-4.65, 1.3, -3.1), SCNVector3(4.7, 2.7, 3.8)),
        ]
        for (spot, center, size) in areas {
            // 넉넉한 누름 영역. 화면에는 보이지 않는다.
            let hit = SCNNode(geometry: SCNBox(width: size.x, height: size.y, length: size.z, chamferRadius: 0))
            hit.geometry?.firstMaterial?.diffuse.contents = NSColor.clear
            hit.position = center
            hit.name = "spot.\(spot.rawValue)"
            hit.categoryBitMask = Layout.hitCategory
            hit.castsShadow = false
            scene.rootNode.addChildNode(hit)
            hitNodes[spot] = hit

            // 가리킬 때 바닥에 뜨는 테두리
            let ring = SCNNode.group("highlight.\(spot.rawValue)")
            let glow = Mat.glow(NSColor(hex: 0x7DE3B0), strength: 1.3)
            let w = size.x, l = size.z, bar: CGFloat = 0.07
            for (px, pz, sx, sz) in [(0, -l / 2, w, bar), (0, l / 2, w, bar), (-w / 2, 0, bar, l), (w / 2, 0, bar, l)] as [(CGFloat, CGFloat, CGFloat, CGFloat)] {
                Shape.box(sx, 0.02, sz, round: 0.01, glow).at(px, 0, pz).into(ring)
            }
            ring.position = SCNVector3(center.x, 0.03, center.z)
            ring.opacity = 0
            ring.noShadow()
            scene.rootNode.addChildNode(ring)
            highlights[spot] = ring
        }
    }

    /// 누른 노드가 어느 장소인지.
    public func spot(for node: SCNNode) -> OfficeSpot? {
        var current: SCNNode? = node
        while let candidate = current {
            if let name = candidate.name, name.hasPrefix("spot."),
               let spot = OfficeSpot(rawValue: String(name.dropFirst("spot.".count))) {
                return spot
            }
            current = candidate.parent
        }
        return nil
    }

    /// 누름 판정에 쓰는 분류값.
    public var hitCategory: Int { Layout.hitCategory }

    /// 장소 이름표를 띄울 3D 위치.
    /// 사람 머리 위에 띄우면 이름표가 동료와 회의 중인 사람을 가린다. 그래서 책상 앞 빈 바닥(통로)이나 회의실 뒷벽 위에 둔다.
    public func labelAnchor(for spot: OfficeSpot) -> SCNVector3 {
        switch spot {
        case .myDesk: SCNVector3(-0.9, 0.2, 2.7)
        case .manager: SCNVector3(4.9, 0.2, 2.55)
        case .meeting: SCNVector3(-4.3, 3.0, -4.95)
        }
    }

    /// 가리킨 장소에 테두리를 띄운다.
    public func setHighlight(_ spot: OfficeSpot?) {
        SCNTransaction.begin()
        SCNTransaction.animationDuration = 0.18
        for (key, node) in highlights {
            node.opacity = key == spot ? 1 : 0
        }
        SCNTransaction.commit()
    }

    // MARK: - 시각과 빛

    /// 가상 시각(자정 기준 분)에 맞춰 창밖과 실내 조명을 바꾼다.
    public func setTime(minutes: Double, animated: Bool) {
        targetMinute = max(0, min(24 * 60 - 1, minutes))
        // '+1시간'처럼 크게 건너뛰면 빛만 1초쯤 따라가고, 사람·문·의자는 걷지 않고 바로 그 시각의 모습으로 둔다.
        if animated, abs(targetMinute - shownMinute) > 10 {
            catchingUp = true
            resetHandDoors()
        }
        if !animated {
            shownMinute = targetMinute
            // 시각이 한 번에 바뀌면(앱을 저녁에 열 때, 새 날) 동료는 걷지 않고 바로 그 시각의 자리에 둔다.
            instantCoworkers = true
            resetHandDoors()
            applyLook()
            instantCoworkers = false
        }
    }

    /// 화면을 그릴 때마다 부른다. 시각이 바뀌는 중이면 빛을 조금씩 옮긴다.
    /// - Returns: 아직 바뀌는 중이면 true
    @discardableResult
    public func update(deltaTime: TimeInterval) -> Bool {
        clock += max(0, min(0.1, deltaTime))
        runTweens()
        updateErrands()
        animateCrew(at: clock)
        updateAutoDoors(max(0, min(0.1, deltaTime)))
        updateFilm(max(0, min(0.1, deltaTime)))
        let gap = targetMinute - shownMinute
        guard abs(gap) > 0.01 else {
            if catchingUp {
                // 다 따라왔으면 마지막으로 한 번 더 그 시각의 자리에 맞춘다.
                catchingUp = false
                instantCoworkers = true
                applyLook()
                instantCoworkers = false
            }
            return true
        }
        // 한 시간 건너뛰기는 1초쯤 걸려 따라간다.
        let step = max(abs(gap) * min(1, deltaTime * 4.5), deltaTime * 20)
        shownMinute += gap > 0 ? min(gap, step) : max(gap, -step)
        applyLook()
        return true
    }

    func applyLook() {
        let look = DayCycle.look(at: shownMinute)

        // 해. 창밖(+X) 높은 곳에서 방 안으로 비춘다.
        let elevation = rad(look.sunElevation), azimuth = rad(look.sunAzimuth)
        let direction = SCNVector3(-cos(elevation) * cos(azimuth), -sin(elevation), -cos(elevation) * sin(azimuth))
        let center = SCNVector3(0.3, 1.0, 0.6)
        sunNode.position = SCNVector3(center.x - direction.x * 34, center.y - direction.y * 34, center.z - direction.z * 34)
        sunNode.look(at: center)
        sunNode.light?.color = look.sunColor
        sunNode.light?.intensity = look.sunIntensity

        fillNode.light?.color = look.fillColor
        fillNode.light?.intensity = look.fillIntensity
        ambientNode.light?.color = look.ambientColor
        ambientNode.light?.intensity = look.ambientIntensity
        // 광택 면에 비치는 환경도 밤에는 어둡게 한다.
        scene.lightingEnvironment.intensity = max(0.1, min(0.6, look.ambientIntensity / 450 * 0.55))

        // 창밖
        parts.sky.geometry = Outdoors.skyGeometry(width: Outdoors.skyWidth, height: Outdoors.skyHeight,
                                                  top: look.skyTop, middle: look.skyMiddle, bottom: look.skyBottom)
        for building in parts.buildings {
            building.geometry?.firstMaterial?.diffuse.contents = look.building
        }
        for (index, light) in parts.cityLights.enumerated() {
            // 불빛이 한꺼번에 켜지지 않고 하나씩 켜지게 한다.
            let threshold = CGFloat((index * 37) % 100) / 100 * 0.8
            light.opacity = max(0, min(1, (look.cityLights - threshold) / 0.2))
        }
        scene.background.contents = look.backdrop
        parts.glassPanes.childNodes.first?.geometry?.firstMaterial?.diffuse.contents = look.glassTint

        // 실내등
        // 꺼진 전구는 검은 구멍처럼 보이지 않게 젖빛 유리 색으로 둔다(밝기는 주변 빛을 따라간다).
        let offBulb = NSColor(hex: 0xE9E2D3).mixed(NSColor(hex: 0x3A3B4E), 1 - min(1, look.ambientIntensity / 340))
        for bulb in pendantBulbs {
            bulb.geometry?.firstMaterial?.diffuse.contents = offBulb
            bulb.geometry?.firstMaterial?.emission.intensity = look.pendants * 1.7
        }
        hallBulb?.geometry?.firstMaterial?.diffuse.contents = offBulb
        // 회의실 화면: 밤에 방이 어두운데 화면만 하얗게 타서 눈부시지 않게 낮춘다.
        meetingBoardFace?.geometry?.firstMaterial?.emission.intensity = 0.55 + 0.45 * min(1, look.ambientIntensity / 340)
        pendantLightNode.light?.intensity = look.pendants * 230
        hallBulb?.geometry?.firstMaterial?.emission.intensity = look.hall * 1.0
        // 문틀 오른쪽 기둥과 낮은 벽 윗머리에 빛 띠가 생기지 않게 약하게.
        hallLightNode.light?.intensity = look.hall * 11

        // 스탠드
        let myLamp = myLampOn ? look.deskLamp : 0
        myDesk?.lampBulb?.geometry?.firstMaterial?.emission.intensity = myLamp * 0.85
        // 낮에는 거의 없고, 어두울 때도 책상을 은은하게만 비춘다(세면 머리·상판이 하얗게 탄다).
        myDesk?.lampLight?.light?.intensity = myLamp * myLamp * 24

        // 모니터
        setScreen(myDesk, on: myScreenOn, image: Textures.screenChecklist(items: checklist))
        // 화면 빛은 책상에서 가까워 조금만 세도 상판이 하얗게 탄다. 어두울 때만 은은하게 켠다.
        myDesk?.screenLight?.light?.intensity = myScreenOn ? 0.6 + (1 - min(1, look.fillIntensity / 470)) * 1.4 : 0
        // 동기와 팀장의 모니터·스탠드는 그 사람이 자리에 있을 때만 켠다(updateCoworkers).
        updateCoworkers()

        // 벽시계
        let hours = shownMinute / 60
        clockHands?.hour.eulerAngles.z = -rad(CGFloat(hours.truncatingRemainder(dividingBy: 12)) / 12 * 360)
        clockHands?.minute.eulerAngles.z = -rad(CGFloat(shownMinute.truncatingRemainder(dividingBy: 60)) / 60 * 360)
    }

    private var screenStates: [ObjectIdentifier: Bool] = [:]
    private var myScreenSignature = ""

    func setScreen(_ desk: Furniture.Desk?, on: Bool, image: @autoclosure () -> NSImage) {
        guard let desk else { return }
        let key = ObjectIdentifier(desk.screen)
        let isMine = desk.screen === myDesk?.screen
        let signature = isMine ? checklist.map { "\($0.level)\($0.done ? "y" : "n")" }.joined() : ""
        if screenStates[key] == on, !isMine || signature == myScreenSignature { return }
        screenStates[key] = on
        if isMine { myScreenSignature = signature }
        let material = desk.screen.geometry?.firstMaterial
        material?.emission.contents = on ? image() : Textures.screenOff()
        material?.emission.intensity = on ? 1.0 : 0.35
    }


    // MARK: - 내 자리 상태

    /// 내 모니터와 스탠드를 켜고 끈다. 출근해서 일하는 동안 켠다.
    public func setMyDeskActive(_ active: Bool) {
        // 퇴근 연출 중에는 일어나 돌아설 때 끈다.
        if holdDeskOn, !active { return }
        guard myScreenOn != active || myLampOn != active else { return }
        myScreenOn = active
        myLampOn = active
        applyLook()
    }

    /// 내 모니터에 보이는 체크리스트를 바꾼다.
    public func setChecklist(_ items: [(level: Int, done: Bool)]) {
        checklist = items
        applyLook()
    }

    // MARK: - 문과 앞벽

    /// 출입문을 열거나 닫는다. 안쪽으로 열린다.
    public func setDoorOpen(_ open: Bool, animated: Bool, duration: TimeInterval = 0.9) {
        // 문은 사람이 손으로 열고 닫는다. 여기서는 닫아 두기만 한다.
        doorAuto = open
        if open { return }
        if !handDoors.isEmpty { handDoors[0].crossing = nil; setHandDoor(0, open: false, animated: !animated ? false : true) }
        SCNTransaction.begin()
        SCNTransaction.animationDuration = animated ? duration : 0
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        parts.doorPivot.eulerAngles.y = 0
        SCNTransaction.commit()
    }

    /// 앞벽 윗부분을 올리거나 내린다. 출근 전에는 올려서 실내를 가린다.
    public func setFrontWallRaised(_ raised: Bool, animated: Bool, duration: TimeInterval = 1.0) {
        SCNTransaction.begin()
        SCNTransaction.animationDuration = animated ? duration : 0
        SCNTransaction.animationTimingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        parts.frontUpper.position.y = raised ? 0 : -(Layout.wallHeight - Layout.lowWall)
        parts.frontUpper.opacity = raised ? 1 : 0
        // 간판은 바깥 얼굴이라 사무실을 내려다볼 때는 내 자리를 가린다. 앞벽과 함께 치운다.
        parts.signNode.opacity = raised ? 1 : 0
        SCNTransaction.commit()
    }

    /// 출근 단말기 화면을 바꾼다.
    public func setTerminal(checkedInAt time: String?) {
        let image = time.map { Textures.terminal(title: $0, detail: "출근 완료", checked: true) }
            ?? Textures.terminal(title: "출근", detail: "카메라 앞에 앉기", checked: false)
        parts.terminalScreen.geometry?.firstMaterial?.emission.contents = image
    }
}

// MARK: - 확인 도구용

extension OfficeStage {
    /// 그림 뽑기 도구가 카메라를 한 자리에 고정한다.
    public func debugCamera(target: SCNVector3, yaw: CGFloat, pitch: CGFloat, distance: CGFloat, fov: CGFloat = 22) {
        let pose = Pose(target: target, yaw: yaw, pitch: pitch, distance: distance, fov: fov)
        filmActive = true
        film = .fixed(pose)
        filmPose = pose
        place(camera: pose)
    }

    /// 고정을 푼다.
    public func debugReleaseCamera() {
        filmActive = false
        film = nil
        setView(view, animated: false)
    }

    /// 동료 한 명에게 지금 바로 잠깐 외출을 시킨다(조직도 순서, 나 제외).
    public func debugErrandNow(_ index: Int) {
        let person = coworkers[index % coworkers.count]
        nextErrand[ObjectIdentifier(person)] = clock
    }

    /// 지금 바로 보고를 시킨다(시험용). 보고하는 사람 id.
    @discardableResult
    public func debugReport(_ id: String) -> Bool {
        guard let boss = Organization.member(id)?.reportsTo else { return false }
        return startReport(coworker(id), to: boss)
    }

    /// 서 있거나 걷는 사람끼리 가장 가까운 거리와 그 두 사람(시험용). 앉은 사람은 뺀다.
    public var debugClosestPair: (Double, String) {
        let people = ([me, courier] + coworkers).filter { person in
            !person.root.isHidden && person.root.opacity > 0.5 && person.root.parent === parts.root
                && ![.sitTyping, .sitTypingWithMug, .sitListen, .sitEat, .sitReview, .sitExplain].contains(person.activity)
        }
        var best = (99.0, "")
        for (i, a) in people.enumerated() {
            for b in people.dropFirst(i + 1) {
                let pa = a.root.position, pb = b.root.position
                let d = Double(hypot(pa.x - pb.x, pa.z - pb.z))
                if d < best.0 {
                    best = (d, String(format: "%@-%@ %@/%@ (%.1f,%.1f)", a.memberID.isEmpty ? "기사" : a.memberID, b.memberID.isEmpty ? "기사" : b.memberID,
                                      "\(a.activity)", "\(b.activity)", Double(pa.x), Double(pa.z)))
                }
            }
        }
        return best
    }

    /// 걷는 사람이 벽·책상 안에 들어가 있으면 그 이름들(시험용).
    public var debugWallHits: [String] {
        var hits: [String] = []
        for person in [me, courier] + coworkers where person.isWalking && !person.root.isHidden && person.root.parent === parts.root {
            let p = person.root.position
            for (name, x0, z0, x1, z1) in obstacleRects where p.x > x0 - 0.08 && p.x < x1 + 0.08 && p.z > z0 - 0.08 && p.z < z1 + 0.08 {
                hits.append(String(format: "%@→%@ (%.2f,%.2f)", person.memberID.isEmpty ? "기사" : person.memberID, name, Double(p.x), Double(p.z)))
            }
        }
        return hits
    }

    /// 사람이 들어가면 안 되는 곳(벽, 책상, 탁자). 사무실 XZ 사각형.
    var obstacleRects: [(String, CGFloat, CGFloat, CGFloat, CGFloat)] {
        let island0 = Layout.islandX.min()! - Layout.islandDeskWidth / 2, island1 = Layout.islandX.max()! + Layout.islandDeskWidth / 2
        let rects: [(String, CGFloat, CGFloat, CGFloat, CGFloat)] = [
            ("섬 책상", island0, Layout.islandZ - 0.7, island1, Layout.islandZ + 0.7),
            ("팀장 책상", 3.1, 0.2, 3.85, 1.8),
            ("부장 책상", 0.25, -3.6, 2.15, -2.75),
            ("탕비실 오른벽(앞)", Layout.pantryX1 - 0.05, Layout.pantryDoorZ + 0.55, Layout.pantryX1 + 0.05, Layout.halfDepth),
            ("탕비실 오른벽(뒤)", Layout.pantryX1 - 0.05, Layout.pantryZ0, Layout.pantryX1 + 0.05, Layout.pantryDoorZ - 0.55),
            ("탕비실 뒷벽", -Layout.halfWidth, Layout.pantryZ0 - 0.05, Layout.pantryX1, Layout.pantryZ0 + 0.05),
            ("화장실 왼벽", Layout.restroomX0 - 0.06, -Layout.halfDepth, Layout.restroomX0 + 0.06, Layout.restroomZ1),
            ("화장실 앞벽", Layout.restroomX0, Layout.restroomZ1 - 0.06, Layout.restroomX - 0.5, Layout.restroomZ1 + 0.06),
            ("회의실 앞 유리", -Layout.halfWidth, Layout.meetingZ1 - 0.05, Layout.meetingX1 - 1.3, Layout.meetingZ1 + 0.05),
            ("회의실 오른 유리", Layout.meetingX1 - 0.05, -Layout.halfDepth, Layout.meetingX1 + 0.05, Layout.meetingZ1),
            ("회의 탁자", Layout.meetingCenterX - 1.2, Layout.meetingCenterZ - 0.57, Layout.meetingCenterX + 1.2, Layout.meetingCenterZ + 0.57),
            ("회의 의자1", Layout.meetingCenterX - 0.62 - 0.22, Layout.meetingCenterZ - 0.92 - 0.21, Layout.meetingCenterX - 0.62 + 0.22, Layout.meetingCenterZ - 0.92 + 0.21),
            ("회의 의자2", Layout.meetingCenterX + 0.62 - 0.22, Layout.meetingCenterZ - 0.92 - 0.21, Layout.meetingCenterX + 0.62 + 0.22, Layout.meetingCenterZ - 0.92 + 0.21),
            ("회의 의자3", Layout.meetingCenterX - 0.62 - 0.22, Layout.meetingCenterZ + 0.92 - 0.21, Layout.meetingCenterX - 0.62 + 0.22, Layout.meetingCenterZ + 0.92 + 0.21),
            ("회의 의자4", Layout.meetingCenterX + 0.62 - 0.22, Layout.meetingCenterZ + 0.92 - 0.21, Layout.meetingCenterX + 0.62 + 0.22, Layout.meetingCenterZ + 0.92 + 0.21),
            ("간식 탁자", Layout.snackTable.x - 0.28, Layout.snackTable.z - 0.28, Layout.snackTable.x + 0.28, Layout.snackTable.z + 0.28),
        ]
        return rects
    }

    /// 그 점(사무실 XZ)이 벽·가구에서 margin 넘게 떨어진 빈 바닥인지.
    func isOpenFloor(_ x: CGFloat, _ z: CGFloat, margin: CGFloat = 0.2) -> Bool {
        let inside = x > -Layout.halfWidth + margin && x < Layout.halfWidth - margin && z > -Layout.halfDepth + margin && z < Layout.halfDepth - margin
        guard inside else { return false }
        return !obstacleRects.contains { _, x0, z0, x1, z1 in x > x0 - margin && x < x1 + margin && z > z0 - margin && z < z1 + margin }
    }

    /// 덜 열린 자동문을 지나가는 사람(시험용).
    public var debugDoorPanelHits: [String] {
        var hits: [String] = []
        for door in handDoors where door.automatic {
            for person in [me, courier] + coworkers where person.isWalking && !person.root.isHidden && person.root.parent === parts.root {
                let p = person.root.position
                if abs(p.z - door.planeZ) < 0.15, p.x > door.x0 - 0.05, p.x < door.x1 + 0.05, door.fraction < 0.8 {
                    hits.append(String(format: "%@ 열림 %.2f (%.2f,%.2f)", person.memberID.isEmpty ? "기사" : person.memberID, Double(door.fraction), Double(p.x), Double(p.z)))
                }
            }
        }
        return hits
    }

    /// 걷는 사람들의 위치(시험용).
    public var debugWalkers: [(String, CGPoint)] {
        ([me, courier] + coworkers).filter { $0.isWalking && !$0.root.isHidden && $0.root.parent === parts.root }
            .map { ($0.memberID.isEmpty ? "기사" : $0.memberID, CGPoint(x: $0.root.position.x, y: $0.root.position.z)) }
    }

    /// 한 사람의 위치·보는 방향·동작(시험용).
    public func debugState(_ id: String) -> String {
        guard let person = ([me, courier] + coworkers).first(where: { $0.memberID == id }) else { return id }
        let f = person.forward
        return String(format: "%@(%.2f,%.2f 방향 %.0f° %@)", id, Double(person.root.position.x), Double(person.root.position.z),
                      Double(atan2(f.x, f.y) * 180 / .pi), "\(person.activity)")
    }

    /// 내 캐릭터 위치(사무실 XZ, 시험용).
    public var debugMePosition: CGPoint { CGPoint(x: me.root.position.x, y: me.root.position.z) }

    /// 그 시각에 일하는 동료 수(시험용).
    public func debugWorkingCount(at minute: Double) -> Int {
        coworkers.filter { state(for: $0, at: minute) == .working }.count
    }

    /// 사람들의 지금 상태 요약(시험 출력용).
    public var debugSummary: String {
        func line(_ name: String, _ person: Person) -> String {
            let p = person.root.convertPosition(SCNVector3Zero, to: parts.root)
            return String(format: "%@ %@ (%.1f, %.1f) 투명 %.2f %@", name, "\(person.activity)", p.x, p.z, person.root.opacity, person.isBusy ? "할일" : "")
        }
        return ([line("나", me)] + coworkers.map { line(Organization.member($0.memberID)?.name ?? $0.memberID, $0) } + [line("기사", courier)])
            .joined(separator: " | ")
    }
}
