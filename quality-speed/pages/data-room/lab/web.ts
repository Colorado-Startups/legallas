// SPDX-License-Identifier: Apache-2.0
// The room's own code, loaded by computed path, as ../gold/web.ts does. The Quality and Speed site type-checks on its own, with no
// web/ packages, so this file declares the shapes the lab uses instead of pulling web/ into that check. Everything loaded here
// imports without packages, so the lab's tests run with no install. A name that goes missing from web/ fails at load.
export const webModule = <T>(rel: string) => import(new URL(`../../../../web/${rel}`, import.meta.url).href) as Promise<T>;

export interface FixtureFile {
  rel: string;
  bytes: Buffer;
}

export interface ExtractedPage {
  n: number;
  text: string;
  ocr: boolean;
}

export const devPdf = await webModule<{ pdfBytes(pages: readonly (readonly string[])[]): Buffer }>('scripts/dev-pdf.ts');

export const devFixture = await webModule<{
  loadFixtureInputs(): Promise<object>;
  fixtureFiles(inputs: object): FixtureFile[];
}>('scripts/dev-fixture.ts');

export const companyFixture = await webModule<{ companyFixtureFiles(): FixtureFile[] }>('scripts/dev-fixture-company.ts');

/** The fields of a file a sync plan reads. */
export interface PlanFile {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
  dev: number;
  ino: number;
  snapshot: string;
  sha256: string;
}

interface SyncPlan {
  adds: unknown[];
}

export const syncDiff = await webModule<{
  diffSync(files: readonly PlanFile[], rows: readonly never[]): SyncPlan;
  kindOf(rel: string): { kind: string };
}>('scripts/diff.ts');

export const extract = await webModule<{
  EXTRACT_TIMEOUT_MS: number;
  EXTRACTOR_VERSION: number;
  parseExtractorOutput(stdout: string): ExtractedPage[];
}>('scripts/extract.ts');

export const guard = await webModule<{
  guardWalk(root: string): Promise<{ files: { rel: string; abs: string }[] }>;
}>('scripts/guard.ts');

export const indexJob = await webModule<{
  indexWork(plan: SyncPlan, manifest: object): { jobs: { sha256: string }[] };
  loadManifest(cacheDir: string, target: 'local'): Promise<Record<string, { sha256: string; parts: number }>>;
}>('scripts/indexjob.ts');

export const piiScan = await webModule<{
  scanRead(kind: string, rel: string): 'extractor' | 'direct' | 'raw' | null;
}>('scripts/pii-scan.ts');

export const devSeed = await webModule<{
  seedPaths(root: string): { cache: string };
}>('scripts/dev-seed.ts');

export const wrangler = await webModule<{
  cliWrangler(target: 'local'): { d1Query(sql: string): Promise<Record<string, unknown>[]> };
}>('scripts/wrangler.ts');

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface Browser {
  cdp: {
    send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
    on(listener: (event: CdpEvent) => void): () => void;
  };
  session: string;
  close(): Promise<void>;
}

export const devCdp = await webModule<{
  launch(chromePath: string): Promise<Browser>;
}>('scripts/dev-cdp.ts');

/** What dev-shoot's probes collect, over every page the lab opens. */
export interface ShotRecord {
  file: string;
  url: string;
  width: number;
  variant: 'light' | 'print';
  console: string[];
  csp: string[];
  httpErrors: string[];
  external: string[];
  layoutShift: number;
  shiftSources: string[];
}

export const devShoot = await webModule<{
  CSP_PROBE: string;
  SHIFT_PROBE: string;
  describeEvent(event: CdpEvent, record: ShotRecord, inflight: Set<string>): void;
  mediaFor(variant: 'light' | 'print'): Record<string, unknown>;
  readShift(browser: Browser): Promise<{ layoutShift: number }>;
  settle(browser: Browser, inflight: Set<string>): Promise<void>;
}>('scripts/dev-shoot.ts');

interface RpcReply {
  status: number;
  result: Record<string, unknown> | null;
}

export interface McpSession {
  open(): Promise<RpcReply>;
  callTool(name: string, args: Record<string, unknown>): Promise<RpcReply>;
}

export const mcpClient = await webModule<{
  LEGACY_VERSION: string;
  McpSession: new (fetcher: typeof fetch, endpoint: string, token: string, version: string) => McpSession;
  resultValue(result: Record<string, unknown> | null): Record<string, unknown> | null;
  summarizeTool(result: Record<string, unknown> | null): object;
  toolCallOk(summary: object): boolean;
}>('scripts/mcp-client.ts');

export interface FlowReport {
  checks: { name: string; outcome: 'pass' | 'fail' | 'skip' }[];
}

export const mcpFlow = await webModule<{
  Report: new () => FlowReport;
  localGrant(report: FlowReport, fetcher: typeof fetch, base: string, options: object): Promise<{ accessToken: string } | null>;
  localOptions(): Promise<object>;
}>('scripts/mcp-flow.ts');

/** The fence the tools put around case text (mcp/format.ts caseData): plain, or with the quarantine's mark on untrusted text. */
export const mcpFence = await webModule<{
  UNTRUSTED_MARKS: readonly string[];
  fenceOf(text: string): { open: string; inner: string; reason: string | null } | null;
}>('mcp/untrusted.ts');

/** Loaded when a run reaches it: the smoke brings much more of web/ with it. */
export const mcpSmoke = () => webModule<{
  runLocal(fetcher: typeof fetch, base: string, parts: undefined, options: object): Promise<FlowReport>;
}>('scripts/mcp-smoke.ts');
