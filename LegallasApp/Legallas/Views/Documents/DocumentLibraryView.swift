// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import AppKit
import LegallasCore

enum DocumentLayout: String {
    case list, grid
}

struct DocumentLibraryView: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(DocumentStoreState.self) private var storeState
    @Query(sort: \Document.addedAt, order: .reverse) private var documents: [Document]
    @Query(sort: \Case.createdAt) private var cases: [Case]

    @AppStorage("documentLayout") private var layoutRaw: String = DocumentLayout.list.rawValue
    @State private var searchText: String = ""
    @State private var selectedTag: String?
    @State private var selected: Document?
    @State private var editing: Document?
    @State private var importErrorText: String?
    @State private var showingImportError = false

    private var layout: DocumentLayout {
        DocumentLayout(rawValue: layoutRaw) ?? .list
    }

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                if !storeState.staleDocuments.isEmpty {
                    ReconnectBanner(
                        count: storeState.staleDocuments.count,
                        reconnectAction: reconnectNextStale
                    )
                }
                tagChipsRow
                Group {
                    switch layout {
                    case .list: documentList
                    case .grid: documentGrid
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search title, filename, content")
            .navigationTitle("Documents")
            .toolbar {
                ToolbarItemGroup {
                    Picker("Layout", selection: $layoutRaw) {
                        Image(systemName: "list.bullet").tag(DocumentLayout.list.rawValue)
                        Image(systemName: "square.grid.2x2").tag(DocumentLayout.grid.rawValue)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 90)

                    Button { importFiles() } label: {
                        Label("Import", systemImage: "plus")
                    }
                    .help("Import PDFs or other files into the library")
                }
            }
            .onDrop(of: [.fileURL], isTargeted: nil, perform: handleDrop)
            .alert("Import failed", isPresented: $showingImportError, presenting: importErrorText) { _ in
                Button("OK") { importErrorText = nil }
            } message: { text in
                Text(text)
            }
        } detail: {
            if let doc = selected {
                DocumentDetailView(document: doc, onEdit: { editing = doc })
            } else {
                ContentUnavailableView(
                    "Select a document",
                    systemImage: "doc.text.magnifyingglass"
                )
            }
        }
        .sheet(item: $editing) { doc in
            DocumentEditor(document: doc)
        }
    }

    private var filteredDocuments: [Document] {
        documents.filter { doc in
            if let tag = selectedTag, !doc.tags.contains(tag) { return false }
            if searchText.isEmpty { return true }
            if doc.title.localizedCaseInsensitiveContains(searchText) { return true }
            if doc.originalFilename.localizedCaseInsensitiveContains(searchText) { return true }
            if let text = doc.fullTextContent,
               text.localizedCaseInsensitiveContains(searchText) { return true }
            return false
        }
    }

    private var allUniqueTags: [String] {
        var set = Set<String>()
        for doc in documents { set.formUnion(doc.tags) }
        return set.sorted()
    }

    private var tagChipsRow: some View {
        Group {
            if !allUniqueTags.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        TagChip(label: "All", isSelected: selectedTag == nil) {
                            selectedTag = nil
                        }
                        ForEach(allUniqueTags, id: \.self) { tag in
                            TagChip(label: tag, isSelected: selectedTag == tag) {
                                selectedTag = (selectedTag == tag) ? nil : tag
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                }
                .background(.thinMaterial)
            }
        }
    }

    private var documentList: some View {
        List(selection: $selected) {
            ForEach(filteredDocuments) { doc in
                DocumentRow(document: doc).tag(doc)
            }
        }
    }

    private var documentGrid: some View {
        ScrollView {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: 12)],
                spacing: 12
            ) {
                ForEach(filteredDocuments) { doc in
                    DocumentGridCard(document: doc, isSelected: selected == doc)
                        .onTapGesture { selected = doc }
                }
            }
            .padding(12)
        }
    }

    private func importFiles() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.allowedContentTypes = [.pdf, .plainText, .rtf, .image, .data]
        panel.prompt = "Import"
        guard panel.runModal() == .OK else { return }
        Task { await importURLs(panel.urls) }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        Task { @MainActor in
            var urls: [URL] = []
            for provider in providers {
                guard provider.canLoadObject(ofClass: URL.self) else { continue }
                if let url = await loadURL(from: provider) {
                    urls.append(url)
                }
            }
            await importURLs(urls)
        }
        return true
    }

    private func loadURL(from provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            _ = provider.loadObject(ofClass: URL.self) { url, _ in
                continuation.resume(returning: url)
            }
        }
    }

    @MainActor
    private func importURLs(_ urls: [URL]) async {
        guard let kase = cases.first else {
            importErrorText = "No active case to attach documents to."
            showingImportError = true
            return
        }
        let store = DocumentStore(modelContext: modelContext)
        for url in urls {
            do {
                _ = try await store.importFile(at: url, for: kase)
            } catch {
                importErrorText = "Could not import \(url.lastPathComponent): \(error.localizedDescription)"
                showingImportError = true
            }
        }
    }

    private func reconnectNextStale() {
        guard let stale = storeState.staleDocuments.first else { return }
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = [.pdf, .plainText, .rtf, .image, .data]
        panel.prompt = "Reconnect"
        panel.message = "Locate the file for '\(stale.title)' (\(stale.originalFilename))."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let store = DocumentStore(modelContext: modelContext)
        do {
            try store.recreateBookmark(for: stale, at: url)
            storeState.staleDocuments.removeAll { $0 === stale }
        } catch {
            importErrorText = "Could not reconnect \(stale.title): \(error.localizedDescription)"
            showingImportError = true
        }
    }
}

private struct TagChip: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(.caption)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(
                    isSelected
                        ? Color.accentColor.opacity(0.25)
                        : Color.secondary.opacity(0.12),
                    in: Capsule()
                )
                .foregroundStyle(isSelected ? Color.accentColor : .primary)
        }
        .buttonStyle(.plain)
    }
}

private struct DocumentRow: View {
    let document: Document

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(document.title).lineLimit(1)
                HStack(spacing: 6) {
                    Text(document.originalFilename)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if let pages = document.pageCount {
                        Text("· \(pages) pages")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if !document.tags.isEmpty {
                    Text(document.tags.joined(separator: ", "))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            Spacer()
            Text(Formatters.displayDate.string(from: document.addedAt))
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }

    private var iconName: String {
        document.originalFilename.lowercased().hasSuffix(".pdf")
            ? "doc.richtext"
            : "doc"
    }
}

private struct DocumentGridCard: View {
    let document: Document
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "doc.richtext")
                .resizable()
                .scaledToFit()
                .frame(height: 64)
                .foregroundStyle(.secondary)
            Text(document.title)
                .font(.headline)
                .lineLimit(2)
            if let pages = document.pageCount {
                Text("\(pages) pages")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isSelected ? Color.accentColor.opacity(0.15) : Color.secondary.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 1.5)
        )
    }
}

private struct ReconnectBanner: View {
    let count: Int
    let reconnectAction: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.yellow)
            Text("\(count) file\(count == 1 ? "" : "s") need to be reconnected")
                .font(.callout)
            Spacer()
            Button("Reconnect", action: reconnectAction)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.yellow.opacity(0.15))
    }
}
