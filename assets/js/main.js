// LunaREX studio site, interface: navigation, hero read-outs, pipeline stepper, worlds, terrain lab, links.
// Author: Raymundo "R@y" Olguin, LunaREX.
import { A } from "./assets.js";
import { hero, flight, END_ALTITUDE_M } from "./terrain3d.js";
import { createLab, CAMERAS } from "./labview.js";
import { initGlobes, BODY, gravity } from "./globes.js";
import { REFS } from "./refs.js";
import { clamp, decodeHeights, ELEVATION, SLOPE, THERMAL, SLOPE_MAX_DEG, THERMAL_FLOOR, SOLAR_CONSTANT, subsolarK, rampAt, rampCss } from "./dtm.js";

const $ = (id) => document.getElementById(id);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fmt = (n, d = 0) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const metres = (m) => (m >= 1000 ? `${fmt(m / 1000, m < 10000 ? 2 : 1)} km` : `${fmt(m, m < 10 ? 1 : 0)} m`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const setText = (el, s) => { if (el.textContent !== s) el.textContent = s; };       // write to the page only when the value changed

/* ---------------- citations: numbered in the order of the reference list, linked to it */
const REF_N = new Map(REFS.map((r, i) => [r.key, i + 1])), cited = new Set();
const cite = (...keys) => `<sup class="cite">[${keys.map((k) => { const r = REFS[REF_N.get(k) - 1]; if (!r) throw new Error(`unknown reference "${k}"`); cited.add(k);
  return `<a href="#ref-${k}" title="${esc(r.short)} (${r.year})">${REF_N.get(k)}</a>`; }).sort((a, b) => parseInt(a.split(">")[1]) - parseInt(b.split(">")[1])).join(", ")}]</sup>`;

/* ---------------- bar: solid past the hero, current chapter marked, menu on small screens */
const bar = $("bar"), nav = $("nav"), menuBtn = $("menuBtn"), navLinks = [...nav.querySelectorAll("a")];
const chapters = navLinks.map((a) => document.querySelector(a.getAttribute("href")));
const darkBands = [...document.querySelectorAll("section.dark, footer.dark")], themeMeta = document.querySelector('meta[name="theme-color"]');
const onScroll = () => {
  // the bar takes the ground of the band behind it: white over the studio chapters, frosted black over the data bands
  const under = darkBands.some((s) => { const r = s.getBoundingClientRect(); return r.top <= 30 && r.bottom > 30; });
  bar.classList.toggle("solid", !under); bar.classList.toggle("over", under && scrollY > 40);
  const tint = under ? "#000000" : "#ffffff"; if (themeMeta && themeMeta.content !== tint) themeMeta.content = tint;      // the browser toolbar follows the band
  let cur = -1; chapters.forEach((c, i) => { if (c.getBoundingClientRect().top < innerHeight * 0.4) cur = i; });
  if (cur >= 0) { const sec = chapters[cur].getBoundingClientRect(); if (cur === chapters.length - 1 && sec.bottom < innerHeight * 0.4) cur = -1; }
  navLinks.forEach((a, i) => (i === cur ? a.setAttribute("aria-current", "true") : a.removeAttribute("aria-current")));
};
addEventListener("scroll", onScroll, { passive: true }); onScroll();
const setMenu = (open) => { bar.classList.toggle("open", open); menuBtn.setAttribute("aria-expanded", open); };
menuBtn.onclick = () => setMenu(menuBtn.getAttribute("aria-expanded") !== "true");
nav.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
addEventListener("keydown", (e) => e.key === "Escape" && setMenu(false));
addEventListener("pointerdown", (e) => { if (bar.classList.contains("open") && !bar.contains(e.target)) setMenu(false); });   // a tap outside closes the menu

/* ---------------- interactive emblem (hero and studio): tilt toward the pointer or finger, a moving highlight, a spin on press */
const redraw = () => document.querySelectorAll("#lxEmblem .drawpath").forEach((p) => { p.style.animation = "none"; void p.getBoundingClientRect(); p.style.animation = ""; });   // replay the orbit line
document.querySelectorAll(".logo3d").forEach((el) => {
  if (reduce) return;                                             // reduced motion: the emblem stays still
  const MAX = 22, rest = () => { el.classList.remove("live"); el.style.setProperty("--rx", "0deg"); el.style.setProperty("--ry", "0deg"); };
  const tilt = (e, reach = 0.5) => {
    const r = el.getBoundingClientRect(), x = clamp((e.clientX - (r.left + r.width / 2)) / (r.width * reach), -1, 1), y = clamp((e.clientY - (r.top + r.height / 2)) / (r.height * reach), -1, 1);
    el.style.setProperty("--ry", (x * MAX).toFixed(1) + "deg"); el.style.setProperty("--rx", (-y * MAX).toFixed(1) + "deg");
    el.style.setProperty("--gx", (50 - x * 34).toFixed(0) + "%"); el.style.setProperty("--gy", (50 - y * 34).toFixed(0) + "%"); el.classList.add("live");
  };
  // the hero emblem follows the pointer across the whole first screen; the studio emblem follows it over itself
  const area = el.id === "heroLogo" ? el.closest(".hero-stick") : el, reach = el.id === "heroLogo" ? 4 : 0.5;
  area.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch" || e.target.closest(".logo3d") === el) tilt(e, e.pointerType === "touch" ? 0.5 : reach); });
  area.addEventListener("pointerleave", rest); el.addEventListener("pointerup", (e) => e.pointerType === "touch" && rest()); el.addEventListener("pointercancel", rest);
  const spin = () => { el.classList.remove("spin"); void el.offsetWidth; el.classList.add("spin"); redraw(); };
  el.addEventListener("click", spin);
  el.addEventListener("keydown", (e) => { if (el.tagName !== "BUTTON" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); spin(); } });
  el.addEventListener("animationend", (e) => e.animationName === "logo-spin" && el.classList.remove("spin"));
});

