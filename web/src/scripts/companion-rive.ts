// SPDX-License-Identifier: Apache-2.0
// Card D3, plan PR-L2. The companion in the page: the rig's stills at once (LegallasStills.astro, one raster per
// state), then the Rive rig on top when motion is allowed. The Rive runtime is imported on demand, so with reduced
// motion the page never fetches the runtime, its wasm or the .riv; any load failure keeps the stills.
//
// Security: the wasm, the .riv and the stills are self-hosted build assets. The runtime's CDN wasm fallback is off
// (connect-src 'self' would block it too), Rive's asset CDN is off, and Rive events never open URLs. The only file
// ever loaded is the one the build emitted; callers cannot pass their own. Callers pass data only (a state from a
// fixed list, numbers, a boolean), checked here.
import type { Rive } from '@rive-app/canvas';
import { RIVE_NAMES, clampLook, isCompanionState, sheetsFor, wantsRig, type CompanionState } from './companion-contract.ts';

// The rig is the brand pack's one .riv (@brand, astro.config.mjs), whatever its name. Only its URL is imported; the file is fetched on demand like before. A pack with no rig or
// several is a load failure like any other (loadRive rejects), so the stills stay; companion-contract.test.ts fails
// such a pack first.
const rigs = Object.values(import.meta.glob<string>('@brand/*.riv', { eager: true, query: '?url', import: 'default' }));
const rivUrl: string | null = rigs.length === 1 ? rigs[0] : null;

/** Whether the brand pack has its one rig, fixed by the build (astro.config.mjs). Unset (tests) counts as yes. */
declare const BRAND_HAS_RIG: boolean | undefined;
/**
 * The runtime and its wasm, imported on demand. A build whose pack has no rig writes `false` here, so the bundler drops
 * both and the release carries neither (about 1 MB gzipped) for a file that could never load.
 */
const runtime =
  typeof BRAND_HAS_RIG === 'boolean' && !BRAND_HAS_RIG
    ? null
    : () => Promise.all([import('@rive-app/canvas'), import('@rive-app/canvas/rive.wasm?url')]);

/**
 * The gate for the Rive rig. True since Lane D's companion rig landed in src/assets/legallas/legallas-companion.riv
 * with the stills rendered from the same rig, so the canvas and the
 * still under it are one drawing. Set it to false only if the committed .riv and the stills ever come from different
 * drawings again: the stills then show everywhere and the runtime, its wasm and the .riv are never fetched.
 */
export const RIG_READY = true;

/** What the page drives. Every call is cheap and safe before, during and after the Rive load. */
export interface Companion {
  /** Returns false (and changes nothing) for anything that is not a companion state. */
  setState(state: CompanionState): boolean;
  setDocs(count: number): void;
  /** Gaze from -1 to 1 on each axis; ignored under Quiet and reduced motion, and by the stills. */
  look(x: number, y: number): void;
  /** Quiet keeps the expressions but stops idle life, the talking mouth, eye scanning and the gaze. */
  setQuiet(on: boolean): void;
  destroy(): void;
  /** Which renderer is showing once loading settles. */
  readonly ready: Promise<'rive' | 'still'>;
}

/** How long the box must hold still before the drawing surface is resized to match it. */
const SETTLE_MS = 120;

interface View {
  state: CompanionState;
  docs: number;
  look: { x: number; y: number };
  quiet: boolean;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)');

/**
 * The stills: one <picture data-still> per state, all but one hidden. A still is shown only once its image has
 * loaded, so a state change never flashes an empty window; the latest state wins, and a still that fails to load
 * leaves the one before it showing.
 */
class Stills {
  private readonly pictures = new Map<string, HTMLElement>();
  private shown: HTMLElement | null = null;
  private wanted = '';

  constructor(host: HTMLElement) {
    for (const picture of host.querySelectorAll<HTMLElement>('picture[data-still]')) {
      this.pictures.set(picture.dataset.still ?? '', picture);
      if (!picture.hidden) this.shown = picture;
    }
  }

