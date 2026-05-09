# GE9X Brayton Cycle Performance Report

Generated: 2026-05-09T16:24:44.031Z

Computed station-by-station thermodynamic analysis using real Brayton
cycle physics. No hardcoded performance numbers — every value comes
from the cycle equations.

## Validation against published GE9X spec (takeoff)

| Quantity | Expected | Computed | Error | Pass |
|----------|----------|----------|-------|------|
| thrust_total_kN | 470 | 394.46 | 16.1% | ✗ |
| OPR | 60 | 59.90 | 0.2% | ✓ |
| BPR | 9.9 | 9.90 | 0.0% | ✓ |
| TIT_C | 1477 | 1651.85 | 11.8% | ✗ |

**2 of 4 validations within 10% of published spec.**

## Operating points

### TAKEOFF

| Quantity | Value |
|----------|-------|
| Altitude | 0 m |
| Mach | 0 |
| Mass flow | 1361 kg/s |
| **Thrust** | **394.5 kN** (88682 lbf) |
| SFC | 0.0326 kg/(N·hr) |
| OPR | 59.9 |
| TIT (T4) | 1652 °C |
| EGT (T5) | 701 °C |
| Fuel flow | 12841 kg/hr |
| Core thrust | 90.9 kN (23.0%) |
| Bypass thrust | 303.6 kN (77.0%) |
| Propulsive eff | 0.0% |
| Thermal eff | 37.6% |

#### Station table

| Station | P_t (kPa) | T_t (K) | Description |
|---------|-----------|---------|-------------|
| 0 | 101 | 288 | Freestream stagnation |
| 2 | 100 | 288 | Fan inlet |
| 3 | 6009 | 1049 | HPC exit / combustor inlet |
| 4 | 5768 | 1925 | Combustor exit / HPT inlet (TIT) |
| 5 | 288 | 974 | LPT exit (EGT) |
| 7 | 282 | 974 | Core nozzle exit |
| 13 | 145 | 323 | Fan exit / bypass entry |
| 17 | 143 | 323 | Bypass nozzle exit |
| 2.5 | 393 | 441 | LPC exit / HPC inlet |
| 4.95 | 1419 | 1403 | HPT exit / LPT inlet |


### TOPOFCLIMB

| Quantity | Value |
|----------|-------|
| Altitude | 10670 m |
| Mach | 0.85 |
| Mass flow | 510 kg/s |
| **Thrust** | **69.6 kN** (15639 lbf) |
| SFC | 0.0722 kg/(N·hr) |
| OPR | 53.9 |
| TIT (T4) | 1552 °C |
| EGT (T5) | 778 °C |
| Fuel flow | 5019 kg/hr |
| Core thrust | 31.8 kN (45.8%) |
| Bypass thrust | 37.7 kN (54.2%) |
| Propulsive eff | 60.1% |
| Thermal eff | 51.9% |

#### Station table

| Station | P_t (kPa) | T_t (K) | Description |
|---------|-----------|---------|-------------|
| 0 | 38 | 250 | Freestream stagnation |
| 2 | 38 | 250 | Fan inlet |
| 3 | 2039 | 882 | HPC exit / combustor inlet |
| 4 | 1957 | 1825 | Combustor exit / HPT inlet (TIT) |
| 5 | 172 | 1051 | LPT exit (EGT) |
| 7 | 169 | 1051 | Core nozzle exit |
| 13 | 53 | 278 | Fan exit / bypass entry |
| 17 | 52 | 278 | Bypass nozzle exit |
| 2.5 | 138 | 375 | LPC exit / HPC inlet |
| 4.95 | 585 | 1390 | HPT exit / LPT inlet |


### CRUISE

| Quantity | Value |
|----------|-------|
| Altitude | 10670 m |
| Mach | 0.84 |
| Mass flow | 470 kg/s |
| **Thrust** | **59.7 kN** (13415 lbf) |
| SFC | 0.0689 kg/(N·hr) |
| OPR | 52.0 |
| TIT (T4) | 1427 °C |
| EGT (T5) | 671 °C |
| Fuel flow | 4108 kg/hr |
| Core thrust | 26.2 kN (43.9%) |
| Bypass thrust | 33.5 kN (56.1%) |
| Propulsive eff | 61.9% |
| Thermal eff | 54.6% |

#### Station table

| Station | P_t (kPa) | T_t (K) | Description |
|---------|-----------|---------|-------------|
| 0 | 38 | 250 | Freestream stagnation |
| 2 | 37 | 250 | Fan inlet |
| 3 | 1949 | 870 | HPC exit / combustor inlet |
| 4 | 1871 | 1700 | Combustor exit / HPT inlet (TIT) |
| 5 | 140 | 944 | LPT exit (EGT) |
| 7 | 138 | 944 | Core nozzle exit |
| 13 | 52 | 276 | Fan exit / bypass entry |
| 17 | 51 | 276 | Bypass nozzle exit |
| 2.5 | 134 | 372 | LPC exit / HPC inlet |
| 4.95 | 517 | 1271 | HPT exit / LPT inlet |

