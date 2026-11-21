import Foundation
import Observation
import WhisperBridge

/// 앱 전체가 함께 쓰는 전사기. 모델을 한 번 읽어 두고 계속 쓴다.
public enum OfficeVoice {
    public static let transcriber = WhisperTranscriber()

    /// 고른 모델을 저장하는 키.
    static let modelKey = "AIBossOffice.whisperModel"

    /// 설정에서 고른 모델. 고른 모델이 없으면 설치된 모델(small 우선), 둘 다 없으면 small.
    public static var selectedModel: WhisperModel {
        get {
            if let raw = UserDefaults.standard.string(forKey: modelKey), let model = WhisperModel(rawValue: raw) {
                return model
            }
            return WhisperModel.allCases.first(where: WhisperModelStore.isInstalled) ?? .small
        }
        set {
            UserDefaults.standard.set(newValue.rawValue, forKey: modelKey)
        }
    }
}

/// 마이크 녹음과 전사의 진행 상태. 화면은 이 값만 본다.
@MainActor
@Observable
final class PTVoiceModel {
    enum Stage: Equatable {
        case idle
        case recording
        case transcribing
    }

    private(set) var stage: Stage = .idle
    /// 0~1 입력 크기.
    private(set) var level: Float = 0
    private(set) var elapsed: TimeInterval = 0
    /// 녹음이나 전사가 실패한 이유. 의미 단위로 줄이 나뉘어 있다.
    private(set) var problem: String?
    /// 모델이 없어서 실패했는지(설정 열기 버튼을 보인다).
    private(set) var needsModel = false
    /// 전사문이 지어낸 내용을 담았을 수 있다는 안내.
    private(set) var warning: String?
    /// 녹음을 멈춘 시각. 초안까지 걸린 시간을 재는 데 쓴다.
    private(set) var stoppedAt: Date?
    private(set) var lastTranscription: Transcription?

    @ObservationIgnored private let recorder = VoiceRecorder()

    init() {
        recorder.onChange = { [weak self] in self?.syncRecorder() }
    }

    var isBusy: Bool { stage != .idle }

    func clearProblem() {
        problem = nil
        needsModel = false
    }

    func start() async {
        guard stage == .idle else { return }
        clearProblem()
        warning = nil
        await recorder.start()
        syncRecorder()
    }

    /// 녹음을 멈추고 전사한다. 원음은 전사가 끝나면 버린다.
    /// - Returns: 전사문. 실패하면 nil이고 `problem`에 이유가 들어간다.
    func stopAndTranscribe() async -> String? {
        guard stage == .recording else { return nil }
        var samples = recorder.stop()
        stoppedAt = Date()
        stage = .transcribing
        defer {
            samples = []
            stage = .idle
        }
        do {
            let result = try await OfficeVoice.transcriber.transcribe(
                samples: samples, model: OfficeVoice.selectedModel, prompt: WhisperTranscriber.morningPTPrompt)
            lastTranscription = result
            warning = result.warning
            return result.text
        } catch let error as WhisperError {
            problem = error.localizedDescription
            if case .modelMissing = error { needsModel = true }
        } catch is CancellationError {
            problem = "전사를 멈췄습니다."
        } catch {
            problem = "전사에 실패했습니다.\n다시 시도해 주세요."
        }
        return nil
    }

    func cancel() {
        recorder.cancel()
        syncRecorder()
    }

    private func syncRecorder() {
        level = recorder.level
        elapsed = recorder.elapsed
        switch recorder.state {
        case .recording:
            stage = .recording
        case .idle:
            if stage == .recording { stage = .idle }
        case .denied:
            stage = .idle
            problem = "마이크 권한이 없습니다.\n시스템 설정 > 개인정보 보호 및 보안 > 마이크에서 이 앱을 허용해 주세요."
        case .failed(let message):
            // 도중에 멈춘 경우 stop()으로 그때까지의 녹음을 받을 수 있으므로 녹음 상태를 유지한다.
            problem = message
        }
    }
}
