// SPDX-License-Identifier: Apache-2.0
// The names practitioners use for federal law, which the official headings never do.

/**
 * The name practitioners use for a federal rule, added to its heading so a question that says "Rule 10b-5" or
 * "Form D" finds the section, whose official text never uses that name.
 */
export function commonName(cite: string): string | null {
  const regD = /^17 C\.F\.R\. § 230\.(50[0-8])$/.exec(cite);
  if (regD) return `Rule ${regD[1]} of Regulation D`;
  if (cite === '17 C.F.R. § 240.10b-5') return 'Rule 10b-5';
  if (cite === '17 C.F.R. § 239.500') return 'Form D';
  const adviserRule = /^17 C\.F\.R\. § 275\.(\d{3}.*)$/.exec(cite);
  if (adviserRule) return `Advisers Act Rule ${adviserRule[1]}`;
  // Advisers Act sections 201 to 221 are 15 U.S.C. § 80b-1 to 80b-21; Investment Company Act sections 1 to 9 keep
  // their numbers (§ 3 is § 80a-3). Higher sections are numbered apart, so they get no common name here.
  const advisers = /^15 U\.S\.C\. § 80b-([1-9]|1\d|2[01])$/.exec(cite);
  if (advisers) return `Investment Advisers Act of 1940 § ${200 + Number(advisers[1])}`;
  const company = /^15 U\.S\.C\. § 80a-([1-9])$/.exec(cite);
  if (company) return `Investment Company Act of 1940 § ${company[1]}`;
  return null;
}
