import Foundation

/// Whisper 다국어 모델.
/// small을 먼저 쓰고, 시연용 맥에서 느리면 같은 녹음으로 base와 비교한다.
/// M1 Pro에서 21초 발표 전사: small 약 1.1초, base 약 0.5초(합성 음성 기준, base가 오탈자가 더 많다).
public enum WhisperModel: String, CaseIterable, Sendable, Identifiable {
    case small
    case base

    public var id: String { rawValue }

    /// 모델 폴더 안의 파일 이름.
    public var fileName: String { file.fileName }

    /// 내려받는 주소. whisper.cpp가 배포하는 ggml 형식 파일이다.
    public var remoteURL: URL { file.remoteURL }

    /// 대략적인 파일 크기(MB). 화면 표시용.
    public var megabytes: Int {
        switch self {
        case .small: 488
        case .base: 148
        }
    }

    /// 화면에 보이는 이름.
    public var label: String {
        switch self {
        case .small: "small · 정확도 우선"
        case .base: "base · 속도 우선"
        }
    }

    /// 배포 파일의 크기(바이트). 덜 받은 파일을 가려내는 기준으로 쓴다.
    var expectedBytes: Int64 { file.expectedBytes }

    var file: ModelFile {
        switch self {
        case .small: .whisperSmall
        case .base: .whisperBase
        }
    }
}

/// 모델 폴더에 두는 파일 하나.
struct ModelFile: Sendable, Equatable {
    var fileName: String
    var remoteURL: URL
    var expectedBytes: Int64

    static let whisperSmall = ModelFile(
        fileName: "ggml-small.bin",
        remoteURL: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin")!,
        expectedBytes: 487_601_967)

    static let whisperBase = ModelFile(
        fileName: "ggml-base.bin",
        remoteURL: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin")!,
        expectedBytes: 147_951_465)

    /// 말소리 구간 감지 모델(Silero VAD v6.2.0, 약 0.9MB).
    /// 잡음·타자 소리만 있는 구간을 전사에서 빼서, 없는 말을 지어내는 일을 줄인다.
    static let speechDetector = ModelFile(
        fileName: "ggml-silero-v6.2.0.bin",
        remoteURL: URL(string: "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v6.2.0.bin")!,
        expectedBytes: 885_098)
}
