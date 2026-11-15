// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import PDFKit

/// Extracts per-page text from a PDF or a single image for the counsel room index.
///
/// PDF pages use the embedded text layer (`PDFPage.string`, lines in drawn order: see
/// `layerText`). A page with fewer than `ocrThreshold` non-whitespace characters is
/// rendered at 300 dpi and OCRed with Apple Vision, with a 400 dpi retry when the first read looks wrong (see
/// `PageRecognizer`). So is a page whose layer is thin for the ink on it, or garbage
/// (see `layerQuality`); OCR replaces such a layer only when it reads clearly more.
/// Tables come out row by row (see `ReadingOrder`). Images are always OCRed as one page.
public enum PageTextExtractor {

    /// Pages with fewer non-whitespace characters than this are OCRed.
    public static let ocrThreshold = 50

    /// A layer shorter than this is also OCRed when the page holds far more ink than it
    /// explains: a scan with a partial or stamped layer. Full pages of text run 1,500 to
    /// 3,500 characters; thin layers on scanned pages run about 100.
    public static let sparseThreshold = 400

    /// A page whose pixel rows are at least this fraction inked counts as full of print.
    /// Pages of text measure about 0.5 at `inkCheckDPI`; cover and signature sheets under 0.15.
    static let inkedRowsFraction = 0.25

    /// Resolution of the quick ink check: text lines are still a few pixels tall.
    static let inkCheckDPI: CGFloat = 50

    /// A layer whose letters and digits are fewer than this fraction of its visible
    /// characters is garbage (unmapped font codes, private-use glyphs) and is OCRed too.
    static let minUsefulRatio = 0.4

    /// OCR replaces a thin or garbage layer only when it reads at least this many times
    /// the layer's letters and digits, so a chart or form page keeps its exact layer.
    static let richerFactor = 1.5

