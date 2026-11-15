// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListEventsTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_events",
        description: "List chronology events. Optional filters: type (filing|service|pleading|discovery|meeting|communication|milestone|deadline|order|custom), since (ISO date), until (ISO date).",
        inputSchema: [
            "type": "object",
            "properties": [
                "type": ["type": "string", "enum": EventType.allCases.map { $0.rawValue }],
                "since": ["type": "string", "format": "date"],
                "until": ["type": "string", "format": "date"]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let type: EventType?
        let since: String?
        let until: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(type: nil, since: nil, until: nil)

        var events = try context.modelContext.fetch(FetchDescriptor<ChronologyEvent>())
        if let type = args.type {
            events = events.filter { $0.type == type }
        }
        if let sinceString = args.since {
            guard let sinceDate = Formatters.parseISODate(sinceString) else {
                throw JSONRPCError(code: -32602, message: "Could not parse since as an ISO date: '\(sinceString)'.")
            }
            events = events.filter { $0.date >= DateMath.startOfDay(sinceDate) }
        }
        if let untilString = args.until {
            guard let untilDate = Formatters.parseISODate(untilString) else {
                throw JSONRPCError(code: -32602, message: "Could not parse until as an ISO date: '\(untilString)'.")
            }
            events = events.filter { $0.date <= DateMath.startOfDay(untilDate) }
        }
        events.sort { $0.date < $1.date }

        let out: [[String: Any]] = events.map { e in
            [
                "title": e.title,
                "date": Formatters.isoDate.string(from: e.date),
                "type": e.type.rawValue,
                "summary": e.summary,
                "source": e.source.rawValue,
                "documentTitles": e.documents.map(\.title),
                "contactNames": e.contacts.map(\.name)
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
