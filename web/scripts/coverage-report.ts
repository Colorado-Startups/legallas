// SPDX-License-Identifier: Apache-2.0
// Counts and the Markdown report of the coverage audit. formatCounts is what the terminal shows: numbers and
// reasons only, never a path, name, query or document text. The Markdown report and the JSON stay in
// <cacheDir>/audit at mode 600.
import type { IndexManifest } from './indexjob.ts';
import { MATTER_KEY } from '../worker/matter-types.ts';
import { isVisualAiKey, VISUAL_AI_PREFIX } from '../worker/visuals.ts';
import { BY_DESIGN, parseIndexKeys, type AiItem, type CoverageRow, type DocRow, type ProbeHit, type Zone } from './coverage-table.ts';

export interface SummaryExtras {
  rows: readonly DocRow[];
  filesKeys: ReadonlySet<string>;
  indexKeys: readonly string[];
  aiItems: ReadonlyMap<string, AiItem>;
  manifest: IndexManifest;
  privateFiles: number;
  foldersNotRead: number;
  retrievalFiles: number;
}

type Counter = Record<string, number>;

export interface CoverageSummary {
  rows: number;
  status: Record<Zone, { OK: number; GAP: number }>;
  reasons: Counter;
  tabs: Record<string, { files: number; gap: number }>;
  room: { files: number; inD1: number; inFiles: number; indexable: number; byDesign: number; notIndexable: number; inIndex: number; aiCompleted: number; shaMismatch: number };
  d1: { live: number; mirror: number; counsel: number; removed: number };
  /**
   * casePicture: the published manifest (meta/matter.json). visualText: the visuals' side files (meta/visual-ai/, their
   * rendered text and PNGs, never documents), of which visualTextOrphans belong to no live visual. Neither is a document.
   */
  filesBucket: { keys: number; live: number; removedOnly: number; unknown: number; casePicture: number; visualText: number; visualTextOrphans: number };
  indexBucket: { keys: number; docs: number; live: number; removed: number; unknown: number; orphanParts: number; other: number };
  aiSearch: { items: number; completed: number; statuses: Counter; notInBucket: number };
  manifest: { entries: number; notLive: number };
  catalog: Counter;
  textGroups: { groups: number; docs: number };
  cited: number;
  retrieved: number;
  retrievalFiles: number;
  privateCopies: number;
  privateFiles: number;
  foldersNotRead: number;
  caseRoot: { files: number; withRoomCopy: number };
  probe: { targets: number; queries: number; errors: number; top1: number; found: number; unfindable: number; reasons: Counter } | null;
}

const bump = (counter: Counter, key: string, by = 1) => {
  counter[key] = (counter[key] ?? 0) + by;
};

