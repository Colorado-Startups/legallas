// SPDX-License-Identifier: Apache-2.0
// Draws the two app icons from the Legallas seal (web/DESIGN.md section 8: target rings, a center mark and an
// arrow fletched with leaves; geometry from src/assets/legallas/brand/seal.svg). Run it to rewrite the PNGs:
//   node connect/copilot/icons.ts
// Microsoft's rules: color.png is 192 x 192 in full color; outline.png is 32 x 32, white on transparent.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRgba } from './png.ts';

type Shape = (x: number, y: number) => boolean;

const ring = (r: number, width: number): Shape => (x, y) => Math.abs(Math.hypot(x - 24, y - 24) - r) <= width / 2;
const disc = (cx: number, cy: number, r: number): Shape => (x, y) => Math.hypot(x - cx, y - cy) <= r;

function capsule(x1: number, y1: number, x2: number, y2: number, width: number): Shape {
  return (x, y) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= width / 2;
  };
}

function triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): Shape {
  const side = (px: number, py: number, qx: number, qy: number, x: number, y: number) => (qx - px) * (y - py) - (qy - py) * (x - px);
  return (x, y) => {
    const s1 = side(ax, ay, bx, by, x, y);
    const s2 = side(bx, by, cx, cy, x, y);
    const s3 = side(cx, cy, ax, ay, x, y);
    return (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  };
}

/** A leaf as an ellipse from the nock (-4.5, 24) to (4.5, 24 + dy). */
function leaf(dy: number): Shape {
  const cx = 0;
  const cy = 24 + dy / 2;
  const angle = Math.atan2(dy, 9);
  const half = Math.hypot(9, dy) / 2;
  return (x, y) => {
    const u = (x - cx) * Math.cos(angle) + (y - cy) * Math.sin(angle);
    const v = -(x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle);
    return (u / half) ** 2 + (v / 1.1) ** 2 <= 1;
  };
}

/** The seal at full detail, as seal.svg draws it (units of its 48-wide viewBox, centered on x 18). */
export const FULL_SEAL: readonly Shape[] = [
  ring(16, 0.9), ring(11, 0.9), ring(6, 0.9), disc(24, 24, 2.2),
  capsule(-2, 24, 17, 24, 1.4), triangle(15.6, 21.4, 21, 24, 15.6, 26.6), leaf(-4.5), leaf(4.5),
];

/** The seal for 32 pixels: two rings and heavier strokes so every line stays at least 1.5 pixels. */
export const SMALL_SEAL: readonly Shape[] = [
  ring(16, 2.4), ring(9.5, 2.4), disc(24, 24, 2.8),
  capsule(-2, 24, 15, 24, 2.4), triangle(13.5, 19.5, 21.5, 24, 13.5, 28.5),
];

export interface IconSpec {
  size: number;
  /** Pixels per seal unit. */
  scale: number;
  shapes: readonly Shape[];
  /** RGBA of the ground; alpha 0 for transparent. */
  ground: readonly [number, number, number, number];
  ink: readonly [number, number, number];
}

/** Brand values from DESIGN.md: --forest #1F3A2E ground, --paper #FAF7F0 ink. */
export const COLOR_ICON: IconSpec = { size: 192, scale: 2.9, shapes: FULL_SEAL, ground: [0x1f, 0x3a, 0x2e, 255], ink: [0xfa, 0xf7, 0xf0] };
/** Microsoft requires pure white on transparent for the outline icon. */
export const OUTLINE_ICON: IconSpec = { size: 32, scale: 0.62, shapes: SMALL_SEAL, ground: [255, 255, 255, 0], ink: [255, 255, 255] };

const SAMPLES = 4;

/** Coverage of one pixel by the shapes, from a SAMPLES x SAMPLES grid. */
function coverage(spec: IconSpec, px: number, py: number): number {
  let hits = 0;
  for (let sy = 0; sy < SAMPLES; sy++) {
    for (let sx = 0; sx < SAMPLES; sx++) {
      const x = 18 + (px + (sx + 0.5) / SAMPLES - spec.size / 2) / spec.scale;
      const y = 24 + (py + (sy + 0.5) / SAMPLES - spec.size / 2) / spec.scale;
      if (spec.shapes.some((shape) => shape(x, y))) hits++;
    }
  }
  return hits / (SAMPLES * SAMPLES);
}

/** Renders an icon to RGBA pixels: the ink composited over the ground by coverage. */
export function renderIcon(spec: IconSpec): Uint8Array {
  const rgba = new Uint8Array(spec.size * spec.size * 4);
  const [gr, gg, gb, ga] = spec.ground;
  for (let py = 0; py < spec.size; py++) {
    for (let px = 0; px < spec.size; px++) {
      const c = coverage(spec, px, py);
      const at = (py * spec.size + px) * 4;
      if (ga === 0) {
        rgba.set([spec.ink[0], spec.ink[1], spec.ink[2], Math.round(c * 255)], at);
      } else {
        const mix = (ink: number, ground: number) => Math.round(ground + (ink - ground) * c);
        rgba.set([mix(spec.ink[0], gr), mix(spec.ink[1], gg), mix(spec.ink[2], gb), ga], at);
      }
    }
  }
  return rgba;
}

export const ICON_FILES = [
  { file: 'color.png', spec: COLOR_ICON },
  { file: 'outline.png', spec: OUTLINE_ICON },
] as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { file, spec } of ICON_FILES) {
    writeFileSync(join(import.meta.dirname, 'appPackage', file), encodeRgba(spec.size, spec.size, renderIcon(spec)));
  }
}
