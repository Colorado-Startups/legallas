// SPDX-License-Identifier: Apache-2.0
// The core's tools, in the order clients list them. Add to this list only by a reviewed change. A package adds its own
// tools at fixed places in it (mcp/extensions.ts; pro: mcp/pro.ts), so listedTools() is what the server lists.
import type { ToolDefinition } from '../contract.ts';
import { withAddedTools } from '../extensions.ts';
import { getCommentsTool } from './comments.ts';
import { getDocumentTool, listDocumentsTool } from './documents.ts';
import { getFileTool } from './files.ts';
import { readPagesTool } from './pages.ts';
import { searchTool } from './search.ts';
import { templateTool } from './templates.ts';

/** Every tool that the MCP server offers. */
export const TOOLS: readonly ToolDefinition<any>[] = [
  searchTool,
  listDocumentsTool,
  getDocumentTool,
  readPagesTool,
  getCommentsTool,
  getFileTool,
  templateTool,
];

/** Every tool the server lists: TOOLS with the ones packages added, read per request. */
export function listedTools(): readonly ToolDefinition<any>[] {
  return withAddedTools(TOOLS);
}
