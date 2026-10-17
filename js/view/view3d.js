// three.js assembly view: parts extruded to material thickness and placed
// by their 4x4, engraving drawn on the top face, reference solids and
// interference points overlaid. Z is up, like OpenSCAD.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { toPolygonsWithHoles, bounds } from '../geom/clip.js';
import { apply4 } from '../geom/mat4.js';

export class View3D {
  constructor(container, { imageFor, onPick } = {}) {
    this.container = container;
    this.imageFor = imageFor || (() => null);
    this.onPick = onPick || (() => {});
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(window.devicePixelRatio);
    container.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(250, -350, 250);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.render());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(300, -200, 500);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-300, 300, 100);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(1000, 100, 0x3a3f48, 0x2a2e35);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.scene.add(axes());

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.explode = 0;
    this.first = true;

    new ResizeObserver(() => this.resize()).observe(container);
    this.bindPick();
    const loop = () => { if (this.controls.update()) this.render(); requestAnimationFrame(loop); };
    loop();
  }

  setBackground(css) {
    const bg = new THREE.Color(css);
    this.scene.background = bg;
    // grid a little off the background so it reads in both themes
    const light = bg.getHSL({}).l > 0.5;
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    this.grid = new THREE.GridHelper(1000, 100, light ? 0xc4c9d2 : 0x3a3f48, light ? 0xe4e7ec : 0x262a31);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);
    this.render();
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.pendingFit) this.fit();
    this.render();
  }

  render() { this.renderer.render(this.scene, this.camera); }

  // result: interpreter output; opts: {selected, hits}
  setModel(result, opts = {}) {
    for (const ch of [...this.group.children]) disposeTree(ch);
    this.group.clear();
    this.meshes = [];
    const all = [...result.parts.map(p => ({ p, ghost: false })), ...result.ghostParts.map(p => ({ p, ghost: true }))];
    const center = this.assemblyCenter(result.parts);
    for (const { p, ghost } of all) {
      const obj = this.partObject(p, ghost, opts.selected === p.id);
      obj.userData.part = p;
      obj.userData.base = obj.position.clone();
      obj.userData.center = this.partCenter(p).sub(center);
      this.group.add(obj);
      if (!ghost) this.meshes.push(obj);
    }
    for (const s of result.solids) this.group.add(solidObject(s));
    for (const g of result.ghosts) this.group.add(flatGhost(g));
    if (opts.hits && opts.hits.length) {
      const pts = opts.hits.flatMap(h => h.points);
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      this.group.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xff2030, size: 3, sizeAttenuation: false, depthTest: false })));
    }
    this.applyExplode();
    if (this.first && result.parts.length) { this.first = false; this.fit(); }
    this.render();
  }

  assemblyCenter(parts) {
    const c = new THREE.Vector3();
    if (!parts.length) return c;
    for (const p of parts) c.add(this.partCenter(p));
    return c.divideScalar(parts.length);
  }
  partCenter(p) {
    const b = bounds(p.shape.body.length ? p.shape.body : [[[0, 0]]]);
    return new THREE.Vector3(...apply4(p.m4, [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, p.material.thickness / 2]));
  }

  setExplode(k) { this.explode = k; this.applyExplode(); this.render(); }
  applyExplode() {
    for (const o of this.group.children) {
      if (!o.userData.center) continue;
      o.position.copy(o.userData.center).multiplyScalar(this.explode);
    }
  }

  partObject(p, ghost, selected) {
    const t = p.material.thickness;
    const g = new THREE.Group();
    const m = new THREE.Matrix4().set(...p.m4);
    g.matrixAutoUpdate = false;
    const inner = new THREE.Group();
    inner.matrixAutoUpdate = false;
    inner.matrix.copy(m);
    g.add(inner);
    // wrapper position is used for explode; inner carries the placement
    g.matrixAutoUpdate = true;

    const shapes = toPolygonsWithHoles(p.shape.body).map(({ outer, holes }) => {
      const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
      for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
      return s;
    });
    if (shapes.length) {
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: t, bevelEnabled: false, curveSegments: 1 });
      const color = selected ? '#e8c56a' : (p.color || p.material.color);
      const mat = new THREE.MeshStandardMaterial({
        color, roughness: 0.85, metalness: 0,
        transparent: ghost || p.material.opacity < 1, opacity: ghost ? 0.25 : p.material.opacity,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        side: THREE.DoubleSide, depthWrite: !ghost,
      });
      const mesh = new THREE.Mesh(geo, mat);
      inner.add(mesh);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25),
        new THREE.LineBasicMaterial({ color: p.highlight ? 0xff4fd8 : 0x3a2b1c, transparent: true, opacity: ghost ? 0.2 : 0.6 }));
      inner.add(edges);
    }
    // engraving on the top face
    const top = t + 0.05;
    if (p.shape.engrave.length) {
      const es = toPolygonsWithHoles(p.shape.engrave).map(({ outer, holes }) => {
        const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
        for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
        return s;
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(es, 1), new THREE.MeshBasicMaterial({ color: 0x3c2414, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      mesh.position.z = top;
      inner.add(mesh);
    }
    const lines = [...p.shape.score.map(l => [l, 0x2f6bff]), ...p.shape.lines.map(l => [l, 0x6a2a10])];
    if (lines.length) {
      for (const color of [0x2f6bff, 0x6a2a10]) {
        const segs = [];
        for (const [l, c] of lines) if (c === color) for (let i = 1; i < l.length; i++) segs.push(new THREE.Vector3(l[i - 1][0], l[i - 1][1], top), new THREE.Vector3(l[i][0], l[i][1], top));
        if (segs.length) inner.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color })));
      }
    }
    for (const im of p.shape.images) {
      const el = this.imageFor(im.src);
      if (!el) continue;
      const tex = new THREE.Texture(el);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, blending: THREE.MultiplyBlending, premultipliedAlpha: true }));
      plane.geometry.translate(0.5, 0.5, 0);
      plane.matrixAutoUpdate = false;
      const a = im.m;
      plane.matrix.set(a[0], a[2], 0, a[4], a[1], a[3], 0, a[5], 0, 0, 1, top + 0.01, 0, 0, 0, 1);
      inner.add(plane);
    }
    return g;
  }

  fit() {
    this.group.updateMatrixWorld(true); // new parts haven't been rendered yet
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return;
    if (!this.container.clientWidth) { this.pendingFit = true; return; }
    this.pendingFit = false;
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = new THREE.Vector3(0.55, -0.75, 0.55).normalize();
    this.controls.target.copy(c);
    // fit the bounding sphere into the narrower of the two fields of view
    const vfov = this.camera.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = (size / 2) / Math.sin(Math.min(vfov, hfov) / 2) * 1.05;
    this.camera.position.copy(c).addScaledVector(dir, dist);
    this.camera.near = size / 100;
    this.camera.far = size * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.render();
  }

  bindPick() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 3) return;
      const r = el.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.meshes || [], true).find(h => h.object.isMesh);
      let o = hit && hit.object;
      while (o && !o.userData.part) o = o.parent;
      this.onPick(o ? o.userData.part : null);
    });
  }

  snapshot() { this.render(); return this.renderer.domElement.toDataURL('image/png'); }
}

