// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore

@Suite("CaseExporter")
struct CaseExporterTests {

    @MainActor
    static func makeContext() throws -> ModelContext {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let ctx = ModelContext(container)
        try Seeding.seedIfNeeded(ctx, with: .sample)
        return ctx
    }

    @MainActor
    @Test("Export includes damages scenarios with every scalar field")
    func exportDamagesScenarios() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let scenario = DamagesScenario(
            name: "Base scenario",
            tier: .base,
            startingAUM: 100_000_000,
            annualGrowthRate: 0.05,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.10,
            horizonYears: 10,
            terminalGrowthRate: 0.03,
            lostDistributions: 250_000,
            governancePremium: 100_000
        )
        scenario.cachedNPV = 15_000_000
        scenario.cachedTrebledNPV = 45_000_000
        scenario.computedAt = Date()
        ctx.insert(scenario)
        kase.damagesScenarios.append(scenario)
        try ctx.save()

        let dto = try CaseExporter.export(from: ctx)
        #expect(dto.damagesScenarios.count == 1)
        let exported = dto.damagesScenarios[0]
        #expect(exported.name == "Base scenario")
        #expect(exported.tier == .base)
        #expect(exported.startingAUM == 100_000_000)
        #expect(exported.cachedNPV == 15_000_000)
        #expect(exported.cachedTrebledNPV == 45_000_000)
        #expect(exported.computedAt != nil)
    }

    @MainActor
    @Test("Export includes settlement offers with covenants and score markdown")
    func exportSettlementOffers() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let offer = SettlementOffer(
            receivedAt: Date(),
            fromParty: "Roe",
            totalAmount: 3_000_000,
            cashAtClose: 2_000_000,
            installmentAmount: 250_000,
            installmentYears: 4,
            restrictiveCovenants: ["non-disparagement", "exclusive-supply"],
            contingencies: ["insurer approval"]
        )
        offer.scoreSummaryMarkdown = "## Settlement Score\nRatio: 0.3"
        ctx.insert(offer)
        kase.settlementOffers.append(offer)
        try ctx.save()

        let dto = try CaseExporter.export(from: ctx)
        #expect(dto.settlementOffers.count == 1)
        let exported = dto.settlementOffers[0]
        #expect(exported.fromParty == "Roe")
        #expect(exported.restrictiveCovenants == ["non-disparagement", "exclusive-supply"])
        #expect(exported.contingencies == ["insurer approval"])
        #expect(exported.installmentYears == 4)
        #expect(exported.scoreSummaryMarkdown?.contains("Settlement Score") == true)
    }

    @MainActor
    @Test("Export includes chronology events with linked document and contact names")
    func exportChronologyEvents() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!
        let plaintiff = kase.parties.first { $0.role == .plaintiff }!

        let doc = Document(
            title: "Complaint",
            originalFilename: "complaint.pdf",
            bookmarkData: Data(),
            lastKnownPath: "/tmp/complaint.pdf"
        )
        ctx.insert(doc)
        kase.documents.append(doc)

        let event = ChronologyEvent(
            title: "Complaint filed",
            date: SeedMatter.fixtureDate,
            type: .filing,
            summary: "Jane Doe sues Harbor Labs, Inc. over the stock agreement.",
            source: .user
        )
        ctx.insert(event)
        kase.events.append(event)
        event.documents.append(doc)
        event.contacts.append(plaintiff)
        try ctx.save()

        let dto = try CaseExporter.export(from: ctx)
        #expect(dto.events.count == 1)
        let exported = dto.events[0]
        #expect(exported.title == "Complaint filed")
        #expect(exported.type == .filing)
        #expect(exported.documentTitles == ["Complaint"])
        #expect(exported.contactNames == ["Jane Doe"])
    }

    @MainActor
    @Test("Round-trip encode/decode preserves all Phase 3 fields")
    func roundTrip() throws {
        let ctx = try Self.makeContext()
        let kase = try ctx.fetch(FetchDescriptor<Case>()).first!

        let scenario = DamagesScenario(
            name: "Base",
            tier: .base,
            startingAUM: 100_000_000,
            annualGrowthRate: 0.05,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.1,
            horizonYears: 5,
            terminalGrowthRate: 0.02
        )
        ctx.insert(scenario)
        kase.damagesScenarios.append(scenario)

        let offer = SettlementOffer(
            receivedAt: SeedMatter.fixtureDate,
            fromParty: "Moe",
            totalAmount: 1_500_000,
            cashAtClose: 1_500_000
        )
        ctx.insert(offer)
        kase.settlementOffers.append(offer)

        let event = ChronologyEvent(
            title: "Service complete",
            date: SeedMatter.fixtureDate,
            type: .service,
            summary: "Summons left with the manager of the Copperline Cafe.",
            source: .user
        )
        ctx.insert(event)
        kase.events.append(event)
        try ctx.save()

        let dto = try CaseExporter.export(from: ctx)
        let data = try CaseExporter.encode(dto)

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(CaseExportDTO.self, from: data)

        #expect(decoded.damagesScenarios.count == 1)
        #expect(decoded.settlementOffers.count == 1)
        #expect(decoded.events.count == 1)
        #expect(decoded.damagesScenarios[0].name == "Base")
        #expect(decoded.settlementOffers[0].fromParty == "Moe")
        #expect(decoded.events[0].title == "Service complete")

        let jsonString = String(decoding: data, as: UTF8.self)
        #expect(jsonString.contains("\"damagesScenarios\""))
        #expect(jsonString.contains("\"settlementOffers\""))
        #expect(jsonString.contains("\"events\""))
    }
}
