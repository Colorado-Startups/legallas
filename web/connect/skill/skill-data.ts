// SPDX-License-Identifier: Apache-2.0
// Writes skill-data.generated.ts: the Agent Skills folder legallas/ as plain strings, so the Worker can serve the
// Claude plugin (mcp/claude-plugin.ts) and build the kit prompts (mcp/prompts.ts) without a file system. Plain text,
// not Base64, so the pre-push pattern scan reads it. Run it after any change to legallas/:
//   node connect/skill/skill-data.ts            rewrites skill-data.generated.ts
//   node connect/skill/skill-data.ts --check    exits 1 when it has drifted from legallas/
// skill.test.ts runs the same check under npm test.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = join(import.meta.dirname, 'legallas');
export const GENERATED_FILE = join(import.meta.dirname, 'skill-data.generated.ts');

/** Every file under `dir`, by path relative to it with forward slashes, sorted. */
export function readSkill(dir: string = SKILL_DIR): Map<string, string> {
  const files: string[] = [];
  const walk = (at: string) => {
    for (const name of readdirSync(at).filter((n) => !n.startsWith('.')).sort()) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(dir);
  return new Map(files.map((path) => [relative(dir, path).split(sep).join('/'), readFileSync(path, 'utf8')]));
}

/** The source text of skill-data.generated.ts for these files. */
export function renderSkillData(files: ReadonlyMap<string, string>): string {
  return [
    '// Generated from connect/skill/legallas/ by `node connect/skill/skill-data.ts`. Do not edit by hand; skill.test.ts',
    '// fails when this drifts from legallas/.',
    '',
    '/** Each file of the Agent Skills folder, by path inside it. */',
    'export const SKILL_FILES: Readonly<Record<string, string>> = {',
    // One source line per text line, so a diff shows the line that changed.
    ...[...files].map(([path, text]) => `  ${JSON.stringify(path)}: [\n${text.split('\n').map((line) => `    ${JSON.stringify(line)},`).join('\n')}\n  ].join('\\n'),`),
    '};',
    '',
  ].join('\n');
}

function main(argv: readonly string[]): number {
  const expected = renderSkillData(readSkill());
  if (argv.includes('--check')) {
    if (readFileSync(GENERATED_FILE, 'utf8') === expected) return 0;
    console.error('skill-data.generated.ts is out of date: run node connect/skill/skill-data.ts');
    return 1;
  }
  writeFileSync(GENERATED_FILE, expected);
  console.log(`Wrote ${GENERATED_FILE}.`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
