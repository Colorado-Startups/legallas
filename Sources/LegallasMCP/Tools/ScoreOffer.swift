// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ScoreOfferTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_score_offer",
        description: "Read-only: score a settlement offer against the base-tier damages scenario. Identify the offer by fromParty plus receivedAt (ISO date). Returns ratios and the markdown rationale without writing to the store.",
        inputSchema: [
            "type": "object",
            "properties": [
                "fromParty": ["type": "string", "minLength": 1],
                "receivedAt": ["type": "string", "format": "date"]
            ],
            "required": ["fromParty", "receivedAt"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let fromParty: String
        let receivedAt: String
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)

        guard let parsedDate = Formatters.parseISODate(args.receivedAt) else {
            throw JSONRPCError(code: -32602, message: "Could not parse receivedAt as an ISO date: '\(args.receivedAt)'.")
        }

        let offers = try context.modelContext.fetch(FetchDescriptor<SettlementOffer>())
        let targetDay = DateMath.startOfDay(parsedDate)
        guard let offer = offers.first(where: {
            $0.fromParty.caseInsensitiveCompare(args.fromParty) == .orderedSame
                && DateMath.denverCalendar.isDate($0.receivedAt, inSameDayAs: targetDay)
        }) else {
            throw JSONRPCError(code: -32602, message: "No settlement offer found from '\(args.fromParty)' on \(Formatters.isoDate.string(from: parsedDate)).")
        }

        let scenarios = try context.modelContext.fetch(FetchDescriptor<DamagesScenario>())
        guard let base = scenarios.first(where: { $0.tier == .base }) else {
            throw JSONRPCError(code: -32603, message: "No base-tier damages scenario is present. Create one before scoring offers.")
        }

        let offerInputs = SettlementInputs(from: offer)
        let baseInputs = DamagesInputs(from: base)
        let score = SettlementScorer.score(offer: offerInputs, against: baseInputs)

        let out: [String: Any] = [
            "fromParty": offer.fromParty,
            "receivedAt": Formatters.isoDate.string(from: offer.receivedAt),
            "baseScenario": base.name,
            "offerPresentValue": NSDecimalNumber(decimal: score.offerPresentValue).stringValue,
            "offerPresentValueFormatted": Formatters.formatMoney(score.offerPresentValue),
            "rawRatio": score.rawRatio,
            "covenantPenalty": score.covenantPenalty,
            "contingencyPenalty": score.contingencyPenalty,
            "adjustedPresentValue": NSDecimalNumber(decimal: score.adjustedPresentValue).stringValue,
            "adjustedPresentValueFormatted": Formatters.formatMoney(score.adjustedPresentValue),
            "adjustedRatio": score.adjustedRatio,
            "trebledNPV": NSDecimalNumber(decimal: score.trebledNPV).stringValue,
            "trebledNPVFormatted": Formatters.formatMoney(score.trebledNPV),
            "rationaleMarkdown": score.rationaleMarkdown
        ]
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
