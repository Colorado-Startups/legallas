// SPDX-License-Identifier: Apache-2.0
// The matter as the litigation pack's pages see it: GET /api/matter (worker/routes/matter.ts), with names for the
// served shapes they render. The fetch and the control-number and date formatters are core (doc-facts.ts) and are
// re-exported here, so a pack page imports one module.
import type { ServedMatter } from '../../worker/matter-types.ts';

export { controlPrefix, fetchMatter, formatCite, formatControl, formatPartialDate, MATTER_TIMEOUT_MS, pageMatter } from './doc-facts.ts';
export type {
  ClaimType, ContactRole, CountKind, DefinedTerm, EventType, OrgKind, PartialDate, ProofStrength, ServedCite, ServedDocFacts,
  ServedMatter, Side, TrackKind,
} from '../../worker/matter-types.ts';

/** The served shapes, named for the pages that render them. */
export type RoomEvent = ServedMatter['events'][number];
/** A person in the served matter. */
export type RoomPerson = ServedMatter['people'][number];
/** An org in the served matter. */
export type RoomOrg = ServedMatter['orgs'][number];
/** A link between two parties in the served matter. */
export type RoomLink = ServedMatter['links'][number];
/** A claim in the served matter. */
export type RoomClaim = ServedMatter['claims'][number];
/** A money entry in the served matter. */
export type RoomMoney = ServedMatter['money'][number];
/** A track in the served matter. */
export type RoomTrack = ServedMatter['tracks'][number];
/** One point of a track. */
export type RoomTrackPoint = RoomTrack['points'][number];
/** A track's brief and counts; absent on a track that has none. */
export type RoomTrackBrief = NonNullable<RoomTrack['brief']>;
/** One hurdle in a track's brief. */
export type RoomHurdle = RoomTrackBrief['hurdles'][number];
/** A draft linked from a track's brief. */
export type RoomDraftLink = RoomTrackBrief['drafts'][number];
/** A violation in the served matter. */
export type RoomViolation = ServedMatter['violations'][number];
/** One step in a violation's story. */
export type RoomViolationStep = RoomViolation['steps'][number];
/** One figure of a violation. */
export type RoomViolationFigure = RoomViolation['figures'][number];
