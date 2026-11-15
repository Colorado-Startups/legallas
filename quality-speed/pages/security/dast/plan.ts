// SPDX-License-Identifier: Apache-2.0
// The ZAP Automation Framework plan: one ZAP run for all four targets (targets.ts). Written as JSON, which ZAP's YAML
// reader accepts. Job and parameter names are from ZAP's own help pages (zaproxy/zap-extensions, read 2026-11-05).
//
// Order: passive settings, header rules, API imports, the MCP import, spiders, a passive wait, the active scans, a
// passive wait, then the exports and reports run.ts reads. Every path is inside the container's /zap/wrk.
import type { Target } from './targets.ts';

/** Where run.ts mounts its work folder in the container. */
export const WRK = '/zap/wrk';
export const ALERTS_FILE = 'zap-alerts.json';
export const HTML_FILE = 'zap-report.html';
/** The MCP import's own requests, which run.ts counts to show each tool was reached. Holds the token, so it is deleted. */
export const MCP_HISTORY_FILE = 'mcp-member-history.har';
/** ZAP reads this environment variable into the MCP import's Authorization header. */
export const TOKEN_VAR = 'MCP_TOKEN';

export const urlsFile = (target: Target['name']) => `urls-${target}.txt`;

export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface PlanOptions {
  targets: readonly Target[];
  /** Target name to the OpenAPI file (inside WRK) imported into it. */
  openapi: Readonly<Partial<Record<Target['name'], string>>>;
  /** The MCP endpoint ZAP's MCP add-on imports, with the token in TOKEN_VAR. */
  mcpUrl: string;
  spiderMinutes: number;
  /** No single active rule may run longer than this. */
  ruleMinutes: number;
}

type Job = Record<string, unknown>;

/** One rule of ZAP's replacer job: sets a request header on every request to `url`, adding it when absent. */
export interface ReplacerRule {
  description: string;
  url: string;
  matchType: 'req_header';
  matchString: string;
  matchRegex: boolean;
  replacementString: string;
  tokenProcessing: boolean;
}

/**
 * Headers a member's browser sends on every write. The room refuses a write without both (web/worker/http.ts
 * isSameOriginWrite), so without them the active scan would never reach a write handler.
 */
export function memberWriteHeaders(target: Target): ReplacerRule[] {
  if (target.surface !== 'room' || target.audience !== 'member') return [];
  const url = `${escapeRegex(target.origin)}/.*`;
  const rule = (header: string, value: string): ReplacerRule => ({
    description: `${target.name} ${header}`,
    url,
    matchType: 'req_header',
    matchString: header,
    matchRegex: false,
    replacementString: value,
    tokenProcessing: false,
  });
  return [rule('Origin', target.origin), rule('Sec-Fetch-Site', 'same-origin')];
}

export function zapPlan(options: PlanOptions): Record<string, unknown> {
  const { targets } = options;
  const out = (file: string) => `${WRK}/out/${file}`;
  const jobs: Job[] = [
    { type: 'passiveScan-config', parameters: { maxAlertsPerRule: 0, scanOnlyInScope: true, enableTags: false } },
    { type: 'replacer', parameters: { deleteAllRules: true }, rules: targets.flatMap(memberWriteHeaders) },
  ];
  for (const target of targets) {
    const file = options.openapi[target.name];
    if (file) jobs.push({ type: 'openapi', name: `openapi ${target.name}`, parameters: { apiFile: `${WRK}/${file}`, context: target.name, targetUrl: target.origin } });
  }
  jobs.push({ type: 'mcp-import', name: 'mcp-import mcp-member', parameters: { serverUrl: options.mcpUrl, securityKey: `Bearer \${${TOKEN_VAR}}` } });
  // The MCP import's own requests, before the spider and scans add theirs.
  const mcpMember = targets.find((target) => target.surface === 'mcp' && target.audience === 'member');
  if (mcpMember) jobs.push({ type: 'export', name: 'export mcp history', parameters: { context: mcpMember.name, type: 'har', source: 'history', fileName: out(MCP_HISTORY_FILE) } });
  for (const target of targets) {
    jobs.push({ type: 'spider', name: `spider ${target.name}`, parameters: { context: target.name, url: `${target.origin}${target.spiderPath}`, maxDuration: options.spiderMinutes, maxDepth: 5 } });
  }
  jobs.push({ type: 'passiveScan-wait', parameters: { maxDuration: 5 } });
  for (const target of targets) {
    jobs.push({
      type: 'activeScan',
      name: `activeScan ${target.name}`,
      parameters: { context: target.name, maxRuleDurationInMins: options.ruleMinutes, maxScanDurationInMins: target.activeMinutes, maxAlertsPerRule: 0 },
    });
  }
  jobs.push({ type: 'passiveScan-wait', parameters: { maxDuration: 5 } });
  for (const target of targets) jobs.push({ type: 'export', name: `export urls ${target.name}`, parameters: { context: target.name, type: 'url', source: 'all', fileName: out(urlsFile(target.name)) } });
  jobs.push({ type: 'report', name: 'report json', parameters: { template: 'traditional-json', reportDir: `${WRK}/out`, reportFile: ALERTS_FILE, reportTitle: 'Automated dynamic scan' } });
  jobs.push({ type: 'report', name: 'report html', parameters: { template: 'traditional-html', reportDir: `${WRK}/out`, reportFile: HTML_FILE, reportTitle: 'Automated dynamic scan' } });
  return {
    env: {
      contexts: targets.map((target) => ({ name: target.name, urls: [`${target.origin}/`], includePaths: [`${escapeRegex(target.origin)}/.*`] })),
      // Keep going past a failed job, so one broken import still leaves the other targets scanned and a report written.
      // run.ts reads ZAP's exit code: 1 means some job failed, and fails the run.
      parameters: { failOnError: false, failOnWarning: false, continueOnFailure: true, progressToStdout: true },
    },
    jobs,
  };
}
