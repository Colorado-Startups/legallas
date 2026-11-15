// SPDX-License-Identifier: Apache-2.0
// The public /privacy and /terms pages for the AI connection (the owner, D7: they name the owner).
//
// Wording the owner approved. Change it only with the owner's approval, and update UPDATED. These pages
// never mention the case, the parties or the matter.
import { REFRESH_TOKEN_TTL_SECONDS } from '../contract.ts';
import { frame } from './html.ts';
import { contactEmail, operatorName } from '../../worker/room-settings.ts';

const OPERATOR = operatorName;
/** From https://example.com/.well-known/security.txt (Contact), read 2026-10-01. */
const CONTACT = contactEmail;
/** The date the owner approved the current wording. */
const UPDATED = 'Oct. 20, 2026';
const DAYS = Math.round(REFRESH_TOKEN_TTL_SECONDS / 86_400);

const contact = `<h2>Contact</h2>
<p>Questions or requests go to <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`;

function legalPage(title: string, lead: string, sections: string): string {
  const body = `<h1>${title}</h1>
<p class="lead">${lead}</p>
<div class="prose">
${sections}
${contact}
<p class="u-quiet">Last updated ${UPDATED}.</p>
</div>`;
  return frame({ title, body });
}

/** The privacy notice for the AI connection. Public. */
export function renderPrivacyPage(): string {
  return legalPage(
    'Privacy',
    `How the counsel room's AI connection handles information. ${OPERATOR} operates it.`,
    `<h2>What it processes</h2>
<ul>
<li>The email address you sign in with, checked against the list of invited members.</li>
<li>The name of each AI app you connect, and when you approved it.</li>
<li>The IP address and user agent of each request, kept in the room's activity log for security. For searches and reads these belong to your AI app's provider, whose servers make the requests; for signing in and managing connections they are yours.</li>
<li>How many searches and reads each member makes per day, to apply a daily limit.</li>
<li>A record of each search, each document read and each original file or visual image sent: who, when, which document and which AI app. What you asked is never recorded.</li>
<li>Documents in the room, read only when your AI app asks, and passed to that app: their text, the visuals, the comment threads and, for apps that accept them, small original files and images of the visuals.</li>
</ul>
<h2>Where it goes</h2>
<p>What your AI app reads, text and any file or image it receives, is sent to that app and its AI provider, under your firm's agreement with them. The service runs on Cloudflare, which processes requests to deliver it.</p>
<p>${OPERATOR} does not sell information, show ads or track you. The only cookies are for sign-in, for your consent and for protecting forms.</p>
<h2>How long it is kept</h2>
<p>A connection ends ${DAYS} days after you approve it, or sooner if you or the room owner end it. Activity records are kept for as long as the counsel room keeps its activity log.</p>`,
  );
}

/** The terms of use for the AI connection. Public. */
export function renderTermsPage(): string {
  return legalPage(
    'Terms of use',
    `These terms cover connecting an AI app to the counsel room, which ${OPERATOR} operates.`,
    `<h2>Who may connect</h2>
<p>Only members invited to the counsel room may connect, and only for the work they were invited to do. Access ends when membership ends.</p>
<h2>Confidential material</h2>
<p>Everything in the room is confidential. Keep it within your firm's duties of confidentiality, and connect only AI apps your firm has approved for confidential client material.</p>
<h2>Read-only access</h2>
<p>A connection can search and read what the member who made it sees in the room: document text, the visuals, the comment threads and, for apps that accept them, small original files and images of the visuals. It cannot change anything in the room. Each original file or visual image it receives is logged.</p>
<h2>Ending access</h2>
<p>${OPERATOR} may revoke any connection or membership at any time, without notice. You can end your own connections at any time.</p>
<h2>No warranty</h2>
<p>The service is provided as is, without warranty of any kind. Answers from your AI app are its own; check them against the documents before relying on them. To the extent the law allows, ${OPERATOR} is not liable for any loss arising from use of the service.</p>
<h2>Governing law</h2>
<p>The laws of the State of Colorado govern these terms.</p>`,
  );
}
