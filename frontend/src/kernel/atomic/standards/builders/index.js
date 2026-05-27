/**
 * ArchDisc Kernel — Atomic-CAD standards-builder dispatcher.
 *
 * Maps catalog `builderKey` (from `data/index.js` STANDARDS_CATALOG) to
 * the concrete builder function. The Standards Library dialog passes the
 * `builderKey` + the size + length (+ grade) to ToolExecutionEngine,
 * which calls `placeStandard(builderKey, part, opts)`.
 */

import * as Fastener from './Fastener.js';
import * as StructuralSection from './StructuralSection.js';
import * as Bearing from './Bearing.js';
import * as ClearanceHole from './ClearanceHole.js';
import * as Spacecraft from './Spacecraft.js';

const BUILDERS = {
  iso4762:      Fastener.iso4762,
  iso4014:      Fastener.iso4014,
  iso4017:      Fastener.iso4017,
  iso4032:      Fastener.iso4032,
  iso7089:      Fastener.iso7089,
  iso7090:      Fastener.iso7090,
  asmeB18_2_1:  Fastener.asmeB18_2_1,
  asmeB18_3:    Fastener.asmeB18_3,
  aiscW:        StructuralSection.aiscW,
  aiscL:        StructuralSection.aiscL,
  aiscHSS:      StructuralSection.aiscHSS,
  skfDeepGroove: Bearing.skfDeepGroove,
  skfTapered:    Bearing.skfTapered,
  clearanceHole: ClearanceHole.cutClearanceHole,
  merlinBell:           Spacecraft.merlinBell,
  merlinChamber:        Spacecraft.merlinChamber,
  merlinTurbopump:      Spacecraft.merlinTurbopump,
  merlinPlumbingSpoke:  Spacecraft.merlinPlumbingSpoke,
  falcon9Dome:          Spacecraft.falcon9Dome,
  falcon9EngineMount:   Spacecraft.falcon9EngineMount,
  falcon9HeatShield:    Spacecraft.falcon9HeatShieldPanel,
  falcon9ThrustPad:     Spacecraft.falcon9ThrustPad,
};

export function getBuilder(builderKey) {
  const b = BUILDERS[builderKey];
  if (!b) throw new Error(`Standards builder: unknown key '${builderKey}'`);
  return b;
}

export async function placeStandard(builderKey, part, opts) {
  return getBuilder(builderKey)(part, opts);
}

export { Fastener, StructuralSection, Bearing, ClearanceHole, Spacecraft };
