# What an outstanding litigation document room must do: research for the Data room page

Read on 2026-11-01. Public law and public standards only, generic concepts only. Research, not legal advice: no lawyer has read this. Nothing here has been run against the product. Every test below is a draft to run against the product or the invented sample room.

**Status key.** "verified" means the primary text was opened. "verified-s" means it was opened only through a summarising fetch tool or a connector's summary, so check the wording before quoting it. "unverified" means it was not opened, or was seen only as a search snippet.

**A word on the word.** "Verified" here is a research status for this file. The product and the page follow A1 of the product notices: "Checked against [source] on [date]".

**Sample room for the tests.** Invented from scratch, Doe v. Harbor Labs, control prefix DOE. It needs: email families, one family with a withheld child, one redacted document, one spreadsheet with a hidden row, one document with tracked changes, planted fake identifiers (fake SSN, TIN, birth date, minor's name, account number), a unique canary string in each withheld or redacted passage, investor accounts, one director-designee account, own counsel, opposing counsel, one item received under an invented protective order, and one test connector.

---

## 1. Sources

### Federal rules

| ID | Title | Publisher | URL or citation | Date read | Status |
|---|---|---|---|---|---|
| S1 | Federal Rules of Civil Procedure, December 1, 2025 pamphlet | U.S. Courts | https://www.uscourts.gov/sites/default/files/document/federal-rules-of-civil-procedure.pdf | 2026-11-01 | read in part: Rules 16(b)(3)(B)(iv), 26(b)(5)(A), 34(b)(2)(E) checked in raw text |
| S2 | Rule 26 with committee notes, including 1993, 2006 and 2025 | Cornell LII | https://www.law.cornell.edu/rules/frcp/rule_26 | 2026-11-01 | read, raw text |
| S3 | Rule 16 with 2025 committee note | Cornell LII | https://www.law.cornell.edu/rules/frcp/rule_16 | 2026-11-01 | read, raw text |
| S4 | Rule 34 with 2006 and 2015 notes | Cornell LII | https://www.law.cornell.edu/rules/frcp/rule_34 | 2026-11-01 | read through summarising fetch; rule text for (b)(2)(E) also checked in S1 |
| S5 | Rule 37 with 2015 note | Cornell LII | https://www.law.cornell.edu/rules/frcp/rule_37 | 2026-11-01 | read through summarising fetch |
| S6 | Rule 5.2 | Cornell LII | https://www.law.cornell.edu/rules/frcp/rule_5.2 | 2026-11-01 | read through summarising fetch |
| S7 | Rule 45 | Cornell LII | https://www.law.cornell.edu/rules/frcp/rule_45 | 2026-11-01 | read through summarising fetch |
| S8 | Pending Rules and Forms Amendments | U.S. Courts | https://www.uscourts.gov/forms-rules/pending-rules-and-forms-amendments | 2026-11-01 | read through summarising fetch |
| S9 | Supreme Court order of April 23, 2025 transmitting the civil rule amendments | Supreme Court | https://www.supremecourt.gov/orders/courtorders/frcv25_limp.pdf | 2026-11-01 | unverified: search result only |
| S10 | Fed. R. Evid. 502 with explanatory note | Cornell LII | https://www.law.cornell.edu/rules/fre/rule_502 | 2026-11-01 | read, raw text |
| S11 | Fed. R. Evid. 901 | Cornell LII | https://www.law.cornell.edu/rules/fre/rule_901 | 2026-11-01 | read, raw text |
| S12 | Fed. R. Evid. 902 with 2017 note | Cornell LII | https://www.law.cornell.edu/rules/fre/rule_902 | 2026-11-01 | read, raw text |
| S13 | Advisory Committee on Evidence Rules, May 7, 2026 materials on proposed Rules 707 and 901(c) | U.S. Courts | https://www.uscourts.gov/sites/default/files/document/2026-05_minutes_of_the_spring_2026_advisory_committee_meeting.pdf | 2026-11-01 | unverified: search snippet only |

### The Sedona Conference and EDRM

| ID | Title | Publisher | URL or citation | Date read | Status |
|---|---|---|---|---|---|
| S14 | The Sedona Principles, Third Edition, 19 Sedona Conf. J. 1 (2018) | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/publications/The%20Sedona%20Principles%20Third%20Edition.19TSCJ1.pdf | 2026-11-01 | read: the 14 principles; comments only where cited |
| S15 | Commentary on Legal Holds, Second Edition: The Trigger & The Process, 20 Sedona Conf. J. 341 (June 2019) | The Sedona Conference | https://www.thesedonaconference.org/publication/Commentary_on_Legal_Holds | 2026-11-01 | unverified for final wording: publication page opened, final PDF not reached |
| S16 | Same commentary, December 2018 public comment version, marked superseded | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/publications/Commentary%20on%20Legal%20Holds%20Second%20Edition%20extended%20PC%20period_0.pdf | 2026-11-01 | read: the 12 guidelines. A draft, so check against S15 |
| S17 | Commentary on Privilege Logs, 25 Sedona Conf. J. (May 2024) | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/publications/Commentary-on-Privilege-Logs-May-2024.pdf | 2026-11-01 | read in part: pp. 229, 235, 277 to 278, 287 to 288, Appendix B |
| S18 | Commentary on Protection of Privileged ESI, 17 Sedona Conf. J. 95 | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/publications/Commentary%20on%20Protection%20of%20Privileged%20ESI.17TSCJ95.pdf | 2026-11-01 | read in part: Rule 502(d) passages |
| S19 | Commentary on ESI Evidence & Admissibility, Second Edition, 22 Sedona Conf. J. (2021) | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/publications/2_ESI_Evidence_and_Admissibility_0.pdf | 2026-11-01 | read in part: Rule 902(13), (14) passages, pp. 99 to 104 |
| S20 | Publications list | The Sedona Conference | https://www.thesedonaconference.org/publications | 2026-11-01 | read: no commentary on ESI redaction is listed |
| S21 | Primer on Artificial Intelligence and the Practice of Law (2025) | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/publications/Primer_on_Artificial_Intelligence_and_the_Practice_of_Law_June_2025_0.pdf | 2026-11-01 | unverified: search snippet only |
| S22 | Primer on GenAI in Discovery, member comment draft of April 30, 2026 | The Sedona Conference | https://www.thesedonaconference.org/sites/default/files/2026-04/Primer%20on%20GenAI%20in%20Discovery%20-%20Member%20Comment%20Draft%2004-30-26.pdf | 2026-11-01 | unverified: search snippet only, and a draft |
| S23 | EDRM Privilege Log Protocol, Version 2.0 (2023) | EDRM | https://edrm.net/wp-content/uploads/2023/09/EDRM-PrivilegeLogProtocol-final.pdf | 2026-11-01 | read |
| S24 | EDRM Production guide | EDRM | https://edrm.net/resources/frameworks-and-standards/edrm-model/production/ | 2026-11-01 | read through summarising fetch |

### Delaware

| ID | Title | Publisher | URL or citation | Date read | Status |
|---|---|---|---|---|---|
| S25 | Rules of the Court of Chancery, compilation with amendments effective June 1, 2026 | Delaware Courts | https://courts.delaware.gov/forms/download.aspx?id=160908 | 2026-11-01 | read in part: Rules 5.1, 26 structure, 34, 37(e), 45(d)(2) |
| S26 | Guidelines for Persons Litigating in the Court of Chancery, updated October 15, 2024, section on Discovery | Delaware Courts | https://courts.delaware.gov/forms/download.aspx?id=99468 | 2026-11-01 | read: preservation, privilege logs, confidentiality, expedited document review |
| S27 | Sample quick-peek stipulation, Exhibit 11 to the Guidelines, published 7/12/2024 | Delaware Courts | https://courts.delaware.gov/forms/download.aspx?id=130308 | 2026-11-01 | read in part |
| S28 | Delaware Uniform Rules of Evidence, D.R.E. 502 and 510 | Delaware Courts | https://courts.delaware.gov/forms/download.aspx?id=39388 | 2026-11-01 | read; currency of this copy not confirmed |
| S29 | Appendix B, E-Discovery Plan Guidelines, Superior Court Complex Commercial Litigation Division | Delaware Courts | https://courts.delaware.gov/superior/pdf/ccld_appendix_b.pdf | 2026-11-01 | read. Superior Court, not Chancery |
| S30 | Default Standard for Discovery, Including Discovery of ESI | D. Del. | https://www.ded.uscourts.gov/sites/ded/files/pages/Electronic%20Discovery%20Default%20Standard_0.pdf | 2026-11-01 | read in part |

### Colorado

| ID | Title | Publisher | URL or citation | Date read | Status |
|---|---|---|---|---|---|
| S31 | Rule Change 2015(05), C.R.C.P., including Rule 26(b)(5) and the case management order's ESI paragraph | Colorado Judicial Branch | https://www.coloradojudicial.gov/media/12395 | 2026-11-01 | read in part; currency of the text not confirmed |
| S32 | Rule Change 2016(03), C.R.E. 502 | Colorado Judicial Branch | https://www.coloradojudicial.gov/sites/default/files/2023-06/Rule_Change_2016-03.pdf | 2026-11-01 | read |
| S33 | Guidelines Addressing the Discovery of ESI, September 1, 2014 | D. Colo. | https://www.cod.uscourts.gov/Portals/0/Documents/Forms/CivilForms/E-Discovery_Guidelines.pdf | 2026-11-01 | read |
| S34 | Local Rules, D.C.COLO.LCivR 7.2 | D. Colo. | https://www.cod.uscourts.gov/Portals/0/Documents/LocalRules/2025_Final_Local_Rules.pdf?ver=ZtBeKMjc1vyU_c0XUL_wIA%3D%3D | 2026-11-01 | read: Rule 7.2 |

### Agency specifications and model orders

| ID | Title | Publisher | URL or citation | Date read | Status |
|---|---|---|---|---|---|
| S35 | Data Delivery Standards, Rev 08/2026 | SEC | https://www.sec.gov/files/sec-dds-aug-2026.pdf | 2026-11-01 | read |
| S36 | Model timing agreement, marked 07/2026 | DOJ Antitrust Division | https://justice.gov/atr/media/1453731/dl?inline= | 2026-11-01 | read: privilege log and form of production parts |
| S37 | Electronic Production Letter, Attachment 1, updated June 25, 2015 | DOJ Antitrust Division | https://www.justice.gov/atr/electronic-production-letter-attachment-1 | 2026-11-01 | read through summarising fetch; may be dated |
| S38 | Summation Database Specifications (August 2008) and Submission Requirements (February 2007) | DOJ Antitrust Division | https://www.justice.gov/sites/default/files/atr/legacy/2009/03/24/243194d.pdf | 2026-11-01 | read; old |
| S39 | ESI stipulation, United States v. Google LLC, No. 1:20-cv-03010-APM (D.D.C.) | DOJ Antitrust Division site | https://www.justice.gov/atr/case-document/file/1428266/dl | 2026-11-01 | read in part |
| S40 | Model protective order for highly sensitive information | N.D. Cal. | https://cand.uscourts.gov/sites/default/files/documents/ND_Cal_Patent_Highly_Sensitive_Model_Prot_Ord_Revised.pdf | 2026-11-01 | read in part |

### Product rules and skill

| ID | Title | Publisher | Location | Date read | Status |
|---|---|---|---|---|---|
| S41 | Product notices, A1, A7, A8 | This repository | `docs/legal/product-notices.md` | 2026-11-01 | read; binding on product wording |
| S42 | The document set and the law, preservation rows | This repository | `docs/design/document-set-and-law.md` | 2026-11-01 | read in part |
| S43 | Skill `litigation-legal:privilege-log-review` | Plugin | loaded through the Skill tool; interview and config skipped as instructed | 2026-11-01 | read: log fields, record fidelity, attorney gate. Practice guidance, not law |

### Cases and orders

Connector tags: [Descrybe], [CourtListener], [govinfo]. "Passages" means the opinion's own text was read in part. "Summary" means only the connector's summary was read, so pinpoints are unchecked.

| ID | Case | Citation | Connector and depth | Status |
|---|---|---|---|---|
| C1 | Burlington N. & Santa Fe Ry. v. U.S. Dist. Ct. | 408 F.3d 1142 (9th Cir. 2005) | [Descrybe] summary | read, summary |
| C2 | In re Grand Jury Subpoena | 274 F.3d 563 (1st Cir. 2001) | [Descrybe] summary | read, summary |
| C3 | EEOC v. BDO USA, L.L.P. | 856 F.3d 356 (5th Cir. 2017) | [Descrybe] summary | read, summary |
| C4 | Mechel Bluestone, Inc. | Del. Ch. Dec. 12, 2014; 2014 WL 7011195, as cited in C5 | [Descrybe] summary and passages | read |
| C5 | Principal Growth Strategies, LLC v. AGH Parent LLC | C.A. No. 2019-0431-JTL (Del. Ch. Nov. 28, 2025) | [Descrybe] passages | read |
| C6 | In re Oxbow Carbon LLC Unitholder Litig. | Del. Ch. Mar. 13, 2017 | [Descrybe] summary and passages | read, summary |
| C7 | TCV VI, L.P. v. TradingScreen, Inc. | Del. Ch. Sept. 25, 2015 | [Descrybe] summary | read, summary |
| C8 | Goldstein v. Denner | 310 A.3d 548 (Del. Ch. 2024) | [CourtListener] snippets of a later ruling in the same case, plus quotations in C9 | read in part |
| C9 | In re World Wrestling Entertainment, Inc. Merger Litig. | Del. Ch. May 26, 2026 | [CourtListener] snippets | read in part; later history open |
| C10 | Terra Mgmt. Grp., LLC v. Keaten | 2025 CO 40 (Colo. June 23, 2025) | [Descrybe] passages, ¶¶ 31 to 39, 44, n.4 | read |
| C11 | Aloi v. Union Pac. R.R. Corp. | 129 P.3d 999 (Colo. 2006) | [Descrybe] summary, and through C10, C13 | read, summary |
| C12 | Pfantz v. Kmart Corp. | 85 P.3d 564 (Colo. App. 2003) | [Descrybe] summary, and through C13 | read, summary |
| C13 | MarkWest v. Rose | Colo. App. Apr. 24, 2025; full caption not confirmed | [Descrybe] passages, ¶¶ 59 to 67 | read |
| C14 | Cache La Poudre Feeds, LLC v. Land O'Lakes, Inc. | 244 F.R.D. 614 (D. Colo. 2007) | [Descrybe] passages | read in part |
| C15 | Hyde Park Venture Partners Fund III, L.P. v. FairXchange, LLC | Del. Ch. Mar. 9, 2023 | [Descrybe] passages | read |
| C16 | In re CBS Corp. Litig. (describes Kalisman v. Friedman, which was not opened) | Del. Ch. July 13, 2018 | [Descrybe] summary | read, summary |
| C17 | Enhabit, Inc. v. Nautic Partners IX, L.P. | Del. Ch. Sept. 8, 2023 | [Descrybe] summary | read, summary |
| C18 | Online HealthNow, Inc. v. CIP OCL Investments, LLC | Del. Ch. Aug. 12, 2021 (pleading stage) | [Descrybe] passages | read |
| C19 | Ashland LLC v. Samuel J. Heyman 1981 Continuing Trust | Del. Super. June 21, 2018 | [Descrybe] summary | read, summary |
| C20 | United States v. O'Keefe | 537 F. Supp. 2d 14 (D.D.C. 2008) | [Descrybe] summary and passages | read |
| C21 | City of Colton v. Am. Promotional Events, Inc. | 277 F.R.D. 578 (C.D. Cal. 2011) | [Descrybe] summary | read, summary |
| C22 | Aguilar v. ICE | 255 F.R.D. 350 (S.D.N.Y. 2008) | [Descrybe] summary | read, summary |
| C23 | National Jewish Health v. WebMD Health Servs. Grp., Inc. | 305 F.R.D. 247 (D. Colo. 2014) | [Descrybe] summary and passages | read |
| C24 | D.M. v. County of Merced | E.D. Cal. Mar. 9, 2022 | [Descrybe] passages | read |
| C25 | Lorraine v. Markel Am. Ins. Co. | 241 F.R.D. 534 (D. Md. 2007) | [Descrybe] passages | read in part |
| C26 | CA, Inc. v. Simple.com, Inc. | 780 F. Supp. 2d 196 (E.D.N.Y. 2009) | [Descrybe] summary | read, summary |
| C27 | Adams v. Medtronic, Inc. | E.D. Tex. Jan. 23, 2024 | [Descrybe] passages | read |
| C28 | Cudd Pressure Control, Inc. v. New Hampshire Ins. | 297 F.R.D. 495 (W.D. Okla. 2014) | [Descrybe] summary | read, summary |
| C29 | Frame-Wilson v. Amazon.com Inc | W.D. Wash. Mar. 25, 2025 | [Descrybe] summary | read, summary |
| C30 | In re Testosterone Replacement Therapy Prods. Liab. Litig. | 301 F. Supp. 3d 917 (N.D. Ill. 2018) | [Descrybe] summary | read, summary |
| C31 | General Motors LLC v. Ashton | D.N.J. Feb. 3, 2023 | [Descrybe] passages | read |
| C32 | Sagacity, Inc. v. BCE-Mach III LLC | E.D. Okla. Aug. 12, 2024 | [Descrybe] summary | read, summary |
| C33 | United States ex rel. Simms v. Austin Radiological Assoc. | 292 F.R.D. 378 (W.D. Tex. 2013) | [Descrybe] summary | read, summary |
| C34 | Gaudet & Co. v. ACE Fire Underwriters Ins. Co. | S.D. Ala. Feb. 6, 2024 | [Descrybe] summary | read, summary |
| C35 | Gillard v. Boulder Valley Sch. Dist. Re-2 | 196 F.R.D. 382 (D. Colo. 2000) | [Descrybe] passages | read |
| C36 | Morgan v. V2X, Inc. | No. 25-cv-01991 (D. Colo. Mar. 30, 2026) (magistrate judge) | [govinfo] https://www.govinfo.gov/content/pkg/USCOURTS-cod-1_25-cv-01991/pdf/USCOURTS-cod-1_25-cv-01991-0.pdf | read in part |
| C37 | Myles v. State Farm Gen. Ins. Co. (stipulated protective order) | C.D. Cal. June 3, 2026 | [Descrybe] passages | read |
| C38 | Wilmington Trust v. Kingsbridge Realty Assocs. (protective order) | S.D.N.Y. June 4, 2026 | [Descrybe] summary | read, summary |
| C39 | DIRECTV, LLC v. Nexstar Media Grp. (protective order) | S.D.N.Y. June 17, 2026 | [Descrybe] summary | read, summary |
| C40 | 5000 Plus LLC v. Majestic Steel USA (protective order) | D. Nev. June 24, 2026 | [Descrybe] summary | read, summary |
| C41 | United States v. Heppner | No. 1:25-cr-00503 (S.D.N.Y. Feb. 17, 2026), ECF 27; 2026 WL 436479 as cited in C36 | [CourtListener] docket entry text only | unverified for the opinion's reasoning |
| C42 | Wright v. Majestic Care Staff LLC (clawback order) | S.D. Ohio Oct. 4, 2021 | [Descrybe] summary | read, summary |
| C43 | Harrison v. Barclay | Colo. App. Sept. 5, 2024 | [Descrybe] summary | read, summary |

**Citation coverage, per the skill's record-fidelity rule.** Found 86 authorities (43 sources, 43 cases and orders). Opened in primary text, whole or in part: 49. Opened only through a summarising tool or connector summary: 31 (S4 to S8, S24, S37 and 24 cases). Could not be opened, so not confirmed: 6 (S9, S13, S15 final text, S21, S22, C41's opinion). A partial read supports only what the row says it supports.

