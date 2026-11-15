// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Testing
@testable import LegallasExtraction

@Suite("LineMerge and retry policy")
struct LineMergeTests {

    /// Three lines of one column, top to bottom.
    static let top = line("12. Entire Agreement. This Agreement constitutes the entire agreement", x: 0.12, y: 0.80, width: 0.7)
    static let middle = line("14. Counterparts. The invoice amount of $18,420.55 is due", x: 0.12, y: 0.77, width: 0.7)
    static let bottom = line("on or before June 29, 2012.", x: 0.12, y: 0.74, width: 0.3)

    @Test("low confidence below 0.5 and crossing lines are suspect; exactly 0.5 is not")
    func suspects() {
        let digit = line("8", x: 0.12, y: 0.5, width: 0.01, confidence: 0.5)
        let garbled = line("14. Cunterpats. Ths Agrement", x: 0.12, y: 0.4, width: 0.5, confidence: 0.3)
        // Boxes modeled on the mangled paragraph on the 9.8 pt clauses page.
        let crossedA = line("4,215.5 upon presentation", x: 0.124, y: 0.714, width: 0.468, height: 0.024)
        let crossedB = line(", except that the Buyer", x: 0.430, y: 0.721, width: 0.435, height: 0.019)

        #expect(LineMerge.suspects([Self.top, digit]).isEmpty)
        #expect(LineMerge.suspects([Self.top, garbled]) == [1])
        #expect(LineMerge.suspects([Self.top, crossedA, crossedB]) == [1, 2])
    }

    @Test("a low-confidence line is replaced in place by a sound reading of the same spot")
    func replacesLowConfidenceLine() {
        let garbled = line("l4. Cunterpats. Th invoce amount of 918,420.55", x: 0.12, y: 0.77, width: 0.7, confidence: 0.3)
        let retry = [Self.top, Self.middle, Self.bottom]

        let merged = LineMerge.merged([Self.top, garbled, Self.bottom], with: retry)

        #expect(merged == [Self.top, Self.middle, Self.bottom])
    }

    @Test("a sound first-pass line is kept even when the second reading disagrees")
    func keepsSoundLines() {
        let worse = line("14. Counterparts. The invoice amount of $18,42.55 is due", x: 0.12, y: 0.77, width: 0.7)

        let merged = LineMerge.merged([Self.top, Self.middle, Self.bottom], with: [worse])

        #expect(merged == [Self.top, Self.middle, Self.bottom])
    }

    @Test("a dropped line is inserted under its neighbor in the same column")
    func insertsDroppedLineInColumnOrder() {
        let rightTop = line("Any notice required or permitted by this Agreement", x: 0.52, y: 0.80, width: 0.35)
        let rightBottom = line("shall be in writing and deemed given when delivered.", x: 0.52, y: 0.77, width: 0.35)
        let leftTop = line("The Commissary shall keep each cold room", x: 0.12, y: 0.80, width: 0.35)
        let leftDropped = line("at or below forty one degrees and shall record", x: 0.12, y: 0.77, width: 0.35)
        let leftBottom = line("the temperature twice a day.", x: 0.12, y: 0.74, width: 0.2)

        let merged = LineMerge.merged(
            [leftTop, leftBottom, rightTop, rightBottom],
            with: [leftDropped, rightTop]
        )

        #expect(merged == [leftTop, leftDropped, leftBottom, rightTop, rightBottom])
    }

    @Test("suspect lines from the second reading are never used")
    func ignoresSuspectExtraLines() {
        let junk = line("~,. il", x: 0.12, y: 0.5, width: 0.05, confidence: 0.3)

        #expect(LineMerge.merged([Self.top], with: [junk]) == [Self.top])
    }

    @Test("a wrapped line and its short continuation survive a merge even when their boxes overlap")
    func wrappedPairSurvivesMerge() {
        // On scans Vision's boxes run taller than the leading: here the continuation's box
        // overlaps the long line by a third of its height. An earlier version lost such
        // pairs when they were taken for crossed fragments and a neighbor touched them.
        let above = line("Each party shall bear its own costs and expenses incurred in connection with", x: 0.12, y: 0.728, width: 0.72, height: 0.024)
        let long = line("the delivery of goods under this Agreement, except that the Buyer shall reimburse the", x: 0.12, y: 0.700, width: 0.72, height: 0.024)
        let short = line("reasonable fees of carriers.", x: 0.12, y: 0.684, width: 0.22, height: 0.024)
        let below = line("17. Notices. All notices shall be in writing and delivered to the address", x: 0.12, y: 0.650, width: 0.72, height: 0.024)
        let base = [above, long, short, below]
        // A second reading (a band crop or the 400 dpi pass) whose lines sit a little
        // differently, so each one touches its neighbors' first-pass boxes.
        let extra = base.map { line($0.text, x: $0.box.minX, y: $0.box.minY - 0.006, width: $0.box.width, height: 0.026) }

        #expect(LineMerge.suspects(base).isEmpty, "adjacent lines are not crossed fragments")
        #expect(LineMerge.merged(base, with: extra) == base)
    }

