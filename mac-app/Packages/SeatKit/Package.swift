// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SeatKit",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "SeatKit", targets: ["SeatKit"]),
    ],
    targets: [
        // 웹캠으로 자리에 사람이 있는지 본다(Vision). 영상은 저장·전송하지 않는다.
        .target(name: "SeatKit"),
        // 터미널에서 착석 판정을 확인하는 도구.
        .executableTarget(name: "seat-check", dependencies: ["SeatKit"]),
        .testTarget(name: "SeatKitTests", dependencies: ["SeatKit"]),
    ]
)
