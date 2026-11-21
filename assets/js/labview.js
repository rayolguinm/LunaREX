// LunaREX terrain lab viewer: one DTM window in WebGL (three.js), drawn in up to four viewports at once.
// A viewport pairs a camera (how the terrain is drawn) with a parameter (what is drawn on it).
//
//   cameras      Perspective  free orbit with foreshortening, the view a headset gives
//                Isometric    orthographic, 35.264 deg above the horizon, snapped to the four diagonals, so the three
//                             axes are foreshortened equally and lengths along them are comparable
//                Plan         orthographic, straight down, image top up: lengths are to scale
//                Front        orthographic, level with the ground, from the bottom edge of the image: an elevation drawing
//   parameters   Orthoimage     the orthorectified image, unlit (it carries its own sunlight)
//                Elevation      metres above the window minimum, LunaREX altimetry ramp (HiRISE hue order, even lightness)
//                Thermal        modeled direct-beam radiative-equilibrium temperature for the chosen Sun, with cast shadows
//                               from the DTM and true-scale normals (see dtm.js)
//                Slope          Horn (1981) slope in degrees at the displayed post spacing, 0 to 45 deg
//                Shaded relief  hillshade of the DTM alone: cos(incidence) for the chosen Sun
//                Mesh           the triangles the index buffer really contains
//
// One renderer draws every viewport of a stage into one canvas with scissored viewports.
// Input: press selects a viewport, drag orbits, pinch or Ctrl + wheel zooms, a double tap or double click resets it.
// Horizontal scale is exact (see registration in dtm.js). Vertical scale is true scale times the exaggeration.
// The hillshade uses the exaggerated surface, the usual z-factor convention; slope and the thermal model never do.
// Author: Raymundo "R@y" Olguin, LunaREX.
import { A } from "./assets.js";
import * as THREE from "../three/three.module.min.js";
import { clamp, registration, stats, gridMesh, slopeDeg, median, castShadow, ELEVATION, SLOPE, THERMAL, SLOPE_MAX_DEG, THERMAL_FLOOR } from "./dtm.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const MODES = { ortho: 0, shaded: 1, elevation: 2, slope: 3, mesh: 4, thermal: 5 };
const FOV = 34, EL = [0.04, 1.45], DIST = [1.1, 6], ISO_EL = Math.atan(Math.SQRT1_2), Q = Math.PI / 2;
// az and el in radians: az pi/2 looks from the bottom edge of the image toward its top. dist is in half-window units.
// `lock` lists the angles a drag may not change, `snap` returns az to the nearest diagonal when the drag ends.
export const CAMERAS = {
  perspective: { name: "Perspective", ortho: false, az: 0.7,    el: 0.62,   dist: 2.55, lock: "",      spin: true },
  isometric:   { name: "Isometric",   ortho: true,  az: Q / 2,  el: ISO_EL, dist: 3.7,  lock: "el",    snap: true },
  plan:        { name: "Plan",        ortho: true,  az: Q,      el: Q,      dist: 3.7,  lock: "az el" },
  front:       { name: "Front",       ortho: true,  az: Q,      el: 0,      dist: 3.7,  lock: "az el" }
};

