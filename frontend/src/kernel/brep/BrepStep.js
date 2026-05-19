/**
 * ArchDisc Kernel — native STEP I/O via OCCT (STEPControl_*).
 * STEP read/write goes through the Emscripten virtual filesystem (oc.FS).
 * Verified API: docs/superpowers/notes/occt-api-A1.md items 12-13.
 */

import { getOCCT } from './occtKernel.js';
import { BrepShape, withScope, track } from './BrepShape.js';

// Emscripten virtual-FS filenames must be RELATIVE (no leading slash).
const STEP_TMP = 'archdisc-step-tmp.step';

/**
 * Export a BrepShape to STEP text (ISO-10303-21).
 * @param {BrepShape} brepShape
 * @returns {Promise<string>} the STEP file contents
 */
export async function exportStep(brepShape) {
  if (!brepShape || !brepShape.shape) throw new Error('exportStep: needs a BrepShape');
  const oc = await getOCCT();
  return withScope(() => {
    const writer = track(new oc.STEPControl_Writer_1());
    // Transfer — EXACTLY 4 args (verified: item 12; 2-or-3-arg call throws BindingError)
    const transferRet = writer.Transfer(
      brepShape.shape,
      oc.STEPControl_StepModelType.STEPControl_AsIs,
      true,
      track(new oc.Message_ProgressRange_1())
    );
    // transferRet is an Embind object; .value === 1 means IFSelect_RetDone (verified: item 12)
    if (transferRet.value !== 1) {
      throw new Error(`exportStep: OCCT transfer failed (status ${transferRet.value})`);
    }
    writer.Write(STEP_TMP);
    const text = oc.FS.readFile(STEP_TMP, { encoding: 'utf8' });
    try { oc.FS.unlink(STEP_TMP); } catch { /* fine */ }
    if (!text || !text.includes('ISO-10303-21')) {
      throw new Error('exportStep: produced text is not valid STEP');
    }
    return text;
  });
}

/**
 * Import a STEP text into a BrepShape.
 * @param {string} stepText  STEP file contents
 * @returns {Promise<BrepShape>}
 */
export async function importStep(stepText) {
  if (typeof stepText !== 'string' || !stepText.includes('ISO-10303-21')) {
    throw new Error('importStep: input is not STEP text');
  }
  const oc = await getOCCT();
  return withScope(() => {
    oc.FS.writeFile(STEP_TMP, stepText);
    const reader = track(new oc.STEPControl_Reader_1());
    const readStatus = reader.ReadFile(STEP_TMP);
    // readStatus is an Embind object; .value === 1 means IFSelect_RetDone (verified: item 13)
    if (readStatus.value !== 1) {
      throw new Error(`importStep: OCCT ReadFile failed (status ${readStatus.value})`);
    }
    reader.TransferRoots(track(new oc.Message_ProgressRange_1()));
    const shape = reader.OneShape();
    try { oc.FS.unlink(STEP_TMP); } catch { /* fine */ }
    if (shape.IsNull()) throw new Error('importStep: OCCT produced a null shape');
    return new BrepShape(shape, { op: 'importStep' });
  });
}
