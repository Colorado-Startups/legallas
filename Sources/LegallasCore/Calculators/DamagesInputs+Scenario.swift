// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

extension DamagesInputs {

    /// Builds damages inputs by copying every assumption from a stored damages scenario.
    @MainActor
    public init(from scenario: DamagesScenario) {
        self.init(
            startingAUM: scenario.startingAUM,
            annualGrowthRate: scenario.annualGrowthRate,
            managementFeeRate: scenario.managementFeeRate,
            claimantFeeShare: scenario.claimantFeeShare,
            carryRate: scenario.carryRate,
            partnerAllocation: scenario.partnerAllocation,
            claimantCarryShare: scenario.claimantCarryShare,
            discountRate: scenario.discountRate,
            horizonYears: scenario.horizonYears,
            terminalGrowthRate: scenario.terminalGrowthRate,
            lostDistributions: scenario.lostDistributions,
            governancePremium: scenario.governancePremium
        )
    }
}
