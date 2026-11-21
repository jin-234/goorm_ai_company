import AppKit
import SceneKit

/// 어떤 시각의 빛 상태.
struct DayLook {
    /// 창으로 들어오는 햇빛
    var sunColor: NSColor
    var sunIntensity: CGFloat
    /// 해의 높이(도). 낮을수록 빛이 바닥에 길게 들어온다.
    var sunElevation: CGFloat
    /// 해의 좌우 위치(도). 0이면 창 정면.
    var sunAzimuth: CGFloat

    /// 창밖 하늘
    var skyTop: NSColor
    var skyMiddle: NSColor
    var skyBottom: NSColor
    var building: NSColor
    /// 창밖 건물 불빛 0~1
    var cityLights: CGFloat

    /// 실내에 퍼진 빛
    var ambientColor: NSColor
    var ambientIntensity: CGFloat
    var fillColor: NSColor
    var fillIntensity: CGFloat

    /// 모형 바깥 배경
    var backdrop: NSColor
    /// 천장 등 0~1
    var pendants: CGFloat
    /// 복도등 0~1
    var hall: CGFloat
    /// 책상 스탠드 0~1
    var deskLamp: CGFloat
    /// 유리에 비치는 밝기
    var glassTint: NSColor

    static func mix(_ a: DayLook, _ b: DayLook, _ t: CGFloat) -> DayLook {
        func n(_ x: CGFloat, _ y: CGFloat) -> CGFloat { x + (y - x) * t }
        return DayLook(
            sunColor: a.sunColor.mixed(b.sunColor, t), sunIntensity: n(a.sunIntensity, b.sunIntensity),
            sunElevation: n(a.sunElevation, b.sunElevation), sunAzimuth: n(a.sunAzimuth, b.sunAzimuth),
            skyTop: a.skyTop.mixed(b.skyTop, t), skyMiddle: a.skyMiddle.mixed(b.skyMiddle, t),
            skyBottom: a.skyBottom.mixed(b.skyBottom, t), building: a.building.mixed(b.building, t),
            cityLights: n(a.cityLights, b.cityLights),
            ambientColor: a.ambientColor.mixed(b.ambientColor, t), ambientIntensity: n(a.ambientIntensity, b.ambientIntensity),
            fillColor: a.fillColor.mixed(b.fillColor, t), fillIntensity: n(a.fillIntensity, b.fillIntensity),
            backdrop: a.backdrop.mixed(b.backdrop, t), pendants: n(a.pendants, b.pendants), hall: n(a.hall, b.hall),
            deskLamp: n(a.deskLamp, b.deskLamp), glassTint: a.glassTint.mixed(b.glassTint, t))
    }
}

