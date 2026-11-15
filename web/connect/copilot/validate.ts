// SPDX-License-Identifier: Apache-2.0
// Checks the Copilot app package against the fields and limits Microsoft documents, plus our own constants
// (the server URL, the privacy and terms pages). It returns every problem at once, as plain sentences.
// Schemas, read 2026-10-01:
//   app manifest 1.30 (what Microsoft 365 Agents Toolkit generates for declarative agents)
//   declarative agent 1.8  https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/declarative-agent-manifest-1.8
//   plugin 2.4             https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-manifest-2.4
//   MCP tool descriptions  https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/plugin-mcp-apps-troubleshooting
import { LAW_TOOL_NAME, MCP_ORIGIN, MCP_RESOURCE, TOOL_NAMES } from '../../mcp/contract.ts';
import { withToolPrefix } from '../../mcp/tool-prefix.ts';
import { VIEW_OF_TOOL, VIEWS } from '../../mcp/apps/views.ts';
import { toolPrefix } from '../../worker/room-settings.ts';
import { STORED_NAME } from '../../worker/stored-name.ts';
import { COLOR_TYPE_RGBA, readPngHeader } from './png-header.ts';

/** The package's files by name (all at the archive root). */
export type PackageFiles = ReadonlyMap<string, Uint8Array>;

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_VERSION = '1.30';
export const AGENT_VERSION = 'v1.8';
export const PLUGIN_VERSION = 'v2.4';
/**
 * The agent's own version (manifest.json `version`). Microsoft replaces an uploaded agent only with a higher one,
 * so every change to the package raises it here and in manifest.json together. 1.4.0: room-neutral text and the
 * six kits as conversation starters (connect/skill/legallas/). 1.5.0: the overview and the document list name their
 * views (mcp/apps/views.ts), which Copilot draws as MCP Apps.
 */
export const PACKAGE_VERSION = '1.5.0';
export const PRIVACY_URL = `${MCP_ORIGIN}/privacy`;
export const TERMS_URL = `${MCP_ORIGIN}/terms`;
/** Toolkit-style placeholder the build replaces with the firm's OAuth client registration ID. */
export const REFERENCE_PLACEHOLDER = `$\{{${STORED_NAME.toUpperCase()}_OAUTH_REFERENCE_ID}}`;
/** What an OAuth client registration ID may look like: 1 to 256 characters, no spaces, quotes or angle brackets. */
export const REFERENCE_ID_PATTERN = /^[^\s"'<>]{1,256}$/;
/** The pinned tool definitions: the server's tools/list result, written by mcp-tools.ts, never by hand. */
export const TOOLS_FILE = 'mcp-tools.json';
/** Every tool the server lists while the law library is on (it is in production), in tools/list order. */
export const PLUGIN_TOOLS: readonly string[] = [...TOOL_NAMES, LAW_TOOL_NAME].map((name) => withToolPrefix(name, toolPrefix));
/** The tools Copilot draws a view from, by their name in this package, and the view each names (mcp/apps/views.ts). */
const VIEWED: ReadonlyMap<string, string> = new Map(Object.entries(VIEW_OF_TOOL).map(([tool, view]) => [withToolPrefix(tool, toolPrefix), VIEWS[view].uri]));
/** "Text beyond 1,024 characters is ignored" in tool and parameter descriptions (the MCP troubleshooting page). */
export const MAX_TOOL_DESCRIPTION = 1024;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), value);

/** Collects problems for one file, prefixed with its name. */
class Report {
  readonly problems: string[] = [];
  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  add(message: string): void {
    this.problems.push(`${this.file}: ${message}`);
  }

  /** A required string with at least one non-space character and at most `max` characters. */
  string(value: unknown, field: string, max: number): void {
    const s = text(value);
    if (s.trim() === '') this.add(`${field} is required`);
    else if (s.length > max) this.add(`${field} is longer than ${max} characters`);
  }

  equal(value: unknown, field: string, expected: unknown): void {
    if (value !== expected) this.add(`${field} must be ${JSON.stringify(expected)}`);
  }
}

function parse(files: PackageFiles, name: string, problems: string[]): Json | null {
  const bytes = files.get(name);
  if (!bytes) {
    problems.push(`${name}: missing from the package`);
    return null;
  }
  const raw = Buffer.from(bytes).toString('utf8');
  if (raw.includes('${{')) problems.push(`${name}: has an unresolved \${{...}} placeholder`);
  try {
    const value: unknown = JSON.parse(raw);
    if (isObject(value)) return value;
  } catch {
    // reported below
  }
  problems.push(`${name}: is not a JSON object`);
  return null;
}

function checkIcon(files: PackageFiles, name: string, size: number, report: Report, rgba: boolean): void {
  const bytes = files.get(name);
  const header = bytes ? readPngHeader(bytes) : null;
  if (!header) return report.add(`icon ${JSON.stringify(name)} is missing or not a PNG`);
  if (header.width !== size || header.height !== size) report.add(`icon ${name} must be ${size} x ${size} pixels`);
  if (rgba && header.colorType !== COLOR_TYPE_RGBA) report.add(`icon ${name} needs an alpha channel (white on transparent)`);
}

