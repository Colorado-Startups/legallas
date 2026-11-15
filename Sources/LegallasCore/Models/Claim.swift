// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A claim asserted in the case, with its elements, treble damages flag and statute of limitations.
@Model
public final class Claim {
    /// Stored raw value of the claim type.
    public var typeRaw: String = ClaimType.custom.rawValue
    /// User-supplied label used when the claim type is custom.
    public var customLabel: String?
    /// Date the statute of limitations runs out, if known.
    public var statuteOfLimitations: Date?
    /// Text describing what must be proven for the claim.
    public var elements: String = ""
    /// Whether the claim carries treble damages.
    public var isTrebleable: Bool = false
    /// Whether the claim is expected to survive summary judgment.
    public var isSurvivingSummaryJudgment: Bool = true

    /// Case the claim belongs to.
    public var `case`: Case?

    /// Kind of claim, read through the room's stored names for claim types.
    public var type: ClaimType {
        get { ClaimType(storedName: typeRaw) }
        set { typeRaw = newValue.storedName }
    }

    /// Creates a claim; elements default to empty, treble damages to off and surviving summary judgment to on.
    public init(
        type: ClaimType,
        customLabel: String? = nil,
        statuteOfLimitations: Date? = nil,
        elements: String = "",
        isTrebleable: Bool = false,
        isSurvivingSummaryJudgment: Bool = true
    ) {
        self.typeRaw = type.storedName
        self.customLabel = customLabel
        self.statuteOfLimitations = statuteOfLimitations
        self.elements = elements
        self.isTrebleable = isTrebleable
        self.isSurvivingSummaryJudgment = isSurvivingSummaryJudgment
    }
}

extension ClaimType {
    /// What a store holds for this claim type: its raw value, unless the room's store keeps another name for it.
    public var storedName: String { storedName(in: AppSettings.storedClaimTypeNames) }

    /// The claim type a stored value means. An unknown value reads as `.custom`, as it always has.
    public init(storedName: String) {
        self.init(storedName: storedName, in: AppSettings.storedClaimTypeNames)
    }

    func storedName(in names: [ClaimType: String]) -> String {
        names[self] ?? rawValue
    }

    init(storedName: String, in names: [ClaimType: String]) {
        self = names.first { $0.value == storedName }?.key ?? ClaimType(rawValue: storedName) ?? .custom
    }
}
