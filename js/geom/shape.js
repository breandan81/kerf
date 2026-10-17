// A Shape is flat laser geometry with separate operation layers:
//   body    closed polygons that are cut out (the part outline + holes)
//   lines   open polylines that are cut (kerf lines, living hinges)
//   engrave filled regions to raster/fill engrave
//   score   polylines to line-engrave (score)
//   images  bitmaps to engrave: {src, m} where m maps the unit square
//           (0,0)-(1,1) into mm, y up
import * as clip from './clip.js';

// 2D affine [a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f
export const I2 = [1, 0, 0, 1, 0, 0];
export function mul2(m, n) { // m ∘ n (apply n first)
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
export const apply2 = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const translate2 = (x, y) => [1, 0, 0, 1, x, y];
export function rotate2(deg) {
  const c = cosd(deg), s = sind(deg);
  return [c, s, -s, c, 0, 0];
}
export const scale2 = (sx, sy) => [sx, 0, 0, sy, 0, 0];
export function mirror2(vx, vy) {
  const l = Math.hypot(vx, vy) || 1;
  const x = vx / l, y = vy / l;
  return [1 - 2 * x * x, -2 * x * y, -2 * x * y, 1 - 2 * y * y, 0, 0];
}

// exact values at multiples of 90° so rotated squares stay square
export function sind(d) {
  const m = ((d % 360) + 360) % 360;
  if (m === 0 || m === 180) return 0;
  if (m === 90) return 1;
  if (m === 270) return -1;
  return Math.sin(d * Math.PI / 180);
}
export function cosd(d) { return sind(d + 90); }

export class Shape {
  constructor(o = {}) {
    this.body = o.body || [];
    this.lines = o.lines || [];
    this.engrave = o.engrave || [];
    this.score = o.score || [];
    this.images = o.images || [];
    this.highlight = o.highlight || false;
  }

  static empty() { return new Shape(); }

  // closed paths given in any orientation become a normalised body
  static fromPaths(paths, fill = 'nonzero') {
    return new Shape({ body: clip.union(paths.filter(p => p.length >= 3), fill) });
  }

  isEmpty() {
    return !this.body.length && !this.lines.length && !this.engrave.length && !this.score.length && !this.images.length;
  }

  transform(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    const tp = paths => paths.map(p => {
      const q = p.map(pt => apply2(m, pt));
      return det < 0 ? q.reverse() : q;
    });
    const tl = lines => lines.map(p => p.map(pt => apply2(m, pt)));
    return new Shape({
      body: tp(this.body),
      lines: tl(this.lines),
      engrave: tp(this.engrave),
      score: tl(this.score),
      images: this.images.map(im => ({ ...im, m: mul2(m, im.m) })),
      highlight: this.highlight,
    });
  }

  // everything but the body is carried along unchanged
  withBody(body) {
    return new Shape({ ...this, body });
  }

  static merge(shapes, bodyOp = 'union') {
    const s = new Shape();
    for (const c of shapes) {
      s.lines.push(...c.lines);
      s.engrave.push(...c.engrave);
      s.score.push(...c.score);
      s.images.push(...c.images);
      s.highlight = s.highlight || c.highlight;
    }
    if (bodyOp === 'union') s.body = clip.union(shapes.flatMap(c => c.body));
    if (s.engrave.length) s.engrave = clip.union(s.engrave);
    return s;
  }

  allPaths() {
    return [...this.body, ...this.lines, ...this.engrave, ...this.score,
      ...this.images.map(im => [[0, 0], [1, 0], [1, 1], [0, 1]].map(p => apply2(im.m, p)))];
  }

  bounds() { return clip.bounds(this.allPaths()); }
}
