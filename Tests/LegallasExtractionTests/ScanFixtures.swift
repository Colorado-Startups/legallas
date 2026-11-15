// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import CoreText
import Foundation

extension Fixtures {

    /// Writes a one-page letter PDF whose only content is a grayscale bitmap rendered at
    /// `dpi`. `draw` works in page points (origin bottom left). No text layer, so OCR runs.
    func scannedPDF(_ name: String, dpi: CGFloat, draw: (CGContext) -> Void) throws -> URL {
        let scale = dpi / 72
        let width = Int(Self.letter.width * scale)
        let height = Int(Self.letter.height * scale)
        guard let bitmap = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { throw FixtureError.cannotCreate }
        bitmap.setFillColor(gray: 1, alpha: 1)
        bitmap.fill(CGRect(x: 0, y: 0, width: width, height: height))
        bitmap.scaleBy(x: scale, y: scale)
        draw(bitmap)
        guard let image = bitmap.makeImage() else { throw FixtureError.cannotCreate }

        let url = directory.appendingPathComponent(name)
        var box = Self.letter
        guard let pdf = CGContext(url as CFURL, mediaBox: &box, nil) else { throw FixtureError.cannotCreate }
        pdf.beginPDFPage(nil)
        pdf.draw(image, in: box)
        pdf.endPDFPage()
        pdf.closePDF()
        return url
    }
}

/// Synthetic scanned layouts in Times, the face most court filings use. All data is made up.
enum ScanLayouts {

    /// Column headings of the payment table.
    static let tableHeader = ["No.", "Due Date", "Amount", "Payee"]

    /// Payment table rows: number, due date, amount, payee.
    static let tableRows: [[String]] = [
        ["1", "01/07/2013", "$118,246.35", "Copper Kettle Dairy"],
        ["2", "02/04/2013", "$26,415.80", "Bluebird Linen Co"],
        ["3", "03/04/2013", "$4,217.65", "Fieldstone Bakery"],
        ["4", "04/08/2013", "$39,052.10", "Prairie Salt Works"],
        ["5", "05/06/2013", "$92,718.45", "Tidewater Seafood"],
        ["6", "06/10/2013", "$7,309.95", "Cinder Hill Coffee"],
        ["7", "07/08/2013", "$51,884.20", "Maple Lane Eggs"],
        ["8", "08/05/2013", "$13,640.75", "Acme Bank NA"],
        ["9", "09/09/2013", "$628.40", "Ledger and Co"],
        ["10", "10/07/2013", "$45,096.30", "Redwood Ice Co"],
        ["11", "11/04/2013", "$8,572.65", "Sunrise Produce"],
        ["12", "12/09/2013", "$214,360.90", "Stonebridge Foods"]
    ]

    /// A titled 4-column payment table, 12 pt, amounts right-aligned like a ledger.
    static func drawTable(in context: CGContext) {
        let lefts: [CGFloat] = [72, 130, 250, 370]
        let amountRight: CGFloat = 340
        drawLine("SCHEDULE OF PAYMENTS", font: times(14, bold: true), at: CGPoint(x: 72, y: 700), in: context)
        var y: CGFloat = 660
        for (column, heading) in tableHeader.enumerated() {
            drawLine(heading, font: times(12, bold: true), at: CGPoint(x: lefts[column], y: y), in: context)
        }
        for row in tableRows {
            y -= 22
            for (column, cell) in row.enumerated() {
                let x = column == 2 ? amountRight - width(of: cell, font: times(12)) : lefts[column]
                drawLine(cell, font: times(12), at: CGPoint(x: x, y: y), in: context)
            }
        }
    }

    /// Left column of the two-column page.
    static let leftColumn = """
        The Commissary shall keep each cold room at or below forty one degrees and shall record the temperature \
        twice a day on the log sheet attached to this Agreement. The Supplier shall also furnish a packing note \
        with every delivery stating the hour the cases left its kitchen. Each driver agrees to wait while the \
        kitchen manager checks the cases against the order and to note any shortage on the delivery slip. The \
        kitchen manager shall sign each packing note and keep a copy for the Commissary files. Nothing in this \
        Section shall make the Supplier answerable for stock that the Commissary has accepted and stored, unless \
        the Supplier packed it above the agreed temperature. The duties set out in this Section continue until \
        the last delivery under the attached schedule has been signed for.
        """

    /// Right column of the two-column page.
    static let rightColumn = """
        Any notice required or permitted by this Agreement shall be in writing and shall be deemed given when \
        delivered personally, one business day after deposit with a national overnight courier, or three days \
        after mailing by certified mail, return receipt requested, postage prepaid, to the address set forth \
        on the signature page. Either party may change its address by giving notice to the other party. This \
        Agreement shall be governed by the laws of the State of Example without regard to conflict of laws \
        principles. Each party irrevocably submits to the exclusive jurisdiction of the state and federal \
        courts located in Example County for any action arising out of this Agreement.
        """

    /// Two 12 pt text columns side by side, as in a newsletter or a two-column brief.
    static func drawTwoColumns(in context: CGContext) {
        drawFrame(leftColumn, font: times(12), in: CGRect(x: 72, y: 200, width: 222, height: 520), context: context)
        drawFrame(rightColumn, font: times(12), in: CGRect(x: 318, y: 200, width: 222, height: 520), context: context)
    }

    /// Numbered contract clauses carrying dollar amounts and dates.
    static let clauses = [
        "12. Entire Agreement. This Agreement, together with the Exhibits hereto, constitutes the entire agreement "
            + "between the parties with respect to the subject matter hereof and supersedes all prior negotiations.",
        "13. Amendment. This Agreement may be amended only by a written instrument signed by the Supplier and the "
            + "managers of a majority of the Outlets then operating, dated as of November 14, 2011.",
        "14. Counterparts. This Agreement may be executed in counterparts, each of which shall be deemed an original, "
            + "and the aggregate invoice amount of $18,420.55 shall be paid on or before June 29, 2012.",
        "15. Severability. If any provision of this Agreement is held invalid, the remaining provisions shall remain "
            + "in full force and effect, and the container deposit of $2,615.40 shall be refunded on October 12, 2012.",
        "16. Expenses. Each party shall bear its own costs, except that the Buyer shall reimburse delivery fees "
            + "not to exceed $4,215.35 upon presentation of invoices no later than January 31, 2013."
    ]

    /// The clauses as paragraphs in Times at `size` points, wrapped to `width` points.
    static func drawClauses(size: CGFloat, width: CGFloat, in context: CGContext) {
        let text = clauses.joined(separator: "\n\n")
        drawFrame(text, font: times(size), in: CGRect(x: 72, y: 72, width: width, height: 648), context: context)
    }

    static func times(_ size: CGFloat, bold: Bool = false) -> CTFont {
        CTFontCreateWithName((bold ? "Times-Bold" : "Times-Roman") as CFString, size, nil)
    }

    private static func attributed(_ text: String, font: CTFont) -> NSAttributedString {
        NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
        ])
    }

    private static func drawLine(_ text: String, font: CTFont, at point: CGPoint, in context: CGContext) {
        context.textPosition = point
        CTLineDraw(CTLineCreateWithAttributedString(attributed(text, font: font)), context)
    }

    private static func width(of text: String, font: CTFont) -> CGFloat {
        let line = CTLineCreateWithAttributedString(attributed(text, font: font))
        return CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    private static func drawFrame(_ text: String, font: CTFont, in rect: CGRect, context: CGContext) {
        let setter = CTFramesetterCreateWithAttributedString(attributed(text, font: font))
        let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: rect, transform: nil), nil)
        CTFrameDraw(frame, context)
    }
}
