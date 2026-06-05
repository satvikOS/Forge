// Forge-65 — contextual toolbar (per workbench).
// 40 px row directly under the top bar; shows tool buttons grouped by
// category. Pinned set comes from the user's role (welcome screen),
// but every tool stays reachable via the cmd bar.

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

// Tool spec — keyed by workbench. Each group is a {label, tools[]} pair.
// Tool: { id, label, icon, hint }
const SPEC = {
  mech: [
    { label: 'Sketch', tools: [
      { id: 'sketch.new',     label: 'Sketch',  icon: 'sketch.rect',  hint: 'New sketch' },
      { id: 'sketch.line',    label: 'Line',    icon: 'sketch.line',  hint: 'L' },
      { id: 'sketch.rect',    label: 'Rect',    icon: 'sketch.rect',  hint: 'R' },
      { id: 'sketch.circle',  label: 'Circle',  icon: 'sketch.circle', hint: 'C' },
      { id: 'sketch.arc',     label: 'Arc',     icon: 'sketch.arc',   hint: 'A' },
      { id: 'sketch.polygon', label: 'Polygon', icon: 'sketch.polygon', hint: 'P' },
      { id: 'sketch.spline',  label: 'Spline',  icon: 'sketch.spline', hint: 'S' },
      { id: 'sketch.dim',     label: 'Dimension', icon: 'sketch.dim', hint: 'D' },
      { id: 'sketch.constrain', label: 'Constrain', icon: 'sketch.constrain' },
      { id: 'sketch.finish',  label: 'Finish',  icon: 'sketch.finish' },
    ]},
    { label: 'Solid', tools: [
      { id: 'solid.extrude',  label: 'Extrude', icon: 'solid.extrude', hint: 'E' },
      { id: 'solid.revolve',  label: 'Revolve', icon: 'solid.revolve' },
      { id: 'solid.sweep',    label: 'Sweep',   icon: 'solid.sweep' },
      { id: 'solid.loft',     label: 'Loft',    icon: 'solid.loft' },
      { id: 'solid.shell',    label: 'Shell',   icon: 'solid.shell' },
      { id: 'solid.fillet',   label: 'Fillet',  icon: 'solid.fillet', hint: 'F' },
      { id: 'solid.chamfer',  label: 'Chamfer', icon: 'solid.chamfer' },
      { id: 'solid.draft',    label: 'Draft',   icon: 'solid.draft' },
      { id: 'solid.hole',     label: 'Hole',    icon: 'solid.hole', hint: 'H' },
      { id: 'solid.thread',   label: 'Thread',  icon: 'solid.thread' },
      { id: 'solid.rib',      label: 'Rib',     icon: 'solid.rib' },
      { id: 'solid.translate',label: 'Move',    icon: 'solid.draft', hint: 'M' },
    ]},
    { label: 'Pattern', tools: [
      { id: 'pattern.linear',   label: 'Linear',   icon: 'pattern.linear' },
      { id: 'pattern.circular', label: 'Circular', icon: 'pattern.circular' },
      { id: 'pattern.mirror',   label: 'Mirror',   icon: 'pattern.mirror' },
      { id: 'pattern.curve',    label: 'On curve', icon: 'pattern.curve' },
    ]},
    { label: 'Boolean', tools: [
      { id: 'bool.union',  label: 'Union',  icon: 'bool.union' },
      { id: 'bool.cut',    label: 'Cut',    icon: 'bool.cut' },
      { id: 'bool.common', label: 'Common', icon: 'bool.common' },
      { id: 'bool.split',  label: 'Split',  icon: 'bool.split' },
    ]},
    { label: 'Measure', tools: [
      { id: 'measure.distance',  label: 'Distance', icon: 'measure.distance' },
      { id: 'measure.angle',     label: 'Angle',    icon: 'measure.angle' },
      { id: 'measure.area',      label: 'Area',     icon: 'measure.area' },
      { id: 'measure.mass',      label: 'Mass',     icon: 'measure.mass' },
      { id: 'measure.interfere', label: 'Interfere', icon: 'measure.interfere' },
    ]},
    { label: 'I/O', tools: [
      { id: 'io.step',  label: 'STEP',  icon: 'io.step' },
      { id: 'io.iges',  label: 'IGES',  icon: 'io.iges' },
      { id: 'io.stl',   label: 'STL',   icon: 'io.stl' },
      { id: 'io.brep',  label: 'BREP',  icon: 'io.brep' },
      { id: 'io.pdf',   label: 'PDF',   icon: 'io.pdf' },
    ]},
  ],
  drawing: [
    { label: 'Views', tools: [
      { id: 'view.iso',    label: 'Iso',     icon: 'view.iso' },
      { id: 'view.front',  label: 'Front',   icon: 'view.front' },
      { id: 'view.top',    label: 'Top',     icon: 'view.top' },
      { id: 'view.right',  label: 'Right',   icon: 'view.right' },
      { id: 'view.section', label: 'Section', icon: 'view.section' },
    ]},
    { label: 'Dimension', tools: [
      { id: 'sketch.dim',     label: 'Linear',   icon: 'sketch.dim' },
      { id: 'measure.angle',  label: 'Angular',  icon: 'measure.angle' },
      { id: 'measure.distance',label: 'Radial',  icon: 'measure.distance' },
    ]},
    { label: 'Annotate', tools: [
      { id: 'sketch.constrain', label: 'GD&T',    icon: 'sketch.constrain' },
      { id: 'sketch.point',     label: 'Datum',   icon: 'sketch.point' },
      { id: 'io.pdf',           label: 'Title',   icon: 'io.pdf' },
    ]},
  ],
  // Forge-127 — Sheet Metal toolbar: six groups, CATIA SMD layout.
  sheet: [
    { label: 'Base', tools: [
      { id: 'sheet.baseFlange', label: 'Base Flange', icon: 'wb.sheet', hint: 'B' },
    ]},
    { label: 'Flange', tools: [
      { id: 'sheet.edgeFlange',       label: 'Edge',        icon: 'wb.sheet' },
      { id: 'sheet.edgeFlangeRelief', label: 'Edge+Relief', icon: 'wb.sheet' },
      { id: 'sheet.miterFlange',      label: 'Miter',       icon: 'solid.chamfer' },
      { id: 'sheet.miterFlangeChain', label: 'Miter Chain', icon: 'solid.chamfer' },
      { id: 'sheet.loftedFlange',     label: 'Lofted',      icon: 'solid.loft' },
      { id: 'sheet.sweptFlange',      label: 'Swept',       icon: 'solid.sweep' },
    ]},
    { label: 'Bend', tools: [
      { id: 'sheet.sketchedBend', label: 'Sketched', icon: 'solid.draft' },
      { id: 'sheet.jog',          label: 'Jog',      icon: 'solid.draft' },
      { id: 'sheet.jogRelief',    label: 'Jog Relief', icon: 'solid.draft' },
    ]},
    { label: 'Forming', tools: [
      { id: 'sheet.louver',      label: 'Louver',    icon: 'pattern.linear' },
      { id: 'sheet.lance',       label: 'Lance',     icon: 'sketch.line' },
      { id: 'sheet.ribForm',     label: 'Rib',       icon: 'solid.rib' },
      { id: 'sheet.dimple',      label: 'Dimple',    icon: 'sketch.circle' },
      { id: 'sheet.drawnCutout', label: 'Drawn',     icon: 'bool.cut' },
      { id: 'sheet.crossBreak',  label: 'X-Break',   icon: 'pattern.mirror' },
    ]},
    { label: 'Corner', tools: [
      { id: 'sheet.hemClosed',    label: 'Hem Closed', icon: 'solid.fillet' },
      { id: 'sheet.hemOpen',      label: 'Hem Open',   icon: 'solid.fillet' },
      { id: 'sheet.hemRolled',    label: 'Hem Rolled', icon: 'solid.fillet' },
      { id: 'sheet.hemTeardrop',  label: 'Hem Tear',   icon: 'solid.fillet' },
      { id: 'sheet.closedCorner', label: 'Closed Corner', icon: 'solid.shell' },
      { id: 'sheet.cornerRelief', label: 'Corner Relief', icon: 'sketch.constrain' },
    ]},
    { label: 'Flat', tools: [
      { id: 'sheet.unfold',      label: 'Unfold', icon: 'solid.draft' },
      { id: 'sheet.flatPattern', label: 'Flat',   icon: 'pattern.linear' },
    ]},
  ],
  weld: [
    { label: 'Weldments', tools: [
      { id: 'weld.member',  label: 'Member',   icon: 'wb.weldments' },
      { id: 'weld.endcap',  label: 'End cap',  icon: 'solid.shell' },
      { id: 'weld.gusset',  label: 'Gusset',   icon: 'solid.rib' },
      { id: 'weld.bead',    label: 'Bead',     icon: 'weld.bead' },
      { id: 'weld.trim',    label: 'Trim',     icon: 'sketch.trim' },
      { id: 'weld.cutlist', label: 'Cut list', icon: 'io.pdf' },
    ]},
  ],
  mold: [
    { label: 'Mold Tools', tools: [
      { id: 'mold.parting',  label: 'Parting',  icon: 'wb.mold' },
      { id: 'mold.core',     label: 'Core',     icon: 'solid.extrude' },
      { id: 'mold.cavity',   label: 'Cavity',   icon: 'bool.cut' },
      { id: 'mold.draft',    label: 'Draft',    icon: 'solid.draft' },
      { id: 'mold.runner',   label: 'Runner',   icon: 'solid.sweep' },
    ]},
  ],
  sim: [
    { label: 'Study', tools: [
      { id: 'sim.static',   label: 'Static',   icon: 'wb.sim' },
      { id: 'sim.modal',    label: 'Modal',    icon: 'wb.sim' },
      { id: 'sim.dynamic',  label: 'Dynamic',  icon: 'wb.sim' },
      { id: 'sim.thermal',  label: 'Thermal',  icon: 'wb.sim' },
      { id: 'sim.cfd',      label: 'CFD',      icon: 'wb.sim' },
    ]},
  ],
  mfg: [
    { label: 'Toolpaths', tools: [
      { id: 'mfg.face',    label: 'Face',    icon: 'wb.mfg' },
      { id: 'mfg.contour', label: 'Contour', icon: 'wb.mfg' },
      { id: 'mfg.pocket',  label: 'Pocket',  icon: 'wb.mfg' },
      { id: 'mfg.drill',   label: 'Drill',   icon: 'solid.hole' },
      { id: 'mfg.5axis',   label: '5-axis',  icon: 'wb.mfg' },
      { id: 'mfg.post',    label: 'Post',    icon: 'io.pdf' },
    ]},
  ],
};

