// SPDX-License-Identifier: Apache-2.0
// The room's catalog: live documents as a folder tree for /api/documents, and the viewer each document
// opens in. Rows are mapped field by field, so storage details (r2_key, sha256, etag) never reach a
// response even if a query returned them. Also the SQL that numbers documents (control_seq, card F3).
import { STORED_NAME } from './stored-name.ts';

/**
 * Room data files mirrored with the documents (the binder manifest, <stored name>-visuals.json). Their rows
 * stay, because the room reads them, but they are never listed, cited or indexed (decision R6).
 */
export const HIDDEN_NAME = new RegExp(`^${STORED_NAME}-.*\\.json$`);
/** HIDDEN_NAME as a SQL condition on `name` (GLOB is case-sensitive, like the pattern). */
export const NOT_HIDDEN_SQL = `name NOT GLOB '${STORED_NAME}-*.json'`;

export function isHiddenName(name: string): boolean {
  return HIDDEN_NAME.test(name);
}

/**
 * The next control number, for use inside an INSERT. Numbers are never reused: removed rows keep theirs.
 * The unique index documents_control_seq makes a duplicate fail rather than land.
 */
export const NEXT_CONTROL_SEQ_SQL = '(SELECT COALESCE(MAX(control_seq), 0) + 1 FROM documents)';

/**
 * Numbers rows that have none, after every numbered row, in path order (migration 0003's order). Only
 * an upload made between the migration and the deploy is ever unnumbered; with none it changes nothing.
 */
export const NUMBER_UNNUMBERED_SQL =
  'UPDATE documents SET control_seq = b.base + r.n FROM ' +
  '(SELECT id, ROW_NUMBER() OVER (ORDER BY path, updated_at, id) AS n FROM documents WHERE control_seq IS NULL) AS r, ' +
  '(SELECT COALESCE(MAX(control_seq), 0) AS base FROM documents) AS b WHERE r.id = documents.id;';

/** A documents row as the catalog reads it. Extra columns are ignored. */
export interface CatalogRow {
  id: string;
  path: string;
  folder: string;
  name: string;
  kind: string;
  size: number;
  pages: number | null;
  updated_at: string;
  source: string;
  control_seq?: number | null;
  key_at?: string | null;
  key_by?: string | null;
  removed_at?: string | null;
}

/** One file as listed in the room. */
export interface ListedDocument {
  id: string;
  name: string;
  kind: string;
  size: number;
  pages: number | null;
  updated_at: string;
  source: string;
  /** Permanent document number; null only in the moments before a sync numbers it. */
  control_seq: number | null;
  /** When and by whom the document was marked Key; both null when it is not Key. */
  key_at: string | null;
  key_by: string | null;
}

export interface FolderNode {
  /** Full folder path, '' for the root. */
  path: string;
  /** Last path segment, '' for the root. */
  name: string;
  /** The folder's CLAUDE.md, shown as its "Folder guide" instead of as a file. */
  guide: ListedDocument | null;
  files: ListedDocument[];
  folders: FolderNode[];
  /** Files in this folder and below, guides included. */
  count: number;
  /** Bytes in this folder and below. */
  size: number;
}

/** The file in each mirrored folder that describes it. */
export const GUIDE_NAME = 'CLAUDE.md';
/** Counsel uploads live at from-counsel/<id>/<name>; the room shows them together in this folder. */
export const COUNSEL_FOLDER = 'from-counsel';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function toListed(row: CatalogRow): ListedDocument {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    size: row.size,
    pages: row.pages ?? null,
    updated_at: row.updated_at,
    source: row.source,
    control_seq: row.control_seq ?? null,
    key_at: row.key_at ?? null,
    key_by: row.key_by ?? null,
  };
}

/** The folder a document is shown in: its own, except counsel uploads, which share one folder. */
export function displayFolder(row: Pick<CatalogRow, 'folder' | 'source'>): string {
  return row.source === 'counsel' ? COUNSEL_FOLDER : row.folder;
}

function emptyNode(path: string): FolderNode {
  return { path, name: path.split('/').pop() ?? '', guide: null, files: [], folders: [], count: 0, size: 0 };
}

function sortTree(node: FolderNode): void {
  node.files.sort((a, b) => collator.compare(a.name, b.name));
  node.folders.sort((a, b) => collator.compare(a.name, b.name));
  for (const child of node.folders) sortTree(child);
}

function total(node: FolderNode): void {
  let count = node.files.length + (node.guide ? 1 : 0);
  let size = node.files.reduce((sum, file) => sum + file.size, node.guide?.size ?? 0);
  for (const child of node.folders) {
    total(child);
    count += child.count;
    size += child.size;
  }
  node.count = count;
  node.size = size;
}

/**
 * Groups live rows into a tree. Intermediate folders that hold only subfolders are created, removed rows
 * and hidden room data files are dropped (the SQL already filters them; this is a second lock), and each
 * folder's CLAUDE.md becomes its guide.
 */
export function buildTree(rows: readonly CatalogRow[]): FolderNode {
  const root = emptyNode('');
  const nodes = new Map<string, FolderNode>([['', root]]);

  const folderNode = (path: string): FolderNode => {
    const existing = nodes.get(path);
    if (existing) return existing;
    const slash = path.lastIndexOf('/');
    const parent = folderNode(slash === -1 ? '' : path.slice(0, slash));
    const node = emptyNode(path);
    parent.folders.push(node);
    nodes.set(path, node);
    return node;
  };

  for (const row of rows) {
    if (row.removed_at || isHiddenName(row.name)) continue;
    const node = folderNode(displayFolder(row));
    const listed = toListed(row);
    if (row.name === GUIDE_NAME && row.source === 'mirror' && !node.guide) node.guide = listed;
    else node.files.push(listed);
  }
  sortTree(root);
  total(root);
  return root;
}

export type Viewer = 'pdf' | 'image' | 'markdown' | 'csv' | 'text' | 'visual' | 'download';

/** Which viewer a document opens in. Only owner-mirrored HTML runs, and only in the sandbox. */
export function viewerFor(kind: string, source: string): Viewer {
  switch (kind) {
    case 'pdf':
    case 'image':
    case 'markdown':
    case 'csv':
    case 'text':
      return kind;
    case 'visual':
      return source === 'mirror' ? 'visual' : 'download';
    default:
      return 'download';
  }
}
