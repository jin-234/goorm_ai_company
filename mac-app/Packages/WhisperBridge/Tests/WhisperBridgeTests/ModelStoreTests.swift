import Foundation
import Testing
@testable import WhisperBridge

/// 시험마다 따로 쓰는 임시 폴더. 끝나면 지운다.
final class TemporaryFolder {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory
            .appendingPathComponent("WhisperBridgeTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    deinit {
        try? FileManager.default.removeItem(at: url)
    }
}

/// ggml 모델처럼 보이는 가짜 파일 내용.
func fakeModelData(bytes: Int) -> Data {
    var data = Data([0x6C, 0x6D, 0x67, 0x67])
    data.append(Data(repeating: 0x5A, count: max(0, bytes - 4)))
    return data
}

/// 진행률 콜백이 준 값을 모은다.
final class ProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [Double] = []

    func add(_ value: Double) {
        lock.withLock { stored.append(value) }
    }

    var values: [Double] {
        lock.withLock { stored }
    }
}

@Suite("모델 파일")
struct ModelStoreTests {

    @Test("모델 이름과 주소")
    func modelNames() {
        #expect(WhisperModel.allCases == [.small, .base])
        #expect(WhisperModel.small.fileName == "ggml-small.bin")
        #expect(WhisperModel.base.fileName == "ggml-base.bin")
        #expect(WhisperModel.small.remoteURL.absoluteString
                == "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin")
        #expect(WhisperModel.base.remoteURL.absoluteString
                == "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin")
        #expect(WhisperModel.small.megabytes == 488)
        #expect(WhisperModel.base.megabytes == 148)
    }

    @Test("모델 폴더는 Application Support/AIBossOffice/models")
    func standardFolder() {
        let path = WhisperModelStore.directory.path
        #expect(path.hasSuffix("/Library/Application Support/AIBossOffice/models"))
        #expect(WhisperModelStore.url(for: .small).lastPathComponent == "ggml-small.bin")
        #expect(WhisperModelStore.url(for: .small).deletingLastPathComponent().path == path)
    }

    @Test("파일이 없거나, 덜 받았거나, 모델이 아니면 설치된 것으로 보지 않는다")
    func looksLikeModel() throws {
        let folder = try TemporaryFolder()
        let missing = folder.url.appendingPathComponent("missing.bin")
        #expect(!ModelFolder.looksLikeModel(missing, minimumBytes: 100))

        let short = folder.url.appendingPathComponent("short.bin")
        try fakeModelData(bytes: 50).write(to: short)
        #expect(!ModelFolder.looksLikeModel(short, minimumBytes: 100))

        let wrong = folder.url.appendingPathComponent("wrong.bin")
        try Data(repeating: 0x41, count: 200).write(to: wrong)
        #expect(!ModelFolder.looksLikeModel(wrong, minimumBytes: 100))

        let good = folder.url.appendingPathComponent("good.bin")
        try fakeModelData(bytes: 200).write(to: good)
        #expect(ModelFolder.looksLikeModel(good, minimumBytes: 100))

        let empty = folder.url.appendingPathComponent("empty.bin")
        try Data().write(to: empty)
        #expect(!ModelFolder.looksLikeModel(empty, minimumBytes: 0))
    }

    @Test("크기가 한참 모자란 파일은 진짜 모델 자리에 있어도 설치로 보지 않는다")
    func tooSmallIsNotInstalled() throws {
        let folder = try TemporaryFolder()
        let models = ModelFolder(url: folder.url)
        #expect(!models.isInstalled(.whisperBase))
        try fakeModelData(bytes: 4_096).write(to: models.url(for: .whisperBase))
        #expect(!models.isInstalled(.whisperBase))
    }

    @Test("내려받으면 모델 폴더에 놓이고 진행률이 1로 끝난다")
    func downloadPlacesFile() async throws {
        let folder = try TemporaryFolder()
        let source = folder.url.appendingPathComponent("source.bin")
        try fakeModelData(bytes: 300_000).write(to: source)
        let models = ModelFolder(url: folder.url.appendingPathComponent("models", isDirectory: true))
        let log = ProgressLog()

        let placed = try await ModelDownloader.download(.whisperBase, from: source, into: models,
                                                        minimumBytes: 1_000) { log.add($0) }

        #expect(placed == models.url(for: .whisperBase))
        #expect(try Data(contentsOf: placed).count == 300_000)
        #expect(log.values.last == 1)
        #expect(log.values == log.values.sorted())
        #expect(!FileManager.default.fileExists(atPath: placed.appendingPathExtension("part").path))
    }

    @Test("받은 파일이 모델이 아니면 남기지 않고 오류를 낸다")
    func downloadRejectsDamagedFile() async throws {
        let folder = try TemporaryFolder()
        let source = folder.url.appendingPathComponent("source.bin")
        try Data(repeating: 0x3C, count: 5_000).write(to: source)
        let models = ModelFolder(url: folder.url.appendingPathComponent("models", isDirectory: true))

        await #expect(throws: WhisperDownloadError.damaged) {
            try await ModelDownloader.download(.whisperBase, from: source, into: models, minimumBytes: 1_000) { _ in }
        }
        #expect(!FileManager.default.fileExists(atPath: models.url(for: .whisperBase).path))
        #expect(!FileManager.default.fileExists(atPath: models.url(for: .whisperBase).appendingPathExtension("part").path))
    }

    @Test("덜 받은 파일은 이미 있던 모델을 덮어쓰지 않는다")
    func downloadKeepsExistingOnFailure() async throws {
        let folder = try TemporaryFolder()
        let models = ModelFolder(url: folder.url.appendingPathComponent("models", isDirectory: true))
        try FileManager.default.createDirectory(at: models.url, withIntermediateDirectories: true)
        let existing = fakeModelData(bytes: 9_000)
        try existing.write(to: models.url(for: .whisperBase))

        let source = folder.url.appendingPathComponent("source.bin")
        try fakeModelData(bytes: 500).write(to: source)

        await #expect(throws: WhisperDownloadError.damaged) {
            try await ModelDownloader.download(.whisperBase, from: source, into: models, minimumBytes: 1_000) { _ in }
        }
        #expect(try Data(contentsOf: models.url(for: .whisperBase)) == existing)
    }

    @Test("받을 곳이 없으면 연결 오류로 알린다")
    func downloadMissingSource() async throws {
        let folder = try TemporaryFolder()
        let models = ModelFolder(url: folder.url.appendingPathComponent("models", isDirectory: true))
        let source = folder.url.appendingPathComponent("no-such-file.bin")

        await #expect(throws: WhisperDownloadError.offline) {
            try await ModelDownloader.download(.whisperBase, from: source, into: models, minimumBytes: 1_000) { _ in }
        }
    }

    @Test("오류 안내는 한국어이고 의미 단위로 줄을 나눈다")
    func errorMessages() {
        let cases: [any LocalizedError] = [
            WhisperDownloadError.offline, WhisperDownloadError.server(status: 503),
            WhisperDownloadError.damaged, WhisperDownloadError.cannotSave,
            WhisperError.modelMissing(.small), WhisperError.loadFailed,
            WhisperError.emptyAudio, WhisperError.transcribeFailed(-7),
        ]
        for problem in cases {
            let message = problem.errorDescription ?? ""
            #expect(message.contains("\n"))
            #expect(message.unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) })
        }
        #expect(WhisperError.modelMissing(.small).errorDescription?.contains("488MB") == true)
        #expect(WhisperError.transcribeFailed(-7).errorDescription?.contains("-7") == true)
        #expect(WhisperDownloadError.server(status: 503).errorDescription?.contains("503") == true)
    }
}
