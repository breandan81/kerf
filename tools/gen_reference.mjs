// Build the language reference from the source:
//   lib/*.kerf           modules and functions: signatures (names, defaults)
//                        straight from the code, descriptions from the
//                        comment block above each one
//   js/lang/reference.js the built-in modules and functions
// Writes docs/reference.html (served with the app) and docs/REFERENCE.md.
//
//   node tools/gen_reference.mjs          write both files
//   node tools/gen_reference.mjs --check  exit 1 if they're out of date or
//                                         anything is undocumented
//
// Doc comments in lib/*.kerf, directly above `module`/`function`:
//   // What it does, in sentences.
//   //   name: what this argument means           ← one line per argument
//   //         continued on an indented line
//   //     example(code);                         ← other indented lines are examples
// A one-line function can instead end with `; // description`.
// `// ---- title` lines start a new section; names starting with _ are private.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBS = [
  ['stdlib.kerf', 'Standard library'],
  ['boxes.kerf', 'Boxes'],
  ['hinges.kerf', 'Hinges'],
  ['gears.kerf', 'Gears'],
  ['flex.kerf', 'Curved boxes (flex)'],
];

// ------------------------------------------------------------ parsing lib files

function splitTop(s) {
  const out = [];
  let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseParams(src) {
  return splitTop(src).map(p => {
    const i = p.indexOf('=');
    return i < 0 ? { name: p.trim(), def: null } : { name: p.slice(0, i).trim(), def: p.slice(i + 1).trim().replace(/\s+/g, ' ') };
  });
}

// text inside the parentheses that start at `open` (index of '(')
function balanced(text, open) {
  let depth = 0, q = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"') q = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return { inner: text.slice(open + 1, i), end: i };
  }
  throw new Error('unbalanced parentheses');
}

function parseDoc(lines, paramNames) {
  // blocks: prose paragraphs and code examples, in their original order
  const blocks = [], params = {};
  const add = (type, text) => {
    const b = blocks[blocks.length - 1];
    if (b && b.type === type && !(type === 'p' && text === '')) b.text += '\n' + text;
    else if (text !== '') blocks.push({ type, text });
  };
  let last = null;
  for (const raw of lines) {
    const l = raw.replace(/^\/\/ ?/, '');
    const m = /^ {2,}([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*): +(.*)$/.exec(l);
    const names = m ? m[1].split(/\s*,\s*/) : [];
    if (m && names.every(n => paramNames.includes(n))) {
      for (const n of names) params[n] = m[2].trim();
      last = names; continue;
    }
    if (last && /^ {4,}\S/.test(l) && !/[;{}]\s*(\/\/.*)?$/.test(l)) { for (const n of last) params[n] += ' ' + l.trim(); continue; }
    last = null;
    if (/^ {2,}\S/.test(l)) add('code', l.replace(/^ {2}/, ''));
    else if (l.trim()) add('p', l.trim());
    else blocks.push({ type: 'gap' });
  }
  const out = blocks.filter(b => b.type !== 'gap');
  return { blocks: out, desc: out.filter(b => b.type === 'p').map(b => b.text).join(' '), params };
}

export function parseLib(file) {
  const text = fs.readFileSync(path.join(ROOT, 'lib', file), 'utf8');
  const lines = text.split('\n');
  // header: the first comment block, minus the licence line
  const head = [];
  for (const l of lines) { if (!l.startsWith('//')) break; if (!/SPDX/.test(l)) head.push(l); }
  const headLen = head.length;
  // "Gears.     use <gears.kerf>": the reference shows how to use it already
  for (let i = 0; i < head.length; i++) head[i] = head[i].replace(/\s+use <[\w.]+>\s*$/, '');
  const items = [];
  let section = null, block = [];
  let offset = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const at = offset;
    offset += line.length + 1;
    if (li < headLen + 1) continue;
    const sec = /^\/\/ -{4,}\s*(.*)$/.exec(line);
    if (sec) { section = sec[1].trim() || null; block = []; continue; }
    if (line.startsWith('//')) { block.push(line); continue; }
    const m = /^(module|function)\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (m) {
      const { inner, end } = balanced(text, at + m[0].length - 1);
      const params = parseParams(inner);
      const rest = text.slice(end + 1, text.indexOf('\n', end + 1) < 0 ? undefined : text.indexOf('\n', end + 1));
      const trailing = /;\s*\/\/\s*(.+)$/.exec(rest);
      const doc = parseDoc(block, params.map(p => p.name));
      if (!doc.desc && trailing) { doc.desc = trailing[1].trim(); doc.blocks = [{ type: 'p', text: doc.desc }]; }
      if (!m[2].startsWith('_')) {
        items.push({ kind: m[1], name: m[2], section, file, desc: doc.desc, blocks: doc.blocks,
          params: params.map(p => ({ ...p, doc: doc.params[p.name] || '' })) });
      }
      // skip to the end of the signature
      while (offset <= end && li < lines.length - 1) { li++; offset += lines[li].length + 1; }
    }
    block = [];
  }
  // arguments described once in the header apply to every item that has them
  const intro = parseDoc(head, [...new Set(items.flatMap(it => it.params.map(p => p.name)))]);
  for (const it of items) for (const p of it.params) if (!p.doc && intro.params[p.name]) p.doc = intro.params[p.name];
  return { file, intro, items };
}

