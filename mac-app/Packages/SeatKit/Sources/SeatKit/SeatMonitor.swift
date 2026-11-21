import AVFoundation

/// 웹캠으로 자리에 사람이 있는지 계속 본다.
///
/// 영상은 저장·전송하지 않고 이 맥 안에서만 판정한다. 장면을 보고 바로 버리며, 사람 수만 남긴다.
///
/// `VoiceRecorder`와 같은 모양이다: `start()`, `stop()`, 읽기 전용 상태, `onChange`.
@MainActor
public final class SeatMonitor {
    /// 사람이 안 보여도 `absent`로 바꾸기 전에 기다리는 기본 시간(초).
    public static let defaultAbsentHoldSeconds: TimeInterval = 3
    /// 영상이 이만큼(초) 안 들어오면 `cameraOff`.
    public static let frameTimeoutSeconds: TimeInterval = 3
    /// 장면을 보는 간격(초). 초당 약 2.5번.
    public static let analysisInterval: TimeInterval = 0.4

    public private(set) var presence: SeatPresence = .unknown
    /// `presence`가 `cameraOff`일 때 화면에 쓸 한국어 한 줄. 그 밖에는 nil.
    public private(set) var offReason: String?
    /// 마지막으로 본 장면의 결과. 화면 확인용.
    public private(set) var lastDetection: SeatDetection?
    public private(set) var isRunning = false
    /// 상태가 바뀔 때 불린다.
    public var onChange: (@MainActor () -> Void)?

    /// 미리보기 화면(`SeatCameraPreview`)에 넘기는 카메라 세션.
    public var captureSession: AVCaptureSession { capture.session }

    private let capture: CameraCapture
    private var filter: SeatPresenceFilter
    private var failure: String?
    private var ticker: Task<Void, Never>?
    /// 멈춘 뒤 뒤늦게 도착한 결과를 걸러 내는 번호.
    private var generation = 0
    /// 켜는 중인지. 화면과 앱이 동시에 start()를 불러도 한 번만 켠다.
    private var starting = false

    /// - Parameter absentHoldSeconds: 사람이 안 보여도 이 시간(초) 동안은 `absent`로 바꾸지 않는다.
    public init(absentHoldSeconds: TimeInterval = SeatMonitor.defaultAbsentHoldSeconds) {
        capture = CameraCapture(interval: Self.analysisInterval)
        filter = SeatPresenceFilter(absentHold: absentHoldSeconds, frameTimeout: Self.frameTimeoutSeconds)
    }

    /// 카메라 권한을 확인하고, 아직 묻지 않았으면 요청한다.
    public static func permission() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .video)
        default: false
        }
    }

    /// 카메라를 켜고 판정을 시작한다. 켜지 못하면 `presence`가 `cameraOff`가 되고 `offReason`에 이유가 들어간다.
    public func start() async {
        guard !isRunning, !starting else { return }
        starting = true
        defer { starting = false }
        guard await Self.permission() else {
            fail(CameraFailure.denied.message)
            return
        }
        guard !isRunning else { return }

        generation += 1
        let current = generation
        do {
            try await capture.start { [weak self] event in
                DispatchQueue.main.async {
                    MainActor.assumeIsolated { self?.handle(event, generation: current) }
                }
            }
        } catch {
            fail(error.message)
            return
        }
        // 켜는 사이 stop()이 불렸으면 끈다.
        guard generation == current else {
            capture.stop()
            return
        }
        failure = nil
        isRunning = true
        filter.begin(at: Date())
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard let self, self.generation == current else { return }
                self.filter.tick(at: Date())
                self.publish()
            }
        }
        publish(force: true)
    }

    /// 카메라를 끈다. `presence`는 `cameraOff`가 된다.
    public func stop() {
        generation += 1
        ticker?.cancel()
        ticker = nil
        if isRunning { capture.stop() }
        isRunning = false
        lastDetection = nil
        failure = "카메라를 껐습니다."
        publish(force: true)
    }

    private func fail(_ message: String) {
        isRunning = false
        failure = message
        publish(force: true)
    }

    private func handle(_ event: CameraEvent, generation: Int) {
        guard generation == self.generation, isRunning else { return }
        switch event {
        case .detection(let detection):
            lastDetection = detection
            filter.frame(seen: detection.isSomeoneThere, at: Date())
            publish(force: true)
        case .failed(let failure):
            // 연결이 끊기면 다시 켜야 한다.
            self.generation += 1
            ticker?.cancel()
            ticker = nil
            capture.stop()
            fail(failure.message)
        }
    }

    private func publish(force: Bool = false) {
        let newPresence: SeatPresence
        let newReason: String?
        if let failure {
            newPresence = .cameraOff
            newReason = failure
        } else {
            newPresence = filter.presence
            newReason = filter.presence == .cameraOff ? CameraFailure.noFrames.message : nil
        }
        let changed = newPresence != presence || newReason != offReason
        presence = newPresence
        offReason = newReason
        if changed || force { onChange?() }
    }
}

