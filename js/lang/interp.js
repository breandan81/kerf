// Kerf interpreter: evaluates a parsed program into laser parts.
//
// Every module instantiation returns a Res: flat 2D shapes (not yet part
// of any part), finished parts (with a 3D placement), ghost geometry and
// reference solids (preview only, never exported).
import { parse, KerfError } from './parser.js';
import * as clip from '../geom/clip.js';
import {
  Shape, translate2, rotate2, scale2, mirror2, sind, cosd, I2, mul2,
} from '../geom/shape.js';
import {
  I4, mul4, translate4, scale4, rotXYZ, rotAxis, mirror4, to2D,
} from '../geom/mat4.js';
import { textPaths } from '../geom/text.js';

class Res {
  constructor() {
    this.shapes = [];
    this.parts = [];
    this.ghosts = []; // flat shapes shown faintly in preview
    this.solids = []; // reference cubes/cylinders/spheres (preview only)
  }
  add(r) {
    if (!r) return this;
    this.shapes.push(...r.shapes);
    this.parts.push(...r.parts);
    this.ghosts.push(...r.ghosts);
    this.solids.push(...r.solids);
    return this;
  }
  static of(shape) { const r = new Res(); if (shape) r.shapes.push(shape); return r; }
}

class Range {
  constructor(start, step, end) { this.start = start; this.step = step; this.end = end; }
  *[Symbol.iterator]() {
    const { start, step, end } = this;
    if (step === 0 || !isFinite(start) || !isFinite(end)) return;
    if ((step > 0 && start > end) || (step < 0 && start < end)) return;
    const n = Math.floor((end - start) / step + 1e-9);
    if (n > 1e6) throw new Error('range too large');
    for (let i = 0; i <= n; i++) yield start + i * step;
  }
}

class Closure {
  constructor(params, body, scope) { this.params = params; this.body = body; this.scope = scope; }
}

class Scope {
  constructor(parent, dynParent) {
    this.parent = parent;
    this.dyn = dynParent;
    this.vars = new Map();
    this.funcs = new Map();
    this.mods = new Map();
  }
  lookup(name) {
    if (name[0] === '$') {
      for (let s = this; s; s = s.dyn) if (s.vars.has(name)) return { found: true, v: s.vars.get(name) };
      return { found: false };
    }
    for (let s = this; s; s = s.parent) if (s.vars.has(name)) return { found: true, v: s.vars.get(name) };
    return { found: false };
  }
  find(kind, name) {
    for (let s = this; s; s = s.parent) if (s[kind].has(name)) return s[kind].get(name);
    return null;
  }
}

const isNum = v => typeof v === 'number';
const isVec = v => Array.isArray(v);
const isNumVec = v => isVec(v) && v.every(isNum);

export function formatValue(v, inList = false) {
  if (v === undefined) return 'undef';
  if (typeof v === 'string') return inList ? JSON.stringify(v) : JSON.stringify(v);
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(+v.toPrecision(6));
  }
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Range) return `[${formatValue(v.start)} : ${formatValue(v.step)} : ${formatValue(v.end)}]`;
  if (v instanceof Closure) return 'function(' + v.params.map(p => p.name).join(', ') + ')';
  if (isVec(v)) return '[' + v.map(x => formatValue(x, true)).join(', ') + ']';
  if (v && v.isMaterial) return `material("${v.name}", ${v.thickness})`;
  return String(v);
}

