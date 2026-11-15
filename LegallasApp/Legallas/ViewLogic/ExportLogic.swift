// SPDX-License-Identifier: Apache-2.0
import Foundation
import LegallasCore

public enum ExportLogic {

    public static func buildMarkdown(from dto: CaseExportDTO) -> String {
        var out: [String] = []
        out.append(caseSection(dto.case))

        appendIfNonEmpty(&out, chronologySection(dto.events))
        appendIfNonEmpty(&out, claimsSection(dto.claims))
        appendIfNonEmpty(&out, damagesSection(dto.damagesScenarios))
        appendIfNonEmpty(&out, discoverySection(dto.discoveryItems))
        appendIfNonEmpty(&out, motionsSection(dto.motions))
        appendIfNonEmpty(&out, contactsSection(dto.parties))
        appendIfNonEmpty(&out, documentsSection(dto.settlementOffers, tasks: dto.tasks, deadlines: dto.deadlines, notes: dto.notes))

        return out.joined(separator: "\n\n") + "\n"
    }

    // MARK: - Sections

    static func caseSection(_ c: CaseExportDTO.CaseDTO) -> String {
        let caseNumber = c.caseNumber.isEmpty ? "Not assigned" : c.caseNumber
        let judge = c.judge.isEmpty ? "Not assigned" : c.judge
        let filed = c.filingDate > Case.notFiledDate ? Formatters.displayDate.string(from: c.filingDate) : "Not yet filed"
        return """
        # \(c.name)

        ## Case

        - Case number: \(caseNumber)
        - Court: \(c.court)
        - Judge: \(judge)\(c.courtroom.isEmpty ? "" : ", Courtroom \(c.courtroom)")
        - Filed: \(filed)
        """
    }

    static func chronologySection(_ events: [CaseExportDTO.ChronologyEventDTO]) -> String {
        guard !events.isEmpty else { return "" }
        let sorted = events.sorted { $0.date < $1.date }
        var lines = ["## Chronology", "", "| Date | Type | Title | Summary |", "| --- | --- | --- | --- |"]
        for e in sorted {
            let date = Formatters.displayDate.string(from: e.date)
            lines.append("| \(date) | \(e.type.rawValue) | \(escape(e.title)) | \(escape(e.summary)) |")
        }
        return lines.joined(separator: "\n")
    }

    static func claimsSection(_ claims: [CaseExportDTO.ClaimDTO]) -> String {
        guard !claims.isEmpty else { return "" }
        var lines = ["## Claims", ""]
        for c in claims {
            let label = c.customLabel ?? c.type.rawValue
            var bullet = "- **\(label)**"
            if c.isTrebleable { bullet += " (trebleable)" }
            if let sol = c.statuteOfLimitations {
                bullet += " (SOL \(Formatters.displayDate.string(from: sol)))"
            }
            lines.append(bullet)
            if !c.elements.isEmpty {
                lines.append("    - Elements: \(escape(c.elements))")
            }
        }
        return lines.joined(separator: "\n")
    }

    static func damagesSection(_ scenarios: [CaseExportDTO.DamagesScenarioDTO]) -> String {
        guard !scenarios.isEmpty else { return "" }
        var lines = ["## Damages", "", "| Scenario | Tier | NPV | Trebled NPV |", "| --- | --- | --- | --- |"]
        for s in scenarios {
            let npv = s.cachedNPV.map(Formatters.formatMoney) ?? "not computed"
            let trebled = s.cachedTrebledNPV.map(Formatters.formatMoney) ?? "not computed"
            lines.append("| \(escape(s.name)) | \(s.tier.rawValue) | \(npv) | \(trebled) |")
        }
        return lines.joined(separator: "\n")
    }

    static func discoverySection(_ items: [CaseExportDTO.DiscoveryItemDTO]) -> String {
        guard !items.isEmpty else { return "" }
        let sorted = items.sorted { lhs, rhs in
            if lhs.direction != rhs.direction { return lhs.direction.rawValue < rhs.direction.rawValue }
            return lhs.servedAt < rhs.servedAt
        }
        var lines = ["## Discovery", ""]
        for item in sorted {
            let label = discoveryHeadline(for: item)
            let served = Formatters.displayDate.string(from: item.servedAt)
            let due = item.dueAt.map { " (due \(Formatters.displayDate.string(from: $0)))" } ?? ""
            lines.append("- **\(label)** (\(item.direction.displayName), served \(served))\(due)")
            if !item.subject.isEmpty {
                lines.append("    - \(escape(item.subject))")
            }
        }
        return lines.joined(separator: "\n")
    }

