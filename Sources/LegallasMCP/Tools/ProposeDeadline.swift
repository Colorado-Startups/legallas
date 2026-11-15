// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeDeadlineTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_deadline",
        description: "Propose a new deadline. The owner reviews and accepts before it lands with computed date + reminders.",
        inputSchema: [
            "type": "object",
            "properties": [
                "title": ["type": "string", "minLength": 1],
                "anchor": ["type": "string", "enum": AnchorEvent.allCases.map { $0.rawValue }],
                "anchorDate": ["type": "string", "format": "date"],
                "customAnchorLabel": ["type": "string"],
                "offsetDays": ["type": "integer", "minimum": 0],
                "direction": ["type": "string", "enum": ["before", "after"]],
                "ruleCitation": ["type": "string"],
                "notes": ["type": "string"],
                "rationale": ["type": "string"]
            ],
            "required": ["title", "anchor", "offsetDays"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let title: String
        let anchor: AnchorEvent
        let anchorDate: Date?
        let customAnchorLabel: String?
        let offsetDays: Int
        let direction: DeadlineDirection?
        let ruleCitation: String?
        let notes: String?
        let rationale: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let payload = DeadlinePayload(
            title: args.title,
            anchor: args.anchor,
            anchorDate: args.anchorDate,
            customAnchorLabel: args.customAnchorLabel,
            offsetDays: args.offsetDays,
            direction: args.direction ?? .after,
            ruleCitation: args.ruleCitation,
            notes: args.notes
        )
        let envelope = ProposalEnvelope(
            type: .deadline,
            rationale: args.rationale,
            payload: .deadline(payload)
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        return "Proposed deadline '\(args.title)' anchored to \(args.anchor.rawValue) offset \(args.offsetDays) days \(args.direction?.rawValue ?? "after"). Pending at \(url.path)."
    }
}
