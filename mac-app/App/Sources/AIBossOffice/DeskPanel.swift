import OfficeScreens
import OfficeCore
import SeatKit
import SwiftUI

/// 내 책상: 착석 상태, 오늘의 체크리스트, 점심·자리 비움, 오늘 기록.
struct DeskPanel: View {
    @Bindable var model: AppModel

    private var office: Office { model.office }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "내 책상", subtitle: office.phaseHeadline) { model.closePanel() }
                SeatCard(model: model)
                checklist
                if office.day.phase == .working || office.day.phase == .overtime {
                    RequestsCard(model: model)
                }
                EventLog(events: office.day.events)
            }
            .padding(20)
        }
    }

    @ViewBuilder private var checklist: some View {
        Card {
            HStack {
                Text("오늘의 체크리스트").font(UI.heading)
                Spacer()
                if !office.day.tasks.isEmpty {
                    Text("\(office.doneTasks.count) / \(office.day.tasks.filter { $0.status != .carried }.count) 완료")
                        .font(UI.bodyBold).foregroundStyle(UI.green)
                }
            }
            if office.day.tasks.isEmpty {
                Text(office.day.phase == .morningPT
                     ? "아직 확정한 업무가 없습니다.\n회의실에서 아침 PT로 업무를 확정하세요."
                     : "확정한 업무가 없습니다.")
                    .font(UI.body).foregroundStyle(UI.inkSoft)
                if office.day.phase == .morningPT {
                    Button("회의실로 가기") { model.panel = .meeting }
                        .buttonStyle(PrimaryButtonStyle())
                }
            } else {
                ForEach(office.day.tasks) { task in
                    TaskRow(model: model, task: task)
                    if task.id != office.day.tasks.last?.id { Divider() }
                }
            }
        }
    }
}

/// 업무 한 줄. 완료 표시와 결과물 칸.
struct TaskRow: View {
    @Bindable var model: AppModel
    var task: WorkTask
    var showDeliverable = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Button {
                    model.run { $0.setTask(task.id, done: !task.isDone) }
                } label: {
                    Image(systemName: task.isDone ? "checkmark.square.fill" : task.status == .carried ? "arrow.uturn.right.square" : "square")
                        .font(UI.font(24))
                        .foregroundStyle(task.status == .carried ? UI.inkSoft : UI.green)
                }
                .buttonStyle(.plain)
                .disabled(!model.office.canEditTasks || task.status == .carried)
                .accessibilityLabel(task.isDone ? "\(task.title) 완료 취소" : "\(task.title) 완료 표시")

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        LevelBadge(level: task.level.rawValue, text: task.level.label)
                        if task.carriedFrom != nil {
                            Text("이월 \(task.carryCount)회").font(UI.small).foregroundStyle(UI.notice)
                        }
                        if task.status == .carried {
                            Text("다음 근무일로 이월됨").font(UI.small).foregroundStyle(UI.inkSoft)
                        }
                    }
                    Text(task.title)
                        .font(UI.font(16, weight: .semibold))
                        .strikethrough(task.isDone, color: UI.inkSoft)
                        .foregroundStyle(task.isDone ? UI.inkSoft : UI.ink)
                    Text("마감 \(Clock.hm(task.due)) · 완료 기준: \(task.doneCriteria)")
                        .font(UI.small).foregroundStyle(UI.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if showDeliverable, task.status != .carried {
                TextField("결과물 (메모, 링크, 파일 이름)", text: Binding(
                    get: { task.deliverable },
                    set: { text in model.run { $0.setDeliverable(task.id, text: text) } }))
                    .officeField()
                    .font(UI.body)
                    .disabled(!model.office.canEditTasks)
                    .padding(.leading, 34)
            }
        }
        .padding(.vertical, 2)
    }
}

/// 착석 상태. 카메라 미리보기, 또는 카메라 없이 시연할 때 쓰는 버튼.
struct SeatCard: View {
    @Bindable var model: AppModel

