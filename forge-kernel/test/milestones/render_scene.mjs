// render_scene.mjs — render a multi-part scene (meshes + curve overlays) to
// 4-angle PNGs in milestones/. Scene JSON:
//   { meshes:[{positions,indices,color,opacity?,metalness?}], lines:[{points,color,radius?}] }
//   node render_scene.mjs <scene.json> <label>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scene = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const label = process.argv[3] || 'scene';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(pathToFileURL(path.join(__dirname, '_render.html')).href);
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

for (const m of scene.meshes || []) {
  await page.evaluate(([p, i, c, o, met]) => window.__loadMesh(p, i, c, { opacity: o, metalness: met }),
    [m.positions, m.indices || [], m.color ?? 0x9fb4cc, m.opacity ?? 1, m.metalness ?? 0.35]);
}
for (const l of scene.lines || []) {
  await page.evaluate(([p, c, r]) => window.__loadLine(p, c, r),
    [l.points, l.color ?? 0xff5a3c, l.radius ?? 0.05]);
}
console.log(`[scene] ${label}: ${(scene.meshes||[]).length} meshes + ${(scene.lines||[]).length} curves`);
for (const angle of ['iso', 'front', 'top', 'right']) {
  const url = await page.evaluate((a) => window.__shoot(a), angle);
  const out = path.join(__dirname, `${label}_${angle}.png`);
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  → ${out}`);
}
await browser.close();
console.log(`[scene] ${label} done (4 angles)`);