const lutTex = (lut) => { const t = new THREE.DataTexture(lut, 256, 1, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
const sunVector = (azDeg, altDeg) => { const a = azDeg * Math.PI / 180, h = altDeg * Math.PI / 180; return new THREE.Vector3(Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)); };   // x east, y up, z south

// views: [{ camera, mode }] for the four viewports. linked: the viewports share one camera, so they stay registered.
export function createLab(canvas, { paneEls = [], views, linked = false, onInteract, onSelect } = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true }); } catch (e) { return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  const scene = new THREE.Scene(), loader = new THREE.TextureLoader();
  const persp = new THREE.PerspectiveCamera(FOV, 1, 0.01, 50), orth = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  const stateOf = (key) => ({ key, az: CAMERAS[key].az, el: CAMERAS[key].el, dist: CAMERAS[key].dist });
  const shared = linked ? stateOf(views[0].camera) : null;
  const panes = views.map((v) => ({ mode: v.mode, cam: shared || stateOf(v.camera) }));
  let active = 0, layout = "quad", sun = { azimuth: 315, altitude: 30 };

  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, uElevRamp: { value: lutTex(ELEVATION) }, uSlopeRamp: { value: lutTex(SLOPE) }, uThermRamp: { value: lutTex(THERMAL) },
      uMode: { value: 0 }, uRelief: { value: 1 }, uSlopeMax: { value: SLOPE_MAX_DEG }, uVE: { value: 1 }, uFloor: { value: THERMAL_FLOOR },
      uSun: { value: sunVector(sun.azimuth, sun.altitude) } },
    vertexShader: `attribute vec2 cell; attribute float height; attribute float slope; attribute float lit;
      varying vec2 vUv; varying vec2 vCell; varying float vH; varying float vS; varying vec3 vN; varying float vLit;
      void main(){ vUv = uv; vCell = cell; vH = height; vS = slope; vN = normal; vLit = lit; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D map, uElevRamp, uSlopeRamp, uThermRamp; uniform float uMode, uRelief, uSlopeMax, uVE, uFloor; uniform vec3 uSun;
      varying vec2 vUv; varying vec2 vCell; varying float vH; varying float vS; varying vec3 vN; varying float vLit;
      void main(){
        vec3 o = texture2D(map, vUv).rgb;
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float lam = clamp(dot(n, uSun), 0., 1.);
        vec3 col = o;
        if (uMode > .5 && uMode < 1.5) col = vec3(pow(lam, 2.2));                                   // display grey = cos(incidence)
        else if (uMode > 1.5 && uMode < 2.5) col = texture2D(uElevRamp, vec2(clamp(vH/uRelief,0.,1.), .5)).rgb * mix(.80, 1., lam);
        else if (uMode > 2.5 && uMode < 3.5) col = texture2D(uSlopeRamp, vec2(clamp(vS/uSlopeMax,0.,1.), .5)).rgb;
        else if (uMode > 3.5 && uMode < 4.5) {
          vec2 f = fract(vCell); float aa = (fwidth(vCell.x)+fwidth(vCell.y))*.55;
          float w = max(max(1.-smoothstep(0.,aa,min(f.x,1.-f.x)), 1.-smoothstep(0.,aa,min(f.y,1.-f.y))), 1.-smoothstep(0.,aa*1.3,abs(f.x-f.y)));
          col = mix(o*.35 + vec3(.02,.03,.06), vec3(.62,.80,1.0), w*.85);
        } else if (uMode > 4.5) {
          vec3 nt = normalize(vec3(n.x, n.y * uVE, n.z));                                           // undo the exaggeration: the true-scale normal
          float mu = dot(nt, uSun);                                                                // cos(incidence)
          float T = pow(clamp(mu, 0., 1.), .25);                                                   // T / Tmax = cos(i)^(1/4)
          vec3 hot = texture2D(uThermRamp, vec2(clamp((T - uFloor)/(1. - uFloor), 0., 1.), .5)).rgb;
          float sunlit = smoothstep(.35, .65, vLit) * step(0., mu);                                // cast shadow or facing away: no direct beam
          col = mix(vec3(.105, .115, .15), hot, sunlit);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide
  });
  let mesh = null, data = null, ve = 1, ds = 2, auto = !reduce, dirty = true, visible = false, info = null, shade = 0;

  // cast shadows depend only on the grid and the Sun, so they are recomputed on the next frame after either changes
  const relight = () => {
    shade = 0; if (!mesh || !data) return;
    mesh.geometry.setAttribute("lit", new THREE.BufferAttribute(castShadow(data.Z, data.reg, ds, sun.azimuth, sun.altitude), 1)); dirty = true;
  };
  const build = () => {
    if (!data) return null;
    const { Z, reg, st } = data, unit = 2 / reg.S;                                   // the window spans -1..1 scene units
    const m = gridMesh({ Z, reg, ds, ve, unit, zRef: (st.lo + st.hi) / 2 }), slope = slopeDeg(Z, reg.N, m.spacing, ds);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.position, 3)); g.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
    g.setAttribute("cell", new THREE.BufferAttribute(m.cell, 2)); g.setAttribute("height", new THREE.BufferAttribute(m.height, 1));
    g.setAttribute("slope", new THREE.BufferAttribute(slope.map((v) => (v === v ? v : 0)), 1));
    g.setAttribute("lit", new THREE.BufferAttribute(new Float32Array(m.n * m.n).fill(1), 1));
    g.setIndex(new THREE.BufferAttribute(m.index, 1)); g.computeVertexNormals();
    if (mesh) { mesh.geometry.dispose(); mesh.geometry = g; } else { mesh = new THREE.Mesh(g, mat); scene.add(mesh); }
    mat.uniforms.uRelief.value = st.relief || 1; mat.uniforms.uVE.value = ve; relight(); dirty = true;
    return (info = { triangles: m.triangles, spacing: m.spacing, posts: m.n, relief: st.relief, valid: st.valid, medianSlope: median(slope) });
  };
  const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); dirty = true; };
  new ResizeObserver(resize).observe(canvas); resize();
  new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(canvas);

  // viewport rectangles come from the overlay elements, so the WebGL viewports and the labels can never disagree
  const shown = () => (layout === "quad" ? panes.map((_, i) => i) : [active]);
  const rectOf = (i) => { const c = canvas.getBoundingClientRect(), r = (paneEls[i] || canvas).getBoundingClientRect(); return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height }; };
  const paneAt = (e) => { const c = canvas.getBoundingClientRect(), x = e.clientX - c.left, y = e.clientY - c.top;
    return shown().find((i) => { const r = rectOf(i); return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }) ?? active; };
  const select = (i) => { if (i === active) return; active = i; dirty = true; onSelect && onSelect(); };
  const def = (p) => CAMERAS[p.cam.key];
  const orbit = (dAz, dEl) => { const p = panes[active], c = def(p); if (!c.lock.includes("az")) p.cam.az += dAz; if (!c.lock.includes("el")) p.cam.el = clamp(p.cam.el + dEl, EL[0], EL[1]); dirty = true; };
  const settle = () => { const p = panes[active]; if (def(p).snap) { p.cam.az = Math.round((p.cam.az - Q / 2) / Q) * Q + Q / 2; dirty = true; } };
  const zoom = (f) => { const p = panes[active]; p.cam.dist = clamp(p.cam.dist * f, DIST[0], DIST[1]); dirty = true; };
  const touched = () => { if (auto && def(panes[active]).spin) { auto = false; onInteract && onInteract(); } };

  // pointer: press selects the viewport under it, drag orbits, two pointers pinch; Ctrl or Cmd + wheel zooms without stealing page scroll
  const pts = new Map(); let pinch = 0, down = null, tap = { t: 0, x: 0, y: 0 };
  const hover = (i) => paneEls.forEach((el, k) => el.classList.toggle("hover", k === i && layout === "quad"));
  canvas.addEventListener("pointerleave", () => hover(-1));
  canvas.addEventListener("pointerdown", (e) => { if (!pts.size) { select(paneAt(e)); down = { t: e.timeStamp, x: e.clientX, y: e.clientY }; } pts.set(e.pointerId, e); canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging"); touched(); });
  canvas.addEventListener("pointermove", (e) => {
    const prev = pts.get(e.pointerId); if (!prev) { if (e.pointerType === "mouse") hover(paneAt(e)); return; } pts.set(e.pointerId, e);
    if (pts.size === 1) orbit(-(e.clientX - prev.clientX) * 0.008, (e.clientY - prev.clientY) * 0.005);
    else if (pts.size === 2) { const [p, q] = [...pts.values()], d = Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY); if (pinch) zoom(pinch / d); pinch = d; }
  });
  const up = (e) => {
    pts.delete(e.pointerId); pinch = 0; if (pts.size) return;
    canvas.classList.remove("dragging"); settle();
    // a quick press that did not move is a tap; two taps close together reset the viewport (mouse double-click included)
    if (down && e.type === "pointerup" && e.timeStamp - down.t < 280 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) {
      if (e.timeStamp - tap.t < 340 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 32) { api.reset(); tap.t = 0; } else tap = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    }
    down = null;
  };
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("wheel", (e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); select(paneAt(e)); touched(); zoom(Math.exp(e.deltaY * 0.01)); }, { passive: false });
  canvas.addEventListener("keydown", (e) => {
    const iso = def(panes[active]).snap, turn = iso ? Q : 0.12;
    const k = { ArrowLeft: () => orbit(turn, 0), ArrowRight: () => orbit(-turn, 0), ArrowUp: () => orbit(0, 0.08), ArrowDown: () => orbit(0, -0.08),
      "+": () => zoom(0.88), "=": () => zoom(0.88), "-": () => zoom(1 / 0.88), "0": () => api.reset(),
      "1": () => select(0), "2": () => select(1), "3": () => select(2), "4": () => select(3) }[e.key];
    if (k) { e.preventDefault(); touched(); k(); }
  });

  const place = (p, aspect) => {
    const c = def(p), s = p.cam, cam = c.ortho ? orth : persp, top = s.el > Q - 1e-3;
    if (c.ortho) {
      // orthographic framing: at the home distance the window just fits the viewport; zoom scales that extent
      const fit = top ? 1.06 / Math.min(1, aspect) : s.el < 0.01 ? Math.max(0.42, 1.1 / aspect) : Math.max(1.12, 1.62 / aspect), hh = fit * s.dist / c.dist;
      cam.left = -hh * aspect; cam.right = hh * aspect; cam.top = hh; cam.bottom = -hh;
    } else cam.aspect = aspect;
    cam.up.set(0, top ? 0 : 1, top ? -1 : 0);                                   // straight down: the top of the image stays up
    cam.position.set(Math.cos(s.az) * Math.cos(s.el) * s.dist, Math.sin(s.el) * s.dist, Math.sin(s.az) * Math.cos(s.el) * s.dist);
    cam.lookAt(0, 0, 0); cam.updateProjectionMatrix(); return cam;
  };
  const draw = () => {
    const H = canvas.clientHeight;
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    for (const i of shown()) {
      const r = rectOf(i), p = panes[i]; if (r.w < 2 || r.h < 2) continue;
      renderer.setViewport(r.x, H - r.y - r.h, r.w, r.h); renderer.setScissor(r.x, H - r.y - r.h, r.w, r.h);   // WebGL counts rows from the bottom
      mat.uniforms.uMode.value = MODES[p.mode] ?? 0;
      renderer.render(scene, place(p, r.w / r.h));
    }
    dirty = false;
  };
  let last = 0;
  const loop = (t) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    if (!visible || !mesh) return;
    if (auto && !pts.size) { const done = new Set(); for (const i of shown()) { const p = panes[i]; if (def(p).spin && !done.has(p.cam)) { done.add(p.cam); p.cam.az += dt * 0.13; dirty = true; } } }
    if (dirty) draw();
  };
  requestAnimationFrame(loop);

  const api = {
    // fetch first, show second: the caller can drop a stale request between the two
    fetchTexture: (e) => loader.loadAsync(A(`assets/data/lab/${e.world}/${e.slug}.jpg`)),
    show(e, Z, tex) {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      if (mat.uniforms.map.value) mat.uniforms.map.value.dispose();
      mat.uniforms.map.value = tex;
      data = { Z, reg: registration(e.grid, e.window_km * 1000, "block"), st: stats(Z) };
      return build();
    },
    setVE(v) { ve = v; return build(); }, setDS(v) { ds = v; return build(); },
    setSun(azimuth, altitude) { sun = { azimuth, altitude }; mat.uniforms.uSun.value = sunVector(azimuth, altitude); dirty = true; if (!shade) shade = requestAnimationFrame(relight); },
    setMode(m) { if (m in MODES) { panes[active].mode = m; dirty = true; } },
    setCamera(key) { if (!(key in CAMERAS)) return; Object.assign(panes[active].cam, stateOf(key)); dirty = true; },   // a linked stage shares the object, so all four follow
    setActive(i) { select(clamp(i | 0, 0, panes.length - 1)); },
    setLayout(l) { layout = l === "single" ? "single" : "quad"; dirty = true; },
    setAuto(v) { auto = v; }, redraw() { dirty = true; },
    get auto() { return auto; }, get info() { return info; }, get sun() { return sun; }, get linked() { return linked; },
    get active() { return active; }, get layout() { return layout; },
    get views() { return panes.map((p) => ({ camera: p.cam.key, name: def(p).name, mode: p.mode })); },
    // draws now and returns the canvas with its viewport rectangles (CSS pixels); copy it in the same task, before the browser clears it
    snapshot() { if (!mesh) return null; draw(); return { canvas, rects: shown().map((i) => ({ i, ...rectOf(i) })) }; },
    resetAll() { panes.forEach((p, i) => { p.mode = views[i].mode; Object.assign(p.cam, stateOf(linked ? views[0].camera : views[i].camera)); }); dirty = true; },
    zoom, reset() { Object.assign(panes[active].cam, stateOf(panes[active].cam.key)); dirty = true; }
  };
  return api;
}
