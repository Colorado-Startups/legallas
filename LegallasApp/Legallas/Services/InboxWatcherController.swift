// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "Inbox")

/// Owns the app's one InboxWatcher and the security-scoped access to the folder it watches.
/// `refresh(in:)` is cheap to call repeatedly: it restarts the watcher only when the case's
/// documents folder resolves to something different from what is being watched.
@MainActor
final class InboxWatcherController {

    private var folder: CaseDocumentsFolder?
    private var watcher: InboxWatcher?
    /// Non-nil while this controller holds security-scoped access, so teardown can release it.
    private var scopedURL: URL?

    /// The documents folder whose inbox is being watched, or nil when nothing is.
    var watchedFolder: URL? { watcher == nil ? nil : folder?.url }

    func refresh(in modelContext: ModelContext) {
        // A re-saved bookmark changes InboxFolderObserver's key; that second refresh is a no-op.
        CaseDocumentsFolderStore.refreshIfStale(in: modelContext)
        let resolved = CaseDocumentsFolder.resolve(in: modelContext)
        guard resolved != folder else { return }
        stop()
        folder = resolved
        guard let resolved else {
            logger.info("No documents folder on the case; inbox watcher not started")
            return
        }
        if resolved.isSecurityScoped {
            if resolved.url.startAccessingSecurityScopedResource() {
                scopedURL = resolved.url
            } else {
                logger.warning("Security-scoped access to the documents folder was not granted; trying without it")
            }
        }
        let candidate = InboxWatcher(modelContext: modelContext, paths: InboxPaths(documentsFolder: resolved.url))
        if candidate.start() {
            watcher = candidate
        } else {
            // Keep `folder` so the same failing folder is not retried on every refresh.
            releaseAccess()
        }
    }

    func stop() {
        watcher?.stop()
        watcher = nil
        folder = nil
        releaseAccess()
    }

    private func releaseAccess() {
        scopedURL?.stopAccessingSecurityScopedResource()
        scopedURL = nil
    }
}
