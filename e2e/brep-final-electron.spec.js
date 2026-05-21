/**
 * brep-final-electron.spec.js
 *
 * Sub-project F gate — real-artifact e2e tests for the 4 REACHABLE final §3
 * capabilities shipped in BrepFinal.js. All geometry is created by clicking
 * real ribbon tools + injecting plan params via the Playwright bypass path.
 * No kernel build APIs are called in spec bodies — only read-only taps
 * (measure, window.__lastBrepShape) for assertions.
 *
 * ── PATTERN: matches brep-g-catmullclark-electron.spec.js ──────────────────
 * Records the whole workflow as a .webm video with key-frame stills at each
 * beat. REAL drag-orbits show the operation in motion.
 *
 * ONE consolidated test — all 4 ops in a single session:
 *   A — Sweep Tortuous:  S-bend pipe section
 *   B — Loft Tangent:    smoothed tapered tower
 *   C — Stitch Faces:    stitched panel assembly
 *   D — Convergent Solid: facet-derived solid cube
 *
 * All 4 tools are arity-0 (no body pre-selection needed).
 * dragOrbit shows each result in 3D before moving on.
 *
 * Artifacts land in:  test-results/motion/brep-final/
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import { captureAllAngles } from './helpers/orbitCapture.js';
import {
  clickRibbonTab, clickRibbonTool, injectToolParams,
} from './helpers/uiWorkflow.js';
import {
  launchWithCapture, dragOrbit,
} from './helpers/motionCapture.js';

test.setTimeout(600000);

const SWEEP_OPTS = {
  azimuths: [0, 60, 120, 180, 240, 300],
  elevations: [-30, 30],
  zooms: [0.6, 1.0, 1.8],
};

// ─── Helper ───────────────────────────────────────────────────────────────────

async function snapBrepId(win) {
  return win.evaluate(() =>
    (window.__lastBrepShape && window.__lastBrepShape.id) || null,
  );
}

/**
 * Run an arity-0 surface tool by injecting params and clicking the ribbon.
 * Returns the registry ID of the new body.
 */
async function runSurfaceTool(win, toolName, params) {
  params = params || {};
  const before = await snapBrepId(win);
  const regCountBefore = await win.evaluate(
    () => (window.__archdiscRegistry && window.__archdiscRegistry.bodies
      ? window.__archdiscRegistry.bodies.length : 0),
  );
  await injectToolParams(win, toolName, params);
  await clickRibbonTab(win, 'Part');
  await win.waitForTimeout(120);
  await clickRibbonTool(win, toolName);
  await win.waitForFunction(
    (b) => !!window.__lastBrepShape && window.__lastBrepShape.id !== b,
    before,
    { timeout: 300000 },
  );
  return win.evaluate((countBefore) => {
    const reg = window.__archdiscRegistry;
    if (reg && reg.bodies && reg.bodies.length > countBefore) {
      return reg.bodies[reg.bodies.length - 1].id;
    }
    return window.__lastBrepShape && window.__lastBrepShape.id;
  }, regCountBefore);
}

// ─── Consolidated test ────────────────────────────────────────────────────────

