// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import LegallasMCP

@Suite("CaseSummaryFiling")
struct CaseSummaryFilingTests {

    /// Runs `legallas_get_case_summary` over a fresh in-memory store and returns its `case` object.
    @MainActor
    static func summaryCase(seed: (ModelContext) throws -> Void) throws -> [String: Any] {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let modelContext = ModelContext(container)
        try seed(modelContext)

        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: tmp) }
        let ctx = MCPExecutionContext(modelContext: modelContext, inboxPaths: InboxPaths(documentsFolder: tmp))

        let text = try CaseSummaryTool().execute(params: nil, context: ctx)
        let obj = try #require(try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any])
        return try #require(obj["case"] as? [String: Any])
    }

    @MainActor
    @Test("legallas_get_case_summary names the seeded matter and reports filingDate null")
    func seededMatterIsNotFiled() throws {
        let kase = try Self.summaryCase { try Seeding.seedIfNeeded($0, with: .sample) }
        #expect(kase["name"] as? String == "Doe v. Harbor Labs, Inc.")
        #expect(kase["caseNumber"] as? String == "Not yet filed")
        #expect(kase["filingDate"] is NSNull)
    }

    @MainActor
    @Test("legallas_get_case_summary reports a filed case's date as an ISO day")
    func filedCaseHasISODate() throws {
        let kase = try Self.summaryCase { ctx in
            ctx.insert(Case(name: "Filed matter", caseNumber: "X", court: "C", judge: "J", filingDate: SeedMatter.fixtureDate))
            try ctx.save()
        }
        #expect(kase["filingDate"] as? String == Formatters.isoDate.string(from: SeedMatter.fixtureDate))
    }
}
