// SPDX-License-Identifier: Apache-2.0
import Foundation
import Testing
import SwiftData
@testable import LegallasCore
@testable import LegallasMCP

@Suite("MCPTools")
struct ToolDispatchTests {

    @MainActor
    static func makeContext() throws -> (MCPExecutionContext, URL) {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let modelContext = ModelContext(container)
        try Seeding.seedIfNeeded(modelContext, with: .sample)

        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        let paths = InboxPaths(documentsFolder: tmp)
        try paths.ensureDirectoriesExist()

        return (MCPExecutionContext(modelContext: modelContext, inboxPaths: paths), tmp)
    }

    @MainActor
    @Test("legallas_get_case_summary returns valid JSON containing case metadata")
    func caseSummary() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = CaseSummaryTool()
        let text = try tool.execute(params: nil, context: ctx)
        let data = Data(text.utf8)
        let obj = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let kase = obj["case"] as? [String: Any]
        #expect(kase?["caseNumber"] as? String == SeedMatter.sample.caseNumber)
        #expect(kase?["judge"] as? String == SeedMatter.sample.judge)
    }

    @MainActor
    @Test("legallas_propose_task writes a pending JSON file")
    func proposeTaskWritesFile() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ProposeTaskTool()
        let argsJSON = #"{"title":"Draft motion to compel","priority":"high","rationale":"missing discovery responses"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        #expect(text.contains("Pending at"))

        let pendingFiles = try FileManager.default.contentsOfDirectory(
            at: ctx.inboxPaths.pending,
            includingPropertiesForKeys: nil
        )
        #expect(pendingFiles.count == 1)

        let data = try Data(contentsOf: pendingFiles[0])
        let envelope = try ProposalCodec.decode(data)
        #expect(envelope.type == .task)
        if case .task(let payload) = envelope.payload {
            #expect(payload.title == "Draft motion to compel")
            #expect(payload.priority == .high)
        } else {
            Issue.record("Expected task payload")
        }
    }

    @MainActor
    @Test("legallas_propose_task rejects missing title")
    func proposeTaskRejectsMissingTitle() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ProposeTaskTool()
        let bad = #"{"priority":"high"}"#
        #expect(throws: (any Error).self) {
            _ = try tool.execute(params: RawJSON(Data(bad.utf8)), context: ctx)
        }
    }

    @MainActor
    @Test("legallas_list_tasks returns an empty array for a fresh case")
    func listTasksEmpty() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ListTasksTool()
        let text = try tool.execute(params: nil, context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any]
        #expect(arr?.isEmpty == true)
    }

    @MainActor
    @Test("legallas_list_contacts returns seeded contacts filtered by role")
    func listContactsByRole() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ListContactsTool()
        let argsJSON = #"{"role":"defendant"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]]
        #expect(arr?.count == 2)
        let names = Set(arr?.compactMap { $0["name"] as? String } ?? [])
        #expect(names.contains("Richard Roe"))
        #expect(names.contains("Mark Moe"))
    }

    @MainActor
    @Test("legallas_list_documents returns an empty array for a fresh case")
    func listDocumentsEmpty() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ListDocumentsTool()
        let text = try tool.execute(params: nil, context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any]
        #expect(arr?.isEmpty == true)
    }

    @MainActor
    @Test("legallas_search_documents returns snippets for matching content")
    func searchDocumentsFindsHit() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let doc = Document(
            title: "Discovery response",
            originalFilename: "discovery.pdf",
            bookmarkData: Data([0x01]),
            lastKnownPath: "/tmp/discovery.pdf",
            tags: ["discovery"]
        )
        doc.fullTextContent = "Plaintiff's first set of requests: NOTICE failure on May 9 alleged."
        ctx.modelContext.insert(doc)
        try ctx.modelContext.save()

        let tool = SearchDocumentsTool()
        let argsJSON = #"{"query":"notice"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]]
        #expect(arr?.count == 1)
        #expect(arr?[0]["title"] as? String == "Discovery response")
        let snippet = arr?[0]["snippet"] as? String ?? ""
        #expect(snippet.lowercased().contains("notice"))
    }

    @MainActor
    @Test("legallas_get_document_text returns full text by title")
    func getDocumentTextByTitle() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let doc = Document(
            title: "Expert report",
            originalFilename: "expert.pdf",
            bookmarkData: Data([0x02]),
            lastKnownPath: "/tmp/expert.pdf"
        )
        doc.fullTextContent = "Opinion: ruined stock valued at $84,231.50 based on the May 2 inventory."
        doc.pageCount = 12
        doc.sha256 = "abc123"
        ctx.modelContext.insert(doc)
        try ctx.modelContext.save()

        let tool = GetDocumentTextTool()
        let argsJSON = #"{"title":"expert"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        let obj = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        #expect(obj?["title"] as? String == "Expert report")
        #expect((obj?["fullTextContent"] as? String)?.contains("$84,231.50") == true)
        #expect(obj?["pageCount"] as? Int == 12)
    }

    @MainActor
    @Test("legallas_get_document_text rejects zero- and both-arg forms")
    func getDocumentTextValidation() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = GetDocumentTextTool()
        #expect(throws: (any Error).self) {
            _ = try tool.execute(params: RawJSON(Data("{}".utf8)), context: ctx)
        }
        let both = #"{"title":"x","sha256":"y"}"#
        #expect(throws: (any Error).self) {
            _ = try tool.execute(params: RawJSON(Data(both.utf8)), context: ctx)
        }
    }

    @MainActor
    @Test("legallas_propose_event writes an event envelope to the inbox")
    func proposeEventWritesFile() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ProposeEventTool()
        let argsJSON = #"{"title":"Summons delivered to Harbor Labs","date":"2012-12-28T12:00:00Z","type":"service","summary":"Summons handed to the Harbor Labs corporate secretary."}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        #expect(text.contains("Pending at"))

        let files = try FileManager.default.contentsOfDirectory(
            at: ctx.inboxPaths.pending,
            includingPropertiesForKeys: nil
        )
        #expect(files.count == 1)
        let envelope = try ProposalCodec.decode(Data(contentsOf: files[0]))
        #expect(envelope.type == .event)
        if case .event(let payload) = envelope.payload {
            #expect(payload.title == "Summons delivered to Harbor Labs")
            #expect(payload.type == .service)
        } else {
            Issue.record("Expected event payload")
        }
    }

    @MainActor
    @Test("legallas_propose_contact_update rejects unknown field keys")
    func proposeContactUpdateValidation() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ProposeContactUpdateTool()
        let bad = #"{"contactName":"Jane Doe","fields":{"ssn":"123"}}"#
        #expect(throws: (any Error).self) {
            _ = try tool.execute(params: RawJSON(Data(bad.utf8)), context: ctx)
        }

        let good = #"{"contactName":"Jane Doe","fields":{"email":"jane@example.com"}}"#
        let text = try tool.execute(params: RawJSON(Data(good.utf8)), context: ctx)
        #expect(text.contains("Pending at"))

        let files = try FileManager.default.contentsOfDirectory(
            at: ctx.inboxPaths.pending,
            includingPropertiesForKeys: nil
        )
        #expect(files.count == 1)
        let envelope = try ProposalCodec.decode(Data(contentsOf: files[0]))
        #expect(envelope.type == .contactUpdate)
        if case .contactUpdate(let payload) = envelope.payload {
            #expect(payload.contactName == "Jane Doe")
            #expect(payload.fields["email"] == "jane@example.com")
        } else {
            Issue.record("Expected contactUpdate payload")
        }
    }

    @MainActor
    @Test("legallas_list_claims returns seeded breach of contract and unpaid wages claims")
    func listClaims() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ListClaimsTool()
        let text = try tool.execute(params: nil, context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]]
        #expect(arr?.count == 3)
        let types = Set(arr?.compactMap { $0["type"] as? String } ?? [])
        #expect(types.contains("breachContract"))
        #expect(types.contains("custom"))

        let filtered = try tool.execute(params: RawJSON(Data(#"{"type":"breachContract"}"#.utf8)), context: ctx)
        let filteredArr = try JSONSerialization.jsonObject(with: Data(filtered.utf8)) as? [[String: Any]]
        #expect(filteredArr?.count == 2)
        #expect(filteredArr?[0]["type"] as? String == "breachContract")
    }

    @MainActor
    @Test("legallas_list_damages returns scenario with cached NPV as string")
    func listDamagesScenarios() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let scenario = DamagesScenario(
            name: "Base",
            tier: .base,
            startingAUM: 100_000_000,
            annualGrowthRate: 0.0,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.10,
            horizonYears: 5,
            terminalGrowthRate: 0.0
        )
        scenario.cachedNPV = 10_000_000
        scenario.cachedTrebledNPV = 30_000_000
        scenario.computedAt = Date()
        ctx.modelContext.insert(scenario)
        kase.damagesScenarios.append(scenario)
        try ctx.modelContext.save()

        let tool = ListDamagesScenariosTool()
        let text = try tool.execute(params: nil, context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]]
        #expect(arr?.count == 1)
        let first = arr?[0]
        #expect(first?["name"] as? String == "Base")
        #expect(first?["tier"] as? String == "base")
        #expect(first?["cachedNPV"] as? String == "10000000")
    }

    @MainActor
    @Test("legallas_list_settlement_offers returns offer with covenants array")
    func listSettlementOffers() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let offer = SettlementOffer(
            receivedAt: Date(),
            fromParty: "Roe",
            totalAmount: 2_500_000,
            cashAtClose: 2_000_000,
            installmentAmount: 125_000,
            installmentYears: 4,
            restrictiveCovenants: ["non-disparagement"],
            contingencies: []
        )
        offer.scoreSummaryMarkdown = "## Score\nratio: 0.4"
        ctx.modelContext.insert(offer)
        kase.settlementOffers.append(offer)
        try ctx.modelContext.save()

        let tool = ListSettlementOffersTool()
        let text = try tool.execute(params: nil, context: ctx)
        let arr = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [[String: Any]]
        #expect(arr?.count == 1)
        let first = arr?[0]
        #expect(first?["fromParty"] as? String == "Roe")
        #expect(first?["installmentYears"] as? Int == 4)
        let covs = first?["restrictiveCovenants"] as? [String]
        #expect(covs == ["non-disparagement"])
    }

    @MainActor
    @Test("legallas_list_events filters by type and date range")
    func listEvents() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let filing = ChronologyEvent(title: "Complaint filed", date: SeedMatter.fixtureDate, type: .filing)
        let meeting = ChronologyEvent(title: "Board walkthrough", date: SeedMatter.fixtureDate.addingTimeInterval(86_400 * 30), type: .meeting)
        ctx.modelContext.insert(filing)
        ctx.modelContext.insert(meeting)
        kase.events.append(filing)
        kase.events.append(meeting)
        try ctx.modelContext.save()

        let tool = ListEventsTool()
        let all = try tool.execute(params: nil, context: ctx)
        let allArr = try JSONSerialization.jsonObject(with: Data(all.utf8)) as? [[String: Any]]
        #expect(allArr?.count == 2)

        let filtered = try tool.execute(params: RawJSON(Data(#"{"type":"filing"}"#.utf8)), context: ctx)
        let filteredArr = try JSONSerialization.jsonObject(with: Data(filtered.utf8)) as? [[String: Any]]
        #expect(filteredArr?.count == 1)
        #expect(filteredArr?[0]["title"] as? String == "Complaint filed")
    }

    @MainActor
    @Test("legallas_compute_damages returns waterfall with per-year rows and NPV")
    func computeDamages() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let scenario = DamagesScenario(
            name: "Hand-verifiable",
            tier: .base,
            startingAUM: 100_000_000,
            annualGrowthRate: 0.0,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.10,
            horizonYears: 5,
            terminalGrowthRate: 0.0
        )
        ctx.modelContext.insert(scenario)
        kase.damagesScenarios.append(scenario)
        try ctx.modelContext.save()

        let tool = ComputeDamagesTool()
        let text = try tool.execute(params: RawJSON(Data(#"{"name":"Hand-verifiable"}"#.utf8)), context: ctx)
        let obj = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        #expect(obj?["scenarioName"] as? String == "Hand-verifiable")
        let perYear = obj?["perYear"] as? [[String: Any]]
        #expect(perYear?.count == 5)

        #expect(throws: (any Error).self) {
            _ = try tool.execute(params: RawJSON(Data(#"{"name":"Nope"}"#.utf8)), context: ctx)
        }
    }

    @MainActor
    @Test("legallas_score_offer returns ratios and markdown for a known offer")
    func scoreOffer() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let scenario = DamagesScenario(
            name: "Base",
            tier: .base,
            startingAUM: 100_000_000,
            annualGrowthRate: 0.0,
            managementFeeRate: 0.02,
            claimantFeeShare: 0.5,
            carryRate: 0.2,
            partnerAllocation: 1.0,
            claimantCarryShare: 0.5,
            discountRate: 0.10,
            horizonYears: 5,
            terminalGrowthRate: 0.0
        )
        ctx.modelContext.insert(scenario)
        kase.damagesScenarios.append(scenario)

        let offer = SettlementOffer(
            receivedAt: SeedMatter.fixtureDate,
            fromParty: "Roe",
            totalAmount: 5_000_000,
            cashAtClose: 5_000_000
        )
        ctx.modelContext.insert(offer)
        kase.settlementOffers.append(offer)
        try ctx.modelContext.save()

        let tool = ScoreOfferTool()
        let iso = Formatters.isoDate.string(from: SeedMatter.fixtureDate)
        let argsJSON = #"{"fromParty":"Roe","receivedAt":"\#(iso)"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        let obj = try JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any]
        #expect(obj?["fromParty"] as? String == "Roe")
        #expect(obj?["baseScenario"] as? String == "Base")
        let md = obj?["rationaleMarkdown"] as? String
        #expect(md?.contains("Settlement Score") == true)
    }

    @MainActor
    @Test("MCPServer dispatches tools/list and tools/call")
    func mcpServerDispatch() throws {
        let container = try ModelContainerFactory.makeInMemoryContainer()
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-tests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }

        // Seed via the container's main context.
        let mainContext = ModelContext(container)
        try Seeding.seedIfNeeded(mainContext, with: .sample)
        let serverContext = ServerContext(
            storeURL: URL(fileURLWithPath: "/dev/null"),
            inboxPaths: InboxPaths(documentsFolder: tmp)
        )
        let provider = ContainerProvider(serverContext: serverContext, container: container)
        let server = MCPServer(provider: provider)
        server.register(CaseSummaryTool())
        server.register(ListTasksTool())

        let listReq = #"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#
        let listResp = server.handleRequest(try JSONRPC.parseRequest(Data(listReq.utf8)))!
        let listObj = try JSONSerialization.jsonObject(with: listResp) as! [String: Any]
        let tools = ((listObj["result"] as? [String: Any])?["tools"] as? [[String: Any]]) ?? []
        let names = tools.compactMap { $0["name"] as? String }.sorted()
        #expect(names.contains("legallas_get_case_summary"))
        #expect(names.contains("legallas_list_tasks"))

        let callReq = #"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"legallas_get_case_summary","arguments":{}}}"#
        let callResp = server.handleRequest(try JSONRPC.parseRequest(Data(callReq.utf8)))!
        let callObj = try JSONSerialization.jsonObject(with: callResp) as! [String: Any]
        let content = ((callObj["result"] as? [String: Any])?["content"] as? [[String: Any]]) ?? []
        #expect(!content.isEmpty)
        #expect((content[0]["text"] as? String)?.contains(SeedMatter.sample.caseNumber) == true)
    }

    @MainActor
    @Test("legallas_list_discovery returns seeded items and respects category filter")
    func listDiscovery() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let rog = DiscoveryItem(category: .interrogatories, direction: .propounded, setNumber: 1, itemNumber: 3, subject: "Delivery invoices", servedAt: Date())
        let rfp = DiscoveryItem(category: .rfp, direction: .received, setNumber: 1, subject: "RFP from opponent", servedAt: Date(), status: .responded)
        ctx.modelContext.insert(rog)
        ctx.modelContext.insert(rfp)
        kase.discoveryItems.append(rog)
        kase.discoveryItems.append(rfp)
        try ctx.modelContext.save()

        let tool = ListDiscoveryTool()
        let all = try tool.execute(params: nil, context: ctx)
        let allArr = try JSONSerialization.jsonObject(with: Data(all.utf8)) as? [[String: Any]]
        #expect(allArr?.count == 2)

        let filtered = try tool.execute(params: RawJSON(Data(#"{"category":"interrogatories"}"#.utf8)), context: ctx)
        let filteredArr = try JSONSerialization.jsonObject(with: Data(filtered.utf8)) as? [[String: Any]]
        #expect(filteredArr?.count == 1)
        #expect(filteredArr?[0]["subject"] as? String == "Delivery invoices")
        #expect(filteredArr?[0]["itemNumber"] as? Int == 3)

        let receivedOnly = try tool.execute(params: RawJSON(Data(#"{"direction":"received"}"#.utf8)), context: ctx)
        let receivedArr = try JSONSerialization.jsonObject(with: Data(receivedOnly.utf8)) as? [[String: Any]]
        #expect(receivedArr?.count == 1)
        #expect(receivedArr?[0]["status"] as? String == "responded")
    }

    @MainActor
    @Test("legallas_propose_discovery writes a discoveryItem envelope to the inbox")
    func proposeDiscoveryWritesFile() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ProposeDiscoveryTool()
        let argsJSON = #"{"category":"interrogatories","direction":"propounded","setNumber":2,"itemNumber":7,"subject":"Board notice history","servedAt":"2013-05-28T00:00:00Z","dueAt":"2013-06-27T00:00:00Z","status":"outstanding","rationale":"need for the flood claim"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        #expect(text.contains("Pending at"))

        let files = try FileManager.default.contentsOfDirectory(
            at: ctx.inboxPaths.pending,
            includingPropertiesForKeys: nil
        )
        #expect(files.count == 1)
        let envelope = try ProposalCodec.decode(Data(contentsOf: files[0]))
        #expect(envelope.type == .discoveryItem)
        if case .discoveryItem(let payload) = envelope.payload {
            #expect(payload.category == .interrogatories)
            #expect(payload.direction == .propounded)
            #expect(payload.setNumber == 2)
            #expect(payload.itemNumber == 7)
            #expect(payload.subject == "Board notice history")
        } else {
            Issue.record("Expected discoveryItem payload")
        }
    }

    @MainActor
    @Test("legallas_list_motions returns seeded motions and respects filedBy filter")
    func listMotions() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let kase = try ctx.modelContext.fetch(FetchDescriptor<Case>()).first!
        let ours = Motion(title: "MTD", motionType: .dismiss, filedBy: .us, filedAt: Date(), status: .pending)
        let theirs = Motion(title: "MSJ against us", motionType: .summaryJudgment, filedBy: .opponent, filedAt: Date(), status: .denied, ruling: "Denied; delivery times disputed")
        ctx.modelContext.insert(ours)
        ctx.modelContext.insert(theirs)
        kase.motions.append(ours)
        kase.motions.append(theirs)
        try ctx.modelContext.save()

        let tool = ListMotionsTool()
        let all = try tool.execute(params: nil, context: ctx)
        let allArr = try JSONSerialization.jsonObject(with: Data(all.utf8)) as? [[String: Any]]
        #expect(allArr?.count == 2)

        let filtered = try tool.execute(params: RawJSON(Data(#"{"filedBy":"opponent"}"#.utf8)), context: ctx)
        let filteredArr = try JSONSerialization.jsonObject(with: Data(filtered.utf8)) as? [[String: Any]]
        #expect(filteredArr?.count == 1)
        #expect(filteredArr?[0]["title"] as? String == "MSJ against us")
        #expect(filteredArr?[0]["status"] as? String == "denied")
        #expect(filteredArr?[0]["ruling"] as? String == "Denied; delivery times disputed")
    }

    @MainActor
    @Test("legallas_propose_motion writes a motion envelope to the inbox")
    func proposeMotionWritesFile() throws {
        let (ctx, tmp) = try Self.makeContext()
        defer { try? FileManager.default.removeItem(at: tmp) }

        let tool = ProposeMotionTool()
        let argsJSON = #"{"title":"Motion to compel discovery","motionType":"compel","filedBy":"us","filedAt":"2013-07-09T00:00:00Z","responseDueAt":"2013-07-26T00:00:00Z","hearingAt":"2013-08-13T14:30:00Z","status":"pending","rationale":"crew sheets not produced"}"#
        let text = try tool.execute(params: RawJSON(Data(argsJSON.utf8)), context: ctx)
        #expect(text.contains("Pending at"))

        let files = try FileManager.default.contentsOfDirectory(
            at: ctx.inboxPaths.pending,
            includingPropertiesForKeys: nil
        )
        #expect(files.count == 1)
        let envelope = try ProposalCodec.decode(Data(contentsOf: files[0]))
        #expect(envelope.type == .motion)
        if case .motion(let payload) = envelope.payload {
            #expect(payload.title == "Motion to compel discovery")
            #expect(payload.motionType == .compel)
            #expect(payload.filedBy == .us)
            #expect(payload.status == .pending)
            #expect(payload.hearingAt != nil)
        } else {
            Issue.record("Expected motion payload")
        }
    }
}
