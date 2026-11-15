// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeMotionTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_motion",
        description: "Propose a new motion (MTD, MSJ, compel, protective, in limine, continuance, custom) for the owner to review. Writes a JSON proposal to the inbox; the app surfaces it for Accept/Reject.",
        inputSchema: [
            "type": "object",
            "properties": [
                "title": ["type": "string", "minLength": 1],
                "motionType": ["type": "string", "enum": MotionType.allCases.map { $0.rawValue }],
                "filedBy": ["type": "string", "enum": MotionFiler.allCases.map { $0.rawValue }],
                "filedAt": ["type": "string", "format": "date"],
                "responseDueAt": ["type": "string", "format": "date"],
                "replyDueAt": ["type": "string", "format": "date"],
                "hearingAt": ["type": "string", "format": "date-time"],
                "status": ["type": "string", "enum": MotionStatus.allCases.map { $0.rawValue }],
                "ruling": ["type": "string"],
                "notes": ["type": "string"],
                "documentTitles": ["type": "array", "items": ["type": "string"]],
                "rationale": ["type": "string"]
            ],
            "required": ["title", "motionType", "filedBy", "filedAt"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let title: String
        let motionType: MotionType
        let filedBy: MotionFiler
        let filedAt: Date
        let responseDueAt: Date?
        let replyDueAt: Date?
        let hearingAt: Date?
        let status: MotionStatus?
        let ruling: String?
        let notes: String?
        let documentTitles: [String]?
        let rationale: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let payload = MotionPayload(
            title: args.title,
            motionType: args.motionType,
            filedBy: args.filedBy,
            filedAt: args.filedAt,
            responseDueAt: args.responseDueAt,
            replyDueAt: args.replyDueAt,
            hearingAt: args.hearingAt,
            status: args.status,
            ruling: args.ruling,
            notes: args.notes,
            documentTitles: args.documentTitles
        )
        let envelope = ProposalEnvelope(
            type: .motion,
            rationale: args.rationale,
            payload: .motion(payload)
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        return "Proposed motion '\(args.title)' (\(args.motionType.shortLabel), \(args.filedBy.displayName)). Pending at \(url.path)."
    }
}
