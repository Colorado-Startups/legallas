// SPDX-License-Identifier: Apache-2.0
// The dated report: what was scanned, how hard, and every finding with its severity and remediation status. It holds
// paths, rule names and counts only: no request or response body, no header, no token, and nothing from a document.
import { countBySeverity, RISKS, type Finding, type Judged } from './findings.ts';
import { TARGETS, type TargetName } from './targets.ts';

export interface Coverage {
  /** Requests ZAP sent to each target, from its URL export; null when the export was missing. */
  requests: Partial<Record<TargetName, number | null>>;
  /** The room's routes, from its route table, and how many answered a member's plain GET with 2xx. */
  roomRoutes: { total: number; gets: number; getsOk: number };
  /** Every route a stranger tried, and how many the gate refused. */
  strangerRoutes: { tried: number; refused: number };
  /** The MCP server's tools, as listed to the member's token, how many ZAP's import reached, and how many of those refused its placeholder arguments. Null when not recorded. */
  mcpTools: { listed: number; reached: number; toolErrors: number } | null;
}

export interface RunInfo {
  /** YYYY-MM-DD, in UTC. */
  date: string;
  commit: string;
  runUrl: string | null;
  zapVersion: string;
  zapImage: string;
  mcpAddon: string;
  /** ZAP's exit code: 0 clean, 1 a job failed, 2 a job warned. */
  zapExit: number;
  minutes: number;
  coverage: Coverage;
}

const LIMIT = 6;
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const targetLabel = (name: TargetName | null) => (name === null ? 'Every target' : (TARGETS.find((target) => target.name === name)?.label ?? name));
const rule = (finding: Finding) => `[${finding.alertRef}](https://www.zaproxy.org/docs/alerts/${finding.pluginId}/)`;
const nf = (n: number) => n.toLocaleString('en-US');

function mcpLine(tools: Coverage['mcpTools']): string {
  if (!tools) return 'not recorded';
  const refused = tools.toolErrors > 0 ? `; ${tools.toolErrors} refused ZAP's placeholder arguments, so ran only their checks` : '';
  return `${tools.reached} of ${tools.listed}${refused}`;
}

function places(finding: Finding): string {
  if (finding.status === 'fixed') return finding.fixedIn ? `Fixed in ${finding.fixedIn}` : '';
  const shown = finding.status === 'open' && finding.uncovered.length > 0 ? finding.uncovered : finding.places;
  const head = shown.slice(0, LIMIT).map((p) => `\`${p}\``).join(', ');
  return shown.length > LIMIT ? `${head} and ${shown.length - LIMIT} more` : head;
}

export function renderReport(info: RunInfo, judged: Judged): string {
  const { findings, notSeen } = judged;
  const counts = countBySeverity(findings);
  const total = (status: 'open' | 'accepted' | 'fixed') => RISKS.reduce((sum, risk) => sum + counts[risk][status], 0);
  const { coverage } = info;
  const lines: string[] = [
    `# Automated dynamic scan, ${info.date}`,
    '',
    'An automated dynamic application security test (DAST) of Legallas, run by OWASP ZAP against the fictional sample room.',
    'It is not a penetration test: no person tried to break in, and it does not judge business logic or one member\'s access to another\'s data.',
    '',
    '| | |',
    '|---|---|',
    `| Date | ${info.date} |`,
    `| Code | \`${info.commit.slice(0, 12)}\` |`,
    `| Run | ${info.runUrl ? `[GitHub Actions](${info.runUrl})` : 'local'} |`,
    `| Scanner | OWASP ZAP ${info.zapVersion}, official image \`${info.zapImage.split('@')[1]?.slice(0, 19) ?? info.zapImage}\`, with its MCP add-on ${info.mcpAddon} |`,
    '| Target | The fictional sample room, both Workers, served inside the CI job on localhost. No customer room and no deployed host |',
    `| Time | ${info.minutes} minutes |`,
    `| ZAP plan | ${info.zapExit === 0 ? 'Every job finished' : info.zapExit === 2 ? 'Finished, with warnings' : 'A job failed: see the run log'} |`,
    '',
    '## Findings by severity',
    '',
    '| Severity | Open | Accepted | Fixed |',
    '|---|---|---|---|',
    ...RISKS.map((risk) => `| ${risk} | ${counts[risk].open} | ${counts[risk].accepted} | ${counts[risk].fixed} |`),
    `| **Total** | **${total('open')}** | **${total('accepted')}** | **${total('fixed')}** |`,
    '',
    'One finding is one ZAP rule on one target, however many pages it was seen on. Open means not yet fixed or judged.',
    'Accepted means judged in `quality-speed/pages/security/dast/triage.json`, with the reason below.',
    '',
    '## What was scanned',
    '',
    '| Target | Requests sent | Active scan limit |',
    '|---|---|---|',
    ...TARGETS.map((target) => {
      const sent = coverage.requests[target.name];
      return `| ${target.label} | ${typeof sent === 'number' ? nf(sent) : 'not recorded'} | ${target.activeMinutes} minutes |`;
    }),
    '',
    '| Reach check | Result |',
    '|---|---|',
    `| Room routes in the route table | ${coverage.roomRoutes.total}, all imported into the scan |`,
    `| Room GET routes that answered the owner with 2xx | ${coverage.roomRoutes.getsOk} of ${coverage.roomRoutes.gets} |`,
    `| Room routes refused to a stranger | ${coverage.strangerRoutes.refused} of ${coverage.strangerRoutes.tried} |`,
    `| MCP tools ZAP's import reached | ${mcpLine(coverage.mcpTools)} |`,
    '',
    '## Findings',
    '',
  ];
  if (findings.length === 0) lines.push('None.', '');
  else {
    lines.push('| Severity | Finding | Rule | Target | Seen at | Status | Reason |', '|---|---|---|---|---|---|---|');
    for (const finding of findings) {
      lines.push(
        `| ${finding.risk} | ${cell(finding.name)} | ${rule(finding)} | ${targetLabel(finding.target)} | ${cell(places(finding))} | ${finding.status} | ${cell(finding.reason)} |`,
      );
    }
    lines.push('');
  }
  if (notSeen.length > 0) {
    lines.push('Judgments in `triage.json` that matched nothing this run:', '');
    for (const entry of notSeen) lines.push(`- ${entry.alert}${entry.paths ? ` at \`${entry.paths}\`` : ''}: ${entry.reason}`);
    lines.push('');
  }
  lines.push(
    '## Not covered',
    '',
    '| Not covered | Why |',
    '|---|---|',
    '| Cloudflare Access, TLS and the edge | The scan reaches the Workers directly on localhost over HTTP. In a real room Cloudflare Access refuses a stranger before the Worker runs |',
    '| Deal-room guest routes and the laptop sync endpoints | Each needs an identity the harness does not make: an invited guest, or a sync service token |',
    '| The Mac app | It is not a web application |',
    '| Access between members, and business logic | A scanner cannot judge who should see what. That is what a penetration test adds |',
    '',
    'How it runs, and how to judge a finding: `quality-speed/pages/security/dast/README.md`.',
    '',
  );
  return lines.join('\n');
}
