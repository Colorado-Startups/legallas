// SPDX-License-Identifier: Apache-2.0
// The fixture's own writers, loaded by computed path. This site type-checks on its own, more strictly than web/ does
// and with no web/ packages, so this file declares the shapes the gold set uses instead of pulling web/ into that
// check. Everything here imports without packages, so the set still runs with no install.

export interface FixtureFile {
  rel: string;
  bytes: Buffer;
}

export interface DocFacts {
  date: string | null;
  type: string | null;
  from: string[];
  to: string[];
  summary: string | null;
  privileged: boolean;
}

export interface Named {
  id: string;
  name: string;
}

export interface FixtureMatter {
  docs: Record<string, DocFacts>;
  people: Named[];
  orgs: Named[];
}

export interface FixtureInputs {
  docIds: Record<string, string>;
  matter: FixtureMatter;
}

/** Loads a module under web/ with the shape the caller declares. */
export const webModule = <T>(rel: string) => import(new URL(`../../../../web/${rel}`, import.meta.url).href) as Promise<T>;

export const devPdf = await webModule<{
  LINES_PER_PAGE: number;
  wrapLine(text: string): string[];
  pdfBytes(pages: readonly (readonly string[])[]): Buffer;
  xlsxBytes(rows: readonly (readonly string[])[]): Buffer;
  zipStored(entries: readonly { name: string; data: Buffer }[]): Buffer;
}>('scripts/dev-pdf.ts');

export const fixtureText = await webModule<{
  FOLDER_GUIDE: string;
  pathById(docIds: Record<string, string>): Map<string, string>;
  citedLines(matter: FixtureMatter, paths: ReadonlyMap<string, string>): Map<string, Map<number, string[]>>;
  documentPages(docPath: string, cited: ReadonlyMap<number, string[]> | undefined, summary: string | null): string[][];
}>('scripts/dev-fixture-text.ts');

export const devFixture = await webModule<{
  MARKER: string;
  assertScratchFolder(out: string): Promise<void>;
  loadFixtureInputs(): Promise<FixtureInputs>;
  fixtureFiles(inputs: FixtureInputs): FixtureFile[];
  catalogCsv(inputs: FixtureInputs, files: readonly FixtureFile[]): string;
  writeFixture(out: string, files: readonly FixtureFile[]): Promise<{ written: number; unchanged: number; removed: number }>;
}>('scripts/dev-fixture.ts');

export const catalog = await webModule<{
  CATALOG_REL: string;
  parseFilename(name: string): { type: string | null; date: string | null };
  parseCatalog(csv: string, root: string): { rows: number; docs: Map<string, { privileged: boolean }> };
}>('scripts/matter/catalog.ts');
