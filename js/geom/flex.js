// Flex walls: living-hinge panels that wrap a curved outline and finger-joint
// into flat plates (bottom and top).
//
// Everything is measured along the walls' centreline, the line through the
// middle of the sheet's thickness: its length doesn't change when the sheet
// bends, so panel fingers, plate notches and hinge zones placed by distance
// along it line up after bending.
//
// The outline P is the OUTSIDE face of the walls seen from above (the plates'
// plane), closed, either orientation. Rounded stretches bend (living hinge);
// sharp 90° corners split the walls into separate panels joined with fingers.
//
// A flat panel: x along the wall (0 = its left end), y up the wall (0 = the
// underside of the bottom plate), z through the sheet (z = t faces outward).
import * as clip from './clip.js';

const SHARP = 45;      // a vertex turning more than this (degrees) is a corner, not a bend
const STRAIGHT = 0.2;  // turning less than this counts as straight
const STRIP_TURN = 3;  // the 3D view bends the panel in rigid strips of at most this many degrees

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const crs = (a, b) => a[0] * b[1] - a[1] * b[0];
const len = a => Math.hypot(a[0], a[1]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const left = a => [-a[1], a[0]];   // left normal (inward on a CCW outline)
const right = a => [a[1], -a[0]];  // right normal (outward on a CCW outline)
const deg = r => r * 180 / Math.PI;

class FlexError extends Error {}
export { FlexError };

function clean(pts) {
  const out = [];
  for (const p of pts) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number') throw new FlexError('path must be a list of [x, y] points');
    if (!out.length || len(sub(p, out[out.length - 1])) > 1e-9) out.push([p[0], p[1]]);
  }
  while (out.length > 1 && len(sub(out[0], out[out.length - 1])) <= 1e-9) out.pop();
  if (out.length < 3) throw new FlexError('path needs at least 3 points');
  return out;
}

// signed turning angle at each vertex of a closed path, in degrees (+ = left)
function turns(P) {
  const n = P.length;
  return P.map((p, i) => {
    const d1 = unit(sub(p, P[(i - 1 + n) % n])), d2 = unit(sub(P[(i + 1) % n], p));
    return deg(Math.atan2(crs(d1, d2), dot(d1, d2)));
  });
}

// ------------------------------------------------------------ round_corners

// Round the corners of a closed polygon. r: one radius, or one per point
// (0 keeps that corner sharp). The result starts halfway along the first
// edge, which is where a one-piece wrap puts its seam. frag(r) = segments
// in a full circle of radius r. Returns {path, clamped}.
export function roundCorners(pts, r, frag) {
  const P = clean(pts);
  const n = P.length;
  const radius = i => Math.max(0, Array.isArray(r) ? (+r[i] || 0) : (+r || 0));
  let clamped = false;
  const corner = i => {
    const prev = P[(i - 1 + n) % n], cur = P[i], next = P[(i + 1) % n];
    const d1 = unit(sub(cur, prev)), d2 = unit(sub(next, cur));
    const th = Math.atan2(crs(d1, d2), dot(d1, d2));
    let ri = radius(i);
    if (ri <= 0 || Math.abs(th) < 1e-9) return [cur];
    // each corner may use up to half of each neighbouring edge
    const room = Math.min(len(sub(cur, prev)), len(sub(next, cur))) / 2;
    let tl = ri * Math.tan(Math.abs(th) / 2);
    if (tl > room + 1e-9) { clamped = true; tl = room; ri = tl / Math.tan(Math.abs(th) / 2); }
    const a = sub(cur, mul(d1, tl));
    const c = add(a, mul(left(d1), th > 0 ? ri : -ri));
    const k = Math.max(1, Math.ceil(frag(ri) * Math.abs(th) / (2 * Math.PI)));
    const v = sub(a, c);
    const out = [];
    for (let j = 0; j <= k; j++) {
      const ang = th * j / k, cs = Math.cos(ang), sn = Math.sin(ang);
      out.push(add(c, [v[0] * cs - v[1] * sn, v[0] * sn + v[1] * cs]));
    }
    return out;
  };
  const out = [mul(add(P[0], P[1]), 0.5)];
  for (let i = 1; i <= n; i++) out.push(...corner(i % n));
  return { path: clean(out), clamped };
}

