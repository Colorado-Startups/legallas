// SPDX-License-Identifier: Apache-2.0
// The Copilot app package build, with no file system access: it fills in the firm's OAuth client registration
// ID, validates every file and zips them. Both the CLI (build.ts, reading appPackage/) and the Worker route
// POST /connect/copilot-package (mcp/copilot-package.ts, reading the bundled copy) use it, so the rules are the
// same. Runs under plain Node and in workerd with nodejs_compat (Buffer only; no node:fs or node:zlib).
import { PACKAGE_DATA } from './package-data.generated.ts';
import { REFERENCE_PLACEHOLDER, validatePackage, type PackageFiles } from './validate.ts';
import { readZipStore, zipStore } from '../../mcp/zip.ts';
import { STORED_NAME } from '../../worker/stored-name.ts';

/** Exactly what the package holds: manifest.json first, then the rest in code-point order. */
export const PACKAGE_FILES = ['manifest.json', 'ai-plugin.json', 'color.png', 'declarativeAgent.json', 'mcp-tools.json', 'outline.png'] as const;
/** Stand-in reference ID for --check, so the source package validates before a firm has registered. */
export const CHECK_REFERENCE_ID = 'check-only-reference-id';
/** The file name the download offers. */
export const PACKAGE_FILE_NAME = `${STORED_NAME}-copilot-agent.zip`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Replaces the reference ID placeholder in the JSON files; other files pass through unchanged. */
export function resolvePlaceholders(files: PackageFiles, referenceId: string): Map<string, Uint8Array> {
  const escaped = JSON.stringify(referenceId).slice(1, -1);
  const out = new Map<string, Uint8Array>();
  for (const [name, bytes] of files) {
    out.set(name, name.endsWith('.json') ? encoder.encode(decoder.decode(bytes).replaceAll(REFERENCE_PLACEHOLDER, escaped)) : bytes);
  }
  return out;
}

/** Problems with the file list itself: anything missing from PACKAGE_FILES, or anything extra. */
export function fileListProblems(files: PackageFiles): string[] {
  const expected = new Set<string>(PACKAGE_FILES);
  const missing = PACKAGE_FILES.filter((name) => !files.has(name)).map((name) => `${name}: missing from the package`);
  const extra = [...files.keys()].filter((name) => !expected.has(name)).map((name) => `${name}: not part of the package; remove it`);
  return [...missing, ...extra];
}

/** Validates and zips the package in PACKAGE_FILES order. Throws with every problem. */
export function buildPackage(files: PackageFiles, referenceId: string): Buffer {
  const resolved = resolvePlaceholders(files, referenceId.trim());
  const problems = [...fileListProblems(resolved), ...validatePackage(resolved)];
  if (problems.length > 0) throw new Error(`The app package has problems:\n- ${[...new Set(problems)].join('\n- ')}`);
  return zipStore(PACKAGE_FILES.map((name) => ({ name, data: resolved.get(name)! }))); // safe: fileListProblems found every name
}

/** The app package bundled into the Worker (package-data.generated.ts), by name; equal to readPackage(). */
export function bundledPackage(): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const [name, base64] of Object.entries(PACKAGE_DATA)) files.set(name, new Uint8Array(Buffer.from(base64, 'base64')));
  return files;
}

/** Every problem with a built package ZIP (a download from /connect, say); an empty list means it is ready. */
export function zipProblems(zip: Uint8Array): string[] {
  let entries;
  try {
    entries = readZipStore(zip);
  } catch (error) {
    return [`the ZIP: ${error instanceof Error ? error.message : 'unreadable'}`];
  }
  const files = new Map(entries.map((entry) => [entry.name, entry.data]));
  const problems = [...fileListProblems(files), ...validatePackage(files)];
  if (files.size !== entries.length) problems.push('the ZIP holds the same file name twice');
  return [...new Set(problems)];
}
