// LunaREX 3D terrain: hero descent and interlude flights over real HiRISE DTM windows.
// One ShaderMaterial carries the whole instrument chain: photon (pushbroom reveal of the orthoimage),
// pixel (hypsometric tint with contours at a round interval), mesh (triangulation front), planet (Lambert lit).
// Scene units are metres: 1 unit = 1 m horizontally and vertically, no vertical exaggeration.
// HiRISE data: NASA/JPL/University of Arizona. DTMs produced at HiROC by Raymundo "R@y" Olguin.
// Author: Raymundo "R@y" Olguin, LunaREX.
import { A } from "./assets.js";
import * as THREE from "../three/three.module.min.js";
import { clamp, lerp, smooth as ss, decodeHeights, registration, stats, niceStep, gridMesh, sampler, ELEVATION } from "./dtm.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const cache = new Map();
export const END_ALTITUDE_M = 30;          // height above ground where the hero descent ends
const WIRE_EVERY = 5;                      // the mesh stage draws every 5th post, so lines stay legible from altitude

export function loadTerrain(slug) {
  if (!cache.has(slug)) cache.set(slug, (async () => {
    const base = `assets/data/${slug}/`;
    const meta = await fetch(A(base + "meta.json")).then((r) => r.json());
    const [Z, image] = await Promise.all([
      decodeHeights(base + "height.png", meta.grid, meta.z_scale_m, meta.nodata),
      new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error("orthoimage failed to load")); im.src = A(base + "texture.jpg"); })
    ]);
    const reg = registration(meta.grid, meta.size_m, "edge"), st = stats(Z);
    return { meta, Z, reg, image, S: meta.size_m, relief: st.relief, contour: niceStep(st.relief), heightAt: sampler(Z, reg) };
  })());
  return cache.get(slug);
}

function geometry(T) {
  const m = gridMesh({ Z: T.Z, reg: T.reg }), g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.position, 3)); g.setAttribute("uv", new THREE.BufferAttribute(m.uv, 2));
  g.setAttribute("cell", new THREE.BufferAttribute(m.cell, 2)); g.setIndex(new THREE.BufferAttribute(m.index, 1)); g.computeVertexNormals();
  return g;
}

function terrainMaterial(T) {
  const tex = new THREE.Texture(T.image); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.needsUpdate = true;
  const lut = new THREE.DataTexture(ELEVATION, 256, 1, THREE.RGBAFormat); lut.colorSpace = THREE.SRGBColorSpace; lut.minFilter = lut.magFilter = THREE.LinearFilter; lut.needsUpdate = true;
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      map: { value: tex }, uRamp: { value: lut }, uScan: { value: 1 }, uElev: { value: 0 }, uLevel: { value: -1 }, uTri: { value: -1 }, uTriA: { value: 0 }, uLit: { value: 0 },
      uRelief: { value: T.relief || 1 }, uStep: { value: T.contour }, uSize: { value: T.S }, uEvery: { value: WIRE_EVERY },
      uSun: { value: new THREE.Vector3(-0.55, 0.62, -0.35).normalize() }     // sun 44 degrees above the horizon, from the image's upper left
    },
    vertexShader: `
      attribute vec2 cell;
      varying vec2 vUv; varying vec2 vCell; varying float vH; varying vec3 vN; varying vec2 vXZ;
      void main(){ vUv = uv; vCell = cell; vH = position.y; vN = normal; vXZ = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform sampler2D map, uRamp; uniform float uScan,uElev,uLevel,uTri,uTriA,uLit,uRelief,uStep,uSize,uEvery; uniform vec3 uSun;
      varying vec2 vUv; varying vec2 vCell; varying float vH; varying vec3 vN; varying vec2 vXZ;
      void main(){
        vec3 ortho = texture2D(map,vUv).rgb;
        // photon: the image arrives line by line, top to bottom
        float row = 1.0 - vUv.y;
        vec3 col = ortho * step(row, uScan);
        col += vec3(.157,.545,1.0) * (1.0 - smoothstep(0.0, .012, abs(row-uScan))) * step(uScan,.999) * 1.6;
        // pixel: elevation tint, contours every uStep metres, and one level rising through the relief
        float d = abs(fract(vH/uStep + .5) - .5) * uStep;
        float iso = 1.0 - smoothstep(0.0, fwidth(vH)*1.2 + .02*uStep, d);
        float sweep = 1.0 - smoothstep(0.0, uRelief*.03, abs(vH-uLevel));
        vec3 hyp = texture2D(uRamp, vec2(clamp(vH/uRelief,0.,1.), .5)).rgb * (.55 + .45*ortho.r) + iso*.18;
        col = mix(col, hyp, uElev) + vec3(sweep*uElev*.9);
        // mesh: posts joined into triangles along the diagonal the index buffer uses, revealed outward
        vec2 g = vCell/uEvery; vec2 f = fract(g); float aa = (fwidth(g.x)+fwidth(g.y))*.6;
        float wire = max(max(1.-smoothstep(0.,aa,min(f.x,1.-f.x)), 1.-smoothstep(0.,aa,min(f.y,1.-f.y))), 1.-smoothstep(0.,aa*1.3,abs(f.x-f.y)));
        float rr = length(vXZ)/(uSize*.5);
        float built = smoothstep(rr-.05, rr, uTri) * uTriA;
        float crest = (1.-smoothstep(0.,.04,abs(rr-uTri))) * uTriA;
        col = mix(col, vec3(.157,.545,1.0), wire*built*.75) + vec3(crest*.9);
        // planet: Lambert term plus a constant ambient floor
        float lam = clamp(dot(normalize(vN),uSun),0.,1.);
        col = mix(col, col*(.32 + .95*lam), uLit);
        vec2 e = min(vUv,1.-vUv); float edge = smoothstep(0.,.12,e.x)*smoothstep(0.,.12,e.y);
        gl_FragColor = vec4(col, edge);
        #include <colorspace_fragment>
      }`
  });
}

