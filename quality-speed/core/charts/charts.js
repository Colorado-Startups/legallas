// SPDX-License-Identifier: Apache-2.0
// Chart kit behavior: tooltips, table sort and filter, Road to 100, timeline. Charts are whole without it; links drill
// down. No dependencies. Styles go through the CSSOM and text through textContent, so a strict CSP holds.

/** A score as shown, by the rule in core/score.ts: rounded down, and 100 only at goal. The tolerance is floating point noise. */
export function wholeScore(exact) {
  const whole = Math.floor(Math.round(exact * 1e6) / 1e6);
  return whole >= 100 && exact < 100 - 1e-9 ? 99 : whole;
}

/** Total score: (Q + S + C) / 3, a third each, shown the same way. A missing Consumption counts as 0, as in core/score.ts. */
export function totalOf(q, s, c = 0) {
  return wholeScore((q + s + (Number.isFinite(c) ? c : 0)) / 3);
}

/** The ring once a set of fixes is on. With none on it is the real score, untouched. */
export function roadState(base, fixes, onIds) {
  const on = fixes.filter((fix) => onIds.includes(fix.id));
  // An unmeasured page stays unmeasured: a fix tried on a missing score means nothing, so the ring stays red.
  const known = [base.q, base.s, base.total].every(Number.isFinite);
  const three = base.c !== undefined;
  const c0 = Number.isFinite(base.c) ? base.c : 0;
  if (on.length === 0 || !known) return { q: base.q, s: base.s, ...(three ? { c: base.c } : {}), total: base.total };
  const q = Math.min(100, on.reduce((sum, fix) => sum + fix.q, base.q));
  const s = Math.min(100, on.reduce((sum, fix) => sum + fix.s, base.s));
  const c = Math.min(100, on.reduce((sum, fix) => sum + (fix.c ?? 0), c0));
  const whole = totalOf(q, s, c);
  return { q, s, ...(three ? { c } : {}), total: whole };
}

/** Sort order for table cells: numbers as numbers, blanks last in either direction. */
export function compareCells(a, b, numeric, direction) {
  if (a === '' || b === '') return a === b ? 0 : a === '' ? 1 : -1;
  const order = numeric ? Number(a) - Number(b) : a.localeCompare(b);
  return direction === 'descending' ? -order : order;
}

/** Shares one load between callers, and forgets a failure so the next call tries again. */
export function shareLoad(load) {
  let pending = null;
  return () => {
    pending ??= load().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

const doc = globalThis.document;

/** Moves one ring. A score with any part that isn't a number reads as missing, whatever the caller thought it had. */
function setRing(fig, score) {
  const known = Boolean(score) && [score.q, score.s, score.total].every(Number.isFinite);
  const { q, s, total } = known ? score : { q: 0, s: 0, total: 0 };
  // A third ring is Consumption. A history row from before it, or one with no number, reads 0 there, never a gap.
  const third = Boolean(fig.querySelector('[data-arc="c"]'));
  const c = known && Number.isFinite(score.c) ? score.c : 0;
  for (const [kind, value] of [['q', q], ['s', s], ...(third ? [['c', c]] : [])]) {
    fig.querySelector(`[data-arc="${kind}"]`)?.setAttribute('stroke-dasharray', `${value} 100`);
    const shown = fig.querySelector(`[data-num="${kind}"]`);
    if (shown) shown.textContent = wholeScore(value);
  }
  fig.querySelector('[data-num="total"]').textContent = total;
  fig.classList.toggle('is-full', known && total >= 100);
  fig.classList.toggle('is-missing', !known);
  const name = fig.dataset.name ? `${fig.dataset.name}: ` : '';
  const said = known ? `total ${total} of 100. Quality ${wholeScore(q)}. Speed ${wholeScore(s)}.${third ? ` Consumption ${wholeScore(c)}.` : ''}` : 'no data, scores 0.';
  fig.querySelector('svg').setAttribute('aria-label', `${name}${said}`);
}

/** Moves every ring to a history row. A ring with no score in that row wasn't measured yet, so it reads as missing. */
export function replayRow(figs, row) {
  for (const fig of figs) {
    const score = row.rings[fig.dataset.qsRing];
    setRing(fig, score);
  }
}

/** The scores the page was built with, as a history row. A ring built as missing has none. */
export function builtRow(figs) {
  const rings = {};
  for (const fig of figs) {
    if (fig.classList.contains('is-missing')) continue;
    const arc = (kind) => parseFloat(fig.querySelector(`[data-arc="${kind}"]`).getAttribute('stroke-dasharray'));
    const total = Number(fig.querySelector('[data-num="total"]').textContent);
    const c = fig.querySelector('[data-arc="c"]') ? { c: arc('c') } : {};
    rings[fig.dataset.qsRing] = { q: arc('q'), s: arc('s'), ...c, total };
  }
  return { rings };
}

function initTooltips() {
  const tip = doc.createElement('div');
  tip.className = 'qs-tip';
  tip.hidden = true;
  const value = tip.appendChild(doc.createElement('strong'));
  const label = tip.appendChild(doc.createElement('span'));
  doc.body.append(tip);
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') tip.hidden = true;
  });
  doc.addEventListener('pointermove', (e) => {
    const mark = e.target.closest?.('[data-tv]');
    tip.hidden = !mark;
    if (!mark) return;
    value.textContent = mark.dataset.tv;
    label.textContent = mark.dataset.tl ?? '';
    const left = Math.max(8, Math.min(e.clientX + 12, doc.documentElement.clientWidth - tip.offsetWidth - 8));
    const top = Math.max(8, e.clientY - tip.offsetHeight - 12);
    tip.style.transform = `translate(${left + scrollX}px, ${top + scrollY}px)`;
  });
}

