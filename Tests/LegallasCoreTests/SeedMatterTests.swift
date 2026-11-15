// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("SeedMatter")
struct SeedMatterTests {

    @MainActor
    @Test("seedIfNeeded with no matter seeds the room's matter")
    func defaultSeedIsRoomMatter() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context)

        let kase = try #require(try context.fetch(FetchDescriptor<Case>()).first)
        #expect(kase.name == Seeding.roomMatter.name)
        #expect(kase.caseNumber == Seeding.roomMatter.caseNumber)
        #expect(kase.parties.count == Seeding.roomMatter.parties.count)
        #expect(kase.claims.count == Seeding.roomMatter.claims.count)
    }

    @MainActor
    @Test("The sample is an unfiled matter with no judge, four parties and one trebleable claim")
    func sampleIsUnfiled() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)

        let kase = try #require(try context.fetch(FetchDescriptor<Case>()).first)
        #expect(kase.name == "Doe v. Harbor Labs, Inc.")
        #expect(!kase.isFiled)
        #expect(kase.judge.isEmpty)
        #expect(kase.courtroom.isEmpty)
        #expect(kase.parties.count == 4)
        #expect(kase.parties.first { $0.role == .plaintiff }?.name == "Jane Doe")
        let trebleableClaims = kase.claims.filter { $0.isTrebleable }.count
        #expect(trebleableClaims == 1)
        #expect(!SeedMatter.sample.documentsFolder.hasPrefix("/"))
        #expect(SeedMatter.fixtureDate > Case.notFiledDate)
    }
}
