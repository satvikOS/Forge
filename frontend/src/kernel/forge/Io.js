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
import { injectAp242Pmi } from './specialty/Ap242PmiEntities.js';

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

  // ----------------------- Forge-34 — IGES / JT / Parasolid ----------------
  /** Imports an IGES (.igs/.iges) file via OCCT's IGESControl_Reader. */
  static importIges(filepath) {
    const handle = requireIo().importIges(filepath);
    return new ForgeBody(handle, { source: 'iges', sourceFile: filepath });
  }
  /** JT: stub that throws a friendly error pointing the user at STEP/IGES. */
  static importJt(filepath) {
    requireIo().importJt(filepath); // always throws
    throw new Error('unreachable'); // placate ESLint
  }
  /** Parasolid: stub that throws a friendly error pointing the user at STEP. */
  static importParasolid(filepath) {
    requireIo().importParasolid(filepath); // always throws
    throw new Error('unreachable');
  }

  // ----------------------- Forge-34/46 — PMI / MBD STEP AP242 --------------
  //
  // Exports a body as STEP AP242, then post-processes the file to inject
  // ISO-10303-242 entities for every annotation: DATUM, DATUM_FEATURE,
  // GEOMETRIC_TOLERANCE_*_TOLERANCE, DATUM_REFERENCE,
  // GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE, ANNOTATION_TEXT_OCCURRENCE.
  // Result is parseable by Theorem, Datakit, and the CAx-IF AP242 toolset
  // as real PMI — not a comment block.
  //
  //   exportStepWithPmi(body, '/tmp/foo.step', { annotationSet })
  //   exportStepWithPmi(body, '/tmp/foo.step', { annotations: [...] })
  static exportStepWithPmi(body, filepath, { annotationSet = null, annotations = null, notes = null } = {}) {
    const list = annotations
                || (annotationSet ? annotationSet.list() : null)
                || notes
                || [];
    // Kernel writes geometry-only STEP first.
    const io = requireIo();
    const kernelResult = io.exportStep
      ? io.exportStep(body.handle, filepath)
      : io.exportStepWithPmi?.(body.handle, filepath, []);

    // Post-process: read file, splice AP242 PMI entities, write back.
    // Pure-JS / cross-platform — uses Node fs through the preload bridge
    // if running in Electron, or directly in a Node test harness.
    try {
      // Lazy require so a browser bundle that doesn't ship fs (electron
      // renderer minus preload) still loads this module without exploding.
      // eslint-disable-next-line global-require
      const fs = (typeof require === 'function') ? require('fs')
              : (typeof window !== 'undefined' && window.forge && window.forge.fs)
                ? window.forge.fs : null;
      if (fs && list.length > 0) {
        const src = fs.readFileSync(filepath, 'utf8');
        const next = injectAp242Pmi(src, list);
        fs.writeFileSync(filepath, next, 'utf8');
      }
    } catch (err) {
      // PMI injection is best-effort — geometry export already succeeded.
      console.warn('[forge.io] AP242 PMI injection failed:', err.message);
    }
    return kernelResult;
  }
}
