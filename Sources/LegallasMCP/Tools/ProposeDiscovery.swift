// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ProposeDiscoveryTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_propose_discovery",
        description: "Propose a new discovery item (interrogatory set, RFP, RFA, deposition, subpoena) for the owner to review. Writes a JSON proposal to the inbox; the app surfaces it for Accept/Reject.",
        inputSchema: [
            "type": "object",
            "properties": [
                "category": ["type": "string", "enum": DiscoveryCategory.allCases.map { $0.rawValue }],
                "direction": ["type": "string", "enum": DiscoveryDirection.allCases.map { $0.rawValue }],
                "setNumber": ["type": "integer", "minimum": 1],
                "itemNumber": ["type": "integer", "minimum": 1],
                "subject": ["type": "string", "minLength": 1],
                "servedAt": ["type": "string", "format": "date"],
                "dueAt": ["type": "string", "format": "date"],
                "status": ["type": "string", "enum": DiscoveryStatus.allCases.map { $0.rawValue }],
                "responseText": ["type": "string"],
                "notes": ["type": "string"],
                "documentTitles": ["type": "array", "items": ["type": "string"]],
                "contactNames": ["type": "array", "items": ["type": "string"]],
                "rationale": ["type": "string"]
            ],
            "required": ["category", "direction", "setNumber", "subject", "servedAt"]
        ]
    )

    public init() {}

    struct Args: Decodable {
        let category: DiscoveryCategory
        let direction: DiscoveryDirection
        let setNumber: Int
        let itemNumber: Int?
        let subject: String
        let servedAt: Date
        let dueAt: Date?
        let status: DiscoveryStatus?
        let responseText: String?
        let notes: String?
        let documentTitles: [String]?
        let contactNames: [String]?
        let rationale: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        guard let params = params else { throw JSONRPCError.invalidParams }
        let args = try params.decode(as: Args.self)
        let payload = DiscoveryItemPayload(
            category: args.category,
            direction: args.direction,
            setNumber: args.setNumber,
            itemNumber: args.itemNumber,
            subject: args.subject,
            servedAt: args.servedAt,
            dueAt: args.dueAt,
            status: args.status,
            responseText: args.responseText,
            notes: args.notes,
            documentTitles: args.documentTitles,
            contactNames: args.contactNames
        )
        let envelope = ProposalEnvelope(
            type: .discoveryItem,
            rationale: args.rationale,
            payload: .discoveryItem(payload)
        )
        try context.inboxPaths.ensureDirectoriesExist()
        let data = try ProposalCodec.encode(envelope)
        let url = context.inboxPaths.pendingFile(id: envelope.id)
        try data.write(to: url, options: .atomic)
        let itemLabel = args.itemNumber.map { " #\($0)" } ?? ""
        return "Proposed \(args.category.shortLabel) Set \(args.setNumber)\(itemLabel): '\(args.subject)'. Pending at \(url.path)."
    }
}
