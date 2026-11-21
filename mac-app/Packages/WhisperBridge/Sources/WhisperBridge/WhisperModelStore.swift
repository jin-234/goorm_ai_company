import Foundation

/// 모델 파일 보관.
///
/// `~/Library/Application Support/AIBossOffice/models/` 한 곳만 쓴다.
/// 프로젝트 폴더는 iCloud로 올라가므로 그 안에는 모델을 두지 않는다.
public enum WhisperModelStore {

    /// 모델을 두는 폴더.
    public static var directory: URL { ModelFolder.standard.url }

    /// 이 모델 파일이 놓이는 위치. 파일이 없어도 위치는 돌려준다.
    public static func url(for model: WhisperModel) -> URL {
        ModelFolder.standard.url(for: model.file)
    }

    /// 모델 파일이 온전히 놓여 있는지.
    public static func isInstalled(_ model: WhisperModel) -> Bool {
        ModelFolder.standard.isInstalled(model.file)
    }

    /// 말소리 구간 감지 모델(약 0.9MB)이 있는지. 없어도 전사는 되지만 잡음에서 없는 말을 지어내기 쉽다.
    public static var isSpeechDetectorInstalled: Bool {
        ModelFolder.standard.isInstalled(.speechDetector)
    }

    /// 말소리 구간 감지 모델을 내려받는다. Whisper 모델을 받을 때 함께 받으면 된다.
    @discardableResult
    public static func downloadSpeechDetector() async throws -> URL {
        try await ModelDownloader.download(.speechDetector, into: .standard,
                                           minimumBytes: ModelFolder.minimumBytes(for: .speechDetector)) { _ in }
    }

    /// 모델을 내려받아 모델 폴더에 놓는다.
    /// - Parameter progress: 0~1 진행률. 화면을 고치려면 메인 액터로 옮겨서 쓴다.
    /// - Throws: `WhisperDownloadError`, 취소하면 `CancellationError`.
    @discardableResult
    public static func download(_ model: WhisperModel,
                                progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        try await ModelDownloader.download(model.file, into: .standard,
                                           minimumBytes: ModelFolder.minimumBytes(for: model.file),
                                           progress: progress)
    }
}

/// 모델을 내려받지 못한 이유.
public enum WhisperDownloadError: Error, LocalizedError, Equatable {
    /// 인터넷에 연결되지 않았거나 받는 중에 끊김.
    case offline
    /// 서버가 파일을 주지 않음.
    case server(status: Int)
    /// 받은 파일이 모델이 아니거나 덜 받음.
    case damaged
    /// 모델 폴더에 저장하지 못함.
    case cannotSave

    public var errorDescription: String? {
        switch self {
        case .offline:
            "모델을 내려받지 못했습니다.\n네트워크 연결을 확인한 뒤 다시 시도해 주세요."
        case .server(let status):
            "모델을 내려받지 못했습니다.\n잠시 뒤 다시 시도해 주세요. (상태 코드 \(status))"
        case .damaged:
            "받은 모델 파일이 온전하지 않습니다.\n다시 내려받아 주세요."
        case .cannotSave:
            "모델 파일을 저장하지 못했습니다.\n저장 공간을 확인한 뒤 다시 시도해 주세요."
        }
    }
}

// MARK: - 폴더

struct ModelFolder: Sendable {
    var url: URL

    static let standard: ModelFolder = {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
                .appendingPathComponent("Library/Application Support", isDirectory: true)
        return ModelFolder(url: support.appendingPathComponent("AIBossOffice/models", isDirectory: true))
    }()

    func url(for file: ModelFile) -> URL {
        url.appendingPathComponent(file.fileName, isDirectory: false)
    }

    func isInstalled(_ file: ModelFile) -> Bool {
        Self.looksLikeModel(url(for: file), minimumBytes: Self.minimumBytes(for: file))
    }

    /// 배포 파일 크기의 90%보다 작으면 덜 받은 파일로 본다.
    static func minimumBytes(for file: ModelFile) -> Int64 {
        file.expectedBytes / 10 * 9
    }

