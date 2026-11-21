import OfficeScreens
import OfficeCore
import SwiftUI

/// 18:00 퇴근 점검. 1단계는 이월 보고, 2·3단계가 남으면 저녁시간과 추가근무.
struct CheckoutPanel: View {
    @Bindable var model: AppModel
    @State private var reports: [UUID: CarryReport] = [:]

    private var office: Office { model.office }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "\(Clock.hm(office.profile.workEnd)) 퇴근 점검",
                            subtitle: "결과물을 올리고 미완료 업무를 확인합니다.")
                // 어떻게 갈라지는지 먼저 보이게 경고를 맨 위에 둔다(아래에 두면 패널 밑에서 잘림).
                let heavy = office.overtimeTargets
                if !heavy.isEmpty {
                    Callout(kind: .warning, title: "2·3단계 업무 \(heavy.count)건이 남았습니다",
                            detail: "\(Clock.hm(office.profile.workEnd))~\(Clock.hm(office.profile.overtimeStart)) 저녁시간 뒤\n\(Clock.hm(office.profile.overtimeStart))~\(Clock.hm(office.profile.overtimeEnd)) 추가근무에 배정합니다.\n3단계부터 진행합니다.")
                }
                if office.day.phase != .checkoutReview {
                    Callout(kind: .notice, title: "퇴근 점검은 \(Clock.hm(office.profile.workEnd))에 합니다", detail: nil)
                }
                if office.day.tasks.isEmpty {
                    Callout(kind: .warning, title: "오늘 확정한 업무가 없습니다",
                            detail: "아침 PT 미진행으로 기록하고 퇴근합니다.")
                } else {
                    Card {
                        Text("오늘 업무").font(UI.heading)
                        Text("끝낸 업무는 지금 체크하고 결과물을 적어 주세요.").font(UI.small).foregroundStyle(UI.inkSoft)
                        ForEach(office.day.tasks) { task in
                            TaskRow(model: model, task: task)
                        }
                    }
                }
                let carry = office.carryReportTargets
                if !carry.isEmpty {
                    Card {
                        Text("1단계 이월 보고").font(UI.heading)
                        Text("미완료 이유와 다음 근무일 완료 계획을\n사내 메일로 보고한 뒤 이월합니다.")
                            .font(UI.small).foregroundStyle(UI.inkSoft)
                        ForEach(carry) { task in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(task.title).font(UI.bodyBold)
                                TextField("미완료 이유", text: binding(task.id, \.reason))
                                    .officeField().font(UI.body)
                                TextField("다음 근무일 완료 계획", text: binding(task.id, \.plan))
                                    .officeField().font(UI.body)
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                Button(submitTitle) { submit() }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(office.day.phase != .checkoutReview || !carry.allSatisfy { reports[$0.id]?.isComplete ?? false })
            }
            .padding(20)
        }
    }

    private var submitTitle: String {
        if !office.overtimeTargets.isEmpty { return "점검 제출 · 추가근무 배정 받기" }
        if !office.carryReportTargets.isEmpty { return "이월 보고하고 퇴근" }
        return "퇴근하기"
    }

    private func binding(_ id: UUID, _ key: WritableKeyPath<CarryReport, String>) -> Binding<String> {
        Binding(get: { reports[id]?[keyPath: key] ?? "" },
                set: { value in
                    var report = reports[id] ?? CarryReport()
                    report[keyPath: key] = value
                    reports[id] = report
                })
    }

    private func submit() {
        model.run { office in
            let outcome = try office.submitCheckout(carryReports: reports)
            switch outcome {
            case .offAllDone: model.show("모든 업무를 마치고 퇴근했습니다.")
            case .offWithCarry(let count): model.show("1단계 \(count)건을 이월 보고하고 퇴근했습니다.")
            case .offNoTasks: model.show("아침 PT 미진행으로 기록하고 퇴근했습니다.")
            case .overtimeAssigned(let count, _): model.show("추가근무 \(count)건이 배정됐습니다.\n저녁시간 뒤 3단계부터 진행합니다.")
            }
        }
    }
}

