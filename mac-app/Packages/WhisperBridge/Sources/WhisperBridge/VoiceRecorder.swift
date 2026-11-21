import AVFoundation

/// 마이크 녹음.
///
/// 녹음은 16kHz 모노 Float32로 메모리에만 모으고 파일로 저장하지 않는다.
/// `stop()`으로 받은 배열을 전사에 넘기고 버리면 원음은 어디에도 남지 않는다.
@MainActor
public final class VoiceRecorder {
    public enum State: Equatable, Sendable {
        case idle
        case recording
        /// 마이크 권한이 없음.
        case denied
        /// 마이크를 쓸 수 없거나 녹음이 도중에 멈춤. 화면에 보일 안내가 들어 있다.
        /// 도중에 멈춘 경우 `stop()`으로 그때까지의 녹음을 받을 수 있다.
        case failed(String)
    }

    public private(set) var state: State = .idle
    /// 0~1 입력 크기. 화면 막대용.
    public private(set) var level: Float = 0
    /// 녹음한 시간(초).
    public private(set) var elapsed: TimeInterval = 0
    /// 상태나 입력 크기가 바뀔 때 불린다.
    public var onChange: (@MainActor () -> Void)?

    /// 한 번에 녹음할 수 있는 가장 긴 시간(초).
    public static let maximumSeconds: TimeInterval = 600

    private var capture: MicCapture?
    /// 멈춘 녹음에서 뒤늦게 도착한 알림을 걸러 내는 번호.
    private var generation = 0

    public init() {}

    /// 마이크 권한을 확인하고, 아직 묻지 않았으면 요청한다.
    public static func permission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .audio)
        default: false
        }
    }

    /// 녹음을 시작한다. 권한이 없으면 `state`가 `.denied`가 된다.
    public func start() async {
        guard state != .recording else { return }
        guard await Self.permission() else {
            state = .denied
            level = 0
            onChange?()
            return
        }
        // 권한을 기다리는 사이 다른 호출이 먼저 시작했을 수 있다.
        guard state != .recording else { return }

        generation += 1
        let current = generation
        let capture = MicCapture(limit: Int(Self.maximumSeconds) * AudioSamples.sampleRate)
        do {
            try capture.start { [weak self] event in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self?.handle(event, generation: current) }
                }
            }
        } catch {
            state = .failed(error.message)
            level = 0
            onChange?()
            return
        }
        self.capture = capture
        elapsed = 0
        level = 0
        state = .recording
        onChange?()
    }

    /// 녹음을 끝내고 16kHz 모노 Float32 녹음을 돌려준다. 녹음 중이 아니었으면 빈 배열.
    @discardableResult
    public func stop() -> [Float] {
        guard let capture else { return [] }
        self.capture = nil
        generation += 1
        let samples = capture.stop()
        elapsed = AudioSamples.seconds(samples)
        level = 0
        state = .idle
        onChange?()
        return samples
    }

    /// 녹음을 버리고 처음 상태로 돌아간다.
    public func cancel() {
        generation += 1
        if let capture {
            self.capture = nil
            _ = capture.stop()
        }
        guard state != .idle || elapsed != 0 || level != 0 else { return }
        elapsed = 0
        level = 0
        state = .idle
        onChange?()
    }

    private func handle(_ event: MicEvent, generation: Int) {
        guard generation == self.generation, capture != nil, state == .recording else { return }
        switch event {
        case .level(let value, let seconds):
            // 올라갈 때는 바로, 내려갈 때는 천천히 움직여 막대가 떨리지 않게 한다.
            level = value >= level ? value : max(value, level * 0.82)
            elapsed = seconds
        case .stopped(let message):
            state = .failed(message)
            level = 0
        }
        onChange?()
    }
}

// MARK: - 마이크에서 받기

enum MicEvent: Sendable {
    case level(Float, seconds: Double)
    /// 녹음이 도중에 멈춤. 화면에 보일 안내.
    case stopped(String)
}

