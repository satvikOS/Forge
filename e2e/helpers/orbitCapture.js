/**
 * orbitCapture.js — shared e2e helper for multi-angle visual capture.
 *
 * captureAllAngles used to teleport the camera via window.__archdiscOrbitView
 * and screenshot the FINISHED model from 36 angles. The reviewer's feedback —
 * "i only see different models but not seeing operations being worked on them
 * in motion" — drove a rewrite: it now performs REAL drag-orbits (the same
 * mouse drag mechanism as motionCapture.js's dragOrbit), capturing a still
 * after each drag, so the closing sweep is genuine motion in the recording.
 *
 * The signature is back-compatible: existing specs that pass
 * { azimuths, elevations, zooms } keep compiling — those opts are accepted
 * and ignored — and the return shape { total, blanks } is unchanged, with
 * blank-frame detection preserved.
 *
 * Usage:
 *   import { captureAllAngles } from './helpers/orbitCapture.js';
 *   const cap = await captureAllAngles(win, 'myShape', { story });
 *   expect(cap.blanks).toEqual([]);
 */
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Orbit the viewport with REAL drag gestures and screenshot after each drag.
 *
 * @param {import('@playwright/test').Page} win  - Playwright Electron window
 * @param {string} label                        - short label (file names)
 * @param {object} [opts]
 * @param {object} [opts.story]   - motionCapture story; if given, each frame
 *                                  is ALSO captured via story.frame() so the
 *                                  orbit stills join the spec's storyboard.
 * @param {string} [opts.dir]     - explicit output dir for the orbit stills.
 *                                  Defaults to the story's motionDir, else a
 *                                  temp dir (graceful fallback).
 * @param {number} [opts.drags]   - number of real drag-orbits (default 7).
 * @param {number[]} [opts.azimuths]   - accepted for back-compat (ignored).
 * @param {number[]} [opts.elevations] - accepted for back-compat (ignored).
 * @param {number[]} [opts.zooms]      - accepted for back-compat (ignored).
 * @returns {Promise<{ total:number, blanks:Array<{angle:string,size:number}> }>}
 */
export async function captureAllAngles(win, label, opts) {
  opts = opts || {};
  const story = opts.story || null;
  const drags = opts.drags || 7;

  // Resolve an output dir. Prefer the spec's motion dir (story.motionDir),
  // then an explicit opts.dir, then a temp dir so this never throws for
  // older specs that pass neither.
  let outDir = opts.dir
    || (story && story.motionDir)
    || path.join(os.tmpdir(), 'archdisc-orbit', label);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch {
    outDir = path.join(os.tmpdir(), 'archdisc-orbit', label);
    fs.mkdirSync(outDir, { recursive: true });
  }

  const canvasLoc = win.locator('canvas').first();
  const box = await canvasLoc.boundingBox();
  const blanks = [];
  let total = 0;

  // A varied set of drag vectors so the orbit visits many viewpoints.
  // [dx, dy] in CSS pixels — alternating signs sweep around the model.
  const vectors = [
    [220, 0], [180, 110], [-200, 90], [-220, -80],
    [200, -120], [120, 150], [-160, 130], [240, 40],
  ];

  const doDrag = async (dx, dy) => {
    if (!box) return;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await win.mouse.move(cx, cy, { steps: 6 });
    await win.waitForTimeout(120);
    await win.mouse.down();
    await win.mouse.move(cx + dx, cy + dy, { steps: 22 });
    await win.waitForTimeout(80);
    await win.mouse.up();
    await win.waitForTimeout(220);
  };

  for (let i = 0; i < drags; i++) {
    total++;
    const [dx, dy] = vectors[i % vectors.length];
    await doDrag(dx, dy);

    // Capture the canvas after this real drag.
    const nn = String(i + 1).padStart(2, '0');
    const filename = `orbit-${label}-${nn}.png`;
    const filepath = path.join(outDir, filename);
    let buf = null;
    try {
      buf = await canvasLoc.screenshot({ path: filepath });
    } catch {
      buf = null;
    }

    // Also fold the frame into the spec's storyboard, if provided.
    if (story && typeof story.frame === 'function') {
      try { await story.frame(`orbit-${nn}`); } catch { /* non-fatal */ }
    }

    // Blank / invisible-geometry detection: a solid-color PNG is small.
    const size = buf
      ? buf.length
      : (fs.existsSync(filepath) ? fs.statSync(filepath).size : 0);
    if (size < 3000) {
      blanks.push({ angle: `orbit-${nn}`, size });
    }
  }

  return { total, blanks };
}
