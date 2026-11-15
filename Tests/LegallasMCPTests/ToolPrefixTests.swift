// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import LegallasMCP

/// The tool prefix (`--tool-prefix`, `MCPServerInfo.toolPrefix`): unset, the server lists and calls every tool by
/// the name it had before the prefix was configurable; a renamed prefix renames every tool and nothing else.
@Suite("MCPToolPrefix")
struct ToolPrefixTests {

    /// Every tool main.swift registers, by the name each had before the prefix was configurable, sorted.
    static let todayNames = [
        "legallas_compute_damages", "legallas_export_case", "legallas_get_case_summary", "legallas_get_document_text",
        "legallas_list_claims", "legallas_list_contacts", "legallas_list_damages", "legallas_list_deadlines",
        "legallas_list_discovery", "legallas_list_documents", "legallas_list_events", "legallas_list_motions",
        "legallas_list_settlement_offers", "legallas_list_tasks", "legallas_propose_contact_update",
        "legallas_propose_deadline", "legallas_propose_discovery", "legallas_propose_event", "legallas_propose_motion",
        "legallas_propose_note", "legallas_propose_task", "legallas_score_offer", "legallas_search",
        "legallas_search_documents"
    ]

    /// A server with every tool main.swift registers, over a seeded in-memory store.
    @MainActor
    static func makeServer(info: MCPServerInfo) throws -> (MCPServer, URL) {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        try Seeding.seedIfNeeded(ModelContext(container), with: .sample)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let serverContext = ServerContext(storeURL: URL(fileURLWithPath: "/dev/null"), inboxPaths: InboxPaths(documentsFolder: tmp))
        let server = MCPServer(info: info, provider: ContainerProvider(serverContext: serverContext, container: container))
        let tools: [MCPTool] = [
            CaseSummaryTool(), ListTasksTool(), ListDeadlinesTool(), SearchTool(), ProposeTaskTool(),
            ProposeDeadlineTool(), ProposeNoteTool(), ListContactsTool(), ListDocumentsTool(), SearchDocumentsTool(),
            GetDocumentTextTool(), ProposeEventTool(), ProposeContactUpdateTool(), ListClaimsTool(),
            ListDamagesScenariosTool(), ListSettlementOffersTool(), ListEventsTool(), ComputeDamagesTool(),
            ScoreOfferTool(), ListDiscoveryTool(), ProposeDiscoveryTool(), ListMotionsTool(), ProposeMotionTool(),
            ExportCaseTool()
        ]
        for tool in tools { server.register(tool) }
        return (server, tmp)
    }

    @MainActor
    static func listed(_ server: MCPServer) throws -> [[String: Any]] {
        let request = #"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#
        let response = try #require(server.handleRequest(try JSONRPC.parseRequest(Data(request.utf8))))
        let object = try JSONSerialization.jsonObject(with: response) as? [String: Any]
        return ((object?["result"] as? [String: Any])?["tools"] as? [[String: Any]]) ?? []
    }

    @MainActor
    static func call(_ server: MCPServer, _ name: String) throws -> [String: Any] {
        let request = #"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"\#(name)","arguments":{}}}"#
        let response = try #require(server.handleRequest(try JSONRPC.parseRequest(Data(request.utf8))))
        return try JSONSerialization.jsonObject(with: response) as? [String: Any] ?? [:]
    }

    @Test("The default prefix is legallas_")
    func defaultPrefix() {
        #expect(MCPServerInfo.defaultToolPrefix == "legallas_")
        #expect(MCPServerInfo().toolPrefix == "legallas_")
        #expect(MCPServerInfo().listedName("legallas_search") == "legallas_search")
    }

    @MainActor
    @Test("With the default prefix, tools/list is byte for byte what the tools define")
    func defaultListUnchanged() throws {
        let (server, tmp) = try Self.makeServer(info: MCPServerInfo())
        defer { try? FileManager.default.removeItem(at: tmp) }
        let tools = try Self.listed(server)
        #expect(tools.compactMap { $0["name"] as? String } == Self.todayNames)

        let (explicit, tmp2) = try Self.makeServer(info: MCPServerInfo(toolPrefix: "legallas_"))
        defer { try? FileManager.default.removeItem(at: tmp2) }
        let request = try JSONRPC.parseRequest(Data(#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#.utf8))
        let unset = try #require(server.handleRequest(request))
        let set = try #require(explicit.handleRequest(request))
        let canonical = { (data: Data) throws -> Data in
            try JSONSerialization.data(withJSONObject: try JSONSerialization.jsonObject(with: data), options: [.sortedKeys])
        }
        #expect(try canonical(unset) == canonical(set))
    }

    @MainActor
    @Test("A renamed prefix lists and calls every tool by the new name only")
    func renamedPrefix() throws {
        let (server, tmp) = try Self.makeServer(info: MCPServerInfo(toolPrefix: "acme_"))
        defer { try? FileManager.default.removeItem(at: tmp) }
        let names = try Self.listed(server).compactMap { $0["name"] as? String }
        #expect(names == Self.todayNames.map { "acme_" + $0.dropFirst("legallas_".count) })

        let renamed = try Self.call(server, "acme_get_case_summary")
        let content = ((renamed["result"] as? [String: Any])?["content"] as? [[String: Any]]) ?? []
        #expect((content.first?["text"] as? String)?.contains(SeedMatter.sample.caseNumber) == true)

        let old = try Self.call(server, "legallas_get_case_summary")
        #expect((old["error"] as? [String: Any])?["code"] as? Int == -32601)
    }

    @Test("Only a lower-case letter, up to 15 more letters or digits, and an underscore is a prefix")
    func prefixPattern() {
        for good in ["acme_", "a_", "legallas_", "x1234567890abcde_"] {
            #expect(MCPServerInfo.isValidToolPrefix(good), "\(good)")
        }
        for bad in ["", "acme", "Acme_", "1acme_", "ac-me_", "acme__", "_", "x1234567890abcdef_", "acme_ x"] {
            #expect(!MCPServerInfo.isValidToolPrefix(bad), "\(bad)")
        }
    }
}
