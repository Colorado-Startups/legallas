// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class SearchDocumentsTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_search_documents",
        description: "Full-text case-insensitive search across document titles and extracted PDF content. Returns title, pageCount, and a snippet for each hit.",
        inputSchema: [
            "type": "object",
            "properties": [
                "query": ["type": "string", "minLength": 1],
                "limit": ["type": "integer", "minimum": 1]
            ],
            "required": ["query"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let query: String
        let limit: Int?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let q = args.query
        let limit = args.limit ?? 20

        var hits: [[String: Any]] = []
        for d in try context.modelContext.fetch(FetchDescriptor<Document>()) {
            let titleMatch = d.title.range(of: q, options: .caseInsensitive) != nil
            let contentMatch = d.fullTextContent?.range(of: q, options: .caseInsensitive) != nil
            guard titleMatch || contentMatch else { continue }

            let snippet: String
            if contentMatch, let text = d.fullTextContent {
                snippet = makeSnippet(text: text, around: q)
            } else if let text = d.fullTextContent {
                snippet = String(text.prefix(200))
            } else {
                snippet = ""
            }

            hits.append([
                "title": d.title,
                "originalFilename": d.originalFilename,
                "pageCount": d.pageCount as Any,
                "sha256": d.sha256 as Any,
                "snippet": snippet
            ])
            if hits.count >= limit { break }
        }

        let data = try JSONSerialization.data(withJSONObject: hits, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }

    private func makeSnippet(text: String, around needle: String, window: Int = 100) -> String {
        guard let range = text.range(of: needle, options: .caseInsensitive) else {
            return String(text.prefix(200))
        }
        let start = text.index(range.lowerBound, offsetBy: -window, limitedBy: text.startIndex) ?? text.startIndex
        let end = text.index(range.upperBound, offsetBy: window, limitedBy: text.endIndex) ?? text.endIndex
        let prefix = start > text.startIndex ? "..." : ""
        let suffix = end < text.endIndex ? "..." : ""
        let body = String(text[start..<end]).replacingOccurrences(of: "\n", with: " ")
        return prefix + body + suffix
    }
}
