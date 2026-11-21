import Foundation
import Synchronization
import WhisperBridge

/// 터미널에서 Whisper 전사를 확인한다.
///
///     swift run --scratch-path ~/Library/Caches/AIBossOffice/WhisperBridge whisper-check
///
/// 인자가 없으면 기획서의 아침 PT 예시를 합성 음성으로 만들어 설치된 모델로 전사한다.
@main
struct WhisperCheck {

    /// 기획서의 아침 PT 발표 양식 예시.
    static let samplePT = """
        3단계 필수 업무는 지원서 최종 검토입니다. 오후 3시까지 오탈자를 확인하고 제출본을 저장하겠습니다. \
        2단계 당일 업무는 포트폴리오 한 문단 초안입니다. 오후 5시까지 문단을 쓰겠습니다. \
        1단계 이월 가능 업무는 관심 기업 세 곳 저장입니다. 퇴근 전까지 링크를 모으겠습니다.
        """

    static let usage = """
        사용법: whisper-check [옵션] [소리 파일 ...]

          (인자 없음)          기획서의 아침 PT 예시를 합성 음성으로 만들어 전사
          소리 파일             wav, aiff, m4a 등을 전사
          --say "문장"          이 문장을 합성 음성으로 만들어 전사
          --voice 이름          합성 목소리 (기본 Yuna)
          --mic 초              마이크로 그 시간만큼 녹음해 전사
          --model small|base|all  쓸 모델 (기본 all: 설치된 모델 모두)
          --prompt "글"         자주 나오는 낱말을 미리 알려 주는 글 (기본: 아침 PT 프롬프트)
          --no-prompt           프롬프트 없이 전사
          --repeat 횟수         같은 입력을 여러 번 전사 (두 번째부터는 모델을 읽어 둔 상태)
          --download            없는 모델을 내려받음
          --help                이 안내
        """

    struct Options {
        var files: [String] = []
        var say: String?
        var voice = "Yuna"
        var micSeconds: Double?
        var models: [WhisperModel] = WhisperModel.allCases
        var prompt: String? = WhisperTranscriber.morningPTPrompt
        var repeatCount = 1
        var download = false
    }

    struct Input {
        var label: String
        var samples: [Float]
    }

    static func main() async {
        let options: Options
        do {
            options = try parse(Array(CommandLine.arguments.dropFirst()))
        } catch let problem as ArgumentProblem {
            print(problem.message)
            print(usage)
            exit(2)
        } catch {
            exit(2)
        }

        print("모델 폴더: \(WhisperModelStore.directory.path)")
        var models: [WhisperModel] = []
        for model in options.models {
            if WhisperModelStore.isInstalled(model) {
                models.append(model)
            } else if options.download {
                if await download(model) { models.append(model) }
            } else {
                print("[\(model.rawValue)] 모델이 없습니다. --download 를 붙이거나 scripts/download-whisper-model.sh \(model.rawValue) 로 내려받아 주세요. (약 \(model.megabytes)MB)")
            }
        }
        guard !models.isEmpty else { exit(1) }
        if !WhisperModelStore.isSpeechDetectorInstalled, options.download {
            print("말소리 구간 감지 모델 내려받는 중 (약 0.9MB)")
            do { try await WhisperModelStore.downloadSpeechDetector() } catch {
                print("말소리 구간 감지 모델을 받지 못했습니다: \(error.localizedDescription.replacingOccurrences(of: "\n", with: " "))")
            }
        }
        print(WhisperModelStore.isSpeechDetectorInstalled
              ? "말소리 구간 감지: 켬"
              : "말소리 구간 감지: 모델 없음 (잡음에서 없는 말을 지어내기 쉽습니다. --download 로 받기)")

        var inputs: [Input] = []
        do {
            for path in options.files {
                let samples = try AudioSamples.load(URL(fileURLWithPath: path))
                inputs.append(Input(label: "파일 \(URL(fileURLWithPath: path).lastPathComponent)", samples: samples))
            }
            if let seconds = options.micSeconds {
                inputs.append(Input(label: "마이크 녹음", samples: try await record(seconds: seconds)))
            }
            if let text = options.say {
                inputs.append(Input(label: "합성 음성(\(options.voice))", samples: try synthesize(text, voice: options.voice)))
            }
            if inputs.isEmpty {
                print("기획서의 아침 PT 예시를 합성 음성으로 만듭니다.")
                print("원문: \(samplePT)")
                inputs.append(Input(label: "합성 음성(\(options.voice))", samples: try synthesize(samplePT, voice: options.voice)))
            }
        } catch {
            print("입력을 준비하지 못했습니다: \(error.localizedDescription)")
            exit(1)
        }

        let transcriber = WhisperTranscriber()
        var failed = false
        for input in inputs {
            print("")
            print("입력: \(input.label) · \(format(AudioSamples.seconds(input.samples)))초")
            for model in models {
                for round in 1...options.repeatCount {
                    do {
                        let result = try await transcriber.transcribe(samples: input.samples, model: model,
                                                                      prompt: options.prompt)
                        let ratio = result.audioSeconds > 0 ? result.elapsedSeconds / result.audioSeconds : 0
                        let load = result.loadSeconds > 0 ? " (모델 읽기 \(format(result.loadSeconds))초 포함)" : ""
                        let roundLabel = options.repeatCount > 1 ? " \(round)회차" : ""
                        print("[\(model.rawValue)]\(roundLabel) 걸린 시간 \(format(result.elapsedSeconds))초\(load) · 녹음 길이의 \(format(ratio))배")
                        print("  \(result.text)")
                        if let warning = result.warning {
                            print("  ⚠︎ \(warning.replacingOccurrences(of: "\n", with: " "))")
                        }
                    } catch {
                        failed = true
                        print("[\(model.rawValue)] 실패: \(error.localizedDescription.replacingOccurrences(of: "\n", with: " "))")
                    }
                }
            }
        }
        exit(failed ? 1 : 0)
    }

