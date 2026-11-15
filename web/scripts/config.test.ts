// SPDX-License-Identifier: Apache-2.0
// The room config's file name: the neutral room.config.json first, the older legallas.config.json as the fallback
// that some rooms still use. The Astro build reads the same names.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertStoredName, brandAssetsDir, brandHasRig, CONFIG_NAMES, configuredControlPrefix, configuredRoomDefines, configuredStoredName, loadSyncConfig, roomDefines, roomGlobalName, storedNameOf, configuredInternalNotes, controlPrefixOf, DEFAULT_BRAND_ASSETS, emailPortraitPath, LEGALLAS_BRAND_ASSETS, LEGALLAS_EMAIL_PORTRAIT, NEUTRAL_BRAND_ASSETS,
  parseBrandAssets, parseInternalNotes, roomConfigPath,
} from './config.ts';

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(tmpdir(), 'room-config-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('room.config.json is read when present, even beside a legallas.config.json', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'legallas.config.json'), '{}');
    writeFileSync(path.join(dir, 'room.config.json'), '{}');
    assert.equal(roomConfigPath(dir), path.join(dir, 'room.config.json'));
  });
});

test('legallas.config.json is the fallback, a worktree symlink included', () => {
  withDir((dir) => {
    writeFileSync(path.join(dir, 'main.json'), '{}');
    symlinkSync(path.join(dir, 'main.json'), path.join(dir, 'legallas.config.json'));
    assert.equal(roomConfigPath(dir), path.join(dir, 'legallas.config.json'));
  });
});

test('with neither file, the neutral name is the one to create', () => {
  withDir((dir) => assert.equal(roomConfigPath(dir), path.join(dir, 'room.config.json')));
});

