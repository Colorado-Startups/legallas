// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation

/// Combines a page's lines with lines from a second reading (a crop or a higher scale).
///
/// Merging line by line, rather than keeping whichever whole reading scores higher,
/// keeps the first reading's good lines: on synthetic pages a 400 dpi reading that
/// recovered a dropped paragraph sometimes garbled another one the 300 dpi reading had
/// right. Here the first reading's lines stay unless they are suspect and replaced, and
/// the second reading only fills places the first left empty or misread. A merge never
/// removes a first-reading line without putting a reading of the same spot in its place:
/// an earlier, looser version lost wrapped line pairs on scanned pages.
enum LineMerge {

    /// A line below this confidence is suspect. Strict: isolated digits and lines that
    /// open with a paragraph number come back at exactly 0.5 and read fine, while a
    /// garbled line came back at 0.30.
    static let lowConfidence: Float = 0.5
    /// Lines cross when they share a visual row (see `sameSpot`) and also overlap sideways
    /// by more than this fraction of the narrower one. Vision's crossed fragments of a
    /// mangled paragraph overlapped 37% sideways; lines on adjacent rows never qualify,
    /// however much their boxes overlap vertically, and neither do neighboring cells.
    static let crossingFraction: CGFloat = 0.2

    /// Indices of suspect lines: low confidence, or crossing another line.
    static func suspects(_ lines: [RecognizedLine]) -> Set<Int> {
        var suspects = Set(lines.indices.filter { lines[$0].confidence < lowConfidence })
        for first in lines.indices {
            for second in lines.indices where second > first && crosses(lines[first].box, lines[second].box) {
                suspects.insert(first)
                suspects.insert(second)
            }
        }
        return suspects
    }

    /// True when two lines share a row and overlap sideways by more than `crossingFraction`.
    static func crosses(_ first: CGRect, _ second: CGRect) -> Bool {
        let narrower = min(first.width, second.width)
        guard sameSpot(first, second), narrower > 0 else { return false }
        let sideways = min(first.maxX, second.maxX) - max(first.minX, second.minX)
        return sideways > crossingFraction * narrower
    }

    /// True when two boxes are readings of the same place: they share a visual row
    /// (`ReadingOrder.rowOverlap` of the shorter one's height) and overlap sideways.
    static func sameSpot(_ first: CGRect, _ second: CGRect) -> Bool {
        ReadingOrder.verticalOverlap(first, second) >= ReadingOrder.rowOverlap
            && first.maxX > second.minX && first.minX < second.maxX
    }

    /// `base` with `extra` merged in, never losing a base line without a replacement.
    ///
    /// Only `extra`'s sound lines are used. A suspect base line is swapped, in place, for
    /// the sound extra lines reading the same spot, and kept when there are none. Every
    /// other sound extra line that reads a spot no kept line reads is inserted after the
    /// nearest line above it in the same column, so prose keeps its column order. Last, a
    /// suspect base line still left is dropped if a placed extra line reads its spot (one
    /// crossed fragment may already have claimed the clean lines over both fragments).
    static func merged(_ base: [RecognizedLine], with extra: [RecognizedLine]) -> [RecognizedLine] {
        let doubtful = suspects(extra)
        let sound = extra.indices.filter { doubtful.contains($0) == false }.map { extra[$0] }
        guard sound.isEmpty == false else { return base }
        let replaceable = suspects(base).map { base[$0] }
        var used = Set<Int>()
        var result: [RecognizedLine] = []
        for line in base {
            let replacements = replaceable.contains(line)
                ? sound.indices.filter { used.contains($0) == false && sameSpot(sound[$0].box, line.box) }
                : []
            guard replacements.isEmpty == false else {
                result.append(line)
                continue
            }
            used.formUnion(replacements)
            result += replacements.map { sound[$0] }.sorted(by: readsBefore)
        }
        let additions = sound.indices
            .filter { used.contains($0) == false }
            .map { sound[$0] }
            .filter { line in result.allSatisfy { sameSpot($0.box, line.box) == false } }
            .sorted { $0.box.midY > $1.box.midY }
        for line in additions { insert(line, into: &result) }
        let placed = used.map { sound[$0] } + additions
        return result.filter { line in
            replaceable.contains(line) == false || placed.allSatisfy { sameSpot($0.box, line.box) == false }
        }
    }

    /// Top to bottom, and left to right within a row.
    private static func readsBefore(_ first: RecognizedLine, _ second: RecognizedLine) -> Bool {
        ReadingOrder.verticalOverlap(first.box, second.box) >= ReadingOrder.rowOverlap
            ? first.box.minX < second.box.minX
            : first.box.midY > second.box.midY
    }

    /// Inserts `line` after the closest line above it that shares its x extent, else
    /// before the closest such line below it, else at the end.
    private static func insert(_ line: RecognizedLine, into lines: inout [RecognizedLine]) {
        let sameColumn = lines.indices.filter {
            lines[$0].box.maxX > line.box.minX && lines[$0].box.minX < line.box.maxX
        }
        let above = sameColumn.filter { lines[$0].box.midY > line.box.midY }
            .min { lines[$0].box.midY < lines[$1].box.midY }
        let below = sameColumn.filter { lines[$0].box.midY <= line.box.midY }
            .max { lines[$0].box.midY < lines[$1].box.midY }
        if let above {
            lines.insert(line, at: above + 1)
        } else if let below {
            lines.insert(line, at: below)
        } else {
            lines.append(line)
        }
    }
}
