// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasMCP

@Suite("MCPProtocol")
struct MCPProtocolTests {

    @Test("Parse request with int id")
    func parseRequestIntID() throws {
        let json = #"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#
        let req = try JSONRPC.parseRequest(Data(json.utf8))
        #expect(req.method == "tools/list")
        #expect(req.id == .int(7))
        #expect(req.isNotification == false)
    }

    @Test("Parse request with string id")
    func parseRequestStringID() throws {
        let json = #"{"jsonrpc":"2.0","id":"abc-123","method":"initialize"}"#
        let req = try JSONRPC.parseRequest(Data(json.utf8))
        #expect(req.id == .string("abc-123"))
    }

    @Test("Parse notification with no id")
    func parseNotification() throws {
        let json = #"{"jsonrpc":"2.0","method":"notifications/initialized"}"#
        let req = try JSONRPC.parseRequest(Data(json.utf8))
        #expect(req.id == nil)
        #expect(req.isNotification)
    }

    @Test("Parse request with params captures raw JSON")
    func parseRequestWithParams() throws {
        let json = #"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x","arguments":{"status":"toDo"}}}"#
        let req = try JSONRPC.parseRequest(Data(json.utf8))
        #expect(req.params != nil)
        let top = try JSONSerialization.jsonObject(with: req.params!.data) as? [String: Any]
        #expect(top?["name"] as? String == "x")
    }

    @Test("Missing method throws invalid request")
    func missingMethodThrows() {
        let json = #"{"jsonrpc":"2.0","id":1}"#
        #expect(throws: JSONRPCError.self) {
            _ = try JSONRPC.parseRequest(Data(json.utf8))
        }
    }

    @Test("Parsing non-JSON throws parse error")
    func nonJSONThrows() {
        let junk = Data("hello world".utf8)
        #expect(throws: (any Error).self) {
            _ = try JSONRPC.parseRequest(junk)
        }
    }

    @Test("Success response contains result and id")
    func successResponseEncoding() throws {
        let data = JSONRPC.successResponse(id: .int(1), result: ["ok": true])
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        #expect(obj["jsonrpc"] as? String == "2.0")
        #expect((obj["id"] as? Int) == 1)
        #expect(((obj["result"] as? [String: Any])?["ok"] as? Bool) == true)
    }

    @Test("Error response contains error.code and error.message")
    func errorResponseEncoding() throws {
        let data = JSONRPC.errorResponse(id: .int(2), error: .methodNotFound)
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let err = obj["error"] as! [String: Any]
        #expect(err["code"] as? Int == -32601)
        #expect(err["message"] as? String == "Method not found")
    }
}
