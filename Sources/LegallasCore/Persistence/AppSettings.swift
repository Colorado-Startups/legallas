// SPDX-License-Identifier: Apache-2.0
import Foundation

/// What a room may set about the Mac app and its local MCP server, with the product's values as defaults.
///
/// A room answers a setting by giving `AppSettings` a `public static var` of the same name in a file of its
/// own (`AppSettings+Room.swift`, beside this one); that member then answers for the default below, the way
/// `RoomSeed` works. A build without that file uses these values, so a fresh install carries no room's names.
///
/// `appName`, `bundleIdentifier` and `helperName` are also build settings
/// (`LegallasApp/Config/Room.xcconfig.example`); `verify-app.sh` fails a build whose two disagree.
///
/// A store that holds a field under another name needs no setting and no migration. SwiftData stores a field under its
/// property's name, so the room supplies its own copy of that model as `Models/<Name>+Room.swift`, with the stored names
/// it has and the product's names as computed properties. `Package.swift` then builds that file instead of `<Name>.swift`.
public protocol RoomAppSettings {
    /// The app's name as people see it.
    static var appName: String { get }
    /// The bundle identifier. It decides the sandbox container, so it decides which store the app can reach.
    static var bundleIdentifier: String { get }
    /// The file name of the MCP helper in `Contents/Helpers`.
    static var helperName: String { get }
    /// The name the local MCP server gives in `initialize`.
    static var mcpServerName: String { get }
    /// The tool prefix when `--tool-prefix` is not given.
    static var mcpToolPrefix: String { get }

    /// The folder under Application Support that holds the store.
    static var storeFolderName: String { get }
    /// The inbox folder under the case's documents folder.
    static var inboxFolderName: String { get }
    /// The export file's name without its extension.
    static var exportFileStem: String { get }

    /// The value a store keeps in `Claim.typeRaw` for a claim type, where it is not the raw value.
    /// The app reads and writes that value, so the store does not change.
    static var storedClaimTypeNames: [ClaimType: String] { get }

    /// The label for `ClaimType.stateRacketeering`.
    static var stateRacketeeringLabel: String { get }
    /// The damages editor's label for `claimantFeeShare`.
    static var claimantFeeShareLabel: String { get }
    /// The damages editor's label for `partnerAllocation`.
    static var partnerAllocationLabel: String { get }
    /// The damages editor's label for `claimantCarryShare`.
    static var claimantCarryShareLabel: String { get }
    /// What the damages editor starts a new scenario with for `claimantFeeShare`.
    static var newScenarioClaimantFeeShare: Double { get }
    /// What the damages editor starts a new scenario with for `partnerAllocation`.
    static var newScenarioPartnerAllocation: Double { get }
    /// What the damages editor starts a new scenario with for `claimantCarryShare`.
    static var newScenarioClaimantCarryShare: Double { get }
}

extension RoomAppSettings {
    /// Default app name, Legallas.
    public static var appName: String { "Legallas" }
    /// Default bundle identifier, org.coloradostartups.Legallas.
    public static var bundleIdentifier: String { "org.coloradostartups.Legallas" }
    /// Default file name of the MCP helper, LegallasMCP.
    public static var helperName: String { "LegallasMCP" }
    /// Default name the local MCP server reports, legallas.
    public static var mcpServerName: String { "legallas" }
    /// Default tool prefix for the MCP server, legallas_.
    public static var mcpToolPrefix: String { "legallas_" }

    /// Default folder name for the store under Application Support, Legallas.
    public static var storeFolderName: String { "Legallas" }
    /// Default inbox folder name, legallas-inbox.
    public static var inboxFolderName: String { "legallas-inbox" }
    /// Default export file name without its extension, legallas-export.
    public static var exportFileStem: String { "legallas-export" }

    /// By default no claim type has a stored name other than its raw value.
    public static var storedClaimTypeNames: [ClaimType: String] { [:] }

    /// Default label for the state racketeering claim type.
    public static var stateRacketeeringLabel: String { "State racketeering" }
    /// Default damages editor label for the claimant's share of management fees.
    public static var claimantFeeShareLabel: String { "Claimant's share of mgmt fees" }
    /// Default damages editor label for the partner allocation of carry.
    public static var partnerAllocationLabel: String { "Partner allocation of carry" }
    /// Default damages editor label for the claimant's share of partner carry.
    public static var claimantCarryShareLabel: String { "Claimant's share of Partner carry" }
    /// Default claimant fee share for a new scenario, 0.10.
    public static var newScenarioClaimantFeeShare: Double { 0.10 }
    /// Default partner allocation for a new scenario, 0.40.
    public static var newScenarioPartnerAllocation: Double { 0.40 }
    /// Default claimant carry share for a new scenario, 0.15.
    public static var newScenarioClaimantCarryShare: Double { 0.15 }
}

/// This build's settings: the defaults above, and whatever a room's own file answers.
public enum AppSettings: RoomAppSettings {
    /// The export file's whole name.
    public static var exportFileName: String { "\(exportFileStem).json" }
}
