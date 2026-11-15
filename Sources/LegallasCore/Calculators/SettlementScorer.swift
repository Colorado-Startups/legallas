// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Terms of a settlement offer to be scored.
public struct SettlementInputs: Sendable, Equatable {
    /// Name of the party that made the offer.
    public let fromParty: String
    /// Date the offer was received.
    public let receivedAt: Date
    /// Total nominal amount of the offer.
    public let totalAmount: Decimal
    /// Cash paid at closing.
    public let cashAtClose: Decimal
    /// Amount of each yearly installment, if the offer has installments.
    public let installmentAmount: Decimal?
    /// Number of yearly installments, if the offer has installments.
    public let installmentYears: Int?
    /// Descriptions of restrictive covenants attached to the offer.
    public let restrictiveCovenants: [String]
    /// Descriptions of contingencies attached to the offer.
    public let contingencies: [String]

    /// Creates settlement inputs; installments, covenants and contingencies default to none.
    public init(
        fromParty: String,
        receivedAt: Date,
        totalAmount: Decimal,
        cashAtClose: Decimal,
        installmentAmount: Decimal? = nil,
        installmentYears: Int? = nil,
        restrictiveCovenants: [String] = [],
        contingencies: [String] = []
    ) {
        self.fromParty = fromParty
        self.receivedAt = receivedAt
        self.totalAmount = totalAmount
        self.cashAtClose = cashAtClose
        self.installmentAmount = installmentAmount
        self.installmentYears = installmentYears
        self.restrictiveCovenants = restrictiveCovenants
        self.contingencies = contingencies
    }
}

/// Result of scoring an offer against the base damages model.
public struct SettlementScore: Sendable, Equatable {
    /// Present value of the offer: cash at close plus discounted installments.
    public let offerPresentValue: Decimal
    /// Offer present value divided by the trebled net present value.
    public let rawRatio: Double
    /// Multiplier of at most one that reduces the offer for restrictive covenants.
    public let covenantPenalty: Double
    /// Multiplier of at most one that reduces the offer for contingencies.
    public let contingencyPenalty: Double
    /// Offer present value after the covenant and contingency multipliers.
    public let adjustedPresentValue: Decimal
    /// Adjusted present value divided by the trebled net present value.
    public let adjustedRatio: Double
    /// Trebled net present value of the base damages model.
    public let trebledNPV: Decimal
    /// Markdown write-up of the score with tables and a one-line verdict.
    public let rationaleMarkdown: String
}

/// Scores settlement offers against a damages model.
public enum SettlementScorer {

    private static let covenantPerItem: Double = 0.05
    private static let covenantFloor: Double = 0.50
    private static let contingencyPerItem: Double = 0.03
    private static let contingencyFloor: Double = 0.60

    /// Scores an offer against the trebled net present value of the base damages inputs, adjusting for covenants and contingencies.
    public static func score(offer: SettlementInputs, against base: DamagesInputs) -> SettlementScore {
        let baseResult = DamagesCalculator.compute(base)
        let trebled = baseResult.trebledNPV
        let r = base.discountRate

        let installmentsPV: Decimal = {
            guard let amount = offer.installmentAmount,
                  let years = offer.installmentYears,
                  years > 0 else { return 0 }
            if r == 0 { return amount * Decimal(years) }
            var pv: Decimal = 0
            for t in 1...years {
                let df = Decimal(Foundation.pow(1.0 + r, -Double(t)))
                pv += amount * df
            }
            return pv
        }()
        let offerPV = offer.cashAtClose + installmentsPV

        let covCount = offer.restrictiveCovenants.count
        let conCount = offer.contingencies.count
        let covenantPenalty = max(covenantFloor, 1.0 - covenantPerItem * Double(covCount))
        let contingencyPenalty = max(contingencyFloor, 1.0 - contingencyPerItem * Double(conCount))
        let adjustedPV = offerPV * Decimal(covenantPenalty * contingencyPenalty)

        let trebledDouble = decimalToDouble(trebled)
        let offerPVDouble = decimalToDouble(offerPV)
        let adjustedPVDouble = decimalToDouble(adjustedPV)
        let rawRatio = trebledDouble == 0 ? 0 : offerPVDouble / trebledDouble
        let adjustedRatio = trebledDouble == 0 ? 0 : adjustedPVDouble / trebledDouble

        let markdown = buildMarkdown(
            offer: offer,
            trebled: trebled,
            offerPV: offerPV,
            installmentsPV: installmentsPV,
            adjustedPV: adjustedPV,
            covenantPenalty: covenantPenalty,
            contingencyPenalty: contingencyPenalty,
            rawRatio: rawRatio,
            adjustedRatio: adjustedRatio
        )

        return SettlementScore(
            offerPresentValue: offerPV,
            rawRatio: rawRatio,
            covenantPenalty: covenantPenalty,
            contingencyPenalty: contingencyPenalty,
            adjustedPresentValue: adjustedPV,
            adjustedRatio: adjustedRatio,
            trebledNPV: trebled,
            rationaleMarkdown: markdown
        )
    }

