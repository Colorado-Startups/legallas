// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Shared date, time and currency formatters.
public enum Formatters {

    /// Formatter for dates written as year-month-day in Denver time.
    public static var isoDate: ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = DateMath.denverTimeZone
        return f
    }

    /// Formatter for full ISO 8601 date and time strings with fractional seconds.
    public static var isoDateTime: ISO8601DateFormatter {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }

    /// Formatter for medium-style dates without a time, in Denver time.
    public static var displayDate: DateFormatter {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .none
        f.timeZone = DateMath.denverTimeZone
        return f
    }

    /// Formatter for medium-style dates with a short time, in Denver time.
    public static var displayDateTime: DateFormatter {
        let f = DateFormatter()
        f.dateStyle = .medium
        f.timeStyle = .short
        f.timeZone = DateMath.denverTimeZone
        return f
    }

    /// Formatter for US dollar amounts without cents.
    public static var currency: NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.maximumFractionDigits = 0
        return f
    }

    /// Formats an amount as US dollars, or $0 if it cannot be formatted.
    public static func formatMoney(_ amount: Decimal) -> String {
        currency.string(from: NSDecimalNumber(decimal: amount)) ?? "$0"
    }

    /// Parses a date from a year-month-day string, falling back to a full ISO 8601 date and time.
    public static func parseISODate(_ string: String) -> Date? {
        isoDate.date(from: string) ?? isoDateTime.date(from: string)
    }
}
