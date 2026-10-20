# Kerf language reference

Every built-in and library module and function, with its arguments and defaults. Generated from the source by
`tools/gen_reference.mjs` (`npm run docs`); the same reference is in the app (**?** → *Full reference*).

## Language

- **Units**: Lengths are in millimetres and angles in degrees. x runs right and y up on the sheet; z is up in 3D.
- **Values**: Numbers, strings (`"ply3"`), `true`/`false`, `undef`, lists `[1, 2, 3]` and ranges `[start : end]` or `[start : step : end]`. Lists index from 0 (`p[0]`) and `.x .y .z` read items 0–2.
- **Variables**: `w = 40;` Like OpenSCAD, the last assignment in a scope wins, everywhere in that scope.
- **Operators**: `+ - * / % ^`, comparisons `== != < <= > >=`, `&& || !` and `cond ? a : b`. `+ - *` work on lists (vector maths; `*` of two lists is a dot or matrix product).
- **Functions**: `function area(a, b = 2) = a * b;` Function literals work too: `f = function(x) x * 2;`
- **Modules**: `module plate(w, h = 20) { square([w, h]); }`, called as `plate(30);` or `plate(w = 30, h = 10);`. `children()` inside a module is whatever it was called with.
- **Control**: `for (i = [0 : 3]) …`, `for (x = [..], y = [..])` (nested), `if (c) … else …`, `let (a = 1) …`, and list comprehensions `[for (a = [0 : 30 : 330]) [cos(a), sin(a)] * 10]` with `if` and `each`.
- **Files**: `include <file.kerf>` pastes a file in; `use <file.kerf>` imports only its modules and functions. Paths are relative to the current file, then the built-in libraries.
- **Modifiers**: Before any module call: `%` ghost (shown, not cut; reference solids count in the fit check), `#` highlight, `!` show only this, `*` disable.
- **Special variables**: `$fn`, `$fa`, `$fs` control circle smoothness (see 2D shapes). `PI` is π.

## Built-in modules and functions

Always available, no `use` needed.

### Materials and parts

Everything that gets cut belongs to a part. A part is one flat piece of one material, drawn in 2D and placed in 3D by the transforms around it.

#### `material(name = "default", thickness = 3, color = "wood", opacity = 1, kerf = 0.1, sheet = [600, 400], margin = 5, gap = 3)`

*module*  
Defines (or changes) a material. Later calls with the same name update only the settings they give. Without any material() call, parts use a 3 mm default.

| argument | default | |
|---|---|---|
| `name` | `"default"` | name you refer to it by, e.g. `"ply3"` |
| `thickness` | `3` | sheet thickness in mm |
| `color` | `"wood"` | colour in the 3D view: a name (`"wood"`, `"clear"`, `"red"`…), `"#rrggbb"` or `[r, g, b]` 0–1 |
| `opacity` | `1` | opacity in the 3D view (0–1), e.g. 0.4 for acrylic |
| `kerf` | `0.1` | width of the laser cut in mm; outlines are offset by half of it on export (see tutorial lesson 9) |
| `sheet` | `[600, 400]` | sheet size [w, h] in mm, for sheet layout |
| `margin` | `5` | empty border around each sheet in mm |
| `gap` | `3` | space between parts on a sheet in mm |

```openscad
material("ply3", thickness = 3, color = "wood", kerf = 0.12, sheet = [300, 300]);
```

#### `part(name = "part", material = undef, qty = 1, thickness = undef, center = false, color = undef)`

*module*  
Makes its 2D children into one cut part. Transforms outside the part place it in 3D; the part lies on z = 0 to thickness before that. Holes are anything subtracted with difference().

| argument | default | |
|---|---|---|
| `name` | `"part"` | name in the parts list and on the sheets |
| `material` | `undef` | material name; default: the first material defined |
| `qty` | `1` | how many to cut (shown once in 3D, laid out qty times) |
| `thickness` | `undef` | instead of material: a plain material of this thickness |
| `center` | `false` | true centres the thickness on z = 0 |
| `color` | `undef` | colour in the 3D view, overriding the material's |

```openscad
translate([0, 0, 20]) part("lid", "ply3", qty = 2) difference() {
  square([80, 60]);
  translate([40, 30]) circle(d = 10);
}
```

#### `thickness(material)`

*function*  
A material's thickness in mm.

| argument | default | |
|---|---|---|
| `material` | *required* | material name |

```openscad
t = thickness("ply3");
```

#### `kerf(material)`

*function*  
A material's kerf (laser cut width) in mm.

| argument | default | |
|---|---|---|
| `material` | *required* | material name |


#### `sheet_size(material)`

*function*  
The usable area of one sheet: `[w, h]` minus the margins.

| argument | default | |
|---|---|---|
| `material` | *required* | material name |


### Laser operations

Inside a part, plain shapes are cut. These wrap shapes to engrave or score them instead.

#### `engrave()`

*module*  
Fill-engraves the children's areas (exported as black fill). Lines inside become scores.

```openscad
part("tag", "ply3") {
  square([40, 15]);
  engrave() translate([20, 7.5]) text("HELLO", size = 8, halign = "center", valign = "center");
}
```

#### `score()`

*module*  
Line-engraves the outlines of the children without cutting (exported as blue lines).


