// SPDX-License-Identifier: Apache-2.0
import Foundation
import SwiftData
import LegallasCore

/// Applies an accepted inbox proposal to the case (or records a rejection) and moves its
/// JSON file out of `pending/`.
///
/// A failed save never leaves a half-applied proposal behind: any edits already pending
/// elsewhere are saved first, then a failure rolls the context back so the proposal reads
/// as pending again, and the error is rethrown.
@MainActor
struct ProposalApplier {

    let modelContext: ModelContext

    /// Persists `modelContext`. Tests swap in a throwing closure to exercise the failure path.
    var save: (ModelContext) throws -> Void = { try $0.save() }

    private var inboxPaths: InboxPaths? {
        InboxPaths.forCase(in: modelContext)
    }

    func accept(_ proposal: InboxProposal) throws {
        guard proposal.status == .pending else { return }
        try savePendingChanges()
        let env = try ProposalCodec.decode(Data(proposal.payloadJSON.utf8))
        let kase = try modelContext.fetch(FetchDescriptor<Case>()).first
        var reminderChange: ReminderChange?

        switch env.payload {
        case .task(let p):
            let maxSort = (kase?.tasks.map(\.sortIndex).max() ?? 0)
            let task = CaseTask(
                title: p.title,
                details: p.details ?? "",
                status: p.status ?? .toDo,
                priority: p.priority ?? .medium,
                dueDate: p.dueDate,
                sortIndex: maxSort + 1000,
                source: .claude
            )
            modelContext.insert(task)
            kase?.tasks.append(task)
            proposal.resultingTask = task

        case .deadline(let p):
            let holidays = (try? CalendarDataSource.loadBundledColoradoCourtHolidays().holidays) ?? []
            // An unfiled case has no filing date to fall back on, so anchor on today.
            let filedOn = kase.flatMap { $0.isFiled ? $0.filingDate : nil }
            let inputs = DeadlineInputs(
                anchor: p.anchorDate ?? filedOn ?? Date(),
                offsetDays: p.offsetDays,
                direction: p.direction,
                applyRollover: true
            )
            let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
            let d = Deadline(
                title: p.title,
                anchor: p.anchor,
                anchorDate: p.anchorDate ?? filedOn,
                customAnchorLabel: p.customAnchorLabel,
                offsetDays: p.offsetDays,
                direction: p.direction,
                applyWeekendRollover: true,
                computedDate: computed,
                ruleCitation: p.ruleCitation,
                notesText: p.notes,
                source: .claude
            )
            modelContext.insert(d)
            kase?.deadlines.append(d)
            // Default reminders: 30 / 7 / 1 days before
            let fires = DeadlineCalculator.reminderFireDates(for: computed, leadTimes: [30, 7, 1])
            reminderChange = ReminderSync.replaceReminders(on: d, with: fires, in: modelContext)
            proposal.resultingDeadline = d

        case .event(let p):
            let e = ChronologyEvent(
                title: p.title,
                date: p.date,
                type: p.type,
                summary: p.summary,
                source: .claude
            )
            modelContext.insert(e)
            kase?.events.append(e)
            proposal.resultingEvent = e

        case .note(let p):
            let n = Note(title: p.title, bodyMarkdown: p.bodyMarkdown, source: .claude)
            modelContext.insert(n)
            kase?.notes.append(n)
            proposal.resultingNote = n

        case .contactUpdate(let p):
            if let contact = kase?.parties.first(where: { $0.name == p.contactName }) {
                for (key, value) in p.fields {
                    switch key {
                    case "organization": contact.organization = value
                    case "email": contact.email = value
                    case "phone": contact.phone = value
                    case "address": contact.address = value
                    case "notesSummary": contact.notesSummary = value
                    default: break
                    }
                }
                proposal.resultingContact = contact
            }

        case .discoveryItem(let p):
            let item = DiscoveryItem(
                category: p.category,
                direction: p.direction,
                setNumber: p.setNumber,
                itemNumber: p.itemNumber,
                subject: p.subject,
                servedAt: p.servedAt,
                dueAt: p.dueAt,
                status: p.status ?? .outstanding,
                responseText: p.responseText ?? "",
                notes: p.notes ?? ""
            )
            modelContext.insert(item)
            kase?.discoveryItems.append(item)
            if let titles = p.documentTitles, !titles.isEmpty {
                let allDocs = (try? modelContext.fetch(FetchDescriptor<Document>())) ?? []
                for title in titles {
                    if let doc = allDocs.first(where: { $0.title == title }) {
                        item.documents.append(doc)
                    }
                }
            }
            if let names = p.contactNames, !names.isEmpty {
                let allContacts = (try? modelContext.fetch(FetchDescriptor<Contact>())) ?? []
                for name in names {
                    if let c = allContacts.first(where: { $0.name == name }) {
                        item.contacts.append(c)
                    }
                }
            }
            proposal.resultingDiscoveryItem = item

        case .motion(let p):
            let m = Motion(
                title: p.title,
                motionType: p.motionType,
                filedBy: p.filedBy,
                filedAt: p.filedAt,
                responseDueAt: p.responseDueAt,
                replyDueAt: p.replyDueAt,
                hearingAt: p.hearingAt,
                status: p.status ?? .pending,
                ruling: p.ruling ?? "",
                notes: p.notes ?? ""
            )
            modelContext.insert(m)
            kase?.motions.append(m)
            if let titles = p.documentTitles, !titles.isEmpty {
                let allDocs = (try? modelContext.fetch(FetchDescriptor<Document>())) ?? []
                for title in titles {
                    if let doc = allDocs.first(where: { $0.title == title }) {
                        m.documents.append(doc)
                    }
                }
            }
            proposal.resultingMotion = m
        }

        proposal.status = .accepted
        proposal.reviewedAt = Date()
        try commit()
        if let reminderChange {
            NotificationService.shared.apply(reminderChange)
        }
        moveInboxFile(id: proposal.externalId, to: .accepted)
    }

    func reject(_ proposal: InboxProposal, reason: String?) throws {
        guard proposal.status == .pending else { return }
        try savePendingChanges()
        proposal.status = .rejected
        proposal.reviewedAt = Date()
        proposal.rejectionReason = reason
        try commit()
        moveInboxFile(id: proposal.externalId, to: .rejected)
    }

    /// Saves edits made elsewhere before touching the proposal, so a rollback in `commit()`
    /// discards only this proposal's changes.
    private func savePendingChanges() throws {
        if modelContext.hasChanges { try save(modelContext) }
    }

    /// Saves the proposal's changes; on failure rolls them back and rethrows.
    private func commit() throws {
        do {
            try save(modelContext)
        } catch {
            modelContext.rollback()
            throw error
        }
    }

    private enum InboxTarget { case accepted, rejected }

    private func moveInboxFile(id: UUID, to target: InboxTarget) {
        guard let paths = inboxPaths else { return }
        let src = paths.pendingFile(id: id)
        let dst: URL
        switch target {
        case .accepted: dst = paths.acceptedFile(id: id)
        case .rejected: dst = paths.rejectedFile(id: id)
        }
        let fm = FileManager.default
        guard fm.fileExists(atPath: src.path) else { return }
        try? paths.ensureDirectoriesExist()
        try? fm.moveItem(at: src, to: dst)
    }
}
