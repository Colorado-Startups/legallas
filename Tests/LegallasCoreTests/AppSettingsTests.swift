// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

/// Takes every default, so these tests pin the product's values even in a build with a room's own settings.
private enum ProductDefaults: RoomAppSettings {}

@Suite("AppSettings")
struct AppSettingsTests {

    @Test("The product's identity and names are its own")
    func productNames() {
        #expect(ProductDefaults.appName == "Legallas")
        #expect(ProductDefaults.bundleIdentifier == "org.coloradostartups.Legallas")
        #expect(ProductDefaults.helperName == "LegallasMCP")
        #expect(ProductDefaults.mcpServerName == "legallas")
        #expect(ProductDefaults.mcpToolPrefix == "legallas_")
        #expect(ProductDefaults.storeFolderName == "Legallas")
        #expect(ProductDefaults.inboxFolderName == "legallas-inbox")
        #expect(ProductDefaults.exportFileStem == "legallas-export")
    }

    @Test("The product's store keeps every claim type under its raw value")
    func productStoreKeepsRawValues() {
        #expect(ProductDefaults.storedClaimTypeNames.isEmpty)
        for type in ClaimType.allCases {
            #expect(type.storedName(in: ProductDefaults.storedClaimTypeNames) == type.rawValue)
            #expect(ClaimType(storedName: type.rawValue, in: ProductDefaults.storedClaimTypeNames) == type)
        }
    }

    @Test("A store's own name for a claim type reads and writes as that name; every other value is as it was")
    func storedClaimTypeNames() {
        let names: [ClaimType: String] = [.stateRacketeering: "exampleStoredName"]
        #expect(ClaimType.stateRacketeering.storedName(in: names) == "exampleStoredName")
        #expect(ClaimType(storedName: "exampleStoredName", in: names) == .stateRacketeering)
        #expect(ClaimType.fraud.storedName(in: names) == "fraud")
        #expect(ClaimType(storedName: "fraud", in: names) == .fraud)
        #expect(ClaimType(storedName: "stateRacketeering", in: names) == .stateRacketeering)
        #expect(ClaimType(storedName: "nothingKnown", in: names) == .custom)
    }

    @Test("A claim stores and reads back through the build's names")
    func claimUsesTheStoredName() {
        let claim = Claim(type: .stateRacketeering)
        #expect(claim.typeRaw == ClaimType.stateRacketeering.storedName)
        #expect(claim.type == .stateRacketeering)
        claim.type = .fraud
        #expect(claim.typeRaw == "fraud")
        claim.typeRaw = "nothingKnown"
        #expect(claim.type == .custom)
    }

    @Test("The product's wording and new-scenario defaults")
    func productWording() {
        #expect(ProductDefaults.stateRacketeeringLabel == "State racketeering")
        #expect(ProductDefaults.claimantFeeShareLabel == "Claimant's share of mgmt fees")
        #expect(ProductDefaults.partnerAllocationLabel == "Partner allocation of carry")
        #expect(ProductDefaults.claimantCarryShareLabel == "Claimant's share of Partner carry")
        #expect(ProductDefaults.newScenarioClaimantFeeShare == 0.10)
        #expect(ProductDefaults.newScenarioPartnerAllocation == 0.40)
        #expect(ProductDefaults.newScenarioClaimantCarryShare == 0.15)
    }

    @Test("The store, inbox and export paths come from the settings")
    func pathsFollowTheSettings() throws {
        let storeURL = try ModelContainerFactory.defaultStoreURL()
        #expect(storeURL.lastPathComponent == "default.store")
        #expect(storeURL.deletingLastPathComponent().lastPathComponent == AppSettings.storeFolderName)

        let paths = InboxPaths(documentsFolder: URL(fileURLWithPath: "/tmp/settings_case_docs", isDirectory: true))
        #expect(paths.root.lastPathComponent == AppSettings.inboxFolderName)
        #expect(paths.exportFile.lastPathComponent == AppSettings.exportFileName)
        #expect(AppSettings.exportFileName == "\(AppSettings.exportFileStem).json")
    }
}
