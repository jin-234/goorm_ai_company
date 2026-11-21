import AVFoundation
import SwiftUI

/// 카메라 미리보기. 출근 화면과 내 책상 패널에 작게 넣는다.
/// 기본은 거울처럼 좌우를 뒤집어 보여 준다. 화면에만 보이고 저장하지 않는다.
public struct SeatCameraPreview: NSViewRepresentable {
    private let session: AVCaptureSession
    private let mirrored: Bool

    @MainActor
    public init(monitor: SeatMonitor, mirrored: Bool = true) {
        session = monitor.captureSession
        self.mirrored = mirrored
    }

    public func makeNSView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.attach(session, mirrored: mirrored)
        return view
    }

    public func updateNSView(_ view: PreviewView, context: Context) {
        view.attach(session, mirrored: mirrored)
    }

    /// 미리보기 층을 담는 뷰.
    public final class PreviewView: NSView {
        private let preview = AVCaptureVideoPreviewLayer()
        private var mirrored = true

        override public init(frame: NSRect) {
            super.init(frame: frame)
            wantsLayer = true
            layer?.backgroundColor = NSColor.black.cgColor
            preview.videoGravity = .resizeAspectFill
            layer?.addSublayer(preview)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

        func attach(_ session: AVCaptureSession, mirrored: Bool) {
            if preview.session !== session { preview.session = session }
            self.mirrored = mirrored
            applyMirror()
        }

        override public func layout() {
            super.layout()
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            preview.frame = bounds
            CATransaction.commit()
            // 세션이 늦게 구성되면 연결도 늦게 생기므로 다시 맞춘다.
            applyMirror()
        }

        private func applyMirror() {
            guard let connection = preview.connection, connection.isVideoMirroringSupported else { return }
            connection.automaticallyAdjustsVideoMirroring = false
            connection.isVideoMirrored = mirrored
        }
    }
}
