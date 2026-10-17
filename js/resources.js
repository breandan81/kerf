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
    this.store = null; // storage backend (see storage.js)
    this.notes = new Map(); // font name -> substitution message for the console
    this.bundled = null; // fonts shipped with the app (hosted mode)
  }

  resolve(path) {
    const desktop = this.store && this.store.kind === 'desktop';
    if (path.startsWith('/')) return desktop ? path : path.slice(1);
    const parts = (this.base ? this.base.split('/') : []).concat(path.split('/'));
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p && p !== '.') out.push(p);
    }
    return (this.base.startsWith('/') ? '/' : '') + out.join('/');
  }

  get(map, key, loader) {
    if (map.has(key)) return map.get(key);
    if (!this.failed.has(key)) this.missing.set(key, () => loader().then(v => map.set(key, v)).catch(e => this.failed.set(key, e.message)));
    return null;
  }

  // "Family:style=Style" (installed font via the local server, or one bundled
  // with the app when hosted), or a .ttf/.otf file in the project
  font(name) {
    if (/\.(ttf|otf)$/i.test(name)) {
      const p = this.resolve(name);
      return this.get(this.fonts, 'font:' + p, async () => globalThis.opentype.parse(await (await this.store.read(p)).arrayBuffer()));
    }
    return this.get(this.fonts, 'font:' + name, async () => {
      if (this.store.kind === 'desktop') {
        const u8 = await window.kerfDesktop.font(name);
        return globalThis.opentype.parse(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
      }
      if (this.store.kind === 'server') {
        const r = await fetch('/api/font?name=' + encodeURIComponent(name));
        if (!r.ok) throw new Error(`font "${name}" not found`);
        return globalThis.opentype.parse(await r.arrayBuffer());
      }
      if (!this.bundled) this.bundled = await (await fetch('fonts/fonts.json')).json();
      const file = this.matchBundled(name);
      const r = await fetch('fonts/' + file);
      if (!r.ok) throw new Error(`font file ${file} missing`);
      return globalThis.opentype.parse(await r.arrayBuffer());
    });
  }

  matchBundled(name) {
    const [fam, style = 'Regular'] = name.split(':style=');
    const keys = Object.keys(this.bundled);
    const want = `${fam.trim()}:style=${style.trim()}`.toLowerCase();
    let k = keys.find(x => x.toLowerCase() === want);
    if (!k) {
      k = keys.find(x => x.toLowerCase() === `${fam.trim().toLowerCase()}:style=regular`) || 'Liberation Sans:style=Regular';
      this.notes.set(name, `font "${name}" isn't available here; using ${k.replace(':style=Regular', '')}. Built-in fonts: ` +
        [...new Set(keys.map(x => x.split(':')[0]))].join(', ') + ' (or put a .ttf/.otf in your project and use font = "file.ttf")');
    }
    return this.bundled[k];
  }

  text(path) {
    const p = this.resolve(path);
    return this.get(this.texts, 'file:' + p, async () => (await this.store.read(p)).text());
  }

  image(path) {
    const p = this.resolve(path);
    return this.get(this.images, 'img:' + p, async () => {
      const blob = await this.store.read(p);
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
