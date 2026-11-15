// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListDocumentsTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_documents",
        description: "List imported case documents. Optional filters: tag (string, case-insensitive exact match), limit (integer).",
        inputSchema: [
            "type": "object",
            "properties": [
                "tag": ["type": "string"],
                "limit": ["type": "integer", "minimum": 1]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let tag: String?
        let limit: Int?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(tag: nil, limit: nil)

        var documents = try context.modelContext.fetch(FetchDescriptor<Document>())
        if let tag = args.tag?.lowercased() {
            documents = documents.filter { $0.tags.contains { $0.lowercased() == tag } }
        }
        documents.sort { $0.addedAt > $1.addedAt }
        if let limit = args.limit {
            documents = Array(documents.prefix(limit))
        }

        let out: [[String: Any]] = documents.map { d in
            [
                "title": d.title,
                "originalFilename": d.originalFilename,
                "tags": d.tags,
                "pageCount": d.pageCount as Any,
                "sha256": d.sha256 as Any,
                "addedAt": Formatters.isoDate.string(from: d.addedAt)
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
