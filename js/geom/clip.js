// Thin wrapper over ClipperLib (integer polygon booleans/offsets).
// Geometry outside this file is float mm: a path is [[x,y], ...], a
// polygon set ("Paths") is an array of closed paths with nonzero fill,
// outer contours CCW and holes CW after normalisation.

const C = () => globalThis.ClipperLib;
export const SCALE = 1e4; // 0.1 µm resolution

const toInt = paths => paths.map(p => p.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })));
const toFloat = paths => paths.map(p => p.map(q => [q.X / SCALE, q.Y / SCALE]));

function exec(op, subj, clip, fillSubj = 'nonzero', fillClip = 'nonzero') {
  const L = C();
  const ft = f => (f === 'evenodd' ? L.PolyFillType.pftEvenOdd : L.PolyFillType.pftNonZero);
  const c = new L.Clipper();
  c.StrictlySimple = true;
  c.AddPaths(toInt(subj), L.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(toInt(clip), L.PolyType.ptClip, true);
  const out = [];
  c.Execute(op, out, ft(fillSubj), ft(fillClip));
  return toFloat(out).filter(p => p.length >= 3);
}

export function union(paths, fill = 'nonzero') {
  if (!paths.length) return [];
  const out = exec(C().ClipType.ctUnion, paths, [], fill, fill);
  return out.filter(p => area(p) > 0).length > 1 ? closeSeams(out) : out;
}

// Clipper leaves shapes that only share an edge (a finger tab whose base lies
// along the middle of a panel's edge) as separate pieces, which would put a
// cut line along the seam. Grow then shrink by a hair to fuse them.
function closeSeams(paths) {
  const L = C();
  const run = (ps, d) => {
    const co = new L.ClipperOffset(2, 1);
    co.AddPaths(ps, L.JoinType.jtMiter, L.EndType.etClosedPolygon);
    const o = [];
    co.Execute(o, d);
    return o;
  };
  return toFloat(run(run(toInt(paths), 2), -2)).filter(p => p.length >= 3);
}
export function difference(a, b) {
  if (!a.length) return [];
  if (!b.length) return union(a);
  return exec(C().ClipType.ctDifference, a, b);
}
export function intersection(a, b) {
  if (!a.length || !b.length) return [];
  return exec(C().ClipType.ctIntersection, a, b);
}
export function xor(a, b) {
  return exec(C().ClipType.ctXor, a, b);
}

// Clip open polylines against a polygon set (keep inside or outside).
export function clipLines(lines, polys, keepInside = true) {
  if (!lines.length) return [];
  const L = C();
  const c = new L.Clipper();
  c.AddPaths(toInt(lines), L.PolyType.ptSubject, false);
  c.AddPaths(toInt(polys), L.PolyType.ptClip, true);
  const tree = new L.PolyTree();
  c.Execute(keepInside ? L.ClipType.ctIntersection : L.ClipType.ctDifference, tree,
    L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return toFloat(L.Clipper.OpenPathsFromPolyTree(tree)).filter(p => p.length >= 2);
}

// join: 'round' | 'miter' | 'square'
export function offset(paths, delta, join = 'round', arcTol = 0.01, miterLimit = 2) {
  if (!paths.length) return [];
  if (delta === 0) return union(paths);
  const L = C();
  const jt = { round: L.JoinType.jtRound, miter: L.JoinType.jtMiter, square: L.JoinType.jtSquare }[join];
  const co = new L.ClipperOffset(miterLimit, arcTol * SCALE);
  co.AddPaths(toInt(union(paths)), jt, L.EndType.etClosedPolygon);
  const out = [];
  co.Execute(out, delta * SCALE);
  return toFloat(out).filter(p => p.length >= 3);
}

// Outline a set of open polylines to a filled polygon of given width
export function strokeLines(lines, width) {
  if (!lines.length) return [];
  const L = C();
  const co = new L.ClipperOffset(2, 0.01 * SCALE);
  co.AddPaths(toInt(lines), L.JoinType.jtRound, L.EndType.etOpenRound);
  const out = [];
  co.Execute(out, (width / 2) * SCALE);
  return toFloat(out);
}

export function minkowski(a, b) {
  const L = C();
  const res = [];
  const ai = toInt(a);
  for (const pattern of toInt(b)) {
    const sum = L.Clipper.MinkowskiSum(pattern, ai, true);
    res.push(...toFloat(sum));
  }
  return union([...res, ...a]);
}

export function area(path) {
  let s = 0;
  for (let i = 0, n = path.length; i < n; i++) {
    const [x1, y1] = path[i], [x2, y2] = path[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// Group a normalised polygon set into [{outer, holes:[...]}, ...]
export function toPolygonsWithHoles(paths) {
  if (!paths.length) return [];
  const L = C();
  const c = new L.Clipper();
  c.AddPaths(toInt(paths), L.PolyType.ptSubject, true);
  const tree = new L.PolyTree();
  c.Execute(L.ClipType.ctUnion, tree, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  const res = [];
  const walk = node => {
    for (const ch of node.Childs()) {
      if (!ch.IsHole()) {
        const outer = toFloat([ch.Contour()])[0];
        const holes = ch.Childs().map(h => toFloat([h.Contour()])[0]);
        res.push({ outer, holes });
        for (const h of ch.Childs()) walk(h);
      }
    }
  };
  walk(tree);
  return res;
}

export function bounds(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const [x, y] of p) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
