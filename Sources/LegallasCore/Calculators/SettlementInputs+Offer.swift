// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

extension SettlementInputs {

    /// Builds settlement inputs by copying the terms of a stored settlement offer.
    @MainActor
    public init(from offer: SettlementOffer) {
        self.init(
            fromParty: offer.fromParty,
            receivedAt: offer.receivedAt,
            totalAmount: offer.totalAmount,
            cashAtClose: offer.cashAtClose,
            installmentAmount: offer.installmentAmount,
            installmentYears: offer.installmentYears,
            restrictiveCovenants: offer.restrictiveCovenants,
            contingencies: offer.contingencies
        )
    }
}
