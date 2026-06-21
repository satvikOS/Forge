// Forge-65 — contextual ribbon (per workbench).
//
// Professional MCAD command ribbon (CATIA / SolidWorks CommandManager / NX
// grade). The single grid toolbar zone hosts:
//   • a left TAB CLUSTER that switches the active command set per workbench
//     (Sketch / Features / Pattern / Evaluate / …) so a dense workbench is
//     navigable instead of a flat 30-icon scroll strip;
//   • GROUPED tool clusters with uppercase group labels and 1px separators;
//   • PRIMARY (large, labeled) + SECONDARY (compact icon) button sizing so the
//     hero op of each group reads first;
//   • SPLIT-BUTTON FLYOUTS for related ops (fillet ▸ chamfer/draft, linear ▸
//     circular/mirror, …) — one button, a chevron, a popover of variants;
//   • OVERFLOW handling: when a tab's groups exceed the row width, the tail
//     collapses into a "⋯ More" chevron menu (never a sideways scroll).
//
// VISUAL + UX upgrade only. Every tool still routes through `onInvoke(id)`,
// every button keeps `data-tool` / `data-active`, the root keeps
// `data-testid="forge-toolbar"` + `data-role-rev`, and the role transformer
// (`window.__forgeRoleApply`) still re-shapes the spec. No logic changes.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';
import './theme/forge-ribbon.css';