// MARK: - 카메라

enum CameraEvent: Sendable {
    case detection(SeatDetection)
    case failed(CameraFailure)
}

enum CameraFailure: Error, Sendable {
    case denied
    case noDevice
    case cannotStart
    case disconnected
    case noFrames

    var message: String {
        switch self {
        case .denied: "카메라 권한이 없습니다. 시스템 설정 > 개인정보 보호 및 보안 > 카메라에서 허용해 주세요."
        case .noDevice: "카메라를 찾지 못했습니다. 카메라가 연결되어 있는지 확인해 주세요."
        case .cannotStart: "카메라를 켜지 못했습니다. 다른 앱이 카메라를 쓰고 있는지 확인해 주세요."
        case .disconnected: "카메라 연결이 끊겼습니다. 다시 연결한 뒤 카메라를 켜 주세요."
        case .noFrames: "카메라 영상이 들어오지 않습니다. 렌즈 가리개나 연결을 확인해 주세요."
        }
    }
}

private extension Error {
    var message: String {
        (self as? CameraFailure ?? .cannotStart).message
    }
}

/// 카메라 세션과 장면 분석. 영상은 카메라 전용 큐로 들어오므로 메인 액터 밖에 두고 잠금으로 지킨다.
final class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, @unchecked Sendable {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "AIBossOffice.SeatKit.session")
    private let frameQueue = DispatchQueue(label: "AIBossOffice.SeatKit.frames", qos: .utility)
    private let detector = PersonDetector()
    private let interval: TimeInterval

    private let lock = NSLock()
    private var send: (@Sendable (CameraEvent) -> Void)?
    private var lastAnalysis = Date.distantPast
    private var configured = false
    private var observers: [NSObjectProtocol] = []

    init(interval: TimeInterval) {
        self.interval = interval
    }

    func start(_ send: @escaping @Sendable (CameraEvent) -> Void) async throws(CameraFailure) {
        let result: CameraFailure? = await withCheckedContinuation { continuation in
            sessionQueue.async { [self] in
                continuation.resume(returning: startOnQueue(send))
            }
        }
        if let result { throw result }
    }

    func stop() {
        lock.withLock { send = nil }
        let observers = self.observers
        self.observers = []
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        sessionQueue.async { [self] in
            if session.isRunning { session.stopRunning() }
        }
    }

    private func startOnQueue(_ send: @escaping @Sendable (CameraEvent) -> Void) -> CameraFailure? {
        if !configured {
            guard let device = Self.pickCamera() else { return .noDevice }
            guard let input = try? AVCaptureDeviceInput(device: device), session.canAddInput(input) else {
                return .cannotStart
            }
            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.setSampleBufferDelegate(self, queue: frameQueue)
            guard session.canAddOutput(output) else { return .cannotStart }
            session.beginConfiguration()
            if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
            session.addInput(input)
            session.addOutput(output)
            session.commitConfiguration()
            configured = true

            observers.append(NotificationCenter.default.addObserver(
                forName: AVCaptureDevice.wasDisconnectedNotification, object: device, queue: nil) { [weak self] _ in
                    self?.report(.failed(.disconnected))
                })
            observers.append(NotificationCenter.default.addObserver(
                forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: nil) { [weak self] _ in
                    self?.report(.failed(.cannotStart))
                })
        }
        lock.withLock {
            self.send = send
            lastAnalysis = .distantPast
        }
        session.startRunning()
        guard session.isRunning else {
            lock.withLock { self.send = nil }
            return .cannotStart
        }
        return nil
    }

    /// 맥 내장 카메라를 먼저 쓰고, 없으면 연결된 카메라를 쓴다.
    private static func pickCamera() -> AVCaptureDevice? {
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
            mediaType: .video, position: .unspecified)
        let devices = discovery.devices.filter(\.isConnected)
        return devices.first { $0.deviceType == .builtInWideAngleCamera }
            ?? devices.first { $0.deviceType == .external }
            ?? devices.first
    }

    private func report(_ event: CameraEvent) {
        let send = lock.withLock { self.send }
        send?(event)
    }

    /// 카메라 큐에서 불린다. 간격이 안 찼으면 장면을 그냥 버린다.
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = Date()
        let due = lock.withLock { () -> Bool in
            guard send != nil, now.timeIntervalSince(lastAnalysis) >= interval else { return false }
            lastAnalysis = now
            return true
        }
        guard due, let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        report(.detection(detector.detect(pixels)))
    }
}