/// 저녁시간과 추가근무.
struct OvertimePanel: View {
    @Bindable var model: AppModel
    @State private var confirmLeave = false

    private var office: Office { model.office }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: office.day.phase == .dinner ? "저녁시간" : "추가근무",
                            subtitle: office.phaseHeadline) { model.closePanel() }
                SeatCard(model: model)
                Card {
                    Text("추가근무 업무").font(UI.heading)
                    Text("3단계부터 진행합니다.").font(UI.small).foregroundStyle(UI.inkSoft)
                    ForEach(office.overtimeTasks) { task in
                        TaskRow(model: model, task: task)
                    }
                }
                if office.day.phase == .overtime { RequestsCard(model: model) }
                let remaining = office.openTasks.count
                if remaining == 0 {
                    Button("모두 끝냈습니다 · 추가근무 종료") {
                        model.run { _ = try $0.endOvertimeEarly() }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    Button("남은 업무를 두고 먼저 종료") { confirmLeave = true }
                        .buttonStyle(SecondaryButtonStyle())
                        .confirmationDialog("먼저 종료할까요?", isPresented: $confirmLeave) {
                            Button("보충근무 미이행으로 기록하고 종료", role: .destructive) {
                                model.run { _ = try $0.endOvertimeEarly() }
                            }
                        } message: {
                            Text("남은 업무 \(remaining)건은 다음 근무일로 이월하고\n보충근무 미이행으로 기록합니다.")
                        }
                }
            }
            .padding(20)
        }
    }
}

/// 22:00 추가근무 종료 점검.
struct OvertimeReviewPanel: View {
    @Bindable var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "\(Clock.hm(model.office.profile.overtimeEnd)) 추가근무 종료",
                            subtitle: "완료한 결과물을 올립니다.\n남은 업무는 다음 근무일로 이월합니다.")
                Card {
                    ForEach(model.office.overtimeTasks) { task in
                        TaskRow(model: model, task: task)
                    }
                }
                Button("결과물 올리고 마치기") {
                    model.run { _ = try $0.submitOvertimeReview() }
                }
                .buttonStyle(PrimaryButtonStyle())
            }
            .padding(20)
        }
    }
}

/// 퇴근 뒤 오늘 요약.
struct OffPanel: View {
    @Bindable var model: AppModel

    private var office: Office { model.office }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "오늘 근무를 마쳤습니다", subtitle: office.today.koreanLong) { model.closePanel() }
                Card {
                    row("출근", office.day.checkInAt.map { "\($0.hm) · \(office.day.attendance?.label ?? "")" } ?? "기록 없음")
                    row("퇴근", office.day.checkoutAt?.hm ?? "-")
                    row("완료한 업무", "\(office.doneTasks.count)건")
                    row("이월한 업무", "\(office.day.tasks.filter { $0.status == .carried }.count)건")
                    if let overtime = office.day.overtime { row("추가근무", overtime.label) }
                    if office.unauthorizedAwayMinutes > 0 {
                        row("근무 중 자리 비움", Clock.duration(office.unauthorizedAwayMinutes), warning: true)
                    }
                    if office.cameraOffMinutes > 0 {
                        row("카메라 꺼짐(확인 필요)", Clock.duration(office.cameraOffMinutes), warning: true)
                    }
                }
                if office.canSubmitWeekly {
                    Callout(kind: .notice, title: "오늘은 금요일입니다", detail: "주간보고서를 직접 써서 올려 주세요.")
                    Button("주간보고서 쓰기") { model.panel = .weekly }
                        .buttonStyle(PrimaryButtonStyle())
                }
                Button("다음 근무일 시작") { model.startNextWorkday() }
                    .buttonStyle(office.canSubmitWeekly ? AnyButtonStyle(SecondaryButtonStyle()) : AnyButtonStyle(PrimaryButtonStyle()))
            }
            .padding(20)
        }
    }

    private func row(_ title: String, _ value: String, warning: Bool = false) -> some View {
        HStack {
            if warning { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(UI.warn) }
            Text(title).font(UI.body).foregroundStyle(UI.inkSoft)
            Spacer()
            Text(value).font(UI.bodyBold).foregroundStyle(warning ? UI.warn : UI.ink)
        }
    }
}

