// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import Legallas

@Suite("DiscoveryEditorService")
struct DiscoveryEditorServiceTests {

    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        return ctx
    }

    @MainActor
    @Test("apply with existing=nil inserts a new item and appends to case.discoveryItems")
    func applyInsertsNew() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        #expect(kase.discoveryItems.isEmpty)
        let draft = DiscoveryEditorDraft(
            category: .interrogatories,
            direction: .propounded,
            setNumber: 1,
            itemNumber: 4,
            subject: "  Delivery invoices  ",
            servedAt: Date(timeIntervalSince1970: 1_360_000_000),
            dueAt: Date(timeIntervalSince1970: 1_362_592_000),
            status: .outstanding
        )
        let item = DiscoveryEditorService.apply(
            draft,
            existing: nil,
            caseOwner: kase,
            context: ctx,
            allDocuments: [],
            allContacts: []
        )

        let fetched = try ctx.fetch(FetchDescriptor<DiscoveryItem>())
        #expect(fetched.count == 1)
        #expect(kase.discoveryItems.count == 1)
        #expect(item.subject == "Delivery invoices")
        #expect(item.itemNumber == 4)
        #expect(item.category == .interrogatories)
    }

    @MainActor
    @Test("apply with existing mutates in place and does not duplicate")
    func applyUpdatesExisting() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let original = DiscoveryItem(
            category: .rfp,
            direction: .propounded,
            setNumber: 1,
            subject: "Original subject",
            servedAt: Date()
        )
        ctx.insert(original)
        kase.discoveryItems.append(original)
        try ctx.save()

        let draft = DiscoveryEditorDraft(
            category: .rfp,
            direction: .received,
            setNumber: 1,
            subject: "Updated subject",
            servedAt: original.servedAt,
            status: .responded,
            responseText: "Produced"
        )
        let updated = DiscoveryEditorService.apply(
            draft,
            existing: original,
            caseOwner: kase,
            context: ctx,
            allDocuments: [],
            allContacts: []
        )

        let fetched = try ctx.fetch(FetchDescriptor<DiscoveryItem>())
        #expect(fetched.count == 1)
        #expect(updated.persistentModelID == original.persistentModelID)
        #expect(updated.subject == "Updated subject")
        #expect(updated.direction == .received)
        #expect(updated.status == .responded)
        #expect(updated.responseText == "Produced")
    }

    @MainActor
    @Test("apply with category=.deposition strips itemNumber even if draft supplied one")
    func depositionStripsItemNumber() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let draft = DiscoveryEditorDraft(
            category: .deposition,
            direction: .propounded,
            setNumber: 1,
            itemNumber: 99,
            subject: "Depo of Carol Count",
            servedAt: Date()
        )
        let item = DiscoveryEditorService.apply(
            draft,
            existing: nil,
            caseOwner: kase,
            context: ctx,
            allDocuments: [],
            allContacts: []
        )
        #expect(item.itemNumber == nil)
    }

    @MainActor
    @Test("apply links documents and contacts by PersistentIdentifier")
    func applyLinksRelationships() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let doc = Document(title: "ROG draft", originalFilename: "rog.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/rog.pdf")
        let witness = Contact(name: "Witness", role: .witness)
        ctx.insert(doc)
        ctx.insert(witness)
        kase.documents.append(doc)
        kase.parties.append(witness)
        try ctx.save()

        let draft = DiscoveryEditorDraft(
            category: .interrogatories,
            direction: .propounded,
            setNumber: 1,
            itemNumber: 1,
            subject: "linked item",
            servedAt: Date(),
            documentIDs: [doc.persistentModelID],
            contactIDs: [witness.persistentModelID]
        )
        let item = DiscoveryEditorService.apply(
            draft,
            existing: nil,
            caseOwner: kase,
            context: ctx,
            allDocuments: [doc],
            allContacts: [witness]
        )
        #expect(item.documents.map(\.title) == ["ROG draft"])
        #expect(item.contacts.map(\.name) == ["Witness"])
    }
}
