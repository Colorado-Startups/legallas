// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

/// A reminder reduced to the values the notification center needs, so it can cross into
/// an async scheduling task without carrying a SwiftData model along.
struct ReminderNotification: Equatable, Sendable {
    let identifier: String
    let title: String
    let body: String
    let fireDate: Date

    /// Builds the notification for `reminder` on `deadline`, or returns nil when
    /// `shouldSchedule` says it should not alert.
    @MainActor
    static func make(for reminder: Reminder, on deadline: Deadline, now: Date = Date()) -> ReminderNotification? {
        guard shouldSchedule(reminder, on: deadline, now: now) else { return nil }
        return ReminderNotification(
            identifier: reminder.notificationIdentifier,
            title: deadline.title,
            body: body(leadTimeDays: reminder.leadTimeDays, dueDate: deadline.computedDate),
            fireDate: reminder.fireDate
        )
    }

    /// Decides whether a reminder still deserves a macOS notification: not yet delivered,
    /// its deadline still open (matching how the MCP and case summary skip satisfied
    /// deadlines), and a fire time still ahead. No overdue check is needed because lead
    /// times are at least one day, so a reminder always fires before its due date.
    @MainActor
    static func shouldSchedule(_ reminder: Reminder, on deadline: Deadline, now: Date) -> Bool {
        !reminder.delivered && !deadline.isSatisfied && reminder.fireDate > now
    }

    /// Notification body, for example "Due in 7 days (May 4, 2013)".
    @MainActor
    static func body(leadTimeDays: Int, dueDate: Date) -> String {
        let unit = leadTimeDays == 1 ? "day" : "days"
        return "Due in \(leadTimeDays) \(unit) (\(Formatters.displayDate.string(from: dueDate)))"
    }
}

/// Notification work left after a deadline's reminders are rebuilt: pending requests to
/// remove for the deleted reminders, and notifications to add for the new ones.
struct ReminderChange: Equatable, Sendable {
    var cancelledIdentifiers: [String] = []
    var scheduled: [ReminderNotification] = []
}

/// Rebuilds a deadline's reminder rows and reports the matching notification work.
@MainActor
enum ReminderSync {

    /// Deletes every reminder on `deadline`, inserts one per entry in `fires`, and returns
    /// what `NotificationService.apply(_:)` must cancel and schedule. Rows are created for
    /// every fire date, including past ones; only the notifications are filtered.
    static func replaceReminders(
        on deadline: Deadline,
        with fires: [(leadTimeDays: Int, fireDate: Date)],
        in context: ModelContext,
        now: Date = Date()
    ) -> ReminderChange {
        let cancelled = deadline.reminders.map(\.notificationIdentifier)
        for existing in deadline.reminders {
            context.delete(existing)
        }
        deadline.reminders = []

        var scheduled: [ReminderNotification] = []
        for fire in fires {
            let reminder = Reminder(leadTimeDays: fire.leadTimeDays, fireDate: fire.fireDate)
            context.insert(reminder)
            deadline.reminders.append(reminder)
            if let notification = ReminderNotification.make(for: reminder, on: deadline, now: now) {
                scheduled.append(notification)
            }
        }
        return ReminderChange(cancelledIdentifiers: cancelled, scheduled: scheduled)
    }
}
