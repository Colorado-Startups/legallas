// SPDX-License-Identifier: Apache-2.0
// Builds the Copilot app package (route 2 in connect/copilot.md): fills in the firm's OAuth client registration
// ID, validates every file, and writes a store-only ZIP the firm's admin uploads.
//   node connect/copilot/build.ts --reference-id <id>        (or LEGALLAS_OAUTH_REFERENCE_ID=<id>)
//   node connect/copilot/build.ts --check                    validates the source package only
//   node connect/copilot/build.ts --verify <package.zip>     validates a built package (a download from /connect)
// Output: connect/copilot/dist/legallas-copilot-agent.zip (gitignored).
// The build itself (placeholders, validation, ZIP) lives in package.ts, shared with the Worker route.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_REFERENCE_ID, PACKAGE_FILE_NAME, buildPackage, zipProblems } from './package.ts';

export { CHECK_REFERENCE_ID, PACKAGE_FILES, buildPackage, fileListProblems, resolvePlaceholders } from './package.ts';

export const APP_PACKAGE_DIR = join(import.meta.dirname, 'appPackage');
export const DIST_FILE = join(import.meta.dirname, 'dist', PACKAGE_FILE_NAME);

/** Reads every file in the app package folder, sorted by name. */
export function readPackage(dir: string = APP_PACKAGE_DIR): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const name of readdirSync(dir).filter((n) => !n.startsWith('.')).sort()) files.set(name, readFileSync(join(dir, name)));
  return files;
}

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Prints copilot_package_ok, or every problem, for a built package ZIP. */
function verify(path: string | undefined): number {
  if (!path) {
    console.error('Pass --verify <path to legallas-copilot-agent.zip>.');
    return 2;
  }
  const problems = zipProblems(readFileSync(path));
  if (problems.length > 0) {
    console.error(`The package has problems:\n- ${problems.join('\n- ')}`);
    return 1;
  }
  console.log('copilot_package_ok');
  return 0;
}

function main(argv: readonly string[]): number {
  if (argv.includes('--verify')) return verify(argValue(argv, '--verify'));
  if (argv.includes('--check')) {
    buildPackage(readPackage(), CHECK_REFERENCE_ID);
    console.log('copilot_package_ok');
    return 0;
  }
  const referenceId = argValue(argv, '--reference-id') ?? process.env.LEGALLAS_OAUTH_REFERENCE_ID ?? '';
  if (referenceId.trim() === '') {
    console.error('Pass --reference-id <OAuth client registration ID> or set LEGALLAS_OAUTH_REFERENCE_ID (see connect/copilot.md).');
    return 2;
  }
  const zip = buildPackage(readPackage(), referenceId);
  mkdirSync(dirname(DIST_FILE), { recursive: true });
  writeFileSync(DIST_FILE, zip);
  console.log(`Wrote ${DIST_FILE} (${zip.length} bytes).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'copilot_package_failed');
    process.exitCode = 1;
  }
}
