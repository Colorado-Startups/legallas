// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import PDFKit
import QuickLook
import AppKit
import LegallasCore

struct DocumentDetailView: View {

    @Environment(\.modelContext) private var modelContext
    @Bindable var document: Document
    let onEdit: () -> Void

    @State private var resolvedURL: URL?
    @State private var resolveError: String?
    @State private var isStale: Bool = false

    var body: some View {
        HSplitView {
            previewPane
                .frame(minWidth: 480)
            metadataSidebar
                .frame(minWidth: 260, idealWidth: 300, maxWidth: 380)
        }
        .navigationTitle(document.title)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { onEdit() } label: {
                    Label("Edit", systemImage: "pencil")
                }
            }
            ToolbarItem {
                Button { showQuickLook() } label: {
                    Label("QuickLook", systemImage: "eye")
                }
                .disabled(resolvedURL == nil)
                .keyboardShortcut(.space, modifiers: [])
            }
        }
        .onAppear(perform: resolveDocument)
    }

    private var previewPane: some View {
        Group {
            if let url = resolvedURL {
                if url.pathExtension.lowercased() == "pdf" {
                    PDFPreview(url: url)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "doc")
                            .font(.system(size: 80))
                            .foregroundStyle(.secondary)
                        Text(url.lastPathComponent)
                        Button("Open with QuickLook", action: showQuickLook)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            } else if let err = resolveError {
                ContentUnavailableView {
                    Label("Could not open document", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(err)
                }
            } else {
                ProgressView("Resolving file…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var metadataSidebar: some View {
        Form {
            Section("Document") {
                LabeledContent("Title", value: document.title)
                LabeledContent("Filename", value: document.originalFilename)
                if let pages = document.pageCount {
                    LabeledContent("Pages", value: "\(pages)")
                }
                if let hash = document.sha256 {
                    LabeledContent("SHA-256", value: String(hash.prefix(12)) + "…")
                        .help(hash)
                }
                LabeledContent("Added", value: Formatters.displayDate.string(from: document.addedAt))
                if let verified = document.bookmarkLastVerifiedAt {
                    LabeledContent("Last verified", value: Formatters.displayDate.string(from: verified))
                }
                if isStale {
                    Label("Bookmark is stale. Re-verify via Reconnect.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                        .font(.caption)
                }
            }
            Section("Tags") {
                if document.tags.isEmpty {
                    Text("No tags").foregroundStyle(.secondary)
                } else {
                    FlowTags(tags: document.tags)
                }
            }
            if !document.events.isEmpty {
                Section("Related events") {
                    ForEach(document.events) { event in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(event.title).font(.callout)
                            Text(Formatters.displayDate.string(from: event.date))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            if !document.notes.isEmpty {
                Section("Related notes") {
                    ForEach(document.notes) { note in
                        Text(note.title ?? String(note.bodyMarkdown.prefix(60)))
                            .font(.callout)
                    }
                }
            }
        }
        .formStyle(.grouped)
    }

    private func resolveDocument() {
        let store = DocumentStore(modelContext: modelContext)
        do {
            let (url, stale) = try store.resolve(document)
            resolvedURL = url
            isStale = stale
            if !stale {
                document.bookmarkLastVerifiedAt = Date()
                try? modelContext.save()
            }
        } catch {
            resolveError = error.localizedDescription
        }
    }

    private func showQuickLook() {
        guard let url = resolvedURL else { return }
        NSWorkspace.shared.open(url)
    }
}

private struct PDFPreview: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.backgroundColor = .windowBackgroundColor
        return view
    }

    func updateNSView(_ nsView: PDFView, context: Context) {
        DocumentStore.withSecurityScope(url: url) { scoped in
            nsView.document = PDFDocument(url: scoped)
        }
    }
}

private struct FlowTags: View {
    let tags: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(tags, id: \.self) { tag in
                    Text(tag)
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.secondary.opacity(0.15), in: Capsule())
                }
            }
        }
    }
}