function solidObject(s) {
  let geo;
  if (s.kind === 'cube') {
    geo = new THREE.BoxGeometry(...s.size);
    geo.translate(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2);
  } else if (s.kind === 'cylinder') {
    geo = new THREE.CylinderGeometry(s.r2, s.r1, s.h, 64);
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, s.h / 2);
  } else {
    geo = new THREE.SphereGeometry(s.r, 48, 24);
  }
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: s.color || '#7fb2ff', transparent: true, opacity: 0.35, depthWrite: false }));
  mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.7 })));
  mesh.matrixAutoUpdate = false;
  mesh.matrix.set(...s.m4);
  g.add(mesh);
  return g;
}

function flatGhost(shape) {
  const segs = [];
  for (const p of [...shape.body, ...shape.lines]) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    segs.push(new THREE.Vector3(a[0], a[1], 0.05), new THREE.Vector3(b[0], b[1], 0.05));
  }
  return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.5 }));
}

function axes() {
  const g = new THREE.Group();
  const L = 30;
  for (const [d, c] of [[[L, 0, 0], 0xe85050], [[0, L, 0], 0x5ac85a], [[0, 0, L], 0x5a8ae8]]) {
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...d)]), new THREE.LineBasicMaterial({ color: c })));
  }
  return g;
}

function disposeTree(o) {
  o.traverse(c => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  });
}