enum MicFailure: Error {
    case noInput
    case cannotStart

    var message: String {
        switch self {
        case .noInput:
            "마이크를 찾지 못했습니다.\n마이크가 연결되어 있는지 확인해 주세요."
        case .cannotStart:
            "마이크를 시작하지 못했습니다.\n다른 앱이 마이크를 쓰고 있는지 확인해 주세요."
        }
    }
}

/// 마이크 소리를 16kHz 모노로 모은다.
/// 소리는 오디오 스레드로 들어오므로 메인 액터 밖에 두고 잠금으로 지킨다.
final class MicCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let limit: Int
    private var observer: NSObjectProtocol?

    private let lock = NSLock()
    private var samples: [Float] = []
    private var resampler: MonoResampler?
    private var sourceRate = 0.0
    private var running = false
    private var send: (@Sendable (MicEvent) -> Void)?

    /// - Parameter limit: 모을 수 있는 가장 긴 길이(16kHz 표본 수).
    init(limit: Int) {
        self.limit = limit
    }

    deinit {
        teardown()
    }

    func start(_ send: @escaping @Sendable (MicEvent) -> Void) throws(MicFailure) {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw .noInput }

        lock.withLock {
            self.send = send
            samples.removeAll()
            samples.reserveCapacity(min(limit, 60 * AudioSamples.sampleRate))
            running = true
        }

        // 형식을 지정하지 않으면 마이크가 주는 형식 그대로 받는다. 16kHz 변환은 직접 한다.
        input.installTap(onBus: 0, bufferSize: 4_096, format: nil) { [weak self] buffer, _ in
            self?.receive(buffer)
        }
        observer = NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange,
                                                          object: engine, queue: nil) { [weak self] _ in
            self?.halt("마이크 연결이 바뀌어 녹음을 멈췄습니다.\n여기까지 녹음한 내용으로 전사할 수 있습니다.")
        }
        engine.prepare()
        do {
            try engine.start()
        } catch {
            lock.withLock { running = false }
            teardown()
            throw .cannotStart
        }
    }

    /// 녹음을 끝내고 모은 소리를 돌려준다.
    func stop() -> [Float] {
        teardown()
        return lock.withLock {
            running = false
            send = nil
            if let resampler { append(resampler.finish()) }
            resampler = nil
            let result = samples
            samples = []
            return result
        }
    }

    private func teardown() {
        if let observer {
            NotificationCenter.default.removeObserver(observer)
            self.observer = nil
        }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    /// 오디오 스레드에서 불린다.
    private func receive(_ buffer: AVAudioPCMBuffer) {
        let mono = Downmix.mono(buffer)
        guard !mono.isEmpty else { return }
        let rate = buffer.format.sampleRate

        let (event, send) = lock.withLock { () -> (MicEvent?, (@Sendable (MicEvent) -> Void)?) in
            guard running else { return (nil, nil) }
            if resampler == nil || sourceRate != rate {
                resampler = MonoResampler(sourceRate: rate)
                sourceRate = rate
            }
            guard let resampler else { return (nil, nil) }
            append(resampler.convert(mono))
            if samples.count >= limit {
                running = false
                let minutes = limit / AudioSamples.sampleRate / 60
                return (.stopped("녹음은 \(minutes)분까지 할 수 있어 여기서 멈췄습니다.\n여기까지 녹음한 내용으로 전사할 수 있습니다."), self.send)
            }
            return (.level(SpeechEnergy.level(mono), seconds: AudioSamples.seconds(samples)), self.send)
        }
        if let event { send?(event) }
    }

    /// 잠금 안에서 부른다.
    private func append(_ converted: [Float]) {
        let room = limit - samples.count
        guard room > 0 else { return }
        samples.append(contentsOf: converted.prefix(room))
    }

    private func halt(_ message: String) {
        let send = lock.withLock { () -> (@Sendable (MicEvent) -> Void)? in
            guard running else { return nil }
            running = false
            return self.send
        }
        send?(.stopped(message))
    }
}
