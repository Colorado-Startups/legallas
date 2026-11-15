// SPDX-License-Identifier: Apache-2.0
import Foundation
@testable import LegallasExtraction

/// Runs blocking test work on a dedicated thread instead of a cooperative pool thread.
///
/// Vision's synchronous text recognizer waits internally on Swift concurrency work. When
/// every cooperative pool thread is blocked in a synchronous Vision call, nothing is left
/// to run that work and the test process deadlocks; that happened on a 10-core Mac with
/// about 11 OCR tests running in parallel. Waiting on a subprocess holds a pool thread the
/// same way, shrinking the pool the OCR tests depend on. Any test that OCRs a page or waits
/// on a process goes through here.
///
/// Keep `#expect` and `#require` out of `work`: they report through the current test's task
/// context, which a plain thread does not carry. Return values and check them after the await.
enum OffPool {

    /// Runs `work` on its own thread and resumes with its result or error.
    static func run<T: Sendable>(_ work: @escaping @Sendable () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            Thread {
                continuation.resume(with: Result { try work() })
            }.start()
        }
    }

    /// `PageTextExtractor.extract(fileAt:)` off the cooperative pool.
    static func extract(_ url: URL) async throws -> ExtractionResult {
        try await run { try PageTextExtractor.extract(fileAt: url) }
    }
}
