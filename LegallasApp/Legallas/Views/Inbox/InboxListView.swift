// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct InboxListView: View {

    @Environment(\.modelContext) private var modelContext
    @Query(sort: \InboxProposal.proposedAt, order: .reverse) private var proposals: [InboxProposal]
    @Query(sort: \Case.createdAt) private var cases: [Case]
    @State private var selected: InboxProposal?
    @State private var folderErrorText: String?

    var body: some View {
        NavigationSplitView {
            List(selection: $selected) {
                Section("Pending") {
                    ForEach(proposals.filter { $0.status == .pending }) { p in
                        proposalRow(p)
                            .tag(p)
                    }
                }
                Section("Reviewed") {
                    ForEach(proposals.filter { $0.status != .pending }) { p in
                        proposalRow(p)
                            .tag(p)
                    }
                }
            }
            .navigationTitle("Claude Inbox")
            .overlay {
                if proposals.isEmpty { emptyState }
            }
            .alert("Couldn't save the documents folder", isPresented: Binding(
                get: { folderErrorText != nil },
                set: { if !$0 { folderErrorText = nil } }
            )) {
                Button("OK") {}
            } message: {
                Text(folderErrorText ?? "")
            }
        } detail: {
            if let p = selected {
                ProposalReviewView(proposal: p)
            } else {
                ContentUnavailableView("No proposal selected", systemImage: "tray")
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if let kase = cases.first, kase.documentsFolderBookmark == nil, kase.documentsFolderLastKnownPath == nil {
            ContentUnavailableView {
                Label("No documents folder", systemImage: "folder.badge.questionmark")
            } description: {
                Text("Claude's proposals arrive in the case's documents folder. Choose it so \(AppSettings.appName) can watch for them.")
            } actions: {
                Button("Choose Documents Folder…") {
                    do {
                        try DocumentsFolderPanel.choose(for: kase, in: modelContext)
                    } catch {
                        folderErrorText = error.localizedDescription
                    }
                }
            }
        } else {
            ContentUnavailableView("No proposals yet", systemImage: "tray", description: Text("Proposals from Claude appear here."))
        }
    }

    private func proposalRow(_ p: InboxProposal) -> some View {
        HStack {
            Image(systemName: icon(for: p.proposalType))
                .foregroundStyle(color(for: p))
            VStack(alignment: .leading, spacing: 2) {
                Text(summary(for: p))
                    .lineLimit(1)
                Text(Formatters.displayDateTime.string(from: p.proposedAt))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func icon(for type: ProposalType) -> String {
        switch type {
        case .task: return "checkmark.square"
        case .deadline: return "calendar.badge.clock"
        case .event: return "clock"
        case .note: return "note.text"
        case .contactUpdate: return "person.crop.circle"
        case .discoveryItem: return "magnifyingglass.circle"
        case .motion: return "doc.text.below.ecg"
        }
    }

    private func color(for p: InboxProposal) -> Color {
        switch p.status {
        case .pending: return .purple
        case .accepted: return .green
        case .rejected: return .secondary
        }
    }

    private func summary(for p: InboxProposal) -> String {
        do {
            let env = try ProposalCodec.decode(Data(p.payloadJSON.utf8))
            switch env.payload {
            case .task(let t): return t.title
            case .deadline(let d): return d.title
            case .event(let e): return e.title
            case .note(let n): return n.title ?? String(n.bodyMarkdown.prefix(40))
            case .contactUpdate(let c): return "Update \(c.contactName)"
            case .discoveryItem(let di): return "\(di.category.shortLabel) Set \(di.setNumber)\(di.itemNumber.map { " #\($0)" } ?? ""): \(di.subject)"
            case .motion(let m): return "\(m.motionType.shortLabel): \(m.title)"
            }
        } catch {
            return "(malformed proposal)"
        }
    }
}
