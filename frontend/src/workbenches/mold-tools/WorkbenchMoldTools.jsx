import React, { useEffect } from 'react';
import WorkbenchMechanical from '../mechanical-cad/WorkbenchMechanical';

/**
 * Mold Tools Workbench — UX Tier 9.
 *
 * The Mold Tools workbench shares the WorkbenchMechanical viewport + tool
 * runtime but defaults to the Mold Tools ribbon tab. This delivers the
 * "dedicated workbench" feel (CommandManager-style — same CAD-tool
 * pattern as SolidWorks where the Mold Tools toolbar is just a different
 * ribbon page over the same Part document) WITHOUT duplicating the entire
 * viewport / scene-graph / ToolExecutionEngine wiring. Same pattern as
 * the Tier 5a Sheet Metal + Tier 6a Weldments workbench wrappers.
 *
 * The first time the workbench mounts it asks the active ribbon to switch
 * to the moldTools tab. The user retains the freedom to switch tabs to
 * Part / Assembly / etc. — the Mold Tools workbench is a starting point,
 * not a lock.
 *
 * Ribbon entries shipped this dispatch (kernel/brep/BrepMoldTools.js):
 *   - Analysis      — Draft Analysis  (per-face draft classification)
 *   - Parting       — Parting Line    (silhouette curve trace)
 *   - Mold Block    — Tooling Split   (core + cavity halves)
 *
 * Queued for follow-on dispatches (see solidworks-course-synthesis.md §6.9):
 *   - Undercut Analysis (deeper — multi-direction)
 *   - Shut-Off Surfaces (close through-holes for mold block)
 *   - Parting Surface (proper — ruled / swept, not just planar)
 *   - Core / Cavity feature (deeper — proper insert generation)
 *   - Side Actions (side-pull cores for undercuts)
 */
export default function WorkbenchMoldTools() {
  // Hint to WorkbenchMechanical (via a one-shot global) that the default
  // ribbon tab should be `moldTools`. WorkbenchMechanical reads this once
  // when constructing its initial state and then clears it.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__archdiscDefaultRibbonTab = 'moldTools';
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__archdiscDefaultRibbonTab;
      }
    };
  }, []);

  return <WorkbenchMechanical />;
}
