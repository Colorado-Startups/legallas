// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("SettlementScorer")
struct SettlementScorerTests {

    static func baseInputs() -> DamagesInputs {
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

    static let receivedAt: Date = {
        var dc = DateComponents()
        dc.year = 2013
        dc.month = 3
        dc.day = 18
        dc.timeZone = DateMath.denverTimeZone
        return DateMath.denverCalendar.date(from: dc)!
    }()

    @Test("Higher cashAtClose scores higher than matched installment offer")
    func cashBeatsInstallments() {
        let allCash = SettlementInputs(
            fromParty: "Roe",
            receivedAt: Self.receivedAt,
            totalAmount: 5_000_000,
            cashAtClose: 5_000_000
        )
        let split = SettlementInputs(
            fromParty: "Roe",
            receivedAt: Self.receivedAt,
            totalAmount: 5_000_000,
            cashAtClose: 3_000_000,
            installmentAmount: 500_000,
            installmentYears: 4
        )
        let scoreCash = SettlementScorer.score(offer: allCash, against: Self.baseInputs())
        let scoreSplit = SettlementScorer.score(offer: split, against: Self.baseInputs())
        #expect(scoreCash.adjustedRatio > scoreSplit.adjustedRatio)
        #expect(scoreCash.offerPresentValue > scoreSplit.offerPresentValue)
    }

    @Test("Adding one restrictive covenant reduces adjusted ratio by exactly 5% of raw")
    func covenantPenalty() {
        let clean = SettlementInputs(
            fromParty: "Moe",
            receivedAt: Self.receivedAt,
            totalAmount: 5_000_000,
            cashAtClose: 5_000_000
        )
        let withCovenant = SettlementInputs(
            fromParty: "Moe",
            receivedAt: Self.receivedAt,
            totalAmount: 5_000_000,
            cashAtClose: 5_000_000,
            restrictiveCovenants: ["non-disparagement"]
        )
        let scoreClean = SettlementScorer.score(offer: clean, against: Self.baseInputs())
        let scoreCovenant = SettlementScorer.score(offer: withCovenant, against: Self.baseInputs())
        #expect(scoreCovenant.adjustedRatio < scoreClean.adjustedRatio)
        #expect(abs(scoreCovenant.covenantPenalty - 0.95) < 1e-9)
        let expected = scoreClean.rawRatio * 0.95
        #expect(abs(scoreCovenant.adjustedRatio - expected) < 1e-9)
    }

    @Test("Each contingency reduces adjusted ratio by 3% until the 60% floor")
    func contingencyPenalty() {
        let oneCont = SettlementInputs(
            fromParty: "Granite Mutual",
            receivedAt: Self.receivedAt,
            totalAmount: 4_000_000,
            cashAtClose: 4_000_000,
            contingencies: ["insurer approval"]
        )
        let score = SettlementScorer.score(offer: oneCont, against: Self.baseInputs())
        #expect(abs(score.contingencyPenalty - 0.97) < 1e-9)
    }

    @Test("Restrictive covenant penalty respects 50% floor")
    func covenantFloor() {
        let manyCovs = (0..<15).map { "covenant \($0)" }
        let offer = SettlementInputs(
            fromParty: "any",
            receivedAt: Self.receivedAt,
            totalAmount: 1_000_000,
            cashAtClose: 1_000_000,
            restrictiveCovenants: manyCovs
        )
        let score = SettlementScorer.score(offer: offer, against: Self.baseInputs())
        #expect(abs(score.covenantPenalty - 0.50) < 1e-9)
    }

    @Test("Markdown rationale includes from-party and interpretation sentence")
    func rationaleMarkdown() {
        let offer = SettlementInputs(
            fromParty: "Roe",
            receivedAt: Self.receivedAt,
            totalAmount: 5_000_000,
            cashAtClose: 5_000_000
        )
        let score = SettlementScorer.score(offer: offer, against: Self.baseInputs())
        #expect(score.rationaleMarkdown.contains("Roe"))
        #expect(score.rationaleMarkdown.contains("Settlement Score"))
        #expect(score.rationaleMarkdown.contains("Interpretation"))
    }

    @Test("Zero trebled produces zero ratios and flag text in markdown")
    func zeroTrebledBase() {
        let zeroBase = DamagesInputs(
            startingAUM: 0,
            annualGrowthRate: 0,
            managementFeeRate: 0,
            claimantFeeShare: 0,
            carryRate: 0,
            partnerAllocation: 0,
            claimantCarryShare: 0,
            discountRate: 0.10,
            horizonYears: 5,
            terminalGrowthRate: 0
        )
        let offer = SettlementInputs(
            fromParty: "anyone",
            receivedAt: Self.receivedAt,
            totalAmount: 1_000_000,
            cashAtClose: 1_000_000
        )
        let score = SettlementScorer.score(offer: offer, against: zeroBase)
        #expect(score.rawRatio == 0)
        #expect(score.adjustedRatio == 0)
        #expect(score.rationaleMarkdown.contains("not meaningful"))
    }
}
