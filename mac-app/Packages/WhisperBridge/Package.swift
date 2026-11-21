// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WhisperBridge",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "WhisperBridge", targets: ["WhisperBridge"]),
    ],
    targets: [
        // whisper.cpp 배포판(태그 b5454, v1.9.5와 같은 날). 서버 없이 앱 안에서 전사한다.
        // 처음 빌드할 때 SwiftPM이 내려받는다(약 66MB).
        .binaryTarget(
            name: "whisper",
            url: "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-b5454-xcframework.zip",
            checksum: "e57f8c48933000acabc13bb913fbe82805d483a2deff692cc6738836bd92393b"
        ),
        // 마이크 녹음, 모델 보관, 한국어 전사.
        .target(name: "WhisperBridge", dependencies: ["whisper"]),
        // 터미널에서 전사문과 걸린 시간을 확인하는 도구. small과 base 비교용.
        .executableTarget(name: "whisper-check", dependencies: ["WhisperBridge"]),
        .testTarget(name: "WhisperBridgeTests", dependencies: ["WhisperBridge"]),
    ]
)
