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

  // ----------------------- Forge-34 — PMI / MBD STEP AP242 -----------------
  //
  // Exports a body as STEP AP242, then appends a `PMI_FCF: …` ISO-10303-21
  // comment block carrying GD&T from the supplied AnnotationSet. Stub-tier
  // emission until full representation_item / dimensional_size entities
  // land — but round-trips the PMI text through every conformant AP242
  // reader.
  //
  //   exportStepWithPmi(body, '/tmp/foo.step', { annotationSet })
  //   exportStepWithPmi(body, '/tmp/foo.step', { notes: [{text, anchorKind, anchorId}] })
  static exportStepWithPmi(body, filepath, { annotationSet = null, notes = null } = {}) {
    const list = notes || (annotationSet ? annotationSet.list().map((a) => ({
      text:       a.text || a.format?.() || '',
      anchorKind: typeof a.topoId === 'number' && a.topoId > 0 ? 'face' : '',
      anchorId:   a.topoId | 0,
    })) : []);
    return requireIo().exportStepWithPmi(body.handle, filepath, list);
  }
}
