// SPDX-License-Identifier: Apache-2.0
// The Proposals page's pure half (proposals-model.ts): labels for every status, reason and step, and the controls a
// person gets, which never include deciding without the approve action or after a decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REJECT_REASONS } from '../../worker/proposals.ts';
import { controlsFor, decisionError, eventLabel, proposedBy, reasonOptions, sourceHref, STATUS_LABELS } from './proposals-model.ts';

test('every reject reason the server accepts is offered, in its order, with words', () => {
  assert.deepEqual(reasonOptions().map(([reason]) => reason), [...REJECT_REASONS]);
  assert.ok(reasonOptions().every(([, label]) => label.length > 0));
});

test('controls: only a person who may approve decides, only while pending; an expired one can still be rejected', () => {
  assert.deepEqual(controlsFor('pending', true), { approve: true, reject: true, download: false });
  assert.deepEqual(controlsFor('pending', false), { approve: false, reject: false, download: false });
  assert.deepEqual(controlsFor('expired', true), { approve: false, reject: true, download: false });
  assert.deepEqual(controlsFor('approved', true), { approve: false, reject: false, download: true });
  assert.deepEqual(controlsFor('approved', false), { approve: false, reject: false, download: true });
  for (const status of ['rejected', 'withdrawn'] as const) {
    assert.deepEqual(controlsFor(status, true), { approve: false, reject: false, download: false });
  }
});

test('labels: statuses, steps with their codes, who and which AI, and links to cited pages', () => {
  assert.equal(STATUS_LABELS.pending, 'Waiting for a decision');
  assert.equal(eventLabel('approve_refused', 'sources_changed'), 'Approval refused: a cited document changed');
  assert.equal(eventLabel('rejected', 'unsafe'), 'Rejected: Unsafe or out of scope');
  assert.equal(eventLabel('applied', null), 'applied', 'an unknown step reads as its code');
  assert.equal(eventLabel('constructor', 'toString'), 'constructor: toString', 'no prototype lookups');
  assert.equal(proposedBy('ada@firm.example', 'Claude'), 'ada@firm.example through Claude');
  assert.equal(proposedBy('ada@firm.example', null), 'ada@firm.example');
  assert.equal(sourceHref('doe 1', 3), '/doc/?id=doe%201#page=3');
  assert.equal(sourceHref('doe-1', null), '/doc/?id=doe-1');
  assert.match(decisionError('sources_changed'), /cannot be approved/);
  assert.match(decisionError('anything else'), /did not go through/);
});
