// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation
import PDFKit

/// OCR for one sparse PDF page: a reading at `TextRecognizer.renderDPI`, plus a second
/// reading at `retryDPI` merged in when the first shows a sign of misreading.
///
/// Rendering every page at 400 dpi made some pages slightly worse, so the higher scale is
/// only a second opinion, and `LineMerge` takes from it only what the first reading
/// lacks or got wrong. Signs of misreading:
/// - a suspect line (see `LineMerge.suspects`): confidence below 0.5, or crossing
///   another line;
/// - a band of ink no line covers, most of a line tall, that a crop could not read
///   either (see `MissedLines`).
enum PageRecognizer {

    /// Resolution of the second reading, still capped by `TextRecognizer.maxRenderSide`.
    static let retryDPI: CGFloat = 400
    /// An unread ink band at least this fraction of the median line height triggers the
    /// retry. Lower values retried three times as many synthetic pages for the same gain.
    static let unreadFraction: CGFloat = 0.6

    /// OCR text for `page` in reading order.
    static func text(of page: PDFPage) throws -> String {
        let first = try TextRecognizer.read(TextRecognizer.render(page))
        guard canRetry(page), needsRetry(first) else { return ReadingOrder.text(first.lines) }
        // The first reading already succeeded, so a failed retry keeps it instead of failing the page.
        guard let second = try? TextRecognizer.read(TextRecognizer.render(page, dpi: retryDPI)) else {
            return ReadingOrder.text(first.lines)
        }
        return ReadingOrder.text(LineMerge.merged(first.lines, with: second.lines))
    }

    /// False when the size cap leaves the retry no sharper than the first reading.
    static func canRetry(_ page: PDFPage) -> Bool {
        let size = TextRecognizer.displaySize(of: page)
        guard
            let base = TextRecognizer.renderScale(for: size, dpi: TextRecognizer.renderDPI),
            let retry = TextRecognizer.renderScale(for: size, dpi: retryDPI)
        else { return false }
        return retry > base
    }

    /// True when the reading shows any sign of misreading.
    static func needsRetry(_ reading: MissedLines.Result) -> Bool {
        if LineMerge.suspects(reading.lines).isEmpty == false { return true }
        guard reading.unread > 0 else { return false }
        let lineHeight = MissedLines.medianHeight(reading.lines) ?? 0
        return reading.unread >= max(unreadFraction * lineHeight, MissedLines.minBand)
    }
}
