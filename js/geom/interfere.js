// Interference check between placed parts. Each part is a prism (its 2D
// body extruded by the material thickness, then moved by its 4x4). We
// sample points inside part A and test them against part B; touching faces
// don't count because samples sit at cell centres and B is shrunk by eps.
import { apply4 } from './mat4.js';
import { bounds, offset, intersection, clipLines, area, union } from './clip.js';
import { mul4 } from './mat4.js';

function invert4(m) {
  // rigid/affine inverse via general 4x4 inversion
  const a = m, inv = new Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  return inv.map(v => v / det);
}

// even-odd point in polygon set
function inside(paths, x, y) {
  let c = false;
  for (const p of paths) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
  }
  return c;
}

// distance from a point to the nearest edge of the polygon set
function edgeDist(paths, x, y) {
  let d = Infinity;
  for (const p of paths) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [x1, y1] = p[j], [x2, y2] = p[i];
      const dx = x2 - x1, dy = y2 - y1;
      const l2 = dx * dx + dy * dy || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2));
      const e = Math.hypot(x - x1 - t * dx, y - y1 - t * dy);
      if (e < d) d = e;
    }
  }
  return d;
}

function worldBox(part) {
  const b = bounds(part.shape.body);
  const t = part.material.thickness;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const x of [b.x0, b.x1]) for (const y of [b.y0, b.y1]) for (const z of [0, t]) {
    const [X, Y, Z] = apply4(part.m4, [x, y, z]);
    x0 = Math.min(x0, X); y0 = Math.min(y0, Y); z0 = Math.min(z0, Z);
    x1 = Math.max(x1, X); y1 = Math.max(y1, Y); z1 = Math.max(z1, Z);
  }
  return { x0, y0, z0, x1, y1, z1 };
}

// Reference solids as prisms: cubes and straight cylinders (cones use their
// larger radius, spheres are skipped).
export function solidsAsPrisms(solids) {
  const out = [];
  for (const s of solids) {
    let body, h;
    if (s.kind === 'cube') {
      const [x, y, z] = s.size;
      body = [[[0, 0], [x, 0], [x, y], [0, y]]];
      h = z;
    } else if (s.kind === 'cylinder') {
      const r = Math.max(s.r1, s.r2);
      body = [Array.from({ length: 48 }, (_, i) => [r * Math.cos(i * Math.PI / 24), r * Math.sin(i * Math.PI / 24)])];
      h = s.h;
    } else continue;
    out.push({ name: `reference ${s.kind} (line ${s.line})`, ref: true, line: s.line, shape: { body }, material: { thickness: h }, m4: s.m4 });
  }
  return out;
}

// returns [{a, b, volume, points: [[x,y,z]...]}] for overlapping pairs.
// refs (from solidsAsPrisms) are checked against parts, not each other.
export function findInterference(parts, { eps = 0.02, maxStep = 0.5, refs = [] } = {}) {
  // a bent (flex) panel is checked as its rigid strips; strips of one panel
  // aren't checked against each other, and hits are reported per panel
  const owner = [];
  parts = parts.flatMap(p => (p.bend
    ? p.bend.map(b => { owner.push(p); return { ...p, shape: b.shape, m4: mul4(p.m4, b.m4) }; })
    : [(owner.push(p), p)]));
  const n = parts.length;
  parts = parts.concat(refs);
  for (const r of refs) owner.push(r);
  const boxes = parts.map(worldBox);
  const inv = parts.map(p => invert4(p.m4));
  const found = new Map();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (owner[i] === owner[j]) continue;
      const A = boxes[i], B = boxes[j];
      if (A.x1 <= B.x0 + eps || B.x1 <= A.x0 + eps || A.y1 <= B.y0 + eps || B.y1 <= A.y0 + eps || A.z1 <= B.z0 + eps || B.z1 <= A.z0 + eps) continue;
      // exact clipping needs no safety margin: touching faces have zero area
      const r = exactOverlap(parts[i], parts[j], inv[j], 0) || pairOverlap(parts[i], parts[j], inv[j], B, eps, maxStep);
      if (r.volume <= 0) continue;
      const key = owner[i].id + ':' + (owner[j].ref ? 'ref' + j : owner[j].id);
      const h = found.get(key) || { a: owner[i], b: owner[j], volume: 0, points: [] };
      h.volume += r.volume;
      if (h.points.length < 2000) h.points.push(...r.points);
      found.set(key, h);
    }
  }
  return [...found.values()].filter(h => h.volume > 0.05);
}

function pairOverlap(pa, pb, invB, boxB, eps, maxStep) {
  const ta = pa.material.thickness, tb = pb.material.thickness;
  const step = Math.min(maxStep, ta / 4);
  const ba = bounds(pa.shape.body);
  const bodyB = pb.shape.body;
  const pts = [];
  let count = 0;
  const nz = Math.max(2, Math.round(ta / step));
  for (let x = ba.x0 + step / 2; x < ba.x1; x += step) {
    for (let y = ba.y0 + step / 2; y < ba.y1; y += step) {
      let inA = null;
      for (let k = 0; k < nz; k++) {
        const z = (k + 0.5) * ta / nz;
        const w = apply4(pa.m4, [x, y, z]);
        if (w[0] < boxB.x0 || w[0] > boxB.x1 || w[1] < boxB.y0 || w[1] > boxB.y1 || w[2] < boxB.z0 || w[2] > boxB.z1) continue;
        const l = apply4(invB, w);
        if (l[2] <= eps || l[2] >= tb - eps) continue;
        if (!inside(bodyB, l[0], l[1]) || edgeDist(bodyB, l[0], l[1]) < eps) continue;
        if (inA === null) inA = inside(pa.shape.body, x, y) && edgeDist(pa.shape.body, x, y) >= eps;
        if (!inA) break;
        count++;
        if (pts.length < 400) pts.push(w);
      }
    }
  }
  return { volume: count * step * step * ta / nz, points: pts };
}

