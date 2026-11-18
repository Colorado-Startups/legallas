// Issues page: pure scoring of GitHub issue records. Reads titles and bodies in memory only; every output is a number,
// a boolean, an issue number or one of this file's fixed labels, so nothing an issue says can reach the site.

import { stripHtmlComments } from "../../core/escape.ts";

export type Label = { name: string };
export type Issue = {
  number: number;
  state: "open" | "closed";
  state_reason?: string | null;
  created_at: string;
  closed_at?: string | null;
  updated_at: string;
  labels: Label[];
  body?: string | null;
  pull_request?: unknown;
  /** The organization's issue type (Bug, Task, Feature), or null. */
  type?: { name: string } | null;
  milestone?: { title: string } | null;
};

export type Rank = "P1" | "P2" | "P3";
export type Severity = "critical" | "high" | "medium" | "low";

export type Row = {
  n: number;
  goal: boolean;
  who: boolean;
  where: boolean;
  done: boolean;
  /** Its one P label, or null: none, or more than one. */
  p: Rank | null;
  sev: Severity;
  age_d: number;
  stale: boolean;
  /** It has an issue type. */
  typed: boolean;
  /** Open longer than its rank's close target (`close_days`). */
  overdue: boolean;
  /** In the launch milestone. */
  launch: boolean;
};

/** What the collector reads and how. Changing a number here changes what a metric means: review it like the manifest. */
export const CONFIG = {
  /** This site's own issues, left out and listed: this label, or every file named under this folder. */
  excluded_label: "area:quality-speed",
  excluded_folder: "quality-speed/",
  /** actions/stale's default `days-before-stale`. */
  stale_days: 60,
  /** `closed_by_hand` counts completed closes from here on: the day the pull-request skill began writing `Closes #N`. A fixed
   * start, never a trailing window (#846): a miss stays until it is reopened and closed by a merged pull request. */
  closes_since: "2026-11-07T00:00:00Z",
  /** The labels that rank an issue, most needed first. An open issue carries exactly one. */
  ranks: ["P1", "P2", "P3"],
  /** Days an open issue may stay open, by rank: GitLab's bug resolution SLOs for severity 1, 2 and 3. No rank: P1's. */
  close_days: { P1: 30, P2: 60, P3: 90 },
  /** The one milestone: every issue in it closes before the make-public gate (the owner, 2026-11-09). */
  launch_milestone: "Public launch",
} as const;

export type Config = typeof CONFIG;

const DAY = 86_400_000;

// Headings that count for each part of the repo's issue shape (CLAUDE.md: "Each says its goal, customer, files and
// when it's done"). The issue forms' own headings are accepted too.
const SECTIONS: Record<"goal" | "who" | "where" | "done", string[]> = {
  goal: ["goal", "problem or goal", "task", "what happened, and what you expected"],
  who: ["who it's for", "customer"],
  where: ["where to work", "files", "where"],
  done: ["done when"],
};

