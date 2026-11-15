// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import os
import LegallasCore

private let logger = Logger(subsystem: AppSettings.bundleIdentifier, category: "Inbox")

/// Shows one inbox proposal from Claude (rationale, decoded preview, raw JSON) with
/// Accept and Reject actions while it is still pending.
struct ProposalReviewView: View {

    let proposal: InboxProposal

    @Environment(\.modelContext) private var modelContext
    @State private var rejectionReason: String = ""
    @State private var showRejectSheet = false
    @State private var showingAcceptError = false
    @State private var acceptErrorText: String?
    @State private var showingRejectError = false
    @State private var rejectErrorText: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let rationale = proposal.rationale, !rationale.isEmpty {
                    GroupBox("Claude's rationale") {
                        Text(rationale)
                    }
                }
                GroupBox("Proposed change") {
                    proposedPreview
                }
                GroupBox("Raw JSON") {
                    Text(proposal.payloadJSON)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            }
            .padding()
        }
        .toolbar {
            if proposal.status == .pending {
                ToolbarItemGroup {
                    Button("Reject") { showRejectSheet = true }
                    Button("Accept") { accept() }
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .sheet(isPresented: $showRejectSheet) { rejectSheet }
        .alert("Couldn't accept proposal", isPresented: $showingAcceptError, presenting: acceptErrorText) { _ in
            Button("OK") { acceptErrorText = nil }
        } message: { text in
            Text(text)
        }
    }

    // The rejection alert lives on the sheet, which stays open on failure so the reason is kept.
    private var rejectSheet: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reject proposal").font(.headline)
            TextField("Reason (optional)", text: $rejectionReason, axis: .vertical)
                .lineLimit(3...6)
            HStack {
                Spacer()
                Button("Cancel") { showRejectSheet = false }
                Button("Reject") {
                    if reject() { showRejectSheet = false }
                }
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding()
        .frame(minWidth: 360)
        .alert("Couldn't reject proposal", isPresented: $showingRejectError, presenting: rejectErrorText) { _ in
            Button("OK") { rejectErrorText = nil }
        } message: { text in
            Text(text)
        }
    }

    private var header: some View {
        HStack {
            Image(systemName: "sparkle").foregroundStyle(.purple)
            Text("Proposal \(proposal.proposalType.rawValue)")
                .font(.title2.weight(.semibold))
            Spacer()
            Text(statusLabel)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(statusColor.opacity(0.15), in: Capsule())
                .foregroundStyle(statusColor)
        }
    }

    private var statusLabel: String {
        switch proposal.status {
        case .pending: return "Pending"
        case .accepted: return "Accepted"
        case .rejected: return "Rejected"
        }
    }

    private var statusColor: Color {
        switch proposal.status {
        case .pending: return .purple
        case .accepted: return .green
        case .rejected: return .secondary
        }
    }

    @ViewBuilder
    private var proposedPreview: some View {
        if let env = try? ProposalCodec.decode(Data(proposal.payloadJSON.utf8)) {
            switch env.payload {
            case .task(let t):
                VStack(alignment: .leading) {
                    Text(t.title).font(.headline)
                    if let d = t.details { Text(d).font(.body) }
                    HStack {
                        if let s = t.status { Text("Status: \(s.rawValue)") }
                        if let p = t.priority { Text("Priority: \(p.rawValue)") }
                        if let due = t.dueDate { Text("Due: \(Formatters.displayDate.string(from: due))") }
                    }
                    .font(.caption)
                }
            case .deadline(let d):
                VStack(alignment: .leading) {
                    Text(d.title).font(.headline)
                    Text("Anchor: \(d.anchor.rawValue) \(d.direction.rawValue) \(d.offsetDays) days")
                    if let rule = d.ruleCitation { Text("Rule: \(rule)").font(.caption) }
                }
            case .event(let e):
                VStack(alignment: .leading) {
                    Text(e.title).font(.headline)
                    Text(Formatters.displayDate.string(from: e.date))
                    Text(e.summary).font(.body)
                }
            case .note(let n):
                VStack(alignment: .leading) {
                    if let t = n.title { Text(t).font(.headline) }
                    Text(n.bodyMarkdown).font(.body)
                }
            case .contactUpdate(let c):
                VStack(alignment: .leading) {
                    Text("Update contact: \(c.contactName)").font(.headline)
                    ForEach(Array(c.fields.keys.sorted()), id: \.self) { key in
                        HStack {
                            Text(key).bold()
                            Text(c.fields[key] ?? "")
                        }
                    }
                }
            case .discoveryItem(let di):
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(di.category.shortLabel) Set \(di.setNumber)\(di.itemNumber.map { " #\($0)" } ?? ""): \(di.subject)").font(.headline)
                    Text("\(di.direction.displayName), served \(Formatters.displayDate.string(from: di.servedAt))")
                    if let due = di.dueAt {
                        Text("Due \(Formatters.displayDate.string(from: due))")
                    }
                    if let response = di.responseText, !response.isEmpty {
                        Text(response).font(.body)
                    }
                }
            case .motion(let m):
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(m.motionType.shortLabel): \(m.title)").font(.headline)
                    Text("\(m.filedBy.displayName), filed \(Formatters.displayDate.string(from: m.filedAt))")
                    if let hearing = m.hearingAt {
                        Text("Hearing \(Formatters.displayDateTime.string(from: hearing))")
                    }
                    if let ruling = m.ruling, !ruling.isEmpty {
                        Text(ruling).font(.body)
                    }
                }
            }
        } else {
            Text("Unable to decode payload")
                .foregroundStyle(.red)
        }
    }

    private func accept() {
        let applier = ProposalApplier(modelContext: modelContext)
        do {
            try applier.accept(proposal)
        } catch {
            logger.error("Accepting proposal failed: \(error.localizedDescription, privacy: .public)")
            acceptErrorText = Self.failureMessage(for: error)
            showingAcceptError = true
        }
    }

    /// Returns true when the rejection was saved.
    private func reject() -> Bool {
        let applier = ProposalApplier(modelContext: modelContext)
        do {
            try applier.reject(proposal, reason: rejectionReason.isEmpty ? nil : rejectionReason)
            return true
        } catch {
            logger.error("Rejecting proposal failed: \(error.localizedDescription, privacy: .public)")
            rejectErrorText = Self.failureMessage(for: error)
            showingRejectError = true
            return false
        }
    }

    private static func failureMessage(for error: Error) -> String {
        "\(error.localizedDescription) The proposal is still pending, so you can try again."
    }
}
