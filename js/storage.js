// Where project files live. Three interchangeable backends:
//   ServerStore  — the local serve.py (./run.sh): files in a folder on disk
//   FolderStore  — hosted app in Chrome/Edge: a folder you pick (File System Access)
//   BrowserStore — hosted app anywhere: files kept in this browser (IndexedDB)
// Each has: kind, label, list() → [path], read(path) → Blob, write(path, string|Blob).

const PROJECT_EXT = /\.(kerf|scad|svg|png|jpe?g|gif|webp|bmp|ttf|otf|txt)$/i;

export class ServerStore {
  constructor(root) { this.kind = 'server'; this.root = root; this.label = root; }
  async list() { return (await (await fetch('/api/ls')).json()).files; }
  async read(path) {
    const r = await fetch('/api/file?path=' + encodeURIComponent(path));
    if (!r.ok) throw new Error(`"${path}" not found`);
    return r.blob();
  }
  async write(path, data) {
    const r = await fetch('/api/file?path=' + encodeURIComponent(path), { method: 'POST', body: data });
    if (!r.ok) throw new Error(`could not save "${path}"`);
  }
}

// ---------------------------------------------------------------- IndexedDB helpers
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kerf', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('files');
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
export const meta = {
  get: k => tx('meta', 'readonly', s => s.get(k)),
  set: (k, v) => tx('meta', 'readwrite', s => s.put(v, k)),
  del: k => tx('meta', 'readwrite', s => s.delete(k)),
};

export class BrowserStore {
  constructor() { this.kind = 'browser'; this.label = 'this browser'; }
  async list() { return ((await tx('files', 'readonly', s => s.getAllKeys())) || []).sort(); }
  async read(path) {
    const v = await tx('files', 'readonly', s => s.get(path));
    if (v == null) throw new Error(`"${path}" not found`);
    return v instanceof Blob ? v : new Blob([v]);
  }
  async write(path, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' });
    await tx('files', 'readwrite', s => s.put(blob, path));
  }
}

export class FolderStore {
  constructor(handle) { this.kind = 'folder'; this.dir = handle; this.label = handle.name; }
  async list() {
    const out = [];
    const walk = async (dir, prefix) => {
      for await (const [name, h] of dir.entries()) {
        if (name.startsWith('.') || name === 'node_modules') continue;
        if (h.kind === 'directory') await walk(h, prefix + name + '/');
        else if (PROJECT_EXT.test(name)) out.push(prefix + name);
      }
    };
    await walk(this.dir, '');
    return out.sort();
  }
  async handle(path, create) {
    const parts = path.split('/').filter(Boolean);
    let dir = this.dir;
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create });
    return dir.getFileHandle(parts[parts.length - 1], { create });
  }
  async read(path) {
    try { return await (await this.handle(path, false)).getFile(); } catch { throw new Error(`"${path}" not found`); }
  }
  async write(path, data) {
    const w = await (await this.handle(path, true)).createWritable();
    await w.write(data);
    await w.close();
  }
}

export const canPickFolder = () => typeof window.showDirectoryPicker === 'function';

// Files you opened from disk, held in memory for this session (the default
// on the website). Saving goes back to disk: in place via the file handle where
// the browser supports it (Chrome/Edge), otherwise as a download (Firefox).
export class WorkspaceStore {
  constructor() {
    this.kind = 'workspace';
    this.label = '';
    this.files = new Map(); // path -> {blob, handle}
  }
  async list() { return [...this.files.keys()].sort(); }
  // exact path, else a unique file with the same name (so image("assets/logo.png")
  // finds a logo.png you opened next to the .kerf)
  entry(path) {
    if (this.files.has(path)) return this.files.get(path);
    const base = path.split('/').pop();
    const hits = [...this.files.keys()].filter(k => k.split('/').pop() === base);
    return hits.length === 1 ? this.files.get(hits[0]) : null;
  }
  async read(path) {
    const e = this.entry(path);
    if (!e) throw new Error(`"${path}" isn't open. Click Open… and select it along with your .kerf file (or drag it onto the page)`);
    return e.blob;
  }
  async write(path, data, handle) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/plain' });
    const prev = this.files.get(path);
    this.files.set(path, { blob, handle: handle || (prev && prev.handle) || null });
  }
  handleFor(path) { const e = this.files.get(path); return e ? e.handle : null; }
  setHandle(path, handle) { const e = this.files.get(path); if (e) e.handle = handle; }
}

export const canSaveInPlace = () => typeof window.showSaveFilePicker === 'function';

// Files left in browser storage by the previous version of the site
export async function legacyBrowserFiles() {
  try {
    const st = new BrowserStore();
    const keys = (await st.list()).filter(k => !/^(tutorial\/|assets\/(star\.svg|sunburst\.png)$|box\.kerf$|sign\.kerf$)/.test(k));
    return Promise.all(keys.map(async k => [k, await st.read(k)]));
  } catch { return []; }
}

// Seed an empty store with the example projects
export async function seedExamples(store) {
  const files = await store.list();
  if (files.some(f => /\.(kerf|scad)$/.test(f))) return;
  const r = await fetch('examples/manifest.json');
  if (!r.ok) return;
  for (const f of await r.json()) {
    const b = await fetch('examples/' + f);
    if (b.ok) await store.write(f, await b.blob());
  }
}

// Pick the backend: local server if present, else a remembered folder
// (if the browser still grants access), else an in-memory workspace.
export async function detectStore() {
  // the local server (./run.sh) only ever runs on this machine
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) try {
    const r = await fetch('/api/ls');
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) return new ServerStore((await r.json()).root);
  } catch { /* hosted: no server */ }
  try {
    const h = await meta.get('folder');
    if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') return new FolderStore(h);
  } catch { /* no saved folder or no permission */ }
  return new WorkspaceStore();
}
