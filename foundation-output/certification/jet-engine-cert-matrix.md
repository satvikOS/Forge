# ArchDisc Certification Matrix

Generated: 2026-05-14T15:13:09.130Z

## Summary

- **Total rules:** 14
- **Covered:** 10 (71.4 %)
- **Passed:** 10
- **Failed:** 0
- **Uncovered:** 4

## Aerodynamic

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| AMC 25.901 | Compressor surge margin | :white_check_mark: PASS | step #2 (Compressor Stage): De Haller passes: hub=0.72, mid=0.85, tip=0.91 (>= 0.72 required) |

## BirdStrike

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 800 | Bird ingestion | :warning: UNCOVERED | No ArchDisc tool covers this rule yet (test evidence required) |

## Durability

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 515 | Engine life | :white_check_mark: PASS | step #11 (Fatigue Analysis): Goodman SF = 1.25 |

## Fuel

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 670 | Fuel system | :warning: UNCOVERED | No ArchDisc tool covers this rule yet (test evidence required) |

## HotSection

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 740 | Hot-section integrity | :white_check_mark: PASS | step #5 (Blade Cooling): Hot-spot midPS = 745 °C, long-life survival |
| CS-E 730 | Combustion | :white_check_mark: PASS | step #3 (Combustor): NOx EI = 74.4 g/kg fuel, heat release = 51.0 MW/(m³·atm) |

## Noise

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| ICAO Ch 14 | Noise certification | :warning: UNCOVERED | No ArchDisc tool covers this rule yet (test evidence required) |

## Performance

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 50 | Engine ratings | :white_check_mark: PASS | step #0 (Mission):  \| step #1 (Brayton Cycle): Thrust 185.7 kN, SFC 0.686 lbm/(lbf·hr) |
| CS-E 60 | SFC declared | :white_check_mark: PASS | step #1 (Brayton Cycle): SFC = 0.686 lbm/(lbf·hr) (typical band 0.3–2.0) |

## Rotors

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 850 | Critical speeds margin | :white_check_mark: PASS | step #10 (Rotordynamics): Critical at 156 RPM (separation margin manual check) |

## Structural

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 510 | Strength + deformation | :warning: UNCOVERED | No plan step used: Linear Static FEA |
| CS-E 540 | Fatigue tolerance | :white_check_mark: PASS | step #11 (Fatigue Analysis): Goodman SF = 1.25 (≥ 1.0 required) |
| CS-E 650 | Vibration survey | :white_check_mark: PASS | step #10 (Rotordynamics): Critical speed = 156 RPM |

## Thermal

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| CS-E 760 | Cooling adequacy | :white_check_mark: PASS | step #5 (Blade Cooling): T_metal_max = 745 °C \| step #6 (Heat Exchanger): Effectiveness = 0.464 |

---

*This report is generated automatically from a single design session.*
*Uncovered rules typically require physical-test evidence (bird-strike rig, endurance cell, FW-H acoustic, fuel-system rig).*