// Inline chevrons — match the icon set's 1.5px-stroke / currentColor language
// (the shared Icon set has no chevron glyph). 16px box like every other icon.
function ChevronDown({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
function MoreGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth={1.5}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="3.5" cy="8" r="0.6" fill="currentColor" />
      <circle cx="8"   cy="8" r="0.6" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.6" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Tool spec — keyed by workbench, then by ribbon TAB. Each tab is a
// {id, label, groups[]} entry; each group is {label, tools[]}. A tool is
// { id, label, icon, hint, primary?, flyout?[] }.
//   primary: render the large labeled hero button (one or two per group).
//   flyout:  array of related tool variants → split-button popover.
// `mech` is the canonical, fully-tabbed reference; the rest are single-tab
// workbenches whose existing groups are preserved verbatim.
// ---------------------------------------------------------------------------
const SPEC = {
  mech: [
    { id: 'tab.sketch', label: 'Sketch', groups: [
      { label: 'Sketch', tools: [
        { id: 'sketch.new', label: 'Sketch', icon: 'sketch.rect', hint: 'New sketch', primary: true,
          flyout: [
            { id: 'sketch.new',  label: 'New Sketch',  icon: 'sketch.rect' },
            { id: 'sketch.finish', label: 'Finish Sketch', icon: 'sketch.finish' },
          ] },
      ]},
      { label: 'Draw', tools: [
        { id: 'sketch.line',    label: 'Line',    icon: 'sketch.line',   hint: 'L', primary: true,
          flyout: [
            { id: 'sketch.line',    label: 'Line',    icon: 'sketch.line',    hint: 'L' },
            { id: 'sketch.spline',  label: 'Spline',  icon: 'sketch.spline',  hint: 'S' },
            { id: 'sketch.arc',     label: 'Arc',     icon: 'sketch.arc',     hint: 'A' },
          ] },
        { id: 'sketch.rect',    label: 'Rect',    icon: 'sketch.rect',    hint: 'R' },
        { id: 'sketch.circle',  label: 'Circle',  icon: 'sketch.circle',  hint: 'C' },
        { id: 'sketch.arc',     label: 'Arc',     icon: 'sketch.arc',     hint: 'A' },
        { id: 'sketch.polygon', label: 'Polygon', icon: 'sketch.polygon', hint: 'P' },
        { id: 'sketch.spline',  label: 'Spline',  icon: 'sketch.spline',  hint: 'S' },
      ]},
      { label: 'Constrain', tools: [
        { id: 'sketch.dim',       label: 'Dimension', icon: 'sketch.dim', hint: 'D', primary: true },
        { id: 'sketch.constrain', label: 'Constrain', icon: 'sketch.constrain' },
        { id: 'sketch.finish',    label: 'Finish',    icon: 'sketch.finish' },
      ]},
    ]},
    { id: 'tab.features', label: 'Features', groups: [
      { label: 'Create', tools: [
        { id: 'solid.extrude',  label: 'Extrude', icon: 'solid.extrude', hint: 'E', primary: true,
          flyout: [
            { id: 'solid.extrude', label: 'Extrude', icon: 'solid.extrude', hint: 'E' },
            { id: 'solid.revolve', label: 'Revolve', icon: 'solid.revolve' },
            { id: 'solid.sweep',   label: 'Sweep',   icon: 'solid.sweep' },
            { id: 'solid.loft',    label: 'Loft',    icon: 'solid.loft' },
          ] },
        { id: 'solid.revolve',  label: 'Revolve', icon: 'solid.revolve' },
        { id: 'solid.sweep',    label: 'Sweep',   icon: 'solid.sweep' },
        { id: 'solid.loft',     label: 'Loft',    icon: 'solid.loft' },
      ]},
      { label: 'Modify', tools: [
        { id: 'solid.fillet',   label: 'Fillet',  icon: 'solid.fillet', hint: 'F', primary: true,
          flyout: [
            { id: 'solid.fillet',  label: 'Fillet',  icon: 'solid.fillet', hint: 'F' },
            { id: 'solid.chamfer', label: 'Chamfer', icon: 'solid.chamfer' },
            { id: 'solid.draft',   label: 'Draft',   icon: 'solid.draft' },
          ] },
        { id: 'solid.chamfer',  label: 'Chamfer', icon: 'solid.chamfer' },
        { id: 'solid.shell',    label: 'Shell',   icon: 'solid.shell' },
        { id: 'solid.draft',    label: 'Draft',   icon: 'solid.draft' },
        { id: 'solid.rib',      label: 'Rib',     icon: 'solid.rib' },
      ]},
      { label: 'Holes', tools: [
        { id: 'solid.hole',     label: 'Hole',    icon: 'solid.hole', hint: 'H', primary: true,
          flyout: [
            { id: 'solid.hole',   label: 'Hole',   icon: 'solid.hole', hint: 'H' },
            { id: 'solid.thread', label: 'Thread', icon: 'solid.thread' },
          ] },
        { id: 'solid.thread',   label: 'Thread',  icon: 'solid.thread' },
        { id: 'solid.translate',label: 'Move',    icon: 'solid.draft', hint: 'M' },
      ]},
      { label: 'Surface', tools: [
        { id: 'solid.thicken',     label: 'Thicken', icon: 'solid.thicken', hint: 'Thicken surface → solid' },
        { id: 'solid.knit',        label: 'Knit',    icon: 'solid.knit', hint: 'Knit/sew surfaces → shell' },
        { id: 'solid.trimSurface', label: 'Trim Srf', icon: 'solid.trimSurface', hint: 'Trim surface to UV window' },
      ]},
    ]},
    { id: 'tab.pattern', label: 'Pattern', groups: [
      { label: 'Pattern', tools: [
        { id: 'pattern.linear',   label: 'Linear',   icon: 'pattern.linear', primary: true,
          flyout: [
            { id: 'pattern.linear',   label: 'Linear Pattern',   icon: 'pattern.linear' },
            { id: 'pattern.circular', label: 'Circular Pattern', icon: 'pattern.circular' },
            { id: 'pattern.curve',    label: 'Pattern on Curve', icon: 'pattern.curve' },
          ] },
        { id: 'pattern.circular', label: 'Circular', icon: 'pattern.circular' },
        { id: 'pattern.mirror',   label: 'Mirror',   icon: 'pattern.mirror', primary: true },
        { id: 'pattern.curve',    label: 'On curve', icon: 'pattern.curve' },
      ]},
      { label: 'Datum', tools: [
        { id: 'datum.offsetPlane', label: 'Offset Plane', icon: 'sketch.rect', hint: 'Offset a plane/face', primary: true,
          flyout: [
            { id: 'datum.offsetPlane', label: 'Offset Plane',   icon: 'sketch.rect', hint: 'Offset a plane/face' },
            { id: 'datum.plane3pt',    label: 'Plane through 3 pts', icon: 'sketch.rect' },
            { id: 'datum.midPlane',    label: 'Mid Plane',      icon: 'sketch.rect' },
            { id: 'datum.axis2pt',     label: 'Axis through 2 pts', icon: 'sketch.line' },
          ] },
        { id: 'datum.plane3pt',    label: 'Plane 3pt',    icon: 'sketch.rect', hint: 'Plane through 3 points' },
        { id: 'datum.midPlane',    label: 'Mid Plane',    icon: 'sketch.rect', hint: 'Mid-plane between 2 planes' },
        { id: 'datum.axis2pt',     label: 'Axis 2pt',     icon: 'sketch.line', hint: 'Axis through 2 points' },
      ]},
      { label: 'Boolean', tools: [
        { id: 'bool.union',  label: 'Union',  icon: 'bool.union', primary: true,
          flyout: [
            { id: 'bool.union',  label: 'Union',  icon: 'bool.union' },
            { id: 'bool.cut',    label: 'Cut',    icon: 'bool.cut' },
            { id: 'bool.common', label: 'Common', icon: 'bool.common' },
            { id: 'bool.split',  label: 'Split',  icon: 'bool.split' },
          ] },
        { id: 'bool.cut',    label: 'Cut',    icon: 'bool.cut' },
        { id: 'bool.common', label: 'Common', icon: 'bool.common' },
        { id: 'bool.split',  label: 'Split',  icon: 'bool.split' },
      ]},
    ]},
    { id: 'tab.evaluate', label: 'Evaluate', groups: [
      { label: 'Measure', tools: [
        { id: 'measure.distance',  label: 'Distance', icon: 'measure.distance', primary: true,
          flyout: [
            { id: 'measure.distance', label: 'Distance', icon: 'measure.distance' },
            { id: 'measure.angle',    label: 'Angle',    icon: 'measure.angle' },
            { id: 'measure.area',     label: 'Area',     icon: 'measure.area' },
          ] },
        { id: 'measure.angle',     label: 'Angle',    icon: 'measure.angle' },
        { id: 'measure.area',      label: 'Area',     icon: 'measure.area' },
        { id: 'measure.mass',      label: 'Mass',     icon: 'measure.mass', primary: true },
        { id: 'measure.interfere', label: 'Interfere', icon: 'measure.interfere' },
      ]},
      { label: 'Export', tools: [
        { id: 'io.step',  label: 'STEP',  icon: 'io.step', primary: true,
          flyout: [
            { id: 'io.step',  label: 'STEP',  icon: 'io.step' },
            { id: 'io.iges',  label: 'IGES',  icon: 'io.iges' },
            { id: 'io.brep',  label: 'BREP',  icon: 'io.brep' },
            { id: 'io.stl',   label: 'STL',   icon: 'io.stl' },
            { id: 'io.pdf',   label: 'PDF',   icon: 'io.pdf' },
          ] },
        { id: 'io.iges',  label: 'IGES',  icon: 'io.iges' },
        { id: 'io.stl',   label: 'STL',   icon: 'io.stl' },
        { id: 'io.brep',  label: 'BREP',  icon: 'io.brep' },
        { id: 'io.pdf',   label: 'PDF',   icon: 'io.pdf' },
      ]},
    ]},
  ],
  drawing: [
    { id: 'tab.drawing', label: 'Drawing', groups: [
      { label: 'Views', tools: [
        { id: 'view.iso',    label: 'Iso',     icon: 'view.iso', primary: true,
          flyout: [
            { id: 'view.iso',   label: 'Isometric', icon: 'view.iso' },
            { id: 'view.front', label: 'Front',     icon: 'view.front' },
            { id: 'view.top',   label: 'Top',       icon: 'view.top' },
            { id: 'view.right', label: 'Right',      icon: 'view.right' },
          ] },
        { id: 'view.front',  label: 'Front',   icon: 'view.front' },
        { id: 'view.top',    label: 'Top',     icon: 'view.top' },
        { id: 'view.right',  label: 'Right',   icon: 'view.right' },
        { id: 'view.section', label: 'Section', icon: 'view.section' },
      ]},
      { label: 'Dimension', tools: [
        { id: 'sketch.dim',      label: 'Linear',   icon: 'sketch.dim', primary: true },
        { id: 'measure.angle',   label: 'Angular',  icon: 'measure.angle' },
        { id: 'measure.distance',label: 'Radial',   icon: 'measure.distance' },
      ]},
      { label: 'Annotate', tools: [
        { id: 'sketch.constrain', label: 'GD&T',    icon: 'sketch.constrain', primary: true },
        { id: 'sketch.point',     label: 'Datum',   icon: 'sketch.point' },
        { id: 'io.pdf',           label: 'Title',   icon: 'io.pdf' },
      ]},
    ]},
  ],
  // Forge-127 — Sheet Metal ribbon: CATIA SMD layout, tabbed by stage.
  sheet: [
    { id: 'tab.sheet.create', label: 'Create', groups: [
      { label: 'Base', tools: [
        { id: 'sheet.baseFlange', label: 'Base Flange', icon: 'wb.sheet', hint: 'B', primary: true },
      ]},
      { label: 'Flange', tools: [
        { id: 'sheet.edgeFlange',       label: 'Edge',        icon: 'wb.sheet', primary: true,
          flyout: [
            { id: 'sheet.edgeFlange',       label: 'Edge Flange',        icon: 'wb.sheet' },
            { id: 'sheet.edgeFlangeRelief', label: 'Edge + Relief',      icon: 'wb.sheet' },
            { id: 'sheet.miterFlange',      label: 'Miter Flange',       icon: 'solid.chamfer' },
            { id: 'sheet.loftedFlange',     label: 'Lofted Flange',      icon: 'solid.loft' },
            { id: 'sheet.sweptFlange',      label: 'Swept Flange',       icon: 'solid.sweep' },
          ] },
        { id: 'sheet.edgeFlangeRelief', label: 'Edge+Relief', icon: 'wb.sheet' },
        { id: 'sheet.miterFlange',      label: 'Miter',       icon: 'solid.chamfer' },
        { id: 'sheet.miterFlangeChain', label: 'Miter Chain', icon: 'solid.chamfer' },
        { id: 'sheet.loftedFlange',     label: 'Lofted',      icon: 'solid.loft' },
        { id: 'sheet.sweptFlange',      label: 'Swept',       icon: 'solid.sweep' },
      ]},
      { label: 'Bend', tools: [
        { id: 'sheet.sketchedBend', label: 'Sketched', icon: 'solid.draft', primary: true },
        { id: 'sheet.jog',          label: 'Jog',      icon: 'solid.draft' },
        { id: 'sheet.jogRelief',    label: 'Jog Relief', icon: 'solid.draft' },
      ]},
    ]},
    { id: 'tab.sheet.form', label: 'Form & Corner', groups: [
      { label: 'Forming', tools: [
        { id: 'sheet.louver',      label: 'Louver',    icon: 'pattern.linear', primary: true },
        { id: 'sheet.lance',       label: 'Lance',     icon: 'sketch.line' },
        { id: 'sheet.ribForm',     label: 'Rib',       icon: 'solid.rib' },
        { id: 'sheet.dimple',      label: 'Dimple',    icon: 'sketch.circle' },
        { id: 'sheet.drawnCutout', label: 'Drawn',     icon: 'bool.cut' },
        { id: 'sheet.crossBreak',  label: 'X-Break',   icon: 'pattern.mirror' },
      ]},
      { label: 'Corner', tools: [
        { id: 'sheet.hemClosed',    label: 'Hem Closed', icon: 'solid.fillet', primary: true,
          flyout: [
            { id: 'sheet.hemClosed',   label: 'Hem Closed',  icon: 'solid.fillet' },
            { id: 'sheet.hemOpen',     label: 'Hem Open',    icon: 'solid.fillet' },
            { id: 'sheet.hemRolled',   label: 'Hem Rolled',  icon: 'solid.fillet' },
            { id: 'sheet.hemTeardrop', label: 'Hem Teardrop', icon: 'solid.fillet' },
          ] },
        { id: 'sheet.hemOpen',      label: 'Hem Open',   icon: 'solid.fillet' },
        { id: 'sheet.hemRolled',    label: 'Hem Rolled', icon: 'solid.fillet' },
        { id: 'sheet.hemTeardrop',  label: 'Hem Tear',   icon: 'solid.fillet' },
        { id: 'sheet.closedCorner', label: 'Closed Corner', icon: 'solid.shell' },
        { id: 'sheet.cornerRelief', label: 'Corner Relief', icon: 'sketch.constrain' },
      ]},
      { label: 'Flat', tools: [
        { id: 'sheet.unfold',      label: 'Unfold', icon: 'solid.draft', primary: true },
        { id: 'sheet.flatPattern', label: 'Flat',   icon: 'pattern.linear', primary: true },
      ]},
    ]},
  ],
  weld: [
    { id: 'tab.weld', label: 'Weldments', groups: [
      { label: 'Weldments', tools: [
        { id: 'weld.member',  label: 'Member',   icon: 'wb.weldments', primary: true },
        { id: 'weld.endcap',  label: 'End cap',  icon: 'solid.shell' },
        { id: 'weld.gusset',  label: 'Gusset',   icon: 'solid.rib' },
        { id: 'weld.bead',    label: 'Bead',     icon: 'weld.bead', primary: true },
        { id: 'weld.trim',    label: 'Trim',     icon: 'sketch.trim' },
        { id: 'weld.cutlist', label: 'Cut list', icon: 'io.pdf' },
      ]},
    ]},
  ],
  mold: [
    { id: 'tab.mold', label: 'Mold Tools', groups: [
      { label: 'Mold Tools', tools: [
        { id: 'mold.parting',  label: 'Parting',  icon: 'wb.mold', primary: true },
        { id: 'mold.core',     label: 'Core',     icon: 'solid.extrude' },
        { id: 'mold.cavity',   label: 'Cavity',   icon: 'bool.cut', primary: true },
        { id: 'mold.draft',    label: 'Draft',    icon: 'solid.draft' },
        { id: 'mold.runner',   label: 'Runner',   icon: 'solid.sweep' },
      ]},
    ]},
  ],
  sim: [
    { id: 'tab.sim', label: 'Study', groups: [
      { label: 'Study', tools: [
        { id: 'sim.static',   label: 'Static',   icon: 'wb.sim', primary: true },
        { id: 'sim.modal',    label: 'Modal',    icon: 'wb.sim' },
        { id: 'sim.dynamic',  label: 'Dynamic',  icon: 'wb.sim' },
        { id: 'sim.thermal',  label: 'Thermal',  icon: 'wb.sim', primary: true },
        { id: 'sim.cfd',      label: 'CFD',      icon: 'wb.sim' },
      ]},
    ]},
  ],
  mfg: [
    { id: 'tab.mfg', label: 'Toolpaths', groups: [
      { label: 'Toolpaths', tools: [
        { id: 'mfg.face',    label: 'Face',    icon: 'wb.mfg', primary: true },
        { id: 'mfg.contour', label: 'Contour', icon: 'wb.mfg' },
        { id: 'mfg.pocket',  label: 'Pocket',  icon: 'wb.mfg', primary: true },
        { id: 'mfg.drill',   label: 'Drill',   icon: 'solid.hole' },
        { id: 'mfg.5axis',   label: '5-axis',  icon: 'wb.mfg' },
        { id: 'mfg.post',    label: 'Post',    icon: 'io.pdf' },
      ]},
    ]},
  ],
};

// ---------------------------------------------------------------------------
// Backwards-compatible legacy shape. The shell + RoleSwitcher + command
// palette historically consumed `toolsForWorkbench(id)` returning a flat
// list of {label, tools[]} GROUPS. We keep that exact contract by flattening
// every tab's groups, so nothing downstream changes.
// ---------------------------------------------------------------------------
function flattenGroups(tabs) {
  const out = [];
  (tabs || []).forEach((tab) => (tab.groups || []).forEach((g) => out.push(g)));
  return out;
}

// The role transformer (`__forgeRoleApply`) was written against the OLD
// flat {wb: groups[]} spec. Build that view, transform it, then re-key the
// transformed groups back onto each workbench's tabbed structure by label so
// role pinning keeps working without the transformer needing to know tabs.
function buildLegacySpec(tabbed) {
  const flat = {};
  Object.keys(tabbed).forEach((wb) => { flat[wb] = flattenGroups(tabbed[wb]); });
  return flat;
}

const LEGACY_SPEC = buildLegacySpec(SPEC);

// ---------------------------------------------------------------------------
// RibbonPopover — a portal-mounted popover anchored under a trigger element.
// The ribbon zone is `overflow: hidden` (so we can do clean overflow handling),
// so flyouts/overflow menus are portalled to <body> and fixed-positioned under
// their anchor (and clamped to the viewport), like the Tooltip primitive.
// ---------------------------------------------------------------------------
function RibbonPopover({ anchorRef, open, onClose, className, align = 'left', children, label }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !popRef.current) return undefined;
    const place = () => {
      const a = anchorRef.current; const p = popRef.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      const vw = window.innerWidth; const vh = window.innerHeight; const PAD = 6;
      let x = align === 'right' ? r.right - pr.width : r.left;
      let y = r.bottom + 4;
      x = Math.max(PAD, Math.min(x, vw - pr.width - PAD));
      if (y + pr.height > vh - PAD) y = Math.max(PAD, r.top - pr.height - 4);
      setPos({ x, y });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (anchorRef.current && anchorRef.current.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('keydown', onKey); };
  }, [open, anchorRef, onClose]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={popRef}
      className={className}
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', left: (pos?.x ?? -9999), top: (pos?.y ?? -9999) }}
    >
      {children}
    </div>,
    document.body,
  );
}

