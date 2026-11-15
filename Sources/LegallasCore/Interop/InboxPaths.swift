// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Folder and file locations of the inbox that Claude and the app exchange proposals through.
public struct InboxPaths: Sendable {
    /// Inbox folder inside the case documents folder.
    public let root: URL
    /// Folder holding proposal files awaiting review.
    public let pending: URL
    /// Folder holding proposal files the user accepted.
    public let accepted: URL
    /// Folder holding proposal files the user rejected.
    public let rejected: URL
    /// Path of the case export file in the documents folder.
    public let exportFile: URL

    /// Derives every inbox path from the case documents folder.
    public init(documentsFolder: URL) {
        self.root = documentsFolder.appendingPathComponent(AppSettings.inboxFolderName, isDirectory: true)
        self.pending = self.root.appendingPathComponent("pending", isDirectory: true)
        self.accepted = self.root.appendingPathComponent("accepted", isDirectory: true)
        self.rejected = self.root.appendingPathComponent("rejected", isDirectory: true)
        self.exportFile = documentsFolder.appendingPathComponent(AppSettings.exportFileName, isDirectory: false)
    }

    /// Creates the inbox folders that do not exist yet, throwing if one cannot be created.
    public func ensureDirectoriesExist() throws {
        let fm = FileManager.default
        for url in [root, pending, accepted, rejected] where !fm.fileExists(atPath: url.path) {
            try fm.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    /// Path of the pending proposal file for a proposal id.
    public func pendingFile(id: UUID) -> URL {
        pending.appendingPathComponent("\(id.uuidString).json", isDirectory: false)
    }

    /// Path of the accepted proposal file for a proposal id.
    public func acceptedFile(id: UUID) -> URL {
        accepted.appendingPathComponent("\(id.uuidString).json", isDirectory: false)
    }

    /// Path of the rejected proposal file for a proposal id.
    public func rejectedFile(id: UUID) -> URL {
        rejected.appendingPathComponent("\(id.uuidString).json", isDirectory: false)
    }
}
