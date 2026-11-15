// SPDX-License-Identifier: Apache-2.0
// Track pages: the control panels under the story stepper, drawn by viz/control.ts from the model in
// viz/control-layout.ts. The drawing module loads on demand (R20); a step chosen before it arrives is drawn when
// it does. Cites open the exhibit pane like every other cite on the page.
import type { ServedCite } from './matter-api.ts';
import { citeRow, citeText } from './track-dom.ts';
import type { ControlModel, ControlStep } from './viz/control-layout.ts';
import type { ControlHandle } from './viz/control.ts';

/** The control panel's view: it shows the ties at a given step. */
export interface ControlView {
  /** Shows the ties at step `index`. */
  show(index: number): void;
}

/** Mounts the panels for `model` in `container`; they draw once the module loads. */
export function mountControl(container: HTMLElement, model: ControlModel<ServedCite>, steps: readonly ControlStep[], title: string): ControlView {
  let handle: ControlHandle | null = null;
  let pending = 0;
  import('./viz/control.ts')
    .then(({ renderControl }) => {
      handle = renderControl<ServedCite>(container, model, steps, {
        title,
        cites: (cites, parent, label) => void citeRow(cites, parent, label),
        citeText,
      });
      handle.show(pending);
    })
    .catch(() => {
      const line = document.createElement('p');
      line.className = 'track-control-failed';
      line.textContent = 'The picture could not load; reload the page to try again.';
      container.replaceChildren(line);
    });
  return {
    show(index) {
      pending = index;
      handle?.show(index);
    },
  };
}
