// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("InboxWatcher")
@MainActor
struct InboxWatcherTests {

    private func makeContext() throws -> ModelContext {
        ModelContext(try ModelContainerFactory.makeInMemoryContainer())
    }

    private func makeTempFolder() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas_inboxwatcher_\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func makeCase() -> Case {
        Case(name: "Test", caseNumber: "1", court: "Court", judge: "Judge", filingDate: Date())
    }

    private func taskEnvelope(_ title: String) -> ProposalEnvelope {
        ProposalEnvelope(
            type: .task,
            rationale: "From the MCP",
            payload: .task(TaskPayload(title: title))
        )
    }

    /// Writes the file exactly where the MCP propose_* tools write it.
    private func writePending(_ envelope: ProposalEnvelope, to paths: InboxPaths) throws {
        try paths.ensureDirectoriesExist()
        try ProposalCodec.encode(envelope).write(to: paths.pendingFile(id: envelope.id))
    }

    @Test("start ingests files already in pending as pending rows on the case")
    func startIngestsExistingFiles() throws {
        let context = try makeContext()
        let kase = makeCase()
        context.insert(kase)
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let paths = InboxPaths(documentsFolder: folder)
        let envelope = taskEnvelope("Draft motion to compel")
        try writePending(envelope, to: paths)

        let watcher = InboxWatcher(modelContext: context, paths: paths)
        watcher.start()
        defer { watcher.stop() }

        let rows = try context.fetch(FetchDescriptor<InboxProposal>())
        #expect(rows.count == 1)
        #expect(rows.first?.externalId == envelope.id)
        #expect(rows.first?.status == .pending)
        #expect(rows.first?.proposalType == .task)
        #expect(rows.first?.rationale == "From the MCP")
        #expect(kase.inboxProposals.count == 1)
        let decoded = try ProposalCodec.decode(Data(try #require(rows.first).payloadJSON.utf8))
        #expect(decoded.id == envelope.id)
    }

    @Test("rescanning does not duplicate rows; new files are picked up")
    func rescanIsIdempotent() throws {
        let context = try makeContext()
        context.insert(makeCase())
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let paths = InboxPaths(documentsFolder: folder)
        try writePending(taskEnvelope("First"), to: paths)

        let watcher = InboxWatcher(modelContext: context, paths: paths)
        #expect(watcher.ingestPendingSnapshot() == 1)
        #expect(watcher.ingestPendingSnapshot() == 0)

        try writePending(taskEnvelope("Second"), to: paths)
        #expect(watcher.ingestPendingSnapshot() == 1)
        #expect(try context.fetch(FetchDescriptor<InboxProposal>()).count == 2)
    }

    @Test("non-UUID names, non-JSON files and undecodable JSON are skipped")
    func skipsUnusableFiles() throws {
        let context = try makeContext()
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let paths = InboxPaths(documentsFolder: folder)
        try paths.ensureDirectoriesExist()
        let junk = Data("not json".utf8)
        try junk.write(to: paths.pending.appendingPathComponent("notes.json"))
        try junk.write(to: paths.pending.appendingPathComponent("\(UUID().uuidString).txt"))
        try junk.write(to: paths.pendingFile(id: UUID()))

        let watcher = InboxWatcher(modelContext: context, paths: paths)
        #expect(watcher.ingestPendingSnapshot() == 0)
        #expect(try context.fetch(FetchDescriptor<InboxProposal>()).isEmpty)
    }

    @Test("a file written after start() is imported exactly once")
    func fileArrivingAfterStart() async throws {
        let context = try makeContext()
        context.insert(makeCase())
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let paths = InboxPaths(documentsFolder: folder)
        let watcher = InboxWatcher(modelContext: context, paths: paths)
        #expect(watcher.start())
        defer { watcher.stop() }

        let envelope = taskEnvelope("Arrives later")
        // An atomic write, as the MCP propose_* tools do: temp file, then rename into pending/.
        try ProposalCodec.encode(envelope).write(to: paths.pendingFile(id: envelope.id), options: .atomic)

        // The DispatchSource delivers on the main queue, which runs while this test awaits.
        // Polling is 60 s, so a row within the deadline can only come from the source.
        let deadline = Date().addingTimeInterval(5)
        while try context.fetch(FetchDescriptor<InboxProposal>()).isEmpty, Date() < deadline {
            try await Task.sleep(for: .milliseconds(20))
        }
        // Let any further events from the same write land before counting.
        try await Task.sleep(for: .milliseconds(250))

        let rows = try context.fetch(FetchDescriptor<InboxProposal>())
        #expect(rows.count == 1)
        #expect(rows.first?.externalId == envelope.id)
        #expect(watcher.ingestPendingSnapshot() == 0)
    }

    @Test("a file whose name and payload ids differ is skipped on every scan")
    func mismatchedIDsAreSkipped() throws {
        let context = try makeContext()
        context.insert(makeCase())
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let paths = InboxPaths(documentsFolder: folder)
        try paths.ensureDirectoriesExist()
        let envelope = taskEnvelope("Renamed")
        try ProposalCodec.encode(envelope).write(to: paths.pendingFile(id: UUID()))

        let watcher = InboxWatcher(modelContext: context, paths: paths)
        #expect(watcher.ingestPendingSnapshot() == 0)
        #expect(watcher.ingestPendingSnapshot() == 0)
        #expect(try context.fetch(FetchDescriptor<InboxProposal>()).isEmpty)
    }

    @Test("a missing pending folder imports nothing")
    func missingPendingFolder() throws {
        let context = try makeContext()
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }

        let watcher = InboxWatcher(modelContext: context, paths: InboxPaths(documentsFolder: folder))
        #expect(watcher.ingestPendingSnapshot() == 0)
    }

    @Test("start creates the inbox folders when they do not exist yet")
    func startCreatesDirectories() throws {
        let context = try makeContext()
        let folder = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let paths = InboxPaths(documentsFolder: folder)

        let watcher = InboxWatcher(modelContext: context, paths: paths)
        watcher.start()
        defer { watcher.stop() }

        #expect(FileManager.default.fileExists(atPath: paths.pending.path))
        #expect(FileManager.default.fileExists(atPath: paths.accepted.path))
        #expect(FileManager.default.fileExists(atPath: paths.rejected.path))
    }

    @Test("InboxPaths.forCase is nil without a documents folder and resolves under it otherwise")
    func pathsForCase() throws {
        let context = try makeContext()
        #expect(InboxPaths.forCase(in: context) == nil)

        let kase = makeCase()
        context.insert(kase)
        #expect(InboxPaths.forCase(in: context) == nil)

        kase.documentsFolderLastKnownPath = "/tmp/legallas_case_docs"
        let paths = try #require(InboxPaths.forCase(in: context))
        #expect(paths.pending.path == "/tmp/legallas_case_docs/legallas-inbox/pending")
    }
}
