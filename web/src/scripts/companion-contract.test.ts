// SPDX-License-Identifier: Apache-2.0
// Card D3, plan PR-L2. The companion contract: names, faces, the rig's file and fallback stills, and the state reducer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { brandAssetsDir } from '../../scripts/config.ts';
import {
  COMPANION_STATES, FACES, drawnStates, GUIDE_INITIAL_MODEL, INITIAL_MODEL, POSE_NAMES, RIVE_NAMES, TALK_MOUTHS, clampLook, isCompanionState, reduce,
  sheetsFor, stateOf, variantsFor, wantsRig, type CompanionEvent, type CompanionModel,
} from './companion-contract.ts';

// The brand pack the build uses (astro.config.mjs @brand): the owner's src/assets/legallas/ unless the room
// config names another.
const ASSETS = pathToFileURL(`${brandAssetsDir()}/`);
const rigs = readdirSync(ASSETS).filter((name) => name.endsWith('.riv'));
const riv = rigs[0] ? readFileSync(new URL(rigs[0], ASSETS)) : Buffer.alloc(0);
const WEBP = { riff: 'RIFF', webp: 'WEBP' };

/** Width and height of a WebP (VP8X, VP8L or VP8 bitstream), or null when it is not one. */
function webpSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.toString('latin1', 0, 4) !== WEBP.riff || bytes.toString('latin1', 8, 12) !== WEBP.webp) return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  return null;
}

test('the state list and the Rive names are fixed', () => {
  assert.deepEqual([...COMPANION_STATES], ['hello', 'idle', 'listening', 'reading', 'speaking', 'citing', 'unknown', 'error']);
  assert.equal(RIVE_NAMES.artboard, 'Companion');
  assert.equal(RIVE_NAMES.stateMachine, 'Companion');
  assert.equal(RIVE_NAMES.viewModel, 'Companion');
  assert.deepEqual(Object.values(RIVE_NAMES.inputs).sort(), ['docs', 'lookX', 'lookY', 'quiet', 'state']);
  assert.ok(isCompanionState('citing'));
  for (const bad of ['wave', 'thinking', '', null, 3, 'IDLE', '__proto__']) assert.equal(isCompanionState(bad), false, String(bad));
});

test('every state has a face, and each face shows exactly one brow, eye and mouth pose', () => {
  assert.deepEqual(Object.keys(FACES).sort(), [...COMPANION_STATES].sort());
  for (const state of COMPANION_STATES) {
    const v = variantsFor(state);
    for (const part of ['brows-', 'eyes-', 'mouth-']) assert.equal(v.filter((n) => n.startsWith(part)).length, 1, `${state} ${part}`);
    for (const name of v) assert.ok(POSE_NAMES.includes(name), `${state} uses unknown pose ${name}`);
  }
  assert.ok(variantsFor('reading').includes('papers'));
  assert.ok(variantsFor('citing').includes('papers'));
  assert.ok(!variantsFor('idle').includes('papers'));
  // R61: the raised palm greets (hello) and the open palm up is "not in the record"; nothing else gestures.
  const hands = (state: (typeof COMPANION_STATES)[number]) => variantsFor(state).filter((n) => n.startsWith('hand-'));
  assert.deepEqual(hands('hello'), ['hand-raised']);
  assert.deepEqual(hands('unknown'), ['hand-open']);
  for (const state of COMPANION_STATES.filter((s) => s !== 'hello' && s !== 'unknown')) assert.deepEqual(hands(state), [], state);
  assert.ok(TALK_MOUTHS.includes(FACES.speaking.mouth), 'speaking starts on a mouth the cycle uses');
});

test('the brand pack has exactly one .riv, the rig companion-rive.ts loads', { skip: rigs.length === 0 && 'this brand pack has no rig' }, () => {
  assert.equal(rigs.length, 1, `one rig in ${ASSETS.pathname}, found ${rigs.join(', ') || 'none'}`);
});