function bucketSummaries(extras: SummaryExtras) {
  const live = new Set(extras.rows.filter((row) => row.removed_at === null).map((row) => row.id));
  const removed = new Set(extras.rows.filter((row) => row.removed_at !== null).map((row) => row.id));
  const liveKeys = new Set(extras.rows.filter((row) => row.removed_at === null).map((row) => row.r2_key));
  const removedKeys = new Set(extras.rows.filter((row) => row.removed_at !== null).map((row) => row.r2_key));
  const filesBucket = { keys: extras.filesKeys.size, live: 0, removedOnly: 0, unknown: 0, casePicture: 0, visualText: 0, visualTextOrphans: 0 };
  const liveShas = new Set(extras.rows.filter((row) => row.removed_at === null && row.sha256).map((row) => row.sha256));
  for (const key of extras.filesKeys) {
    if (key === MATTER_KEY) filesBucket.casePicture += 1;
    else if (isVisualAiKey(key)) {
      filesBucket.visualText += 1;
      if (!liveShas.has(key.slice(VISUAL_AI_PREFIX.length, VISUAL_AI_PREFIX.length + 64))) filesBucket.visualTextOrphans += 1;
    }
    else if (liveKeys.has(key)) filesBucket.live += 1;
    else if (removedKeys.has(key)) filesBucket.removedOnly += 1;
    else filesBucket.unknown += 1;
  }
  const { parts, other } = parseIndexKeys(extras.indexKeys);
  const indexBucket = { keys: extras.indexKeys.length, docs: parts.size, live: 0, removed: 0, unknown: 0, orphanParts: 0, other };
  for (const [id, list] of parts) {
    if (live.has(id)) indexBucket.live += 1;
    else {
      indexBucket.orphanParts += list.length;
      if (removed.has(id)) indexBucket.removed += 1;
      else indexBucket.unknown += 1;
    }
  }
  const indexKeys = new Set(extras.indexKeys);
  const aiSearch = { items: extras.aiItems.size, completed: 0, statuses: {} as Counter, notInBucket: 0 };
  for (const [key, item] of extras.aiItems) {
    bump(aiSearch.statuses, item.status);
    if (item.status === 'completed') aiSearch.completed += 1;
    if (!indexKeys.has(key)) aiSearch.notInBucket += 1;
  }
  const manifest = { entries: Object.keys(extras.manifest).length, notLive: Object.keys(extras.manifest).filter((id) => !live.has(id)).length };
  const d1 = {
    live: live.size,
    mirror: extras.rows.filter((row) => row.removed_at === null && row.source === 'mirror').length,
    counsel: extras.rows.filter((row) => row.removed_at === null && row.source === 'counsel').length,
    removed: removed.size,
  };
  return { filesBucket, indexBucket, aiSearch, manifest, d1 };
}

function probeSummary(rows: readonly CoverageRow[]): CoverageSummary['probe'] {
  const probed = rows.filter((row) => row.probe);
  if (probed.length === 0) return null;
  const probe = { targets: probed.length, queries: 0, errors: 0, top1: 0, found: 0, unfindable: 0, reasons: {} as Counter };
  for (const row of probed) {
    const hits = [row.probe!.summary, row.probe!.passage].filter((hit) => hit !== null); // safe: filtered on row.probe
    probe.queries += hits.length;
    probe.errors += hits.filter((hit) => hit.error).length;
    if (hits.some((hit) => hit.rank === 1)) probe.top1 += 1;
    if (row.probe!.unfindable) { // safe: filtered on row.probe
      probe.unfindable += 1;
      bump(probe.reasons, row.probe!.reason ?? 'unknown'); // safe: filtered on row.probe
    } else probe.found += 1;
  }
  return probe;
}

export function summarize(rows: readonly CoverageRow[], extras: SummaryExtras): CoverageSummary {
  const status = { room: { OK: 0, GAP: 0 }, 'case-root': { OK: 0, GAP: 0 }, 'd1-only': { OK: 0, GAP: 0 }, counsel: { OK: 0, GAP: 0 } };
  const reasons: Counter = {};
  const tabs: CoverageSummary['tabs'] = {};
  const catalog: Counter = {};
  for (const row of rows) {
    status[row.zone][row.status] += 1;
    for (const reason of row.reasons) bump(reasons, reason);
    if (row.zone !== 'room') continue;
    const tab = (tabs[row.tab] ??= { files: 0, gap: 0 });
    tab.files += 1;
    if (row.status === 'GAP') tab.gap += 1;
    if (row.catalog) bump(catalog, row.catalog);
  }
  const room = rows.filter((row) => row.zone === 'room');
  const caseRoot = rows.filter((row) => row.zone === 'case-root');
  const grouped = room.filter((row) => row.textGroup);
  return {
    rows: rows.length,
    status,
    reasons,
    tabs,
    room: {
      files: room.length,
      inD1: room.filter((row) => row.inD1).length,
      inFiles: room.filter((row) => row.inFiles).length,
      indexable: room.filter((row) => row.indexable === true).length,
      byDesign: room.filter((row) => typeof row.indexable === 'string' && BY_DESIGN.has(row.indexable)).length,
      notIndexable: room.filter((row) => typeof row.indexable === 'string' && row.indexable.endsWith('not indexable')).length,
      inIndex: room.filter((row) => row.indexParts > 0).length,
      aiCompleted: room.filter((row) => row.ai && row.ai.items > 0 && row.ai.completed === row.ai.items).length,
      shaMismatch: room.filter((row) => row.shaMatch === false).length,
    },
    ...bucketSummaries(extras),
    catalog,
    textGroups: { groups: new Set(grouped.map((row) => row.textGroup)).size, docs: grouped.length },
    cited: room.filter((row) => row.cited > 0).length,
    retrieved: room.filter((row) => row.retrieved > 0).length,
    retrievalFiles: extras.retrievalFiles,
    privateCopies: room.filter((row) => row.privateCopy).length,
    privateFiles: extras.privateFiles,
    foldersNotRead: extras.foldersNotRead,
    caseRoot: { files: caseRoot.length, withRoomCopy: caseRoot.filter((row) => row.copies.length > 0).length },
    probe: probeSummary(rows),
  };
}

