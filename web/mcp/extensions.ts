// SPDX-License-Identifier: Apache-2.0
// What a package adds to the remote MCP server without the core importing it (the Legallas plan, step 2: the tool
// registry). Pro calls extendMcp once, when mcp/pro.ts loads, to add its tools (the case overview and the visual
// binder), its pages (the prebuilt Copilot agent package) and what /connect offers with them. The Worker entry imports
// the package (mcp/entry-pro.ts); the core reads the registry per request and never at module load. The room's
// routes, mark and signature have their own registry (worker/extensions.ts).
import { proposalsEnabled } from '../worker/proposals.ts';
import type { McpEnv, ToolDefinition } from './contract.ts';
import type { ConnectPageOptions } from './pages/connect.ts';

/** A tool and the tool it is listed right after, so a package keeps the order clients see. */
export interface ToolSlot {
  tool: ToolDefinition<any>;
  after: ToolDefinition<any>;
}

/** A page at one exact path, served by oauth.ts route() like the core's own pages. */
export interface McpPage {
  path: string;
  handler: (request: Request, env: McpEnv) => Promise<Response>;
}

export interface McpExtension {
  tools?: readonly ToolSlot[];
  pages?: readonly McpPage[];
  /** What /connect offers beyond the core's guides. */
  connect?: (env: McpEnv) => ConnectPageOptions;
}

const slots: ToolSlot[] = [];
const pages = new Map<string, McpPage['handler']>();
let connect: McpExtension['connect'];

/** Adds tools and pages, and sets the /connect options when given. A path a package already added is refused. */
export function extendMcp(extension: McpExtension): void {
  for (const page of extension.pages ?? []) {
    if (pages.has(page.path)) throw new Error(`mcp page ${page.path} is already added`);
    pages.set(page.path, page.handler);
  }
  slots.push(...(extension.tools ?? []));
  connect = extension.connect ?? connect;
}

/** The core's tools with each added tool right after its anchor; one whose anchor is missing goes last. */
export function withAddedTools(core: readonly ToolDefinition<any>[]): readonly ToolDefinition<any>[] {
  const listed = [...core];
  for (const slot of slots) {
    const at = listed.indexOf(slot.after);
    listed.splice(at === -1 ? listed.length : at + 1, 0, slot.tool);
  }
  return listed;
}

/** The handler a package added for this exact path, if any. */
export function addedPage(path: string): McpPage['handler'] | undefined {
  return pages.get(path);
}

/** The /connect options a package set, else none, and whether the room's proposals are on. */
export function connectOptions(env: McpEnv): ConnectPageOptions {
  return { ...(connect?.(env) ?? {}), ...(proposalsEnabled(env) ? { proposals: true } : {}) };
}
