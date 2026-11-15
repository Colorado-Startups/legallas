// SPDX-License-Identifier: Apache-2.0
// Known SSNs as salted, slow hashes: rule known-hash of pii.ts. The gitignored legallas.config.json may hold
//
//   "piiHashes": { "salt": "<base64, 16 random bytes>", "N": 16384, "r": 8, "p": 1, "keylen": 32, "hashes": ["<hex>"] }
//
// Each hash is scrypt(the nine digits, salt). The digits are never stored, so the config can say "this number is
// the owner's SSN" without holding it. One salt per config: every nine digits in a scanned text costs one scrypt,
// whatever the number of hashes. The SSN space is small (under a billion, less once the issuing state and year
// are known), so a hash is protection against casual reading, not against someone who has the config and time:
// keep the config gitignored and mode 600 (`npm run pii -- --add-hash` sets it). Only that CLI (pii-cli.ts) adds
// hashes; nothing else writes the key.
import { createHash, randomBytes, scrypt, scryptSync } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { KnownMatcher } from './pii.ts';

export interface PiiHashConfig {
  salt: string;
  N: number;
  r: number;
  p: number;
  keylen: number;
  hashes: string[];
}

/** About 27 ms a hash on an M-series Mac (16 MiB of memory each). */
export const DEFAULT_SCRYPT = { N: 2 ** 14, r: 8, p: 1, keylen: 32 } as const;
const MIN_N = 2 ** 14;
const MAX_N = 2 ** 20;
const SALT_BYTES = 16;

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * The piiHashes key of a parsed legallas.config.json, validated, or null when the key is absent. A malformed key is
 * an error, never ignored: a guard that silently loses its hashes would pass a known SSN.
 */
export function parsePiiHashes(raw: unknown): PiiHashConfig | null {
  if (typeof raw !== 'object' || raw === null || !('piiHashes' in raw)) return null;
  const value = (raw as { piiHashes: unknown }).piiHashes;
  const bad = (what: string) => new Error(`legallas.config.json: piiHashes ${what}`);
  if (typeof value !== 'object' || value === null) throw bad('must be an object');
  const { salt, N, r, p, keylen, hashes } = value as Record<string, unknown>;
  if (typeof salt !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(salt) || Buffer.from(salt, 'base64').length < SALT_BYTES) {
    throw bad(`salt must be base64 of at least ${SALT_BYTES} bytes`);
  }
  if (!isInt(N, MIN_N, MAX_N) || (N & (N - 1)) !== 0) throw bad(`N must be a power of two from ${MIN_N} to ${MAX_N}`);
  if (!isInt(r, 1, 32) || !isInt(p, 1, 4) || !isInt(keylen, 16, 64)) throw bad('r, p or keylen is out of range');
  const hex = new RegExp(`^[0-9a-f]{${keylen * 2}}$`);
  if (!Array.isArray(hashes) || !hashes.every((hash) => typeof hash === 'string' && hex.test(hash))) {
    throw bad(`hashes must be a list of ${keylen * 2}-character hex strings`);
  }
  return { salt, N, r, p, keylen, hashes: [...hashes] as string[] };
}

function scryptOptions(config: PiiHashConfig) {
  return { N: config.N, r: config.r, p: config.p, maxmem: 256 * config.N * config.r + 1024 * 1024 };
}

function assertNine(digits: string): void {
  if (!/^\d{9}$/.test(digits)) throw new Error('A known-SSN hash is made from exactly nine digits');
}

/** The hash of nine digits under the config's salt and cost. */
export function hashNine(digits: string, config: PiiHashConfig): string {
  assertNine(digits);
  return scryptSync(digits, Buffer.from(config.salt, 'base64'), config.keylen, scryptOptions(config)).toString('hex');
}

export function hashNineAsync(digits: string, config: PiiHashConfig): Promise<string> {
  assertNine(digits);
  return new Promise((resolve, reject) => {
    scrypt(digits, Buffer.from(config.salt, 'base64'), config.keylen, scryptOptions(config), (error, key) => (error ? reject(error) : resolve(key.toString('hex'))));
  });
}

/**
 * Matches nine digits against the known hashes. Each distinct nine digits is hashed once per run (the sync's scan
 * and the index check share one instance), so the same text is never paid for twice.
 */
export class KnownSsnHashes implements KnownMatcher {
  readonly #config: PiiHashConfig;
  readonly #known: ReadonlySet<string>;
  readonly #settled = new Map<string, boolean>();
  readonly #pending = new Map<string, Promise<boolean>>();

  constructor(config: PiiHashConfig) {
    this.#config = config;
    this.#known = new Set(config.hashes);
  }

  get size(): number {
    return this.#known.size;
  }

  /** Changes whenever the list does, so editing it by hand without changing its length still counts. */
  get fingerprint(): string {
    return createHash('sha256').update([...this.#known].sort().join('\n')).digest('hex').slice(0, 16);
  }

  /** How many distinct nine-digit sequences were hashed so far. */
  get hashed(): number {
    return this.#settled.size;
  }

  matches(digits: string): Promise<boolean> {
    const settled = this.#settled.get(digits);
    if (settled !== undefined) return Promise.resolve(settled);
    let pending = this.#pending.get(digits);
    if (!pending) {
      pending = hashNineAsync(digits, this.#config).then((hash) => {
        const hit = this.#known.has(hash);
        this.#settled.set(digits, hit);
        this.#pending.delete(digits);
        return hit;
      });
      this.#pending.set(digits, pending);
    }
    return pending;
  }

  matchesSync(digits: string): boolean {
    let hit = this.#settled.get(digits);
    if (hit === undefined) {
      hit = this.#known.has(hashNine(digits, this.#config));
      this.#settled.set(digits, hit);
    }
    return hit;
  }
}

/** The known hashes of a config file, or null when it lists none. */
export async function loadKnownHashes(configFile: string): Promise<KnownSsnHashes | null> {
  const config = parsePiiHashes(JSON.parse(await readFile(configFile, 'utf8')));
  return config && config.hashes.length > 0 ? new KnownSsnHashes(config) : null;
}

/**
 * Adds the hash of nine digits to a parsed config (a fresh salt and the default cost when it has no piiHashes
 * yet). Returns the updated config and whether the hash was new. Pure apart from the salt.
 */
export function withHash(raw: Record<string, unknown>, digits: string, salt = randomBytes(SALT_BYTES)): { config: Record<string, unknown>; added: boolean } {
  const current = parsePiiHashes(raw) ?? { salt: salt.toString('base64'), ...DEFAULT_SCRYPT, hashes: [] };
  const hash = hashNine(digits, current);
  if (current.hashes.includes(hash)) return { config: raw, added: false };
  return { config: { ...raw, piiHashes: { ...current, hashes: [...current.hashes, hash] } }, added: true };
}