    static func motionsSection(_ motions: [CaseExportDTO.MotionDTO]) -> String {
        guard !motions.isEmpty else { return "" }
        let ours = motions.filter { $0.filedBy == .us }.sorted { $0.filedAt < $1.filedAt }
        let theirs = motions.filter { $0.filedBy == .opponent }.sorted { $0.filedAt < $1.filedAt }

        var lines = ["## Motions"]
        if !ours.isEmpty {
            lines.append("")
            lines.append("### Ours")
            for m in ours { lines.append(motionBullet(m)) }
        }
        if !theirs.isEmpty {
            lines.append("")
            lines.append("### Theirs")
            for m in theirs { lines.append(motionBullet(m)) }
        }
        return lines.joined(separator: "\n")
    }

    static func contactsSection(_ contacts: [CaseExportDTO.ContactDTO]) -> String {
        guard !contacts.isEmpty else { return "" }
        var lines = ["## Contacts", "", "| Name | Role | Organization | Email |", "| --- | --- | --- | --- |"]
        for c in contacts.sorted(by: { $0.name < $1.name }) {
            lines.append("| \(escape(c.name)) | \(c.role.rawValue) | \(escape(c.organization ?? "")) | \(escape(c.email ?? "")) |")
        }
        return lines.joined(separator: "\n")
    }

    static func documentsSection(
        _ offers: [CaseExportDTO.SettlementOfferDTO],
        tasks: [CaseExportDTO.CaseTaskDTO],
        deadlines: [CaseExportDTO.DeadlineDTO],
        notes: [CaseExportDTO.NoteDTO]
    ) -> String {
        var parts: [String] = []

        if !tasks.isEmpty {
            var lines = ["## Tasks", ""]
            for t in tasks.sorted(by: { ($0.dueDate ?? .distantFuture) < ($1.dueDate ?? .distantFuture) }) {
                let due = t.dueDate.map { " (due \(Formatters.displayDate.string(from: $0)))" } ?? ""
                lines.append("- [\(t.status.rawValue)] \(escape(t.title)) (\(t.priority.rawValue))\(due)")
            }
            parts.append(lines.joined(separator: "\n"))
        }

        if !deadlines.isEmpty {
            var lines = ["## Deadlines", "", "| Date | Title | Anchor | Satisfied |", "| --- | --- | --- | --- |"]
            for d in deadlines.sorted(by: { $0.computedDate < $1.computedDate }) {
                let date = Formatters.displayDate.string(from: d.computedDate)
                lines.append("| \(date) | \(escape(d.title)) | \(d.anchor.rawValue) \(d.direction.rawValue) \(d.offsetDays) | \(d.isSatisfied ? "yes" : "no") |")
            }
            parts.append(lines.joined(separator: "\n"))
        }

        if !offers.isEmpty {
            var lines = ["## Settlement Offers", ""]
            for o in offers.sorted(by: { $0.receivedAt < $1.receivedAt }) {
                lines.append("- \(Formatters.displayDate.string(from: o.receivedAt)): \(escape(o.fromParty)) offered \(Formatters.formatMoney(o.totalAmount)) (cash \(Formatters.formatMoney(o.cashAtClose)))")
            }
            parts.append(lines.joined(separator: "\n"))
        }

        if !notes.isEmpty {
            var lines = ["## Notes", ""]
            for n in notes.sorted(by: { $0.updatedAt > $1.updatedAt }) {
                let title = n.title ?? "(untitled)"
                lines.append("### \(escape(title))")
                lines.append("")
                lines.append(n.bodyMarkdown)
                lines.append("")
            }
            parts.append(lines.joined(separator: "\n"))
        }

        return parts.joined(separator: "\n\n")
    }

    // MARK: - Helpers

    static func discoveryHeadline(for item: CaseExportDTO.DiscoveryItemDTO) -> String {
        let setLabel = "\(item.category.shortLabel) Set \(item.setNumber)"
        if let n = item.itemNumber { return "\(setLabel) #\(n)" }
        return setLabel
    }

    static func motionBullet(_ m: CaseExportDTO.MotionDTO) -> String {
        let filed = Formatters.displayDate.string(from: m.filedAt)
        var bullet = "- **\(escape(m.title))** (\(m.motionType.displayName), filed \(filed), \(m.status.rawValue))"
        if let hearing = m.hearingAt {
            bullet += " (hearing \(Formatters.displayDate.string(from: hearing)))"
        }
        return bullet
    }

    static func timestampedFileName(prefix: String, ext: String, now: Date = Date()) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyyMMdd-HHmmss"
        f.timeZone = DateMath.denverTimeZone
        return "\(prefix)-\(f.string(from: now)).\(ext)"
    }

    private static func appendIfNonEmpty(_ out: inout [String], _ section: String) {
        if !section.isEmpty { out.append(section) }
    }

    private static func escape(_ s: String) -> String {
        s.replacingOccurrences(of: "|", with: "\\|")
         .replacingOccurrences(of: "\n", with: " ")
    }
}
