// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListMotionsTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_motions",
        description: "List motions (MTD, MSJ, compel, protective, in limine, continuance, custom). Optional filters: status, filedBy (us|opponent).",
        inputSchema: [
            "type": "object",
            "properties": [
                "status": ["type": "string", "enum": MotionStatus.allCases.map { $0.rawValue }],
                "filedBy": ["type": "string", "enum": MotionFiler.allCases.map { $0.rawValue }]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let status: MotionStatus?
        let filedBy: MotionFiler?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(status: nil, filedBy: nil)

        var motions = try context.modelContext.fetch(FetchDescriptor<Motion>())
        if let status = args.status {
            motions = motions.filter { $0.status == status }
        }
        if let filedBy = args.filedBy {
            motions = motions.filter { $0.filedBy == filedBy }
        }
        motions.sort { $0.filedAt < $1.filedAt }

        let out: [[String: Any]] = motions.map { m in
            var row: [String: Any] = [
                "title": m.title,
                "motionType": m.motionType.rawValue,
                "filedBy": m.filedBy.rawValue,
                "filedAt": Formatters.isoDate.string(from: m.filedAt),
                "status": m.status.rawValue,
                "ruling": m.ruling,
                "notes": m.notes,
                "linkedDocumentTitles": m.documents.map(\.title)
            ]
            if let responseDueAt = m.responseDueAt {
                row["responseDueAt"] = Formatters.isoDate.string(from: responseDueAt)
            }
            if let replyDueAt = m.replyDueAt {
                row["replyDueAt"] = Formatters.isoDate.string(from: replyDueAt)
            }
            if let hearingAt = m.hearingAt {
                row["hearingAt"] = Formatters.isoDate.string(from: hearingAt)
            }
            return row
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
