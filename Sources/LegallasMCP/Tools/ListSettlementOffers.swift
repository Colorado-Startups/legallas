// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListSettlementOffersTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_settlement_offers",
        description: "List all settlement offers on the case with their nominal totals, installment schedules, restrictive covenants, contingencies, and cached score markdown.",
        inputSchema: [
            "type": "object",
            "properties": [:],
            "required": []
        ]
    )

    public init() {}

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        var offers = try context.modelContext.fetch(FetchDescriptor<SettlementOffer>())
        offers.sort { $0.receivedAt > $1.receivedAt }

        let out: [[String: Any]] = offers.map { o in
            [
                "fromParty": o.fromParty,
                "receivedAt": Formatters.isoDate.string(from: o.receivedAt),
                "totalAmount": decimalString(o.totalAmount),
                "totalAmountFormatted": Formatters.formatMoney(o.totalAmount),
                "cashAtClose": decimalString(o.cashAtClose),
                "cashAtCloseFormatted": Formatters.formatMoney(o.cashAtClose),
                "installmentAmount": o.installmentAmount.map(decimalString) as Any,
                "installmentYears": o.installmentYears as Any,
                "restrictiveCovenants": o.restrictiveCovenants,
                "contingencies": o.contingencies,
                "scoreSummaryMarkdown": o.scoreSummaryMarkdown as Any
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }

    private func decimalString(_ d: Decimal) -> String {
        NSDecimalNumber(decimal: d).stringValue
    }
}
