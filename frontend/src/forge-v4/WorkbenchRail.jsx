// Forge-65 — left workbench rail.
//
// 60 px slim column hosting one tab per workbench. Active tab gets a
// copper border + label + a 3 px left stripe; the rest sit muted.
// Designed for at-a-glance recognition: the user always sees which
// workbench they're in without reading.

import React from 'react';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

export const WORKBENCHES = [
  { id: 'mech',     icon: 'wb.mech',     label: 'Part' },
  { id: 'draft',    icon: 'sketch.line', label: 'Draft' },
  { id: 'drawing',  icon: 'wb.drawing',  label: 'Drawing' },
  { id: 'sheet',    icon: 'wb.sheet',    label: 'Sheet' },
  { id: 'weld',     icon: 'wb.weldments',label: 'Weld' },
  { id: 'mold',     icon: 'wb.mold',     label: 'Mold' },
  { id: 'sim',      icon: 'wb.sim',      label: 'Sim' },
  { id: 'mfg',      icon: 'wb.mfg',      label: 'Mfg' },
  // Forge-150 — Arch/BIM workbench (FreeCAD Arch parity).
  { id: 'arch',     icon: 'wb.arch',     label: 'Arch' },
  // Forge-151 — Mesh workbench (polygonal mesh tools).
  { id: 'mesh',     icon: 'select.body', label: 'Mesh' },
  // Forge-152 — Industrial 6-axis robot workbench (KUKA / ABB / FANUC).
  { id: 'robot',    icon: 'wb.robot',    label: 'Robot' },
  // Forge-171 — Aerospace airfoil + wing designer (NACA / Selig / loft).
  { id: 'aero',     icon: 'wb.sim',      label: 'Aero' },
  // Forge-176 — Geotechnical slope stability (Bishop + Janbu).
  { id: 'geotech',  icon: 'wb.arch',     label: 'Geotech' },
  // Forge-173 — Casting solidification (enthalpy FDM).
  { id: 'casting',  icon: 'wb.sim',      label: 'Cast' },
  // Forge-172 — Injection mould flow (Hele-Shaw + Cross-WLF).
  { id: 'moldflow', icon: 'wb.mold',     label: 'MoldFlow' },
  // Forge-175 — Acoustic room simulator (image-source method).
  { id: 'acoustics',icon: 'wb.sim',      label: 'Acoust' },
  // Forge-174 — Welding distortion FEA (Goldak + thermo-mechanical).
  { id: 'welddist', icon: 'wb.weldments',label: 'WeldFEA' },
  // Forge-179 — Cost estimation (material × machining × labour).
  { id: 'cost',     icon: 'wb.mfg',      label: 'Cost' },
  // Forge-180 — Carbon-footprint LCA (cradle-to-gate).
  { id: 'carbon',   icon: 'wb.sim',      label: 'Carbon' },
  // Forge-181 — Sun-path + daylight analysis (NOAA SPA).
  { id: 'sunpath',  icon: 'wb.arch',     label: 'SunPath' },
  // Forge-185 — Tolerance stack-up (worst-case + RSS + Monte-Carlo).
  { id: 'tolerance',icon: 'wb.mfg',      label: 'Stackup' },
  // Forge-186 — HVAC ductwork (ASHRAE sizing + pressure drop).
  { id: 'duct',     icon: 'wb.arch',     label: 'Ductwork' },
  // Forge-187 — Generative variant explorer.
  { id: 'variants', icon: 'wb.sim',      label: 'Variants' },
  // Forge-192 — HVAC psychrometric chart.
  { id: 'psychro',  icon: 'wb.arch',     label: 'Psychro' },
  // Forge-190 — Electrical schematic + MNA DC/AC.
  { id: 'circuit',  icon: 'wb.sim',      label: 'Circuit' },
  // Forge-191 — Civil terrain (Delaunay + cut/fill).
  { id: 'terrain',  icon: 'wb.arch',     label: 'Terrain' },
  // Forge-194 — Reverse-engineering NURBS surface fit.
  { id: 'nurbsfit', icon: 'wb.sim',      label: 'NURBSfit' },
  // Forge-193 — Time-series log viewer (FEA / CFD / acoustics).
  { id: 'tsviewer', icon: 'archie.spark',label: 'Logs' },
  // Forge-196 — ARIA / accessibility audit.
  { id: 'a11y',     icon: 'misc.kbd',    label: 'A11y' },
];

export function WorkbenchRail({ activeId, onSwitch }) {
  return (
    <nav className="forge-wb-rail"
         aria-label="Workbenches"
         data-testid="forge-wb-rail">
      {WORKBENCHES.map((wb) => (
        <Tooltip key={wb.id} label={wb.label} placement="right">
          <button
            type="button"
            className="forge-wb-tab"
            data-wb={wb.id}
            data-active={String(activeId === wb.id)}
            onClick={() => onSwitch?.(wb.id)}
            aria-pressed={activeId === wb.id}
          >
            <Icon name={wb.icon} size={24} className="forge-wb-tab-glyph" />
            <span className="forge-wb-tab-label">{wb.label}</span>
          </button>
        </Tooltip>
      ))}
    </nav>
  );
}
