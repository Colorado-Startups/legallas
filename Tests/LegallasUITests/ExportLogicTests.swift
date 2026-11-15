// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("ExportLogic")
struct ExportLogicTests {

    static func makeMinimalDTO(
        caseName: String = "Doe v. Harbor Labs, Inc.",
        caseNumber: String = "2012-CV-0417"
    ) -> CaseExportDTO {
        let caseDTO = CaseExportDTO.CaseDTO(
            name: caseName,
            caseNumber: caseNumber,
            court: "District Court",
            judge: "Hon. Test Judge",
            courtroom: "4B",
            filingDate: Date(timeIntervalSince1970: 1_351_000_000)
        )
        return CaseExportDTO(
            exportedAt: Date(),
            case: caseDTO,
            parties: [],
            tasks: [],
            deadlines: [],
            claims: [],
            notes: [],
            events: [],
            damagesScenarios: [],
            settlementOffers: [],
            discoveryItems: [],
            motions: []
        )
    }

    @Test("buildMarkdown begins with case name as H1 header")
    func markdownStartsWithCaseName() {
        let dto = Self.makeMinimalDTO(caseName: "Doe v. Harbor Labs, Inc.")
        let output = ExportLogic.buildMarkdown(from: dto)
        #expect(output.hasPrefix("# Doe v. Harbor Labs, Inc."))
    }

    @Test("buildMarkdown includes case number in output")
    func markdownIncludesCaseNumber() {
        let dto = Self.makeMinimalDTO(caseNumber: "2012-CV-0417")
        let output = ExportLogic.buildMarkdown(from: dto)
        #expect(output.contains("2012-CV-0417"))
    }

    @Test("buildMarkdown output ends with a newline")
    func markdownEndsWithNewline() {
        let dto = Self.makeMinimalDTO()
        let output = ExportLogic.buildMarkdown(from: dto)
        #expect(output.hasSuffix("\n"))
    }

    @Test("buildMarkdown omits empty sections")
    func emptySectionsOmitted() {
        let dto = Self.makeMinimalDTO()
        let output = ExportLogic.buildMarkdown(from: dto)
        #expect(!output.contains("## Chronology"))
        #expect(!output.contains("## Claims"))
        #expect(!output.contains("## Damages"))
    }
}
