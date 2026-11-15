// SPDX-License-Identifier: Apache-2.0
import AppKit
import Foundation

private enum PDFExporterError: Error, LocalizedError {
    case renderingFailed

    var errorDescription: String? {
        switch self {
        case .renderingFailed: return "Failed to render PDF from markdown."
        }
    }
}

@MainActor
enum PDFExporter {

    static func renderPDF(markdown: String, to url: URL) throws {
        let options = AttributedString.MarkdownParsingOptions(
            interpretedSyntax: .full
        )
        let attributed: NSAttributedString
        if let parsed = try? AttributedString(markdown: markdown, options: options) {
            attributed = NSAttributedString(parsed)
        } else {
            attributed = NSAttributedString(string: markdown)
        }

        let pageSize = NSSize(width: 612, height: 792)
        let margin: CGFloat = 54
        let textRect = NSRect(
            x: margin,
            y: margin,
            width: pageSize.width - margin * 2,
            height: pageSize.height - margin * 2
        )

        let frame = NSRect(origin: .zero, size: pageSize)
        let textView = NSTextView(frame: frame)
        textView.textContainerInset = .zero
        textView.textContainer?.size = textRect.size
        textView.textContainer?.lineFragmentPadding = 0
        textView.textStorage?.setAttributedString(attributed)

        let printInfo = NSPrintInfo()
        printInfo.paperSize = pageSize
        printInfo.topMargin = margin
        printInfo.bottomMargin = margin
        printInfo.leftMargin = margin
        printInfo.rightMargin = margin
        printInfo.horizontalPagination = .fit
        printInfo.verticalPagination = .automatic
        printInfo.jobDisposition = .save
        printInfo.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = url

        let operation = NSPrintOperation(view: textView, printInfo: printInfo)
        operation.showsPrintPanel = false
        operation.showsProgressPanel = false

        guard operation.run() else {
            throw PDFExporterError.renderingFailed
        }
    }
}
