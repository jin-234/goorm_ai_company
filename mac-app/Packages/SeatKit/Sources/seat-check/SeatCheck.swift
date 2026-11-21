import Foundation
import ImageIO
import SeatKit

/// 터미널에서 착석 판정을 확인한다.
///
///     swift run --scratch-path ~/Library/Caches/AIBossOffice/SeatKit seat-check            카메라로 20초
///     swift run --scratch-path ~/Library/Caches/AIBossOffice/SeatKit seat-check 사진.jpg   사진 한 장 판정
///
/// 카메라를 쓰려면 이 터미널 프로그램에 카메라 권한이 있어야 한다.
@main
struct SeatCheck {
    static let usage = """
        사용법: seat-check [--seconds 초] [사진 파일 ...]

          (인자 없음)       카메라로 20초 동안 자리 상태가 바뀔 때마다 찍음
          --seconds 초      카메라로 볼 시간 (1~600)
          --frames          장면마다 상반신·얼굴 수를 찍음
          사진 파일          사진에서 사람·얼굴 수를 셈 (카메라를 켜지 않음)
        """

    static func main() async {
        var seconds = 20.0
        var files: [String] = []
        var verbose = false
        var arguments = Array(CommandLine.arguments.dropFirst())[...]
        while let argument = arguments.popFirst() {
            switch argument {
            case "--help", "-h":
                print(usage); exit(0)
            case "--frames":
                verbose = true
            case "--seconds":
                guard let value = arguments.popFirst().flatMap(Double.init), (1...600).contains(value) else {
                    print("--seconds 뒤에는 1~600 사이 초를 적어 주세요."); exit(2)
                }
                seconds = value
            default:
                guard !argument.hasPrefix("--") else { print("모르는 옵션입니다: \(argument)\n\(usage)"); exit(2) }
                files.append(argument)
            }
        }
        if files.isEmpty {
            await watch(seconds: seconds, verbose: verbose)
        } else {
            checkImages(files)
        }
    }

    static func checkImages(_ files: [String]) {
        let detector = PersonDetector()
        var failed = false
        for path in files {
            guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
                print("\(path): 사진을 읽지 못했습니다."); failed = true; continue
            }
            let started = Date()
            let result = detector.detect(image)
            let ms = Int(Date().timeIntervalSince(started) * 1000)
            print("\(path): \(result.isSomeoneThere ? "사람 있음" : "사람 없음") · 상반신 \(result.people) · 얼굴 \(result.faces) · 확신 \(String(format: "%.2f", result.confidence)) · \(ms)ms")
        }
        exit(failed ? 1 : 0)
    }

    @MainActor
    static func watch(seconds: Double, verbose: Bool) async {
        let monitor = SeatMonitor()
        let started = Date()
        var last: SeatPresence?
        var frames = 0
        var seenFrames = 0
        monitor.onChange = {
            if let detection = monitor.lastDetection, monitor.isRunning {
                frames += 1
                if detection.isSomeoneThere { seenFrames += 1 }
                if verbose {
                    let t = String(format: "%5.1f", Date().timeIntervalSince(started))
                    print("  \(t)초 상반신 \(detection.people) 얼굴 \(detection.faces) 확신 \(String(format: "%.2f", detection.confidence)) → \(monitor.presence.title)")
                }
            }
            guard monitor.presence != last else { return }
            last = monitor.presence
            let elapsed = String(format: "%5.1f", Date().timeIntervalSince(started))
            let reason = monitor.offReason.map { " · \($0)" } ?? ""
            print("[\(elapsed)초] \(monitor.presence.title)\(reason)")
        }
        print("카메라로 \(Int(seconds))초 동안 봅니다. 자리를 떠났다가 돌아와 보세요. (영상은 저장하지 않습니다)")
        await monitor.start()
        guard monitor.isRunning else { exit(1) }
        try? await Task.sleep(for: .seconds(seconds))
        monitor.stop()
        print("본 장면 \(frames)개 · 사람이 보인 장면 \(seenFrames)개 · 초당 \(String(format: "%.1f", Double(frames) / seconds))장")
        exit(0)
    }
}