function deepEq(a, b) {
  if (isVec(a) && isVec(b)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  return a === b;
}

const DEFAULT_MATERIAL = {
  name: 'default', thickness: 3, color: '#d9b38c', opacity: 1, kerf: 0.1,
  sheet: [600, 400], margin: 5, gap: 3, isMaterial: true,
};

export class Interpreter {
  // resources: { font(name), text(path), image(path), svg(text) } — each returns
  // null when not loaded yet, recording the request in resources.missing.
  constructor(resources, opts = {}) {
    this.res = resources;
    this.opts = opts;
    this.echo = [];
    this.warnings = [];
    this.materials = new Map();
    this.steps = 0;
    this.depth = 0;
    this.partSeq = 0;
    this.files = opts.files || {}; // path -> source for include/use
    this.file = opts.file || 'main';
  }

  warn(msg, line) {
    this.warnings.push({ msg, line, file: this.curFile });
  }
  err(msg, line) { return new KerfError(msg, line, this.curFile); }

  run(src) {
    this.curFile = this.file;
    const prog = parse(src, this.file);
    const top = new Scope(null, null);
    this.topScope = top;
    top.vars.set('$fn', 0);
    top.vars.set('$fa', 1);
    top.vars.set('$fs', 0.1);
    top.vars.set('$t', 0);
    top.vars.set('PI', Math.PI);
    top.vars.set('$preview', true);
    this.prelude(top);
    let res = this.execBlock(prog.body, top, true);
    if (this.rootRes) res = this.rootRes; // `!` modifier: show only that subtree

    const parts = res.parts.filter(p => !p.ghost);
    const ghostParts = res.parts.filter(p => p.ghost);
    // loose top-level 2D geometry becomes an implicit part, like OpenSCAD
    const loose = res.shapes.filter(s => !s.isEmpty());
    if (loose.length) {
      parts.push(this.makePart('untitled', this.defaultMaterial(), Shape.merge(loose), 0, {}));
      if (res.parts.length) this.warn('2D geometry outside any part() was collected into a part named "untitled"', 0);
    }
    return {
      parts, ghostParts,
      ghosts: res.ghosts,
      solids: res.solids,
      materials: [...this.materials.values()],
      echo: this.echo,
      warnings: this.warnings,
    };
  }

  // standard library in Kerf itself, loaded into the top scope
  prelude(top) {
    const src = this.opts.stdlib;
    if (!src) return;
    const saved = this.curFile;
    this.curFile = 'stdlib';
    const prog = parse(src, 'stdlib');
    this.execBlock(prog.body, top, false);
    this.curFile = saved;
  }

  defaultMaterial() {
    if (!this.materials.has('default')) this.materials.set('default', { ...DEFAULT_MATERIAL });
    return this.materials.get('default');
  }

  tick(line) {
    if (++this.steps > 5e7) throw this.err('Too many evaluation steps (infinite loop?)', line);
  }

  // ------------------------------------------------------------------ statements
  execBlock(stmts, scope, collect = true) {
    const out = new Res();
    // hoist definitions and includes
    const body = [];
    this.hoist(stmts, scope, body, []);
    // assignments first (OpenSCAD semantics); material() declarations run in
    // the same pass so `t = thickness("ply")` works anywhere in the file
    const early = s => s.type === 'assign' || (s.type === 'call' && s.name === 'material');
    for (const s of body) {
      if (s.type === 'assign') scope.vars.set(s.name, this.eval(s.expr, scope));
      else if (early(s)) this.exec(s, scope);
    }
    for (const s of body) {
      if (early(s)) continue;
      const r = this.exec(s, scope);
      if (collect && r) out.add(r);
    }
    return out;
  }

  // Definitions go into `scope`; anything else into `body`. include<> pastes
  // the file in (recursively); use<> only imports its modules and functions,
  // which keep seeing the library's own top-level variables (like OpenSCAD).
  hoist(stmts, scope, body, stack) {
    for (const s of stmts) {
      if (s.type === 'moduledef') scope.mods.set(s.name, { def: s, scope });
      else if (s.type === 'funcdef') scope.funcs.set(s.name, new Closure(s.params, s.expr, scope));
      else if (s.type === 'include' || s.type === 'use') {
        if (stack.includes(s.path)) throw this.err(`${s.path} includes itself (${[...stack, s.path].join(' → ')})`, s.line);
        const inc = this.loadLib(s);
        if (!inc) continue;
        if (s.type === 'include') this.hoist(inc.body, scope, body, [...stack, s.path]);
        else {
          const lib = this.useLib(s.path, inc, [...stack, s.path]);
          for (const [k, v] of lib.mods) scope.mods.set(k, v);
          for (const [k, v] of lib.funcs) scope.funcs.set(k, v);
        }
      } else body.push(s);
    }
  }

  useLib(path, prog, stack) {
    this.libs = this.libs || new Map();
    if (this.libs.has(path)) return this.libs.get(path);
    const sc = new Scope(this.topScope, this.topScope);
    this.libs.set(path, sc);
    const body = [];
    const saved = this.curFile;
    this.curFile = path;
    this.hoist(prog.body, sc, body, stack);
    for (const s of body) if (s.type === 'assign') sc.vars.set(s.name, this.eval(s.expr, sc));
    this.curFile = saved;
    return sc;
  }

  loadLib(s) {
    const path = s.path;
    let src = this.files[path];
    // gears.kerf doing `use <gears.kerf>` means the built-in one, not itself
    const self = this.res.resolve && this.res.resolve(path) === this.file;
    if (src == null) src = this.res.lib ? this.res.lib(path, self) : this.res.text(path);
    if (src == null) return null;
    try {
      return parse(src, path);
    } catch (e) {
      if (e instanceof KerfError) throw e;
      throw this.err(`in ${path}: ${e.message}`, s.line);
    }
  }

  exec(s, scope) {
    this.tick(s.line);
    if (s.modifier === '*') return null;
    let r;
    switch (s.type) {
      case 'block': r = this.execBlock(s.body, new Scope(scope, scope)); break;
      case 'if': {
        const c = this.eval(s.cond, scope);
        if (truthy(c)) r = this.exec(s.then, new Scope(scope, scope));
        else if (s.else) r = this.exec(s.else, new Scope(scope, scope));
        break;
      }
      case 'for': {
        r = new Res();
        this.loop(s.bindings, scope, sc => r.add(this.exec(s.child, sc)), s.line);
        break;
      }
      case 'let': {
        const sc = new Scope(scope, scope);
        for (const b of s.bindings) sc.vars.set(b.name, this.eval(b.expr, sc));
        r = this.exec(s.child, sc);
        break;
      }
      case 'call': r = this.call(s, scope); break;
      default: throw this.err(`Unexpected ${s.type}`, s.line);
    }
    if (r && s.modifier) r = applyModifier(r, s.modifier);
    if (r && r.root) this.rootRes = r;
    return r;
  }

  loop(bindings, scope, fn, line) {
    const rec = (i, sc) => {
      if (i === bindings.length) return fn(sc);
      const b = bindings[i];
      const seq = this.eval(b.expr, sc);
      const it = iterable(seq);
      if (!it) { this.warn(`for loop over ${formatValue(seq)}`, line); return; }
      for (const v of it) {
        this.tick(line);
        const inner = new Scope(sc, sc);
        inner.vars.set(b.name, v);
        rec(i + 1, inner);
      }
    };
    rec(0, scope);
  }

  // ------------------------------------------------------------------ module calls
  call(s, scope) {
    const name = s.name;
    const user = scope.find('mods', name);
    if (user) return this.callUserModule(user, s, scope);
    const b = BUILTIN_MODULES[name];
    if (!b) {
      this.warn(`Unknown module '${name}'`, s.line);
      return null;
    }
    const args = this.evalArgs(s.args, scope);
    // $-named args become dynamic variables for the children
    const sc = new Scope(scope, scope);
    for (const [k, v] of Object.entries(args.named)) if (k[0] === '$') sc.vars.set(k, v);
    for (const c of s.children) if (c.type === 'assign') sc.vars.set(c.name, this.eval(c.expr, sc));
    const kids = s.children.filter(c => c.type !== 'assign');
    const ctx = {
      interp: this, scope: sc, line: s.line, args,
      children: () => this.execChildren(kids, sc),
      childList: () => kids.map(c => this.execChildren([c], sc)),
    };
    return b(ctx);
  }

  execChildren(children, scope) {
    return this.execBlock(children, new Scope(scope, scope));
  }

  callUserModule(user, s, scope) {
    if (++this.depth > 2000) throw this.err('Recursion too deep', s.line);
    const savedFile = this.curFile;
    try {
      const def = user.def;
      const sc = new Scope(user.scope, scope);
      this.bindParams(def.params, s.args, scope, sc, s.line);
      // children are evaluated in the caller's scope but see our $vars
      const kids = s.children.filter(c => c.type !== 'assign');
      const assigns = s.children.filter(c => c.type === 'assign');
      sc.childInfo = { kids, assigns, scope, file: this.curFile };
      sc.vars.set('$children', kids.length);
      if (def.file) this.curFile = def.file; // errors inside a library point at the library
      return this.exec(def.body, sc);
    } finally {
      this.curFile = savedFile;
      this.depth--;
    }
  }

  // children() / children(i) / children([i,j])
  callChildren(ctx) {
    // lexical chain: children() belongs to the module whose body contains it
    let sc = ctx.scope;
    while (sc && !sc.childInfo) sc = sc.parent;
    if (!sc) return null;
    const { kids, assigns, scope, file } = sc.childInfo;
    const savedFile = this.curFile;
    this.curFile = file;
    const cs = new Scope(scope, ctx.scope);
    for (const a of assigns) cs.vars.set(a.name, this.eval(a.expr, cs));
    const idx = ctx.args.pos[0];
    let pick = kids;
    if (isNum(idx)) pick = kids[idx] ? [kids[idx]] : [];
    else if (isVec(idx)) pick = idx.map(i => kids[i]).filter(Boolean);
    else if (idx instanceof Range) pick = [...idx].map(i => kids[i]).filter(Boolean);
    const out = new Res();
    try {
      for (const k of pick) out.add(this.exec(k, new Scope(cs, cs)));
    } finally { this.curFile = savedFile; }
    return out;
  }

  bindParams(params, args, callerScope, target, line) {
    const pos = [], named = {};
    for (const a of args) {
      const v = this.eval(a.expr, callerScope);
      if (a.name) named[a.name] = v; else pos.push(v);
    }
    params.forEach((p, i) => {
      if (p.name in named) target.vars.set(p.name, named[p.name]);
      else if (i < pos.length) target.vars.set(p.name, pos[i]);
      else target.vars.set(p.name, p.def ? this.eval(p.def, target) : undefined);
    });
    for (const [k, v] of Object.entries(named)) {
      if (!params.some(p => p.name === k)) {
        if (k[0] === '$') target.vars.set(k, v);
        else this.warn(`Unknown parameter '${k}'`, line);
      }
    }
  }

  evalArgs(args, scope) {
    const pos = [], named = {};
    for (const a of args) {
      const v = this.eval(a.expr, scope);
      if (a.name) named[a.name] = v; else pos.push(v);
    }
    return { pos, named };
  }

  // ------------------------------------------------------------------ expressions
  eval(e, scope) {
    this.tick(e.line);
    switch (e.type) {
      case 'lit': return e.v;
      case 'var': {
        const r = scope.lookup(e.name);
        if (r.found) return r.v;
        const f = scope.find('funcs', e.name);
        if (f) return f;
        if (BUILTIN_FUNCS[e.name]) return { builtin: e.name };
        this.warn(`Unknown variable '${e.name}'`, e.line);
        return undefined;
      }
      case 'list': {
        const out = [];
        for (const it of e.items) this.evalElem(it, scope, out);
        return out;
      }
      case 'range': {
        const a = this.eval(e.start, scope);
        const b = this.eval(e.end, scope);
        const st = e.step ? this.eval(e.step, scope) : 1;
        if (!e.step && a > b) {
          this.warn('Range [a:b] with a > b is empty; use [a:-1:b] to count down', e.line);
        }
        return new Range(a, st, b);
      }
      case 'bin': return this.binop(e, scope);
      case 'unary': {
        const v = this.eval(e.a, scope);
        if (e.op === '!') return !truthy(v);
        if (e.op === '+') return v;
        return neg(v);
      }
      case 'ternary': return truthy(this.eval(e.cond, scope)) ? this.eval(e.a, scope) : this.eval(e.b, scope);
      case 'index': {
        const v = this.eval(e.a, scope);
        const i = this.eval(e.index, scope);
        if ((isVec(v) || typeof v === 'string') && isNum(i)) return v[Math.floor(i)];
        return undefined;
      }
      case 'member': {
        const v = this.eval(e.a, scope);
        if (v && v.isMaterial) return v[e.name];
        const k = { x: 0, y: 1, z: 2 }[e.name];
        if (isVec(v) && k !== undefined) return v[k];
        return undefined;
      }
      case 'let': {
        const sc = new Scope(scope, scope);
        for (const b of e.bindings) sc.vars.set(b.name, this.eval(b.expr, sc));
        return this.eval(e.body, sc);
      }
      case 'lambda': return new Closure(e.params, e.body, scope);
      case 'callexpr': return this.callFunc(e, scope);
      case 'echoexpr': {
        const args = this.evalArgs(e.args, scope);
        this.echoArgs(args, e.line);
        return e.body ? this.eval(e.body, scope) : undefined;
      }
      case 'assertexpr': {
        const args = this.evalArgs(e.args, scope);
        if (!truthy(args.pos[0])) throw this.err('Assertion failed' + (args.pos[1] ? ': ' + args.pos[1] : ''), e.line);
        return e.body ? this.eval(e.body, scope) : undefined;
      }
    }
    throw this.err(`Cannot evaluate ${e.type}`, e.line);
  }

  evalElem(it, scope, out) {
    switch (it.type) {
      case 'compfor':
        this.loop(it.bindings, scope, sc => this.evalElem(it.body, sc, out), it.line);
        return;
      case 'compif':
        if (truthy(this.eval(it.cond, scope))) this.evalElem(it.then, scope, out);
        else if (it.else) this.evalElem(it.else, scope, out);
        return;
      case 'complet': {
        const sc = new Scope(scope, scope);
        for (const b of it.bindings) sc.vars.set(b.name, this.eval(b.expr, sc));
        this.evalElem(it.body, sc, out);
        return;
      }
      case 'compeach': {
        const tmp = [];
        this.evalElem(it.a, scope, tmp);
        for (const v of tmp) {
          const iter = iterable(v);
          if (iter) out.push(...iter); else out.push(v);
        }
        return;
      }
      default:
        out.push(this.eval(it, scope));
    }
  }

  binop(e, scope) {
    if (e.op === '&&') return truthy(this.eval(e.a, scope)) && truthy(this.eval(e.b, scope));
    if (e.op === '||') return truthy(this.eval(e.a, scope)) || truthy(this.eval(e.b, scope));
    const a = this.eval(e.a, scope), b = this.eval(e.b, scope);
    switch (e.op) {
      case '+': return arith(a, b, (x, y) => x + y);
      case '-': return arith(a, b, (x, y) => x - y);
      case '*': return mulv(a, b);
      case '/': return isVec(a) && isNum(b) ? a.map(x => divn(x, b)) : (isNum(a) && isNum(b) ? a / b : undefined);
      case '%': return isNum(a) && isNum(b) ? a % b : undefined;
      case '^': return isNum(a) && isNum(b) ? Math.pow(a, b) : undefined;
      case '==': return deepEq(a, b);
      case '!=': return !deepEq(a, b);
      case '<': return cmp(a, b) && a < b;
      case '<=': return cmp(a, b) && a <= b;
      case '>': return cmp(a, b) && a > b;
      case '>=': return cmp(a, b) && a >= b;
    }
    return undefined;
  }

  callFunc(e, scope) {
    let f;
    if (e.fn.type === 'var') {
      const name = e.fn.name;
      const r = scope.lookup(name);
      if (r.found && (r.v instanceof Closure || (r.v && r.v.builtin))) f = r.v;
      else {
        f = scope.find('funcs', name);
        if (!f && BUILTIN_FUNCS[name]) f = { builtin: name };
      }
      if (!f) {
        this.warn(`Unknown function '${name}'`, e.line);
        return undefined;
      }
    } else f = this.eval(e.fn, scope);
    if (f && f.builtin) {
      const args = this.evalArgs(e.args, scope);
      return BUILTIN_FUNCS[f.builtin].call(this, args, scope, e.line);
    }
    if (!(f instanceof Closure)) {
      this.warn('Calling something that is not a function', e.line);
      return undefined;
    }
    if (++this.depth > 5000) throw this.err('Recursion too deep', e.line);
    try {
      const sc = new Scope(f.scope, scope);
      this.bindParams(f.params, e.args, scope, sc, e.line);
      return this.eval(f.body, sc);
    } finally {
      this.depth--;
    }
  }

  echoArgs(args, line) {
    const parts = args.pos.map(v => formatValue(v));
    for (const [k, v] of Object.entries(args.named)) parts.push(`${k} = ${formatValue(v)}`);
    this.echo.push({ text: parts.join(', '), line, file: this.curFile });
  }

  // ------------------------------------------------------------------ helpers
  fragments(r, scope) {
    const fn = scope.lookup('$fn').v || 0;
    const fa = scope.lookup('$fa').v || 1;
    const fs = scope.lookup('$fs').v || 0.1;
    if (fn > 0) return Math.max(3, Math.floor(fn));
    return Math.max(5, Math.ceil(Math.min(360 / fa, (r * 2 * Math.PI) / fs)));
  }

  material(v, line) {
    if (v && v.isMaterial) return v;
    if (typeof v === 'string') {
      const m = this.materials.get(v);
      if (m) return m;
      this.warn(`Unknown material "${v}" — declare it with material("${v}", thickness)`, line);
    }
    return this.defaultMaterial();
  }

  makePart(name, mat, shape, line, o) {
    // the cut outline defines the part; engraving/scoring/hinge lines are clipped to it
    const body = clip.union(shape.body);
    const s = new Shape({
      body,
      lines: clip.clipLines(shape.lines, body, true),
      engrave: clip.intersection(shape.engrave, body),
      score: clip.clipLines(shape.score, body, true),
      images: shape.images,
      highlight: shape.highlight,
    });
    if (!body.length) this.warn(`part("${name}") has no outline to cut`, line);
    return {
      id: ++this.partSeq,
      name: String(name),
      material: mat,
      shape: s,
      m4: o.center ? translate4(0, 0, -mat.thickness / 2) : I4,
      color: o.color || null,
      qty: o.qty ?? 1,
      line,
      file: this.curFile,
      highlight: shape.highlight,
      flip: !!o.flip,
    };
  }
}

function applyModifier(r, mod) {
  if (mod === '#') {
    r.shapes = r.shapes.map(s => { const t = new Shape(s); t.highlight = true; return t; });
    r.parts.forEach(p => { p.highlight = true; });
    return r;
  }
  if (mod === '%') {
    const g = new Res();
    g.ghosts.push(...r.shapes, ...r.ghosts);
    g.parts.push(...r.parts.map(p => ({ ...p, ghost: true })));
    g.solids.push(...r.solids);
    return g;
  }
  if (mod === '!') { r.root = true; return r; }
  return r;
}

function truthy(v) {
  if (isVec(v)) return v.length > 0;
  if (typeof v === 'string') return v.length > 0;
  if (v instanceof Range) return true;
  return !!v;
}
function iterable(v) {
  if (v instanceof Range) return v;
  if (isVec(v)) return v;
  if (typeof v === 'string') return [...v];
  if (isNum(v) || typeof v === 'boolean') return [v];
  return null;
}
function neg(v) { return isNum(v) ? -v : isVec(v) ? v.map(neg) : undefined; }
function arith(a, b, f) {
  if (isNum(a) && isNum(b)) return f(a, b);
  if (isVec(a) && isVec(b)) {
    const n = Math.min(a.length, b.length);
    const r = [];
    for (let i = 0; i < n; i++) r.push(arith(a[i], b[i], f));
    return r;
  }
  return undefined;
}
function divn(x, b) { return isNum(x) ? x / b : isVec(x) ? x.map(y => divn(y, b)) : undefined; }
function mulv(a, b) {
  if (isNum(a) && isNum(b)) return a * b;
  if (isNum(a) && isVec(b)) return b.map(x => mulv(a, x));
  if (isVec(a) && isNum(b)) return a.map(x => mulv(x, b));
  if (isNumVec(a) && isNumVec(b)) {
    if (a.length !== b.length) return undefined;
    return a.reduce((s, x, i) => s + x * b[i], 0);
  }
  if (isVec(a) && isVec(b)) {
    const aMat = a.every(isNumVec), bMat = b.every(isNumVec);
    if (aMat && isNumVec(b)) return a.map(row => mulv(row, b)); // matrix * vector
    if (isNumVec(a) && bMat) return b[0].map((_, j) => a.reduce((s, x, i) => s + x * b[i][j], 0));
    if (aMat && bMat) return a.map(row => b[0].map((_, j) => row.reduce((s, x, i) => s + x * b[i][j], 0)));
  }
  return undefined;
}
function cmp(a, b) { return (isNum(a) && isNum(b)) || (typeof a === 'string' && typeof b === 'string'); }

// ==================================================================== builtins
const num = (v, d) => (isNum(v) ? v : d);
const vec2 = (v, d = [0, 0]) => {
  if (isNum(v)) return [v, v];
  if (isVec(v)) return [num(v[0], d[0]), num(v[1], d[1])];
  return d;
};
const vec3 = (v, d = [0, 0, 0]) => {
  if (isNum(v)) return [v, v, v];
  if (isVec(v)) return [num(v[0], d[0]), num(v[1], d[1]), num(v[2], d[2])];
  return d;
};
const arg = (ctx, i, name, d) => (name in ctx.args.named ? ctx.args.named[name] : (ctx.args.pos[i] !== undefined ? ctx.args.pos[i] : d));

// Apply a 3D transform: flat shapes get its 2D part, parts get the full matrix.
function transformRes(ctx, m4) {
  const r = ctx.children();
  const m2 = to2D(m4);
  if (!m2 && (r.shapes.length || r.ghosts.length)) {
    ctx.interp.warn('Tilting flat 2D geometry out of the XY plane has no effect — wrap it in part() first', ctx.line);
  }
  const t = s => (m2 ? s.transform(m2) : s);
  r.shapes = r.shapes.map(t);
  r.ghosts = r.ghosts.map(t);
  r.parts = r.parts.map(p => ({ ...p, m4: mul4(m4, p.m4) }));
  r.solids = r.solids.map(s => ({ ...s, m4: mul4(m4, s.m4) }));
  return r;
}

function boolean(ctx, op) {
  const kids = ctx.childList();
  const out = new Res();
  const flat = [];
  for (const k of kids) {
    out.parts.push(...k.parts);
    out.ghosts.push(...k.ghosts);
    out.solids.push(...k.solids);
    if (k.shapes.length) flat.push(Shape.merge(k.shapes));
  }
  if (kids.some(k => k.parts.length) && flat.length) {
    ctx.interp.warn(`${op}() mixes parts and flat shapes; parts are passed through untouched`, ctx.line);
  }
  if (!flat.length) return out;
  const merged = Shape.merge(flat, 'none');
  let body;
  if (op === 'union') body = clip.union(flat.flatMap(s => s.body));
  else if (op === 'difference') {
    body = clip.difference(flat[0].body, flat.slice(1).flatMap(s => s.body));
  } else {
    body = flat[0].body;
    for (const s of flat.slice(1)) body = clip.intersection(body, s.body);
    merged.engrave = clip.intersection(merged.engrave, body);
    merged.lines = clip.clipLines(merged.lines, body);
    merged.score = clip.clipLines(merged.score, body);
  }
  out.shapes.push(merged.withBody(body));
  return out;
}

function circlePath(r, n) {
  const p = [];
  for (let i = 0; i < n; i++) p.push([r * cosd(360 * i / n), r * sind(360 * i / n)]);
  return p;
}

const BUILTIN_MODULES = {
  // ---- 2D primitives
  square(ctx) {
    const [w, h] = vec2(arg(ctx, 0, 'size', 1), [1, 1]);
    const c = arg(ctx, 1, 'center', false);
    const x0 = c ? -w / 2 : 0, y0 = c ? -h / 2 : 0;
    if (w <= 0 || h <= 0) return new Res();
    return Res.of(Shape.fromPaths([[[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]]]));
  },
  circle(ctx) {
    let r = arg(ctx, 0, 'r', undefined);
    const d = ctx.args.named.d;
    if (isNum(d)) r = d / 2;
    r = num(r, 1);
    if (r <= 0) return new Res();
    return Res.of(Shape.fromPaths([circlePath(r, ctx.interp.fragments(r, ctx.scope))]));
  },
  polygon(ctx) {
    const pts = arg(ctx, 0, 'points', []);
    const paths = arg(ctx, 1, 'paths', undefined);
    if (!isVec(pts)) return new Res();
    const P = pts.map(p => vec2(p));
    const list = isVec(paths) ? paths.map(ix => ix.map(i => P[i]).filter(Boolean)) : [P];
    // OpenSCAD polygons with paths use even-odd so inner paths become holes
    return Res.of(Shape.fromPaths(list, isVec(paths) ? 'evenodd' : 'nonzero'));
  },
  // open polyline: cut by default; wrap in score()/engrave() to change
  line(ctx) {
    const pts = arg(ctx, 0, 'points', []);
    const closed = arg(ctx, 1, 'closed', false);
    if (!isVec(pts) || pts.length < 2) return new Res();
    const P = pts.map(p => vec2(p));
    if (closed) P.push(P[0]);
    return Res.of(new Shape({ lines: [P] }));
  },
  text(ctx) {
    const t = String(arg(ctx, 0, 'text', ''));
    const n = ctx.args.named;
    const fontName = n.font || 'Liberation Sans';
    const font = ctx.interp.res.font(fontName);
    if (!font) return new Res();
    const paths = textPaths(font, t, {
      size: num(n.size, 10), spacing: num(n.spacing, 1), halign: n.halign, valign: n.valign,
    });
    return Res.of(new Shape({ body: paths }));
  },
  import(ctx) {
    const file = String(arg(ctx, 0, 'file', ''));
    const center = arg(ctx, 1, 'center', false);
    const ext = file.split('.').pop().toLowerCase();
    if (ext !== 'svg') {
      ctx.interp.warn(`import() supports .svg (use image() for bitmaps): ${file}`, ctx.line);
      return new Res();
    }
    const txt = ctx.interp.res.text(file);
    if (txt == null) return new Res();
    let g;
    try { g = ctx.interp.res.svg(txt); } catch (e) {
      ctx.interp.warn(`import("${file}"): ${e.message}`, ctx.line);
      return new Res();
    }
    // closed paths fill with even-odd, like most drawing programs' artwork
    let s = new Shape({ body: clip.union(g.closed, 'evenodd'), lines: g.open });
    if (center) {
      const b = s.bounds();
      s = s.transform(translate2(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2));
    }
    return Res.of(s);
  },
  // bitmap engraving
  image(ctx) {
    const file = String(arg(ctx, 0, 'file', ''));
    const n = ctx.args.named;
    const img = ctx.interp.res.image(file);
    if (!img) return new Res();
    const dpi = num(n.dpi, 300);
    let w = n.width, h = n.height;
    if (isNum(w) && !isNum(h)) h = w * img.h / img.w;
    else if (isNum(h) && !isNum(w)) w = h * img.w / img.h;
    else if (!isNum(w)) { w = img.w / dpi * 25.4; h = img.h / dpi * 25.4; }
    const x0 = n.center ? -w / 2 : 0, y0 = n.center ? -h / 2 : 0;
    return Res.of(new Shape({ images: [{ src: img.src, file, m: [w, 0, 0, h, x0, y0] }] }));
  },

  // ---- 3D reference solids (preview only, for test-fitting real objects)
  cube(ctx) {
    const [x, y, z] = vec3(arg(ctx, 0, 'size', 1), [1, 1, 1]);
    const c = arg(ctx, 1, 'center', false);
    const r = new Res();
    r.solids.push({ kind: 'cube', size: [x, y, z], m4: c ? translate4(-x / 2, -y / 2, -z / 2) : I4, line: ctx.line });
    return r;
  },
  cylinder(ctx) {
    const n = ctx.args.named;
    const h = num(arg(ctx, 0, 'h', 1), 1);
    let r1 = num(n.r1 ?? n.r ?? ctx.args.pos[1], 1), r2 = num(n.r2 ?? n.r ?? ctx.args.pos[2] ?? r1, r1);
    if (isNum(n.d)) r1 = r2 = n.d / 2;
    if (isNum(n.d1)) r1 = n.d1 / 2;
    if (isNum(n.d2)) r2 = n.d2 / 2;
    const r = new Res();
    r.solids.push({ kind: 'cylinder', h, r1, r2, m4: n.center ? translate4(0, 0, -h / 2) : I4, line: ctx.line });
    return r;
  },
  sphere(ctx) {
    let r0 = num(arg(ctx, 0, 'r', 1), 1);
    if (isNum(ctx.args.named.d)) r0 = ctx.args.named.d / 2;
    const r = new Res();
    r.solids.push({ kind: 'sphere', r: r0, m4: I4, line: ctx.line });
    return r;
  },

  // ---- transforms
  translate(ctx) {
    const [x, y, z] = vec3(arg(ctx, 0, 'v', [0, 0, 0]));
    return transformRes(ctx, translate4(x, y, z));
  },
  rotate(ctx) {
    const a = arg(ctx, 0, 'a', 0);
    const v = arg(ctx, 1, 'v', undefined);
    let m;
    if (isVec(a)) m = rotXYZ(...vec3(a));
    else if (isVec(v)) m = rotAxis(num(a, 0), vec3(v));
    else m = rotXYZ(0, 0, num(a, 0));
    return transformRes(ctx, m);
  },
  scale(ctx) {
    const v = arg(ctx, 0, 'v', 1);
    const [x, y, z] = isNum(v) ? [v, v, v] : vec3(v, [1, 1, 1]);
    return transformRes(ctx, scale4(x, y, z));
  },
  mirror(ctx) {
    return transformRes(ctx, mirror4(vec3(arg(ctx, 0, 'v', [1, 0, 0]))));
  },
  multmatrix(ctx) {
    const m = arg(ctx, 0, 'm', undefined);
    const M = [...I4];
    if (isVec(m)) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (isVec(m[i]) && isNum(m[i][j])) M[i * 4 + j] = m[i][j];
    return transformRes(ctx, M);
  },
  resize(ctx) {
    const [w, h] = vec2(arg(ctx, 0, 'newsize', [0, 0]));
    const r = ctx.children();
    if (!r.shapes.length) return r;
    const s = Shape.merge(r.shapes);
    const b = s.bounds();
    const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    let sx = w > 0 ? w / bw : 1, sy = h > 0 ? h / bh : 1;
    if (w > 0 && !(h > 0)) sy = arg(ctx, 1, 'auto', false) ? sx : 1;
    if (h > 0 && !(w > 0)) sx = arg(ctx, 1, 'auto', false) ? sy : 1;
    r.shapes = [s.transform(mul2([1, 0, 0, 1, b.x0, b.y0], mul2(scale2(sx, sy), [1, 0, 0, 1, -b.x0, -b.y0])))];
    return r;
  },
  offset(ctx) {
    const n = ctx.args.named;
    const r = ctx.children();
    const shapes = r.shapes.map(s => {
      if (isNum(n.r) || isNum(ctx.args.pos[0])) return s.withBody(clip.offset(s.body, num(n.r, ctx.args.pos[0]), 'round'));
      if (isNum(n.delta)) return s.withBody(clip.offset(s.body, n.delta, n.chamfer ? 'square' : 'miter', 0.01, 1e3));
      return s;
    });
    r.shapes = shapes;
    return r;
  },
  hull(ctx) {
    const r = ctx.children();
    const pts = r.shapes.flatMap(s => s.body.flat());
    const merged = Shape.merge(r.shapes, 'none');
    r.shapes = pts.length >= 3 ? [merged.withBody(clip.union([clip.convexHull(pts)]))] : [];
    return r;
  },
  minkowski(ctx) {
    const kids = ctx.childList().filter(k => k.shapes.length);
    if (!kids.length) return new Res();
    let body = Shape.merge(kids[0].shapes).body;
    for (const k of kids.slice(1)) body = clip.minkowski(body, Shape.merge(k.shapes).body);
    return Res.of(Shape.merge(kids.flatMap(k => k.shapes), 'none').withBody(body));
  },

  // ---- booleans
  union(ctx) { return boolean(ctx, 'union'); },
  difference(ctx) { return boolean(ctx, 'difference'); },
  intersection(ctx) { return boolean(ctx, 'intersection'); },
  group(ctx) { return ctx.children(); },
  render(ctx) { return ctx.children(); },
  color(ctx) {
    const c = arg(ctx, 0, 'c', undefined);
    const r = ctx.children();
    const css = colorToCss(c, arg(ctx, 1, 'alpha', 1));
    if (css) r.parts = r.parts.map(p => ({ ...p, color: css }));
    r.solids = r.solids.map(s => ({ ...s, color: css || s.color }));
    return r;
  },

  // ---- laser operations
  // engrave(): fill-engrave the children's areas; lines inside become scores
  engrave(ctx) {
    const r = ctx.children();
    r.shapes = r.shapes.map(s => new Shape({
      engrave: clip.union([...s.body, ...s.engrave]),
      score: [...s.score, ...s.lines],
      images: s.images,
      highlight: s.highlight,
    }));
    return r;
  },
  // score(): line-engrave the outlines of the children (no cutting)
  score(ctx) {
    const r = ctx.children();
    r.shapes = r.shapes.map(s => new Shape({
      score: [...s.score, ...s.lines, ...s.body.map(p => [...p, p[0]])],
      engrave: s.engrave,
      images: s.images,
      highlight: s.highlight,
    }));
    return r;
  },
  // cut(): cut the children's outlines as lines without making them holes
  cut(ctx) {
    const r = ctx.children();
    r.shapes = r.shapes.map(s => new Shape({
      lines: [...s.lines, ...s.score, ...s.body.map(p => [...p, p[0]])],
      highlight: s.highlight,
    }));
    return r;
  },

  // material("ply3", thickness=3, color=..., kerf=0.1, sheet=[600,400])
  material(ctx) {
    const name = String(arg(ctx, 0, 'name', 'default'));
    const n = ctx.args.named;
    const prev = ctx.interp.materials.get(name) || { ...DEFAULT_MATERIAL, name };
    const m = {
      ...prev,
      name,
      thickness: num(arg(ctx, 1, 'thickness', prev.thickness), prev.thickness),
      color: colorToCss(n.color, 1) || prev.color,
      opacity: num(n.opacity, prev.opacity),
      kerf: num(n.kerf, prev.kerf),
      sheet: isVec(n.sheet) ? vec2(n.sheet) : prev.sheet,
      margin: num(n.margin, prev.margin),
      gap: num(n.gap, prev.gap),
      isMaterial: true,
    };
    ctx.interp.materials.set(name, m);
    return null;
  },

  // part("name", material, qty=1) { 2D geometry } — one physical piece
  part(ctx) {
    const name = arg(ctx, 0, 'name', 'part');
    const n = ctx.args.named;
    let mat;
    const mArg = arg(ctx, 1, 'material', undefined);
    if (mArg !== undefined) mat = ctx.interp.material(mArg, ctx.line);
    else if (isNum(n.thickness)) {
      const key = `${n.thickness}mm`;
      if (!ctx.interp.materials.has(key)) ctx.interp.materials.set(key, { ...DEFAULT_MATERIAL, name: key, thickness: n.thickness });
      mat = ctx.interp.materials.get(key);
    } else mat = ctx.interp.defaultMaterial();
    const r = ctx.children();
    const out = new Res();
    out.parts.push(...r.parts);
    if (r.parts.length) ctx.interp.warn(`part("${name}") contains other parts`, ctx.line);
    out.ghosts.push(...r.ghosts);
    out.solids.push(...r.solids);
    const shape = Shape.merge(r.shapes);
    const p = ctx.interp.makePart(name, mat, shape, ctx.line, {
      qty: isNum(n.qty) ? n.qty : 1, center: n.center, color: colorToCss(n.color, 1), flip: n.flip,
    });
    out.parts.push(p);
    return out;
  },

  children(ctx) { return ctx.interp.callChildren(ctx); },
  echo(ctx) {
    ctx.interp.echoArgs(ctx.args, ctx.line);
    return ctx.children();
  },
  assert(ctx) {
    if (!truthy(ctx.args.pos[0])) throw ctx.interp.err('Assertion failed' + (ctx.args.pos[1] ? ': ' + ctx.args.pos[1] : ''), ctx.line);
    return ctx.children();
  },
};

const NAMED_COLORS = {
  red: '#e33', green: '#3a3', blue: '#36d', yellow: '#ec3', orange: '#f93', purple: '#93c', black: '#222',
  white: '#eee', gray: '#888', grey: '#888', brown: '#8b5a2b', tan: '#d2b48c', pink: '#f9c', cyan: '#3cc',
  magenta: '#c3c', silver: '#bbb', gold: '#da3', wood: '#d9b38c', clear: '#cde',
};
function colorToCss(c, alpha) {
  if (typeof c === 'string') return NAMED_COLORS[c.toLowerCase()] || c;
  if (isNumVec(c) && c.length >= 3) {
    const h = v => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
    return '#' + h(c[0]) + h(c[1]) + h(c[2]);
  }
  void alpha;
  return null;
}

const m1 = f => function ({ pos }) { return isNum(pos[0]) ? f(pos[0]) : undefined; };
const BUILTIN_FUNCS = {
  abs: m1(Math.abs), sign: m1(Math.sign), floor: m1(Math.floor), ceil: m1(Math.ceil),
  round: m1(x => (x < 0 ? -Math.round(-x) : Math.round(x))),
  sqrt: m1(Math.sqrt), exp: m1(Math.exp), ln: m1(Math.log), log: m1(Math.log10),
  sin: m1(sind), cos: m1(cosd), tan: m1(x => Math.tan(x * Math.PI / 180)),
  asin: m1(x => Math.asin(x) * 180 / Math.PI), acos: m1(x => Math.acos(x) * 180 / Math.PI),
  atan: m1(x => Math.atan(x) * 180 / Math.PI),
  atan2({ pos }) { return Math.atan2(pos[0], pos[1]) * 180 / Math.PI; },
  pow({ pos }) { return Math.pow(pos[0], pos[1]); },
  min({ pos }) { const a = pos.length === 1 && isVec(pos[0]) ? pos[0] : pos; return a.length ? Math.min(...a) : undefined; },
  max({ pos }) { const a = pos.length === 1 && isVec(pos[0]) ? pos[0] : pos; return a.length ? Math.max(...a) : undefined; },
  norm({ pos }) { return isNumVec(pos[0]) ? Math.hypot(...pos[0]) : undefined; },
  cross({ pos }) {
    const [a, b] = pos;
    if (!isNumVec(a) || !isNumVec(b)) return undefined;
    if (a.length === 2) return a[0] * b[1] - a[1] * b[0];
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  },
  len({ pos }) { const v = pos[0]; return isVec(v) || typeof v === 'string' ? v.length : undefined; },
  concat({ pos }) { return pos.flatMap(v => (isVec(v) ? v : [v])); },
  str({ pos }) { return pos.map(v => (typeof v === 'string' ? v : formatValue(v))).join(''); },
  chr({ pos }) { return (isVec(pos[0]) ? pos[0] : pos).map(c => String.fromCodePoint(c)).join(''); },
  ord({ pos }) { return typeof pos[0] === 'string' && pos[0].length ? pos[0].codePointAt(0) : undefined; },
  lookup({ pos }) {
    const [k, tbl] = pos;
    if (!isNum(k) || !isVec(tbl) || !tbl.length) return undefined;
    if (k <= tbl[0][0]) return tbl[0][1];
    for (let i = 1; i < tbl.length; i++) {
      if (k <= tbl[i][0]) {
        const [a, va] = tbl[i - 1], [b, vb] = tbl[i];
        return va + (vb - va) * (k - a) / (b - a);
      }
    }
    return tbl[tbl.length - 1][1];
  },
  rands({ pos }) {
    const [lo, hi, n, seed] = pos;
    let s = isNum(seed) ? seed : Math.random() * 1e9;
    const rnd = () => { s = (s * 16807 + 12345) % 2147483647; return (s % 1e6) / 1e6; };
    return Array.from({ length: n }, () => lo + rnd() * (hi - lo));
  },
  is_undef({ pos }) { return pos[0] === undefined; },
  is_num({ pos }) { return isNum(pos[0]) && !Number.isNaN(pos[0]); },
  is_bool({ pos }) { return typeof pos[0] === 'boolean'; },
  is_string({ pos }) { return typeof pos[0] === 'string'; },
  is_list({ pos }) { return isVec(pos[0]); },
  is_function({ pos }) { return pos[0] instanceof Closure || !!(pos[0] && pos[0].builtin); },
  version() { return [2026, 10, 0]; },
  // thickness("ply3") → material thickness in mm
  thickness({ pos }, scope, line) { return this.material(pos[0], line).thickness; },
  kerf({ pos }, scope, line) { return this.material(pos[0], line).kerf; },
};

export { Range };
