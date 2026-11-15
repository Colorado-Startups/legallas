// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Testing
@testable import LegallasExtraction

/// A recognized line at a normalized position (origin bottom left), for tests without Vision.
func line(
    _ text: String,
    x: CGFloat,
    y: CGFloat,
    width: CGFloat = 0.1,
    height: CGFloat = 0.018,
    confidence: Float = 1
) -> RecognizedLine {
    RecognizedLine(text: text, confidence: confidence, box: CGRect(x: x, y: y, width: width, height: height))
}

@Suite("ReadingOrder")
struct ReadingOrderTests {

    /// Column lefts and row bottoms of a synthetic 4 x 5 table (header plus four rows).
    static let columnX: [CGFloat] = [0.12, 0.21, 0.44, 0.60]
    static let rowY: [CGFloat] = [0.83, 0.80, 0.77, 0.74, 0.71]
    static let cells = [
        ["No.", "Due Date", "Amount", "Payee"],
        ["1", "01/07/2013", "$118,246.35", "Copper Kettle Dairy"],
        ["2", "02/04/2013", "$26,415.80", "Bluebird Linen Co"],
        ["3", "03/04/2013", "$4,217.65", "Fieldstone Bakery"],
        ["4", "04/08/2013", "$39,052.10", "Prairie Salt Works"]
    ]

    /// The table in Vision's order: title, every column top to bottom, then a footer.
    /// `skew` raises each cell by that much per unit of x, like a page scanned slightly askew.
    static func visionTable(skew: CGFloat = 0) -> [RecognizedLine] {
        var lines = [line("SCHEDULE OF PAYMENTS", x: 0.12, y: 0.88, width: 0.3)]
        for column in columnX.indices {
            for row in rowY.indices {
                let x = columnX[column]
                lines.append(line(cells[row][column], x: x, y: rowY[row] + skew * x, width: 0.08))
            }
        }
        lines.append(line("Payments are due by wire transfer on each date shown above.", x: 0.12, y: 0.60, width: 0.7))
        return lines
    }

    static let expectedTable = (
        ["SCHEDULE OF PAYMENTS"]
            + cells.map { $0.joined(separator: "\t") }
            + ["Payments are due by wire transfer on each date shown above."]
    ).joined(separator: "\n")

    @Test("a table read column by column comes out row by row, between the lines around it")
    func tableComesOutRowByRow() {
        #expect(ReadingOrder.text(Self.visionTable()) == Self.expectedTable)
    }

    @Test("a table scanned about 2 degrees askew still groups its rows")
    func skewedTableKeepsRows() {
        // 0.027 per unit of x is about 2 degrees on a letter page; rows sit 0.03 apart.
        #expect(ReadingOrder.text(Self.visionTable(skew: 0.027)) == Self.expectedTable)
    }

    /// Two columns of prose, read column by column.
    static func twoColumnProse() -> [RecognizedLine] {
        let left = [
            "The Commissary shall keep each cold room at or below forty one",
            "degrees and shall record the temperature twice a day on the log",
            "sheet attached to this Agreement. The Supplier shall also furnish",
            "signed for."
        ]
        let right = [
            "Any notice required or permitted by this Agreement shall be",
            "in writing and shall be deemed given when delivered personally,",
            "one business day after deposit with a national overnight",
            "Agreement."
        ]
        return left.enumerated().map { line($1, x: 0.12, y: 0.9 - CGFloat($0) * 0.02, width: 0.35) }
            + right.enumerated().map { line($1, x: 0.52, y: 0.9 - CGFloat($0) * 0.02, width: 0.35) }
    }

    @Test("two-column prose keeps Vision's column-by-column order exactly")
    func twoColumnProseIsUnchanged() {
        let lines = Self.twoColumnProse()

        #expect(ReadingOrder.grids(in: lines).isEmpty)
        #expect(ReadingOrder.text(lines) == lines.map(\.text).joined(separator: "\n"))
    }

    @Test("short lines in two columns, like a caption, are not a table")
    func twoShortColumnsAreNotAGrid() {
        let pairs = [("JANE DOE,", "Case No. 2012CV04817"), ("Plaintiff,", "Division: 5"), ("v.", "Courtroom 424")]
        let lines = pairs.enumerated().flatMap { row, pair in
            [line(pair.0, x: 0.12, y: 0.8 - CGFloat(row) * 0.03), line(pair.1, x: 0.6, y: 0.8 - CGFloat(row) * 0.03)]
        }

        #expect(ReadingOrder.text(lines) == lines.map(\.text).joined(separator: "\n"))
    }

