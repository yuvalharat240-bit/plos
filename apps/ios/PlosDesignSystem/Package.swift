// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "PlosDesignSystem",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "PlosDesignSystem", targets: ["PlosDesignSystem"]),
        // ponytail: a real, runnable verification harness, not just a
        // compile check — `swift run PlosPreviewApp` launches the actual
        // navigation flow on macOS. Not a shipping target; the real app
        // is the Xcode target in apps/ios/plos.xcodeproj.
        .executable(name: "PlosPreviewApp", targets: ["PlosPreviewApp"]),
    ],
    targets: [
        .target(name: "PlosDesignSystem"),
        .executableTarget(name: "PlosPreviewApp", dependencies: ["PlosDesignSystem"]),
    ]
)
