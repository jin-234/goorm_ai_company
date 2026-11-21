import CoreGraphics
import Foundation
import Testing
@testable import SeatKit

@Suite("착석 판정")
struct SeatPresenceFilterTests {
    let start = Date(timeIntervalSinceReferenceDate: 1_000)

    func at(_ seconds: Double) -> Date { start.addingTimeInterval(seconds) }

    @Test("rawValue는 OfficeCore PresenceState와 같다")
    func rawValues() {
        #expect(SeatPresence.allCases.map(\.rawValue) == ["present", "absent", "cameraOff", "unknown"])
    }

    @Test("두 번 이어서 보이면 present")
    func confirm() {
        var filter = SeatPresenceFilter()
        filter.begin(at: start)
        #expect(filter.presence == .unknown)
        filter.frame(seen: true, at: at(0.4))
        #expect(filter.presence == .unknown)
        filter.frame(seen: true, at: at(0.8))
        #expect(filter.presence == .present)
    }

    @Test("한두 장면 놓쳐도 absent로 뒤집히지 않는다")
    func holdsThroughMisses() {
        var filter = SeatPresenceFilter(absentHold: 3)
        filter.begin(at: start)
        filter.frame(seen: true, at: at(0.4))
        filter.frame(seen: true, at: at(0.8))
        filter.frame(seen: false, at: at(1.2))
        filter.frame(seen: false, at: at(1.6))
        filter.tick(at: at(2.0))
        #expect(filter.presence == .present)
        filter.frame(seen: true, at: at(2.4))
        filter.frame(seen: true, at: at(2.8))
        #expect(filter.presence == .present)
    }

    @Test("마지막으로 보인 뒤 유지 시간이 지나면 absent")
    func becomesAbsent() {
        var filter = SeatPresenceFilter(absentHold: 3)
        filter.begin(at: start)
        filter.frame(seen: true, at: at(0.4))
        filter.frame(seen: true, at: at(0.8))
        var time = 1.2
        while time < 3.8 {
            filter.frame(seen: false, at: at(time))
            time += 0.4
        }
        #expect(filter.presence == .present)
        filter.frame(seen: false, at: at(3.8))
        #expect(filter.presence == .absent)
        // 돌아오면 다시 present.
        filter.frame(seen: true, at: at(4.2))
        filter.frame(seen: true, at: at(4.6))
        #expect(filter.presence == .present)
    }

    @Test("처음부터 아무도 없으면 유지 시간 뒤 absent")
    func absentFromStart() {
        var filter = SeatPresenceFilter(absentHold: 3)
        filter.begin(at: start)
        filter.frame(seen: false, at: at(1))
        #expect(filter.presence == .unknown)
        filter.frame(seen: false, at: at(3))
        #expect(filter.presence == .absent)
    }

    @Test("영상이 안 들어오면 cameraOff, 다시 들어오면 새로 센다")
    func stalls() {
        var filter = SeatPresenceFilter(absentHold: 3, frameTimeout: 3)
        filter.begin(at: start)
        filter.frame(seen: true, at: at(0.4))
        filter.frame(seen: true, at: at(0.8))
        filter.tick(at: at(3.0))
        #expect(filter.presence == .present)
        filter.tick(at: at(3.9))
        #expect(filter.presence == .cameraOff)
        #expect(filter.isStalled)
        filter.frame(seen: false, at: at(5))
        #expect(filter.presence == .unknown)
        filter.frame(seen: true, at: at(5.4))
        filter.frame(seen: true, at: at(5.8))
        #expect(filter.presence == .present)
    }

    @Test("한 번도 영상이 안 오면 cameraOff")
    func neverStarts() {
        var filter = SeatPresenceFilter(frameTimeout: 3)
        filter.begin(at: start)
        filter.tick(at: at(2.5))
        #expect(filter.presence != .cameraOff)
        filter.tick(at: at(3))
        #expect(filter.presence == .cameraOff)
    }

    @Test("begin 전에는 아무것도 바꾸지 않는다")
    func beforeBegin() {
        var filter = SeatPresenceFilter()
        filter.frame(seen: true, at: at(1))
        filter.frame(seen: true, at: at(2))
        filter.tick(at: at(10))
        #expect(filter.presence == .unknown)
    }

    @Test("빈 장면에서는 사람을 찾지 않는다")
    func blankImage() throws {
        let context = try #require(CGContext(data: nil, width: 640, height: 480, bitsPerComponent: 8,
                                             bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                             bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(CGColor(red: 0.9, green: 0.88, blue: 0.82, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 640, height: 480))
        let image = try #require(context.makeImage())
        let result = PersonDetector().detect(image)
        #expect(!result.isSomeoneThere)
    }
}
