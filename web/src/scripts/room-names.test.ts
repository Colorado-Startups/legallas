// SPDX-License-Identifier: Apache-2.0
// The room's names in the browser (room-names.ts): with no data attribute on <html> (every page of a room that
// renames nothing, and Node), the strings are today's; a renamed room's attributes change them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CARDS, CLAUDE_ADD } from './connect-first.ts';
import { assistantName, instanceName, pageTitle } from './room-names.ts';

test("with no attributes, the room's strings are today's", () => {
  assert.equal(instanceName(), 'Legallas');
  assert.equal(assistantName(), 'Legallas');
  assert.equal(pageTitle('DOE-000412 Repair ticket'), 'DOE-000412 Repair ticket | Legallas');
  assert.equal(
    CLAUDE_ADD,
    'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Legallas&connectorUrl=https%3A%2F%2Fmcp.room.example.com%2Fmcp',
  );
  assert.equal(AI_CARDS.find((card) => card.app === 'copilot')?.who, 'Your IT team adds Legallas once; then it is in Outlook, Teams and Word');
});

test("a renamed room's <html> attributes rename the instance and the assistant", (t) => {
  const dataset: Record<string, string> = { instanceName: 'Acme Data Room', assistantName: 'Juniper' };
  (globalThis as { document?: unknown }).document = { documentElement: { dataset } };
  t.after(() => delete (globalThis as { document?: unknown }).document);
  assert.equal(instanceName(), 'Acme Data Room');
  assert.equal(assistantName(), 'Juniper');
  assert.equal(pageTitle('Overview'), 'Overview | Acme Data Room');
  delete dataset.assistantName;
  assert.equal(assistantName(), 'Legallas', 'an absent attribute is the default');
});

test('the Astro pages take the names from scripts/room-config.ts, whose fallback is worker/room-names.ts', () => {
  const web = join(import.meta.dirname, '..', '..');
  const read = (file: string) => readFileSync(join(web, file), 'utf8');
  assert.match(read('src/scripts/room-config.ts'), /export const names: RoomNames = roomNames\(roomConfig \?\? \{\}\);/);
  const room = read('src/layouts/Room.astro');
  for (const used of ['<title>{title} | {names.instanceName}</title>', '<span>{names.instanceName}</span>', '<p>{names.instanceName} counsel room. Private, by invitation only.</p>']) {
    assert.ok(room.includes(used), used);
  }
  // A renamed room's attributes only: with the default names the <html> element is what it was.
  assert.match(room, /const instanceAttr = names\.instanceName === DEFAULT_INSTANCE_NAME \? undefined : names\.instanceName;/);
  assert.match(room, /const assistantAttr = names\.assistantName === DEFAULT_ASSISTANT_NAME \? undefined : names\.assistantName;/);
  for (const door of ['src/pages/welcome/index.astro', 'src/pages/welcome/away/index.astro', 'src/pages/welcome/denied/index.astro']) {
    const source = read(door);
    assert.match(source, /<Door title=\{names\.instanceName\}/, door);
    assert.doesNotMatch(source, />Legallas</, `${door} has no literal name left`);
  }
});
