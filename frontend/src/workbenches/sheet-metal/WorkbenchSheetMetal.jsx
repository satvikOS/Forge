import React, { useEffect } from 'react';
import WorkbenchMechanical from '../mechanical-cad/WorkbenchMechanical';

/**
 * Sheet Metal Workbench — UX Tier 5a.
 *
 * The Sheet Metal workbench shares the WorkbenchMechanical viewport + tool
 * runtime but defaults to the Sheet Metal ribbon tab. This delivers the
 * "dedicated workbench" feel (CommandManager-style — same CAD-tool
 * pattern as SolidWorks where the Sheet Metal toolbar is just a different
 * ribbon page over the same Part document) WITHOUT duplicating the entire
 * viewport / scene-graph / ToolExecutionEngine wiring.
 *
 * The first time the workbench mounts it asks the active ribbon to switch
 * to the sheetMetal tab. The user retains the freedom to switch tabs to
 * Part / Assembly / etc. — the Sheet Metal workbench is a starting point,
 * not a lock.
 *
 * Ribbon entries shipped this dispatch (kernel/brep/BrepSheetMetal.js):
 *   - Create        — Base Flange
 *   - Bend          — Edge Flange
 *   - Manufacturing — Flat Pattern
 *
 * Queued for follow-on dispatches (see solidworks-course-synthesis.md §6.5):
 *   - Convert to Sheet Metal, Lofted Bend, Miter Flange, Hem (4 variants),
 *     Jog, Sketched Bend, Closed Corner, Corner Trim/Relief, Cross Break,
 *     Forming Tool, Sweep Flange, Rib (Sheet Metal),
 *     K-Factor / Bend Allowance / Bend Deduction table switch.
 */
export default function WorkbenchSheetMetal() {
  // Hint to WorkbenchMechanical (via a one-shot global) that the default
  // ribbon tab should be `sheetMetal`. WorkbenchMechanical reads this once
  // when constructing its initial state and then clears it.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__archdiscDefaultRibbonTab = 'sheetMetal';
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__archdiscDefaultRibbonTab;
      }
    };
  }, []);

  return <WorkbenchMechanical />;
}