function FlyoutItems({ items, activeTool, onInvoke, onClose }) {
  return items.map((f) => (
    <button
      key={f.id}
      type="button"
      role="menuitem"
      className="forge-ribbon-flyout-item"
      data-tool={f.id}
      data-active={String(activeTool === f.id)}
      onClick={() => { onInvoke?.(f.id); onClose?.(); }}
    >
      <Icon name={f.icon} size={16} />
      <span className="forge-ribbon-flyout-label">{f.label}</span>
      {f.hint ? <span className="forge-ribbon-flyout-hint">{f.hint}</span> : null}
    </button>
  ));
}

// ---------------------------------------------------------------------------
// Split-button: a primary action + a chevron that opens a flyout of variants.
// `measuring` renders the same markup at the same width but omits the testable
// data-* attributes + interactivity (used only by the off-screen sizing row).
// ---------------------------------------------------------------------------
function SplitButton({ tool, activeTool, onInvoke, measuring }) {
  const [open, setOpen] = useState(false);
  const caretRef = useRef(null);
  const isActive = activeTool === tool.id ||
    (tool.flyout || []).some((f) => f.id === activeTool);

  const primaryBtn = (
    <button
      type="button"
      className="forge-tool forge-tool--primary"
      data-tool={measuring ? undefined : tool.id}
      data-active={measuring ? undefined : String(isActive)}
      aria-label={tool.label}
      aria-pressed={isActive}
      tabIndex={measuring ? -1 : undefined}
      onClick={measuring ? undefined : () => onInvoke?.(tool.id)}
    >
      <Icon name={tool.icon} size={20} />
      <span className="forge-tool-label">{tool.label}</span>
    </button>
  );

  return (
    <div className="forge-ribbon-split">
      {measuring ? primaryBtn : (
        <Tooltip label={tool.label} hint={tool.hint} placement="bottom">{primaryBtn}</Tooltip>
      )}
      <button
        ref={caretRef}
        type="button"
        className="forge-ribbon-split-caret"
        data-active={measuring ? undefined : String(open)}
        aria-label={`${tool.label} options`}
        aria-haspopup="true"
        aria-expanded={open}
        tabIndex={measuring ? -1 : undefined}
        onClick={measuring ? undefined : () => setOpen((v) => !v)}
      >
        <ChevronDown size={11} />
      </button>
      {!measuring && (
        <RibbonPopover
          anchorRef={caretRef}
          open={open}
          onClose={() => setOpen(false)}
          className="forge-ribbon-flyout"
          label={`${tool.label} options`}
        >
          <FlyoutItems
            items={tool.flyout || []}
            activeTool={activeTool}
            onInvoke={onInvoke}
            onClose={() => setOpen(false)}
          />
        </RibbonPopover>
      )}
    </div>
  );
}

