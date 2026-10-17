// Tutorial lessons. Each opens tutorial/<file> in the project (copied from
// the app on first visit, so your edits are kept; "Reset" restores it).
export const LESSONS = [
  {
    file: '01-first-shapes.kerf',
    title: 'First shapes',
    html: `
<p>Kerf works like OpenSCAD: you <b>write</b> the shape instead of drawing it. The editor is on the left; the
picture updates as you type (or press <kbd>F5</kbd>).</p>
<p>Every statement ends with <code>;</code>. Units are millimetres, <b>x</b> goes right and <b>y</b> goes up,
and <code>[60, 40]</code> is a list of two numbers, here a width and a height.</p>
<p><code>translate([x, y])</code> moves whatever comes after it. A circle is centred on its position;
a square starts at its bottom-left corner unless you add <code>center = true</code>.</p>
<p>Click the <b>Parts</b> tab to see the flat drawing with its axes, and hover to read coordinates.
Scroll to zoom, drag to pan, double-click to fit.</p>`,
    tasks: [
      'Make the square 80 wide.',
      'Move the circle so it sits on top of the square.',
      'Add <code>center = true</code> to the square and see where it moves.',
    ],
  },
  {
    file: '02-booleans.kerf',
    title: 'Holes: union & difference',
    html: `
<p>Shapes combine with three operations, each wrapping its children in <code>{ }</code>:</p>
<ul>
<li><code>union()</code> merges them (also what happens by default),</li>
<li><code>difference()</code> keeps the <b>first</b> child and cuts away the rest,</li>
<li><code>intersection()</code> keeps only where they all overlap.</li>
</ul>
<p>On the laser, everything outlined in <span class="c-cut">red</span> is cut. A hole is just another outline
inside the part.</p>
<p>A <code>for</code> loop repeats something: <code>for (x = [10, 70]) translate([x, 10]) circle(d = 4);</code>
makes two holes. With two variables, <code>for (x = [10, 70], y = [10, 40])</code>, it makes every
combination.</p>`,
    tasks: [
      'Put a screw hole in all four corners with one <code>for</code> loop.',
      'Change <code>difference</code> to <code>intersection</code> to see what it does, then change it back.',
      'Make the centre hole a hexagon: <code>ngon(6, 10)</code> instead of the circle.',
    ],
  },
  {
    file: '03-variables-modules.kerf',
    title: 'Variables & modules',
    html: `
<p>Name your numbers. When every dimension hangs off a few variables at the top, resizing the whole design
means editing one line. That's the big win over drawing in Inkscape.</p>
<p>A <code>module</code> is your own reusable command. <code>plate(w, h)</code> here draws a rounded plate
with a hole in each corner. Parameters can have defaults: <code>module plate(w, h = 30)</code>.</p>
<p><code>rounded_square</code> comes from Kerf's standard library, which is written in this same language.
Press <b>?</b> (or <kbd>F1</kbd>) for the full list of commands.</p>`,
    tasks: [
      'Change <code>W</code> to 120 and watch the holes follow.',
      'Add a second, smaller plate: <code>translate([0, 60]) plate(40, 30);</code>',
      'Give the module a <code>hole</code> parameter so each plate can have its own hole size.',
    ],
  },
  {
    file: '04-parts-materials.kerf',
    title: 'Parts & materials',
    html: `
<p>So far everything has been loose geometry, which Kerf collects into one part called "untitled". Real
projects name their pieces:</p>
<ul>
<li><code>material("ply3", thickness = 3, …)</code> describes a sheet: thickness, colour in the preview,
<code>kerf</code> (the beam width, see lesson 9), and <code>sheet = [w, h]</code>, the size of your stock.</li>
<li><code>part("name", "ply3") { … }</code> is one physical piece, the union of what's inside it.
<code>qty = 4</code> cuts four copies.</li>
</ul>
<p>Look at the <b>3D fit</b> tab: each part becomes a slab of its material's thickness. Then open <b>Sheets</b>:
Kerf packs the pieces onto sheets automatically, with one set of sheets per material.</p>
<p>Every part starts at the origin. That's why the sign is moved aside: otherwise it would sit inside the
coaster and the fit check would complain.</p>`,
    tasks: [
      'Change <code>qty</code> to 8. Where do the extra coasters go?',
      'Make the sheet smaller and watch Kerf start a second sheet.',
      'Remove the <code>translate</code> from the sign and look at the fit status in the 3D tab.',
    ],
  },
  {
    file: '05-engrave-score.kerf',
    title: 'Engrave, score & images',
    assets: ['assets/sunburst.png', 'assets/star.svg'],
    html: `
<p>Three laser operations, three colours in the exported SVG. Give each colour its own power/speed/passes in xTool:</p>
<ul>
<li><span class="c-cut">cut</span> (red): the part outline and its holes, which is the default.</li>
<li><span class="c-eng">engrave</span> (black fill): <code>engrave() { … }</code> fills in the areas of its children.</li>
<li><span class="c-score">score</span> (blue): <code>score() { … }</code> traces outlines without cutting through.</li>
</ul>
<p><code>text()</code> uses any font installed on your computer, written as <code>"Family:style=Style"</code>.
<code>image("file.png", width = …)</code> engraves a photo or bitmap, and <code>import("file.svg")</code> brings in
vector artwork, which you can cut, engrave or score like any other shape.</p>
<p>Engraving is clipped to its part, so it never spills off the edge.</p>`,
    tasks: [
      'Change the text, then try <code>font = "DejaVu Serif:style=Italic"</code>.',
      'Wrap the score line in <code>engrave()</code> instead and compare.',
      'Cut the star out instead of engraving it: move the <code>import</code> line into a <code>difference()</code>.',
    ],
  },
  {
    file: '06-placing-in-3d.kerf',
    title: 'Placing parts in 3D',
    html: `
<p>Inside a part, transforms shape the flat drawing. <b>Outside</b> a part, the same transforms place the
finished piece in 3D: <code>translate([x, y, z])</code>, <code>rotate([ax, ay, az])</code>, <code>mirror()</code>.</p>
<p>Standing parts up is so common there are two helpers:</p>
<ul>
<li><code>face_y(t)</code>: the part's local y becomes height, and it faces the viewer (−y). Its thickness
fills y = 0…t.</li>
<li><code>face_x(t)</code>: the same, but it faces +x and runs along y, like a box side.</li>
</ul>
<p>Engraving is on the part's top face, so check in 3D that it ends up facing the way you want. If not,
<code>mirror([1,0,0])</code> the part or rotate it 180°.</p>
<p>The slot is <code>t + gap</code> wide. Lasers cut slightly wide (the kerf), so the right gap depends on your
machine; lesson 9 measures it.</p>
<p>Drag the <b>explode</b> slider to pull the parts apart.</p>`,
    tasks: [
      'Make the panel taller and the text bigger.',
      'Add a second panel in a second slot, 10 mm behind the first.',
      'Turn the panel 90° so it stands along the short side of the base.',
    ],
  },
  {
    file: '07-test-fit.kerf',
    title: 'Test fitting',
    html: `
<p>Before you burn material, Kerf checks every pair of parts for overlaps. The status in the 3D tab says
<span class="c-ok">✓ no collisions</span> or lists them; click a message to jump to the code, and the
overlap is drawn in red.</p>
<p>Add the things that go <b>with</b> your project as reference objects with <code>%</code>: <code>%cube([x, y, z])</code>,
<code>%cylinder(h, d = …)</code>. They show up as blue ghosts, they're checked against your parts, and they're never
exported. "Will my phone fit in this stand?" becomes a yes or no.</p>
<p>Touching is fine; only real overlap counts. Kerf catches overlaps down to a few hundredths of a mm.</p>`,
    tasks: [
      'Set <code>gap = -0.5</code> (slot narrower than the panel). Read the collision, then put it back.',
      'Make the phone 20 mm thick. Does it still fit in front of the panel?',
      'Measure something real on your desk and add it as a reference object.',
    ],
  },
  {
    file: '08-finger-joints.kerf',
    title: 'Finger joints',
    html: `
<p>Two panels meeting at a corner share an edge. Split that edge into an odd number of segments: one panel
keeps the odd ones, the other keeps the even ones, and they interlock.</p>
<ul>
<li><code>finger_count(length, 12)</code> picks an odd count with fingers about 12 mm wide.</li>
<li><code>finger_tabs(length, t, n, odd = true/false)</code> draws the tabs along the x axis, <code>t</code> deep.
Mating edges use the same <code>n</code> and opposite <code>odd</code>.</li>
<li>Each panel's own body stops <code>t</code> short of the joint, and its tabs fill that strip.</li>
</ul>
<p>Flip either <code>odd</code> and the fit check shows the clash immediately. For a whole box, including
how the corners are shared between three panels, open <b>box.kerf</b> from the file menu.</p>`,
    tasks: [
      'Drag <b>explode</b> and orbit round the back to see the fingers interlock.',
      'Change the finger width from 12 to 6.',
      'Set both panels to <code>odd = true</code> and look at the collision.',
      'Add a side wall on the left with <code>face_x(t)</code> and joint it to the floor.',
    ],
  },
  {
    file: '09-kerf-and-fit.kerf',
    title: 'Kerf & fit: test card',
    html: `
<p>The beam burns away a thin line of material, the <b>kerf</b> (typically 0.08–0.2 mm). Holes come out
bigger and parts come out smaller by about that much. Kerf can compensate when it exports.</p>
<p>This file is a test card worth cutting on <b>your</b> laser for each material:</p>
<ol>
<li>Untick <b>kerf comp</b>, click <b>Export SVG</b>, and cut it.</li>
<li>Measure the 20 mm square with calipers. <code>kerf = 20 − measured</code>. Put that in your
<code>material(…, kerf = …)</code> and tick <b>kerf comp</b> again from now on.</li>
<li>Push the edge of an offcut into each slot of the comb. The labels are the drawn widths. The slot you
like (snug, or sliding) tells you the <code>gap</code> to use for slots: <code>width − t</code>.</li>
</ol>
<p>Plywood thickness varies by sheet, so measure it with calipers rather than trusting "3 mm".</p>`,
    tasks: [
      'Set <code>t</code> to your measured sheet thickness and re-export.',
      'Make the comb go in 0.05 mm steps.',
      'Copy your measured material lines into a <code>materials.kerf</code> and <code>include &lt;materials.kerf&gt;</code> it from new projects.',
    ],
  },
  {
    file: '10-going-further.kerf',
    title: 'Going further',
    html: `
<p>A few more tools from the standard library:</p>
<ul>
<li><code>living_hinge(w, h, pitch, seg, bridge)</code>: rows of cuts that let plywood bend. Narrower
<code>pitch</code> bends tighter but is weaker.</li>
<li><code>tslot(d, len, nut_w, nut_t)</code>: a captive-nut slot so you can bolt panels together;
<code>tslot_hole(d)</code> is the matching hole in the other panel.</li>
<li><code>slot</code>, <code>ngon</code>, <code>hole_grid</code>, <code>rounded_square</code>, and the full list is under <b>?</b>.</li>
</ul>
<p><b>Your own library:</b> put modules you reuse in a file such as <code>mylib.kerf</code> and write
<code>use &lt;mylib.kerf&gt;</code> at the top of a project. <code>use</code> imports modules and functions;
<code>include</code> also runs the file's code and variables.</p>
<p><b>Workflow tips:</b> <code>#</code> before a statement highlights it, <code>*</code> switches it off,
<code>!</code> shows only it. Click a part chip under the view to select it; double-click to jump to its code.</p>
<p>The next three lessons use the libraries that come with Kerf: boxes, hinges and gears. <b>box.kerf</b>,
<b>sign.kerf</b>, <b>hinged-box.kerf</b> and <b>gear-pair.kerf</b> in the file menu are complete projects to copy from.</p>`,
    tasks: [
      'Make the hinge zone wider and the pitch 1.2.',
      'Add the matching <code>tslot_hole</code> part for the bracket.',
      'Start your own project with <b>New</b>.',
    ],
  },
  {
    file: '11-boxes.kerf',
    title: 'Parametric boxes',
    html: `
<p>Lesson 8 jointed two panels by hand. <code>use &lt;boxes.kerf&gt;</code> does a whole box. It's a library that
ships with Kerf, written in Kerf, so you can read it in the reference (<b>?</b>).</p>
<ul>
<li><code>finger_box(size, "ply3")</code> makes every panel, jointed and placed in 3D, named
<code>box_bottom</code>, <code>box_front</code>…. <code>size</code> is the outside <code>[x, y, z]</code>.</li>
<li><code>top = "open"</code>, <code>"closed"</code> or <code>"lid"</code>. A lid is a plate plus a lip that drops
inside the walls; glue them together.</li>
<li><code>inside = true</code> treats <code>size</code> as the space inside, which is handy when you're boxing
something you've measured.</li>
<li><code>fw</code> is the finger width (default 12), and <code>label</code> engraves the front (or the lid).</li>
</ul>
<p>To change one panel, build the box yourself. <code>box_panel(which, size, t)</code> is a panel's flat outline and
<code>box_place(which, size, t)</code> puts a part where that panel goes, so a <code>difference()</code> can cut a hole
in just the front. <code>which</code> is <code>"bottom"</code>, <code>"top"</code>, <code>"front"</code>,
<code>"back"</code>, <code>"left"</code> or <code>"right"</code>.</p>
<p>Change <code>t</code> or any size and every finger follows. That's the point of doing it in code.</p>`,
    tasks: [
      'Change <code>size</code> to <code>[160, 90, 40]</code>. Both boxes update; the fit check stays green.',
      'Try <code>top = "closed"</code> and <code>top = "open"</code> on the first box.',
      'Make the first box <code>inside = true</code> and add a <code>%cube</code> of what goes in it.',
      'Engrave your name on the second box\'s left side (add an <code>engrave()</code> to its part).',
    ],
  },
  {
    file: '12-hinges.kerf',
    title: 'Hinges',
    html: `
<p><code>use &lt;hinges.kerf&gt;</code> gives you two ways to make things move.</p>
<p><b>A pinned lid.</b> <code>hinged_box(size, "ply3", lid_h, pin_d)</code> is a box whose lid is a shallow
upside-down box, a little wider than the body. Ears on both sets of sides overlap behind the box, and a pin
(3 mm dowel, filament or an M3 bolt) goes through each pair. The pivot sits behind and below the rim, so the lid
opens past 90° without hitting the back.</p>
<ul>
<li><code>open</code> swings the lid in the 3D view. Use it to check the lid clears whatever is inside.</li>
<li><code>pin_d</code> is the hole size; make it a touch bigger than the pin. <code>gap</code> is the clearance
between lid and body sides.</li>
</ul>
<p><b>A living hinge.</b> <code>living_hinge(w, h)</code> (lesson 10) makes plywood bend.
<code>bend_length(angle, r, t)</code> tells you how wide the cut zone needs to be to bend <code>angle</code>
degrees around an inside radius <code>r</code>. The echo shows it.</p>`,
    tasks: [
      'Set <code>open = 110</code> and orbit round the back to watch the ears.',
      'Make the lid taller (<code>lid_h = 35</code>) and check it still opens cleanly.',
      'Change the living hinge to bend 180° and see how much wider the zone gets.',
      'Put a <code>%cube</code> inside the box and find the largest <code>open</code> angle that clears it.',
    ],
  },
  {
    file: '13-gears.kerf',
    title: 'Gears',
    html: `
<p><code>use &lt;gears.kerf&gt;</code> makes involute spur gears, the standard tooth shape, which rolls smoothly.</p>
<ul>
<li><code>gear(teeth, mod, bore)</code>: <code>mod</code> (the module) sets the tooth size; the pitch diameter is
<code>teeth × mod</code>. Gears that mesh must share it.</li>
<li><code>gear_distance(z1, z2, mod)</code> is the centre distance for two gears to mesh. That's where the axle
holes go. Laser-cut gears like 0.1–0.2 mm extra (<code>play</code>).</li>
<li><code>gear_mesh(z1, z2, mod, a1, dir, extra)</code> places its child (the second gear) at that distance, in
direction <code>dir</code>, and rotates it so the teeth interleave. <code>a1</code> is how far the first gear is
turned; the second turns the other way by <code>a1 × z1 / z2</code>.</li>
<li><code>gear_outer_r</code>, <code>gear_root_r</code>, <code>gear_pitch_r</code> and <code>gear_ratio</code> help
size things around the gears, like the base plate here.</li>
</ul>
<p>The fit check is a good gear tester. If the teeth overlap, it says so. Try making <code>play</code> negative.</p>
<p>Below about 13 teeth, small pinions can bind. Cut a test pair before a whole gearbox.</p>`,
    tasks: [
      'Change <code>a</code> to 5, 10, 15… and watch all three gears turn together.',
      'Set <code>play = -0.4</code> and look at the collision; set it back.',
      'Change <code>dir3</code> to move the third gear around the drive gear (the plate follows).',
      'Add a rack: <code>translate([0, -70, 0]) { part("rack", "ply3") rack(12, mod = m); on_rack(z2, m, k = 4) part("on_rack", "ply3") gear(z2, mod = m); }</code>',
    ],
  },
];
