// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

public struct DiscoveryEditorDraft: Sendable {
    public var category: DiscoveryCategory
    public var direction: DiscoveryDirection
    public var setNumber: Int
    public var itemNumber: Int?
    public var subject: String
    public var servedAt: Date
    public var dueAt: Date?
    public var status: DiscoveryStatus
    public var responseText: String
    public var notes: String
    public var documentIDs: Set<PersistentIdentifier>
    public var contactIDs: Set<PersistentIdentifier>

    public init(
        category: DiscoveryCategory = .interrogatories,
        direction: DiscoveryDirection = .propounded,
        setNumber: Int = 1,
        itemNumber: Int? = nil,
        subject: String = "",
        servedAt: Date = Date(),
        dueAt: Date? = nil,
        status: DiscoveryStatus = .outstanding,
        responseText: String = "",
        notes: String = "",
        documentIDs: Set<PersistentIdentifier> = [],
        contactIDs: Set<PersistentIdentifier> = []
    ) {
        self.category = category
        self.direction = direction
        self.setNumber = setNumber
        self.itemNumber = itemNumber
        self.subject = subject
        self.servedAt = servedAt
        self.dueAt = dueAt
        self.status = status
        self.responseText = responseText
        self.notes = notes
        self.documentIDs = documentIDs
        self.contactIDs = contactIDs
    }
}

@MainActor
public enum DiscoveryEditorService {

    @discardableResult
    public static func apply(
        _ draft: DiscoveryEditorDraft,
        existing: DiscoveryItem?,
        caseOwner: Case?,
        context: ModelContext,
        allDocuments: [Document],
        allContacts: [Contact]
    ) -> DiscoveryItem {
        let trimmedSubject = draft.subject.trimmingCharacters(in: .whitespaces)
        let resolvedItemNumber = supportsItemNumber(draft.category) ? draft.itemNumber : nil

        let item: DiscoveryItem
        if let existing {
            item = existing
            item.category = draft.category
            item.direction = draft.direction
            item.setNumber = draft.setNumber
            item.itemNumber = resolvedItemNumber
            item.subject = trimmedSubject
            item.servedAt = draft.servedAt
            item.dueAt = draft.dueAt
            item.status = draft.status
            item.responseText = draft.responseText
            item.notes = draft.notes
        } else {
            item = DiscoveryItem(
                category: draft.category,
                direction: draft.direction,
                setNumber: draft.setNumber,
                itemNumber: resolvedItemNumber,
                subject: trimmedSubject,
                servedAt: draft.servedAt,
                dueAt: draft.dueAt,
                status: draft.status,
                responseText: draft.responseText,
                notes: draft.notes
            )
            context.insert(item)
            caseOwner?.discoveryItems.append(item)
        }

        item.documents = allDocuments.filter { draft.documentIDs.contains($0.persistentModelID) }
        item.contacts = allContacts.filter { draft.contactIDs.contains($0.persistentModelID) }

        try? context.save()
        return item
    }

    public static func supportsItemNumber(_ category: DiscoveryCategory) -> Bool {
        category != .deposition && category != .subpoena
    }
}
