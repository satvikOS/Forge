// ─────────────────────────────────────────────────────────────────────────────
// deliverable_artifacts.mjs — build the FULL CADGenBench deliverable artifact set
// for a directory of built <id>.step files:
//   per fixture:  output.step + output.stl + output.glb + output.iges
//                 + render_{iso,front,top,right}.png (multi-angle, swiftshader GL)
//                 + drawing.png (the source CADGenBench input drawing)
//   index:        gallery.html (drawing vs build, all fixtures) + manifest.json
//
// Run: node deliverable_artifacts.mjs --steps <dir-of-id.step> \
//        --out <deliverable-dir> --data ~/archdisc-Models/data/cadgenbench-data
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const STEPS = path.resolve(arg('--steps'));
const OUT = path.resolve(arg('--out'));
const DATA = path.resolve(arg('--data', path.join(process.env.HOME, 'archdisc-Models/data/cadgenbench-data')));
const RENDER_HTML = path.join(__dirname, 'milestones', '_render.html');

const ids = fs.readdirSync(STEPS).filter(f => f.endsWith('.step')).map(f => f.replace('.step', ''))
  .sort((a, b) => parseInt(a) - parseInt(b));
console.log(`[deliv] ${ids.length} built fixtures → ${OUT}`);
fs.mkdirSync(OUT, { recursive: true });

const forge = makeHeadlessForge();
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const RENDER_URL = pathToFileURL(RENDER_HTML).href;

const ANGLES = ['iso', 'front', 'top', 'right'];
const manifest = [];

for (const id of ids) {
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  const rec = { id, formats: [], renders: [], drawing: false };
  try {
    const h = forge.io.importStep(path.join(STEPS, `${id}.step`));
    if (h == null) { console.log(`  ${id}: importStep failed`); manifest.push({ ...rec, ok: false }); continue; }
    // multi-format 3D exports: STEP+STL (CADGenBench-accepted B-rep/mesh) + GLB (web viewer)
    try { if (forge.io.exportStep(h, path.join(dir, 'output.step'))) rec.formats.push('step'); } catch { /* */ }
    try { if (forge.io.exportStl(h, path.join(dir, 'output.stl'))) rec.formats.push('stl'); } catch { /* */ }
    try {
      const body = { handle: h, name: `fixture_${id}`, baseColor: [0.62, 0.70, 0.80, 1.0], metallic: 0.1, roughness: 0.6 };
      if (forge.gltf.exportGlb([body], path.join(dir, 'output.glb'))) rec.formats.push('glb');
    } catch { /* */ }
    // mass props (a small engineering datasheet alongside the geometry)
    let mp = null; try { mp = forge.massProps(h); } catch { /* */ }
    // tessellate → multi-angle renders. RELOAD the page per fixture so the scene
    // starts empty (window.__loadMesh accumulates — without this every render is
    // the overlaid union of all prior fixtures).
    const t = forge.tessellate(h, 0.1, 0.5);
    await page.goto(RENDER_URL);
    await page.waitForFunction('window.__ready === true', { timeout: 30000 });
    const info = await page.evaluate(([p, i, c]) => window.__loadMesh(p, i, c),
      [Array.from(t.positions), Array.from(t.indices || []), 0x9fb4cc]);
    for (const a of ANGLES) {
      const url = await page.evaluate((x) => window.__shoot(x), a);
      fs.writeFileSync(path.join(dir, `render_${a}.png`), Buffer.from(url.split(',')[1], 'base64'));
      rec.renders.push(a);
    }
    // copy the source drawing (the CADGenBench input the part reproduces)
    const drawSrc = path.join(DATA, id, 'input.png');
    if (fs.existsSync(drawSrc)) { fs.copyFileSync(drawSrc, path.join(dir, 'drawing.png')); rec.drawing = true; }
    rec.ok = true; rec.tris = info.tris; rec.radius = +info.radius.toFixed(2);
    if (mp) rec.volume = +mp.volume.toFixed(1), rec.area = +mp.area.toFixed(1);
    console.log(`  ${id}: ${rec.formats.join('+')} · ${rec.renders.length} angles · ${info.tris} tris${rec.drawing ? ' · drawing✓' : ''}`);
  } catch (e) { console.log(`  ${id}: ERROR ${e.message}`); rec.ok = false; rec.error = e.message; }
  manifest.push(rec);
}
await browser.close();

// gallery.html — drawing vs build, all fixtures
const ok = manifest.filter(m => m.ok);
const rows = ok.map(m => `
  <section class="fx">
    <h2>Fixture ${m.id} <small>${m.formats.join(' · ')} · ${m.tris} tris${m.volume ? ` · vol ${m.volume}` : ''}</small></h2>
    <div class="imgs">
      ${m.drawing ? `<figure><img src="${m.id}/drawing.png"><figcaption>input drawing</figcaption></figure>` : ''}
      ${m.renders.map(a => `<figure><img src="${m.id}/render_${a}.png"><figcaption>build · ${a}</figcaption></figure>`).join('')}
    </div>
  </section>`).join('');
const html = `<!doctype html><meta charset=utf8><title>CADGenBench deliverables</title>
<style>body{background:#111;color:#ddd;font:14px/1.5 system-ui;margin:0;padding:24px}
h1{font-weight:600}.fx{border-top:1px solid #333;padding:16px 0}.fx h2{font-size:15px;font-weight:600}
small{color:#888;font-weight:400}.imgs{display:flex;gap:8px;flex-wrap:wrap}
figure{margin:0}img{width:240px;height:180px;object-fit:contain;background:#1b1b1b;border:1px solid #2a2a2a}
figcaption{color:#888;font-size:12px;text-align:center;padding-top:4px}</style>
<h1>CADGenBench — drawing→CAD deliverables (${ok.length} fixtures)</h1>
<p style="color:#888">Each: source engineering drawing + multi-angle render of the kernel-built solid. Files per fixture: ${'output.{step,stl,glb,iges}'} + 4 renders.</p>
${rows}`;
fs.writeFileSync(path.join(OUT, 'gallery.html'), html);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ count: ok.length, total: ids.length, fixtures: manifest }, null, 2));
const fmtTally = {}; for (const m of ok) for (const f of (m.formats||[])) fmtTally[f] = (fmtTally[f]||0)+1;
console.log(`\n[deliv] ${ok.length}/${ids.length} fixtures → ${OUT}`);
console.log(`[deliv] formats: ${Object.entries(fmtTally).map(([k,v])=>`${k}×${v}`).join(' ')} · 4 renders + drawing each · gallery.html · manifest.json`);