---

## 2. Requirements

### Three findings that shape the whole table

**The numbering test is a practice standard, not a rule.** No federal, Delaware or Colorado rule read here requires Bates numbers, continuous numbers, or gaps that match withheld items. Sedona notes that practitioners differ: some number fully withheld documents with a slip sheet, some give them no number (S17, App. B). The strongest public text is DOJ's old submission requirement, which asks for each custodian's ranges and any gaps in them (S38), and DOJ's 2026 log list, which expects beginning and ending control numbers for withheld documents (S36). The page should say this standard is one the product chose, drawn from those specifications.

**Rule 26(b)(5)(A) does not require a log or list its fields.** It requires an express claim and a description that "will enable other parties to assess the claim" (S2). Sedona makes the same point (S17, p. 229). The December 1, 2025 amendments did take effect: Rule 26(f)(3)(D) and Rule 16(b)(3)(B)(iv) now reach the timing and method of complying (S1, S2, S3). The notes refuse a single format and warn about a log served near the close of discovery. Rule 26(b)(5)(A) itself was not changed. So nothing can honestly claim a "compliant log"; the test is whether the room can produce whichever method a court or the parties set, and whether the entries are complete.

**Three forums, three standards for lost records.** The room has to be built for the strictest.

| Forum | Duty starts | Harshest remedies need | Source |
|---|---|---|---|
| Federal | Litigation reasonably foreseeable | Intent to deprive; negligence and gross negligence are not enough | Rule 37(e), 2015 note (S5) |
| Delaware Chancery | Reasonable anticipation or actual notice of imminent litigation | Reckless or intentional; Chancery defines recklessness as conscious awareness of the risk | Ct. Ch. R. 37(e) (S25); C9 |
| Colorado state | Party knew or should have known litigation was pending or reasonably foreseeable | No comparable rule. Willfulness suffices and bad faith is not needed; negligence may support an inference to remedy harm | C10 ¶¶ 35, 38, n.4; C11; C12; C13 ¶¶ 66 to 67 |

