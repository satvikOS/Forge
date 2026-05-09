# GE9X — FAR Part 33 / EASA CS-E Compliance Report

Generated: 2026-05-09T15:18:25.852Z
Engine: GE Aviation GE9X-105B1A
Regulation: 14 CFR Part 33 / EASA CS-E

## Summary

| Status | Count |
|--------|-------|
| **VERIFIED** | 6 |
| Partial / Mixed | 5 |
| Unverified | 2 |
| **Total** | 13 |
| **Coverage** | **46.2%** |

## Requirements Matrix

| § Code | Title | Scenarios | Status | Pass / Fail / Total |
|--------|-------|-----------|--------|---------------------|
| 33.15 | Materials | fatigue_hcf, thermal_cycle | MIXED | 17 / 23 / 40 |
| 33.27 | Turbine, compressor, fan, and turbosupercharger rotor overspeed | rotor_overspeed | MIXED | 16 / 3 / 19 |
| 33.62 | Stress analysis | load_static | VERIFIED | 20 / 0 / 20 |
| 33.63 | Vibration | vibration_random | FAILED | 0 / 20 / 20 |
| 33.74 | Continued rotation | rotor_overspeed | UNVERIFIED | 0 / 0 / 0 |
| 33.76 | Bird ingestion | bird_strike | VERIFIED | 17 / 0 / 17 |
| 33.77 | Foreign object ingestion — FOD | fod_ingestion | VERIFIED | 17 / 0 / 17 |
| 33.78 | Rain and hail ingestion | hail_ingestion | VERIFIED | 17 / 0 / 17 |
| 33.83 | Vibration test (engine-level) | vibration_random | FAILED | 0 / 20 / 20 |
| 33.87 | Endurance test | fatigue_hcf, thermal_cycle | MIXED | 17 / 23 / 40 |
| 33.94 | Blade containment and rotor unbalance tests | blade_off | VERIFIED | 1 / 0 / 1 |
| 33.97 | Thrust reverser system | load_static | UNVERIFIED | 0 / 0 / 0 |
| 33.B-1 | Lightning strike (CS-E 800 / DO-160 §22) | lightning_strike | VERIFIED | 1 / 0 / 1 |

## Evidence Detail

### § 33.15 — Materials

**Description:** Suitability and durability of materials used in the engine must be established.

**Pass criteria:** Materials demonstrated to withstand HCF + thermal cycling per service life.