// ------------------------------------------------------------ rendering

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// `code` spans in descriptions
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
const paras = s => s.split(/\n\s*\n/).map(p => `<p>${inline(p.replace(/\n/g, ' '))}</p>`).join('');
const blocksHTML = bs => bs.map(b => (b.type === 'code' ? `<pre>${esc(b.text)}</pre>` : paras(b.text))).join('');
const blocksMD = bs => bs.flatMap(b => (b.type === 'code' ? ['```openscad', b.text, '```', ''] : [b.text.replace(/\n/g, ' '), ''])).join('\n');
// built-ins: a description and an optional example
const builtinBlocks = it => [{ type: 'p', text: it.desc }, ...(it.example ? [{ type: 'code', text: it.example }] : [])];
const sig = it => `${it.name}(${it.params.map(p => (p.def == null ? p.name : `${p.name} = ${p.def}`)).join(', ')})`;
const anchor = (lib, name) => `${lib.replace(/\W+/g, '-')}-${name}`;

function entryHTML(it, lib) {
  // a table only when it says more than the signature does
  const ps = it.params.some(p => p.doc || p.def != null) ? `<table class="params args"><tr><th>argument</th><th>default</th><th></th></tr>${
    it.params.map(p => `<tr><td><code>${esc(p.name)}</code></td><td>${p.def == null ? '<span class="req">required</span>' : `<code>${esc(p.def)}</code>`}</td><td>${inline(p.doc)}</td></tr>`).join('')}</table>` : '';
  return `<section class="entry" id="${anchor(lib, it.name)}" data-search="${esc((it.name + ' ' + it.desc + ' ' + it.params.map(p => p.name + ' ' + p.doc).join(' ')).toLowerCase())}">
<h4><span class="kind">${it.kind}</span> <code>${esc(sig(it))}</code></h4>
${blocksHTML(it.blocks.filter(b => b.type === 'p'))}${ps}${blocksHTML(it.blocks.filter(b => b.type === 'code'))}</section>`;
}

function entryMD(it) {
  const rows = !it.params.some(p => p.doc || p.def != null) ? [] : it.params.map(p => `| \`${p.name}\` | ${p.def == null ? '*required*' : '`' + p.def.replace(/\|/g, '\\|') + '`'} | ${p.doc.replace(/\|/g, '\\|')} |`);
  return [`#### \`${sig(it)}\``, '', `*${it.kind}*  `, blocksMD(it.blocks.filter(b => b.type === 'p')),
    ...(rows.length ? ['| argument | default | |', '|---|---|---|', ...rows, ''] : []),
    blocksMD(it.blocks.filter(b => b.type === 'code'))].join('\n');
}

