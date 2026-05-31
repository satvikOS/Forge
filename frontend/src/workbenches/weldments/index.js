/**
 * ArchDisc Weldments Workbench — UX Tier 6a foundation.
 *
 * The Weldments workbench is SHIPPED as a dedicated ribbon TAB
 * (`RibbonToolbar.jsx` TABS.weldments) backed by three foundation kernel
 * ops in `kernel/brep/BrepWeldments.js`:
 *
 *   - Structural Member    — `K.brep.structuralMember(path, profileSpec, opts)`
 *   - Trim/Extend Members  — `K.brep.trimMembers(members, {mode})`
 *   - End Cap              — `K.brep.endCap(member, endRef, {thickness})`
 *
 * The ribbon tab activates whenever the user clicks "Weldments" alongside
 * Part / Assembly / Drawing / Sheet Metal / Simulate; the same scene + tool
 * runtime (WorkbenchMechanical's viewport + ToolExecutionEngine) is reused,
 * so a welded structural frame can be measured, queried, exported, and
 * assembled with every other Mechanical CAD facility.
 *
 * The standard profile library (ISO/ANSI) is available via
 * `K.brep.standardProfileSizes()` and `K.brep.buildStandardProfile(family,size)`.
 * Foundation pass ships three sizes per family:
 *
 *   - Rectangular tube (ISO 4019): 40×60×3, 50×100×4, 80×120×5
 *   - Square tube      (ISO 4019): 40×40×3, 50×50×4, 80×80×5
 *   - Round tube       (ISO 4200): Ø48.3×3.6, Ø60.3×3.6, Ø88.9×4.0
 *   - Angle iron       (ISO 657-21): 50×50×5, 65×65×7, 80×80×8
 *   - C-channel        (ISO 657-11): 100×50×5, 150×75×6.5, 200×75×8.5
 *   - I-beam           (IPE): IPE100, IPE160, IPE200
 *
 * Queued for follow-on Tier-6 dispatches (see solidworks-course-synthesis.md
 * §6.6 — Weldments tool mapping):
 *
 *   - Gusset (corner reinforcement)
 *   - Weld Bead (spot / continuous / all-around)
 *   - Cut List (auto-generated BOM of every member + cut length)
 *   - Sub-Weldment (nested weldment hierarchy)
 *   - Custom Profile Import (sketch-based profile → STANDARD_PROFILES)
 *   - Cope Cut (saddle cut on round-tube joints — surface-surface intersection)
 */
export { default as WorkbenchWeldments } from './WorkbenchWeldments.jsx';

// Re-export the kernel ops for convenient consumption from weldments
// callers that import via the workbench rather than the kernel index.
export {
  structuralMember, trimMembers, endCap,
  isWeldment, getWeldmentMetadata,
  buildStandardProfile, standardProfileSizes, STANDARD_PROFILES,
} from '../../kernel/brep/BrepWeldments.js';

// The set of tool names the Weldments ribbon tab exposes — used by the
// e2e spec to drive the same names that the ribbon tab shows.
export const WELDMENT_TOOLS = ['Structural Member', 'Trim/Extend Members', 'End Cap'];
