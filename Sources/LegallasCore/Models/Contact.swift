// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A person or organization connected to a case, such as a party, counsel, expert or witness.
@Model
public final class Contact {
    /// Contact's full name.
    public var name: String = ""
    /// Stored raw value of the contact role.
    public var roleRaw: String = ContactRole.other.rawValue
    /// Organization the contact belongs to, if known.
    public var organization: String?
    /// Contact's email address, if known.
    public var email: String?
    /// Contact's phone number, if known.
    public var phone: String?
    /// Contact's postal address, if known.
    public var address: String?
    /// Short summary of notes about the contact.
    public var notesSummary: String?
    /// When the contact was created.
    public var createdAt: Date = Date()
    /// Stored raw value of where the contact came from.
    public var sourceRaw: String = DataSource.user.rawValue

    /// Cases the contact is connected to.
    public var cases: [Case] = []

    /// Notes linked to the contact.
    @Relationship(deleteRule: .nullify, inverse: \Note.contacts)
    public var notes: [Note] = []

    /// Chronology events linked to the contact.
    public var events: [ChronologyEvent] = []

    /// Discovery items linked to the contact.
    public var discoveryItems: [DiscoveryItem] = []

    /// Contact's role in the case; an unreadable stored value reads as other.
    public var role: ContactRole {
        get { ContactRole(rawValue: roleRaw) ?? .other }
        set { roleRaw = newValue.rawValue }
    }

    /// Whether the user, Claude or an import created the contact; an unreadable stored value reads as user.
    public var source: DataSource {
        get { DataSource(rawValue: sourceRaw) ?? .user }
        set { sourceRaw = newValue.rawValue }
    }

    /// Creates a contact; only the name and role are required.
    public init(
        name: String,
        role: ContactRole,
        organization: String? = nil,
        email: String? = nil,
        phone: String? = nil,
        address: String? = nil,
        notesSummary: String? = nil,
        source: DataSource = .user
    ) {
        self.name = name
        self.roleRaw = role.rawValue
        self.organization = organization
        self.email = email
        self.phone = phone
        self.address = address
        self.notesSummary = notesSummary
        self.createdAt = Date()
        self.sourceRaw = source.rawValue
    }
}
