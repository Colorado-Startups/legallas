// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// A scheduled reminder for a deadline, fired a set number of days ahead.
@Model
public final class Reminder {
    /// Days before the deadline that the reminder fires.
    public var leadTimeDays: Int = 0
    /// Date and time the reminder fires.
    public var fireDate: Date = Date.distantFuture
    /// Whether the reminder has been delivered.
    public var delivered: Bool = false
    /// When the reminder was dismissed, if it was.
    public var dismissedAt: Date?
    /// Identifier of the scheduled notification for this reminder.
    public var notificationIdentifier: String = UUID().uuidString

    /// Deadline the reminder belongs to.
    public var deadline: Deadline?

    /// Creates a reminder that has not been delivered; the notification identifier defaults to a new UUID string.
    public init(
        leadTimeDays: Int,
        fireDate: Date,
        notificationIdentifier: String = UUID().uuidString
    ) {
        self.leadTimeDays = leadTimeDays
        self.fireDate = fireDate
        self.delivered = false
        self.notificationIdentifier = notificationIdentifier
    }
}
