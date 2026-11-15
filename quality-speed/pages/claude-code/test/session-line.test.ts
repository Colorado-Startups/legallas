import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionLines } from "../lib/compute.ts";
import { lineFor, tally, upsert } from "../session-line.ts";

// Invented transcript entries: ids, times and counts are made up.
const entry = (o: object) => JSON.stringify(o);
const usage = { input_tokens: 2, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 30 };

test("a message split over several lines counts once; subagents add theirs; a parent session's copied entries don't count", () => {
  const main = [
    entry({ sessionId: "parent", timestamp: "2031-04-09T06:00:00Z", message: { id: "p1", usage } }),
    entry({ type: "user", sessionId: "s", timestamp: "2031-04-09T08:00:00.120Z" }),
    entry({ timestamp: "2031-04-09T08:00:05Z", message: { id: "m1", usage } }),
    entry({ timestamp: "2031-04-09T08:00:05Z", message: { id: "m1", usage } }),
    "not json",
    entry({ timestamp: "2031-04-09T08:01:00Z", message: { id: "m2", usage: { ...usage, output_tokens: -5 } } }),
  ].join("\n");
  const sub = entry({ sessionId: "s", timestamp: "2031-04-09T07:00:00Z", message: { id: "s1", usage } });
  assert.deepEqual(tally([main, sub], "s"), { tokens: 1132 + 1102 + 1132, started: "2031-04-09T08:00:00Z" });
  assert.deepEqual(tally([""], "s"), { tokens: 0, started: null });
});

test("the line reads back as the collector parses it, and needs a session and a start", () => {
  const line = lineFor("0123abcd-ffff", { tokens: 12_345_678, started: "2031-04-09T08:00:00Z" });
  assert.equal(line, "Claude Code session 0123abcd: 12,345,678 tokens, started 2031-04-09T08:00:00Z");
  assert.deepEqual(sessionLines(`What: a change.\n\n${line}`), [{ session: "0123abcd", tokens: 12_345_678, started: "2031-04-09T08:00:00Z" }]);
  assert.throws(() => lineFor("", { tokens: 1, started: "2031-04-09T08:00:00Z" }));
  assert.throws(() => lineFor("0123abcd", { tokens: 1, started: null }));
});

test("a session's line is replaced in place; another session's is kept and a new one goes last", () => {
  const a = "Claude Code session aaaaaaaa: 5 tokens, started 2031-04-09T08:00:00Z";
  const b = "Claude Code session bbbbbbbb: 9 tokens, started 2031-04-09T09:00:00Z";
  const body = `| What | x |\r\n\r\n${a}\r\nRepairs: none`;
  const next = "Claude Code session aaaaaaaa: 50 tokens, started 2031-04-09T08:00:00Z";
  assert.equal(upsert(body, next), `| What | x |\n\n${next}\nRepairs: none`);
  assert.equal(upsert(`${body}\n\n`, b), `| What | x |\r\n\r\n${a}\r\nRepairs: none\n\n${b}\n`);
  assert.equal(upsert("", b), `\n\n${b}\n`);
});
