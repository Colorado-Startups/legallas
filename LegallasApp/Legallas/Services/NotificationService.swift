// SPDX-License-Identifier: Apache-2.0
import Foundation
import UserNotifications
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "Notifications")

/// Schedules and cancels the macOS notifications behind deadline reminders.
///
/// macOS only lets a process inside a `.app` bundle use `UNUserNotificationCenter`; calling
/// it from the bare SwiftPM executable crashes the process. Every entry point goes through
/// `center`, which logs once and returns nil outside a bundle, so the app keeps running and
/// reminders start firing as soon as it is launched as `Legallas.app`.
@MainActor
final class NotificationService {

    static let shared = NotificationService()

    private var loggedUnbundled = false

    private init() {}

    /// True only for a `.app` bundle with a bundle identifier.
    nonisolated static func isRunningInAppBundle(_ bundle: Bundle) -> Bool {
        bundle.bundleIdentifier != nil && bundle.bundleURL.pathExtension == "app"
    }

    private var center: UNUserNotificationCenter? {
        guard Self.isRunningInAppBundle(Bundle.main) else {
            if !loggedUnbundled {
                loggedUnbundled = true
                logger.notice("Not running inside a .app bundle; reminder notifications are off")
            }
            return nil
        }
        return UNUserNotificationCenter.current()
    }

    func requestAuthorization() async {
        guard let center else { return }
        do {
            _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            logger.error("Notification authorization failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Removes pending requests for replaced reminders, then schedules the new ones.
    func apply(_ change: ReminderChange) {
        guard let center else { return }
        if !change.cancelledIdentifiers.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: change.cancelledIdentifiers)
        }
        let notifications = change.scheduled
        Task {
            for notification in notifications {
                await self.add(notification)
            }
        }
    }

    /// Clears every pending Legallas request and reschedules each reminder the store says is
    /// still due. Run at launch; re-adding is idempotent and clears anything stale.
    func reconcileAllPending(context: ModelContext) async {
        guard let center else { return }
        let reminders: [Reminder]
        do {
            reminders = try context.fetch(FetchDescriptor<Reminder>())
        } catch {
            logger.error("Fetching reminders failed: \(error.localizedDescription, privacy: .public)")
            return
        }
        let now = Date()
        let notifications = reminders.compactMap { reminder in
            reminder.deadline.flatMap { ReminderNotification.make(for: reminder, on: $0, now: now) }
        }
        center.removeAllPendingNotificationRequests()
        for notification in notifications {
            await add(notification)
        }
        logger.info("Scheduled \(notifications.count) reminder notification(s)")
    }

    private func add(_ notification: ReminderNotification) async {
        guard let center else { return }
        let content = UNMutableNotificationContent()
        content.title = notification.title
        content.body = notification.body
        content.sound = .default

        let comps = Calendar(identifier: .gregorian).dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: notification.fireDate
        )
        let request = UNNotificationRequest(
            identifier: notification.identifier,
            content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false)
        )
        do {
            try await center.add(request)
        } catch {
            logger.error("Scheduling reminder failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
