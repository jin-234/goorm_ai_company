// swift-tools-version: 6.0
import PackageDescription

// 맥 앱 'AI 상사 가상회사'. scripts/build-app.sh 가 이 실행 파일을 .app 으로 감싼다.
let package = Package(
    name: "AIBossOffice",
    defaultLocalization: "ko",
    platforms: [.macOS(.v15)],
    dependencies: [
        .package(path: "../Packages/OfficeKit"),
        .package(path: "../Packages/WhisperBridge"),
        .package(path: "../Packages/SeatKit"),
        .package(path: "../Packages/OfficeScreens"),
    ],
    targets: [
        .executableTarget(
            name: "AIBossOffice",
            dependencies: [
                .product(name: "OfficeCore", package: "OfficeKit"),
                .product(name: "OfficeScene", package: "OfficeKit"),
                .product(name: "WhisperBridge", package: "WhisperBridge"),
                .product(name: "SeatKit", package: "SeatKit"),
                .product(name: "OfficeScreens", package: "OfficeScreens"),
            ],
            // SceneKit·AppKit 콜백이 많아 Swift 5 방식 동시성 검사를 쓴다.
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
    ]
)
