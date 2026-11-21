import SwiftUI

/// 오른쪽 패널 공통 색·글자·크기. 앱의 다른 화면도 이 값을 쓴다.
///
/// 정보 약자 접근성: 본문 15pt 이상, 제목 22pt 이상, 버튼 높이 36pt 이상,
/// 경고는 색만이 아니라 아이콘과 글자를 함께 쓴다.
public enum OfficeStyle {
    // MARK: 색
    /// 종이색 패널 바탕.
    public static let paper = Color(hex: 0xFBF8F0)
    /// 패널 안 카드 바탕.
    public static let card = Color(hex: 0xFFFDF8)
    /// 포인트 짙은 초록.
    public static let green = Color(hex: 0x1F5A45)
    /// 초록 위의 옅은 바탕(선택된 칸).
    public static let greenSoft = Color(hex: 0xE3EEE8)
    /// 본문 글자.
    public static let ink = Color(hex: 0x2A2621)
    /// 보조 글자. 종이색 위 대비 5:1 이상.
    public static let muted = Color(hex: 0x635B50)
    /// 구분선, 카드 테두리.
    public static let line = Color(hex: 0xE4DCCB)
    /// 주의(확인 필요, 지각).
    public static let warning = Color(hex: 0x8A4B00)
    public static let warningSoft = Color(hex: 0xFFF1D6)
    /// 오류.
    public static let danger = Color(hex: 0xA3261E)
    public static let dangerSoft = Color(hex: 0xFBE6E3)
    /// 괜찮음(사람 있음, 설치됨).
    public static let okSoft = Color(hex: 0xE3EEE8)

    // MARK: 글자
    /// 글자 배율. 앱 설정의 '글자 크게'(UserDefaults "textScale", 1 또는 1.25)를 따른다.
    /// 시험용 환경변수 AIBOSS_TEXT_SCALE가 있으면 그 값이 우선이다. 앱은 배율이 바뀌면 패널을 다시 그린다.
    public static var scale: CGFloat {
        if let text = ProcessInfo.processInfo.environment["AIBOSS_TEXT_SCALE"], let forced = Double(text), forced > 0 {
            return CGFloat(forced)
        }
        let value = UserDefaults.standard.double(forKey: "textScale")
        return value > 0 ? CGFloat(value) : 1
    }

    /// 배율을 반영한 시스템 글꼴. 패널 안의 글자는 모두 이것으로 만든다.
    public static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: (size * scale).rounded(), weight: weight)
    }

    public static var titleFont: Font { font(22, weight: .bold) }
    public static var headingFont: Font { font(17, weight: .semibold) }
    public static var bodyFont: Font { font(15) }
    public static var bodyBoldFont: Font { font(15, weight: .semibold) }
    /// 작은 표지(배지). 패널 안에서 가장 작은 글자.
    public static var badgeFont: Font { font(13, weight: .semibold) }

    // MARK: 크기
    public static let panelWidth: CGFloat = 460
    public static let panelMinHeight: CGFloat = 720
    public static let buttonHeight: CGFloat = 40
    public static let smallButtonHeight: CGFloat = 36
    public static let cornerRadius: CGFloat = 10
    public static let spacing: CGFloat = 14
}

public extension Color {
    /// 0xRRGGBB.
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}

// MARK: - 패널과 카드

public extension View {
    /// 오른쪽 패널 바탕. 다크 모드에서도 종이색이 그대로 읽히도록 밝은 모드로 고정한다.
    func officePanel() -> some View {
        self
            .font(OfficeStyle.bodyFont)
            .foregroundStyle(OfficeStyle.ink)
            .tint(OfficeStyle.green)
            .background(OfficeStyle.paper)
            .environment(\.colorScheme, .light)
    }

    /// 글자 입력칸. macOS 기본 둥근 테두리 칸은 높이가 고정이라 글자를 키우면 글자가 칸을 넘친다.
    /// 그래서 테두리를 직접 그리고 위아래 여백으로 높이가 글자를 따라가게 한다.
    func officeField() -> some View {
        self
            .textFieldStyle(.plain)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(OfficeStyle.line.opacity(0.9) .mix(with: OfficeStyle.muted, by: 0.35)))
    }

    /// 테두리 있는 카드.
    func officeCard() -> some View {
        self
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(OfficeStyle.card, in: RoundedRectangle(cornerRadius: OfficeStyle.cornerRadius))
            .overlay(RoundedRectangle(cornerRadius: OfficeStyle.cornerRadius).strokeBorder(OfficeStyle.line))
    }
}

