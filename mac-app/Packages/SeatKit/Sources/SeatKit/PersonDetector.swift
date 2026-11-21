import CoreGraphics
import CoreVideo
import Vision

/// 한 장면에서 사람(상반신)과 얼굴을 찾는다. Apple Vision으로 기기 안에서만 계산한다.
///
/// 웹 시연의 MediaPipe 사람 감지와 같은 역할이다. 고개를 숙여 책을 볼 때도
/// 상반신이 보이면 있다고 보도록 사람과 얼굴 중 하나만 보여도 된다.
public struct PersonDetector: Sendable {
    /// 이보다 확실해야 찾은 것으로 친다.
    public var minimumConfidence: Float

    public init(minimumConfidence: Float = 0.5) {
        self.minimumConfidence = minimumConfidence
    }

    public func detect(_ pixelBuffer: CVPixelBuffer) -> SeatDetection {
        run(VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up))
    }

    public func detect(_ image: CGImage) -> SeatDetection {
        run(VNImageRequestHandler(cgImage: image, orientation: .up))
    }

    private func run(_ handler: VNImageRequestHandler) -> SeatDetection {
        let humans = VNDetectHumanRectanglesRequest()
        // 책상 앞에 앉으면 웹캠에는 상반신만 보인다.
        humans.upperBodyOnly = true
        let faces = VNDetectFaceRectanglesRequest()
        do {
            try handler.perform([humans, faces])
        } catch {
            return SeatDetection(people: 0, faces: 0, confidence: 0)
        }
        let people = (humans.results ?? []).filter { $0.confidence >= minimumConfidence }
        let found = (faces.results ?? []).filter { $0.confidence >= minimumConfidence }
        let best = (people.map(\.confidence) + found.map(\.confidence)).max() ?? 0
        return SeatDetection(people: people.count, faces: found.count, confidence: best)
    }
}
