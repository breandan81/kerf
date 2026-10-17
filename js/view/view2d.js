// Canvas 2D view (mm, y up) with pan/zoom, used for the part view and
// the sheet layout. Items are {shape, m, color, label, ghost, selected, part}.

import { bounds } from '../geom/clip.js';

export class View2D {
  constructor(canvas, { imageFor, onPick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.imageFor = imageFor || (() => null);
    this.onPick = onPick || (() => {});
    this.scene = { items: [], sheets: [], axes: true };
    this.view = { x: 0, y: 0, z: 2 }; // screen = (mm - x) * z
    this.colors = {};
    this.needsFit = true;
    this.bindEvents();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setScene(scene, fit = false) {
    // pre-transform shapes into view space once
    this.scene = {
      ...scene,
      items: scene.items.map(it => ({ ...it, s: it.m ? it.shape.transform(it.m) : it.shape })),
    };
    if (fit || this.needsFit) this.fit();
    this.draw();
  }

  contentBounds() {
    const paths = [];
    for (const it of this.scene.items) paths.push(...it.s.allPaths());
    for (const sh of this.scene.sheets) paths.push([[sh.x, sh.y], [sh.x + sh.w, sh.y + sh.h]]);
    if (!paths.length) return { x0: -10, y0: -10, x1: 100, y1: 100 };
    return bounds(paths);
  }

  fit() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) { this.needsFit = true; return; }
    this.needsFit = false;
    const b = this.contentBounds();
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0);
    const z = Math.min(r.width / (w * 1.1), r.height / (h * 1.15));
    this.view = { z, x: (b.x0 + b.x1) / 2 - r.width / 2 / z, y: (b.y0 + b.y1) / 2 - r.height / 2 / z };
  }

  toScreen([x, y]) {
    const H = this.canvas.clientHeight;
    return [(x - this.view.x) * this.view.z, H - (y - this.view.y) * this.view.z];
  }
  toWorld(sx, sy) {
    const H = this.canvas.clientHeight;
    return [sx / this.view.z + this.view.x, (H - sy) / this.view.z + this.view.y];
  }

  bindEvents() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const k = Math.exp(-e.deltaY * 0.0015);
      this.view.z *= k;
      const [nx, ny] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.view.x += wx - nx;
      this.view.y += wy - ny;
      this.draw();
    }, { passive: false });
    c.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      this.mouse = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        this.view.x -= dx / this.view.z;
        this.view.y += dy / this.view.z;
        drag.x = e.clientX; drag.y = e.clientY;
      }
      this.draw();
    });
    c.addEventListener('pointerup', e => {
      if (drag && !drag.moved) {
        const r = c.getBoundingClientRect();
        const [x, y] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        const hit = [...this.scene.items].reverse().find(it => !it.ghost && pointIn(it.s.body, x, y));
        this.onPick(hit ? hit.part : null);
      }
      drag = null;
    });
    c.addEventListener('dblclick', () => { this.fit(); this.draw(); });
  }

  css(name, fallback) {
    if (!this.colors[name]) this.colors[name] = getComputedStyle(this.canvas).getPropertyValue(name).trim() || fallback;
    return this.colors[name];
  }

  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    if (!W || !H) return;
    if (this.needsFit) this.fit();
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    this.colors = {};
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.css('--canvas-bg', '#1b1d22');
    ctx.fillRect(0, 0, W, H);
    this.drawGrid(W, H);

    // world transform: mm → px, y up
    const { x, y, z } = this.view;
    const world = () => ctx.setTransform(dpr * z, 0, 0, -dpr * z, -x * z * dpr, (H + y * z) * dpr);
    const px = 1 / z; // one screen pixel in mm

    for (const sh of this.scene.sheets) {
      world();
      ctx.fillStyle = this.css('--sheet', '#2a2d33');
      ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
      ctx.strokeStyle = sh.oversize ? '#e55' : this.css('--sheet-edge', '#555');
      ctx.lineWidth = px;
      ctx.strokeRect(sh.x, sh.y, sh.w, sh.h);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [lx, ly] = this.toScreen([sh.x, sh.y + sh.h]);
      ctx.fillStyle = this.css('--muted', '#999');
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText(sh.label, lx, ly - 6);
    }

    for (const it of this.scene.items) {
      const s = it.s;
      world();
      ctx.globalAlpha = it.ghost ? 0.25 : 1;
      if (s.body.length) {
        ctx.beginPath();
        for (const p of s.body) tracePath(ctx, p, true);
        ctx.fillStyle = it.selected ? this.css('--selected', '#e8c56a') : (it.color || '#d9b38c');
        ctx.fill('evenodd');
      }
      for (const im of s.images) {
        const el = this.imageFor(im.src);
        if (!el) continue;
        ctx.save();
        const m = im.m;
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.transform(1, 0, 0, -1, 0, 1);
        ctx.globalAlpha *= 0.85;
        ctx.globalCompositeOperation = 'multiply';
        ctx.drawImage(el, 0, 0, 1, 1);
        ctx.restore();
        world();
      }
      if (s.engrave.length) {
        ctx.beginPath();
        for (const p of s.engrave) tracePath(ctx, p, true);
        ctx.fillStyle = 'rgba(60,35,20,0.85)';
        ctx.fill('evenodd');
      }
      ctx.lineWidth = 1.2 * px;
      ctx.lineJoin = 'round';
      if (s.score.length) {
        ctx.beginPath();
        for (const p of s.score) tracePath(ctx, p, false);
        ctx.strokeStyle = '#2f6bff';
        ctx.stroke();
      }
      ctx.beginPath();
      for (const p of s.body) tracePath(ctx, p, true);
      for (const p of s.lines) tracePath(ctx, p, false);
      ctx.strokeStyle = it.highlight ? '#ff4fd8' : '#e8322b';
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (it.label && this.scene.labels !== false) {
        const b = bounds(s.body.length ? s.body : s.allPaths());
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [lx, ly] = this.toScreen([(b.x0 + b.x1) / 2, b.y0]);
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = this.css('--muted', '#999');
        ctx.fillText(it.label, lx, ly + 13);
        ctx.textAlign = 'start';
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.mouse) {
      ctx.fillStyle = this.css('--muted', '#999');
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(`${this.mouse[0].toFixed(1)}, ${this.mouse[1].toFixed(1)} mm`, 8, H - 8);
    }
  }

  drawGrid(W, H) {
    const ctx = this.ctx;
    const z = this.view.z;
    // grid step: 1/10/100 mm depending on zoom
    let step = 1;
    while (step * z < 8) step *= 10;
    const [x0, y0] = this.toWorld(0, H), [x1, y1] = this.toWorld(W, 0);
    ctx.lineWidth = 1;
    for (const [s, col] of [[step, this.css('--grid', '#24272d')], [step * 10, this.css('--grid-major', '#2e323a')]]) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      for (let gx = Math.ceil(x0 / s) * s; gx <= x1; gx += s) { const [sx] = this.toScreen([gx, 0]); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, H); }
      for (let gy = Math.ceil(y0 / s) * s; gy <= y1; gy += s) { const [, sy] = this.toScreen([0, gy]); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(W, Math.round(sy) + 0.5); }
      ctx.stroke();
    }
    if (this.scene.axes) {
      const [ox, oy] = this.toScreen([0, 0]);
      ctx.strokeStyle = 'rgba(232,80,80,0.6)';
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(W, oy); ctx.stroke();
      ctx.strokeStyle = 'rgba(90,200,90,0.6)';
      ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox, 0); ctx.stroke();
    }
  }
}

function tracePath(ctx, p, closed) {
  if (!p.length) return;
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  if (closed) ctx.closePath();
}

function pointIn(paths, x, y) {
  let c = false;
  for (const p of paths) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