const list = (counter: Counter) =>
  Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => `${key} ${n}`)
    .join('; ') || 'none';

/** The terminal summary: counts and reasons only. */
export function formatCounts(s: CoverageSummary): string {
  const zones = (Object.keys(s.status) as Zone[]).map((zone) => `${zone} ${s.status[zone].OK} OK / ${s.status[zone].GAP} GAP`).join('; ');
  const lines = [
    `Rows: ${s.rows} (${zones})`,
    `Room folder: ${s.room.files} files; in D1 ${s.room.inD1}; in legallas-files ${s.room.inFiles}; indexable ${s.room.indexable} (by design not indexed ${s.room.byDesign}, kind not indexable ${s.room.notIndexable}); in legallas-index ${s.room.inIndex}; AI Search complete ${s.room.aiCompleted}; D1 sha differs ${s.room.shaMismatch}`,
    `D1: ${s.d1.live} live (${s.d1.mirror} mirror, ${s.d1.counsel} counsel), ${s.d1.removed} removed`,
    `legallas-files: ${s.filesBucket.keys} keys; live ${s.filesBucket.live}; removed rows only ${s.filesBucket.removedOnly}; case picture ${s.filesBucket.casePicture}; visual side files ${s.filesBucket.visualText} (no live visual ${s.filesBucket.visualTextOrphans}); no row ${s.filesBucket.unknown}`,
    `legallas-index: ${s.indexBucket.keys} keys for ${s.indexBucket.docs} documents; live ${s.indexBucket.live}; removed ${s.indexBucket.removed}; unknown ${s.indexBucket.unknown}; orphan parts ${s.indexBucket.orphanParts}; other keys ${s.indexBucket.other}`,
    `AI Search: ${s.aiSearch.items} items (${list(s.aiSearch.statuses)}); not in legallas-index ${s.aiSearch.notInBucket}`,
    `Index manifest: ${s.manifest.entries} entries; not live ${s.manifest.notLive}`,
    `Catalog: ${list(s.catalog)}`,
    `Identical text: ${s.textGroups.groups} groups, ${s.textGroups.docs} documents`,
    `Cited by the case picture: ${s.cited}; ever retrieved: ${s.retrieved} (${s.retrievalFiles} retrieval files)`,
    `Private copies: ${s.privateCopies} room files (${s.privateFiles} private files hashed); case-root files ${s.caseRoot.files}, with a room copy ${s.caseRoot.withRoomCopy}; folders not read ${s.foldersNotRead}`,
    `Gap reasons: ${list(s.reasons)}`,
  ];
  if (s.probe) {
    lines.push(`Probe: ${s.probe.targets} documents, ${s.probe.queries} searches (${s.probe.errors} failed); found ${s.probe.found} (first ${s.probe.top1}); unfindable ${s.probe.unfindable} (${list(s.probe.reasons)})`);
  }
  return lines.join('\n');
}

