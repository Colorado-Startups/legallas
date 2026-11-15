// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

@MainActor
public final class ExportCaseTool: MCPTool {

    public let definition = MCPToolDefinition(
        name: "legallas_export_case",
        description: "Write the current case state to \(AppSettings.exportFileName) so the Claude Desktop project can ingest it. Returns the destination path.",
        inputSchema: [
            "type": "object",
            "properties": [
                "destination": [
                    "type": "string",
                    "description": "Optional absolute path. Defaults to <documentsFolder>/\(AppSettings.exportFileName)."
                ]
            ],
            "required": []
        ]
    )

    public init() {}

    struct Args: Decodable {
        let destination: String?
    }

    public func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String {
        let args: Args = try params?.decode(as: Args.self) ?? Args(destination: nil)
        let url: URL
        if let destination = args.destination, !destination.isEmpty {
            url = URL(fileURLWithPath: destination)
        } else {
            url = context.inboxPaths.exportFile
        }
        try CaseExporter.writeExport(from: context.modelContext, to: url)
        return "Exported case to \(url.path)."
    }
}
