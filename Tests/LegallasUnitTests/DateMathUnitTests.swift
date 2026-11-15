// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("DateMathUnit")
struct DateMathUnitTests {

    static func date(_ year: Int, _ month: Int, _ day: Int) -> Date {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.timeZone = DateMath.denverTimeZone
        return DateMath.denverCalendar.date(from: components)!
    }

    @Test("startOfDay strips time components in Denver timezone")
    func startOfDayStripsTime() {
        var components = DateComponents()
        components.year = 2027
        components.month = 9
        components.day = 22
        components.hour = 14
        components.minute = 37
        components.second = 22
        components.timeZone = DateMath.denverTimeZone
        let withTime = DateMath.denverCalendar.date(from: components)!
        let start = DateMath.startOfDay(withTime)
        let startComponents = DateMath.denverCalendar.dateComponents([.hour, .minute, .second], from: start)
        #expect(startComponents.hour == 0)
        #expect(startComponents.minute == 0)
        #expect(startComponents.second == 0)
    }

    @Test("isHoliday matches only the exact SOD date")
    func isHolidayExactMatch() {
        let holiday = Self.date(2028, 5, 29)
        #expect(DateMath.isHoliday(holiday, holidays: [holiday]) == true)
        #expect(DateMath.isHoliday(Self.date(2028, 5, 30), holidays: [holiday]) == false)
        #expect(DateMath.isHoliday(holiday, holidays: []) == false)
    }

    @Test("isWeekendOrHoliday covers both conditions independently")
    func isWeekendOrHolidayCombined() {
        let friday = Self.date(2028, 3, 31)
        let saturday = Self.date(2028, 4, 1)
        #expect(DateMath.isWeekendOrHoliday(friday, holidays: []) == false)
        #expect(DateMath.isWeekendOrHoliday(saturday, holidays: []) == true)
        #expect(DateMath.isWeekendOrHoliday(friday, holidays: [friday]) == true)
    }

    @Test("daysBetween returns zero for same date")
    func daysBetweenSameDate() {
        let sameDate = Self.date(2028, 8, 8)
        #expect(DateMath.daysBetween(sameDate, sameDate) == 0)
    }

    @Test("daysBetween is negative when from > to")
    func daysBetweenNegative() {
        let later = Self.date(2028, 9, 19)
        let earlier = Self.date(2028, 9, 12)
        #expect(DateMath.daysBetween(later, earlier) == -7)
    }
}
