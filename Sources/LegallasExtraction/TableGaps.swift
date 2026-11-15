// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation

/// Recovers table cells the full-page pass dropped.
///
/// Vision often skips isolated one- and two-character cells, such as row numbers 1, 3, 8
/// and 11. Re-reading just that column as a tight strip finds most of them (159 of 168
/// row numbers on synthetic tables, against 130 from the page pass) for about 40 ms per
/// strip. Only grid columns with a missing cell are re-read, and a strip result is kept
/// only when it lands in a row that lacks that column's cell.
enum TableGaps {

    /// Padding around a column strip, in normalized page coordinates.
    static let stripPadding: CGFloat = 0.01

    /// `lines` plus any cells recovered from column strips of `image`. Best effort: a
    /// strip that fails to render or recognize is skipped.
    static func filled(_ lines: [RecognizedLine], in image: CGImage) -> [RecognizedLine] {
        var result = lines
        for grid in ReadingOrder.grids(in: lines) {
            for column in grid.columns {
                result += recovered(column: column, grid: grid, lines: lines, image: image)
            }
        }
        return result
    }

    /// Cells found in one column's strip that fill rows missing a cell in that column.
    private static func recovered(
        column: ClosedRange<CGFloat>,
        grid: ReadingOrder.Grid,
        lines: [RecognizedLine],
        image: CGImage
    ) -> [RecognizedLine] {
        let rowBoxes = grid.rows.map { row in row.map { lines[$0].box }.reduce(CGRect.null) { $0.union($1) } }
        var missing = grid.rows.indices.filter { row in
            grid.rows[row].allSatisfy { overlaps(lines[$0].box, column) == false }
        }
        // A real column has a cell in most rows; a sparse one is probably not a column.
        guard missing.isEmpty == false, missing.count * 2 <= grid.rows.count else { return [] }
        let span = rowBoxes.reduce(CGRect.null) { $0.union($1) }
        let wanted = CGRect(
            x: column.lowerBound - stripPadding,
            y: span.minY - stripPadding,
            width: column.upperBound - column.lowerBound + 2 * stripPadding,
            height: span.height + 2 * stripPadding
        )
        guard let found = TextRecognizer.observe(region: wanted, in: image) else { return [] }
        var recovered: [RecognizedLine] = []
        for cell in found {
            guard
                ReadingOrder.isCell(cell),
                let slot = missing.firstIndex(where: {
                    ReadingOrder.verticalOverlap(rowBoxes[$0], cell.box) >= ReadingOrder.rowOverlap
                })
            else { continue }
            recovered.append(cell)
            missing.remove(at: slot)
        }
        return recovered
    }

    /// True when `box` overlaps the column's x extent.
    private static func overlaps(_ box: CGRect, _ column: ClosedRange<CGFloat>) -> Bool {
        box.maxX > column.lowerBound && box.minX < column.upperBound
    }
}