// Exact overlap for the usual laser case: sheets parallel or perpendicular.
// Returns null for oblique pairs (the sampler handles those).
function exactOverlap(pa, pb, invB, eps) {
  const M = mul4(invB, pa.m4); // A-local → B-local
  const ta = pa.material.thickness, tb = pb.material.thickness;
  const nz = M[10]; // A's normal · B's normal
  const polyA = eps ? offset(pa.shape.body, -eps, 'miter') : pa.shape.body;
  const polyB = eps ? offset(pb.shape.body, -eps, 'miter') : pb.shape.body;
  if (!polyA.length || !polyB.length) return { volume: 0, points: [] };
  const pts = [];
  const toWorld = (x, y, z) => {
    const m = pa.m4;
    return [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
  };
  if (Math.abs(Math.abs(nz) - 1) < 1e-6) {
    // parallel sheets: map A's outline into B's plane, intersect, times z overlap
    const w0 = M[11], w1 = M[11] + M[10] * ta;
    const dz = Math.min(Math.max(w0, w1), tb - eps) - Math.max(Math.min(w0, w1), eps);
    if (dz <= 0) return { volume: 0, points: [] };
    const mapped = polyA.map(p => p.map(([x, y]) => [M[0] * x + M[1] * y + M[3], M[4] * x + M[5] * y + M[7]]));
    const inter = intersection(mapped, polyB);
    const a = Math.abs(inter.reduce((s, p) => s + area(p), 0));
    // points back in world space via B's frame
    const mb = pb.m4, wz = (Math.max(Math.min(w0, w1), 0) + Math.min(Math.max(w0, w1), tb)) / 2;
    for (const p of inter) for (const [u, v] of p) pts.push([mb[0] * u + mb[1] * v + mb[2] * wz + mb[3], mb[4] * u + mb[5] * v + mb[6] * wz + mb[7], mb[8] * u + mb[9] * v + mb[10] * wz + mb[11]]);
    return { volume: a * dz, points: pts };
  }
  if (Math.abs(nz) > 1e-6) return null;
  // perpendicular: in A's plane at height c, B is a set of strips
  const gx = M[8], gy = M[9];          // gradient of B's w across A's plane
  const g2 = gx * gx + gy * gy;
  if (g2 < 1e-12) return null;
  const ex = -gy / Math.sqrt(g2), ey = gx / Math.sqrt(g2); // along the strips
  const nx = gx / g2, ny = gy / g2;                       // per unit of w
  const ba = bounds(polyA);
  const corners = [[ba.x0, ba.y0], [ba.x1, ba.y0], [ba.x0, ba.y1], [ba.x1, ba.y1]];
  const sProj = corners.map(([x, y]) => x * ex + y * ey);
  const sMin = Math.min(...sProj) - 1, sMax = Math.max(...sProj) + 1;
  const levels = 8;
  let volume = 0;
  for (let k = 0; k < levels; k++) {
    const c = (k + 0.5) * ta / levels;
    // A-plane point with w = 0 and s = 0
    const w0 = M[10] * c + M[11];
    const px = -w0 * nx, py = -w0 * ny;
    const uv = (x, y) => [M[0] * x + M[1] * y + M[2] * c + M[3], M[4] * x + M[5] * y + M[6] * c + M[7]];
    const P0 = uv(px, py);
    const P1 = uv(px + ex, py + ey);
    const D = [P1[0] - P0[0], P1[1] - P0[1]];
    const D2 = D[0] * D[0] + D[1] * D[1];
    const segs = clipLines([[[P0[0] + sMin * D[0], P0[1] + sMin * D[1]], [P0[0] + sMax * D[0], P0[1] + sMax * D[1]]]], polyB, true);
    const rects = [];
    for (const seg of segs) {
      const ss = seg.map(([u, v]) => ((u - P0[0]) * D[0] + (v - P0[1]) * D[1]) / D2);
      const s0 = Math.min(...ss), s1 = Math.max(...ss);
      if (s1 - s0 <= 0) continue;
      const at = (s, w) => [px + s * ex + w * nx, py + s * ey + w * ny];
      rects.push([at(s0, eps), at(s1, eps), at(s1, tb - eps), at(s0, tb - eps)]);
    }
    if (!rects.length) continue;
    const inter = intersection(polyA, union(rects));
    const a = Math.abs(inter.reduce((s, p) => s + area(p), 0));
    volume += a * ta / levels;
    if (a > 0) for (const p of inter) for (const [x, y] of p) pts.push(toWorld(x, y, c));
  }
  return { volume, points: pts.slice(0, 2000) };
}