    @Test("a grid needs three rows of three or more aligned cells")
    func smallGridsAreLeftAlone() {
        let twoRows = Array(Self.visionTable().filter { $0.box.minY >= 0.8 })
        #expect(ReadingOrder.grids(in: twoRows).count == 0)

        let threeRows = Array(Self.visionTable().filter { $0.box.minY >= 0.77 && $0.box.minY < 0.85 })
        #expect(ReadingOrder.grids(in: threeRows).count == 1)
    }

    @Test("cells of five or more words are prose, not a table")
    func longCellsAreProse() {
        let lines = (0..<4).flatMap { row in
            (0..<3).map { column in
                line("one two three four five", x: 0.1 + CGFloat(column) * 0.3, y: 0.8 - CGFloat(row) * 0.03, width: 0.25)
            }
        }

        #expect(ReadingOrder.grids(in: lines).isEmpty)
        #expect(ReadingOrder.text(lines) == lines.map(\.text).joined(separator: "\n"))
    }

    /// The page of #377 in drawn order, from a PDF text layer: every line at the left
    /// margin, 0.02 of the page apart, the sentence wrapped onto a short last line.
    static let wrappedPage = [
        line("HARBOR LABS SAMPLE RECORD. Fictional: every name, date and number is invented.",
             x: 0.118, y: 0.906, width: 0.68, height: 0.014),
        line("Page 7 of 12", x: 0.118, y: 0.886, width: 0.10, height: 0.014),
        line("Competition", x: 0.118, y: 0.866, width: 0.10, height: 0.014),
        line("Paper, spreadsheets and ShiftPad. None of them builds the schedule from forecast",
             x: 0.118, y: 0.846, width: 0.67, height: 0.014),
        line("covers.", x: 0.118, y: 0.826, width: 0.06, height: 0.014)
    ]

    @Test("a wrapped sentence's short last line, read before the long line above it, goes back below it (#377)")
    func shortLastLineGoesBelow() {
        let page = Self.wrappedPage
        let pdfKitOrder = [page[0], page[1], page[2], page[4], page[3]]

        #expect(ReadingOrder.drawnOrder(pdfKitOrder) == page)
    }

    @Test("lines already in drawn order stay put")
    func drawnOrderKeepsDrawnLines() {
        #expect(ReadingOrder.drawnOrder(Self.wrappedPage) == Self.wrappedPage)
    }

    @Test("two-column prose read column by column keeps its order")
    func drawnOrderKeepsColumns() {
        let lines = Self.twoColumnProse()

        #expect(ReadingOrder.drawnOrder(lines) == lines)
    }

    @Test("a raised mark on a line's row stays after it")
    func drawnOrderKeepsRows() {
        // The mark sits a little higher, inside the line's width, but shares its row.
        let row = [
            line("Fees are due on signing.", x: 0.12, y: 0.8, width: 0.5),
            line("1", x: 0.3, y: 0.806, width: 0.01, height: 0.012)
        ]

        #expect(ReadingOrder.drawnOrder(row) == row)
    }

    @Test("a page drawn upside down in page space keeps its order")
    func drawnOrderKeepsUpsideDownPages() {
        let flipped = Self.wrappedPage.map { drawn in
            line(drawn.text, x: drawn.box.minX, y: 1 - drawn.box.maxY, width: drawn.box.width, height: drawn.box.height)
        }

        #expect(ReadingOrder.drawnOrder(flipped) == flipped)
    }

    @Test("a line with no box never moves, and no line moves past it")
    func drawnOrderKeepsUnboxedLines() {
        let lines = [
            RecognizedLine(text: "", confidence: 1, box: .null),
            Self.wrappedPage[4],
            RecognizedLine(text: "", confidence: 1, box: .null),
            Self.wrappedPage[3]
        ]

        #expect(ReadingOrder.drawnOrder(lines) == lines)
    }

    @Test("columns merge overlapping x extents, left to right")
    func columnsMergeOverlaps() {
        let boxes = [
            CGRect(x: 0.5, y: 0, width: 0.1, height: 0.01),
            CGRect(x: 0.1, y: 0, width: 0.1, height: 0.01),
            CGRect(x: 0.15, y: 0, width: 0.1, height: 0.01)
        ]

        #expect(ReadingOrder.columns(of: boxes) == [0.1...0.25, 0.5...0.6])
    }
}
