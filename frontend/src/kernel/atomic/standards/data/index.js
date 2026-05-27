/**
 * ArchDisc Kernel — Standards-library catalog index.
 *
 * Re-exports every catalog + provides the STANDARDS_CATALOG map the
 * Standards Library dialog browses. Keys mirror the dialog's tree.
 */

export * from './iso.js';
export * from './asme.js';
export * from './aisc.js';
export * from './skf.js';
export * from './spacecraft.js';
export * from './automotive.js';

import {
  ISO_4762, ISO_4014, ISO_4017, ISO_4032, ISO_7089, ISO_7090,
  ISO_273, ISO_898_GRADES, ISO_SIZES,
} from './iso.js';
import {
  ASME_B18_2_1, ASME_B18_3, SAE_GRADES,
  ASME_HEX_SIZES, ASME_SHCS_SIZES,
} from './asme.js';
import {
  AISC_W_SHAPES, AISC_L_SHAPES, AISC_HSS_RECT,
  AISC_W_SIZES, AISC_L_SIZES, AISC_HSS_SIZES,
} from './aisc.js';
import {
  SKF_DEEP_GROOVE_LIGHT, SKF_DEEP_GROOVE_HEAVY,
  SKF_TAPERED_LIGHT, SKF_TAPERED_HEAVY,
  SKF_DEEP_GROOVE_LIGHT_DESIGNATIONS,
  SKF_DEEP_GROOVE_HEAVY_DESIGNATIONS,
  SKF_TAPERED_LIGHT_DESIGNATIONS,
  SKF_TAPERED_HEAVY_DESIGNATIONS,
} from './skf.js';

