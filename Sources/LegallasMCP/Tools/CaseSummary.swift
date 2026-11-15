// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class CaseSummaryTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_get_case_summary",
        description: "Returns current case metadata, parties by role, open claims, upcoming deadlines in the next 30 days, and task counts by status.",
        inputSchema: [
            "type": "object",
            "properties": [:],
            "required": []
        ]
    )

    public init() {}

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let cases = try context.modelContext.fetch(FetchDescriptor<Case>())
        guard let kase = cases.first else {
            return "{\"error\": \"No case found in store\"}"
        }

        let partiesByRole: [String: [String]] = Dictionary(grouping: kase.parties, by: { $0.role.rawValue })
            .mapValues { $0.map { $0.name } }

        let now = Date()
        let in30 = DateMath.addDays(30, to: DateMath.startOfDay(now))
        let upcomingDeadlines = kase.deadlines
            .filter { !$0.isSatisfied && $0.computedDate >= now && $0.computedDate <= in30 }
            .sorted { $0.computedDate < $1.computedDate }
            .map { d -> [String: Any] in
                [
                    "title": d.title,
                    "computedDate": Formatters.isoDate.string(from: d.computedDate),
                    "anchor": d.anchor.rawValue,
                    "offsetDays": d.offsetDays,
                    "ruleCitation": d.ruleCitation as Any
                ]
            }

        let statusCounts = Dictionary(grouping: kase.tasks, by: { $0.status.rawValue })
            .mapValues { $0.count }

        let openClaims = kase.claims
            .filter { $0.isSurvivingSummaryJudgment }
            .map { c -> [String: Any] in
                [
                    "type": c.type.rawValue,
                    "customLabel": c.customLabel as Any,
                    "isTrebleable": c.isTrebleable
                ]
            }

        // null until the case is filed, rather than the not-filed sentinel's year-1 date.
        let filingDate: Any = kase.isFiled ? Formatters.isoDate.string(from: kase.filingDate) : NSNull()

        let result: [String: Any] = [
            "case": [
                "name": kase.name,
                "caseNumber": kase.caseNumber,
                "court": kase.court,
                "judge": kase.judge,
                "courtroom": kase.courtroom,
                "filingDate": filingDate
            ],
            "partiesByRole": partiesByRole,
            "openClaims": openClaims,
            "upcomingDeadlines30d": upcomingDeadlines,
            "taskCountsByStatus": statusCounts
        ]

        let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
