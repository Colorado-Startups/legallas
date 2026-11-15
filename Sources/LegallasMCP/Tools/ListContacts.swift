// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

@MainActor
public final class ListContactsTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_list_contacts",
        description: "List contacts on the case. Optional filters: role (plaintiff|defendant|plaintiffCounsel|defenseCounsel|expert|witness|courtStaff|vendor|other), limit (integer).",
        inputSchema: [
            "type": "object",
            "properties": [
                "role": ["type": "string", "enum": ContactRole.allCases.map { $0.rawValue }],
                "limit": ["type": "integer", "minimum": 1]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let role: ContactRole?
        let limit: Int?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args = try params?.decode(as: Args.self) ?? Args(role: nil, limit: nil)

        var contacts = try context.modelContext.fetch(FetchDescriptor<Contact>())
        if let role = args.role {
            contacts = contacts.filter { $0.role == role }
        }
        contacts.sort { $0.name < $1.name }
        if let limit = args.limit {
            contacts = Array(contacts.prefix(limit))
        }

        let out: [[String: Any]] = contacts.map { c in
            [
                "name": c.name,
                "role": c.role.rawValue,
                "organization": c.organization as Any,
                "email": c.email as Any,
                "phone": c.phone as Any,
                "source": c.source.rawValue
            ]
        }
        let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys, .prettyPrinted])
        return String(decoding: data, as: UTF8.self)
    }
}
