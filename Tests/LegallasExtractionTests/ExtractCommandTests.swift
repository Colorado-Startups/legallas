// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasExtraction

/// Anchors `Bundle(for:)` to the test bundle so the built CLI can be found next to it.
private final class BundleToken {}

/// What the spawned CLI produced.
private struct BinaryRun: Sendable {
    let status: Int32
    let stdout: Data
    let stderr: String
}

@Suite("ExtractCommand")
struct ExtractCommandTests {

    @Test("success prints the JSON shape and nothing on stderr")
    func jsonShape() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf(
            "shape.pdf", pages: [.text(PageTextExtractorTests.bodyText), .image(Fixtures.scanText)]
        )

        // The scanned page runs Vision, so keep it off the cooperative pool (see OffPool).
        let outcome = try await OffPool.run { ExtractCommand.run(arguments: [url.path]) }

        #expect(outcome.exitCode == 0)
        #expect(outcome.stderr.isEmpty)
        #expect(outcome.stdout.last == 0x0A)
        try Self.assertShape(outcome.stdout, pageCount: 2)
    }

    @Test("non-PDF extension exits 2 with a bare code")
    func unsupportedExtension() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.file("notes.txt", contents: "plain text, not a PDF")

        let outcome = ExtractCommand.run(arguments: [url.path])

        #expect(outcome.exitCode == 2)
        #expect(outcome.stderr == "unsupported\n")
        #expect(outcome.stdout.isEmpty)
    }

    @Test("corrupt .pdf and missing file exit 2 as unreadable")
    func unreadableFiles() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let fake = try fixtures.file("fake.pdf", contents: "this is not really a PDF")
        let missing = fixtures.directory.appendingPathComponent("missing.pdf")

        for url in [fake, missing] {
            let outcome = ExtractCommand.run(arguments: [url.path])
            #expect(outcome.exitCode == 2)
            #expect(outcome.stderr == "unreadable\n")
            #expect(outcome.stdout.isEmpty)
        }
    }

    @Test("password-locked PDF exits 3 and leaks no text")
    func encryptedExits3() throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let url = try fixtures.pdf(
            "locked.pdf", pages: [.text(PageTextExtractorTests.bodyText)],
            userPassword: "user-secret", ownerPassword: "owner-secret"
        )

        let outcome = ExtractCommand.run(arguments: [url.path])

        #expect(outcome.exitCode == 3)
        #expect(outcome.stderr == "encrypted\n")
        #expect(outcome.stdout.isEmpty)
    }

    @Test("wrong argument count exits 2 with usage")
    func usage() {
        #expect(ExtractCommand.run(arguments: []).exitCode == 2)
        #expect(ExtractCommand.run(arguments: ["a.pdf", "b.pdf"]).stderr == "usage\n")
    }

    @Test("built LegallasExtract binary honors the stdout, stderr and exit code contract")
    func binaryEndToEnd() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        let text = try fixtures.pdf("cli.pdf", pages: [.text(PageTextExtractorTests.bodyText)])
        let locked = try fixtures.pdf(
            "cli-locked.pdf", pages: [.text(PageTextExtractorTests.bodyText)],
            userPassword: "user-secret", ownerPassword: "owner-secret"
        )
        let other = try fixtures.file("cli.docx", contents: "not supported")

        let success = try await Self.runBinary(text)
        #expect(success.status == 0)
        #expect(success.stderr.isEmpty)
        try Self.assertShape(success.stdout, pageCount: 1)

        let encrypted = try await Self.runBinary(locked)
        #expect(encrypted.status == 3)
        #expect(encrypted.stderr == "encrypted\n")
        #expect(encrypted.stdout.isEmpty)

        let unsupported = try await Self.runBinary(other)
        #expect(unsupported.status == 2)
        #expect(unsupported.stderr == "unsupported\n")
    }

    @Test("binary keeps framework log noise off stderr, leaving only the code")
    func binaryStderrIsOnlyTheCode() async throws {
        let fixtures = try Fixtures()
        defer { fixtures.cleanUp() }
        // CoreGraphics logs its own complaint to stderr when it parses a corrupt PDF.
        let corrupt = try fixtures.file("corrupt.pdf", contents: "%PDF-1.7\nthis is not really a PDF")

        let run = try await Self.runBinary(corrupt)

        #expect(run.status == 2)
        #expect(run.stderr == "unreadable\n")
        #expect(run.stdout.isEmpty)
    }

    /// Checks the exact key sets and value types of the CLI JSON.
    static func assertShape(_ data: Data, pageCount: Int) throws {
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(Set(object.keys) == ["sha256", "pageCount", "pages"])
        let sha = try #require(object["sha256"] as? String)
        #expect(sha.count == 64)
        #expect(sha.allSatisfy { $0.isHexDigit && !$0.isUppercase })
        #expect(object["pageCount"] as? Int == pageCount)
        let pages = try #require(object["pages"] as? [[String: Any]])
        #expect(pages.count == pageCount)
        for (index, page) in pages.enumerated() {
            #expect(Set(page.keys) == ["n", "text", "ocr"])
            #expect(page["n"] as? Int == index + 1)
            #expect(page["text"] is String)
            #expect(page["ocr"] is Bool)
        }
        let decoded = try JSONDecoder().decode(ExtractionResult.self, from: data)
        #expect(decoded.pageCount == pageCount)
    }

    /// Runs the LegallasExtract binary built alongside this test bundle, waiting off the pool.
    private static func runBinary(_ file: URL) async throws -> BinaryRun {
        let products = Bundle(for: BundleToken.self).bundleURL.deletingLastPathComponent()
        let binary = products.appendingPathComponent("LegallasExtract")
        try #require(FileManager.default.isExecutableFile(atPath: binary.path), "LegallasExtract not built")

        return try await OffPool.run { try spawn(binary, file) }
    }

    /// Spawns `binary` on `file` and blocks until it exits; call through `OffPool`.
    private static func spawn(_ binary: URL, _ file: URL) throws -> BinaryRun {
        let process = Process()
        process.executableURL = binary
        process.arguments = [file.path]
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        try process.run()
        let stdout = out.fileHandleForReading.readDataToEndOfFile()
        let stderr = err.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return BinaryRun(status: process.terminationStatus, stdout: stdout, stderr: String(decoding: stderr, as: UTF8.self))
    }
}
