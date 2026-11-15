// SPDX-License-Identifier: Apache-2.0
// Reads a robots file, so the default law pack (default-pack.ts) can follow each site's rules at the moment it fetches:
// the group for every agent, the longest matching path wins, Allow on a tie (RFC 9309).

interface Rule {
  allow: boolean;
  path: string;
}

/** The rules of the `User-agent: *` groups. */
function rulesForEveryAgent(robots: string): Rule[] {
  const rules: Rule[] = [];
  let inGroup = false;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const field = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!field) continue;
    const name = field[1]!.toLowerCase();
    const value = field[2]!.trim();
    if (name === 'user-agent') {
      // Consecutive User-agent lines share one group.
      inGroup = (lastWasAgent && inGroup) || value === '*';
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (inGroup && (name === 'allow' || name === 'disallow') && value) rules.push({ allow: name === 'allow', path: value });
  }
  return rules;
}

/**
 * A prefix match, where `*` stands for any run of characters and a final `$` anchors the end. Rules come from a remote
 * server, so this makes one forward pass rather than building a regular expression that many `*`s could make very slow.
 * Taking each piece's leftmost match can't rule out a later one, so it never needs to go back.
 */
function matches(rulePath: string, target: string): boolean {
  const anchored = rulePath.endsWith('$');
  const pieces = (anchored ? rulePath.slice(0, -1) : rulePath).split('*');
  const first = pieces[0] as string;
  if (pieces.length === 1) return anchored ? target === first : target.startsWith(first);
  if (!target.startsWith(first)) return false;
  let at = first.length;
  for (const piece of pieces.slice(1, -1)) {
    const found = target.indexOf(piece, at);
    if (found < 0) return false;
    at = found + piece.length;
  }
  const last = pieces[pieces.length - 1] as string;
  return anchored ? target.length - last.length >= at && target.endsWith(last) : target.indexOf(last, at) >= 0;
}

/** Whether `robots` lets every agent fetch `pathAndQuery` ("/a/b?c=d"). */
export function robotsAllows(robots: string, pathAndQuery: string): boolean {
  let best: Rule | null = null;
  for (const rule of rulesForEveryAgent(robots)) {
    if (!matches(rule.path, pathAndQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best?.allow ?? true;
}
