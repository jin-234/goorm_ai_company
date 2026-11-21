import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

// 사용법: winrec <프로세스 번호> <최대 초> <출력 .mov>
// 그 프로세스의 창 하나만 녹화한다. 다른 창에 가려져 있어도 창 내용이 찍힌다.
// 프로세스가 끝나거나 최대 초가 지나면 멈춘다.
@main
struct WinRec {
    static func main() async throws {
        // 창 서버(CGS)를 먼저 초기화해야 ScreenCaptureKit을 쓸 수 있다.
        _ = await MainActor.run { NSApplication.shared }
        let args = CommandLine.arguments
        guard args.count >= 4, let pid = Int32(args[1]), let seconds = Double(args[2]) else {
            print("사용법: winrec <프로세스 번호> <최대 초> <출력 .mov>")
            exit(2)
        }
        let out = URL(fileURLWithPath: args[3])
        try? FileManager.default.removeItem(at: out)

        var window: SCWindow?
        for _ in 0..<40 {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            // 시트(입사 안내 등)가 아니라 가장 큰 본창을 찍는다.
            window = content.windows
                .filter { $0.owningApplication?.processID == pid && $0.windowLayer == 0 && $0.frame.width > 1000 }
                .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
            if window != nil { break }
            try await Task.sleep(for: .milliseconds(250))
        }
        guard let window else { print("창 없음"); exit(1) }

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        let scale = CGFloat(filter.pointPixelScale)
        config.width = Int(window.frame.width * scale)
        config.height = Int(window.frame.height * scale)
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.showsCursor = false
        config.capturesAudio = false

        let stream = SCStream(filter: filter, configuration: config, delegate: nil)
        let recordingConfig = SCRecordingOutputConfiguration()
        recordingConfig.outputURL = out
        recordingConfig.outputFileType = .mov
        recordingConfig.videoCodecType = .h264
        let recording = SCRecordingOutput(configuration: recordingConfig, delegate: Delegate())
        try stream.addRecordingOutput(recording)
        try await stream.startCapture()
        print("녹화 시작 \(config.width)x\(config.height)")

        let start = Date()
        while Date().timeIntervalSince(start) < seconds, kill(pid, 0) == 0 {
            try await Task.sleep(for: .milliseconds(200))
        }
        // 앱이 먼저 끝나 창이 사라지면 스트림이 이미 멈춰 있다. 그 오류는 무시하고 파일을 마무리한다.
        try? await stream.stopCapture()
        try await Task.sleep(for: .seconds(1))
        print(String(format: "녹화 끝 %.1f초", Date().timeIntervalSince(start)))
    }
}

final class Delegate: NSObject, SCRecordingOutputDelegate {
    func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: any Error) {
        print("녹화 오류: \(error.localizedDescription)")
    }
}
