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

<h3>Libraries</h3>
<p><code>use &lt;file.kerf&gt;</code> imports a file's modules and functions; <code>include &lt;file.kerf&gt;</code> pastes the
whole file in (its parts and variables too). Paths are relative to your file; if it isn't in your project, Kerf
looks in its built-in libraries:</p>
<table>
<tr><td colspan=2><b>use &lt;boxes.kerf&gt;</b></td></tr>
<tr><td>finger_box([x,y,z], "ply3", top="open", inside=false, fw=12, label="")</td><td>A whole finger-jointed box, every part placed in 3D. <code>top</code>: "open", "closed" or "lid" (lift-off lid with a lip). <code>inside=true</code>: size is the inside.</td></tr>
<tr><td>box_panel(which, size, t, top) · box_place(which, size, t)</td><td>Build the box yourself to add holes/engraving: <code>box_place("front", size, t) part("front", "ply3") difference() { box_panel("front", size, t); … }</code>. which = bottom, top, front, back, left, right.</td></tr>
<tr><td>fj_panel(w, h, t, edges=[b,r,t,l], fw=12)</td><td>Any finger-jointed panel. Each edge: 0 plain, 1 fingers between, 2 fingers owning the corners; mating edges use 1 and 2.</td></tr>
<tr><td colspan=2><b>use &lt;hinges.kerf&gt;</b></td></tr>
<tr><td>hinged_box([x,y,z], "ply3", lid_h=20, pin_d=3.2, gap=0.5, open=0, label="")</td><td>Box with a lid on two pins through ears at the back. <code>open</code> swings the lid in the 3D view to test-fit.</td></tr>
<tr><td>bend_length(angle, r, t)</td><td>How long a <code>living_hinge</code> must be to bend that far around inside radius r.</td></tr>
<tr><td>pivot_ear(at, r, d, a, b)</td><td>Round ear with a pin hole at <code>at</code>, joined to the panel edge a→b.</td></tr>
<tr><td colspan=2><b>use &lt;gears.kerf&gt;</b></td></tr>
<tr><td>gear(teeth, mod=2, pressure_angle=20, backlash=0.1, bore=0, flat=0)</td><td>Involute spur gear centred on the origin, a tooth on +x. <code>mod</code> = pitch diameter / teeth; meshing gears share it.</td></tr>
<tr><td>gear_distance(t1, t2, mod)</td><td>Centre distance for two gears to mesh (add 0.1–0.2 mm for laser-cut gears).</td></tr>
<tr><td>gear_mesh(t1, t2, mod, a1=0, dir=0, extra=0) { gear(t2) }</td><td>Places gear 2 meshing with a t1-tooth gear at the origin (turned a1°), in direction <code>dir</code>, rotated so the teeth interleave.</td></tr>
<tr><td>gear_pitch_r · gear_outer_r · gear_root_r(teeth, mod) · gear_ratio(t1, t2) · gear_mesh_angle(t1, t2, a1, dir)</td><td></td></tr>
<tr><td>rack(teeth, mod, base=5) · on_rack(teeth, mod, k) { gear(teeth) }</td><td>Straight rack along +x; on_rack puts a gear on it over the k-th gap.</td></tr>
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

<h3>Files</h3>
<p>On the website, <b>Open…</b> (Ctrl+O) loads a <code>.kerf</code> file from your computer. Select its images,
SVGs and fonts in the same dialog, or drag them onto the page. <b>Save</b> (Ctrl+S) writes it back: in Chrome/Edge
straight to the same file, in Firefox as a download (set Firefox → Settings → Downloads → <i>Always ask you where
to save files</i> to get a save dialog). Unsaved work is kept as a draft if the tab closes.
Chrome/Edge can also <b>Open folder…</b> to work in a folder directly.</p>

<h3>Export</h3>
<p>One SVG per sheet (mm units): downloaded on the website, or written to the project's <code>export/</code> folder (local app / opened folder).
Red stroke = cut, blue stroke = score, black fill = engrave, embedded bitmaps = image engrave, each in its own group.
In xTool Creative Space, import the SVG and give each colour its own power, speed and passes. Holes are written before outlines.
Untick <b>kerf comp</b> to export the exact drawn geometry (e.g. when measuring your kerf; see tutorial lesson 9).</p>
`;
