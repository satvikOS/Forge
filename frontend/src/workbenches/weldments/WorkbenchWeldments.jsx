import React, { useEffect } from 'react';
import WorkbenchMechanical from '../mechanical-cad/WorkbenchMechanical';

/**
 * Weldments Workbench — UX Tier 6a.
 *
 * The Weldments workbench shares the WorkbenchMechanical viewport + tool
 * runtime but defaults to the Weldments ribbon tab. This delivers the
 * "dedicated workbench" feel (CommandManager-style — same CAD-tool
 * pattern as SolidWorks where the Weldments toolbar is just a different
 * ribbon page over the same Part document) WITHOUT duplicating the entire
 * viewport / scene-graph / ToolExecutionEngine wiring. Same pattern as
 * the Tier 5a Sheet Metal workbench wrapper.
 *
 * The first time the workbench mounts it asks the active ribbon to switch
 * to the weldments tab. The user retains the freedom to switch tabs to
 * Part / Assembly / etc. — the Weldments workbench is a starting point,
 * not a lock.
 *
 * Ribbon entries shipped this dispatch (kernel/brep/BrepWeldments.js):
 *   - Members  — Structural Member (sweep an ISO/ANSI profile along a 3D path)
 *   - Trim     — Trim/Extend Members (boolean trim 2+ members at a joint)
 *   - Caps     — End Cap (close an open member end with a flat / thick cap)
 *
 * Queued for follow-on dispatches (see solidworks-course-synthesis.md §6.6):
 *   - Gusset (corner reinforcement between two perpendicular members)
 *   - Weld Bead (spot / continuous; size + all-around toggle)
 *   - Cut List (auto-generated BOM of every member + cut length)
 *   - Sub-Weldment (nested weldment hierarchy)
 *   - Custom profile import (extend STANDARD_PROFILES with user sketches)
 *   - Cope Cut (cylindrical-tube saddle cut at non-orthogonal joints)
 */
export default function WorkbenchWeldments() {
  // Hint to WorkbenchMechanical (via a one-shot global) that the default
  // ribbon tab should be `weldments`. WorkbenchMechanical reads this once
  // when constructing its initial state and then clears it.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.__archdiscDefaultRibbonTab = 'weldments';
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window.__archdiscDefaultRibbonTab;
      }
    };
  }, []);

  return <WorkbenchMechanical />;
}
