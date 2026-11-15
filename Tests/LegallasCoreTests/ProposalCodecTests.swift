// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("ProposalCodec")
struct ProposalCodecTests {

    @Test("Task proposal round-trips")
    func taskRoundTrip() throws {
        let envelope = ProposalEnvelope(
            type: .task,
            rationale: "Claude suggests filing a motion to compel",
            payload: .task(TaskPayload(
                title: "Draft motion to compel discovery",
                details: "Include exhibits A-C",
                status: .toDo,
                priority: .high,
                dueDate: nil
            ))
        )
        let data = try ProposalCodec.encode(envelope)
        let decoded = try ProposalCodec.decode(data)

        #expect(decoded.id == envelope.id)
        #expect(decoded.type == .task)
        #expect(decoded.status == .pending)
        if case .task(let payload) = decoded.payload {
            #expect(payload.title == "Draft motion to compel discovery")
            #expect(payload.priority == .high)
        } else {
            Issue.record("Expected task payload")
        }
    }

    @Test("Deadline proposal round-trips")
    func deadlineRoundTrip() throws {
        let envelope = ProposalEnvelope(
            type: .deadline,
            payload: .deadline(DeadlinePayload(
                title: "Discovery cutoff",
                anchor: .trial,
                anchorDate: nil,
                offsetDays: 60,
                direction: .before,
                ruleCitation: "Case management order"
            ))
        )
        let data = try ProposalCodec.encode(envelope)
        let decoded = try ProposalCodec.decode(data)

        if case .deadline(let payload) = decoded.payload {
            #expect(payload.anchor == .trial)
            #expect(payload.offsetDays == 60)
            #expect(payload.direction == .before)
        } else {
            Issue.record("Expected deadline payload")
        }
    }

    @Test("Event, note, and contactUpdate proposals round-trip")
    func otherTypesRoundTrip() throws {
        let event = ProposalEnvelope(
            type: .event,
            payload: .event(EventPayload(
                title: "Served Roe Commissary, LLC",
                date: Date(),
                type: .service,
                summary: "Summons handed to the commissary night manager"
            ))
        )
        let note = ProposalEnvelope(
            type: .note,
            payload: .note(NotePayload(
                title: "Strategy note",
                bodyMarkdown: "Ask Ed Expert to review the cooler temperature logs"
            ))
        )
        let contact = ProposalEnvelope(
            type: .contactUpdate,
            payload: .contactUpdate(ContactUpdatePayload(
                contactName: "Richard Roe",
                fields: ["organization": "Harbor Labs, Inc."]
            ))
        )

        for env in [event, note, contact] {
            let data = try ProposalCodec.encode(env)
            let decoded = try ProposalCodec.decode(data)
            #expect(decoded.type == env.type)
            #expect(decoded.id == env.id)
        }
    }

    @Test("Decoding invalid JSON throws")
    func malformedJSONFails() {
        let junk = Data("not json".utf8)
        #expect(throws: DecodingError.self) {
            _ = try ProposalCodec.decode(junk)
        }
    }
}