function checkManifest(m: Json, files: PackageFiles, report: Report): string | null {
  report.equal(m['$schema'], '$schema', `https://developer.microsoft.com/json-schemas/teams/v${MANIFEST_VERSION}/MicrosoftTeams.schema.json`);
  report.equal(m['manifestVersion'], 'manifestVersion', MANIFEST_VERSION);
  report.equal(m['version'], 'version', PACKAGE_VERSION);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(m['id']))) report.add('id must be a GUID');
  report.string(at(m, 'developer', 'name'), 'developer.name', 32);
  if (!text(at(m, 'developer', 'websiteUrl')).startsWith('https://')) report.add('developer.websiteUrl must be an https URL');
  report.equal(at(m, 'developer', 'privacyUrl'), 'developer.privacyUrl', PRIVACY_URL);
  report.equal(at(m, 'developer', 'termsOfUseUrl'), 'developer.termsOfUseUrl', TERMS_URL);
  report.string(at(m, 'name', 'short'), 'name.short', 30);
  report.string(at(m, 'name', 'full'), 'name.full', 100);
  report.string(at(m, 'description', 'short'), 'description.short', 80);
  report.string(at(m, 'description', 'full'), 'description.full', 4000);
  if (!/^#[0-9A-Fa-f]{6}$/.test(text(m['accentColor']))) report.add('accentColor must be a #RRGGBB color');
  checkIcon(files, text(at(m, 'icons', 'color')), 192, report, false);
  checkIcon(files, text(at(m, 'icons', 'outline')), 32, report, true);
  const agents = at(m, 'copilotAgents', 'declarativeAgents');
  if (!Array.isArray(agents) || agents.length !== 1) {
    report.add('copilotAgents.declarativeAgents must list exactly one agent');
    return null;
  }
  report.string(at(agents[0], 'id'), 'copilotAgents.declarativeAgents[0].id', 64);
  return text(at(agents[0], 'file')) || null;
}

function checkAgent(a: Json, files: PackageFiles, report: Report): string[] {
  report.equal(a['$schema'], '$schema', `https://developer.microsoft.com/json-schemas/copilot/declarative-agent/${AGENT_VERSION}/schema.json`);
  report.equal(a['version'], 'version', AGENT_VERSION);
  report.string(a['name'], 'name', 100);
  report.string(a['description'], 'description', 1000);
  report.string(a['instructions'], 'instructions', 8000);
  const starters = a['conversation_starters'] ?? [];
  if (!Array.isArray(starters) || starters.length > 12) report.add('conversation_starters must be a list of at most 12');
  else starters.forEach((s, i) => report.string(at(s, 'text'), `conversation_starters[${i}].text`, 4000));
  if (a['disclaimer'] !== undefined) report.string(at(a, 'disclaimer', 'text'), 'disclaimer.text', 500);
  const actions = a['actions'];
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 10) {
    report.add('actions must list 1 to 10 plugins');
    return [];
  }
  const plugins: string[] = [];
  actions.forEach((action, i) => {
    report.string(at(action, 'id'), `actions[${i}].id`, 4000);
    const file = text(at(action, 'file'));
    if (!files.has(file)) report.add(`actions[${i}].file ${JSON.stringify(file)} is not in the package`);
    else plugins.push(file);
  });
  return plugins;
}

/** Checks the plugin and returns its tool definitions file, or null when it names none. */
function checkPlugin(p: Json, files: PackageFiles, report: Report): string | null {
  report.equal(p['$schema'], '$schema', `https://developer.microsoft.com/json-schemas/copilot/plugin/${PLUGIN_VERSION}/schema.json`);
  report.equal(p['schema_version'], 'schema_version', PLUGIN_VERSION);
  report.string(p['name_for_human'], 'name_for_human', 20);
  report.string(p['description_for_human'], 'description_for_human', 100);
  if (p['description_for_model'] !== undefined) report.string(p['description_for_model'], 'description_for_model', 2048);
  if (!/^[A-Za-z0-9]+$/.test(text(p['namespace']))) report.add('namespace must match ^[A-Za-z0-9]+$');
  report.equal(p['privacy_policy_url'], 'privacy_policy_url', PRIVACY_URL);
  report.equal(p['legal_info_url'], 'legal_info_url', TERMS_URL);
  // Pinned tools: /mcp lists its tools only after sign-in, so the plugin names each one and points at
  // mcp-tools.json for the rest (mcp-tools.ts writes both from the server's tools/list).
  const functions = p['functions'];
  const names = Array.isArray(functions) ? functions.map((f) => at(f, 'name')) : [];
  if (!sameList(names, PLUGIN_TOOLS)) report.add(`functions must list exactly ${PLUGIN_TOOLS.join(', ')}, in that order`);
  if (Array.isArray(functions)) functions.forEach((f, i) => report.string(at(f, 'description'), `functions[${i}].description`, MAX_TOOL_DESCRIPTION));
  const runtimes = p['runtimes'];
  if (!Array.isArray(runtimes) || runtimes.length !== 1) {
    report.add('runtimes must hold exactly one RemoteMCPServer runtime');
    return null;
  }
  const runtime: unknown = runtimes[0];
  report.equal(at(runtime, 'type'), 'runtimes[0].type', 'RemoteMCPServer');
  report.equal(at(runtime, 'spec', 'url'), 'runtimes[0].spec.url', MCP_RESOURCE);
  report.equal(at(runtime, 'auth', 'type'), 'runtimes[0].auth.type', 'OAuthPluginVault');
  const reference = text(at(runtime, 'auth', 'reference_id'));
  if (!REFERENCE_ID_PATTERN.test(reference)) report.add('runtimes[0].auth.reference_id must be the OAuth client registration ID');
  const runFor = at(runtime, 'run_for_functions');
  if (!sameList(Array.isArray(runFor) ? runFor : [], PLUGIN_TOOLS)) report.add(`runtimes[0].run_for_functions must list exactly ${PLUGIN_TOOLS.join(', ')}`);
  const described = at(runtime, 'spec', 'mcp_tool_description');
  const file = text(at(described, 'file'));
  if (!isObject(described) || Object.keys(described).join() !== 'file' || !files.has(file)) {
    report.add(`runtimes[0].spec.mcp_tool_description must be { "file": "${TOOLS_FILE}" }, a file in the package`);
    return null;
  }
  return file;
}

