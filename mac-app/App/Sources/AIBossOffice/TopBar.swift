import OfficeCore
import SwiftUI

/// 화면 위 막대. 가상 시각, 지금 단계, 내 자리 상태, 시연 버튼.
struct TopBar: View {
    @Bindable var model: AppModel

    private var office: Office { model.office }

    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(Cast.teamName) · \(office.profile.name) 사원")
                    .font(UI.font(13, weight: .semibold))
                    .foregroundStyle(UI.inkSoft)
                Text(office.today.koreanShort)
                    .font(UI.font(16, weight: .bold))
                    .foregroundStyle(UI.ink)
            }

            Text(office.now.hm)
                .font(UI.font(30, weight: .heavy).monospacedDigit())
                .foregroundStyle(UI.ink)
                .accessibilityLabel("가상 시각 \(Clock.korean(office.now.minuteOfDay))")

            VStack(alignment: .leading, spacing: 3) {
                Text(office.phaseHeadline)
                    .font(UI.font(15, weight: .bold))
                    .foregroundStyle(UI.green)
                SeatChip(status: office.seatStatus, now: office.now)
            }

            Spacer(minLength: 8)

            // 출근 뒤 아침 PT를 할 차례면, 화면 아래 잠깐 뜨는 안내만으로는 놓치기 쉬워 위에 늘 보이게 한다.
            if office.day.phase == .morningPT, model.panel != .meeting {
                Button {
                    model.panel = .meeting
                } label: {
                    Label("회의실로 · 아침 PT", systemImage: "person.wave.2.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .fixedSize()
                .help("회의실에서 오늘 할 일을 정합니다")
            }

            let stats = office.monthStats
            if stats.points > 0 {
                VStack(alignment: .trailing, spacing: 1) {
                    Text("이번 달 \(stats.points)점").font(UI.font(13, weight: .semibold))
                    Text("지각비 예상 \(LateFee.won(stats.estimatedFee))").font(UI.font(12))
                }
                .foregroundStyle(UI.inkSoft)
                .help("지각 1회 1점, 결근 후보 1회 3점. 2점까지 0원, 초과 1점당 1,000원, 월 최대 5,000원. 시연에서는 청구하지 않습니다.")
            }

            Button {
                model.showOrgChart = true
            } label: {
                Label("조직도", systemImage: "person.3.fill")
            }
            .buttonStyle(SecondaryButtonStyle())
            .help("부장부터 사원까지 회사 사람들과 책상 배치")

            Button {
                model.panel = .mail
            } label: {
                Label(office.unreadCount > 0 ? "메일 \(office.unreadCount)" : "메일함", systemImage: office.unreadCount > 0 ? "envelope.badge.fill" : "envelope")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(!office.onboarded)

            // 시연용 조작은 한데 묶어 실제 기능(조직도·메일)과 구분한다.
            HStack(spacing: 6) {
                Text("시연")
                    .font(UI.font(12, weight: .bold))
                    .foregroundStyle(UI.inkSoft)
                    .padding(.leading, 4)
                if office.canStartNextWorkday {
                    Button("다음 근무일") { model.startNextWorkday() }
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    Button {
                        model.skipHour()
                    } label: {
                        Label("다음 정각", systemImage: "forward.fill")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(!office.canSkipHour)
                    .help(office.canSkipHour ? "시연 시각을 다음 정각으로 보냅니다. 퇴근 점검·추가근무 시각에서는 멈춥니다." : "지금 점검을 먼저 제출해 주세요.")
                }
                if office.canJumpToFriday {
                    Button("금요일 장면") { model.jumpToFriday() }
                        .buttonStyle(SecondaryButtonStyle())
                        .help("시연용: 오늘을 마감하고 이번 주 금요일 아침으로 갑니다.")
                }
            }
            .padding(4)
            .background(UI.paperDeep, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(UI.line, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("시연용 조작")

            Button {
                model.showSettings = true
            } label: {
                Image(systemName: "gearshape.fill").font(UI.font(16))
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .foregroundStyle(UI.inkSoft)
            .help("설정")
            .accessibilityLabel("설정")
        }
        .padding(.horizontal, 18)
        .frame(height: 62)
        .background(.regularMaterial)
        .overlay(alignment: .bottom) { Rectangle().fill(UI.line).frame(height: 1) }
    }
}

/// 내 자리 상태 한 줄. 주의 상태는 아이콘과 글자로도 구분한다.
struct SeatChip: View {
    var status: SeatStatus
    var now: Date

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(UI.font(12, weight: .bold))
            Text(status.title).font(UI.font(13, weight: .semibold))
            if let extra { Text(extra).font(UI.font(13)) }
        }
        .foregroundStyle(status.isWarning ? UI.warn : UI.inkSoft)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(status.isWarning ? UI.warnSoft : UI.paperDeep, in: Capsule())
    }

    private var icon: String {
        switch status {
        case .seated: "person.fill.checkmark"
        case .checking: "camera.viewfinder"
        case .lunch: "fork.knife"
        case .dinner: "fork.knife"
        case .away: "cup.and.saucer.fill"
        case .unauthorizedAway: "person.fill.questionmark"
        case .cameraOff: "video.slash.fill"
        case .absentCandidate: "exclamationmark.triangle.fill"
        case .beforeCheckIn: "door.left.hand.closed"
        case .emptyBeforeWork: "chair"
        case .review: "checklist"
        case .off: "moon.fill"
        }
    }

    private var extra: String? {
        switch status {
        case .lunch(let until), .dinner(let until): "· \(until.hm)까지"
        case .away(let until, _): "· \(until.hm)까지"
        case .unauthorizedAway(let since):
            "· \(Clock.duration(max(0, Int(now.timeIntervalSince(since) / 60))))"
        default: nil
        }
    }
}
