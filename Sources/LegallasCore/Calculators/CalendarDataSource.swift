// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Court holiday calendar loaded from JSON, used to roll deadlines past non-court days.
public struct CalendarDataSource: Sendable {
    /// Start-of-day dates on which the court is closed.
    public let holidays: Set<Date>
    /// Where the holiday list came from, as stated in the JSON file.
    public let source: String
    /// Free-text notes about the holiday list, as stated in the JSON file.
    public let notes: String

    /// Creates a data source from a holiday set, with optional source and notes text.
    public init(holidays: Set<Date>, source: String = "", notes: String = "") {
        self.holidays = holidays
        self.source = source
        self.notes = notes
    }

    /// Loads the Colorado court holiday JSON from the given bundle, throwing if the resource is missing or invalid.
    public static func loadColoradoCourtHolidays(bundle: Bundle) throws -> CalendarDataSource {
        guard let url = bundle.url(forResource: "ColoradoCourtHolidays", withExtension: "json") else {
            throw CalendarDataSourceError.resourceNotFound
        }
        let data = try Data(contentsOf: url)
        return try decode(data)
    }

    /// Loads the Colorado court holiday JSON bundled with this package.
    public static func loadBundledColoradoCourtHolidays() throws -> CalendarDataSource {
        try loadColoradoCourtHolidays(bundle: .module)
    }

    /// Parses holiday JSON into a data source, normalizing each ISO date to the start of its day.
    public static func decode(_ data: Data) throws -> CalendarDataSource {
        let decoded = try JSONDecoder().decode(RawFile.self, from: data)
        let dates = try decoded.holidays.map { raw -> Date in
            guard let date = Formatters.isoDate.date(from: raw) else {
                throw CalendarDataSourceError.invalidDate(raw)
            }
            return DateMath.startOfDay(date)
        }
        return CalendarDataSource(
            holidays: Set(dates),
            source: decoded.source,
            notes: decoded.notes
        )
    }

    private struct RawFile: Decodable {
        let source: String
        let notes: String
        let holidays: [String]
    }
}

/// Errors thrown while loading the court holiday calendar.
public enum CalendarDataSourceError: Error, CustomStringConvertible {
    case resourceNotFound
    case invalidDate(String)

    /// Human-readable message for the error case.
    public var description: String {
        switch self {
        case .resourceNotFound:
            return "ColoradoCourtHolidays.json not found in bundle"
        case .invalidDate(let raw):
            return "Invalid date in holidays JSON: \(raw)"
        }
    }
}
