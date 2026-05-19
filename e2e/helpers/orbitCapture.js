/**
 * orbitCapture.js — shared e2e helper for multi-angle / multi-zoom visual capture.
 *
 * Usage:
 *   import { captureAllAngles } from './helpers/orbitCapture.js';
 *   // after rendering + framing geometry in the viewport:
 *   const cap = await captureAllAngles(win, 'myShape');
 *   expect(cap.blanks).toEqual([]);
 */
import fs from 'fs';
import path from 'path';

/**
 * Capture the viewport canvas from a thorough sweep of camera angles and zoom levels.
 *
 * @param {import('@playwright/test').Page} win   - Playwright Electron window
 * @param {string}                           label - Short label for this geometry (used in file names)
 * @param {object}                           opts  - Optional overrides
 * @param {number[]}  [opts.azimuths]   - Azimuth angles in degrees (default: 8 angles)
 * @param {number[]}  [opts.elevations] - Elevation angles in degrees (default: 3 elevations)
 * @param {number[]}  [opts.zooms]      - Zoom factors (default: 3 levels)
 * @param {string}    [opts.outDir]     - Base output directory (default: e2e/screenshots/<label>)
 * @returns {{ total: number, blanks: Array<{angle: string, size: number}> }}
 */
export async function captureAllAngles(win, label, opts) {
  opts = opts || {};
  const azimuths   = opts.azimuths   || [0, 45, 90, 135, 180, 225, 270, 315];
  const elevations = opts.elevations || [-45, 10, 60];
  const zooms      = opts.zooms      || [0.6, 1.0, 1.8];

  // __dirname is the e2e/helpers directory; go up one level to get e2e/
  const e2eDir  = path.join(__dirname, '..');
  const baseDir = opts.outDir || path.join(e2eDir, 'screenshots');
  const outDir  = path.join(baseDir, label);
  fs.mkdirSync(outDir, { recursive: true });

  // Snapshot the framed distance as zoom=1 reference
  await win.evaluate(() => {
    if (typeof window.__archdiscSetOrbitBase === 'function') {
      window.__archdiscSetOrbitBase();
    }
  });

  const blanks = [];
  let total = 0;

  for (const zoom of zooms) {
    for (const el of elevations) {
      for (const az of azimuths) {
        total++;
        const zLabel  = String(zoom).replace('.', 'p');
        const elLabel = el < 0 ? 'n' + Math.abs(el) : String(el);
        const filename = 'az' + az + '_el' + elLabel + '_z' + zLabel + '.png';
        const filepath = path.join(outDir, filename);

        // Orbit to this angle + zoom
        await win.evaluate(function(args) {
          var a = args[0], e = args[1], z = args[2];
          if (typeof window.__archdiscOrbitView === 'function') {
            window.__archdiscOrbitView(a, e, z);
          }
        }, [az, el, zoom]);

        // Brief settle — let Three.js finish the render call
        await win.waitForTimeout(60);

        // Capture the canvas
        const buf = await win.locator('canvas').first().screenshot({ path: filepath });

        // A blank / invisible-geometry PNG is very small (solid color ~1-3 KB).
        // Real geometry will produce >= 4 KB due to pixel variation.
        const size = buf ? buf.length : (fs.existsSync(filepath) ? fs.statSync(filepath).size : 0);
        if (size < 3000) {
          blanks.push({ angle: 'az' + az + '_el' + elLabel + '_z' + zLabel, size: size });
        }
      }
    }
  }

  return { total: total, blanks: blanks };
}
