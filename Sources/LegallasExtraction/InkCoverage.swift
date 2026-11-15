// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation

/// Finds printed text Vision skipped: dark pixels no recognized line covers.
///
/// On clean synthetic pages, Vision at 300 dpi sometimes drops a paragraph's short last
/// line ("2011."), or a whole paragraph, while every line it does return has confidence
/// 1.0, so confidence alone cannot catch it. A band of uncovered ink can.
enum InkCoverage {

    /// Gray level below which a pixel counts as ink.
    static let inkLevel: UInt8 = 128
    /// A pixel row is inked when at least this fraction of its width is uncovered ink.
    /// A line of text clears it easily; a lone digit, a speck or a thin rule does not.
    static let rowInkFraction = 0.005
    /// Each box is grown by this fraction of its height above and below, and by its
    /// full height left and right, so ascenders, descenders and edge glyphs count as covered.
    static let verticalPadding: CGFloat = 0.25

    /// Runs of inked rows left after blanking every box, top to bottom. Each is a
    /// normalized rect (origin bottom left) spanning the run's rows and its ink's x
    /// extent. Empty when the image cannot be read.
    static func uncoveredBands(in image: CGImage, covered boxes: [CGRect]) -> [CGRect] {
        let width = image.width
        let height = image.height
        guard var pixels = grayPixels(of: image) else { return [] }
        pixels.withUnsafeMutableBufferPointer { buffer in
            for box in boxes { blank(box, in: buffer, width: width, height: height) }
        }
        return pixels.withUnsafeBufferPointer { inkBands($0, width: width, height: height) }
    }

    /// Fraction of `image`'s pixel rows that hold ink: at least `rowInkFraction` of the
    /// width darker than `inkLevel`. A page of text is about half inked rows even at 50 dpi;
    /// a cover sheet with a few lines is a few percent. 0 when the image cannot be read.
    static func inkedRowFraction(in image: CGImage) -> Double {
        let width = image.width
        let height = image.height
        guard let pixels = grayPixels(of: image) else { return 0 }
        let needed = max(1, Int((Double(width) * rowInkFraction).rounded(.up)))
        var inked = 0
        for row in 0..<height {
            let start = row * width
            var ink = 0
            for column in 0..<width where pixels[start + column] < inkLevel { ink += 1 }
            if ink >= needed { inked += 1 }
        }
        return Double(inked) / Double(height)
    }

    /// `image` as 8-bit gray pixels, rows top to bottom. Nil when it is empty or cannot be drawn.
    private static func grayPixels(of image: CGImage) -> [UInt8]? {
        let width = image.width
        let height = image.height
        guard width > 0, height > 0 else { return nil }
        var pixels = [UInt8](repeating: 255, count: width * height)
        let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? pixels : nil
    }

    /// Paints a padded box white. Buffer rows run top to bottom.
    private static func blank(_ box: CGRect, in pixels: UnsafeMutableBufferPointer<UInt8>, width: Int, height: Int) {
        let padY = box.height * verticalPadding
        let left = max(0, Int(((box.minX - box.height) * CGFloat(width)).rounded(.down)))
        let right = min(width, Int(((box.maxX + box.height) * CGFloat(width)).rounded(.up)))
        let top = max(0, Int(((1 - box.maxY - padY) * CGFloat(height)).rounded(.down)))
        let bottom = min(height, Int(((1 - box.minY + padY) * CGFloat(height)).rounded(.up)))
        guard left < right, top < bottom else { return }
        for row in top..<bottom {
            let start = row * width
            for column in left..<right { pixels[start + column] = 255 }
        }
    }

    /// Runs of consecutive rows that each hold enough ink, as normalized rects.
    private static func inkBands(_ pixels: UnsafeBufferPointer<UInt8>, width: Int, height: Int) -> [CGRect] {
        let needed = max(1, Int((Double(width) * rowInkFraction).rounded(.up)))
        var bands: [CGRect] = []
        var top: Int?
        var left = width
        var right = 0
        // One row past the bottom closes a band that reaches the edge.
        for row in 0...height {
            var ink = 0
            var rowLeft = width
            var rowRight = 0
            if row < height {
                let start = row * width
                for column in 0..<width where pixels[start + column] < inkLevel {
                    ink += 1
                    rowLeft = min(rowLeft, column)
                    rowRight = max(rowRight, column)
                }
            }
            if ink >= needed {
                if top == nil { (top, left, right) = (row, width, 0) }
                left = min(left, rowLeft)
                right = max(right, rowRight)
            } else if let first = top {
                bands.append(CGRect(
                    x: CGFloat(left) / CGFloat(width),
                    y: 1 - CGFloat(row) / CGFloat(height),
                    width: CGFloat(right - left + 1) / CGFloat(width),
                    height: CGFloat(row - first) / CGFloat(height)
                ))
                top = nil
            }
        }
        return bands
    }
}
