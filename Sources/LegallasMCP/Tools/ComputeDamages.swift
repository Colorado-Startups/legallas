// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ComputeDamagesTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_compute_damages",
        description: "Read-only: run the DCF damages model against a named scenario and return the year-by-year waterfall, terminal value, NPV, and trebled NPV. Does not write to the store.",
        inputSchema: [
            "type": "object",
            "properties": [
                "name": ["type": "string", "minLength": 1]
            ],
            "required": ["name"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let name: String
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)

        let scenarios = try context.modelContext.fetch(FetchDescriptor<DamagesScenario>())
        guard let scenario = scenarios.first(where: { $0.name == args.name }) else {
            throw JSONRPCError(code: -32602, message: "No damages scenario named '\(args.name)'.")
        }

        let inputs = DamagesInputs(from: scenario)
        let result = DamagesCalculator.compute(inputs)

        let perYear: [[String: Any]] = result.perYear.map { row in
            [
                "year": row.year,
                "aumBegin": decimalString(row.aumBegin),
                "aumEnd": decimalString(row.aumEnd),
                "managementFee": decimalString(row.managementFee),
                "claimantManagementFee": decimalString(row.claimantManagementFee),
                "carry": decimalString(row.carry),
                "claimantCarry": decimalString(row.claimantCarry),
                "cashFlowToClaimant": decimalString(row.cashFlowToClaimant),
                "cashFlowToClaimantFormatted": Formatters.formatMoney(row.cashFlowToClaimant),
                "discountFactor": decimalString(row.discountFactor),
                "presentValue": decimalString(row.presentValue),
                "presentValueFormatted": Formatters.formatMoney(row.presentValue)
            ]
        }

        let out: [String: Any] = [
            "scenarioName": scenario.name,
            "tier": scenario.tier.rawValue,
            "perYear": perYear,
            "terminalValueUndiscounted": decimalString(result.terminalValueUndiscounted),
            "terminalValuePresentValue": decimalString(result.terminalValuePresentValue),
            "terminalValuePresentValueFormatted": Formatters.formatMoney(result.terminalValuePresentValue),
            "terminalValueClamped": result.terminalValueClamped,
            "lostDistributionsAdjustment": decimalString(result.lostDistributionsAdjustment),
            "governancePremiumAdjustment": decimalString(result.governancePremiumAdjustment),
            "npv": decimalString(result.npv),
            "npvFormatted": Formatters.formatMoney(result.npv),
            "trebledNPV": decimalString(result.trebledNPV),
            "trebledNPVFormatted": Formatters.formatMoney(result.trebledNPV)
        ]
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }

    private func decimalString(_ d: Decimal) -> String {
        NSDecimalNumber(decimal: d).stringValue
    }
}
