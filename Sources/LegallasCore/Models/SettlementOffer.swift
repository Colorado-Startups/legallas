// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A settlement offer received on a case, with its cash, installments, covenants and contingencies.
@Model
public final class SettlementOffer {
    /// Date the offer was received.
    public var receivedAt: Date = Date()
    /// Party that made the offer.
    public var fromParty: String = ""
    /// Total nominal amount offered.
    public var totalAmount: Decimal = 0
    /// Cash paid at closing.
    public var cashAtClose: Decimal = 0
    /// Amount of each yearly installment, if any.
    public var installmentAmount: Decimal?
    /// Number of yearly installments, if any.
    public var installmentYears: Int?
    /// Restrictive covenants attached to the offer.
    public var restrictiveCovenants: [String] = []
    /// Contingencies attached to the offer.
    public var contingencies: [String] = []
    /// Markdown summary of the offer's score, if it was scored.
    public var scoreSummaryMarkdown: String?

    /// Case the offer belongs to.
    public var `case`: Case?

    /// Creates an offer; installments, covenants and contingencies default to none.
    public init(
        receivedAt: Date = Date(),
        fromParty: String,
        totalAmount: Decimal,
        cashAtClose: Decimal,
        installmentAmount: Decimal? = nil,
        installmentYears: Int? = nil,
        restrictiveCovenants: [String] = [],
        contingencies: [String] = []
    ) {
        self.receivedAt = receivedAt
        self.fromParty = fromParty
        self.totalAmount = totalAmount
        self.cashAtClose = cashAtClose
        self.installmentAmount = installmentAmount
        self.installmentYears = installmentYears
        self.restrictiveCovenants = restrictiveCovenants
        self.contingencies = contingencies
    }
}
