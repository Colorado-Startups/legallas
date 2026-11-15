// SPDX-License-Identifier: Apache-2.0
// Workstream S2 (Structure). The pure half of the structure tree: organizations placed under their `parent` as a
// tidy tree. Leaves take consecutive columns in depth-first order and a parent sits centred over its first and last
// child, so subtrees never overlap. Every node also keeps its preorder row, so a narrow screen can draw the same
// tree as an indented list. A sibling group larger than `collapseOver` folds into one "N entities" node until it
// is expanded. Tested in tree.test.ts; tree.ts draws it.

import type { Side } from '../../../worker/matter-types.ts';

/** What the tree reads from an organization. `formed` is optional until every manifest carries it. */
export interface TreeOrg {
  id: string;
  name: string;
  kind: string;
  side: Side;
  parent: string | null;
  formed?: string | null;
}

/** Options for the org tree layout: when sibling groups fold, and which folded groups a person opened. */
export interface TreeLayoutOptions {
  /** Sibling groups with more members than this fold into one node. */
  collapseOver: number;
  /** Parents whose folded group a person opened. */
  expanded?: ReadonlySet<string>;
  /** Organizations that never fold away (the selected tile, a step's entities). */
  pinned?: ReadonlySet<string>;
}

/** One drawn node of the org tree: an org, or a folded group. */
export interface TreeNode {
  /** The org id, or `group:<parent id>` for a folded group (matter ids never hold a colon). */
  key: string;
  type: 'org' | 'group';
  /** The organization (org nodes only). */
  org: TreeOrg | null;
  /** The formation date when it is a valid partial ISO date, else null. */
  formed: string | null;
  /** The folded members' ids (group nodes only), in sibling order. */
  members: string[];
  /** The parent node's key; null for a root. */
  parentKey: string | null;
  depth: number;
  /** Horizontal position in column units: a leaf takes a whole column, a parent sits between its children. */
  col: number;
  /** Preorder index: the row in the indented drawing. */
  row: number;
  /** Organizations under this one, at any depth, whether shown or folded. */
  descendants: number;
}

/** A group of siblings under a parent: its size and whether it is open. */
export interface TreeGroup {
  parent: string;
  size: number;
  expanded: boolean;
}

/** The org tree layout: its nodes in preorder and the links from parent to child. */
export interface TreeLayout {
  /** Every drawn node in preorder. */
  nodes: TreeNode[];
  /** Parent to child, by node key. */
  edges: Array<{ from: string; to: string }>;
  /** Columns used (the widest level, in leaves). */
  columns: number;
  /** Levels used. */
  levels: number;
  /** Every sibling group over the limit, folded or opened. */
  groups: TreeGroup[];
  /** The node key that draws each org: itself, or the group it is folded into. */
  keyOf: Map<string, string>;
}

const SIDE_ORDER: readonly Side[] = ['defendant', 'nominal', 'client', 'third', 'court'];
const DATE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** A formation date the tree can print: "2024", "2024-01" or "2024-01-01". Anything else reads as unknown. */
export function formedOf(org: Pick<TreeOrg, 'formed'>): string | null {
  const value = org.formed;
  return typeof value === 'string' && DATE.test(value) ? value : null;
}

function byFormedThenName(a: TreeOrg, b: TreeOrg): number {
  const fa = formedOf(a);
  const fb = formedOf(b);
  if (fa !== fb) {
    if (fa === null) return 1;
    if (fb === null) return -1;
    return fa < fb ? -1 : 1;
  }
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}

/** Each org's usable parent: unknown, self and cycle-closing parents become null (the org is drawn as a root). */
export function parentsOf(orgs: TreeOrg[]): Map<string, string | null> {
  const ids = new Set(orgs.map((o) => o.id));
  const parent = new Map<string, string | null>();
  for (const o of orgs) parent.set(o.id, o.parent && o.parent !== o.id && ids.has(o.parent) ? o.parent : null);
  for (const o of orgs) {
    const seen = new Set<string>([o.id]);
    let at = parent.get(o.id) ?? null;
    while (at !== null) {
      if (seen.has(at)) { parent.set(o.id, null); break; }
      seen.add(at);
      at = parent.get(at) ?? null;
    }
  }
  return parent;
}

/** Each org's children, oldest formation first, and the roots (orgs with no usable parent). */
function childrenOf(unique: TreeOrg[], parent: Map<string, string | null>): { kids: Map<string, TreeOrg[]>; roots: TreeOrg[] } {
  const kids = new Map<string, TreeOrg[]>();
  const roots: TreeOrg[] = [];
  for (const o of unique) {
    const p = parent.get(o.id) ?? null;
    if (p === null) roots.push(o);
    else kids.set(p, [...(kids.get(p) ?? []), o]);
  }
  for (const list of kids.values()) list.sort(byFormedThenName);
  return { kids, roots };
}

