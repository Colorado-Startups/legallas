import { test } from "node:test";
import assert from "node:assert/strict";
import { pageThrough } from "../lib/github.ts";

test("paging stops at a short page or the stop test; the cap throws unless the list is a sample", async () => {
  const pages = (n: number) => async (path: string) => {
    const page = Number(/[?&]page=(\d+)/.exec(path)![1]);
    return page <= n ? Array.from({ length: 100 }, (_, i) => ({ i: (page - 1) * 100 + i })) : [];
  };
  assert.equal((await pageThrough(pages(3), "/x")).length, 300);
  assert.equal((await pageThrough(pages(50), "/x", { cap: 250, sample: true })).length, 250);
  await assert.rejects(pageThrough(pages(50), "/x", { cap: 250 }));
  assert.equal((await pageThrough(pages(3), "/x", { cap: 300 })).length, 300);
  await assert.rejects(pageThrough(pages(4), "/x", { cap: 300 }));
  assert.equal((await pageThrough(pages(50), "/x", { stop: (last) => (last as { i: number }).i >= 199 })).length, 200);
  await assert.rejects(pageThrough(async () => ({}), "/x"));
});