    var body: some View {
        let status = model.office.seatStatus
        Card {
            HStack(alignment: .top, spacing: 12) {
                if model.useCamera {
                    SeatCameraPreview(monitor: model.seat, mirrored: true)
                        .frame(width: 128, height: 96)
                        .background(Color.black)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .accessibilityLabel("카메라 미리보기")
                }
                VStack(alignment: .leading, spacing: 6) {
                    SeatChip(status: status, now: model.office.now)
                    Text(model.useCamera || status != .seated ? status.detail(now: model.office.now) : "자리에 있음으로 표시했습니다.")
                        .font(UI.body).foregroundStyle(UI.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if model.useCamera, model.cameraPresence == .cameraOff, let reason = model.cameraOffReason {
                        Text(reason).font(UI.small).foregroundStyle(UI.warn)
                    }
                }
                Spacer(minLength: 0)
            }
            if case .lunch = status {
                Button("점심 마치고 복귀") { model.run { $0.returnFromAllowance() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
            if case .away = status {
                Button("자리로 복귀") { model.run { $0.returnFromAllowance() } }
                    .buttonStyle(SecondaryButtonStyle())
            }
            if !model.useCamera, model.office.isMonitoring || model.office.day.phase == .morningPT {
                Text("카메라 없이 시연 중 · 자리 상태를 직접 바꿉니다").font(UI.small).foregroundStyle(UI.inkSoft)
                HStack {
                    Button("자리에 있음") { model.setManualPresence(.present) }
                    Button("자리 비움") { model.setManualPresence(.absent) }
                    Button("카메라 꺼짐") { model.setManualPresence(.cameraOff) }
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
    }
}

/// 점심 요청과 자리 비움 등록.
struct RequestsCard: View {
    @Bindable var model: AppModel
    @State private var reason = ""

    private let presets = ["물 가지러 자리 비웁니다", "화장실 다녀오겠습니다", "택배를 받으러 갑니다"]

    var body: some View {
        Card {
            Text("근태 요청").font(UI.heading)
            if model.office.day.phase == .working {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("점심").font(UI.bodyBold)
                        Text(model.office.day.lunchUsed ? "오늘 점심은 사용했습니다." : "사내 메일로 요청하면 1시간을 받습니다.")
                            .font(UI.small).foregroundStyle(UI.inkSoft)
                    }
                    Spacer()
                    Button("점심 요청 메일") { model.run { _ = try $0.requestLunch() } }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(!model.office.canRequestLunch)
                }
                Divider()
            }
            Text("자리 비움 (건당 15분)").font(UI.bodyBold)
            TextField("사유 예: 물 가지러 자리 비웁니다", text: $reason)
                .officeField()
                .font(UI.body)
            HStack(spacing: 6) {
                ForEach(presets, id: \.self) { preset in
                    Button(preset) { reason = preset }
                        .buttonStyle(.plain)
                        .font(UI.small)
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(UI.paperDeep, in: Capsule())
                }
            }
            Button("15분 자리 비움 등록") {
                model.run { _ = try $0.registerAway(reason: reason) }
                reason = ""
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.office.canRegisterAway || reason.trimmingCharacters(in: .whitespaces).isEmpty)
            Text("허용 시간 안에는 착석 확인을 쉬고,\n끝난 뒤에도 자리가 비면 근무 중 자리 비움으로 기록합니다.")
                .font(UI.small).foregroundStyle(UI.inkSoft)
        }
    }
}

/// 오늘 근태 기록. 주의 기록은 아이콘을 붙인다.
struct EventLog: View {
    var events: [AttendanceEvent]

    var body: some View {
        if !events.isEmpty {
            Card {
                Text("오늘 기록").font(UI.heading)
                ForEach(events.suffix(8).reversed()) { event in
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: event.isWarning ? "exclamationmark.triangle.fill" : "circle.fill")
                            .font(UI.font(event.isWarning ? 12 : 6))
                            .foregroundStyle(event.isWarning ? UI.warn : UI.green.opacity(0.6))
                            .frame(width: 14, height: 18)
                        Text(event.at.hm).font(UI.small.monospacedDigit()).foregroundStyle(UI.inkSoft)
                        Text(event.text).font(UI.small).foregroundStyle(event.isWarning ? UI.warn : UI.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}