#### `cut()`

*module*  
Cuts the children's outlines as lines without making them holes, e.g. a cut line through a living hinge.


#### `line(points, closed = false)`

*module*  
An open line (not an area). Cut inside a part, or scored inside engrave()/score().

| argument | default | |
|---|---|---|
| `points` | *required* | list of [x, y] points |
| `closed` | `false` | true joins the last point back to the first |

```openscad
part("card", "ply3") {
  square([40, 20]);
  score() line([[5, 10], [20, 15], [35, 10]]);   // a scored fold line
}
```

#### `image(file, width = undef, height = undef, dpi = 300, center = false)`

*module*  
A bitmap to engrave (embedded in the exported SVG). Give width or height and the other follows the image's shape.

| argument | default | |
|---|---|---|
| `file` | *required* | path relative to the .kerf file |
| `width` | `undef` | width in mm |
| `height` | `undef` | height in mm |
| `dpi` | `300` | size from the image's pixels when neither width nor height is given |
| `center` | `false` | centre on the origin |

```openscad
engrave() image("photo.png", width = 50);
```

### 2D shapes

All sizes in mm. Curves are made of short straight segments; `$fn` sets the number of segments, or `$fa` (max degrees per segment, default 1) and `$fs` (max segment length, default 0.1 mm).

#### `square(size = 1, center = false)`

*module*  
A rectangle with its corner at the origin.

| argument | default | |
|---|---|---|
| `size` | `1` | a number (square) or [w, h] |
| `center` | `false` | centre on the origin |


#### `circle(r = 1, d = undef)`

*module*  
A circle centred on the origin.

| argument | default | |
|---|---|---|
| `r` | `1` | radius |
| `d` | `undef` | diameter, instead of r |

```openscad
circle(d = 3.2);
```

#### `polygon(points, paths = undef)`

*module*  
A polygon from points. With paths, the first path is the outline and the rest are holes.

| argument | default | |
|---|---|---|
| `points` | *required* | list of [x, y] points |
| `paths` | `undef` | lists of point indexes, one per outline |


#### `text(text, size = 10, font = "Liberation Sans", halign = "left", valign = "baseline", spacing = 1)`

*module*  
Text as outlines. Bundled fonts and `.ttf`/`.otf` files in the project both work.

| argument | default | |
|---|---|---|
| `text` | *required* | the text |
| `size` | `10` | roughly the height of capital letters in mm |
| `font` | `"Liberation Sans"` | font name, optionally with a style: `"Liberation Sans:style=Bold"`, or a font file |
| `halign` | `"left"` | `"left"`, `"center"` or `"right"` |
| `valign` | `"baseline"` | `"baseline"`, `"top"`, `"center"` or `"bottom"` |
| `spacing` | `1` | letter spacing factor |


#### `import(file, center = false)`

*module*  
Shapes from an SVG file. Closed paths fill even-odd (like most drawing programs); open paths become lines.

| argument | default | |
|---|---|---|
| `file` | *required* | path to a `.svg` relative to the .kerf file |
| `center` | `false` | centre on the origin |


#### `round_corners(points, r = 0)`

*function*  
A closed path (list of points) with its corners rounded. A radius too big for its edges is reduced, with a warning.

| argument | default | |
|---|---|---|
| `points` | *required* | corner points of a closed outline |
| `r` | `0` | one radius for every corner, or a list with one per point (0 = sharp) |

```openscad
polygon(round_corners([[0, 0], [60, 0], [60, 40], [0, 40]], [0, 10, 10, 0]));
```

### Transforms

Each applies to its children. Angles are in degrees.

#### `translate(v = [0, 0, 0])`

*module*  
Moves the children.

| argument | default | |
|---|---|---|
| `v` | `[0, 0, 0]` | [x, y] or [x, y, z] |


#### `rotate(a = 0, v = undef)`

*module*  
Rotates the children. A single number rotates about z.

| argument | default | |
|---|---|---|
| `a` | `0` | angle, or [x, y, z] angles applied in that order |
| `v` | `undef` | axis to rotate a degrees around |


#### `scale(v = 1)`

*module*  
Scales the children.

| argument | default | |
|---|---|---|
| `v` | `1` | factor, or [x, y] / [x, y, z] factors |


#### `mirror(v = [1, 0, 0])`

*module*  
Mirrors the children across the plane through the origin with normal v.

| argument | default | |
|---|---|---|
| `v` | `[1, 0, 0]` | normal of the mirror; [1, 0] flips left–right |


#### `multmatrix(m)`

*module*  
Applies a 4 × 4 (or 3 × 4) transformation matrix.

| argument | default | |
|---|---|---|
| `m` | *required* | the matrix, as a list of rows |


#### `resize(newsize = [0, 0], auto = false)`

*module*  
Scales 2D children to an exact size.

| argument | default | |
|---|---|---|
| `newsize` | `[0, 0]` | [w, h]; 0 leaves that direction alone |
| `auto` | `false` | true scales a 0 direction to keep proportions |


#### `offset(r = undef, delta = undef, chamfer = false)`

*module*  
Grows (positive) or shrinks (negative) 2D shapes.

| argument | default | |
|---|---|---|
| `r` | `undef` | round offset: corners become arcs |
| `delta` | `undef` | sharp offset: corners stay sharp |
| `chamfer` | `false` | with delta: cut the corners off |