export function Toolbar({ workbenchId, activeTool, onInvoke }) {
  // Forge-137 — re-render when role changes so the role-aware SPEC takes
  // effect. The transformer lives on window so this file does not have a
  // hard dependency on RoleSwitcher (it works whether the host mounted
  // or not).
  const [roleRev, setRoleRev] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bump = () => setRoleRev((n) => n + 1);
    window.addEventListener('forge:role-applied', bump);
    return () => window.removeEventListener('forge:role-applied', bump);
  }, []);
  const apply = (typeof window !== 'undefined' && typeof window.__forgeRoleApply === 'function')
    ? window.__forgeRoleApply : null;
  const effective = apply ? apply(SPEC) : SPEC;
  const groups = (effective[workbenchId] || SPEC[workbenchId] || SPEC.mech);
  return (
    <div className="forge-toolbar"
         role="toolbar"
         aria-label={`${workbenchId} tools`}
         data-testid="forge-toolbar"
         data-role-rev={roleRev}>
      {groups.map((g) => (
        <div key={g.label} className="forge-toolbar-group">
          <span className="forge-toolbar-group-label">{g.label}</span>
          {g.tools.map((t) => (
            <Tooltip key={t.id} label={t.label} hint={t.hint} placement="bottom">
              <button
                type="button"
                className="forge-tool"
                data-tool={t.id}
                data-active={String(activeTool === t.id)}
                aria-label={t.label}
                aria-pressed={activeTool === t.id}
                onClick={() => onInvoke?.(t.id)}
              >
                <Icon name={t.icon} size={18} />
              </button>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  );
}

export function toolsForWorkbench(id) { return SPEC[id] || []; }
