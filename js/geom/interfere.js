// Interference check between placed parts. Each part is a prism (its 2D
// body extruded by the material thickness, then moved by its 4x4). We
// sample points inside part A and test them against part B; touching faces
// don't count because samples sit at cell centres and B is shrunk by eps.
import { apply4 } from './mat4.js';
import { bounds } from './clip.js';

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
  const n = parts.length;
  parts = parts.concat(refs);
  const boxes = parts.map(worldBox);
  const inv = parts.map(p => invert4(p.m4));
  const hits = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.x1 <= B.x0 + eps || B.x1 <= A.x0 + eps || A.y1 <= B.y0 + eps || B.y1 <= A.y0 + eps || A.z1 <= B.z0 + eps || B.z1 <= A.z0 + eps) continue;
      const r = pairOverlap(parts[i], parts[j], inv[j], B, eps, maxStep);
      if (r.volume > 0) hits.push({ a: parts[i], b: parts[j], ...r });
    }
  }
  return hits;
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
