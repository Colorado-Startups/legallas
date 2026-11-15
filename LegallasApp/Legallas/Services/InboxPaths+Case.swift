// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "Inbox")

/// The case's documents folder in the form the sandbox honours: the security-scoped
/// bookmark when one is stored (as AutoExporter does), else the last known path.
struct CaseDocumentsFolder: Equatable {
    let url: URL
    /// True when `url` came from the bookmark, so access needs `startAccessingSecurityScopedResource()`.
    let isSecurityScoped: Bool

    @MainActor
    static func resolve(in modelContext: ModelContext) -> CaseDocumentsFolder? {
        guard let kase = try? modelContext.fetch(FetchDescriptor<Case>()).first else { return nil }
        return resolve(for: kase)
    }

    @MainActor
    static func resolve(for kase: Case) -> CaseDocumentsFolder? {
        if let bookmark = kase.documentsFolderBookmark {
            do {
                let resolved = try BookmarkResolver.resolve(bookmark)
                if resolved.isStale {
                    logger.info("The documents folder bookmark is stale; it still resolves but should be recreated")
                }
                return CaseDocumentsFolder(url: resolved.url, isSecurityScoped: true)
            } catch {
                let nsError = error as NSError
                logger.error("Resolving the documents folder bookmark failed (\(nsError.domain, privacy: .public) \(nsError.code, privacy: .public)); falling back to the stored path")
            }
        }
        guard let path = kase.documentsFolderLastKnownPath else { return nil }
        return CaseDocumentsFolder(url: URL(fileURLWithPath: path), isSecurityScoped: false)
    }
}

extension InboxPaths {

    /// The inbox under the case's documents folder, or nil until a folder has been chosen.
    /// InboxWatcherController and ProposalApplier both resolve through here so they agree on one folder.
    @MainActor
    static func forCase(in modelContext: ModelContext) -> InboxPaths? {
        CaseDocumentsFolder.resolve(in: modelContext).map { InboxPaths(documentsFolder: $0.url) }
    }
}
