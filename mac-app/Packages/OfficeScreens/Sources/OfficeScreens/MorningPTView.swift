import OfficeCore
import SwiftUI
import WhisperBridge

/// 회의실 아침 PT. 말하거나 적은 PT로 업무 초안을 만들고, 고친 뒤 '확정하고 근무 시작'.
///
/// 흐름: 녹음 → Whisper 전사(이 맥 안) → Solar 초안(연결 안 되면 기기 안 규칙) → 수정 → 확정.
/// 전사문과 초안은 Office에 바로 들어가므로 Solar가 실패해도 지워지지 않는다.
public struct MorningPTView: View {
    @Binding private var office: Office
    private let solar: () -> SolarClient?
    private let openSettings: () -> Void
    private let onConfirmed: () -> Void

    @State private var voice = PTVoiceModel()
    @State private var making = false
    @State private var solarError: SolarError?
    @State private var confirmError: String?
    @State private var draftSeconds: Double?
    @State private var askReplace = false

    /// 기획서의 아침 PT 예시.
    public nonisolated static let samplePT = """
        3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.
        2단계 당일 업무는 포트폴리오 한 문단 초안입니다. 오후 5시까지 문단을 쓰겠습니다.
        1단계 이월 가능 업무는 관심 기업 세 곳 저장입니다. 퇴근 전까지 링크를 모으겠습니다.
        """

    /// - Parameters:
    ///   - solar: Solar 클라이언트. 키가 없으면 nil을 돌려주고, 그때는 기기 안 규칙으로 정리한다.
    ///   - openSettings: 키나 Whisper 모델 설정을 여는 동작.
    ///   - onConfirmed: '확정하고 근무 시작'이 성공한 뒤 불린다.
    public init(office: Binding<Office>, solar: @escaping () -> SolarClient?,
                openSettings: @escaping () -> Void, onConfirmed: @escaping () -> Void) {
        _office = office
        self.solar = solar
        self.openSettings = openSettings
        self.onConfirmed = onConfirmed
    }