// ------------------------------------------------------------ layout

// Split a run of wall whose flat length is over maxLen into panels that butt
// together at seams. Seams go on straight stretches, clear of hinge zones and
// corner joints, as evenly spaced as that allows.
function splitRun(run, zones, t, fw, margin, maxLen) {
  const head = run.start === 'corner' ? t / 2 : 0, tail = run.end === 'corner' ? t / 2 : 0;
  const F = run.len + head + tail;
  if (!(maxLen > 0) || F <= maxLen + 1e-9) return [run];
  // prefer seams on straight stretches; a wall that is all bend (a round pot)
  // gets seams in the bend instead
  // where a seam may go, in centreline distance u from the run's start
  const keep = fw / 2 + 1;
  const bad = [[-Infinity, (run.start === 'corner' ? t : 0) + keep], [run.len - (run.end === 'corner' ? t : 0) - keep, Infinity]];
  for (const z of zones) {
    const a = z.a - run.s0, b = z.b - run.s0;
    if (b > 0 && a < run.len) bad.push([a - margin - keep, b + margin + keep]);
  }
  return trySplit(run, F, head, tail, fw, maxLen, bad, true) || trySplit(run, F, head, tail, fw, maxLen, bad.slice(0, 2), false);
}

// One attempt at placing seams outside the `bad` stretches (a list of [a, b]
// in centreline distance); null if no spacing works.
function trySplit(run, F, head, tail, fw, maxLen, bad, strict) {
  bad = bad.slice().sort((x, y) => x[0] - y[0]);
  const ok = [];
  let from = -Infinity;
  for (const [a, b] of bad) { if (a > from) ok.push([from, a]); from = Math.max(from, b); }
  ok.push([from, Infinity]);
  const allowed = ok.map(([a, b]) => [Math.max(a, 0), Math.min(b, run.len)]).filter(([a, b]) => b - a >= 0);
  const snap = u => {
    let best = null;
    for (const [a, b] of allowed) {
      const v = Math.min(b, Math.max(a, u));
      if (best === null || Math.abs(v - u) < Math.abs(best - u)) best = v;
    }
    return best;
  };
  const flatOf = (ua, ub, first, last) => ub - ua + (first ? head : 0) + (last ? tail : 0);
  for (let k = Math.ceil(F / maxLen); k <= Math.ceil(F / fw); k++) {
    const us = [0];
    for (let i = 1; i < k; i++) us.push(snap(i * F / k - head));
    us.push(run.len);
    if (us.some(v => v === null)) break;
    let fits = true;
    for (let i = 0; i < k && fits; i++) {
      const w = flatOf(us[i], us[i + 1], i === 0, i === k - 1);
      if (us[i + 1] - us[i] < 2 * fw || w > maxLen + 1e-9) fits = false;
    }
    if (!fits) continue;
    return us.slice(0, -1).map((u, i) => ({
      s0: run.s0 + u, len: us[i + 1] - u,
      start: i === 0 ? run.start : 'seam', end: i === k - 1 ? run.end : 'seam',
    }));
  }
  if (strict) return null;
  throw new FlexError(`a ${F.toFixed(0)} mm wall can't be split into panels of at most ${maxLen} mm; raise max_len`);
}


