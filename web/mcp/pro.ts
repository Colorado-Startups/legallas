// SPDX-License-Identifier: Apache-2.0
// Pro on the remote MCP server: the case overview and the visual binder tools,
// the prebuilt Copilot agent package and its download, the Claude plugin with the room's kits and the skill folder alone
// (mcp/claude-plugin.ts),
// and the /connect options that offer them. Added through
// mcp/extensions.ts when this file loads; the Worker entry imports it (mcp/entry-pro.ts), and so do the tests that
// list or call a pro tool. The tools keep the places they always had: the overview after search, the binder after
// read_pages.
import { CLAUDE_PLUGIN_PATH, SKILL_ZIP_PATH, claudePlugin, skillFolder } from './claude-plugin.ts';
import { agentConfigured, copilotPackage, legallasAgent } from './copilot-package.ts';
import { COPILOT_PACKAGE_PATH } from './contract.ts';
import { extendMcp } from './extensions.ts';
import { AGENT_ZIP_PATH } from './pages/connect-copilot.ts';
import { overviewTool } from './tools/overview.ts';
import { readPagesTool } from './tools/pages.ts';
import { searchTool } from './tools/search.ts';
import { viewVisualTool } from './tools/visuals.ts';

extendMcp({
  tools: [
    { tool: overviewTool, after: searchTool },
    { tool: viewVisualTool, after: readPagesTool },
  ],
  pages: [
    { path: COPILOT_PACKAGE_PATH, handler: copilotPackage },
    { path: AGENT_ZIP_PATH, handler: legallasAgent },
    { path: CLAUDE_PLUGIN_PATH, handler: claudePlugin },
    { path: SKILL_ZIP_PATH, handler: skillFolder },
  ],
  connect: (env) => ({ claudePlugin: true, ...(agentConfigured(env) ? { copilotPackage: true, copilotReferenceId: env.COPILOT_REFERENCE_ID?.trim() } : {}) }),
});
