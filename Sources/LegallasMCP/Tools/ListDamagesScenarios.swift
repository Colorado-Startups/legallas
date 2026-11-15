// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListDamagesScenariosTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_damages",
        description: "List damages scenarios with cached NPV and trebled NPV. Optional filter: tier (conservative|base|aggressive).",
        inputSchema: [
            "type": "object",
            "properties": [
                "tier": ["type": "string", "enum": DamagesTier.allCases.map { $0.rawValue }]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let tier: DamagesTier?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(tier: nil)

        var scenarios = try context.modelContext.fetch(FetchDescriptor<DamagesScenario>())
        if let tier = args.tier {
            scenarios = scenarios.filter { $0.tier == tier }
        }
        scenarios.sort { $0.name < $1.name }

        let out: [[String: Any]] = scenarios.map { s in
            [
                "name": s.name,
                "tier": s.tier.rawValue,
                "startingAUM": decimalString(s.startingAUM),
                "startingAUMFormatted": Formatters.formatMoney(s.startingAUM),
                "annualGrowthRate": s.annualGrowthRate,
                "managementFeeRate": s.managementFeeRate,
                "claimantFeeShare": s.claimantFeeShare,
                "carryRate": s.carryRate,
                "partnerAllocation": s.partnerAllocation,
                "claimantCarryShare": s.claimantCarryShare,
                "discountRate": s.discountRate,
                "horizonYears": s.horizonYears,
                "terminalGrowthRate": s.terminalGrowthRate,
                "lostDistributions": decimalString(s.lostDistributions),
                "governancePremium": decimalString(s.governancePremium),
                "cachedNPV": s.cachedNPV.map(decimalString) as Any,
                "cachedNPVFormatted": s.cachedNPV.map(Formatters.formatMoney) as Any,
                "cachedTrebledNPV": s.cachedTrebledNPV.map(decimalString) as Any,
                "cachedTrebledNPVFormatted": s.cachedTrebledNPV.map(Formatters.formatMoney) as Any,
                "computedAt": s.computedAt.map(Formatters.isoDateTime.string(from:)) as Any
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }

    private func decimalString(_ d: Decimal) -> String {
        NSDecimalNumber(decimal: d).stringValue
    }
}