test('the .riv is a Rive file that carries every contract name', { skip: rigs.length === 0 && 'this brand pack has no rig' }, () => {
  // A .riv stores its names as plain UTF-8 strings: the artboard, state machine and view model, the enum and its
  // values, and the view model's properties. The rig is built in the art repository (`rive --once`) and copied in as it is.
  assert.equal(riv.toString('latin1', 0, 4), 'RIVE');
  const text = riv.toString('utf8');
  const names = [RIVE_NAMES.artboard, RIVE_NAMES.stateMachine, RIVE_NAMES.viewModel, RIVE_NAMES.stateEnum, ...Object.values(RIVE_NAMES.inputs), ...COMPANION_STATES];
  for (const name of names) assert.ok(text.includes(name), `${rigs[0]} has no ${name}`);
});

test('every state has a fallback still, 240:280 WebP, and nothing else is in the folder', { skip: rigs.length === 0 && 'this brand pack has no rig' }, () => {
  const folder = new URL('states/', ASSETS);
  assert.deepEqual(readdirSync(folder).sort(), COMPANION_STATES.map((s) => `${s}.webp`).sort());
  for (const state of COMPANION_STATES) {
    const size = webpSize(readFileSync(new URL(`${state}.webp`, folder)));
    assert.ok(size, `${state}.webp is a WebP`);
    assert.equal(size.width * 280, size.height * 240, `${state}.webp is 240:280 (${size.width}x${size.height})`);
    // 2x the largest shown width (Ask, 192px) at least, so astro:assets never scales one up.
    assert.ok(size.width >= 384, `${state}.webp is at least 384px wide`);
  }
});

test('the stills are distinct: no state reuses another state\'s image', { skip: rigs.length === 0 && 'this brand pack has no rig' }, () => {
  const seen = new Map<string, string>();
  for (const state of COMPANION_STATES) {
    const key = readFileSync(new URL(`states/${state}.webp`, ASSETS)).toString('base64');
    assert.equal(seen.get(key), undefined, `${state} repeats ${seen.get(key)}`);
    seen.set(key, state);
  }
});

test('a brand pack has every still or none: none draws nothing, some of them stops the build', () => {
  const names = (states: readonly string[]) => new Set(states.map((state) => `${state}.webp`));
  assert.deepEqual(drawnStates(new Set()), [], 'no stills: no companion');
  assert.deepEqual(drawnStates(names(COMPANION_STATES)), COMPANION_STATES, 'every still: all of them, in contract order');
  const [missing, ...rest] = COMPANION_STATES;
  assert.throws(() => drawnStates(names(rest)), new RegExp(`no states/${missing}\\.webp`), 'all but one');
  assert.throws(() => drawnStates(names(['idle'])), /every companion state needs a still/, 'just one');
  assert.throws(() => drawnStates(new Set(['other.webp'])), /every companion state needs a still/, 'none of the right names');
});

