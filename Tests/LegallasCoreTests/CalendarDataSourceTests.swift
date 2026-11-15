// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("CalendarDataSource")
struct CalendarDataSourceTests {

    @Test("Bundled Colorado holidays load and parse")
    func loadBundled() throws {
        let ds = try CalendarDataSource.loadBundledColoradoCourtHolidays()
        #expect(!ds.holidays.isEmpty)
        // Spot-check known observances
        let expected = [
            (2026, 1, 1),     // New Year's Day
            (2026, 7, 3),     // Indep Day observed (Jul 4 = Sat)
            (2026, 11, 26),   // Thanksgiving
            (2026, 12, 25),   // Christmas
            (2027, 7, 5),     // Indep Day observed (Jul 4 = Sun)
            (2027, 12, 24)    // Christmas observed (Dec 25 = Sat)
        ]
        for (y, m, d) in expected {
            var dc = DateComponents()
            dc.year = y; dc.month = m; dc.day = d
            dc.timeZone = DateMath.denverTimeZone
            let date = DateMath.denverCalendar.date(from: dc)!
            #expect(ds.holidays.contains(DateMath.startOfDay(date)), "Missing holiday \(y)-\(m)-\(d)")
        }
    }

    @Test("Invalid date strings are rejected")
    func invalidDate() {
        let badJSON = """
        { "source": "", "notes": "", "holidays": ["not-a-date"] }
        """
        let data = Data(badJSON.utf8)
        #expect(throws: CalendarDataSourceError.self) {
            _ = try CalendarDataSource.decode(data)
        }
    }
}
