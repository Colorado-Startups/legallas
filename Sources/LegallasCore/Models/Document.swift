// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A file attached to a case, kept as a bookmark to its place on disk with optional extracted text.
@Model
public final class Document {
    /// Title shown for the document.
    public var title: String = ""
    /// File name the document had when it was added.
    public var originalFilename: String = ""
    /// Bookmark data that lets the app reopen the file.
    public var bookmarkData: Data = Data()
    /// Path of the file when the bookmark was last resolved.
    public var lastKnownPath: String = ""
    /// When the bookmark was created.
    public var bookmarkCreatedAt: Date = Date()
    /// When the bookmark was last checked.
    public var bookmarkLastVerifiedAt: Date?
    /// When the document was added to the case.
    public var addedAt: Date = Date()
    /// Tags attached to the document.
    public var tags: [String] = []
    /// Text extracted from the document, if any.
    public var fullTextContent: String?
    /// SHA-256 hash of the file contents as hex, if it was computed.
    public var sha256: String?
    /// Number of pages in the document, if known.
    public var pageCount: Int?

    /// Case the document belongs to.
    public var `case`: Case?

    /// Chronology events linked to the document.
    public var events: [ChronologyEvent] = []

    /// Discovery items linked to the document.
    public var discoveryItems: [DiscoveryItem] = []

    /// Motions linked to the document.
    public var motions: [Motion] = []

    /// Notes linked to the document.
    @Relationship(deleteRule: .nullify, inverse: \Note.documents)
    public var notes: [Note] = []

    /// Creates a document from its title, file name, bookmark data and last known path.
    public init(
        title: String,
        originalFilename: String,
        bookmarkData: Data,
        lastKnownPath: String,
        tags: [String] = []
    ) {
        self.title = title
        self.originalFilename = originalFilename
        self.bookmarkData = bookmarkData
        self.lastKnownPath = lastKnownPath
        self.bookmarkCreatedAt = Date()
        self.addedAt = Date()
        self.tags = tags
    }
}
