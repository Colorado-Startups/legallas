// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "Inbox")

/// Watches the case's `legallas-inbox/pending` folder and inserts each new proposal JSON
/// as an `InboxProposal`, using a file-system event source plus a 60-second polling fallback.
@MainActor
final class InboxWatcher {

    private let modelContext: ModelContext
    private let paths: InboxPaths
    private var source: DispatchSourceFileSystemObject?
    private var pollingTask: Task<Void, Never>?
    /// Files already reported for a name/payload ID mismatch, so each is warned about once.
    private var reportedMismatches: Set<String> = []

    init(modelContext: ModelContext, paths: InboxPaths) {
        self.modelContext = modelContext
        self.paths = paths
    }

    /// Returns false when the inbox folders cannot be created; nothing is watched then.
    @discardableResult
    func start() -> Bool {
        guard source == nil, pollingTask == nil else { return true }
        do {
            try paths.ensureDirectoriesExist()
        } catch {
            // Foundation's description can name the case folder, so only the domain and code are public.
            let nsError = error as NSError
            logger.error("Creating inbox folders failed (\(nsError.domain, privacy: .public) \(nsError.code, privacy: .public)): \(error.localizedDescription)")
            return false
        }
        ingestPendingSnapshot()
        attachDispatchSource()
        startPollingFallback()
        return true
    }

    func stop() {
        // The cancel handler closes the descriptor once the source has finished with it.
        source?.cancel()
        source = nil
        pollingTask?.cancel()
        pollingTask = nil
    }

    private func attachDispatchSource() {
        let path = paths.pending.path
        let descriptor = open(path, O_EVTONLY)
        guard descriptor >= 0 else {
            let reason = String(cString: strerror(errno))
            logger.error("Watching inbox folder \(path) failed: \(reason, privacy: .public); relying on polling")
            return
        }
        let src = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .extend, .delete, .rename],
            queue: .main
        )
        src.setEventHandler { [weak self] in
            self?.ingestPendingSnapshot()
        }
        src.setCancelHandler {
            close(descriptor)
        }
        src.activate()
        source = src
    }

    private func startPollingFallback() {
        pollingTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                guard !Task.isCancelled else { return }
                self?.ingestPendingSnapshot()
            }
        }
    }

    /// Inserts a pending row for every `{uuid}.json` in the pending folder that has none yet.
    /// The payload's `id` is the proposal's identity; a file whose name disagrees with it is
    /// skipped (ProposalApplier moves files by that id, so it could never leave `pending/`).
    /// Files that fail to decode are skipped and retried on the next scan (they may be mid-write).
    /// Returns the number of proposals inserted.
    @discardableResult
    func ingestPendingSnapshot() -> Int {
        let entries: [URL]
        do {
            entries = try FileManager.default.contentsOfDirectory(
                at: paths.pending,
                includingPropertiesForKeys: [.contentModificationDateKey]
            )
        } catch {
            let nsError = error as NSError
            logger.error("Listing the inbox folder \(self.paths.pending.path) failed (\(nsError.domain, privacy: .public) \(nsError.code, privacy: .public))")
            return 0
        }

        let existingIDs: Set<UUID> = Set(
            (try? modelContext.fetch(FetchDescriptor<InboxProposal>()).map(\.externalId)) ?? []
        )
        let kase = try? modelContext.fetch(FetchDescriptor<Case>()).first
        var inserted = 0

        for fileURL in entries where fileURL.pathExtension.lowercased() == "json" {
            let idString = fileURL.deletingPathExtension().lastPathComponent
            // Name and payload must match (checked below), so the name is a safe fast-path dedupe.
            guard let id = UUID(uuidString: idString) else { continue }
            if existingIDs.contains(id) { continue }
            let env: ProposalEnvelope
            let data: Data
            do {
                data = try Data(contentsOf: fileURL)
                env = try ProposalCodec.decode(data)
            } catch {
                // File names are proposal UUIDs; the error text can name the case folder.
                logger.info("Skipping \(fileURL.lastPathComponent, privacy: .public) until the next scan: \(error.localizedDescription)")
                continue
            }
            guard env.id == id else {
                if reportedMismatches.insert(fileURL.lastPathComponent).inserted {
                    logger.warning("Skipping \(fileURL.lastPathComponent, privacy: .public): its payload id is \(env.id.uuidString, privacy: .public)")
                }
                continue
            }

            let proposal = InboxProposal(
                externalId: env.id,
                proposalType: env.type,
                proposedAt: env.proposedAt,
                rationale: env.rationale,
                payloadJSON: String(decoding: data, as: UTF8.self),
                status: .pending
            )
            modelContext.insert(proposal)
            kase?.inboxProposals.append(proposal)
            inserted += 1
        }

        guard inserted > 0 else { return 0 }
        do {
            try modelContext.save()
            logger.info("Ingested \(inserted, privacy: .public) proposal(s) from the inbox")
        } catch {
            let nsError = error as NSError
            logger.error("Saving ingested proposals failed (\(nsError.domain, privacy: .public) \(nsError.code, privacy: .public)): \(error.localizedDescription)")
        }
        return inserted
    }
}