/* ---------------- emblem: its orbit line draws once, when it comes into view */
new IntersectionObserver((es, io) => { if (es[0].isIntersecting) { $("emblem").classList.add("in"); io.disconnect(); } }, { threshold: 0.3 }).observe($("emblem"));

/* ---------------- hero and flights (real HiRISE DTM windows; every figure in the captions comes from the tile metadata) */
const stagesEl = [...$("stages").children];
const STAGE = [
  ["Photon", () => "Pushbroom acquisition: the orthoimage arrives line by line, the way the HiRISE detectors sweep the ground."],
  ["Pixel", (T) => `Stereo DTM: elevation on a regular grid, in altimetry colors from violet lows to white highs, with a contour every ${fmt(T.contour)} m and one level rising from floor to rim.`],
  ["Mesh", () => "Every four neighbouring posts become two triangles. The lines trace every fifth post of the mesh the pipeline writes."],
  ["Planet", () => `Lit, textured and at true scale: the scene a headset receives, here from ${END_ALTITUDE_M} m above the surface. The terrain lab below runs the same chain on 60 terrains.`]
];
// logarithmic altitude tape, 10 m to 10 km
const TAPE = [10, 10000], tapePos = (m) => 1 - clamp(Math.log10(Math.max(m, 1) / TAPE[0]) / Math.log10(TAPE[1] / TAPE[0]));
const minorTicks = [1, 2, 3].flatMap((d) => [2, 3, 4, 5, 6, 7, 8, 9].map((k) => k * 10 ** d));
$("tape").insertAdjacentHTML("afterbegin",
  [10, 100, 1000, 10000].map((m) => `<span style="top:${tapePos(m) * 100}%">${m >= 1000 ? m / 1000 + " km" : m + " m"}</span>`).join("") +
  minorTicks.map((m) => `<s style="top:${tapePos(m) * 100}%"></s>`).join(""));
const collar = (T, lead) => `${lead} ${metres(T.S)} HiRISE DTM window, ${T.meta.dtm_id}: ${fmt(T.reg.post, 1)} m post spacing, ${fmt(T.relief)} m of relief, true scale. NASA/JPL/University of Arizona.`;
const heroEl = $("top");
hero({
  section: heroEl, canvas: $("heroGL"), slug: "noachis-terra-craters-3524e-3510s",
  onStage: (s, T) => { stagesEl.forEach((li, i) => { li.classList.toggle("on", i === s); li.classList.toggle("done", i < s); }); $("stageName").textContent = STAGE[s][0]; $("stageTxt").textContent = STAGE[s][1](T); },
  onRead: (m, p) => { setText($("altVal"), fmt(m) + " m"); $("tapeMark").style.top = tapePos(m) * 100 + "%"; heroEl.classList.toggle("descending", p > 0.03); }
}).then((T) => { $("heroCollar").textContent = collar(T, "Noachis Terra craters,"); })
  .catch(() => { $("heroPoster").hidden = false; heroEl.classList.add("static"); });
[{ id: "f1", slug: "cavil-angusti-south-polar-2834e-765s", move: "spiral" }, { id: "f2", slug: "hebes-mensa-deposit-2848e-013s", move: "crane" }].forEach((f) => {
  const sec = $(f.id), read = sec.querySelector(".alt-read"), cap = sec.querySelector(".collar");
  new IntersectionObserver((es, io) => {
    if (!es[0].isIntersecting) return; io.disconnect();
    flight({ section: sec, canvas: sec.querySelector("canvas"), slug: f.slug, move: f.move, onRead: (m) => setText(read, fmt(m) + " m") })
      .then((T) => { cap.textContent = collar(T, cap.dataset.move + " a"); })
      .catch(() => { sec.querySelector(".poster").hidden = false; sec.querySelector(".read").hidden = true; });
  }, { rootMargin: "600px" }).observe(sec);
});

