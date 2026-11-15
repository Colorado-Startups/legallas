// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation
import Testing
@testable import LegallasExtraction

/// End-to-end OCR of synthetic scans with real layouts. These need Vision's accurate
/// recognizer, which needs a Neural Engine; CI runs them on a hosted Mac that has one.
///
/// Each extraction runs off the cooperative pool through `OffPool`, which explains why.
@Suite("OCR layout")
struct OCRLayoutTests {

    /// Extracts `url` through `OffPool` and returns its only page.
    static func extract(_ url: URL) async throws -> ExtractedPage {
        let result = try await OffPool.extract(url)
        return try #require(result.pages.first)
    }

    @Test("4-column table reads row by row, every row's cells on one line")
    func tableReadsRowByRow() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.scannedPDF("table.pdf", dpi: 300, draw: ScanLayouts.drawTable)

        let page = try await Self.extract(url)
        let rows = page.text.split(separator: "\n").map { $0.split(separator: "\t").map(String.init) }

        #expect(page.ocr == true)
        #expect(rows.first == ["SCHEDULE OF PAYMENTS"])
        #expect(rows.contains(ScanLayouts.tableHeader))
        var numbered = 0
        for expected in ScanLayouts.tableRows {
            // Date, amount and payee must share one line, in order; the row number, when
            // recognized, must lead that same line.
            let row = rows.first { Array($0.suffix(3)) == Array(expected.suffix(3)) }
            #expect(row != nil, "row \(expected[0]) did not come out on one line")
            if let row, row.count == 4 {
                #expect(row[0] == expected[0])
                numbered += 1
            }
        }
        // The page pass alone can drop a row number; the column strip recovers it.
        #expect(numbered == ScanLayouts.tableRows.count)
        let dueDates = rows.compactMap { $0.count >= 3 ? $0[$0.count - 3] : nil }.filter { $0.contains("/") }
        #expect(dueDates == ScanLayouts.tableRows.map { $0[1] }, "rows must stay in top to bottom order")
    }

    @Test("two-column page reads column by column")
    func twoColumnPageReadsColumnByColumn() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.scannedPDF("columns.pdf", dpi: 300, draw: ScanLayouts.drawTwoColumns)

        let page = try await Self.extract(url)
        let text = Self.collapsed(page.text)

        #expect(page.ocr == true)
        #expect(page.text.contains("\t") == false, "prose must never be treated as a table")
        let left = try #require(text.range(of: Self.collapsed(ScanLayouts.leftColumn)))
        let right = try #require(text.range(of: Self.collapsed(ScanLayouts.rightColumn)))
        #expect(left.upperBound <= right.lowerBound)
    }

    @Test("dollar amounts and dates survive exactly")
    func amountsAndDatesSurvive() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.scannedPDF("clauses.pdf", dpi: 300) { context in
            ScanLayouts.drawClauses(size: 12, width: 468, in: context)
        }

        let page = try await Self.extract(url)
        let text = Self.collapsed(page.text)

        for token in Self.amountsAndDates {
            #expect(text.contains(token), "missing \(token)")
        }
    }

    @Test("page whose 300 dpi read drops a paragraph still yields every paragraph")
    func droppedParagraphIsRecovered() async throws {
        // On macOS 27 the full-page pass drops paragraph 16 of this exact page, with every
        // remaining line at confidence 1.0; the uncovered ink band is re-read as a crop.
        try await Self.expectEveryClause(size: 9.6, width: 480)
    }

    @Test("page Vision mangles at 300 dpi reads cleanly after the 400 dpi retry")
    func mangledParagraphIsRetried() async throws {
        // On macOS 27 the full-page pass returns paragraph 16 of this exact page as two
        // crossed, garbled fragments at confidence 1.0; the crossing triggers the retry.
        try await Self.expectEveryClause(size: 9.8, width: 470)
    }

    /// OCRs the clauses page at `size` and `width` and expects every heading, amount and date.
    static func expectEveryClause(size: CGFloat, width: CGFloat) async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.scannedPDF("clauses-\(size)-\(width).pdf", dpi: 300) { context in
            ScanLayouts.drawClauses(size: size, width: width, in: context)
        }

        let page = try await extract(url)
        let text = collapsed(page.text)

        for heading in ["12. Entire Agreement.", "13. Amendment.", "14. Counterparts.", "15. Severability.", "16. Expenses."] {
            #expect(text.contains(heading), "missing \(heading)")
        }
        for token in amountsAndDates {
            #expect(text.contains(token), "missing \(token)")
        }
        // Nothing doubled: a merge that keeps a garbled fragment next to its clean
        // re-reading once passed the checks above.
        #expect(text.components(separatedBy: "Each party shall bear its own costs").count == 2)
        #expect(text.components(separatedBy: "upon presentation of invoices").count == 2)
    }

    /// Every amount and date in `ScanLayouts.clauses`.
    static let amountsAndDates = [
        "$18,420.55", "$2,615.40", "$4,215.35",
        "November 14, 2011", "June 29, 2012", "October 12, 2012", "January 31, 2013"
    ]

    /// `text` with every whitespace run collapsed to one space.
    static func collapsed(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
