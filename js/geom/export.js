// SVG export for laser software (tuned for xTool Creative Space, which
// reads mm units and keeps groups): one file per sheet, operations as
// colour-coded groups.
import { mul2 } from './shape.js';
import * as clip from './clip.js';

export const DEFAULT_COLORS = { cut: '#ff0000', score: '#0000ff', engrave: '#000000' };

const f = v => (Math.round(v * 1000) / 1000).toString();

function pathD(paths, H, closed) {
  return paths.map(p => 'M' + p.map(([x, y]) => `${f(x)},${f(H - y)}`).join('L') + (closed ? 'Z' : '')).join('');
}

// sheet: from layoutParts. opts: {kerf: true, colors, strokeWidth}
export function sheetToSVG(sheet, opts = {}) {
  const colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
  const sw = opts.strokeWidth ?? 0.1;
  const W = sheet.w, H = sheet.h;
  const kerf = opts.kerf === false ? 0 : sheet.material.kerf || 0;
  const images = [], engrave = [], score = [], cut = [];
  for (const it of sheet.items) {
    const s = it.part.shape.transform(it.m);
    const label = `${esc(it.part.name)}${it.part.qty > 1 ? ' #' + (it.copy + 1) : ''}`;
    for (const im of s.images) {
      // unit square (y up) → sheet → SVG (y down); SVG <image> is y down
      const m = mul2([1, 0, 0, -1, 0, H], mul2(im.m, [1, 0, 0, -1, 0, 1]));
      images.push(`<image x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="matrix(${m.map(f).join(' ')})" href="${im.src}" xlink:href="${im.src}"><title>${label}</title></image>`);
    }
    if (s.engrave.length) engrave.push(`<path d="${pathD(s.engrave, H, true)}"><title>${label}</title></path>`);
    if (s.score.length) score.push(`<path d="${pathD(s.score, H, false)}"><title>${label}</title></path>`);
    // kerf compensation grows the outline and shrinks holes by half the beam width
    const body = kerf > 0 ? clip.offset(s.body, kerf / 2, 'miter', 0.01, 4) : s.body;
    // holes first so pieces don't drop out before their inner cuts are done
    const holes = body.filter(p => clip.area(p) < 0), outer = body.filter(p => clip.area(p) >= 0);
    if (s.lines.length) cut.push(`<path d="${pathD(s.lines, H, false)}"><title>${label} lines</title></path>`);
    if (holes.length) cut.push(`<path d="${pathD(holes, H, true)}"><title>${label} holes</title></path>`);
    if (outer.length) cut.push(`<path d="${pathD(outer, H, true)}"><title>${label}</title></path>`);
  }
  const g = (id, attrs, items) => items.length
    ? `  <g id="${id}" inkscape:groupmode="layer" inkscape:label="${id}" ${attrs}>\n    ${items.join('\n    ')}\n  </g>\n` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Kerf: ${esc(sheet.material.name)} ${sheet.material.thickness} mm, sheet ${sheet.index + 1}, kerf compensation ${kerf ? kerf + ' mm' : 'off'}
     ${colors.cut} = cut, ${colors.score} = score (line engrave), ${colors.engrave} fill = engrave -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
     width="${f(W)}mm" height="${f(H)}mm" viewBox="0 0 ${f(W)} ${f(H)}">
${g('engrave-images', '', images)}${g('engrave', `fill="${colors.engrave}" fill-rule="evenodd" stroke="none"`, engrave)}${g('score', `fill="none" stroke="${colors.score}" stroke-width="${sw}"`, score)}${g('cut', `fill="none" stroke="${colors.cut}" stroke-width="${sw}"`, cut)}</svg>
`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

