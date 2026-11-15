// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeContactUpdateTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_contact_update",
        description: "Propose field updates to an existing contact identified by exact name match. Allowed field keys: organization, email, phone, address, notesSummary. The owner reviews before the changes land.",
        inputSchema: [
            "type": "object",
            "properties": [
                "contactName": ["type": "string", "minLength": 1],
                "fields": [
                    "type": "object",
                    "additionalProperties": ["type": "string"]
                ],
                "rationale": ["type": "string"]
            ],
            "required": ["contactName", "fields"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let contactName: String
        let fields: [String: String]
        let rationale: String?
    }

    static let allowedFields: Set<String> = [
        "organization", "email", "phone", "address", "notesSummary"
    ]

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)

        guard !args.fields.isEmpty else {
            throw JSONRPCError(code: -32602, message: "At least one field must be provided.")
        }
        let unknown = Set(args.fields.keys).subtracting(Self.allowedFields)
        guard unknown.isEmpty else {
            throw JSONRPCError(
                code: -32602,
                message: "Unknown field keys: \(unknown.sorted().joined(separator: ", ")). Allowed: \(Self.allowedFields.sorted().joined(separator: ", "))."
            )
        }

        let payload = ContactUpdatePayload(
            contactName: args.contactName,
            fields: args.fields
        )
        let envelope = ProposalEnvelope(
            type: .contactUpdate,
            rationale: args.rationale,
            payload: .contactUpdate(payload)
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        return "Proposed update to contact '\(args.contactName)' (\(args.fields.keys.sorted().joined(separator: ", "))). Pending at \(url.path)."
    }
}
