import OfficeCore
import SeatKit
import SwiftUI

/// 출입문 출근 단말기. 카메라에 사람이 보이면 출근 버튼이 켜진다.
///
/// 카메라 영상은 화면에만 보이고 저장·전송하지 않는다.
/// 이 화면은 `monitor.onChange`를 건드리지 않는다(앱이 `office.observe`에 연결해 쓴다).
/// 대신 0.5초마다 `monitor.presence`를 읽어 화면을 고친다.
public struct CheckInView: View {
    @Binding private var office: Office
    private let monitor: SeatMonitor
    private let onCheckedIn: (Attendance) -> Void
    private let startsCamera: Bool
    private let cameraEnabled: Bool

    @State private var problem: String?
    @State private var starting = false
    @State private var result: Attendance?

    /// - Parameters:
    ///   - cameraEnabled: false면 카메라 없는 시연. 미리보기와 카메라 켜기 없이 출근 버튼이 바로 켜진다.
    ///   - startsCamera: 화면을 열 때 카메라를 켤지. 화면 확인 도구에서는 끈다.
    public init(office: Binding<Office>, monitor: SeatMonitor, cameraEnabled: Bool = true,
                startsCamera: Bool = true, onCheckedIn: @escaping (Attendance) -> Void) {
        _office = office
        self.monitor = monitor
        self.cameraEnabled = cameraEnabled
        self.startsCamera = startsCamera
        self.onCheckedIn = onCheckedIn
    }