function makeView(canvas) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" }); }
  catch (e) { return null; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(42, 1, 1, 60000);
  const view = { renderer, scene, camera, dirty: true };
  const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); view.dirty = true; };
  new ResizeObserver(resize).observe(canvas); resize();
  return view;
}

// progress of a tall section through its sticky viewport, 0..1
const progressOf = (sec) => { const r = sec.getBoundingClientRect(), span = r.height - innerHeight; return span > 0 ? clamp(-r.top / span) : 0; };

// Runs `draw(p, seconds)` on animation frames while the section is near the viewport.
// With reduced motion there is no time-based drift, so frames are drawn only when the scroll position changes.
function runWhileVisible(section, view, draw) {
  let near = false, raf = 0, lastP = -1; const t0 = performance.now();
  const frame = (now) => {
    raf = near ? requestAnimationFrame(frame) : 0;
    const p = progressOf(section);
    if (reduce && p === lastP && !view.dirty) return;
    lastP = p; view.dirty = false; draw(p, reduce ? 0 : (now - t0) / 1000, now - t0);
    view.renderer.render(view.scene, view.camera);
  };
  new IntersectionObserver((es) => { near = es[0].isIntersecting; if (near && !raf) raf = requestAnimationFrame(frame); }, { rootMargin: "200px" }).observe(section);
}

// ------------------------------------------------------------------ hero: photon, pixel, mesh, planet
export async function hero({ section, canvas, slug, onStage, onRead }) {
  const V = makeView(canvas); if (!V) throw new Error("WebGL is unavailable");
  const T = await loadTerrain(slug), mat = terrainMaterial(T), u = mat.uniforms;
  V.scene.add(new THREE.Mesh(geometry(T), mat));
  const S = T.S, y0 = T.heightAt(0, 0), SCAN_MS = 3400;
  let stage = -1;
  runWhileVisible(section, V, (p, time, ms) => {
    u.uScan.value = reduce ? 1 : clamp(ms / SCAN_MS);
    const scanDone = u.uScan.value >= 1;
    u.uElev.value = scanDone ? ss(0.02, 0.22, p) * (1 - ss(0.5, 0.72, p) * 0.85) : 0;
    u.uLevel.value = lerp(-0.05, 1.05, ss(0.04, 0.34, p)) * T.relief;
    u.uTri.value = lerp(-0.1, 1.6, ss(0.32, 0.6, p)); u.uTriA.value = 1 - ss(0.72, 0.9, p);
    u.uLit.value = ss(0.6, 0.85, p);
    const st = !scanDone || p < 0.04 ? 0 : p < 0.32 ? 1 : p < 0.62 ? 2 : 3;
    if (st !== stage) { stage = st; onStage && onStage(st, T); }
    // camera: top-down, then an oblique orbit, then down to END_ALTITUDE_M above the ground under the camera
    const az = -0.9 + time * 0.035 + ss(0, 1, p) * 1.6, low = ss(0.6, 1, p);
    const rad = lerp(S * 0.02, S * 0.62, ss(0, 0.45, p)) - S * 0.12 * low;
    const x = Math.cos(az) * rad, z = Math.sin(az) * rad, ground = T.heightAt(x, z);
    const y = lerp(y0 + lerp(S * 1.5, S * 0.38, ss(0, 0.5, p)), ground + END_ALTITUDE_M, low);
    V.camera.position.set(x, y, z);
    V.camera.lookAt(-Math.cos(az) * S * 0.25 * low, y0 + T.relief * 0.2 * low, lerp(0.001, -Math.sin(az) * S * 0.25, low));
    onRead && onRead(Math.max(0, y - ground), p);
  });
  return T;
}

// ------------------------------------------------------------------ interlude flights
export async function flight({ section, canvas, slug, move = "spiral", onRead }) {
  const V = makeView(canvas); if (!V) throw new Error("WebGL is unavailable");
  const T = await loadTerrain(slug), mat = terrainMaterial(T), u = mat.uniforms;
  u.uLit.value = 0.85;
  V.scene.add(new THREE.Mesh(geometry(T), mat));
  const S = T.S, y0 = T.heightAt(0, 0);
  runWhileVisible(section, V, (p, time) => {
    const drift = time * 0.02; let x, y, z, ly = y0;
    if (move === "spiral") {
      const a = 0.4 + p * 2.6 + drift, r = lerp(S * 0.6, S * 0.22, p);
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = T.heightAt(x, z) + lerp(S * 0.6, T.relief * 0.25 + 90, ss(0, 1, p));
    } else {                                   // crane: start low facing the relief, rise to an overview
      const a = 2.2 + p * 0.9 + drift, r = lerp(S * 0.42, S * 0.7, p);
      x = Math.cos(a) * r; z = Math.sin(a) * r; y = T.heightAt(x, z) + lerp(80, S * 0.75, ss(0, 1, p));
      ly = lerp(T.relief * 0.6, y0, p);
    }
    u.uElev.value = ss(0.35, 0.5, p) * (1 - ss(0.6, 0.75, p)) * 0.85;       // one elevation reading, mid-flight
    u.uLevel.value = lerp(0, T.relief, ss(0.35, 0.75, p));
    V.camera.position.set(x, y, z); V.camera.lookAt(0, ly, 0);
    onRead && onRead(Math.max(0, y - T.heightAt(x, z)), p);
  });
  return T;
}