// A single primary (large, labeled) or secondary (compact icon) button.
function ToolButton({ tool, activeTool, onInvoke, measuring }) {
  if (tool.flyout && tool.flyout.length > 1) {
    return <SplitButton tool={tool} activeTool={activeTool} onInvoke={onInvoke} measuring={measuring} />;
  }
  const isActive = activeTool === tool.id;
  const isPrimary = !!tool.primary;
  const btn = (
    <button
      type="button"
      className={isPrimary ? 'forge-tool forge-tool--primary' : 'forge-tool'}
      data-tool={measuring ? undefined : tool.id}
      data-active={measuring ? undefined : String(isActive)}
      aria-label={tool.label}
      aria-pressed={isActive}
      tabIndex={measuring ? -1 : undefined}
      onClick={measuring ? undefined : () => onInvoke?.(tool.id)}
    >
      <Icon name={tool.icon} size={isPrimary ? 20 : 18} />
      {isPrimary ? <span className="forge-tool-label">{tool.label}</span> : null}
    </button>
  );
  if (measuring) return btn;
  return (
    <Tooltip label={tool.label} hint={tool.hint} placement="bottom">{btn}</Tooltip>
  );
}

function ToolGroup({ group, activeTool, onInvoke, measuring }) {
  return (
    <div className="forge-toolbar-group" role="group" aria-label={group.label}>
      <div className="forge-toolbar-group-tools">
        {group.tools.map((t) => (
          <ToolButton key={t.id} tool={t} activeTool={activeTool} onInvoke={onInvoke} measuring={measuring} />
        ))}
      </div>
      <span className="forge-toolbar-group-label">{group.label}</span>
    </div>
  );
}