/* ---------------- 2 pipeline stepper */
const steps = [
  { t: "Photon", s: "Calibrated stereo pairs", d: "Orbital cameras capture the same terrain from two viewing angles. Images are radiometrically calibrated before any geometry is extracted.", l: [`HiRISE and CTX on Mars Reconnaissance Orbiter${cite("mcewen2007", "malin2007")}`, `CaSSIS on ESA Trace Gas Orbiter${cite("thomas2017")}`, `Public LROC NAC and WAC lunar archive${cite("robinson2010")}`, `Galileo imagery for Europa${cite("belton1992")}`] },
  { t: "Pixel", s: "Photogrammetry", d: "Stereo correlation turns parallax between the two images into elevation. Each DTM is controlled, edited and checked against its orthoimage.", l: [`SOCET SET 5.6 photogrammetric workflow${cite("kirk2008", "sutton2022")}`, `Bundle adjustment and automatic terrain extraction${cite("triggs2000")}`, `Orthoimages matched to every DTM${cite("henriksen2017")}`, "Emission, incidence and phase angle bookkeeping", `Expected vertical precision EP = ρ · GSD / (b/h), with a matching error ρ near 0.2 pixel${cite("kirk2008", "kirk2021")}`] },
  { t: "Mesh", s: "3D reconstruction", d: "GeoTIFF elevation grids become true-scale textured meshes with the orthoimage draped on top, ready for render engines and 3D printers.", l: ["DTM to OBJ with JP2 ortho texture, downsampling factor per target", "Blender 5.2 Geometry Nodes for scenes and synthetic relief", "DEM to STL for print-ready terrain", "Automated HTML reports for every reconstruction"] },
  { t: "Planet", s: "Immersive XR and film", d: "Finished terrain is staged for headsets, phones and film, so anyone can stand on Mars at the resolution of the instrument.", l: ["Twinmotion VR on Meta Quest over Meta Horizon Link", "Unity AR for Meta Quest and phones", "Vertical Mars terrain films for social media", "Public guides on GitHub Pages"] }
];
let cur = 0;
$("steps").innerHTML = steps.map((x, i) => `<li><button type="button" data-i="${i}"><span class="n">${i + 1}</span><span><b>${x.t}</b><small>${x.s}</small></span></button></li>`).join("");
const figCv = $("stepFig"), fx = figCv.getContext("2d");
// One terrain profile, read four ways. The convergence angle printed in the first figure is measured from the drawing itself.
const drawFig = (t) => {
  const r = Math.min(2, devicePixelRatio || 1), W = figCv.clientWidth, H = figCv.clientHeight; if (!W || !H) return;
  if (figCv.width !== Math.round(W * r)) { figCv.width = Math.round(W * r); figCv.height = Math.round(H * r); }
  fx.setTransform(r, 0, 0, r, 0, 0); fx.clearRect(0, 0, W, H);
  const base = H * 0.66, prof = (x) => base - 26 * Math.sin(x * 0.018) - 14 * Math.sin(x * 0.051 + 1) - 8 * Math.sin(x * 0.13);
  const line = (w, c) => { fx.lineWidth = w; fx.strokeStyle = c; };
  fx.font = '500 11px "DM Mono", ui-monospace, monospace'; fx.textBaseline = "top";
  if (cur === 0) {                                                  // two look directions converge on one ground point
    const sx = W * 0.5 + W * 0.3 * Math.sin(t * 0.0006), sy = prof(sx), cams = [[W * 0.28, 14], [W * 0.72, 14]];
    cams.forEach(([ox, oy], k) => { line(1.5, k ? "rgba(40,139,255,.9)" : "rgba(255,255,255,.8)"); fx.beginPath(); fx.moveTo(ox, oy); fx.lineTo(sx, sy); fx.stroke(); fx.fillStyle = "#fff"; fx.fillRect(ox - 6, oy - 3, 12, 6); });
    const ang = Math.abs(Math.atan2(cams[0][0] - sx, sy - cams[0][1]) - Math.atan2(cams[1][0] - sx, sy - cams[1][1])) * 180 / Math.PI;
    fx.fillStyle = "#b9b9bb"; fx.fillText(`convergence ${ang.toFixed(0)}°`, 12, 10);
  }
  line(1.5, "#fff"); fx.beginPath(); for (let x = 0; x <= W; x += 3) fx.lineTo(x, prof(x)); fx.stroke();
  if (cur === 1) {                                                  // posts on a regular grid, tinted by elevation
    for (let x = 6; x <= W; x += 12) { const y = prof(x), c = rampAt(ELEVATION, (base + 48 - y) / 96).join(",");
      line(1, `rgba(${c},.45)`); fx.beginPath(); fx.moveTo(x, y); fx.lineTo(x, H - 16); fx.stroke(); fx.fillStyle = `rgb(${c})`; fx.beginPath(); fx.arc(x, y, 2.6, 0, 6.3); fx.fill(); }
    fx.fillStyle = "#b9b9bb"; fx.fillText("one elevation per post", 12, 10);
  }
  if (cur === 2) {                                                  // neighbouring posts joined into triangles, built left to right
    const n = Math.min(Math.ceil(W / 24), Math.floor(((t * 0.05) % (W + 240)) / 24)); line(1, "rgba(40,139,255,.8)");
    for (let i = 0; i < n; i++) { const a = i * 24, b = a + 24; fx.beginPath(); fx.moveTo(a, prof(a)); fx.lineTo(b, prof(b)); fx.lineTo(b, H - 16); fx.lineTo(a, H - 16); fx.closePath(); fx.moveTo(a, prof(a)); fx.lineTo(b, H - 16); fx.stroke(); }
    fx.fillStyle = "#b9b9bb"; fx.fillText("two triangles per grid cell", 12, 10);
  }
  if (cur === 3) {                                                  // an observer on the surface and their field of view
    const x = W * 0.12 + ((t * 0.03) % (W * 0.7)), y = prof(x) - 10;
    fx.fillStyle = "rgba(40,139,255,.22)"; fx.beginPath(); fx.moveTo(x, y); fx.lineTo(x + 110, y - 38); fx.lineTo(x + 110, y + 30); fx.fill();
    fx.fillStyle = "#fff"; fx.beginPath(); fx.arc(x, y, 4.5, 0, 6.3); fx.fill(); line(1.5, "#fff"); fx.beginPath(); fx.moveTo(x, y + 4); fx.lineTo(x, prof(x)); fx.stroke();
    fx.fillStyle = "#b9b9bb"; fx.fillText("the terrain at eye height", 12, 10);
  }
};
let figOn = false, figRaf = 0;
const figLoop = (t) => { figRaf = 0; drawFig(reduce ? 900 : t); if (figOn && !reduce) figRaf = requestAnimationFrame(figLoop); };
const figKick = () => { if (!figRaf) figRaf = requestAnimationFrame(figLoop); };
new IntersectionObserver((es) => { figOn = es[0].isIntersecting; if (figOn) figKick(); }).observe(figCv);
new ResizeObserver(figKick).observe(figCv);
const showStep = (i, focus) => {
  cur = clamp(i, 0, steps.length - 1); const x = steps[cur];
  $("steps").querySelectorAll("button").forEach((b) => { +b.dataset.i === cur ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current"); if (focus && +b.dataset.i === cur) b.focus(); });
  $("stepTxt").innerHTML = `<h3>${x.t}: ${x.s}</h3><p>${x.d}</p><ul>${x.l.map((v) => `<li>${v}</li>`).join("")}</ul>`;
  $("prevStep").disabled = cur === 0; $("nextStep").disabled = cur === steps.length - 1; figKick();
};
$("steps").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) showStep(+b.dataset.i); });
$("steps").addEventListener("keydown", (e) => { const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]; if (d) { e.preventDefault(); showStep(cur + d, true); } });
$("prevStep").onclick = () => showStep(cur - 1); $("nextStep").onclick = () => showStep(cur + 1);
showStep(0);

