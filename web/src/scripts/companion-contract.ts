// SPDX-License-Identifier: Apache-2.0
// Card D3, plan PR-L2. The Ask companion's contract, shared by the Rive rig (rigged in the Rive editor and built
// in the owner's art repository, copied in as src/assets/legallas/legallas-companion.riv), its fallback stills
// (src/assets/legallas/states/<state>.webp, one per state) and the runtime loader (companion-rive.ts). Pure data and
// pure functions only, no DOM, so node:test pins the names, the faces and the state reducer.

/** What the companion shows. Every state mirrors something real in the Ask exchange; nothing runs on a timer. */
export const COMPANION_STATES = ['hello', 'idle', 'listening', 'reading', 'speaking', 'citing', 'unknown', 'error'] as const;
/** A state the companion can be in. */
export type CompanionState = (typeof COMPANION_STATES)[number];

/** The names the .riv must use. The rig carries them and the loader refuses a file without them. */
export const RIVE_NAMES = {
  artboard: 'Companion',
  stateMachine: 'Companion',
  viewModel: 'Companion',
  stateEnum: 'CompanionState',
  inputs: { state: 'state', docs: 'docs', lookX: 'lookX', lookY: 'lookY', quiet: 'quiet' },
} as const;

/** The most sheets of paper the rig holds; more documents still show five. */
export const MAX_SHEETS = 5;

/** The brow positions the companion's face can take. */
export const BROWS = ['level', 'raised', 'knit', 'askew'] as const;
/** The eye positions the companion's face can take. */
export const EYES = ['open', 'soft', 'down'] as const;
/** The mouth shapes the companion's face can take. */
export const MOUTHS = ['rest', 'smile', 'open', 'round', 'flat', 'tight'] as const;
/** A brow position of the companion's face. */
export type Brows = (typeof BROWS)[number];
/** An eye position of the companion's face. */
export type Eyes = (typeof EYES)[number];
/** A mouth shape of the companion's face. */
export type Mouth = (typeof MOUTHS)[number];
/** Hands: none at rest; raised only to greet (hello); open, palm up and low, only for "not in the record". */
export const HANDS = ['none', 'raised', 'open'] as const;
/** A hand position of the companion. */
export type Hand = (typeof HANDS)[number];

/** The companion's face: its brows, eyes and mouth. */
export interface Face {
  brows: Brows;
  eyes: Eyes;
  mouth: Mouth;
  /** A raised palm reads as an oath or "stop" in a courtroom, so it is the greeting only. */
  hand: Hand;
  /** The papers held at the chest; how many sheets show follows the docs count. */
  papers: boolean;
}

/** The single source for every expression: the rig's pose keys and the stills (one rendered per state) follow it. */
export const FACES: Record<CompanionState, Face> = {
  hello: { brows: 'raised', eyes: 'soft', mouth: 'smile', hand: 'raised', papers: false },
  idle: { brows: 'level', eyes: 'open', mouth: 'rest', hand: 'none', papers: false },
  listening: { brows: 'raised', eyes: 'open', mouth: 'rest', hand: 'none', papers: false },
  reading: { brows: 'knit', eyes: 'down', mouth: 'rest', hand: 'none', papers: true },
  speaking: { brows: 'level', eyes: 'open', mouth: 'open', hand: 'none', papers: false },
  citing: { brows: 'raised', eyes: 'down', mouth: 'smile', hand: 'none', papers: true },
  unknown: { brows: 'askew', eyes: 'open', mouth: 'flat', hand: 'open', papers: false },
  error: { brows: 'knit', eyes: 'open', mouth: 'tight', hand: 'none', papers: false },
};

/** The mouths Rive cycles through while speaking (its own layer, so Quiet stops it on the first). */
export const TALK_MOUTHS: readonly Mouth[] = ['open', 'rest', 'round', 'rest'];

/** Every pose name the rig keys: one solo per brow, eye and mouth, the two hands and the papers. */
export const POSE_NAMES: readonly string[] = [
  ...BROWS.map((b) => `brows-${b}`),
  ...EYES.map((e) => `eyes-${e}`),
  ...MOUTHS.map((m) => `mouth-${m}`),
  'hand-raised',
  'hand-open',
  'papers',
];

/** Whether a value is one of the companion states. */
export function isCompanionState(value: unknown): value is CompanionState {
  return typeof value === 'string' && (COMPANION_STATES as readonly string[]).includes(value);
}

/** The pose names shown in a state. A part is visible when any of its names is in this list. */
export function variantsFor(state: CompanionState): string[] {
  const face = FACES[state];
  return [
    `brows-${face.brows}`,
    `eyes-${face.eyes}`,
    `mouth-${face.mouth}`,
    ...(face.hand === 'none' ? [] : [`hand-${face.hand}`]),
    ...(face.papers ? ['papers'] : []),
  ];
}

/** Sheets of paper for a docs count: whole, from 0 to MAX_SHEETS. Anything that is not a number is 0. */
export function sheetsFor(docs: number): number {
  if (!Number.isFinite(docs)) return docs === Infinity ? MAX_SHEETS : 0;
  return Math.min(MAX_SHEETS, Math.max(0, Math.floor(docs)));
}

/**
 * The states a brand pack draws, given the file names in its states/ folder: every state, or none for a pack with no
 * companion. Some but not all is a mistake, and stops the build.
 */