// Overflow menu — the groups that don't fit collapse into a "⋯" popover so we
// never fall back to a sideways scroll strip.
function OverflowMenu({ groups, activeTool, onInvoke }) {
  const [open, setOpen] = useState(false);
  // Anchor to the wrapper (not the button) — the Tooltip's cloneElement would
  // otherwise overwrite a ref placed on the trigger button.
  const wrapRef = useRef(null);
  if (!groups.length) return null;
  return (
    <div className="forge-ribbon-overflow" ref={wrapRef}>
      <Tooltip label="More tools" placement="bottom">
        <button
          type="button"
          className="forge-tool forge-ribbon-overflow-btn"
          data-active={String(open)}
          aria-label="More tools"
          aria-haspopup="true"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <MoreGlyph size={16} />
        </button>
      </Tooltip>
      <RibbonPopover
        anchorRef={wrapRef}
        open={open}
        onClose={() => setOpen(false)}
        className="forge-ribbon-overflow-menu"
        align="right"
        label="More tools"
      >
        {groups.map((g) => (
          <div key={g.label} className="forge-ribbon-overflow-group">
            <span className="forge-ribbon-overflow-group-label">{g.label}</span>
            <div className="forge-ribbon-overflow-grid">
              <FlyoutItems
                items={g.tools}
                activeTool={activeTool}
                onInvoke={onInvoke}
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        ))}
      </RibbonPopover>
    </div>
  );
}

