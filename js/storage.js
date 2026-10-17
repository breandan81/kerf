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
// (if the browser still grants access), else browser storage.
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
  return new BrowserStore();
}
