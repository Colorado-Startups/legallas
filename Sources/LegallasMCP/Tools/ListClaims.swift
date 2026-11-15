// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListClaimsTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_claims",
        description: "List claims in the case. Optional filter: type (stateRacketeering|civilTheft|breachContract|breachFiduciaryDuty|fraud|conversion|unjustEnrichment|custom).",
        inputSchema: [
            "type": "object",
            "properties": [
                "type": ["type": "string", "enum": ClaimType.allCases.map { $0.rawValue }]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let type: ClaimType?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(type: nil)

        var claims = try context.modelContext.fetch(FetchDescriptor<Claim>())
        if let type = args.type {
            claims = claims.filter { $0.type == type }
        }
        claims.sort { $0.type.rawValue < $1.type.rawValue }

        let out: [[String: Any]] = claims.map { c in
            [
                "type": c.type.rawValue,
                "customLabel": c.customLabel as Any,
                "elements": c.elements,
                "isTrebleable": c.isTrebleable,
                "isSurvivingSummaryJudgment": c.isSurvivingSummaryJudgment,
                "statuteOfLimitations": c.statuteOfLimitations.map(Formatters.isoDate.string(from:)) as Any
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
