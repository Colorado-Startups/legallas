// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import PDFKit
import LegallasCore

private struct PDFExtractionResult: Sendable {
    let fullTextContent: String?
    let pageCount: Int?
    let sha256: String
    let byteSize: Int
}

private enum DocumentStoreError: Error, LocalizedError {
    case bookmarkResolutionFailed
    case fileNotReadable(URL)

    var errorDescription: String? {
        switch self {
        case .bookmarkResolutionFailed:
            return "The file bookmark could not be resolved. Try reconnecting the file."
        case .fileNotReadable(let url):
            return "The file at \(url.path) could not be read."
        }
    }
}

@MainActor
final class DocumentStore {

    let modelContext: ModelContext

    init(modelContext: ModelContext) {
        self.modelContext = modelContext
    }

    nonisolated static func withSecurityScope<T>(url: URL, body: (URL) throws -> T) rethrows -> T {
        try BookmarkResolver.withSecurityScope(url: url, body: body)
    }

    func resolve(_ document: Document) throws -> (URL, isStale: Bool) {
        let resolved = try BookmarkResolver.resolve(document.bookmarkData)
        return (resolved.url, resolved.isStale)
    }

    func recreateBookmark(for document: Document, at url: URL) throws {
        let data = try BookmarkResolver.makeBookmark(for: url)
        document.bookmarkData = data
        document.lastKnownPath = url.path
        document.bookmarkCreatedAt = Date()
        document.bookmarkLastVerifiedAt = Date()
        try modelContext.save()
    }

    func importFile(at url: URL, for kase: Case, tags: [String] = []) async throws -> Document {
        let bookmark = try BookmarkResolver.makeBookmark(for: url)

        let document = Document(
            title: url.deletingPathExtension().lastPathComponent,
            originalFilename: url.lastPathComponent,
            bookmarkData: bookmark,
            lastKnownPath: url.path,
            tags: tags
        )
        document.bookmarkLastVerifiedAt = Date()
        modelContext.insert(document)
        kase.documents.append(document)
        try modelContext.save()

        let documentID = document.persistentModelID
        let result = try await Task.detached(priority: .utility) { () throws -> PDFExtractionResult in
            try PDFExtractor.extract(from: url)
        }.value

        if let doc = modelContext.model(for: documentID) as? Document {
            doc.fullTextContent = result.fullTextContent
            doc.pageCount = result.pageCount
            doc.sha256 = result.sha256
            try modelContext.save()
        }

        return document
    }

    func sweepBookmarks(for kase: Case) -> [Document] {
        var stale: [Document] = []
        for doc in kase.documents {
            do {
                let resolved = try BookmarkResolver.resolve(doc.bookmarkData)
                if resolved.isStale {
                    stale.append(doc)
                } else {
                    doc.bookmarkLastVerifiedAt = Date()
                }
            } catch {
                stale.append(doc)
            }
        }
        try? modelContext.save()
        return stale
    }
}

private enum PDFExtractor {

    nonisolated static func extract(from url: URL) throws -> PDFExtractionResult {
        try BookmarkResolver.withSecurityScope(url: url) { scopedURL in
            let data: Data
            do {
                data = try Data(contentsOf: scopedURL)
            } catch {
                throw DocumentStoreError.fileNotReadable(scopedURL)
            }
            let hash = DocumentHashing.sha256Hex(of: data)
            let byteSize = data.count

            let isPDF = scopedURL.pathExtension.lowercased() == "pdf"
            guard isPDF, let pdf = PDFDocument(url: scopedURL) else {
                return PDFExtractionResult(
                    fullTextContent: nil,
                    pageCount: nil,
                    sha256: hash,
                    byteSize: byteSize
                )
            }

            // The page layer only, form field values left out: this text feeds the app's own library search and its
            // local MCP tools, never the SSN guard or the room, which read fields through LegallasExtraction (#622).
            var text = ""
            for i in 0..<pdf.pageCount {
                if let page = pdf.page(at: i), let pageText = page.string {
                    text.append(pageText)
                    if !pageText.hasSuffix("\n") { text.append("\n") }
                }
            }
            return PDFExtractionResult(
                fullTextContent: text.isEmpty ? nil : text,
                pageCount: pdf.pageCount,
                sha256: hash,
                byteSize: byteSize
            )
        }
    }
}

@MainActor
@Observable
final class DocumentStoreState {
    var staleDocuments: [Document] = []
}
