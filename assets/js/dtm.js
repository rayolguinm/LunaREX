// LunaREX DTM core: one place for every number the 3D views depend on.
//   decode      16-bit terrain-RGB height tiles to metres (no-data becomes NaN)
//   register    where each post sits inside its window, in metres and in orthoimage UV
//   mesh        true-scale triangulated grid at a chosen downsampling factor, no-data posts left out
//   slope       Horn (1981) 3 x 3 finite differences, in degrees, at the displayed post spacing
//   sample      bilinear height lookup for camera paths
//   shadow      cast shadows for a given Sun (horizon test), used by the thermal model
//   thermal     direct-beam radiative equilibrium temperature
//   colour      perceptually even ramps (equal OKLab steps) shared by shaders, legends and figures
// Author: Raymundo "R@y" Olguin, LunaREX.
import { A } from "./assets.js";

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ decoding */
// elevation_m = (256 R + G) * zScale above the window minimum; 65535 marks no data.
// createImageBitmap with colour management off keeps the 8-bit channels exactly as stored.
export async function decodeHeights(path, N, zScale, nodata = 65535) {
  const blob = await fetch(A(path)).then((r) => { if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`); return r.blob(); });
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  if (bmp.width !== N || bmp.height !== N) throw new Error(`${path}: expected ${N} x ${N} posts, found ${bmp.width} x ${bmp.height}`);
  const cv = document.createElement("canvas"); cv.width = cv.height = N;
  const cx = cv.getContext("2d", { willReadFrequently: true }); cx.drawImage(bmp, 0, 0); bmp.close && bmp.close();
  const px = cx.getImageData(0, 0, N, N).data, Z = new Float32Array(N * N);
  for (let i = 0; i < Z.length; i++) { const v = px[i * 4] * 256 + px[i * 4 + 1]; Z[i] = v === nodata ? NaN : v * zScale; }
  return Z;
}

/* ------------------------------------------------------------------ registration */
// Two tile layouts exist in the dataset, and they place posts differently inside the window of side S:
//   "edge"  (hero and flight tiles, 256 posts): posts sit on a lattice that includes both window edges,
//           post k at k * S / (N - 1).
//   "block" (terrain lab tiles, 128 posts): each post is the mean of a 2 x 2 block of the edge lattice,
//           so post k sits at (k + 1/4) * S / (N - 1/2) and the spacing is S / (N - 1/2).
//           (Checked against the 256-post tiles of the same windows: residual 0.004 m RMS.)
export function registration(N, S, layout = "edge") {
  const post = layout === "block" ? S / (N - 0.5) : S / (N - 1), first = layout === "block" ? 0.25 * post : 0;
  return { N, S, post, first, x: (k) => first + k * post - S / 2, u: (k) => (first + k * post) / S };
}

/* ------------------------------------------------------------------ statistics */
export function stats(Z) {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (let i = 0; i < Z.length; i++) { const z = Z[i]; if (z === z) { n++; if (z < lo) lo = z; if (z > hi) hi = z; } }
  return n ? { lo, hi, relief: hi - lo, valid: n / Z.length } : { lo: 0, hi: 0, relief: 0, valid: 0 };
}
export const median = (a) => { const v = Float32Array.from(a).filter((x) => x === x).sort(); return v.length ? (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2 : NaN; };
// 1-2-5 contour interval that gives about `target` lines across the relief
export function niceStep(relief, target = 12) {
  const raw = Math.max(relief, 1e-6) / target, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/* ------------------------------------------------------------------ slope */
// Horn (1981) third-order finite difference on the displayed lattice (spacing d = post * ds).
// Where a 3 x 3 neighbour is missing, the estimate falls back to central or one-sided differences.
export function slopeDeg(Z, N, d, ds = 1) {
  const n = Math.floor((N - 1) / ds) + 1, out = new Float32Array(n * n);
  const z = (i, j) => (i < 0 || j < 0 || i >= n || j >= n) ? NaN : Z[j * ds * N + i * ds];
  const diff = (a, c, b) => (a === a && b === b) ? (b - a) / (2 * d) : (c === c && b === b) ? (b - c) / d : (a === a && c === c) ? (c - a) / d : NaN;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const c = z(i, j); if (c !== c) { out[j * n + i] = NaN; continue; }
    const a = z(i - 1, j - 1), b = z(i, j - 1), cc = z(i + 1, j - 1), dd = z(i - 1, j), f = z(i + 1, j), g = z(i - 1, j + 1), h = z(i, j + 1), k = z(i + 1, j + 1);
    let gx, gy;
    if (a === a && b === b && cc === cc && dd === dd && f === f && g === g && h === h && k === k) {
      gx = ((cc + 2 * f + k) - (a + 2 * dd + g)) / (8 * d); gy = ((g + 2 * h + k) - (a + 2 * b + cc)) / (8 * d);
    } else { gx = diff(dd, c, f); gy = diff(b, c, h); }
    out[j * n + i] = (gx === gx && gy === gy) ? Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI : NaN;
  }
  return out;
}

/* ------------------------------------------------------------------ mesh */
// Vertices sit exactly on their posts; UVs follow the same registration, so the orthoimage stays in place
// at every downsampling factor. `unit` converts metres to scene units, `ve` is the vertical exaggeration.
// Returns typed arrays only, so the function has no dependency on the renderer.
export function gridMesh({ Z, reg, ds = 1, ve = 1, unit = 1, zRef = 0 }) {
  const N = reg.N, n = Math.floor((N - 1) / ds) + 1;
  const position = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), cell = new Float32Array(n * n * 2), height = new Float32Array(n * n), ok = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, z = Z[j * ds * N + i * ds]; ok[k] = z === z ? 1 : 0; height[k] = ok[k] ? z : 0;
    position[k * 3] = reg.x(i * ds) * unit; position[k * 3 + 1] = ok[k] ? (z - zRef) * ve * unit : 0; position[k * 3 + 2] = reg.x(j * ds) * unit;
    uv[k * 2] = reg.u(i * ds); uv[k * 2 + 1] = 1 - reg.u(j * ds);
    cell[k * 2] = i; cell[k * 2 + 1] = j;                      // lattice coordinates, for drawing the true triangle edges
  }
  const quads = (n - 1) * (n - 1), index = n * n > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    if (ok[a] && ok[b] && ok[c] && ok[d]) { index[t++] = a; index[t++] = c; index[t++] = d; index[t++] = a; index[t++] = d; index[t++] = b; }   // diagonal a to d
  }
  return { position, uv, cell, height, index: index.subarray(0, t), n, triangles: t / 3, spacing: reg.post * ds };
}

/* ------------------------------------------------------------------ sampling */
// Bilinear height at window coordinates (x east, z south, origin at the window centre), metres.
export function sampler(Z, reg) {
  const N = reg.N, at = (r, c) => { const z = Z[r * N + c]; return z === z ? z : 0; };
  return (x, z) => {
    const c = clamp((x + reg.S / 2 - reg.first) / reg.post, 0, N - 1), r = clamp((z + reg.S / 2 - reg.first) / reg.post, 0, N - 1);
    const c0 = Math.min(N - 2, Math.floor(c)), r0 = Math.min(N - 2, Math.floor(r)), fc = c - c0, fr = r - r0;
    return (at(r0, c0) * (1 - fc) + at(r0, c0 + 1) * fc) * (1 - fr) + (at(r0 + 1, c0) * (1 - fc) + at(r0 + 1, c0 + 1) * fc) * fr;
  };
}

/* ------------------------------------------------------------------ colour */
// Ramps are resampled so that equal data steps are equal steps in OKLab (Ottosson, 2020),
// which keeps the lightness of a tint proportional to the value it encodes.
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h) => [1, 3, 5].map((i) => toLin(parseInt(h.slice(i, i + 2), 16) / 255));
const oklab = ([r, g, b]) => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const unlab = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
export function makeRamp(stops, size = 256) {
  const lab = stops.map((h) => oklab(hex(h))), cum = [0];
  for (let i = 1; i < lab.length; i++) cum.push(cum[i - 1] + Math.hypot(...lab[i].map((v, k) => v - lab[i - 1][k])));
  const out = new Uint8Array(size * 4);
  for (let p = 0; p < size; p++) {
    const s = (p / (size - 1)) * cum[cum.length - 1]; let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), rgb = unlab(lab[i - 1].map((v, k) => lerp(v, lab[i][k], t)));
    for (let k = 0; k < 3; k++) out[p * 4 + k] = Math.round(clamp(toSrgb(clamp(rgb[k]))) * 255);
    out[p * 4 + 3] = 255;
  }
  return out;
}
// LunaREX altimetry: the hue order of the HiRISE colour altimetry products (violet and blue for low ground, then
// green, yellow, orange and red, white for the highest), rebuilt in OKLCH so that lightness rises steadily
// from low to high and chroma stays moderate. A classic rainbow reverses lightness between yellow and red, which
// makes mid elevations look like ridges; here a grayscale copy of the map still reads low to high.
const lchToRgb = (L, C, hDeg) => { const h = hDeg * Math.PI / 180; return unlab([L, C * Math.cos(h), C * Math.sin(h)]); };
export function makeAltimetry(size = 256) {
  const out = new Uint8Array(size * 4);
  for (let p = 0; p < size; p++) {
    // colour runs over the first 88 % of the range (lightness 0.32 to 0.76, hue 300 deg violet to 28 deg red);
    // the last 12 % lifts the red to white, as the highest ground does in the HiRISE products
    const t = p / (size - 1), u = Math.min(1, t / 0.88), w = Math.max(0, (t - 0.88) / 0.12);
    const L = 0.32 + 0.44 * u + 0.21 * w, h = 300 - 272 * u;
    let C = 0.16 * (0.72 + 0.28 * Math.sin(Math.PI * u)) * (1 - w) ** 1.4, rgb = lchToRgb(L, C, h);
    while (C > 0 && rgb.some((v) => v < 0 || v > 1)) { C -= 0.004; rgb = lchToRgb(L, Math.max(C, 0), h); }   // stay inside sRGB by giving up chroma, never lightness
    for (let k = 0; k < 3; k++) out[p * 4 + k] = Math.round(clamp(toSrgb(clamp(rgb[k]))) * 255);
    out[p * 4 + 3] = 255;
  }
  return out;
}
export const ELEVATION = makeAltimetry();
// Slope: a deep navy into the NASA HDS Core blues (Blue Shade, NASA Blue, Blue Tint, Spacesuit White): one hue, so it is never read as height
export const SLOPE = makeRamp(["#0a1e47", "#0b3d91", "#1c67e3", "#288bff", "#ffffff"]);
// Thermal: Carbon 90, Red Shade, International Orange, Spacesuit White
export const THERMAL = makeRamp(["#17171b", "#b60109", "#ea6f24", "#ffffff"]);
export const SLOPE_MAX_DEG = 45;
export const rampAt = (lut, t) => { const p = Math.round(clamp(t) * (lut.length / 4 - 1)) * 4; return [lut[p], lut[p + 1], lut[p + 2]]; };
export const rampCss = (lut, n = 12) => `linear-gradient(90deg,${Array.from({ length: n }, (_, i) => `rgb(${rampAt(lut, i / (n - 1)).join(",")})`).join(",")})`;

/* ------------------------------------------------------------------ cast shadows */
// Direct-beam visibility of the Sun from every displayed post (1 lit, 0 shadowed). A ray leaves the post toward the
// Sun and is tested against the terrain at one-post steps, with bilinear heights from the full-resolution grid:
// the post is shadowed when the ground rises above the ray (the horizon method used for lunar illumination maps,
// Mazarico et al., 2011). Heights and distances are true scale, in metres. The Sun is a point source at infinity,
// so there is no penumbra, and terrain outside the window cannot cast a shadow into it.
// azimuth is clockwise from the top of the image, altitude is above the horizon, both in degrees.
export function castShadow(Z, reg, ds, azimuthDeg, altitudeDeg) {
  const N = reg.N, n = Math.floor((N - 1) / ds) + 1, lit = new Float32Array(n * n), az = azimuthDeg * Math.PI / 180;
  const dc = Math.sin(az), dr = -Math.cos(az), rise = Math.tan(altitudeDeg * Math.PI / 180) * reg.post, top = stats(Z).hi;   // step toward the Sun, in posts
  const at = (r, c) => { const r0 = Math.min(N - 2, Math.floor(r)), c0 = Math.min(N - 2, Math.floor(c)), fr = r - r0, fc = c - c0;
    const a = Z[r0 * N + c0], b = Z[r0 * N + c0 + 1], e = Z[(r0 + 1) * N + c0], f = Z[(r0 + 1) * N + c0 + 1];
    return (a === a && b === b && e === e && f === f) ? (a * (1 - fc) + b * fc) * (1 - fr) + (e * (1 - fc) + f * fc) * fr : NaN; };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const z0 = Z[j * ds * N + i * ds]; let v = 1;
    if (z0 === z0) for (let s = 1; ; s++) {
      const r = j * ds + dr * s, c = i * ds + dc * s, ray = z0 + rise * s;
      if (r < 0 || c < 0 || r > N - 1 || c > N - 1 || ray > top) break;          // left the window, or above the highest ground
      const g = at(r, c); if (g === g && g > ray + 1e-3) { v = 0; break; }
    }
    lit[j * n + i] = v;
  }
  return lit;
}

/* ------------------------------------------------------------------ thermal model */
// Direct-beam radiative equilibrium of a sunlit facet: (1 - A) S cos(i) = eps sigma T^4, with S the solar constant
// scaled to the body's distance and i the incidence angle on the true-scale facet (the slope term of Aharonson and
// Schorghofer, 2006, without their subsurface conduction). It is the zero-thermal-inertia limit: real surfaces store
// heat, lag the Sun and peak lower (Kieffer, 2013), so the result is a ceiling on daytime temperature, not a measurement.
// Facets in cast shadow (castShadow above) or turned from the Sun receive no direct beam and are drawn as "no direct sunlight".
// Not modeled: thermal inertia, the atmosphere, light and heat re-radiated by neighbouring terrain, sub-pixel roughness.
// S: IAU 2015 nominal total solar irradiance (Prsa et al., 2016), consistent with 1360.8 +/- 0.5 W m^-2 measured by Kopp and Lean (2011).
export const SOLAR_CONSTANT = 1361, STEFAN_BOLTZMANN = 5.670374419e-8;        // W m^-2 at 1 AU; W m^-2 K^-4 (CODATA 2018, exact)
export const subsolarK = ({ au, bond_albedo, emissivity }) => ((1 - bond_albedo) * SOLAR_CONSTANT / au ** 2 / (emissivity * STEFAN_BOLTZMANN)) ** 0.25;
export const THERMAL_FLOOR = 0.5;                                              // the ramp spans 0.5 Tmax .. Tmax
