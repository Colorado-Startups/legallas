// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListTasksTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_tasks",
        description: "List case tasks. Optional filters: status (toDo|inProgress|waiting|done), priority (low|medium|high|critical), dueBefore (ISO-8601 date), limit (integer).",
        inputSchema: [
            "type": "object",
            "properties": [
                "status": ["type": "string", "enum": ["toDo", "inProgress", "waiting", "done"]],
                "priority": ["type": "string", "enum": ["low", "medium", "high", "critical"]],
                "dueBefore": ["type": "string", "format": "date"],
                "limit": ["type": "integer", "minimum": 1]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let status: TaskStatus?
        let priority: Priority?
        let dueBefore: Date?
        let limit: Int?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(status: nil, priority: nil, dueBefore: nil, limit: nil)

        var tasks = try context.modelContext.fetch(FetchDescriptor<CaseTask>())
        if let s = args.status { tasks = tasks.filter { $0.status == s } }
        if let p = args.priority { tasks = tasks.filter { $0.priority == p } }
        if let dueBefore = args.dueBefore {
            tasks = tasks.filter { ($0.dueDate ?? .distantFuture) <= dueBefore }
        }
        tasks.sort { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }
        if let limit = args.limit {
            tasks = Array(tasks.prefix(limit))
        }

        let out: [[String: Any]] = tasks.map { t in
            [
                "title": t.title,
                "status": t.status.rawValue,
                "priority": t.priority.rawValue,
                "dueDate": t.dueDate.map(Formatters.isoDate.string(from:)) as Any,
                "category": t.category as Any,
                "source": t.source.rawValue,
                "details": t.details
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
