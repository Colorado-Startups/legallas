// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct ClaimEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let existing: Claim?
    let caseOwner: Case?

    @State private var type: ClaimType = .custom
    @State private var customLabel: String = ""
    @State private var elements: String = ""
    @State private var isTrebleable: Bool = false
    @State private var isSurvivingSummaryJudgment: Bool = true
    @State private var hasStatuteOfLimitations: Bool = false
    @State private var statuteOfLimitations: Date = Date().addingTimeInterval(86_400 * 365 * 3)

    var body: some View {
        Form {
            Section("Claim") {
                Picker("Type", selection: $type) {
                    ForEach(ClaimType.allCases, id: \.self) { t in
                        Text(t.displayName).tag(t)
                    }
                }
                if type == .custom {
                    TextField("Custom label", text: $customLabel)
                }
            }
            Section("Elements") {
                TextField("Elements and citations", text: $elements, axis: .vertical)
                    .lineLimit(4...12)
            }
            Section("Flags") {
                Toggle("Trebleable", isOn: $isTrebleable)
                Toggle("Survives summary judgment", isOn: $isSurvivingSummaryJudgment)
            }
            Section("Statute of limitations") {
                Toggle("Has deadline", isOn: $hasStatuteOfLimitations)
                if hasStatuteOfLimitations {
                    DatePicker("SOL date", selection: $statuteOfLimitations, displayedComponents: .date)
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 520, minHeight: 520)
        .onAppear(perform: bootstrap)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(existing == nil ? "Create" : "Save", action: save)
                    .disabled(type == .custom && customLabel.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func bootstrap() {
        guard let claim = existing else { return }
        type = claim.type
        customLabel = claim.customLabel ?? ""
        elements = claim.elements
        isTrebleable = claim.isTrebleable
        isSurvivingSummaryJudgment = claim.isSurvivingSummaryJudgment
        if let sol = claim.statuteOfLimitations {
            hasStatuteOfLimitations = true
            statuteOfLimitations = sol
        }
    }

    private func save() {
        let trimmedLabel = customLabel.trimmingCharacters(in: .whitespaces)
        let finalLabel = trimmedLabel.isEmpty ? nil : trimmedLabel
        let claim: Claim
        if let existing {
            claim = existing
            claim.type = type
            claim.customLabel = finalLabel
            claim.elements = elements
            claim.isTrebleable = isTrebleable
            claim.isSurvivingSummaryJudgment = isSurvivingSummaryJudgment
            claim.statuteOfLimitations = hasStatuteOfLimitations ? statuteOfLimitations : nil
        } else {
            claim = Claim(
                type: type,
                customLabel: finalLabel,
                statuteOfLimitations: hasStatuteOfLimitations ? statuteOfLimitations : nil,
                elements: elements,
                isTrebleable: isTrebleable,
                isSurvivingSummaryJudgment: isSurvivingSummaryJudgment
            )
            modelContext.insert(claim)
            caseOwner?.claims.append(claim)
        }
        try? modelContext.save()
        dismiss()
    }
}

private extension ClaimType {
    var displayName: String {
        switch self {
        case .stateRacketeering: return AppSettings.stateRacketeeringLabel
        case .civilTheft: return "Civil theft"
        case .breachContract: return "Breach of contract"
        case .breachFiduciaryDuty: return "Breach of fiduciary duty"
        case .fraud: return "Fraud"
        case .conversion: return "Conversion"
        case .unjustEnrichment: return "Unjust enrichment"
        case .custom: return "Custom claim"
        }
    }
}
