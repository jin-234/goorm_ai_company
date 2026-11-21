import AppKit
import OfficeScene
import SceneKit
import SwiftUI

/// 장소 이름표를 띄울 화면 위치. 3D 장면이 움직일 때마다 바뀐다.
@MainActor
@Observable
final class SpotLabels {
    var points: [OfficeSpot: CGPoint] = [:]
    var hovered: OfficeSpot?
}

/// 3D 사무실. 장소를 누르면 `onPick`을 부른다.
struct OfficeSceneView: NSViewRepresentable {
    let stage: OfficeStage
    let labels: SpotLabels
    var onPick: (OfficeSpot) -> Void

    func makeNSView(context: Context) -> StageView {
        let view = StageView(frame: .zero, options: [SCNView.Option.preferredRenderingAPI.rawValue: SCNRenderingAPI.metal.rawValue])
        view.scene = stage.scene
        view.pointOfView = stage.cameraNode
        view.antialiasingMode = stage.quality == .full ? .multisampling4X : .multisampling2X
        view.rendersContinuously = true
        view.preferredFramesPerSecond = 60
        view.allowsCameraControl = false
        view.backgroundColor = .clear
        view.stage = stage
        view.labels = labels
        view.onPick = onPick
        view.start()
        return view
    }

    func updateNSView(_ view: StageView, context: Context) {
        view.onPick = onPick
    }

    static func dismantleNSView(_ view: StageView, coordinator: ()) {
        view.stop()
    }
}

final class StageView: SCNView {
    var stage: OfficeStage?
    var labels: SpotLabels?
    var onPick: ((OfficeSpot) -> Void)?
    private var displayLink: CADisplayLink?
    private var lastTimestamp: CFTimeInterval?
    private var tracking: NSTrackingArea?

    func start() {
        let link = displayLink(target: self, selector: #selector(step(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    func stop() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func step(_ link: CADisplayLink) {
        let now = link.timestamp
        let delta = lastTimestamp.map { now - $0 } ?? 1.0 / 60
        lastTimestamp = now
        MainActor.assumeIsolated {
            stage?.update(deltaTime: delta)
            updateLabels()
        }
    }

    @MainActor
    private func updateLabels() {
        guard let stage, let labels else { return }
        var points: [OfficeSpot: CGPoint] = [:]
        for spot in OfficeSpot.allCases {
            let projected = projectPoint(stage.labelAnchor(for: spot))
            guard projected.z > 0, projected.z < 1 else { continue }
            // SceneKit 좌표는 왼쪽 아래가 원점. SwiftUI는 왼쪽 위.
            points[spot] = CGPoint(x: CGFloat(projected.x), y: bounds.height - CGFloat(projected.y))
        }
        // 1점 미만 움직임은 무시해 화면 갱신을 줄인다.
        let changed = points.contains { spot, point in
            guard let old = labels.points[spot] else { return true }
            return abs(old.x - point.x) > 0.5 || abs(old.y - point.y) > 0.5
        } || points.count != labels.points.count
        if changed { labels.points = points }
    }

    // MARK: 누르기와 가리키기

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.activeInKeyWindow, .mouseMoved, .mouseEnteredAndExited, .inVisibleRect],
                                  owner: self, userInfo: nil)
        addTrackingArea(area)
        tracking = area
    }

    @MainActor
    private func spot(at event: NSEvent) -> OfficeSpot? {
        guard let stage else { return nil }
        let point = convert(event.locationInWindow, from: nil)
        let hits = hitTest(point, options: [
            .categoryBitMask: stage.hitCategory,
            .searchMode: SCNHitTestSearchMode.closest.rawValue,
            .ignoreHiddenNodes: false,
        ])
        return hits.lazy.compactMap { stage.spot(for: $0.node) }.first
    }

    override func mouseMoved(with event: NSEvent) {
        MainActor.assumeIsolated {
            let spot = spot(at: event)
            guard labels?.hovered != spot else { return }
            labels?.hovered = spot
            stage?.setHighlight(spot)
            if spot != nil { NSCursor.pointingHand.set() } else { NSCursor.arrow.set() }
        }
    }

    override func mouseExited(with event: NSEvent) {
        MainActor.assumeIsolated {
            labels?.hovered = nil
            stage?.setHighlight(nil)
            NSCursor.arrow.set()
        }
    }

    override func mouseUp(with event: NSEvent) {
        MainActor.assumeIsolated {
            if let spot = spot(at: event) { onPick?(spot) }
        }
    }
}
