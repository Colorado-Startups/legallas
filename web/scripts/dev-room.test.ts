// SPDX-License-Identifier: Apache-2.0
// The fixture room's settings (dev-room.ts): the company room shows the checklist, for its invented entity type and
// formation date, and the case room is the examples unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { COMPANY_ROOM_CONFIG, fixtureRoomFiles } from './dev-room.ts';
import { roomDefines } from './config.ts';
import { BASELINE } from '../worker/checklist-baseline.ts';

const read = (name: string) => readFileSync(path.join(import.meta.dirname, '..', name), 'utf8');

test('the case room is the examples, as before', () => {
  assert.deepEqual(fixtureRoomFiles('case', read), { 'wrangler.jsonc': read('wrangler.example.jsonc'), 'wrangler.mcp.jsonc': read('wrangler.mcp.example.jsonc') });
});

test('the company room turns the checklist on and gives both Workers its entity type and formation date', () => {
  const files = fixtureRoomFiles('company', read);
  const room = JSON.parse(files['wrangler.jsonc']);
  const mcp = JSON.parse(files['wrangler.mcp.jsonc']);
  assert.equal(room.vars.CHECKLIST_ENABLED, '1');
  assert.deepEqual(JSON.parse(files['room.config.json']!), COMPANY_ROOM_CONFIG);
  for (const config of [room, mcp]) {
    assert.deepEqual(config.define, { ...config.define, ...roomDefines(COMPANY_ROOM_CONFIG) });
    assert.equal(config.define.ROOM_ENTITY_TYPE, '"delaware-c-corporation"');
    assert.equal(config.define.ROOM_FORMATION_DATE, '"2011-06-01"');
  }
  assert.equal(room.main, './worker/entry-pro.ts', "pro's routes, as the examples");
});

test('the entity type is one the checklist knows', () => {
  assert.ok(BASELINE.vocabulary.entity_types.includes(COMPANY_ROOM_CONFIG.entityType));
});
