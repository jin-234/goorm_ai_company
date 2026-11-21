import Foundation
import Synchronization
import whisper

/// 전사 결과.
public struct Transcription: Sendable, Equatable {
    /// 전사문.
    public var text: String
    /// 녹음 길이(초).
    public var audioSeconds: Double
    /// 전사를 시작해서 전사문이 나오기까지 걸린 시간(초). 모델을 읽은 시간을 포함한다.
    public var elapsedSeconds: Double
    public var model: WhisperModel
    /// `elapsedSeconds` 가운데 모델을 읽는 데 쓴 시간(초). 이미 읽혀 있었으면 0.
    public var loadSeconds: Double
    /// 말소리 구간 감지 모델로 말 없는 구간을 걸러 냈는지.
    public var usedSpeechDetector: Bool
    /// 전사문이 말하지 않은 내용을 지어냈을 수 있으면 화면에 보일 안내. 문제없으면 nil.
    /// Whisper는 웅성거림·잡음에서 "구독과 좋아요" 같은 문장을 지어내는 일이 있다.
    public var warning: String?

    public init(text: String, audioSeconds: Double, elapsedSeconds: Double, model: WhisperModel,
                loadSeconds: Double = 0, usedSpeechDetector: Bool = false, warning: String? = nil) {
        self.text = text
        self.audioSeconds = audioSeconds
        self.elapsedSeconds = elapsedSeconds
        self.model = model
        self.loadSeconds = loadSeconds
        self.usedSpeechDetector = usedSpeechDetector
        self.warning = warning
    }
}

public enum WhisperError: Error, LocalizedError, Equatable {
    /// 모델 파일이 모델 폴더에 없음.
    case modelMissing(WhisperModel)
    /// 모델 파일은 있지만 읽지 못함.
    case loadFailed
    /// 녹음이 비었거나 말소리가 없음.
    case emptyAudio
    /// whisper.cpp가 돌려준 오류 코드.
    case transcribeFailed(Int32)

    /// 화면에 보이는 안내. 의미 단위로 줄을 나눈다.
    public var errorDescription: String? {
        switch self {
        case .modelMissing(let model):
            "Whisper \(model.rawValue) 모델이 없습니다.\n모델을 내려받은 뒤 다시 시도해 주세요. (약 \(model.megabytes)MB)"
        case .loadFailed:
            "Whisper 모델을 읽지 못했습니다.\n모델을 다시 내려받아 주세요."
        case .emptyAudio:
            "녹음에서 말소리를 찾지 못했습니다.\n마이크 가까이에서 다시 말해 주세요."
        case .transcribeFailed(let code):
            "전사에 실패했습니다.\n다시 시도해 주세요. (코드 \(code))"
        }
    }
}