/* ---------------- 3 worlds: facts computed from the constants the globes use (see globes.js) */
document.querySelectorAll("dl.facts").forEach((dl) => {
  const b = BODY[dl.dataset.body], day = b.rotation_d < 2 ? `${fmt(b.rotation_d * 24, 2)} h` : `${fmt(b.rotation_d, 2)} d`;
  dl.innerHTML = `<div><dt>Mean radius</dt><dd>${fmt(b.radius_km, 1)} km</dd></div><div><dt>Surface gravity</dt><dd>${fmt(gravity(b), 2)} m/s²</dd></div><div><dt>Rotation period</dt><dd>${day}</dd></div>`;
});
initGlobes();

/* ---------------- 4 terrain lab: 60 real DTM windows in two stages that follow the story (see labview.js and dtm.js)
   Stage A, Photon: the orthoimage in four drawings (perspective, isometric, plan, front).
   Stage B, Pixel: four parameters of the same grid (elevation, thermal model, slope, shaded relief) on linked cameras.
   Every legend states its method and cites the paper behind it. */
const MODE_NAME = { ortho: "Orthoimage", elevation: "Elevation", thermal: "Thermal", slope: "Slope", shaded: "Shaded relief", mesh: "Mesh" };
const CAM_NOTE = {
  perspective: "Perspective: free orbit with foreshortening, the view a headset gives. Drag to orbit.",
  isometric: "Isometric: orthographic, 35.26° above the horizon. The three axes are foreshortened equally. Drag turns it to the next diagonal.",
  plan: "Plan: orthographic, straight down, image top up. Lengths are to scale.",
  front: "Front: orthographic and level with the ground, seen from the bottom edge of the image. Heights and lengths are to scale."
};
const L = { cat: [], world: "mars", idx: 0, site: null, ve: 1, ds: 2, region: "All", req: 0, heights: new Map() };
const NO_WEBGL = "This browser could not start WebGL, so the 3D view is unavailable.";
// settings remembered on this device (layout, Sun, downsampling, auto-rotate); storage can be unavailable, so every access is guarded
const STORE = "lunarex.lab.v1", phone = () => matchMedia("(max-width: 700px)").matches;
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
const remember = (patch) => { Object.assign(saved, patch); try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { /* private mode or blocked storage: the page works without it */ } };
const play = $("play"), setPlay = (v) => { stages.forEach((s) => s.lab && s.lab.setAuto(v)); play.setAttribute("aria-pressed", v); };