    // MARK: - 입력 만들기

    /// `say`로 합성 음성을 만들어 읽는다. 임시 파일은 읽은 뒤 지운다.
    static func synthesize(_ text: String, voice: String) throws -> [Float] {
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("whisper-check-\(UUID().uuidString).aiff")
        defer { try? FileManager.default.removeItem(at: file) }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/say")
        process.arguments = ["-v", voice, "-o", file.path, text]
        try process.run()
        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            throw ArgumentProblem(message: "합성 음성을 만들지 못했습니다. 목소리 이름을 확인해 주세요: \(voice)")
        }
        return try AudioSamples.load(file)
    }

    /// 마이크로 녹음한다. 터미널 프로그램에 마이크 권한이 있어야 한다.
    @MainActor
    static func record(seconds: Double) async throws -> [Float] {
        let recorder = VoiceRecorder()
        await recorder.start()
        switch recorder.state {
        case .recording:
            break
        case .denied:
            throw ArgumentProblem(message: "마이크 권한이 없습니다. 시스템 설정 > 개인정보 보호 및 보안 > 마이크에서 이 터미널 프로그램을 허용해 주세요.")
        case .failed(let message):
            throw ArgumentProblem(message: message.replacingOccurrences(of: "\n", with: " "))
        case .idle:
            throw ArgumentProblem(message: "녹음을 시작하지 못했습니다.")
        }
        print("녹음 중입니다. \(format(seconds))초 동안 말해 주세요.")
        var peak: Float = 0
        recorder.onChange = { peak = max(peak, recorder.level) }
        try await Task.sleep(for: .seconds(seconds))
        if case .failed(let message) = recorder.state {
            print("녹음이 도중에 멈췄습니다: \(message.replacingOccurrences(of: "\n", with: " "))")
        }
        let samples = recorder.stop()
        print("녹음 끝 · \(format(AudioSamples.seconds(samples)))초 · 가장 컸던 입력 크기 \(format(Double(peak)))")
        return samples
    }

    static func download(_ model: WhisperModel) async -> Bool {
        print("[\(model.rawValue)] 내려받는 중 (약 \(model.megabytes)MB)")
        do {
            let reporter = ProgressPrinter()
            try await WhisperModelStore.download(model) { fraction in reporter.report(fraction) }
            print("[\(model.rawValue)] 내려받기 완료")
            return true
        } catch {
            print("[\(model.rawValue)] 내려받기 실패: \(error.localizedDescription.replacingOccurrences(of: "\n", with: " "))")
            return false
        }
    }

    // MARK: - 인자 읽기

    struct ArgumentProblem: Error, LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    static func parse(_ arguments: [String]) throws -> Options {
        var options = Options()
        var index = 0

        func value(after name: String) throws -> String {
            index += 1
            guard index < arguments.count else { throw ArgumentProblem(message: "\(name) 뒤에 값이 필요합니다.") }
            return arguments[index]
        }

        while index < arguments.count {
            let argument = arguments[index]
            switch argument {
            case "--help", "-h":
                print(usage)
                exit(0)
            case "--say":
                options.say = try value(after: argument)
            case "--voice":
                options.voice = try value(after: argument)
            case "--prompt":
                options.prompt = try value(after: argument)
            case "--no-prompt":
                options.prompt = nil
            case "--download":
                options.download = true
            case "--mic":
                guard let seconds = Double(try value(after: argument)), seconds > 0, seconds <= 600 else {
                    throw ArgumentProblem(message: "--mic 뒤에는 녹음할 시간(초)을 적어 주세요.")
                }
                options.micSeconds = seconds
            case "--repeat":
                guard let count = Int(try value(after: argument)), (1...20).contains(count) else {
                    throw ArgumentProblem(message: "--repeat 뒤에는 1~20 사이 횟수를 적어 주세요.")
                }
                options.repeatCount = count
            case "--model":
                let name = try value(after: argument)
                if name == "all" {
                    options.models = WhisperModel.allCases
                } else if let model = WhisperModel(rawValue: name) {
                    options.models = [model]
                } else {
                    throw ArgumentProblem(message: "모델은 small, base, all 가운데 하나입니다: \(name)")
                }
            default:
                guard !argument.hasPrefix("--") else {
                    throw ArgumentProblem(message: "모르는 옵션입니다: \(argument)")
                }
                options.files.append(argument)
            }
            index += 1
        }
        return options
    }

    static func format(_ value: Double) -> String {
        String(format: "%.2f", value)
    }
}

/// 내려받기 진행률을 10% 단위로 찍는다.
final class ProgressPrinter: Sendable {
    private let lastStep = Mutex(-1)

    func report(_ fraction: Double) {
        let step = Int(fraction * 10)
        let shouldPrint = lastStep.withLock { last -> Bool in
            guard step > last else { return false }
            last = step
            return true
        }
        if shouldPrint { print("  \(step * 10)%") }
    }
}
