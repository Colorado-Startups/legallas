// SPDX-License-Identifier: Apache-2.0
// Emails set out as text (eml.ts). Fictional Doe v. Roe messages only, with example.test addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlText, renderEml } from './eml.ts';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

const PLAIN = [
  'From: "Doe, Jane" <jane.doe@example.test>',
  'To: Richard Roe <rroe@example.test>,',
  ' Mary Major <mmajor@example.test>',
  'Cc: =?UTF-8?Q?J=C3=BCrgen_Example?= <jurgen@example.test>',
  'Date: Mon, 2 Apr 2012 09:15:00 -0600',
  `Subject: =?UTF-8?B?${b64('Café meeting:')}?= =?UTF-8?B?${b64(' Friday delivery schedule')}?=`,
  'Message-ID: <1@example.test>',
  'Received: from relay.example.test by mx.example.test',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset="utf-8"',
  'Content-Transfer-Encoding: quoted-printable',
  '',
  'Richard,',
  '',
  '',
  '',
  'The spring invoice for Harbor Labs is due Friday. We=E2=80=99ll send the deli=',
  'veries once the supply agreement is signed.',
  '',
  'Jane',
].join('\r\n');

test('a plain message: the shown headers decoded and unfolded, then the quoted-printable text with blank runs closed', () => {
  assert.equal(
    renderEml(PLAIN),
    [
      'From: "Doe, Jane" <jane.doe@example.test>',
      'To: Richard Roe <rroe@example.test>, Mary Major <mmajor@example.test>',
      'Cc: Jürgen Example <jurgen@example.test>',
      'Date: Mon, 2 Apr 2012 09:15:00 -0600',
      'Subject: Café meeting: Friday delivery schedule',
      '',
      'Richard,',
      '',
      'The spring invoice for Harbor Labs is due Friday. We’ll send the deliveries once the supply agreement is signed.',
      '',
      'Jane',
    ].join('\n'),
  );
});

const MIXED = `From: Jane Doe <jane.doe@example.test>
To: Richard Roe <rroe@example.test>
Date: Tue, 3 Apr 2012 10:00:00 -0600
Subject: Signed agreement
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="mix-1"

This is a multi-part message in MIME format.
--mix-1
Content-Type: multipart/alternative; boundary=alt-1

--alt-1
Content-Type: text/plain; charset=us-ascii

Attached is the signed agreement for Doe v. Roe.
--alt-1
Content-Type: text/html; charset=us-ascii

<html><body><p>Attached is the <b>signed</b> agreement (HTML copy).</p></body></html>
--alt-1--

--mix-1
Content-Type: application/pdf; name="ignored.pdf"
Content-Disposition: attachment;
 filename*=UTF-8''Supply%20Agreement%20%C2%A71.pdf
Content-Transfer-Encoding: base64

${b64('%PDF-1.4\nSECRET BYTES OF THE ATTACHMENT')}
--mix-1
Content-Type: image/png
Content-Disposition: inline; filename="logo.png"
Content-Transfer-Encoding: base64

iVBORw0KGgo=
--mix-1--
`;

test('a multipart message: the plain alternative, attachments by name only, never their bytes', () => {
  const text = renderEml(MIXED);
  assert.equal(
    text,
    [
      'From: Jane Doe <jane.doe@example.test>',
      'To: Richard Roe <rroe@example.test>',
      'Date: Tue, 3 Apr 2012 10:00:00 -0600',
      'Subject: Signed agreement',
      'Attachments: Supply Agreement §1.pdf; logo.png',
      '',
      'Attached is the signed agreement for Doe v. Roe.',
    ].join('\n'),
  );
  assert.equal(/SECRET|JVBER|HTML copy|multi-part message/.test(text ?? ''), false);
});

const HTML_ONLY = `From: Mary Major <mmajor@example.test>
Date: Wed, 4 Apr 2012 08:00:00 -0600
Subject: Kitchen notes
Content-Type: text/html; charset=windows-1252
Content-Transfer-Encoding: quoted-printable

<html><head><style>p { color: red; }</style><title>Ignore me</title></head><body>
<script>alert("x")</script>
<p>Order checked on April 4.&nbsp;Invoice total: $18&#44;420.55.</p>
<ul><li>Item one</li><li>Caf=E9 &amp; more</li></ul>
<div>Line one<br>Line two</div>
</body></html>
`;

