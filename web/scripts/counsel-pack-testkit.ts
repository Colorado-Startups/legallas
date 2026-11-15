// SPDX-License-Identifier: Apache-2.0
// Shared fixture for the counsel pack tests: a temp folder with Copperline style files, an --out path
// beside it and a fake D1 and R2. Never real case data.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PackDeps, PackOptions } from './counsel-pack-build.ts';
import { PACK_MIRROR_SQL, PACK_UPLOADS_SQL } from './counsel-pack-plan.ts';

export const NOW = new Date('2026-10-01T12:00:00Z');
export const FILES: Record<string, string> = {
  'CLAUDE.md': '# Folder guide for the Copperline repair papers',
  '01-Contracts/Service-Contract__20110809__Tally-Payroll.pdf': '%PDF-1.7 service contract between Copperline Restaurant Group, Inc. and Tally Payroll, Inc.',
  '01-Contracts/Job-Schedule__20110914__Tally-Payroll.pdf': '%PDF-1.7 job schedule, 212 feet of gutter',
  '04-Letters/Letter__20120903__Acme-Mutual.txt': 'Dear Mr. Moe, please confirm the 37 feet we patched on June 12, 2012.',
};

export interface Fixture {
  parent: string;
  root: string;
  out: string;
  rows: Record<string, unknown>[];
  uploads: Record<string, unknown>[];
  r2: Map<string, string>;
  options: (extra?: Partial<PackOptions>) => PackOptions;
  deps: PackDeps;
  done: () => Promise<void>;
}

export const sha = (text: string) => createHash('sha256').update(text).digest('hex');

export function rowFor(rel: string, content: string, seq: number): Record<string, unknown> {
  const id = `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
  return { id, path: rel, name: path.posix.basename(rel), sha256: sha(content), size: Buffer.byteLength(content), pages: rel.endsWith('.pdf') ? 2 : null, control_seq: seq };
}

export async function fixture(): Promise<Fixture> {
  const parent = await mkdtemp(path.join(tmpdir(), 'legallas-pack-'));
  const root = path.join(parent, 'Shared');
  for (const [rel, content] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content);
  }
  const rows = Object.entries(FILES).map(([rel, content], i) => rowFor(rel, content, i + 1));
  const uploads: Record<string, unknown>[] = [];
  const r2 = new Map<string, string>();
  const f: Fixture = {
    parent,
    root,
    out: path.join(parent, 'Pack'),
    rows,
    uploads,
    r2,
    options: (extra = {}) => ({ out: f.out, sourceRoot: root, prefix: 'DOE', banner: 'Work Product.', includeUploads: false, zip: false, dryRun: false, ...extra }),
    deps: {
      async d1Query(sql) {
        if (sql === PACK_MIRROR_SQL) return rows;
        if (sql === PACK_UPLOADS_SQL) return uploads;
        throw new Error('unexpected query');
      },
      async r2Get(_bucket, key, file) {
        const body = r2.get(key);
        if (body === undefined) throw new Error('no such key');
        await writeFile(file, body);
      },
      now: NOW,
      finderInfo: async () => null,
      repoRoot: path.join(parent, 'repo'),
    },
    done: () => rm(parent, { recursive: true, force: true }),
  };
  return f;
}
