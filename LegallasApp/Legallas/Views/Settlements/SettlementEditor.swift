// SPDX-License-Identifier: Apache-2.0
import SwiftUI
import SwiftData
import LegallasCore

struct SettlementEditor: View {

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    let existing: SettlementOffer?
    let caseOwner: Case?
    let baseScenario: DamagesScenario?

    @State private var fromParty: String = ""
    @State private var receivedAt: Date = Date()
    @State private var totalAmount: Decimal = 0
    @State private var cashAtClose: Decimal = 0
    @State private var hasInstallments: Bool = false
    @State private var installmentAmount: Decimal = 0
    @State private var installmentYears: Int = 1
    @State private var restrictiveCovenants: [String] = []
    @State private var contingencies: [String] = []

    var body: some View {
        Form {
            Section("Offer") {
                TextField("From party", text: $fromParty)
                DatePicker("Received", selection: $receivedAt, displayedComponents: .date)
                moneyField("Total nominal", value: $totalAmount)
                moneyField("Cash at close", value: $cashAtClose)
            }
            Section("Installments") {
                Toggle("Pay over time", isOn: $hasInstallments)
                if hasInstallments {
                    moneyField("Annual installment", value: $installmentAmount)
                    Stepper("\(installmentYears) year\(installmentYears == 1 ? "" : "s")",
                            value: $installmentYears, in: 1...20)
                }
            }
            stringListSection(title: "Restrictive covenants",
                              items: $restrictiveCovenants,
                              placeholder: "non-disparagement")
            stringListSection(title: "Contingencies",
                              items: $contingencies,
                              placeholder: "board approval")
        }
        .formStyle(.grouped)
        .frame(minWidth: 520, minHeight: 600)
        .onAppear(perform: bootstrap)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel") { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(existing == nil ? "Create" : "Save", action: save)
                    .disabled(fromParty.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    private func bootstrap() {
        guard let offer = existing else { return }
        fromParty = offer.fromParty
        receivedAt = offer.receivedAt
        totalAmount = offer.totalAmount
        cashAtClose = offer.cashAtClose
        hasInstallments = (offer.installmentAmount != nil) && (offer.installmentYears != nil)
        installmentAmount = offer.installmentAmount ?? 0
        installmentYears = offer.installmentYears ?? 1
        restrictiveCovenants = offer.restrictiveCovenants
        contingencies = offer.contingencies
    }

    private func save() {
        let trimmed = fromParty.trimmingCharacters(in: .whitespaces)
        let offer: SettlementOffer
        if let existing {
            offer = existing
            offer.fromParty = trimmed
            offer.receivedAt = receivedAt
            offer.totalAmount = totalAmount
            offer.cashAtClose = cashAtClose
            offer.installmentAmount = hasInstallments ? installmentAmount : nil
            offer.installmentYears = hasInstallments ? installmentYears : nil
            offer.restrictiveCovenants = restrictiveCovenants.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            offer.contingencies = contingencies.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        } else {
            offer = SettlementOffer(
                receivedAt: receivedAt,
                fromParty: trimmed,
                totalAmount: totalAmount,
                cashAtClose: cashAtClose,
                installmentAmount: hasInstallments ? installmentAmount : nil,
                installmentYears: hasInstallments ? installmentYears : nil,
                restrictiveCovenants: restrictiveCovenants.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty },
                contingencies: contingencies.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            )
            modelContext.insert(offer)
            caseOwner?.settlementOffers.append(offer)
        }

        if let base = baseScenario {
            let score = SettlementScorer.score(
                offer: SettlementInputs(from: offer),
                against: DamagesInputs(from: base)
            )
            offer.scoreSummaryMarkdown = score.rationaleMarkdown
        } else {
            offer.scoreSummaryMarkdown = """
            ## Settlement Score

            No base-tier damages scenario is present. Create one before relying on the scored ratio.
            """
        }

        try? modelContext.save()
        dismiss()
    }

    private func moneyField(_ title: String, value: Binding<Decimal>) -> some View {
        let formatter: NumberFormatter = {
            let f = NumberFormatter()
            f.numberStyle = .decimal
            f.maximumFractionDigits = 2
            return f
        }()
        return TextField(title, value: value, formatter: formatter)
            .multilineTextAlignment(.trailing)
    }

    private func stringListSection(
        title: String,
        items: Binding<[String]>,
        placeholder: String
    ) -> some View {
        Section(title) {
            ForEach(items.wrappedValue.indices, id: \.self) { index in
                HStack {
                    TextField(placeholder, text: Binding(
                        get: { items.wrappedValue[index] },
                        set: { items.wrappedValue[index] = $0 }
                    ))
                    Button {
                        items.wrappedValue.remove(at: index)
                    } label: {
                        Image(systemName: "minus.circle")
                    }
                    .buttonStyle(.borderless)
                }
            }
            Button {
                items.wrappedValue.append("")
            } label: {
                Label("Add", systemImage: "plus.circle")
            }
            .buttonStyle(.borderless)
        }
    }
}