**Status:** MIXED (40 test runs against 5 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | fatigue_hcf | FAIL | HCF 5e7 |
| GE9X-FAN-BLD-0001 | thermal_cycle | PASS | thermal cycle |
| GE9X-FAN-BLD-0002 | fatigue_hcf | FAIL | HCF 5e7 |
| GE9X-FAN-BLD-0002 | thermal_cycle | PASS | thermal cycle |
| GE9X-FAN-BLD-0003 | fatigue_hcf | FAIL | HCF 5e7 |


---
### § 33.27 — Turbine, compressor, fan, and turbosupercharger rotor overspeed

**Description:** Rotors must be capable of withstanding overspeed conditions for 5 minutes without burst.

**Pass criteria:** No rotor burst at 115% red-line for 5 minutes.

**Status:** MIXED (19 test runs against 2 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | rotor_overspeed | PASS | FAR 33.27 |
| GE9X-FAN-BLD-0002 | rotor_overspeed | PASS | FAR 33.27 |
| GE9X-FAN-BLD-0003 | rotor_overspeed | PASS | FAR 33.27 |
| GE9X-FAN-BLD-0004 | rotor_overspeed | PASS | FAR 33.27 |
| GE9X-FAN-BLD-0005 | rotor_overspeed | PASS | FAR 33.27 |


---
### § 33.62 — Stress analysis

**Description:** Engine must be subject to stress analysis showing margin of safety on each critical part.

**Pass criteria:** All critical parts show SF ≥ 1.0 at limit and ultimate loads.

**Status:** VERIFIED (20 test runs against 6 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | load_static | PASS | FAR 25.305 |
| GE9X-FAN-BLD-0002 | load_static | PASS | FAR 25.305 |
| GE9X-FAN-BLD-0003 | load_static | PASS | FAR 25.305 |
| GE9X-FAN-BLD-0004 | load_static | PASS | FAR 25.305 |
| GE9X-FAN-BLD-0005 | load_static | PASS | FAR 25.305 |


---
### § 33.63 — Vibration

**Description:** Engine must be designed to function under vibration over the operating range.

**Pass criteria:** No first-mode resonance in the 20-2000 Hz operating band.

**Status:** FAILED (20 test runs against 3 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0002 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0003 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0004 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0005 | vibration_random | FAIL | DO-160 §8 |


---
### § 33.74 — Continued rotation

**Description:** After shutdown by any cause, engine must continue to rotate or sustain damage limited to that not endangering aircraft.

**Pass criteria:** Bearings and shaft accommodate rundown without seizure failure mode.

**Status:** UNVERIFIED (0 test runs against 2 subsystem types)

_No test evidence yet — run additional campaigns._

---
### § 33.76 — Bird ingestion

**Description:** Engine must be capable of ingesting one large bird and one medium bird without unsafe condition.

**Pass criteria:** Fan blade SF ≥ 1.0 under 1.8 kg bird @ 250 m/s impact.

**Status:** VERIFIED (17 test runs against 1 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | bird_strike | PASS | FAR 33.76 |
| GE9X-FAN-BLD-0002 | bird_strike | PASS | FAR 33.76 |
| GE9X-FAN-BLD-0003 | bird_strike | PASS | FAR 33.76 |
| GE9X-FAN-BLD-0004 | bird_strike | PASS | FAR 33.76 |
| GE9X-FAN-BLD-0005 | bird_strike | PASS | FAR 33.76 |


---
### § 33.77 — Foreign object ingestion — FOD

**Description:** Engine must withstand ingestion of medium FOD.

**Pass criteria:** Fan and compressor blades SF ≥ 1.0 under 0.45 kg @ 200 m/s FOD.

**Status:** VERIFIED (17 test runs against 1 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | fod_ingestion | PASS | FAA AC 33.76 |
| GE9X-FAN-BLD-0002 | fod_ingestion | PASS | FAA AC 33.76 |
| GE9X-FAN-BLD-0003 | fod_ingestion | PASS | FAA AC 33.76 |
| GE9X-FAN-BLD-0004 | fod_ingestion | PASS | FAA AC 33.76 |
| GE9X-FAN-BLD-0005 | fod_ingestion | PASS | FAA AC 33.76 |


---
### § 33.78 — Rain and hail ingestion

**Description:** Engine must operate during ingestion of rain and hail.

**Pass criteria:** No blade yielding from 25 mm hailstone ingestion.

**Status:** VERIFIED (17 test runs against 1 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | hail_ingestion | PASS | DO-160 §24 |
| GE9X-FAN-BLD-0002 | hail_ingestion | PASS | DO-160 §24 |
| GE9X-FAN-BLD-0003 | hail_ingestion | PASS | DO-160 §24 |
| GE9X-FAN-BLD-0004 | hail_ingestion | PASS | DO-160 §24 |
| GE9X-FAN-BLD-0005 | hail_ingestion | PASS | DO-160 §24 |


---
### § 33.83 — Vibration test (engine-level)

**Description:** Endurance vibration test demonstrating no resonance amplification damage.

**Pass criteria:** No resonant amplification > 4× across operating speed range.

**Status:** FAILED (20 test runs against 3 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0002 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0003 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0004 | vibration_random | FAIL | DO-160 §8 |
| GE9X-FAN-BLD-0005 | vibration_random | FAIL | DO-160 §8 |


---
### § 33.87 — Endurance test

**Description:** 150-hour endurance test simulating typical operating cycles.

**Pass criteria:** Components survive 150 hr equivalent cycles without crack initiation.

**Status:** MIXED (40 test runs against 4 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-BLD-0001 | fatigue_hcf | FAIL | HCF 5e7 |
| GE9X-FAN-BLD-0001 | thermal_cycle | PASS | thermal cycle |
| GE9X-FAN-BLD-0002 | fatigue_hcf | FAIL | HCF 5e7 |
| GE9X-FAN-BLD-0002 | thermal_cycle | PASS | thermal cycle |
| GE9X-FAN-BLD-0003 | fatigue_hcf | FAIL | HCF 5e7 |


---
### § 33.94 — Blade containment and rotor unbalance tests

**Description:** Engine casing must contain a liberated fan blade (blade-off).

**Pass criteria:** Fan case SF ≥ 1.0 against blade liberation kinetic energy.

**Status:** VERIFIED (1 test runs against 1 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-CSG-0001 | blade_off | PASS | FAR 33.94 |


---
### § 33.97 — Thrust reverser system

**Description:** Thrust reverser must operate reliably and not pose hazard if it fails.

**Pass criteria:** Reverser cascades withstand limit + ultimate loads.

**Status:** UNVERIFIED (0 test runs against 2 subsystem types)

_No test evidence yet — run additional campaigns._

---
### § 33.B-1 — Lightning strike (CS-E 800 / DO-160 §22)

**Description:** Engine must operate after lightning strike per certification spec.

**Pass criteria:** No through-burn from 200 kA Zone 1A strike.

**Status:** VERIFIED (1 test runs against 2 subsystem types)

**Sample evidence:**

| Part ID | Scenario | Result | Standard |
|---------|----------|--------|----------|
| GE9X-FAN-CSG-0001 | lightning_strike | PASS | DO-160 §22 |


