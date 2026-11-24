import { getFontEmbedCSS, toPng } from 'html-to-image';

/**
 * Captures any printable DOM sheet as a crisp full-width PNG Data URL.
 * Attempts to embed loaded Google Fonts CSS (using crossorigin="anonymous")
 * so PNG glyph metrics match the live DOM identically and avoid fallback-font
 * wrapping/overlap, with a clean SecurityError-safe fallback.
 */
export async function captureSheetToPng(
  element: HTMLElement,
  options: { pixelRatio?: number; backgroundColor?: string } = {}
): Promise<string> {
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font readiness check errors
    }
  }

  let fontEmbedCSS: string | undefined;
  let skipFonts = false;
  try {
    fontEmbedCSS = await getFontEmbedCSS(element);
  } catch {
    fontEmbedCSS = '';
    skipFonts = true;
  }

  const width = Math.max(element.scrollWidth, element.offsetWidth);
  const height = Math.max(element.scrollHeight, element.offsetHeight);

  return toPng(element, {
    pixelRatio: options.pixelRatio ?? 2.2,
    backgroundColor: options.backgroundColor ?? '#FFFFFF',
    cacheBust: true,
    skipFonts,
    ...(fontEmbedCSS !== undefined ? { fontEmbedCSS } : {}),
    width,
    height,
    style: {
      margin: '0',
      maxWidth: 'none',
      width: `${width}px`,
      height: `${height}px`,
      boxSizing: 'border-box',
    },
  });
}
