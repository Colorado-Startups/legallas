// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeNoteTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_note",
        description: "Propose a new markdown note for the case (strategy observation, meeting summary, etc.). The owner reviews before it lands.",
        inputSchema: [
            "type": "object",
            "properties": [
                "title": ["type": "string"],
                "bodyMarkdown": ["type": "string", "minLength": 1],
                "rationale": ["type": "string"]
            ],
            "required": ["bodyMarkdown"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let title: String?
        let bodyMarkdown: String
        let rationale: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let envelope = ProposalEnvelope(
            type: .note,
            rationale: args.rationale,
            payload: .note(NotePayload(title: args.title, bodyMarkdown: args.bodyMarkdown))
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        return "Proposed note \(args.title.map { "'\($0)'" } ?? "(untitled)"). Pending at \(url.path)."
    }
}
