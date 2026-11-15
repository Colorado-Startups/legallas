// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("DeadlineCalculator")
struct DeadlineCalculatorTests {

    static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var dc = DateComponents()
        dc.year = year
        dc.month = month
        dc.day = day
        dc.timeZone = DateMath.denverTimeZone
        return DateMath.denverCalendar.date(from: dc)!
    }

    @Test("CRCP 4 service deadline: 63 days after filing")
    func serviceDeadline() throws {
        let holidays = try CalendarDataSource.loadBundledColoradoCourtHolidays().holidays
        let filing = Self.date(2028, 4, 11)
        let inputs = DeadlineInputs(anchor: filing, offsetDays: 63, direction: .after)
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2028, 6, 13)))
    }

    @Test("CRCP 12(a)(1) answer: 21 days after service")
    func answerDeadline() throws {
        let holidays = try CalendarDataSource.loadBundledColoradoCourtHolidays().holidays
        let service = Self.date(2027, 9, 15) // hypothetical Wednesday
        let inputs = DeadlineInputs(anchor: service, offsetDays: 21, direction: .after)
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        // Sep 15 + 21 days = Oct 6 (Wednesday in 2027), no rollover.
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2027, 10, 6)))
    }

    @Test("CMC: 49 days from at-issue date")
    func cmcDeadline() throws {
        let holidays = try CalendarDataSource.loadBundledColoradoCourtHolidays().holidays
        let atIssue = Self.date(2027, 8, 12)
        let inputs = DeadlineInputs(anchor: atIssue, offsetDays: 49, direction: .after)
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        // 8/12 + 49 = 9/30 (Thursday 2027). No rollover.
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2027, 9, 30)))
    }

    @Test("Weekend rollover: Saturday deadline rolls to Monday")
    func weekendRollover() throws {
        let holidays = try CalendarDataSource.loadBundledColoradoCourtHolidays().holidays
        // Pick an anchor such that anchor + offsetDays lands on a Saturday.
        // 2027-10-15 (Fri) + 1 day = Sat 2027-10-16. Expect Monday 2027-10-18.
        let anchor = Self.date(2027, 10, 15)
        let inputs = DeadlineInputs(anchor: anchor, offsetDays: 1, direction: .after)
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2027, 10, 18)))
    }

    @Test("Holiday rollover: deadline landing on observed Independence Day 2027")
    func holidayRollover() throws {
        let holidays = try CalendarDataSource.loadBundledColoradoCourtHolidays().holidays
        // Jul 5 2027 is observed Independence Day (Jul 4 = Sunday). A deadline on Mon Jul 5 rolls to Tue Jul 6.
        let anchor = Self.date(2027, 6, 28)
        let inputs = DeadlineInputs(anchor: anchor, offsetDays: 7, direction: .after)
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2027, 7, 6)))
    }

    @Test("Direction .before subtracts days")
    func directionBefore() throws {
        let holidays = try CalendarDataSource.loadBundledColoradoCourtHolidays().holidays
        // Expert disclosures: 120 days before a (hypothetical) trial date of 2028-03-20 (Mon).
        let trial = Self.date(2028, 3, 20)
        let inputs = DeadlineInputs(anchor: trial, offsetDays: 120, direction: .before)
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        // 2028-03-20 minus 120 days = 2027-11-21 (Sunday). Rolls to Mon 2027-11-22.
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2027, 11, 22)))
    }

    @Test("applyRollover=false skips weekend adjustment")
    func noRolloverWhenDisabled() throws {
        let anchor = Self.date(2027, 10, 15)
        let inputs = DeadlineInputs(anchor: anchor, offsetDays: 1, direction: .after, applyRollover: false)
        let computed = DeadlineCalculator.compute(inputs, holidays: [])
        #expect(DateMath.denverCalendar.isDate(computed, inSameDayAs: Self.date(2027, 10, 16)))
    }

    @Test("reminderFireDates returns one entry per lead time")
    func reminderFireDates() {
        let computedDate = Self.date(2028, 9, 13)
        let fires = DeadlineCalculator.reminderFireDates(for: computedDate, leadTimes: [30, 7, 1])
        #expect(fires.count == 3)
        #expect(fires[0].leadTimeDays == 30)
        #expect(fires[1].leadTimeDays == 7)
        #expect(fires[2].leadTimeDays == 1)
        // 30-day fire should land on 2028-08-14
        let fireDay = DateMath.startOfDay(fires[0].fireDate)
        #expect(DateMath.denverCalendar.isDate(fireDay, inSameDayAs: Self.date(2028, 8, 14)))
    }
}
