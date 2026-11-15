// SPDX-License-Identifier: Apache-2.0
import CoreGraphics
import Foundation
import PDFKit
import Testing
@testable import LegallasExtraction

/// Pages whose text layer is present but thin for the ink on them, or garbage: they are
/// OCRed too, and OCR replaces the layer only when it reads clearly more. Synthetic pages only.
@Suite("Thin and garbage text layers")
struct ThinLayerTests {

    /// Twelve lines of common words, so Vision reads them back reliably after language correction.
    static let longScan = """
        Orchard window harbor
        Garden market valley
        River bridge station
        Morning letter office
        Silver mountain road
        Summer evening light
        Winter coat pocket
        Yellow pencil drawer
        Kitchen table chair
        Paper notebook page
        Forest trail marker
        Ocean breeze sunset
        """

    /// A partial layer, like a header and initials stamped over a scanned agreement page.
    static let thinLayer = "Copperline and Harbor Labs supply agreement, page 1 of 6, initials JD and RR"

    /// Five lines of punctuation, like a layer whose font maps glyphs to the wrong codes.
    static let garbageLayer = Array(repeating: String(repeating: "!#$%&*+/<=>?@^_|~", count: 5), count: 5)
        .joined(separator: "\n")

    /// A genuinely short page: two lines of real text on an otherwise blank sheet.
    static let shortPage = """
        EXHIBIT 14
        Signature page to the supply agreement
        between Copperline Restaurant Group, Inc. and Harbor Labs, Inc.
        """

    @Test("a scan under a thin layer is OCRed and the full scan text replaces the layer")
    func thinLayerIsReplaced() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("thin.pdf", pages: [.hiddenLayer(scan: Self.longScan, layer: Self.thinLayer)])
        let layer = PDFDocument(url: url)?.page(at: 0)?.string ?? ""
        // Guard the fixture: the layer must sit between the two thresholds, or this proves nothing.
        #expect(PageTextExtractor.visibleCount(layer) >= PageTextExtractor.ocrThreshold)
        #expect(PageTextExtractor.visibleCount(layer) < PageTextExtractor.sparseThreshold)

        let page = try #require(try await OffPool.extract(url).pages.first)

        #expect(page.ocr == true)
        #expect(page.text.lowercased().contains("orchard"))
        #expect(page.text.lowercased().contains("sunset"))
    }

    @Test("a scan under a garbage layer is OCRed and the scan text replaces it")
    func garbageLayerIsReplaced() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("garbage.pdf", pages: [.hiddenLayer(scan: Self.longScan, layer: Self.garbageLayer)])
        let layer = PDFDocument(url: url)?.page(at: 0)?.string ?? ""
        #expect(PageTextExtractor.visibleCount(layer) >= PageTextExtractor.sparseThreshold)

        let page = try #require(try await OffPool.extract(url).pages.first)

        #expect(page.ocr == true)
        #expect(page.text.lowercased().contains("harbor"))
        #expect(page.text.contains("!#$%") == false)
    }

    @Test("a short page of real text keeps its layer and is not OCRed")
    func shortPageKeepsLayer() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf("short.pdf", pages: [.text(Self.shortPage)])
        let document = try #require(PDFDocument(url: url))
        let page = try #require(document.page(at: 0))
        #expect(PageTextExtractor.visibleCount(page.string ?? "") >= PageTextExtractor.ocrThreshold)
        #expect(PageTextExtractor.inkedRows(of: page) < PageTextExtractor.inkedRowsFraction)

        let extracted = try #require(try await OffPool.extract(url).pages.first)

        #expect(extracted.ocr == false)
        #expect(extracted.text.contains("Signature page to the supply agreement"))
    }

    @Test("layerQuality: sparse under the threshold, thin when inked or garbage, good otherwise")
    func layerQualityPolicy() {
        var asked = 0
        let ink: (Double) -> () -> Double = { value in { asked += 1; return value } }

        #expect(PageTextExtractor.layerQuality("", inkedRows: ink(1)) == .sparse)
        #expect(PageTextExtractor.layerQuality(String(repeating: "word ", count: 100), inkedRows: ink(1)) == .good)
        #expect(PageTextExtractor.layerQuality(Self.garbageLayer, inkedRows: ink(0)) == .thin)
        #expect(asked == 0, "only a short, sound layer needs the page rendered")

        #expect(PageTextExtractor.layerQuality(Self.shortPage, inkedRows: ink(0.05)) == .good)
        #expect(PageTextExtractor.layerQuality(Self.shortPage, inkedRows: ink(0.5)) == .thin)
        #expect(asked == 2)
    }

    @Test("chooseRicher replaces the layer only when OCR reads clearly more letters and digits")
    func chooseRicherPolicy() {
        let scan = PageTextExtractor.chooseRicher(layer: Self.thinLayer, recognized: Self.longScan)
        #expect(scan == PageTextExtractor.ExtractedText(text: Self.longScan, ocr: true))

        let chart = PageTextExtractor.chooseRicher(layer: "Invoice 2012 2013 Q1 Q2 Q3", recognized: "Invoice 2012 2013 Q1 Q2 Q3 Q4")
        #expect(chart == PageTextExtractor.ExtractedText(text: "Invoice 2012 2013 Q1 Q2 Q3", ocr: false))

        let garbage = PageTextExtractor.chooseRicher(layer: Self.garbageLayer, recognized: "Orchard")
        #expect(garbage.ocr == true)

        let blank = PageTextExtractor.chooseRicher(layer: "", recognized: " \n")
        #expect(blank == PageTextExtractor.ExtractedText(text: "", ocr: false))
    }

    @Test("usefulCount counts letters and digits of any script, not punctuation or private-use glyphs")
    func usefulCountScope() {
        #expect(PageTextExtractor.usefulCount("Ab1 \u{E9}\u{E000}!?") == 4)
        #expect(PageTextExtractor.usefulCount("") == 0)
    }

    @Test("inkedRowFraction measures the share of rows holding ink")
    func inkedRowFractionMeasures() throws {
        #expect(InkCoverage.inkedRowFraction(in: try Self.gray(width: 100, height: 100, blackRows: 0..<0)) == 0)
        #expect(InkCoverage.inkedRowFraction(in: try Self.gray(width: 100, height: 100, blackRows: 0..<100)) == 1)
        #expect(InkCoverage.inkedRowFraction(in: try Self.gray(width: 100, height: 100, blackRows: 0..<50)) == 0.5)
    }

    /// A white gray image with `blackRows` (top to bottom) painted black.
    static func gray(width: Int, height: Int, blackRows: Range<Int>) throws -> CGImage {
        var pixels = [UInt8](repeating: 255, count: width * height)
        for row in blackRows {
            for column in 0..<width { pixels[row * width + column] = 0 }
        }
        guard
            let provider = CGDataProvider(data: Data(pixels) as CFData),
            let image = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                provider: provider,
                decode: nil,
                shouldInterpolate: false,
                intent: .defaultIntent
            )
        else { throw FixtureError.cannotCreate }
        return image
    }
}