  show(state: CompanionState): void {
    const picture = this.pictures.get(state);
    this.wanted = state;
    if (!picture || picture === this.shown) return;
    const img = picture.querySelector('img');
    if (img) img.loading = 'eager';
    (img ? img.decode() : Promise.resolve()).then(
      () => {
        if (this.wanted !== state) return;
        if (this.shown) this.shown.hidden = true;
        picture.hidden = false;
        this.shown = picture;
      },
      () => {}, // The still before it stays.
    );
  }
}

interface RiveHandle {
  push(view: View): void;
  destroy(): void;
}

/** Binds the loaded file to the view; throws when the file does not match the contract. */
function bindRive(rive: Rive, canvas: HTMLCanvasElement, host: HTMLElement): RiveHandle {
  const names = RIVE_NAMES.inputs;
  const vm = rive.viewModelInstance;
  const state = vm?.enum(names.state);
  const docs = vm?.number(names.docs);
  const lookX = vm?.number(names.lookX);
  const lookY = vm?.number(names.lookY);
  const quiet = vm?.boolean(names.quiet);
  if (!state || !docs || !lookX || !lookY || !quiet) throw new Error('legallas-companion.riv does not match the contract');

  // Resizing clears the surface, so it waits for the size to settle, then draws again at once.
  let visible = true;
  const fit = () => {
    rive.resizeDrawingSurfaceToCanvas();
    rive.drawFrame();
    if (!visible) rive.stopRendering();
  };
  fit();
  let settle = 0;
  const resize = new ResizeObserver(() => {
    clearTimeout(settle);
    settle = window.setTimeout(fit, SETTLE_MS);
  });
  resize.observe(canvas);
  // Rendering stops while he is out of view and resumes, state intact, when he comes back.
  const seen = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? visible;
    if (visible) rive.startRendering();
    else rive.stopRendering();
  });
  seen.observe(host);

  return {
    push(view) {
      if (state.values.includes(view.state)) state.value = view.state;
      docs.value = sheetsFor(view.docs);
      quiet.value = view.quiet;
      const gaze = view.quiet ? { x: 0, y: 0 } : view.look;
      lookX.value = gaze.x;
      lookY.value = gaze.y;
    },
    destroy() {
      clearTimeout(settle);
      resize.disconnect();
      seen.disconnect();
      rive.cleanup();
      canvas.remove();
    },
  };
}

/** Loads the runtime and the file; resolves once it matches the contract, rejects (and cleans up) otherwise. */
async function loadRive(host: HTMLElement): Promise<RiveHandle> {
  if (rivUrl === null) throw new Error(`the brand pack needs exactly one .riv rig, found ${rigs.length}`);
  if (runtime === null) throw new Error('this build ships no Rive runtime');
  const [{ Alignment, Fit, Layout, Rive: RiveCtor, RuntimeLoader }, { default: wasmUrl }] = await runtime();
  // Must run before any Rive instance exists: the defaults point at unpkg and jsdelivr.
  RuntimeLoader.setWasmUrl(wasmUrl);
  RuntimeLoader.setWasmFallbackUrl(null);
  await RuntimeLoader.awaitInstance();
  const canvas = document.createElement('canvas');
  canvas.className = 'companion-canvas';
  // Decorative like the stills it covers; the companion's state is the text beside it.
  canvas.setAttribute('aria-hidden', 'true');
  for (const [k, v] of [['display', 'block'], ['width', '100%'], ['height', '100%']]) canvas.style.setProperty(k, v);
  host.append(canvas);
  return new Promise((resolve, reject) => {
    let rive: Rive | undefined;
    const fail = (error: unknown) => {
      rive?.cleanup();
      canvas.remove();
      reject(error instanceof Error ? error : new Error('the companion rig failed to load'));
    };
    try {
      rive = new RiveCtor({
        src: rivUrl,
        canvas,
        artboard: RIVE_NAMES.artboard,
        stateMachine: RIVE_NAMES.stateMachine,
        autoplay: true,
        autoBind: true,
        layout: new Layout({ fit: Fit.Contain, alignment: Alignment.BottomCenter }),
        enableRiveAssetCDN: false,
        automaticallyHandleEvents: false,
        isTouchScrollEnabled: true,
        onLoad: () => {
          try {
            resolve(bindRive(rive as Rive, canvas, host));
          } catch (error) {
            fail(error);
          }
        },
        onLoadError: fail,
      });
    } catch (error) {
      fail(error);
    }
  });
}

