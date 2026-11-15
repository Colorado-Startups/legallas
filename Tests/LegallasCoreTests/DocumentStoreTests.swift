// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore

@Suite("DocumentStore")
struct DocumentStoreTests {

    @Test("SHA256 of a known byte sequence matches the expected digest")
    func sha256KnownValue() {
        let data = Data("The quick brown fox jumps over the lazy dog".utf8)
        let hash = DocumentHashing.sha256Hex(of: data)
        #expect(hash == "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592")
    }

    @Test("SHA256 hashing a temp file matches the in-memory hash")
    func sha256FileMatchesInMemory() throws {
        let data = Data("legallas-phase-2-document-hash-fixture".utf8)
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-sha-\(UUID().uuidString).bin")
        try data.write(to: tmp, options: .atomic)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let fileHash = try DocumentHashing.sha256Hex(ofFileAt: tmp)
        let memoryHash = DocumentHashing.sha256Hex(of: data)
        #expect(fileHash == memoryHash)
    }

    @Test("Security-scoped bookmark round-trips to the same file path")
    func bookmarkRoundTrip() throws {
        let content = Data("bookmark-fixture".utf8)
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas-bm-\(UUID().uuidString).txt")
        try content.write(to: tmp, options: .atomic)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let bookmark = try BookmarkResolver.makeBookmark(for: tmp)
        #expect(!bookmark.isEmpty)

        let resolved = try BookmarkResolver.resolve(bookmark)
        #expect(resolved.isStale == false)
        #expect(resolved.url.standardizedFileURL.path == tmp.standardizedFileURL.path)
    }

    @Test("withSecurityScope returns the body's value and balances start/stop")
    func withSecurityScopeReturnsValue() throws {
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("legallas-scope-\(UUID().uuidString).txt")
        try Data("scope-fixture".utf8).write(to: tmp, options: .atomic)
        defer { try? FileManager.default.removeItem(at: tmp) }

        let size = try BookmarkResolver.withSecurityScope(url: tmp) { scoped in
            try Data(contentsOf: scoped).count
        }
        #expect(size == Data("scope-fixture".utf8).count)
    }
}
