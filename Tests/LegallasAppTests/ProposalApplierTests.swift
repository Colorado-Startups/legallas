// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import Legallas

@Suite("ProposalApplier")
struct ProposalApplierTests {

    struct SaveFailed: Error {}

    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        try ctx.save()
        return ctx
    }

    /// Inserts and saves a pending task proposal, so the context starts with no unsaved changes.
    @MainActor
    static func insertTaskProposal(title: String, into ctx: ModelContext) throws -> InboxProposal {
        let env = ProposalEnvelope(type: .task, payload: .task(TaskPayload(title: title)))
        let proposal = InboxProposal(
            externalId: env.id,
            proposalType: .task,
            payloadJSON: try ProposalCodec.payloadJSONString(env)
        )
        ctx.insert(proposal)
        try ctx.save()
        return proposal
    }

    @MainActor
    static func taskCount(titled title: String, in ctx: ModelContext) throws -> Int {
        try ctx.fetch(FetchDescriptor<CaseTask>()).filter { $0.title == title }.count
    }

    @MainActor
    @Test("accept inserts the task and marks the proposal accepted")
    func acceptSucceeds() throws {
        let ctx = try Self.makeContext()
        let proposal = try Self.insertTaskProposal(title: "File reply brief", into: ctx)

        try ProposalApplier(modelContext: ctx).accept(proposal)

        #expect(proposal.status == .accepted)
        #expect(proposal.reviewedAt != nil)
        #expect(proposal.resultingTask?.title == "File reply brief")
        #expect(try Self.taskCount(titled: "File reply brief", in: ctx) == 1)
        #expect(!ctx.hasChanges)
    }

    @MainActor
    @Test("a failed save on accept rolls back: proposal pending, no task, nothing unsaved")
    func acceptSaveFailureRollsBack() throws {
        let ctx = try Self.makeContext()
        let proposal = try Self.insertTaskProposal(title: "Draft motion to compel", into: ctx)
        let applier = ProposalApplier(modelContext: ctx, save: { _ in throw SaveFailed() })

        #expect(throws: SaveFailed.self) { try applier.accept(proposal) }

        #expect(proposal.status == .pending)
        #expect(proposal.reviewedAt == nil)
        #expect(proposal.resultingTask == nil)
        #expect(try Self.taskCount(titled: "Draft motion to compel", in: ctx) == 0)
        #expect(!ctx.hasChanges)
    }

    @MainActor
    @Test("after a failed accept, a retry with a working save applies the proposal once")
    func acceptRetryAfterFailure() throws {
        let ctx = try Self.makeContext()
        let proposal = try Self.insertTaskProposal(title: "Serve disclosures", into: ctx)

        #expect(throws: SaveFailed.self) {
            try ProposalApplier(modelContext: ctx, save: { _ in throw SaveFailed() }).accept(proposal)
        }
        try ProposalApplier(modelContext: ctx).accept(proposal)

        #expect(proposal.status == .accepted)
        #expect(try Self.taskCount(titled: "Serve disclosures", in: ctx) == 1)
    }

    @MainActor
    @Test("a failed save on reject rolls back: proposal pending with no reason recorded")
    func rejectSaveFailureRollsBack() throws {
        let ctx = try Self.makeContext()
        let proposal = try Self.insertTaskProposal(title: "Call opposing counsel", into: ctx)
        let applier = ProposalApplier(modelContext: ctx, save: { _ in throw SaveFailed() })

        #expect(throws: SaveFailed.self) { try applier.reject(proposal, reason: "Already done") }

        #expect(proposal.status == .pending)
        #expect(proposal.rejectionReason == nil)
        #expect(proposal.reviewedAt == nil)
        #expect(!ctx.hasChanges)
    }

    @MainActor
    @Test("edits pending elsewhere are saved before the proposal, so a rollback keeps them")
    func unrelatedPendingEditsSurviveRollback() throws {
        let ctx = try Self.makeContext()
        let proposal = try Self.insertTaskProposal(title: "Update exhibit list", into: ctx)
        ctx.insert(CaseTask(title: "Unrelated edit"))

        var saves = 0
        let applier = ProposalApplier(modelContext: ctx, save: { context in
            saves += 1
            if saves == 1 { try context.save() } else { throw SaveFailed() }
        })

        #expect(throws: SaveFailed.self) { try applier.accept(proposal) }

        #expect(proposal.status == .pending)
        #expect(try Self.taskCount(titled: "Unrelated edit", in: ctx) == 1)
        #expect(try Self.taskCount(titled: "Update exhibit list", in: ctx) == 0)
    }
}