/** One mounted companion: the stills always, Rive on top while motion is allowed and the file loads. */
class Mounted {
  readonly view: View = { state: 'idle', docs: 0, look: { x: 0, y: 0 }, quiet: false };
  readonly motion = reducedMotion();
  readonly stills: Stills;
  rive: RiveHandle | null = null;
  loading: Promise<'rive' | 'still'> | null = null;
  gone = false;
  readonly onMotion = () => {
    if (this.motion.matches) this.dropRive();
    else if (!this.rive && !this.still) void this.upgrade();
    this.render();
  };

  constructor(readonly host: HTMLElement) {
    this.stills = new Stills(host);
    this.motion.addEventListener('change', this.onMotion);
  }

  /** Rive is wanted only once the rig is ready, while the companion is mounted and motion is allowed. */
  get still(): boolean {
    return !wantsRig(RIG_READY, this.gone, this.motion.matches);
  }

  render(): void {
    if (this.gone) return;
    this.host.dataset.companionState = this.view.state;
    // Under the rig the stills are covered (companion.css), so none is fetched for a state change.
    if (this.rive) this.rive.push(this.view);
    else this.stills.show(this.view.state);
  }

  /** companion.css hides the stills under data-renderer="rive". */
  setRenderer(renderer: 'rive' | 'still'): void {
    this.host.dataset.renderer = renderer;
  }

  dropRive(): void {
    this.rive?.destroy();
    this.rive = null;
    this.setRenderer('still');
  }

  /** Loads Rive once; a load that lands under reduced motion or after destroy is thrown away. */
  upgrade(): Promise<'rive' | 'still'> {
    this.loading ??= loadRive(this.host).then(
      (handle) => {
        this.loading = null;
        if (this.still) {
          handle.destroy();
          return 'still';
        }
        this.rive = handle;
        this.render();
        this.setRenderer('rive');
        return 'rive';
      },
      () => {
        this.loading = null;
        return 'still';
      },
    );
    return this.loading;
  }

  start(): Promise<'rive' | 'still'> {
    this.setRenderer('still');
    this.render();
    return this.still ? Promise.resolve('still') : this.upgrade();
  }

  destroy(): void {
    this.gone = true;
    this.motion.removeEventListener('change', this.onMotion);
    this.dropRive();
    delete this.host.dataset.renderer;
    delete this.host.dataset.companionState;
  }
}

/** Mounts the companion in `host` (which holds the stills) and returns its controls. */
export function mount(host: HTMLElement): Companion {
  const m = new Mounted(host);
  const { view } = m;
  return {
    ready: m.start(),
    setState(state) {
      if (!isCompanionState(state)) return false;
      view.state = state;
      m.render();
      return true;
    },
    setDocs(count) {
      // Kept as given; sheetsFor turns it into 0 to 5 sheets for the rig. The stills show a fixed handful.
      view.docs = typeof count === 'number' ? count : 0;
      m.render();
    },
    look(x, y) {
      view.look = clampLook(x, y);
      if (!view.quiet && !m.motion.matches) m.render();
    },
    setQuiet(on) {
      view.quiet = on === true;
      m.render();
    },
    destroy: () => m.destroy(),
  };
}
