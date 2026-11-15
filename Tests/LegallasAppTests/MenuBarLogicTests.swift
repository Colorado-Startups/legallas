// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("MenuBarLogic")
struct MenuBarLogicTests {

    @Test("note draft requires a non-empty body")
    func noteValidation() {
        #expect(MenuBarLogic.isNoteDraftValid(body: "Observation about damages") == true)
        #expect(MenuBarLogic.isNoteDraftValid(body: "") == false)
        #expect(MenuBarLogic.isNoteDraftValid(body: "   \n\t  ") == false)
    }

    @Test("task draft requires a non-empty title")
    func taskValidation() {
        #expect(MenuBarLogic.isTaskDraftValid(title: "Draft reply brief") == true)
        #expect(MenuBarLogic.isTaskDraftValid(title: "") == false)
        #expect(MenuBarLogic.isTaskDraftValid(title: "   ") == false)
    }

    @Test("note payload round-trips through ProposalCodec with title and body intact")
    func noteRoundtrip() throws {
        let payload = try MenuBarLogic.noteProposalPayload(title: "  Deposition prep  ", body: "Ask about the July 2012 repair ticket.")
        let envelope = try ProposalCodec.decode(Data(payload.utf8))
        #expect(envelope.type == .note)
        #expect(envelope.source == "menubar")
        guard case .note(let note) = envelope.payload else {
            Issue.record("expected .note payload")
            return
        }
        #expect(note.title == "Deposition prep")
        #expect(note.bodyMarkdown == "Ask about the July 2012 repair ticket.")
    }

    @Test("task payload round-trips with and without a due date")
    func taskRoundtrip() throws {
        let due = Date(timeIntervalSince1970: 1_356_998_400)

        let withDue = try MenuBarLogic.taskProposalPayload(title: "File motion", dueDate: due)
        let envelopeDue = try ProposalCodec.decode(Data(withDue.utf8))
        guard case .task(let withDuePayload) = envelopeDue.payload else {
            Issue.record("expected .task payload")
            return
        }
        #expect(withDuePayload.title == "File motion")
        #expect(withDuePayload.dueDate == due)

        let noDue = try MenuBarLogic.taskProposalPayload(title: "Call opposing counsel", dueDate: nil)
        let envelopeNoDue = try ProposalCodec.decode(Data(noDue.utf8))
        guard case .task(let noDuePayload) = envelopeNoDue.payload else {
            Issue.record("expected .task payload")
            return
        }
        #expect(noDuePayload.dueDate == nil)
    }

    @Test("note envelope drops an all-whitespace title")
    func noteWhitespaceTitle() {
        let envelope = MenuBarLogic.noteEnvelope(title: "   ", body: "Thought")
        guard case .note(let payload) = envelope.payload else {
            Issue.record("expected note payload")
            return
        }
        #expect(payload.title == nil)
        #expect(payload.bodyMarkdown == "Thought")
    }

    @Test("task envelope trims whitespace from the title")
    func taskTitleTrim() {
        let envelope = MenuBarLogic.taskEnvelope(title: "  File the motion  ", dueDate: nil)
        guard case .task(let payload) = envelope.payload else {
            Issue.record("expected task payload")
            return
        }
        #expect(payload.title == "File the motion")
    }
}