### A. Preservation and legal hold

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| P1 | A hold can start before any suit exists | Duty can attach before filing | S5, S25 Rule 37(e), S26 §7.a.vi, C10 ¶¶ 37 to 38, S16 G1 | verified | Turn on a hold in a room with no case number and no complaint. Pass if it succeeds and stores start date, time and the acting account |
| P2 | Dispute notice comes first | Product rule | S41 A8 | verified | Tell the sample room a dispute has started. Pass if the first rendered block is the A8 text, string for string, before any other content |
| P3 | Hold blocks every way of losing a record | Reasonable steps; routine operation may need to be interrupted | S5, S25 Rule 37(e), C8, C9, S41 A7 | verified-s | With a hold on, a script calls every delete, purge, overwrite, cleanup and uninstall path in the UI, API, connector and scheduled jobs. Pass if each is refused, each refusal writes a log row, and object count and every SHA-256 are unchanged |
| P4 | Retention and expiry jobs stop | Same; suspend routine deletion | S5, S33 Cmt. 2.2(f), C9 | verified-s | Advance the test clock past the longest retention and room-expiry setting. Pass if zero objects are removed or archived |
| P5 | Old versions survive | Multiple versions make the operative one hard to prove | C25, S5 | verified-s | Replace DOE-000010 during a hold. Pass if version 1 is retrievable byte for byte, and each version has its own hash and date |
| P6 | Hold notice has the working parts | Written notices to custodians; notice content | S26 §7.a.ii, iv(B), S16 G8 | verified | The notice record must hold: custodian list, how to preserve, named contact, acknowledgment, auto-delete instruction. Pass if all five fields are populated and each custodian has an acknowledged time or appears on an exported "not acknowledged" list |
| P7 | Amended notices go to everyone, and old ones stay | Updated instructions; periodic review and reminders; monitoring | S26 §7.a.iv(B), S16 G8(f), (g), G10 | verified | Amend the notice. Pass if version 2 reaches all custodians, version 1 is kept, and the screen shows last reminder date and next due date |
| P8 | Preservation steps are documented in one export | Document the steps; document the procedure | S26 §7.a.iv(C), S16 G9 | verified | Pass if one action exports a dated list of every hold step with no hand assembly, and its row count equals the hold events in the log |
| P9 | Sources outside the room are named, not implied | Laptops, home computers, phones, USB drives, personal email, texts and messaging are named problem areas; identify inaccessible sources; third parties | S26 §7.a.v, S2 Rule 26(b)(2)(B), S33 Cmt. 2.2(e), 3.6, S41 A7 | verified | Hold screen shows the A7 "can't reach" list verbatim. A register has one row per source with state held in room, outside room, or not reasonably accessible with a reason. Pass if no row is blank and the product makes no statement that outside sources are preserved |
| P10 | Notice covers auto-delete and old devices | Individuals must disable auto-delete and back up before disposing of a device; circulating a hold is not enough | C9, C8 | verified-s | Pass if the notice template contains both instructions and the acknowledgment is per person |
| P11 | Loss is detected and reported | Rule turns on loss that cannot be restored or replaced; lost means not retrievable from another source | S5, S25 Rule 37(e), C9 | verified-s | Remove one stored object out of band. Pass if the next integrity run names the control number, last hash, last seen date and any other known custodian copy |
| P12 | Logs are exported on the promised schedule | Product rule | S41 A7 | verified | With a hold on, simulate 7 days. Pass if there are 7 exports and each export's hash is recorded in the next |
| P13 | Release is a recorded act by the right role | Release provisions | S16 G11 | verified | Release as a non-counsel role: refused. Release as the invited lawyer: stores date and reason and cannot be back-dated. Pass if deletion stays blocked until that event exists |

