// Node tests for the language + geometry core: `node test/interp.test.mjs`
import { createRequire } from 'module';
import fs from 'fs';
import assert from 'assert';
const require = createRequire(import.meta.url);
globalThis.ClipperLib = require('clipper-lib');
const opentype = require('opentype.js');
const { Interpreter } = await import('../js/lang/interp.js');
const clip = await import('../js/geom/clip.js');

const stdlib = fs.readFileSync(new URL('../lib/stdlib.kerf', import.meta.url), 'utf8');
const font = opentype.loadSync('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf');
const libFile = p => { try { return fs.readFileSync(new URL('../lib/' + p, import.meta.url), 'utf8'); } catch { return null; } };
const resources = { missing: new Set(), font: () => font, text: () => null, lib: libFile, image: () => null, svg: () => null };

function run(src) {
  const it = new Interpreter(resources, { stdlib });
  return it.run(src);
}
const areaOf = paths => paths.reduce((s, p) => s + clip.area(p), 0);
let n = 0;
function test(name, fn) {
  try { fn(); n++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n', e); process.exitCode = 1; }
}

test('square area', () => {
  const r = run('square([10,20]);');
  assert.equal(r.parts.length, 1);
  assert(Math.abs(areaOf(r.parts[0].shape.body) - 200) < 1e-6);
});
test('difference makes a hole', () => {
  const r = run('difference(){ square(20, center=true); circle(5, $fn=64); }');
  const a = areaOf(r.parts[0].shape.body);
  assert(Math.abs(a - (400 - 64 / 2 * 25 * Math.sin(2 * Math.PI / 64))) < 1e-3, a);
});
test('functions, list comprehension, ranges', () => {
  const r = run('function f(x) = x*x; v = [for (i=[1:4]) if (i%2==0) f(i)]; echo(v, sum=v[0]+v[1]);');
  assert.equal(r.echo[0].text, '[4, 16], sum = 20');
});
test('module with children and $vars', () => {
  const r = run('module two() { children(); translate([20,0]) children(); } two() square(5);');
  assert(Math.abs(areaOf(r.parts[0].shape.body) - 50) < 1e-6);
});
test('nested children', () => {
  const r = run('module a() b() children(); module b() { children(); } a() square(3);');
  assert(Math.abs(areaOf(r.parts[0].shape.body) - 9) < 1e-6);
});
test('engrave text clipped to part', () => {
  const r = run('part("p", thickness=3) { square([60,20]); engrave() translate([5,5]) text("Hi", size=10); }');
  const p = r.parts[0];
  assert.equal(p.material.thickness, 3);
  assert(p.shape.engrave.length > 0);
  assert(Math.abs(areaOf(p.shape.body) - 1200) < 1e-6);
});
test('box example: 5 parts, matching joints', () => {
  const src = fs.readFileSync(new URL('../examples/box.kerf', import.meta.url), 'utf8');
  const r = run(src);
  assert.deepEqual(r.parts.map(p => p.name), ['bottom', 'front', 'back', 'left', 'right']);
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
  assert.equal(r.solids.length, 1); // the % reference cube
});
test('living hinge lines are clipped into part', () => {
  const r = run('part("h") { square([40,30]); translate([5,0]) living_hinge(30, 30); }');
  assert(r.parts[0].shape.lines.length > 10);
});
test('assert + errors carry line numbers', () => {
  try { run('x=1;\n\nsquare(;'); assert.fail('no error'); } catch (e) { assert.equal(e.line, 3); }
});

const { findInterference } = await import('../js/geom/interfere.js');
const await_flex = await import('../js/geom/flex.js');
const await_layout = await import('../js/geom/layout.js');
test('box example parts do not interfere', () => {
  const r = run(fs.readFileSync(new URL('../examples/box.kerf', import.meta.url), 'utf8'));
  const hits = findInterference(r.parts);
  assert.equal(hits.length, 0, hits.map(h => `${h.a.name}×${h.b.name} ${h.volume.toFixed(1)}mm³`).join(', '));
});
test('interference is detected when a joint is wrong', () => {
  const src = fs.readFileSync(new URL('../examples/box.kerf', import.meta.url), 'utf8')
    .replace('finger_tabs(W - 2 * t, t, nW, odd = true)', 'finger_tabs(W - 2 * t, t, nW, odd = false)');
  const hits = findInterference(run(src).parts);
  assert(hits.some(h => h.a.name === 'bottom' && h.b.name === 'front'), hits.map(h => h.a.name + h.b.name));
});
test('box is closed: every panel touches its neighbours', () => {
  // grow each part slightly in-plane: neighbours must then overlap
  const r = run(fs.readFileSync(new URL('../examples/box.kerf', import.meta.url), 'utf8'));
  const grown = r.parts.map(p => ({ ...p, shape: { ...p.shape, body: clip.offset(p.shape.body, 0.3) } }));
  const pairs = new Set(findInterference(grown).map(h => h.a.name + '-' + h.b.name));
  for (const want of ['bottom-front', 'bottom-back', 'bottom-left', 'bottom-right', 'front-left', 'front-right', 'back-left', 'back-right'])
    assert(pairs.has(want), want + ' missing; got ' + [...pairs]);
});

const { layoutParts } = await import('../js/geom/layout.js');
const { sheetToSVG } = await import('../js/geom/export.js');
test('layout: pieces inside sheet, no overlaps, qty honoured', () => {
  const r = run(fs.readFileSync(new URL('../examples/box.kerf', import.meta.url), 'utf8') +
    '\npart("washer", "ply3", qty=6) difference(){ circle(15); circle(5); }\npart("diag", "ply3") rotate(30) square([150, 20]);');
  const { sheets, warnings } = layoutParts(r.parts);
  assert.equal(warnings.length, 0, warnings.join());
  const placed = sheets.flatMap(s => s.items.map(it => ({ s, poly: it.part.shape.transform(it.m).body, name: it.part.name })));
  assert.equal(placed.length, 5 + 6 + 1);
  for (const p of placed) {
    const b = clip.bounds(p.poly);
    assert(b.x0 >= p.s.material.margin - 1e-6 && b.y0 >= p.s.material.margin - 1e-6 && b.x1 <= p.s.w + 1e-6 && b.y1 <= p.s.h + 1e-6, p.name + JSON.stringify(b));
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    if (placed[i].s !== placed[j].s) continue;
    const a = Math.abs(clip.intersection(placed[i].poly, placed[j].poly).reduce((s, p) => s + clip.area(p), 0));
    assert(a < 1e-6, `${placed[i].name} overlaps ${placed[j].name}`);
  }
  console.log('     sheets:', sheets.map(s => `${s.material.name}#${s.index + 1}: ${s.items.length} pcs`).join(', '));
  const svg = sheetToSVG(sheets[0]);
  assert(svg.includes('width="400mm"') && svg.includes('id="cut"') && svg.includes('id="engrave"'));
  
});
const { solidsAsPrisms } = await import('../js/geom/interfere.js');
test('reference objects take part in the fit check', () => {
  const box = fs.readFileSync(new URL('../examples/box.kerf', import.meta.url), 'utf8');
  const ok = run(box);
  assert.equal(findInterference(ok.parts, { refs: solidsAsPrisms(ok.solids) }).length, 0);
  const big = run(box.replace('cube([100, 60, 40])', 'cube([118, 60, 40])'));
  const hits = findInterference(big.parts, { refs: solidsAsPrisms(big.solids) });
  assert(hits.length && hits.every(h => h.b.ref), JSON.stringify(hits.map(h => [h.a.name, h.b.name])));
});

const lessons = fs.readdirSync(new URL('../tutorial/', import.meta.url)).filter(f => f.endsWith('.kerf')).sort();
const lesson = f => fs.readFileSync(new URL('../tutorial/' + f, import.meta.url), 'utf8');
const fit = r => findInterference(r.parts, { refs: solidsAsPrisms(r.solids) });
for (const f of lessons) test(`tutorial ${f} runs clean`, () => {
  const r = run(lesson(f));
  assert(r.parts.length > 0);
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
  assert.equal(fit(r).length, 0, fit(r).map(h => h.a.name + '×' + h.b.name).join());
  assert.equal(layoutParts(r.parts).warnings.length, 0);
});
test('tutorial 7: the "break it" tasks are caught', () => {
  const src = lesson('07-test-fit.kerf');
  assert(fit(run(src.replace('gap = 0.2;', 'gap = -0.5;'))).some(h => h.a.name === 'base' && h.b.name === 'panel'));
  const tight = fit(run(src.replace('gap = 0.2;', 'gap = -0.1;')));
  assert(tight.length === 1 && Math.abs(tight[0].volume - 0.1 * 80 * 6) < 1, 'expected 48 mm³, got ' + tight.map(h => h.volume));
  assert.equal(fit(run(src.replace('gap = 0.2;', 'gap = 0;'))).length, 0); // touching is not a collision
  assert(fit(run(src.replace('cube([70, 9, 140])', 'cube([70, 20, 140])'))).some(h => h.b.ref));
});
test('tutorial 8: floor and wall actually meet', () => {
  const r = run(lesson('08-finger-joints.kerf'));
  const grown = r.parts.map(p => ({ ...p, shape: { ...p.shape, body: clip.offset(p.shape.body, 0.3) } }));
  assert.equal(findInterference(grown).length, 1);
  assert.equal(fit(run(lesson('08-finger-joints.kerf').replace('odd = false', 'odd = true'))).length, 1);
});
test('tutorial 9: comb labels', () => {
  const r = run(lesson('09-kerf-and-fit.kerf').replace('part("kerf square"', 'echo(widths); part("kerf square"'));
  assert.equal(r.echo[0].text, '[2.7, 2.8, 2.9, 3, 3.1, 3.2, 3.3]');
});

test('edge-touching tabs fuse into one piece', () => {
  const r = run('part("p", thickness=3) { translate([3,3]) square([114,47]); translate([3,0]) finger_tabs(114, 3, odd=true); }');
  assert.equal(r.parts[0].shape.body.filter(p => clip.area(p) > 0).length, 1);
  const two = run('square(10); translate([20,0]) square(10);');
  assert.equal(two.parts[0].shape.body.length, 2);
});
test('use<> keeps library variables, nested use works', () => {
  const r = run('use <hinges.kerf>\nmaterial("ply3", thickness=3);\nhinged_box([120,80,50], "ply3", lid_h=25);\necho(bend_length(90, 2, 3));');
  assert.equal(r.parts.length, 10);
  assert.equal(findInterference(r.parts).length, 0);
});
test('library boxes do not interfere', () => {
  for (const top of ['open', 'closed', 'lid']) {
    const r = run(`use <boxes.kerf>\nmaterial("ply3", thickness=3);\nfinger_box([120,80,60], "ply3", top="${top}");`);
    assert.equal(findInterference(r.parts).length, 0, top);
    for (const p of r.parts) assert.equal(p.shape.body.filter(q => clip.area(q) > 0).length, 1, p.name);
  }
});
test('hinged lid opens without collisions', () => {
  for (const open of [45, 90, 130]) {
    const r = run(`use <hinges.kerf>\nmaterial("ply3", thickness=3);\nhinged_box([120,80,50], "ply3", lid_h=25, open=${open});`);
    assert.equal(findInterference(r.parts).length, 0, open);
  }
});
test('gears mesh at gear_distance and collide when too close', () => {
  const g = (extra, dir = 0, a1 = 0) => run(`use <gears.kerf>\nrotate(${a1}) part("a", thickness=3) gear(24);\ngear_mesh(24, 13, 2, a1=${a1}, dir=${dir}, extra=${extra}) part("b", thickness=3) gear(13);`).parts;
  assert.equal(findInterference(g(0, 35, 4)).length, 0);
  assert.equal(findInterference(g(-0.4, 35, 4)).length, 1);
  assert.equal(run('use <gears.kerf>\necho(gear_distance(20, 12, 1.5));').echo[0].text, '24');
});
test('round_corners: rounded rectangle', () => {
  const r = run('p = round_corners([[0,0],[120,0],[120,80],[0,80]], 20, $fn=360); echo(len(p), p[0]);');
  assert.equal(r.echo[0].text.split(',')[1].trim(), '[60', r.echo[0].text); // starts mid first edge
  const area = run('part("p", thickness=3) polygon(round_corners([[0,0],[120,0],[120,80],[0,80]], 20, $fn=360));').parts[0];
  assert(Math.abs(areaOf(area.shape.body) - (120 * 80 - (4 - Math.PI) * 400)) < 0.5, areaOf(area.shape.body));
  assert(run('x = round_corners([[0,0],[10,0],[10,10],[0,10]], 30);').warnings.length === 1); // radius reduced
});
test('flex: panel length follows the centreline', () => {
  // 120 x 80 outside, r 20, t 3: centreline = straights + circle of radius 18.5
  const L = run('use <flex.kerf>\necho(flex_lengths(rounded_rect([120,80], 20), 3, $fn=720));').echo[0].text;
  const want = 2 * 80 + 2 * 40 + 2 * Math.PI * 18.5;
  assert(Math.abs(JSON.parse(L)[0] - want) < 0.05, L + ' vs ' + want);
  // flat back: 2 panels; the flat one is 70 + 3 (t/2 past each corner) - 3 (inside both walls)... = 70
  const r2 = run('use <flex.kerf>\necho(flex_count(round_corners([[0,0],[100,0],[100,70],[0,70]], [0,30,30,0]), 3), flex_lengths(round_corners([[0,0],[100,0],[100,70],[0,70]], [0,30,30,0]), 3)[0]);');
  assert.equal(r2.echo[0].text, '2, 70');
});
test('flex boxes fit together in every style', () => {
  const shapes = {
    rounded: 'rounded_rect([120, 80], 20)',
    'flat back': 'round_corners([[0,0],[100,0],[100,70],[0,70]], [0,30,30,0])',
    pot: '[for (a = [0:5:355]) 40 * [cos(a), sin(a)]]',
    square: '[[0,0],[100,0],[100,70],[0,70]]',
    'inward curve': 'round_corners([[0,0],[100,0],[100,80],[50,50],[0,80]], [15,15,15,30,15])',
  };
  for (const [k, path] of Object.entries(shapes)) {
    for (const opts of ['', ', lip = 4', ', top = "open"']) {
      const r = run(`use <flex.kerf>\nmaterial("ply3", 3);\nflex_box(${path}, 50, "ply3"${opts});`);
      assert.equal(r.warnings.length, 0, k + opts + JSON.stringify(r.warnings));
      const hits = findInterference(r.parts);
      assert.equal(hits.length, 0, `${k}${opts}: ` + hits.map(h => `${h.a.name}/${h.b.name} ${h.volume.toFixed(2)}`).join(', '));
      for (const p of r.parts) assert.equal(p.shape.body.filter(q => clip.area(q) > 0).length, 1, `${k}${opts} ${p.name} in one piece`);
    }
  }
});
test('flex: mismatched plate and panel collide (the check is real)', () => {
  const r = run('use <flex.kerf>\nmaterial("ply3", 3);\npath = rounded_rect([120, 80], 20);\n' +
    'part("bottom", "ply3") flex_plate(path, 3, fw = 12);\n' +
    'flex_bend(path, 3) part("wall", "ply3") flex_panel(path, 50, 3, fw = 20);');
  assert(findInterference(r.parts).length >= 1);
});
test('flex: hinge cuts only where it bends, narrow fingers on curves', () => {
  const r = run('use <flex.kerf>\nmaterial("ply3", 3);\npart("w", "ply3") flex_panel(round_corners([[0,0],[100,0],[100,70],[0,70]], [0,30,30,0]), 50, 3, 1);');
  const p = r.parts[0];
  const xs = p.shape.lines.map(l => l[0][0]);
  // panel 1 runs from the front-left corner: flat to x = 70 where the 30 mm
  // bend starts, and the cuts begin `margin` (3 mm) before it
  assert(Math.abs(Math.min(...xs) - 67) < 0.5, Math.min(...xs));
  assert(p.shape.lines.length > 100);
  // fingers: full width on the straight, narrower on the bend
  const flex = await_flex;
  const lay = flex.flexLayout(flex.roundCorners([[0, 0], [100, 0], [100, 70], [0, 70]], [0, 30, 30, 0], () => 360).path, 3);
  const w = lay.pieces[1].intervals.map(([a, b]) => [(a + b) / 2, b - a]);
  assert(w.filter(([x]) => x < 60).every(([, d]) => d > 10), JSON.stringify(w));
  assert(w.filter(([x]) => x > 75 && x < 110).every(([, d]) => d < 8), JSON.stringify(w));
});
test('flex: bad corners are explained', () => {
  assert.throws(() => run('use <flex.kerf>\nflex_box([[0,0],[100,0],[50,80]], 40, "x");'), /square outside corners/);
  assert.throws(() => run('use <flex.kerf>\nflex_box(rounded_rect([60,40], 1), 40, "x");'), /tighter than the sheet/);
  const warned = run('use <flex.kerf>\nflex_box(rounded_rect([60,40], 3), 40, "x");').warnings;
  assert(warned.some(x => /very tight/.test(x.msg)), JSON.stringify(warned));
});
test('flex: max_len splits long walls to fit small sheets', () => {
  const { layoutParts } = await_layout;
  const lens = src => JSON.parse(run(src).echo[0].text);
  // the lesson box: one 356 mm wall becomes two, each under 290
  const L = lens('use <flex.kerf>\necho(flex_lengths(rounded_rect([120, 80], 20), 3, max_len = 290));');
  assert.equal(L.length, 2, JSON.stringify(L));
  assert(L.every(x => x <= 290) && Math.abs(L[0] + L[1] - 356.237) < 0.01, JSON.stringify(L));
  const shapes = [
    'rounded_rect([120, 80], 20)',
    'round_corners([[0,0],[160,0],[160,90],[0,90]], [30,30,0,0])',
    '[for (a = [0:5:355]) 60 * [cos(a), sin(a)]]',
    'rounded_rect([200, 150], 25)',
  ];
  for (const path of shapes) for (const lip of [0, 4]) {
    const r = run(`use <flex.kerf>\nmaterial("ply3", 3, sheet = [300, 300]);\nflex_box(${path}, 60, "ply3", lip = ${lip}, max_len = 290);`);
    assert.equal(r.warnings.length, 0, path + JSON.stringify(r.warnings));
    const hits = findInterference(r.parts);
    assert.equal(hits.length, 0, `${path} lip ${lip}: ` + hits.map(h => `${h.a.name}/${h.b.name} ${h.volume.toFixed(2)}`).join(', '));
    const lay = layoutParts(r.parts);
    assert.equal(lay.warnings.length, 0, path + ' ' + lay.warnings.join('; '));
    for (const p of r.parts) assert.equal(p.shape.body.filter(q => clip.area(q) > 0).length, 1, `${path} ${p.name} in one piece`);
  }
  // seams never land in a bend: no hinge cut within margin of a panel's seam end
  const r = run('use <flex.kerf>\nmaterial("ply3", 3);\nflex_box(rounded_rect([200, 150], 25), 60, "ply3", max_len = 290);');
  for (const p of r.parts.filter(p => /wall/.test(p.name))) {
    const w = clip.bounds(p.shape.body).x1;
    for (const l of p.shape.lines) assert(l[0][0] > 3 && l[0][0] < w - 3, p.name + ' ' + l[0][0]);
  }
  assert.throws(() => run('use <flex.kerf>\nflex_box([for (a = [0:5:355]) 60 * [cos(a), sin(a)]], 60, "x", max_len = 20);'), /can't be split/);
  // flex_box splits to fit the material's sheet with no max_len given
  const auto = run('use <flex.kerf>\nmaterial("ply3", 3, sheet = [300, 300]);\nflex_box(rounded_rect([120, 80], 20), 60, "ply3");');
  assert.deepEqual(auto.parts.map(p => p.name), ['flex_bottom', 'flex_top', 'flex_wall1', 'flex_wall2']);
  assert.equal(layoutParts(auto.parts).warnings.length, 0);
  assert.equal(findInterference(auto.parts).length, 0);
  assert.equal(run('use <flex.kerf>\nmaterial("ply3", 3, sheet = [600, 400]);\nflex_box(rounded_rect([120, 80], 20), 60, "ply3");').parts.length, 3);
  assert.equal(run('material("m", 3, sheet = [300, 200], margin = 10);\necho(sheet_size("m"));').echo[0].text, '[280, 180]');
  // a round pot has no straight stretch: it still splits (seams in the bend)
  assert.equal(JSON.parse(run('use <flex.kerf>\necho(flex_lengths([for (a = [0:5:355]) 60 * [cos(a), sin(a)]], 3, max_len = 290));').echo[0].text).length, 2);
});
test('include of a missing file is reported, not fatal', () => {
  const r = run('include <nope.kerf>\nsquare(5);');
  assert.equal(r.parts.length, 1);
});
test('gears.kerf using <gears.kerf> gets the built-in library, not itself', () => {
  const res = { ...resources, resolve: p => p, lib: (p, builtinOnly) => (builtinOnly ? libFile(p) : 'use <gears.kerf>\ngear(10);') };
  const r = new Interpreter(res, { stdlib, file: 'gears.kerf' }).run('use <gears.kerf>\ngear(10);');
  assert.equal(r.parts.length, 1);
});
console.log(`${n} passed`);
