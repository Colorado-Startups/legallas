// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A motion on a case, with who filed it, its due dates, hearing, status and ruling.
@Model
public final class Motion {
    /// Title of the motion.
    public var title: String = ""
    /// Stored raw value of the motion type.
    public var motionTypeRaw: String = MotionType.custom.rawValue
    /// Stored raw value of which side filed the motion.
    public var filedByRaw: String = MotionFiler.us.rawValue
    /// Date the motion was filed.
    public var filedAt: Date = Date()
    /// Date the response is due, if set.
    public var responseDueAt: Date?
    /// Date the reply is due, if set.
    public var replyDueAt: Date?
    /// Date and time of the hearing, if set.
    public var hearingAt: Date?
    /// Stored raw value of the motion status.
    public var statusRaw: String = MotionStatus.pending.rawValue
    /// Text of the court's ruling.
    public var ruling: String = ""
    /// Free-text notes on the motion.
    public var notes: String = ""
    /// When the motion record was created.
    public var createdAt: Date = Date()

    /// Case the motion belongs to.
    public var `case`: Case?

    /// Documents linked to the motion.
    @Relationship(deleteRule: .nullify, inverse: \Document.motions)
    public var documents: [Document] = []

    /// Kind of motion; an unreadable stored value reads as custom.
    public var motionType: MotionType {
        get { MotionType(rawValue: motionTypeRaw) ?? .custom }
        set { motionTypeRaw = newValue.rawValue }
    }

    /// Which side filed the motion; an unreadable stored value reads as us.
    public var filedBy: MotionFiler {
        get { MotionFiler(rawValue: filedByRaw) ?? .us }
        set { filedByRaw = newValue.rawValue }
    }

    /// Where the motion stands; an unreadable stored value reads as pending.
    public var status: MotionStatus {
        get { MotionStatus(rawValue: statusRaw) ?? .pending }
        set { statusRaw = newValue.rawValue }
    }

    /// Creates a motion; status defaults to pending and the ruling and notes to empty.
    public init(
        title: String,
        motionType: MotionType,
        filedBy: MotionFiler,
        filedAt: Date,
        responseDueAt: Date? = nil,
        replyDueAt: Date? = nil,
        hearingAt: Date? = nil,
        status: MotionStatus = .pending,
        ruling: String = "",
        notes: String = ""
    ) {
        self.title = title
        self.motionTypeRaw = motionType.rawValue
        self.filedByRaw = filedBy.rawValue
        self.filedAt = filedAt
        self.responseDueAt = responseDueAt
        self.replyDueAt = replyDueAt
        self.hearingAt = hearingAt
        self.statusRaw = status.rawValue
        self.ruling = ruling
        self.notes = notes
        self.createdAt = Date()
    }
}
