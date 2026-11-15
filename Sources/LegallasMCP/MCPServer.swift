// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore
import SwiftData

public struct MCPToolDefinition {
    public let name: String
    public let description: String
    public let inputSchema: [String: Any]

    public init(name: String, description: String, inputSchema: [String: Any]) {
        self.name = name
        self.description = description
        self.inputSchema = inputSchema
    }

    public var asListEntry: [String: Any] {
        [
            "name": name,
            "description": description,
            "inputSchema": inputSchema
        ]
    }
}

@MainActor
public protocol MCPTool: AnyObject {
    var definition: MCPToolDefinition { get }
    func execute(params: RawJSON?, context: MCPExecutionContext) throws -> String
}

@MainActor
public struct MCPExecutionContext {
    public let modelContext: ModelContext
    public let inboxPaths: InboxPaths
}

/// The server's identity and the prefix its tool names carry.
public struct MCPServerInfo: Sendable {
    /// The prefix every tool is written with (`legallas_search` and so on), and the default `toolPrefix`.
    public static let defaultToolPrefix = "legallas_"

    public let name: String
    public let version: String
    public let protocolVersion: String
    /// The prefix tools are listed and called by: `--tool-prefix`, or `defaultToolPrefix`. The same pattern as the
    /// remote MCP's MCP_TOOL_PREFIX (web/worker/room-names.ts TOOL_PREFIX_PATTERN).
    public let toolPrefix: String

    public init(
        name: String = "legallas",
        version: String = "0.1.0",
        protocolVersion: String = "2024-11-05",
        toolPrefix: String = MCPServerInfo.defaultToolPrefix
    ) {
        self.name = name
        self.version = version
        self.protocolVersion = protocolVersion
        self.toolPrefix = toolPrefix
    }

    /// True for a lower-case letter, up to 15 more letters or digits, then an underscore.
    public static func isValidToolPrefix(_ prefix: String) -> Bool {
        prefix.range(of: "^[a-z][a-z0-9]{0,15}_$", options: .regularExpression) != nil
    }

    /// A tool's name as listed: `defaultToolPrefix` swapped for `toolPrefix`. Unchanged with the default prefix.
    public func listedName(_ name: String) -> String {
        guard toolPrefix != Self.defaultToolPrefix, name.hasPrefix(Self.defaultToolPrefix) else { return name }
        return toolPrefix + name.dropFirst(Self.defaultToolPrefix.count)
    }
}

@MainActor
public final class MCPServer {

    public let info: MCPServerInfo
    public let provider: ContainerProvider
    private var tools: [String: MCPTool] = [:]

    public init(info: MCPServerInfo = .init(), provider: ContainerProvider) {
        self.info = info
        self.provider = provider
    }

    /// Adds a tool under its listed name (`MCPServerInfo.listedName`), so it is called by the prefixed name too.
    public func register(_ tool: MCPTool) {
        tools[info.listedName(tool.definition.name)] = tool
    }

    public func handleRequest(_ request: JSONRPCRequest) -> Data? {
        switch request.method {
        case "initialize":
            return handleInitialize(request)
        case "notifications/initialized":
            return nil
        case "tools/list":
            return handleToolsList(request)
        case "tools/call":
            return handleToolsCall(request)
        default:
            guard let id = request.id else { return nil }
            return JSONRPC.errorResponse(id: id, error: .methodNotFound)
        }
    }

    private func handleInitialize(_ request: JSONRPCRequest) -> Data? {
        guard let id = request.id else { return nil }
        let result: [String: Any] = [
            "protocolVersion": info.protocolVersion,
            "capabilities": [
                "tools": [:]
            ],
            "serverInfo": [
                "name": info.name,
                "version": info.version
            ]
        ]
        return JSONRPC.successResponse(id: id, result: result)
    }

    private func handleToolsList(_ request: JSONRPCRequest) -> Data? {
        guard let id = request.id else { return nil }
        let entries = tools
            .sorted { $0.key < $1.key }
            .map { name, tool in
                var entry = tool.definition.asListEntry
                entry["name"] = name
                return entry
            }
        return JSONRPC.successResponse(id: id, result: ["tools": entries])
    }

    private func handleToolsCall(_ request: JSONRPCRequest) -> Data? {
        guard let id = request.id else { return nil }
        guard let params = request.params else {
            return JSONRPC.errorResponse(id: id, error: .invalidParams)
        }
        guard let top = try? JSONSerialization.jsonObject(with: params.data) as? [String: Any],
              let name = top["name"] as? String else {
            return JSONRPC.errorResponse(id: id, error: .invalidParams)
        }
        guard let tool = tools[name] else {
            return JSONRPC.errorResponse(
                id: id,
                error: JSONRPCError(code: -32601, message: "Tool not found: \(name)")
            )
        }

        let argumentsRaw: RawJSON? = {
            guard let args = top["arguments"] else { return nil }
            guard let data = try? JSONSerialization.data(
                withJSONObject: args,
                options: [.sortedKeys]
            ) else { return nil }
            return RawJSON(data)
        }()

        let ctx = MCPExecutionContext(
            modelContext: provider.context,
            inboxPaths: provider.serverContext.inboxPaths
        )
        do {
            let text = try tool.execute(params: argumentsRaw, context: ctx)
            let result: [String: Any] = [
                "content": [
                    ["type": "text", "text": text]
                ]
            ]
            return JSONRPC.successResponse(id: id, result: result)
        } catch {
            return JSONRPC.errorResponse(
                id: id,
                error: JSONRPCError(code: -32603, message: "Tool error: \(error)")
            )
        }
    }
}
