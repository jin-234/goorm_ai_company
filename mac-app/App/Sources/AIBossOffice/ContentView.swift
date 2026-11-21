import AppKit
import OfficeCore
import OfficeScene
import OfficeScreens
import SwiftUI

@main
struct AIBossOfficeApp: App {
    @State private var model = AppModel()

    init() {
        // 자동 점검(시험) 실행은 사용자가 쓰는 화면 앞으로 튀어나와 키 입력을 가로채지 않게 뒤에서 뜬다.
        if ProcessInfo.processInfo.environment["AIBOSS_BACKGROUND"] == "1" {
            NSApplication.shared.setActivationPolicy(.accessory)
            // 뒤에 있는 앱은 macOS가 절전(App Nap)으로 타이머와 화면 갱신을 늦춘다. 시험 중에는 끈다.
            Self.keepAwake = ProcessInfo.processInfo.beginActivity(
                options: [.userInitiated, .idleSystemSleepDisabled, .latencyCritical], reason: "자동 점검 실행")
        }
    }

    private static var keepAwake: NSObjectProtocol?

    var body: some Scene {
        Window("AI 상사 가상회사", id: "office") {
            ContentView(model: model)
                .frame(minWidth: 1180, minHeight: 760)
        }
        .defaultSize(width: 1440, height: 900)
        .windowResizability(.contentMinSize)
        .commands {
            CommandGroup(replacing: .newItem) {}
            // 3D 장소를 마우스로 정확히 누르기 어려운 사람도 키보드로 바로 갈 수 있게.
            CommandMenu("이동") {
                Button("내 책상") { model.open(.myDesk) }
                    .keyboardShortcut("1", modifiers: .command)
                Button("팀장 자리 · 메일함") { model.open(.manager) }
                    .keyboardShortcut("2", modifiers: .command)
                Button("회의실 · 아침 PT") { model.open(.meeting) }
                    .keyboardShortcut("3", modifiers: .command)
                Button("조직도") { model.showOrgChart = true }
                    .keyboardShortcut("4", modifiers: .command)
                Divider()
                Button("패널 닫기") { model.closePanel() }
                    .keyboardShortcut(.escape, modifiers: [])
                    .disabled(model.panel == nil)
            }
            CommandMenu("시연") {
                Button("다음 정각으로") { model.skipHour() }
                    .keyboardShortcut("]", modifiers: .command)
                    .disabled(!model.office.canSkipHour)
                Button("금요일 장면으로") { model.jumpToFriday() }
                    .disabled(!model.office.canJumpToFriday)
                Button("다음 근무일") { model.startNextWorkday() }
                    .disabled(!model.office.canStartNextWorkday)
            }
        }

        Settings {
            SettingsView(model: model)
        }
    }
}

struct ContentView: View {
    @Bindable var model: AppModel
    @State private var labels = SpotLabels()

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                OfficeSceneView(stage: model.stage, labels: labels) { spot in
                    model.open(spot)
                }
                .ignoresSafeArea()

                if model.office.onboarded, model.office.day.phase != .beforeCheckIn {
                    spotChips
                }

                VStack(spacing: 0) {
                    TopBar(model: model)
                        .id(model.textScale)
                    Spacer()
                }

