// SPDX-License-Identifier: Apache-2.0
import Darwin
import Foundation
import LegallasExtraction

// LegallasExtract <file>
// Prints one JSON object to stdout: {"pageCount", "pages": [{"n", "ocr", "text"}], "sha256"}.
// Exit codes: 0 ok, 1 OCR failure, 2 unreadable or unsupported, 3 encrypted.
// stderr only ever carries a short error code; document text goes nowhere but stdout.

// System frameworks (CoreGraphics PDF, Vision) log diagnostics to stderr on their own.
// Keep the real stderr for our error code and point fd 2 at /dev/null while working.
let errorDescriptor = dup(STDERR_FILENO)
let devNull = open("/dev/null", O_WRONLY)
if errorDescriptor >= 0, devNull >= 0 {
    dup2(devNull, STDERR_FILENO)
}
if devNull >= 0 {
    close(devNull)
}
let errorOutput = errorDescriptor >= 0
    ? FileHandle(fileDescriptor: errorDescriptor, closeOnDealloc: false)
    : FileHandle.standardError

let outcome = ExtractCommand.run(arguments: Array(CommandLine.arguments.dropFirst()))
do {
    // Each stream is empty when it has nothing to say, so both writes are unconditional.
    try FileHandle.standardOutput.write(contentsOf: outcome.stdout)
    try errorOutput.write(contentsOf: Data(outcome.stderr.utf8))
} catch {
    // A closed pipe means the caller did not get the JSON; report failure.
    exit(1)
}
exit(outcome.exitCode)
