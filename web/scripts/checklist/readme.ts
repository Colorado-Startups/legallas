// SPDX-License-Identifier: Apache-2.0
// Fills docs/checklist/README.template.md from the checklist: the counts, tables and maps come from the items, and the rest
// from the template. A {{name}} nothing fills throws.
import type { ChecklistBaseline, ChecklistItem } from '../../worker/checklist-types.ts';

/** "Founder, lawyer, accountant": the first word as labelled, the rest in lower case. */
const sentenceList = (labels: readonly string[]) => labels.map((label, i) => (i === 0 ? label : label.toLowerCase())).join(', ');

function appliesTo(item: ChecklistItem, { labels, vocabulary }: ChecklistBaseline): string {
  return new Set(item.entity_types).size === vocabulary.entity_types.length ? 'All' : item.entity_types.map((word) => labels.entity_types[word]).join(', ');
}

function stageMap({ items, labels, vocabulary }: ChecklistBaseline): string {
  const stages = vocabulary.stages.filter((stage) => stage !== 'ongoing');
  const node = (stage: string, summary: string) => `["<b>${labels.stages[stage]}</b><br/>${summary}"]`;
  const count = (stage: string) => items.filter((item) => item.stage === stage).length;
  return [
    '```mermaid',
    'flowchart LR',
    ...stages.map((stage, i) => `  S${i}${node(stage, `${count(stage)} items`)}`),
    `  O${node('ongoing', `${count('ongoing')} yearly items, plus ${items.filter((item) => item.stage !== 'ongoing' && item.repeats).length} that repeat`)}`,
    `  ${stages.map((_, i) => `S${i}`).join(' --> ')}`,
    ...stages.slice(1).map((_, i) => `  S${i + 1} -.-> O`),
    '```',
  ].join('\n');
}

function relationshipMap({ items, labels, vocabulary: { relationships, categories } }: ChecklistBaseline): string {
  const lines = ['```mermaid', 'flowchart LR', '  subgraph Relationships'];
  relationships.forEach((word, i) => lines.push(`    R${i}["${labels.relationships[word]}: ${items.filter((item) => item.relationship === word).length}"]`));
  lines.push('  end', '  subgraph Categories');
  categories.forEach((word, i) => lines.push(`    C${i}["${labels.categories[word]}: ${items.filter((item) => item.category === word).length}"]`));
  lines.push('  end');
  relationships.forEach((relationship, r) =>
    categories
      .map((category, c) => ({ c, count: items.filter((item) => item.relationship === relationship && item.category === category).length }))
      .filter(({ count }) => count > 0)
      .sort((a, b) => b.count - a.count)
      .forEach(({ c, count }) => lines.push(`  R${r} -->|${count}| C${c}`)),
  );
  lines.push('```');
  return lines.join('\n');
}

function categoryTable(category: string, baseline: ChecklistBaseline): string {
  const { items, labels, vocabulary } = baseline;
  const lines = [
    `### ${labels.categories[category]}`,
    '',
    `| Item | ${vocabulary.stages.map((stage) => labels.stages[stage]).join(' | ')} | Applies to | Provided by | Rooms |`,
    `|:--|${vocabulary.stages.map(() => ':-:').join('|')}|:--|:--|:--|`,
  ];
  const notes: string[] = [];
  for (const item of items.filter((each) => each.category === category)) {
    const marked = Boolean(item.applies_when || item.deadline);
    const marks = vocabulary.stages.map((stage) => (item.stage === stage ? ' ● ' : stage === 'ongoing' && item.repeats ? ' ↻ ' : '  ')).join('|');
    const providers = sentenceList(item.provided_by.map((word) => labels.providers[word] ?? word));
    const rooms = item.room_roles.length ? sentenceList(item.room_roles.map((word) => labels.room_roles[word] ?? word)) : 'Owner only';
    lines.push(`| ${item.title}${marked ? ' †' : ''} |${marks}| ${appliesTo(item, baseline)} | ${providers} | ${rooms} |`);
    if (marked) notes.push(`- **${item.title}:** ${[item.applies_when, item.deadline && `Deadline: ${item.deadline}`].filter(Boolean).join(' ')}`);
  }
  if (notes.length) lines.push('', '† Conditions and deadlines:', '', ...notes);
  return lines.join('\n');
}

function investorIndex({ items, folders }: ChecklistBaseline): string {
  const titles = new Map(items.map((item) => [item.id, item.title]));
  return ['| Folder | What goes in |', '|:--|:--|', ...folders.map((folder) => `| ${folder.number}. ${folder.title} | ${folder.items.map((id) => titles.get(id)).join('; ')} |`)].join('\n');
}

/** The README for this checklist, from its template. */
export function renderReadme(template: string, baseline: ChecklistBaseline): string {
  const { items, labels, vocabulary, folders } = baseline;
  const fills: Readonly<Record<string, string>> = {
    notice: baseline.notice,
    status: baseline.status,
    drafted: baseline.drafted,
    scope: baseline.scope,
    item_count: String(items.length),
    category_count: String(vocabulary.categories.length),
    entity_types: vocabulary.entity_types.map((word) => labels.entity_types[word]).join(', '),
    source_count: String(items.reduce((sum, item) => sum + item.sources.length, 0)),
    folder_count: String(folders.length),
    stage_map: stageMap(baseline),
    relationship_map: relationshipMap(baseline),
    tables: vocabulary.categories.map((category) => categoryTable(category, baseline)).join('\n\n'),
    investor_index: investorIndex(baseline),
  };
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, name: string) => {
    if (!Object.hasOwn(fills, name)) throw new Error(`README template: nothing fills {{${name}}}`);
    return fills[name] as string;
  });
}
