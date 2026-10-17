// Minimal SVG → paths importer (path, rect, circle, ellipse, line,
// polyline, polygon, nested transforms). Output is mm, y up, with the
// document's bottom-left at the origin like OpenSCAD's import().
// Needs a DOM (DOMParser), so it runs in the browser only.
import { mul2, apply2, I2 } from '../geom/shape.js';

const UNIT = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

function parseLength(s) {
  if (s == null) return null;
  const m = /^\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*([a-z%]*)/i.exec(s);
  if (!m || m[2] === '%') return null;
  return parseFloat(m[1]) * (UNIT[m[2].toLowerCase()] ?? UNIT.px);
}

function parseTransform(s) {
  let m = I2;
  if (!s) return m;
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(s))) {
    const a = t[2].trim().split(/[\s,]+/).map(Number);
    let n = I2;
    switch (t[1]) {
      case 'matrix': n = a; break;
      case 'translate': n = [1, 0, 0, 1, a[0], a[1] || 0]; break;
      case 'scale': n = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
      case 'rotate': {
        const r = a[0] * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
        n = [c, sn, -sn, c, 0, 0];
        if (a.length === 3) n = mul2([1, 0, 0, 1, a[1], a[2]], mul2(n, [1, 0, 0, 1, -a[1], -a[2]]));
        break;
      }
      case 'skewX': n = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': n = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    m = mul2(m, n);
  }
  return m;
}

// returns {closed:[...], open:[...]} in local coordinates
export function parsePathData(d, tol = 0.05) {
  const toks = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0;
  const closed = [], open = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = '', lcx = 0, lcy = 0, lqx = 0, lqy = 0;
  const num = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/[a-zA-Z]/.test(toks[i]);
  const finish = (isClosed) => {
    if (cur && cur.length > 1) (isClosed ? closed : open).push(cur);
    cur = null;
  };
  const lineTo = (nx, ny) => { if (!cur) cur = [[x, y]]; cur.push([nx, ny]); x = nx; y = ny; };
  const nseg = len => Math.max(2, Math.min(64, Math.ceil(len / tol / 4)));
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    const n = nseg(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2));
    const x0 = x, y0 = y;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      lineTo(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey);
    }
  };
  const quad = (x1, y1, ex, ey) => {
    const n = nseg(Math.hypot(x1 - x, y1 - y) + Math.hypot(ex - x1, ey - y1));
    const x0 = x, y0 = y;
    for (let k = 1; k <= n; k++) {
      const t = k / n, u = 1 - t;
      lineTo(u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey);
    }
  };
  const arc = (rx, ry, phi, large, sweep, ex, ey) => {
    // endpoint → center parameterisation (SVG spec F.6.5)
    if (rx === 0 || ry === 0) return lineTo(ex, ey);
    rx = Math.abs(rx); ry = Math.abs(ry);
    const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
    const dx = (x - ex) / 2, dy = (y - ey) / 2;
    const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const num_ = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    let co = Math.sqrt(Math.max(0, num_ / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    if (large === sweep) co = -co;
    const cx1 = co * rx * y1 / ry, cy1 = -co * ry * x1 / rx;
    const cx = cp * cx1 - sp * cy1 + (x + ex) / 2, cy = sp * cx1 + cp * cy1 + (y + ey) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil(Math.abs(dt) * Math.max(rx, ry) / (tol * 4)));
    for (let k = 1; k <= Math.min(n, 256); k++) {
      const t = t1 + dt * k / Math.min(n, 256);
      lineTo(cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp);
    }
  };
  while (i < toks.length) {
    if (!isNum()) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        finish(false);
        x = num() + ox; y = num() + oy; sx = x; sy = y;
        cur = [[x, y]];
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': lineTo(num() + ox, num() + oy); break;
      case 'H': lineTo(num() + ox, y); break;
      case 'V': lineTo(x, num() + oy); break;
      case 'C': {
        const a = [num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy];
        cubic(...a); lcx = a[2]; lcy = a[3]; break;
      }
      case 'S': {
        const x1 = 2 * x - lcx, y1 = 2 * y - lcy;
        const a = [num() + ox, num() + oy, num() + ox, num() + oy];
        cubic(x1, y1, ...a); lcx = a[0]; lcy = a[1]; break;
      }
      case 'Q': {
        const a = [num() + ox, num() + oy, num() + ox, num() + oy];
        quad(...a); lqx = a[0]; lqy = a[1]; break;
      }
      case 'T': {
        const x1 = 2 * x - lqx, y1 = 2 * y - lqy;
        quad(x1, y1, num() + ox, num() + oy); lqx = x1; lqy = y1; break;
      }
      case 'A': {
        const rx = num(), ry = num(), phi = num(), large = num(), sweep = num();
        arc(rx, ry, phi, !!large, !!sweep, num() + ox, num() + oy);
        break;
      }
      case 'Z':
        if (cur) { cur.push([sx, sy]); finish(true); }
        x = sx; y = sy;
        break;
      default:
        i++;
    }
    if (!'CS'.includes(cmd.toUpperCase())) { lcx = x; lcy = y; }
    if (!'QT'.includes(cmd.toUpperCase())) { lqx = x; lqy = y; }
  }
  finish(false);
  return { closed, open };
}