function group(items) {
  const out = [];
  for (const it of items) {
    const g = out.find(x => x.section === it.section);
    if (g) g.items.push(it); else out.push({ section: it.section, items: [it] });
  }
  return out;
}

export async function build() {
  const { BUILTINS, LANGUAGE } = await import(path.join(ROOT, 'js/lang/reference.js'));
  const libs = LIBS.map(([file, title]) => ({ ...parseLib(file), title }));
  const toc = [], body = [], md = [];

  toc.push('<li><a href="#language">Language</a></li>');
  body.push(`<h2 id="language">Language</h2>${LANGUAGE.html}`);
  md.push('## Language', '', LANGUAGE.md, '');

  toc.push('<li><a href="#builtins">Built-in</a><ul>' + BUILTINS.map(g => `<li><a href="#${anchor('builtin', g.group)}">${esc(g.group)}</a></li>`).join('') + '</ul></li>');
  body.push('<h2 id="builtins">Built-in modules and functions</h2><p>Always available, no <code>use</code> needed.</p>');
  md.push('## Built-in modules and functions', '', 'Always available, no `use` needed.', '');
  for (const g of BUILTINS) {
    body.push(`<h3 id="${anchor('builtin', g.group)}">${esc(g.group)}</h3>${g.intro ? paras(g.intro) : ''}`);
    md.push(`### ${g.group}`, '', ...(g.intro ? [g.intro, ''] : []));
    for (const it of g.items) {
      const e = { ...it, params: it.params.map(([name, def, doc]) => ({ name, def, doc: doc || '' })), blocks: builtinBlocks(it) };
      body.push(entryHTML(e, 'builtin'));
      md.push(entryMD(e));
    }
  }

  toc.push('<li><a href="#libraries">Libraries</a><ul>' + libs.map(l => `<li><a href="#lib-${l.file.replace('.kerf', '')}">${esc(l.title)}</a></li>`).join('') + '</ul></li>');
  body.push('<h2 id="libraries">Libraries</h2><p>Written in Kerf (in <code>lib/</code>). <code>use &lt;name.kerf&gt;</code> imports a library\'s modules and functions; a file with the same name in your project takes precedence.</p>');
  md.push('## Libraries', '', 'Written in Kerf (in `lib/`). `use <name.kerf>` imports a library\'s modules and functions; a file with the same name in your project takes precedence.', '');
  for (const l of libs) {
    const how = l.file === 'stdlib.kerf' ? '' : `<code>use &lt;${l.file}&gt;</code>`;
    const common = Object.entries(l.intro.params);
    body.push(`<h3 id="lib-${l.file.replace('.kerf', '')}">${esc(l.title)} <small>${how}</small></h3>${blocksHTML(l.intro.blocks)}${
      common.length ? `<p>Arguments used throughout:</p><table class="params">${common.map(([k, v]) => `<tr><td><code>${esc(k)}</code></td><td>${inline(v)}</td></tr>`).join('')}</table>` : ''}`);
    md.push(`### ${l.title}${l.file === 'stdlib.kerf' ? '' : ' — `use <' + l.file + '>`'}`, '', blocksMD(l.intro.blocks),
      ...(common.length ? ['Arguments used throughout:', '', ...common.map(([k, v]) => `- \`${k}\`: ${v}`), ''] : []));
    for (const g of group(l.items)) {
      if (g.section) { body.push(`<h5>${esc(g.section)}</h5>`); md.push(`**${g.section}**`, ''); }
      for (const it of g.items) { body.push(entryHTML(it, l.file)); md.push(entryMD(it)); }
    }
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kerf reference</title>
<style>
:root { --bg: #fbfaf7; --fg: #222; --muted: #6b6560; --line: #e2ddd5; --code: #f1ede6; --accent: #c0392b; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1b1a; --fg: #e8e4de; --muted: #a29a90; --line: #3a3733; --code: #2a2826; --accent: #ff7b6b; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
nav { position: fixed; top: 0; bottom: 0; left: 0; width: 240px; overflow: auto; padding: 16px; border-right: 1px solid var(--line); font-size: 14px; }
nav ul { list-style: none; padding-left: 12px; margin: 4px 0; } nav > ul { padding: 0; }
nav a { color: var(--fg); text-decoration: none; } nav a:hover { color: var(--accent); }
#q { width: 100%; padding: 7px 9px; margin: 8px 0 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--code); color: var(--fg); font: inherit; }
main { margin-left: 240px; padding: 16px 32px 80px; max-width: 980px; }
h1 { margin: 8px 0 4px; } h2 { margin-top: 40px; border-bottom: 2px solid var(--line); padding-bottom: 4px; }
h3 { margin-top: 32px; } h3 small { font-weight: normal; color: var(--muted); font-size: 14px; } h5 { margin: 24px 0 4px; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
code { background: var(--code); padding: 1px 4px; border-radius: 3px; }
pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow: auto; }
.entry { border-top: 1px solid var(--line); padding: 10px 0 6px; }
.entry h4 { margin: 0 0 4px; font-weight: normal; } .entry h4 code { background: none; padding: 0; font-size: 14px; font-weight: 600; }
.kind { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-right: 4px; }
.entry p { margin: 4px 0; }
.params { border-collapse: collapse; margin: 6px 0; font-size: 14px; width: 100%; }
.params th { text-align: left; color: var(--muted); font-weight: normal; font-size: 12px; border-bottom: 1px solid var(--line); padding: 2px 8px 2px 0; }
.params td { vertical-align: top; padding: 3px 12px 3px 0; border-bottom: 1px solid var(--line); }
.params td:first-child, .args td:nth-child(2) { white-space: nowrap; }
.entry h4 code { overflow-wrap: anywhere; }
.req { color: var(--accent); font-size: 12px; }
.hidden { display: none; }
@media (max-width: 800px) {
  nav { position: static; width: auto; border: 0; } main { margin: 0; padding: 0 16px 60px; }
  .params td, .args td:nth-child(2) { white-space: normal; overflow-wrap: anywhere; }
}
</style></head><body>
<nav><b>Kerf reference</b><input id="q" placeholder="Search… (e.g. hinge)" autocomplete="off"><ul>${toc.join('')}</ul></nav>
<main><h1>Kerf language reference</h1>
<p>Every built-in and library module and function, with its arguments and defaults. Generated from the source
(<code>tools/gen_reference.mjs</code>), so it matches this version of Kerf.</p>
${body.join('\n')}</main>
<script>
const q = document.getElementById('q');
q.addEventListener('input', () => {
  const s = q.value.trim().toLowerCase();
  for (const e of document.querySelectorAll('.entry')) e.classList.toggle('hidden', !!s && !e.dataset.search.includes(s));
});
</script></body></html>
`;
  const mdOut = ['# Kerf language reference', '',
    'Every built-in and library module and function, with its arguments and defaults. Generated from the source by',
    '`tools/gen_reference.mjs` (`npm run docs`); the same reference is in the app (**?** → *Full reference*).', '', ...md].join('\n') + '\n';

  // coverage: every built-in and every public library item is described
  const missing = [];
  for (const l of libs) for (const it of l.items) {
    if (!it.desc) missing.push(`${l.file}: ${it.name} has no description`);
    for (const p of it.params) if (!p.doc) missing.push(`${l.file}: ${it.name}(${p.name}) is not described`);
  }
  return { html, md: mdOut, missing, libs, BUILTINS };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { html, md, missing } = await build();
  const check = process.argv.includes('--check');
  const files = [['docs/reference.html', html], ['docs/REFERENCE.md', md]];
  let stale = false;
  for (const [f, s] of files) {
    const p = path.join(ROOT, f);
    if (check) { if (!fs.existsSync(p) || fs.readFileSync(p, 'utf8') !== s) { console.log('out of date:', f); stale = true; } } else fs.writeFileSync(p, s);
  }
  for (const m of missing) console.log('undocumented:', m);
  if (!check) console.log(`wrote ${files.map(f => f[0]).join(', ')}`);
  if (missing.length || stale) process.exitCode = 1;
}