// Browser-tree-friendly catalog map. Each leaf has {standard, table,
// sizes, units, defaultLength_mm, builderKey}. The dialog reads this to
// build the category tree + size picker.
export const STANDARDS_CATALOG = {
  Fasteners: {
    'Socket Head Cap Screw (ISO 4762)': {
      standard: 'ISO 4762', table: ISO_4762, sizes: ISO_SIZES, units: 'mm',
      defaultLength_mm: 25, lengthSeries: [8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120],
      grades: Object.keys(ISO_898_GRADES), defaultGrade: '12.9', builderKey: 'iso4762',
    },
    'Hex Bolt partial-thread (ISO 4014)': {
      standard: 'ISO 4014', table: ISO_4014, sizes: ISO_SIZES, units: 'mm',
      defaultLength_mm: 50, lengthSeries: [16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 120, 140],
      grades: Object.keys(ISO_898_GRADES), defaultGrade: '12.9', builderKey: 'iso4014',
    },
    'Hex Bolt full-thread (ISO 4017)': {
      standard: 'ISO 4017', table: ISO_4017, sizes: ISO_SIZES, units: 'mm',
      defaultLength_mm: 40, lengthSeries: [16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100],
      grades: Object.keys(ISO_898_GRADES), defaultGrade: '10.9', builderKey: 'iso4017',
    },
    'Hex Nut (ISO 4032)': {
      standard: 'ISO 4032', table: ISO_4032, sizes: ISO_SIZES, units: 'mm',
      grades: Object.keys(ISO_898_GRADES), defaultGrade: '8', builderKey: 'iso4032',
    },
    'Plain Washer (ISO 7089)': {
      standard: 'ISO 7089', table: ISO_7089, sizes: ISO_SIZES, units: 'mm',
      builderKey: 'iso7089',
    },
    'Spring Lock Washer (ISO 7090)': {
      standard: 'ISO 7090', table: ISO_7090, sizes: ISO_SIZES, units: 'mm',
      builderKey: 'iso7090',
    },
    'SHCS UNC/UNF (ASME B18.3)': {
      standard: 'ASME B18.3', table: ASME_B18_3, sizes: ASME_SHCS_SIZES, units: 'in',
      defaultLength_in: 1.0, lengthSeries: [0.5, 0.625, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0],
      grades: Object.keys(SAE_GRADES), defaultGrade: '8', builderKey: 'asmeB18_3',
    },
    'Hex Cap Screw UNC/UNF (ASME B18.2.1)': {
      standard: 'ASME B18.2.1', table: ASME_B18_2_1, sizes: ASME_HEX_SIZES, units: 'in',
      defaultLength_in: 1.5, lengthSeries: [0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0],
      grades: Object.keys(SAE_GRADES), defaultGrade: '8', builderKey: 'asmeB18_2_1',
    },
  },
  'Steel Sections': {
    'W-Shape Wide-Flange (AISC)': {
      standard: 'AISC ASD 14th', table: AISC_W_SHAPES, sizes: AISC_W_SIZES, units: 'in',
      defaultLength_in: 60, lengthSeries: [12, 24, 36, 48, 60, 72, 96, 120, 144, 240, 360, 480],
      builderKey: 'aiscW',
    },
    'Angle (AISC L-shape)': {
      standard: 'AISC ASD 14th', table: AISC_L_SHAPES, sizes: AISC_L_SIZES, units: 'in',
      defaultLength_in: 36, lengthSeries: [12, 24, 36, 48, 60, 72, 96, 120, 144],
      builderKey: 'aiscL',
    },
    'HSS Rectangular Tube (AISC)': {
      standard: 'AISC ASD 14th', table: AISC_HSS_RECT, sizes: AISC_HSS_SIZES, units: 'in',
      defaultLength_in: 48, lengthSeries: [12, 24, 36, 48, 60, 72, 96, 120, 144],
      builderKey: 'aiscHSS',
    },
  },
  Spacecraft: {
    'Falcon 9 Thrust Dome (Al-Li 2195)': {
      standard: 'Falcon 9 ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'falcon9Dome',
    },
    'Falcon 9 Engine Mount Frustum': {
      standard: 'Falcon 9 ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'falcon9EngineMount',
    },
    'Merlin 1D Combustion Chamber': {
      standard: 'Merlin 1D ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'merlinChamber',
    },
    'Merlin 1D Bell Nozzle': {
      standard: 'Merlin 1D ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'merlinBell',
    },
    'Falcon 9 Heat Shield Panel': {
      standard: 'Falcon 9 ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'falcon9HeatShield',
    },
    'Falcon 9 Thrust Takeout Pad': {
      standard: 'Falcon 9 ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'falcon9ThrustPad',
    },
    'Merlin 1D Turbopump': {
      standard: 'Merlin 1D ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'merlinTurbopump',
    },
    'Merlin Plumbing Spoke': {
      standard: 'Falcon 9 ref', sizes: ['stock'], table: { stock: { } }, units: 'mm',
      builderKey: 'merlinPlumbingSpoke',
    },
  },
  Automotive: {
    'Cab Front Panel':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabFrontPanel' },
    'Radiator Grille Panel':     { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoRadiatorGrillePanel' },
    'Lower Intake Slat Bank':    { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLowerIntakeSlatBank' },
    'Bumper Main Section':       { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoBumperMain' },
    'Bumper Lower Trim':         { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoBumperLowerTrim' },
    'Bumper Side Cap':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoBumperSideCap' },
    'Headlight Cluster':         { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoHeadlightCluster' },
    'VOLVO Logo Emboss':         { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLogoEmboss' },
    'L Badge':                   { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLBadge' },
    'Cab Front Step Plate':      { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabFrontStepPlate' },
    'Headlight Surround Louver': { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoHeadlightLouver' },
    'Cab Step Tread':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabStepTread' },
    'Tow Hook Mount':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoTowHookMount' },
    'Cab Side Pillar':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabSidePillar' },
    'Orange Accent Trim':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoOrangeAccent' },
    'License Plate Frame':       { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLicensePlateFrame' },
    'License Plate Panel':       { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLicensePlatePanel' },
    'Fog Light Cluster':         { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoFogLightCluster' },
    'Wing Mirror Housing':       { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoWingMirror' },
    'Roof Sun Visor':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoRoofSunVisor' },
    'Mud Flap':                  { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoMudFlap' },
    'Lower Side Skirt':          { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLowerSideSkirt' },
    'Door Handle Recess':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDoorHandleRecess' },
    'Roof Beacon Bar':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoRoofBeaconBar' },
    'Cab Side Panel':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabSidePanel' },
    'Cab Rear Panel':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabRearPanel' },
    'Cab Roof Panel':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabRoofPanel' },
    'Cab Floor Panel':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabFloorPanel' },
    'Windshield':                { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoWindshield' },
    'Side Window':               { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSideWindow' },
    'Cab Door':                  { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCabDoor' },
    'Roof Air Deflector':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoRoofAirDeflector' },
    'A Pillar':                  { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoAPillar' },
    'B Pillar':                  { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoBPillar' },
    'Wheel Arch Cover':          { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoWheelArchCover' },
    'Roof Marker Light':         { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoRoofMarkerLight' },
    'Exhaust Stack':             { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoExhaustStack' },
    'Frame Rail':                { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoFrameRail' },
    'Frame Cross Member':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoFrameCrossMember' },
    'Fuel Tank':                 { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoFuelTank' },
    'Axle Beam':                 { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoAxleBeam' },
    'Wheel Rim':                 { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoWheelRim' },
    'Tire':                      { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoTire' },
    'Brake Drum':                { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoBrakeDrum' },
    'Drive Shaft':               { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDriveShaft' },
    'Differential Housing':      { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDifferentialHousing' },
    'Suspension Leaf Spring':    { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoLeafSpring' },
    'Shock Absorber':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoShockAbsorber' },
    'Air Suspension Bellows':    { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoAirSuspensionBellows' },
    'Battery Box':               { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoBatteryBox' },
    'Air Compressor Tank':       { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoAirCompressorTank' },
    'Engine Block':              { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoEngineBlock' },
    'Cylinder Head':             { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCylinderHead' },
    'Turbocharger Housing':      { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoTurbocharger' },
    'Intake Manifold':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoIntakeManifold' },
    'Exhaust Manifold':          { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoExhaustManifold' },
    'Radiator Module':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoRadiatorModule' },
    'Cooling Fan':               { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCoolingFan' },
    'Driver Seat Base':          { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDriverSeatBase' },
    'Driver Seat Back':          { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDriverSeatBack' },
    'Seat Headrest':             { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSeatHeadrest' },
    'Steering Wheel Rim':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSteeringWheelRim' },
    'Steering Wheel Boss':       { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSteeringWheelBoss' },
    'Steering Wheel Spoke':      { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSteeringWheelSpoke' },
    'Steering Column':           { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSteeringColumn' },
    'Dashboard':                 { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDashboard' },
    'Instrument Cluster':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoInstrumentCluster' },
    'Gear Shifter':              { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoGearShifter' },
    'Foot Pedal':                { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoFootPedal' },
    'AC Vent':                   { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoACVent' },
    'Door Card':                 { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoDoorCard' },
    'Sun Visor Interior':        { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSunVisorInterior' },
    'Centre Console':            { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCentreConsole' },
    'Cup Holder':                { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoCupHolder' },
    'Sleeper Bunk':              { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoSleeperBunk' },
    'Headliner':                 { standard: 'Volvo FH ref', sizes: ['stock'], table: { stock: {} }, units: 'mm', builderKey: 'volvoHeadliner' },
  },
  Bearings: {
    'Deep-Groove Ball (SKF 60xx light)': {
      standard: 'SKF / ISO 15', table: SKF_DEEP_GROOVE_LIGHT,
      sizes: SKF_DEEP_GROOVE_LIGHT_DESIGNATIONS, units: 'mm',
      builderKey: 'skfDeepGroove',
    },
    'Deep-Groove Ball (SKF 63xx heavy)': {
      standard: 'SKF / ISO 15', table: SKF_DEEP_GROOVE_HEAVY,
      sizes: SKF_DEEP_GROOVE_HEAVY_DESIGNATIONS, units: 'mm',
      builderKey: 'skfDeepGroove',
    },
    'Tapered Roller (SKF 302xx light)': {
      standard: 'SKF / ISO 355', table: SKF_TAPERED_LIGHT,
      sizes: SKF_TAPERED_LIGHT_DESIGNATIONS, units: 'mm',
      builderKey: 'skfTapered',
    },
    'Tapered Roller (SKF 322xx heavy)': {
      standard: 'SKF / ISO 355', table: SKF_TAPERED_HEAVY,
      sizes: SKF_TAPERED_HEAVY_DESIGNATIONS, units: 'mm',
      builderKey: 'skfTapered',
    },
  },
};

// Flat lookup by (category, leafName, size) → entry — used by ToolExecutionEngine.
export function lookupCatalog(category, leafName, size) {
  const cat = STANDARDS_CATALOG[category];
  if (!cat) return null;
  const leaf = cat[leafName];
  if (!leaf) return null;
  const entry = leaf.table[size];
  if (!entry) return null;
  return { leaf, entry, size };
}