    /// ggml 모델 파일인지. 앞 4바이트가 "lmgg"이고 크기가 충분한지 본다.
    static func looksLikeModel(_ file: URL, minimumBytes: Int64) -> Bool {
        let resolved = file.resolvingSymlinksInPath()
        guard let size = (try? FileManager.default.attributesOfItem(atPath: resolved.path))?[.size] as? NSNumber,
              size.int64Value >= max(minimumBytes, 4),
              let handle = try? FileHandle(forReadingFrom: resolved) else { return false }
        defer { try? handle.close() }
        let magic = (try? handle.read(upToCount: 4)) ?? Data()
        return magic == Data([0x6C, 0x6D, 0x67, 0x67])
    }
}

// MARK: - 내려받기

enum ModelDownloader {

    /// `source`에서 받아 `folder`에 놓는다. 다 받아 확인하기 전까지는 `.part` 이름으로 둔다.
    static func download(_ file: ModelFile, from source: URL? = nil, into folder: ModelFolder,
                         minimumBytes: Int64,
                         progress: @escaping @Sendable (Double) -> Void) async throws -> URL {
        let source = source ?? file.remoteURL
        let destination = folder.url(for: file)
        let partial = destination.appendingPathExtension("part")
        do {
            try FileManager.default.createDirectory(at: folder.url, withIntermediateDirectories: true)
        } catch {
            throw WhisperDownloadError.cannotSave
        }

        let receiver = DownloadReceiver(partial: partial, expectedBytes: file.expectedBytes, progress: progress)
        let session = URLSession(configuration: .ephemeral, delegate: receiver, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let task = session.downloadTask(with: source)

        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                receiver.begin(continuation)
                task.resume()
            }
        } onCancel: {
            task.cancel()
        }

        guard ModelFolder.looksLikeModel(partial, minimumBytes: minimumBytes) else {
            try? FileManager.default.removeItem(at: partial)
            throw WhisperDownloadError.damaged
        }
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: partial, to: destination)
        } catch {
            try? FileManager.default.removeItem(at: partial)
            throw WhisperDownloadError.cannotSave
        }
        progress(1)
        return destination
    }
}

private final class DownloadReceiver: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Void, Error>?
    private var failure: WhisperDownloadError?
    private var lastReported = -1.0

    private let partial: URL
    private let expectedBytes: Int64
    private let progress: @Sendable (Double) -> Void

    init(partial: URL, expectedBytes: Int64, progress: @escaping @Sendable (Double) -> Void) {
        self.partial = partial
        self.expectedBytes = expectedBytes
        self.progress = progress
    }

    func begin(_ continuation: CheckedContinuation<Void, Error>) {
        lock.withLock { self.continuation = continuation }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : expectedBytes
        guard total > 0 else { return }
        // 확인을 마치기 전에는 100%로 보이지 않게 한다.
        let fraction = min(0.99, max(0, Double(totalBytesWritten) / Double(total)))
        let changed = lock.withLock { () -> Bool in
            guard fraction - lastReported >= 0.005 else { return false }
            lastReported = fraction
            return true
        }
        if changed { progress(fraction) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        if let http = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            lock.withLock { failure = .server(status: http.statusCode) }
            return
        }
        // 이 함수가 끝나면 임시 파일이 지워지므로 여기서 바로 옮긴다.
        do {
            let files = FileManager.default
            if files.fileExists(atPath: partial.path) { try files.removeItem(at: partial) }
            try files.moveItem(at: location, to: partial)
        } catch {
            lock.withLock { failure = .cannotSave }
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let (continuation, failure) = lock.withLock {
            let pair = (self.continuation, self.failure)
            self.continuation = nil
            return pair
        }
        guard let continuation else { return }
        if let error {
            let cancelled = (error as? URLError)?.code == .cancelled || error is CancellationError
            continuation.resume(throwing: cancelled ? CancellationError() : WhisperDownloadError.offline)
        } else if let failure {
            continuation.resume(throwing: failure)
        } else {
            continuation.resume()
        }
    }
}