```openscad
offset(r = 2) square([20, 10]);
```

#### `color(c, alpha = 1)`

*module*  
Colour of the children in the 3D view (parts and reference solids). Doesn't affect the export.

| argument | default | |
|---|---|---|
| `c` | *required* | a name, `"#rrggbb"` or [r, g, b] 0–1 |
| `alpha` | `1` | opacity |


### Combining shapes

#### `union()`

*module*  
Merges the children into one shape. Shapes inside a part are merged anyway.


#### `difference()`

*module*  
The first child minus all the others: how holes are made.


#### `intersection()`

*module*  
Only the area all the children share.


#### `hull()`

*module*  
The convex hull of the children: like a rubber band around them.

```openscad
hull() { circle(5); translate([30, 0]) circle(8); }
```

#### `minkowski()`

*module*  
Minkowski sum of the children: traces the second shape around the first (rounds a square with a circle).


#### `group()`

*module*  
Groups children without changing them.


#### `render()`

*module*  
Accepted for OpenSCAD compatibility; does nothing.


#### `children(index = undef)`

*module*  
Inside a module: the children it was called with.

| argument | default | |
|---|---|---|
| `index` | `undef` | only this child (from 0) |


### Reference solids (preview only)

3D shapes for test-fitting real objects. They show in the 3D view, count in the fit check and are never cut. Use them with `%` so they show as ghosts, e.g. `%cylinder(h = 60, d = 30);`.

#### `cube(size = 1, center = false)`

*module*  
A box with its corner at the origin.

| argument | default | |
|---|---|---|
| `size` | `1` | a number or [x, y, z] |
| `center` | `false` | centre on the origin |


#### `cylinder(h = 1, r = 1, d = undef, r1 = r, r2 = r1, d1 = undef, d2 = undef, center = false)`

*module*  
A cylinder (or cone) standing on z = 0.

| argument | default | |
|---|---|---|
| `h` | `1` | height |
| `r` | `1` | radius |
| `d` | `undef` | diameter, instead of r |
| `r1` | `r` | bottom radius |
| `r2` | `r1` | top radius |
| `d1` | `undef` | bottom diameter |
| `d2` | `undef` | top diameter |
| `center` | `false` | centre the height on z = 0 |


#### `sphere(r = 1, d = undef)`

*module*  
A sphere centred on the origin.

| argument | default | |
|---|---|---|
| `r` | `1` | radius |
| `d` | `undef` | diameter, instead of r |


### Curved walls (flex)

The building blocks behind `flex_box` in `flex.kerf`. path is the outside of the walls seen from above, as a closed list of points; rounded stretches bend with a living hinge and sharp 90° corners split the wall into panels with finger-jointed corners. Everything is measured along the middle of the sheet. **Every piece of one box must get the same path, t, fw, sag, margin and max_len**, or the notches won't line up (the fit check shows it). Unlike `flex_box`, these don't read the sheet size: give `max_len = max(sheet_size("ply3"))` to split long walls.

#### `flex_plate(path, t, lip = 0, fw = 12, sag = 0.1, margin = 3, max_len = undef)`

*module*  
Bottom or top plate: the outline with notches for the wall's fingers (lip = 0, flush) or slots they poke through (lip > 0).

| argument | default | |
|---|---|---|
| `path` | *required* | wall outline |
| `t` | *required* | sheet thickness, or a material name |
| `lip` | `0` | how far the plate overhangs the walls, in mm (0 = flush notches) |
| `fw` | `12` | target finger width on straight stretches |
| `sag` | `0.1` | how far a straight finger may stand off a curve (mm): sets finger width on curves, √(8·r·sag) |
| `margin` | `3` | how far the hinge cuts run past each bend |
| `max_len` | `undef` | longest flat panel; longer walls split at butt seams |


#### `flex_panel(path, height, t, panel = 0, top = true, fw = 12, sag = 0.1, margin = 3, max_len = undef, pitch = 1.5, seg = 18, bridge = 3)`

*module*  
One flat wall panel: fingers along the bottom (and top) edges, hinge cuts where it bends, finger corners at sharp corners.

| argument | default | |
|---|---|---|
| `path` | *required* | wall outline |
| `height` | *required* | outside height, plates included |
| `t` | *required* | sheet thickness, or a material name |
| `panel` | `0` | which panel (from 0; see flex_count) |
| `top` | `true` | false: no fingers on the top edge (open box) |
| `fw` | `12` | as flex_plate |
| `sag` | `0.1` | as flex_plate |
| `margin` | `3` | as flex_plate |
| `max_len` | `undef` | as flex_plate |
| `pitch` | `1.5` | spacing between hinge cut lines |
| `seg` | `18` | length of each hinge cut |
| `bridge` | `3` | uncut gap between hinge cuts |


#### `flex_bend(path, t, panel = 0, fw = 12, sag = 0.1, margin = 3, max_len = undef)`

*module*  
Shows a flat panel part bent into place in 3D, and fit-checks it bent. It is still laid out and cut flat. Wrap it around the part.