                HStack(spacing: 0) {
                    Spacer()
                    if let panel = model.panel {
                        PanelHost(model: model, panel: panel)
                            .id(model.textScale)
                            .frame(width: AppModel.panelWidth)
                            .frame(maxHeight: .infinity)
                            .padding(.top, 76)
                            .padding([.trailing, .bottom], 14)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .animation(.easeInOut(duration: 0.28), value: model.panel)

                if let toast = model.toast {
                    VStack {
                        Spacer()
                        Text(toast)
                            .font(UI.bodyBold)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 22)
                            .padding(.vertical, 12)
                            .background(UI.ink.opacity(0.88), in: RoundedRectangle(cornerRadius: 14))
                            .padding(.bottom, 28)
                            .padding(.trailing, model.panel == nil ? 0 : AppModel.panelWidth + 14)
                    }
                    .frame(maxWidth: .infinity)
                    .allowsHitTesting(false)
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: model.toast)
            .onAppear { model.windowWidth = proxy.size.width }
            .onChange(of: proxy.size.width) { _, width in model.windowWidth = width }
        }
        .background(UI.paperDeep)
        .sheet(isPresented: .constant(!model.office.onboarded)) {
            OnboardingView(model: model)
                .interactiveDismissDisabled()
        }
        .sheet(isPresented: $model.showOrgChart) {
            OrgChartView(myName: model.office.profile.name)
        }
        .sheet(isPresented: $model.showSettings) {
            SettingsView(model: model, inSheet: true)
        }
    }

    /// 3D 장소 위에 뜨는 이름표. 누르면 그 장소로 간다.
    private var spotChips: some View {
        ForEach(OfficeSpot.allCases) { spot in
            if let point = labels.points[spot], model.panel == nil {
                Button {
                    model.open(spot)
                } label: {
                    VStack(spacing: 1) {
                        Text(spot.title).font(UI.font(15, weight: .bold))
                        Text(chipHint(spot)).font(UI.font(12))
                            .foregroundStyle(labels.hovered == spot ? .white.opacity(0.9) : UI.inkSoft)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .foregroundStyle(labels.hovered == spot ? .white : UI.ink)
                    .background(labels.hovered == spot ? UI.green : Color.white.opacity(0.94), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(UI.green.opacity(nudge(spot) ? 0.9 : 0.25), lineWidth: nudge(spot) ? 2.5 : 1))
                    .shadow(color: .black.opacity(0.12), radius: 6, y: 2)
                }
                .buttonStyle(.plain)
                .position(x: point.x, y: point.y)
                .accessibilityLabel("\(spot.title), \(chipHint(spot))")
            }
        }
    }

    private func chipHint(_ spot: OfficeSpot) -> String {
        switch spot {
        case .myDesk: "체크리스트 · \(model.office.seatStatus.title)"
        case .manager: model.office.unreadCount > 0 ? "메일함 · 안 읽음 \(model.office.unreadCount)" : "사내 메일함"
        case .meeting: model.office.day.phase == .morningPT ? "지금 아침 PT" : "아침 PT"
        }
    }

    /// 지금 눌러야 할 곳을 굵은 테두리로 알려 준다.
    private func nudge(_ spot: OfficeSpot) -> Bool {
        switch model.office.day.phase {
        case .morningPT: spot == .meeting
        case .working: spot == .manager && model.office.unreadCount > 0
        default: false
        }
    }
}

/// 오른쪽 패널을 고른다.
struct PanelHost: View {
    @Bindable var model: AppModel
    var panel: Panel

    var body: some View {
        Group {
            switch panel {
            case .checkIn:
                CheckInView(office: $model.office, monitor: model.seat, cameraEnabled: model.useCamera, startsCamera: model.useCamera) { attendance in
                    model.didCheckIn(attendance)
                }
                .overlay(alignment: .topTrailing) { closeButton }
            case .meeting:
                MorningPTView(office: $model.office, solar: { model.solarClient() },
                              openSettings: { model.showSettings = true },
                              onConfirmed: { model.didConfirmTasks() })
                .overlay(alignment: .topTrailing) { closeButton }
            case .desk: DeskPanel(model: model)
            case .mail: MailPanel(model: model)
            case .checkout: CheckoutPanel(model: model)
            case .overtime: OvertimePanel(model: model)
            case .overtimeReview: OvertimeReviewPanel(model: model)
            case .off: OffPanel(model: model)
            case .weekly: WeeklyPanel(model: model)
            }
        }
        .background(UI.paper, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(UI.line))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.14), radius: 18, y: 6)
    }

    /// 옆 세션 화면(OfficeScreens)에는 닫기가 없어 여기서 덧씌운다.
    private var closeButton: some View {
        Button { model.closePanel() } label: {
            Image(systemName: "xmark")
                .font(UI.font(14, weight: .bold))
                .frame(width: 32, height: 32)
                .background(UI.paperDeep, in: Circle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(UI.inkSoft)
        .padding(14)
        .help("닫기")
        .accessibilityLabel("패널 닫기")
    }
}
