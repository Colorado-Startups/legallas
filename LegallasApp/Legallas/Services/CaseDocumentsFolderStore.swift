// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "DocumentsFolder")

/// Writes the case's documents folder: a security-scoped bookmark (what the sandbox honours
/// across launches) plus the path, shown in the UI and used when no bookmark resolves.
@MainActor
enum CaseDocumentsFolderStore {

    /// Records `url`, a folder the user just picked, as the case's documents folder.
    /// InboxFolderObserver sees the new bookmark and points the inbox watcher at it.
    static func choose(_ url: URL, for kase: Case, in context: ModelContext, now: Date = Date()) throws {
        let bookmark = try BookmarkResolver.makeBookmark(for: url)
        record(bookmark, path: url.path, on: kase, now: now)
        try context.save()
    }

    /// Re-saves the bookmark when macOS reports it stale (the folder was moved or renamed),
    /// pointing it and the stored path at where the folder is now. Returns true when it re-saved.
    @discardableResult
    static func refreshIfStale(in context: ModelContext, now: Date = Date()) -> Bool {
        guard let kase = try? context.fetch(FetchDescriptor<Case>()).first,
              let data = kase.documentsFolderBookmark,
              let resolved = try? BookmarkResolver.resolve(data),
              resolved.isStale else { return false }
        do {
            // Inside the sandbox, a new security-scoped bookmark needs access to the folder first.
            let fresh = try BookmarkResolver.withSecurityScope(url: resolved.url) { folder in
                try BookmarkResolver.makeBookmark(for: folder)
            }
            record(fresh, path: resolved.url.path, on: kase, now: now)
            try context.save()
            logger.info("Re-saved the stale documents folder bookmark")
            return true
        } catch {
            let nsError = error as NSError
            logger.error("Re-saving the stale documents folder bookmark failed (\(nsError.domain, privacy: .public) \(nsError.code, privacy: .public))")
            return false
        }
    }

    private static func record(_ bookmark: Data, path: String, on kase: Case, now: Date) {
        kase.documentsFolderBookmark = bookmark
        kase.documentsFolderLastKnownPath = path
        kase.documentsFolderLastVerifiedAt = now
        kase.updatedAt = now
    }
}
