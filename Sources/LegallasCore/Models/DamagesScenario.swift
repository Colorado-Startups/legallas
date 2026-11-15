// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A set of damages assumptions on a case, with the net present value last calculated from them.
@Model
public final class DamagesScenario {
    /// Name given to the scenario.
    public var name: String = ""
    /// Stored raw value of the scenario tier.
    public var tierRaw: String = DamagesTier.base.rawValue

    /// Fund assets under management at the start of the model.
    public var startingAUM: Decimal = 0
    /// Yearly growth rate of the fund's assets.
    public var annualGrowthRate: Double = 0
    /// Yearly management fee rate.
    public var managementFeeRate: Double = 0
    /// Fraction of the management fee that goes to the claimant.
    public var claimantFeeShare: Double = 0
    /// Carried interest rate.
    public var carryRate: Double = 0
    /// Fraction of the carry allocated to partners.
    public var partnerAllocation: Double = 0
    /// Fraction of the partner carry that goes to the claimant.
    public var claimantCarryShare: Double = 0
    /// Rate used to discount cash flows.
    public var discountRate: Double = 0
    /// Number of years modeled; ten by default.
    public var horizonYears: Int = 10
    /// Growth rate of cash flow after the modeled years.
    public var terminalGrowthRate: Double = 0
    /// Flat lost distributions amount added to the result.
    public var lostDistributions: Decimal = 0
    /// Flat governance premium amount added to the result.
    public var governancePremium: Decimal = 0

    /// Net present value from the last calculation, if one was saved.
    public var cachedNPV: Decimal?
    /// Trebled net present value from the last calculation, if one was saved.
    public var cachedTrebledNPV: Decimal?
    /// When the saved results were calculated.
    public var computedAt: Date?

    /// Case the scenario belongs to.
    public var `case`: Case?

    /// Assumption tier of the scenario; an unreadable stored value reads as base.
    public var tier: DamagesTier {
        get { DamagesTier(rawValue: tierRaw) ?? .base }
        set { tierRaw = newValue.rawValue }
    }

    /// Creates a scenario from its assumptions; the horizon defaults to ten years and the flat adjustments to zero.
    public init(
        name: String,
        tier: DamagesTier,
        startingAUM: Decimal,
        annualGrowthRate: Double,
        managementFeeRate: Double,
        claimantFeeShare: Double,
        carryRate: Double,
        partnerAllocation: Double,
        claimantCarryShare: Double,
        discountRate: Double,
        horizonYears: Int = 10,
        terminalGrowthRate: Double,
        lostDistributions: Decimal = 0,
        governancePremium: Decimal = 0
    ) {
        self.name = name
        self.tierRaw = tier.rawValue
        self.startingAUM = startingAUM
        self.annualGrowthRate = annualGrowthRate
        self.managementFeeRate = managementFeeRate
        self.claimantFeeShare = claimantFeeShare
        self.carryRate = carryRate
        self.partnerAllocation = partnerAllocation
        self.claimantCarryShare = claimantCarryShare
        self.discountRate = discountRate
        self.horizonYears = horizonYears
        self.terminalGrowthRate = terminalGrowthRate
        self.lostDistributions = lostDistributions
        self.governancePremium = governancePremium
    }
}
