// Card F6b: types for subset-font (harfbuzz subsetting and instancing), which ships none. Used by
// visualtheme-fonts.ts at export time only; nothing of it reaches the Worker or the browser.
declare module 'subset-font' {
  export default function subsetFont(
    font: Buffer,
    text: string,
    options?: {
      targetFormat?: 'woff2' | 'woff' | 'sfnt';
      /** Keeps every glyph; `text` must then be empty. */
      keepAllGlyphs?: boolean;
      /** Name IDs kept beyond harfbuzz's default (0 to 6). */
      preserveNameIds?: number[];
      variationAxes?: Record<string, number | { min: number; max: number; default?: number }>;
    },
  ): Promise<Buffer>;
}
