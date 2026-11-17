// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SpendStop } from '../spend-guard.ts';
import { sha256 } from './plan.ts';
import { CHECKPOINT_BATCHES, embedParts, type Part } from './replica.ts';

test('a stopped embed keeps what it embedded, so the next run embeds only the rest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-replica-'));
  try {
    // 120 parts: three batches of at most 50. The second call stops, as the day's budget would.
    const parts: Part[] = Array.from({ length: 120 }, (_, i) => ({ key: `law/both/p-${i}.md`, text: `part ${i}` }));
    let calls = 0;
    const stopping = async (texts: string[]) => {
      if (++calls === 2) throw new SpendStop('neurons', 'spend stop');
      return texts.map(() => [1, 0]);
    };
    await assert.rejects(embedParts(dir, parts, stopping, () => {}), /spend stop/);
    const kept = JSON.parse(await readFile(path.join(dir, 'replica', 'embeddings.json'), 'utf8')) as Record<string, number[]>;
    assert.equal(Object.keys(kept).length, 50);
    const asked: string[] = [];
    const vectors = await embedParts(dir, parts, async (texts) => (asked.push(...texts), texts.map(() => [0, 1])), () => {});
    assert.equal(asked.length, 70, 'only the parts the stopped run missed');
    assert.equal(vectors.length, 120);
    assert.deepEqual(vectors[0], [1, 0]);
    assert.deepEqual(vectors[119], [0, 1]);
    assert.ok(kept[sha256('part 0')]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a text the model refuses gets zeros, and the run embeds the rest', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-replica-'));
  try {
    const parts: Part[] = ['ok one', 'refused', 'ok two'].map((text, i) => ({ key: `law/both/p-${i}.md`, text }));
    const refusing = async (texts: string[]) => {
      if (texts.includes('refused')) throw new Error('embedding_http_400');
      return texts.map(() => [1, 0]);
    };
    const vectors = await embedParts(dir, parts, refusing, () => {});
    assert.deepEqual(vectors[0], [1, 0]);
    assert.ok(vectors[1]!.length > 0 && vectors[1]!.every((v) => v === 0));
    assert.deepEqual(vectors[2], [1, 0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a rate limit left after the retries ends the run at once and stores no zeros', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-replica-'));
  try {
    const parts: Part[] = ['ok one', 'limited', 'ok two'].map((text, i) => ({ key: `law/both/p-${i}.md`, text }));
    let calls = 0;
    const limited = async (texts: string[]) => {
      calls++;
      if (texts.includes('limited')) throw new Error('embedding_http_429');
      return texts.map(() => [1, 0]);
    };
    await assert.rejects(embedParts(dir, parts, limited, () => {}), /embedding_http_429/);
    assert.equal(calls, 1, 'no halving while rate-limited');
    await assert.rejects(readFile(path.join(dir, 'replica', 'embeddings.json'), 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a long embed writes its cache as it goes, so a run killed mid-way keeps its progress', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'law-replica-'));
  try {
    const batches = CHECKPOINT_BATCHES + 2;
    const parts: Part[] = Array.from({ length: batches * 50 }, (_, i) => ({ key: `law/both/p-${i}.md`, text: `part ${i}` }));
    let calls = 0;
    let seenOnDisk = 0;
    const watching = async (texts: string[]) => {
      // The batch after the checkpoint looks at the file, as a run killed there would leave it.
      if (++calls === CHECKPOINT_BATCHES + 1) seenOnDisk = Object.keys(JSON.parse(await readFile(path.join(dir, 'replica', 'embeddings.json'), 'utf8'))).length;
      return texts.map(() => [1, 0]);
    };
    await embedParts(dir, parts, watching, () => {});
    assert.equal(seenOnDisk, CHECKPOINT_BATCHES * 50);
    const kept = JSON.parse(await readFile(path.join(dir, 'replica', 'embeddings.json'), 'utf8')) as Record<string, number[]>;
    assert.equal(Object.keys(kept).length, batches * 50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