// one stage = a viewer figure (bar, four viewports, legend) plus its row of controls
const makeStage = (fig, opts) => {
  fig.innerHTML = `<figcaption class="v-bar">
      <div class="v-id"><button type="button" class="chip step" data-step="-1" aria-label="Previous terrain">‹</button>
        <div class="v-head"><b data-name>Loading</b><code data-prod></code></div>
        <button type="button" class="chip step" data-step="1" aria-label="Next terrain">›</button></div>
      <span class="ve-badge" data-ve></span>
      <div class="v-tools"><div class="tabs" role="group" aria-label="Viewport layout"><button type="button" data-l="single" aria-pressed="false">1 view</button><button type="button" data-l="quad" aria-pressed="true">4 views</button></div>
        <button type="button" class="chip" data-z="out" aria-label="Zoom out" title="Zoom out">&minus;</button><button type="button" class="chip" data-z="in" aria-label="Zoom in" title="Zoom in">+</button><button type="button" class="chip" data-z="reset">Reset view</button>
        <button type="button" class="chip" data-act="save">Save image</button>${document.fullscreenEnabled ? '<button type="button" class="chip" data-act="full">Full screen</button>' : ""}</div></figcaption>
    <div class="v-stage"><canvas tabindex="0" role="img" aria-label="${opts.label}. Click a viewport to select it; 1 to 4 select, arrow keys orbit, plus and minus zoom, 0 resets, square brackets change terrain."></canvas>
      <div class="panes" data-layout="quad" aria-hidden="true">${"<div class=\"pane\"><span></span></div>".repeat(4)}</div>
      <p class="v-hint" aria-hidden="true">Hold Ctrl or Cmd and scroll to zoom</p><p class="v-status" role="status">Loading the DTM and its orthoimage</p></div>
    <div class="v-legend"><b data-for></b><div class="legend" aria-live="polite"></div></div>`;
  const q = (s) => fig.querySelector(s), root = fig.closest(".stage"), paneEls = [...q(".panes").children], st = { fig, opts, q };
  st.lab = createLab(q("canvas"), { paneEls, views: opts.views, linked: opts.linked, onInteract: () => setPlay(false), onSelect: () => st.sync() });
  const camTabs = root.querySelector("[data-cams]"), modeTabs = root.querySelector("[data-modes]");
  camTabs.innerHTML = opts.cameras.map((k) => `<button type="button" data-c="${k}" aria-pressed="false">${CAMERAS[k].name}</button>`).join("");
  if (modeTabs) modeTabs.innerHTML = opts.modes.map((k) => `<button type="button" data-m="${k}" aria-pressed="false">${MODE_NAME[k]}</button>`).join("");
  st.status = (cls, msg, retry) => { fig.classList.toggle("loading", cls === "loading"); fig.classList.toggle("failed", cls === "failed");
    q(".v-status").innerHTML = esc(msg || "") + (retry ? ' <button type="button" class="chip" data-act="retry">Try again</button>' : ""); };
  st.sync = () => {
    const lab = st.lab, e = L.site; if (!lab) return;
    const views = lab.views, a = lab.active, v = views[a], I = lab.info;
    paneEls.forEach((el, i) => { el.classList.toggle("active", i === a); el.firstElementChild.textContent = `${i + 1} ${views[i].name}${views[i].mode === "ortho" && !opts.modes ? "" : ": " + MODE_NAME[views[i].mode]}`; });
    q(".panes").dataset.layout = lab.layout;
    fig.querySelectorAll("[data-l]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.l === lab.layout));
    camTabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.c === v.camera));
    modeTabs && modeTabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.m === v.mode));
    root.querySelector("[data-camhint]").textContent = CAM_NOTE[v.camera];
    q("[data-for]").textContent = `${a + 1} ${v.name}`;
    if (!e || !I) return;
    q("[data-name]").textContent = e.name; q("[data-prod]").textContent = e.product;
    q("[data-ve]").textContent = L.ve === 1 ? "True scale" : `Vertical × ${L.ve.toFixed(1)}`; q("[data-ve]").classList.toggle("true", L.ve === 1);
    const was = q(".legend details"); if (was) st.more = was.open;      // read the panel's state from the page: the toggle event arrives a task later
    const lg = legend(lab, v, I, e);            // one line first; the method and its sources open on request
    q(".legend").innerHTML = `${lg.bar}<details class="how"${st.more ? " open" : ""}><summary><span>${lg.lead}</span><b>Method and sources</b></summary><p>${lg.more}</p></details>`;
  };
  q(".legend").addEventListener("toggle", (ev) => { st.more = ev.target.open; }, true);
  st.save = () => {
    // the four WebGL viewports, their labels and a credit line, composed on an opaque ground
    const shot = st.lab && st.lab.snapshot(), e = L.site; if (!shot || !e) return;
    const src = shot.canvas, k = src.width / src.clientWidth, pad = Math.round(34 * k), out = document.createElement("canvas"); out.width = src.width; out.height = src.height + pad;
    const g = out.getContext("2d"); g.fillStyle = "#0b0b0d"; g.fillRect(0, 0, out.width, out.height); g.drawImage(src, 0, 0);
    const views = st.lab.views; g.textBaseline = "top"; g.font = `${Math.round(12 * k)}px "DM Mono", monospace`; g.fillStyle = "#e3e3e3";
    shot.rects.forEach((r) => g.fillText(`${views[r.i].name}${opts.modes ? ": " + MODE_NAME[views[r.i].mode] : ""}`, (r.x + 12) * k, (r.y + 10) * k));
    g.fillStyle = "#b9b9bb"; g.fillText(`${e.name}, ${e.product}. ${e.credit} Rendered with LunaREX${L.ve === 1 ? ", true scale" : `, vertical × ${L.ve.toFixed(1)}`}.`, 12 * k, src.height + 10 * k, out.width - 24 * k);
    out.toBlob((blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `LunaREX_${e.slug}_${opts.id}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }, "image/png");
  };
  fig.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b || !st.lab) return;
    if (b.dataset.l) { st.lab.setLayout(b.dataset.l); remember({ ["layout_" + opts.id]: b.dataset.l }); st.sync(); st.lab.redraw(); }
    if (b.dataset.step) loadSite(L.idx + +b.dataset.step);
    if (b.dataset.act === "save") st.save();
    if (b.dataset.act === "retry") loadSite(L.idx);
    if (b.dataset.act === "full") (document.fullscreenElement ? document.exitFullscreen() : fig.requestFullscreen()).catch(() => {});
    if (b.dataset.z) { b.dataset.z === "reset" ? st.lab.reset() : st.lab.zoom(b.dataset.z === "in" ? 0.85 : 1 / 0.85); }
  });
  camTabs.onclick = (ev) => { const b = ev.target.closest("button"); if (b && st.lab) { st.lab.setCamera(b.dataset.c); st.sync(); } };
  if (modeTabs) modeTabs.onclick = (ev) => { const b = ev.target.closest("button"); if (b && st.lab) { st.lab.setMode(b.dataset.m); st.sync(); } };
  if (st.lab) st.lab.setLayout(saved["layout_" + opts.id] || (phone() ? "single" : "quad"));        // four viewports need room; phones open on one
  const cv = q("canvas"); let hintT = 0;
  cv.addEventListener("wheel", (ev) => { if (ev.ctrlKey || ev.metaKey) return; fig.classList.add("hint"); clearTimeout(hintT); hintT = setTimeout(() => fig.classList.remove("hint"), 1500); }, { passive: true });
  cv.addEventListener("keydown", (ev) => { if (ev.key === "[") loadSite(L.idx - 1); else if (ev.key === "]") loadSite(L.idx + 1); else if ((ev.key === "f" || ev.key === "F") && document.fullscreenEnabled) q('[data-act="full"]').click(); });
  fig.addEventListener("fullscreenchange", () => { const b = q('[data-act="full"]'); if (b) b.textContent = document.fullscreenElement === fig ? "Exit full screen" : "Full screen"; st.lab && st.lab.redraw(); });
  if (!st.lab) st.status("failed", NO_WEBGL);
  return st;
};
// the legend of the selected viewport: what the colours mean, in the units of the data
// thermal model parameters per body, and the measurement each ceiling is checked against (sources in the reference list)
const THERMAL_NOTE = {
  moon: (t) => `A = 0.12 and ε = 0.95, as in the Diviner thermal models${cite("vasavada2012", "hayne2017")}. Ceiling ${t} K; Diviner measures 387 to 397 K at the equator${cite("williams2017")}.`,
  mars: (t) => `A = 0.25, inside the 0.09 to 0.43 mapped by Viking${cite("kieffer1977")}; ε = 0.95 is an assumption. Ceiling ${t} K; Viking observed up to 290 K${cite("kieffer1977")}.`,
  europa: (t) => `A = 0.62 and ε = 0.90 are working assumptions, not values taken from a paper. Ceiling ${t} K; Galileo measured a 132 K daytime peak${cite("spencer1999")}.`
};
const legend = (lab, v, I, e) => {
  const m = (x) => `${fmt(x, x < 10 ? 2 : 1)} m`, sp = m(I.spacing), veNote = L.ve === 1 ? "" : ` Relief drawn × ${L.ve.toFixed(1)}.`, sun = lab.sun, body = BODY[e.world], tmax = subsolarK(body);
  const flux = (1 - body.bond_albedo) * SOLAR_CONSTANT / body.au ** 2, flat = Math.sin(sun.altitude * Math.PI / 180);
  const barOf = (lut, a, b) => `<i class="ramp" style="background:${rampCss(lut, 24)}"></i><span class="ends"><span>${a}</span><span>${b}</span></span>`;
  const [bar, lead, more] = {
    ortho: ["", CAM_NOTE[v.camera], `The orthoimage is drawn unlit: its shading is the Sun at the time of imaging, and the DTM has already placed every pixel where the ground is${cite("kirk2008")}.${v.camera === "plan" || v.camera === "perspective" ? "" : veNote}`],
    elevation: [barOf(ELEVATION, "0 m", fmt(I.relief) + " m"), "Elevation above the lowest post in the window.",
      `Stereo elevation${cite("kirk2008", "sutton2022")}. LunaREX altimetry: the HiRISE hue order with lightness rising from low to high, because an unordered rainbow misleads${cite("borland2007", "crameri2020")}.`],
    thermal: [barOf(THERMAL, fmt(tmax * THERMAL_FLOOR) + " K", fmt(tmax) + " K"), `Modeled daytime temperature ceiling, not a measurement. Sun ${sun.altitude}° high: level ground ${fmt(tmax * flat ** 0.25)} K. Grey: no direct sunlight.`,
      `Direct-beam radiative equilibrium, (1 − A) S cos i = εσT<sup>4</sup>, on true-scale slopes with cast shadows from the DTM${cite("aharonson2006", "mazarico2011")}. S = 1361 W/m² at 1 AU${cite("prsa2016", "kopp2011")}, ${fmt(flux)} W/m² absorbed at ${body.name}. ${THERMAL_NOTE[e.world](fmt(tmax))} No thermal inertia, so real surfaces lag the Sun and peak lower${cite("kieffer2013")}.`],
    slope: [barOf(SLOPE, "0°", SLOPE_MAX_DEG + "° and steeper"), `Slope at ${sp} post spacing, always true scale. Median ${fmt(I.medianSlope, 1)}°.`,
      `Horn's 3 × 3 operator${cite("horn1981")}, a ${m(2 * I.spacing)} baseline. Slope depends on baseline${cite("shepard2001", "kreslavsky2000")}, so compare values only at equal spacing.`],
    shaded: ["", `Hillshade of the DTM alone. Sun azimuth ${sun.azimuth}° clockwise from image top, ${sun.altitude}° above the horizon.`,
      `Lambert reflectance, cos(incidence)${cite("horn1981")}. A cartographic convention, not the surface's true photometric function${cite("mcewen1991")}.${veNote}`],
    mesh: ["", `${fmt(I.triangles)} triangles joining ${I.posts} × ${I.posts} posts at ${sp}.`, "Each cell of four posts is split into two triangles along one diagonal, and the lines drawn are those triangle edges. Posts without data are left out of the mesh."]
  }[v.mode];
  return { bar, lead, more };
};
const stages = [
  makeStage($("viewerA"), { id: "image", label: "The orthorectified image in four drawings", cameras: ["perspective", "isometric", "plan", "front"],
    views: [{ camera: "perspective", mode: "ortho" }, { camera: "isometric", mode: "ortho" }, { camera: "plan", mode: "ortho" }, { camera: "front", mode: "ortho" }] }),
  makeStage($("viewerB"), { id: "parameters", label: "Four parameters of the terrain", linked: true, cameras: ["isometric", "perspective", "plan", "front"], modes: ["elevation", "thermal", "slope", "shaded", "mesh"],
    views: [{ camera: "isometric", mode: "elevation" }, { camera: "isometric", mode: "thermal" }, { camera: "isometric", mode: "slope" }, { camera: "isometric", mode: "shaded" }] })
];
const labs = stages.map((s) => s.lab).filter(Boolean), each = (fn) => labs.forEach(fn), syncAll = () => { stages.forEach((s) => s.sync()); refresh(); };
const sites = () => L.cat.filter((e) => e.world === L.world);
const heights = (e) => { if (!L.heights.has(e.slug)) L.heights.set(e.slug, decodeHeights(`assets/data/lab/${e.world}/${e.slug}.png`, e.grid, e.z_scale_m)); return L.heights.get(e.slug); };
// exaggeration that brings the relief to about 16 % of the half-window, in steps of 0.5, never below true scale
const suggestVE = (e) => clamp(Math.round(0.16 / Math.max(e.relief_m / (e.window_km * 500), 1e-4) * 2) / 2, 1, 30);
const press = (sel, el) => document.querySelectorAll(sel).forEach((b) => b.setAttribute("aria-pressed", b === el));
const thumb = (e) => (e.world === "mars" ? `assets/data/thumbs/${e.slug}.jpg` : `assets/data/lab/${e.world}/${e.slug}_t.jpg`);

const fillSelect = () => {
  $("site").innerHTML = sites().map((e, i) => `<option value="${i}">${i + 1}. ${esc(e.name)}</option>`).join("");
  const regs = L.world === "mars" ? ["All", ...new Set(sites().map((e) => e.region))] : [];
  $("chips").hidden = !regs.length;
  $("chips").innerHTML = regs.map((r) => `<button type="button" data-r="${esc(r)}" aria-pressed="${r === L.region}">${esc(r)}</button>`).join("");
  renderGallery();
};
const renderGallery = () => {
  const words = (L.query || "").toLowerCase().split(/\s+/).filter(Boolean), hay = (e) => `${e.name} ${e.product} ${e.region || ""}`.toLowerCase();
  const list = sites().map((e, i) => [e, i]).filter(([e]) => (L.world !== "mars" || L.region === "All" || e.region === L.region) && words.every((w) => hay(e).includes(w))), n = sites().length;
  $("gallery").innerHTML = list.map(([e, i]) => `<button type="button" data-i="${i}" aria-pressed="${i === L.idx}" title="${esc(e.name)}"><img loading="lazy" width="240" height="240" src="${A(thumb(e))}" alt=""><span>${esc(e.name)}</span></button>`).join("");
  const what = L.world === "mars" ? 'HiRISE DTMs produced at HiROC by Raymundo "R@y" Olguin' : L.world === "moon" ? "LROC NAC DTMs of the Moon, from the public archive" : "Galileo SSI DTMs of Europa";
  $("galCount").textContent = list.length ? `${list.length} of ${n} ${what}` : `No terrain on this world matches "${L.query}". Clear the search or pick another world.`;
  markGallery();
};
const markGallery = () => {
  const g = $("gallery"); let on = null;
  g.querySelectorAll("button").forEach((b) => { const hit = +b.dataset.i === L.idx; b.setAttribute("aria-pressed", hit); if (hit) on = b; });
  if (on && g.scrollWidth > g.clientWidth) g.scrollTo({ left: on.offsetLeft - (g.clientWidth - on.clientWidth) / 2, behavior: reduce ? "auto" : "smooth" });   // carousel on phones: keep the selection in view
};

// the shared read-outs: control labels, section and Sun values, and the DTM record
const refresh = () => {
  const e = L.site, I = labs[0] && labs[0].info; if (!e || !I) return;
  const sp = `${fmt(I.spacing, I.spacing < 10 ? 2 : 1)} m`, sun = labs[0].sun;
  $("vexO").textContent = L.ve.toFixed(1) + "×"; $("dsO").textContent = L.ds;
  $("dsHint").textContent = `${I.posts} × ${I.posts} posts at ${sp}, ${fmt(I.triangles)} triangles per viewport`;
  $("sunAzO").textContent = sun.azimuth + "°"; $("sunAltO").textContent = sun.altitude + "°";
  const mars = e.world === "mars", kv = (v, k) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
  $("siteInfo").innerHTML = `<h3>${esc(e.name)}</h3>
    ${mars ? `<p class="where">${esc(e.region)}, ${Math.abs(e.lat).toFixed(2)}°${e.lat < 0 ? "S" : "N"}, ${e.lon.toFixed(2)}°E. Released ${esc(e.released)}.</p>` : e.lat != null ? `<p class="where">${Math.abs(e.lat).toFixed(2)}°${e.lat < 0 ? "S" : "N"}, ${e.lon.toFixed(2)}°E</p>` : ""}
    <dl class="kv">${kv(metres(e.window_km * 1000), "Window")}${kv(sp, "Post spacing shown")}${kv(fmt(I.relief) + " m", "Relief in window")}${kv(fmt(I.medianSlope, 1) + "°", "Median slope")}
      ${mars ? kv(e.native_post_m + " m", "Native post spacing") : ""}${I.valid < 0.9995 ? kv(fmt(I.valid * 100, 1) + " %", "Posts with data") : ""}</dl>
    ${mars ? `<p>${esc(e.geo_note)}</p>` : ""}
    <p class="prod"><code>${esc(e.product)}</code>${mars ? ` from stereo pair <code>${esc(e.pair.join(" + "))}</code>` : ""}<br>Orthoimage: ${esc(e.ortho)}<br>${esc(e.source)}. ${esc(e.credit)}</p>
    <a class="btn line" href="${esc(e.url)}" target="_blank" rel="noopener">${mars ? "Open on uahirise.org" : "Open the source product"}</a>`;
};
const loadSite = async (i, { keepUrl } = {}) => {
  const list = sites(); if (!list.length) return;
  L.idx = (i + list.length) % list.length; const e = list[L.idx], req = ++L.req;
  $("site").value = L.idx; markGallery(); stages.forEach((s) => s.lab && s.status("loading", `Loading ${e.name}`));
  try {
    const [Z, ...tex] = await Promise.all([heights(e), ...labs.map((lab) => lab.fetchTexture(e))]);
    if (req !== L.req) { tex.forEach((t) => t.dispose()); return; }             // a newer selection replaced this one while it loaded
    L.site = e; L.ve = suggestVE(e); $("vex").value = L.ve;
    labs.forEach((lab, k) => { lab.setVE(L.ve); lab.show(e, Z, tex[k]); });
    stages.forEach((s) => s.lab && s.status("", "")); syncAll();
    if (!keepUrl) try { const u = new URL(location.href); u.searchParams.set("dtm", e.slug); history.replaceState(null, "", u); } catch (err) { /* file:// pages may refuse; the link is a convenience */ }
  } catch (err) {
    if (req !== L.req) return; L.heights.delete(e.slug);
    stages.forEach((s) => s.lab && s.status("failed", `${e.name} did not load. Check the connection.`, true));
  }
};
const setWorld = (w) => { L.world = w; L.region = "All"; L.idx = 0; press("[data-w]", document.querySelector(`[data-w="${w}"]`)); fillSelect(); };
fetch(A("assets/data/lab/catalog.json")).then((r) => r.json()).then((cat) => {
  L.cat = cat;
  const want = new URLSearchParams(location.search).get("dtm"), hit = want && cat.find((e) => e.slug === want);   // ?dtm=<slug> opens that DTM
  setWorld(hit ? hit.world : "mars");
  const start = () => loadSite(hit ? sites().indexOf(hit) : 0, { keepUrl: true });
  if (hit) { start(); if (!location.hash) $("lab-ch").scrollIntoView(); return; }                                 // a shared link lands on its terrain
  // otherwise the first terrain is fetched only when the lab is about a screen away, so the hero loads alone
  new IntersectionObserver((es, io) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: "1200px" }).observe($("lab-ch"));
}).catch(() => stages.forEach((s) => s.lab && s.status("failed", "The DTM catalog did not load. Reload the page to try again.")));

