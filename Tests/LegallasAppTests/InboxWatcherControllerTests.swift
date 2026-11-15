// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("InboxWatcherController")
@MainActor
struct InboxWatcherControllerTests {

    private func makeTempFolder() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas_inboxcontroller_\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func dropProposal(in folder: URL) throws {
        let paths = InboxPaths(documentsFolder: folder)
        try paths.ensureDirectoriesExist()
        let envelope = ProposalEnvelope(type: .note, payload: .note(NotePayload(bodyMarkdown: "From the MCP")))
        try ProposalCodec.encode(envelope).write(to: paths.pendingFile(id: envelope.id))
    }

    /// Bookmark resolution can return /private/var where FileManager says /var.
    private func samePath(_ lhs: URL?, _ rhs: URL) -> Bool {
        lhs?.resolvingSymlinksInPath().path == rhs.resolvingSymlinksInPath().path
    }

    @Test("refresh starts on the case folder, follows a change and stops when it is cleared")
    func followsFolderChanges() throws {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let kase = Case(name: "Test", caseNumber: "1", court: "Court", judge: "Judge", filingDate: Date())
        context.insert(kase)
        let first = try makeTempFolder()
        let second = try makeTempFolder()
        defer {
            try? FileManager.default.removeItem(at: first)
            try? FileManager.default.removeItem(at: second)
        }
        try dropProposal(in: first)
        try dropProposal(in: second)
        let controller = InboxWatcherController()
        defer { controller.stop() }

        controller.refresh(in: context)
        #expect(controller.watchedFolder == nil)

        kase.documentsFolderLastKnownPath = first.path
        controller.refresh(in: context)
        #expect(samePath(controller.watchedFolder, first))
        #expect(try context.fetchCount(FetchDescriptor<InboxProposal>()) == 1)

        controller.refresh(in: context)
        #expect(try context.fetchCount(FetchDescriptor<InboxProposal>()) == 1)

        kase.documentsFolderLastKnownPath = second.path
        controller.refresh(in: context)
        #expect(samePath(controller.watchedFolder, second))
        #expect(try context.fetchCount(FetchDescriptor<InboxProposal>()) == 2)

        kase.documentsFolderLastKnownPath = nil
        controller.refresh(in: context)
        #expect(controller.watchedFolder == nil)
    }

    @Test("a stored bookmark wins over the stored path")
    func bookmarkWins() throws {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let kase = Case(name: "Test", caseNumber: "1", court: "Court", judge: "Judge", filingDate: Date())
        context.insert(kase)
        let bookmarked = try makeTempFolder()
        defer { try? FileManager.default.removeItem(at: bookmarked) }
        kase.documentsFolderBookmark = try BookmarkResolver.makeBookmark(for: bookmarked)
        kase.documentsFolderLastKnownPath = "/nonexistent/legallas_stale_path"

        let folder = try #require(CaseDocumentsFolder.resolve(for: kase))
        #expect(folder.isSecurityScoped)
        #expect(samePath(folder.url, bookmarked))
        #expect(samePath(InboxPaths.forCase(in: context)?.pending.deletingLastPathComponent().deletingLastPathComponent(), bookmarked))

        let controller = InboxWatcherController()
        defer { controller.stop() }
        controller.refresh(in: context)
        #expect(samePath(controller.watchedFolder, bookmarked))
    }
}