### B. Numbering

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| N1 | Each number is unique for all time | Unique, sequential control numbers | S35 §I.1.e, f, S39 App. A, §(a) | verified | Over the full history, including removed and clawed-back items, pass if no number is assigned twice and retired numbers are never reissued |
| N2 | Numbering is continuous and every number is accounted for | Practice standard; ranges and gaps are reported | S38, S36, S35 §I.1.f | verified | Let A be every integer from first to last control number, P produced, W withheld in full per the log, T all other states. Pass if P, W and T are pairwise disjoint and their union equals A |
| N3 | Every other state has a reason from a closed list | Objections must say whether anything is withheld; material outside search limits counts as withheld | S4 Rule 34(b)(2)(C), 2015 note | verified-s | Each row in T carries one reason from a fixed list, such as duplicate suppressed, not responsive, withheld on objection, reserved. Pass if none is blank or free text |
| N4 | Gap report exists per custodian | Ranges and gaps per custodian; Bates range per custodian | S38 §B.4, S35 General 1.c | verified | Plant a gap. Pass if the report lists it under the right custodian with its reason |
| N5 | Number format is accepted by both agencies | SEC bars spaces and allows hyphen and underscore. DOJ wants hyphens, up to three segments, a 6 to 8 digit sequence, no spaces, slashes or underscores | S35 §I, S37 | verified-s | Pass if every number matches `^[A-Z0-9]+(-[A-Z0-9]+){0,2}$`, the last segment is 6 to 8 digits at one width, e.g. DOE-000001 |
| N6 | Number is part of the image | Endorsed on each image, lower right; not an overlay; stamps burned in | S35 §I.1.f, S39 §(a), S24 | verified-s | Rasterize each produced page. Pass if OCR of the lower right returns the expected number and the file has no removable annotation holding it |
| N7 | Families stay together | Children follow parents in sequence | S35 General 4, S39 | verified | For each family, pass if child numbers immediately follow the parent and BEGATTACH to ENDATTACH covers all members, including withheld ones |
| N8 | Natives carry a number | Native gets a number; placeholder image named by number; linked file named by first number | S35 §I.1.h, §I.5, S37, S39 | verified-s | For a spreadsheet, pass if the placeholder page shows the number, the file name equals FIRSTBATES and LINK resolves |
| N9 | A withheld document is never silent | Slip sheet or log, practices differ | S17 App. B, S36 | verified | For each fully withheld document, pass if it has a slip sheet carrying only number and withheld notice, or its range is in the log. Fail if neither |

