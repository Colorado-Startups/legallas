// SPDX-License-Identifier: Apache-2.0
import Foundation

public enum JSONRPCID: Sendable, Hashable {
    case int(Int)
    case string(String)

    public var asAny: Any {
        switch self {
        case .int(let i): return i
        case .string(let s): return s
        }
    }
}

public struct RawJSON: Sendable, Equatable {
    public let data: Data
    public init(_ data: Data) { self.data = data }

    public func decode<T: Decodable>(as type: T.Type) throws -> T {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return try d.decode(type, from: data)
    }

    public static func encode<T: Encodable>(_ value: T) throws -> RawJSON {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return RawJSON(try e.encode(value))
    }
}

public struct JSONRPCRequest: Sendable {
    public let jsonrpc: String
    public let id: JSONRPCID?
    public let method: String
    public let params: RawJSON?

    public var isNotification: Bool { id == nil }
}

public struct JSONRPCError: Sendable {
    public let code: Int
    public let message: String
    public let data: RawJSON?

    public static let parseError      = JSONRPCError(code: -32700, message: "Parse error",      data: nil)
    public static let invalidRequest  = JSONRPCError(code: -32600, message: "Invalid request",  data: nil)
    public static let methodNotFound  = JSONRPCError(code: -32601, message: "Method not found", data: nil)
    public static let invalidParams   = JSONRPCError(code: -32602, message: "Invalid params",   data: nil)
    public static let internalError   = JSONRPCError(code: -32603, message: "Internal error",   data: nil)

    public init(code: Int, message: String, data: RawJSON? = nil) {
        self.code = code
        self.message = message
        self.data = data
    }
}

public enum JSONRPC {

    public static func parseRequest(_ data: Data) throws -> JSONRPCRequest {
        guard let top = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw JSONRPCError.parseError.asError
        }
        let method: String = (top["method"] as? String) ?? ""
        guard !method.isEmpty else { throw JSONRPCError.invalidRequest.asError }

        let id: JSONRPCID? = {
            if let i = top["id"] as? Int { return .int(i) }
            if let n = top["id"] as? NSNumber { return .int(n.intValue) }
            if let s = top["id"] as? String { return .string(s) }
            return nil
        }()

        let params: RawJSON? = {
            guard let p = top["params"] else { return nil }
            guard let data = try? JSONSerialization.data(
                withJSONObject: p,
                options: [.sortedKeys]
            ) else { return nil }
            return RawJSON(data)
        }()

        let jsonrpc = top["jsonrpc"] as? String ?? "2.0"
        return JSONRPCRequest(jsonrpc: jsonrpc, id: id, method: method, params: params)
    }

    public static func successResponse(id: JSONRPCID, result: Any) -> Data {
        var obj: [String: Any] = [
            "jsonrpc": "2.0",
            "result": result
        ]
        obj["id"] = id.asAny
        return (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
    }

    public static func errorResponse(id: JSONRPCID?, error: JSONRPCError) -> Data {
        var errObj: [String: Any] = [
            "code": error.code,
            "message": error.message
        ]
        if let data = error.data, let parsed = try? JSONSerialization.jsonObject(with: data.data) {
            errObj["data"] = parsed
        }
        var obj: [String: Any] = [
            "jsonrpc": "2.0",
            "error": errObj
        ]
        obj["id"] = id?.asAny ?? NSNull()
        return (try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])) ?? Data()
    }
}

extension JSONRPCError: Error {
    public var asError: any Error { self }
}
