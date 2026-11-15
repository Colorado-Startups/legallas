// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A Markdown note on a case, linkable to tasks, documents, contacts and events.
@Model
public final class Note {
    /// Note title, if it has one.
    public var title: String?
    /// Note body in Markdown.
    public var bodyMarkdown: String = ""
    /// When the note was created.
    public var createdAt: Date = Date()
    /// When the note was last changed.
    public var updatedAt: Date = Date()
    /// Stored raw value of where the note came from.
    public var sourceRaw: String = DataSource.user.rawValue

    /// Case the note belongs to.
    public var `case`: Case?

    /// Tasks linked to the note.
    @Relationship(deleteRule: .nullify)
    public var tasks: [CaseTask] = []

    /// Documents linked to the note.
    @Relationship(deleteRule: .nullify)
    public var documents: [Document] = []

    /// Contacts linked to the note.
    @Relationship(deleteRule: .nullify)
    public var contacts: [Contact] = []

    /// Chronology events linked to the note.
    @Relationship(deleteRule: .nullify)
    public var events: [ChronologyEvent] = []

    /// Whether the user, Claude or an import created the note; an unreadable stored value reads as user.
    public var source: DataSource {
        get { DataSource(rawValue: sourceRaw) ?? .user }
        set { sourceRaw = newValue.rawValue }
    }

    /// Creates a note; the title is optional and the body defaults to empty.
    public init(
        title: String? = nil,
        bodyMarkdown: String = "",
        source: DataSource = .user
    ) {
        self.title = title
        self.bodyMarkdown = bodyMarkdown
        self.createdAt = Date()
        self.updatedAt = Date()
        self.sourceRaw = source.rawValue
    }
}
