// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData

/// Builds the SwiftData containers used by the app, the read-only MCP server and tests.
public enum ModelContainerFactory {

    /// Returns the default store file path under Application Support, creating the folder when it is missing.
    public static func defaultStoreURL() throws -> URL {
        let fm = FileManager.default
        let appSupport = try fm.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let dir = appSupport.appendingPathComponent(AppSettings.storeFolderName, isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent("default.store")
    }

    /// Opens the store for reading and writing after checking its shape and applying the migration plan; uses the default store when no URL is given.
    public static func makeReadWriteContainer(storeURL: URL? = nil) throws -> ModelContainer {
        let url = try storeURL ?? defaultStoreURL()
        try StoreGuard.check(storeURL: url, modelSets: LegallasMigrationPlan.schemas.map { $0.models })
        let schema = Schema(versionedSchema: LegallasSchemaV1.self)
        let config = ModelConfiguration(
            "Legallas",
            schema: schema,
            url: url,
            allowsSave: true
        )
        return try ModelContainer(
            for: schema,
            migrationPlan: LegallasMigrationPlan.self,
            configurations: config
        )
    }

    /// Opens an existing store at the given URL for reading only, with saving turned off.
    public static func makeReadOnlyContainer(storeURL: URL) throws -> ModelContainer {
        let schema = Schema(versionedSchema: LegallasSchemaV1.self)
        let config = ModelConfiguration(
            "LegallasReadOnly",
            schema: schema,
            url: storeURL,
            allowsSave: false
        )
        return try ModelContainer(
            for: schema,
            configurations: config
        )
    }

    /// Creates a container that lives in memory only, for tests.
    public static func makeInMemoryContainer() throws -> ModelContainer {
        let schema = Schema(versionedSchema: LegallasSchemaV1.self)
        let config = ModelConfiguration(
            "LegallasTest",
            schema: schema,
            isStoredInMemoryOnly: true,
            allowsSave: true
        )
        return try ModelContainer(
            for: schema,
            configurations: config
        )
    }
}
