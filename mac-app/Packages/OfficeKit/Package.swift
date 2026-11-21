// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OfficeKit",
    defaultLocalization: "ko",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "OfficeCore", targets: ["OfficeCore"]),
        .library(name: "OfficeScene", targets: ["OfficeScene"]),
    ],
    targets: [
        // 근태·업무 규칙, 사내 메일, Solar 연동. 화면과 무관한 순수 로직.
        .target(name: "OfficeCore"),
        // 3D 사무실(SceneKit). 장면, 캐릭터, 시간대별 조명.
        // SceneKit이 그리기 스레드에서 부르는 콜백이 있어 Swift 5 방식의 동시성 검사를 쓴다.
        .target(name: "OfficeScene", dependencies: ["OfficeCore"],
                swiftSettings: [.swiftLanguageMode(.v5)]),
        // 사무실 장면을 창 없이 그림 파일로 뽑는 도구(디자인 시안 09:00, 20:00 두 컷).
        .executableTarget(name: "render-shots", dependencies: ["OfficeScene"],
                          swiftSettings: [.swiftLanguageMode(.v5)]),
        // 터미널에서 Solar 실제 응답을 확인하는 도구.
        .executableTarget(name: "solar-check", dependencies: ["OfficeCore"]),
        .testTarget(name: "OfficeCoreTests", dependencies: ["OfficeCore"]),
    ]
)
