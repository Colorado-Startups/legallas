// SPDX-License-Identifier: Apache-2.0
// Exits 0 when Vision's `.accurate` text recognizer (the level LegallasExtraction
// uses) can run on this machine, 1 when it cannot.
//
// GitHub's hosted macOS runners are VMs with no Neural Engine. On macOS 27
// (`xcode-27`) the accurate recognizer fails there ("nilError", on the virtual GPU
// and on the CPU) while `.fast` works; on macOS 26 (`macos-26`) it runs on the
// virtual GPU or the CPU (both checked 2026-10-31). ci.yml's `swift` job skips
// LegallasExtractionTests with a notice when this probe fails, and `swift-ocr`,
// which runs them, fails instead.
import CoreGraphics
import CoreText
import Foundation
import Vision

let size = CGSize(width: 1_600, height: 600)
guard let context = CGContext(
    data: nil,
    width: Int(size.width),
    height: Int(size.height),
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceGray(),
    bitmapInfo: CGImageAlphaInfo.none.rawValue
) else { fatalError("cannot create bitmap context") }
context.setFillColor(gray: 1, alpha: 1)
context.fill(CGRect(origin: .zero, size: size))
let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica" as CFString, 80, nil),
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0, alpha: 1)
]
context.textPosition = CGPoint(x: 80, y: 300)
CTLineDraw(CTLineCreateWithAttributedString(NSAttributedString(string: "ORCHARD WINDOW", attributes: attributes)), context)
guard let image = context.makeImage() else { fatalError("cannot create image") }

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
do {
    try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
    print("accurate OCR available: \(text)")
    exit(text.uppercased().contains("ORCHARD") ? 0 : 1)
} catch {
    print("accurate OCR unavailable: \(error)")
    exit(1)
}
