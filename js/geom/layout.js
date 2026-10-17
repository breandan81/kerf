// Lay parts out flat on sheets, one material at a time (MaxRects packing
// with 90° rotation). Each placed piece gets a 2D affine from its local
// coordinates to sheet coordinates (mm, y up, sheet origin bottom-left).
import { mul2, rotate2, translate2 } from './shape.js';
import { bounds, convexHull } from './clip.js';

// rotation (deg) that gives the smallest bounding box, from the hull edges
function bestRotation(paths) {
  const hull = convexHull(paths.flat());
  let best = 0, bestArea = Infinity;
  const tryAngle = deg => {
    const r = rotate2(deg);
    const b = bounds([hull.map(([x, y]) => [r[0] * x + r[2] * y, r[1] * x + r[3] * y])]);
    const a = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (a < bestArea - 1e-6) { bestArea = a; best = deg; }
  };
  tryAngle(0);
  const area0 = bestArea;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i], [x2, y2] = hull[(i + 1) % hull.length];
    tryAngle(-Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI);
  }
  // only bother rotating if it saves real material
  return bestArea < area0 * 0.93 ? best : 0;
}

class MaxRects {
  constructor(w, h) { this.free = [{ x: 0, y: 0, w, h }]; }
  // best short side fit; returns {x,y,rot} or null
  find(w, h, allowRot) {
    let best = null;
    for (const f of this.free) {
      for (const [ww, hh, rot] of allowRot ? [[w, h, false], [h, w, true]] : [[w, h, false]]) {
        if (ww <= f.w + 1e-9 && hh <= f.h + 1e-9) {
          const ss = Math.min(f.w - ww, f.h - hh), ls = Math.max(f.w - ww, f.h - hh);
          // prefer low y, then low x (fills from the bottom-left)
          const score = [f.y + hh, ss, ls, f.x];
          if (!best || cmp(score, best.score) < 0) best = { x: f.x, y: f.y, w: ww, h: hh, rot, score };
        }
      }
    }
    return best;
  }
  place(r) {
    const next = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) { next.push(f); continue; }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    // drop free rects contained in others
    this.free = next.filter((a, i) => !next.some((b, j) => j !== i &&
      a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.w !== b.w || a.h !== b.h || a.x !== b.x || a.y !== b.y)));
  }
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

// parts: interpreter parts. opts: {rotate: true}
// returns { sheets: [{material, w, h, index, items:[{part, copy, m}]}], warnings }
export function layoutParts(parts, opts = {}) {
  const warnings = [];
  const byMat = new Map();
  for (const p of parts) {
    if (!p.shape.body.length) continue;
    const k = p.material.name;
    if (!byMat.has(k)) byMat.set(k, []);
    for (let c = 0; c < Math.max(1, Math.round(p.qty)); c++) byMat.get(k).push({ part: p, copy: c });
  }
  const sheets = [];
  for (const [, pieces] of byMat) {
    const mat = pieces[0].part.material;
    const [SW, SH] = mat.sheet;
    const gap = mat.gap, margin = mat.margin;
    // pre-rotate each piece to its tightest box, normalise to origin
    for (const pc of pieces) {
      const rot = opts.rotate === false ? 0 : bestRotation(pc.part.shape.body);
      const m0 = rotate2(rot);
      const b = bounds(pc.part.shape.body.map(p => p.map(([x, y]) => [m0[0] * x + m0[2] * y, m0[1] * x + m0[3] * y])));
      pc.base = mul2(translate2(-b.x0, -b.y0), m0);
      pc.w = b.x1 - b.x0;
      pc.h = b.y1 - b.y0;
    }
    pieces.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
    const open = [];
    const newSheet = () => {
      const s = { material: mat, w: SW, h: SH, index: sheets.length, items: [], packer: new MaxRects(SW - 2 * margin + gap, SH - 2 * margin + gap) };
      sheets.push(s);
      open.push(s);
      return s;
    };
    for (const pc of pieces) {
      let spot = null, sheet = null;
      for (const s of open) {
        spot = s.packer.find(pc.w + gap, pc.h + gap, opts.rotate !== false);
        if (spot) { sheet = s; break; }
      }
      if (!spot) {
        sheet = newSheet();
        spot = sheet.packer.find(pc.w + gap, pc.h + gap, opts.rotate !== false);
        if (!spot) {
          warnings.push(`"${pc.part.name}" (${pc.w.toFixed(1)} × ${pc.h.toFixed(1)} mm) does not fit on a ${SW} × ${SH} ${mat.name} sheet`);
          sheet.w = Math.max(SW, pc.w + 2 * margin);
          sheet.h = Math.max(SH, pc.h + 2 * margin);
          sheet.oversize = true;
          spot = { x: 0, y: 0, w: pc.w + gap, h: pc.h + gap, rot: false };
          open.splice(open.indexOf(sheet), 1);
        }
      }
      sheet.packer.place(spot);
      let m = pc.base;
      if (spot.rot) m = mul2(translate2(pc.h, 0), mul2(rotate2(90), m));
      // pack from the top-left, where the laser's origin is
      const ph = spot.rot ? pc.w : pc.h;
      m = mul2(translate2(margin + spot.x, sheet.h - margin - spot.y - ph), m);
      sheet.items.push({ part: pc.part, copy: pc.copy, m });
    }
  }
  for (const s of sheets) delete s.packer;
  return { sheets, warnings };
}