// Work out the panels, hinge zones and finger positions for an outline.
//   t: sheet thickness   o.fw: finger width   o.sag: how far (mm) a rigid
//   finger may stand off a curve, which sets narrower fingers on tight bends
//   o.margin: how far hinge cuts extend past each bend
export function flexLayout(path, t, o = {}) {
  const fw = o.fw ?? 12, sag = o.sag ?? 0.1, margin = o.margin ?? 3;
  if (!(t > 0)) throw new FlexError('thickness must be positive');
  let P = clean(path);
  if (clip.area(P) < 0) P = [P[0], ...P.slice(1).reverse()];
  let T = turns(P);
  const n = P.length;

  // start at the first sharp corner so panels run corner to corner
  const sharpAt = T.findIndex(a => Math.abs(a) > SHARP);
  if (sharpAt > 0) { P = [...P.slice(sharpAt), ...P.slice(0, sharpAt)]; T = turns(P); }
  for (let i = 0; i < n; i++) {
    if (Math.abs(T[i]) <= SHARP) continue;
    if (T[i] < 0 || Math.abs(T[i] - 90) > 1) {
      throw new FlexError(`sharp corner at [${P[i].map(v => +v.toFixed(2))}] turns ${Math.abs(T[i]).toFixed(1)}°${T[i] < 0 ? ' inward' : ''}: ` +
        'only square outside corners can be finger-jointed; give it a radius to bend it instead');
    }
  }

  // centreline: the outline moved inward by t/2 (miter offset per vertex)
  const C = P.map((p, i) => {
    const n1 = left(unit(sub(p, P[(i - 1 + n) % n]))), n2 = left(unit(sub(P[(i + 1) % n], p)));
    const b = unit(add(n1, n2));
    return add(p, mul(b, (t / 2) / dot(b, n1)));
  });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (dot(sub(C[j], C[i]), sub(P[j], P[i])) <= 0) {
      throw new FlexError(`a bend near [${P[i].map(v => +v.toFixed(2))}] is tighter than the sheet is thick — use a bigger radius`);
    }
  }
  const s = [0];
  for (let i = 0; i < n; i++) s.push(s[i] + len(sub(C[(i + 1) % n], C[i])));
  const L = s[n];
  const segLen = i => s[i + 1] - s[i];

  // bends: merge each curved vertex's neighbourhood into zones
  let raw = [];
  for (let i = 0; i < n; i++) {
    const a = Math.abs(T[i]);
    if (a <= STRAIGHT || a > SHARP) continue;
    // a vertex where a long straight meets an arc only bends over the short side
    const h = Math.min(segLen((i - 1 + n) % n), segLen(i));
    const r = h / (a * Math.PI / 180);
    let a0 = s[i] - h / 2, b0 = s[i] + h / 2;
    if (a0 < 0) { raw.push({ a: a0 + L, b: L, r }); a0 = 0; }
    if (b0 > L) { raw.push({ a: 0, b: b0 - L, r }); b0 = L; }
    raw.push({ a: a0, b: b0, r });
  }
  raw.sort((x, y) => x.a - y.a);
  const zones = [];
  for (const z of raw) {
    const last = zones[zones.length - 1];
    if (last && z.a <= last.b + 1) { last.b = Math.max(last.b, z.b); last.r = Math.min(last.r, z.r); } else zones.push({ ...z });
  }

  // simplified centreline K: C's vertices, skipping ones until the turn
  // since the last kept vertex reaches STRIP_TURN. Plate notches and the
  // bent 3D strips both follow K, so they match exactly.
  const keep = [];
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += T[i];
    if (i === 0 || Math.abs(T[i]) > SHARP || Math.abs(acc) > STRIP_TURN) { keep.push(i); acc = 0; }
  }
  const K = keep.map(i => C[i]), ks = [...keep.map(i => s[i]), L];
  const kIndex = new Map(keep.map((i, j) => [i, j]));

  // runs of wall: corner to corner, or one closed loop
  const corners = [];
  for (let i = 0; i < n; i++) if (Math.abs(T[i]) > SHARP) corners.push(i);
  const runs = corners.length
    ? corners.map((c0, k) => {
      const c1 = k + 1 < corners.length ? corners[k + 1] : n;
      return { s0: s[c0], len: s[c1] - s[c0], start: 'corner', end: 'corner' };
    })
    : [{ s0: 0, len: L, start: 'seam', end: 'seam', loop: true }];
  const pieces = runs.flatMap(run => splitRun(run, zones, t, fw, margin, o.maxLen));

  for (const pc of pieces) {
    const Lc = pc.len;
    const startC = pc.start === 'corner', endC = pc.end === 'corner';
    const ends = startC ? t / 2 : 0;                   // the panel reaches t/2 past a corner
    pc.lead = ends;                                    // flat x of the centreline's start
    pc.flatLen = Lc + ends + (endC ? t / 2 : 0);
    // flat x range between the corner joints (the joints are t wide)
    pc.core = [startC ? t : 0, pc.flatLen - (endC ? t : 0)];
    // bends inside this panel, in flat x
    pc.zones = zones
      .map(z => ({ a: Math.max(z.a, pc.s0) - pc.s0 + ends, b: Math.min(z.b, pc.s0 + Lc) - pc.s0 + ends, r: z.r }))
      .filter(z => z.b - z.a > 1e-6);
    // hinge cuts stay 1 mm clear of a seam edge
    const h0 = pc.core[0] + (pc.start === 'seam' && !pc.loop ? 1 : 0), h1 = pc.core[1] - (pc.end === 'seam' && !pc.loop ? 1 : 0);
    pc.hinges = pc.zones
      .map(z => [Math.max(h0, z.a - margin), Math.min(h1, z.b + margin)])
      .filter(([a, b]) => b - a > 0.5);
    // fingers along the edges that meet the plates
    const [fa, fb] = pc.core;
    const cuts = [fa];
    for (const z of pc.zones) for (const x of [z.a, z.b]) if (x > fa + 1e-6 && x < fb - 1e-6) cuts.push(x);
    cuts.push(fb);
    cuts.sort((a, b) => a - b);
    const spans = [];
    for (let k = 1; k < cuts.length; k++) {
      const a = cuts[k - 1], b = cuts[k];
      if (b - a < 1e-6) continue;
      const mid = (a + b) / 2;
      const z = pc.zones.find(z => mid > z.a && mid < z.b);
      const w = z ? Math.max(2, Math.min(fw, Math.sqrt(8 * z.r * sag))) : fw;
      spans.push({ a, b, n: Math.max(1, Math.round((b - a) / w)) });
    }
    let total = spans.reduce((q, sp) => q + sp.n, 0);
    // a whole loop alternates all the way round; any other panel starts and ends
    // with a stretch the plate keeps (at a seam, one plate finger spans the joint)
    const want = pc.loop ? (total < 2 ? 2 : total % 2 === 0 ? total : total + 1) : (total % 2 === 1 ? total : total + 1);
    while (total < want) {
      spans.reduce((m, sp) => ((sp.b - sp.a) / sp.n > (m.b - m.a) / m.n ? sp : m)).n++;
      total++;
    }
    const xs = [];
    for (const sp of spans) for (let k = 0; k < sp.n; k++) xs.push(sp.a + (sp.b - sp.a) * k / sp.n);
    xs.push(fb);
    pc.intervals = xs.slice(1).map((b, k) => [xs[k], b]);
    pc.fingers = pc.intervals.filter((_, k) => k % 2 === 1);   // panel's; the plate keeps the rest
  }
  const minR = zones.length ? Math.min(...zones.map(z => z.r)) : Infinity;
  return { P, C: K, s: ks, L, n: K.length, t, fw, pieces, minR };
}

