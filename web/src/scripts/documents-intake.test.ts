// SPDX-License-Identifier: Apache-2.0
// Card P5b (Documents, intake): the document-date rule the heatmap counts by and the table filters on, and the
// plain-language upload rules behind "Send to client".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_UPLOAD_BYTES } from '../../worker/files-upload.ts';
import type { FolderNode, ListedDocument } from './files-api.ts';
import { documentDate, documentMonth, flattenTree, heatDates } from './documents-intake-dates.ts';
import {
  MAX_UPLOAD_LABEL, UPLOAD_ACCEPT, errorCode, isoDay, messageFor, percent, precheck, syncStatus, uploadedId,
} from './documents-intake-rules.ts';

const doc = (id: string, updated_at = '2026-09-30T18:04:00Z'): ListedDocument => ({
  id, name: `DOE-${id}.pdf`, kind: 'pdf', size: 1, pages: 1, updated_at, source: 'mirror',
});

const folder = (path: string, files: ListedDocument[], folders: FolderNode[] = [], guide: ListedDocument | null = null): FolderNode => ({
  path, name: path, guide, files, folders, count: files.length, size: files.length,
});

test('documentDate prefers the matter date, at whatever precision it has', () => {
  assert.equal(documentDate({ date: '2012-03-03' }, '2026-09-30T18:04:00Z'), '2012-03-03');
  assert.equal(documentDate({ date: '2012-03' }, '2026-09-30T18:04:00Z'), '2012-03');
  assert.equal(documentDate({ date: '2013' }, '2026-09-30T18:04:00Z'), '2013', 'a year-only date is not replaced');
});

test('documentDate falls back to the day the room saw the file', () => {
  assert.equal(documentDate(undefined, '2026-09-30T18:04:00Z'), '2026-09-30');
  assert.equal(documentDate({ date: null }, '2026-09-30T18:04:00Z'), '2026-09-30');
  assert.equal(documentDate({ date: '2013-13' }, '2026-09-30T18:04:00Z'), '2026-09-30', 'a malformed date is ignored');
  assert.equal(documentDate(undefined, 'yesterday'), null);
  assert.equal(documentDate(undefined, null), null);
});

test('documentMonth is the heatmap cell a document counts in', () => {
  assert.equal(documentMonth({ date: '2012-03-03' }, null), '2012-03');
  assert.equal(documentMonth({ date: '2012-03' }, null), '2012-03');
  assert.equal(documentMonth({ date: '2013' }, '2026-09-30T00:00:00Z'), null, 'year-only dates sit outside the grid');
  assert.equal(documentMonth(undefined, '2026-09-30T00:00:00Z'), '2026-09');
  assert.equal(documentMonth(undefined, undefined), null);
});

test('flattenTree lists every document once, guides included', () => {
  const guide = doc('g');
  const tree = folder('', [doc('a')], [folder('03', [doc('b'), doc('c')], [folder('03/03.2', [doc('d')])], guide)]);
  assert.deepEqual(flattenTree(tree).map((d) => d.id), ['a', 'g', 'b', 'c', 'd']);
  const twice = folder('', [doc('a')], [folder('x', [doc('a')])]);
  assert.deepEqual(flattenTree(twice).map((d) => d.id), ['a']);
});

test('heatDates joins the matter facts by document id', () => {
  const docs = [doc('a', '2026-01-02T00:00:00Z'), doc('b', '2026-03-04T00:00:00Z')];
  assert.deepEqual(heatDates(docs, { a: { date: '2012-07-01' } }), ['2012-07-01', '2026-03-04']);
  assert.deepEqual(heatDates(docs, null), ['2026-01-02', '2026-03-04'], 'no published matter yet');
});

