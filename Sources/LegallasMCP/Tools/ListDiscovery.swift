// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListDiscoveryTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_discovery",
        description: "List discovery items (interrogatories, RFPs, RFAs, depositions, subpoenas). Optional filters: category, direction (propounded|received), status.",
        inputSchema: [
            "type": "object",
            "properties": [
                "category": ["type": "string", "enum": DiscoveryCategory.allCases.map { $0.rawValue }],
                "direction": ["type": "string", "enum": DiscoveryDirection.allCases.map { $0.rawValue }],
                "status": ["type": "string", "enum": DiscoveryStatus.allCases.map { $0.rawValue }]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let category: DiscoveryCategory?
        let direction: DiscoveryDirection?
        let status: DiscoveryStatus?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(category: nil, direction: nil, status: nil)

        var items = try context.modelContext.fetch(FetchDescriptor<DiscoveryItem>())
        if let category = args.category {
            items = items.filter { $0.category == category }
        }
        if let direction = args.direction {
            items = items.filter { $0.direction == direction }
        }
        if let status = args.status {
            items = items.filter { $0.status == status }
        }
        items.sort { $0.servedAt < $1.servedAt }

        let out: [[String: Any]] = items.map { item in
            var row: [String: Any] = [
                "category": item.category.rawValue,
                "direction": item.direction.rawValue,
                "setNumber": item.setNumber,
                "subject": item.subject,
                "servedAt": Formatters.isoDate.string(from: item.servedAt),
                "status": item.status.rawValue,
                "responseText": item.responseText,
                "notes": item.notes,
                "linkedDocumentTitles": item.documents.map(\.title),
                "linkedContactNames": item.contacts.map(\.name)
            ]
            if let itemNumber = item.itemNumber {
                row["itemNumber"] = itemNumber
            }
            if let dueAt = item.dueAt {
                row["dueAt"] = Formatters.isoDate.string(from: dueAt)
            }
            return row
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
