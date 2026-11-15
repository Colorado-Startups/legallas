// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A deadline on a case, counted from an anchor event, with its computed date and reminders.
@Model
public final class Deadline {
    /// Short deadline title.
    public var title: String = ""
    /// Stored raw value of the anchor event.
    public var anchorRaw: String = AnchorEvent.custom.rawValue
    /// Date of the anchor event, if known.
    public var anchorDate: Date?
    /// Label for the anchor when it is a custom event.
    public var customAnchorLabel: String?
    /// Days between the anchor and the deadline.
    public var offsetDays: Int = 0
    /// Stored raw value of the deadline direction.
    public var directionRaw: String = DeadlineDirection.after.rawValue
    /// Whether a deadline landing on a weekend or holiday moves to the next court day.
    public var applyWeekendRollover: Bool = true
    /// Deadline date after calculation.
    public var computedDate: Date = Date.distantFuture
    /// Whether the deadline has been met.
    public var isSatisfied: Bool = false
    /// When the deadline was marked met.
    public var satisfiedAt: Date?
    /// Rule or statute the deadline comes from, if any.
    public var ruleCitation: String?
    /// Free-text notes on the deadline.
    public var notesText: String?
    /// Stored raw value of where the deadline came from.
    public var sourceRaw: String = DataSource.user.rawValue

    /// Case the deadline belongs to.
    public var `case`: Case?

    /// Tasks tied to the deadline.
    @Relationship(deleteRule: .nullify, inverse: \CaseTask.deadline)
    public var tasks: [CaseTask] = []

    /// Reminders for the deadline; deleted along with it.
    @Relationship(deleteRule: .cascade, inverse: \Reminder.deadline)
    public var reminders: [Reminder] = []

    /// Event the deadline is counted from; an unreadable stored value reads as custom.
    public var anchor: AnchorEvent {
        get { AnchorEvent(rawValue: anchorRaw) ?? .custom }
        set { anchorRaw = newValue.rawValue }
    }

    /// Whether the deadline falls before or after the anchor; an unreadable stored value reads as after.
    public var direction: DeadlineDirection {
        get { DeadlineDirection(rawValue: directionRaw) ?? .after }
        set { directionRaw = newValue.rawValue }
    }

    /// Whether the user, Claude or an import created the deadline; an unreadable stored value reads as user.
    public var source: DataSource {
        get { DataSource(rawValue: sourceRaw) ?? .user }
        set { sourceRaw = newValue.rawValue }
    }

    /// Creates a deadline; direction defaults to after the anchor and weekend rollover to on.
    public init(
        title: String,
        anchor: AnchorEvent,
        anchorDate: Date? = nil,
        customAnchorLabel: String? = nil,
        offsetDays: Int,
        direction: DeadlineDirection = .after,
        applyWeekendRollover: Bool = true,
        computedDate: Date,
        ruleCitation: String? = nil,
        notesText: String? = nil,
        source: DataSource = .user
    ) {
        self.title = title
        self.anchorRaw = anchor.rawValue
        self.anchorDate = anchorDate
        self.customAnchorLabel = customAnchorLabel
        self.offsetDays = offsetDays
        self.directionRaw = direction.rawValue
        self.applyWeekendRollover = applyWeekendRollover
        self.computedDate = computedDate
        self.ruleCitation = ruleCitation
        self.notesText = notesText
        self.sourceRaw = source.rawValue
    }
}