const sameList = (actual: readonly unknown[], expected: readonly string[]): boolean =>
  actual.length === expected.length && actual.every((value, i) => value === expected[i]);

/** Descriptions in an input schema's properties, nested ones included, as [path, text]. */
function parameterDescriptions(schema: unknown, path: string): [string, unknown][] {
  const properties = at(schema, 'properties');
  if (!isObject(properties)) return [];
  return Object.entries(properties).flatMap(([name, property]) => [
    ...(at(property, 'description') === undefined ? [] : [[`${path}.${name}.description`, at(property, 'description')] as [string, unknown]]),
    ...parameterDescriptions(property, `${path}.${name}`),
    ...parameterDescriptions(at(property, 'items'), `${path}.${name}.items`),
  ]);
}

/** mcp-tools.json: a tools/list result naming the plugin's tools, each read-only, described as the plugin says. */
function checkTools(t: Json, plugin: Json, report: Report): void {
  const tools = t['tools'];
  if (!Array.isArray(tools) || !sameList(tools.map((tool) => at(tool, 'name')), PLUGIN_TOOLS)) {
    return report.add(`tools must list exactly ${PLUGIN_TOOLS.join(', ')}, in that order (a tools/list result)`);
  }
  const functions = Array.isArray(plugin['functions']) ? plugin['functions'] : [];
  tools.forEach((tool, i) => {
    const name = text(at(tool, 'name'));
    report.string(at(tool, 'description'), `${name}.description`, MAX_TOOL_DESCRIPTION);
    if (at(functions[i], 'description') !== at(tool, 'description')) report.add(`${name}.description must equal ai-plugin.json functions[${i}].description`);
    if (at(tool, 'inputSchema', 'type') !== 'object') report.add(`${name}.inputSchema must be an object schema`);
    for (const [path, description] of parameterDescriptions(at(tool, 'inputSchema'), `${name}.inputSchema`)) {
      report.string(description, path, MAX_TOOL_DESCRIPTION);
    }
    if (at(tool, 'annotations', 'readOnlyHint') !== true || at(tool, 'annotations', 'destructiveHint') !== false) {
      report.add(`${name}.annotations must mark it read-only and not destructive`);
    }
    // Copilot draws a view only from a tool whose pinned definition names it, visible to the model (plugin-mcp-apps).
    const view = VIEWED.get(name);
    const visibility = at(tool, '_meta', 'ui', 'visibility');
    if (view && (at(tool, '_meta', 'ui', 'resourceUri') !== view || !Array.isArray(visibility) || !visibility.includes('model'))) {
      report.add(`${name}._meta.ui must name its view ${view}, visible to the model`);
    }
  });
}

/** Every problem with the package; an empty list means it is ready to zip. */
export function validatePackage(files: PackageFiles): string[] {
  const problems: string[] = [];
  const manifest = parse(files, MANIFEST_FILE, problems);
  if (!manifest) return problems;
  const report = new Report(MANIFEST_FILE);
  const agentFile = checkManifest(manifest, files, report);
  problems.push(...report.problems);
  if (!agentFile) return problems;
  const agent = parse(files, agentFile, problems);
  if (!agent) return problems;
  const agentReport = new Report(agentFile);
  const pluginFiles = checkAgent(agent, files, agentReport);
  problems.push(...agentReport.problems);
  for (const file of pluginFiles) {
    const plugin = parse(files, file, problems);
    if (!plugin) continue;
    const pluginReport = new Report(file);
    const toolsFile = checkPlugin(plugin, files, pluginReport);
    problems.push(...pluginReport.problems);
    const tools = toolsFile ? parse(files, toolsFile, problems) : null;
    if (!toolsFile || !tools) continue;
    const toolsReport = new Report(toolsFile);
    checkTools(tools, plugin, toolsReport);
    problems.push(...toolsReport.problems);
  }
  return problems;
}
