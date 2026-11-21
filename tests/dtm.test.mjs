// Numeric checks for assets/js/dtm.js. Run from the repository root:  node tests/dtm.test.mjs
// Author: Raymundo "R@y" Olguin, LunaREX.
import assert from "node:assert/strict";
import { registration, gridMesh, slopeDeg, sampler, stats, niceStep, median, makeRamp, ELEVATION, SLOPE, THERMAL, castShadow, subsolarK } from "../assets/js/dtm.js";

let n = 0; const check = (name, fn) => { fn(); n++; console.log("ok  " + name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} expected ${b}, got ${a}`);

check("edge layout: posts span the whole window", () => {
  const r = registration(256, 3471.66, "edge");
  near(r.post, 3471.66 / 255, 1e-9); near(r.x(0), -1735.83, 1e-9); near(r.x(255), 1735.83, 1e-9); near(r.u(0), 0, 1e-12); near(r.u(255), 1, 1e-12);
});
check("block layout: post k is the centre of a 2 x 2 block of the edge lattice", () => {
  const S = 3828.907, e = registration(256, S, "edge"), b = registration(128, S, "block");
  for (const k of [0, 1, 63, 127]) near(b.x(k), (e.x(2 * k) + e.x(2 * k + 1)) / 2, 1e-9, `post ${k}`);
  near(b.post, 2 * e.post, 1e-12);
});
check("mesh keeps exact positions and UVs at every downsampling factor", () => {
  const N = 128, S = 10000, reg = registration(N, S, "block"), Z = new Float32Array(N * N).fill(5);
  for (const ds of [1, 2, 3, 4]) {
    const m = gridMesh({ Z, reg, ds }), last = (m.n - 1) * ds;
    near(m.position[0], reg.x(0), 1e-3); near(m.position[(m.n - 1) * 3], reg.x(last), 1e-3, `ds ${ds} last x`);
    near(m.uv[(m.n - 1) * 2], reg.u(last), 1e-6); near(m.spacing, reg.post * ds, 1e-9);
    near(m.position[3] - m.position[0], reg.post * ds, 1e-3, `ds ${ds} spacing`);
    assert.equal(m.triangles, 2 * (m.n - 1) ** 2);
  }
});
check("no-data posts are left out of the mesh", () => {
  const N = 8, Z = new Float32Array(N * N).fill(1); Z[3 * N + 3] = NaN;
  const m = gridMesh({ Z, reg: registration(N, 70, "edge") });
  assert.equal(m.triangles, 2 * 49 - 2 * 4);                        // the four cells that touch the post lose both triangles
  assert.ok(![...m.index].includes(3 * N + 3));
});
check("slope of an inclined plane is exact, in both axes and on the diagonal", () => {
  const N = 32, d = 25;
  for (const [gx, gy] of [[0.1, 0], [0, 0.25], [0.3, 0.4], [1, 0]]) {
    const Z = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Z[j * N + i] = 100 + gx * i * d + gy * j * d;
    const want = Math.atan(Math.hypot(gx, gy)) * 180 / Math.PI;
    for (const ds of [1, 2]) { const s = slopeDeg(Z, N, d * ds, ds); for (const v of s) near(v, want, 2e-3, `plane ${gx},${gy} ds ${ds}`); }
  }
});
check("slope stays finite beside no-data and is NaN on it", () => {
  const N = 16, Z = new Float32Array(N * N); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Z[j * N + i] = 2 * i;
  Z[5 * N + 5] = NaN; const s = slopeDeg(Z, N, 1);
  assert.ok(Number.isNaN(s[5 * N + 5])); near(s[5 * N + 4], Math.atan(2) * 180 / Math.PI, 1e-3); near(s[6 * N + 6], Math.atan(2) * 180 / Math.PI, 1e-3);
});
check("bilinear sampler reproduces a plane between posts and clamps at the edge", () => {
  const N = 16, S = 150, reg = registration(N, S, "edge"), Z = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) Z[j * N + i] = 3 * reg.x(i) - 2 * reg.x(j) + 7;
  const h = sampler(Z, reg); near(h(12.3, -40.1), 3 * 12.3 + 2 * 40.1 + 7, 1e-3); near(h(0, 0), 7, 1e-3); near(h(1e6, 0), 3 * 75 + 7, 1e-3);
});
check("statistics ignore no-data", () => {
  const s = stats(Float32Array.from([NaN, 2, 10, 4])); assert.deepEqual([s.lo, s.hi, s.relief, s.valid], [2, 10, 8, 0.75]);
  near(median(Float32Array.from([5, NaN, 1, 3])), 3, 1e-9); near(median(Float32Array.from([4, 1, 3, 2])), 2.5, 1e-9);
});
check("contour interval is a 1-2-5 number", () => {
  assert.deepEqual([697.5, 951.3, 912.7, 92.9, 12, 2698].map((r) => niceStep(r)), [50, 100, 100, 10, 1, 200]);
});
check("ramps rise monotonically in lightness, in near-equal perceptual steps", () => {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = (lut, p) => { const [r, g, b] = [0, 1, 2].map((k) => lin(lut[p * 4 + k] / 255));
    return 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) + 0.793617785 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b); };
  for (const [name, lut] of [["altimetry", ELEVATION], ["slope", SLOPE], ["thermal", THERMAL]]) {
    for (let p = 8; p < 256; p += 8) assert.ok(L(lut, p) > L(lut, p - 8), `${name} lightness dips at ${p}`);
  }
  const two = makeRamp(["#000000", "#ffffff"]); for (let p = 16; p < 256; p += 16) near(L(two, p) - L(two, p - 16), 16 / 255, 0.01, "grey ramp step");
});
check("altimetry keeps the HiRISE hue order: blue low, green middle, red high, near white at the top", () => {
  const at = (t) => { const p = Math.round(t * 255) * 4; return [ELEVATION[p], ELEVATION[p + 1], ELEVATION[p + 2]]; };
  const lo = at(0.12), mid = at(0.5), hi = at(0.88), top = at(1);
  assert.ok(lo[2] > lo[0] && lo[2] > lo[1], "low is blue"); assert.ok(mid[1] > mid[0] && mid[1] > mid[2], "middle is green");
  assert.ok(hi[0] > hi[1] && hi[0] > hi[2], "high is red"); assert.ok(Math.min(...top) > 225, "top is near white");
});
check("cast shadow of a wall has the length height / tan(altitude)", () => {
  const N = 64, reg = registration(N, 630, "edge"), Z = new Float32Array(N * N), wall = 20, H = 50;        // 10 m posts, a 50 m wall along column 20
  for (let j = 0; j < N; j++) Z[j * N + wall] = H;
  for (const alt of [15, 30, 45]) {                                                                       // Sun in the west (azimuth 270): the shadow falls east
    const lit = castShadow(Z, reg, 1, 270, alt), row = 32, len = H / Math.tan(alt * Math.PI / 180) / reg.post;
    let n = 0; for (let i = wall + 1; i < N; i++) if (!lit[row * N + i]) n++;
    near(n, Math.min(len, N - 1 - wall), 1.01, `altitude ${alt}`);
    assert.equal(lit[row * N + wall - 3], 1, "ground on the sunward side is lit"); assert.equal(lit[row * N + wall], 1, "the wall top is lit");
  }
  const east = castShadow(Z, reg, 1, 90, 30); assert.equal(east[32 * N + wall + 3], 1); assert.equal(east[32 * N + wall - 3], 0);   // Sun in the east: shadow falls west
  const north = castShadow(Z, reg, 1, 0, 30); assert.ok(north.every((v) => v === 1), "a Sun along the wall casts no shadow on flat ground");
});
check("thermal model: subsolar equilibrium temperatures", () => {
  near(subsolarK({ au: 1, bond_albedo: 0.12, emissivity: 0.95 }), 386.2, 0.5, "Moon");
  near(subsolarK({ au: 1.524, bond_albedo: 0.25, emissivity: 0.95 }), 300.6, 0.5, "Mars");
  near(subsolarK({ au: 5.203, bond_albedo: 0.62, emissivity: 0.90 }), 139.3, 0.7, "Europa");
  near(subsolarK({ au: 1, bond_albedo: 0, emissivity: 1 }), (1361 / 5.670374419e-8) ** 0.25, 1e-9);
});
console.log(`\n${n} checks passed`);
