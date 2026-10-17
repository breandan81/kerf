// Kerf language: lexer + parser. The syntax is an OpenSCAD subset
// (assignments, modules, functions, for/if/let, list comprehensions,
// function literals) so OpenSCAD habits carry over.

export class KerfError extends Error {
  constructor(msg, line, file) {
    super(msg);
    this.line = line;
    this.file = file;
  }
}

const PUNCT = ['<=', '>=', '==', '!=', '&&', '||',
  '+', '-', '*', '/', '%', '^', '!', '<', '>', '=', '?', ':', ';', ',', '.',
  '(', ')', '[', ']', '{', '}', '#'];

export function tokenize(src, file = '') {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
      continue;
    }
    // include <file> / use <file>
    if ((src.startsWith('include', i) || src.startsWith('use', i)) && !/[\w$]/.test(src[i - 1] || '')) {
      const m = /^(include|use)\s*<([^>]*)>/.exec(src.slice(i, i + 400));
      if (m) {
        toks.push({ t: m[1], v: m[2].trim(), line });
        i += m[0].length;
        continue;
      }
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
      toks.push({ t: 'num', v: parseFloat(m[0]), line });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 256));
      const w = m[0];
      const kw = ['module', 'function', 'if', 'else', 'for', 'let', 'each', 'true', 'false', 'undef', 'assert', 'echo'];
      toks.push({ t: kw.includes(w) ? w : 'id', v: w, line });
      i += w.length;
      continue;
    }
    if (c === '"') {
      let s = '';
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\') {
          const e = src[i + 1];
          if (e === 'n') s += '\n';
          else if (e === 't') s += '\t';
          else if (e === 'u' || e === 'x') {
            const len = e === 'u' ? 4 : 2;
            s += String.fromCodePoint(parseInt(src.substr(i + 2, len), 16));
            i += len;
          } else s += e;
          i += 2;
        } else {
          if (src[i] === '\n') line++;
          s += src[i++];
        }
      }
      if (i >= n) throw new KerfError('Unterminated string', line, file);
      i++;
      toks.push({ t: 'str', v: s, line });
      continue;
    }
    const p = PUNCT.find(p => src.startsWith(p, i));
    if (!p) throw new KerfError(`Unexpected character '${c}'`, line, file);
    toks.push({ t: p, v: p, line });
    i += p.length;
  }
  toks.push({ t: 'eof', v: null, line });
  return toks;
}