/** Counts the orgs under an id at any depth, remembering each answer. */
function counterOf(kids: ReadonlyMap<string, TreeOrg[]>): (id: string) => number {
  const below = new Map<string, number>();
  const count = (id: string): number => {
    const known = below.get(id);
    if (known !== undefined) return known;
    const n = (kids.get(id) ?? []).reduce((sum, k) => sum + 1 + count(k.id), 0);
    below.set(id, n);
    return n;
  };
  return count;
}

/** A pinned org keeps its whole chain of parents out of any fold, so it can be seen where it sits. */
function keptOrgs(parent: ReadonlyMap<string, string | null>, pinned: Iterable<string>): Set<string> {
  const keep = new Set<string>();
  for (const id of pinned) {
    for (let at: string | null = parent.has(id) ? id : null; at !== null && !keep.has(at); at = parent.get(at) ?? null) keep.add(at);
  }
  return keep;
}

/** Which of a parent's children are drawn and which fold into one group; records a group over the limit. */
function planFold(
  list: TreeOrg[], parentId: string, fold: { limit: number; keep: ReadonlySet<string>; expanded?: ReadonlySet<string> }, groups: TreeGroup[],
): { shown: TreeOrg[]; folded: TreeOrg[] } {
  if (list.length <= fold.limit) return { shown: list, folded: [] };
  const expanded = fold.expanded?.has(parentId) ?? false;
  groups.push({ parent: parentId, size: list.length, expanded });
  if (expanded) return { shown: list, folded: [] };
  const shown = list.filter((k) => fold.keep.has(k.id));
  const folded = list.filter((k) => !fold.keep.has(k.id));
  return folded.length < 2 ? { shown: list, folded: [] } : { shown, folded };
}

/** Adds the "N entities" node for the folded children of `parentId`; their own subtrees fold with them. */
function addFoldedGroup(
  out: TreeLayout, parentId: string, folded: TreeOrg[], depth: number,
  kids: ReadonlyMap<string, TreeOrg[]>, count: (id: string) => number,
): TreeNode {
  const key = `group:${parentId}`;
  const group: TreeNode = {
    key, type: 'group', org: null, formed: null, members: folded.map((k) => k.id), parentKey: parentId,
    depth: depth + 1, col: 0, row: out.nodes.length,
    descendants: folded.reduce((sum, k) => sum + 1 + count(k.id), 0),
  };
  out.nodes.push(group);
  out.edges.push({ from: parentId, to: key });
  out.levels = Math.max(out.levels, depth + 2);
  const hide = (id: string): void => { out.keyOf.set(id, key); for (const k of kids.get(id) ?? []) hide(k.id); };
  for (const k of folded) hide(k.id);
  return group;
}

/** Lays out the org tree, folding large sibling groups unless a person opened them. */
export function layoutTree(orgs: TreeOrg[], opts: TreeLayoutOptions): TreeLayout {
  const unique = [...new Map(orgs.map((o) => [o.id, o])).values()];
  const parent = parentsOf(unique);
  const { kids, roots } = childrenOf(unique, parent);
  const count = counterOf(kids);
  // Structures first (the largest leads), then lone entities; within each, defendants first, then by name.
  roots.sort((a, b) => count(b.id) - count(a.id) || SIDE_ORDER.indexOf(a.side) - SIDE_ORDER.indexOf(b.side)
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

  const fold = { limit: Math.max(1, Math.floor(opts.collapseOver)), keep: keptOrgs(parent, opts.pinned ?? []), expanded: opts.expanded };
  const out: TreeLayout = { nodes: [], edges: [], columns: 0, levels: 0, groups: [], keyOf: new Map() };
  let leaf = 0;

  const place = (node: TreeNode, children: TreeNode[]): void => {
    if (children.length === 0) node.col = leaf++;
    else node.col = (children[0].col + children[children.length - 1].col) / 2;
  };

  const visit = (org: TreeOrg, parentKey: string | null, depth: number): TreeNode => {
    const node: TreeNode = {
      key: org.id, type: 'org', org, formed: formedOf(org), members: [], parentKey, depth, col: 0,
      row: out.nodes.length, descendants: count(org.id),
    };
    out.nodes.push(node);
    out.keyOf.set(org.id, org.id);
    if (parentKey) out.edges.push({ from: parentKey, to: org.id });
    out.levels = Math.max(out.levels, depth + 1);
    const { shown, folded } = planFold(kids.get(org.id) ?? [], org.id, fold, out.groups);
    const children = shown.map((k) => visit(k, org.id, depth + 1));
    if (folded.length > 0) {
      const group = addFoldedGroup(out, org.id, folded, depth, kids, count);
      place(group, []);
      children.push(group);
    }
    place(node, children);
    return node;
  };

  for (const r of roots) visit(r, null, 0);
  out.columns = leaf;
  return out;
}