### C. Privilege logs

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| L1 | Every withheld range appears exactly once | Express claim required; no log or an unlisted entry can mean waiver | S2 Rule 26(b)(5)(A), S7 Rule 45(e)(2)(A), S25 Rule 45(d)(2), S31, C2, C4, C5 n.126 | verified | Expand all log ranges to single numbers. Pass if the multiset equals W with no duplicate and no omission |
| L2 | Every entry points to a real range | Same | S2, S36 | verified | Pass if for every entry begin is at or below end, both exist in the register, and each number's state is withheld or redacted. Fail on any entry touching a number produced in full |
| L3 | Redactions are logged or stated on the face, by a recorded choice | Redaction logs are common; can be dropped when the face shows the same facts and the parties agree; load file flags redacted documents | S26 §7.c.iv(D), g.v(C), S17 pp. 277 to 278, S23 ¶5 | verified | Pass if each redacted document either has a log row or, where a recorded agreement drops the log, a populated redacted field plus a basis on the redaction box. Count of flags equals count in the redaction list |
| L4 | Every entry states a privilege basis | 467 entries with none were waived; assert each basis | C5, S17 App. B, S36 | verified | Pass if zero entries have a blank basis and values come from attorney-client, work product, common interest or another named basis |
| L5 | Every entry names a lawyer or says why not | Category and document entries must identify the attorney; no-attorney entries need a reason | C5 and n.115, C6, S26 §7.c.iv(E) | verified | Pass if each entry lists a person flagged as a lawyer in the legend or has a non-empty counsel explanation, and the export reports how many took the second path |
| L6 | Log carries the full field set | DOJ's 2026 list; Delaware elements: date, parties and positions, attorneys, description | S36, C6, C7, S17 p. 229, S43 | verified | Pass if the export has ID, begin and end number, parent, attachments, family range, page count, authors, addressees, BCC, other recipients, date, document type, redacted flag, basis, description. Only BCC may be empty across a whole log |
| L7 | Players list resolves every name | Titles, affiliations, group members, name variants, lawyers marked; entries naming someone absent from the list were waived | S36, S26 §7.c.iv(F), S23 ¶9, C4, C5 | verified | Pass if every name on every entry maps to exactly one legend row with title, affiliation and lawyer flag, each group expands to members, each alias maps to a person, and unresolved count is 0 |
| L8 | Outsiders on an entry are explained | Non-party authors or recipients need a stated basis | S26 §7.c.iv(F), C4 | verified | Pass if every entry with a person whose legend affiliation is outside client and counsel has a non-empty explanation written by counsel, and the export counts them |
| L9 | Work product entries name the litigation | Identify the litigation reasonably anticipated | C5, C6 | verified | Pass if every work product entry has a non-empty anticipated matter field and date |
| L10 | Repeated descriptions are surfaced | Court discourages short lists of repeats; descriptions should be document-specific | S26 §7.c.iv(E), C6, C5 | verified | Exporter lists each description string used on more than one non-family entry, with counts. Pass if the list is shown before service. It measures repetition only and makes no call on adequacy |
| L11 | The log does not leak | Description must not reveal the protected content; subject and file name fields may need redaction, with edits shown | S2, S17 p. 287, S23 ¶6 | verified | Pass if canary strings from withheld bodies appear in no log field, and subject and file name fields are flagged for counsel with any edit marked as an edit |
| L12 | Log is a working spreadsheet | Provide Excel or Word on request; sortable spreadsheet | S26 §7.c.iv(H), S23 ¶8 | verified | Pass if .xlsx and .csv open with one header row and row count equals entries |
| L13 | Rolling logs keep numbering | Timing and method; rolling logs are favoured; continue numbers, do not restart | S1, S2, S3 2025 notes, S17 App. B, S23 ¶8 | verified | Serve log 1, add 5 withheld items, serve log 2. Pass if IDs continue, a cumulative file is the union, and earlier rows are marked with their service date |
| L14 | The method can be chosen | No single format; Sedona prefers metadata plus topic; combo logs work only narrowly | S2, S3, S17 p. 235, S23 ¶6, C5 | verified | From one register, pass if the room exports traditional, metadata-plus-topic and category formats, and each category row still names attorney, basis and description |
| L15 | Exclusions need a recorded agreement | Post-suit cut-off is common; a unilateral shortcut risks waiver | S26 §7.c.iv(A), g.v(B), (E), S30, S17, S33 | verified | Set a cut-off with a blank agreement or order field: refused. With one filled: pass if later items drop out and the excluded count prints on the log |
| L16 | Log deadline is tracked | Timing can decide waiver; a missed ordered deadline can waive | C1, C5, S2 2025 note | verified-s | Pass if the room stores a due date, shows overdue past it, and stores each service date |
| L17 | Attachments are handled separately and linked | Parent and sibling designation; family identifier; assess attachments separately | S37, S17 App. B, S43 | verified-s | Pass if a withheld child has a parent reference and family range, and its claim state can differ from its parent's |
| L18 | A folder mark is not a claim | Product rule | S41 A1, A7 | verified | Mark a folder. Pass if no log row appears until counsel confirms, and the label reads "Marked privileged by you" |
| L19 | Nothing strips or asserts by itself | Skill rule: keep the designation and flag; attorney decides; gate before service | S43, S41 A8 | verified | Pass if AI suggestions are stored as suggestions, no mark or claim changes without a named person's event, and log export is refused until the invited lawyer role confirms |

### D. Productions, load files and metadata

The agency specifications bind productions to those agencies. Chancery says it requires no particular format and describes the usual one: images, native spreadsheets and media, standard load files, objective metadata, searchable text (S26 §7.g.iv(B)). They are used here because they are public and exact.

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| F1 | Requested form can be produced | Request may name a form; default is ordinarily maintained or reasonably usable. In Chancery a stated form must be followed unless unreasonable | S4, S1 Rule 34(b)(2)(E), S25 Rule 34(d), S7 Rule 45(e)(1), S14 P12, S2 Rule 26(f)(3)(C), S33 Cmt. 3.5, S29, S31 | verified | Pass if the room exports both native and image plus text plus load file, and records on each production which form was used and why |
| F2 | Searchability survives production | Do not remove or significantly degrade searchability | S4 2006 note, C22, C23 | verified-s | Run 10 known strings in the room and against the production. Pass if the same documents return |
| F3 | Load files parse | One .DAT and one .OPT or .LOG; header row; Concordance delimiters; byte order mark if Unicode; mm/dd/yyyy; date, time and zone in separate fields; seven-field image file | S35 §I.2, §I.3, General 5 | verified | Pass if an independent parser built from S35 loads every row with the same column count and no error |
| F4 | Load file carries real metadata | A complaint about a Bates-only load file was part of a motion to compel that was granted | C24, S35 Add. A, S39 App. A | verified | Pass if email records populate FROM, TO, CC, BCC, SUBJECT, DATE_SENT, TIME_SENT, TIME_ZONE_SENT, INTMSGID, and native records populate FILE_NAME, AUTHOR, DATE_MOD, PATH, FILE_SIZE, and all have FIRSTBATES, LASTBATES, SHA256, TEXTPATH, CUSTODIAN |
| F5 | All custodians survive de-duplication | Keep unique metadata; an all-custodians field; record duplicate custodians | S35 General, S26 §7.g.iv(C), S39 | verified | Add one document under two custodians. Pass if one record remains and ALLCUSTODIANS names both |
| F6 | Source is known for each document | Without custodian or source, authentication suffers | C20, S35 General 3, S2 | verified-s | Pass if no document has a blank custodian, source or intake date. Unknown is the stored word when unknown |
| F7 | Production is organised | As kept or labelled to the request. Courts differ: C21 applies this to ESI, while C23 (D. Colo.) reads ESI under (E)(ii) alone | S1 Rule 34(b)(2)(E)(i), S7, C21, C20, C23 | verified-s | Pass if the index maps every document to its original folder path or to a request number, with none blank |
| F8 | Every number has its file | Numbers with no file and locked files were part of the same granted motion | C24 | verified | Pass if every path in the load file exists, no file is password protected, and the failure list is empty |
| F9 | Hidden content is not lost | Hidden text expanded; check images against natives; office flags | S39, S24, S35 Add. A | verified-s | Pass if the planted tracked change and hidden row appear in the text or linked native, and OFFICE_FLAGS is true |
| F10 | Transmittal is generated | Cover letter with case, media, custodian ranges, redaction list and reasons, time zone; production log | S35 General 1, 2, S24 | verified-s | Pass if each production emits these fields and adds a log row with date, recipient, method, ranges |
| F11 | File and folder names are clean | Alphanumeric and underscore only; 2,000 files per folder | S35 General 10, §I.1.g | verified | Pass on a scan of the package |
| F12 | An exact copy is kept | Keep an exact copy of what was produced | S24 | verified-s | Pass if the stored package's hash at production equals the hash on re-download |
| F13 | A disclosure list can be exported | Copy or description by category and location, federal only. Chancery Rule 26 has no such paragraph; Colorado's is wider, reaching material whether or not it helps the discloser | S2 Rule 26(a)(1)(A)(ii), S25 Rule 26, C43 | verified-s | Pass if the room exports category and location for each document with no document text |

