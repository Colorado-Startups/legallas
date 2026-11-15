// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

public enum MenuBarLogic {

    public static func isNoteDraftValid(body: String) -> Bool {
        !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func isTaskDraftValid(title: String) -> Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public static func noteEnvelope(
        title: String,
        body: String,
        id: UUID = UUID(),
        proposedAt: Date = Date()
    ) -> ProposalEnvelope {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload = NotePayload(
            title: trimmedTitle.isEmpty ? nil : trimmedTitle,
            bodyMarkdown: body
        )
        return ProposalEnvelope(
            id: id,
            type: .note,
            proposedAt: proposedAt,
            source: "menubar",
            rationale: "Quick capture from menu bar",
            payload: .note(payload)
        )
    }

    public static func taskEnvelope(
        title: String,
        dueDate: Date?,
        id: UUID = UUID(),
        proposedAt: Date = Date()
    ) -> ProposalEnvelope {
        let payload = TaskPayload(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            dueDate: dueDate
        )
        return ProposalEnvelope(
            id: id,
            type: .task,
            proposedAt: proposedAt,
            source: "menubar",
            rationale: "Quick capture from menu bar",
            payload: .task(payload)
        )
    }

    public static func noteProposalPayload(
        title: String,
        body: String,
        id: UUID = UUID(),
        proposedAt: Date = Date()
    ) throws -> String {
        try ProposalCodec.payloadJSONString(
            noteEnvelope(title: title, body: body, id: id, proposedAt: proposedAt)
        )
    }

    public static func taskProposalPayload(
        title: String,
        dueDate: Date?,
        id: UUID = UUID(),
        proposedAt: Date = Date()
    ) throws -> String {
        try ProposalCodec.payloadJSONString(
            taskEnvelope(title: title, dueDate: dueDate, id: id, proposedAt: proposedAt)
        )
    }
}
