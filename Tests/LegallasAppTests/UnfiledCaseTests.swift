// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import Legallas

@Suite("UnfiledCase")
struct UnfiledCaseTests {

    @Test("export says the case is not filed and has no judge, instead of printing the sentinel date")
    func exportUnfiledCase() {
        let unfiled = CaseExportDTO.CaseDTO(
            name: "Unfiled matter",
            caseNumber: "",
            court: "District Court",
            judge: "",
            courtroom: "",
            filingDate: Case.notFiledDate
        )
        let md = ExportLogic.caseSection(unfiled)
        #expect(md.contains("- Case number: Not assigned"))
        #expect(md.contains("- Judge: Not assigned"))
        #expect(md.contains("- Filed: Not yet filed"))
        #expect(!md.contains("Courtroom"))
        #expect(!md.contains(Formatters.displayDate.string(from: Case.notFiledDate)))
    }

    @MainActor
    @Test("a deadline proposal with no anchor date anchors on today when the case is not filed")
    func deadlineOnUnfiledCaseAnchorsToday() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        try ctx.save()

        let payload = DeadlinePayload(title: "Serve the demand", anchor: .filing, offsetDays: 0)
        let env = ProposalEnvelope(type: .deadline, payload: .deadline(payload))
        let proposal = InboxProposal(
            externalId: env.id,
            proposalType: .deadline,
            payloadJSON: try ProposalCodec.payloadJSONString(env)
        )
        ctx.insert(proposal)
        try ctx.save()

        try ProposalApplier(modelContext: ctx).accept(proposal)

        let deadline = try #require(proposal.resultingDeadline)
        #expect(deadline.anchorDate == nil)
        let year = DateMath.denverCalendar.component(.year, from: deadline.computedDate)
        #expect(year >= DateMath.denverCalendar.component(.year, from: Date()))
    }
}
