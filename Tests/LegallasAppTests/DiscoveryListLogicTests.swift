// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import Legallas

@Suite("DiscoveryListLogic")
struct DiscoveryListLogicTests {

    @MainActor
    static func makeSeeded() throws -> [DiscoveryItem] {
        let served = Date(timeIntervalSince1970: 1_360_000_000)
        return [
            DiscoveryItem(category: .interrogatories, direction: .propounded, setNumber: 1, itemNumber: 1, subject: "ROG 1", servedAt: served),
            DiscoveryItem(category: .interrogatories, direction: .propounded, setNumber: 1, itemNumber: 2, subject: "ROG 2", servedAt: served),
            DiscoveryItem(category: .rfp, direction: .received, setNumber: 1, subject: "RFP to us", servedAt: served, status: .responded),
            DiscoveryItem(category: .deposition, direction: .propounded, setNumber: 1, subject: "Depo of witness", servedAt: served),
            DiscoveryItem(category: .subpoena, direction: .received, setNumber: 1, subject: "Subpoena for records", servedAt: served)
        ]
    }

    @MainActor
    @Test("filter(direction: nil) returns every item; .propounded and .received each return their subset")
    func filterByDirection() throws {
        let items = try Self.makeSeeded()
        #expect(DiscoveryListLogic.filter(items, direction: nil).count == 5)
        #expect(DiscoveryListLogic.filter(items, direction: .propounded).count == 3)
        #expect(DiscoveryListLogic.filter(items, direction: .received).count == 2)
    }

    @MainActor
    @Test("grouped respects DiscoveryCategory.allCases order and drops empty buckets")
    func groupedOrdering() throws {
        let items = try Self.makeSeeded()
        let groups = DiscoveryListLogic.grouped(items)
        let cats = groups.map(\.category)
        #expect(cats == [.interrogatories, .rfp, .deposition, .subpoena])
        #expect(groups.first(where: { $0.category == .rfa }) == nil)
        #expect(groups.first(where: { $0.category == .interrogatories })?.items.count == 2)
    }

    @MainActor
    @Test("headline formats ROG with item number and depo without")
    func headlineFormatting() {
        let rog = DiscoveryItem(category: .interrogatories, direction: .propounded, setNumber: 1, itemNumber: 3, subject: "x", servedAt: Date())
        let depo = DiscoveryItem(category: .deposition, direction: .propounded, setNumber: 2, subject: "y", servedAt: Date())
        let setOnly = DiscoveryItem(category: .rfp, direction: .propounded, setNumber: 1, subject: "z", servedAt: Date())
        #expect(DiscoveryListLogic.headline(for: rog) == "ROG Set 1 #3")
        #expect(DiscoveryListLogic.headline(for: depo) == "Depo Set 2")
        #expect(DiscoveryListLogic.headline(for: setOnly) == "RFP Set 1")
    }

    @MainActor
    @Test("statusStyle maps every DiscoveryStatus case and directionStyle maps both directions")
    func styleMapping() {
        #expect(DiscoveryListLogic.statusStyle(for: .outstanding) == .warning)
        #expect(DiscoveryListLogic.statusStyle(for: .responded) == .positive)
        #expect(DiscoveryListLogic.statusStyle(for: .objected) == .negative)
        #expect(DiscoveryListLogic.statusStyle(for: .motionPending) == .emphasis)
        #expect(DiscoveryListLogic.statusStyle(for: .closed) == .neutral)
        #expect(DiscoveryListLogic.directionStyle(for: .propounded) == .informational)
        #expect(DiscoveryListLogic.directionStyle(for: .received) == .accent)
    }

    @MainActor
    @Test("countdown returns nil when dueAt is nil; .soon for 3d, .overdue for past, .normal for far-future")
    func countdownBuckets() {
        let now = Date(timeIntervalSince1970: 1_720_000_000)
        #expect(DiscoveryListLogic.countdown(to: nil, now: now) == nil)

        let threeDaysOut = now.addingTimeInterval(3 * 86_400)
        let soon = DiscoveryListLogic.countdown(to: threeDaysOut, now: now)
        #expect(soon?.urgency == .soon)
        #expect(soon?.days == 3)

        let pastDue = now.addingTimeInterval(-5 * 86_400)
        let overdue = DiscoveryListLogic.countdown(to: pastDue, now: now)
        #expect(overdue?.urgency == .overdue)
        #expect((overdue?.days ?? 0) < 0)

        let farOut = now.addingTimeInterval(30 * 86_400)
        let normal = DiscoveryListLogic.countdown(to: farOut, now: now)
        #expect(normal?.urgency == .normal)
    }
}
