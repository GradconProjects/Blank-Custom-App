/* BOMA ESTIMATES — 3D element viewer (Three.js, locally bundled).
 *
 * A VIEW of the canonical takeoff state: it renders a SceneModel built by the
 * app (buildElementScene in estimates-app.html) and never calculates a
 * quantity or writes to the estimate. SceneModel: { units:"mm", nodes:[...] }
 * with nodes { id, label, type, role, included, visible, ghost, warning,
 * geometry } — see buildNode below for the geometry shapes.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const MM = 0.001;
const ROLE = {
  concrete:   { color: 0x9aa0a6, opacity: 1.0, metal: 0.0, rough: 0.9 },
  pedestal:   { color: 0x8d949a, opacity: 1.0, metal: 0.0, rough: 0.9 },
  reoBottom:  { color: 0xc0392b, opacity: 1.0, metal: 0.4, rough: 0.5 },
  reoTop:     { color: 0xe67e22, opacity: 1.0, metal: 0.4, rough: 0.5 },
  reoSide:    { color: 0xd35400, opacity: 1.0, metal: 0.4, rough: 0.5 },
  starter:    { color: 0x8e44ad, opacity: 1.0, metal: 0.4, rough: 0.5 },
  lig:        { color: 0x2980b9, opacity: 1.0, metal: 0.4, rough: 0.5 },
  blinding:   { color: 0xe3d5b3, opacity: 1.0, metal: 0.0, rough: 1.0 },
  excavation: { color: 0x8b6b4a, opacity: 0.18, metal: 0.0, rough: 1.0, wire: true },
  formwork:   { color: 0x3a7bd5, opacity: 0.85, metal: 0.0, rough: 0.7 },
  membrane:   { color: 0x00b8d9, opacity: 0.95, metal: 0.0, rough: 0.6 },
  insulation: { color: 0xf1c40f, opacity: 0.95, metal: 0.0, rough: 0.8 },
  castin:     { color: 0x2c3e50, opacity: 1.0, metal: 0.9, rough: 0.3 },
  ground:     { color: 0xd8dce2, opacity: 0.35, metal: 0.0, rough: 1.0 },
};
const HIGHLIGHT = 0xff7a00, SELECT = 0x143d6b, WARN = 0xf1c40f;

function textSprite(text, opts) {
  opts = opts || {};
  const pad = 6, font = `${opts.bold ? "700" : "500"} ${opts.size || 22}px ui-monospace, Menlo, Consolas, monospace`;
  const c = document.createElement("canvas"), g = c.getContext("2d");
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2, h = (opts.size || 22) + pad * 2;
  c.width = w * 2; c.height = h * 2; g.scale(2, 2);
  g.font = font;
  g.fillStyle = opts.bg || "rgba(255,255,255,0.92)"; g.fillRect(0, 0, w, h);
  g.strokeStyle = opts.border || "#143d6b"; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, h - 1.5);
  g.fillStyle = opts.color || "#143d6b"; g.textBaseline = "middle"; g.fillText(text, pad, h / 2);
  const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const s = new THREE.Sprite(mat);
  const scale = (opts.worldHeight || 0.09);
  s.scale.set(scale * (w / h), scale, 1);
  s.renderOrder = 10;
  return s;
}

export function create(container, opts) {
  opts = opts || {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
  } catch (e) { return null; }
  if (!renderer.getContext()) { try { renderer.dispose(); } catch (e) {} return null; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.localClippingEnabled = true;
  renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; renderer.domElement.style.display = "block";
  renderer.domElement.setAttribute("tabindex", "0");
  renderer.domElement.setAttribute("aria-label", "3D element viewer");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 6, 4); scene.add(sun);
  const root = new THREE.Group(); scene.add(root);
  const overlay = new THREE.Group(); scene.add(overlay);   // labels, dimension lines, selection boxes
  let persp = new THREE.PerspectiveCamera(40, 1, 0.01, 200);
  let ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
  let camera = persp;
  const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduced && !opts.reducedMotion; controls.dampingFactor = 0.12;
  controls.addEventListener("change", requestRender);

  const state = { model: null, nodes: new Map(), bounds: new THREE.Box3(), explode: 0, clip: null, xray: false, labels: true, filter: "all", staticMode: false, paused: false, disposed: false, selected: null, highlighted: new Set(), hidden: new Set() };
  const clipPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  let raf = 0, dirty = true, frames = 0;

  function requestRender() { dirty = true; if (!raf && !state.paused && !state.disposed) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (state.disposed || state.paused) return;
    const damping = controls.enableDamping && controls.update();
    if (dirty || damping) { dirty = false; render(); }
    if (damping && !state.staticMode) raf = requestAnimationFrame(tick);
  }
  function render() { resize(); renderer.render(scene, camera); frames++; }
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) renderer.setSize(w, h, false);
    const a = w / h;
    persp.aspect = a; persp.updateProjectionMatrix();
    const ext = state.bounds.isEmpty() ? 1 : state.bounds.getSize(new THREE.Vector3()).length() * 0.7;
    ortho.left = -ext * a; ortho.right = ext * a; ortho.top = ext; ortho.bottom = -ext; ortho.zoom = ortho.zoom || 1; ortho.updateProjectionMatrix();
  }

  // observers: pause off-screen and when the tab is hidden
  const io = ("IntersectionObserver" in window) ? new IntersectionObserver((es) => { const vis = es.some((e) => e.isIntersecting); if (vis) { state.paused = false; requestRender(); } else state.paused = true; }, { threshold: 0.01 }) : null;
  if (io) io.observe(container);
  const onVis = () => { if (document.hidden) state.paused = true; else { state.paused = false; requestRender(); } };
  document.addEventListener("visibilitychange", onVis);
  const ro = ("ResizeObserver" in window) ? new ResizeObserver(() => requestRender()) : null;
  if (ro) ro.observe(container);

  // picking
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let onSelectCb = null, onHoverCb = null, lastHover = null;
  function pick(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.x = ((ev.clientX - r.left) / r.width) * 2 - 1; ptr.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(root.children, true).filter((h) => h.object.visible && h.object.userData.nodeId && !h.object.userData.helper);
    return hits.length ? hits[0].object.userData.nodeId : null;
  }
  let downAt = null;
  renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt) return; const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
    if (moved > 4) return;
    const id = pick(e); api.select(id); if (onSelectCb) onSelectCb(id);
  });
  renderer.domElement.addEventListener("pointermove", (e) => { const id = pick(e); if (id !== lastHover) { lastHover = id; api.highlight(id ? [id] : []); if (onHoverCb) onHoverCb(id); } });
  renderer.domElement.addEventListener("pointerleave", () => { lastHover = null; api.highlight([]); if (onHoverCb) onHoverCb(null); });

  function material(role, ghost) {
    const r = ROLE[role] || ROLE.concrete;
    const m = new THREE.MeshStandardMaterial({ color: r.color, metalness: r.metal, roughness: r.rough, transparent: r.opacity < 1 || ghost, opacity: ghost ? Math.min(r.opacity, 0.28) : r.opacity, side: THREE.DoubleSide, wireframe: !!r.wire && !ghost });
    if (ghost) m.wireframe = false;
    return m;
  }
  function buildNode(n) {
    const g = n.geometry || {}, grp = new THREE.Group();
    grp.userData.nodeId = n.id;
    const mat = material(n.role, n.ghost);
    const add = (mesh) => { mesh.userData.nodeId = n.id; grp.add(mesh); };
    const v = (a) => new THREE.Vector3((a[0] || 0) * MM, (a[1] || 0) * MM, (a[2] || 0) * MM);
    if (g.kind === "box") {
      const m = new THREE.Mesh(new THREE.BoxGeometry(g.size[0] * MM, g.size[1] * MM, g.size[2] * MM), mat); m.position.copy(v(g.pos)); add(m);
      if (n.ghost || (ROLE[n.role] || {}).wire) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineDashedMaterial({ color: (ROLE[n.role] || ROLE.concrete).color, dashSize: 0.03, gapSize: 0.02 })); e.computeLineDistances(); e.position.copy(m.position); e.userData.helper = true; grp.add(e); }
    } else if (g.kind === "cyl") {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(g.r * MM, (g.r2 !== undefined ? g.r2 : g.r) * MM, g.h * MM, 40, 1, !!g.open), mat); m.position.copy(v(g.pos)); add(m);
    } else if (g.kind === "bars") {
      // many straight bars: [{from:[x,y,z], to:[x,y,z]}], one InstancedMesh per node
      const bars = g.bars || [], dia = (g.dia || 12) * MM;
      if (bars.length) {
        const geo = new THREE.CylinderGeometry(dia / 2, dia / 2, 1, 8, 1);
        const inst = new THREE.InstancedMesh(geo, mat, bars.length);
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s3 = new THREE.Vector3();
        bars.forEach((b, i) => { const a = v(b.from), c = v(b.to), d = c.clone().sub(a), len = Math.max(1e-4, d.length()); q.setFromUnitVectors(up, d.clone().normalize()); m4.compose(a.clone().add(c).multiplyScalar(0.5), q, s3.set(1, len, 1)); inst.setMatrixAt(i, m4); });
        inst.instanceMatrix.needsUpdate = true; add(inst);
      }
    } else if (g.kind === "loops") {
      // closed rectangular ties: [{center:[x,y,z], w, d}] in the XZ plane
      const loops = g.loops || [], dia = (g.dia || 10) * MM;
      loops.forEach((l) => {
        const w = l.w * MM, d = l.d * MM, c = v(l.center);
        const path = new THREE.CurvePath();
        const p = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        for (let i = 0; i < 4; i++) { const a = p[i], b = p[(i + 1) % 4]; path.add(new THREE.LineCurve3(new THREE.Vector3(c.x + a[0], c.y, c.z + a[1]), new THREE.Vector3(c.x + b[0], c.y, c.z + b[1]))); }
        const m = new THREE.Mesh(new THREE.TubeGeometry(path, 16, dia / 2, 6, true), mat); add(m);
      });
    } else if (g.kind === "panel") {
      const m = new THREE.Mesh(new THREE.BoxGeometry(g.size[0] * MM, g.size[1] * MM, g.size[2] * MM), mat); m.position.copy(v(g.pos)); add(m);
    } else if (g.kind === "markers") {
      (g.points || []).forEach((p) => { const m = new THREE.Mesh(new THREE.CylinderGeometry((g.dia || 20) * MM / 2, (g.dia || 20) * MM / 2, (g.h || 150) * MM, 12), mat); m.position.copy(v(p)); add(m); });
    }
    grp.userData.explodeDir = new THREE.Vector3(...(n.explodeDir || [0, 0, 0]));
    grp.userData.basePos = grp.position.clone();
    return grp;
  }

  function rebuildOverlay() {
    while (overlay.children.length) { const c = overlay.children.pop(); disposeObj(c); }
    if (!state.model) return;
    const dims = state.model.dimensions || [];
    if (state.labels) {
      dims.forEach((d) => {
        const a = new THREE.Vector3(...d.from.map((x) => x * MM)), b = new THREE.Vector3(...d.to.map((x) => x * MM));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0x55745f }));
        line.userData.helper = true; overlay.add(line);
        const s = textSprite(d.label, { size: 20, worldHeight: 0.07, color: "#21382f", border: "#55745f" }); s.position.copy(a.clone().add(b).multiplyScalar(0.5)); s.position.y += 0.02; overlay.add(s);
      });
      (state.model.labels || []).forEach((l) => { const s = textSprite(l.text, { size: 20, worldHeight: 0.07, bold: true }); s.position.set(...l.at.map((x) => x * MM)); overlay.add(s); });
    }
    // selection / highlight / warning helpers
    state.nodes.forEach((grp, id) => {
      const n = grp.userData.node;
      if (!grp.visible) return;
      const sel = state.selected === id, hi = state.highlighted.has(id);
      if (sel || hi || n.warning) {
        const box = new THREE.Box3().setFromObject(grp);
        if (box.isEmpty()) return;
        const h = new THREE.Box3Helper(box, sel ? SELECT : hi ? HIGHLIGHT : WARN); h.userData.helper = true; overlay.add(h);
        const tag = textSprite((sel ? "SELECTED: " : hi ? "" : "⚠ ") + (n.label || id) + (n.ghost ? " — Not included" : "") + (n.warning ? " ⚠" : ""), { size: 20, worldHeight: 0.075, bold: true, color: sel ? "#143d6b" : hi ? "#9a4a04" : "#7a4a08", border: sel ? "#143d6b" : hi ? "#e8760a" : "#f1c40f" });
        tag.position.set(box.max.x, box.max.y + 0.06, box.max.z); overlay.add(tag);
      } else if (n.ghost) {
        const box = new THREE.Box3().setFromObject(grp); if (box.isEmpty()) return;
        const tag = textSprite("Not included: " + (n.label || id), { size: 18, worldHeight: 0.06, color: "#5b6b7d", border: "#5b6b7d", bg: "rgba(255,255,255,0.8)" });
        tag.position.set(box.min.x, box.max.y + 0.04, box.max.z); overlay.add(tag);
      }
    });
  }
  function applyVisibility() {
    state.nodes.forEach((grp, id) => {
      const n = grp.userData.node;
      let vis = n.visible !== false && !state.hidden.has(id);
      if (state.filter === "reo") vis = vis && /reo|starter|lig/.test(n.role);
      if (state.filter === "form") vis = vis && /formwork/.test(n.role);
      grp.visible = vis;
      grp.traverse((o) => { if (o.material && !o.userData.helper) { const base = (ROLE[n.role] || ROLE.concrete); const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach((m) => { if (state.xray && /concrete|pedestal|blinding/.test(n.role)) { m.transparent = true; m.opacity = 0.25; } else if (!n.ghost) { m.opacity = base.opacity; m.transparent = base.opacity < 1; } m.clippingPlanes = state.clip === null ? null : [clipPlane]; m.needsUpdate = true; }); } });
      const dir = grp.userData.explodeDir; grp.position.copy(grp.userData.basePos).addScaledVector(dir, state.explode * 0.35);
    });
  }
  function disposeObj(o) { o.traverse ? o.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) { const ms = Array.isArray(c.material) ? c.material : [c.material]; ms.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } }) : null; }

  const api = {
    setScene(model) {
      if (state.disposed) return;
      while (root.children.length) { const c = root.children.pop(); disposeObj(c); }
      state.nodes.clear();
      state.model = model;
      (model.nodes || []).forEach((n) => { const grp = buildNode(n); grp.userData.node = n; root.add(grp); state.nodes.set(n.id, grp); });
      state.bounds.setFromObject(root);
      const s = state.bounds.getSize(new THREE.Vector3()), c = state.bounds.getCenter(new THREE.Vector3());
      clipPlane.constant = state.clip === null ? 1e6 : (c.x + (state.clip - 0.5) * s.x);
      applyVisibility(); rebuildOverlay();
      if (!api._fitted) { api.setView("iso"); api._fitted = true; }
      requestRender();
    },
    fit() {
      if (state.bounds.isEmpty()) return;
      const s = state.bounds.getSize(new THREE.Vector3()), c = state.bounds.getCenter(new THREE.Vector3());
      const radius = s.length() / 2;
      const dist = radius / Math.sin((persp.fov * Math.PI / 180) / 2) * 1.1;
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (!isFinite(dir.length()) || dir.length() === 0) dir.set(1, 0.8, 1).normalize();
      controls.target.copy(c);
      camera.position.copy(c).addScaledVector(dir, dist);
      ortho.zoom = 1; ortho.position.copy(camera.position); ortho.updateProjectionMatrix();
      camera.near = dist / 100; camera.far = dist * 20; camera.updateProjectionMatrix();
      controls.update(); requestRender();
    },
    setView(name) {
      const c = state.bounds.isEmpty() ? new THREE.Vector3() : state.bounds.getCenter(new THREE.Vector3());
      const dirs = { iso: [1, 0.8, 1], plan: [0, 1, 0.0001], front: [0, 0.0001, 1], side: [1, 0.0001, 0] };
      const d = new THREE.Vector3(...(dirs[name] || dirs.iso)).normalize();
      camera.position.copy(c).addScaledVector(d, 5); controls.target.copy(c); camera.up.set(0, 1, 0);
      api.fit();
    },
    setProjection(kind) {
      const pos = camera.position.clone(), tgt = controls.target.clone();
      camera = kind === "ortho" ? ortho : persp;
      camera.position.copy(pos); controls.object = camera; controls.target.copy(tgt); controls.update();
      resize(); api.fit();
    },
    setClip(frac) { state.clip = (frac === null || frac === undefined || frac === "" ) ? null : Math.max(0, Math.min(1, Number(frac))); if (state.model) api.setScene(state.model); },
    setExplode(f) { state.explode = Math.max(0, Math.min(1, Number(f) || 0)); applyVisibility(); rebuildOverlay(); requestRender(); },
    setXray(on) { state.xray = !!on; applyVisibility(); requestRender(); },
    setLabels(on) { state.labels = !!on; rebuildOverlay(); requestRender(); },
    setFilter(f) { state.filter = f || "all"; applyVisibility(); rebuildOverlay(); requestRender(); },
    setVisible(id, on) { if (on) state.hidden.delete(id); else state.hidden.add(id); applyVisibility(); rebuildOverlay(); requestRender(); },
    highlight(ids) { state.highlighted = new Set(ids || []); rebuildOverlay(); requestRender(); },
    select(id) { state.selected = id || null; rebuildOverlay(); requestRender(); },
    setStatic(on) { state.staticMode = !!on; controls.enableDamping = !on && !reduced; requestRender(); },
    screenshot() { render(); return renderer.domElement.toDataURL("image/png"); },
    reset() { state.explode = 0; state.clip = null; state.xray = false; state.filter = "all"; state.hidden.clear(); state.selected = null; state.highlighted.clear(); if (state.model) api.setScene(state.model); api.setView("iso"); },
    onSelect(cb) { onSelectCb = cb; }, onHover(cb) { onHoverCb = cb; },
    info() { return { nodes: state.nodes.size, visibleNodes: [...state.nodes.values()].filter((g) => g.visible).length, hidden: [...state.hidden], ghosts: [...state.nodes.values()].filter((g) => g.userData.node.ghost).map((g) => g.userData.nodeId), ids: [...state.nodes.keys()], geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, frames, paused: state.paused, disposed: state.disposed, raf: !!raf, explode: state.explode, clip: state.clip, xray: state.xray, filter: state.filter }; },
    pause() { state.paused = true; }, resume() { state.paused = false; requestRender(); },
    dispose() {
      if (state.disposed) return; state.disposed = true;
      if (raf) cancelAnimationFrame(raf); raf = 0;
      if (io) io.disconnect(); if (ro) ro.disconnect(); document.removeEventListener("visibilitychange", onVis);
      controls.dispose();
      while (root.children.length) { const c = root.children.pop(); disposeObj(c); }
      while (overlay.children.length) { const c = overlay.children.pop(); disposeObj(c); }
      state.nodes.clear();
      renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss();
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
    },
  };
  api.setView("iso");
  return api;
}
export const VERSION = "1.0.0";
export function webglAvailable() { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } }
