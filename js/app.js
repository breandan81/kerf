// Kerf app: editor ↔ interpreter ↔ views.
import { Interpreter } from './lang/interp.js';
import { KerfError } from './lang/parser.js';
import { Resources } from './resources.js';
import { View2D } from './view/view2d.js';
import { View3D } from './view/view3d.js';
import { layoutParts } from './geom/layout.js';
import { sheetToSVG } from './geom/export.js';
import { findInterference, solidsAsPrisms } from './geom/interfere.js';
import { bounds } from './geom/clip.js';
import { HELP } from './help.js';
import { LESSONS } from './tutorial.js';
import { detectStore, seedExamples, FolderStore, canPickFolder, canSaveInPlace, legacyBrowserFiles, meta } from './storage.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem('kerf.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('kerf.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ------------------------------------------------------------------ editor
const BUILTINS = 'square|circle|polygon|text|import|image|line|translate|rotate|scale|mirror|multmatrix|resize|offset|hull|minkowski|union|difference|intersection|color|children|echo|assert|cube|cylinder|sphere|group|render';
const LASER = 'part|material|engrave|score|cut|thickness';
CodeMirror.defineSimpleMode('kerf', {
  start: [
    { regex: /\/\/.*/, token: 'comment' },
    { regex: /\/\*/, token: 'comment', next: 'comment' },
    { regex: /"(?:[^\\"]|\\.)*?(?:"|$)/, token: 'string' },
    { regex: /(?:include|use)\s*<[^>]*>/, token: 'meta' },
    { regex: /\b(?:module|function|if|else|for|let|each)\b/, token: 'keyword' },
    { regex: /\b(?:true|false|undef|PI)\b/, token: 'atom' },
    { regex: new RegExp(`\\b(?:${LASER})\\b(?=\\s*\\()`), token: 'laser' },
    { regex: new RegExp(`\\b(?:${BUILTINS})\\b(?=\\s*\\()`), token: 'builtin' },
    { regex: /\$\w+/, token: 'variable-2' },
    { regex: /(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i, token: 'number' },
    { regex: /[-+*/%^=<>!&|?:#]+/, token: 'operator' },
    { regex: /[\w$]+/, token: 'variable' },
  ],
  comment: [{ regex: /.*?\*\//, token: 'comment', next: 'start' }, { regex: /.*/, token: 'comment' }],
  meta: { lineComment: '//', blockCommentStart: '/*', blockCommentEnd: '*/', electricChars: '}' },
});

const editor = CodeMirror($('editor'), {
  mode: 'kerf', lineNumbers: true, indentUnit: 2, tabSize: 2, matchBrackets: true,
  autoCloseBrackets: true, styleActiveLine: true,
  extraKeys: {
    'Ctrl-S': () => save(), 'Cmd-S': () => save(),
    'Shift-Ctrl-S': () => save({ as: store_.kind === 'workspace' }), 'Shift-Cmd-S': () => save({ as: store_.kind === 'workspace' }),
    'F5': () => render({ manual: true }), 'Ctrl-Enter': () => render({ manual: true }),
    'Ctrl-/': 'toggleComment', 'Cmd-/': 'toggleComment',
    'Tab': cm => (cm.somethingSelected() ? cm.indentSelection('add') : cm.replaceSelection('  ')),
  },
});

// ------------------------------------------------------------------ state
const res = new Resources();
let stdlib = '';
let current = null; // project path of the open file
let savedText = '';
let result = null;
let sheetsResult = null;
let hits = [];
let selected = null;
let view = store.get('view', '3d');
let renderSeq = 0;
let store_ = null; // file storage backend (storage.js)

const imageFor = src => res.imageElement(src);
const pick = p => { selected = p ? p.id : null; refreshViews(); };
const v3 = new View3D($('v3d'), { imageFor, onPick: pick });
const v2 = new View2D($('v2d'), { imageFor, onPick: pick });

// ------------------------------------------------------------------ files
async function listFiles(select) {
  const files = await store_.list();
  const kerf = files.filter(f => f.endsWith('.kerf') || f.endsWith('.scad'));
  const sel = $('file');
  sel.innerHTML = '';
  for (const f of kerf) sel.add(new Option(f, f));
  if (select) sel.value = select;
  return kerf;
}

function showWhere() {
  const k = store_.kind;
  $('where').textContent = k === 'folder' ? '📁 ' + store_.label : '';
  $('where').title = k === 'folder' ? 'Files are read from and saved to this folder on your computer' : '';
  $('openfolder').hidden = k === 'server' || !canPickFolder();
  $('open').hidden = k !== 'workspace';
  $('saveas').hidden = k !== 'workspace';
}

async function openFile(path) {
  if (isDirty() && !confirm(`Discard unsaved changes to ${current}?`)) { $('file').value = current; return; }
  const text = await (await store_.read(path)).text();
  current = path;
  savedText = path === recovered ? '' : text; // recovered drafts start out unsaved
  res.base = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  res.refreshFiles();
  editor.setValue(text);
  editor.clearHistory();
  store.set('file', path);
  $('file').value = path;
  v3.first = true;
  v2.needsFit = true;
  updateDirty();
  render({ manual: true });
}

async function save({ as = false } = {}) {
  if (!current) return;
  const text = editor.getValue();
  if (store_.kind === 'workspace') {
    const name = await saveToDisk(current, text, as);
    if (!name) return; // cancelled
    if (name !== current.split('/').pop()) {
      // saved under a new name: that becomes the open file
      await store_.write(name, text, store_.handleFor(current));
      if (as && canSaveInPlace()) store_.setHandle(current, null);
      current = name;
      res.base = '';
      await listFiles(current);
      store.set('file', current);
    }
    log('ok', canSaveInPlace() ? `saved ${name}` : `saved ${name} (downloaded — set Firefox to "Always ask where to save files" to pick the folder)`);
  } else {
    await store_.write(current, text);
    log('ok', `saved ${current}`);
  }
  savedText = text;
  recovered = null;
  store.set('draft', null);
  updateDirty();
}

// Write a file to the user's disk: in place via a file handle (Chrome/Edge),
// otherwise as a download. Returns the file name, or null if cancelled.
async function saveToDisk(path, text, as) {
  await store_.write(path, text);
  let name = path.split('/').pop();
  if (canSaveInPlace()) {
    let handle = as ? null : store_.handleFor(path);
    try {
      if (!handle) {
        handle = await window.showSaveFilePicker({
          suggestedName: name, id: 'kerf',
          types: [{ description: 'Kerf design', accept: { 'text/plain': ['.kerf', '.scad'] } }],
        });
      }
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      store_.setHandle(path, handle);
      return handle.name;
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  if (as) {
    const n = prompt('Save as', name);
    if (!n) return null;
    name = /\.(kerf|scad)$/.test(n) ? n : n + '.kerf';
  }
  download(name, text, 'text/plain');
  return name;
}

const isDirty = () => current && editor.getValue() !== savedText;
function updateDirty() { $('dirty').hidden = !isDirty(); document.title = (isDirty() ? '● ' : '') + (current || '') + ' — Kerf'; }

$('file').addEventListener('change', e => openFile(e.target.value));
$('save').addEventListener('click', () => save());
$('saveas').addEventListener('click', () => save({ as: true }));
$('new').addEventListener('click', async () => {
  let name = prompt('New file name', 'untitled.kerf');
  if (!name) return;
  if (!/\.(kerf|scad)$/.test(name)) name += '.kerf';
  const files = await listFiles();
  if (files.includes(name)) return openFile(name);
  const tmpl = `// ${name}\nmaterial("ply3", thickness = 3, sheet = [400, 300], kerf = 0.1);\n\npart("plate", "ply3") {\n  difference() {\n    rounded_square([80, 50], r = 4);\n    translate([10, 25]) circle(d = 4);\n  }\n  engrave() translate([45, 25]) text("Kerf", size = 10, halign = "center", valign = "center");\n}\n`;
  await store_.write(name, tmpl);
  await listFiles(name);
  savedText = editor.getValue(); // the old file's dirty state was already confirmed
  current = null;
  openFile(name);
});
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------------ render
let timer = null;
let recovered = null; // path of a draft restored after a crash/reload
editor.on('change', () => {
  updateDirty();
  // keep a draft of unsaved work in case the tab is closed or crashes
  if (store_ && store_.kind === 'workspace') store.set('draft', isDirty() ? { path: current, text: editor.getValue() } : null);
  if ($('auto').checked) { clearTimeout(timer); timer = setTimeout(() => render(), 450); }
});

function clearMarks() {
  for (let i = 0; i < editor.lineCount(); i++) {
    editor.removeLineClass(i, 'background', 'errline');
    editor.removeLineClass(i, 'background', 'warnline');
  }
}

async function render({ manual = false } = {}) {
  const seq = ++renderSeq;
  if (manual) res.refreshFiles();
  const src = editor.getValue();
  const t0 = performance.now();
  let out = null, error = null;
  for (let pass = 0; pass < 4; pass++) {
    try {
      const it = new Interpreter(res, { stdlib, file: current || 'main' });
      out = it.run(src);
      error = null;
    } catch (e) {
      error = e;
      out = null;
    }
    if (!(await res.loadMissing())) break;
    if (seq !== renderSeq) return;
  }
  if (seq !== renderSeq) return;
  clearMarks();
  $('console').innerHTML = '';
  for (const [k, msg] of res.failed) if (src.includes(k.split(':').slice(1).join(':').split('/').pop())) log('err', msg);
  for (const [name, msg] of res.notes) if (src.includes(name)) log('warn', 'FONT: ' + msg);
  if (error) {
    const where = error.line ? `${error.file && error.file !== current ? error.file + ', ' : ''}line ${error.line}` : '';
    log('err', `ERROR: ${error.message}${where ? ' (' + where + ')' : ''}`, error instanceof KerfError && error.file === (current || 'main') ? error.line : null);
    if (error.line && (!error.file || error.file === (current || 'main'))) editor.addLineClass(error.line - 1, 'background', 'errline');
    if (!(error instanceof KerfError)) console.error(error);
    $('stats').textContent = 'error';
    return;
  }
  result = out;
  for (const e of out.echo) log('echo', `ECHO: ${e.text}`, e.file === (current || 'main') ? e.line : null);
  for (const w of out.warnings) {
    const mine = !w.file || w.file === (current || 'main');
    log('warn', `WARNING: ${w.msg}${w.line ? ` (${mine ? '' : w.file + ', '}line ${w.line})` : ''}`, mine ? w.line : null);
    if (mine && w.line) editor.addLineClass(w.line - 1, 'background', 'warnline');
  }
  sheetsResult = layoutParts(out.parts);
  for (const w of sheetsResult.warnings) log('warn', 'LAYOUT: ' + w);
  if (selected && !out.parts.some(p => p.id === selected)) selected = null;
  // part ids change each run; keep selection by name
  if (selected == null && store.get('sel')) {
    const p = out.parts.find(q => q.name === store.get('sel'));
    if (p) selected = p.id;
  }
  const ms = performance.now() - t0;
  checkFit();
  refreshViews();
  const pieces = out.parts.reduce((s, p) => s + p.qty, 0);
  $('stats').textContent = `${out.parts.length} part${out.parts.length === 1 ? '' : 's'} · ${pieces} piece${pieces === 1 ? '' : 's'} · ${sheetsResult.sheets.length} sheet${sheetsResult.sheets.length === 1 ? '' : 's'} · ${ms.toFixed(0)} ms`;
}

function checkFit() {
  const el = $('fitstatus');
  hits = [];
  if (result.parts.length > 60) { el.textContent = 'fit check skipped (>60 parts)'; el.className = 'fitstatus'; return; }
  hits = findInterference(result.parts, { refs: solidsAsPrisms(result.solids) });
  if (!result.parts.length) { el.textContent = ''; return; }
  if (!hits.length) {
    el.textContent = result.parts.length > 1 ? '✓ no collisions' : '';
    el.className = 'fitstatus ok';
  } else {
    el.textContent = `✗ ${hits.length} collision${hits.length > 1 ? 's' : ''}`;
    el.className = 'fitstatus bad';
    for (const h of hits) {
      const what = h.b.ref ? `part "${h.a.name}" hits the ${h.b.name}` : `"${h.a.name}" and "${h.b.name}" overlap`;
      log('err', `COLLISION: ${what} by ~${h.volume.toFixed(1)} mm³`, h.b.ref ? h.b.line : h.a.line);
    }
  }
}

function log(kind, text, line) {
  const d = document.createElement('div');
  d.className = kind;
  if (line) {
    const a = document.createElement('a');
    a.textContent = text;
    a.addEventListener('click', () => { editor.setCursor(line - 1, 0); editor.focus(); });
    d.appendChild(a);
  } else d.textContent = text;
  $('console').appendChild(d);
}

// ------------------------------------------------------------------ views
function refreshViews() {
  if (!result) return;
  const sel = result.parts.find(p => p.id === selected);
  store.set('sel', sel ? sel.name : null);
  renderPartList();
  if (view === '3d') v3.setModel(result, { selected, hits });
  else if (view === 'part') v2.setScene(partScene(sel), false);
  else v2.setScene(sheetScene(), false);
}

function partScene(sel) {
  // one part at its own origin, or all parts in a row
  const items = [];
  if (sel) {
    items.push({ shape: sel.shape, color: sel.color || sel.material.color, part: sel, label: sel.name, highlight: sel.highlight });
    for (const g of result.ghosts) items.push({ shape: g, ghost: true });
    return { items, sheets: [], axes: true };
  }
  let x = 0;
  for (const p of result.parts) {
    if (!p.shape.body.length) continue;
    const b = bounds(p.shape.allPaths());
    items.push({ shape: p.shape, m: [1, 0, 0, 1, x - b.x0, -b.y0], color: p.color || p.material.color, part: p, label: p.name + (p.qty > 1 ? ` ×${p.qty}` : ''), highlight: p.highlight });
    x += b.x1 - b.x0 + 15;
  }
  return { items, sheets: [], axes: false };
}

function sheetScene() {
  const items = [], sheets = [];
  let y = 0;
  for (const s of sheetsResult.sheets) {
    y -= s.h + 30;
    sheets.push({ x: 0, y, w: s.w, h: s.h, oversize: s.oversize, label: `${s.material.name} · ${s.material.thickness} mm · sheet ${s.index + 1} · ${s.w} × ${s.h}` });
    for (const it of s.items) {
      items.push({
        shape: it.part.shape, m: [it.m[0], it.m[1], it.m[2], it.m[3], it.m[4], it.m[5] + y],
        color: it.part.color || it.part.material.color, part: it.part, selected: it.part.id === selected,
        label: it.part.name + (it.part.qty > 1 ? ` #${it.copy + 1}` : ''), highlight: it.part.highlight,
      });
    }
  }
  return { items, sheets, axes: false };
}

function renderPartList() {
  const box = $('partlist');
  box.innerHTML = '';
  const all = document.createElement('span');
  all.className = 'chip' + (selected == null ? ' on' : '');
  all.textContent = 'all';
  all.onclick = () => pick(null);
  box.appendChild(all);
  for (const p of result.parts) {
    const c = document.createElement('span');
    c.className = 'chip' + (p.id === selected ? ' on' : '');
    const b = bounds(p.shape.body.length ? p.shape.body : [[[0, 0]]]);
    c.innerHTML = `<span class="sw" style="background:${p.color || p.material.color}"></span>`;
    c.append(p.name + (p.qty > 1 ? ` ×${p.qty}` : ''));
    const dim = document.createElement('span');
    dim.className = 'dim';
    dim.textContent = `${(b.x1 - b.x0).toFixed(1)}×${(b.y1 - b.y0).toFixed(1)}×${p.material.thickness}`;
    c.appendChild(dim);
    c.title = `${p.material.name} — click to select, double-click to jump to code`;
    c.onclick = () => pick(p.id === selected ? null : p);
    c.ondblclick = () => { if (p.file === (current || 'main')) { editor.setCursor(p.line - 1, 0); editor.focus(); } };
    box.appendChild(c);
  }
}

function setView(v) {
  view = v;
  store.set('view', v);
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.view === v);
  $('v3d').hidden = v !== '3d';
  $('v2d').hidden = v === '3d';
  $('viewtools-3d').hidden = v !== '3d';
  $('viewtools-2d').hidden = v === '3d';
  v2.needsFit = true;
  refreshViews();
}
for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => setView(b.dataset.view));
$('explode').addEventListener('input', e => v3.setExplode(+e.target.value));
$('fit3d').addEventListener('click', () => v3.fit());
$('fit2d').addEventListener('click', () => { v2.fit(); v2.draw(); });
$('render').addEventListener('click', () => render({ manual: true }));

// ------------------------------------------------------------------ export
$('export').addEventListener('click', async () => {
  if (!sheetsResult || !sheetsResult.sheets.length) return log('warn', 'Nothing to export');
  const stem = (current || 'kerf').replace(/\.(kerf|scad)$/, '');
  const kerf = $('kerfcomp').checked;
  const written = [];
  for (const s of sheetsResult.sheets) {
    const svg = sheetToSVG(s, { kerf });
    const name = `export/${stem.split('/').pop()}-${s.material.name}-${s.index + 1}.svg`.replace(/[^\w./-]+/g, '_');
    if (store_.kind === 'workspace') download(name.split('/').pop(), svg, 'image/svg+xml');
    else await store_.write((res.base ? res.base + '/' : '') + name, svg);
    written.push(name);
  }
  if (store_.kind === 'workspace') return log('ok', `Downloaded ${written.length} SVG${written.length > 1 ? 's' : ''} (kerf compensation ${kerf ? 'on' : 'off'}): ${written.map(w => w.split('/').pop()).join(', ')}`);
  log('ok', `Exported ${written.length} sheet${written.length > 1 ? 's' : ''} (kerf compensation ${kerf ? 'on' : 'off'}):\n  ` + written.join('\n  '));
});
$('kerfcomp').checked = store.get('kerfcomp', true);
$('kerfcomp').addEventListener('change', e => store.set('kerfcomp', e.target.checked));
$('auto').checked = store.get('auto', true);
$('auto').addEventListener('change', e => store.set('auto', e.target.checked));

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ------------------------------------------------------------------ storage: folder / uploads
async function useStore(st) {
  store_ = st;
  res.store = st;
  res.refreshFiles();
  showWhere();
  current = null;
  savedText = '';
  const files = await listFiles();
  if (!$('tutorial').hidden && files.length) return openLesson(lesson);
  const want = store.get('file');
  const first = files.includes(want) ? want : (files.includes('box.kerf') ? 'box.kerf' : files[0]);
  if (first) await openFile(first);
  else { editor.setValue(''); savedText = ''; updateDirty(); }
}

$('openfolder').addEventListener('click', async () => {
  if (isDirty() && !confirm(`Discard unsaved changes to ${current}?`)) return;
  let handle = null;
  // re-grant a remembered folder first
  try {
    const h = await meta.get('folder');
    if (h && store_.kind !== 'folder' && (await h.requestPermission({ mode: 'readwrite' })) === 'granted' &&
        confirm(`Reopen folder "${h.name}"? (Cancel to pick a different one)`)) handle = h;
  } catch { /* none remembered */ }
  if (!handle) {
    try { handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'kerf' }); } catch { return; }
  }
  await meta.set('folder', handle);
  const st = new FolderStore(handle);
  const files = await st.list();
  if (!files.some(f => /\.(kerf|scad)$/.test(f)) && confirm(`"${handle.name}" has no .kerf files yet. Copy the example projects into it?`)) await seedExamples(st);
  await useStore(st);
  log('ok', `Working in folder "${handle.name}"`);
});

// Bring files from disk into the project. In the workspace (website) the
// first .kerf among them is opened; images/SVGs/fonts are kept alongside it.
async function addFiles(fileList, handles = []) {
  const kerfs = [];
  const names = [];
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    const path = store_.kind === 'workspace' ? f.name : (res.base ? res.base + '/' : '') + f.name;
    if (/\.(kerf|scad)$/i.test(f.name)) kerfs.push(path);
    await store_.write(path, f, handles[i]);
    names.push(path);
  }
  res.refreshFiles();
  await listFiles(current);
  const assets = names.filter(n => !kerfs.includes(n));
  if (assets.length) log('ok', `Loaded ${assets.join(', ')}`);
  if (kerfs.length) {
    if (isDirty() && !confirm(`Discard unsaved changes to ${current}?`)) return;
    savedText = editor.getValue();
    await openFile(kerfs[0]);
  } else render({ manual: true });
}

async function openFromDisk() {
  if (canSaveInPlace() && window.showOpenFilePicker) {
    // Chrome/Edge: keep handles so Save writes back to the same file
    let hs;
    try {
      hs = await window.showOpenFilePicker({
        multiple: true, id: 'kerf',
        types: [{ description: 'Kerf designs and assets', accept: { 'text/plain': ['.kerf', '.scad'], 'image/*': ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'], 'font/*': ['.ttf', '.otf'] } }],
      });
    } catch { return; }
    return addFiles(await Promise.all(hs.map(h => h.getFile())), hs);
  }
  $('openinput').click();
}
$('open').addEventListener('click', openFromDisk);
$('openinput').addEventListener('change', e => { if (e.target.files.length) addFiles([...e.target.files]); e.target.value = ''; });
// drop files anywhere on the page
window.addEventListener('dragover', e => { if (store_ && store_.kind !== 'server') e.preventDefault(); });
window.addEventListener('drop', e => {
  if (!store_ || store_.kind === 'server' || !e.dataTransfer.files.length) return;
  e.preventDefault();
  addFiles([...e.dataTransfer.files]);
});

// ------------------------------------------------------------------ help, keys, splitter
$('helpcontent').innerHTML = HELP;
const toggleHelp = show => { $('helpbox').hidden = !(show ?? $('helpbox').hidden); };
$('help').addEventListener('click', () => toggleHelp(true));
$('helpclose').addEventListener('click', () => toggleHelp(false));
$('helpbox').addEventListener('click', e => { if (e.target === $('helpbox')) toggleHelp(false); });
window.addEventListener('keydown', e => {
  if (e.key === 'F5') { e.preventDefault(); render({ manual: true }); }
  if (e.key === 'F1') { e.preventDefault(); toggleHelp(); }
  if (e.key === 'Escape') toggleHelp(false);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save({ as: e.shiftKey && store_.kind === 'workspace' }); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o' && store_ && store_.kind === 'workspace') { e.preventDefault(); openFromDisk(); }
});
{
  const sp = $('splitter'), left = $('left');
  const w = store.get('split', null);
  if (w) left.style.width = w + 'px';
  sp.addEventListener('pointerdown', e => {
    sp.setPointerCapture(e.pointerId);
    const move = ev => { left.style.width = Math.max(260, Math.min(window.innerWidth - 300, ev.clientX)) + 'px'; editor.refresh(); };
    const up = () => { sp.removeEventListener('pointermove', move); sp.removeEventListener('pointerup', up); store.set('split', left.offsetWidth); };
    sp.addEventListener('pointermove', move);
    sp.addEventListener('pointerup', up);
  });
}
const applyTheme = () => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
  v3.setBackground(bg);
  v2.draw();
};
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme);

// ------------------------------------------------------------------ tutorial
// Lessons live in <project>/tutorial/, copied from the app the first time so
// your edits survive; Reset copies the original back.
let lesson = store.get('lesson', 0);
const tutPath = l => 'tutorial/' + l.file;

async function copyFromApp(src, dest) {
  const r = await fetch(src);
  if (!r.ok) throw new Error(`missing ${src}`);
  await store_.write(dest, await r.blob());
}

async function openLesson(i, { reset = false } = {}) {
  lesson = Math.max(0, Math.min(LESSONS.length - 1, i));
  store.set('lesson', lesson);
  const L = LESSONS[lesson];
  showLesson();
  const files = await store_.list();
  for (const a of L.assets || []) if (!files.includes('tutorial/' + a)) await copyFromApp('examples/' + a, 'tutorial/' + a);
  if (reset || !files.includes(tutPath(L))) {
    await copyFromApp('tutorial/' + L.file, tutPath(L));
    if (reset && current === tutPath(L)) savedText = editor.getValue(); // discard edits without asking again
  }
  await listFiles(current);
  if (current !== tutPath(L) || reset) {
    if (reset) current = null;
    await openFile(tutPath(L));
  }
}

function showLesson() {
  const L = LESSONS[lesson];
  const done = store.get('tasks', {});
  $('tutsel').value = String(lesson);
  $('tutbody').innerHTML = `<div class="step">Lesson ${lesson + 1} of ${LESSONS.length}</div><h2>${L.title}</h2>${L.html}
    <div class="tut-tasks"><h3>Try it</h3>${L.tasks.map((t, k) => {
      const key = L.file + ':' + k;
      return `<label class="${done[key] ? 'done' : ''}"><input type="checkbox" data-key="${key}" ${done[key] ? 'checked' : ''}><span>${t}</span></label>`;
    }).join('')}</div>`;
  $('tutbody').scrollTop = 0;
  for (const cb of $('tutbody').querySelectorAll('input[type=checkbox]')) {
    cb.addEventListener('change', () => {
      const d = store.get('tasks', {});
      d[cb.dataset.key] = cb.checked;
      store.set('tasks', d);
      cb.parentElement.classList.toggle('done', cb.checked);
    });
  }
  $('tutprev').disabled = lesson === 0;
  $('tutnext').textContent = lesson === LESSONS.length - 1 ? 'Done' : 'Next →';
}

function setTutorial(open) {
  $('tutorial').hidden = !open;
  store.set('tutOpen', open);
  editor.refresh();
  if (open) openLesson(lesson);
}
LESSONS.forEach((L, i) => $('tutsel').add(new Option(`${i + 1}. ${L.title}`, String(i))));
$('tutsel').addEventListener('change', e => openLesson(+e.target.value));
$('tutbtn').addEventListener('click', () => setTutorial($('tutorial').hidden));
$('tutclose').addEventListener('click', () => setTutorial(false));
$('tutprev').addEventListener('click', () => openLesson(lesson - 1));
$('tutnext').addEventListener('click', () => (lesson === LESSONS.length - 1 ? setTutorial(false) : openLesson(lesson + 1)));
$('tutreset').addEventListener('click', () => {
  if (confirm(`Restore lesson ${lesson + 1}'s original code? Your changes to it will be lost.`)) openLesson(lesson, { reset: true });
});

// ------------------------------------------------------------------ boot
(async () => {
  applyTheme();
  stdlib = await (await fetch('lib/stdlib.kerf')).text();
  store_ = await detectStore();
  res.store = store_;
  if (store_.kind === 'workspace') {
    await seedExamples(store_);
    // files made with the earlier browser-storage version: keep them reachable
    const legacy = await legacyBrowserFiles();
    for (const [k, blob] of legacy) await store_.write(k, blob);
    if (legacy.length) log('warn', `Found ${legacy.length} file(s) saved in this browser by an earlier version: ${legacy.map(l => l[0]).join(', ')}. Open them from the file list and use Save to put them on your computer.`);
    const draft = store.get('draft');
    if (draft && draft.path && typeof draft.text === 'string') {
      await store_.write(draft.path, draft.text);
      recovered = draft.path;
      store.set('file', draft.path);
      log('warn', `Recovered unsaved changes to ${draft.path} — Save to keep them.`);
    }
  }
  showWhere();
  const files = await listFiles();
  setView(view);
  const want = new URLSearchParams(location.search).get('file') || store.get('file');
  const first = files.includes(want) ? want : (files.includes('box.kerf') ? 'box.kerf' : files[0]);
  // first visit: start with the tutorial open
  const linked = new URLSearchParams(location.search).has('file'); // a linked file wins over the tutorial
  if (store.get('tutOpen', true) && !linked && !recovered) setTutorial(true);
  else if (first) await openFile(first);
  window.kerf = { editor, render, get result() { return result; }, get sheets() { return sheetsResult; }, get hits() { return hits; }, setView, v3, v2 };
})();