### E. Audit trail and chain of custody

No rule read here requires an audit trail. The need comes from proving a process and a copy (Rules 901(b)(9), 902(13), (14)), from showing who could see what (Rule 502(b), D.R.E. 510), and from clawback (Rule 26(b)(5)(B)).

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| A1 | Log cannot be altered without detection | Certificate should show the information was not altered; absent proof of alteration, machine time stamps have been admitted | S12, S19 p. 103, C26 | verified-s | No role can edit or delete a row. Alter one row in a copy: pass if verification fails at that row and passes on the original |
| A2 | Every action writes an event | Metadata covers who created, accessed or modified; permissions | C25, S24 | verified | Script 20 actions: upload, view, download, permission change, mark, redact, produce, clawback and so on. Pass if the log has exactly those 20 with actor, UTC time, control number and action |
| A3 | Hash at intake and at every copy | Hash comparison is the usual digital identification; SHA-256 field | S12 2017 note, S35 Add. A, C25 | verified | Pass if SHA-256 stored at intake equals SHA-256 recomputed at export for all documents |
| A4 | A certification data sheet can be built | Rules 902(13), (14) need a qualified person's certification and notice; the certificate describes system, steps, date, time, tools and versions | S12, S19 pp. 103 to 104 | verified | Pass if one action exports the record, per-file hashes, system name and version, and duplication date, time and tool, marked unsigned for a qualified person. The product signs nothing (S42) |
| A5 | Operative version can be identified | Hash on the final version helps authenticate it | C25 | verified | Pass if one version per document can be flagged final, with hash and actor, and only one at a time |
| A6 | Access can be queried as of any date | Waiver turns on who received it; file permissions are metadata | S28 D.R.E. 510(a), S10, C25, C15 | verified | For a document and date, pass if the returned account list matches the scripted permission history exactly |
| A7 | Everyone holding a copy can be listed | Duty to retrieve after notice; some orders require disclosing who read it | S2 Rule 26(b)(5)(B), S7, C42 | verified-s | For a document, pass if the list of downloads and productions matches the script, with account or volume and time |
| A8 | Times are unambiguous | Zone stated; zone in its own field | S35 General 1.e, §I.3.e | verified | Pass if all stored times are UTC and every export states the zone used |

### F. Authentication

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| U1 | Record and data sheet travel together, ready for notice | Rule 902(11) notice and inspection applies to (13), (14) | S12 | verified | Pass if the export holds the record and the A4 data sheet in one package with a manifest of hashes |
| U2 | Process can be described | Rule 901(b)(9): evidence of a process that produces an accurate result | S11, S19 | verified | Pass if the room emits a dated description of its intake, numbering, hashing and logging steps, with software version, for the date asked |
| U3 | The product makes no authenticity claim | Authenticity is for the proponent and the court; product rule on status words | S11, S41 A1 | verified | Pass if rendered strings contain no status word from A1's "don't say" column; integrity output reads "hash matched on [date]" |
| U4 | AI output stays apart from source records | No rule yet: proposed Rule 707 was held for study in May 2026 (S13, unverified). Rule 902 covers the record, not a summary of it | S12, S13 | verified for S12 | Pass if an AI answer is never stored as a document record, carries no control number of its own, and cites control numbers for each passage |

### G. Protective orders, tiers and clawback

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| T1 | At least two tiers, set per document | Court may limit who sees what and protect commercial information; Chancery's sample covers Confidential and Highly Confidential; N.D. Cal. has attorneys' eyes only | S2 Rule 26(c)(1)(E), (G), S27 n.1, S40, S25 Rule 26(c), S31 | verified | Pass if tier names come from the order, and an account outside a tier's list is refused on view, search, preview, Ask, connector and export |
| T2 | Tier is stamped and fielded | Mark each page; designation field | S40, S39 | verified | Pass if every produced page shows the tier and the load file has a matching field |
| T3 | No access before acknowledgment | Signed agreement to be bound before access | S40, C39 | verified-s | Pass if a listed person with no stored acknowledgment is refused |
| T4 | Bulk designation is visible | Good faith; no mass designation; courts warn of over-designation | C35, S40, C36 n.4 | verified | Pass if bulk marking needs a typed reason and the room reports count and percent per tier. It makes no call on good faith |
| T5 | Challenges are tracked | Designator keeps the burden; protection holds until ruling | C35, C37 | verified | Pass if a challenge sets a challenged state, the tier holds, and only a recorded ruling changes it |
| T6 | Received material can be kept from AI | Product rule; orders now bar public AI tools by name, including Claude; closed tools only on terms | S41 A7, C36, C37, C38, C39 | verified | Pass if an item in the No-AI class returns zero hits through index, Ask and every connector, and only an invited lawyer can lift it, stating the term of the order |
| T7 | Every AI tool that touched a designated item can be named | A court ordered disclosure of the name of any AI tool used with confidential material | C36 | verified | Pass if for any designated item the room lists tool name, account and dates, or states none |
| T8 | AI terms are recorded per connector | Clauses turn on contract terms: no training, no third-party disclosure, deletion on request, written proof | C36, C37, S41 A7 | verified | Pass if each connector has a record of plan, retention and contract document, and a room set to zero retention refuses a consumer plan |
| T9 | End-of-case return or destroy reaches derived data | Copies, abstracts, summaries; certification; 60 days in the model | S40 §15, C40 | verified | Run close-out on received material. Pass if the file, text, index entries, embeddings and AI summaries are gone, a certificate lists them, the event stays in the log, and items under a hold stop for a lawyer's decision |
| T10 | Court-filing export follows the forum | Chancery's cover and footer text, public version date; D. Colo. levels, and a stipulated order alone does not justify restriction | S25 Rule 5.1(b) to (e), S34 LCivR 7.2 | verified | Pass if Chancery mode adds the prescribed cover and a footer on every page, and Colorado mode records level 1, 2 or 3 |
| T11 | Clawback runs as a procedure | Notice and basis; return, sequester or destroy; no use; retrieve copies; preserve until resolved | S2 Rule 26(b)(5)(B), S7 Rule 45(e)(2)(B), S10 Rule 502(b)(3), S28 D.R.E. 510(c), S32 | verified | Trigger a clawback. Pass if the item is blocked for all but counsel, gone from search, Ask and connectors, the A7 copy list is produced, a log row is added, the number is not reused, and the original bytes stay intact |
| T12 | Colorado's clock is available | Written notices; 14 days to contest; 14 days to present under seal or the claim is waived; no review meanwhile | S31 C.R.C.P. 26(b)(5)(B) | verified | Pass if Colorado mode shows both dates from the notice date and blocks review from notice |
| T13 | Clawback reason is limited | Privilege or protection, not relevance, absent agreement | C27, S10 | verified | Pass if the reason list holds only privilege and protection types unless a recorded agreement adds more |
| T14 | Prevention steps can be proved | Rule 502(b)(2) reasonable steps; a party that could not detail its steps lost that point | S10, S28, S32, C28 | verified-s | Pass if one export shows the screen used, by whom, when, population counts and hits |
| T15 | Non-waiver instrument is recorded by type | Plan and order may cover it; a court order binds others, a party agreement binds only the parties | S2, S3, S10 Rule 502(d), (e), S32 (d), (e), S28 510(f), (g), S33, S23 ¶1, S18 | verified | Pass if the record stores type, court and date, and shows that an agreement binds only its parties when type is agreement |