/// whisper.cpp로 녹음을 글로 옮긴다. 서버 없이 이 프로세스 안에서 돈다.
///
/// 모델은 처음 쓸 때 읽어 두고, 다른 모델을 요청하면 바꿔 읽는다.
/// 전사는 몇 초씩 걸리므로 전용 큐에서 돌려 다른 작업을 막지 않는다.
/// 말소리 구간 감지 모델(Silero)이 모델 폴더에 있으면 말 없는 구간을 빼고 전사한다.
public actor WhisperTranscriber {
    private let queue = DispatchSerialQueue(label: "AIBossOffice.WhisperTranscriber", qos: .userInitiated)

    public nonisolated var unownedExecutor: UnownedSerialExecutor {
        queue.asUnownedSerialExecutor()
    }

    /// 아침 PT용 프롬프트. 단계 이름의 표기("3단계 필수 업무")를 맞춘다.
    /// 합성 음성 8개 실험에서 글자 오류가 5.5%에서 4.1%로 줄었다.
    public static let morningPTPrompt =
        "오늘 할 일을 3단계 필수 업무, 2단계 당일 업무, 1단계 이월 가능 업무 순서로 말씀드리겠습니다. 첫째, 둘째로 나누어 마감과 완료 기준을 말씀드리겠습니다."

    private let folder: ModelFolder
    private var loaded: (model: WhisperModel, context: WhisperContext)?

    public init() {
        folder = .standard
    }

    /// 시험용. 다른 폴더의 모델을 쓴다.
    init(folder: ModelFolder) {
        self.folder = folder
    }

    /// 16kHz 모노 Float32 녹음을 전사한다.
    /// - Parameters:
    ///   - language: 말하는 언어. 자동 감지는 "auto".
    ///   - prompt: 자주 나오는 낱말을 미리 알려 주는 글. 표기를 맞추는 데 쓴다. 없어도 된다.
    /// - Throws: `WhisperError`, 작업을 취소하면 `CancellationError`.
    public func transcribe(samples: [Float], model: WhisperModel, language: String = "ko",
                           prompt: String? = nil) async throws -> Transcription {
        let clock = ContinuousClock()
        let started = clock.now
        guard SpeechEnergy.hasSpeech(samples) else { throw WhisperError.emptyAudio }
        try Task.checkCancellation()

        let alreadyLoaded = loaded?.model == model
        let context = try context(for: model)
        let loadSeconds = alreadyLoaded ? 0 : Self.seconds(clock.now - started)
        let detector = folder.isInstalled(.speechDetector) ? folder.url(for: .speechDetector).path : nil

        let cancel = CancelFlag()
        let outcome = await withTaskCancellationHandler {
            context.run(samples: samples, language: language, prompt: prompt, speechDetector: detector,
                        threads: Self.threadCount, cancel: cancel)
        } onCancel: {
            cancel.cancel()
        }
        if cancel.isCancelled { throw CancellationError() }
        guard outcome.code == 0 else { throw WhisperError.transcribeFailed(outcome.code) }

        let review = TranscriptCheck.review(outcome.segments, prompt: prompt)
        // 소리는 있었지만 말로 읽히지 않은 경우.
        guard !review.text.isEmpty else { throw WhisperError.emptyAudio }
        return Transcription(text: review.text,
                             audioSeconds: AudioSamples.seconds(samples),
                             elapsedSeconds: Self.seconds(clock.now - started),
                             model: model,
                             loadSeconds: loadSeconds,
                             usedSpeechDetector: detector != nil,
                             warning: review.warning)
    }

    /// 읽어 둔 모델을 메모리에서 내린다.
    public func unload() {
        loaded = nil
    }

    private func context(for model: WhisperModel) throws -> WhisperContext {
        if let loaded, loaded.model == model { return loaded.context }
        // 두 모델이 함께 메모리에 올라가 있지 않게 먼저 내린다.
        loaded = nil
        guard folder.isInstalled(model.file) else { throw WhisperError.modelMissing(model) }
        guard let context = WhisperContext(path: folder.url(for: model.file).path) else {
            throw WhisperError.loadFailed
        }
        loaded = (model, context)
        return context
    }

    private static func seconds(_ duration: Duration) -> Double {
        let parts = duration.components
        return Double(parts.seconds) + Double(parts.attoseconds) / 1e18
    }

    /// 디코더에 쓸 스레드 수. 성능 코어 수에 맞추고 8개를 넘기지 않는다.
    private static let threadCount: Int32 = {
        var cores: Int32 = 0
        var size = MemoryLayout<Int32>.size
        if sysctlbyname("hw.perflevel0.physicalcpu", &cores, &size, nil, 0) == 0, cores > 0 {
            return min(cores, 8)
        }
        return Int32(max(1, min(8, ProcessInfo.processInfo.activeProcessorCount - 2)))
    }()
}

// MARK: - whisper.cpp 다루기

/// 읽어 둔 모델 하나.
private final class WhisperContext: @unchecked Sendable {
    /// 이미 내린 모델로 전사하려 했을 때의 코드. 프로세스가 끝나는 중에만 나온다.
    static let releasedCode: Int32 = -100

    private let pointer: OpaquePointer
    /// 전사하는 동안, 그리고 모델을 내리는 동안 잡는다.
    private let useLock = NSLock()
    /// `useLock`을 잡고 읽고 쓴다.
    private var released = false
    /// 지금 돌고 있는 전사를 멈추는 표시.
    private let running = Mutex<CancelFlag?>(nil)

    init?(path: String) {
        WhisperLog.install
        var parameters = whisper_context_default_params()
        parameters.use_gpu = true
        guard let pointer = whisper_init_from_file_with_params(path, parameters) else { return nil }
        self.pointer = pointer
        LiveContexts.add(self)
    }

    deinit {
        LiveContexts.remove(ObjectIdentifier(self))
        release()
    }

    /// 모델을 메모리에서 내린다. 전사 중이면 끝나기를 기다린다.
    /// - Returns: 기한 안에 내리지 못했으면 false.
    @discardableResult
    func release(before deadline: Date? = nil) -> Bool {
        if let deadline {
            guard useLock.lock(before: deadline) else { return false }
        } else {
            useLock.lock()
        }
        defer { useLock.unlock() }
        guard !released else { return true }
        released = true
        whisper_free(pointer)
        return true
    }

