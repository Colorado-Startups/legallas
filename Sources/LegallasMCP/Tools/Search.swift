// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class SearchTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_search",
        description: "Cross-entity case-insensitive substring search across task titles/details, deadline titles/citations, note titles/bodies, and chronology event titles/summaries.",
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
        guard let params = params else {
            throw JSONRPCError.invalidParams
        }
        let args = try params.decode(as: Args.self)
        let q = args.query.lowercased()
        let limit = args.limit ?? 50

        var hits: [[String: Any]] = []

        for t in try context.modelContext.fetch(FetchDescriptor<CaseTask>()) {
            if t.title.lowercased().contains(q) || t.details.lowercased().contains(q) {
                hits.append([
                    "entity": "task",
                    "title": t.title,
                    "snippet": snippet(t.details, around: q),
                    "status": t.status.rawValue
                ])
            }
        }
        for d in try context.modelContext.fetch(FetchDescriptor<Deadline>()) {
            if d.title.lowercased().contains(q) || (d.ruleCitation?.lowercased().contains(q) ?? false) {
                hits.append([
                    "entity": "deadline",
                    "title": d.title,
                    "snippet": d.ruleCitation ?? "",
                    "computedDate": Formatters.isoDate.string(from: d.computedDate)
                ])
            }
        }
        for n in try context.modelContext.fetch(FetchDescriptor<Note>()) {
            if (n.title?.lowercased().contains(q) ?? false) || n.bodyMarkdown.lowercased().contains(q) {
                hits.append([
                    "entity": "note",
                    "title": n.title ?? "(untitled)",
                    "snippet": snippet(n.bodyMarkdown, around: q)
                ])
            }
        }
        for e in try context.modelContext.fetch(FetchDescriptor<ChronologyEvent>()) {
            if e.title.lowercased().contains(q) || e.summary.lowercased().contains(q) {
                hits.append([
                    "entity": "event",
                    "title": e.title,
                    "snippet": snippet(e.summary, around: q),
                    "date": Formatters.isoDate.string(from: e.date)
                ])
            }
        }

        hits = Array(hits.prefix(limit))
        let data = try JSONSerialization.data(withJSONObject: hits, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }

    private func snippet(_ text: String, around needle: String, window: Int = 80) -> String {
        guard let range = text.range(of: needle, options: .caseInsensitive) else {
            return String(text.prefix(window))
        }
        let start = text.index(range.lowerBound, offsetBy: -window, limitedBy: text.startIndex) ?? text.startIndex
        let end = text.index(range.upperBound, offsetBy: window, limitedBy: text.endIndex) ?? text.endIndex
        let prefix = start > text.startIndex ? "…" : ""
        let suffix = end < text.endIndex ? "…" : ""
        return prefix + String(text[start..<end]) + suffix
    }
}
