// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListDeadlinesTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_deadlines",
        description: "List case deadlines. Optional filters: satisfied (bool), withinDays (integer, upcoming unsatisfied deadlines within N days), anchor (filing|service|answer|atIssue|cmc|trial|custom).",
        inputSchema: [
            "type": "object",
            "properties": [
                "satisfied": ["type": "boolean"],
                "withinDays": ["type": "integer", "minimum": 0],
                "anchor": ["type": "string", "enum": AnchorEvent.allCases.map { $0.rawValue }]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let satisfied: Bool?
        let withinDays: Int?
        let anchor: AnchorEvent?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(satisfied: nil, withinDays: nil, anchor: nil)

        var deadlines = try context.modelContext.fetch(FetchDescriptor<Deadline>())
        if let satisfied = args.satisfied {
            deadlines = deadlines.filter { $0.isSatisfied == satisfied }
        }
        if let anchor = args.anchor {
            deadlines = deadlines.filter { $0.anchor == anchor }
        }
        if let withinDays = args.withinDays {
            let now = Date()
            let cutoff = DateMath.addDays(withinDays, to: DateMath.startOfDay(now))
            deadlines = deadlines.filter { !$0.isSatisfied && $0.computedDate >= now && $0.computedDate <= cutoff }
        }
        deadlines.sort { $0.computedDate < $1.computedDate }

        let out: [[String: Any]] = deadlines.map { d in
            [
                "title": d.title,
                "anchor": d.anchor.rawValue,
                "anchorDate": d.anchorDate.map(Formatters.isoDate.string(from:)) as Any,
                "offsetDays": d.offsetDays,
                "direction": d.direction.rawValue,
                "computedDate": Formatters.isoDate.string(from: d.computedDate),
                "isSatisfied": d.isSatisfied,
                "ruleCitation": d.ruleCitation as Any,
                "source": d.source.rawValue,
                "reminderCount": d.reminders.count
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
