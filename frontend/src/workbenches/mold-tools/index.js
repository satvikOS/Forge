/**
 * ArchDisc Mold Tools Workbench — UX Tier 9 foundation.
 *
 * The Mold Tools workbench is SHIPPED as a dedicated ribbon TAB
 * (`RibbonToolbar.jsx` TABS.moldTools) backed by three foundation kernel
 * ops in `kernel/brep/BrepMoldTools.js`:
 *
 *   - Draft Analysis   — `K.brep.draftAnalysis(body, pullDirection, opts)`
 *   - Parting Line     — `K.brep.partingLine(body, pullDirection, opts)`
 *   - Tooling Split    — `K.brep.toolingSplit(body, pullDirection, opts)`
 *
 * The ribbon tab activates whenever the user clicks "Mold Tools" alongside
 * Part / Assembly / Drawing / Sheet Metal / Weldments / Simulate; the same
 * scene + tool runtime (WorkbenchMechanical's viewport + ToolExecutionEngine)
 * is reused, so an injection-molded part can be analysed, queried, and
 * exported with every other Mechanical CAD facility.
 *
 * Bodies are tagged via `body.metadata.mold = { draftAnalysis, partingLine,
 * half, toolingSplit }`, and faces carry `mold.draft` SP-2 attributes so
 * the analysis survives downstream ops.
 *
 * Queued for follow-on Tier-9 dispatches (see solidworks-course-synthesis.md
 * §6.9 — Mold Tools tool mapping):
 *
 *   - Undercut Analysis (multi-direction "stuck face" detection)
 *   - Shut-Off Surfaces (close through-holes for a manifold mold block)
 *   - Parting Surface (proper ruled / swept parting — not just planar)
 *   - Core / Cavity feature (proper mold-insert generation)
 *   - Side Actions (side-pull cores for undercuts)
 */
export { default as WorkbenchMoldTools } from './WorkbenchMoldTools.jsx';

// Re-export the kernel ops for convenient consumption from mold-tools
// callers that import via the workbench rather than the kernel index.
export {
  draftAnalysis, partingLine, toolingSplit,
  isMold, getMoldMetadata,
} from '../../kernel/brep/BrepMoldTools.js';

// The set of tool names the Mold Tools ribbon tab exposes — used by the
// e2e spec to drive the same names that the ribbon tab shows.
export const MOLD_TOOLS = ['Draft Analysis', 'Parting Line', 'Tooling Split'];
