// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OfficeScreens",
    defaultLocalization: "ko",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OfficeScreens", targets: ["OfficeScreens"]),
    ],
    dependencies: [
        .package(path: "../OfficeKit"),
        .package(path: "../WhisperBridge"),
        .package(path: "../SeatKit"),
    ],
    targets: [
        // 오른쪽 패널에 들어가는 화면: 회의실 아침 PT, 출근, Whisper 모델 설정.
        // 앱 상태는 Binding<Office>로만 받고 Office의 메서드로 바꾼다.
        .target(name: "OfficeScreens", dependencies: [
            .product(name: "OfficeCore", package: "OfficeKit"),
            .product(name: "WhisperBridge", package: "WhisperBridge"),
            .product(name: "SeatKit", package: "SeatKit"),
        ]),
        // 화면을 PNG로 뽑아 눈으로 확인하는 도구.
        .executableTarget(name: "screen-shots", dependencies: ["OfficeScreens"]),
        .testTarget(name: "OfficeScreensTests", dependencies: ["OfficeScreens"]),
    ]
)
