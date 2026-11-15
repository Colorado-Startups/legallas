// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import Legallas

@Suite("MotionEditorService")
struct MotionEditorServiceTests {

    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        return ctx
    }

    @MainActor
    @Test("apply inserts a new motion and links documents")
    func applyInsertsAndLinksDocuments() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let brief = Document(title: "MTD brief", originalFilename: "mtd.pdf", bookmarkData: Data(), lastKnownPath: "/tmp/mtd.pdf")
        ctx.insert(brief)
        kase.documents.append(brief)
        try ctx.save()

        let draft = MotionEditorDraft(
            title: "  Motion to Dismiss  ",
            motionType: .dismiss,
            filedBy: .us,
            filedAt: Date(),
            status: .pending,
            documentIDs: [brief.persistentModelID]
        )
        let motion = MotionEditorService.apply(
            draft,
            existing: nil,
            caseOwner: kase,
            context: ctx,
            allDocuments: [brief]
        )

        let fetched = try ctx.fetch(FetchDescriptor<Motion>())
        #expect(fetched.count == 1)
        #expect(kase.motions.count == 1)
        #expect(motion.title == "Motion to Dismiss")
        #expect(motion.documents.map(\.title) == ["MTD brief"])
    }

    @MainActor
    @Test("apply clears hearingAt when the draft passes nil")
    func applyClearsHearing() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let originalHearing = Date(timeIntervalSince1970: 1_366_000_000)
        let original = Motion(
            title: "MTD",
            motionType: .dismiss,
            filedBy: .us,
            filedAt: Date(),
            hearingAt: originalHearing,
            status: .pending
        )
        ctx.insert(original)
        kase.motions.append(original)
        try ctx.save()
        #expect(original.hearingAt != nil)

        let draft = MotionEditorDraft(
            title: original.title,
            motionType: original.motionType,
            filedBy: original.filedBy,
            filedAt: original.filedAt,
            hearingAt: nil,
            status: .pending
        )
        let updated = MotionEditorService.apply(
            draft,
            existing: original,
            caseOwner: kase,
            context: ctx,
            allDocuments: []
        )
        #expect(updated.hearingAt == nil)
    }

    @MainActor
    @Test("apply with existing mutates in place and does not duplicate")
    func applyUpdatesInPlace() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let original = Motion(title: "Old", motionType: .dismiss, filedBy: .us, filedAt: Date(), status: .pending)
        ctx.insert(original)
        kase.motions.append(original)
        try ctx.save()

        let draft = MotionEditorDraft(
            title: "New",
            motionType: .summaryJudgment,
            filedBy: .opponent,
            filedAt: original.filedAt,
            status: .denied,
            ruling: "Denied; delivery times disputed"
        )
        let updated = MotionEditorService.apply(
            draft,
            existing: original,
            caseOwner: kase,
            context: ctx,
            allDocuments: []
        )

        let fetched = try ctx.fetch(FetchDescriptor<Motion>())
        #expect(fetched.count == 1)
        #expect(updated.persistentModelID == original.persistentModelID)
        #expect(updated.title == "New")
        #expect(updated.motionType == .summaryJudgment)
        #expect(updated.filedBy == .opponent)
        #expect(updated.status == .denied)
        #expect(updated.ruling == "Denied; delivery times disputed")
    }
}
