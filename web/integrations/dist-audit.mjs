// SPDX-License-Identifier: Apache-2.0
// Fails the build when the output breaks the page CSP (inline style or script, inline handlers, remote
// assets) or a page's eager script is over the 60 KB gzipped budget (R15, R20). The checks live in
// scripts/dist-audit.ts. Listed last in astro.config.mjs, so it sees the files the other integrations copy.
import { fileURLToPath } from 'node:url';
import { auditDist, formatAudit } from '../scripts/dist-audit.ts';

/** @returns {import('astro').AstroIntegration} */
export default function distAudit() {
  return {
    name: 'legallas-dist-audit',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const { info, problems } = formatAudit(auditDist(fileURLToPath(dir).replace(/\/$/, '')));
        for (const line of info) logger.info(line);
        if (problems.length === 0) return;
        for (const line of problems) logger.error(line);
        throw new Error(`dist audit: ${problems.length} problem(s); see the lines above`);
      },
    },
  };
}
