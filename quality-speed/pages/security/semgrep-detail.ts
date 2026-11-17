// SPDX-License-Identifier: Apache-2.0
// Branch claude/wstg-internal only: the nightly scan's open Semgrep findings, one row each, with Semgrep's own severity and
// whether the file ships in a room. Same rules as readings.ts sastCounts: security category, not a test, not an audited
// rule, and no triage.json reason matching the line's hash.
//   node quality-speed/pages/security/semgrep-detail.ts <semgrep.json> <out.tsv>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { countsAsFinding, matchHash, repoPath, ruleName } from './readings.ts';

const [report, out] = process.argv.slice(2) as [string, string];
const triage = JSON.parse(readFileSync(path.join(import.meta.dirname, 'triage.json'), 'utf8'));
const r = JSON.parse(readFileSync(report, 'utf8'));
const used = new Set<unknown>();
const rows: string[] = [];
const PROD = /^web\/(worker|mcp|src)\//;
for (const f of r.results) {
  if (!countsAsFinding(f, triage.rules_not_scored)) continue;
  const p = repoPath(f.path);
  const rule = ruleName(f.check_id);
  let hash: string | null = null;
  try {
    hash = matchHash(readFileSync(p, 'utf8'), f.start.line, f.end?.line ?? f.start.line);
  } catch {}
  const entry = triage.sast.find((e: { rule: string; path: string; line_hash: string; reason: string }) => !used.has(e) && e.rule === rule && e.path === p && e.line_hash === hash && e.reason.trim().length >= 20);
  if (entry) {
    used.add(entry);
    continue;
  }
  rows.push([f.extra.severity, PROD.test(p) ? 'production' : 'not production', rule, `${p}:${f.start.line}`].join('\t'));
}
writeFileSync(out, `${rows.join('\n')}\n`);
process.stdout.write(`open ${rows.length}\n`);
