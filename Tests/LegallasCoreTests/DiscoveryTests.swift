// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("Discovery")
struct DiscoveryTests {

    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        return ctx
    }

    @MainActor
    @Test("Propounded ROG set 1 stores all fields and round-trips through computed properties")
    func createPropoundedROG() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let item = DiscoveryItem(
            category: .interrogatories,
            direction: .propounded,
            setNumber: 1,
            itemNumber: 3,
            subject: "Delivery invoices, spring 2012",
            servedAt: Date(timeIntervalSince1970: 1_360_000_000),
            dueAt: Date(timeIntervalSince1970: 1_362_592_000),
            status: .outstanding,
            responseText: "Awaiting",
            notes: "High priority"
        )
        ctx.insert(item)
        kase.discoveryItems.append(item)
        try ctx.save()

        let fetched = try ctx.fetch(FetchDescriptor<DiscoveryItem>())
        #expect(fetched.count == 1)
        let f = fetched[0]
        #expect(f.category == .interrogatories)
        #expect(f.direction == .propounded)
        #expect(f.setNumber == 1)
        #expect(f.itemNumber == 3)
        #expect(f.subject == "Delivery invoices, spring 2012")
        #expect(f.status == .outstanding)
        #expect(f.categoryRaw == "interrogatories")
        #expect(f.directionRaw == "propounded")
        #expect(f.statusRaw == "outstanding")
    }

    @MainActor
    @Test("Filter by direction separates propounded from received")
    func filterByDirection() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let served = Date()
        let outbound = DiscoveryItem(category: .interrogatories, direction: .propounded, setNumber: 1, subject: "ROG 1", servedAt: served)
        let outbound2 = DiscoveryItem(category: .rfp, direction: .propounded, setNumber: 1, subject: "RFP 1", servedAt: served)
        let inbound = DiscoveryItem(category: .rfp, direction: .received, setNumber: 1, subject: "RFP to us", servedAt: served, status: .responded)
        for i in [outbound, outbound2, inbound] {
            ctx.insert(i)
            kase.discoveryItems.append(i)
        }
        try ctx.save()

        let all = try ctx.fetch(FetchDescriptor<DiscoveryItem>())
        #expect(all.count == 3)
        #expect(all.filter { $0.direction == .propounded }.count == 2)
        #expect(all.filter { $0.direction == .received }.count == 1)
    }

    @MainActor
    @Test("Filter by category separates interrogatories from RFPs")
    func filterByCategory() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let served = Date()
        for i in 1...3 {
            let rog = DiscoveryItem(category: .interrogatories, direction: .propounded, setNumber: 1, itemNumber: i, subject: "ROG \(i)", servedAt: served)
            ctx.insert(rog)
            kase.discoveryItems.append(rog)
        }
        let rfp = DiscoveryItem(category: .rfp, direction: .propounded, setNumber: 1, subject: "RFP Set", servedAt: served)
        ctx.insert(rfp)
        kase.discoveryItems.append(rfp)
        try ctx.save()

        let all = try ctx.fetch(FetchDescriptor<DiscoveryItem>())
        #expect(all.filter { $0.category == .interrogatories }.count == 3)
        #expect(all.filter { $0.category == .rfp }.count == 1)
    }

    @MainActor
    @Test("Linking documents and contacts populates relationship arrays")
    func linksToDocumentsAndContacts() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let doc = Document(title: "ROG Set 1 draft", originalFilename: "rog1.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/rog1.pdf")
        let contact = Contact(name: "Witness A", role: .witness)
        ctx.insert(doc)
        ctx.insert(contact)
        kase.documents.append(doc)
        kase.parties.append(contact)

        let item = DiscoveryItem(category: .deposition, direction: .propounded, setNumber: 1, subject: "Deposition of Witness A", servedAt: Date())
        ctx.insert(item)
        kase.discoveryItems.append(item)
        item.documents.append(doc)
        item.contacts.append(contact)
        try ctx.save()

        let fetched = try ctx.fetch(FetchDescriptor<DiscoveryItem>())
        #expect(fetched[0].documents.count == 1)
        #expect(fetched[0].contacts.count == 1)
        #expect(fetched[0].documents[0].title == "ROG Set 1 draft")
        #expect(fetched[0].contacts[0].name == "Witness A")
    }

    @MainActor
    @Test("CaseExporter includes discoveryItems with linkedDocumentTitles and linkedContactNames")
    func exportIncludesDiscovery() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let doc = Document(title: "ROG responses", originalFilename: "responses.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/responses.pdf")
        let contact = Contact(name: "Dan Dee", role: .defenseCounsel)
        ctx.insert(doc)
        ctx.insert(contact)
        kase.documents.append(doc)
        kase.parties.append(contact)

        let served = Date(timeIntervalSince1970: 1_360_000_000)
        let due = served.addingTimeInterval(35 * 86_400)
        let item = DiscoveryItem(
            category: .rfa,
            direction: .received,
            setNumber: 2,
            itemNumber: 5,
            subject: "Admission re July 9 delivery time",
            servedAt: served,
            dueAt: due,
            status: .objected,
            responseText: "Objected; delivery window undefined",
            notes: "Meet and confer scheduled"
        )
        ctx.insert(item)
        kase.discoveryItems.append(item)
        item.documents.append(doc)
        item.contacts.append(contact)
        try ctx.save()

        let dto = try CaseExporter.export(from: ctx)
        #expect(dto.discoveryItems.count == 1)
        let e = dto.discoveryItems[0]
        #expect(e.category == .rfa)
        #expect(e.direction == .received)
        #expect(e.setNumber == 2)
        #expect(e.itemNumber == 5)
        #expect(e.subject == "Admission re July 9 delivery time")
        #expect(e.status == .objected)
        #expect(e.responseText == "Objected; delivery window undefined")
        #expect(e.linkedDocumentTitles == ["ROG responses"])
        #expect(e.linkedContactNames == ["Dan Dee"])
    }
}
