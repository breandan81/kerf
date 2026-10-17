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

const imageFor = src => res.imageElement(src);
const pick = p => { selected = p ? p.id : null; refreshViews(); };
const v3 = new View3D($('v3d'), { imageFor, onPick: pick });
const v2 = new View2D($('v2d'), { imageFor, onPick: pick });

// ------------------------------------------------------------------ files
async function api(path, opts) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r;
}

async function listFiles(select) {
  const { files, root } = await (await api('/api/ls')).json();
  const kerf = files.filter(f => f.endsWith('.kerf') || f.endsWith('.scad'));
  const sel = $('file');
  sel.innerHTML = '';
  for (const f of kerf) sel.add(new Option(f, f));
  sel.title = 'Project: ' + root;
  if (select) sel.value = select;
  return kerf;
}

async function openFile(path) {
  if (isDirty() && !confirm(`Discard unsaved changes to ${current}?`)) { $('file').value = current; return; }
  const text = await (await api('/api/file?path=' + encodeURIComponent(path))).text();
  current = path;
  savedText = text;
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

async function save() {
  if (!current) return;
  const text = editor.getValue();
  await api('/api/file?path=' + encodeURIComponent(current), { method: 'POST', body: text });
  savedText = text;
  updateDirty();
  log('ok', `saved ${current}`);
}

const isDirty = () => current && editor.getValue() !== savedText;
function updateDirty() { $('dirty').hidden = !isDirty(); document.title = (isDirty() ? '● ' : '') + (current || '') + ' — Kerf'; }

$('file').addEventListener('change', e => openFile(e.target.value));
$('save').addEventListener('click', save);
$('new').addEventListener('click', async () => {
  let name = prompt('New file name', 'untitled.kerf');
  if (!name) return;
  if (!/\.(kerf|scad)$/.test(name)) name += '.kerf';
  const files = await listFiles();
  if (files.includes(name)) return openFile(name);
  const tmpl = `// ${name}\nmaterial("ply3", thickness = 3, sheet = [400, 300], kerf = 0.1);\n\npart("plate", "ply3") {\n  difference() {\n    rounded_square([80, 50], r = 4);\n    translate([10, 25]) circle(d = 4);\n  }\n  engrave() translate([45, 25]) text("Kerf", size = 10, halign = "center", valign = "center");\n}\n`;
  await api('/api/file?path=' + encodeURIComponent(name), { method: 'POST', body: tmpl });
  await listFiles(name);
  savedText = editor.getValue(); // the old file's dirty state was already confirmed
  current = null;
  openFile(name);
});
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ------------------------------------------------------------------ render
let timer = null;
editor.on('change', () => {
  updateDirty();
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
    await api('/api/file?path=' + encodeURIComponent((res.base ? res.base + '/' : '') + name), { method: 'POST', body: svg });
    written.push(name);
  }
  log('ok', `Exported ${written.length} sheet${written.length > 1 ? 's' : ''} (kerf compensation ${kerf ? 'on' : 'off'}):\n  ` + written.join('\n  '));
});
$('kerfcomp').checked = store.get('kerfcomp', true);
$('kerfcomp').addEventListener('change', e => store.set('kerfcomp', e.target.checked));
$('auto').checked = store.get('auto', true);
$('auto').addEventListener('change', e => store.set('auto', e.target.checked));

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
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
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

// ------------------------------------------------------------------ boot
(async () => {
  applyTheme();
  stdlib = await (await fetch('lib/stdlib.kerf')).text();
  const files = await listFiles();
  setView(view);
  const want = new URLSearchParams(location.search).get('file') || store.get('file');
  const first = files.includes(want) ? want : (files.includes('box.kerf') ? 'box.kerf' : files[0]);
  if (first) await openFile(first);
  window.kerf = { editor, render, get result() { return result; }, get sheets() { return sheetsResult; }, get hits() { return hits; }, setView, v3, v2 };
})();
