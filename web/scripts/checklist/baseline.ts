// SPDX-License-Identifier: Apache-2.0
// Reads docs/checklist/baseline.toml and refuses a list the product couldn't rely on: an item with no public source, a word
// outside the vocabulary, an investor folder that doesn't hold exactly the investor items, or wording the product may not
// show (docs/legal/product-notices.md, A1).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import type { ChecklistBaseline, ChecklistFolder, ChecklistItem, ChecklistTemplate } from '../../worker/checklist-types.ts';

const BANNED_WORDS = /\b(you|your|should|verified|reliable|ironclad|legal advice|informational purposes|tax advice|tax adviser|tax planning)\b/i;

type RawItem = Omit<ChecklistItem, 'templates'> & { templates?: string[] };

interface RawBaseline extends Omit<ChecklistBaseline, 'items' | 'folders'> {
  item: RawItem[];
  diligence: { folder: ChecklistFolder[] };
}

/**
 * One file the build serves (integrations/template-assets.mjs), with what it says about itself. Null if it isn't there, says
 * too little, or has a licence the card has no plain words for (docs/legal/product-notices.md, A5).
 */
function readTemplate(path: string): ChecklistTemplate | null {
  if (!/^founders\/[a-z0-9-]+\.md$/.test(path)) return null;
  let text: string;
  try {
    text = readFileSync(fileURLToPath(new URL(`../../../templates/${path}`, import.meta.url)), 'utf8');
  } catch {
    return null;
  }
  const frontMatter = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  // By position: the field name is never made into a pattern.
  const field = (name: string) => frontMatter.split('\n').find((line) => line.startsWith(`${name}: `) && line.length > name.length + 2)?.slice(name.length + 2).trim();
  const [title, source, licence, lawChecked, entities] = [field('title'), field('source'), field('licence'), field('date_checked'), field('entity')];
  if (!title || !source || licence !== 'CC0-1.0' || !lawChecked || !entities) return null;
  // The templates say delaware-corporation; the list says delaware-c-corporation.
  const entityTypes = entities.replace(/[[\]\s]/g, '').split(',').map((word) => (word === 'delaware-corporation' ? 'delaware-c-corporation' : word));
  const version = /^Legallas template \S+ version (\S+?)\./m.exec(text)?.[1] ?? null;
  if (field('kind') === 'template' && !version) return null;
  return { title, path, source, version, law_checked: lawChecked, entity_types: entityTypes };
}

/** The checklist in the toml. Throws, listing every problem, when the product couldn't rely on it. */
export function parseBaseline(source: string): ChecklistBaseline {
  const raw = parse(source) as unknown as RawBaseline;
  const { title, notice, template_notice, template_card_notice, template_licence_notice, status, drafted, scope, vocabulary, labels, item: rawItems, diligence } = raw;
  const problems: string[] = [];
  const seen = new Set<string>();
  const items = rawItems.map(({ templates, ...item }): ChecklistItem => {
    if (!templates) return item;
    const read = templates.map((path) => {
      const template = readTemplate(path);
      if (!template) problems.push(`${item.id}: templates/${path} isn't a file the build serves, with its front matter`);
      return template;
    });
    return { ...item, templates: read.filter((template): template is ChecklistTemplate => template !== null) };
  });
  for (const item of items) {
    const problem = (text: string) => problems.push(`${item.id}: ${text}`);
    if (seen.has(item.id)) problem('appears twice');
    seen.add(item.id);
    if (!item.id.startsWith(`${item.category}.`)) problem('the id must start with its category');
    const words: [string, readonly string[], readonly string[]][] = [
      ['category', [item.category], vocabulary.categories],
      ['relationship', [item.relationship], vocabulary.relationships],
      ['stage', [item.stage], vocabulary.stages],
      ['entity_types', item.entity_types, vocabulary.entity_types],
      ['provided_by', item.provided_by, vocabulary.providers],
      ['room_roles', item.room_roles, vocabulary.room_roles],
    ];
    for (const [field, used, allowed] of words) for (const word of used) if (!allowed.includes(word)) problem(`${field}: unknown word ${word}`);
    if (!item.sources?.length) problem('every item keeps a public source');
    for (const { url } of item.sources ?? []) if (!url.startsWith('https://')) problem(`${url} must be an https link`);
    if (item.due?.kind === 'after') for (const from of item.due.from) if (!items.some((other) => other.id === from)) problem(`due: no item ${from}`);
    const shown = [item.title, item.why, item.evidence, item.repeats, item.deadline, item.note, item.date_label, item.applies_when, ...Object.values(item.title_by_entity ?? {})];
    for (const text of shown) {
      const banned = text && BANNED_WORDS.exec(text);
      if (banned) problem(`the product may not say "${banned[0]}"`);
    }
  }
  // Every item whose rooms include investors sits in exactly one folder, and nothing else does.
  const placed = diligence.folder.flatMap((folder) => folder.items);
  const investorItems = items.filter((item) => item.room_roles.includes('investors')).map((item) => item.id);
  if (new Set(placed).size !== placed.length) problems.push('an item sits in two investor folders');
  for (const id of investorItems) if (!placed.includes(id)) problems.push(`${id}: has investors in its rooms and sits in no folder`);
  for (const id of placed) if (!investorItems.includes(id)) problems.push(`${id}: in an investor folder, without investors in its rooms`);
  if (problems.length > 0) throw new Error(`baseline toml:\n${problems.join('\n')}`);
  return { title, notice, template_notice, template_card_notice, template_licence_notice, status, drafted, scope, vocabulary, labels, items, folders: diligence.folder };
}
