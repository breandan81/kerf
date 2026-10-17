// text() → polygons using opentype.js. Font outlines are flattened and
// unioned with the nonzero rule so counters (holes in o, e, a…) come out right.
import * as clip from './clip.js';

function flattenCommands(cmds, tol) {
  const paths = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0;
  const seg = (len) => Math.max(2, Math.min(32, Math.ceil(len / tol)));
  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        if (cur && cur.length > 2) paths.push(cur);
        cur = [[c.x, c.y]]; x = sx = c.x; y = sy = c.y; break;
      case 'L': cur.push([c.x, c.y]); x = c.x; y = c.y; break;
      case 'Q': {
        const n = seg(Math.hypot(c.x1 - x, c.y1 - y) + Math.hypot(c.x - c.x1, c.y - c.y1));
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          cur.push([u * u * x + 2 * u * t * c.x1 + t * t * c.x, u * u * y + 2 * u * t * c.y1 + t * t * c.y]);
        }
        x = c.x; y = c.y; break;
      }
      case 'C': {
        const n = seg(Math.hypot(c.x1 - x, c.y1 - y) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          cur.push([
            u * u * u * x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
            u * u * u * y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y]);
        }
        x = c.x; y = c.y; break;
      }
      case 'Z':
        if (cur && cur.length > 2) paths.push(cur);
        cur = null; x = sx; y = sy; break;
    }
  }
  if (cur && cur.length > 2) paths.push(cur);
  return paths;
}

// size ≈ height of capitals above baseline, as in OpenSCAD
export function textPaths(font, str, o) {
  const size = o.size ?? 10;
  const fontSize = size * 1.37; // em size that makes cap height ≈ size for typical fonts
  const spacing = o.spacing ?? 1;
  const scale = fontSize / font.unitsPerEm;
  const tol = Math.max(0.02, size / 200);
  const glyphs = font.stringToGlyphs(str);
  let pen = 0;
  const raw = [];
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const p = g.getPath(pen, 0, fontSize);
    raw.push(...flattenCommands(p.commands, tol));
    let adv = (g.advanceWidth || 0) * scale * spacing;
    if (i + 1 < glyphs.length && font.getKerningValue) adv += font.getKerningValue(g, glyphs[i + 1]) * scale;
    pen += adv;
  }
  // opentype is y-down; flip
  let paths = raw.map(p => p.map(([x, y]) => [x, -y]));
  paths = clip.union(paths, 'nonzero');
  const b = paths.length ? clip.bounds(paths) : { x0: 0, x1: 0, y0: 0, y1: 0 };
  let dx = 0, dy = 0;
  const halign = o.halign || 'left', valign = o.valign || 'baseline';
  if (halign === 'center') dx = -pen / 2;
  else if (halign === 'right') dx = -pen;
  if (valign === 'top') dy = -b.y1;
  else if (valign === 'center') dy = -(b.y0 + b.y1) / 2;
  else if (valign === 'bottom') dy = -b.y0;
  return paths.map(p => p.map(([x, y]) => [x + dx, y + dy]));
}
