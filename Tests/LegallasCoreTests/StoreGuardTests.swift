// SPDX-License-Identifier: Apache-2.0
import CoreData
import Foundation
import SwiftData
import Testing
@testable import LegallasCore

// One class per case, each with its own entity name. Each store comes from its class's own model, changed to the shape
// a store would have had before that class's change.

@Model final class GuardPlainItem {
    var title: String = ""
    var share: Double = 0
    init(title: String, share: Double) {
        self.title = title
        self.share = share
    }
}

@Model final class GuardRenamedItem {
    var title: String = ""
    var share: Double = 0
    init(title: String, share: Double) {
        self.title = title
        self.share = share
    }
}

@Model final class GuardAddedItem {
    var title: String = ""
    var share: Double = 0
    var added: Double = 0
    init(title: String, share: Double, added: Double) {
        self.title = title
        self.share = share
        self.added = added
    }
}

@Suite("StoreGuard", .serialized)
struct StoreGuardTests {

    /// `type`'s model with `share` under `storedName`, and without any property named in `missing`.
    private func storeModel(of type: any PersistentModel.Type, storedName: String, missing: Set<String>) throws -> NSManagedObjectModel {
        let model = try #require(NSManagedObjectModel.makeManagedObjectModel(for: [type]))
        let copy = try #require(model.copy() as? NSManagedObjectModel)
        for entity in copy.entities {
            entity.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
            entity.properties.removeAll { missing.contains($0.name) }
            for property in entity.properties where property.name == "share" {
                property.name = storedName
            }
        }
        return copy
    }

    /// A new folder holding a store in that shape, written and closed, with one row in it.
    private func makeStore(of type: any PersistentModel.Type, storedName: String = "share", missing: Set<String> = []) throws -> URL {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-guard-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent("default.store")

        let model = try storeModel(of: type, storedName: storedName, missing: missing)
        let coordinator = NSPersistentStoreCoordinator(managedObjectModel: model)
        let store = try coordinator.addPersistentStore(type: .sqlite, at: url)
        let context = NSManagedObjectContext(.privateQueue)
        context.persistentStoreCoordinator = coordinator
        let entity = try #require(model.entities.first)
        try context.performAndWait {
            let row = NSManagedObject(entity: entity, insertInto: context)
            row.setValue("Invented row", forKey: "title")
            row.setValue(0.25, forKey: storedName)
            try context.save()
        }
        try coordinator.remove(store)
        return url
    }

    /// What the store holds, read with the model it was written with.
    private func storedValues(_ url: URL, of type: any PersistentModel.Type, storedName: String) throws -> [Double] {
        let model = try storeModel(of: type, storedName: storedName, missing: [])
        let coordinator = NSPersistentStoreCoordinator(managedObjectModel: model)
        let store = try coordinator.addPersistentStore(type: .sqlite, at: url, options: [NSReadOnlyPersistentStoreOption: true])
        defer { try? coordinator.remove(store) }
        let context = NSManagedObjectContext(.privateQueue)
        context.persistentStoreCoordinator = coordinator
        let entityName = try #require(model.entities.first?.name)
        return try context.performAndWait {
            try context.fetch(NSFetchRequest<NSManagedObject>(entityName: entityName)).compactMap { $0.value(forKey: storedName) as? Double }
        }
    }

    /// Every file of the store, so "unchanged" covers the write-ahead log too.
    private func storeFiles(_ url: URL) throws -> [String: Data] {
        let dir = url.deletingLastPathComponent()
        var files: [String: Data] = [:]
        for name in try FileManager.default.contentsOfDirectory(atPath: dir.path) where name.hasPrefix(url.lastPathComponent) && !name.hasSuffix("-shm") {
            files[name] = try Data(contentsOf: dir.appendingPathComponent(name))
        }
        return files
    }

    @Test("The one store shape the product has shipped is pinned, so an edit to the models in place fails here")
    func onlyShapeIsPinned() throws {
        // Changing a stored field needs a new VersionedSchema and a stage, not a new value here (REVIEW.md rule 5).
        let model = try #require(NSManagedObjectModel.makeManagedObjectModel(for: LegallasSchemaV1.models))
        #expect(model.versionChecksum == "JgRidv+BG7SmY894kgxst3tjbHVTHnM2E0knlASGo24=")
    }