/// 금요일 주간보고서. 사용자가 직접 쓴다.
struct WeeklyPanel: View {
    @Bindable var model: AppModel

    private var office: Office { model.office }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                PanelHeader(title: "주간보고서", subtitle: "\(office.today.weekLabel) · 양식에 맞춰 직접 씁니다.") { model.closePanel() }
                if let submitted = office.weeklyReports.last(where: { $0.weekOf == office.today.mondayOfWeek() }) {
                    after(submitted)
                } else if !office.today.isFriday {
                    Callout(kind: .notice, title: "주간보고서는 금요일에 제출합니다", detail: "위 막대의 '금요일 장면'으로 이동할 수 있습니다.")
                } else {
                    form
                }
            }
            .padding(20)
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 14) {
            section("1. 이번 주 완료한 업무와 결과물", text: $model.office.weeklyDraft.completed)
            section("2. 미완료 업무와 이유", text: $model.office.weeklyDraft.incomplete)
            section("3. 다음 주 목표", text: $model.office.weeklyDraft.nextGoals)
            if office.day.checkInAt == nil {
                Callout(kind: .notice, title: "출근한 뒤에 제출할 수 있습니다", detail: nil)
            }
            let missing = office.weeklyDraft.missingSections
            if !missing.isEmpty {
                Text("아직 쓰지 않은 칸: \(missing.joined(separator: ", "))").font(UI.small).foregroundStyle(UI.inkSoft)
            }
            Button("주간보고서 제출") { model.submitWeekly() }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!missing.isEmpty || !office.canSubmitWeekly)
        }
    }

    private func section(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(UI.bodyBold)
            TextEditor(text: text)
                .font(UI.body)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 96)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(UI.line))
        }
    }

    @ViewBuilder
    private func after(_ report: WeeklyReport) -> some View {
        Callout(kind: .info, title: "주간보고서를 제출했습니다", detail: report.submittedAt.map { "제출 시각 \($0.hm)" })
        if let replyID = report.replyMailID, let mail = office.mails.first(where: { $0.id == replyID }) {
            Button("팀장 답장 읽기") {
                model.office.markRead(mail.id)
                model.selectedMailID = mail.id
                model.panel = .mail
            }
            .buttonStyle(PrimaryButtonStyle())
        } else if model.weeklySending {
            HStack(spacing: 10) {
                ProgressView().controlSize(.small)
                Text("팀장이 답장을 쓰고 있습니다.").font(UI.body)
            }
        } else {
            if let error = model.weeklyError {
                Callout(kind: .warning, title: error.title, detail: error.guidance)
            } else if model.solarClient() == nil {
                Callout(kind: .notice, title: "Solar 키가 없습니다", detail: "설정에서 UPSTAGE_API_KEY를 넣거나\n기본 답장을 받을 수 있습니다.")
            }
            HStack {
                Button("다시 시도") { Task { await model.requestWeeklyReply(for: report) } }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.solarClient() == nil)
                Button("기본 답장 받기") { Task { await model.requestWeeklyReply(for: report, allowFallback: true) } }
                    .buttonStyle(SecondaryButtonStyle())
                Button("설정") { model.showSettings = true }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }
}

/// 조건에 따라 버튼 모양을 바꾸려고 쓰는 감싸개.
struct AnyButtonStyle: ButtonStyle {
    private let make: (Configuration) -> AnyView

    init<S: ButtonStyle>(_ style: S) {
        make = { AnyView(style.makeBody(configuration: $0)) }
    }

    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}
