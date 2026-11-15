// SPDX-License-Identifier: Apache-2.0
// Adds a known SSN to the sync's SSN guard as a salted scrypt hash (pii-hash.ts), local only:
//
//   npm run pii -- --add-hash [--config <file>]
//
// The number is read from the terminal without echo, twice, or once from a pipe; it is never printed, logged or
// written anywhere except as its hash under piiHashes in legallas.config.json (default web/legallas.config.json; a
// worktree's symlink is followed and kept). The file is rewritten in place with mode 600.
import { chmod, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_CONFIG_PATH } from './config.ts';
import { KnownSsnHashes, parsePiiHashes, withHash } from './pii-hash.ts';

const USAGE = 'usage: npm run pii -- --add-hash [--config <file>]';

export function parsePiiArgs(args: readonly string[]): { config: string } {
  let add = false;
  let config = DEFAULT_CONFIG_PATH;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--add-hash') add = true;
    else if (args[i] === '--config' && args[i + 1]) config = path.resolve(args[++i]);
    else throw new Error(USAGE);
  }
  if (!add) throw new Error(USAGE);
  return { config };
}

/** The nine digits of what was typed, separators dropped, or an error that never repeats the input. */
export function nineDigitsOf(typed: string): string {
  const digits = typed.replace(/[\s\-.\u2010-\u2014]/g, '');
  if (!/^\d{9}$/.test(digits)) throw new Error('Expected exactly nine digits (dashes and spaces are fine). Nothing was added.');
  return digits;
}

/** One line from a terminal in raw mode, nothing echoed. Ctrl-C or Ctrl-D cancels. */
function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    let line = '';
    const done = (error: Error | null) => {
      input.setRawMode(false);
      input.pause();
      input.off('data', onData);
      process.stderr.write('\n');
      if (error) reject(error);
      else resolve(line);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') return done(null);
        if (char === '\u0003' || char === '\u0004') return done(new Error('Cancelled. Nothing was added.'));
        if (char === '\u007f' || char === '\b') line = line.slice(0, -1);
        else line += char;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function readPiped(): Promise<string> {
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

/** The number, read twice from a terminal (the two must agree) or once from a pipe. */
async function readNumber(): Promise<string> {
  if (!process.stdin.isTTY) return nineDigitsOf(await readPiped());
  const first = nineDigitsOf(await readHidden('Known SSN (not shown as you type): '));
  const second = nineDigitsOf(await readHidden('Again, to confirm: '));
  if (first !== second) throw new Error('The two entries differ. Nothing was added.');
  return first;
}

/** Writes beside the real file and renames over it, so a crash never leaves half a config. Mode 600. */
async function writeConfig(file: string, config: Record<string, unknown>): Promise<void> {
  const real = await realpath(file);
  const temp = path.join(path.dirname(real), `.${path.basename(real)}.${process.pid}.tmp`);
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temp, real);
  await chmod(real, 0o600);
}

export async function addKnownHash(configFile: string, digits: string): Promise<{ added: boolean; count: number }> {
  const raw = JSON.parse(await readFile(configFile, 'utf8')) as unknown;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${configFile} is not a JSON object`);
  const { config, added } = withHash(raw as Record<string, unknown>, digits);
  const hashes = parsePiiHashes(config);
  if (!hashes || !new KnownSsnHashes(hashes).matchesSync(digits)) throw new Error('The new hash did not verify. Nothing was added.');
  if (added) await writeConfig(configFile, config);
  return { added, count: hashes.hashes.length };
}

async function main(): Promise<void> {
  const { config } = parsePiiArgs(process.argv.slice(2));
  const { added, count } = await addKnownHash(config, await readNumber());
  process.stdout.write(
    added
      ? `Added a known-SSN hash to ${config} (piiHashes now holds ${count}). The number itself was not stored or printed.\n`
      : `That number's hash is already in ${config} (piiHashes holds ${count}). Nothing changed.\n`,
  );
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
