// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("ContactRoleFilter")
struct ContactRoleFilterTests {

    @MainActor
    @Test("Filtering contacts by role returns only the matching subset")
    func filterByRole() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)

        let kase = try context.fetch(FetchDescriptor<Case>()).first!

        let witness = Contact(name: "Jane Witness", role: .witness)
        let expert = Contact(name: "Dr. Expert", role: .expert)
        let vendor = Contact(name: "Vendor Inc.", role: .vendor)
        for c in [witness, expert, vendor] {
            context.insert(c)
            kase.parties.append(c)
        }
        try context.save()

        let all = try context.fetch(FetchDescriptor<Contact>())
        #expect(all.count == 7)

        let plaintiffs = all.filter { $0.role == .plaintiff }
        #expect(plaintiffs.count == 1)
        #expect(plaintiffs[0].name == "Jane Doe")

        let defendants = all.filter { $0.role == .defendant }
        #expect(defendants.count == 2)

        let experts = all.filter { $0.role == .expert }
        #expect(experts.count == 1)
        #expect(experts[0].name == "Dr. Expert")

        let vendors = all.filter { $0.role == .vendor }
        #expect(vendors.count == 1)
        #expect(vendors[0].name == "Vendor Inc.")
    }

    @MainActor
    @Test("ContactRole.allCases covers nine roles including vendor and expert")
    func allCasesIsComplete() {
        let cases = ContactRole.allCases
        #expect(cases.count == 9)
        #expect(cases.contains(.plaintiff))
        #expect(cases.contains(.vendor))
        #expect(cases.contains(.expert))
        #expect(cases.contains(.other))
    }

    @MainActor
    @Test("ContactRole raw values round-trip through the Contact.role computed property")
    func roleRoundTrip() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        let c = Contact(name: "Roundtrip", role: .plaintiffCounsel)
        context.insert(c)
        try context.save()

        let fetched = try context.fetch(FetchDescriptor<Contact>())
        #expect(fetched.count == 1)
        #expect(fetched[0].role == .plaintiffCounsel)
        #expect(fetched[0].roleRaw == ContactRole.plaintiffCounsel.rawValue)
    }
}
