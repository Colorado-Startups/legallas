// SPDX-License-Identifier: Apache-2.0
// The page guide (plan PR 5b) in the browser: LegallasGuide.astro's band. It fills the briefing and orders from the
// matter, opens Ask with an order's question (never sends it), and reacts to what the reader does through the
// guide bus (guide-bus.ts) and the companion's reducer (companion-contract.ts):
//
//   look  -> gaze toward the point, listening     open  -> reading     cite -> citing
//   gap   -> unknown     error -> error     rest -> idle     first pointer or key this session -> hello
//
// Nothing happens on load (no entrance motion). The stills are plain images; companion-rive.ts is imported once the
// page has laid out and only while the bust is shown (not below 48rem), and it fetches Rive only when motion is allowed.
import { openAsk } from './ask-drawer.ts';
import { GUIDE_INITIAL_MODEL, reduce, stateOf, type CompanionEvent, type CompanionModel } from './companion-contract.ts';
import { readQuiet, writeQuiet } from './companion-quiet.ts';
import type { Companion } from './companion-rive.ts';
import { GUIDE_EVENT, type GuideEvent } from './guide-bus.ts';
import { briefingFor, guideValues, isGuidePage, type GuidePage, type GuideValues } from './guide-copy.ts';
import { pageMatter } from './matter-api.ts';

/** The room's stored name as a literal (worker/stored-name.ts): the minified key stays one, and a stored key can be read. */
declare const ROOM_STORED_NAME: string | undefined;

/** sessionStorage key: the greeting has been shown in this tab's session. */
const HELLO_KEY = `${typeof ROOM_STORED_NAME === 'string' ? ROOM_STORED_NAME : 'legallas'}-guide-hello`;
/** Pages whose own title fills {title} in the orders. */
const TITLED: ReadonlySet<GuidePage> = new Set(['doc', 'visual']);

interface Band {
  root: HTMLElement;
  page: GuidePage;
  art: HTMLElement | null;
  brief: HTMLElement | null;
  orders: HTMLElement | null;
  quiet: HTMLButtonElement | null;
}

let model: CompanionModel = GUIDE_INITIAL_MODEL;
let bust: Companion | null = null;
let mounting = false;
let gaze = { x: 0, y: 0 };

function find(): Band | null {
  const root = document.querySelector<HTMLElement>('[data-guide]');
  const page = root?.dataset.guide;
  if (!root || !isGuidePage(page)) return null;
  return {
    root,
    page,
    art: root.querySelector<HTMLElement>('[data-guide-art]'),
    brief: root.querySelector<HTMLElement>('[data-guide-brief]'),
    orders: root.querySelector<HTMLElement>('[data-guide-orders]'),
    quiet: root.querySelector<HTMLButtonElement>('[data-guide-quiet]'),
  };
}

function draw(band: Band): void {
  const state = stateOf(model);
  band.root.dataset.state = state;
  bust?.setState(state);
  bust?.look(gaze.x, gaze.y);
}

function send(band: Band, event: CompanionEvent): void {
  const next = reduce(model, event);
  if (next === model) return;
  model = next;
  draw(band);
}

/** A viewport point as gaze from -1 to 1, relative to the bust (eyes sit in its upper third). */
function aim(band: Band, x: number, y: number): { x: number; y: number } {
  const box = (band.art ?? band.root).getBoundingClientRect();
  return {
    x: (x - (box.left + box.width / 2)) / (window.innerWidth / 2),
    y: (y - (box.top + box.height / 3)) / (window.innerHeight / 2),
  };
}

/** Only the shapes the bus defines get through; anything else on the event is ignored. */
function react(band: Band, detail: unknown): void {
  const event = detail as Partial<GuideEvent> | null;
  switch (event?.type) {
    case 'look':
      if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
      gaze = aim(band, event.x as number, event.y as number);
      send(band, { type: 'look' });
      bust?.look(gaze.x, gaze.y);
      return;
    case 'open':
    case 'gap':
    case 'error':
    case 'rest':
      if (event.type === 'rest') gaze = { x: 0, y: 0 };
      send(band, { type: event.type });
      bust?.look(gaze.x, gaze.y);
      return;
    case 'cite':
      send(band, { type: 'cite', focused: true });
      return;
    default:
  }
}