/// 패널 맨 위 제목.
public struct PanelHeader: View {
    var place: String
    var title: String
    var detail: String?

    public init(place: String, title: String, detail: String? = nil) {
        self.place = place
        self.title = title
        self.detail = detail
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(place)
                .font(OfficeStyle.badgeFont)
                .foregroundStyle(OfficeStyle.green)
            Text(title)
                .font(OfficeStyle.titleFont)
            if let detail {
                Text(detail)
                    .foregroundStyle(OfficeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - 알림 칸

/// 아이콘과 글자를 함께 쓰는 알림 칸. 색만으로 뜻을 전하지 않는다.
public struct NoticeBox<Actions: View>: View {
    public enum Kind: Sendable {
        case info, ok, warning, error

        var icon: String {
            switch self {
            case .info: "info.circle.fill"
            case .ok: "checkmark.circle.fill"
            case .warning: "exclamationmark.triangle.fill"
            case .error: "xmark.octagon.fill"
            }
        }

        var foreground: Color {
            switch self {
            case .info, .ok: OfficeStyle.green
            case .warning: OfficeStyle.warning
            case .error: OfficeStyle.danger
            }
        }

        var background: Color {
            switch self {
            case .info: OfficeStyle.card
            case .ok: OfficeStyle.okSoft
            case .warning: OfficeStyle.warningSoft
            case .error: OfficeStyle.dangerSoft
            }
        }
    }

    var kind: Kind
    var title: String
    var message: String?
    var actions: Actions

    public init(_ kind: Kind, title: String, message: String? = nil, @ViewBuilder actions: () -> Actions) {
        self.kind = kind
        self.title = title
        self.message = message
        self.actions = actions()
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: kind.icon)
                .font(OfficeStyle.font(17))
                .foregroundStyle(kind.foreground)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(OfficeStyle.bodyBoldFont)
                    .foregroundStyle(kind.foreground)
                if let message {
                    Text(message)
                        .foregroundStyle(OfficeStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                actions
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(kind.background, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(kind.foreground.opacity(0.35)))
        .accessibilityElement(children: .contain)
    }
}

public extension NoticeBox where Actions == EmptyView {
    init(_ kind: Kind, title: String, message: String? = nil) {
        self.init(kind, title: title, message: message) { EmptyView() }
    }
}

/// 작은 표지. 예: '이월', '확인 필요'.
public struct Badge: View {
    var text: String
    var icon: String?
    var color: Color
    var background: Color

    public init(_ text: String, icon: String? = nil, color: Color = OfficeStyle.green,
                background: Color = OfficeStyle.greenSoft) {
        self.text = text
        self.icon = icon
        self.color = color
        self.background = background
    }

    public var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).accessibilityHidden(true) }
            Text(text)
        }
        .font(OfficeStyle.badgeFont)
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(background, in: Capsule())
    }
}

// MARK: - 버튼

/// 짙은 초록으로 채운 주 버튼.
public struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var fullWidth: Bool

    public init(fullWidth: Bool = true) {
        self.fullWidth = fullWidth
    }

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OfficeStyle.bodyBoldFont)
            .foregroundStyle(isEnabled ? Color.white : OfficeStyle.muted)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil, minHeight: OfficeStyle.buttonHeight)
            .background(isEnabled ? OfficeStyle.green : OfficeStyle.line,
                        in: RoundedRectangle(cornerRadius: 8))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Rectangle())
    }
}

/// 테두리만 있는 보조 버튼.
public struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    public init() {}

    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OfficeStyle.bodyFont)
            .foregroundStyle(isEnabled ? OfficeStyle.green : OfficeStyle.muted)
            .padding(.horizontal, 14)
            .frame(minHeight: OfficeStyle.smallButtonHeight)
            .background(configuration.isPressed ? OfficeStyle.greenSoft : OfficeStyle.card,
                        in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .strokeBorder(isEnabled ? OfficeStyle.green.opacity(0.6) : OfficeStyle.line))
            .contentShape(Rectangle())
    }
}