/// 시각별 빛. 아침 금빛 → 낮 → 노을 → 짙은 남색 밤.
enum DayCycle {
    /// (자정 기준 분, 빛)
    static let keys: [(minute: Double, look: DayLook)] = [
        (6 * 60, DayLook(
            sunColor: NSColor(hex: 0xFFC58A), sunIntensity: 0, sunElevation: 6, sunAzimuth: 24,
            skyTop: NSColor(hex: 0x51648F), skyMiddle: NSColor(hex: 0x8C93B5), skyBottom: NSColor(hex: 0xE2B9A0),
            building: NSColor(hex: 0x66739A), cityLights: 0.5,
            ambientColor: NSColor(hex: 0xA9B6DA), ambientIntensity: 250,
            fillColor: NSColor(hex: 0xB8C2E0), fillIntensity: 200,
            backdrop: NSColor(hex: 0x4B5578), pendants: 0.6, hall: 1, deskLamp: 0.6, glassTint: NSColor(hex: 0xB9C6E2))),
        (8 * 60, DayLook(
            sunColor: NSColor(hex: 0xFFD49A), sunIntensity: 1700, sunElevation: 15, sunAzimuth: 22,
            skyTop: NSColor(hex: 0x9CC9EA), skyMiddle: NSColor(hex: 0xD5E6EE), skyBottom: NSColor(hex: 0xFBE3BF),
            building: NSColor(hex: 0xB7C6D4), cityLights: 0,
            ambientColor: NSColor(hex: 0xFFF2DF), ambientIntensity: 330,
            fillColor: NSColor(hex: 0xFFF0DA), fillIntensity: 330,
            backdrop: NSColor(hex: 0xEDE4D2), pendants: 0.15, hall: 0.3, deskLamp: 0.5, glassTint: NSColor(hex: 0xF3F3E6))),
        // 09:00 출근. 옅은 금빛이 창으로 들어온다.
        (9 * 60, DayLook(
            sunColor: NSColor(hex: 0xFFDCA6), sunIntensity: 2100, sunElevation: 21, sunAzimuth: 18,
            skyTop: NSColor(hex: 0x8FC4EC), skyMiddle: NSColor(hex: 0xCFE5F1), skyBottom: NSColor(hex: 0xFAE9C9),
            building: NSColor(hex: 0xB9CAD8), cityLights: 0,
            ambientColor: NSColor(hex: 0xFFF4E2), ambientIntensity: 360,
            fillColor: NSColor(hex: 0xFFF3E0), fillIntensity: 370,
            backdrop: NSColor(hex: 0xEFE7D6), pendants: 0, hall: 0, deskLamp: 0.45, glassTint: NSColor(hex: 0xF4F6EC))),
        // 낮. 창밖이 밝고 그림자가 짧다.
        (12 * 60 + 30, DayLook(
            sunColor: NSColor(hex: 0xFFF7EA), sunIntensity: 1900, sunElevation: 60, sunAzimuth: 0,
            skyTop: NSColor(hex: 0x6DB6EE), skyMiddle: NSColor(hex: 0xB5DCF5), skyBottom: NSColor(hex: 0xE8F3F7),
            building: NSColor(hex: 0xBFD3E2), cityLights: 0,
            ambientColor: NSColor(hex: 0xFBF6EC), ambientIntensity: 340,
            fillColor: NSColor(hex: 0xFFF8EC), fillIntensity: 340,
            backdrop: NSColor(hex: 0xF1EBDD), pendants: 0, hall: 0, deskLamp: 0.3, glassTint: NSColor(hex: 0xF2F8F8))),
        (15 * 60 + 30, DayLook(
            sunColor: NSColor(hex: 0xFFF0D6), sunIntensity: 2100, sunElevation: 42, sunAzimuth: -10,
            skyTop: NSColor(hex: 0x7ABDED), skyMiddle: NSColor(hex: 0xBFE0F3), skyBottom: NSColor(hex: 0xF1F0E2),
            building: NSColor(hex: 0xBDD0DE), cityLights: 0,
            ambientColor: NSColor(hex: 0xFFF7EA), ambientIntensity: 370,
            fillColor: NSColor(hex: 0xFFF8EA), fillIntensity: 370,
            backdrop: NSColor(hex: 0xF0E9DA), pendants: 0, hall: 0, deskLamp: 0.35, glassTint: NSColor(hex: 0xF4F6EE))),
        (17 * 60, DayLook(
            sunColor: NSColor(hex: 0xFFCB8C), sunIntensity: 1450, sunElevation: 22, sunAzimuth: -18,
            skyTop: NSColor(hex: 0x8DB4E2), skyMiddle: NSColor(hex: 0xE3D6D2), skyBottom: NSColor(hex: 0xFFD3A0),
            building: NSColor(hex: 0xB3B7CC), cityLights: 0,
            ambientColor: NSColor(hex: 0xFCEEE2), ambientIntensity: 350,
            fillColor: NSColor(hex: 0xFCECDD), fillIntensity: 350,
            backdrop: NSColor(hex: 0xEEE4D7), pendants: 0.1, hall: 0.2, deskLamp: 0.5, glassTint: NSColor(hex: 0xF7E9D6))),
        // 18:00 퇴근 점검. 노을이 바닥에 길게 들어온다.
        (18 * 60, DayLook(
            sunColor: NSColor(hex: 0xFF9A54), sunIntensity: 1050, sunElevation: 10.5, sunAzimuth: -22,
            skyTop: NSColor(hex: 0x7F8FCB), skyMiddle: NSColor(hex: 0xF3A98C), skyBottom: NSColor(hex: 0xFF8A52),
            building: NSColor(hex: 0x8D7FA6), cityLights: 0.25,
            // 노을색은 햇빛(창으로 드는 빛)에만 둔다. 그늘까지 주황으로 물들이면 화면 전체가 색 바랜 사진처럼 탁하다.
            ambientColor: NSColor(hex: 0xF3E4DA), ambientIntensity: 290,
            fillColor: NSColor(hex: 0xF5E0D2), fillIntensity: 270,
            backdrop: NSColor(hex: 0xE4D6CC), pendants: 0.3, hall: 0.6, deskLamp: 0.7, glassTint: NSColor(hex: 0xF8C9A6))),
        (19 * 60, DayLook(
            sunColor: NSColor(hex: 0xE0705A), sunIntensity: 0, sunElevation: 3, sunAzimuth: -24,
            skyTop: NSColor(hex: 0x2B3A72), skyMiddle: NSColor(hex: 0x65588C), skyBottom: NSColor(hex: 0xC9796D),
            building: NSColor(hex: 0x3A3F6E), cityLights: 0.8,
            ambientColor: NSColor(hex: 0xB9BDE2), ambientIntensity: 220,
            fillColor: NSColor(hex: 0xAEB6E0), fillIntensity: 150,
            backdrop: NSColor(hex: 0x3F426B), pendants: 0.75, hall: 1, deskLamp: 1, glassTint: NSColor(hex: 0x8E8FC0))),
        // 20:00 추가근무. 창밖은 짙은 남색, 내 책상 스탠드와 복도등만 남는다.
        (20 * 60, DayLook(
            sunColor: NSColor(hex: 0x8CA2E6), sunIntensity: 0, sunElevation: 30, sunAzimuth: 0,
            skyTop: NSColor(hex: 0x0E1638), skyMiddle: NSColor(hex: 0x18265A), skyBottom: NSColor(hex: 0x2A3A78),
            building: NSColor(hex: 0x1A2350), cityLights: 1,
            ambientColor: NSColor(hex: 0x8F9DDC), ambientIntensity: 150,
            fillColor: NSColor(hex: 0x8496E0), fillIntensity: 95,
            backdrop: NSColor(hex: 0x1B2244), pendants: 0, hall: 1, deskLamp: 1, glassTint: NSColor(hex: 0x54629E))),
        (23 * 60 + 59, DayLook(
            sunColor: NSColor(hex: 0x8CA2E6), sunIntensity: 0, sunElevation: 30, sunAzimuth: 0,
            skyTop: NSColor(hex: 0x090F2A), skyMiddle: NSColor(hex: 0x111C48), skyBottom: NSColor(hex: 0x1F2C62),
            building: NSColor(hex: 0x141B42), cityLights: 0.85,
            ambientColor: NSColor(hex: 0x8491D2), ambientIntensity: 135,
            fillColor: NSColor(hex: 0x7C8EDA), fillIntensity: 85,
            backdrop: NSColor(hex: 0x151B3A), pendants: 0, hall: 1, deskLamp: 1, glassTint: NSColor(hex: 0x4A5790))),
    ]

    /// 그 시각의 빛. 앞뒤 기준 사이를 부드럽게 잇는다.
    static func look(at minute: Double) -> DayLook {
        let m = max(0, min(24 * 60 - 1, minute))
        guard let first = keys.first, let last = keys.last else { fatalError("빛 기준이 비어 있습니다") }
        if m <= first.minute { return first.look }
        if m >= last.minute { return last.look }
        for index in 1..<keys.count where m <= keys[index].minute {
            let a = keys[index - 1], b = keys[index]
            let t = (m - a.minute) / (b.minute - a.minute)
            return DayLook.mix(a.look, b.look, CGFloat(t))
        }
        return last.look
    }
}
