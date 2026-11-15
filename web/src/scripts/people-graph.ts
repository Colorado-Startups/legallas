// SPDX-License-Identifier: Apache-2.0
// Card P3 (People). The page's graph: card F5b's force graph (viz/force.ts) of people and organizations placed by
// side, with money edges (promises dashed, movements solid), labels on the chosen party's ties and a dashed group
// around each organization and its members (R46). The page keeps its own Graph / Table toggle and table, so the chart frame's own head is hidden in
// people.css. Selection runs both ways: a node chosen in the graph opens the profile, and a profile opened from
// the table or the URL marks its node.
import type { ServedMatter } from './matter-api.ts';
import { renderForce, type ForceHandle } from './viz/force.ts';
import './viz/charts.css';

/** The people graph's handle: select a party, and show only some of the parties. */
export interface PeopleGraph {
  /** Marks a party as chosen (or none), without calling onSelect, and brings it into view. */
  select(id: string | null): void;
  /** Shows only these parties (the side chips and the search together); the rest and their edges leave the graph. */
  setVisible(ids: Set<string>): void;
  destroy(): void;
}

/** Options for the people graph: the matter, and a callback for a selection. */
export interface GraphOptions {
  matter: ServedMatter;
  onSelect(id: string | null): void;
}

/** Draws the force graph of people and orgs into the host and returns its handle. */
export function renderGraph(host: HTMLElement, opts: GraphOptions): PeopleGraph {
  host.replaceChildren();
  const { people, orgs, links, money } = opts.matter;
  const handle: ForceHandle = renderForce(host, people, orgs, links, {
    title: 'People and organizations by side',
    money,
    edgeLabels: 'selection',
    groups: true,
    frame: 'drawing',
    onSelect: opts.onSelect,
  });
  return {
    select: (id) => handle.select(id),
    setVisible: (ids) => handle.setVisible(ids),
    destroy: () => handle.destroy(),
  };
}
