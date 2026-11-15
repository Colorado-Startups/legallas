// SPDX-License-Identifier: Apache-2.0
// The Worker entry for a room with pro: the room's fetch handler from index.ts (the core plus pro's routes), plus
// the research chat's Durable Object class, which the RESEARCH binding names. The class is exported here and never
// from index.ts: tests import index.ts under plain Node, where cloudflare:workers and the agents package do not load
// (worker/config.test.ts keeps it that way). A core-only room's entry is room.ts itself.
//
// ResearchAgent is the same class under its neutral name (Legallas plan, step 2). Nothing in this repo binds it and
// no migration names it, so a room on the older class name keeps it; a renamed_classes migration
// moves the binding to ResearchAgent at a room's first Legallas release, never here.
export { default } from './index.ts';
export { LegallasResearch, LegallasResearch as ResearchAgent } from './agent/research.ts';
