// Forge-252 — Cable sizing smoke (NEC 310.16 + IEC 60364).
//
// 1) NEC ampacity for 4 AWG Cu, 75°C, 35°C ambient, 4 conductors:
//    base = 85 A; ambient(35°C) = 0.94; grouping(4) = 0.80; Cu = 1.0
//    effective = 85·0.94·0.80·1.0 = 63.92 A
//
// 2) Aluminum at same conditions: ×0.80 material factor
//    = 85·0.94·0.80·0.80 = 51.14 A
//
// 3) Voltage drop: 16 mm² Cu, 50 m, 100 A, pf=0.9, X=0, V=400 V 3-φ:
//    R/km = 0.0172·1000/16 = 1.075 Ω/km
//    ΔV = √3·100·0.05·(1.075·0.9 + 0) = √3·100·0.05·0.9675 = 8.379 V
//    %  = 8.379/400 = 2.10%
//
// 4) Single-phase: same cable, 230 V 1-φ:
//    ΔV = 2·100·0.05·(1.075·0.9) = 9.675 V; % = 4.21%.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const table = kernel.cable.ampacityTable();
if (!Array.isArray(table) || table.length < 16) throw new Error('table missing entries');

const cu4 = kernel.cable.ampacity({
  conductorSize: '4', material: 'copper',
  ambientTempC: 35, numCurrentCarryingConductors: 4,
});
console.log('Cu 4 AWG:', cu4);
if (!approx(cu4.baseAmpacityA, 85, 1e-9)) throw new Error('base off');
if (!approx(cu4.ambientFactor, 0.94, 1e-9)) throw new Error('ambient off');
if (!approx(cu4.groupingFactor, 0.80, 1e-9)) throw new Error('grouping off');
if (!approx(cu4.effectiveAmpacityA, 63.92, 0.01)) throw new Error('effective off');

const al4 = kernel.cable.ampacity({
  conductorSize: '4', material: 'aluminum',
  ambientTempC: 35, numCurrentCarryingConductors: 4,
});
console.log('Al 4 AWG:', al4);
if (!approx(al4.effectiveAmpacityA, 51.14, 0.01)) throw new Error('Al effective off');

const vd3 = kernel.cable.voltageDrop({
  system: 'threePhase',
  xsecMm2: 16, lengthMeters: 50, loadAmperes: 100,
  powerFactor: 0.9,
  materialResistivityOhmMmSqPerM: 0.0172,
  conductorReactanceOhmPerKm: 0,
  systemVoltage: 400,
});
console.log('3-φ:', vd3);
if (!approx(vd3.cableResistanceOhmPerKm, 1.075, 0.01)) throw new Error('R/km off');
if (!approx(vd3.voltageDropV, 8.379, 0.01)) throw new Error('ΔV 3-φ off');
if (!approx(vd3.voltageDropPct, 2.10, 0.01)) throw new Error('%ΔV 3-φ off');

const vd1 = kernel.cable.voltageDrop({
  system: 'singlePhase',
  xsecMm2: 16, lengthMeters: 50, loadAmperes: 100,
  powerFactor: 0.9,
  materialResistivityOhmMmSqPerM: 0.0172,
  conductorReactanceOhmPerKm: 0,
  systemVoltage: 230,
});
console.log('1-φ:', vd1);
if (!approx(vd1.voltageDropV, 9.675, 0.01)) throw new Error('ΔV 1-φ off');
if (!approx(vd1.voltageDropPct, 4.21, 0.01)) throw new Error('%ΔV 1-φ off');

console.log('OK — cable smoke green');
