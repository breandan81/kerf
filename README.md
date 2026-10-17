# Kerf

OpenSCAD-style code CAD for laser cutting. Write flat parts with 2D shapes
and booleans, give them a material thickness, test-fit the assembly in 3D,
and export sheets as SVG for the laser (tuned for xTool Creative Space).

```
./run.sh                 # project folder = ./projects (examples copied in on first run)
./run.sh ~/some/folder   # any folder of .kerf files + images/SVGs
```

Opens http://127.0.0.1:8790/. The **Tutorial** panel (open on first visit) walks through ten lessons;
each opens a file under `<project>/tutorial/`. Press **F1** for the language reference.

Everything runs in the browser; `serve.py` only serves files, saves your project and finds fonts.

**Website** (https://kerf.bposhaughnessy.com, `./deploy_tau.sh`): works like a desktop app. **Open…** loads a
`.kerf` (plus its images/SVGs/fonts) from disk; **Save** writes it back in place (Chrome/Edge) or downloads it
(Firefox: set *Always ask you where to save files* for a save dialog). Exports download. Unsaved edits survive
a closed tab as a draft. Chrome/Edge can also **Open folder…**. Fonts are the bundled set in `fonts/`.

```openscad
material("ply3", thickness = 3, kerf = 0.12, sheet = [400, 300]);
t = thickness("ply3");

part("lid", "ply3") {
  difference() {
    rounded_square([120, 80], r = 5);
    translate([60, 70]) slot(30, 8);
  }
  engrave() translate([60, 35]) text("TOOLS", size = 14, halign = "center");
}

translate([0, 0, 60]) part("lid2", "ply3") square([120, 80]);   // place in 3D
%translate([10, 10, t]) cube([100, 60, 40]);                     // reference object
```

## How it works

| | |
|---|---|
| `js/lang/parser.js` | OpenSCAD-subset lexer/parser |
| `js/lang/interp.js` | evaluator; builtin modules (shapes, transforms, booleans, `part`, `material`, `engrave`/`score`/`cut`) |
| `lib/stdlib.kerf` | standard library in Kerf: finger joints, T-slots, living hinge, rounded squares… |
| `js/geom/` | Clipper booleans, text (opentype.js + system fonts via fontconfig), SVG import, MaxRects sheet layout, 3D interference check, SVG export |
| `js/view/` | three.js assembly view, canvas 2D part/sheet view |
| `serve.py` | stdlib-only Python server: app, project files, fonts (`fc-match`) |

- A **part** is the union of its children, extruded from z = 0 to its thickness;
  3D transforms on a part place it in the assembly, 2D transforms inside it shape it.
- **Fit check**: every pair of parts (and parts against `%cube`/`%cylinder`
  reference objects) is sampled for overlap; touching faces don't count.
- **Export**: one SVG per sheet into `<project>/export/`. Red stroke = cut,
  blue stroke = score, black fill = engrave, embedded bitmaps = image engrave.
  Kerf compensation (half the material's `kerf`) grows outlines and shrinks
  holes; holes are written before outlines.

## Tests

```
npm install          # dev deps for tests only (clipper-lib, opentype.js, puppeteer-core)
npm test             # language, geometry, joints, layout, export
python3 serve.py projects &   node test/smoke.mjs box.kerf /tmp   # headless UI screenshots
node test/tutorial.mjs /tmp                                       # click through every lesson
```