test('Final suite: Sweep Tortuous → Loft Tangent → Stitch Faces → Convergent Solid', async () => {
  // Single-session recording: all 4 arity-0 surface tools in sequence.
  // All are arity-0 (no body pre-selection); dragOrbit shows each result in 3D.
  const { app, win, pageErrors, story } = await launchWithCapture('brep-final');
  try {

    // ── A: Sweep Tortuous — S-bend pipe section ───────────────────────────────
    // Artifact: S-bend tortuous pipe section
    // A circular profile (r=4mm) swept along a 3-segment tortuous polyline with
    // two right-angle bends → solid S-bend pipe. Used in HVAC, hydraulics,
    // heat exchanger manifolds. Built via BRepOffsetAPI_MakePipeShell.
    console.log('  [A] Building Sweep Tortuous (S-bend pipe)...');
    await story.frame('before-sweep-tortuous');
    const sweepId = await runSurfaceTool(win, 'Sweep Tortuous', {
      profileRadius: 4,
      segLength: 20,
      bendCount: 2,
    });
    console.log(`  Sweep Tortuous id: ${sweepId}`);

    await win.waitForTimeout(300);
    await story.frame('after-sweep-tortuous');
    await dragOrbit(win, { dx: 200, dy: 90 });
    await story.frame('after-sweep-tortuous-3d');

    const mSweep = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Sweep Tortuous: vol=${mSweep.volume?.toFixed(0)}, faces=${mSweep.faceCount}`);
    // Swept pipe: π * r² * segLength ≈ 1005 mm³ per segment. Assert > 900 mm³.
    expect(mSweep.volume).toBeGreaterThan(900);

    // ── B: Loft Tangent — smoothed tapered tower ─────────────────────────────
    // Artifact: smoothed tapered tower (tangent loft)
    // Three square sections lofted with tangent-continuous smoothing:
    //   40mm square at z=0, 20mm square at z=20, 30mm square at z=40.
    // Applications: architectural columns, aerospace fairing transitions,
    // turbine blade span profiles. Built via BRepOffsetAPI_ThruSections.
    console.log('  [B] Building Loft Tangent (tapered tower)...');
    await story.frame('before-loft-tangent');
    const loftId = await runSurfaceTool(win, 'Loft Tangent', {
      s0: 40, s1: 20, s2: 30,
      z0: 0,  z1: 20, z2: 40,
    });
    console.log(`  Loft Tangent id: ${loftId}`);

    await win.waitForTimeout(300);
    await story.frame('after-loft-tangent');
    await dragOrbit(win, { dx: 180, dy: 70 });
    await story.frame('after-loft-tangent-3d');

    const mLoft = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Loft Tangent: vol=${mLoft.volume?.toFixed(0)}, faces=${mLoft.faceCount}`);
    // Verified volume from recon: 25779 mm³. Allow ±10%.
    const expectedLoftVol = 25779;
    expect(mLoft.volume).toBeGreaterThan(expectedLoftVol * 0.90);
    expect(mLoft.volume).toBeLessThan(expectedLoftVol * 1.10);

    // ── C: Stitch Faces — stitched panel assembly ─────────────────────────────
    // Artifact: stitched panel assembly (Sewing API)
    // Two planar rectangular panels (20×20mm each) with a 0.05mm gap between
    // their shared edges. Sewed with tolerance=0.1mm → single open shell.
    // Applications: sheet-metal panel assemblies, imported-surface repair.
    console.log('  [C] Building Stitch Faces (panel assembly)...');
    await story.frame('before-stitch-faces');
    const stitchId = await runSurfaceTool(win, 'Stitch Faces', {
      gap: 0.05,
      tolerance: 0.1,
      panelW: 20,
      panelH: 20,
    });
    console.log(`  Stitch Faces id: ${stitchId}`);

    await win.waitForTimeout(300);
    await story.frame('after-stitch-faces');
    await dragOrbit(win, { dx: 160, dy: 60 });
    await story.frame('after-stitch-faces-3d');

    const mStitch = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Stitch Faces: vol=${mStitch.volume?.toFixed(0)}, faces=${mStitch.faceCount}`);
    // Stitched shell: both original panels must be present.
    // A shell has no enclosed volume (volume = 0 or undefined for open shell).
    expect(mStitch.faceCount).toBeGreaterThanOrEqual(2);

    // ── D: Convergent Solid — facet-derived solid cube ────────────────────────
    // Artifact: facet-derived solid cube (convergent modeling pipeline)
    // A 20mm cube built from 12 triangle faces via the full convergent pipeline:
    //   BRepBuilderAPI_MakeEdge + MakeWire + MakeFace (×12 triangles)
    //   → BRepBuilderAPI_Sewing (shell) → BRepBuilderAPI_MakeSolid (solid).
    // Applications: STL-imported solids, photogrammetry meshes, FEM output B-rep.
    console.log('  [D] Building Convergent Solid (facet-derived cube)...');
    await story.frame('before-convergent-solid');
    const convId = await runSurfaceTool(win, 'Convergent Solid', {
      size: 20,
      tolerance: 0.001,
    });
    console.log(`  Convergent Solid id: ${convId}`);

    await win.waitForTimeout(300);
    await story.frame('after-convergent-solid');
    await dragOrbit(win, { dx: 210, dy: 80 });
    await story.frame('after-convergent-solid-3d');

    const mConv = await win.evaluate(async () =>
      window.__archdiscKernel.kernel.brep.measure(window.__lastBrepShape),
    );
    console.log(`  Convergent Solid: vol=${mConv.volume?.toFixed(0)}, faces=${mConv.faceCount}`);
    // Verified volume from recon: 8000 mm³ (exact for 20mm cube). Allow ±10%.
    const expectedConvVol = 8000;
    expect(mConv.volume).toBeGreaterThan(expectedConvVol * 0.90);
    expect(mConv.volume).toBeLessThan(expectedConvVol * 1.10);

    // ── Multi-angle render ────────────────────────────────────────────────────
    const cap = await captureAllAngles(win, 'final-suite', { story, drags: 7 });
    console.log(`  Render: ${cap.total} real drag-orbits, ${cap.blanks.length} blanks`);
    expect(cap.blanks).toEqual([]);
    expect(pageErrors).toEqual([]);

    // ── Verify storyboard stills exist and are non-trivial ────────────────────
    const stills = story.frames();
    const inputStill = stills.find(f => /-before-sweep-tortuous\.png$/.test(f));
    const outputStill = stills.find(f => /-after-convergent-solid\.png$/.test(f));
    expect(inputStill, 'a before-sweep-tortuous still must have been captured').toBeTruthy();
    expect(outputStill, 'an after-convergent-solid still must have been captured').toBeTruthy();
    expect(fs.statSync(inputStill).size,
      'input still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
    expect(fs.statSync(outputStill).size,
      'after-convergent-solid still must be a real screenshot (>1 KB)').toBeGreaterThan(1024);
  } finally {
    await app.close();
    const sess = await story.finish();
    expect(sess.videoSize,
      'the recorded session .webm must be > 200 KB').toBeGreaterThan(200 * 1024);
  }
});