    /// Lowercased file extensions treated as single-page images.
    public static let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "heic", "tif", "tiff"]

    /// Extracts text and the sha256 of the file at `url`.
    /// - Throws: `ExtractionError` describing why the file could not be read.
    public static func extract(fileAt url: URL) throws -> ExtractionResult {
        let ext = url.pathExtension.lowercased()
        guard ext == "pdf" || imageExtensions.contains(ext) else {
            throw ExtractionError.unsupported
        }
        let data: Data
        do {
            data = try Data(contentsOf: url, options: .mappedIfSafe)
        } catch {
            throw ExtractionError.unreadable
        }
        let digest = sha256Hex(of: data)
        let pages = ext == "pdf" ? try pdfPages(from: data) : [try imagePage(from: data)]
        return ExtractionResult(sha256: digest, pageCount: pages.count, pages: pages)
    }

    /// Lowercase hex sha256 of `data`.
    public static func sha256Hex(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    /// Number of non-whitespace Unicode scalars in `text`.
    static func visibleCount(_ text: String) -> Int {
        text.unicodeScalars.reduce(0) { count, scalar in
            CharacterSet.whitespacesAndNewlines.contains(scalar) ? count : count + 1
        }
    }

    /// Picks the text for a sparse page once OCR has run. OCR wins only when it found
    /// more visible characters, so a scan with a stamped text-layer Bates number keeps
    /// the full OCR text, while a genuinely short page (a cover sheet) keeps its exact
    /// text layer and is not marked as OCR.
    static func chooseText(layer: String, recognized: String) -> ExtractedText {
        visibleCount(recognized) > visibleCount(layer)
            ? ExtractedText(text: recognized, ocr: true)
            : ExtractedText(text: layer, ocr: false)
    }

    /// Number of letters and digits in `text`, of any script; private-use glyphs and
    /// punctuation do not count.
    static func usefulCount(_ text: String) -> Int {
        text.unicodeScalars.reduce(0) { count, scalar in
            CharacterSet.alphanumerics.contains(scalar) ? count + 1 : count
        }
    }

    /// Picks the text for a thin or garbage layer once OCR has run: OCR wins only when it
    /// read `richerFactor` times the layer's letters and digits, so a scan under a partial
    /// layer gets its full text while a chart or form page keeps its exact layer.
    static func chooseRicher(layer: String, recognized: String) -> ExtractedText {
        let read = usefulCount(recognized)
        let kept = usefulCount(layer)
        return read > kept && Double(read) >= richerFactor * Double(kept)
            ? ExtractedText(text: recognized, ocr: true)
            : ExtractedText(text: layer, ocr: false)
    }

    /// How far a page's text layer can be trusted.
    enum LayerQuality: Equatable {
        /// Enough real text for the page: used as it is, no OCR.
        case good
        /// Under `ocrThreshold` visible characters: OCR runs and `chooseText` decides.
        case sparse
        /// Thin for the ink on the page, or garbage: OCR runs and `chooseRicher` decides.
        case thin
    }

    /// Grades `layer`. `inkedRows` (the page's inked row fraction) is only asked for a
    /// layer under `sparseThreshold` that is otherwise sound, so most pages are never rendered.
    static func layerQuality(_ layer: String, inkedRows: () -> Double) -> LayerQuality {
        let visible = visibleCount(layer)
        if visible < ocrThreshold { return .sparse }
        if Double(usefulCount(layer)) < minUsefulRatio * Double(visible) { return .thin }
        if visible < sparseThreshold, inkedRows() >= inkedRowsFraction { return .thin }
        return .good
    }

    /// A page's chosen text and where it came from.
    struct ExtractedText: Equatable {
        let text: String
        let ocr: Bool
    }

    private static func pdfPages(from data: Data) throws -> [ExtractedPage] {
        guard let document = PDFDocument(data: data) else {
            throw ExtractionError.unreadable
        }
        // Owner-password-only PDFs open with an empty user password.
        if document.isLocked, document.unlock(withPassword: "") == false {
            throw ExtractionError.encrypted
        }
        var pages: [ExtractedPage] = []
        pages.reserveCapacity(document.pageCount)
        for index in 0..<document.pageCount {
            let extracted = try autoreleasepool {
                try pageText(document.page(at: index))
            }
            pages.append(ExtractedPage(n: index + 1, text: extracted.text, ocr: extracted.ocr))
        }
        return pages
    }

    private static func pageText(_ page: PDFPage?) throws -> ExtractedText {
        guard let page else { return ExtractedText(text: "", ocr: false) }
        return withFields(try chosenText(page), fieldText(of: page))
    }

    /// The values typed or chosen in a page's form fields (text and choice widgets), one
    /// to a line. `PDFPage.string` leaves them out, so a number typed into a filled tax
    /// form would pass the SSN guard unseen (#347). They go to search too: they are what
    /// the form says. Kept apart from the layer's grade.
    static func fieldText(of page: PDFPage) -> String {
        guard let page = page.pageRef else { return "" }
        return fieldValues(of: page).joined(separator: "\n")
    }

    /// Each text or choice field value on a page, read from the page's own annotation dictionaries: PDFKit's
    /// `widgetStringValue` gives "" for a multi-select list box, whose /V is an array (#622). A widget's type and value
    /// may sit on its parent field, so up to `maxFieldDepth` parents are read, as pdf.js does on Windows.
    static func fieldValues(of page: CGPDFPage) -> [String] {
        guard let pageDict = page.dictionary else { return [] }
        var annots: CGPDFArrayRef?
        guard CGPDFDictionaryGetArray(pageDict, "Annots", &annots), let annots else { return [] }
        var values: [String] = []
        for index in 0..<CGPDFArrayGetCount(annots) {
            var widget: CGPDFDictionaryRef?
            guard CGPDFArrayGetDictionary(annots, index, &widget), let widget, let field = fieldOf(widget) else { continue }
            values += strings(in: field, key: "V")
        }
        return values.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    static let maxFieldDepth = 8

    /// The dictionary holding a widget's field type, itself or a parent, when that type is text (Tx) or choice (Ch).
    private static func fieldOf(_ widget: CGPDFDictionaryRef) -> CGPDFDictionaryRef? {
        var field = widget
        for _ in 0..<maxFieldDepth {
            var type: UnsafePointer<CChar>?
            if CGPDFDictionaryGetName(field, "FT", &type), let type {
                return ["Tx", "Ch"].contains(String(cString: type)) ? field : nil
            }
            var parent: CGPDFDictionaryRef?
            guard CGPDFDictionaryGetDictionary(field, "Parent", &parent), let parent else { return nil }
            field = parent
        }
        return nil
    }

    /// A string value, or each string of an array value (a multi-select's choices).
    private static func strings(in dict: CGPDFDictionaryRef, key: String) -> [String] {
        var string: CGPDFStringRef?
        if CGPDFDictionaryGetString(dict, key, &string), let string, let text = CGPDFStringCopyTextString(string) {
            return [text as String]
        }
        var array: CGPDFArrayRef?
        guard CGPDFDictionaryGetArray(dict, key, &array), let array else { return [] }
        return (0..<CGPDFArrayGetCount(array)).compactMap { item in
            var value: CGPDFStringRef?
            guard CGPDFArrayGetString(array, item, &value), let value, let text = CGPDFStringCopyTextString(value) else { return nil }
            return text as String
        }
    }

    /// A page's chosen text with its form field values after it.
    static func withFields(_ extracted: ExtractedText, _ fields: String) -> ExtractedText {
        guard !fields.isEmpty else { return extracted }
        let text = extracted.text.isEmpty ? fields : extracted.text + "\n" + fields
        return ExtractedText(text: text, ocr: extracted.ocr)
    }

    /// The page's text layer, its lines in drawn order (`ReadingOrder.drawnOrder`). Each
    /// line is boxed through `page.selection(for:)`. When no line moves, or the lines
    /// cannot be mapped to boxes, this is `page.string` exactly.
    static func layerText(of page: PDFPage) -> String {
        let text = page.string ?? ""
        let layer = text as NSString
        guard
            page.rotation == 0,
            !text.unicodeScalars.contains("\r"),
            page.numberOfCharacters == layer.length
        else { return text }
        let crop = page.bounds(for: .cropBox)
        guard crop.width > 0, crop.height > 0 else { return text }
        var location = 0
        let lines = layer.components(separatedBy: "\n").map { line -> RecognizedLine in
            let length = (line as NSString).length
            defer { location += length + 1 }
            guard
                length > 0,
                let bounds = page.selection(for: NSRange(location: location, length: length))?.bounds(for: page),
                !bounds.isEmpty
            else { return RecognizedLine(text: line, confidence: 1, box: .null) }
            let box = CGRect(
                x: (bounds.minX - crop.minX) / crop.width,
                y: (bounds.minY - crop.minY) / crop.height,
                width: bounds.width / crop.width,
                height: bounds.height / crop.height
            )
            return RecognizedLine(text: line, confidence: 1, box: box)
        }
        let ordered = ReadingOrder.drawnOrder(lines)
        guard ordered != lines else { return text }
        return ordered.map(\.text).joined(separator: "\n")
    }

    private static func chosenText(_ page: PDFPage) throws -> ExtractedText {
        let layer = layerText(of: page)
        switch layerQuality(layer, inkedRows: { inkedRows(of: page) }) {
        case .good:
            return ExtractedText(text: layer, ocr: false)
        case .sparse:
            return chooseText(layer: layer, recognized: try PageRecognizer.text(of: page))
        case .thin:
            // The layer is real text, so an OCR failure keeps it instead of failing the file.
            guard let recognized = try? PageRecognizer.text(of: page) else {
                return ExtractedText(text: layer, ocr: false)
            }
            return chooseRicher(layer: layer, recognized: recognized)
        }
    }

    /// The page's inked row fraction from a quick render at `inkCheckDPI`; 0 when it
    /// cannot be rendered, so the layer is kept.
    static func inkedRows(of page: PDFPage) -> Double {
        guard let image = try? TextRecognizer.render(page, dpi: inkCheckDPI) else { return 0 }
        return InkCoverage.inkedRowFraction(in: image)
    }

    private static func imagePage(from data: Data) throws -> ExtractedPage {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            CGImageSourceGetCount(source) > 0,
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { throw ExtractionError.unreadable }
        // Screenshots and exports often have a transparent background; OCR needs it white.
        let opaque = try TextRecognizer.flattened(image)
        let text = try TextRecognizer.recognize(opaque, orientation: orientation(of: source))
        return ExtractedPage(n: 1, text: text, ocr: true)
    }

    /// EXIF orientation of the first image, so phone photos are read upright.
    private static func orientation(of source: CGImageSource) -> CGImagePropertyOrientation {
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let raw = properties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
        return CGImagePropertyOrientation(rawValue: raw) ?? .up
    }
}
