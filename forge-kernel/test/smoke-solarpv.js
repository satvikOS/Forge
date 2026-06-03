// Forge-255 — Solar PV sizing smoke (off-grid).
//
// Daily AC load: 5000 Wh.
// PSH: 5.0 h, panel = 400 Wp, η_inv = 0.95, η_batt = 0.92, derate = 0.75.
//
//   E_dc = 5000 / (0.95·0.92) = 5719 Wh
//   array Wp = 5719 / (5·0.75) = 1525.1 Wp
//   N = ceil(1525.1 / 400) = 4 panels → installed 1600 Wp
//
// Battery: autonomy 2 days, DoD 0.5, 48 V bank, η_batt 0.92.
//   E_storage = 5000·2/(0.5·0.92) = 21,739 Wh
//   C_battery = 21,739/48 = 452.9 Ah
//
// Inverter: peak 3000 W, pf 0.9, sizing 1.25.
//   VA = 3000·1.25/0.9 = 4167 VA.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const arr = kernel.solarpv.sizeArray({
  dailyEnergyAcWh: 5000, peakSunHours: 5,
  panelWattPeak: 400, inverterEfficiency: 0.95,
  batteryEfficiency: 0.92, arrayDeratingFactor: 0.75,
});
console.log('array:', arr);
if (!approx(arr.requiredArrayPowerWp, 1525.1, 0.01))
  throw new Error('array Wp off');
if (arr.numberOfPanels !== 4) throw new Error('N off');
if (arr.installedArrayPowerWp !== 1600) throw new Error('installed off');

const bat = kernel.solarpv.sizeBatteryBank({
  dailyEnergyAcWh: 5000, autonomyDays: 2,
  depthOfDischarge: 0.5, batteryBankVoltage: 48, batteryEfficiency: 0.92,
});
console.log('battery:', bat);
if (!approx(bat.storageEnergyWh, 21739, 0.01)) throw new Error('storage off');
if (!approx(bat.batteryCapacityAh, 452.9, 0.01)) throw new Error('Ah off');

const inv = kernel.solarpv.sizeInverterVA({
  peakAcLoadW: 3000, powerFactor: 0.9, sizingFactor: 1.25,
});
console.log('inverter VA:', inv);
if (!approx(inv, 4166.67, 0.01)) throw new Error('VA off');

console.log('OK — solarpv smoke green');
