// SPDX-License-Identifier: Apache-2.0
// The room's views as MCP Apps (modelcontextprotocol/ext-apps specification 2026-01-26): two HTML resources, each on one
// existing tool, rendered by the AI from that tool's result. No new tool.
//
// | Resource                 | On tool                   | Faces                               |
// |--------------------------|---------------------------|-------------------------------------|
// | `ui://legallas/overview` | `legallas_case_overview`  | Summary · Board · Timeline (by section) |
// | `ui://legallas/grid`     | `legallas_list_documents` | Grid                                |
//
// A tool names one resource, so the board and the timeline share the overview's page and pick their face from the
// result's section (mcp/apps/view/overview.ts).
//
// | Who                 | Renders | Notes (read 2026-11-06)                                                                  |
// |---------------------|---------|------------------------------------------------------------------------------------------|
// | Claude (all apps)   | yes     | support.claude.com/en/articles/13454812; claude.com/docs/connectors/building/mcp-apps    |
// | Microsoft 365 Copilot | yes   | declarative agent, plugin v2.4 RemoteMCPServer; learn.microsoft.com/…/plugin-mcp-apps     |
// | Harvey, OpenCode    | no      | they read the tool's text, which is unchanged                                            |
//
// Each page is one self-contained HTML (mcp/apps/build.ts bundles the chart kit into it): no script, style, font or
// image from anywhere, and no request of its own. So the resource declares no `csp` (no outside origin, the hosts'
// default) and no `domain` (a stable sandbox origin matters only to an app that fetches or signs in; a wrong one breaks
// the view in Claude). Its data is the tool result the host passes in; a cite reads its page with
// legallas_read_pages through the host. The same page runs in the room's binder frame (viewDocument).
import type { McpServer } from '@modelcontextprotocol/server';
import { STORED_NAME } from '../../worker/stored-name.ts';
import { withToolPrefix } from '../tool-prefix.ts';
import { CONFIG_ID, DATA_ID } from './view/ids.ts';
import { VIEW_HTML } from './views.generated.ts';

export type ViewName = keyof typeof VIEW_HTML;

/** MCP Apps' resource type (the specification's Content Requirements). */
export const VIEW_MIME = 'text/html;profile=mcp-app';

export const VIEWS: Readonly<Record<ViewName, { uri: string; title: string; description: string }>> = {
  overview: {
    uri: 'ui://legallas/overview',
    title: 'Board and timeline',
    description: "The room's case overview as a board by status, a timeline of dated entries, or summary tiles, each entry cited.",
  },
  grid: {
    uri: 'ui://legallas/grid',
    title: 'Review grid',
    description: "The room's documents as a review grid: a row per document, its facts in columns, each cell opening its page.",
  },
};

/** The tool each view is drawn from, by its default name (mcp/tool-prefix.ts renames both together). */
export const VIEW_OF_TOOL = { legallas_case_overview: 'overview', legallas_list_documents: 'grid' } as const satisfies Record<string, ViewName>;

/**
 * A tool's `_meta` for its view: `ui.resourceUri`, and `ui.visibility` with both "model" (the AI lists and calls it,
 * which Copilot requires) and "app" (the view may call it again for another section or page). The flat
 * `ui/resourceUri` key is the specification's older spelling, still read by earlier hosts.
 */
export function viewMeta(view: ViewName): Record<string, unknown> {
  return { ui: { resourceUri: VIEWS[view].uri, visibility: ['model', 'app'] }, 'ui/resourceUri': VIEWS[view].uri };
}

/** The resource's own `_meta.ui`: a border where the host draws one (Claude). Nothing else: see the header. */
export const VIEW_RESOURCE_META = { ui: { prefersBorder: true } } as const;

/** What a page needs of its room (mcp/apps/view/bridge.ts ViewConfig): the tool names it calls and the stored name. */
export interface ViewConfig {
  tools: { overview: string; list: string; read: string };
  storedName: string;
}

/** The config for a room's tool prefix (mcp/tool-prefix.ts), so a renamed room's view calls its own tools. */
export function viewConfig(toolPrefix?: string): ViewConfig {
  const named = (name: string) => withToolPrefix(name, toolPrefix);
  return {
    tools: { overview: named('legallas_case_overview'), list: named('legallas_list_documents'), read: named('legallas_read_pages') },
    storedName: STORED_NAME,
  };
}

export { CONFIG_ID, DATA_ID };

/** JSON for inside a <script> block: nothing in it can close the block or start a comment. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function withBlocks(view: ViewName, blocks: Record<string, unknown>): string {
  const page = VIEW_HTML[view];
  const scripts = Object.entries(blocks).map(([id, value]) => `<script type="application/json" id="${id}">${scriptJson(value)}</script>`).join('');
  const at = page.indexOf('</head>');
  return at < 0 ? scripts + page : page.slice(0, at) + scripts + page.slice(at);
}

/** A view's page for the AI: the bundle with the room's config. */
export function viewHtml(view: ViewName, config: ViewConfig): string {
  return withBlocks(view, { [CONFIG_ID]: config });
}

/**
 * A view's page for the room's binder frame: the same bundle, with one tool result saved inside it, so it draws with
 * no host (bridge.ts binder mode) under the binder's `visual` policy (worker/headers.ts: inline only, no network). A
 * cite in it opens the exhibit through the binder's bridge. `result` is the tool's CallToolResult as the room served it
 * to its member; the view keeps nothing else.
 */
export function viewDocument(view: ViewName, result: unknown, config: ViewConfig, args?: Record<string, unknown>): string {
  return withBlocks(view, { [CONFIG_ID]: config, [DATA_ID]: { result, ...(args ? { args } : {}) } });
}

/** Registers both views as resources. They hold no case data, so any connection may read them. */
export function registerViews(server: McpServer, config: ViewConfig): void {
  for (const view of Object.keys(VIEWS) as ViewName[]) {
    const { uri, title, description } = VIEWS[view];
    const text = viewHtml(view, config);
    server.registerResource(`legallas-${view}-view`, uri, { title, description, mimeType: VIEW_MIME, _meta: VIEW_RESOURCE_META }, (url) => ({
      contents: [{ uri: url.href, mimeType: VIEW_MIME, text, _meta: VIEW_RESOURCE_META }],
    }));
  }
}
