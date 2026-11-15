// SPDX-License-Identifier: Apache-2.0
// The real risks, the reviewed list (PLAN.md, "Ideal state"). Each names the risky functions only, the tests that should
// prove them, and planted breaks: the one change per risk that would do the most harm. A risk is proven when every
// planted break fails at least one of its tests. Paths are from the repository root.
//
// Sources: SECURITY.md, docs/product.md ("How it's built", "Rooms and access"), and the owner's sync rule that nothing in
// the folder is ever changed.

export interface Break {
  file: string;
  /** Exact text that must occur once in `file`. Empty with a file that does not exist: `replace` becomes a new file. */
  find: string;
  replace: string;
}

export interface Risk {
  id: string;
  /** File to the names of its risky functions. Mutants are made inside these only. */
  code: Record<string, readonly string[]>;
  tests: readonly string[];
  breaks: readonly Break[];
}

export const RISKS: readonly Risk[] = [
  {
    // Only a signed-in member gets in, a write comes from the room's own page, and every answer carries the
    // security headers (SECURITY.md).
    id: 'room_gate',
    code: {
      'web/worker/auth.ts': ['verifyAccessIdentity', 'findMember'],
      'web/worker/http.ts': ['isSameOriginWrite', 'isAllowedDocumentRead'],
      'web/worker/headers.ts': ['withSecurityHeaders'],
      'web/worker/room.ts': ['handle'],
    },
    tests: [
      'web/worker/auth.test.ts',
      'web/worker/headers.test.ts',
      'web/worker/index.test.ts',
      'web/worker/signins.test.ts',
      'web/worker/comments.test.ts',
      // Document reads from another site are refused (isAllowedDocumentRead).
      'web/worker/files-routes.test.ts',
      // The gate's other doors in handle: a service token reaches only sync, a sign-in with no second factor reaches
      // nothing, a guest only their room, and a member nothing before the notice tick.
      'web/worker/sync-gate.test.ts',
      'web/worker/mfa.test.ts',
      'web/worker/rooms-access.test.ts',
      'web/worker/notice-gate.test.ts',
    ],
    breaks: [
      { file: 'web/worker/auth.ts', find: 'audience: audiences,', replace: '' },
      {
        file: 'web/worker/http.ts',
        find: "return request.headers.get('Origin') === expected && request.headers.get('Sec-Fetch-Site') === 'same-origin';",
        replace: 'return true;',
      },
    ],
  },
  {
    // Each role and guest sees only what it may: privileged folders stay with owner and counsel, an investor sees only
    // the room's folders (docs/product.md "Privilege guard").
    id: 'who_sees_what',
    code: {
      'web/worker/auth.ts': ['isRole', 'canPerform'],
      'web/worker/privilege.ts': ['isPrivilegedPath', 'canSeeDocument', 'privilegeFilter'],
      'web/worker/rooms.ts': ['isRoomRole', 'canInRoom', 'findRoomGuest', 'privilegedMarks', 'ruleFor', 'listRoomDocuments', 'findRoomDocument'],
    },
    tests: [
      'web/worker/privilege.test.ts',
      'web/worker/rooms.test.ts',
      'web/worker/rooms-access.test.ts',
      'web/worker/members-roles.test.ts',
      'web/worker/comments-privilege.test.ts',
      'web/mcp/tools/documents-privilege.test.ts',
      // The role matrix, the proof of canPerform.
      'web/worker/auth.test.ts',
      // A guest's AI sees only its rooms' documents, never a privileged one (canSeeDocument, privilegeFilter).
      'web/mcp/rooms-ai.test.ts',
      // Counsel in a matter room see its documents, privileged included (ruleFor's first branch).
      'web/worker/rooms-matter.test.ts',
    ],
    breaks: [
      {
        file: 'web/worker/rooms.ts',
        find: 'seen: (row) => !isPrivilegedPath(row.path) && !isAgentFile(row.path) && !marks.has(row.id.toLowerCase())',
        replace: 'seen: (row) => !isAgentFile(row.path)',
      },
      { file: 'web/worker/rooms.ts', find: '`g.revoked_at IS NULL AND ', replace: '`' },
    ],
  },
  {
    // A cite links to the page that says it: unknown ids and impossible pages are dropped, and the quote comes from
    // that page (docs/product.md "Built-in Ask with verified cites").
    id: 'cites_right_page',
    code: {
      'web/worker/citations.ts': ['citedRefs', 'pageFits', 'validateCitations', 'citeCarriers', 'pinpointQuote'],
      'web/worker/cite-book.ts': ['passagePages', 'citeBook', 'restoreCites'],
    },
    tests: ['web/worker/citations.test.ts', 'web/worker/cite-book.test.ts', 'web/worker/pinpoint.test.ts', 'web/worker/prompt-cites.test.ts'],
    breaks: [{ file: 'web/worker/citations.ts', find: ' || (pages && !pages.allows(ref.id, ref.page))', replace: '' }],
  },
  {
    // Sync changes nothing in the owner's folder: the walk follows no link out of it, originals are only read, a
    // change mid-sync stops the run, and a pulled file never replaces one already there (docs/product.md "Sync").
    id: 'sync_changes_nothing',
    code: {
      'web/scripts/guard.ts': ['isPrivateSegment', 'isBundleName', 'hasAliasMagic', 'hasAliasFlag', 'isInside', 'checkFile', 'walkDir', 'guardWalk'],
      'web/scripts/snapshot.ts': ['createSnapshot', 'verifyOriginals'],
      'web/scripts/pull.ts': ['sanitizeFilename', 'placeExclusively', 'pullCounselUploads'],
    },
    tests: ['web/scripts/guard.test.ts', 'web/scripts/snapshot.test.ts', 'web/scripts/pull.test.ts', 'web/scripts/sync-windows.test.ts'],
    breaks: [
      { file: 'web/scripts/guard.ts', find: "return ['NFC', 'NFKC'].some((form) => name.normalize(form).toLowerCase().includes(PRIVATE_MARK));", replace: 'return false;' },
      { file: 'web/scripts/snapshot.ts', find: 'if (changed.length > 0) throw new MidSyncChange(changed.sort());', replace: '' },
      {
        file: 'web/scripts/pull.ts',
        find: 'while (!(await placeExclusively(partial, path.join(inboxDir, sanitizeFilename(row.name, taken))))) {',
        replace: 'const destination = path.join(inboxDir, sanitizeFilename(row.name, new Set()));\n      await rm(destination, { force: true });\n      while (!(await placeExclusively(partial, destination))) {',
      },
    ],
  },
  {
    // A migration never drops, renames or rewrites, and one already applied never changes.
    id: 'safe_migrations',
    code: {},
    tests: ['web/worker/migrations.test.ts'],
    breaks: [
      { file: 'web/migrations/9999_planted.sql', find: '', replace: 'ALTER TABLE members DROP COLUMN name;\n' },
      {
        file: 'web/migrations/0014_record_checks.sql',
        find: 'CREATE INDEX record_checks_expiry ON record_checks (expires_at);',
        replace: 'CREATE INDEX record_checks_expiry ON record_checks (expires_at, email);',
      },
    ],
  },
  {
    // The PII guard stops a document carrying a Social Security number before it leaves the laptop (docs/product.md
    // "folder sync + PII guard").
    id: 'pii_guard',
    code: {
      'web/scripts/pii.ts': ['issuable', 'inUrlEscape', 'ssnFormHits', 'hasSsnForm', 'nineDigitRuns', 'labelEnds', 'placeholder', 'labelledHits', 'findPii', 'findPiiSync'],
      'web/scripts/pii-scan.ts': ['scanForPii', 'piiGate', 'piiRefusal'],
    },
    tests: ['web/scripts/pii.test.ts', 'web/scripts/pii-scan.test.ts', 'web/scripts/pii-fixture.test.ts'],
    breaks: [{ file: 'web/scripts/pii-scan.ts', find: 'open: rest.filter((doc) => !allowed.has(doc.sha256)),', replace: 'open: [],' }],
  },
  {
    // The spend guard is the only stop on Cloudflare's bill: nothing reserves past the month's limit (docs/product.md
    // "Customer costs").
    id: 'spend_guard',
    code: {
      'web/worker/spend.ts': ['amountOf', 'reserve', 'adjust', 'shortMeter', 'meteredAi', 'meteredSearch', 'withSpendGuards'],
      'web/worker/budget.ts': ['paidNeuronsOfDay', 'paidBefore', 'neuronLimit', 'periodOf', 'limitOf', 'scriptRoom', 'worstCaseNeurons'],
      'web/scripts/spend-guard.ts': ['reserveSql', 'holdIngestion'],
    },
    tests: ['web/worker/spend.test.ts', 'web/worker/budget.test.ts', 'web/worker/ask-spend.test.ts', 'web/scripts/spend-guard.test.ts'],
    breaks: [{ file: 'web/worker/spend.ts', find: "'ON CONFLICT (meter, period) DO UPDATE SET used = used + ?3 WHERE used + ?3 <= ?4 ' +", replace: "'ON CONFLICT (meter, period) DO UPDATE SET used = used + ?3 ' +" }],
  },
  {
    // The connector reads only and checks membership on every call. Its one write is a pending proposal, listed only
    // where the member allowed it, and only that member approves it, in the room (SECURITY.md). A consent's code goes
    // only to the member and browser that gave it, a repeat click included.
    id: 'connector_contract',
    code: {
      'web/mcp/server.ts': ['listsRecords', 'listsPropose', 'callerOf', 'runTool', 'buildServer'],
      'web/mcp/authorize.ts': ['requireMember', 'mayPropose', 'proposeKinds', 'approve', 'submitConsent'],
      'web/worker/proposal-review.ts': ['seesAllProposals', 'visibleTo', 'decides', 'findVisible', 'approveProposal'],
      'web/mcp/consent-repeat.ts': ['timingSafeEqual', 'readCookie', 'boundCookie', 'rememberConsentDone', 'readDone', 'findConsentDone'],
    },
    tests: [
      'web/mcp/server.test.ts',
      'web/mcp/authorize.test.ts',
      'web/mcp/authorize-propose.test.ts',
      'web/mcp/tools/privilege.test.ts',
      'web/mcp/burst.test.ts',
      'web/worker/proposals.test.ts',
      'web/worker/proposals-routes.test.ts',
      'web/mcp/consent-repeat.test.ts',
    ],
    breaks: [
      { file: 'web/mcp/server.ts', find: "return proposalsEnabled(env) && props.propose === true && roleCan(props.role, 'propose');", replace: 'return true;' },
      {
        file: 'web/mcp/server.ts',
        find: 'const member = await findMember(env.DB, email);',
        replace: "const member = { email, role: 'owner' as const, name: null };",
      },
      // A member who isn't the owner sees every member's proposals, as only the owner may.
      { file: 'web/worker/proposal-review.ts', find: ": 'p.proposed_by = ?1'}", replace: ": '?1 IS NOT NULL'}" },
    ],
  },
];
