// SPDX-License-Identifier: Apache-2.0
// Writes package-data.generated.ts: the app package files as base64, so the Worker can build each firm's
// Copilot package without a file system. Run it after any change to appPackage/:
//   node connect/copilot/package-data.ts            rewrites package-data.generated.ts
//   node connect/copilot/package-data.ts --check    exits 1 when it has drifted from appPackage/
// package-data.test.ts runs the same check under npm test.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPackage } from './build.ts';
import type { PackageFiles } from './validate.ts';

export const GENERATED_FILE = join(import.meta.dirname, 'package-data.generated.ts');
/** Base64 characters per source line, so the generated file stays readable in a diff. */
const LINE_WIDTH = 100;

/** The source text of package-data.generated.ts for these files, in the order given. */
export function renderPackageData(files: PackageFiles): string {
  const entries = [...files].map(([name, bytes]) => {
    const base64 = Buffer.from(bytes).toString('base64');
    const lines: string[] = [];
    for (let at = 0; at < base64.length; at += LINE_WIDTH) lines.push(`    '${base64.slice(at, at + LINE_WIDTH)}',`);
    return `  '${name}': [\n${lines.join('\n')}\n  ].join(''),`;
  });
  return [
    '// Generated from appPackage/ by `node connect/copilot/package-data.ts`. Do not edit by hand; package-data.test.ts',
    '// fails when this drifts from appPackage/. mcp/copilot-package.ts builds each firm\'s package from these bytes.',
    '',
    '/** Each app package file, base64, by name. */',
    'export const PACKAGE_DATA: Readonly<Record<string, string>> = {',
    ...entries,
    '};',
    '',
  ].join('\n');
}

function main(argv: readonly string[]): number {
  const expected = renderPackageData(readPackage());
  if (argv.includes('--check')) {
    if (readFileSync(GENERATED_FILE, 'utf8') === expected) return 0;
    console.error('package-data.generated.ts is out of date: run node connect/copilot/package-data.ts');
    return 1;
  }
  writeFileSync(GENERATED_FILE, expected);
  console.log(`Wrote ${GENERATED_FILE}.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
