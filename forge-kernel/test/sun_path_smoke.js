// forge-kernel SunPath smoke (Forge-181) — known astronomical events.
// References (NOAA SPA):
//   * Equinox: sun rises ~due east, sets ~due west, altitude at solar
//     noon ≈ 90° − |latitude|.
//   * June solstice: longest day in northern hemisphere; daylight at
//     London (51.5°N) ≈ 16.6 h; daylight at Sydney (−33.9°S) ≈ 9.9 h.
//   * December solstice: mirror of the above.
//   * High latitudes (≥ ~66.5°) see polar day/night around the solstices.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.sun && typeof forge.sun.compute === 'function',
          'forge.sun.compute missing');

// 1. London (51.5074°N, -0.1278°E), summer solstice 2025 (June 21, day 172).
//    Expected daylight ~ 16.6 hours.
const londonSummer = forge.sun.compute({
  year: 2025, dayOfYear: 172, localHour: 12.0,
  latitudeDeg: 51.5074, longitudeDeg: -0.1278, tzOffsetHours: 1,    // BST
});
assert.ok(Math.abs(londonSummer.daylightHours - 16.6) < 0.5,
          `London summer daylight ${londonSummer.daylightHours.toFixed(2)} should be ≈ 16.6`);
assert.ok(londonSummer.altitudeDeg > 50,    // ~62° at noon
          `London summer noon altitude ${londonSummer.altitudeDeg.toFixed(2)} should be > 50°`);
assert.ok(londonSummer.altitudeDeg < 70,
          `London summer noon altitude ${londonSummer.altitudeDeg.toFixed(2)} should be < 70°`);

// 2. Sydney (-33.8688°S, 151.2093°E), same day (their winter).
//    Daylight should be much shorter (~9.9 h).
const sydneyJuneNoon = forge.sun.compute({
  year: 2025, dayOfYear: 172, localHour: 12.0,
  latitudeDeg: -33.8688, longitudeDeg: 151.2093, tzOffsetHours: 10,  // AEST
});
assert.ok(Math.abs(sydneyJuneNoon.daylightHours - 9.9) < 0.5,
          `Sydney winter daylight ${sydneyJuneNoon.daylightHours.toFixed(2)} should be ≈ 9.9`);

// 3. Equator (0°N, 0°E), spring equinox (day 80 = March 21).
//    Daylight ≈ 12 h, noon altitude ≈ 90°.
const equator = forge.sun.compute({
  year: 2025, dayOfYear: 80, localHour: 12.0,
  latitudeDeg: 0.0, longitudeDeg: 0.0, tzOffsetHours: 0,
});
assert.ok(Math.abs(equator.daylightHours - 12.0) < 0.3,
          `equator equinox daylight ${equator.daylightHours} should be ≈ 12`);
assert.ok(equator.altitudeDeg > 85,
          `equator equinox noon altitude ${equator.altitudeDeg.toFixed(2)} should be > 85°`);

// 4. Polar day: Tromsø (69.6°N), summer solstice — sun never sets.
const tromsoMidnight = forge.sun.compute({
  year: 2025, dayOfYear: 172, localHour: 0.0,
  latitudeDeg: 69.65, longitudeDeg: 18.95, tzOffsetHours: 2,    // CEST
});
assert.ok(tromsoMidnight.sunUp,
          `Tromsø midnight sun should be up at summer solstice`);
assert.ok(tromsoMidnight.daylightHours >= 23.5,
          `Tromsø daylight ${tromsoMidnight.daylightHours} should ≈ 24 (polar day)`);

// 5. Hourly sweep — sum of sunUp hours should match daylightHours
// (within rounding since we sample at integer hours).
const sweep = forge.sun.sweepHourly({
  year: 2025, dayOfYear: 172,
  latitudeDeg: 51.5074, longitudeDeg: -0.1278, tzOffsetHours: 1,
});
assert.strictEqual(sweep.length, 24, 'sweep should have 24 samples');
const sunUpHours = sweep.filter((s) => s.pos.sunUp).length;
assert.ok(Math.abs(sunUpHours - londonSummer.daylightHours) < 1.5,
          `London sweep sunUp hours ${sunUpHours} should ≈ daylight ${londonSummer.daylightHours.toFixed(2)}`);

// 6. Annual noon — 12 monthly samples, June altitude is highest in NH.
const annual = forge.sun.annualNoon({
  year: 2025, latitudeDeg: 51.5074, longitudeDeg: -0.1278, tzOffsetHours: 0,
});
assert.strictEqual(annual.length, 12);
const juneAlt = annual.find((s) => s.monthOneBased === 6).altitudeDeg;
const decAlt  = annual.find((s) => s.monthOneBased === 12).altitudeDeg;
assert.ok(juneAlt > decAlt + 20,
          `London June noon ${juneAlt.toFixed(1)}° should >> December ${decAlt.toFixed(1)}°`);

console.log('✅ SunPath smoke PASSED');
console.log(`   London summer 21 Jun  daylight  ${londonSummer.daylightHours.toFixed(2)} h  noon alt ${londonSummer.altitudeDeg.toFixed(1)}°`);
console.log(`   Sydney  winter 21 Jun  daylight  ${sydneyJuneNoon.daylightHours.toFixed(2)} h`);
console.log(`   Equator spring eq      noon alt  ${equator.altitudeDeg.toFixed(1)}°  daylight  ${equator.daylightHours.toFixed(2)} h`);
console.log(`   Tromsø summer midnight altitude  ${tromsoMidnight.altitudeDeg.toFixed(1)}°  sunUp=${tromsoMidnight.sunUp}`);
console.log(`   London hourly sweep    sunUp     ${sunUpHours} of 24 hours`);
console.log(`   London annual noon     June ${juneAlt.toFixed(1)}°  Dec ${decAlt.toFixed(1)}°`);
