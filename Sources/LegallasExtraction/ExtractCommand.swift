// SPDX-License-Identifier: Apache-2.0
import Foundation

/// The `LegallasExtract` command, kept in the library so tests can run it in-process.
public enum ExtractCommand {

    /// What one run produced: the exit code plus exactly what goes to stdout and stderr.
    public struct Outcome: Equatable, Sendable {
        /// Process exit code: 0 ok, 2 unreadable or unsupported, 3 encrypted, 1 OCR failure.
        public let exitCode: Int32
        /// The JSON document plus a trailing newline, or empty on failure.
        public let stdout: Data
        /// A short error code plus a trailing newline, or empty on success. Never document text.
        public let stderr: String
    }

    /// Runs the command for `arguments` (excluding the program name).
    public static func run(arguments: [String]) -> Outcome {
        guard arguments.count == 1, let path = arguments.first, path.isEmpty == false else {
            return Outcome(exitCode: 2, stdout: Data(), stderr: "usage\n")
        }
        do {
            let result = try PageTextExtractor.extract(fileAt: URL(fileURLWithPath: path))
            var json = try encode(result)
            json.append(0x0A)
            return Outcome(exitCode: 0, stdout: json, stderr: "")
        } catch let error as ExtractionError {
            return Outcome(exitCode: error.exitCode, stdout: Data(), stderr: error.code + "\n")
        } catch {
            return Outcome(exitCode: 1, stdout: Data(), stderr: "internal\n")
        }
    }

    /// Encodes a result as compact JSON with keys in a stable order.
    public static func encode(_ result: ExtractionResult) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(result)
    }
}