// the panel's flat length, for each panel
export const flexLengths = lay => lay.pieces.map(p => p.flatLen);

// point and outward unit normal on the centreline at distance u from its start.
// atEnd picks the segment ending at a vertex when u lands exactly on one.
function frameAt(lay, u, atEnd) {
  const { C, s, n } = lay;
  let k = 0;
  if (atEnd) { while (k < n - 1 && s[k + 1] < u - 1e-9) k++; } else { while (k < n - 1 && s[k + 1] <= u + 1e-9) k++; }
  const a = C[k], b = C[(k + 1) % n];
  const d = unit(sub(b, a));
  return { p: add(a, mul(d, u - s[k])), nrm: right(d), k };
}

// Where a flat finger really sits: fingers have no hinge cuts, so on a curve
// they stay straight, along the chord between the centreline points at their
// ends (standing off the curve by at most lay.sag in the middle). The finger
// keeps its flat length, a hair more than the chord, centred on it.
// Returns the frame: o = where the finger's middle sits, u along, N outward.
function chordFrame(lay, ua, ub) {
  const A = frameAt(lay, ua, false).p, B = frameAt(lay, ub, true).p;
  const u = unit(sub(B, A));
  return { o: mul(add(A, B), 0.5), u, N: right(u), half: (ub - ua) / 2 };
}
function chordRect(lay, ua, ub, din, dout) {
  const { o, u, N, half } = chordFrame(lay, ua, ub);
  const A = sub(o, mul(u, half)), B = add(o, mul(u, half));
  return [add(A, mul(N, dout)), add(B, mul(N, dout)), sub(B, mul(N, din)), sub(A, mul(N, din))];
}

