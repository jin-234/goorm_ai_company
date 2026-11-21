import Accelerate
import AVFoundation

/// Whisper에 넣는 소리 형식(16kHz 모노 Float32) 다루기.
public enum AudioSamples {
    /// Whisper 입력 표본화 주파수.
    public static let sampleRate = 16_000

    /// 소리 파일(wav, aiff, m4a 등)을 16kHz 모노 Float32로 읽는다.
    /// 파일로 받은 녹음을 전사해 볼 때 쓴다. 앱의 마이크 녹음은 파일을 거치지 않는다.
    public static func load(_ url: URL) throws -> [Float] {
        let file: AVAudioFile
        do {
            file = try AVAudioFile(forReading: url)
        } catch {
            throw AudioSamplesError.unreadable(url.lastPathComponent)
        }
        let format = file.processingFormat
        let chunk: AVAudioFrameCount = 16_384
        guard let resampler = MonoResampler(sourceRate: format.sampleRate),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else {
            throw AudioSamplesError.unreadable(url.lastPathComponent)
        }

        var samples: [Float] = []
        samples.reserveCapacity(Int(Double(file.length) * Double(sampleRate) / format.sampleRate) + 1024)
        while file.framePosition < file.length {
            do {
                try file.read(into: buffer, frameCount: chunk)
            } catch {
                throw AudioSamplesError.unreadable(url.lastPathComponent)
            }
            if buffer.frameLength == 0 { break }
            samples.append(contentsOf: resampler.convert(Downmix.mono(buffer)))
        }
        samples.append(contentsOf: resampler.finish())
        return samples
    }

    /// 소리 길이(초).
    public static func seconds(_ samples: [Float]) -> Double {
        Double(samples.count) / Double(sampleRate)
    }
}

public enum AudioSamplesError: Error, LocalizedError, Equatable {
    /// 소리 파일이 아니거나 읽을 수 없는 형식.
    case unreadable(String)

    public var errorDescription: String? {
        switch self {
        case .unreadable(let name):
            "소리 파일을 읽지 못했습니다.\n(\(name))"
        }
    }
}

// MARK: - 채널 합치기

enum Downmix {
    /// 여러 채널을 평균해 한 채널로 만든다.
    static func mono(_ buffer: AVAudioPCMBuffer) -> [Float] {
        let frames = Int(buffer.frameLength)
        guard frames > 0, let channels = buffer.floatChannelData else { return [] }
        let channelCount = Int(buffer.format.channelCount)
        var mono = [Float](UnsafeBufferPointer(start: channels[0], count: frames))
        guard channelCount > 1 else { return mono }

        mono.withUnsafeMutableBufferPointer { pointer in
            guard let base = pointer.baseAddress else { return }
            for channel in 1..<channelCount {
                vDSP_vadd(base, 1, channels[channel], 1, base, 1, vDSP_Length(frames))
            }
            var scale = 1 / Float(channelCount)
            vDSP_vsmul(base, 1, &scale, base, 1, vDSP_Length(frames))
        }
        return mono
    }
}

// MARK: - 16kHz로 바꾸기

/// 모노 Float32 소리를 16kHz로 바꾼다. 이어지는 조각을 차례로 넣고 마지막에 `finish()`를 부른다.
final class MonoResampler {
    private let converter: AVAudioConverter?
    private let source: AVAudioFormat
    private let target: AVAudioFormat

    init?(sourceRate: Double) {
        let targetRate = Double(AudioSamples.sampleRate)
        guard sourceRate > 0,
              let source = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: sourceRate,
                                         channels: 1, interleaved: false),
              let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: targetRate,
                                         channels: 1, interleaved: false) else { return nil }
        self.source = source
        self.target = target
        if sourceRate == targetRate {
            // 이미 16kHz면 그대로 지나간다.
            converter = nil
        } else {
            guard let converter = AVAudioConverter(from: source, to: target) else { return nil }
            self.converter = converter
        }
    }

    func convert(_ mono: [Float]) -> [Float] {
        guard !mono.isEmpty else { return [] }
        guard converter != nil else { return mono }
        guard let input = AVAudioPCMBuffer(pcmFormat: source, frameCapacity: AVAudioFrameCount(mono.count)),
              let channel = input.floatChannelData?[0] else { return [] }
        mono.withUnsafeBufferPointer { pointer in
            guard let base = pointer.baseAddress else { return }
            channel.update(from: base, count: mono.count)
        }
        input.frameLength = AVAudioFrameCount(mono.count)
        return pump(input, endOfStream: false)
    }

    /// 변환기 안에 남은 끝부분을 꺼낸다. 부른 뒤에는 다시 쓰지 않는다.
    func finish() -> [Float] {
        guard converter != nil else { return [] }
        return pump(nil, endOfStream: true)
    }

    private func pump(_ input: AVAudioPCMBuffer?, endOfStream: Bool) -> [Float] {
        guard let converter else { return [] }
        let ratio = target.sampleRate / source.sampleRate
        let capacity = AVAudioFrameCount(Double(input?.frameLength ?? 0) * ratio) + 2_048
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return [] }

        var pending = input
        var result: [Float] = []
        while true {
            output.frameLength = 0
            var failure: NSError?
            let status = converter.convert(to: output, error: &failure) { _, inputStatus in
                if let buffer = pending {
                    pending = nil
                    inputStatus.pointee = .haveData
                    return buffer
                }
                inputStatus.pointee = endOfStream ? .endOfStream : .noDataNow
                return nil
            }
            let produced = Int(output.frameLength)
            if produced > 0, let channel = output.floatChannelData?[0] {
                result.append(contentsOf: UnsafeBufferPointer(start: channel, count: produced))
            }
            // 출력 버퍼가 가득 찼을 때만 한 번 더 돈다.
            if status != .haveData || produced == 0 { break }
        }
        return result
    }
}

// MARK: - 소리 크기

enum SpeechEnergy {
    /// 말소리로 볼 만한 크기의 기준. 약 -45dBFS.
    static let threshold: Float = 0.0056
    /// 이만큼(초)은 기준을 넘어야 말소리가 있다고 본다.
    static let minimumSeconds = 0.24

    /// 말소리로 볼 만한 크기의 구간이 있는지.
    /// 무음을 Whisper에 넣으면 없는 말을 지어내므로 전사 전에 가려낸다.
    static func hasSpeech(_ samples: [Float], sampleRate: Int = AudioSamples.sampleRate) -> Bool {
        let window = max(1, sampleRate / 50) // 20ms
        let needed = max(1, Int((minimumSeconds * Double(sampleRate) / Double(window)).rounded(.up)))
        guard samples.count >= window * needed else { return false }

        var loud = 0
        return samples.withUnsafeBufferPointer { pointer -> Bool in
            guard let base = pointer.baseAddress else { return false }
            var offset = 0
            while offset + window <= pointer.count {
                var rms: Float = 0
                vDSP_rmsqv(base + offset, 1, &rms, vDSP_Length(window))
                if rms > threshold {
                    loud += 1
                    if loud >= needed { return true }
                }
                offset += window
            }
            return false
        }
    }

    /// 화면 막대용 입력 크기(0~1). -55dBFS 이하는 0, -10dBFS 이상은 1.
    static func level(_ samples: [Float]) -> Float {
        guard !samples.isEmpty else { return 0 }
        var rms: Float = 0
        vDSP_rmsqv(samples, 1, &rms, vDSP_Length(samples.count))
        guard rms > 0 else { return 0 }
        let decibels = 20 * log10(rms)
        return max(0, min(1, (decibels + 55) / 45))
    }
}