    /// 돌고 있는 전사가 있으면 멈추게 한다.
    func cancelRunning() {
        running.withLock { $0?.cancel() }
    }

    func run(samples: [Float], language: String, prompt: String?, speechDetector: String?, threads: Int32,
             cancel: CancelFlag) -> (code: Int32, segments: [String]) {
        useLock.lock()
        defer { useLock.unlock() }
        guard !released else { return (Self.releasedCode, []) }
        running.withLock { $0 = cancel }
        defer { running.withLock { $0 = nil } }

        // 탐색 폭(beam 5)은 오류를 거의 줄이지 못하고 30% 느려서 기본 방식(greedy)을 쓴다.
        var parameters = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        parameters.n_threads = threads
        parameters.translate = false
        parameters.detect_language = false
        // 앞 구간에서 잘못 읽은 말이 뒤로 번지지 않게 한다.
        parameters.no_context = true
        parameters.suppress_blank = true
        parameters.suppress_nst = true
        parameters.print_special = false
        parameters.print_progress = false
        parameters.print_realtime = false
        parameters.print_timestamps = false
        parameters.vad = speechDetector != nil
        parameters.abort_callback = { data in
            guard let data else { return false }
            return Unmanaged<CancelFlag>.fromOpaque(data).takeUnretainedValue().isCancelled
        }
        parameters.abort_callback_user_data = Unmanaged.passUnretained(cancel).toOpaque()

        let code = language.withCString { languagePointer -> Int32 in
            parameters.language = languagePointer
            return Self.withOptionalCString(prompt) { promptPointer -> Int32 in
                parameters.initial_prompt = promptPointer
                return Self.withOptionalCString(speechDetector) { detectorPointer -> Int32 in
                    parameters.vad_model_path = detectorPointer
                    return samples.withUnsafeBufferPointer { buffer in
                        whisper_full(pointer, parameters, buffer.baseAddress, Int32(buffer.count))
                    }
                }
            }
        }
        guard code == 0 else { return (code, []) }

        // 구간 경계에서 글자가 잘릴 수 있어 바이트를 모두 이은 뒤 한 번에 글자로 바꾼다.
        // 구간마다 끝 위치를 기억해 두고, 이은 글에서 다시 자른다.
        var bytes: [UInt8] = []
        var ends: [Int] = []
        for index in 0..<whisper_full_n_segments(pointer) {
            guard let piece = whisper_full_get_segment_text(pointer, index) else { continue }
            let length = strlen(piece)
            piece.withMemoryRebound(to: UInt8.self, capacity: length) { start in
                bytes.append(contentsOf: UnsafeBufferPointer(start: start, count: length))
            }
            ends.append(bytes.count)
        }
        var segments: [String] = []
        var start = 0
        for end in ends {
            segments.append(String(decoding: bytes[start..<end], as: UTF8.self))
            start = end
        }
        return (0, segments)
    }

    private static func withOptionalCString<Result>(_ text: String?,
                                                    _ body: (UnsafePointer<CChar>?) -> Result) -> Result {
        guard let text, !text.isEmpty else { return body(nil) }
        return text.withCString { body($0) }
    }
}

/// 읽어 둔 모델 목록.
///
/// 모델을 읽어 둔 채 프로세스가 끝나면 whisper.cpp의 Metal 정리 코드가
/// "아직 쓰는 자원이 있다"며 비정상 종료한다(앱을 끌 때 오류 창이 뜬다).
/// 그래서 프로세스가 끝날 때 남은 모델을 먼저 내린다.
private enum LiveContexts {
    private struct WeakContext {
        weak var context: WhisperContext?
    }

    private static let contexts = Mutex<[ObjectIdentifier: WeakContext]>([:])

    /// 종료할 때 부를 함수를 한 번만 걸어 둔다.
    /// whisper.cpp가 자기 정리 코드를 건 뒤에 걸어야 먼저 불리므로, 모델을 처음 읽은 다음에 건다.
    private static let exitHook: Void = {
        atexit { LiveContexts.releaseAll() }
    }()

    static func add(_ context: WhisperContext) {
        contexts.withLock { $0[ObjectIdentifier(context)] = WeakContext(context: context) }
        exitHook
    }

    static func remove(_ id: ObjectIdentifier) {
        contexts.withLock { $0[id] = nil }
    }

    /// 돌고 있는 전사를 멈추게 하고 2초까지 기다려 모델을 내린다.
    static func releaseAll() {
        let alive = contexts.withLock { $0.values.compactMap(\.context) }
        for context in alive { context.cancelRunning() }
        let deadline = Date().addingTimeInterval(2)
        for context in alive { context.release(before: deadline) }
    }
}

