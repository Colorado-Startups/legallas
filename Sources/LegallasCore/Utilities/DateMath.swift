// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Date helpers that count days and weekends in Denver time.
public enum DateMath {

    /// Denver time zone, America/Denver.
    public static let denverTimeZone: TimeZone = TimeZone(identifier: "America/Denver")!

    /// Gregorian calendar set to the Denver time zone.
    public static var denverCalendar: Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = denverTimeZone
        return cal
    }

    /// Returns the start of the given date's day in Denver time.
    public static func startOfDay(_ date: Date) -> Date {
        denverCalendar.startOfDay(for: date)
    }

    /// Returns the date moved by the given number of days, or the original date if the calendar cannot.
    public static func addDays(_ days: Int, to date: Date) -> Date {
        denverCalendar.date(byAdding: .day, value: days, to: date) ?? date
    }

    /// Returns whether the date falls on a Saturday or Sunday in Denver time.
    public static func isWeekend(_ date: Date) -> Bool {
        let weekday = denverCalendar.component(.weekday, from: date)
        return weekday == 1 || weekday == 7
    }

    /// Returns whether the date's day is in the holiday set.
    public static func isHoliday(_ date: Date, holidays: Set<Date>) -> Bool {
        holidays.contains(startOfDay(date))
    }

    /// Returns whether the date falls on a weekend or a holiday.
    public static func isWeekendOrHoliday(_ date: Date, holidays: Set<Date>) -> Bool {
        isWeekend(date) || isHoliday(date, holidays: holidays)
    }

    /// Returns the start of the date's day, moved forward past any weekend or holiday days.
    public static func rollForwardIfNeeded(_ date: Date, holidays: Set<Date>) -> Date {
        var candidate = startOfDay(date)
        while isWeekendOrHoliday(candidate, holidays: holidays) {
            candidate = addDays(1, to: candidate)
        }
        return candidate
    }

    /// Returns the number of whole days from the first date's day to the second date's day.
    public static func daysBetween(_ from: Date, _ to: Date) -> Int {
        let start = startOfDay(from)
        let end = startOfDay(to)
        let components = denverCalendar.dateComponents([.day], from: start, to: end)
        return components.day ?? 0
    }
}