const cell = (value: unknown) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const table = (head: readonly string[], body: readonly (readonly unknown[])[]) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((row) => `| ${row.map(cell).join(' | ')} |`)].join('\n');
const yes = (value: boolean | null) => (value === null ? '' : value ? 'yes' : 'no');

function textCell(row: CoverageRow): string {
  if (!row.text) return '';
  const sorted = [...row.text.chars].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return `${row.text.pages}p ${row.text.blankPages}b ${row.text.ocrPages}ocr ~${median}c`;
}

function probeCell(row: CoverageRow): string {
  if (!row.probe) return '';
  const rank = (hit: ProbeHit | null) => (!hit ? '-' : hit.error ? 'err' : (hit.rank ?? 'none'));
  return `${rank(row.probe.summary)}/${rank(row.probe.passage)}${row.probe.unfindable ? ` ${row.probe.reason}` : ''}`;
}

/** The full report: summary, gaps, groups, unfindable documents, case-root files and the whole table. */
export function renderMarkdown(rows: readonly CoverageRow[], s: CoverageSummary, generatedAt: string): string {
  const room = rows.filter((row) => row.zone === 'room');
  const groups = new Map<string, string[]>();
  for (const row of room) if (row.textGroup) groups.set(row.textGroup, [...(groups.get(row.textGroup) ?? []), row.control || row.path]);
  const unfindable = rows.filter((row) => row.probe?.unfindable);
  const full = rows.map((row) => [
    row.zone, row.tab, row.kind, row.control, yes(row.shaMatch), yes(row.inD1), yes(row.inFiles), row.indexable === true ? 'yes' : row.indexable,
    row.manifest ? `${row.manifest.parts}p v${row.manifest.version ?? '-'}${row.manifest.fresh ? '' : ' stale'}` : '', row.indexParts,
    row.ai ? `${row.ai.completed}/${row.ai.items} ${row.ai.chunks}ch` : '', textCell(row), row.textGroup ?? '', row.catalog ?? '',
    Object.entries(row.audit).map(([k, n]) => `${k} ${n}`).join(', '), row.cited, row.retrieved, probeCell(row), row.status,
    [...row.reasons, ...row.notes].join('; '), row.path,
  ]);
  return [
    `# Coverage audit, ${generatedAt}`,
    '',
    'Work product. Local only (mode 600). Probe: summary rank / passage rank (passages in Ask order; none = not returned).',
    '',
    '## Counts',
    '',
    '```',
    formatCounts(s),
    '```',
    '',
    '## By tab (room folder)',
    '',
    table(['Tab', 'Files', 'GAP'], Object.entries(s.tabs).sort().map(([tab, n]) => [tab, n.files, n.gap])),
    '',
    '## Gaps',
    '',
    table(['Zone', 'Control', 'Reasons', 'Path'], rows.filter((row) => row.status === 'GAP').map((row) => [row.zone, row.control, row.reasons.join('; '), row.path])),
    '',
    '## Unfindable (probe)',
    '',
    unfindable.length ? table(['Control', 'Reason', 'Path'], unfindable.map((row) => [row.control, row.probe!.reason, row.path])) : 'None, or the probe did not run.', // safe: filtered on probe
    '',
    '## Identical text',
    '',
    groups.size ? table(['Group', 'Documents'], [...groups].map(([group, members]) => [group, members.join(', ')])) : 'None.',
    '',
    '## Case-folder root',
    '',
    table(['File', 'Room copies', 'Status', 'Notes'], rows.filter((row) => row.zone === 'case-root').map((row) => [row.path, row.copies.join(', '), row.status, [...row.reasons, ...row.notes].join('; ')])),
    '',
    '## All rows',
    '',
    table(['Zone', 'Tab', 'Kind', 'Control', 'Sha', 'D1', 'Files', 'Indexable', 'Manifest', 'Parts', 'AI', 'Text', 'Group', 'Catalog', 'Audit', 'Cited', 'Retrieved', 'Probe', 'Status', 'Reasons and notes', 'Path'], full),
    '',
  ].join('\n');
}
