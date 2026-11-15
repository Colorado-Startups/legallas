// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Inputs for a deadline: an anchor date, a day offset, a direction and whether to roll off non-court days.
public struct DeadlineInputs: Sendable, Equatable {
    /// Date the offset is counted from.
    public let anchor: Date
    /// Number of days between the anchor and the deadline.
    public let offsetDays: Int
    /// Whether the deadline falls after or before the anchor.
    public let direction: DeadlineDirection
    /// Whether a deadline landing on a weekend or holiday moves to the next court day.
    public let applyRollover: Bool

    /// Creates deadline inputs; direction defaults to after the anchor and rollover to on.
    public init(
        anchor: Date,
        offsetDays: Int,
        direction: DeadlineDirection = .after,
        applyRollover: Bool = true
    ) {
        self.anchor = anchor
        self.offsetDays = offsetDays
        self.direction = direction
        self.applyRollover = applyRollover
    }
}

/// Computes deadline dates and reminder times.
public enum DeadlineCalculator {

    /// Returns the deadline date: the anchor shifted by the offset, then rolled forward past weekends and holidays when rollover is on.
    public static func compute(_ inputs: DeadlineInputs, holidays: Set<Date>) -> Date {
        let signedOffset: Int = {
            switch inputs.direction {
            case .after:  return inputs.offsetDays
            case .before: return -inputs.offsetDays
            }
        }()
        let raw = DateMath.addDays(signedOffset, to: DateMath.startOfDay(inputs.anchor))
        guard inputs.applyRollover else { return raw }
        return DateMath.rollForwardIfNeeded(raw, holidays: holidays)
    }

    /// Returns a reminder fire date for each lead time in days before the deadline, at the given time of day in Denver.
    public static func reminderFireDates(
        for computedDate: Date,
        leadTimes: [Int],
        at time: DateComponents = DateComponents(hour: 9, minute: 0)
    ) -> [(leadTimeDays: Int, fireDate: Date)] {
        let cal = DateMath.denverCalendar
        return leadTimes.map { lead in
            let day = DateMath.addDays(-lead, to: DateMath.startOfDay(computedDate))
            var dc = cal.dateComponents([.year, .month, .day], from: day)
            dc.hour = time.hour
            dc.minute = time.minute
            dc.timeZone = DateMath.denverTimeZone
            let fire = cal.date(from: dc) ?? day
            return (lead, fire)
        }
    }
}
