// Forge-284 — stopping sight distance smoke (AASHTO Green Book).
//
// Design speed 80 km/h ≈ 50 mph. AASHTO standard: t = 2.5 s, f = 0.35,
//   level grade G = 0.
//   v = 80/3.6 = 22.22 m/s
//   a = 9.81 · 0.35 = 3.434 m/s²
//   d_perception = 22.22 · 2.5 = 55.56 m
//   d_braking    = 22.22²/(2·3.434) = 71.87 m
//   SSD          = 127.4 m (AASHTO table: 130 m at 80 km/h)
//
// In feet: 127.4 / 0.3048 = 418 ft (AASHTO table: 425 ft at 50 mph).

const kernel = require('../build/Release/forge-kernel.node');

function assert(cond, msg) { if (!cond) { console.error('FAIL', msg); process.exit(1); } }

const level = kernel.ssd.analyse({
    designSpeedKmH: 80, perceptionTimeS: 2.5,
    frictionCoefficient: 0.35, gradePct: 0,
});
console.log('level 80 km/h', JSON.stringify(level, null, 2));

assert(Math.abs(level.designSpeedMs - 80/3.6) < 1e-9, 'v conversion');
assert(Math.abs(level.effectiveDecelerationMs2 - 9.81 * 0.35) < 1e-6, 'a');
assert(Math.abs(level.perceptionDistanceM - (80/3.6) * 2.5) < 1e-6, 'd_perception');
assert(Math.abs(level.totalSsdM - 127.4) < 1, 'SSD ≈ 127.4 m');
assert(Math.abs(level.totalSsdFt - level.totalSsdM / 0.3048) < 1e-6, 'ft conversion');

// Downhill 6 % grade reduces effective deceleration → longer SSD.
const down = kernel.ssd.analyse({
    designSpeedKmH: 80, perceptionTimeS: 2.5,
    frictionCoefficient: 0.35, gradePct: -6,
});
console.log('down 6%', JSON.stringify(down));
assert(down.effectiveDecelerationMs2 < level.effectiveDecelerationMs2, 'downhill a smaller');
assert(down.totalSsdM > level.totalSsdM, 'downhill longer SSD');

// Uphill 6 % grade boosts deceleration → shorter SSD.
const up = kernel.ssd.analyse({
    designSpeedKmH: 80, perceptionTimeS: 2.5,
    frictionCoefficient: 0.35, gradePct: 6,
});
console.log('up 6%', JSON.stringify(up));
assert(up.totalSsdM < level.totalSsdM, 'uphill shorter SSD');

// Higher speed → much longer SSD (braking is v², perception is v).
const v100 = kernel.ssd.analyse({
    designSpeedKmH: 100, perceptionTimeS: 2.5,
    frictionCoefficient: 0.35, gradePct: 0,
});
assert(v100.totalSsdM > level.totalSsdM * 1.4, 'higher speed dramatically longer SSD');

// Very low friction on steep downhill should throw.
let threw = false;
try {
    kernel.ssd.analyse({
        designSpeedKmH: 80, perceptionTimeS: 2.5,
        frictionCoefficient: 0.05, gradePct: -10,
    });
} catch (e) { threw = true; }
assert(threw, 'a ≤ 0 throws');

// Out-of-range grade.
threw = false;
try {
    kernel.ssd.analyse({
        designSpeedKmH: 80, perceptionTimeS: 2.5,
        frictionCoefficient: 0.35, gradePct: 20,
    });
} catch (e) { threw = true; }
assert(threw, 'G = 20% throws');

console.log('Forge-284 SSD smoke OK');
