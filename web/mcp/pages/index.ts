// SPDX-License-Identifier: Apache-2.0
// Server-rendered pages for legallas-mcp (owner: session A2), built to web/DESIGN.md with inline CSS: no
// external assets, no scripts. Every value may come from a client (names, hosts): escape all of it.
import type { ClientKind, ConnectionRow } from '../contract.ts';
import { renderConsentPage } from './consent.ts';
import { renderAdminClientsPage } from './admin.ts';
import { renderConnectionsPage } from './connections.ts';
import { renderPrivacyPage, renderTermsPage } from './legal.ts';
import { renderMessagePage } from './message.ts';

export { escapeHtml } from './html.ts';

export interface ConsentView {
  memberEmail: string;
  clientName: string;
  /** Set for a CIMD client: the verified domain to show prominently. */
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  /** The app as the server treats it on every tool call (mcp/server.ts resolveClientKind); only `claude` gets files. */
  clientKind: ClientKind;
  /** Posted back to /authorize (approveConsent / denyConsent). */
  handle: string;
  /**
   * True while the room's proposals or public-records checks are on and the member's role may propose: the page offers
   * the propose box.
   */
  offerPropose?: boolean;
  /** What the box covers: drafts (PROPOSALS_ENABLED), public-records checks (PUBLIC_RECORDS), or both. Drafts if unset. */
  proposes?: { drafts: boolean; records: boolean };
}

export interface ConnectionsView {
  memberEmail: string;
  isOwner: boolean;
  rows: ConnectionRow[];
  /** The forms.ts double-submit token for the Disconnect buttons. */
  formToken: string;
  notice?: string;
}

export interface AdminClientsView {
  clients: { clientId: string; clientName: string; redirectUris: string[]; registrationDate: number | null }[];
  /** Shown once, right after creation. */
  created?: { clientId: string; clientSecret: string; clientName: string };
  formToken: string;
  /** Which list is shown: clients created on this page ('static', the default) or every client ('all'). */
  list: 'static' | 'all';
  /** Set when more rows follow: the page links to `?list=<list>&cursor=<nextCursor>`. */
  nextCursor?: string | null;
}

export interface MessageView {
  title: string;
  message: string;
  status: number;
  /** Optional next steps, each shown as a link under the message. */
  links?: readonly { href: string; label: string }[];
}

/** "Connect <app> to the counsel room": the member, the app, the verified domain, the redirect host, approve or deny. */
export function renderConsent(view: ConsentView): string {
  return renderConsentPage(view);
}
/** The member's AI connections (every member's for the owner), each with a Disconnect button. */
export function renderConnections(view: ConnectionsView): string {
  return renderConnectionsPage(view);
}
/** The owner's registered clients, the create form and the one-time secret panel. */
export function renderAdminClients(view: AdminClientsView): string {
  return renderAdminClientsPage(view);
}
/** The public privacy notice (wording approved by the owner, D7). */
export function renderPrivacy(): string {
  return renderPrivacyPage();
}
/** The public terms of use (wording approved by the owner, D7). */
export function renderTerms(): string {
  return renderTermsPage();
}
/** A 403, 404 or error page. */
export function renderMessage(view: MessageView): string {
  return renderMessagePage(view);
}

/**
 * An HTML response with the page headers (CSP default-src 'none' plus inline style, no framing, no referrer).
 * No form-action directive: Chrome applies it to the redirect after a form post, and the consent form's POST
 * ends in a redirect to the client (claude.ai, teams.microsoft.com), which 'self' would block.
 */
export function htmlResponse(html: string, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'");
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status, headers });
}

/**
 * htmlResponse for a page that posts its own forms (/connections, /admin/clients). Under no-referrer a browser sends
 * a form POST's Origin as null even to this origin (Fetch, "append a request Origin header"), and checkForm refuses
 * null. same-origin keeps the real Origin on this origin's own posts and still sends nothing to any other site.
 */
export function formPageResponse(html: string, status = 200, extra?: HeadersInit): Response {
  const response = htmlResponse(html, status, extra);
  response.headers.set('referrer-policy', 'same-origin');
  return response;
}