document.querySelectorAll("[data-w]").forEach((b) => (b.onclick = () => { setWorld(b.dataset.w); loadSite(0); }));
$("site").onchange = (e) => loadSite(+e.target.value);
$("chips").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; L.region = b.dataset.r; press("#chips button", b); renderGallery(); };
$("gallery").onclick = (e) => {
  const b = e.target.closest("button"); if (!b) return; loadSite(+b.dataset.i);
  const v = $("viewerA").getBoundingClientRect(); if (v.top < 0 || v.bottom > innerHeight) $("viewerA").scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
};
$("prevSite").onclick = () => loadSite(L.idx - 1); $("nextSite").onclick = () => loadSite(L.idx + 1);
$("shuffle").onclick = () => { const n = sites().length; if (n > 1) loadSite((L.idx + 1 + Math.floor(Math.random() * (n - 1))) % n); };
const setVE = (v) => { L.ve = v; $("vex").value = v; each((lab) => lab.setVE(v)); syncAll(); };
$("vex").oninput = (e) => setVE(+e.target.value);
$("trueScale").onclick = () => setVE(1); $("suggested").onclick = () => L.site && setVE(suggestVE(L.site));
const setDS = (v) => { L.ds = v; $("ds").value = v; each((lab) => lab.setDS(v)); remember({ ds: v }); syncAll(); };
$("ds").oninput = (e) => setDS(+e.target.value);
$("dtmSearch").oninput = (e) => { L.query = e.target.value.trim(); renderGallery(); };
const setSun = () => { each((lab) => lab.setSun(+$("sunAz").value, +$("sunAlt").value)); remember({ sunAz: +$("sunAz").value, sunAlt: +$("sunAlt").value }); syncAll(); };
$("sunAz").oninput = setSun; $("sunAlt").oninput = setSun;
play.onclick = () => { const v = !(labs[0] && labs[0].auto); setPlay(v); remember({ play: v }); };
// restore what was remembered, then offer a way back to the defaults
if (saved.ds >= 1 && saved.ds <= 4) { L.ds = saved.ds; $("ds").value = saved.ds; each((lab) => lab.setDS(saved.ds)); }
if (saved.sunAz != null) { $("sunAz").value = saved.sunAz; $("sunAlt").value = saved.sunAlt ?? 30; each((lab) => lab.setSun(+$("sunAz").value, +$("sunAlt").value)); }
setPlay(reduce ? false : saved.play ?? true);
$("resetAll").onclick = () => {
  try { localStorage.removeItem(STORE); } catch (e) { /* nothing stored */ }
  Object.keys(saved).forEach((k) => delete saved[k]);
  $("sunAz").value = 315; $("sunAlt").value = 30; each((lab) => { lab.setSun(315, 30); lab.resetAll(); lab.setLayout(phone() ? "single" : "quad"); });
  L.ds = 2; $("ds").value = 2; each((lab) => lab.setDS(2)); setPlay(!reduce); if (L.site) setVE(suggestVE(L.site)); else syncAll();
};
// share: the system share sheet where it exists (phones), the clipboard elsewhere
$("share").onclick = async () => {
  const e = L.site; if (!e) return; const u = new URL(location.href); u.searchParams.set("dtm", e.slug); u.hash = "";
  const done = (t) => { $("share").textContent = t; setTimeout(() => ($("share").textContent = "Share this terrain"), 2200); };
  try { if (navigator.share) await navigator.share({ title: `${e.name}, LunaREX terrain lab`, url: u.href }); else { await navigator.clipboard.writeText(u.href); done("Link copied"); } }
  catch (err) { if (err && err.name !== "AbortError") done("Copy the address from the browser bar"); }
};
stages.forEach((s) => s.sync());

