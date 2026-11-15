// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import ImageIO
import PDFKit
import Vision

/// One line of text Vision recognized, with where it sits in the image.
struct RecognizedLine: Equatable, Sendable {
    /// Vision's top candidate string.
    let text: String
    /// Vision's confidence for `text`, 0 to 1. Observed values are coarse: 1.0, 0.5
    /// (isolated digits, lines that open with a paragraph number) and 0.3.
    let confidence: Float
    /// Bounding box in normalized image coordinates, origin at the bottom left.
    let box: CGRect
}

/// Renders PDF pages to bitmaps and runs Apple Vision text recognition on them.
///
/// Recognition is synchronous but Vision waits internally on Swift concurrency work, so
/// never block every cooperative pool thread in it at once: the process deadlocks. The
/// CLI calls it from the main thread; tests that run many OCR cases in parallel should
/// call it from their own threads.
enum TextRecognizer {

    /// Target render resolution for OCR.
    static let renderDPI: CGFloat = 300

    /// Longest bitmap side in pixels. Caps memory on oversized pages (plans, posters).
    static let maxRenderSide: CGFloat = 8_000

    /// Points per inch in PDF user space.
    private static let pointsPerInch: CGFloat = 72

    /// Page rotations that leave width and height unswapped are multiples of this.
    private static let halfTurnDegrees = 180

    /// Vision attempts per image. Under load (several extractors at once) Vision has
    /// failed transiently on a page that succeeds on a rerun, so one retry is allowed.
    static let maxAttempts = 2

    /// Recognizes text in an image (accurate level, language correction on, en-US) and
    /// returns it in reading order: Vision's order, except tables read row by row.
    static func recognize(
        _ image: CGImage,
        orientation: CGImagePropertyOrientation = .up
    ) throws -> String {
        ReadingOrder.text(try read(image, orientation: orientation).lines)
    }

    /// Every line in `image`: the full-image pass, plus table cells and skipped lines
    /// recovered from crops (see `TableGaps` and `MissedLines`).
    static func read(
        _ image: CGImage,
        orientation: CGImagePropertyOrientation = .up
    ) throws -> MissedLines.Result {
        let lines = try observe(image, orientation: orientation)
        // Crops index raw pixels, which match Vision's normalized space only when upright.
        guard orientation == .up else { return MissedLines.Result(lines: lines, unread: 0) }
        return MissedLines.filled(TableGaps.filled(lines, in: image), in: image)
    }

    /// Recognizes the part of `image` inside `region` (normalized, origin bottom left)
    /// and returns its lines with boxes in the full image's coordinates. Nil when the
    /// crop is empty or recognition fails.
    static func observe(region: CGRect, in image: CGImage) -> [RecognizedLine]? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        // CGImage pixel rows run top to bottom; Vision's normalized y runs bottom to top.
        let pixels = CGRect(
            x: region.minX * width,
            y: (1 - region.maxY) * height,
            width: region.width * width,
            height: region.height * height
        ).integral.intersection(CGRect(x: 0, y: 0, width: width, height: height))
        guard
            pixels.isEmpty == false,
            let crop = image.cropping(to: pixels),
            let lines = try? observe(crop)
        else { return nil }
        // The region the crop really covers after snapping to whole pixels.
        let frame = CGRect(
            x: pixels.minX / width,
            y: 1 - pixels.maxY / height,
            width: pixels.width / width,
            height: pixels.height / height
        )
        return lines.map { line in
            let box = CGRect(
                x: frame.minX + line.box.minX * frame.width,
                y: frame.minY + line.box.minY * frame.height,
                width: line.box.width * frame.width,
                height: line.box.height * frame.height
            )
            return RecognizedLine(text: line.text, confidence: line.confidence, box: box)
        }
    }

    /// Runs Vision text recognition and returns every line with its confidence and box,
    /// in the order Vision returns them.
    static func observe(
        _ image: CGImage,
        orientation: CGImagePropertyOrientation = .up
    ) throws -> [RecognizedLine] {
        for attempt in 1...maxAttempts {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-US"]
            let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
            do {
                try handler.perform([request])
            } catch {
                if attempt < maxAttempts { continue }
                throw ExtractionError.ocrFailed
            }
            return (request.results ?? []).compactMap { observation in
                observation.topCandidates(1).first.map {
                    RecognizedLine(text: $0.string, confidence: $0.confidence, box: observation.boundingBox)
                }
            }
        }
        throw ExtractionError.ocrFailed
    }

    /// Composites `image` over white into an opaque sRGB bitmap of the same pixel size.
    /// Vision ignores alpha, so a transparent background (premultiplied to black) hides
    /// dark text and OCR returns nothing. Images without alpha are returned unchanged.
    static func flattened(_ image: CGImage) throws -> CGImage {
        switch image.alphaInfo {
        case .none, .noneSkipFirst, .noneSkipLast:
            return image
        default:
            break
        }
        guard
            let space = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(
                data: nil,
                width: image.width,
                height: image.height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: space,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
            )
        else { throw ExtractionError.ocrFailed }
        let bounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
        context.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
        context.fill(bounds)
        context.draw(image, in: bounds)
        guard let opaque = context.makeImage() else { throw ExtractionError.ocrFailed }
        return opaque
    }

    /// Size of a page in points as displayed: crop box, with a quarter-turn rotation applied.
    static func displaySize(of page: PDFPage) -> CGSize {
        let box = page.bounds(for: .cropBox)
        // PDFKit keeps rotation at a multiple of 90; a quarter turn swaps width and height.
        return page.rotation.isMultiple(of: halfTurnDegrees)
            ? box.size
            : CGSize(width: box.height, height: box.width)
    }

    /// Pixels per point for rendering `size` at `dpi`, capped so the longest side stays
    /// within `maxRenderSide`. Nil for an empty page.
    static func renderScale(for size: CGSize, dpi: CGFloat) -> CGFloat? {
        let longest = max(size.width, size.height)
        guard longest > 0 else { return nil }
        return min(dpi / pointsPerInch, maxRenderSide / longest)
    }

    /// Renders a page (crop box, page rotation applied) to an opaque grayscale bitmap
    /// at `dpi`, scaled down if the longest side would exceed `maxRenderSide`.
    static func render(_ page: PDFPage, dpi: CGFloat = renderDPI) throws -> CGImage {
        let size = displaySize(of: page)
        guard let scale = renderScale(for: size, dpi: dpi) else { throw ExtractionError.ocrFailed }
        let width = Int((size.width * scale).rounded(.up))
        let height = Int((size.height * scale).rounded(.up))

        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { throw ExtractionError.ocrFailed }

        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        context.scaleBy(x: scale, y: scale)
        // PDFPage.draw applies transform(for:), which handles rotation and the box origin.
        page.draw(with: .cropBox, to: context)

        guard let image = context.makeImage() else { throw ExtractionError.ocrFailed }
        return image
    }
}
