import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'gltf');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(120000);

test('GLTF/GLB export: bracket + sphere + cylinder → web-viewable', async ({ page }) => {
  ensure(ROOT);
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async () => {
    const { manifoldToGLTF, manifoldToGLB, buildModelViewerHTML } = await import('/src/foundation/GLTFExport.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { nurbsSphereSolid, nurbsCylinderSolid } = await import('/src/foundation/NURBSToManifold.js');

    const bracket = await buildPhoneStandBracket();
    const sphere = await nurbsSphereSolid(15, { stepsU: 64, stepsV: 32 });
    const cylinder = await nurbsCylinderSolid(8, 25);

    const enc = (a) => { let b = ''; for (let i = 0; i < a.length; i++) b += String.fromCharCode(a[i]); return btoa(b); };
    return {
      bracket: {
        gltf: manifoldToGLTF(bracket, { name: 'PhoneStandBracket', colorRGBA: [0.36, 0.61, 0.83, 1.0] }),
        glb: enc(manifoldToGLB(bracket, { name: 'PhoneStandBracket', colorRGBA: [0.36, 0.61, 0.83, 1.0] })),
        triCount: bracket.numTri(),
      },
      sphere: {
        gltf: manifoldToGLTF(sphere, { name: 'NURBSSphere_R15', colorRGBA: [0.93, 0.70, 0.20, 1.0], metallic: 0.7, roughness: 0.3 }),
        glb: enc(manifoldToGLB(sphere, { name: 'NURBSSphere_R15', colorRGBA: [0.93, 0.70, 0.20, 1.0], metallic: 0.7, roughness: 0.3 })),
        triCount: sphere.numTri(),
      },
      cylinder: {
        gltf: manifoldToGLTF(cylinder, { name: 'NURBSCylinder_R8_H25', colorRGBA: [0.43, 0.68, 0.28, 1.0] }),
        glb: enc(manifoldToGLB(cylinder, { name: 'NURBSCylinder_R8_H25', colorRGBA: [0.43, 0.68, 0.28, 1.0] })),
        triCount: cylinder.numTri(),
      },
      modelViewerBracket: buildModelViewerHTML('bracket.glb', { title: 'Phone-Stand Bracket' }),
      modelViewerSphere: buildModelViewerHTML('sphere.glb', { title: 'NURBS Sphere R=15' }),
    };
  });

  // Save GLTF JSON
  fs.writeFileSync(path.join(ROOT, 'bracket.gltf'), JSON.stringify(result.bracket.gltf, null, 2));
  fs.writeFileSync(path.join(ROOT, 'sphere.gltf'), JSON.stringify(result.sphere.gltf, null, 2));
  fs.writeFileSync(path.join(ROOT, 'cylinder.gltf'), JSON.stringify(result.cylinder.gltf, null, 2));
  // Save GLB binary
  fs.writeFileSync(path.join(ROOT, 'bracket.glb'), Buffer.from(result.bracket.glb, 'base64'));
  fs.writeFileSync(path.join(ROOT, 'sphere.glb'), Buffer.from(result.sphere.glb, 'base64'));
  fs.writeFileSync(path.join(ROOT, 'cylinder.glb'), Buffer.from(result.cylinder.glb, 'base64'));
  // Save HTML pages
  fs.writeFileSync(path.join(ROOT, 'bracket.html'), result.modelViewerBracket);
  fs.writeFileSync(path.join(ROOT, 'sphere.html'), result.modelViewerSphere);

  console.log(`\n=== GLTF / GLB EXPORT ===`);
  for (const [name, item] of Object.entries({ bracket: result.bracket, sphere: result.sphere, cylinder: result.cylinder })) {
    const gltfBytes = JSON.stringify(item.gltf).length;
    const glbBytes = Math.floor(item.glb.length * 3 / 4);
    console.log(`  ${name.padEnd(8)} ${item.triCount} tris  ·  GLTF ${(gltfBytes/1024).toFixed(0)} KB  ·  GLB ${(glbBytes/1024).toFixed(0)} KB`);
  }

  // GLTF schema sanity checks
  for (const item of [result.bracket, result.sphere, result.cylinder]) {
    expect(item.gltf.asset.version).toBe('2.0');
    expect(item.gltf.scenes.length).toBeGreaterThan(0);
    expect(item.gltf.meshes.length).toBe(1);
    expect(item.gltf.accessors.length).toBe(3);   // POSITION, NORMAL, indices
    expect(item.gltf.bufferViews.length).toBe(3);
    expect(item.gltf.buffers.length).toBe(1);
    expect(item.gltf.materials.length).toBe(1);
    expect(item.gltf.materials[0].pbrMetallicRoughness.baseColorFactor).toBeDefined();
  }

  // GLB header check: magic + version
  const glbBin = Buffer.from(result.bracket.glb, 'base64');
  expect(glbBin.readUInt32LE(0)).toBe(0x46546C67);   // "glTF"
  expect(glbBin.readUInt32LE(4)).toBe(2);            // version 2
  // JSON chunk header
  expect(glbBin.readUInt32LE(16)).toBe(0x4E4F534A);  // "JSON"

  expect(result.bracket.triCount).toBeGreaterThan(0);
  expect(result.sphere.triCount).toBeGreaterThan(1000);
});