### H. Redaction

| ID | Requirement | Rule or standard | Sources | Status | Pass or fail test |
|---|---|---|---|---|---|
| D1 | Redaction is permanent everywhere | Burned in; removed from fielded data and text; no native or original text alongside | S24, S35 §I.4 | verified-s | Pass if each canary returns zero hits in the image OCR, PDF text layer, text file, load file, metadata and package-wide byte search |
| D2 | Redactions are labelled | Label and basis on the redaction; each page marked | C40, S26 §7.g.v(C), S17 p. 277 | verified-s | Pass if every box shows a label and basis, and every affected page has one |
| D3 | Redacted set is listed | List with reason in the cover letter; load file flag | S35 General 1.d, S23 ¶5, S17 p. 278 | verified | Pass if list count, flag count and redacted-document count are equal |
| D4 | Relevance is not an offered reason | Majority view: unilateral relevance redactions are improper; leave of court for exceptions | C31, C32, C33, C34 | verified | Pass if the reason list offers privilege, work product, personal identifier and order, and relevance appears only with an order reference filled in |
| D5 | The original stays | Preservation; redaction is an alteration of potential evidence | C31, S5, S25 | verified | Pass if the unredacted original keeps its control number and hash, visible only to counsel |
| D6 | Duplicates are redacted alike | Inconsistent redactions across duplicates were held against a party | C34 | verified-s | Pass if same-hash documents get identical redactions or are listed as differing |
| D7 | Filing identifiers are caught | Last four of SSN, TIN, account; birth year; minor's initials; reference list under seal; waiver if filed unredacted. Chancery treats these as confidential too | S6 Rule 5.2(a), (g), (h), S25 Rule 5.1(b)(3)(C) | verified-s | Pass if the pre-filing scan finds 100 percent of the planted fake identifiers and offers the rule's short forms. Rule 5.2 governs filings, not productions |

### I. Wording rules as tests (binding on the product)

| ID | Requirement | Sources | Status | Pass or fail test |
|---|---|---|---|---|
| W1 | Status words | S41 A1 | verified | Scan rendered strings. Pass if no document status reads privileged, protected or confidential, and none of A1's "don't say" strings appears |
| W2 | Folder mark text | S41 A7 | verified | Pass on exact string match of the "Marked privileged by you" notice |
| W3 | Case room notice | S41 A7 | verified | Pass if "Not private like talking to your lawyer" shows on first use and at the top of any case room |
| W4 | Counsel-directed record | S41 A7 | verified | Pass if only an invited lawyer can switch it on, and it shows date, matter, tasks and approved AI |
| W5 | No drafting to the other side or a court without a lawyer | S41 A8 | verified | Pass if such a request with no lawyer in the room is refused with the A8 wording |

---

## 3. The conversion journey: deal room to litigation room

No rule or case read here addresses this conversion by name. The tests come from the preservation, waiver and access authorities above. Two points make it matter in a founder fight. What each side could see in the deal room can itself be the dispute: in a Chancery case at the pleading stage, allegations of separate, selectively filled data rooms for each bidder bore on whether the buyers' delay in finding an alleged fraud was unreasonable (C18), and another case involved a buyer sent to a data room that held nothing on the point (C19). And privilege is uneven here: a director is generally a joint client with equal access, subject to a prior agreement, a special committee, or known adversity (C16), and privilege cannot be raised against a former joint client for communications on a matter of common interest (C15, D.R.E. 502(d)(6)), while disclosure outside the circle, or to a party with commercial or adverse interests, can waive (S28 510(a), C4, C5, C17).

**Run every test on the invented sample room: take a manifest before, convert, take a manifest after, diff them.**

### What must stay intact

| ID | What stays | Authority | Pass or fail test |
|---|---|---|---|
| J1 | Every document | S5, S25 Rule 37(e), C10 | Diff of manifests: same count, same SHA-256 for all, zero differences |
| J2 | Every control number | S35, S38, N1, N2 | Same number on the same hash for all documents. A new document takes the next number. Old links still resolve for accounts still entitled |
| J3 | All versions | C25 | Version count per document is unchanged |
| J4 | Every metadata value | S24, S35 Add. A | No created, modified, custodian, path or author value changes. The conversion touches no document's dates |
| J5 | Full event history | S12, S19 | Row count before is a prefix of the log after, and the hash chain verifies across the conversion. The first new event refers to the last old hash |
| J6 | Investor access and download history | C18, C19, S28, S10 | After conversion, an as-of query for a pre-conversion date returns the investor accounts and what each could see. No history row is removed when an account is removed |
| J7 | The deal-room view per group | C18 | The room can export, for each investor group and date, the exact index that group could see, including any group-specific view |
| J8 | Q&A, comments and acknowledgments | S5, S26 §7.a.ii | Counts of Q&A threads, comments, NDA acceptances and invitations are equal before and after, with authors and times |
| J9 | Marks and their history | S41 A7, C4 | Each "Marked privileged by you" mark keeps its date and actor, and stays out of every shared view |
| J10 | Existing productions | S24, N1 | Earlier production packages keep their hashes, and their numbers stay out of reuse |

### What must change

| ID | What changes | Authority | Pass or fail test |
|---|---|---|---|
| J11 | The conversion is one recorded act | S26 §7.a.iv(C), S16 G9 | One event holds actor, time, before and after counts and manifest hash. The manifest exports |
| J12 | It cannot half-finish | S5 | Kill the process at the midpoint and re-run. Final manifest equals a clean run, no duplicates, no document in two states |
| J13 | Hold goes on at conversion | S41 A7, P3 | Hold state is on at the conversion event, or conversion refuses. A separate field holds the date the dispute was first expected, which may be earlier and is entered by a person |
| J14 | Timers stop | S5, C9 | Advance the clock past the deal-room expiry date. Nothing is archived, emailed, expired or removed |
| J15 | Investors out, everywhere | C5, C17; S2 Rule 26(c)(1)(E) by analogy | Each investor test account is refused on view, search, preview, download, API, Ask, connector, saved share link and cached thumbnail. Active sessions for them are 0. Digests and alerts to them are 0 |
| J16 | Directors are not silently removed | C15, C16 | Conversion cannot finish while any account holding a director role is unresolved. The screen requires a lawyer's recorded decision and date per account, and states no conclusion about access rights |
| J17 | A list of copies already out | S2, S26 §7.d.iii, A7 | The room exports each document each departing account downloaded, with hash and time. Nothing is sent to them by the product |
| J18 | Exposure report for marked items | S28 510(a), C4, C5 | Any marked item that a non-lawyer outside the client viewed before conversion, including the planted one, appears on a report for counsel, worded as a fact and with no statement that anything was waived |
| J19 | Counsel in, by invitation only | S41 A7, S26 §7.a.iii | A lawyer account has no access until it accepts an invitation. After that it sees all documents, hold screen, log and audit trail. Each lawyer record shows firm and role, which feed the players list |
| J20 | Opposing side sees productions only | S2 Rule 26(c), T1 | A receiving-party account sees only served productions at its tier. Room index, log of unproduced items, marks and audit trail all refuse |
| J21 | Connected AI is re-decided | S41 A7, C36, C37 | All connector grants are suspended at conversion. Each returns only after a person re-approves it and the plan card shows. Departing accounts' tokens are revoked |
| J22 | Notices change | S41 A7, A8 | The case-room notice and A8 show at the top, and deal-room prompts such as investor invitation prompts do not render |
| J23 | Numbering rule switches on for new work | N2 | The first production after conversion passes N1 to N9 with no change to any earlier number |

