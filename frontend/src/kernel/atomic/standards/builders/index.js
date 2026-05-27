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
import * as Automotive from './Automotive.js';

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
  // SP-2 — Volvo FH front fascia (Video-21 parity reference)
  volvoCabFrontPanel:       Automotive.volvoCabFrontPanel,
  volvoRadiatorGrillePanel: Automotive.volvoRadiatorGrillePanel,
  volvoLowerIntakeSlatBank: Automotive.volvoLowerIntakeSlatBank,
  volvoBumperMain:          Automotive.volvoBumperMain,
  volvoBumperLowerTrim:     Automotive.volvoBumperLowerTrim,
  volvoBumperSideCap:       Automotive.volvoBumperSideCap,
  volvoHeadlightCluster:    Automotive.volvoHeadlightCluster,
  volvoLogoEmboss:          Automotive.volvoLogoEmboss,
  volvoLBadge:              Automotive.volvoLBadge,
  volvoCabFrontStepPlate:   Automotive.volvoCabFrontStepPlate,
  volvoHeadlightLouver:     Automotive.volvoHeadlightLouver,
  volvoCabStepTread:        Automotive.volvoCabStepTread,
  volvoTowHookMount:        Automotive.volvoTowHookMount,
  volvoCabSidePillar:       Automotive.volvoCabSidePillar,
  volvoOrangeAccent:        Automotive.volvoOrangeAccent,
  volvoLicensePlateFrame:   Automotive.volvoLicensePlateFrame,
  volvoLicensePlatePanel:   Automotive.volvoLicensePlatePanel,
  volvoFogLightCluster:     Automotive.volvoFogLightCluster,
  volvoWingMirror:          Automotive.volvoWingMirror,
  volvoRoofSunVisor:        Automotive.volvoRoofSunVisor,
  volvoMudFlap:             Automotive.volvoMudFlap,
  volvoLowerSideSkirt:      Automotive.volvoLowerSideSkirt,
  volvoDoorHandleRecess:    Automotive.volvoDoorHandleRecess,
  volvoRoofBeaconBar:       Automotive.volvoRoofBeaconBar,
  // SP-3 cab body
  volvoCabSidePanel:        Automotive.volvoCabSidePanel,
  volvoCabRearPanel:        Automotive.volvoCabRearPanel,
  volvoCabRoofPanel:        Automotive.volvoCabRoofPanel,
  volvoCabFloorPanel:       Automotive.volvoCabFloorPanel,
  volvoWindshield:          Automotive.volvoWindshield,
  volvoSideWindow:          Automotive.volvoSideWindow,
  volvoCabDoor:             Automotive.volvoCabDoor,
  volvoRoofAirDeflector:    Automotive.volvoRoofAirDeflector,
  volvoAPillar:             Automotive.volvoAPillar,
  volvoBPillar:             Automotive.volvoBPillar,
  volvoWheelArchCover:      Automotive.volvoWheelArchCover,
  volvoRoofMarkerLight:     Automotive.volvoRoofMarkerLight,
  volvoExhaustStack:        Automotive.volvoExhaustStack,
  // SP-4 chassis + powertrain
  volvoFrameRail:           Automotive.volvoFrameRail,
  volvoFrameCrossMember:    Automotive.volvoFrameCrossMember,
  volvoFuelTank:            Automotive.volvoFuelTank,
  volvoAxleBeam:            Automotive.volvoAxleBeam,
  volvoWheelRim:            Automotive.volvoWheelRim,
  volvoTire:                Automotive.volvoTire,
  volvoBrakeDrum:           Automotive.volvoBrakeDrum,
  volvoDriveShaft:          Automotive.volvoDriveShaft,
  volvoDifferentialHousing: Automotive.volvoDifferentialHousing,
  volvoLeafSpring:          Automotive.volvoLeafSpring,
  volvoShockAbsorber:       Automotive.volvoShockAbsorber,
  volvoAirSuspensionBellows: Automotive.volvoAirSuspensionBellows,
  volvoBatteryBox:          Automotive.volvoBatteryBox,
  volvoAirCompressorTank:   Automotive.volvoAirCompressorTank,
  volvoEngineBlock:         Automotive.volvoEngineBlock,
  volvoCylinderHead:        Automotive.volvoCylinderHead,
  volvoTurbocharger:        Automotive.volvoTurbocharger,
  volvoIntakeManifold:      Automotive.volvoIntakeManifold,
  volvoExhaustManifold:     Automotive.volvoExhaustManifold,
  volvoRadiatorModule:      Automotive.volvoRadiatorModule,
  volvoCoolingFan:          Automotive.volvoCoolingFan,
  // SP-5 cab interior
  volvoDriverSeatBase:      Automotive.volvoDriverSeatBase,
  volvoDriverSeatBack:      Automotive.volvoDriverSeatBack,
  volvoSeatHeadrest:        Automotive.volvoSeatHeadrest,
  volvoSteeringWheelRim:    Automotive.volvoSteeringWheelRim,
  volvoSteeringWheelBoss:   Automotive.volvoSteeringWheelBoss,
  volvoSteeringWheelSpoke:  Automotive.volvoSteeringWheelSpoke,
  volvoSteeringColumn:      Automotive.volvoSteeringColumn,
  volvoDashboard:           Automotive.volvoDashboard,
  volvoInstrumentCluster:   Automotive.volvoInstrumentCluster,
  volvoGearShifter:         Automotive.volvoGearShifter,
  volvoFootPedal:           Automotive.volvoFootPedal,
  volvoACVent:              Automotive.volvoACVent,
  volvoDoorCard:            Automotive.volvoDoorCard,
  volvoSunVisorInterior:    Automotive.volvoSunVisorInterior,
  volvoCentreConsole:       Automotive.volvoCentreConsole,
  volvoCupHolder:           Automotive.volvoCupHolder,
  volvoSleeperBunk:         Automotive.volvoSleeperBunk,
  volvoHeadliner:           Automotive.volvoHeadliner,
};

export function getBuilder(builderKey) {
  const b = BUILDERS[builderKey];
  if (!b) throw new Error(`Standards builder: unknown key '${builderKey}'`);
  return b;
}

export async function placeStandard(builderKey, part, opts) {
  return getBuilder(builderKey)(part, opts);
}

export { Fastener, StructuralSection, Bearing, ClearanceHole, Spacecraft, Automotive };
