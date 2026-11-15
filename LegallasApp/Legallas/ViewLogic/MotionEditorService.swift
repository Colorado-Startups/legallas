// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

public struct MotionEditorDraft: Sendable {
    public var title: String
    public var motionType: MotionType
    public var filedBy: MotionFiler
    public var filedAt: Date
    public var responseDueAt: Date?
    public var replyDueAt: Date?
    public var hearingAt: Date?
    public var status: MotionStatus
    public var ruling: String
    public var notes: String
    public var documentIDs: Set<PersistentIdentifier>

    public init(
        title: String = "",
        motionType: MotionType = .custom,
        filedBy: MotionFiler = .us,
        filedAt: Date = Date(),
        responseDueAt: Date? = nil,
        replyDueAt: Date? = nil,
        hearingAt: Date? = nil,
        status: MotionStatus = .pending,
        ruling: String = "",
        notes: String = "",
        documentIDs: Set<PersistentIdentifier> = []
    ) {
        self.title = title
        self.motionType = motionType
        self.filedBy = filedBy
        self.filedAt = filedAt
        self.responseDueAt = responseDueAt
        self.replyDueAt = replyDueAt
        self.hearingAt = hearingAt
        self.status = status
        self.ruling = ruling
        self.notes = notes
        self.documentIDs = documentIDs
    }
}

@MainActor
public enum MotionEditorService {

    @discardableResult
    public static func apply(
        _ draft: MotionEditorDraft,
        existing: Motion?,
        caseOwner: Case?,
        context: ModelContext,
        allDocuments: [Document]
    ) -> Motion {
        let trimmedTitle = draft.title.trimmingCharacters(in: .whitespaces)

        let motion: Motion
        if let existing {
            motion = existing
            motion.title = trimmedTitle
            motion.motionType = draft.motionType
            motion.filedBy = draft.filedBy
            motion.filedAt = draft.filedAt
            motion.responseDueAt = draft.responseDueAt
            motion.replyDueAt = draft.replyDueAt
            motion.hearingAt = draft.hearingAt
            motion.status = draft.status
            motion.ruling = draft.ruling
            motion.notes = draft.notes
        } else {
            motion = Motion(
                title: trimmedTitle,
                motionType: draft.motionType,
                filedBy: draft.filedBy,
                filedAt: draft.filedAt,
                responseDueAt: draft.responseDueAt,
                replyDueAt: draft.replyDueAt,
                hearingAt: draft.hearingAt,
                status: draft.status,
                ruling: draft.ruling,
                notes: draft.notes
            )
            context.insert(motion)
            caseOwner?.motions.append(motion)
        }

        motion.documents = allDocuments.filter { draft.documentIDs.contains($0.persistentModelID) }

        try? context.save()
        return motion
    }
}
