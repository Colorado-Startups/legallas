// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Builds synthetic PDFs and images in a temp directory. No case files are ever used.
struct Fixtures {

    /// One page of a generated PDF.
    enum Page {
        /// A real text layer drawn with Core Text.
        case text(String)
        /// Text rasterized into a bitmap first, so the page has no text layer.
        case image(String)
        /// A rasterized scan plus a small text-layer stamp, like a Bates number.
        case stampedImage(String, stamp: String)
        /// A rasterized scan under an invisible text layer that says something else, like a
        /// scan whose OCR layer covers only a header, or holds unmapped glyph codes.
        case hiddenLayer(scan: String, layer: String)
        /// A page filled solid black (for render geometry checks).
        case black
    }

    /// Letter-size page in points.
    static let letter = CGRect(x: 0, y: 0, width: 612, height: 792)

    /// Words the OCR tests look for; common English words survive language correction.
    static let scanText = "ORCHARD WINDOW HARBOR"

    let directory: URL

    init() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas-extract-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    func cleanUp() {
        try? FileManager.default.removeItem(at: directory)
    }

    /// Writes a PDF with the given pages. Passwords, when set, encrypt it.
    func pdf(
        _ name: String,
        pages: [Page],
        mediaBox: CGRect = Fixtures.letter,
        userPassword: String? = nil,
        ownerPassword: String? = nil
    ) throws -> URL {
        let url = directory.appendingPathComponent(name)
        var info: [CFString: Any] = [:]
        if let userPassword { info[kCGPDFContextUserPassword] = userPassword }
        if let ownerPassword { info[kCGPDFContextOwnerPassword] = ownerPassword }
        var box = mediaBox
        guard let context = CGContext(url as CFURL, mediaBox: &box, info as CFDictionary) else {
            throw FixtureError.cannotCreate
        }
        for page in pages {
            context.beginPDFPage(nil)
            try draw(page, in: context, box: mediaBox)
            context.endPDFPage()
        }
        context.closePDF()
        return url
    }

    /// Writes a PNG whose only content is rasterized text. With `transparent`, the
    /// background is fully clear (alpha 0) and only the dark glyphs are opaque, like a
    /// screenshot or an export with no background.
    func png(_ name: String, text: String, transparent: Bool = false) throws -> URL {
        let url = directory.appendingPathComponent(name)
        let size = CGSize(width: 1_600, height: 600)
        let image = transparent ? try Self.rasterizeClear(text, size: size) : try Self.rasterize(text, size: size)
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL, UTType.png.identifier as CFString, 1, nil
        ) else { throw FixtureError.cannotCreate }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw FixtureError.cannotCreate }
        return url
    }

    /// Writes arbitrary bytes, for non-PDF and corrupt-file cases.
    func file(_ name: String, contents: String) throws -> URL {
        let url = directory.appendingPathComponent(name)
        try Data(contents.utf8).write(to: url)
        return url
    }

    private func draw(_ page: Page, in context: CGContext, box: CGRect) throws {
        switch page {
        case .text(let text):
            Self.drawLines(text, in: context, fontSize: 14, origin: CGPoint(x: 72, y: box.height - 96))
        case .image(let text):
            context.draw(try Self.scan(text, box: box), in: box)
        case .stampedImage(let text, let stamp):
            context.draw(try Self.scan(text, box: box), in: box)
            Self.drawLines(stamp, in: context, fontSize: 9, origin: CGPoint(x: box.width - 120, y: 24))
        case .hiddenLayer(let scan, let layer):
            context.draw(try Self.scan(scan, box: box), in: box)
            context.setTextDrawingMode(.invisible)
            Self.drawLines(layer, in: context, fontSize: 9, origin: CGPoint(x: 36, y: box.height - 36))
            context.setTextDrawingMode(.fill)
        case .black:
            context.setFillColor(gray: 0, alpha: 1)
            context.fill(box)
        }
    }

    /// A 200 dpi bitmap of `text`, the size of `box`.
    private static func scan(_ text: String, box: CGRect) throws -> CGImage {
        let scale: CGFloat = 200 / 72
        return try rasterize(text, size: CGSize(width: box.width * scale, height: box.height * scale))
    }

    /// Draws `text` into an opaque white bitmap and returns the image.
    static func rasterize(_ text: String, size: CGSize) throws -> CGImage {
        guard let context = CGContext(
            data: nil,
            width: Int(size.width),
            height: Int(size.height),
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { throw FixtureError.cannotCreate }
        context.setFillColor(gray: 1, alpha: 1)
        context.fill(CGRect(origin: .zero, size: size))
        let fontSize = size.width / 20
        drawLines(text, in: context, fontSize: fontSize, origin: CGPoint(x: fontSize, y: size.height - fontSize * 3))
        guard let image = context.makeImage() else { throw FixtureError.cannotCreate }
        return image
    }

    /// Draws `text` into an RGBA bitmap left fully transparent behind the glyphs.
    static func rasterizeClear(_ text: String, size: CGSize) throws -> CGImage {
        guard
            let space = CGColorSpace(name: CGColorSpace.sRGB),
            let context = CGContext(
                data: nil,
                width: Int(size.width),
                height: Int(size.height),
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else { throw FixtureError.cannotCreate }
        context.clear(CGRect(origin: .zero, size: size))
        let fontSize = size.width / 20
        drawLines(text, in: context, fontSize: fontSize, origin: CGPoint(x: fontSize, y: size.height - fontSize * 3))
        guard let image = context.makeImage() else { throw FixtureError.cannotCreate }
        return image
    }

    /// Draws each line of `text` in black Helvetica, top to bottom from `origin`.
    static func drawLines(_ text: String, in context: CGContext, fontSize: CGFloat, origin: CGPoint) {
        let font = CTFontCreateWithName("Helvetica" as CFString, fontSize, nil)
        let attributes: [NSAttributedString.Key: Any] = [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
        ]
        var y = origin.y
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let ctLine = CTLineCreateWithAttributedString(
                NSAttributedString(string: String(line), attributes: attributes)
            )
            context.textPosition = CGPoint(x: origin.x, y: y)
            CTLineDraw(ctLine, context)
            y -= fontSize * 1.5
        }
    }
}

/// Fixture construction failed (a test bug, not an extractor bug).
enum FixtureError: Error {
    case cannotCreate
}