/// 전사를 도중에 멈추라는 표시.
private final class CancelFlag: Sendable {
    private let cancelled = Atomic<Bool>(false)

    func cancel() {
        cancelled.store(true, ordering: .relaxed)
    }

    var isCancelled: Bool {
        cancelled.load(ordering: .relaxed)
    }
}

private enum WhisperLog {
    /// whisper.cpp가 모델을 읽을 때 내는 안내를 끄고 오류만 남긴다.
    /// 전부 보려면 환경 변수 `WHISPER_VERBOSE=1`로 실행한다.
    static let install: Void = {
        guard ProcessInfo.processInfo.environment["WHISPER_VERBOSE"] != "1" else { return }
        whisper_log_set({ level, text, _ in
            guard level == GGML_LOG_LEVEL_ERROR, let text else { return }
            let message = String(cString: text)
            // Core ML용 모델 파일은 쓰지 않는다. 없다는 안내는 오류가 아니다(Metal로 돈다).
            guard !message.contains("Core ML") else { return }
            FileHandle.standardError.write(Data(message.utf8))
        }, nil)
    }()
}

// MARK: - 전사문 정리와 점검

enum TranscriptText {
    /// 구간 사이의 공백과 줄바꿈을 한 칸으로 정리한다.
    static func clean(_ raw: String) -> String {
        raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// 비교용. 공백과 문장 부호를 빼고 소문자로.
    static func key(_ text: String) -> String {
        String(text.lowercased().unicodeScalars.filter {
            !CharacterSet.whitespacesAndNewlines.contains($0) && !CharacterSet.punctuationCharacters.contains($0)
        }.map(Character.init))
    }
}

/// 말하지 않은 내용을 지어낸 전사인지 살핀다.
///
/// 실험(합성 음성과 웅성거림 섞기)에서 본 지어내기는 세 가지였다.
/// 1. 영상 끝인사("구독과 좋아요", "시청해 주셔서") — 학습 자료의 자막에서 온 문구
/// 2. 같은 문장이 구간마다 되풀이됨
/// 3. 프롬프트 문장을 그대로 읊음
/// 진짜 발표에서는 셋 다 나오지 않았다. 지어낸 구간은 빼지 않고 경고만 붙인다(사용자가 고친다).
enum TranscriptCheck {
    static let warningText = "말하지 않은 내용이 섞였을 수 있습니다.\n주변이 시끄러웠다면 전사문을 확인하거나 다시 녹음해 주세요."

    /// 자막 끝인사처럼 지어낼 때 자주 나오는 문구.
    static let knownPhrases = ["구독", "좋아요", "시청해", "시청 해", "시청해주", "다음 영상", "다음 시간에", "자막"]

    struct Review: Equatable {
        var text: String
        var warning: String?
    }

    static func review(_ segments: [String], prompt: String?) -> Review {
        let cleaned = segments.map(TranscriptText.clean).filter { !$0.isEmpty }
        // 바로 앞 구간과 똑같은 구간은 한 번만 남긴다.
        var kept: [String] = []
        var repeated = false
        for segment in cleaned {
            if let last = kept.last, TranscriptText.key(last) == TranscriptText.key(segment) {
                repeated = true
                continue
            }
            kept.append(segment)
        }
        // 떨어져 있어도 같은 문장(6글자 이상)이 두 번 넘게 나오면 되풀이로 본다.
        var counts: [String: Int] = [:]
        for segment in kept {
            let key = TranscriptText.key(segment)
            guard key.count >= 6 else { continue }
            counts[key, default: 0] += 1
        }
        if counts.values.contains(where: { $0 >= 2 }) { repeated = true }

        let text = TranscriptText.clean(kept.joined(separator: " "))
        let known = knownPhrases.contains { text.contains($0) }
        let echoed = echoesPrompt(kept, prompt: prompt)
        return Review(text: text, warning: repeated || known || echoed ? warningText : nil)
    }

    /// 어떤 구간이 프롬프트의 일부를 그대로 옮긴 것인지. 짧은 단계 이름은 실제로도 말하므로 12글자 이상만 본다.
    static func echoesPrompt(_ segments: [String], prompt: String?) -> Bool {
        guard let prompt, !prompt.isEmpty else { return false }
        let promptKey = TranscriptText.key(prompt)
        return segments.contains { segment in
            let key = TranscriptText.key(segment)
            return key.count >= 12 && promptKey.contains(key)
        }
    }
}
