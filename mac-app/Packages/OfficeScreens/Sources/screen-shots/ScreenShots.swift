import AppKit
import OfficeCore
import OfficeScreens
import SeatKit
import SwiftUI

/// 화면을 PNG로 뽑는다. 창을 화면에 띄우지 않고, 입력칸 같은 AppKit 컨트롤까지 그대로 그린다.
///
///     swift run --scratch-path ~/Library/Caches/AIBossOffice/OfficeScreens screen-shots [폴더]
///
/// 카메라는 켜지 않는다(출근 화면의 미리보기는 '카메라가 꺼져 있습니다'로 나온다).
@main
@MainActor
struct ScreenShots {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let folder = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "screen-shots",
                         isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

        let monitor = SeatMonitor()
        let height = OfficeStyle.panelMinHeight

        let shots: [(String, AnyView, CGFloat)] = [
            ("1-출근-정시", AnyView(CheckInHost(office: OfficeSamples.beforeCheckIn(minute: 8 * 60 + 58),
                                              monitor: monitor)), height),
            ("2-출근-지각", AnyView(CheckInHost(office: OfficeSamples.beforeCheckIn(minute: 9 * 60 + 12),
                                              monitor: monitor)), height),
            ("7-출근-카메라없이", AnyView(CheckInHost(office: OfficeSamples.beforeCheckIn(minute: 8 * 60 + 58),
                                                monitor: monitor, cameraEnabled: false)), height),
            ("3-아침PT-빈화면", AnyView(PTHost(office: OfficeSamples.morningPT(withDrafts: false))), 1500),
            ("4-아침PT-초안", AnyView(PTHost(office: OfficeSamples.morningPT(withDrafts: true))), 2300),
            ("5-아침PT-확인필요", AnyView(PTHost(office: incompleteDrafts())), 2300),
            ("6-Whisper모델", AnyView(ScrollView { WhisperModelSection().padding(16) }.officePanel()), 560),
        ]
        for (name, view, viewHeight) in shots {
            let url = folder.appendingPathComponent("\(name).png")
            if render(view, size: CGSize(width: OfficeStyle.panelWidth, height: (viewHeight * OfficeStyle.scale).rounded()), to: url) {
                print("저장: \(url.path)")
            } else {
                print("실패: \(name)")
            }
        }
        exit(0)
    }

    /// 업무명·마감이 빈 초안이 섞인 상태.
    static func incompleteDrafts() -> Office {
        var office = OfficeSamples.morningPT(withDrafts: true)
        office.setTranscript(office.day.transcript + "\n그리고 컴활 필기 3장을 풀겠습니다.")
        if !office.day.drafts.isEmpty { office.day.drafts[0].due = nil }
        office.addDraft()
        return office
    }

    static func render(_ view: AnyView, size: CGSize, to url: URL) -> Bool {
        let host = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        host.frame = CGRect(origin: .zero, size: size)
        let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = host
        host.layoutSubtreeIfNeeded()
        // 한 번 돌려서 onAppear·task 결과가 반영되게 한다.
        RunLoop.main.run(until: Date().addingTimeInterval(0.4))
        host.layoutSubtreeIfNeeded()
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return false }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return false }
        return (try? data.write(to: url)) != nil
    }
}

/// 상태를 쥐고 있는 감싸개(앱에서 Binding을 넘기는 것과 같다).
struct PTHost: View {
    @State var office: Office

    var body: some View {
        MorningPTView(office: $office, solar: { nil }, openSettings: {}, onConfirmed: {})
    }
}

struct CheckInHost: View {
    @State var office: Office
    let monitor: SeatMonitor
    var cameraEnabled = true

    var body: some View {
        CheckInView(office: $office, monitor: monitor, cameraEnabled: cameraEnabled, startsCamera: false,
                    onCheckedIn: { _ in })
    }
}