    @Test("A store that does not exist yet passes")
    func missingStorePasses() throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-guard-missing-\(UUID().uuidString).store")
        try StoreGuard.check(storeURL: url, modelSets: [[GuardRenamedItem.self]])
    }

    @Test("A store in the models' own shape passes")
    func sameShapePasses() throws {
        let url = try makeStore(of: GuardPlainItem.self)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try StoreGuard.check(storeURL: url, modelSets: [[GuardPlainItem.self]])
    }

    @Test("A stored field the models do not name is refused, with the store unchanged")
    func renamedFieldIsRefused() throws {
        let url = try makeStore(of: GuardRenamedItem.self, storedName: "olderShare")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let before = try storeFiles(url)

        #expect(throws: StoreOpenError.unknownShape(path: url.path)) {
            try StoreGuard.check(storeURL: url, modelSets: [[GuardRenamedItem.self]])
        }
        #expect(try storeFiles(url) == before)
        #expect(try storedValues(url, of: GuardRenamedItem.self, storedName: "olderShare") == [0.25])
    }

    @Test("A field added to the models with no schema version is refused too")
    func addedFieldIsRefused() throws {
        let url = try makeStore(of: GuardAddedItem.self, missing: ["added"])
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        #expect(throws: StoreOpenError.unknownShape(path: url.path)) {
            try StoreGuard.check(storeURL: url, modelSets: [[GuardAddedItem.self]])
        }
    }

    @Test("A store passes when any of the given model sets is its shape")
    func anyGivenVersionPasses() throws {
        let url = try makeStore(of: GuardPlainItem.self)
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        try StoreGuard.check(storeURL: url, modelSets: [[GuardRenamedItem.self], [GuardPlainItem.self]])
        #expect(throws: StoreOpenError.unknownShape(path: url.path)) {
            try StoreGuard.check(storeURL: url, modelSets: [[GuardRenamedItem.self]])
        }
    }

    @Test("The app's read-write open refuses a store of another shape, with the store unchanged")
    func readWriteOpenIsGuarded() throws {
        let url = try makeStore(of: GuardRenamedItem.self, storedName: "olderShare")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        let before = try storeFiles(url)

        #expect(throws: StoreOpenError.unknownShape(path: url.path)) {
            _ = try ModelContainerFactory.makeReadWriteContainer(storeURL: url)
        }
        #expect(try storeFiles(url) == before)
        #expect(try storedValues(url, of: GuardRenamedItem.self, storedName: "olderShare") == [0.25])
    }

    @Test("The MCP server's read-only open of a store of another shape fails, with the values kept")
    func readOnlyOpenFails() throws {
        let url = try makeStore(of: GuardRenamedItem.self, storedName: "olderShare")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }

        #expect(throws: (any Error).self) {
            _ = try ModelContainerFactory.makeReadOnlyContainer(storeURL: url)
        }
        #expect(try storedValues(url, of: GuardRenamedItem.self, storedName: "olderShare") == [0.25])
    }

    @Test("A store this build wrote opens again, with the damages fields kept")
    func ownStoreReopens() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("legallas-guard-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("default.store")

        do {
            let container = try ModelContainerFactory.makeReadWriteContainer(storeURL: url)
            let context = ModelContext(container)
            context.insert(DamagesScenario(
                name: "Invented scenario",
                tier: .base,
                startingAUM: 1_000,
                annualGrowthRate: 0.05,
                managementFeeRate: 0.02,
                claimantFeeShare: 0.11,
                carryRate: 0.2,
                partnerAllocation: 0.33,
                claimantCarryShare: 0.17,
                discountRate: 0.1,
                terminalGrowthRate: 0.02
            ))
            try context.save()
        }

        let container = try ModelContainerFactory.makeReadWriteContainer(storeURL: url)
        let rows = try ModelContext(container).fetch(FetchDescriptor<DamagesScenario>())
        #expect(rows.map(\.claimantFeeShare) == [0.11])
        #expect(rows.map(\.partnerAllocation) == [0.33])
        #expect(rows.map(\.claimantCarryShare) == [0.17])
    }

    @Test("A refused open tells the person, in words, that nothing changed")
    func refusalIsToldInWords() {
        let message = StoreOpenError.message(for: StoreOpenError.unknownShape(path: "/tmp/example.store"))
        #expect(message.contains("/tmp/example.store"))
        #expect(message.contains("has not changed it"))
        #expect(message.contains(AppSettings.appName))
    }

    @Test("Any other failure to open is told in words too")
    func otherFailureIsToldInWords() {
        let message = StoreOpenError.message(for: CocoaError(.fileReadNoSuchFile))
        #expect(message.hasPrefix("\(AppSettings.appName) could not open its case data: "))
    }
}
