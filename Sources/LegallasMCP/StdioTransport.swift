// SPDX-License-Identifier: Apache-2.0
import Foundation

public struct StdioTransport: Sendable {

    public init() {}

    public func readRequest() -> Data? {
        guard let line = readLine(strippingNewline: true) else { return nil }
        guard !line.isEmpty else { return readRequest() }
        return line.data(using: .utf8)
    }

    public func writeResponse(_ data: Data) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    public func logStderr(_ message: String) {
        FileHandle.standardError.write(Data((message + "\n").utf8))
    }
}