// ------------------------------------------------------------ plate

// The bottom/top plate: the outline (grown by `lip` for tabs-through-slots)
// minus a notch or slot wherever a panel finger comes through: a straight
// rectangle, since fingers stay flat even on curves.
export function flexPlate(lay, lip = 0) {
  const t = lay.t;
  const outline = lip > 0 ? clip.offset([lay.P], lip, 'round') : clip.union([lay.P]);
  const holes = [];
  for (const pc of lay.pieces) {
    for (const [a, b] of pc.fingers) {
      const ua = pc.s0 + a - pc.lead, ub = pc.s0 + b - pc.lead, dout = lip > 0 ? t / 2 : t / 2 + 1;
      holes.push(chordRect(lay, ua, ub, t / 2, dout));
    }
  }
  return clip.difference(outline, holes);
}

// ------------------------------------------------------------ panel

// Where the hinge cut columns go across ha..hb, and which reach the edges:
// [[x, edge], …]. The wall can only bend at its edges between fingers (a
// finger is solid and stays flat), so an edge column goes in the middle of
// every gap between fingers, and the columns between two gaps are spaced
// evenly, as close to `pitch` as strict alternation allows (within 25%).
// Edge columns that land on a finger stop at its root.
function hingeColumns(pc, ha, hb, pitch) {
  const anchors = pc.intervals.filter((_, k) => k % 2 === 0)
    .map(([a, b]) => (a + b) / 2).filter(x => x > ha && x < hb);
  const cols = [];
  if (!anchors.length) {
    for (let c = 0, n = Math.floor((hb - ha) / pitch); c <= n; c++) cols.push([ha + c * pitch, c % 2 === 0]);
    return cols;
  }
  const CLEAR = 0.5;   // edge cuts stay this far from a finger's sides
  const nearSide = x => pc.fingers.some(([a, b]) => Math.abs(x - a) < CLEAR || Math.abs(x - b) < CLEAR);
  const step = [];   // spacing used between each pair of anchors
  for (let i = 0; i + 1 < anchors.length; i++) {
    const D = anchors[i + 1] - anchors[i];
    // an even number of columns, spaced close to pitch (finer rather than
    // coarser: tight bends need it), with no edge column beside a finger
    let best = null;
    for (let m = 2; D / m >= 0.6 * pitch || m === 2; m += 2) {
      const sp = D / m;
      let cost = sp > pitch ? 1.5 * Math.log(sp / pitch) : Math.log(pitch / sp);
      for (let k = 2; k < m; k += 2) if (nearSide(anchors[i] + k * sp)) cost += 10;
      if (!best || cost < best.cost) best = { m, cost };
    }
    step.push(D / best.m);
    for (let k = 0; k < best.m; k++) cols.push([anchors[i] + k * D / best.m, k % 2 === 0]);
  }
  cols.push([anchors[anchors.length - 1], true]);
  // carry on past the first and last gaps to the ends of the hinge zone
  const p0 = step.length ? step[0] : pitch, p1 = step.length ? step[step.length - 1] : pitch;
  for (let k = 1; anchors[0] - k * p0 >= ha - 1e-9; k++) cols.unshift([anchors[0] - k * p0, k % 2 === 0]);
  for (let k = 1; anchors[anchors.length - 1] + k * p1 <= hb + 1e-9; k++) cols.push([anchors[anchors.length - 1] + k * p1, k % 2 === 0]);
  // an edge cut right beside a finger's side would carry that side on up into
  // the wall (or leave a sliver). Where the spacing couldn't avoid it (past
  // the last gap), nudge it clear, whichever way is shorter
  for (const c of cols) {
    if (!c[1]) continue;
    for (const [a, b] of pc.fingers) for (const side of [a, b]) {
      if (Math.abs(c[0] - side) < CLEAR) c[0] = side + (c[0] < side ? -CLEAR : CLEAR);
    }
  }
  return cols;
}

