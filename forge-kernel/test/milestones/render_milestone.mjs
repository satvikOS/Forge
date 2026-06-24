// render_milestone.mjs — render a kernel-produced mesh to multi-angle PNGs in
// the milestones/ folder. Reusable per kernel-geometry milestone overnight.
//   node render_milestone.mjs <mesh.json> <label> [colorHex]
// mesh.json = { positions:[x,y,z,...], indices:[i,j,k,...] }
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const meshFile = process.argv[2];
const label = process.argv[3] || 'milestone';
const color = process.argv[4] ? parseInt(process.argv[4], 16) : 0x9fb4cc;
const mesh = JSON.parse(fs.readFileSync(meshFile, 'utf8'));

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(pathToFileURL(path.join(__dirname, '_render.html')).href);
await page.waitForFunction('window.__ready === true', { timeout: 30000 });

const info = await page.evaluate(([p, i, c]) => window.__loadMesh(p, i, c),
  [mesh.positions, mesh.indices || [], color]);
console.log(`[render] ${label}: ${info.verts} verts / ${info.tris} tris, r=${info.radius.toFixed(2)}`);

for (const angle of ['iso', 'front', 'top', 'right']) {
  const url = await page.evaluate((a) => window.__shoot(a), angle);
  const out = path.join(__dirname, `${label}_${angle}.png`);
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log(`  → ${out}`);
}
await browser.close();
console.log(`[render] ${label} done (4 angles in test/milestones/)`);