export function Toolbar({ workbenchId, activeTool, onInvoke }) {
  // Forge-137 — re-render when role changes so the role-aware spec takes
  // effect. The transformer lives on window so this file does not have a
  // hard dependency on RoleSwitcher (it works whether the host mounted
  // or not).
  const [roleRev, setRoleRev] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const bump = () => setRoleRev((n) => n + 1);
    window.addEventListener('forge:role-applied', bump);
    return () => window.removeEventListener('forge:role-applied', bump);
  }, []);

  const tabs = SPEC[workbenchId] || SPEC.mech;

  // Active ribbon tab — reset to the first tab when the workbench changes.
  const [activeTabId, setActiveTabId] = useState(tabs[0]?.id);
  useEffect(() => { setActiveTabId(tabs[0]?.id); }, [workbenchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Role transformer still operates on the LEGACY flat {wb: groups[]} spec.
  // We apply it, then map the transformed groups (matched by label) back onto
  // the current tab's groups so role pinning continues to filter the tools.
  const apply = (typeof window !== 'undefined' && typeof window.__forgeRoleApply === 'function')
    ? window.__forgeRoleApply : null;
  const legacyEffective = apply ? apply(LEGACY_SPEC) : LEGACY_SPEC;
  const allowedByLabel = {};
  (legacyEffective[workbenchId] || LEGACY_SPEC[workbenchId] || []).forEach((g) => {
    allowedByLabel[g.label] = new Set(g.tools.map((t) => t.id));
  });
  const hasRole = !!apply && !!(legacyEffective[workbenchId] || LEGACY_SPEC[workbenchId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  let groups = (activeTab?.groups || []);
  // Apply role filtering when a role transformer is present.
  if (hasRole) {
    groups = groups
      .map((g) => {
        const allow = allowedByLabel[g.label];
        if (!allow) return g;
        return { ...g, tools: g.tools.filter((t) => allow.has(t.id)) };
      })
      .filter((g) => g.tools.length > 0);
  }

  // ----- overflow handling -----
  // Two-pass + cached widths so it never flickers: an off-screen measurement
  // row renders ALL groups once per spec change and records their intrinsic
  // widths; a second effect derives how many fit from those cached widths and
  // the live strip width (re-derived on resize, no DOM re-measure of the cut
  // set — which would otherwise oscillate as groups enter/leave the overflow).
  const stripRef = useRef(null);
  const measureRef = useRef(null);
  const widthsRef = useRef([]);
  const [visibleCount, setVisibleCount] = useState(groups.length);
  const measureKey = `${workbenchId}::${activeTabId}::${roleRev}::${groups.map((g) => g.label).join(',')}`;

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    widthsRef.current = Array.from(el.querySelectorAll('[data-measure-group]'))
      .map((c) => c.getBoundingClientRect().width);
  }, [measureKey]);

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;
    const fitCount = () => {
      const widths = widthsRef.current;
      if (!widths.length) return groups.length;
      const avail = el.getBoundingClientRect().width;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail) return widths.length;     // everything fits — no tail
      // Doesn't all fit: reserve room for the ⋯ tail, then greedily pack.
      const TAIL = 44;
      let used = 0; let fit = 0;
      for (let i = 0; i < widths.length; i += 1) {
        if (used + widths[i] + TAIL <= avail) { used += widths[i]; fit = i + 1; }
        else break;
      }
      return Math.max(1, fit);
    };
    const apply2 = () => setVisibleCount(fitCount());
    apply2();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply2) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', apply2);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', apply2); };
  }, [measureKey, groups.length]);

  const shown = groups.slice(0, visibleCount);
  const overflow = groups.slice(visibleCount);

  return (
    <div className="forge-toolbar forge-ribbon"
         role="toolbar"
         aria-label={`${workbenchId} tools`}
         data-testid="forge-toolbar"
         data-role-rev={roleRev}>
      {tabs.length > 1 && (
        <div className="forge-ribbon-tabs" role="tablist" aria-label="Ribbon tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className="forge-ribbon-tab"
              data-ribbon-tab={tab.id}
              data-active={String(tab.id === activeTab?.id)}
              aria-selected={tab.id === activeTab?.id}
              onClick={() => setActiveTabId(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <span className="forge-ribbon-tabs-sep" aria-hidden="true" />
        </div>
      )}
      <div className="forge-ribbon-strip" ref={stripRef}>
        {shown.map((g) => (
          <div key={g.label} data-ribbon-group={g.label} className="forge-ribbon-group-wrap">
            <ToolGroup group={g} activeTool={activeTool} onInvoke={onInvoke} />
          </div>
        ))}
        {overflow.length > 0 && (
          <OverflowMenu groups={overflow} activeTool={activeTool} onInvoke={onInvoke} />
        )}
      </div>
      {/* Off-screen measurement row — renders ALL groups at intrinsic width so
          overflow math is stable regardless of what is currently shown. */}
      <div ref={measureRef} className="forge-ribbon-measure" aria-hidden="true">
        {groups.map((g) => (
          <div key={g.label} data-measure-group={g.label} className="forge-ribbon-group-wrap">
            <ToolGroup group={g} activeTool={activeTool} onInvoke={() => {}} measuring />
          </div>
        ))}
      </div>
    </div>
  );
}

export function toolsForWorkbench(id) { return LEGACY_SPEC[id] || []; }