| argument | default | |
|---|---|---|
| `path` | *required* | wall outline |
| `t` | *required* | sheet thickness, or a material name |
| `panel` | `0` | which panel |
| `fw` | `12` | as flex_plate |
| `sag` | `0.1` | as flex_plate |
| `margin` | `3` | as flex_plate |
| `max_len` | `undef` | as flex_plate |

```openscad
for (i = [0 : flex_count(shape, t) - 1])
  flex_bend(shape, t, i) part(str("wall", i), "ply3") flex_panel(shape, 60, t, i);
```

#### `flex_count(path, t, fw = 12, sag = 0.1, margin = 3, max_len = undef)`

*function*  
How many wall panels the outline needs.

| argument | default | |
|---|---|---|
| `path` | *required* | wall outline |
| `t` | *required* | sheet thickness |
| `fw` | `12` | as flex_plate |
| `sag` | `0.1` | as flex_plate |
| `margin` | `3` | as flex_plate |
| `max_len` | `undef` | as flex_plate |


#### `flex_lengths(path, t, fw = 12, sag = 0.1, margin = 3, max_len = undef)`

*function*  
The flat length of each wall panel, for planning sheets.

| argument | default | |
|---|---|---|
| `path` | *required* | wall outline |
| `t` | *required* | sheet thickness |
| `fw` | `12` | as flex_plate |
| `sag` | `0.1` | as flex_plate |
| `margin` | `3` | as flex_plate |
| `max_len` | `undef` | as flex_plate |


### Messages

#### `echo()`

*module*  
Prints values to the console: `echo(w = w)` prints `w = 40`.


#### `assert(condition, message = undef)`

*module*  
Stops with an error if the condition is false.

| argument | default | |
|---|---|---|
| `condition` | *required* |  |
| `message` | `undef` | shown with the error |

```openscad
assert(w > 2 * t, "too narrow");
```

### Math and lists

Trigonometry works in degrees. `PI` is π.

#### `abs(x)`

*function*  
Absolute value.


#### `sign(x)`

*function*  
-1, 0 or 1.


#### `floor(x)`

*function*  
Round down.


#### `ceil(x)`

*function*  
Round up.


#### `round(x)`

*function*  
Round to the nearest whole number (halves away from 0).


#### `sqrt(x)`

*function*  
Square root.


#### `exp(x)`

*function*  
e to the power x.


#### `ln(x)`

*function*  
Natural logarithm.


#### `log(x)`

*function*  
Base-10 logarithm.


#### `pow(base, exponent)`

*function*  
base to the power exponent (also `base ^ exponent`).


#### `sin(a)`

*function*  
Sine of an angle in degrees. Also cos, tan.

| argument | default | |
|---|---|---|
| `a` | *required* | degrees |


#### `cos(a)`

*function*  
Cosine of an angle in degrees.

| argument | default | |
|---|---|---|
| `a` | *required* | degrees |


#### `tan(a)`

*function*  
Tangent of an angle in degrees.

| argument | default | |
|---|---|---|
| `a` | *required* | degrees |


#### `asin(x)`

*function*  
Inverse sine, in degrees. Also acos, atan.


#### `acos(x)`

*function*  
Inverse cosine, in degrees.


#### `atan(x)`

*function*  
Inverse tangent, in degrees.


#### `atan2(y, x)`

*function*  
Angle of the point [x, y] in degrees (note the order: y first).


#### `min(values…)`

*function*  
Smallest of the arguments, or of one list.

| argument | default | |
|---|---|---|
| `values…` | *required* | numbers, or one list |


#### `max(values…)`

*function*  
Largest of the arguments, or of one list.

| argument | default | |
|---|---|---|
| `values…` | *required* | numbers, or one list |


#### `norm(v)`

*function*  
Length of a vector.


#### `cross(a, b)`

*function*  
Cross product (a number for 2D vectors).


#### `len(v)`

*function*  
Number of items in a list, or characters in a string.


#### `concat(lists…)`

*function*  
Joins lists into one list.


#### `lookup(key, table)`

*function*  
Interpolates in a table of [key, value] rows sorted by key.

```openscad
echo(lookup(2.5, [[0, 0], [10, 100]]));   // 25
```

#### `rands(lo, hi, n, seed = undef)`

*function*  
A list of n random numbers between lo and hi. With a seed, the same every time.

| argument | default | |
|---|---|---|
| `lo` | *required* |  |
| `hi` | *required* |  |
| `n` | *required* |  |
| `seed` | `undef` |  |


#### `str(values…)`

*function*  
Joins values into a string.

```openscad
part(str("wall", i), "ply3") …
```

#### `chr(codes…)`

*function*  
Characters from character codes.


#### `ord(s)`

*function*  
Character code of the first character.


#### `is_undef(v)`

*function*  
True if the value is undef. Also is_num, is_bool, is_string, is_list, is_function.


#### `is_num(v)`

*function*  
True if the value is a number.


#### `is_bool(v)`

*function*  
True if the value is a boolean.


#### `is_string(v)`

*function*  
True if the value is a string.


#### `is_list(v)`

*function*  
True if the value is a list.


#### `is_function(v)`

*function*  
True if the value is a function.


#### `version()`

*function*  
Kerf's version as [year, month, n].


## Libraries

Written in Kerf (in `lib/`). `use <name.kerf>` imports a library's modules and functions; a file with the same name in your project takes precedence.

### Standard library