test('the stills component renders a picture per state and the loader shows them by data-still', () => {
  const component = readFileSync(new URL('../components/LegallasStills.astro', import.meta.url), 'utf8');
  assert.match(component, /import\.meta\.glob<[^>]+>\('@brand\/states\/\*\.webp'/);
  assert.match(component, /drawnStates\(new Set\(byName\.keys\(\)\)\)\.map/);
  assert.match(component, /'data-still': state, hidden: state !== first/);
  const loader = readFileSync(new URL('companion-rive.ts', import.meta.url), 'utf8');
  assert.match(loader, /picture\[data-still\]/);
  assert.match(loader, /import\.meta\.glob<string>\('@brand\/\*\.riv', \{ eager: true, query: '\?url', import: 'default' \}\)/);
  // No stills: a state with no picture changes nothing, and the window with nothing in it stays hidden.
  assert.match(loader, /if \(!picture \|\| picture === this\.shown\) return;/);
  // A pack without exactly one rig keeps the stills (loadRive rejects) instead of breaking the page at import.
  assert.match(loader, /^const rivUrl: string \| null = rigs\.length === 1 \? rigs\[0\] : null;$/m);
  assert.match(loader, /async function loadRive\(host: HTMLElement\): Promise<RiveHandle> \{\n  if \(rivUrl === null\) throw /);
  const css = readFileSync(new URL('../styles/companion.css', import.meta.url), 'utf8');
  assert.match(css, /\.companion-art:empty \{\n  display: none;/);
  assert.match(css, /\.companion-art > picture\[hidden\],\s*\.companion-art\[data-renderer='rive'\] > picture \{\s*display: none;/);
});

test('the rig gate: no Rive until the rig is ready, and never once gone or under reduced motion', () => {
  // Off path (RIG_READY false): the stills stay whatever the motion setting.
  for (const gone of [false, true]) for (const reduced of [false, true]) assert.equal(wantsRig(false, gone, reduced), false);
  // On path, for when Lane D's rig lands.
  assert.equal(wantsRig(true, false, false), true);
  assert.equal(wantsRig(true, true, false), false);
  assert.equal(wantsRig(true, false, true), false);
  // The rig is in (gen2: the art repository main), so the loader opens the gate, and every load path goes through it.
  const loader = readFileSync(new URL('companion-rive.ts', import.meta.url), 'utf8');
  assert.match(loader, /^export const RIG_READY = true;$/m, 'RIG_READY is true while the .riv and the stills come from the same rig');
  assert.match(loader, /get still\(\): boolean \{\s*return !wantsRig\(RIG_READY, this\.gone, this\.motion\.matches\);/);
  const upgrades = loader.match(/void this\.upgrade\(\)|: this\.upgrade\(\)/g) ?? [];
  assert.equal(upgrades.length, 2, 'the two upgrade calls (start and a motion change)');
  assert.match(loader, /else if \(!this\.rive && !this\.still\) void this\.upgrade\(\);/);
  assert.match(loader, /return this\.still \? Promise\.resolve\('still'\) : this\.upgrade\(\);/);
});

test('the loader starts the one state machine with the singular stateMachine option', () => {
  // @rive-app/canvas 2.44 deprecates the plural stateMachines (it logs a console warning); stateMachine takes priority.
  const loader = readFileSync(new URL('companion-rive.ts', import.meta.url), 'utf8');
  assert.match(loader, /^\s+stateMachine: RIVE_NAMES\.stateMachine,$/m);
  assert.doesNotMatch(loader, /\bstateMachines\s*:/);
});

test('sheets: whole, 0 to 5', () => {
  const cases: [number, number][] = [[0, 0], [1, 1], [3.9, 3], [5, 5], [62, 5], [-2, 0], [NaN, 0], [Infinity, 5], [-Infinity, 0]];
  for (const [docs, want] of cases) assert.equal(sheetsFor(docs), want, String(docs));
});

test('look: clamped to -1..1, junk looks straight out', () => {
  assert.deepEqual(clampLook(0.3, -0.4), { x: 0.3, y: -0.4 });
  assert.deepEqual(clampLook(4, -9), { x: 1, y: -1 });
  assert.deepEqual(clampLook(NaN, Infinity), { x: 0, y: 0 });
});

const run = (events: CompanionEvent[], from: CompanionModel = INITIAL_MODEL) => events.reduce(reduce, from);

test('a full exchange: hello, listening, reading with docs, speaking, then idle', () => {
  let m = INITIAL_MODEL;
  assert.equal(stateOf(m), 'hello');
  m = reduce(m, { type: 'greeted' });
  assert.equal(stateOf(m), 'idle');
  m = reduce(m, { type: 'typing', active: true });
  assert.equal(stateOf(m), 'listening');
  m = reduce(m, { type: 'send' });
  assert.deepEqual(m, { under: 'reading', docs: 0, busy: true, citing: false });
  m = reduce(m, { type: 'docs', count: 6 });
  assert.equal(m.docs, 6);
  m = reduce(m, { type: 'delta' });
  assert.equal(stateOf(m), 'speaking');
  m = reduce(m, { type: 'done', dontKnow: false });
  assert.deepEqual(m, { under: 'idle', docs: 6, busy: false, citing: false });
});

test('done with the dontKnow verdict shows unknown until the next question', () => {
  const m = run([{ type: 'send' }, { type: 'delta' }, { type: 'done', dontKnow: true }]);
  assert.equal(stateOf(m), 'unknown');
  assert.equal(stateOf(reduce(m, { type: 'greeted' })), 'unknown');
  assert.equal(stateOf(reduce(m, { type: 'typing', active: true })), 'listening');
  assert.equal(stateOf(reduce(m, { type: 'typing', active: false })), 'unknown', 'leaving the box keeps the verdict');
});

test('cite focus overlays citing on any state and lifts back to what was under it', () => {
  for (const under of ['idle', 'speaking', 'unknown', 'reading'] as const) {
    const m: CompanionModel = { under, docs: 2, busy: under === 'speaking' || under === 'reading', citing: false };
    const on = reduce(m, { type: 'cite', focused: true });
    assert.equal(stateOf(on), 'citing');
    assert.equal(on.under, under);
    assert.equal(stateOf(reduce(on, { type: 'cite', focused: false })), under);
  }
});

test('an error clears citing and ends the request', () => {
  const m = run([{ type: 'send' }, { type: 'cite', focused: true }, { type: 'error' }]);
  assert.deepEqual(m, { under: 'error', docs: 0, busy: false, citing: false });
  assert.equal(stateOf(run([{ type: 'send' }], m)), 'reading', 'the next question starts over');
});

test('stale events are ignored and return the same model', () => {
  const idle: CompanionModel = { under: 'idle', docs: 0, busy: false, citing: false };
  for (const e of [{ type: 'delta' }, { type: 'done', dontKnow: true }, { type: 'docs', count: 4 }] as CompanionEvent[]) {
    assert.equal(reduce(idle, e), idle, `${e.type} with nothing in flight`);
  }
  const streaming = run([{ type: 'send' }, { type: 'delta' }]);
  assert.equal(reduce(streaming, { type: 'typing', active: true }), streaming, 'typing while streaming');
  assert.equal(reduce(streaming, { type: 'delta' }), streaming, 'a second delta changes nothing');
  assert.equal(reduce(streaming, { type: 'cite', focused: false }), streaming);
  assert.equal(reduce(idle, { type: 'greeted' }), idle);
  assert.equal(reduce(idle, { type: 'typing', active: false }), idle);
  const reading = run([{ type: 'send' }, { type: 'docs', count: 3 }]);
  assert.equal(reduce(reading, { type: 'docs', count: NaN }), reading, 'a junk count keeps the last one');
  assert.equal(reduce(reading, { type: 'docs', count: 3 }), reading);
});

test('a new question resets the docs count and drops a stale cite overlay', () => {
  const m = run([{ type: 'send' }, { type: 'docs', count: 9 }, { type: 'done', dontKnow: false }, { type: 'cite', focused: true }, { type: 'send' }]);
  assert.deepEqual(m, { under: 'reading', docs: 0, busy: true, citing: false });
});

test('the guide starts at rest and each page event moves the state beneath', () => {
  assert.equal(stateOf(GUIDE_INITIAL_MODEL), 'idle', 'no entrance greeting');
  const steps: [CompanionEvent, string][] = [
    [{ type: 'hello' }, 'hello'],
    [{ type: 'look' }, 'listening'],
    [{ type: 'open' }, 'reading'],
    [{ type: 'cite', focused: true }, 'citing'],
    [{ type: 'gap' }, 'unknown'],
    [{ type: 'error' }, 'error'],
    [{ type: 'rest' }, 'idle'],
  ];
  let m = GUIDE_INITIAL_MODEL;
  for (const [event, state] of steps) {
    m = reduce(m, event);
    assert.equal(stateOf(m), state, event.type);
  }
});

test('a guide event lifts the cite overlay, repeats return the same model, and a request in flight wins', () => {
  const citing = run([{ type: 'open' }, { type: 'cite', focused: true }], GUIDE_INITIAL_MODEL);
  assert.equal(stateOf(reduce(citing, { type: 'open' })), 'reading', 'the same state beneath still lifts the overlay');
  assert.equal(stateOf(reduce(citing, { type: 'rest' })), 'idle');
  const looking = reduce(GUIDE_INITIAL_MODEL, { type: 'look' });
  assert.equal(reduce(looking, { type: 'look' }), looking);
  assert.equal(reduce(GUIDE_INITIAL_MODEL, { type: 'rest' }), GUIDE_INITIAL_MODEL);
  const busy = run([{ type: 'send' }]);
  for (const type of ['hello', 'look', 'open', 'gap', 'rest'] as const) assert.equal(reduce(busy, { type }), busy, type);
});
