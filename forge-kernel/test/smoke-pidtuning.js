// Forge-264 — PID tuning smoke (Åström & Hägglund Ch. 7).
//
// Ziegler-Nichols closed-loop: K_u = 4.0, P_u = 6 s.
//   P  : Kp = 2.0
//   PI : Kp = 1.80, Ti = 5.0
//   PID: Kp = 2.40, Ti = 3.0, Td = 0.75
//
// Cohen-Coon: K_p = 2.0, τ = 10 s, θ = 2 s (τ/θ = 5):
//   P  : Kp = (1/2.0)·5·(1 + 0.2/3) = 2.5·1.0667 = 2.667
//   PI : Kp = 0.5·5·(0.9 + 0.2/12) = 2.5·0.9167 = 2.292
//        Ti = 2·(30 + 0.6)/(9 + 4) = 2·2.354 = 4.708
//   PID: Kp = 0.5·5·(1.333 + 0.05) = 2.5·1.383 = 3.458
//        Ti = 2·(32 + 1.2)/(13 + 1.6) = 2·2.274 = 4.548
//        Td = 2·4/(11 + 0.4) = 8/11.4 = 0.702

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const znP = kernel.pidtuning.zieglerNichols({
  controller: 'P', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
});
if (!approx(znP.Kp, 2.0, 1e-9)) throw new Error('ZN P Kp off');

const znPI = kernel.pidtuning.zieglerNichols({
  controller: 'PI', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
});
if (!approx(znPI.Kp, 1.80, 1e-9)) throw new Error('ZN PI Kp off');
if (!approx(znPI.Ti, 5.0, 1e-9))   throw new Error('ZN PI Ti off');

const znPID = kernel.pidtuning.zieglerNichols({
  controller: 'PID', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
});
console.log('ZN PID:', znPID);
if (!approx(znPID.Kp, 2.40, 1e-9)) throw new Error('ZN PID Kp off');
if (!approx(znPID.Ti, 3.0, 1e-9))   throw new Error('ZN PID Ti off');
if (!approx(znPID.Td, 0.75, 1e-9))  throw new Error('ZN PID Td off');

const ccP = kernel.pidtuning.cohenCoon({
  controller: 'P', processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 2,
});
console.log('CC P:', ccP);
if (!approx(ccP.Kp, 2.667, 0.001)) throw new Error('CC P Kp off');

const ccPI = kernel.pidtuning.cohenCoon({
  controller: 'PI', processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 2,
});
console.log('CC PI:', ccPI);
if (!approx(ccPI.Kp, 2.292, 0.001)) throw new Error('CC PI Kp off');
if (!approx(ccPI.Ti, 4.708, 0.005)) throw new Error('CC PI Ti off');

const ccPID = kernel.pidtuning.cohenCoon({
  controller: 'PID', processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 2,
});
console.log('CC PID:', ccPID);
if (!approx(ccPID.Kp, 3.458, 0.001))  throw new Error('CC PID Kp off');
if (!approx(ccPID.Ti, 4.548, 0.005))  throw new Error('CC PID Ti off');
if (!approx(ccPID.Td, 0.702, 0.005))  throw new Error('CC PID Td off');

console.log('OK — pidtuning smoke green');
