import SwiftUI

/// 앱 화면 공통 색과 글자. 정보 약자도 읽기 쉽게 글자는 크게, 경고는 색과 아이콘·글자를 함께 쓴다.
enum UI {
    static let paper = Color(red: 0xFB / 255, green: 0xF8 / 255, blue: 0xF0 / 255)
    static let paperDeep = Color(red: 0xF2 / 255, green: 0xEC / 255, blue: 0xDE / 255)
    static let green = Color(red: 0x1F / 255, green: 0x5A / 255, blue: 0x45 / 255)
    static let greenSoft = Color(red: 0xDD / 255, green: 0xEB / 255, blue: 0xE4 / 255)
    static let ink = Color(red: 0x24 / 255, green: 0x2B / 255, blue: 0x27 / 255)
    static let inkSoft = Color(red: 0x5A / 255, green: 0x63 / 255, blue: 0x5E / 255)
    static let line = Color(red: 0xE2 / 255, green: 0xDA / 255, blue: 0xC8 / 255)
    static let warn = Color(red: 0xB4 / 255, green: 0x4A / 255, blue: 0x1E / 255)
    static let warnSoft = Color(red: 0xFB / 255, green: 0xE8 / 255, blue: 0xD8 / 255)
    static let notice = Color(red: 0x8A / 255, green: 0x66 / 255, blue: 0x10 / 255)
    static let noticeSoft = Color(red: 0xFB / 255, green: 0xF0 / 255, blue: 0xCC / 255)

    /// 글자 배율. 설정의 '글자 크게'를 켜면 1.25.
    static var scale: CGFloat {
        if let text = ProcessInfo.processInfo.environment["AIBOSS_TEXT_SCALE"], let forced = Double(text) { return CGFloat(forced) }
        let value = UserDefaults.standard.double(forKey: "textScale")
        return value > 0 ? CGFloat(value) : 1
    }

    /// 배율을 반영한 시스템 글꼴. 화면의 모든 글자는 이것으로 만든다.
    static func font(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: (size * scale).rounded(), weight: weight)
    }

    static var title: Font { font(24, weight: .bold) }
    static var heading: Font { font(18, weight: .bold) }
    static var body: Font { font(15) }
    static var bodyBold: Font { font(15, weight: .semibold) }
    static var small: Font { font(13) }

    static func levelColor(_ level: Int) -> Color {
        switch level {
        case 3: green
        case 2: green.opacity(0.7)
        default: green.opacity(0.4)
        }
    }
}

/// 흰 종이 카드.
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(UI.line))
    }
}

/// 짙은 초록 바탕의 주 버튼.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(UI.bodyBold)
            .foregroundStyle(.white)
            .padding(.horizontal, 18)
            .frame(minHeight: 40)
            .frame(maxWidth: .infinity)
            .background(UI.green.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.35),
                        in: RoundedRectangle(cornerRadius: 10))
            .contentShape(Rectangle())
    }
}

/// 테두리만 있는 보조 버튼.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(UI.bodyBold)
            .foregroundStyle(UI.green.opacity(isEnabled ? 1 : 0.4))
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .background(UI.greenSoft.opacity(configuration.isPressed ? 1 : 0.55), in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(UI.green.opacity(0.35)))
            .contentShape(Rectangle())
    }
}

/// 주의 상자. 색만으로 구분하지 않게 아이콘과 제목을 함께 둔다.
struct Callout: View {
    enum Kind { case warning, notice, info }
    var kind: Kind
    var title: String
    var detail: String?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(UI.font(17, weight: .bold))
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(UI.bodyBold).foregroundStyle(UI.ink)
                if let detail { Text(detail).font(UI.body).foregroundStyle(UI.inkSoft).fixedSize(horizontal: false, vertical: true) }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(background, in: RoundedRectangle(cornerRadius: 10))
    }

    private var icon: String {
        switch kind {
        case .warning: "exclamationmark.triangle.fill"
        case .notice: "info.circle.fill"
        case .info: "checkmark.circle.fill"
        }
    }

    private var tint: Color {
        switch kind {
        case .warning: UI.warn
        case .notice: UI.notice
        case .info: UI.green
        }
    }

    private var background: Color {
        switch kind {
        case .warning: UI.warnSoft
        case .notice: UI.noticeSoft
        case .info: UI.greenSoft
        }
    }
}

/// 중요도 표시. 예: 3단계 · 필수 마감
struct LevelBadge: View {
    var level: Int
    var text: String

    var body: some View {
        Text(text)
            .font(UI.font(13, weight: .bold))
            .foregroundStyle(level == 1 ? UI.green : .white)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(UI.levelColor(level), in: Capsule())
    }
}

/// 패널 머리. 제목, 한 줄 설명, 닫기.
struct PanelHeader: View {
    var title: String
    var subtitle: String?
    var close: (() -> Void)?

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(UI.title).foregroundStyle(UI.ink)
                if let subtitle {
                    Text(subtitle).font(UI.body).foregroundStyle(UI.inkSoft).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer()
            if let close {
                Button(action: close) {
                    Image(systemName: "xmark")
                        .font(UI.font(14, weight: .bold))
                        .frame(width: 32, height: 32)
                        .background(UI.paperDeep, in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(UI.inkSoft)
                .help("닫기")
                .accessibilityLabel("패널 닫기")
            }
        }
    }
}
