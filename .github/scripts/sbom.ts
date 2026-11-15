// SPDX-License-Identifier: Apache-2.0
// Software bill of materials, CycloneDX JSON, for what Legallas ships: the room and MCP Workers (web/, one lockfile for
// both) and the Mac app (the Swift package and LegallasApp/). Run by .github/workflows/sbom.yml; reads only the
// repository, installs nothing, and prints component counts. Package names and versions only: no case data exists here.
//
//   node .github/scripts/sbom.ts <out-dir>
//
// | File                  | Holds                                                                   |
// |-----------------------|-------------------------------------------------------------------------|
// | web-runtime.cdx.json  | `npm sbom --omit dev`: what the Workers run                              |
// | web-all.cdx.json      | `npm sbom`: the same plus build and test tools                          |
// | swift.cdx.json        | Every pin in a tracked Package.resolved; none today (no remote packages) |
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const out = path.resolve(process.argv[2] ?? 'sbom');
mkdirSync(out, { recursive: true });

type Bom = { bomFormat?: string; components?: unknown[] };

function npmSbom(extra: string[]): Bom {
  const json = execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--package-lock-only', ...extra], {
    cwd: path.join(root, 'web'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(json) as Bom;
}

const tracked = (pattern: string): string[] =>
  execFileSync('git', ['ls-files', '--', pattern], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);

type Pin = { identity?: string; package?: string; location?: string; repositoryURL?: string; state?: { version?: string; revision?: string; branch?: string } };

/** One CycloneDX component per pin, from Package.resolved version 1, 2 or 3. */
function swiftComponents(file: string): unknown[] {
  const resolved = JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { pins?: Pin[]; object?: { pins?: Pin[] } };
  return (resolved.pins ?? resolved.object?.pins ?? []).map((pin) => {
    const url = pin.location ?? pin.repositoryURL ?? '';
    const name = pin.identity ?? pin.package ?? path.basename(url, '.git');
    const version = pin.state?.version ?? pin.state?.revision ?? pin.state?.branch ?? 'unknown';
    const where = url.replace(/^[a-z+]+:\/\//, '').replace(/^git@([^:]+):/, '$1/').replace(/\.git$/, '');
    return { type: 'library', 'bom-ref': `${name}@${version}`, name, version, purl: `pkg:swift/${where}@${version}`, externalReferences: [{ type: 'vcs', url }] };
  });
}

function swiftSbom(): Bom {
  const resolvedFiles = tracked('*Package.resolved');
  const manifest = readFileSync(path.join(root, 'Package.swift'), 'utf8');
  const projects = tracked('*.pbxproj').map((file) => readFileSync(path.join(root, file), 'utf8'));
  const declaresRemote = /\.package\s*\(/.test(manifest) || projects.some((text) => text.includes('XCRemoteSwiftPackageReference'));
  if (declaresRemote && resolvedFiles.length === 0) {
    throw new Error('Package.swift or an Xcode project declares a remote package, but no Package.resolved is tracked: commit it so the SBOM can list it');
  }
  const components = resolvedFiles.flatMap(swiftComponents);
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: '.github/scripts/sbom.ts' }] },
      component: { type: 'application', 'bom-ref': 'legallas-swift', name: 'Legallas', description: 'Swift package and Mac app' },
      properties: [
        { name: 'legallas:package-resolved', value: resolvedFiles.join(', ') || 'none tracked' },
        { name: 'legallas:remote-packages', value: declaresRemote ? 'declared' : 'none: Package.swift and the Xcode project declare no remote package' },
      ],
    },
    components,
  } as Bom;
}

const boms: [string, Bom][] = [
  ['web-runtime.cdx.json', npmSbom(['--omit', 'dev'])],
  ['web-all.cdx.json', npmSbom([])],
  ['swift.cdx.json', swiftSbom()],
];

const rows = boms.map(([file, bom]) => {
  if (bom.bomFormat !== 'CycloneDX' || !Array.isArray(bom.components)) throw new Error(`${file} is not a CycloneDX document`);
  writeFileSync(path.join(out, file), `${JSON.stringify(bom, null, 2)}\n`);
  return [file, bom.components.length] as const;
});
if (rows[0]![1] === 0) throw new Error('web-runtime.cdx.json lists no components: the lockfile was not read');

const lines = ['| SBOM | Components |', '|---|---|', ...rows.map(([file, count]) => `| \`${file}\` | ${count} |`)];
process.stdout.write(`${lines.join('\n')}\n`);
for (const [file, count] of rows) process.stdout.write(`::notice title=SBOM::${file}: ${count} components\n`);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Software bill of materials\n\n${lines.join('\n')}\n`);
