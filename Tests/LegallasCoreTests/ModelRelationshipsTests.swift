// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("ModelRelationships")
struct ModelRelationshipsTests {

    @MainActor
    @Test("Seeding creates one Case row with parties and claims")
    func seedingCreatesCase() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)

        let cases = try context.fetch(FetchDescriptor<Case>())
        #expect(cases.count == 1)
        let kase = cases[0]
        #expect(kase.caseNumber == SeedMatter.sample.caseNumber)
        #expect(kase.parties.count == 4)
        #expect(kase.claims.count == 3)
        #expect(kase.claims.contains(where: { $0.type == .breachContract }))
        #expect(kase.claims.contains(where: { $0.type == .custom }))
    }

    @MainActor
    @Test("Seeding is idempotent")
    func seedingIdempotent() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)
        try Seeding.seedIfNeeded(context, with: .sample)
        let cases = try context.fetch(FetchDescriptor<Case>())
        #expect(cases.count == 1)
    }

    @MainActor
    @Test("Deadline cascade deletes its reminders")
    func deadlineCascadesReminders() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)

        let kase = try context.fetch(FetchDescriptor<Case>()).first!
        let deadline = Deadline(
            title: "Service deadline",
            anchor: .filing,
            anchorDate: kase.filingDate,
            offsetDays: 63,
            direction: .after,
            computedDate: Date(),
            ruleCitation: "CRCP 4"
        )
        context.insert(deadline)
        kase.deadlines.append(deadline)

        let reminder = Reminder(leadTimeDays: 7, fireDate: Date())
        context.insert(reminder)
        deadline.reminders.append(reminder)
        try context.save()

        #expect(try context.fetch(FetchDescriptor<Reminder>()).count == 1)
        context.delete(deadline)
        try context.save()
        #expect(try context.fetch(FetchDescriptor<Reminder>()).isEmpty)
    }

    @MainActor
    @Test("Case delete nullifies task backref (does not cascade)")
    func caseDeleteNullifiesTasks() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)

        let kase = try context.fetch(FetchDescriptor<Case>()).first!
        let task = CaseTask(title: "Review pleading", status: .toDo, priority: .medium)
        context.insert(task)
        kase.tasks.append(task)
        try context.save()

        context.delete(kase)
        try context.save()

        let tasks = try context.fetch(FetchDescriptor<CaseTask>())
        #expect(tasks.count == 1)
        #expect(tasks[0].case == nil)
    }

    @MainActor
    @Test("Case delete cascades claims")
    func caseDeleteCascadesClaims() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let context = ModelContext(container)
        try Seeding.seedIfNeeded(context, with: .sample)

        let kase = try context.fetch(FetchDescriptor<Case>()).first!
        #expect(kase.claims.count == 3)
        context.delete(kase)
        try context.save()

        let remaining = try context.fetch(FetchDescriptor<Claim>())
        #expect(remaining.isEmpty)
    }
}
