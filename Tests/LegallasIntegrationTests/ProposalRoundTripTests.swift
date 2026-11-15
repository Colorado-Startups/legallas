// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("ProposalCodecIntegration")
struct ProposalRoundTripTests {

    @Test("TaskPayload survives JSON round-trip without data loss")
    func taskRoundTrip() throws {
        let id = UUID()
        let sentAt = Date(timeIntervalSince1970: 1_745_000_000)
        let envelope = ProposalEnvelope(
            id: id,
            type: .task,
            proposedAt: sentAt,
            source: "integration-test",
            rationale: "verify round-trip",
            status: .pending,
            payload: .task(TaskPayload(
                title: "Draft motion to compel",
                details: "File by Thursday",
                priority: .high
            ))
        )

        let data = try ProposalCodec.encode(envelope)
        let decoded = try ProposalCodec.decode(data)

        #expect(decoded.id == id)
        #expect(decoded.type == .task)
        #expect(decoded.source == "integration-test")
        #expect(decoded.rationale == "verify round-trip")
        #expect(decoded.status == .pending)

        if case .task(let payload) = decoded.payload {
            #expect(payload.title == "Draft motion to compel")
            #expect(payload.details == "File by Thursday")
            #expect(payload.priority == .high)
        } else {
            Issue.record("Expected .task payload, got something else")
        }
    }

    @Test("NotePayload JSON contains expected keys")
    func noteEncodedShape() throws {
        let envelope = ProposalEnvelope(
            type: .note,
            source: "test",
            payload: .note(NotePayload(title: "Key fact", bodyMarkdown: "Important detail."))
        )

        let json = try ProposalCodec.payloadJSONString(envelope)
        #expect(json.contains("\"type\""))
        #expect(json.contains("\"note\""))
        #expect(json.contains("\"Key fact\""))
        #expect(json.contains("\"Important detail.\""))
    }

    @Test("Decoded proposal preserves ISO-8601 date precision")
    func datePreservesISO8601Precision() throws {
        let proposedAt = Date(timeIntervalSince1970: 1_745_123_456)
        let original = ProposalEnvelope(
            type: .task,
            proposedAt: proposedAt,
            source: "test",
            payload: .task(TaskPayload(title: "Check date"))
        )

        let decoded = try ProposalCodec.decode(ProposalCodec.encode(original))
        #expect(abs(decoded.proposedAt.timeIntervalSince(proposedAt)) < 1.0)
    }
}
