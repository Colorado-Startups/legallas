// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

enum SidebarSection: String, Hashable, CaseIterable {
    case kanban, deadlines, chronology, claims, motions, damages, settlements, discovery, documents, contacts, inbox

    var title: String {
        switch self {
        case .kanban: return "Kanban"
        case .deadlines: return "Deadlines"
        case .chronology: return "Chronology"
        case .claims: return "Claims"
        case .motions: return "Motions"
        case .damages: return "Damages"
        case .settlements: return "Settlements"
        case .discovery: return "Discovery"
        case .documents: return "Documents"
        case .contacts: return "Contacts"
        case .inbox: return "Claude Inbox"
        }
    }

    var systemImage: String {
        switch self {
        case .kanban: return "rectangle.split.3x1"
        case .deadlines: return "calendar.badge.clock"
        case .chronology: return "calendar.day.timeline.left"
        case .claims: return "checkmark.seal"
        case .motions: return "doc.text.below.ecg"
        case .damages: return "chart.bar.xaxis"
        case .settlements: return "scalemass"
        case .discovery: return "magnifyingglass.circle"
        case .documents: return "doc.text.magnifyingglass"
        case .contacts: return "person.crop.circle"
        case .inbox: return "tray.full"
        }
    }
}

struct RootView: View {

    @Environment(\.modelContext) private var modelContext
    @State private var selection: SidebarSection? = .kanban
    @Query private var proposals: [InboxProposal]
    @Query(sort: \Case.createdAt) private var cases: [Case]
    @State private var exportErrorText: String?
    @State private var exportSuccessPath: String?

    var body: some View {
        NavigationSplitView {
            Sidebar(selection: $selection, pendingCount: pendingCount)
                .navigationSplitViewColumnWidth(min: 180, ideal: 220)
        } detail: {
            detailView
                .toolbar {
                    ToolbarItem {
                        Button { runExport(format: .markdown) } label: {
                            Label("Export Markdown", systemImage: "doc.text")
                        }
                    }
                    ToolbarItem {
                        Button { runExport(format: .pdf) } label: {
                            Label("Export PDF", systemImage: "doc.richtext")
                        }
                    }
                }
        }
        .onReceive(NotificationCenter.default.publisher(for: .legallasExportCaseJSON)) { _ in
            runJSONExport()
        }
        .alert(
            "Export failed",
            isPresented: Binding(get: { exportErrorText != nil }, set: { if !$0 { exportErrorText = nil } })
        ) {
            Button("OK", role: .cancel) { exportErrorText = nil }
        } message: {
            Text(exportErrorText ?? "")
        }
        .alert(
            "Export complete",
            isPresented: Binding(get: { exportSuccessPath != nil }, set: { if !$0 { exportSuccessPath = nil } })
        ) {
            Button("OK", role: .cancel) { exportSuccessPath = nil }
        } message: {
            Text(exportSuccessPath ?? "")
        }
    }

    @ViewBuilder private var detailView: some View {
        switch selection ?? .kanban {
        case .kanban: KanbanBoardView()
        case .deadlines: DeadlineListView()
        case .chronology: ChronologyTimelineView()
        case .claims: ClaimsListView()
        case .motions: MotionListView()
        case .damages: DamagesListView()
        case .settlements: SettlementListView()
        case .discovery: DiscoveryListView()
        case .documents: DocumentLibraryView()
        case .contacts: ContactListView()
        case .inbox: InboxListView()
        }
    }

    private var pendingCount: Int {
        proposals.filter { $0.status == .pending }.count
    }

    private func runJSONExport() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = AppSettings.exportFileName
        panel.allowedContentTypes = [.json]
        if let path = cases.first?.documentsFolderLastKnownPath {
            panel.directoryURL = URL(fileURLWithPath: path)
        }
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try CaseExporter.writeExport(from: modelContext, to: url)
        } catch {
            exportErrorText = "\(error)"
        }
    }

    enum ExportFormat { case markdown, pdf }

    private func runExport(format: ExportFormat) {
        guard let folderPath = cases.first?.documentsFolderLastKnownPath else {
            exportErrorText = "Set a documents folder on the case first."
            return
        }
        let folder = URL(fileURLWithPath: folderPath)
        do {
            let dto = try CaseExporter.export(from: modelContext)
            let markdown = ExportLogic.buildMarkdown(from: dto)
            let url: URL
            switch format {
            case .markdown:
                let name = ExportLogic.timestampedFileName(prefix: AppSettings.exportFileStem, ext: "md")
                url = folder.appendingPathComponent(name)
                try markdown.data(using: .utf8)?.write(to: url, options: .atomic)
            case .pdf:
                let name = ExportLogic.timestampedFileName(prefix: AppSettings.exportFileStem, ext: "pdf")
                url = folder.appendingPathComponent(name)
                try PDFExporter.renderPDF(markdown: markdown, to: url)
            }
            exportSuccessPath = url.path
        } catch {
            exportErrorText = "\(error)"
        }
    }
}