// One flat panel. height: outside height of the box (plates included).
// top: whether a top plate joins its upper edge. Hinge cuts: pitch between
// lines, seg cut length, bridge left between cuts.
export function flexPanel(lay, index, height, o = {}) {
  const pc = lay.pieces[index];
  if (!pc) throw new FlexError(`there is no panel ${index}; this outline has ${lay.pieces.length}`);
  const t = lay.t, fw = o.fw ?? lay.fw, top = o.top ?? true;
  const pitch = o.pitch ?? 1.5, seg = o.seg ?? 18, bridge = o.bridge ?? 3;
  const y0 = t, y1 = top ? height - t : height;
  if (y1 - y0 < 1) throw new FlexError(`height ${height} leaves no wall between the plates`);
  const rect = (x0, x1, ya, yb) => [[x0, ya], [x1, ya], [x1, yb], [x0, yb]];
  const body = [rect(pc.core[0], pc.core[1], y0, y1)];
  for (const [a, b] of pc.fingers) {
    body.push(rect(a, b, 0, t));
    if (top) body.push(rect(a, b, height - t, height));
  }
  if (pc.start === 'corner' || pc.end === 'corner') {
    // corner joints: the panel ending at a corner keeps the outer fingers
    const m = Math.max(1, Math.floor((y1 - y0) / fw));
    const k = m % 2 === 0 ? Math.max(1, m - 1) : m;
    const h = (y1 - y0) / k;
    for (let i = 0; i < k; i++) {
      const ya = y0 + i * h, yb = ya + h;
      if (i % 2 === 1) { if (pc.start === 'corner') body.push(rect(0, t, ya, yb)); } else if (pc.end === 'corner') body.push(rect(pc.flatLen - t, pc.flatLen, ya, yb));
    }
  }
  // Hinge cuts come in two kinds of column, strictly alternating: "edge"
  // columns cut right out to both edges of the wall (n cuts, n - 1 bridges),
  // "inner" columns keep a bridge at each edge (and one in the middle of each
  // of the edge column's inner cuts). Cut lengths are stretched so the pattern
  // fits the height exactly.
  const H = y1 - y0;
  const nE = Math.max(2, Math.round((H + bridge) / (seg + bridge)));
  const L = (H - (nE - 1) * bridge) / nE;
  const edgeCuts = Array.from({ length: nE }, (_, i) => [y0 + i * (L + bridge), y0 + i * (L + bridge) + L]);
  const innerBr = [[y0, y0 + bridge], ...edgeCuts.slice(1, -1).map(([a, b]) => [(a + b - bridge) / 2, (a + b + bridge) / 2]), [y1 - bridge, y1]];
  const innerCuts = innerBr.slice(1).map((br, i) => [innerBr[i][1], br[0]]);
  const lines = [];
  for (const [ha, hb] of pc.hinges) {
    for (const [x, edge] of hingeColumns(pc, ha, hb, pitch)) {
      for (const [a, b] of edge ? edgeCuts : innerCuts) if (b - a > 0.5) lines.push([[x, a], [x, b]]);
    }
  }  return { body: clip.union(body), lines };
}