/** hello on the reader's first pointer or key this session; never on load. Blocked storage means no greeting. */
function wireHello(band: Band): void {
  const kinds = ['pointerdown', 'pointermove', 'keydown'] as const;
  const greet = () => {
    for (const kind of kinds) window.removeEventListener(kind, greet, true);
    try {
      if (sessionStorage.getItem(HELLO_KEY)) return;
      sessionStorage.setItem(HELLO_KEY, '1');
    } catch {
      return;
    }
    send(band, { type: 'hello' });
  };
  for (const kind of kinds) window.addEventListener(kind, greet, { capture: true, passive: true });
}

function wireQuiet(band: Band): void {
  const apply = (quiet: boolean) => {
    band.quiet?.setAttribute('aria-pressed', String(quiet));
    bust?.setQuiet(quiet);
  };
  apply(readQuiet());
  band.quiet?.addEventListener('click', () => {
    const quiet = band.quiet?.getAttribute('aria-pressed') !== 'true';
    apply(quiet);
    writeQuiet(quiet);
  });
}

/** Mounts the bust once it is shown; on a phone the small Legallas stands in and nothing more loads. */
function mountWhenShown(band: Band): void {
  const art = band.art;
  if (!art) return;
  const shown = () => {
    if (bust || mounting || art.getClientRects().length === 0) return;
    mounting = true;
    void import('./companion-rive.ts').then(
      ({ mount }) => {
        bust = mount(art);
        bust.setQuiet(readQuiet());
        draw(band);
      },
      () => {
        mounting = false; // The stills stay as they are.
      },
    );
  };
  new ResizeObserver(shown).observe(art);
}

/*
  Layout shift (R89): the band is drawn with the generic sentence and filled once the matter answers, by which time
  the page has drawn below it. A filled sentence that wraps to another line count would move the orders and the
  whole page, so it is kept only when it takes the generic sentence's lines; otherwise the generic one stays, as it
  does with no matter.
*/
function fillBrief(band: Band, brief: string): void {
  const el = band.brief!;
  const before = el.getBoundingClientRect().height;
  const generic = el.textContent;
  el.textContent = brief;
  if (el.getBoundingClientRect().height !== before) el.textContent = generic;
}

function paint(band: Band, values: GuideValues): void {
  const { brief, orders } = briefingFor(band.page, values);
  if (band.brief && band.brief.textContent !== brief) fillBrief(band, brief);
  const list = band.orders;
  if (!list) return;
  const current = [...list.querySelectorAll<HTMLElement>('[data-guide-question]')].map((b) => `${b.textContent?.trim()}\n${b.dataset.guideQuestion}`);
  if (current.join('\n\n') === orders.map((o) => `${o.label}\n${o.question}`).join('\n\n')) return;
  list.replaceChildren(
    ...orders.map((order) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'c-button c-guide__order';
      button.dataset.guideQuestion = order.question;
      button.textContent = order.label;
      item.append(button);
      return item;
    }),
  );
}

/** Names and counts from the matter, once the page is idle; without one the generic text stays. */
async function fillFromMatter(band: Band): Promise<void> {
  const matter = await pageMatter().catch(() => null);
  const title = TITLED.has(band.page) ? document.querySelector('main h1')?.textContent ?? '' : '';
  paint(band, guideValues(matter, { title }));
}

/** Runs `work` after the page has laid out and gone idle, so the guide never competes with the page's own load. */
function afterLayout(work: () => void): void {
  // Safari has no requestIdleCallback; a short timeout after load stands in.
  const idle = () => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(work, { timeout: 2000 }) : setTimeout(work, 200));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

function start(): void {
  const band = find();
  if (!band) return;
  band.orders?.addEventListener('click', (event) => {
    const button = (event.target as Element | null)?.closest<HTMLElement>('[data-guide-question]');
    if (button?.dataset.guideQuestion) openAsk(button.dataset.guideQuestion, button);
  });
  window.addEventListener(GUIDE_EVENT, (event) => react(band, (event as CustomEvent<unknown>).detail));
  wireHello(band);
  wireQuiet(band);
  draw(band);
  afterLayout(() => {
    mountWhenShown(band);
    void fillFromMatter(band);
  });
}

start();
