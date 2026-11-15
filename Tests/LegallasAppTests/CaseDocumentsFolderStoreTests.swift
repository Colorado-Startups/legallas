// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("CaseDocumentsFolderStore")
@MainActor
struct CaseDocumentsFolderStoreTests {

    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func makeCaseContext() throws -> (ModelContext, Case) {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let kase = Case(name: "Test", caseNumber: "1", court: "Court", judge: "Judge", filingDate: Date())
        context.insert(kase)
        return (context, kase)
    }

    /// A parent temp folder holding the case folder, so tests can rename the case folder inside it.
    private func makeParent() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas_docsfolder_\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func makeFolder(_ name: String, in parent: URL) throws -> URL {
        let url = parent.appendingPathComponent(name, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func dropProposal(in folder: URL) throws {
        let paths = InboxPaths(documentsFolder: folder)
        try paths.ensureDirectoriesExist()
        let envelope = ProposalEnvelope(type: .note, payload: .note(NotePayload(bodyMarkdown: "Test note")))
        try ProposalCodec.encode(envelope).write(to: paths.pendingFile(id: envelope.id))
    }

    /// Bookmark resolution can return /private/var where FileManager says /var.
    private func samePath(_ lhs: URL?, _ rhs: URL) -> Bool {
        lhs?.resolvingSymlinksInPath().path == rhs.resolvingSymlinksInPath().path
    }

    @Test("choosing a folder saves a bookmark that resolves to it, plus the path and verified date")
    func chooseRecordsBookmarkAndPath() throws {
        let (context, kase) = try makeCaseContext()
        let parent = try makeParent()
        defer { try? FileManager.default.removeItem(at: parent) }
        let folder = try makeFolder("Docs", in: parent)

        try CaseDocumentsFolderStore.choose(folder, for: kase, in: context, now: now)

        let bookmark = try #require(kase.documentsFolderBookmark)
        let resolved = try BookmarkResolver.resolve(bookmark)
        #expect(samePath(resolved.url, folder))
        #expect(!resolved.isStale)
        #expect(kase.documentsFolderLastKnownPath == folder.path)
        #expect(kase.documentsFolderLastVerifiedAt == now)
        #expect(!context.hasChanges)
    }

    @Test("setting the folder changes the observer's key, and the refresh it triggers starts the watcher there")
    func choosingTriggersObserverRefresh() throws {
        let (context, kase) = try makeCaseContext()
        let parent = try makeParent()
        defer { try? FileManager.default.removeItem(at: parent) }
        let folder = try makeFolder("Docs", in: parent)
        try dropProposal(in: folder)
        let controller = InboxWatcherController()
        defer { controller.stop() }

        // What InboxFolderObserver does: refresh at launch (initial), then on each key change.
        let before = InboxFolderObserver.FolderKey(kase)
        controller.refresh(in: context)
        #expect(controller.watchedFolder == nil)

        try CaseDocumentsFolderStore.choose(folder, for: kase, in: context, now: now)
        #expect(InboxFolderObserver.FolderKey(kase) != before)
        controller.refresh(in: context)

        #expect(samePath(controller.watchedFolder, folder))
        #expect(try context.fetchCount(FetchDescriptor<InboxProposal>()) == 1)
    }

    @Test("a stale bookmark (folder renamed) is re-saved to the new location, once")
    func staleBookmarkIsRefreshed() throws {
        let (context, kase) = try makeCaseContext()
        let parent = try makeParent()
        defer { try? FileManager.default.removeItem(at: parent) }
        let original = try makeFolder("Docs", in: parent)
        try CaseDocumentsFolderStore.choose(original, for: kase, in: context, now: now)
        let oldBookmark = kase.documentsFolderBookmark

        let renamed = parent.appendingPathComponent("Docs Renamed", isDirectory: true)
        try FileManager.default.moveItem(at: original, to: renamed)
        let later = now.addingTimeInterval(60)

        #expect(CaseDocumentsFolderStore.refreshIfStale(in: context, now: later))
        #expect(kase.documentsFolderBookmark != oldBookmark)
        let resolved = try BookmarkResolver.resolve(try #require(kase.documentsFolderBookmark))
        #expect(!resolved.isStale)
        #expect(samePath(resolved.url, renamed))
        #expect(samePath(kase.documentsFolderLastKnownPath.map { URL(fileURLWithPath: $0) }, renamed))
        #expect(kase.documentsFolderLastVerifiedAt == later)
        #expect(!context.hasChanges)

        #expect(!CaseDocumentsFolderStore.refreshIfStale(in: context, now: later))
    }

    @Test("the watcher follows a renamed folder because refresh re-saves the stale bookmark first")
    func controllerFollowsRenamedFolder() throws {
        let (context, kase) = try makeCaseContext()
        let parent = try makeParent()
        defer { try? FileManager.default.removeItem(at: parent) }
        let original = try makeFolder("Docs", in: parent)
        try CaseDocumentsFolderStore.choose(original, for: kase, in: context, now: now)
        let renamed = parent.appendingPathComponent("Docs Renamed", isDirectory: true)
        try FileManager.default.moveItem(at: original, to: renamed)
        try dropProposal(in: renamed)
        let controller = InboxWatcherController()
        defer { controller.stop() }

        controller.refresh(in: context)

        #expect(samePath(controller.watchedFolder, renamed))
        #expect(try context.fetchCount(FetchDescriptor<InboxProposal>()) == 1)
    }

    @Test("no bookmark means nothing to refresh")
    func noBookmarkNoRefresh() throws {
        let (context, kase) = try makeCaseContext()
        kase.documentsFolderLastKnownPath = "/tmp/legallas_no_bookmark"
        #expect(!CaseDocumentsFolderStore.refreshIfStale(in: context, now: now))
        #expect(kase.documentsFolderBookmark == nil)
    }
}
