// SPDX-License-Identifier: Apache-2.0
// The pages about a case, which a room with no matter redirects to its Overview (room-shape.ts). Its own module with no
// Workers types, so the build's audit (scripts/dist-company.ts) skips the same pages the room never serves.

/** The pages about a case. Redirected temporarily, since the same room may get a matter later. */
export const CASE_PAGE = /^\/(?:complaint|regulator|chronology|people|claims|binder|visual)(?:\/|$)/;
