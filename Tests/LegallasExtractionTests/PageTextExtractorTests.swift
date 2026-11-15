// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation
import ImageIO
import PDFKit
import Testing
@testable import LegallasExtraction

@Suite("PageTextExtractor")
struct PageTextExtractorTests {

    static let bodyText = """
        The quick brown fox jumps over the lazy dog.
        This page has a real text layer drawn with Core Text.
        """

    @Test("text page uses the PDF text layer without OCR")
    func textPageUsesTextLayer() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("text.pdf", pages: [.text(Self.bodyText)])

        let result = try PageTextExtractor.extract(fileAt: url)

        #expect(result.pageCount == 1)
        let page = try #require(result.pages.first)
        #expect(page.n == 1)
        #expect(page.ocr == false)
        #expect(page.text.contains("quick brown fox jumps over the lazy dog"))
        #expect(page.text.contains("real text layer"))
    }

    @Test("image-only page triggers OCR and recognizes the scanned words")
    func imageOnlyPageIsOCRed() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("scan.pdf", pages: [.image(Fixtures.scanText)])

        let document = try #require(PDFDocument(url: url))
        let layer = document.page(at: 0)?.string ?? ""
        #expect(PageTextExtractor.visibleCount(layer) < PageTextExtractor.ocrThreshold)

        let page = try #require(try await OffPool.extract(url).pages.first)
        #expect(page.ocr == true)
        #expect(page.text.lowercased().contains("orchard"))
        #expect(page.text.lowercased().contains("harbor"))
    }

    @Test("mixed PDF keeps page order and flags only the scanned page")
    func mixedDocumentPerPage() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("mixed.pdf", pages: [.text(Self.bodyText), .image(Fixtures.scanText)])

        let result = try await OffPool.extract(url)

        #expect(result.pageCount == 2)
        #expect(result.pages.map(\.n) == [1, 2])
        #expect(result.pages.map(\.ocr) == [false, true])
        #expect(result.pages[0].text.contains("quick brown fox"))
        #expect(result.pages[1].text.lowercased().contains("orchard"))
    }

    @Test("scan with a small text-layer stamp still gets OCR text")
    func stampedScanIsOCRed() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("stamped.pdf", pages: [.stampedImage(Fixtures.scanText, stamp: "AB000123")])

        let page = try #require(try await OffPool.extract(url).pages.first)
        #expect(page.ocr == true)
        #expect(page.text.lowercased().contains("orchard"))
    }

    @Test("single PNG image is one OCR page")
    func pngIsOneOCRPage() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.png("photo.PNG", text: Fixtures.scanText)

        let result = try await OffPool.extract(url)

        #expect(result.pageCount == 1)
        let page = try #require(result.pages.first)
        #expect(page.n == 1)
        #expect(page.ocr == true)
        #expect(page.text.lowercased().contains("window"))
    }

    @Test("transparent PNG with dark text is composited over white and recognized")
    func transparentPNGIsRecognized() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.png("clear.png", text: Fixtures.scanText, transparent: true)

        // Guard the fixture itself: the file must really carry alpha, or this test proves nothing.
        let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        #expect(properties?[kCGImagePropertyHasAlpha] as? Bool == true)

        let page = try #require(try await OffPool.extract(url).pages.first)
        #expect(page.ocr == true)
        #expect(page.text.lowercased().contains("orchard"))
        #expect(page.text.lowercased().contains("harbor"))
    }

    @Test("flattening an alpha image yields an opaque image of the same size")
    func flattenRemovesAlpha() throws {
        let clear = try Fixtures.rasterizeClear(Fixtures.scanText, size: CGSize(width: 400, height: 150))
        #expect(clear.alphaInfo == .premultipliedLast)

        let flat = try TextRecognizer.flattened(clear)

        #expect(flat.width == 400)
        #expect(flat.height == 150)
        #expect([.none, .noneSkipFirst, .noneSkipLast].contains(flat.alphaInfo))
    }

    @Test("chooseText prefers OCR only when it found more visible text")
    func chooseTextPolicy() {
        let richer = PageTextExtractor.chooseText(layer: "AB000123", recognized: "ORCHARD WINDOW\nAB000123")
        #expect(richer.ocr == true)
        #expect(richer.text == "ORCHARD WINDOW\nAB000123")

        let same = PageTextExtractor.chooseText(layer: "EXHIBIT A", recognized: "EXHIBIT A")
        #expect(same.ocr == false)
        #expect(same.text == "EXHIBIT A")

        let blank = PageTextExtractor.chooseText(layer: "", recognized: "  \n")
        #expect(blank.ocr == false)
        #expect(blank.text.isEmpty)
    }

    @Test("visibleCount ignores spaces, tabs and newlines")
    func visibleCountIgnoresWhitespace() {
        #expect(PageTextExtractor.visibleCount(" a b\tc\n\nd ") == 4)
        #expect(PageTextExtractor.visibleCount("") == 0)
    }

    @Test("rotated page renders upright onto the full canvas at 300 dpi")
    func rotatedPageRendersOnCanvas() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let box = CGRect(x: 0, y: 0, width: 144, height: 72)
        let url = try fixtures.pdf("black.pdf", pages: [.black], mediaBox: box)
        let page = try #require(PDFDocument(url: url)?.page(at: 0))
        page.rotation = 90

        let image = try TextRecognizer.render(page)

        // 1 x 2 inches after a quarter turn, at 300 dpi.
        #expect(image.width == 300)
        #expect(image.height == 600)
        #expect(try Self.darkFraction(of: image) > 0.95)
    }

    @Test("sha256 matches a known vector and an independent shasum")
    func sha256IsCorrect() async throws {
        #expect(
            PageTextExtractor.sha256Hex(of: Data("abc".utf8))
                == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("hash.pdf", pages: [.text(Self.bodyText)])

        let result = try PageTextExtractor.extract(fileAt: url)

        let expected = try await OffPool.run { try Self.shasum(url) }
        #expect(result.sha256 == expected)
    }

    @Test("owner-password-only PDF opens without a password")
    func ownerPasswordOnlyOpens() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("owner.pdf", pages: [.text(Self.bodyText)], ownerPassword: "owner-secret")

        let result = try PageTextExtractor.extract(fileAt: url)

        #expect(result.pages.first?.text.contains("quick brown fox") == true)
    }

    @Test("user-password PDF throws encrypted")
    func userPasswordThrowsEncrypted() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf(
            "locked.pdf", pages: [.text(Self.bodyText)], userPassword: "user-secret", ownerPassword: "owner-secret"
        )

        #expect(throws: ExtractionError.encrypted) {
            try PageTextExtractor.extract(fileAt: url)
        }
    }

    /// Fraction of pixels darker than mid-gray, read through an 8-bit gray copy.
    static func darkFraction(of image: CGImage) throws -> Double {
        let width = image.width
        let height = image.height
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
        guard drawn else { throw FixtureError.cannotCreate }
        let dark = pixels.reduce(0) { $1 < 128 ? $0 + 1 : $0 }
        return Double(dark) / Double(pixels.count)
    }

    /// sha256 from /usr/bin/shasum, independent of CryptoKit.
    static func shasum(_ url: URL) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/shasum")
        process.arguments = ["-a", "256", url.path]
        let pipe = Pipe()
        process.standardOutput = pipe
        try process.run()
        let output = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return String(decoding: output, as: UTF8.self).split(separator: " ").first.map(String.init) ?? ""
    }
    @Test("a number typed into a filled form field is read with the page (#347)")
    func formFieldValueIsRead() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        // The SSA's voided sample number, joined at run time.
        let number = ["078", "05", "1120"].joined(separator: "-")
        let line = "The quick brown fox jumps over the lazy dog, twice over."
        let content = "BT /F1 12 Tf 72 720 Td (\(line)) Tj ET"
        let url = try fixtures.file("form.pdf", contents: Self.pdfOf([
            "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots [5 0 R] "
                + "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>",
            "<< /Length \(content.utf8.count) >>\nstream\n\(content)\nendstream",
            "<< /Type /Annot /Subtype /Widget /FT /Tx /T (ssn) /V (\(number)) /Rect [72 600 300 620] /P 3 0 R >>"
        ]))

        let page = try #require(try PageTextExtractor.extract(fileAt: url).pages.first)

        #expect(page.text.contains("quick brown fox"))
        #expect(page.text.hasSuffix("\n" + number))
    }

    @Test("a multi-select list box gives each choice, and a field's value on its parent is read (#622)")
    func multiSelectAndInheritedFieldValues() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let line = "The quick brown fox jumps over the lazy dog, twice over."
        let content = "BT /F1 12 Tf 72 720 Td (\(line)) Tj ET"
        let url = try fixtures.file("fields.pdf", contents: Self.pdfOf([
            "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 7 0 R] >> >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots [5 0 R 6 0 R] "
                + "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>",
            "<< /Length \(content.utf8.count) >>\nstream\n\(content)\nendstream",
            "<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 2228224 /T (states) /Opt [(Delaware) (Colorado) (Texas)] "
                + "/V [(Delaware) (Colorado)] /Rect [72 600 300 680] /P 3 0 R >>",
            "<< /Type /Annot /Subtype /Widget /Parent 7 0 R /Rect [72 500 300 520] /P 3 0 R >>",
            "<< /FT /Tx /T (company) /V (Harbor Labs) /Kids [6 0 R] >>"
        ]))

        let page = try #require(try PageTextExtractor.extract(fileAt: url).pages.first)

        #expect(page.text.hasSuffix("\nDelaware\nColorado\nHarbor Labs"))
        #expect(!page.text.contains("Texas"), "an option not chosen is not a value")
    }

    @Test("a text layer's wrapped short last line reads after the long line above it (#377)")
    func wrappedLastLineReadsInDrawnOrder() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        // The page web/scripts/dev-pdf.ts writes: Helvetica 11 pt, 16 pt leading, one line per Tj.
        // PDFKit's page.string reads "covers." before the line above it.
        let lines = [
            "HARBOR LABS SAMPLE RECORD. Fictional: every name, date and number is invented.",
            "Page 7 of 12",
            "Competition",
            "Paper, spreadsheets and ShiftPad. None of them builds the schedule from forecast",
            "covers."
        ]
        let body = lines.enumerated().map { index, text in (index == 0 ? "" : "T* ") + "(\(text)) Tj" }
        let content = "BT\n/F1 11 Tf\n16 TL\n72 720 Td\n" + body.joined(separator: "\n") + "\nET\n"
        let url = try fixtures.file("wrapped.pdf", contents: Self.pdfOf([
            "<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
                + "/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica "
                + "/Encoding /WinAnsiEncoding >> >> >> >>",
            "<< /Length \(content.utf8.count) >>\nstream\n\(content)endstream"
        ]))

        let page = try #require(try PageTextExtractor.extract(fileAt: url).pages.first)

        #expect(page.ocr == false)
        #expect(page.text == lines.joined(separator: "\n"))
    }

    /// An ASCII PDF of these objects, numbered from 1, with object 1 as its catalog.
    static func pdfOf(_ objects: [String]) -> String {
        var out = "%PDF-1.7\n"
        var offsets: [Int] = []
        for (index, body) in objects.enumerated() {
            offsets.append(out.utf8.count)
            out += "\(index + 1) 0 obj\n\(body)\nendobj\n"
        }
        let xrefAt = out.utf8.count
        out += "xref\n0 \(objects.count + 1)\n0000000000 65535 f \n"
        for offset in offsets { out += String(format: "%010d 00000 n \n", offset) }
        out += "trailer\n<< /Size \(objects.count + 1) /Root 1 0 R >>\nstartxref\n\(xrefAt)\n%%EOF\n"
        return out
    }
}