export function parse(src, file = '') {
  const toks = tokenize(src, file);
  let pos = 0;
  const peek = (o = 0) => toks[pos + o];
  const at = t => toks[pos].t === t;
  const next = () => toks[pos++];
  const err = (msg, tok = peek()) => new KerfError(msg, tok.line, file);
  const expect = (t) => {
    if (!at(t)) {
      const tk = peek();
      throw err(`Expected '${t}' but found ${tk.t === 'eof' ? 'end of file' : `'${tk.v}'`}`);
    }
    return next();
  };
  const accept = t => (at(t) ? next() : null);

  // ---------- statements ----------
  function statement() {
    const tok = peek();
    const line = tok.line;
    if (accept(';')) return null;
    if (at('{')) {
      next();
      const body = [];
      while (!at('}')) {
        if (at('eof')) throw err("Missing '}'", tok);
        const s = statement();
        if (s) body.push(s);
      }
      next();
      return { type: 'block', body, line };
    }
    if (at('include') || at('use')) {
      next();
      return { type: tok.t, path: tok.v, line };
    }
    if (at('module')) {
      next();
      const name = expect('id').v;
      const params = paramList();
      const body = statement();
      return { type: 'moduledef', name, params, body, line };
    }
    if (at('function')) {
      next();
      const name = expect('id').v;
      const params = paramList();
      expect('=');
      const expr = expression();
      expect(';');
      return { type: 'funcdef', name, params, expr, line };
    }
    if (at('id') && peek(1).t === '=') {
      const name = next().v;
      next();
      const expr = expression();
      expect(';');
      return { type: 'assign', name, expr, line };
    }
    // modifiers
    if (at('*') || at('#') || at('%') || at('!')) {
      const mod = next().t;
      const s = statement();
      if (s) s.modifier = mod;
      return s;
    }
    if (at('if')) {
      next();
      expect('(');
      const cond = expression();
      expect(')');
      const then = statement();
      let els = null;
      if (accept('else')) els = statement();
      return { type: 'if', cond, then, else: els, line };
    }
    if (at('for') || at('let')) {
      const kind = next().t;
      const bindings = assignList();
      const child = statement();
      return { type: kind, bindings, child, line };
    }
    if (at('echo') || at('assert')) {
      const kind = next().t;
      const args = argList();
      const child = at(';') ? (next(), null) : statement();
      return { type: 'call', name: kind, args, children: child ? [child] : [], line };
    }
    if (at('id')) {
      const name = next().v;
      const args = argList();
      let children = [];
      if (accept(';')) children = [];
      else {
        const s = statement();
        if (s) children = s.type === 'block' ? s.body : [s];
      }
      return { type: 'call', name, args, children, line };
    }
    throw err(`Unexpected ${tok.t === 'eof' ? 'end of file' : `'${tok.v}'`}`);
  }

  function paramList() {
    expect('(');
    const params = [];
    while (!at(')')) {
      const name = expect('id').v;
      let def = null;
      if (accept('=')) def = expression();
      params.push({ name, def });
      if (!accept(',')) break;
    }
    expect(')');
    return params;
  }

  function argList() {
    expect('(');
    const args = [];
    while (!at(')')) {
      if (at('id') && peek(1).t === '=') {
        const name = next().v;
        next();
        args.push({ name, expr: expression() });
      } else {
        args.push({ name: null, expr: expression() });
      }
      if (!accept(',')) break;
    }
    expect(')');
    return args;
  }

  // (a = 1, b = [0:3]) for for/let
  function assignList() {
    expect('(');
    const list = [];
    while (!at(')')) {
      const name = expect('id').v;
      expect('=');
      list.push({ name, expr: expression() });
      if (!accept(',')) break;
    }
    expect(')');
    return list;
  }

  // ---------- expressions ----------
  function expression() {
    const line = peek().line;
    if (at('let')) {
      next();
      const bindings = assignList();
      return { type: 'let', bindings, body: expression(), line };
    }
    if (at('assert') || at('echo')) {
      const kind = next().t;
      const args = argList();
      const body = (at(';') || at(')') || at(',') || at(']')) ? null : expression();
      return { type: kind + 'expr', args, body, line };
    }
    if (at('function')) {
      next();
      const params = paramList();
      return { type: 'lambda', params, body: expression(), line };
    }
    const cond = binary(0);
    if (accept('?')) {
      const a = expression();
      expect(':');
      const b = expression();
      return { type: 'ternary', cond, a, b, line };
    }
    return cond;
  }

  const LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']];

  function binary(level) {
    if (level >= LEVELS.length) return unary();
    let left = binary(level + 1);
    while (LEVELS[level].includes(peek().t)) {
      const op = next();
      const right = binary(level + 1);
      left = { type: 'bin', op: op.t, a: left, b: right, line: op.line };
    }
    return left;
  }

  function unary() {
    if (at('-') || at('+') || at('!')) {
      const op = next();
      return { type: 'unary', op: op.t, a: unary(), line: op.line };
    }
    return power();
  }

  function power() {
    const base = postfix();
    if (at('^')) {
      const op = next();
      return { type: 'bin', op: '^', a: base, b: unary(), line: op.line };
    }
    return base;
  }

  function postfix() {
    let e = primary();
    for (;;) {
      if (at('(')) {
        const line = peek().line;
        e = { type: 'callexpr', fn: e, args: argList(), line };
      } else if (at('[')) {
        const line = next().line;
        const index = expression();
        expect(']');
        e = { type: 'index', a: e, index, line };
      } else if (at('.')) {
        const line = next().line;
        e = { type: 'member', a: e, name: expect('id').v, line };
      } else break;
    }
    return e;
  }

  function primary() {
    const tok = peek();
    const line = tok.line;
    switch (tok.t) {
      case 'num': next(); return { type: 'lit', v: tok.v, line };
      case 'str': next(); return { type: 'lit', v: tok.v, line };
      case 'true': next(); return { type: 'lit', v: true, line };
      case 'false': next(); return { type: 'lit', v: false, line };
      case 'undef': next(); return { type: 'lit', v: undefined, line };
      case 'id': next(); return { type: 'var', name: tok.v, line };
      case '(': {
        next();
        const e = expression();
        expect(')');
        return e;
      }
      case '[': return listOrRange();
    }
    throw err(`Unexpected ${tok.t === 'eof' ? 'end of file' : `'${tok.v}'`} in expression`);
  }

  function listOrRange() {
    const line = expect('[').line;
    if (accept(']')) return { type: 'list', items: [], line };
    if (at('for') || at('each') || at('if') || at('let')) {
      const items = [compElem()];
      while (accept(',')) { if (at(']')) break; items.push(listElem()); }
      expect(']');
      return { type: 'list', items, line };
    }
    const first = listElem();
    if (accept(':')) {
      const second = expression();
      if (accept(':')) {
        const third = expression();
        expect(']');
        return { type: 'range', start: first, step: second, end: third, line };
      }
      expect(']');
      return { type: 'range', start: first, step: null, end: second, line };
    }
    const items = [first];
    while (accept(',')) {
      if (at(']')) break;
      items.push(listElem());
    }
    expect(']');
    return { type: 'list', items, line };
  }

  function listElem() {
    if (at('for') || at('each') || at('if') || (at('let') && peek(1).t === '(' && isCompLet())) return compElem();
    return expression();
  }

  // `let` inside a list is a comprehension element only if followed by for/if/each after its bindings
  function isCompLet() {
    let depth = 0, k = pos + 1;
    for (; k < toks.length; k++) {
      if (toks[k].t === '(') depth++;
      else if (toks[k].t === ')') { depth--; if (depth === 0) break; }
    }
    const t = toks[k + 1] && toks[k + 1].t;
    return t === 'for' || t === 'if' || t === 'each' || t === 'let';
  }

  function compElem() {
    const line = peek().line;
    if (accept('for')) {
      const bindings = assignList();
      return { type: 'compfor', bindings, body: compElem(), line };
    }
    if (accept('each')) return { type: 'compeach', a: compElem(), line };
    if (accept('if')) {
      expect('(');
      const cond = expression();
      expect(')');
      const then = compElem();
      let els = null;
      if (accept('else')) els = compElem();
      return { type: 'compif', cond, then, else: els, line };
    }
    if (at('let') && isCompLet()) {
      next();
      const bindings = assignList();
      return { type: 'complet', bindings, body: compElem(), line };
    }
    if (at('(') ) {
      // parenthesised comprehension element e.g. (for ...)
      const save = pos;
      next();
      if (at('for') || at('if') || at('each')) {
        const e = compElem();
        expect(')');
        return e;
      }
      pos = save;
    }
    return expression();
  }

  const body = [];
  while (!at('eof')) {
    const s = statement();
    if (s) body.push(s);
  }
  return { type: 'program', body, file };
}