const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[*_`]/g, "").trim().toLowerCase();

/** Splits a markdown body into its level 2 and 3 headed sections. */
export function sections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let key: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (key !== null && !out.has(key)) out.set(key, buf.join("\n"));
  };
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const h = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      key = norm(h[1] ?? "");
      buf = [];
    } else if (/^#\s/.test(line)) {
      flush();
      key = null;
    } else if (key !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Text that only holds a place: a form's empty answer, a dash, a question mark, TBD, TODO, n/a or none. */
const PLACEHOLDER = /^(?:_?no response_?|tbd|todo|to do|n\/?a|none|-+|\?+|\.+)$/i;

const clean = (l: string) => l.replace(/^[\s>*+-]*(?:\[[ x]\])?\s*/i, "").replace(/[.!:\s]+$/, "").trim();
const real = (l: string) => l.length > 0 && !PLACEHOLDER.test(l);

const filled = (text: string | undefined) =>
  text !== undefined && stripHtmlComments(text).split("\n").map(clean).some(real);

/** Which of the four template parts a body states, each with some text under it. */
export function templateParts(body: string | null | undefined) {
  const map = sections(body ?? "");
  const has = (names: string[]) => names.some((n) => filled(map.get(n)));
  return { goal: has(SECTIONS.goal), who: has(SECTIONS.who), where: has(SECTIONS.where), done: has(SECTIONS.done) };
}

const names = (i: Issue) => i.labels.map((l) => l.name);

/** An issue's one rank label, or null with none or several. */
export function rankOf(i: Issue, cfg: Config): Rank | null {
  const found = names(i).filter((n): n is Rank => (cfg.ranks as readonly string[]).includes(n));
  return found.length === 1 ? (found[0] as Rank) : null;
}

/** The Severity line, as the Reliability page reads it: none counts as high, so leaving it off never helps. */
export function severityOf(body: string | null | undefined): Severity {
  const found = /^Severity:\s*(critical|high|medium|low)\s*$/im.exec(body ?? "")?.[1]?.toLowerCase();
  return (found as Severity | undefined) ?? "high";
}

/** The repo paths an issue names under Files or Where to work, or anywhere in it when it has neither. */
export function paths(body: string | null | undefined): string[] {
  const map = sections(body ?? "");
  const where = SECTIONS.where.filter((n) => map.has(n));
  const text = where.length ? where.map((n) => map.get(n) ?? "").join("\n") : (body ?? "");
  return [...text.matchAll(/`(?:\.\/)?([\w.-]+\/[^`\s]*|[\w-]+\.\w+)`/g)].map((m) => m[1] ?? "");
}

/** The repo's top-level folders: a path is placed only when it starts at one of these, so `core/` or `page.ts` alone place nothing. */
const ROOTS = [".claude/", ".github/", "LegallasApp/", "Sources/", "Tests/", "docs/", "quality-speed/", "templates/", "web/"];

/** This site's own workflows. */
const SITE_WORKFLOW = /^\.github\/workflows\/quality-speed[\w-]*\.yml$/;

/** This site's own work: its label, or every placed file it names is in the site's folder. */
export function siteOwn(i: Issue, cfg: Config): boolean {
  const named = paths(i.body).filter((p) => ROOTS.some((r) => p.startsWith(r)));
  return names(i).includes(cfg.excluded_label) || (named.length > 0 && named.every((p) => p.startsWith(cfg.excluded_folder) || SITE_WORKFLOW.test(p)));
}

/** Issues this page measures: not pull requests, and not this site's own. */
export const inScope = (all: Issue[], cfg: Config) => all.filter((i) => i.pull_request === undefined && !siteOwn(i, cfg));

/** Issue numbers left out as this site's own, so the exclusion stays visible. */
export const excluded = (all: Issue[], cfg: Config) =>
  all.filter((i) => i.pull_request === undefined && siteOwn(i, cfg)).map((i) => i.number).sort((a, b) => a - b);

/** Closes as completed since `closes_since`, oldest first: not-planned and duplicate closes left out. */
export const closesSince = (scoped: Issue[], cfg: Config) =>
  scoped
    .filter((i) => i.state === "closed" && i.state_reason === "completed" && Date.parse(i.closed_at as string) >= Date.parse(cfg.closes_since))
    .sort((a, b) => Date.parse(a.closed_at as string) - Date.parse(b.closed_at as string));

const days = (from: string, to: number) => (to - Date.parse(from)) / DAY;

/** One drill-down row per open issue in scope. */
export function rows(all: Issue[], cfg: Config, now: number): Row[] {
  return inScope(all, cfg)
    .filter((i) => i.state === "open")
    .sort((a, b) => a.number - b.number)
    .map((i) => ({
      n: i.number,
      ...templateParts(i.body),
      p: rankOf(i, cfg),
      sev: severityOf(i.body),
      age_d: round(days(i.created_at, now), 2),
      stale: days(i.updated_at, now) > cfg.stale_days,
      typed: typeof i.type?.name === "string",
      overdue: days(i.created_at, now) > cfg.close_days[rankOf(i, cfg) ?? "P1"],
      launch: i.milestone?.title === cfg.launch_milestone,
    }));
}

export const round = (v: number, places = 6) => Math.round(v * 10 ** places) / 10 ** places;