    private static func decimalToDouble(_ d: Decimal) -> Double {
        NSDecimalNumber(decimal: d).doubleValue
    }

    private static func buildMarkdown(
        offer: SettlementInputs,
        trebled: Decimal,
        offerPV: Decimal,
        installmentsPV: Decimal,
        adjustedPV: Decimal,
        covenantPenalty: Double,
        contingencyPenalty: Double,
        rawRatio: Double,
        adjustedRatio: Double
    ) -> String {
        let receivedString = Formatters.displayDate.string(from: offer.receivedAt)
        let cashLine = Formatters.formatMoney(offer.cashAtClose)
        let totalLine = Formatters.formatMoney(offer.totalAmount)
        let installmentAmountLine: String = offer.installmentAmount.map(Formatters.formatMoney) ?? "none"
        let installmentYearsLine: String = offer.installmentYears.map { "\($0) years" } ?? "none"
        let installmentsPVLine = Formatters.formatMoney(installmentsPV)
        let pvLine = Formatters.formatMoney(offerPV)
        let trebledLine = Formatters.formatMoney(trebled)
        let adjustedLine = Formatters.formatMoney(adjustedPV)

        let covSection: String = offer.restrictiveCovenants.isEmpty
            ? "- **Restrictive covenants (0)**: none"
            : "- **Restrictive covenants (\(offer.restrictiveCovenants.count))**:\n"
                + offer.restrictiveCovenants.map { "  - \($0)" }.joined(separator: "\n")
        let conSection: String = offer.contingencies.isEmpty
            ? "- **Contingencies (0)**: none"
            : "- **Contingencies (\(offer.contingencies.count))**:\n"
                + offer.contingencies.map { "  - \($0)" }.joined(separator: "\n")

        let verdict: String = {
            if trebled == 0 {
                return "Base trebled NPV is zero; ratios are not meaningful. Set up a base-tier damages scenario before relying on this score."
            }
            switch adjustedRatio {
            case 0.80...: return "Strong offer. Within 20% of the trebled recovery after adjustments."
            case 0.50..<0.80: return "Reasonable offer. Below trebled but above the single-damages benchmark."
            case 0.25..<0.50: return "Weak offer. Worth a counter; below a litigation-risk-adjusted midpoint."
            default: return "Low offer. Opening-position territory; counter or walk."
            }
        }()

        return """
        ## Settlement Score

        **Offer from \(offer.fromParty)** received \(receivedString)

        | | Value |
        | --- | --- |
        | Cash at close | \(cashLine) |
        | Installment (annual) | \(installmentAmountLine) |
        | Installment term | \(installmentYearsLine) |
        | Installments present value | \(installmentsPVLine) |
        | Total nominal | \(totalLine) |
        | **Present value** | **\(pvLine)** |

        ## Comparison to Base Damages

        | | Value |
        | --- | --- |
        | Base trebled NPV | \(trebledLine) |
        | Raw ratio (PV / trebled) | \(formatPercent(rawRatio)) |
        | Covenant multiplier | \(formatPercent(covenantPenalty)) |
        | Contingency multiplier | \(formatPercent(contingencyPenalty)) |
        | **Adjusted PV** | **\(adjustedLine)** |
        | **Adjusted ratio** | **\(formatPercent(adjustedRatio))** |

        ## Adjustments

        \(covSection)
        \(conSection)

        ## Interpretation

        \(verdict)
        """
    }

    private static func formatPercent(_ value: Double) -> String {
        String(format: "%.1f%%", value * 100)
    }
}
