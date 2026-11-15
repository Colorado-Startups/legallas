// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

struct CLIArgs {
    var storePath: String?
    var inboxRoot: String?
    var toolPrefix: String?
    var printHelp: Bool = false
}

func parseCLIArgs(_ args: [String]) -> CLIArgs {
    var parsed = CLIArgs()
    var i = 1
    while i < args.count {
        let flag = args[i]
        switch flag {
        case "--store":
            i += 1
            if i < args.count { parsed.storePath = args[i] }
        case "--inbox":
            i += 1
            if i < args.count { parsed.inboxRoot = args[i] }
        case "--tool-prefix":
            i += 1
            if i < args.count { parsed.toolPrefix = args[i] }
        case "-h", "--help":
            parsed.printHelp = true
        default:
            break
        }
        i += 1
    }
    return parsed
}

let transport = StdioTransport()
let args = parseCLIArgs(CommandLine.arguments)
// The room's documents folder under the home folder, used when no `--inbox` is given.
let defaultDocumentsFolder = Seeding.roomMatter.documentsFolder

if args.printHelp {
    transport.logStderr("""
    \(AppSettings.helperName): stdio MCP server for the \(AppSettings.appName) macOS case tracker.

    Options:
      --store <path>   Absolute path to the \(AppSettings.appName) SwiftData store (required).
      --inbox <path>   Absolute path to the documents folder containing \(AppSettings.inboxFolderName)/.
                       If omitted, defaults to ~/\(defaultDocumentsFolder).
      --tool-prefix <p>
                       The prefix of every tool name: a lower-case letter, up to 15 more
                       letters or digits, then an underscore. If omitted, \(AppSettings.mcpToolPrefix).

    Usage (in Claude Desktop config):
      {
        "mcpServers": {
          "\(AppSettings.mcpServerName)": {
            "command": "/Users/<you>/Applications/\(AppSettings.appName).app/Contents/Helpers/\(AppSettings.helperName)",
            "args": [
              "--store", "/Users/<you>/Library/Containers/\(AppSettings.bundleIdentifier)/Data/Library/Application Support/\(AppSettings.storeFolderName)/default.store",
              "--inbox", "/Users/<you>/\(defaultDocumentsFolder)"
            ]
          }
        }
      }
    """)
    exit(0)
}

guard let storePath = args.storePath else {
    transport.logStderr("error: --store <path> is required. Pass -h for usage.")
    exit(64)
}

let toolPrefix = args.toolPrefix ?? AppSettings.mcpToolPrefix
guard MCPServerInfo.isValidToolPrefix(toolPrefix) else {
    transport.logStderr("error: --tool-prefix must be a lower-case letter, up to 15 more letters or digits, and an underscore.")
    exit(64)
}

let storeURL = URL(fileURLWithPath: storePath)
let inboxDocsURL: URL = {
    if let inboxRoot = args.inboxRoot {
        return URL(fileURLWithPath: inboxRoot)
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    return home.appendingPathComponent(defaultDocumentsFolder, isDirectory: true)
}()
let inboxPaths = InboxPaths(documentsFolder: inboxDocsURL)

await MainActor.run {
    do {
        let provider = try ContainerProvider(serverContext: ServerContext(storeURL: storeURL, inboxPaths: inboxPaths))
        let server = MCPServer(info: MCPServerInfo(name: AppSettings.mcpServerName, toolPrefix: toolPrefix), provider: provider)
        server.register(CaseSummaryTool())
        server.register(ListTasksTool())
        server.register(ListDeadlinesTool())
        server.register(SearchTool())
        server.register(ProposeTaskTool())
        server.register(ProposeDeadlineTool())
        server.register(ProposeNoteTool())
        server.register(ListContactsTool())
        server.register(ListDocumentsTool())
        server.register(SearchDocumentsTool())
        server.register(GetDocumentTextTool())
        server.register(ProposeEventTool())
        server.register(ProposeContactUpdateTool())
        server.register(ListClaimsTool())
        server.register(ListDamagesScenariosTool())
        server.register(ListSettlementOffersTool())
        server.register(ListEventsTool())
        server.register(ComputeDamagesTool())
        server.register(ScoreOfferTool())
        server.register(ListDiscoveryTool())
        server.register(ProposeDiscoveryTool())
        server.register(ListMotionsTool())
        server.register(ProposeMotionTool())
        server.register(ExportCaseTool())

        transport.logStderr("\(AppSettings.helperName) ready. store=\(storeURL.path) inbox=\(inboxDocsURL.path)")

        while let data = transport.readRequest() {
            let request: JSONRPCRequest
            do {
                request = try JSONRPC.parseRequest(data)
            } catch {
                transport.writeResponse(JSONRPC.errorResponse(id: nil, error: .parseError))
                continue
            }
            if let response = server.handleRequest(request) {
                transport.writeResponse(response)
            }
        }
    } catch {
        transport.logStderr("\(AppSettings.helperName) failed to start: \(error)")
        exit(1)
    }
}
