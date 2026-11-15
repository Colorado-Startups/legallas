// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

enum DeadlineEditorMode {
    case create
    case edit(Deadline)
}

/// Sheet for creating or editing a deadline and its reminder lead times. Saving rebuilds
/// the reminders and hands the notification changes to `NotificationService`.
struct DeadlineEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Case.createdAt) private var cases: [Case]

    let mode: DeadlineEditorMode

    @State private var title: String = ""
    @State private var anchor: AnchorEvent = .filing
    @State private var anchorDate: Date = Date()
    @State private var customAnchorLabel: String = ""
    @State private var offsetDays: Int = 0
    @State private var direction: DeadlineDirection = .after
    @State private var applyRollover: Bool = true
    @State private var ruleCitation: String = ""
    @State private var notesText: String = ""
    @State private var leadTimes: [Int] = [30, 7, 1]
    @State private var newLeadTime: Int = 14

    var body: some View {
        Form {
            Section("Deadline") {
                TextField("Title", text: $title)
                TextField("Rule citation", text: $ruleCitation)
                TextField("Notes", text: $notesText, axis: .vertical)
                    .lineLimit(2...4)
            }
            Section("Anchor") {
                Picker("Anchor event", selection: $anchor) {
                    ForEach(AnchorEvent.allCases, id: \.self) { a in
                        Text(a.rawValue).tag(a)
                    }
                }
                DatePicker("Anchor date", selection: $anchorDate, displayedComponents: .date)
                if anchor == .custom {
                    TextField("Custom anchor label", text: $customAnchorLabel)
                }
                HStack {
                    Stepper("Offset: \(offsetDays) days", value: $offsetDays, in: 0...3650)
                    Picker("Direction", selection: $direction) {
                        Text("After").tag(DeadlineDirection.after)
                        Text("Before").tag(DeadlineDirection.before)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 160)
                }
                Toggle("Roll over weekends and Colorado court holidays (CRCP 6(a))", isOn: $applyRollover)
            }
            Section("Reminders") {
                if leadTimes.isEmpty {
                    Text("No reminders").foregroundStyle(.secondary)
                } else {
                    ForEach(leadTimes, id: \.self) { days in
                        HStack {
                            Text("\(days) day\(days == 1 ? "" : "s") before")
                            Spacer()
                            Button {
                                leadTimes.removeAll { $0 == days }
                            } label: {
                                Image(systemName: "minus.circle.fill").foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                HStack {
                    Stepper("Add reminder: \(newLeadTime) days before", value: $newLeadTime, in: 1...365)
                    Button("Add") {
                        if !leadTimes.contains(newLeadTime) {
                            leadTimes.append(newLeadTime)
                            leadTimes.sort(by: >)
                        }
                    }
                    .disabled(leadTimes.contains(newLeadTime))
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 520, minHeight: 580)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save", action: save)
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .onAppear(perform: bootstrap)
    }

    private func bootstrap() {
        if case .edit(let d) = mode {
            title = d.title
            anchor = d.anchor
            anchorDate = d.anchorDate ?? Date()
            customAnchorLabel = d.customAnchorLabel ?? ""
            offsetDays = d.offsetDays
            direction = d.direction
            applyRollover = d.applyWeekendRollover
            ruleCitation = d.ruleCitation ?? ""
            notesText = d.notesText ?? ""
            leadTimes = d.reminders.map(\.leadTimeDays).sorted(by: >)
        }
    }

    private func save() {
        let holidays = (try? CalendarDataSource.loadBundledColoradoCourtHolidays().holidays) ?? []
        let inputs = DeadlineInputs(
            anchor: anchorDate,
            offsetDays: offsetDays,
            direction: direction,
            applyRollover: applyRollover
        )
        let computed = DeadlineCalculator.compute(inputs, holidays: holidays)
        let fires = DeadlineCalculator.reminderFireDates(for: computed, leadTimes: leadTimes)

        let deadline: Deadline
        switch mode {
        case .create:
            let d = Deadline(
                title: title,
                anchor: anchor,
                anchorDate: anchorDate,
                customAnchorLabel: customAnchorLabel.isEmpty ? nil : customAnchorLabel,
                offsetDays: offsetDays,
                direction: direction,
                applyWeekendRollover: applyRollover,
                computedDate: computed,
                ruleCitation: ruleCitation.isEmpty ? nil : ruleCitation,
                notesText: notesText.isEmpty ? nil : notesText,
                source: .user
            )
            modelContext.insert(d)
            cases.first?.deadlines.append(d)
            deadline = d
        case .edit(let d):
            d.title = title
            d.anchor = anchor
            d.anchorDate = anchorDate
            d.customAnchorLabel = customAnchorLabel.isEmpty ? nil : customAnchorLabel
            d.offsetDays = offsetDays
            d.direction = direction
            d.applyWeekendRollover = applyRollover
            d.ruleCitation = ruleCitation.isEmpty ? nil : ruleCitation
            d.notesText = notesText.isEmpty ? nil : notesText
            d.computedDate = computed
            deadline = d
        }
        let change = ReminderSync.replaceReminders(on: deadline, with: fires, in: modelContext)
        try? modelContext.save()
        NotificationService.shared.apply(change)
        dismiss()
    }
}
