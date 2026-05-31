/**
 * ArchDisc Sheet Metal Workbench — UX Tier 5a foundation.
 *
 * The Sheet Metal workbench is SHIPPED as a dedicated ribbon TAB
 * (`RibbonToolbar.jsx` TABS.sheetMetal) backed by three foundation kernel
 * ops in `kernel/brep/BrepSheetMetal.js`:
 *
 *   - Base Flange   — `K.brep.baseFlange(profile, opts)`
 *   - Edge Flange   — `K.brep.edgeFlange(body, edgeRef, opts)`
 *   - Flat Pattern  — `K.brep.flatPattern(body)`
 *
 * The ribbon tab activates whenever the user clicks "Sheet Metal" alongside
 * Part / Assembly / Drawing / Simulate; the same scene + tool runtime
 * (WorkbenchMechanical's viewport + ToolExecutionEngine) is reused, so a
 * sheet-metal part can be measured, queried, exported, and assembled with
 * every other Mechanical CAD facility.
 *
 * Queued for follow-on Tier-5 dispatches (see solidworks-course-synthesis.md
 * §6.5 — Sheet Metal tool mapping):
 *
 *   - Convert to Sheet Metal, Lofted Bend, Miter Flange, Hem (4 variants),
 *     Jog, Sketched Bend, Closed Corner, Corner Trim/Relief, Cross Break,
 *     Forming Tool (library of louver/emboss/bridge etc.), Sweep Flange,
 *     Rib (Sheet Metal version), Auto-Relief.
 *   - Bend Allowance / Bend Deduction / Gauge Table switching (currently
 *     K-Factor only).
 */
export { default as WorkbenchSheetMetal } from './WorkbenchSheetMetal.jsx';

// Re-export the kernel ops for convenient consumption from sheet-metal
// callers that import via the workbench rather than the kernel index.
export {
  baseFlange, edgeFlange, flatPattern,
  isSheetMetal, getSheetMetalMetadata, bendAllowance,
} from '../../kernel/brep/BrepSheetMetal.js';

// The set of tool names the Sheet Metal ribbon tab exposes — used by the
// e2e spec to drive the same names that the ribbon tab shows.
export const SHEET_METAL_TOOLS = ['Base Flange', 'Edge Flange', 'Flat Pattern'];
