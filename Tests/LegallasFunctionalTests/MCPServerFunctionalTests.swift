// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import LegallasMCP

@Suite("MCPServerFunctional")
struct MCPServerFunctionalTests {

    @MainActor
    static func makeServer() throws -> (MCPServer, URL) {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas-functional-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let paths = InboxPaths(documentsFolder: tmp)
        try paths.ensureDirectoriesExist()

        let serverContext = ServerContext(
            storeURL: tmp.appendingPathComponent("test.store"),
            inboxPaths: paths
        )
        let provider = ContainerProvider(serverContext: serverContext, container: container)
        let server = MCPServer(provider: provider)

        server.register(CaseSummaryTool())
        server.register(ListTasksTool())
        server.register(ProposeTaskTool())
        server.register(ListDeadlinesTool())
        server.register(SearchTool())

        return (server, tmp)
    }

    @MainActor
    @Test("initialize returns server info with name 'legallas'")
    func initializeReturnsServerInfo() throws {
        let (server, tmp) = try Self.makeServer()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let req = JSONRPCRequest(jsonrpc: "2.0", id: .string("init"), method: "initialize", params: nil)
        let data = try #require(server.handleRequest(req))

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let result = json?["result"] as? [String: Any]
        let serverInfo = result?["serverInfo"] as? [String: Any]
        #expect(serverInfo?["name"] as? String == "legallas")
    }

    @MainActor
    @Test("tools/list returns all registered tools")
    func toolsListReturnsRegistered() throws {
        let (server, tmp) = try Self.makeServer()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let req = JSONRPCRequest(jsonrpc: "2.0", id: .string("1"), method: "tools/list", params: nil)
        let data = try #require(server.handleRequest(req))

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let result = json?["result"] as? [String: Any]
        let tools = result?["tools"] as? [[String: Any]] ?? []

        #expect(tools.count == 5)
        let names = tools.compactMap { $0["name"] as? String }
        #expect(names.contains("legallas_get_case_summary"))
        #expect(names.contains("legallas_propose_task"))
    }

    @MainActor
    @Test("unknown method returns JSON-RPC error -32601")
    func unknownMethodReturnsError() throws {
        let (server, tmp) = try Self.makeServer()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let req = JSONRPCRequest(jsonrpc: "2.0", id: .int(99), method: "no/such/method", params: nil)
        let data = try #require(server.handleRequest(req))

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let error = json?["error"] as? [String: Any]
        #expect(error?["code"] as? Int == -32601)
    }
}
