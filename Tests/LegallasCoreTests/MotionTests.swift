// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("Motion")
struct MotionTests {

    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        return ctx
    }

    @MainActor
    @Test("Us-filed MTD and opponent MSJ can be filtered by filedBy")
    func filterByFiledBy() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let ours = Motion(title: "Motion to Dismiss", motionType: .dismiss, filedBy: .us, filedAt: Date(), status: .pending)
        let theirs = Motion(title: "MSJ against us", motionType: .summaryJudgment, filedBy: .opponent, filedAt: Date(), status: .denied)
        for m in [ours, theirs] {
            ctx.insert(m)
            kase.motions.append(m)
        }
        try ctx.save()

        let all = try ctx.fetch(FetchDescriptor<Motion>())
        #expect(all.count == 2)
        #expect(all.filter { $0.filedBy == .us }.count == 1)
        #expect(all.filter { $0.filedBy == .opponent }.count == 1)
        #expect(all.filter { $0.filedBy == .us }.first?.title == "Motion to Dismiss")
    }

    @MainActor
    @Test("Filter by status separates pending, granted, denied")
    func filterByStatus() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let pending = Motion(title: "MTC", motionType: .compel, filedBy: .us, filedAt: Date(), status: .pending)
        let granted = Motion(title: "Continuance", motionType: .continuance, filedBy: .us, filedAt: Date(), status: .granted)
        let denied = Motion(title: "MIL", motionType: .limineThem, filedBy: .opponent, filedAt: Date(), status: .denied)
        for m in [pending, granted, denied] {
            ctx.insert(m)
            kase.motions.append(m)
        }
        try ctx.save()

        let all = try ctx.fetch(FetchDescriptor<Motion>())
        #expect(all.filter { $0.status == .pending }.count == 1)
        #expect(all.filter { $0.status == .granted }.count == 1)
        #expect(all.filter { $0.status == .denied }.count == 1)
    }

    @MainActor
    @Test("Linking documents populates the documents array")
    func linksToDocuments() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let brief = Document(title: "MTD brief", originalFilename: "mtd.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/mtd.pdf")
        let exhibit = Document(title: "Exhibit A", originalFilename: "exhibitA.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/exhibitA.pdf")
        ctx.insert(brief)
        ctx.insert(exhibit)
        kase.documents.append(brief)
        kase.documents.append(exhibit)

        let motion = Motion(title: "Motion to Dismiss", motionType: .dismiss, filedBy: .us, filedAt: Date())
        ctx.insert(motion)
        kase.motions.append(motion)
        motion.documents.append(brief)
        motion.documents.append(exhibit)
        try ctx.save()

        let fetched = try ctx.fetch(FetchDescriptor<Motion>())
        #expect(fetched[0].documents.count == 2)
        let titles = Set(fetched[0].documents.map(\.title))
        #expect(titles == ["MTD brief", "Exhibit A"])
    }

    @MainActor
    @Test("Motion computed properties round-trip raw strings")
    func enumRoundTrip() throws {
        let ctx = try Self.makeContext()
        let m = Motion(title: "In Limine", motionType: .limineMine, filedBy: .us, filedAt: Date(), status: .argued)
        ctx.insert(m)
        try ctx.save()

        let fetched = try ctx.fetch(FetchDescriptor<Motion>())
        #expect(fetched[0].motionType == .limineMine)
        #expect(fetched[0].filedBy == .us)
        #expect(fetched[0].status == .argued)
        #expect(fetched[0].motionTypeRaw == MotionType.limineMine.rawValue)
        #expect(fetched[0].filedByRaw == MotionFiler.us.rawValue)
        #expect(fetched[0].statusRaw == MotionStatus.argued.rawValue)
    }

    @MainActor
    @Test("CaseExporter includes motions with scalar fields and linked document titles")
    func exportIncludesMotions() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let brief = Document(title: "MSJ opposition", originalFilename: "opposition.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/opposition.pdf")
        ctx.insert(brief)
        kase.documents.append(brief)

        let filed = Date(timeIntervalSince1970: 1_363_000_000)
        let hearing = filed.addingTimeInterval(60 * 86_400)
        let motion = Motion(
            title: "MSJ opposition brief",
            motionType: .summaryJudgment,
            filedBy: .opponent,
            filedAt: filed,
            responseDueAt: filed.addingTimeInterval(21 * 86_400),
            replyDueAt: filed.addingTimeInterval(35 * 86_400),
            hearingAt: hearing,
            status: .denied,
            ruling: "Denied; the delivery times are disputed.",
            notes: "Prepared response with the temperature-log declaration"
        )
        ctx.insert(motion)
        kase.motions.append(motion)
        motion.documents.append(brief)
        try ctx.save()

        let dto = try CaseExporter.export(from: ctx)
        #expect(dto.motions.count == 1)
        let e = dto.motions[0]
        #expect(e.title == "MSJ opposition brief")
        #expect(e.motionType == .summaryJudgment)
        #expect(e.filedBy == .opponent)
        #expect(e.filedAt == filed)
        #expect(e.responseDueAt == filed.addingTimeInterval(21 * 86_400))
        #expect(e.replyDueAt == filed.addingTimeInterval(35 * 86_400))
        #expect(e.hearingAt == hearing)
        #expect(e.status == .denied)
        #expect(e.ruling == "Denied; the delivery times are disputed.")
        #expect(e.linkedDocumentTitles == ["MSJ opposition"])
    }
}
