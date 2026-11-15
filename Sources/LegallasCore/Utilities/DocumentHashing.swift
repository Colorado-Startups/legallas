// SPDX-License-Identifier: Apache-2.0
import Foundation
import CryptoKit

/// Computes SHA-256 hashes of document contents.
public enum DocumentHashing {

    /// Returns the SHA-256 hash of the data as lowercase hex.
    public static func sha256Hex(of data: Data) -> String {
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Returns the SHA-256 hash of a file as lowercase hex, reading it in chunks of the given size.
    public static func sha256Hex(ofFileAt url: URL, chunkSize: Int = 1 << 20) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while true {
            let chunk: Data
            do {
                chunk = try handle.read(upToCount: chunkSize) ?? Data()
            } catch {
                throw error
            }
            if chunk.isEmpty { break }
            hasher.update(data: chunk)
        }
        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