test('the Astro build tries the same names in the same order', () => {
  const reader = readFileSync(new URL('../src/scripts/room-config.ts', import.meta.url), 'utf8');
  const names = [...reader.matchAll(/'\.\.\/\.\.\/([a-z.]+\.config\.json)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(names)], [...CONFIG_NAMES]);
});

test('the brand pack is the Legallas pack where the checkout has it, else the neutral one, unless brandAssets names another', () => {
  assert.equal(parseBrandAssets({}, '/web'), DEFAULT_BRAND_ASSETS);
  assert.equal(parseBrandAssets({ brandAssets: null }, '/web'), DEFAULT_BRAND_ASSETS);
  assert.ok(LEGALLAS_BRAND_ASSETS.endsWith(path.join('src', 'assets', 'legallas')));
  assert.ok(existsSync(NEUTRAL_BRAND_ASSETS), 'the core ships the neutral pack');
  assert.equal(DEFAULT_BRAND_ASSETS, existsSync(LEGALLAS_BRAND_ASSETS) ? LEGALLAS_BRAND_ASSETS : NEUTRAL_BRAND_ASSETS);
  assert.equal(parseBrandAssets({ brandAssets: 'brand/neutral' }, '/web'), path.join('/web', 'brand', 'neutral'));
  assert.equal(parseBrandAssets({ brandAssets: '/opt/art' }, '/web'), '/opt/art');
  assert.equal(parseBrandAssets({ brandAssets: '~/art' }, '/web', '/home/u'), '/home/u/art');
  assert.throws(() => parseBrandAssets({ brandAssets: '' }, '/web'), /brandAssets/);
  assert.throws(() => parseBrandAssets({ brandAssets: 3 }, '/web'), /brandAssets/);
});

test('brandAssetsDir reads the key from the config file and refuses a folder that is not there', () => {
  withDir((dir) => {
    const file = path.join(dir, 'room.config.json');
    assert.equal(brandAssetsDir(file), DEFAULT_BRAND_ASSETS, 'no config: the default');
    writeFileSync(file, JSON.stringify({ brandAssets: 'art' }));
    assert.throws(() => brandAssetsDir(file), /does not exist/);
    mkdirSync(path.join(dir, 'art'));
    assert.equal(brandAssetsDir(file), path.join(dir, 'art'));
  });
});

test('brandHasRig: exactly one .riv in the pack, the rule the loader uses, so a pack without one ships no Rive runtime', () => {
  withDir((dir) => {
    assert.equal(brandHasRig(dir), false, 'none');
    writeFileSync(path.join(dir, 'companion.riv'), '');
    assert.equal(brandHasRig(dir), true, 'one');
    writeFileSync(path.join(dir, 'second.riv'), '');
    assert.equal(brandHasRig(dir), false, 'two: the loader keeps the stills');
  });
  assert.equal(brandHasRig(NEUTRAL_BRAND_ASSETS), false, 'the neutral pack has no rig');
});

test('the mail builder embeds docs/email/legallas-v3.png for the Legallas pack, email-portrait.png for any other', () => {
  assert.equal(emailPortraitPath(LEGALLAS_BRAND_ASSETS), LEGALLAS_EMAIL_PORTRAIT);
  assert.equal(emailPortraitPath(NEUTRAL_BRAND_ASSETS), path.join(NEUTRAL_BRAND_ASSETS, 'email-portrait.png'));
  assert.ok(LEGALLAS_EMAIL_PORTRAIT.endsWith(path.join('docs', 'email', 'legallas-v3.png')));
  assert.equal(emailPortraitPath('/opt/art'), path.join('/opt/art', 'email-portrait.png'));
});

test('the control prefix comes from the config, with the room fallback', () => {
  assert.equal(controlPrefixOf({ controlPrefix: 'ROE' }), 'ROE');
  assert.equal(controlPrefixOf({ controlPrefix: 'DOE' }), 'DOE');
  assert.equal(controlPrefixOf({ controlPrefix: 'roe' }), 'DOC');
  assert.equal(controlPrefixOf(null), 'DOC');
});

test('the configured prefix is the config\'s own, and null with no config or only the fallback', () => {
  withDir((dir) => {
    const file = path.join(dir, 'room.config.json');
    assert.equal(configuredControlPrefix(file), null, 'no config');
    writeFileSync(file, JSON.stringify({ controlPrefix: 'ROE' }));
    assert.equal(configuredControlPrefix(file), 'ROE');
    for (const controlPrefix of ['DOE', 'DOC', 'roe', undefined]) {
      writeFileSync(file, JSON.stringify({ controlPrefix }));
      assert.equal(configuredControlPrefix(file), null, String(controlPrefix));
    }
    writeFileSync(file, '{');
    assert.throws(() => configuredControlPrefix(file), SyntaxError, 'a broken config is an error, not "none"');
  });
});

test('internalNotes: none without the key, compiled to ignore case with it, refused when malformed', () => {
  assert.deepEqual(parseInternalNotes({}), []);
  assert.deepEqual(parseInternalNotes({ internalNotes: null }), []);
  assert.deepEqual(parseInternalNotes({ internalNotes: [] }), []);
  const notes = parseInternalNotes({ internalNotes: [{ note: 'scanner batch', pattern: '\\bscanner batch\\b' }] });
  assert.deepEqual(notes.map(({ note }) => note), ['scanner batch']);
  assert.ok(notes[0]?.pattern.test('Scanner Batch 7'));
  assert.throws(() => parseInternalNotes({ internalNotes: 'scanner' }), /internalNotes must be a list/);
  assert.throws(() => parseInternalNotes({ internalNotes: ['scanner'] }), /internalNotes\[0\] needs/);
  assert.throws(() => parseInternalNotes({ internalNotes: [{ note: 'scanner' }] }), /internalNotes\[0\] needs/);
  assert.throws(() => parseInternalNotes({ internalNotes: [{ note: 'a', pattern: 'a' }, { note: '', pattern: 'b' }] }), /internalNotes\[1\] needs/);
  assert.throws(
    () => parseInternalNotes({ internalNotes: [{ note: 'a', pattern: 'unclosed(' }] }),
    (error: Error) => /internalNotes\[0\] has an invalid pattern/.test(error.message) && !error.message.includes('unclosed'),
  );
});

test('configuredInternalNotes reads the key from the config file, and finds none with no config', () => {
  withDir((dir) => {
    const file = path.join(dir, 'room.config.json');
    assert.deepEqual(configuredInternalNotes(file), []);
    writeFileSync(file, JSON.stringify({ internalNotes: [{ note: 'scanner batch', pattern: 'scanner batch' }] }));
    assert.deepEqual(configuredInternalNotes(file).map(({ note }) => note), ['scanner batch']);
    writeFileSync(file, '{ not json');
    assert.throws(() => configuredInternalNotes(file), SyntaxError);
  });
});

test('storedName: the default without the key, the name with it, refused when it could not sit in SQL or a selector', () => {
  assert.equal(storedNameOf({}), 'legallas');
  assert.equal(storedNameOf({ storedName: 'acme2' }), 'acme2');
  for (const bad of ['', 'Acme', '2acme', 'a-b', "a'b", 'a b', 'a'.repeat(17), 7]) {
    assert.throws(() => storedNameOf({ storedName: bad }), /storedName must be/);
  }
});

test('configuredStoredName reads the key from the config file, and finds the default with no config', () => {
  withDir((dir) => {
    const file = path.join(dir, 'room.config.json');
    assert.equal(configuredStoredName(file), 'legallas');
    writeFileSync(file, '{"storedName":"acme"}');
    assert.equal(configuredStoredName(file), 'acme');
  });
});

test('a run that started without the preload stops, rather than miss the manifest or index hidden data files', async () => {
  assert.throws(() => assertStoredName({ storedName: 'acme' }, 'legallas'), /storedName is acme, but this run has legallas/);
  assert.doesNotThrow(() => assertStoredName({ storedName: 'acme' }, 'acme'));
  assert.doesNotThrow(() => assertStoredName({}, 'legallas'));
  const dir = mkdtempSync(path.join(tmpdir(), 'room-config-'));
  try {
    const file = path.join(dir, 'room.config.json');
    writeFileSync(file, JSON.stringify({ storedName: 'acme', sourceRoot: '/a/source', inboxDir: '/a/inbox', cacheDir: '/a/cache' }));
    await assert.rejects(loadSyncConfig(file), /storedName is acme/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the preload gives a script the configured name, tries the same names and sets nothing without a config', () => {
  withDir((dir) => {
    const preload = path.join(dir, 'scripts', 'room-preload.ts');
    mkdirSync(path.dirname(preload));
    writeFileSync(preload, readFileSync(new URL('./room-preload.ts', import.meta.url)));
    const seen = () => execFileSync(process.execPath, ['--import', preload, '--input-type=module', '--eval', 'console.log(String(globalThis.ROOM_STORED_NAME))'], { encoding: 'utf8' }).trim();
    assert.equal(seen(), 'undefined');
    writeFileSync(path.join(dir, CONFIG_NAMES[1]), '{"storedName":"older"}');
    assert.equal(seen(), 'older');
    writeFileSync(path.join(dir, CONFIG_NAMES[0]), '{"storedName":"acme"}');
    assert.equal(seen(), 'acme');
    writeFileSync(path.join(dir, CONFIG_NAMES[0]), '{}');
    assert.equal(seen(), 'undefined', 'the first config found decides, as roomConfigPath does');
  });
});

test('a config that is not valid JSON stops the preload without quoting what it holds', () => {
  withDir((dir) => {
    const preload = path.join(dir, 'scripts', 'room-preload.ts');
    mkdirSync(path.dirname(preload));
    writeFileSync(preload, readFileSync(new URL('./room-preload.ts', import.meta.url)));
    writeFileSync(path.join(dir, CONFIG_NAMES[0]), '{"sourceRoot": "/private/path-sentinel", broken');
    const run = spawnSync(process.execPath, ['--import', preload, '--input-type=module', '--eval', ''], { encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /room\.config\.json is not valid JSON/);
    assert.doesNotMatch(run.stderr, /path-sentinel/);
  });
});

test('every npm script that runs a script starts it with the preload', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  // The tests (node --test, or scripts/run-tests.ts for npm test) run on the defaults, never a room's settings.
  const runs = Object.entries(scripts).filter(([, command]) => /\bnode\s+(?!--test\b|scripts\/run-tests\.ts\b)/.test(command));
  assert.ok(runs.length > 10);
  for (const [name, command] of runs) assert.match(command, /node --import \.\/scripts\/room-preload\.ts /, name);
  assert.doesNotMatch(scripts.test!, /room-preload/, 'npm test');
});

test('a text setting holding <, > or " stops the build with its name (#243)', () => {
  for (const bad of ['Ada <ada@doe.example>', 'Doe "Kitchen" Co', 'a > b']) {
    assert.throws(() => roomDefines({ ownerName: bad }), { message: 'room config: ownerName must not hold <, > or "' }, bad);
  }
  assert.doesNotThrow(() => roomDefines({ ownerName: 'Ada Doe', companyName: 'Harbor Labs, Inc.' }));
});

test('roomDefines writes each setting as a literal, and undefined for one left out, so the code default is used', () => {
  const defines = roomDefines({ mcpHost: 'mcp.acme.example', regulatorOrders: [{ label: 'L', question: ['Q?'] }], storedName: 'acme', banner: 'not a build setting' });
  assert.equal(defines.ROOM_MCP_HOST, '"mcp.acme.example"');
  assert.equal(defines.ROOM_REGULATOR_ORDERS, '[{"label":"L","question":["Q?"]}]');
  assert.equal(defines.ROOM_STORED_NAME, '"acme"');
  assert.equal(defines.ROOM_HOST, 'undefined');
  assert.equal(defines.ROOM_BANNER, undefined);
  assert.throws(() => roomDefines({ mcpHost: 7 }), /mcpHost must be text/);
  assert.throws(() => roomDefines({ extraClaimTypes: 'one' }), /extraClaimTypes must be a list/);
  // A1: the build stops on an assistant name that could pass for a lawyer, with the notices file's message.
  assert.throws(() => roomDefines({ assistantName: 'Ada Lane, Esq.' }), /^Error: room config: assistantName\. That name could make people think a lawyer is answering\. Please pick another\.$/);
  assert.doesNotThrow(() => roomDefines({ assistantName: 'Juniper' }));
  assert.equal(roomDefines(undefined).ROOM_STORED_NAME, '"legallas"');
  withDir((dir) => {
    const file = path.join(dir, 'room.config.json');
    assert.equal(configuredRoomDefines(file).ROOM_MCP_HOST, 'undefined');
    writeFileSync(file, '{"mcpHost":"m.example"}');
    assert.equal(configuredRoomDefines(file).ROOM_MCP_HOST, '"m.example"');
  });
});

test('a config that is not valid JSON stops the build without quoting what it holds', () => {
  withDir((dir) => {
    const file = path.join(dir, 'room.config.json');
    writeFileSync(file, '{"sourceRoot": "/private/path-sentinel", broken');
    for (const read of [configuredRoomDefines, configuredStoredName]) {
      assert.throws(() => read(file), (error: Error) => /room\.config\.json is not valid JSON/.test(error.message) && !error.message.includes('path-sentinel'));
    }
  });
});

test('the preload names each global by roomGlobalName', () => {
  withDir((dir) => {
    const preload = path.join(dir, 'scripts', 'room-preload.ts');
    mkdirSync(path.dirname(preload));
    writeFileSync(preload, readFileSync(new URL('./room-preload.ts', import.meta.url)));
    writeFileSync(path.join(dir, CONFIG_NAMES[0]), '{"mcpHost":"m.example","priorCaseLabel":"Old case"}');
    const seen = execFileSync(process.execPath, ['--import', preload, '--input-type=module', '--eval', `console.log(globalThis.${roomGlobalName('mcpHost')}, '|', globalThis.${roomGlobalName('priorCaseLabel')})`], { encoding: 'utf8' }).trim();
    assert.equal(seen, 'm.example | Old case');
    assert.equal(roomGlobalName('mcpHost'), 'ROOM_MCP_HOST');
  });
});