    public var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            // 켜기 전에는 monitor가 '확인 중'이지만 화면에는 '카메라 꺼짐'으로 보인다.
            let running = monitor.isRunning
            content(presence: running || monitor.presence == .cameraOff ? monitor.presence : .cameraOff,
                    reason: monitor.offReason ?? (running ? nil : "카메라 켜기를 눌러 주세요."),
                    running: running)
        }
        .frame(minWidth: OfficeStyle.panelWidth, maxWidth: OfficeStyle.panelWidth)
        .officePanel()
        .task {
            // 화면을 열면 카메라를 켠다. 끄는 것은 앱이 정한다.
            if cameraEnabled, startsCamera, !monitor.isRunning, office.canCheckIn { await startCamera() }
        }
    }

    private func content(presence: SeatPresence, reason: String?, running: Bool) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: OfficeStyle.spacing) {
                if cameraEnabled {
                    PanelHeader(place: "출입문", title: "출근",
                                detail: "카메라 앞에 앉으면 출근 버튼이 켜집니다.\n영상은 이 맥 안에서만 쓰고 저장하지 않습니다.")
                    clockCard
                    cameraCard(presence: presence, reason: reason, running: running)
                } else {
                    PanelHeader(place: "출입문", title: "출근", detail: "출근 버튼을 누르면 출근 시각이 찍힙니다.")
                    clockCard
                    NoticeBox(.info, title: "카메라 없이 시연 중",
                              message: "카메라 확인 없이 출근을 기록합니다.\n설정에서 카메라를 켜면 사람이 보일 때만 출근할 수 있습니다.")
                }
                actionSection(presence: presence)
            }
            .padding(16)
        }
    }

    // MARK: - 시각

    private var isLateNow: Bool { office.now.minuteOfDay > office.profile.workStart }

    private var clockCard: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("지금").font(OfficeStyle.badgeFont).foregroundStyle(OfficeStyle.muted)
                Text(Clock.hm(office.now.minuteOfDay))
                    .font(OfficeStyle.font(34, weight: .bold))
                    .monospacedDigit()
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text("출근 기준").font(OfficeStyle.badgeFont).foregroundStyle(OfficeStyle.muted)
                Text(Clock.hm(office.profile.workStart))
                    .font(OfficeStyle.headingFont)
                    .monospacedDigit()
            }
        }
        .officeCard()
        .accessibilityElement(children: .combine)
    }

    // MARK: - 카메라

    private func cameraCard(presence: SeatPresence, reason: String?, running: Bool) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack {
                SeatCameraPreview(monitor: monitor)
                if !running {
                    Rectangle().fill(Color(hex: 0x2A2621))
                    VStack(spacing: 8) {
                        Image(systemName: "video.slash.fill").font(OfficeStyle.font(28))
                        Text("카메라가 꺼져 있습니다")
                    }
                    .foregroundStyle(Color.white.opacity(0.85))
                }
            }
            .aspectRatio(4 / 3, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .topLeading) {
                Badge(presence.title, icon: Self.icon(presence),
                      color: presence == .present ? Color.white : OfficeStyle.ink,
                      background: presence == .present ? OfficeStyle.green : Color.white.opacity(0.9))
                    .padding(10)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("카메라 미리보기, \(presence.title)")

            switch presence {
            case .cameraOff:
                NoticeBox(.error, title: "카메라 꺼짐",
                          message: reason ?? "카메라를 켜 주세요.") {
                    Button(starting ? "켜는 중" : "카메라 켜기") { Task { await startCamera() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(starting)
                }
            case .absent:
                NoticeBox(.warning, title: "사람이 보이지 않습니다",
                          message: "카메라 정면에 앉아 주세요.\n얼굴이나 어깨가 화면에 들어오면 됩니다.")
            case .unknown:
                if running {
                    Label("자리를 확인하고 있습니다", systemImage: "hourglass")
                        .foregroundStyle(OfficeStyle.muted)
                } else {
                    Button(starting ? "켜는 중" : "카메라 켜기") { Task { await startCamera() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(starting)
                }
            case .present:
                Label("사람이 보입니다. 출근할 수 있습니다.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(OfficeStyle.green)
            }
        }
        .officeCard()
    }

    static func icon(_ presence: SeatPresence) -> String {
        switch presence {
        case .present: "person.fill.checkmark"
        case .absent: "person.fill.questionmark"
        case .cameraOff: "video.slash.fill"
        case .unknown: "hourglass"
        }
    }

    private func startCamera() async {
        starting = true
        await monitor.start()
        starting = false
    }

    // MARK: - 출근

    @ViewBuilder
    private func actionSection(presence: SeatPresence) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let checkIn = office.day.checkInAt {
                checkedInNotice(at: checkIn)
            } else if office.day.absentCandidate || !office.canCheckIn {
                NoticeBox(.warning, title: "오늘은 출근할 수 없습니다",
                          message: "근무시간이 끝났습니다.\n다음 근무일에 출근해 주세요.")
            } else {
                if isLateNow { lateNotice }
                Button {
                    checkIn()
                } label: {
                    Label(isLateNow ? "지각 출근하기" : "출근하기", systemImage: "person.badge.clock.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(cameraEnabled && presence != .present)
                .accessibilityHint(!cameraEnabled || presence == .present ? "" : "카메라에 사람이 보여야 누를 수 있습니다.")

                if cameraEnabled {
                    Button("카메라 없이 출근 (시연)") { checkIn() }
                        .buttonStyle(.link)
                        .font(OfficeStyle.badgeFont)
                        .foregroundStyle(OfficeStyle.muted)
                        .frame(minHeight: 28)
                }
            }
            if let problem {
                NoticeBox(.error, title: "출근을 기록하지 못했습니다", message: problem)
            }
        }
    }

    private var lateNotice: some View {
        let stats = office.monthStats
        let after = MonthStats(late: stats.late + 1, absent: stats.absent)
        return NoticeBox(.warning, title: "지금 출근하면 지각으로 기록됩니다",
                         message: "이번 달 지각 \(stats.late)회 → \(after.late)회 (\(after.points)점)\n"
                            + "지각비 예상액 \(LateFee.won(after.estimatedFee)) · 실제로 청구하지 않습니다")
    }

    @ViewBuilder
    private func checkedInNotice(at time: Date) -> some View {
        if office.day.isLate {
            let stats = office.monthStats
            NoticeBox(.warning, title: "\(Clock.hm(time.minuteOfDay)) 지각 출근",
                      message: "이번 달 지각 \(stats.late)회 (\(stats.points)점)\n"
                        + "지각비 예상액 \(LateFee.won(stats.estimatedFee)) · 실제로 청구하지 않습니다")
        } else {
            NoticeBox(.ok, title: "\(Clock.hm(time.minuteOfDay)) 출근", message: "회의실에서 아침 PT를 시작해 주세요.")
        }
    }

    private func checkIn() {
        do {
            let attendance = try office.checkIn()
            problem = nil
            result = attendance
            onCheckedIn(attendance)
        } catch {
            problem = error.localizedDescription
        }
    }
}

#Preview("출근") {
    @Previewable @State var office = OfficeSamples.beforeCheckIn(minute: 8 * 60 + 58)
    CheckInView(office: $office, monitor: SeatMonitor(), onCheckedIn: { _ in })
        .frame(height: OfficeStyle.panelMinHeight)
}
