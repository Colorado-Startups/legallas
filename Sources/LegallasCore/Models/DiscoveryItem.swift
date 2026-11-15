// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A discovery request or response on a case, such as an interrogatory, request for production or deposition.
@Model
public final class DiscoveryItem {
    /// Stored raw value of the discovery category.
    public var categoryRaw: String = DiscoveryCategory.interrogatories.rawValue
    /// Stored raw value of the discovery direction.
    public var directionRaw: String = DiscoveryDirection.propounded.rawValue
    /// Number of the discovery set the item belongs to.
    public var setNumber: Int = 1
    /// Number of the item within its set, if any.
    public var itemNumber: Int?
    /// What the item is about.
    public var subject: String = ""
    /// Date the item was served.
    public var servedAt: Date = Date()
    /// Date a response is due, if set.
    public var dueAt: Date?
    /// Stored raw value of the item's response state.
    public var statusRaw: String = DiscoveryStatus.outstanding.rawValue
    /// Text of the response.
    public var responseText: String = ""
    /// Free-text notes on the item.
    public var notes: String = ""
    /// When the item was created.
    public var createdAt: Date = Date()

    /// Case the item belongs to.
    public var `case`: Case?

    /// Documents linked to the item.
    @Relationship(deleteRule: .nullify, inverse: \Document.discoveryItems)
    public var documents: [Document] = []

    /// Contacts linked to the item.
    @Relationship(deleteRule: .nullify, inverse: \Contact.discoveryItems)
    public var contacts: [Contact] = []

    /// Kind of discovery request; an unreadable stored value reads as interrogatories.
    public var category: DiscoveryCategory {
        get { DiscoveryCategory(rawValue: categoryRaw) ?? .interrogatories }
        set { categoryRaw = newValue.rawValue }
    }

    /// Whether the item was propounded by us or received; an unreadable stored value reads as propounded.
    public var direction: DiscoveryDirection {
        get { DiscoveryDirection(rawValue: directionRaw) ?? .propounded }
        set { directionRaw = newValue.rawValue }
    }

    /// Response state of the item; an unreadable stored value reads as outstanding.
    public var status: DiscoveryStatus {
        get { DiscoveryStatus(rawValue: statusRaw) ?? .outstanding }
        set { statusRaw = newValue.rawValue }
    }

    /// Creates a discovery item; status defaults to outstanding and the response and notes to empty.
    public init(
        category: DiscoveryCategory,
        direction: DiscoveryDirection,
        setNumber: Int,
        itemNumber: Int? = nil,
        subject: String,
        servedAt: Date,
        dueAt: Date? = nil,
        status: DiscoveryStatus = .outstanding,
        responseText: String = "",
        notes: String = ""
    ) {
        self.categoryRaw = category.rawValue
        self.directionRaw = direction.rawValue
        self.setNumber = setNumber
        self.itemNumber = itemNumber
        self.subject = subject
        self.servedAt = servedAt
        self.dueAt = dueAt
        self.statusRaw = status.rawValue
        self.responseText = responseText
        self.notes = notes
        self.createdAt = Date()
    }
}
