// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("DateMath")
struct DateMathTests {

    static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var dc = DateComponents()
        dc.year = year
        dc.month = month
        dc.day = day
        dc.timeZone = DateMath.denverTimeZone
        return DateMath.denverCalendar.date(from: dc)!
    }

    @Test("Weekend detection uses Denver calendar weekdays")
    func weekendDetection() {
        #expect(DateMath.isWeekend(Self.date(2027, 8, 14)) == true)  // Saturday
        #expect(DateMath.isWeekend(Self.date(2027, 8, 15)) == true)  // Sunday
        #expect(DateMath.isWeekend(Self.date(2027, 8, 16)) == false) // Monday
    }

    @Test("Adding days crosses months correctly")
    func addDaysAcrossMonth() {
        let start = Self.date(2028, 4, 19)
        let plus63 = DateMath.addDays(63, to: start)
        #expect(DateMath.denverCalendar.isDate(plus63, inSameDayAs: Self.date(2028, 6, 21)))
    }

    @Test("Rollover skips weekends")
    func rolloverSkipsWeekend() {
        let saturday = Self.date(2027, 10, 23)
        let rolled = DateMath.rollForwardIfNeeded(saturday, holidays: [])
        #expect(DateMath.denverCalendar.isDate(rolled, inSameDayAs: Self.date(2027, 10, 25)))
    }

    @Test("Rollover skips holiday then weekend")
    func rolloverSkipsHolidayThenWeekend() {
        // If December 24, 2027 (Fri) is the observed Christmas holiday, and Dec 25-26 are weekend,
        // a deadline landing Dec 24 rolls to Monday Dec 27.
        let holiday = Self.date(2027, 12, 24)
        let rolled = DateMath.rollForwardIfNeeded(holiday, holidays: [holiday])
        #expect(DateMath.denverCalendar.isDate(rolled, inSameDayAs: Self.date(2027, 12, 27)))
    }

    @Test("daysBetween is inclusive of day boundaries")
    func daysBetween() {
        let a = Self.date(2028, 7, 14)
        let b = Self.date(2028, 9, 15)
        #expect(DateMath.daysBetween(a, b) == 63)
    }
}
