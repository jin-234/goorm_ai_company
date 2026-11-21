import SwiftUI
import WhisperBridge

/// 설정 시트에 넣는 Whisper 모델 칸. 쓸 모델을 고르고, 없으면 내려받는다.
/// small을 받을 때 말소리 구간 감지 모델(0.9MB)도 함께 받는다.
public struct WhisperModelSection: View {
    @State private var selected = OfficeVoice.selectedModel
    @State private var installed: Set<WhisperModel> = []
    @State private var detectorInstalled = false
    @State private var progress: [WhisperModel: Double] = [:]
    @State private var problems: [WhisperModel: String] = [:]
    @State private var tasks: [WhisperModel: Task<Void, Never>] = [:]

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("음성 전사 모델")
                .font(OfficeStyle.headingFont)
            Text("아침 PT 녹음을 이 맥 안에서 글로 옮깁니다.\n녹음은 전사가 끝나면 지웁니다.")
                .foregroundStyle(OfficeStyle.muted)
                .fixedSize(horizontal: false, vertical: true)

            ForEach(WhisperModel.allCases) { model in
                row(model)
            }

            if detectorInstalled {
                Label("말소리 구간 감지 켜짐", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(OfficeStyle.green)
            } else {
                NoticeBox(.warning, title: "말소리 구간 감지 모델이 없습니다",
                          message: "주변 소음을 말로 잘못 옮길 수 있습니다.\n모델을 내려받으면 함께 받습니다.") {
                    Button("감지 모델만 받기 (0.9MB)") { downloadDetector() }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }

            Text("모델 폴더: \(WhisperModelStore.directory.path)")
                .font(OfficeStyle.badgeFont)
                .foregroundStyle(OfficeStyle.muted)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .officeCard()
        .onAppear(perform: refresh)
        .onDisappear {
            for task in tasks.values { task.cancel() }
        }
    }

    @ViewBuilder
    private func row(_ model: WhisperModel) -> some View {
        let isInstalled = installed.contains(model)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Button {
                    guard isInstalled else { return }
                    selected = model
                    OfficeVoice.selectedModel = model
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: selected == model && isInstalled ? "largecircle.fill.circle" : "circle")
                            .foregroundStyle(isInstalled ? OfficeStyle.green : OfficeStyle.line)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.label).font(OfficeStyle.bodyBoldFont)
                            Text(isInstalled ? "설치됨 · 약 \(model.megabytes)MB" : "설치 안 됨 · 약 \(model.megabytes)MB")
                                .font(OfficeStyle.badgeFont)
                                .foregroundStyle(OfficeStyle.muted)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!isInstalled)
                .accessibilityLabel("\(model.label), \(isInstalled ? "설치됨" : "설치 안 됨")")
                .accessibilityAddTraits(selected == model && isInstalled ? .isSelected : [])

                Spacer()

                if let fraction = progress[model] {
                    Button("멈춤") { tasks[model]?.cancel() }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityLabel("\(model.rawValue) 내려받기 멈춤, \(Int(fraction * 100))퍼센트")
                } else if !isInstalled {
                    Button("내려받기") { download(model) }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
            if let fraction = progress[model] {
                ProgressView(value: fraction) {
                    Text("내려받는 중 \(Int(fraction * 100))%").font(OfficeStyle.badgeFont)
                }
            }
            if let problem = problems[model] {
                NoticeBox(.error, title: "내려받지 못했습니다", message: problem)
            }
        }
        .padding(12)
        .background(selected == model && isInstalled ? OfficeStyle.greenSoft : OfficeStyle.paper,
                    in: RoundedRectangle(cornerRadius: 8))
    }

    private func refresh() {
        installed = Set(WhisperModel.allCases.filter(WhisperModelStore.isInstalled))
        detectorInstalled = WhisperModelStore.isSpeechDetectorInstalled
        selected = OfficeVoice.selectedModel
    }

    private func download(_ model: WhisperModel) {
        problems[model] = nil
        progress[model] = 0
        tasks[model] = Task { @MainActor in
            defer {
                progress[model] = nil
                tasks[model] = nil
                refresh()
            }
            do {
                if !WhisperModelStore.isSpeechDetectorInstalled {
                    _ = try? await WhisperModelStore.downloadSpeechDetector()
                }
                try await WhisperModelStore.download(model) { fraction in
                    Task { @MainActor in
                        if progress[model] != nil { progress[model] = fraction }
                    }
                }
                // 처음 받은 모델은 바로 쓰도록 고른다.
                if !WhisperModelStore.isInstalled(OfficeVoice.selectedModel) {
                    OfficeVoice.selectedModel = model
                }
            } catch is CancellationError {
                problems[model] = "내려받기를 멈췄습니다.\n다시 누르면 처음부터 받습니다."
            } catch {
                problems[model] = error.localizedDescription
            }
        }
    }

    private func downloadDetector() {
        Task { @MainActor in
            _ = try? await WhisperModelStore.downloadSpeechDetector()
            refresh()
        }
    }
}

#Preview("Whisper 모델 설정") {
    ScrollView {
        WhisperModelSection().padding(16)
    }
    .frame(width: OfficeStyle.panelWidth, height: 520)
    .officePanel()
}
