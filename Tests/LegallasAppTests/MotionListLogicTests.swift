// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("MotionListLogic")
struct MotionListLogicTests {

    @MainActor
    static func makeSeeded() -> [Motion] {
        let filed = Date(timeIntervalSince1970: 1_363_000_000)
        return [
            Motion(title: "MTD", motionType: .dismiss, filedBy: .us, filedAt: filed, status: .pending),
            Motion(title: "MTC", motionType: .compel, filedBy: .us, filedAt: filed, status: .argued),
            Motion(title: "MSJ against us", motionType: .summaryJudgment, filedBy: .opponent, filedAt: filed, status: .denied),
            Motion(title: "MIL theirs", motionType: .limineThem, filedBy: .opponent, filedAt: filed, status: .granted)
        ]
    }

    @MainActor
    @Test("filter by filedBy returns only the matching subset")
    func filterByFiledBy() {
        let motions = Self.makeSeeded()
        #expect(MotionListLogic.filter(motions, filedBy: nil).count == 4)
        #expect(MotionListLogic.filter(motions, filedBy: .us).count == 2)
        #expect(MotionListLogic.filter(motions, filedBy: .opponent).count == 2)
    }

    @MainActor
    @Test("partitioned splits motions into ours vs theirs preserving order")
    func partition() {
        let motions = Self.makeSeeded()
        let parts = MotionListLogic.partitioned(motions)
        #expect(parts.ours.map(\.title) == ["MTD", "MTC"])
        #expect(parts.theirs.map(\.title) == ["MSJ against us", "MIL theirs"])
    }

    @MainActor
    @Test("statusStyle maps every MotionStatus case correctly")
    func statusStyleMapping() {
        #expect(MotionListLogic.statusStyle(for: .pending) == .warning)
        #expect(MotionListLogic.statusStyle(for: .responseFiled) == .neutral)
        #expect(MotionListLogic.statusStyle(for: .replyFiled) == .neutral)
        #expect(MotionListLogic.statusStyle(for: .argued) == .informational)
        #expect(MotionListLogic.statusStyle(for: .granted) == .positive)
        #expect(MotionListLogic.statusStyle(for: .denied) == .negative)
        #expect(MotionListLogic.statusStyle(for: .grantedInPart) == .muted)
        #expect(MotionListLogic.statusStyle(for: .withdrawn) == .neutral)
    }

    @MainActor
    @Test("hearingCountdown returns urgency buckets around thresholds")
    func hearingCountdownBuckets() {
        let now = Date(timeIntervalSince1970: 1_720_000_000)
        #expect(MotionListLogic.hearingCountdown(to: nil, now: now) == nil)

        let fourDays = now.addingTimeInterval(4 * 86_400)
        let soon = MotionListLogic.hearingCountdown(to: fourDays, now: now)
        #expect(soon?.urgency == .soon)
        #expect(soon?.days == 4)

        let past = now.addingTimeInterval(-1 * 86_400)
        let overdue = MotionListLogic.hearingCountdown(to: past, now: now)
        #expect(overdue?.urgency == .overdue)

        let farOut = now.addingTimeInterval(21 * 86_400)
        let normal = MotionListLogic.hearingCountdown(to: farOut, now: now)
        #expect(normal?.urgency == .normal)
    }
}
