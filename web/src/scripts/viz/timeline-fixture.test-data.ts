// SPDX-License-Identifier: Apache-2.0
// Card F5a (timeline viz). A fictional Doe v. Harbor Labs, Inc. chronology for the timeline tests and the
// scratch harness. No real matter content.
import type { EventType, MatterEvent } from '../../../worker/matter-types.ts';
import type { TimelineData } from './timeline-model.ts';

function event(id: string, date: string, type: EventType, actors: string[], title: string, claims: string[] = []): MatterEvent {
  return { id, date, title, summary: null, type, actors, claims, cites: [{ doc: `doc-${id}`, page: 1 }] };
}

/** Fictional timeline data for tests: people, orgs and events. */
export const DOE_DATA: TimelineData = {
  people: [
    { id: 'p-doe', name: 'Jane Doe', role: 'plaintiff', side: 'client', title: 'Owner', orgs: [], cites: [] },
    { id: 'p-roe', name: 'Richard Roe', role: 'defendant', side: 'defendant', title: 'Owner', orgs: ['o-company'], cites: [] },
    { id: 'p-clerk', name: 'Clerk of Court', role: 'courtStaff', side: 'court', title: null, orgs: ['o-court'], cites: [] },
    { id: 'p-tech', name: 'Pat Teller', role: 'witness', side: 'third', title: 'Repair technician', orgs: [], cites: [] },
  ],
  orgs: [
    { id: 'o-company', name: 'Roe Commissary, LLC', kind: 'company', side: 'nominal', parent: null, formed: null, cites: [] },
    { id: 'o-court', name: 'District Court', kind: 'court', side: 'court', parent: null, formed: null, cites: [] },
  ],
  events: [
    event('ev-01', '2011', 'milestone', ['o-company'], 'Roe Commissary opens its kitchen'),
    event('ev-02', '2011-04-04', 'communication', ['p-doe', 'p-roe'], 'Doe and Roe sign the supply agreement', ['count-1']),
    event('ev-03', '2012-02', 'communication', ['p-roe'], 'Roe confirms the spring delivery schedule', ['count-2']),
    event('ev-04', '2012-07-09', 'meeting', ['p-roe', 'p-tech'], 'Roe inspects the failed cooler', ['count-2', 'count-3']),
    event('ev-05', '2012-07-10', 'communication', ['p-tech'], 'The repair ticket is opened'),
    event('ev-06', '2012-07-11', 'communication', ['p-doe'], 'Doe asks for the temperature logs', ['count-1']),
    event('ev-07', '2013-03-01', 'pleading', ['p-doe'], 'Doe files the complaint', ['count-1', 'count-2', 'count-3']),
    event('ev-08', '2014-01-09', 'order', ['p-clerk'], 'The court sets the scheduling order'),
    event('ev-09', '2014-04', 'discovery', [], 'Records exchange begins'),
    event('ev-10', '2014-10-17', 'filing', ['p-roe'], 'Roe files an answer'),
    event('ev-bad', '2014-02-30', 'custom', ['p-doe'], 'A date that does not exist'),
  ],
};
