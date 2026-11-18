// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
@testable import LegallasCore
@testable import Legallas

@Suite("ExportLogic")
struct ExportLogicTests {

    static func makeCase() -> CaseExportDTO.CaseDTO {
        .init(
            name: "Doe v. Harbor Labs, Inc.",
            caseNumber: "2012-CV-0417",
            court: "Example County District",
            judge: "Smith",
            courtroom: "5A",
            filingDate: Date(timeIntervalSince1970: 1_356_998_400)
        )
    }

    static func makeEmptyDTO() -> CaseExportDTO {
        CaseExportDTO(
            exportedAt: Date(timeIntervalSince1970: 1_356_998_400),
            case: makeCase(),
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

    static func makeFullDTO() -> CaseExportDTO {
        let filed = Date(timeIntervalSince1970: 1_356_998_400)
        return CaseExportDTO(
            exportedAt: filed,
            case: makeCase(),
            parties: [
                .init(name: "Jane Doe", role: .plaintiff, organization: nil, email: "jane@example.com", phone: nil)
            ],
            tasks: [
                .init(title: "Draft motion", details: "Due next week", status: .inProgress, priority: .high, dueDate: filed, source: .user)
            ],
            deadlines: [
                .init(title: "Answer due", anchor: .service, offsetDays: 21, direction: .after, computedDate: filed, isSatisfied: false, ruleCitation: "CRCP 12")
            ],
            claims: [
                .init(type: .breachContract, customLabel: nil, elements: "agreement, performance, breach, damages", isTrebleable: true, isSurvivingSummaryJudgment: true, statuteOfLimitations: filed)
            ],
            notes: [],
            events: [
                .init(title: "Complaint filed", date: filed, type: .pleading, summary: "Jane Doe files suit", source: .user, documentTitles: [], contactNames: [], noteTitles: [])
            ],
            damagesScenarios: [
                .init(
                    name: "Base case",
                    tier: .base,
                    startingAUM: 100_000_000,
                    annualGrowthRate: 0.12,
                    managementFeeRate: 0.02,
                    claimantFeeShare: 0.25,
                    carryRate: 0.20,
                    partnerAllocation: 0.70,
                    claimantCarryShare: 0.25,
                    discountRate: 0.08,
                    horizonYears: 10,
                    terminalGrowthRate: 0.03,
                    lostDistributions: 250_000,
                    governancePremium: 500_000,
                    cachedNPV: 1_234_567,
                    cachedTrebledNPV: 3_703_701,
                    computedAt: filed
                )
            ],
            settlementOffers: [],
            discoveryItems: [
                .init(
                    category: .interrogatories,
                    direction: .propounded,
                    setNumber: 1,
                    itemNumber: 3,
                    subject: "Identify the driver on the July 9 delivery",
                    servedAt: filed,
                    dueAt: filed,
                    status: .outstanding,
                    responseText: "",
                    notes: "",
                    linkedDocumentTitles: [],
                    linkedContactNames: []
                )
            ],
            motions: [
                .init(title: "MTD Count II", motionType: .dismiss, filedBy: .opponent, filedAt: filed, responseDueAt: nil, replyDueAt: nil, hearingAt: nil, status: .pending, ruling: "", notes: "", linkedDocumentTitles: [])
            ]
        )
    }

    @Test("sections appear in the documented order when populated")
    func sectionOrder() {
        let md = ExportLogic.buildMarkdown(from: Self.makeFullDTO())
        let expected = [
            "## Case",
            "## Chronology",
            "## Claims",
            "## Damages",
            "## Discovery",
            "## Motions",
            "## Contacts",
            "## Tasks",
            "## Deadlines"
        ]
        var lastIndex = -1
        for heading in expected {
            guard let idx = md.range(of: heading)?.lowerBound else {
                Issue.record("missing section: \(heading)")
                continue
            }
            let position = md.distance(from: md.startIndex, to: idx)
            #expect(position > lastIndex, "\(heading) out of order")
            lastIndex = position
        }
    }

    @Test("empty collections produce no section heading")
    func emptyOmission() {
        let md = ExportLogic.buildMarkdown(from: Self.makeEmptyDTO())
        #expect(md.contains("## Case"))
        #expect(!md.contains("## Chronology"))
        #expect(!md.contains("## Claims"))
        #expect(!md.contains("## Damages"))
        #expect(!md.contains("## Discovery"))
        #expect(!md.contains("## Motions"))
        #expect(!md.contains("## Contacts"))
        #expect(!md.contains("## Tasks"))
        #expect(!md.contains("## Deadlines"))
        #expect(!md.contains("## Notes"))
        #expect(!md.contains("## Settlement Offers"))
    }

    @Test("damages rows format monetary values as USD currency")
    func damagesCurrency() {
        let md = ExportLogic.buildMarkdown(from: Self.makeFullDTO())
        #expect(md.contains("$1,234,567"))
        #expect(md.contains("$3,703,701"))
    }

    @Test("discovery rows use the shortLabel / set / item convention")
    func discoveryHeadline() {
        let md = ExportLogic.buildMarkdown(from: Self.makeFullDTO())
        #expect(md.contains("ROG Set 1 #3"))
    }

    @Test("case section always emits name, case number, court, and filing date")
    func caseSection() {
        let md = ExportLogic.buildMarkdown(from: Self.makeEmptyDTO())
        #expect(md.contains("# Doe v. Harbor Labs, Inc."))
        #expect(md.contains("2012-CV-0417"))
        #expect(md.contains("Example County District"))
        #expect(md.contains("Courtroom 5A"))
    }

    @Test("motion section splits into Ours and Theirs subsections")
    func motionPartitioning() {
        var dto = Self.makeEmptyDTO()
        let filed = Date(timeIntervalSince1970: 1_356_998_400)
        dto.motions = [
            .init(title: "Our MTD", motionType: .dismiss, filedBy: .us, filedAt: filed, responseDueAt: nil, replyDueAt: nil, hearingAt: nil, status: .pending, ruling: "", notes: "", linkedDocumentTitles: []),
            .init(title: "Their MSJ", motionType: .summaryJudgment, filedBy: .opponent, filedAt: filed, responseDueAt: nil, replyDueAt: nil, hearingAt: nil, status: .pending, ruling: "", notes: "", linkedDocumentTitles: [])
        ]
        let md = ExportLogic.buildMarkdown(from: dto)
        #expect(md.contains("### Ours"))
        #expect(md.contains("### Theirs"))
        guard let oursRange = md.range(of: "### Ours"),
              let theirsRange = md.range(of: "### Theirs") else {
            Issue.record("expected Ours and Theirs subsections")
            return
        }
        #expect(oursRange.lowerBound < theirsRange.lowerBound)
    }

    @Test("timestampedFileName composes prefix, formatted timestamp, and extension")
    func timestampedFilename() {
        let fixed = Date(timeIntervalSince1970: 1_356_998_400)
        let name = ExportLogic.timestampedFileName(prefix: "legallas-export", ext: "md", now: fixed)
        #expect(name.hasPrefix("legallas-export-"))
        #expect(name.hasSuffix(".md"))
        let stem = name.replacingOccurrences(of: "legallas-export-", with: "").replacingOccurrences(of: ".md", with: "")
        #expect(stem.count == "yyyyMMdd-HHmmss".count)
    }
}
