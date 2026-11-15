// SPDX-License-Identifier: Apache-2.0
import Foundation

/// Creates and resolves file bookmarks, and runs code with access to a security-scoped file.
public enum BookmarkResolver {

    /// A resolved bookmark: the file location and whether the bookmark is stale.
    public struct Resolved: Sendable {
        /// Location the bookmark points to.
        public let url: URL
        /// Whether the system reports the bookmark as stale and due to be recreated.
        public let isStale: Bool
    }

    // macOS asks for security scope explicitly; on iOS it is unavailable because a
    // bookmark to a file the user picked carries that access implicitly.
    #if os(macOS)
    private static let creationOptions: URL.BookmarkCreationOptions = [.withSecurityScope]
    private static let resolutionOptions: URL.BookmarkResolutionOptions = [.withSecurityScope]
    #else
    private static let creationOptions: URL.BookmarkCreationOptions = []
    private static let resolutionOptions: URL.BookmarkResolutionOptions = []
    #endif

    /// Creates bookmark data for a file URL; on macOS the bookmark carries security scope.
    public static func makeBookmark(for url: URL) throws -> Data {
        try url.bookmarkData(
            options: creationOptions,
            includingResourceValuesForKeys: nil,
            relativeTo: nil
        )
    }

    /// Resolves bookmark data to a URL and reports whether the bookmark is stale.
    public static func resolve(_ data: Data) throws -> Resolved {
        var stale = false
        let resolved = try URL(
            resolvingBookmarkData: data,
            options: resolutionOptions,
            relativeTo: nil,
            bookmarkDataIsStale: &stale
        )
        return Resolved(url: resolved, isStale: stale)
    }

    /// Runs the body while access to the security-scoped URL is open, then closes that access.
    @discardableResult
    public static func withSecurityScope<T>(url: URL, body: (URL) throws -> T) rethrows -> T {
        let started = url.startAccessingSecurityScopedResource()
        defer { if started { url.stopAccessingSecurityScopedResource() } }
        return try body(url)
    }
}
