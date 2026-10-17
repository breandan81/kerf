export const HELP = `
<h2>Kerf language reference</h2>
<p>OpenSCAD syntax, flat parts. Draw 2D shapes, wrap them in <code>part()</code> to make a piece of
material, place parts in 3D with the usual transforms, and Kerf lays them out on sheets for the laser.
Units are mm. <b>F5</b> render · <b>Ctrl+S</b> save · <b>Ctrl+/</b> comment · <b>F1</b> this page.</p>

<h3>Materials and parts</h3>
<table>
<tr><td>material("ply3", thickness=3, color="wood", kerf=0.12, sheet=[400,300], margin=5, gap=3)</td><td>Declare a sheet material. <code>kerf</code> is the beam width used for kerf compensation on export; <code>gap</code> is the spacing between parts on the sheet.</td></tr>
<tr><td>thickness("ply3")</td><td>A material's thickness, e.g. <code>t = thickness("ply3");</code></td></tr>
<tr><td>part("name", "ply3", qty=1, color=, center=false) { … }</td><td>One physical piece: the union of its children is cut out. It occupies z = 0…thickness in its own frame (<code>center=true</code>: centred on z = 0). <code>qty</code> cuts extra copies.</td></tr>
<tr><td>part("name", thickness=6) { … }</td><td>Shortcut: ad-hoc material named "6mm".</td></tr>
</table>

<h3>Laser operations</h3>
<table>
<tr><td>engrave() { … }</td><td>Fill-engrave the children's areas (text, logos). Clipped to the part.</td></tr>
<tr><td>score() { … }</td><td>Line-engrave the outlines of the children (no cut).</td></tr>
<tr><td>cut() { … }</td><td>Cut the outlines as lines without them becoming holes.</td></tr>
<tr><td>line([[x,y], …], closed=false)</td><td>Open polyline, cut by default (wrap in score() to score it).</td></tr>
<tr><td>image("photo.png", width=50, dpi=300, center=false)</td><td>Bitmap engraving (path relative to the .kerf file).</td></tr>
</table>

<h3>2D shapes</h3>
<table>
<tr><td>square([w,h], center=false)</td><td></td></tr>
<tr><td>circle(r) · circle(d=)</td><td>Smoothness: <code>$fn</code> (segments), or <code>$fa</code>/<code>$fs</code> (defaults 1°, 0.1 mm, fine for lasers).</td></tr>
<tr><td>polygon(points, paths)</td><td></td></tr>
<tr><td>text("Hi", size=10, font="Liberation Sans:style=Bold", halign, valign, spacing)</td><td>Any installed font, named like OpenSCAD/fontconfig. <code>halign</code> left|center|right, <code>valign</code> baseline|bottom|center|top.</td></tr>
<tr><td>import("logo.svg", center=false)</td><td>Closed paths become shapes, open paths become cut lines.</td></tr>
</table>

<h3>Booleans and modifiers</h3>
<table>
<tr><td>union() difference() intersection()</td><td>On the cut outline. Engraving/score inside a difference is kept, not subtracted.</td></tr>
<tr><td>hull() minkowski() offset(r=) offset(delta=, chamfer=)</td><td></td></tr>
<tr><td>translate rotate scale mirror multmatrix resize color</td><td>On flat shapes they act in 2D; on parts they place them in 3D (<code>rotate([90,0,0])</code> stands a part up).</td></tr>
<tr><td># % * !</td><td>highlight · ghost (preview only, never cut) · disable · show only this</td></tr>
</table>

<h3>Test fitting</h3>
<table>
<tr><td>%cube([x,y,z]) %cylinder(h, r) %sphere(r)</td><td>Reference objects (the thing going in the box). Preview only.</td></tr>
<tr><td>3D fit tab</td><td>Shows the assembly and checks every pair of parts for overlap; collisions are listed and drawn as red points. Use <i>explode</i> to pull parts apart.</td></tr>
</table>

<h3>Standard library</h3>
<table>
<tr><td>rounded_square(size, r, center)</td><td></td></tr>
<tr><td>ngon(n, r) · slot(len, w)</td><td>Regular polygon · stadium slot centred on the origin.</td></tr>
<tr><td>finger_count(len, w=10)</td><td>Odd finger count for an edge.</td></tr>
<tr><td>finger_tabs(len, t, n, odd=true)</td><td>Tabs along x (0…len), t deep. Mating edges use the same n with opposite <code>odd</code>.</td></tr>
<tr><td>finger_slots(len, t, n, odd)</td><td>Slots centred on y=0 for tabs crossing a panel.</td></tr>
<tr><td>tslot(d=3, len=12, nut_w=5.5, nut_t=2.4) · tslot_hole(d)</td><td>Captive-nut T-slot cut into an edge on y=0.</td></tr>
<tr><td>living_hinge(w, h, pitch=1.5, seg=18, bridge=3)</td><td>Bendable lattice cut lines.</td></tr>
<tr><td>hole_grid(cols, rows, pitch, d)</td><td></td></tr>
<tr><td>face_y(t) · face_x(t)</td><td>Stand a part up: facing -y (thickness y=0…t) or facing +x (thickness x=0…t).</td></tr>
</table>

<h3>Language</h3>
<pre>w = 40;                                   // variables (last assignment wins)
function area(a, b) = a * b;
module plate(w, h = 20) { square([w, h]); }
for (i = [0 : 3]) translate([i * 10, 0]) circle(2);
if (w > 30) square(w); else circle(w);
pts = [for (a = [0 : 30 : 330]) [cos(a), sin(a)] * 10];
include &lt;common.kerf&gt;   use &lt;lib.kerf&gt;
echo("w is", w);</pre>

<h3>Export</h3>
<p>One SVG per sheet goes into the project's <code>export/</code> folder (mm units).
Red stroke = cut, blue stroke = score, black fill = engrave, embedded bitmaps = image engrave, each in its own group.
In xTool Creative Space, import the SVG and give each colour its own power, speed and passes. Holes are written before outlines.
Untick <b>kerf comp</b> to export the exact drawn geometry (e.g. when measuring your kerf; see tutorial lesson 9).</p>
`;
