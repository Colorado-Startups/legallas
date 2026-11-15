// swift-tools-version: 6.2
import Foundation
import PackageDescription

// SwiftData stores a field under its property's name. A room whose store holds other names keeps them, with no
// migration, by supplying its own copy of that model as Sources/LegallasCore/Models/<Name>+Room.swift, which is built
// instead of <Name>.swift (see AppSettings.swift). A build without one is the product.
let modelsFolder = Context.packageDirectory + "/Sources/LegallasCore/Models"
let replacedModels = ((try? FileManager.default.contentsOfDirectory(atPath: modelsFolder)) ?? [])
    .filter { $0.hasSuffix("+Room.swift") }
    .map { "Models/" + $0.replacingOccurrences(of: "+Room.swift", with: ".swift") }

let package = Package(
    name: "Legallas",
    platforms: [
        .macOS(.v26),
        // LegallasCore only, for the iPhone destination to come; CI builds it for
        // generic iOS so the shared code stays portable. The executables are Mac only.
        .iOS(.v26)
    ],
    products: [
        .library(
            name: "LegallasCore",
            targets: ["LegallasCore"]
        ),
        .executable(
            name: "LegallasMCP",
            targets: ["LegallasMCP"]
        ),
        .executable(
            name: "Legallas",
            targets: ["Legallas"]
        ),
        .library(
            name: "LegallasExtraction",
            targets: ["LegallasExtraction"]
        ),
        .executable(
            name: "LegallasExtract",
            targets: ["LegallasExtract"]
        )
    ],
    targets: [
        .target(
            name: "LegallasCore",
            exclude: replacedModels,
            resources: [
                .process("Resources")
            ],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        .executableTarget(
            name: "LegallasMCP",
            dependencies: ["LegallasCore"],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        .executableTarget(
            name: "Legallas",
            dependencies: ["LegallasCore"],
            path: "LegallasApp/Legallas",
            // AppIcon.icon is compiled by the Xcode project (actool), not SwiftPM.
            exclude: ["Legallas.entitlements", "Info.plist", "AppIcon.icon"],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        // PDFKit + Vision text extraction for the counsel room sync. Kept out of
        // LegallasCore so the LegallasMCP binary never links Vision.
        .target(
            name: "LegallasExtraction",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        .executableTarget(
            name: "LegallasExtract",
            dependencies: ["LegallasExtraction"],
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        .testTarget(
            name: "LegallasExtractionTests",
            dependencies: ["LegallasExtraction", "LegallasExtract"]
        ),
        .testTarget(
            name: "LegallasCoreTests",
            dependencies: ["LegallasCore"]
        ),
        .testTarget(
            name: "LegallasMCPTests",
            dependencies: ["LegallasMCP", "LegallasCore"]
        ),
        .testTarget(
            name: "LegallasAppTests",
            dependencies: ["Legallas", "LegallasCore"]
        ),
        .testTarget(
            name: "LegallasUnitTests",
            dependencies: ["LegallasCore"]
        ),
        .testTarget(
            name: "LegallasIntegrationTests",
            dependencies: ["LegallasCore"]
        ),
        .testTarget(
            name: "LegallasFunctionalTests",
            dependencies: ["LegallasMCP", "LegallasCore"]
        ),
        .testTarget(
            name: "LegallasUITests",
            dependencies: ["Legallas", "LegallasCore"]
        ),
        .testTarget(
            name: "LegallasE2ETests",
            dependencies: ["LegallasCore"]
        )
    ]
)
