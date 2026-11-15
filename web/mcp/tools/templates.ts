// SPDX-License-Identifier: Apache-2.0
// legallas_template: the template library (templates/founders, raise and investors), listed, or one template read a
// part at a time (mcp/templates.ts). Every member's AI may call it: templates are never privileged. Off for room guests
// (mcp/server.ts GUEST_TOOLS).
import { z } from 'zod';
import type { ToolDefinition } from '../contract.ts';
import { templateList, templatePart } from '../templates.ts';
import { TEMPLATE_OUTPUT } from './output.ts';

const inputSchema = z.object({
  path: z.string().max(200).optional().describe('A path from the list.'),
  part: z.number().int().min(1).max(999).default(1).describe('next_part from the last result.'),
});

/** The legallas_template tool, which reads a template. */
export const templateTool: ToolDefinition<typeof inputSchema> = {
  name: 'legallas_template',
  title: 'Read a template',
  description: 'Lists the template library; with a path, returns that template a part at a time.',
  inputSchema,
  outputSchema: TEMPLATE_OUTPUT,
  async handler(args, ctx) {
    return args.path === undefined ? templateList(ctx.profile, args.part) : templatePart(args.path, ctx.profile, args.part);
  },
};