function initTables() {
  doc.addEventListener('click', (e) => {
    const button = e.target.closest?.('[data-qs-sort]');
    if (!button) return;
    const th = button.closest('th');
    const index = [...th.parentElement.children].indexOf(th);
    const direction = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
    for (const other of th.parentElement.children) other.removeAttribute('aria-sort');
    th.setAttribute('aria-sort', direction);
    const body = th.closest('table').tBodies[0];
    const raw = (row) => row.cells[index].dataset.v ?? row.cells[index].textContent;
    body.append(...[...body.rows].sort((a, b) => compareCells(raw(a), raw(b), button.dataset.type === 'num', direction)));
  });
  for (const input of doc.querySelectorAll('[data-qs-filter]')) {
    const box = input.closest('[data-qs-table]');
    input.closest('.qs-filter').hidden = false;
    input.addEventListener('input', () => {
      const needle = input.value.trim().toLowerCase();
      const rows = [...box.querySelectorAll('tbody tr')];
      for (const row of rows) row.hidden = !row.textContent.toLowerCase().includes(needle);
      box.querySelector('[data-qs-count]').textContent = `${rows.filter((row) => !row.hidden).length}/${rows.length}`;
    });
  }
}

function initRoad(road) {
  const data = JSON.parse(road.querySelector('script[type="application/json"]').textContent);
  const ring = road.querySelector('[data-qs-road-ring]');
  const said = road.querySelector('[data-road="said"]');
  const boxes = [...road.querySelectorAll('input[type="checkbox"]')];
  const update = () => {
    const on = boxes.filter((box) => box.checked).map((box) => box.value);
    const state = roadState(data.now, data.fixes, on);
    setRing(ring, state);
    said.textContent = Number.isFinite(state.total) ? `Total ${state.total} of 100` : 'No data, scores 0';
    for (const box of boxes) box.closest('li').classList.toggle('is-on', box.checked);
  };
  for (const box of boxes) {
    box.disabled = false;
    box.addEventListener('change', update);
  }
  update();
}

function initTimeline(line) {
  const range = line.querySelector('input[type="range"]');
  const rows = shareLoad(async () => {
    if (!line.dataset.src) return JSON.parse(line.querySelector('script[type="application/json"]').textContent);
    const res = await fetch(line.dataset.src);
    if (!res.ok) throw new Error(`Timeline history: ${res.status}`);
    return res.json();
  });
  const figs = [...doc.querySelectorAll('[data-qs-ring]')];
  const built = builtRow(figs);
  range.disabled = false;
  range.addEventListener('input', async () => {
    let row;
    try {
      row = (await rows())[Number(range.value)];
    } catch (error) {
      // The rings stay on the newest run, and the next drag tries again.
      console.error(error);
      return;
    }
    if (!row) return;
    // The newest position is what the page was built with, whatever the history holds.
    replayRow(figs, range.value === range.max ? built : row);
    line.querySelector('output').textContent = row.label;
    range.setAttribute('aria-valuetext', row.label);
  });
}

if (doc) {
  initTooltips();
  initTables();
  for (const road of doc.querySelectorAll('[data-qs-road]')) initRoad(road);
  for (const line of doc.querySelectorAll('[data-qs-timeline]')) initTimeline(line);
}