function ellipse(cx, cy, rx, ry, n = 64) {
  const p = [];
  for (let k = 0; k < n; k++) {
    const t = 2 * Math.PI * k / n;
    p.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
  }
  return p;
}

// Returns {closed, open} in mm, y up, origin bottom-left of the document
export function importSVG(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (!svg || svg.nodeName !== 'svg') throw new Error('not an SVG file');
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  let W = parseLength(svg.getAttribute('width')), H = parseLength(svg.getAttribute('height'));
  let root;
  if (vb.length === 4 && vb.every(isFinite)) {
    if (W == null) W = vb[2] * UNIT.px;
    if (H == null) H = vb[3] * UNIT.px;
    root = mul2([W / vb[2], 0, 0, H / vb[3], 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);
  } else {
    root = [UNIT.px, 0, 0, UNIT.px, 0, 0];
    if (H == null) H = 0;
  }
  // flip y so the document's bottom edge is y=0
  root = mul2([1, 0, 0, -1, 0, H], root);
  const closed = [], open = [];
  const add = (res, m) => {
    for (const p of res.closed) closed.push(p.map(q => apply2(m, q)));
    for (const p of res.open) open.push(p.map(q => apply2(m, q)));
  };
  const num = (el, a) => parseFloat(el.getAttribute(a) || '0');
  const walk = (el, m) => {
    if (el.nodeType !== 1) return;
    const name = el.localName;
    if (['defs', 'clipPath', 'mask', 'symbol', 'metadata', 'title', 'desc', 'style'].includes(name)) return;
    if (el.getAttribute('display') === 'none') return;
    m = mul2(m, parseTransform(el.getAttribute('transform')));
    switch (name) {
      case 'path': add(parsePathData(el.getAttribute('d') || ''), m); break;
      case 'rect': {
        const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
        add({ closed: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], open: [] }, m);
        break;
      }
      case 'circle': add({ closed: [ellipse(num(el, 'cx'), num(el, 'cy'), num(el, 'r'), num(el, 'r'))], open: [] }, m); break;
      case 'ellipse': add({ closed: [ellipse(num(el, 'cx'), num(el, 'cy'), num(el, 'rx'), num(el, 'ry'))], open: [] }, m); break;
      case 'line': add({ closed: [], open: [[[num(el, 'x1'), num(el, 'y1')], [num(el, 'x2'), num(el, 'y2')]]] }, m); break;
      case 'polyline':
      case 'polygon': {
        const v = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const pts = [];
        for (let k = 0; k + 1 < v.length; k += 2) pts.push([v[k], v[k + 1]]);
        add(name === 'polygon' ? { closed: [pts], open: [] } : { closed: [], open: [pts] }, m);
        break;
      }
    }
    for (const ch of el.children) walk(ch, m);
  };
  walk(svg, root);
  return { closed, open, width: W, height: H };
}