---

## 4. What to leave out

Each of these needs a court or a lawyer, or software cannot test it. None belongs on the page as a goal or a score.

**Legal conclusions**

1. Whether any document is privileged or is work product. A court decides (S41 A7).
2. Whether showing an item in the deal room waived anything, and how far a waiver reaches. The room reports the exposure and stops (J18).
3. Whether a common interest existed with an investor, or a joint-client relationship with a director, and when adversity became known.
4. When litigation became reasonably foreseeable. It is fact-specific and objective (C10 ¶¶ 37 to 39, S16 G4). The room stores a date a person enters.
5. Whether preservation was reasonable or proportionate, or a loss prejudicial or reckless.
6. Whether a log description is enough to let the other side assess the claim. L10 only counts repeats.
7. Whether a given log method will be accepted in a given court (S2, S3 notes: no one-size-fits-all).
8. Whether a production is "reasonably usable" as a conclusion. Test the parts: F2 to F9.
9. Authenticity or admissibility, hearsay, or whether a certificate will satisfy a judge. A qualified person signs; the product prepares the data.
10. Good cause for a protective order, good faith of a designation, or whether a tier is right.
11. Whether an AI plan meets a given order's terms. T8 records terms; a lawyer reads them against the order. AI privilege law is unsettled: C36, pp. 7 to 8, departs from C41 on work product and on whether a public AI's data use ends all protection.
12. Whether a redaction is justified on its merits, or an exception to the relevance-redaction rule applies.
13. Whether a Rule 502(d) order's wording displaces Rule 502(b). Courts split (C29, C30).
14. Responsiveness, search adequacy, proportionality.

**Soft goals and claims to keep off the page**

15. "Compliant", "court-ready", "defensible", "litigation-grade", "evidence-grade", "tamper-proof", "spoliation-proof", "no risk of waiver", "sanctions-safe".
16. "SEC-compliant" or "DOJ-compliant". Those specifications bind productions to those agencies. Say "Checked against SEC Data Delivery Standards, Rev 08/2026, on [date]".
17. "Outstanding" as a score, or any percentage that blends these tests into a grade the law does not recognise. Report passes and fails per test.
18. "Preserves everything". The room reaches only what is in it (S41 A7).
19. Claims about the other side's or investors' copies being recalled. The room lists them; a lawyer acts.
20. Advice-shaped lines such as "you should designate this", which A1 bars.

---

## 5. Unverified or still open

**Not opened, so confirm before relying on them**

- Legal Holds, Second Edition, final text (S15): the guidelines above come from the December 2018 public comment version, which says it was superseded. The publication page and a search summary confirm a June 2019 final with 12 guidelines, but the final PDF refused the fetch. Check G8, G9, G10, G11 wording.
- Proposed Rules 707 and 901(c) (S13): search snippets say the Evidence Committee took no action in May 2026 and kept studying. Minutes not opened.
- Sedona AI primers (S21, S22): snippets only. The 2026 one is a member comment draft.
- Heppner (C41): the docket entry confirms the ruling and date. C36, pp. 7 to 8, describes its work product reasoning and distinguishes it for a civil, unrepresented litigant. The opinion itself was not opened, so A7's added details (the footnote on a lawyer's advice, "even after he gave them to his lawyer") were not checked. C36 also cites Warner v. Gilbarco, Inc., 2026 WL 373043 (E.D. Mich. Feb. 10, 2026), which was not opened.
- Supreme Court order (S9): search result only. The amended text itself was confirmed in S1 to S3.
- C.R.C.P. 34: current text not found on the Colorado site. S31 is a 2015 rule change, and its Rule 26(b)(5)(B) clock (T12) needs a currency check.
- Colorado filing redaction rule and restricted access in state court (C.R.C.P. 121, Chief Justice Directive 05-01): not read.
- Chancery Rule 5(k) (filer's omission of identifiers): cited in Rule 5.1, not read. Chancery's sample confidentiality stipulations, Exhibits 7 and 8: could not be fetched. The two tiers in T1 come from Exhibit 11's footnote.
- D.R.E. copy (S28): the file shows 2017 amendments but no date of its own. Confirm 502 and 510 are current.
- Summary-only reads: S4 to S8, S24, S37 and the cases marked "read, summary". Pinpoints unchecked. Rule 37(e) and its 2015 note in particular came through a summarising tool, so quote from the official pamphlet (S1) instead.

**Searched for and not found**

- A Sedona commentary on ESI redaction. The publications list has none (S20). Closest are the sealing commentary and privilege logs (S17). Redaction law here comes from cases and agency specifications.
- A standalone Sedona commentary on AI: only primers.
- A rule or case on converting a deal room to a litigation room, or squarely on privileged documents placed in a data room. Section 3 is reasoned from general authority.
- A case on Bates gaps matching withheld items: two searches returned one hit each, neither read. Treat N2 as a chosen standard.
- A DOJ Civil Division production specification. The Antitrust ESI letter that S36 refers to was not located, and the 2015 attachment (S37) may be stale.

**Conflicts and corrections for the repo**

- SEC allows underscores in Bates numbers (S35); DOJ's attachment forbids them (S37). N5 passes both by using hyphens only.
- Chancery Rule 26, as compiled, has no paragraph matching federal 26(a)(1), 26(b)(5) or 26(f). Log duties there come from case law and the Guidelines, and subpoena claims from Rule 45(d)(2). Check this against the rule's history before saying it publicly.
- `docs/design/document-set-and-law.md` links Rule 37(e) "and Guidelines" to id=160908. That link is the Rules compilation. The Guidelines are at id=99468, updated October 15, 2024. A separate standalone guideline on preserving ESI was not located.
- The same document marks Colorado's preservation duty unverified and says no rule like 37(e) was found. C10 n.4 now confirms that from the Colorado Supreme Court, and sets the standard. The row can be updated.
- A7's line that some protective orders forbid putting the other side's documents into AI is supported by C36 to C39. Those are case-specific orders, not a rule. A7's line that others protected some AI work is supported by C36.

**Open questions on the law**

- C9's later history: a search snippet mentioned a 2026 Chancery spoliation order on when the duty arises being reviewed by the Delaware Supreme Court. It could not be tied to C9. Check before citing C9.
- Rule 5.2 has a proposed amendment in the August 2026 draft, projected for December 1, 2028, and Rule 45 one projected for December 1, 2027 (S8). Contents not read. The same page lists no civil rule for December 1, 2026.
- Rule 502(d) applies to federal court orders. State equivalents exist in Colorado and Delaware (S32, S28), and Chancery's sample warns that a quick-peek may not hold elsewhere (S26 §7.g.v(D)). A test of the record (T15) cannot settle how far an order reaches.

**Product side**

- These tests have not been run. Some assume features the product may not have, such as director roles, slip sheets, per-group views or a Colorado clock. A failed test is a finding for the page; decide before publishing whether each row is scored now or marked not built.
- Test data must stay invented. Nothing here uses or was drawn from any real matter.
