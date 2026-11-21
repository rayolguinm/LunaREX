// LunaREX world icons: real global mosaics on lit, rotating spheres.
//   Moon:   LROC WAC global morphologic mosaic (NASA/GSFC/Arizona State University)
//   Mars:   Viking Orbiter global color mosaic (NASA/JPL/USGS)
//   Europa: Voyager and Galileo SSI global mosaic (NASA/JPL/USGS)
// One offscreen WebGL renderer draws every globe and copies the frame to each card's 2D canvas,
// so the page opens a single extra GPU context. Lighting per body:
//   Moon:   Lommel-Seeliger regolith law (flat, bright full disk, hard terminator), faint earthshine
//   Mars:   Lambert surface plus a thin dusty limb glow
//   Europa: Lambert ice with a faint cool rim
// The globes are laid out at their true relative sizes (see --r in the stylesheet), so the renderer keeps one
// buffer at the largest size and each card receives a resampled copy.
// Author: Raymundo "R@y" Olguin, LunaREX.
import { A } from "./assets.js";
import * as THREE from "../three/three.module.min.js";

const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Physical constants. Mean radii: IAU Working Group on Cartographic Coordinates and Rotational Elements
// (Archinal et al., 2018, Celest. Mech. Dyn. Astron. 130, 22). Surface gravity is derived here as g = GM / R^2.
// `tilt` is the angle between the spin axis and the normal of the body's orbit around the Sun, in degrees, which
// is the tilt sunlight sees: Moon 1.54 (to the ecliptic), Mars 25.19, Europa about 3.1 (it inherits Jupiter's
// obliquity, because its spin axis and orbit stay within a fraction of a degree of Jupiter's equator).
// `au`, `bond_albedo` and `emissivity` feed the terrain lab's thermal model (dtm.js). The albedo and emissivity are
// round working values for the whole body, stated as assumptions in the legend; edit them here.
// `speed` is display rotation in rad/s and is not to scale: real periods differ by a factor of 27.
export const BODY = {
  moon:   { name: "Moon",   tex: "assets/img/globe_moon.jpg",   kind: 0, radius_km: 1737.4, gm_km3s2: 4902.80,  rotation_d: 27.3217, tilt: 1.54,  au: 1.0,   bond_albedo: 0.12, emissivity: 0.95, speed: 0.10, start: 3.6 },
  mars:   { name: "Mars",   tex: "assets/img/globe_mars.jpg",   kind: 1, radius_km: 3389.5, gm_km3s2: 42828.37, rotation_d: 1.02596, tilt: 25.19, au: 1.524, bond_albedo: 0.25, emissivity: 0.95, speed: 0.12, start: 4.4 },
  europa: { name: "Europa", tex: "assets/img/globe_europa.jpg", kind: 2, radius_km: 1560.8, gm_km3s2: 3202.72,  rotation_d: 3.5512,  tilt: 3.1,   au: 5.203, bond_albedo: 0.62, emissivity: 0.90, speed: 0.09, start: 1.6 }
};
export const gravity = (b) => b.gm_km3s2 / b.radius_km ** 2 * 1000;      // m/s^2

export function initGlobes() {
  const cvs = [...document.querySelectorAll("canvas.globe3d")];
  if (!cvs.length) return;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: false }); } catch (e) { return; }
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20);
  camera.position.set(0, 0, 5.4); camera.lookAt(0, 0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, uKind: { value: 0 }, uSun: { value: new THREE.Vector3(-0.62, 0.38, 0.69).normalize() } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform float uKind; uniform vec3 uSun;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        vec3 n = normalize(vN), v = normalize(vV), l = normalize(uSun);
        float mu0 = max(dot(n,l),0.), mu = max(dot(n,v),0.);
        vec3 a = texture2D(map, vUv).rgb;
        vec3 col;
        if (uKind < .5) {                                   // Moon: Lommel-Seeliger
          float ls = mu0 / (mu0 + mu + 1e-4) * 2.0;
          col = a * ls * 1.08 + a * .018;                   // faint earthshine on the night side
        } else if (uKind < 1.5) {                           // Mars
          float lam = smoothstep(-.06, .9, dot(n,l));
          col = a * lam * 1.18;
          float rim = pow(1. - mu, 3.2) * smoothstep(-.25, .45, dot(n,l));
          col += vec3(.95,.62,.42) * rim * .55;             // dusty limb
        } else {                                            // Europa
          float lam = smoothstep(-.04, .95, dot(n,l));
          col = a * lam * 1.06;
          col += vec3(.70,.82,1.) * pow(1. - mu, 4.) * smoothstep(-.2, .5, dot(n,l)) * .22;
        }
        float edge = smoothstep(0., .035, mu);              // antialiased limb
        gl_FragColor = vec4(col, edge);
        #include <colorspace_fragment>
      }`,
    transparent: true
  });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 100), mat);
  scene.add(globe);
  const loader = new THREE.TextureLoader(), tex = {};
  const items = cvs.map((c) => {
    const b = BODY[c.dataset.body], it = { c, b, ctx: c.getContext("2d"), vis: false, ready: false, rot: b.start };
    loader.load(A(b.tex), (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); tex[c.dataset.body] = t; it.ready = true; it.dirty = true; c.classList.add("live"); });
    new IntersectionObserver((es) => { it.vis = es[0].isIntersecting; it.dirty = true; }).observe(c);
    return it;
  });
  let last = performance.now(), buffer = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    for (const it of items) {
      if (!it.vis || !it.ready) continue;
      if (!reduce) it.rot += dt * it.b.speed; else if (!it.dirty) continue;
      const dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(it.c.clientWidth * dpr), H = Math.round(it.c.clientHeight * dpr);
      if (!W || !H) continue;
      if (it.c.width !== W || it.c.height !== H) { it.c.width = W; it.c.height = H; }
      const B = Math.max(...items.map((o) => o.c.width));                  // one square buffer, sized for the largest globe
      if (buffer !== B) { buffer = B; renderer.setSize(B, B, false); }
      mat.uniforms.map.value = tex[it.c.dataset.body]; mat.uniforms.uKind.value = it.b.kind;
      globe.rotation.set(0, 0, 0); globe.rotateZ(THREE.MathUtils.degToRad(it.b.tilt)); globe.rotateY(it.rot);
      renderer.render(scene, camera);
      it.ctx.clearRect(0, 0, W, H); it.ctx.drawImage(renderer.domElement, 0, 0, buffer, buffer, 0, 0, W, H);
      it.dirty = false;
    }
  };
  requestAnimationFrame(frame);
}