/* ---------------- 7 references: the list, grouped by topic, and the citations written in the markup */
document.querySelectorAll("sup.cite[data-refs]").forEach((el) => { el.outerHTML = cite(...el.dataset.refs.split(" ")); });
document.querySelectorAll(".refs ol[data-topic]").forEach((ol) => {
  const rows = REFS.filter((r) => r.topic === ol.dataset.topic); ol.start = REF_N.get(rows[0].key);
  ol.innerHTML = rows.map((r) => `<li id="ref-${r.key}">${esc(r.authors)} (${r.year}). ${esc(r.title)}. <i>${esc(r.journal)}</i>${r.volume ? " " + esc(r.volume) : ""}${r.pages ? ", " + esc(r.pages) : ""}. <a href="https://doi.org/${esc(r.doi)}" target="_blank" rel="noopener">doi:${esc(r.doi)}</a></li>`).join("");
});
$("refCount").textContent = `The ${REFS.length}`;
window.__uncited = REFS.filter((r) => !cited.has(r.key)).map((r) => r.key);          // checked by the page tests: every paper must be cited

/* ---------------- 6 links */
const links = [
  ["HiRISE XR", "rayolguinm.github.io/HiRISE_VR", "https://rayolguinm.github.io/HiRISE_VR"],
  ["HiRISE Portfolio", "rayolguinm.github.io/HiRISE_Phone", "https://rayolguinm.github.io/HiRISE_Phone"],
  ["HiRISE DTM Production", "uahirise.org/dtm", "https://www.uahirise.org/dtm/"],
  ["LPL Directory", "lpl.arizona.edu/directory", "https://lpl.arizona.edu/directory/O"],
  ["Architectural Designer Portfolio", "rayolguinm.github.io/Architectural_Designer", "https://rayolguinm.github.io/Architectural_Designer"],
  ["GitHub", "github.com/rayolguinm", "https://github.com/rayolguinm"],
  ["LinkedIn", "linkedin.com/in/rayolguin", "https://www.linkedin.com/in/rayolguin"],
  ["LunaREX on LinkedIn", "linkedin.com/company/lunarex", "https://www.linkedin.com/company/lunarex"],
  ["Linktree", "linktr.ee/rayolguin", "https://linktr.ee/rayolguin"]
];
$("linkgrid").innerHTML = links.map((l) => `<a class="lk" href="${l[2]}" target="_blank" rel="noopener"><b>${l[0]}</b><span>${l[1]}</span></a>`).join("");