    @Test("a suspect line is dropped only when a sound reading of the same spot replaces it")
    func suspectLineNeedsSameSpotReplacement() {
        let garbled = line("l4. Cunterpats. Th invoce amount of 918,420.55", x: 0.12, y: 0.77, width: 0.7, confidence: 0.3)
        // Only neighbors in the second reading; its taller box for the top line still
        // reads the top line's row but grazes the garbled line's box.
        let grazingTop = line(Self.top.text, x: 0.12, y: 0.785, width: 0.7, height: 0.03)

        let merged = LineMerge.merged([Self.top, garbled, Self.bottom], with: [grazingTop, Self.bottom])

        #expect(merged == [Self.top, garbled, Self.bottom])
    }

    @Test("crossed fragments give way to the clean lines over them, in reading order, once each")
    func crossedFragmentsAreReplaced() {
        // Boxes modeled on the 9.8 pt clauses page at 300 dpi, then at 400 dpi.
        let above = line("and effect, and the container deposit of $2,615.40", x: 0.117, y: 0.754, width: 0.59, height: 0.013)
        let fragmentA = line("4,215.5 upon presentation", x: 0.124, y: 0.714, width: 0.468, height: 0.024)
        let fragmentB = line(", except that the Buyer", x: 0.430, y: 0.721, width: 0.435, height: 0.019)
        let first = line("16. Expenses. Each party shall bear its own costs,", x: 0.115, y: 0.725, width: 0.759, height: 0.015)
        let second = line("$4,215.35 upon presentation of invoices", x: 0.115, y: 0.711, width: 0.488, height: 0.014)

        let merged = LineMerge.merged([above, fragmentA, fragmentB], with: [above, first, second])

        #expect(merged == [above, first, second])
    }

    @Test("retry triggers on a suspect line or an unread band most of a line tall")
    func retryPolicy() {
        let clean = [Self.top, Self.middle, Self.bottom]
        let height = Self.top.box.height

        #expect(PageRecognizer.needsRetry(MissedLines.Result(lines: clean, unread: 0)) == false)
        #expect(PageRecognizer.needsRetry(MissedLines.Result(lines: clean, unread: height * 0.5)) == false)
        #expect(PageRecognizer.needsRetry(MissedLines.Result(lines: clean, unread: height * 0.6)))

        let digit = line("8", x: 0.12, y: 0.5, width: 0.01, confidence: 0.5)
        #expect(PageRecognizer.needsRetry(MissedLines.Result(lines: clean + [digit], unread: 0)) == false)
        let garbled = line("Cunterpats", x: 0.12, y: 0.5, width: 0.2, confidence: 0.3)
        #expect(PageRecognizer.needsRetry(MissedLines.Result(lines: clean + [garbled], unread: 0)))
    }

    @Test("uncovered ink bands are found, covered ink and specks are not")
    func inkBands() throws {
        // Two 30-pixel "lines" of dashed ink on a 1000 x 1000 page, and a 3-pixel speck.
        let image = try Self.page(inkRows: [100..<130, 300..<330], speck: CGPoint(x: 500, y: 700))
        let firstLine = CGRect(x: 0.1, y: 0.87, width: 0.8, height: 0.03)
        let secondLine = CGRect(x: 0.1, y: 0.67, width: 0.8, height: 0.03)

        #expect(InkCoverage.uncoveredBands(in: image, covered: [firstLine, secondLine]).isEmpty)

        let bands = InkCoverage.uncoveredBands(in: image, covered: [firstLine])
        let band = try #require(bands.first)
        #expect(bands.count == 1)
        #expect(abs(band.height - 0.03) < 0.001)
        #expect(abs(band.minY - 0.67) < 0.001)
        #expect(abs(band.minX - 0.1) < 0.002)
    }

    /// A white page with dashed ink across x 100..<900 on each of `inkRows` (top-down pixel rows).
    static func page(inkRows: [Range<Int>], speck: CGPoint) throws -> CGImage {
        guard let context = CGContext(
            data: nil,
            width: 1_000,
            height: 1_000,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { throw FixtureError.cannotCreate }
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 1_000, height: 1_000))
        context.setFillColor(gray: 0, alpha: 1)
        // CGContext y runs bottom to top; flip the top-down rows.
        for rows in inkRows {
            for x in stride(from: 100, to: 900, by: 10) {
                context.fill(CGRect(x: x, y: 1_000 - rows.upperBound, width: 4, height: rows.count))
            }
        }
        context.fill(CGRect(x: speck.x, y: 1_000 - speck.y, width: 3, height: 3))
        guard let image = context.makeImage() else { throw FixtureError.cannotCreate }
        return image
    }
}