    private var isOpen: Bool { office.day.phase == .morningPT }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: OfficeStyle.spacing) {
                PanelHeader(place: "회의실", title: "아침 PT",
                            detail: "오늘 할 일을 3단계부터 1단계 순서로 말해 주세요.\n확정한 업무로 퇴근 점검을 합니다.")
                if !isOpen {
                    closedNotice
                }
                if isOpen || office.day.confirmedAt == nil {
                    formCard
                    recordCard
                    transcriptCard
                    draftsSection
                    confirmSection
                } else {
                    confirmedSummary
                }
            }
            .padding(16)
        }
        .frame(minWidth: OfficeStyle.panelWidth, maxWidth: OfficeStyle.panelWidth)
        .officePanel()
        .onDisappear {
            // 녹음 중에 패널을 닫으면 마이크를 끄고 녹음을 버린다. 전사 중이면 끝까지 해서 전사문을 남긴다.
            if voice.stage == .recording { voice.cancel() }
        }
        .confirmationDialog("초안을 새로 만들까요?", isPresented: $askReplace) {
            Button("새로 만들기") { Task { await makeDrafts() } }
            Button("그대로 두기", role: .cancel) {}
        } message: {
            Text("지금 고친 초안이 전사문으로 다시 만든 초안으로 바뀝니다.\n이월된 업무는 그대로 남습니다.")
        }
    }

    // MARK: - 안내

    @ViewBuilder
    private var closedNotice: some View {
        switch office.day.phase {
        case .beforeCheckIn:
            NoticeBox(.info, title: "출근한 뒤 아침 PT를 합니다",
                      message: "출입문에서 카메라 출근을 먼저 해 주세요.")
        case .morningPT:
            EmptyView()
        default:
            NoticeBox(.ok, title: "오늘 업무를 이미 확정했습니다",
                      message: office.day.confirmedAt.map { "\(Clock.hm($0.minuteOfDay))에 확정했습니다." })
        }
    }

    private var formCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("발표 양식").font(OfficeStyle.headingFont)
            ForEach(TaskLevel.allCases.reversed(), id: \.self) { level in
                HStack(alignment: .top, spacing: 10) {
                    Badge(level.short)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(level.meaning).font(OfficeStyle.bodyBoldFont)
                        Text(level.ruleAtWorkEnd)
                            .foregroundStyle(OfficeStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            Text("“3단계 필수 업무는 지원서 최종 검토입니다.\n오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다.”")
                .foregroundStyle(OfficeStyle.muted)
                .padding(.top, 2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .officeCard()
    }

    // MARK: - 녹음

    private var recordCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("말로 하기").font(OfficeStyle.headingFont)
                Spacer()
                Text("모델 \(OfficeVoice.selectedModel.rawValue)")
                    .font(OfficeStyle.badgeFont)
                    .foregroundStyle(OfficeStyle.muted)
            }
            HStack(spacing: 12) {
                Button {
                    Task { await toggleRecording() }
                } label: {
                    Label(recordButtonTitle, systemImage: voice.stage == .recording ? "stop.fill" : "mic.fill")
                }
                .buttonStyle(PrimaryButtonStyle(fullWidth: false))
                .disabled(!isOpen || voice.stage == .transcribing || making)
                .keyboardShortcut("r", modifiers: [.command])
                .accessibilityHint("Command R로도 누를 수 있습니다.")

                switch voice.stage {
                case .recording:
                    LevelBar(level: voice.level)
                    Text(Self.timeText(voice.elapsed))
                        .monospacedDigit()
                        .foregroundStyle(OfficeStyle.muted)
                case .transcribing:
                    ProgressView().controlSize(.small)
                    Text("글로 옮기는 중").foregroundStyle(OfficeStyle.muted)
                case .idle:
                    if making {
                        ProgressView().controlSize(.small)
                        Text("업무 초안을 만드는 중").foregroundStyle(OfficeStyle.muted)
                    }
                }
                Spacer(minLength: 0)
            }
            if let problem = voice.problem {
                NoticeBox(.error, title: "녹음을 글로 옮기지 못했습니다", message: problem) {
                    if voice.needsModel {
                        Button("설정 열기", action: openSettings).buttonStyle(SecondaryButtonStyle())
                    }
                }
            }
            Text("녹음은 이 맥 안에서 글로 옮긴 뒤 바로 지웁니다.")
                .font(OfficeStyle.badgeFont)
                .foregroundStyle(OfficeStyle.muted)
        }
        .officeCard()
    }

    private var recordButtonTitle: String {
        switch voice.stage {
        case .recording: "말하기 끝"
        case .transcribing: "옮기는 중"
        case .idle: "말하기 시작"
        }
    }

    private func toggleRecording() async {
        switch voice.stage {
        case .idle:
            await voice.start()
        case .recording:
            guard let text = await voice.stopAndTranscribe() else { return }
            let current = office.day.transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            office.setTranscript(current.isEmpty ? text : current + "\n" + text)
            await makeDrafts()
        case .transcribing:
            break
        }
    }

    // MARK: - 전사문

    private var transcriptBinding: Binding<String> {
        Binding(get: { office.day.transcript }, set: { office.setTranscript($0) })
    }

    private var transcriptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("전사문").font(OfficeStyle.headingFont)
                Spacer()
                Button("예시 넣기") { office.setTranscript(Self.samplePT) }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(!isOpen || voice.isBusy)
            }
            if let warning = voice.warning {
                NoticeBox(.warning, title: "전사문을 확인해 주세요", message: warning)
            }
            TextEditor(text: transcriptBinding)
                .font(OfficeStyle.bodyFont)
                .scrollContentBackground(.hidden)
                .padding(8)
                .frame(minHeight: 120)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(OfficeStyle.line))
                .overlay(alignment: .topLeading) {
                    if office.day.transcript.isEmpty {
                        Text("녹음하면 여기에 글이 들어옵니다.\n직접 적어도 됩니다.")
                            .foregroundStyle(OfficeStyle.muted)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 8)
                            .allowsHitTesting(false)
                    }
                }
                .disabled(!isOpen || voice.isBusy)
                .accessibilityLabel("전사문")
            Button {
                if office.day.drafts.contains(where: { !$0.isCarried }) {
                    askReplace = true
                } else {
                    Task { await makeDrafts() }
                }
            } label: {
                Label("업무 초안 만들기", systemImage: "list.bullet.clipboard")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(!isOpen || making || voice.isBusy
                      || office.day.transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let solarError {
                NoticeBox(.warning, title: solarError.title,
                          message: solarError.guidance + "\n지금은 기기 안 규칙으로 정리한 초안을 보여 드립니다.") {
                    HStack(spacing: 8) {
                        if solarError.canRetry {
                            Button("Solar로 다시 시도") { Task { await makeDrafts() } }
                                .buttonStyle(SecondaryButtonStyle())
                        }
                        if solarError.needsKeySetup {
                            Button("설정 열기", action: openSettings).buttonStyle(SecondaryButtonStyle())
                        }
                    }
                }
            }
        }
        .officeCard()
    }

    /// 전사문으로 초안을 만든다. Solar가 없거나 실패하면 기기 안 규칙으로 만든다.
    private func makeDrafts() async {
        let transcript = office.day.transcript
        guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        making = true
        solarError = nil
        defer { making = false }
        let workEnd = office.profile.workEnd
        if let client = solar() {
            do {
                let drafts = try await client.checklist(transcript: transcript, workEnd: workEnd)
                office.replaceDrafts(drafts, source: .solar)
            } catch {
                solarError = error
                office.replaceDrafts(PTParser.parse(transcript, workEnd: workEnd), source: .localRules)
            }
        } else {
            office.replaceDrafts(PTParser.parse(transcript, workEnd: workEnd), source: .localRules)
        }
        if let stoppedAt = voice.stoppedAt {
            draftSeconds = Date().timeIntervalSince(stoppedAt)
        }
    }

    // MARK: - 초안

    private var draftsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("업무 체크리스트").font(OfficeStyle.headingFont)
                Spacer()
                if let source = office.day.draftSource {
                    Badge(source.label, icon: source == .solar ? "sparkles" : "cpu",
                          color: source == .solar ? OfficeStyle.green : OfficeStyle.warning,
                          background: source == .solar ? OfficeStyle.greenSoft : OfficeStyle.warningSoft)
                }
            }
            if let draftSeconds {
                Text("녹음을 마친 뒤 초안까지 \(String(format: "%.1f", draftSeconds))초")
                    .font(OfficeStyle.badgeFont)
                    .foregroundStyle(OfficeStyle.muted)
            }
            if office.day.drafts.isEmpty {
                Text("아직 업무가 없습니다.\n말하거나 적은 뒤 '업무 초안 만들기'를 누르세요.")
                    .foregroundStyle(OfficeStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach($office.day.drafts) { $draft in
                DraftRow(draft: $draft, workEnd: office.profile.workEnd, editable: isOpen) {
                    office.removeDraft(draft.id)
                }
            }
            Button {
                office.addDraft()
            } label: {
                Label("업무 직접 추가", systemImage: "plus")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(!isOpen)
        }
        .officeCard()
    }

    // MARK: - 확정

    private var confirmSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            if isOpen, let blocker = office.confirmBlocker, !office.day.drafts.isEmpty {
                NoticeBox(.warning, title: "확인이 필요합니다", message: Self.blockerRows(blocker))
            }
            if let confirmError {
                NoticeBox(.error, title: "확정하지 못했습니다", message: confirmError)
            }
            Button {
                do {
                    try office.confirmTasks()
                    confirmError = nil
                    onConfirmed()
                } catch {
                    confirmError = error.localizedDescription
                }
            } label: {
                Label("확정하고 근무 시작", systemImage: "checkmark.seal.fill")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!isOpen || office.confirmBlocker != nil || making || voice.isBusy)
        }
    }

    /// '확인이 필요한 칸이 남아 있습니다.' 아래 줄만 보인다(제목과 겹치지 않게).
    static func blockerRows(_ blocker: OfficeError) -> String {
        if case .draftIncomplete(let rows) = blocker { return rows.joined(separator: "\n") }
        return blocker.localizedDescription
    }

    private var confirmedSummary: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("확정한 업무 \(office.day.tasks.count)건").font(OfficeStyle.headingFont)
            ForEach(office.day.tasks) { task in
                HStack(alignment: .top, spacing: 10) {
                    Badge(task.level.short)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(task.title).font(OfficeStyle.bodyBoldFont)
                        Text("\(Clock.hm(task.due))까지 · \(task.doneCriteria)")
                            .foregroundStyle(OfficeStyle.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .officeCard()
    }

    static func timeText(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

// MARK: - 업무 한 줄

struct DraftRow: View {
    @Binding var draft: TaskDraft
    var workEnd: Int
    var editable: Bool
    var onRemove: () -> Void

    @State private var dueText = ""
    @State private var dueInvalid = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if hasBadges {
            HStack(spacing: 8) {
                if draft.isCarried {
                    Badge("이월" + (draft.carryCount > 1 ? " \(draft.carryCount)회" : ""),
                          icon: "arrow.uturn.forward", color: OfficeStyle.warning, background: OfficeStyle.warningSoft)
                }
                if !draft.missingFields.isEmpty {
                    Badge("확인 필요 · " + draft.missingFields.joined(separator: ", "),
                          icon: "exclamationmark.triangle.fill",
                          color: OfficeStyle.warning, background: OfficeStyle.warningSoft)
                }
                Spacer(minLength: 0)
                removeButton
            }
            }

            field("업무명") {
                HStack(spacing: 6) {
                    TextField("예: 지원서 최종 검토", text: text(\.title))
                        .officeField()
                    if !hasBadges { removeButton }
                }
            }

            field("중요도") {
                HStack(spacing: 6) {
                    ForEach(TaskLevel.allCases.reversed(), id: \.self) { level in
                        let chosen = draft.level == level
                        Button {
                            draft.level = level
                        } label: {
                            Text(level.label)
                                .font(chosen ? OfficeStyle.badgeFont : OfficeStyle.font(13))
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                                .frame(maxWidth: .infinity, minHeight: OfficeStyle.smallButtonHeight)
                                .foregroundStyle(chosen ? Color.white : OfficeStyle.green)
                                .background(chosen ? OfficeStyle.green : OfficeStyle.card,
                                            in: RoundedRectangle(cornerRadius: 7))
                                .overlay(RoundedRectangle(cornerRadius: 7)
                                    .strokeBorder(OfficeStyle.green.opacity(chosen ? 1 : 0.4)))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(chosen ? .isSelected : [])
                    }
                }
            }

            field("마감") {
                HStack(spacing: 8) {
                    TextField("HH:MM", text: $dueText)
                        .officeField()
                        .frame(width: 90 * OfficeStyle.scale)
                        .monospacedDigit()
                        .onChange(of: dueText) { _, value in
                            let minutes = Clock.minutes(fromHM: value)
                            dueInvalid = !value.isEmpty && minutes == nil
                            if minutes != draft.due { draft.due = minutes }
                        }
                    Button("퇴근 전") { dueText = Clock.hm(workEnd) }
                        .buttonStyle(SecondaryButtonStyle())
                    if let due = draft.due {
                        Text(Clock.korean(due)).foregroundStyle(OfficeStyle.muted)
                    } else if dueInvalid {
                        Label("HH:MM 형식으로 적어 주세요", systemImage: "exclamationmark.triangle.fill")
                            .font(OfficeStyle.badgeFont)
                            .foregroundStyle(OfficeStyle.warning)
                    }
                }
            }

            field("완료 기준") {
                TextField("예: 제출본을 저장", text: text(\.doneCriteria), axis: .vertical)
                    .officeField()
                    .lineLimit(1...3)
            }
        }
        .padding(12)
        .background(OfficeStyle.paper, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8)
            .strokeBorder(draft.isComplete ? OfficeStyle.line : OfficeStyle.warning.opacity(0.5)))
        .disabled(!editable)
        .onAppear { dueText = draft.due.map(Clock.hm) ?? "" }
        .onChange(of: draft.due) { _, due in
            // Solar 초안이 새로 들어오면 칸도 맞춘다.
            if let due, Clock.minutes(fromHM: dueText) != due { dueText = Clock.hm(due) }
        }
    }

    private var hasBadges: Bool { draft.isCarried || !draft.missingFields.isEmpty }

    /// 이월 업무는 뺄 수 없어서 버튼이 없다.
    @ViewBuilder
    private var removeButton: some View {
        if !draft.isCarried {
            Button(role: .destructive, action: onRemove) {
                Image(systemName: "trash")
                    .frame(width: 32, height: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .foregroundStyle(OfficeStyle.danger)
            .disabled(!editable)
            .accessibilityLabel("이 업무 빼기")
        }
    }

    private func text(_ path: WritableKeyPath<TaskDraft, String?>) -> Binding<String> {
        Binding(get: { draft[keyPath: path] ?? "" }, set: { draft[keyPath: path] = $0 })
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(OfficeStyle.badgeFont)
                .foregroundStyle(OfficeStyle.muted)
            content()
        }
    }
}

/// 녹음 입력 크기 막대.
struct LevelBar: View {
    var level: Float

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(OfficeStyle.line)
                Capsule().fill(OfficeStyle.green)
                    .frame(width: max(6, geometry.size.width * CGFloat(level)))
            }
        }
        .frame(width: 110, height: 8)
        .animation(.linear(duration: 0.08), value: level)
        .accessibilityLabel("입력 크기")
        .accessibilityValue("\(Int(level * 100))퍼센트")
    }
}

extension Date {
    /// 서울 시각 기준 자정부터의 분.
    var minuteOfDay: Int {
        let parts = KST.calendar.dateComponents([.hour, .minute], from: self)
        return (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
    }
}

#Preview("아침 PT · 초안") {
    @Previewable @State var office = OfficeSamples.morningPT(withDrafts: true)
    MorningPTView(office: $office, solar: { nil }, openSettings: {}, onConfirmed: {})
        .frame(height: OfficeStyle.panelMinHeight)
}