test('an HTML-only message becomes text: no head, style or script, entities and the charset decoded', () => {
  assert.equal(
    renderEml(HTML_ONLY),
    [
      'From: Mary Major <mmajor@example.test>',
      'Date: Wed, 4 Apr 2012 08:00:00 -0600',
      'Subject: Kitchen notes',
      '',
      'Order checked on April 4. Invoice total: $18,420.55.',
      '',
      '- Item one',
      '- Café & more',
      '',
      'Line one',
      'Line two',
    ].join('\n'),
  );
});

const FORWARD = `From: Jane Doe <jane.doe@example.test>
Date: Thu, 5 Apr 2012 12:00:00 -0600
Subject: Fwd: Terms
Content-Type: multipart/mixed; boundary=b1

--b1
Content-Type: text/plain

See the message below.
--b1
Content-Type: message/rfc822

From: Richard Roe <rroe@example.test>
Date: Wed, 4 Apr 2012 17:00:00 -0600
Subject: Terms

The terms stand as written.
--b1--
`;

test('an attached message is named and set out after the text', () => {
  assert.equal(
    renderEml(FORWARD),
    [
      'From: Jane Doe <jane.doe@example.test>',
      'Date: Thu, 5 Apr 2012 12:00:00 -0600',
      'Subject: Fwd: Terms',
      'Attachments: attached message',
      '',
      'See the message below.',
      '',
      'Attached message:',
      'From: Richard Roe <rroe@example.test>',
      'Date: Wed, 4 Apr 2012 17:00:00 -0600',
      'Subject: Terms',
      '',
      'The terms stand as written.',
    ].join('\n'),
  );
});

test('a file that is not an email gives null, so it is shown and indexed as it is', () => {
  assert.equal(renderEml('just some notes\nwith no headers'), null);
  assert.equal(renderEml('{"json": 1}'), null);
  assert.equal(renderEml(''), null);
  assert.equal(renderEml('X-Note: a header block with no sender, date or subject\n\nbody'), null);
});

test('a cut message (the viewer reads the first 2 MB) keeps its text and the names it reached', () => {
  const cut = MIXED.slice(0, MIXED.indexOf('Content-Transfer-Encoding: base64') + 45);
  assert.equal(cut.includes('--mix-1--'), false, 'the closing boundary is cut off');
  const text = renderEml(cut) ?? '';
  assert.match(text, /Attached is the signed agreement for Doe v\. Roe\./);
  assert.match(text, /Attachments: Supply Agreement §1\.pdf/);
});

test('deep nesting and an mbox "From " line are handled without error', () => {
  let body = 'Content-Type: text/plain\n\nThe innermost text.';
  for (let i = 0; i < 20; i += 1) body = `Content-Type: multipart/mixed; boundary=n${i}\n\n--n${i}\n${body}\n--n${i}--`;
  const text = renderEml(`From jane.doe@example.test Sun Apr  1 00:00:00 2012\nFrom: Jane Doe <jane.doe@example.test>\nSubject: Deep\n${body}`);
  assert.ok(text?.startsWith('From: Jane Doe <jane.doe@example.test>\nSubject: Deep'));
  assert.equal(text?.includes('innermost'), false, 'parts past the depth limit are left out');
});

test('htmlText keeps text that only looks like markup once entities are decoded', () => {
  assert.equal(htmlText('<p>&lt;script&gt;not run&lt;/script&gt;</p>'), '<script>not run</script>');
});

test('htmlText drops a script or comment that only forms once an inner one is removed', () => {
  assert.equal(htmlText('<p>Hello</p><<script></script>script>steal()</script>'), 'Hello');
  assert.equal(htmlText('<p>Hello</p><!<script></script>-- note <b>hidden</b> -->'), 'Hello');
  assert.equal(htmlText('<p>Hello</p><script>steal()</script foo>'), 'Hello');
  assert.equal(htmlText('<p>Hello</p><!<!--- comment -->-- -->'), 'Hello');
  assert.equal(htmlText('<p>Hello</p><<!---->!--x-->'), 'Hello');
});

test('htmlText leaves no raw "<": an unclosed tag or comment loses its bracket', () => {
  assert.equal(htmlText('<p>Hello <!-- cut off</p>'), 'Hello !-- cut off');
  assert.equal(htmlText('<p>Hello</p><script'), 'Hello\nscript');
});