export function drawnStates(files: ReadonlySet<string>): readonly CompanionState[] {
  if (files.size === 0) return [];
  for (const state of COMPANION_STATES) {
    if (!files.has(`${state}.webp`)) throw new Error(`the brand pack has no states/${state}.webp: every companion state needs a still, or none of them`);
  }
  return COMPANION_STATES;
}

/**
 * Whether the page should load the Rive rig over the stills: only once the rig is ready (companion-rive.ts,
 * RIG_READY), while the companion is mounted and the reader allows motion. Otherwise the stills stay.
 */
export function wantsRig(rigReady: boolean, gone: boolean, reducedMotion: boolean): boolean {
  return rigReady && !gone && !reducedMotion;
}

/** Gaze from -1 to 1 on each axis; anything that is not a finite number looks straight out. */
export function clampLook(x: number, y: number): { x: number; y: number } {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(-1, v)) : 0);
  return { x: clamp(x), y: clamp(y) };
}

/**
 * The Ask exchange as the companion sees it. `under` is the state beneath any cite overlay, `busy` is
 * true while a question is in flight, `docs` counts the documents read for it, and `citing` is true
 * while a cite chip has focus (it overlays whatever is under it).
 */
export interface CompanionModel {
  under: Exclude<CompanionState, 'citing'>;
  docs: number;
  busy: boolean;
  citing: boolean;
}

/** The events the companion's reducer takes. */
export type CompanionEvent =
  /** The greeting has been seen; hello settles to idle. */
  | { type: 'greeted' }
  /** The question box gained text or focus (true), or was emptied or left (false). */
  | { type: 'typing'; active: boolean }
  /** A question was sent: retrieval starts. */
  | { type: 'send' }
  /** The server reported how many documents it is reading. */
  | { type: 'docs'; count: number }
  /** A streamed piece of the answer arrived. */
  | { type: 'delta' }
  /** The answer finished; `dontKnow` is the server's verdict that the record does not answer it. */
  | { type: 'done'; dontKnow: boolean }
  /** The request failed. */
  | { type: 'error' }
  /** A cite chip gained (true) or lost (false) focus or hover. */
  | { type: 'cite'; focused: boolean }
  // The page guide's events (guide.ts, from guide-bus.ts). Each answers something the reader did on the page,
  // moves the state beneath and lifts any cite overlay; while a question is in flight they change nothing.
  /** The reader's first pointer or keyboard activity this session: the greeting. */
  | { type: 'hello' }
  /** The reader pointed at a card, tile or event (the gaze is the caller's): listening. */
  | { type: 'look' }
  /** The reader opened an event, entity or profile: reading. */
  | { type: 'open' }
  /** The reader focused a gap, a point not yet in the record: unknown. */
  | { type: 'gap' }
  /** The reader moved on: idle. */
  | { type: 'rest' };

/** The state beneath for each guide event. */
const GUIDE_UNDER = { hello: 'hello', look: 'listening', open: 'reading', gap: 'unknown', rest: 'idle' } as const;

/** The companion's starting model: it opens on hello, with no documents and nothing busy. */
export const INITIAL_MODEL: CompanionModel = { under: 'hello', docs: 0, busy: false, citing: false };

/** The page guide starts at rest; hello waits for the reader's first activity (no entrance motion). */
export const GUIDE_INITIAL_MODEL: CompanionModel = { under: 'idle', docs: 0, busy: false, citing: false };

/** What the companion shows for a model: the cite overlay wins over everything beneath it. */
export function stateOf(model: CompanionModel): CompanionState {
  return model.citing ? 'citing' : model.under;
}

/**
 * The pure state step. Stale events (a delta or a verdict with nothing in flight, typing while an
 * answer streams) return the same model object, so callers can skip a redraw with `===`.
 */
export function reduce(model: CompanionModel, event: CompanionEvent): CompanionModel {
  switch (event.type) {
    case 'greeted':
      return model.under === 'hello' ? { ...model, under: 'idle' } : model;
    case 'typing': {
      if (model.busy) return model;
      if (event.active) return model.under === 'listening' ? model : { ...model, under: 'listening' };
      return model.under === 'listening' ? { ...model, under: 'idle' } : model;
    }
    case 'send':
      return { under: 'reading', docs: 0, busy: true, citing: false };
    case 'docs': {
      if (!model.busy) return model;
      const docs = Number.isFinite(event.count) ? Math.max(0, Math.floor(event.count)) : model.docs;
      return docs === model.docs ? model : { ...model, docs };
    }
    case 'delta':
      if (!model.busy) return model;
      return model.under === 'speaking' ? model : { ...model, under: 'speaking' };
    case 'done':
      if (!model.busy) return model;
      return { ...model, under: event.dontKnow ? 'unknown' : 'idle', busy: false };
    case 'error':
      return { ...model, under: 'error', busy: false, citing: false };
    case 'cite':
      return model.citing === event.focused ? model : { ...model, citing: event.focused };
    case 'hello':
    case 'look':
    case 'open':
    case 'gap':
    case 'rest': {
      const under = GUIDE_UNDER[event.type];
      if (model.busy || (model.under === under && !model.citing)) return model;
      return { ...model, under, citing: false };
    }
    default:
      return model;
  }
}