test('precheck refuses what the Worker would refuse, before sending a byte', () => {
  assert.equal(precheck({ name: 'invoice.pdf', size: 10 }), null);
  assert.equal(precheck({ name: 'INVOICE.PDF', size: 10 }), null);
  assert.equal(precheck({ name: 'page.html', size: 10 }), 'type_not_allowed');
  assert.equal(precheck({ name: 'logo.svg', size: 10 }), 'type_not_allowed');
  assert.equal(precheck({ name: 'noextension', size: 10 }), 'type_not_allowed');
  assert.equal(precheck({ name: 'empty.txt', size: 0 }), 'empty_file');
  assert.equal(precheck({ name: 'big.zip', size: MAX_UPLOAD_BYTES }), null);
  assert.equal(precheck({ name: 'big.zip', size: MAX_UPLOAD_BYTES + 1 }), 'too_large');
});

test('every refusal reads as one plain sentence with no names in it', () => {
  const codes = ['forbidden', 'bad_name', 'type_not_allowed', 'empty_file', 'too_large', 'content_mismatch', 'active_content', 'pii_in_name', 'pii_in_file',
    'length_required', 'bad_length', 'incomplete_body', 'network', 'canceled', 'something_new', '', null];
  for (const code of codes) {
    const text = messageFor(code);
    assert.match(text, /^[A-Z][^.!]*(\.[a-z]+[^.!]*)*\.$/, `${String(code)}: ${text}`);
    assert.doesNotMatch(text, /the owner|Mac|\u2014|!/, `${String(code)}: ${text}`);
  }
  assert.equal(messageFor('too_large'), `That file is larger than ${MAX_UPLOAD_LABEL}.`);
  assert.equal(MAX_UPLOAD_LABEL, '95 MB');
  assert.equal(messageFor('toString'), messageFor('unknown'), 'inherited keys are not messages');
});

test('the picker accepts exactly the allowlist', () => {
  assert.equal(UPLOAD_ACCEPT, '.pdf,.png,.jpg,.jpeg,.docx,.xlsx,.pptx,.zip,.txt,.csv,.md');
});

test('errorCode and uploadedId read the route body, tolerating junk', () => {
  assert.equal(errorCode('{"error":"too_large"}'), 'too_large');
  assert.equal(errorCode('<html>bad gateway</html>'), null);
  assert.equal(errorCode('null'), null);
  assert.equal(errorCode('{"error":7}'), null);
  assert.equal(uploadedId('{"id":"9b1f","name":"a.pdf"}'), '9b1f');
  assert.equal(uploadedId('{"id":""}'), null);
  assert.equal(uploadedId(''), null);
});

test('percent is a whole number from 0 to 100', () => {
  assert.equal(percent(0, 100), 0);
  assert.equal(percent(64, 100), 64);
  assert.equal(percent(2, 3), 67);
  assert.equal(percent(150, 100), 100);
  assert.equal(percent(5, 0), 0);
  assert.equal(percent(Number.NaN, 10), 0);
});

test('syncStatus names where a counsel file stands', () => {
  assert.deepEqual(syncStatus(false), { state: 'waiting', label: 'Waiting for sync' });
  assert.deepEqual(syncStatus(true), { state: 'synced', label: 'Synced to client files' });
});

test('isoDay writes metadata dates as ISO days', () => {
  assert.match(isoDay('2026-09-30T12:00:00Z'), /^2026-09-30$/);
  assert.equal(isoDay('not a date'), '');
});

test('only a member who can upload sees Send to client and the accepted types (data-needs, header.css)', () => {
  const intake = readFileSync(join(import.meta.dirname, 'documents-intake.ts'), 'utf8');
  const css = readFileSync(join(import.meta.dirname, '..', 'styles', 'components', 'header.css'), 'utf8');
  assert.match(intake, /const send = el\('button'[^\n]*\n\s*send\.type = 'button';\n\s*send\.dataset\.needs = 'upload';/);
  assert.match(intake, /const limits = el\('p', 'docs-counsel__limits t-caption', UPLOAD_LIMITS\);\n\s*limits\.dataset\.needs = 'upload';/);
  assert.match(css, /html\[data-cannot~='upload'\] \[data-needs~='upload'\]/);
});
