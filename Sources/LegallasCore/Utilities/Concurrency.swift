// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Marker protocol for types that are isolated to the main actor.
@MainActor
public protocol MainActorIsolated {}

/// Holds a value behind a lock so it can be changed from any thread.
public struct ThreadSafeBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    /// Creates a box holding the given value.
    public init(_ value: Value) { self.value = value }

    /// Runs the body with exclusive access to the value, holding the lock while it runs.
    public mutating func withLock<R>(_ body: (inout Value) throws -> R) rethrows -> R {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }
}
