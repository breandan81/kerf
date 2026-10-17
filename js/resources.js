// Fonts, included files, images and SVGs for the interpreter. The
// interpreter is synchronous, so a lookup that isn't cached yet returns
// null and is recorded in `missing`; the app loads them and re-runs.
import { importSVG } from './geom/svgimport.js';

export class Resources {
  constructor() {
    this.fonts = new Map();
    this.texts = new Map();
    this.images = new Map();
    this.failed = new Map(); // key -> error message
    this.missing = new Map(); // key -> loader
    this.base = ''; // directory of the file being rendered, relative to project
  }

  resolve(path) {
    if (path.startsWith('/')) return path.slice(1);
    const parts = (this.base ? this.base.split('/') : []).concat(path.split('/'));
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    }
    return out.join('/');
  }

  get(map, key, loader) {
    if (map.has(key)) return map.get(key);
    if (!this.failed.has(key)) this.missing.set(key, () => loader().then(v => map.set(key, v)).catch(e => this.failed.set(key, e.message)));
    return null;
  }

  font(name) {
    return this.get(this.fonts, 'font:' + name, async () => {
      const r = await fetch('/api/font?name=' + encodeURIComponent(name));
      if (!r.ok) throw new Error(`font "${name}" not found`);
      return globalThis.opentype.parse(await r.arrayBuffer());
    });
  }

  text(path) {
    const p = this.resolve(path);
    return this.get(this.texts, 'file:' + p, async () => {
      const r = await fetch('/api/file?path=' + encodeURIComponent(p));
      if (!r.ok) throw new Error(`file "${p}" not found`);
      return r.text();
    });
  }

  image(path) {
    const p = this.resolve(path);
    return this.get(this.images, 'img:' + p, async () => {
      const r = await fetch('/api/file?path=' + encodeURIComponent(p));
      if (!r.ok) throw new Error(`image "${p}" not found`);
      const blob = await r.blob();
      const src = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
      const el = new Image();
      el.src = src;
      await el.decode();
      return { src, w: el.naturalWidth, h: el.naturalHeight, el };
    });
  }

  svg(text) { return importSVG(text); }

  // load everything requested by the last run; true if anything new arrived
  async loadMissing() {
    if (!this.missing.size) return false;
    const jobs = [...this.missing.values()];
    this.missing.clear();
    await Promise.all(jobs.map(j => j()));
    return true;
  }

  // forget project files (not fonts) so edits made outside Kerf are picked up
  refreshFiles() {
    this.texts.clear();
    this.images.clear();
    for (const k of [...this.failed.keys()]) if (!k.startsWith('font:')) this.failed.delete(k);
  }

  imageElement(src) {
    for (const v of this.images.values()) if (v.src === src) return v.el;
    return null;
  }
}