// ------------------------------------------------------------ bending (3D view)

// Split a flat panel (a Shape-like {body, lines, engrave, score}) into rigid
// strips, each with the row-major 4x4 that stands it on the outline. The
// strips together show the panel wrapped around the plates.
export function flexStrips(lay, index, shape) {
  const pc = lay.pieces[index];
  if (!pc) throw new FlexError(`there is no panel ${index}; this outline has ${lay.pieces.length}`);
  const { C, s, n, t } = lay;
  const groups = [];
  for (let k = 0; k < n; k++) if (s[k] < pc.s0 + pc.len - 1e-9 && s[k + 1] > pc.s0 + 1e-9) groups.push({ start: k, end: k + 1 });
  const BIG = 1e5;
  const out = [];
  // fingers have no hinge cuts, so they stay flat: each is its own rigid
  // piece along the chord between its ends, the same rectangle the plates cut
  const top = clip.bounds(shape.body).y1;
  // fingers along the top edge only if the panel has them (not with an open
  // top): then the plate's stretch between two fingers is cut away up there
  const gap = pc.intervals.find((_, k) => k % 2 === 0);
  const topFingers = !!gap && Math.abs(clip.intersection(shape.body,
    [[[gap[0] + 0.1, top - t / 2], [gap[1] - 0.1, top - t / 2], [gap[1] - 0.1, top], [gap[0] + 0.1, top]]])
    .reduce((sum, q) => sum + clip.area(q), 0)) < 1e-6;
  const fingerBoxes = pc.fingers.flatMap(([a, b]) => [
    [[a, -BIG], [b, -BIG], [b, t], [a, t]],
    ...(topFingers ? [[[a, top - t], [b, top - t], [b, BIG], [a, BIG]]] : [])]);
  for (const [a, b] of pc.fingers) {
    const box = [[a, -BIG], [b, -BIG], [b, BIG], [a, BIG]];
    const body = clip.intersection(shape.body, clip.intersection([box], fingerBoxes));
    if (!body.length) continue;
    const { o, u, N } = chordFrame(lay, pc.s0 + a - pc.lead, pc.s0 + b - pc.lead);
    const m = (a + b) / 2;  // the finger's middle lands on the chord's
    const tx = o[0] - u[0] * m - N[0] * t / 2, ty = o[1] - u[1] * m - N[1] * t / 2;
    out.push({ shape: { body, lines: [], engrave: [], score: [], images: [] }, m4: [u[0], 0, N[0], tx, u[1], 0, N[1], ty, 0, 1, 0, 0, 0, 0, 0, 1] });
  }
  const rest = { ...shape, body: clip.difference(shape.body, fingerBoxes) };
  groups.forEach((g, gi) => {
    const a = C[g.start], b = C[g.end % n];
    const u = unit(sub(b, a)), N = right(u);
    const xa = s[g.start] - pc.s0 + pc.lead, xb = s[g.end] - pc.s0 + pc.lead;
    const lo = gi === 0 ? -BIG : xa, hi = gi === groups.length - 1 ? BIG : xb;
    const box = [[[lo, -BIG], [hi, -BIG], [hi, BIG], [lo, BIG]]];
    const piece = {
      body: clip.intersection(rest.body, box),
      lines: clip.clipLines(shape.lines || [], box, true),
      engrave: clip.intersection(shape.engrave || [], box),
      score: clip.clipLines(shape.score || [], box, true),
      images: [],
    };
    if (!piece.body.length) return;
    // flat (x, y, z) → world: along u from a, y up, z outward from the centreline
    const tx = a[0] - u[0] * xa - N[0] * t / 2, ty = a[1] - u[1] * xa - N[1] * t / 2;
    out.push({ shape: piece, m4: [u[0], 0, N[0], tx, u[1], 0, N[1], ty, 0, 1, 0, 0, 0, 0, 0, 1] });
  });
  return out;
}