Kerf standard library — loaded automatically before every file. Everything here is plain Kerf; copy and tweak freely.

**shapes**

#### `rounded_square(size, r = 2, center = false)`

*module*  
A rectangle with rounded corners.

| argument | default | |
|---|---|---|
| `size` | *required* | a number (square) or [w, h] |
| `r` | `2` | corner radius (reduced if it's too big for the size) |
| `center` | `false` | true centres it on the origin; false puts its corner there |


#### `ngon(n, r)`

*module*  
A regular polygon centred on the origin, with a corner on +x.

| argument | default | |
|---|---|---|
| `n` | *required* | number of sides |
| `r` | *required* | circumradius (centre to corner) |


#### `slot(len, w)`

*module*  
A slot with round ends, centred on the origin, running along x.

| argument | default | |
|---|---|---|
| `len` | *required* | overall length, round ends included |
| `w` | *required* | width (the ends' diameter) |


**joints**

#### `finger_count(len, w = 10)`

*function*  
Odd number of fingers that fit `len` with fingers about `w` wide.

| argument | default | |
|---|---|---|
| `len` | *required* | edge length |
| `w` | `10` | target finger width |


#### `finger_tabs(len, t, n = undef, odd = true, w = 10)`

*module*  
Tabs along the x axis from 0..len, t deep (y = 0..t). The edge is split into n segments and every other one is kept. Two mating edges use the same len and n and opposite `odd`.

| argument | default | |
|---|---|---|
| `len` | *required* | edge length |
| `t` | *required* | tab depth (the thickness of the mating sheet) |
| `n` | `undef` | number of segments; default finger_count(len, w) |
| `odd` | `true` | true keeps segments 1, 3, 5…; false keeps 0, 2, 4… |
| `w` | `10` | target finger width, when n isn't given |


#### `finger_slots(len, t, n = undef, odd = true, w = 10)`

*module*  
Slots through a panel for tabs of another panel crossing it (a "tab and slot" joint away from the edge). Slots run along x from 0..len, t wide, centred on y = 0. Use odd/n matching the tabs.

| argument | default | |
|---|---|---|
| `len` | *required* | as finger_tabs |
| `t` | *required* | slot width (the thickness of the sheet with the tabs) |
| `n` | `undef` | as finger_tabs |
| `odd` | `true` | as finger_tabs |
| `w` | `10` | as finger_tabs |


#### `tslot(d = 3, len = 12, nut_w = 5.5, nut_t = 2.4, nut_at = 6)`

*module*  
T-slot for a captive nut + bolt, cut into an edge. The edge lies on y = 0 and the slot goes inward along +y. Subtract it from the panel.

| argument | default | |
|---|---|---|
| `d` | `3` | bolt diameter (the slot's width) |
| `len` | `12` | how far the slot goes into the panel (the bolt's length past the other panel) |
| `nut_w` | `5.5` | nut width across the flats |
| `nut_t` | `2.4` | nut thickness |
| `nut_at` | `6` | distance from the edge to the nut |


#### `tslot_hole(d = 3)`

*module*  
Matching bolt hole for a T-slot in the panel it screws through.

| argument | default | |
|---|---|---|
| `d` | `3` | bolt diameter |


**laser tricks**

#### `living_hinge(w, h, pitch = 1.5, seg = 18, bridge = 3)`

*module*  
Straight-line living hinge: cut lines parallel to y across a w × h area so the sheet bends around an axis parallel to y. The flex.kerf boxes lay these out for you.

| argument | default | |
|---|---|---|
| `w` | *required* | size of the bendable area (bending happens across w) |
| `h` | *required* | size of the bendable area (bending happens across w) |
| `pitch` | `1.5` | spacing between cut lines; smaller bends more easily |
| `seg` | `18` | length of each cut |
| `bridge` | `3` | material left between cuts; smaller bends more easily |


#### `hole_grid(cols, rows, pitch, d)`

*module*  
A grid of round holes (subtract it), handy for vents and speaker grilles. The first hole is centred on the origin.

| argument | default | |
|---|---|---|
| `cols` | *required* | number of holes along x and y |
| `rows` | *required* | number of holes along x and y |
| `pitch` | *required* | centre-to-centre spacing |
| `d` | *required* | hole diameter |


**3D placement**

#### `face_y(t)`

*module*  
Stands a flat part up so its local +y becomes world +z, facing -y. Local x stays world x; its thickness occupies y = 0..t.

| argument | default | |
|---|---|---|
| `t` | *required* | the part's thickness |


#### `face_x(t)`

*module*  
Stands a flat part up so its local +y becomes world +z, facing +x. Local x runs along world +y; its thickness occupies x = 0..t.

| argument | default | |
|---|---|---|
| `t` | *required* | the part's thickness |


### Boxes — `use <boxes.kerf>`

Parametric finger-jointed boxes.

```openscad
finger_box([120, 80, 60], "ply3");                  // open box, all parts placed in 3D
finger_box([120, 80, 60], "ply3", top = "lid");     // with a lift-off lid
finger_box([100, 60, 40], "ply3", inside = true);   // size is the inside
```

Sizes are outside dimensions [x, y, z] unless inside = true. The box sits with its outside corner at the origin. Engraving on the walls faces out.

To cut holes or engrave a panel, build the parts yourself from the pieces:

```openscad
size = [120, 80, 60]; t = thickness("ply3");
for (w = ["bottom", "back", "left", "right"]) box_place(w, size, t) part(w, "ply3") box_panel(w, size, t);
box_place("front", size, t) part("front", "ply3") difference() {
  box_panel("front", size, t);
  translate([60, 30]) circle(d = 20);
}
```

Arguments used throughout:

- `size`: the box's outside size [x, y, z]
- `t`: sheet thickness (also the finger depth)
- `fw`: target finger width
- `top`: "open", "closed", or "lid" (a lift-off lid: a plate plus a lip that drops inside the walls; glue the two together)
- `which`: which panel: "bottom", "top", "front", "back", "left" or "right"

#### `fj_panel(w, h, t, edges = [1, 2, 0, 2], fw = 12)`

*module*  
One flat panel w × h with finger-jointed edges. Two mating edges: one 1, the other 2.

| argument | default | |
|---|---|---|
| `w` | *required* | panel size |
| `h` | *required* | panel size |
| `t` | *required* | sheet thickness (also the finger depth) |
| `edges` | `[1, 2, 0, 2]` | [bottom, right, top, left], each 0 plain, 1 fingers that fit between the other panel's, 2 fingers that own the corners |
| `fw` | `12` | target finger width |


#### `box_panel(which, size, t, top = "open", fw = 12)`

*module*  
The 2D outline of one panel of a standard box (top = "lid" gives the walls of an open box). Front/back own the vertical corners; bottom/top own their corners.

| argument | default | |
|---|---|---|
| `which` | *required* | which panel: "bottom", "top", "front", "back", "left" or "right" |
| `size` | *required* | the box's outside size [x, y, z] |
| `t` | *required* | sheet thickness (also the finger depth) |
| `top` | `"open"` | "open", "closed", or "lid" (a lift-off lid: a plate plus a lip that drops inside the walls; glue the two together) |
| `fw` | `12` | target finger width |


#### `box_place(which, size, t)`

*module*  
Put a part where a panel goes in a box of `size` with its outside corner at the origin. Walls face outward: the side you engrave ends up outside. Front/back panels are size.x wide; left/right run along y (local x = y for "right", reversed for "left", so text reads correctly from outside).

| argument | default | |
|---|---|---|
| `which` | *required* | which panel: "bottom", "top", "front", "back", "left" or "right" |
| `size` | *required* | the box's outside size [x, y, z] |
| `t` | *required* | sheet thickness (also the finger depth) |


#### `box_outside(size, t, top = "open")`

*function*  
Outside size of a box from its inside size.

| argument | default | |
|---|---|---|
| `size` | *required* | the inside size [x, y, z] |
| `t` | *required* | sheet thickness (also the finger depth) |
| `top` | `"open"` | "open", "closed", or "lid" (a lift-off lid: a plate plus a lip that drops inside the walls; glue the two together) |


#### `finger_box(size, material, top = "open", inside = false, fw = 12, gap = 0.3, label = "", font = "Liberation Sans:style=Bold", label_size = 10, name = "box")`

*module*  
A whole box as parts named <name>_bottom, <name>_front, ..., placed in 3D with the outside corner at the origin.

| argument | default | |
|---|---|---|
| `size` | *required* | outside size [x, y, z] (inside size with inside = true) |
| `material` | *required* | material name |
| `top` | `"open"` | "open", "closed", or "lid" (a lift-off lid: a plate plus a lip that drops inside the walls; glue the two together) |
| `inside` | `false` | true = size is the inside |
| `fw` | `12` | target finger width |
| `gap` | `0.3` | clearance around the lid lip |
| `label` | `""` | text engraved on the front (or on the top / lid) |
| `font` | `"Liberation Sans:style=Bold"` | the label's font |
| `label_size` | `10` | the label's text size |
| `name` | `"box"` | start of every part's name |


### Hinges — `use <hinges.kerf>`

Hinges.

```openscad
hinged_box([120, 80, 50], "ply3", lid_h = 20, pin_d = 3);
```

living_hinge() (in the standard library) makes a sheet bendable; bend_length() tells you how long the flexible area needs to be.

#### `bend_length(angle, r, t)`

*function*  
Length of living hinge needed to bend a sheet of thickness t through `angle` degrees around an inside radius r.

| argument | default | |
|---|---|---|
| `angle` | *required* | bend angle in degrees |
| `r` | *required* | inside radius of the bend |
| `t` | *required* | sheet thickness |


#### `pivot_ear(at, r, d, a, b)`

*module*  
A round ear with a pin hole at `at`, joined to the straight edge from a to b (two points on the panel's outline). Union it with the panel.

| argument | default | |
|---|---|---|
| `at` | *required* | centre of the ear and its hole |
| `r` | *required* | ear radius |
| `d` | *required* | pin hole diameter |
| `a` | *required* | ends of the panel edge the ear grows from |
| `b` | *required* | ends of the panel edge the ear grows from |


#### `hinged_box(size, material, lid_h = 20, pin_d = 3.2, knuckle = undef, gap = 0.5, fw = 12, open = 0, label = "", font = "Liberation Sans:style=Bold", label_size = 12, name = "box")`

*module*  
Box with a lid that swings open on two pins (dowel, filament, M3 bolt...). The lid is a shallow upside-down box, slightly wider than the body, whose sides hang over the body's sides at the back. Both have ears behind the box with a pin hole; the pivot is `knuckle` mm behind the back and below the rim, which lets the lid open past 90° without hitting anything. Parts: <name>_bottom/_front/_back/_left/_right, <name>_lid_top/_lid_front/...

| argument | default | |
|---|---|---|
| `size` | *required* | the body's outside size [x, y, z] |
| `material` | *required* | material name |
| `lid_h` | `20` | lid height (outside) |
| `pin_d` | `3.2` | pin hole diameter (make it a touch bigger than the pin) |
| `knuckle` | `undef` | how far the pivot is behind the back and below the rim; default pin_d + 3 |
| `gap` | `0.5` | clearance between the lid's sides and the body's |
| `fw` | `12` | target finger width |
| `open` | `0` | lid angle in degrees, for test-fitting in the 3D view |
| `label` | `""` | text engraved on the lid |
| `font` | `"Liberation Sans:style=Bold"` | the label's font |
| `label_size` | `12` | the label's text size |
| `name` | `"box"` | start of every part's name |


### Gears — `use <gears.kerf>`

Involute spur gears.

Gears mesh when they share `mod` (tooth size: pitch diameter / teeth) and `pressure_angle`. Every gear has a tooth centred on +x.

```openscad
gear(20, mod = 2, bore = 5);                       // 20 teeth, 40 mm pitch circle
gear_mesh(20, 12, mod = 2) gear(12, mod = 2);      // a 12-tooth gear meshing with it
d = gear_distance(20, 12, mod = 2);                // centre distance = 32 mm
```

Below about 13 teeth real gears are undercut; these aren't, so very small pinions can bind. Laser-cut gears like a little extra centre distance (0.1–0.2 mm) on top of gear_distance() — try it on a test pair first.

Arguments used throughout:

- `teeth`: number of teeth
- `mod`: module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it
- `pressure_angle`: tooth flank angle in degrees. Meshing gears share it
- `backlash`: tooth thinning in mm, the play between meshing teeth
- `t1`: tooth counts: t1 of gear 1 (at the origin), t2 of gear 2
- `t2`: tooth counts: t1 of gear 1 (at the origin), t2 of gear 2
- `a1`: how far gear 1 is turned, in degrees
- `dir`: direction from gear 1 to gear 2, in degrees
- `extra`: added centre distance in mm

**sizes**

#### `gear_pitch_r(teeth, mod = 2)`

*function*  
where the gears roll on each other

| argument | default | |
|---|---|---|
| `teeth` | *required* | number of teeth |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |


#### `gear_outer_r(teeth, mod = 2)`

*function*  
tooth tips

| argument | default | |
|---|---|---|
| `teeth` | *required* | number of teeth |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |


#### `gear_root_r(teeth, mod = 2)`

*function*  
bottom of the gaps

| argument | default | |
|---|---|---|
| `teeth` | *required* | number of teeth |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |


#### `gear_distance(t1, t2, mod = 2)`

*function*  
centre distance for meshing

| argument | default | |
|---|---|---|
| `t1` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `t2` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |


#### `gear_ratio(t1, t2)`

*function*  
turns of gear 1 per turn of gear 2

| argument | default | |
|---|---|---|
| `t1` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `t2` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |


#### `gear_mesh_angle(t1, t2, a1 = 0, dir = 0)`

*function*  
Rotation for gear 2 so its teeth fall between gear 1's. Gear 1 sits at the origin turned by a1; gear 2 sits in direction `dir` (degrees) from it. Turning gear 1 by a1 turns gear 2 the other way by a1 * t1 / t2.

| argument | default | |
|---|---|---|
| `t1` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `t2` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `a1` | `0` | how far gear 1 is turned, in degrees |
| `dir` | `0` | direction from gear 1 to gear 2, in degrees |


#### `gear_mesh(t1, t2, mod = 2, a1 = 0, dir = 0, extra = 0)`

*module*  
Place children (gear 2, t2 teeth) meshing with a t1-tooth gear at the origin. Works for flat shapes and for parts. extra = added centre distance.

| argument | default | |
|---|---|---|
| `t1` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `t2` | *required* | tooth counts: t1 of gear 1 (at the origin), t2 of gear 2 |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |
| `a1` | `0` | how far gear 1 is turned, in degrees |
| `dir` | `0` | direction from gear 1 to gear 2, in degrees |
| `extra` | `0` | added centre distance in mm |


**shapes**

#### `gear(teeth, mod = 2, pressure_angle = 20, backlash = 0.1, bore = 0, flat = 0, steps = 8)`

*module*  
Spur gear outline, centred on the origin.

| argument | default | |
|---|---|---|
| `teeth` | *required* | number of teeth |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |
| `pressure_angle` | `20` | tooth flank angle in degrees. Meshing gears share it |
| `backlash` | `0.1` | tooth thinning in mm, the play between meshing teeth |
| `bore` | `0` | centre hole diameter (0 = none) |
| `flat` | `0` | depth of a D-flat in the bore, for a motor shaft (0 = round) |
| `steps` | `8` | points along each tooth flank (smoothness) |


#### `rack(teeth, mod = 2, pressure_angle = 20, backlash = 0.1, base = 5)`

*module*  
Straight rack along +x starting at x = 0, pitch line on y = 0, teeth up, `base` mm of solid strip under the tooth roots. Place a gear on it with on_rack().

| argument | default | |
|---|---|---|
| `teeth` | *required* | number of teeth |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |
| `pressure_angle` | `20` | tooth flank angle in degrees. Meshing gears share it |
| `backlash` | `0.1` | tooth thinning in mm, the play between meshing teeth |
| `base` | `5` | depth of solid strip under the teeth, in mm |


#### `on_rack(teeth, mod = 2, k = 1, extra = 0)`

*module*  
Place children (a gear with `teeth` teeth) meshing with a rack, its centre above the rack's k-th gap.

| argument | default | |
|---|---|---|
| `teeth` | *required* | the gear's tooth count |
| `mod` | `2` | module, the tooth size: pitch diameter ÷ teeth. Meshing gears share it |
| `k` | `1` | which gap of the rack the gear sits over (x = k × π × mod) |
| `extra` | `0` | added centre distance in mm |


### Curved boxes (flex) — `use <flex.kerf>`

Curved boxes: walls that bend with living hinges and finger-joint into flat bottom and top plates.

```openscad
flex_box(rounded_rect([120, 80], 20), 60, "ply3");            // rounded box
flex_box(rounded_rect([120, 80], 20), 60, "ply3", lip = 4);   // plates overhang, tabs through slots
flex_box(round_corners([[0, 0], [100, 0], [100, 70], [0, 70]], [0, 30, 30, 0]),
         50, "ply3");                                          // flat back, rounded front
flex_box([for (a = [0 : 5 : 355]) 40 * [cos(a), sin(a)]], 80, "ply3", top = "open"); // a pot
```

path is the OUTSIDE of the walls seen from above: a list of points, closed. Rounded stretches bend; sharp square corners split the walls into separate panels with finger joints. Everything is measured along the middle of the sheet, so the fingers on the walls land in the plates' notches after bending — no lengths to match by hand.

The built-in pieces, for your own designs (holes, engraving, other plates):

```openscad
round_corners(points, r)         path with rounded corners (r per point, 0 = sharp)
flex_plate(path, t, lip = 0)      plate outline with notches (lip = 0, flush)
                                  or slots (lip > 0: plate overhangs by lip)
flex_panel(path, height, t, panel = 0, top = true)   one flat wall panel
flex_bend(path, t, panel = 0) part(...)             show it bent in 3D
flex_count(path, t), flex_lengths(path, t)          number and flat lengths of panels
```

Plates and panels must get the same path, t, fw, sag, margin and max_len to line up.

max_len: longest flat panel you can cut. flex_box uses the material's sheet (material(..., sheet = [w, h]) less its margins) unless you give one. Longer walls are split into panels that butt together on straight stretches; the plates' fingers hold the joint in line.

```openscad
flex_box(rounded_rect([120, 80], 20), 60, "ply3", max_len = 200);
```

Hinge settings: pitch (line spacing), seg (cut length), bridge (uncut gap), margin (how far the cuts run past each bend). Bigger radius = easier bend. The full list of arguments is under flex_box.

#### `rounded_rect(size, r)`

*function*  
A rounded-rectangle path with its corner at the origin, to use as a box's outline.

| argument | default | |
|---|---|---|
| `size` | *required* | [w, d] outside size |
| `r` | *required* | corner radius: one for all corners, or [r1, r2, r3, r4] counter-clockwise from the origin (0 = sharp) |


#### `flex_box(path, height, material, top = "closed", lip = 0, fw = 12, sag = 0.1, pitch = 1.5, seg = 18, bridge = 3, margin = 3, max_len = undef, label = "", font = "Liberation Sans:style=Bold", label_size = 10, name = "flex")`

*module*  
Whole box: <name>_bottom, <name>_top (unless top = "open") and the walls <name>_wall (or _wall1, _wall2, … when sharp corners split them), placed in 3D with the bottom on z = 0. height is the outside height. Walls too long for the material's sheet are split (see max_len above).

| argument | default | |
|---|---|---|
| `path` | *required* | outside of the walls seen from above, a closed list of [x, y] points |
| `height` | *required* | outside height, plates included |
| `material` | *required* | material name |
| `top` | `"closed"` | "closed" or "open" |
| `lip` | `0` | how far the plates overhang the walls, in mm. 0 = flush (fingers in notches); more = fingers poke through slots as tabs |
| `fw` | `12` | target finger width on straight stretches |
| `sag` | `0.1` | how far a straight finger may stand off a curve, in mm: sets the finger width on curves, √(8 × radius × sag) |
| `pitch` | `1.5` | spacing between hinge cut lines; smaller bends more easily |
| `seg` | `18` | length of each hinge cut |
| `bridge` | `3` | uncut gap between hinge cuts; smaller bends more easily |
| `margin` | `3` | how far the hinge cuts run past each bend |
| `max_len` | `undef` | longest flat panel; default: the sheet's longer side less its margins |
| `label` | `""` | text engraved on the top |
| `font` | `"Liberation Sans:style=Bold"` | the label's font |
| `label_size` | `10` | the label's text size |
| `name` | `"flex"` | start of every part's name |


