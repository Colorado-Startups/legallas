// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("ReminderSync")
@MainActor
struct ReminderSyncTests {

    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func makeDeadline(in context: ModelContext, daysOut: Int = 40) -> Deadline {
        let deadline = Deadline(
            title: "Response to motion",
            anchor: .filing,
            offsetDays: daysOut,
            computedDate: now.addingTimeInterval(Double(daysOut) * 86_400)
        )
        context.insert(deadline)
        return deadline
    }

    private func fires(_ offsets: [(Int, Double)]) -> [(leadTimeDays: Int, fireDate: Date)] {
        offsets.map { (leadTimeDays: $0.0, fireDate: now.addingTimeInterval($0.1)) }
    }

    @Test("a new deadline gets one row per fire date and only future ones are scheduled")
    func newDeadline() throws {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let deadline = makeDeadline(in: context)

        let change = ReminderSync.replaceReminders(
            on: deadline, with: fires([(30, 3_600), (7, 7_200), (1, -60)]), in: context, now: now
        )

        #expect(deadline.reminders.count == 3)
        #expect(change.cancelledIdentifiers.isEmpty)
        #expect(change.scheduled.count == 2)
        #expect(change.scheduled.allSatisfy { $0.title == "Response to motion" && $0.fireDate > now })
    }

    @Test("editing cancels the old notification identifiers and deletes the old rows")
    func editReplaces() throws {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let deadline = makeDeadline(in: context)
        _ = ReminderSync.replaceReminders(on: deadline, with: fires([(30, 3_600), (7, 7_200)]), in: context, now: now)
        try context.save()
        let oldIdentifiers = deadline.reminders.map(\.notificationIdentifier)

        let change = ReminderSync.replaceReminders(on: deadline, with: fires([(14, 5_000)]), in: context, now: now)
        try context.save()

        #expect(Set(change.cancelledIdentifiers) == Set(oldIdentifiers))
        #expect(try context.fetch(FetchDescriptor<Reminder>()).count == 1)
        #expect(change.scheduled.count == 1)
        #expect(!oldIdentifiers.contains(change.scheduled[0].identifier))
    }

    @Test("delivered and already-past reminders are not scheduled")
    func skipsDeliveredAndPast() throws {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let deadline = makeDeadline(in: context)
        let future = Reminder(leadTimeDays: 7, fireDate: now.addingTimeInterval(60))
        let delivered = Reminder(leadTimeDays: 7, fireDate: now.addingTimeInterval(60))
        delivered.delivered = true
        let atNow = Reminder(leadTimeDays: 1, fireDate: now)

        #expect(ReminderNotification.make(for: future, on: deadline, now: now) != nil)
        #expect(ReminderNotification.make(for: delivered, on: deadline, now: now) == nil)
        #expect(ReminderNotification.make(for: atNow, on: deadline, now: now) == nil)
    }

    @Test("reminders on a satisfied deadline are not scheduled")
    func skipsSatisfiedDeadline() throws {
        let context = ModelContext(try ModelContainerFactory.makeInMemoryContainer())
        let deadline = makeDeadline(in: context)
        let reminder = Reminder(leadTimeDays: 7, fireDate: now.addingTimeInterval(60))
        #expect(ReminderNotification.make(for: reminder, on: deadline, now: now) != nil)

        deadline.isSatisfied = true
        #expect(ReminderNotification.make(for: reminder, on: deadline, now: now) == nil)
    }

    @Test("body pluralizes the lead time")
    func bodyPluralization() {
        #expect(ReminderNotification.body(leadTimeDays: 1, dueDate: now).hasPrefix("Due in 1 day ("))
        #expect(ReminderNotification.body(leadTimeDays: 7, dueDate: now).hasPrefix("Due in 7 days ("))
    }

    @Test("notifications are enabled only inside a .app bundle with an identifier")
    func appBundleGuard() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas_bundle_guard_\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        func makeBundle(named name: String, identifier: String?) throws -> Bundle {
            let url = root.appendingPathComponent(name, isDirectory: true)
            let contents = url.appendingPathComponent("Contents", isDirectory: true)
            try FileManager.default.createDirectory(at: contents, withIntermediateDirectories: true)
            var plist: [String: Any] = ["CFBundleName": "Legallas"]
            if let identifier { plist["CFBundleIdentifier"] = identifier }
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try data.write(to: contents.appendingPathComponent("Info.plist"))
            return try #require(Bundle(url: url))
        }

        let app = try makeBundle(named: "Legallas.app", identifier: "org.coloradostartups.Legallas.test")
        let noIdentifier = try makeBundle(named: "Unnamed.app", identifier: nil)
        let bareDirectory = try makeBundle(named: "debug", identifier: "org.coloradostartups.Legallas.test")

        #expect(NotificationService.isRunningInAppBundle(app))
        #expect(!NotificationService.isRunningInAppBundle(noIdentifier))
        #expect(!NotificationService.isRunningInAppBundle(bareDirectory))
    }
}
