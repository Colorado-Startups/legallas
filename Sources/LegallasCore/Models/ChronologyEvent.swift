// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A dated entry on the case chronology, linked to documents, contacts and notes.
@Model
public final class ChronologyEvent {
    /// Short event title.
    public var title: String = ""
    /// Date of the event.
    public var date: Date = Date()
    /// Stored raw value of the event type.
    public var typeRaw: String = EventType.custom.rawValue
    /// Short description of what happened.
    public var summary: String = ""
    /// Stored raw value of where the event came from.
    public var sourceRaw: String = DataSource.user.rawValue

    /// Case the event belongs to.
    public var `case`: Case?

    /// Documents linked to the event.
    @Relationship(deleteRule: .nullify, inverse: \Document.events)
    public var documents: [Document] = []

    /// Contacts linked to the event.
    @Relationship(deleteRule: .nullify, inverse: \Contact.events)
    public var contacts: [Contact] = []

    /// Notes linked to the event.
    @Relationship(deleteRule: .nullify, inverse: \Note.events)
    public var notes: [Note] = []

    /// Kind of event; an unreadable stored value reads as custom.
    public var type: EventType {
        get { EventType(rawValue: typeRaw) ?? .custom }
        set { typeRaw = newValue.rawValue }
    }

    /// Whether the user, Claude or an import created the event; an unreadable stored value reads as user.
    public var source: DataSource {
        get { DataSource(rawValue: sourceRaw) ?? .user }
        set { sourceRaw = newValue.rawValue }
    }

    /// Creates a chronology event; the summary is empty and the source is user unless given.
    public init(
        title: String,
        date: Date,
        type: EventType,
        summary: String = "",
        source: DataSource = .user
    ) {
        self.title = title
        self.date = date
        self.typeRaw = type.rawValue
        self.summary = summary
        self.sourceRaw = source.rawValue
    }
}
