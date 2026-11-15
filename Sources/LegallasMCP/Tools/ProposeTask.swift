// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeTaskTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_task",
        description: "Propose a new task (kanban card) for the owner to review and accept. Writes a JSON proposal to the inbox; the app surfaces it for Accept/Reject.",
        inputSchema: [
            "type": "object",
            "properties": [
                "title": ["type": "string", "minLength": 1],
                "details": ["type": "string"],
                "status": ["type": "string", "enum": TaskStatus.allCases.map { $0.rawValue }],
                "priority": ["type": "string", "enum": Priority.allCases.map { $0.rawValue }],
                "dueDate": ["type": "string", "format": "date"],
                "rationale": ["type": "string"]
            ],
            "required": ["title"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let title: String
        let details: String?
        let status: TaskStatus?
        let priority: Priority?
        let dueDate: Date?
        let rationale: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let payload = TaskPayload(
            title: args.title,
            details: args.details,
            status: args.status,
            priority: args.priority,
            dueDate: args.dueDate
        )
        let envelope = ProposalEnvelope(
            type: .task,
            rationale: args.rationale,
            payload: .task(payload)
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        return "Proposed task '\(args.title)'. Pending at \(url.path). The owner will review in the \(AppSettings.appName) Inbox before it lands as a CaseTask."
    }
}
