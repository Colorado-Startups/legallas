// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeEventTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_event",
        description: "Propose a new chronology event for the owner to review. Writes a JSON proposal to the inbox; the app surfaces it for Accept/Reject.",
        inputSchema: [
            "type": "object",
            "properties": [
                "title": ["type": "string", "minLength": 1],
                "date": ["type": "string", "format": "date"],
                "type": ["type": "string", "enum": EventType.allCases.map { $0.rawValue }],
                "summary": ["type": "string"],
                "rationale": ["type": "string"]
            ],
            "required": ["title", "date", "type", "summary"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let title: String
        let date: Date
        let type: EventType
        let summary: String
        let rationale: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let payload = EventPayload(
            title: args.title,
            date: args.date,
            type: args.type,
            summary: args.summary
        )
        let envelope = ProposalEnvelope(
            type: .event,
            rationale: args.rationale,
            payload: .event(payload)
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        return "Proposed event '\(args.title)' on \(Formatters.isoDate.string(from: args.date)). Pending at \(url.path)."
    }
}
