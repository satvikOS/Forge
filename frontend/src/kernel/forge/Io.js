/**
 * Forge I/O — STEP / BREP / STL import + export.
 *
 * Operates on absolute file paths (Electron renderer has FS access via
 * the preload bridge; pure-browser callers would need an alternative
 * mechanism that the kernel doesn't have today). Throws on parse or
 * disk failure — callers should wrap in try/catch and surface a
 * friendly error in the UI.
 */

import { getForge, ForgeBody } from './index.js';

function requireIo() {
  const f = getForge();
  if (!f.io) {
    throw new Error('[forge.io] forge.io not present on the bridge — build forge-kernel >= Forge-21');
  }
  return f.io;
}

export class ForgeIo {
  static importStep(filepath) {
    const handle = requireIo().importStep(filepath);
    return new ForgeBody(handle, { source: 'step', sourceFile: filepath });
  }
  static exportStep(body, filepath) {
    return requireIo().exportStep(body.handle, filepath);
  }
  static importBrep(filepath) {
    const handle = requireIo().importBrep(filepath);
    return new ForgeBody(handle, { source: 'brep', sourceFile: filepath });
  }
  static exportBrep(body, filepath) {
    return requireIo().exportBrep(body.handle, filepath);
  }
  static importStl(filepath) {
    const handle = requireIo().importStl(filepath);
    return new ForgeBody(handle, { source: 'stl', sourceFile: filepath });
  }
  /** Exports a tessellated STL. linearTol / angularTol drive mesh density. */
  static exportStl(body, filepath, { linearTol = 0.1, angularTol = 0.5, ascii = false } = {}) {
    return requireIo().exportStl(body.handle, filepath, linearTol, angularTol, ascii);
  }
}
