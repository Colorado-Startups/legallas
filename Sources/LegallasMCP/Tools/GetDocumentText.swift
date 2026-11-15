// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class GetDocumentTextTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_get_document_text",
        description: "Return the extracted full text of a document. Identify it by exactly one of: title (case-insensitive substring), sha256 (hex digest). If multiple documents match the title, returns the first and includes ambiguousMatches count.",
        inputSchema: [
            "type": "object",
            "properties": [
                "title": ["type": "string"],
                "sha256": ["type": "string"]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let title: String?
        let sha256: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)

        let titleQuery = args.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hash = args.sha256?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let hasTitle = !(titleQuery?.isEmpty ?? true)
        let hasHash = !(hash?.isEmpty ?? true)

        guard hasTitle != hasHash else {
            throw JSONRPCError(code: -32602, message: "Provide exactly one of 'title' or 'sha256'.")
        }

        let documents = try context.modelContext.fetch(FetchDescriptor<Document>())

        let matches: [Document]
        if let hash, hasHash {
            matches = documents.filter { $0.sha256?.lowercased() == hash }
        } else if let titleQuery, hasTitle {
            matches = documents.filter { $0.title.range(of: titleQuery, options: .caseInsensitive) != nil }
        } else {
            matches = []
        }

        guard let document = matches.first else {
            throw JSONRPCError(code: -32602, message: "No document matched the supplied criteria.")
        }

        var out: [String: Any] = [
            "title": document.title,
            "originalFilename": document.originalFilename,
            "sha256": document.sha256 as Any,
            "pageCount": document.pageCount as Any,
            "fullTextContent": document.fullTextContent as Any
        ]
        if hasTitle, matches.count > 1 {
            out["ambiguousMatches"] = matches.count
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
