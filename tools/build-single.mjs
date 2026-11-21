// Builds the single-file edition (LunaREX.html): one HTML file with the scripts, styles, fonts, images and
// DTM tiles embedded, so it runs by double-click with no server and no network.
// Usage, from the repository root:   npm install esbuild sharp   then   node tools/build-single.mjs [output.html] [--ortho 768]
//   --ortho <px>   resample the 60 terrain lab orthoimages to <px> on a side before embedding (needs sharp).
//                  768 keeps the file near 16 MB; without the flag the full 1024 px images are embedded (22 MB).
// The hosted site needs no build; this script only repackages it.
// Author: Raymundo "R@y" Olguin, LunaREX.
import { build } from "esbuild";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2), flag = args.indexOf("--ortho"), orthoPx = flag >= 0 ? +args.splice(flag, 2)[1] : 0;
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), out = resolve(args[0] || join(root, "..", "LunaREX.html"));
const MIME = { ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
const dataUri = (rel) => `data:${MIME[extname(rel)]};base64,${readFileSync(join(root, rel)).toString("base64")}`;
const walk = (dir) => readdirSync(join(root, dir)).flatMap((f) => { const p = `${dir}/${f}`; return statSync(join(root, p)).isDirectory() ? walk(p) : [p]; });

// 1. scripts: one classic script, so it also runs from file://
const js = (await build({ entryPoints: [join(root, "assets/js/main.js")], bundle: true, format: "iife", minify: true, write: false, legalComments: "eof", target: "es2020" })).outputFiles[0].text;

// 2. every file the scripts request through A(): DTM tiles, catalog, thumbnails, globe textures
const assets = Object.fromEntries([...walk("assets/data"), ...walk("assets/img").filter((p) => p.includes("globe_"))].map((p) => [p, dataUri(p)]));
if (orthoPx) {
  const sharp = (await import("sharp")).default, isOrtho = (p) => /^assets\/data\/lab\/\w+\/[^/]+\.jpg$/.test(p) && !p.endsWith("_t.jpg");
  for (const p of Object.keys(assets).filter(isOrtho))
    assets[p] = "data:image/jpeg;base64," + (await sharp(join(root, p)).resize(orthoPx, orthoPx, { kernel: "lanczos3" }).jpeg({ quality: 84, mozjpeg: true }).toBuffer()).toString("base64");
}

// 3. styles with the fonts embedded
const css = readFileSync(join(root, "assets/css/site.css"), "utf8").replace(/url\(\.\.\/fonts\/([^)]+)\)/g, (_, f) => `url(${dataUri("assets/fonts/" + f)})`);

// 4. page: inline what the markup itself references
let html = readFileSync(join(root, "index.html"), "utf8")
  .replace(/<link rel="preload"[^>]*>\n?/, "")
  .replace(/<link rel="manifest"[^>]*>\n?/, "")                                  // a single file cannot carry a home-screen manifest
  .replace('<link rel="stylesheet" href="assets/css/site.css">', () => `<style>${css}</style>`)
  .replace(/(href|src)="(assets\/img\/[^"]+)"/g, (_, a, p) => `${a}="${dataUri(p)}"`)
  .replace(/url\((assets\/data\/[^)]+)\)/g, (_, p) => `url(${assets[p]})`)
  .replace('<script type="module" src="assets/js/main.js"></script>', () => `<script>window.__ASSETS=${JSON.stringify(assets)};</script>\n<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`);
if (/(src|href)="assets\//.test(html)) throw new Error("a local reference was left un-embedded");
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1048576).toFixed(1)} MB, ${Object.keys(assets).length} embedded data files`);
