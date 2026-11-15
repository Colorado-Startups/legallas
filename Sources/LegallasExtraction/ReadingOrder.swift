// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation

/// Puts recognized lines into reading order for the index.
///
/// Vision reads prose and multi-column pages column by column, which is right for them,
/// so lines keep Vision's order. Tables are the exception: Vision reads them column by
/// column too, which pulls every row apart ("No." column, then "Due Date" column, ...).
/// Only a grid (at least `minColumns` aligned columns of short cells over at least
/// `minRows` rows) is rewritten, row by row with cells joined by tabs. Two-column prose
/// never qualifies: it has two cells per row, and its lines are long.
enum ReadingOrder {

    /// A table found among the lines.
    struct Grid: Equatable {
        /// Rows top to bottom; each row holds line indices left to right.
        let rows: [[Int]]
        /// Column x extents in normalized coordinates, left to right.
        let columns: [ClosedRange<CGFloat>]
    }

    /// Fewest aligned columns that make a grid.
    static let minColumns = 3
    /// Fewest rows with `minColumns` or more cells that make a grid.
    static let minRows = 3
    /// Longest cell in words. Prose lines run longer, which keeps columns of text out.
    static let maxCellWords = 4
    /// Two lines share a row when their vertical overlap is at least this fraction of
    /// the shorter one.
    static let rowOverlap: CGFloat = 0.5
    /// Joins the cells of a table row.
    static let cellSeparator = "\t"

    /// Lines joined with newlines in reading order. With no grid on the page this is
    /// exactly Vision's order.
    static func text(_ lines: [RecognizedLine]) -> String {
        let grids = grids(in: lines)
        var owner: [Int: Int] = [:]
        for (number, grid) in grids.enumerated() {
            for index in grid.rows.joined() { owner[index] = number }
        }
        var emitted = Set<Int>()
        var output: [String] = []
        for (index, line) in lines.enumerated() {
            guard let number = owner[index] else {
                output.append(line.text)
                continue
            }
            // A table goes out whole, where Vision first reached any of its cells.
            guard emitted.insert(number).inserted else { continue }
            output += grids[number].rows.map { row in
                row.map { lines[$0].text }.joined(separator: cellSeparator)
            }
        }
        return output.joined(separator: "\n")
    }

    /// Every grid on the page, top to bottom.
    static func grids(in lines: [RecognizedLine]) -> [Grid] {
        var grids: [Grid] = []
        var run: [[Int]] = []
        for row in visualRows(lines) {
            if isCandidate(row, lines: lines) {
                run.append(row)
                continue
            }
            if let grid = grid(from: run, lines: lines) { grids.append(grid) }
            run = []
        }
        if let grid = grid(from: run, lines: lines) { grids.append(grid) }
        return grids
    }

    /// Lines grouped into visual rows, top to bottom, each row left to right. A line joins
    /// the row being built when it overlaps any line already in it, so a slightly skewed
    /// row still chains together cell by cell.
    static func visualRows(_ lines: [RecognizedLine]) -> [[Int]] {
        let order = lines.indices.sorted { lines[$0].box.midY > lines[$1].box.midY }
        var rows: [[Int]] = []
        var current: [Int] = []
        for index in order {
            let box = lines[index].box
            if current.contains(where: { verticalOverlap(lines[$0].box, box) >= rowOverlap }) {
                current.append(index)
            } else {
                if current.isEmpty == false { rows.append(current) }
                current = [index]
            }
        }
        if current.isEmpty == false { rows.append(current) }
        return rows.map { row in row.sorted { lines[$0].box.minX < lines[$1].box.minX } }
    }

    /// True when `line` is short enough to be a table cell.
    static func isCell(_ line: RecognizedLine) -> Bool {
        let words = line.text.split(whereSeparator: \.isWhitespace).count
        return words > 0 && words <= maxCellWords
    }

    /// A PDF text layer's lines in the order the page draws them (#377). PDFKit's
    /// `page.string` can read the short last line of a wrapped sentence before the long
    /// line above it. An insertion sort moves a line up only past neighbours it sits above
    /// in the same column (`isAbove`), so lines in other columns, or on one row, keep
    /// their order. When more stacked neighbours run upward than downward, the text is
    /// drawn upside down in page space, and the order is kept.
    static func drawnOrder(_ lines: [RecognizedLine]) -> [RecognizedLine] {
        let neighbours = zip(lines, lines.dropFirst())
        let upward = neighbours.filter { isAbove($1.box, $0.box) }.count
        let downward = neighbours.filter { isAbove($0.box, $1.box) }.count
        guard upward <= downward else { return lines }
        var ordered = lines
        for start in ordered.indices.dropFirst() {
            var index = start
            while index > 0, isAbove(ordered[index].box, ordered[index - 1].box) {
                ordered.swapAt(index, index - 1)
                index -= 1
            }
        }
        return ordered
    }

    /// True when `first` is on a higher row than `second` in the same column: both boxes
    /// are real, they overlap across, and they do not share a row.
    static func isAbove(_ first: CGRect, _ second: CGRect) -> Bool {
        guard !first.isEmpty, !second.isEmpty else { return false }
        return first.maxX > second.minX && first.minX < second.maxX
            && verticalOverlap(first, second) < rowOverlap
            && first.midY > second.midY
    }

    /// Vertical overlap of two boxes as a fraction of the shorter one's height.
    static func verticalOverlap(_ first: CGRect, _ second: CGRect) -> CGFloat {
        let shorter = min(first.height, second.height)
        guard shorter > 0 else { return 0 }
        let overlap = min(first.maxY, second.maxY) - max(first.minY, second.minY)
        return max(0, overlap) / shorter
    }

    /// A row that could belong to a grid: two or more short cells side by side.
    private static func isCandidate(_ row: [Int], lines: [RecognizedLine]) -> Bool {
        guard row.count >= 2, row.allSatisfy({ isCell(lines[$0]) }) else { return false }
        return zip(row, row.dropFirst()).allSatisfy { left, right in
            lines[left].box.maxX <= lines[right].box.minX
        }
    }

    /// The grid in a run of candidate rows, if it has enough rows and aligned columns.
    /// Rows at either end with fewer than `minColumns` cells are dropped, so a stray
    /// pair of short lines next to a table is not pulled into it.
    private static func grid(from run: [[Int]], lines: [RecognizedLine]) -> Grid? {
        guard
            let first = run.firstIndex(where: { $0.count >= minColumns }),
            let last = run.lastIndex(where: { $0.count >= minColumns })
        else { return nil }
        let rows = Array(run[first...last])
        guard rows.filter({ $0.count >= minColumns }).count >= minRows else { return nil }
        let columns = columns(of: rows.joined().map { lines[$0].box })
        guard columns.count >= minColumns else { return nil }
        return Grid(rows: rows, columns: columns)
    }

    /// Merges the cells' x extents into columns, left to right.
    static func columns(of boxes: [CGRect]) -> [ClosedRange<CGFloat>] {
        var columns: [ClosedRange<CGFloat>] = []
        for box in boxes.sorted(by: { $0.minX < $1.minX }) {
            if let last = columns.last, box.minX <= last.upperBound {
                columns[columns.count - 1] = last.lowerBound...max(last.upperBound, box.maxX)
            } else {
                columns.append(box.minX...box.maxX)
            }
        }
        return columns
    }
}
