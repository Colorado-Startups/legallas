// SPDX-License-Identifier: Apache-2.0
import Foundation

/// The text of one page, in the shape the counsel room sync consumes.
public struct ExtractedPage: Codable, Equatable, Sendable {
    /// One-based page number.
    public let n: Int
    /// Extracted text. Empty when the page has no recognizable text.
    public let text: String
    /// True when `text` came from Vision OCR instead of the PDF text layer.
    public let ocr: Bool

    /// Creates a page record.
    public init(n: Int, text: String, ocr: Bool) {
        self.n = n
        self.text = text
        self.ocr = ocr
    }
}

/// Everything `LegallasExtract` prints for one file.
public struct ExtractionResult: Codable, Equatable, Sendable {
    /// Lowercase hex sha256 of the file bytes.
    public let sha256: String
    /// Number of pages (1 for a single image).
    public let pageCount: Int
    /// Per-page text, in page order.
    public let pages: [ExtractedPage]

    /// Creates a result record.
    public init(sha256: String, pageCount: Int, pages: [ExtractedPage]) {
        self.sha256 = sha256
        self.pageCount = pageCount
        self.pages = pages
    }
}

/// Why a file could not be extracted. `code` is the only thing ever written to stderr.
public enum ExtractionError: Error, Equatable, Sendable {
    /// The file is missing, unreadable, or not a valid PDF or image.
    case unreadable
    /// The file extension is not a PDF or a supported image type.
    case unsupported
    /// The PDF needs a password to open.
    case encrypted
    /// A page needed OCR but could not be rendered or recognized.
    case ocrFailed

    /// Short, text-free error code for stderr.
    public var code: String {
        switch self {
        case .unreadable: "unreadable"
        case .unsupported: "unsupported"
        case .encrypted: "encrypted"
        case .ocrFailed: "ocr-failed"
        }
    }

    /// Process exit code for the CLI.
    public var exitCode: Int32 {
        switch self {
        case .unreadable, .unsupported: 2
        case .encrypted: 3
        case .ocrFailed: 1
        }
    }
}
