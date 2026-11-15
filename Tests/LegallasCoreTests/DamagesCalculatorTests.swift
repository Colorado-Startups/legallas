// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("DamagesCalculator")
struct DamagesCalculatorTests {

    static func knowableInputs() -> DamagesInputs {
        DamagesInputs(
            startingAUM: 100_000_000,
            annualGrowthRate: 0.0,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.50,
            carryRate: 0.20,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.50,
            discountRate: 0.10,
            horizonYears: 5,
            terminalGrowthRate: 0.0
        )
    }

    static func decimalAbs(_ d: Decimal) -> Decimal {
        d < 0 ? -d : d
    }

    @Test("Hand-verifiable NPV: flat 1M annuity with 10% discount equals 10M")
    func knowableNPV() {
        let result = DamagesCalculator.compute(Self.knowableInputs())
        let expected: Decimal = 10_000_000
        #expect(Self.decimalAbs(result.npv - expected) < Decimal(string: "1.00")!)
        #expect(result.perYear.count == 5)
        #expect(result.perYear.allSatisfy { Self.decimalAbs($0.cashFlowToClaimant - 1_000_000) < Decimal(string: "0.01")! })
    }

    @Test("Trebled NPV equals NPV times 3")
    func trebleMultiplier() {
        let result = DamagesCalculator.compute(Self.knowableInputs())
        #expect(result.trebledNPV == result.npv * 3)
    }

    @Test("Horizon of zero: NPV equals lostDistributions plus governancePremium")
    func zeroHorizon() {
        let inputs = DamagesInputs(
            startingAUM: 100_000_000,
            annualGrowthRate: 0.05,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.1,
            horizonYears: 0,
            terminalGrowthRate: 0.02,
            lostDistributions: 250_000,
            governancePremium: 100_000
        )
        let result = DamagesCalculator.compute(inputs)
        #expect(result.perYear.isEmpty)
        #expect(result.terminalValuePresentValue == 0)
        #expect(result.npv == 350_000)
        #expect(result.trebledNPV == 1_050_000)
    }

    @Test("Terminal growth above discount triggers clamp flag")
    func terminalClampWhenGrowthExceedsDiscount() {
        let inputs = DamagesInputs(
            startingAUM: 100_000_000,
            annualGrowthRate: 0.08,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.10,
            horizonYears: 5,
            terminalGrowthRate: 0.15
        )
        let result = DamagesCalculator.compute(inputs)
        #expect(result.terminalValueClamped == true)
        #expect(result.terminalValuePresentValue > 0)
        #expect(result.npv > 0)
    }

    @Test("Lost distributions and governance premium add directly to NPV")
    func adjustmentsAddDirectly() {
        let base = Self.knowableInputs()
        let withAdjustments = DamagesInputs(
            startingAUM: base.startingAUM,
            annualGrowthRate: base.annualGrowthRate,
            managementFeeRate: base.managementFeeRate,
            claimantFeeShare: base.claimantFeeShare,
            carryRate: base.carryRate,
            partnerAllocation: base.partnerAllocation,
            claimantCarryShare: base.claimantCarryShare,
            discountRate: base.discountRate,
            horizonYears: base.horizonYears,
            terminalGrowthRate: base.terminalGrowthRate,
            lostDistributions: 500_000,
            governancePremium: 250_000
        )
        let baseResult = DamagesCalculator.compute(base)
        let withResult = DamagesCalculator.compute(withAdjustments)
        let diff = withResult.npv - baseResult.npv
        #expect(Self.decimalAbs(diff - 750_000) < Decimal(string: "0.01")!)
    }

    @Test("Sensitivity table returns 9 cells with 0/0 matching base compute")
    func sensitivityGrid() {
        let inputs = Self.knowableInputs()
        let cells = DamagesCalculator.sensitivity(inputs)
        #expect(cells.count == 9)
        guard let center = cells.first(where: { $0.discountRateDelta == 0 && $0.growthRateDelta == 0 }) else {
            Issue.record("No center cell found")
            return
        }
        let base = DamagesCalculator.compute(inputs)
        #expect(Self.decimalAbs(center.npv - base.npv) < Decimal(string: "0.01")!)
    }

    @Test("Zero starting AUM produces zero cash flows")
    func zeroStartingAUM() {
        let inputs = DamagesInputs(
            startingAUM: 0,
            annualGrowthRate: 0.08,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.10,
            horizonYears: 10,
            terminalGrowthRate: 0.02,
            lostDistributions: 100_000,
            governancePremium: 0
        )
        let result = DamagesCalculator.compute(inputs)
        #expect(result.perYear.allSatisfy { $0.cashFlowToClaimant == 0 })
        #expect(result.terminalValuePresentValue == 0)
        #expect(result.npv == 100_000)
    }
}
