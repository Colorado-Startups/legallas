// SPDX-License-Identifier: Apache-2.0
// What every guest is told before they open anything, on the room's first page and in the invitation the owner sends
// (scripts/room.ts prints it after an invite). A recipient told the documents are confidential, and that each open is
// logged, is on notice: a reasonable measure to keep them secret (C.R.S. 7-74-102(4); 18 U.S.C. 1839(3)).
// "Opened" is the honest word for what the audit log records (docs/design/rooms-and-grants.md).

export const GUEST_NOTICE =
  'Confidential. These documents are shared with you only to review this company. Do not copy or pass them on. ' +
  'The room logs each document you open, with your email and the time, and the owner can see that log.';
