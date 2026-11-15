// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("LegallasMCPSubprocess")
struct MCPSubprocessTests {

    // Resolves to <repo-root>/.build/debug/LegallasMCP via the source file path.
    static var binaryURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // MCPSubprocessTests.swift
            .deletingLastPathComponent()  // LegallasE2ETests/
            .deletingLastPathComponent()  // Tests/
            .appendingPathComponent(".build/debug/LegallasMCP")
    }

    static let initializeRequest: Data = {
        Data(#"{"jsonrpc":"2.0","id":"e2e-init","method":"initialize","params":{}}"# .utf8) + Data([0x0a])
    }()

    @MainActor
    @Test("LegallasMCP binary starts and returns a valid initialize response")
    func binaryHandlesInitialize() throws {
        guard FileManager.default.fileExists(atPath: Self.binaryURL.path) else {
            // Binary not built; run: swift build --product LegallasMCP
            return
        }

        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas-e2e-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let storeURL = tmp.appendingPathComponent("e2e.store")
        // Create the store so the subprocess can open it read-only.
        _ = try ModelContainerFactory.makeReadWriteContainer(storeURL: storeURL)

        let process = Process()
        process.executableURL = Self.binaryURL
        process.arguments = ["--store", storeURL.path, "--inbox", tmp.path]

        let stdinPipe = Pipe()
        let stdoutPipe = Pipe()
        process.standardInput = stdinPipe
        process.standardOutput = stdoutPipe
        process.standardError = Pipe()

        try process.run()

        // Write initialize then close stdin; the server exits its read loop when stdin closes.
        stdinPipe.fileHandleForWriting.write(Self.initializeRequest)
        stdinPipe.fileHandleForWriting.closeFile()

        // Schedule a terminate fallback in case the process hangs.
        DispatchQueue.global().asyncAfter(deadline: .now() + 10) {
            if process.isRunning { process.terminate() }
        }

        // Block until the process closes stdout (normal exit after stdin EOF).
        let responseData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let responseText = String(data: responseData, encoding: .utf8) ?? ""
        let preview = responseText.prefix(200)
        #expect(responseText.contains("legallas"), "Expected 'legallas' in initialize response; got: \(preview)")
    }
}
