# GE9X Engine Maintenance Manual — Task Cards

Generated: 2026-05-09T17:03:51.646Z
Engine: GE Aviation GE9X-105B1A
Reference: GE9X EMM (Engine Maintenance Manual) chapter 72

## Summary

| Metric | Value |
|--------|-------|
| Total task cards | 23 |
| Life-limited parts (LLP) | 9 |
| Total scheduled labor over 24,000-cycle life | **7422 man-hours** |

## Life-Limited Parts (LLP) Table

Hard cycle limits per FAR 33.70 Critical Parts. Mandatory replacement
regardless of measured condition.

| Part | Cycles | Labor | EM Ref |
|------|--------|-------|--------|
| Fan disk replacement | 30,000 | 40 hr | 72-30-00-LLP-1 |
| LPT disk set replacement | 18,000 | 80 hr | 72-50-00-LLP-2 |
| HPT disk set replacement | 12,000 | 80 hr | 72-50-00-LLP-1 |
| HPC disk set replacement | 24,000 | 120 hr | 72-30-00-LLP-3 |

## All Task Cards

### 72001-A — Pre-flight visual inspection

| Field | Value |
|-------|-------|
| Interval (hours) | every flight |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 0.25 man-hours |
| LLP | no |
| Tooling | flashlight; borescope-eye |
| EM Reference | 72-00-00-200 |

Walk-around visual: fan blade leading-edge nicks/dents > 5mm, OGV cracks, oil stains, FOD on inlet lip, exhaust nozzle integrity.

---
### 72002-A — Engine oil quantity + visual

| Field | Value |
|-------|-------|
| Interval (hours) | 1 |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 0.1 man-hours |
| LLP | no |
| Tooling | none |
| EM Reference | 72-60-00 |

Verify oil tank level between MIN/MAX, check for leaks, scavenge filter pop-out.

---
### 72100 — Borescope inspection — fan, LPC

| Field | Value |
|-------|-------|
| Interval (hours) | 100 |
| Interval (cycles) | 200 |
| Calendar (days) | 90 |
| Labor | 1.5 man-hours |
| LLP | no |
| Tooling | Olympus IV9000 borescope; access port plug wrenches |
| EM Reference | 72-30-00-680 |

Insert borescope through ports BS-FAN-1 and BS-LPC-1. Inspect fan blades for FOD, LPC airfoils for nicks/cracks. Photo-document any indication > 1mm.

---
### 72101 — HPC borescope (3 ports)

| Field | Value |
|-------|-------|
| Interval (hours) | 200 |
| Interval (cycles) | 400 |
| Calendar (days) | 180 |
| Labor | 2 man-hours |
| LLP | no |
| Tooling | Olympus IV9000; BS-HPC-1/2/3 plugs |
| EM Reference | 72-30-00-685 |

BS-HPC-1 (stage 1-3), BS-HPC-2 (stage 4-7), BS-HPC-3 (stage 8-11). Especially inspect stage-1 OGV for tip rub.

---
### 72200 — Combustor borescope inspection

| Field | Value |
|-------|-------|
| Interval (hours) | 200 |
| Interval (cycles) | 400 |
| Calendar (days) | 180 |
| Labor | 2.5 man-hours |
| LLP | no |
| Tooling | articulating borescope; BS-COMB-1; BS-COMB-2 |
| EM Reference | 72-40-00-680 |

Inspect TAPS swirler tips for hot streaks, CMC liner for spallation, dome plate for cracks. Critical for CMC life monitoring.

---
### 72300 — HPT stage-1 blade borescope

| Field | Value |
|-------|-------|
| Interval (hours) | 200 |
| Interval (cycles) | 400 |
| Calendar (days) | 180 |
| Labor | 3 man-hours |
| LLP | **YES — life-limited** |
| Tooling | articulating borescope; BS-HPT-1 |
| EM Reference | 72-50-00-680 |

Tip rub, cooling-hole blockage, TBC spallation, leading-edge erosion. Document all blades. CMC blades require thermal-shock crack assessment.

---
### 72400 — Engine oil change + filter element

| Field | Value |
|-------|-------|
| Interval (hours) | 1000 |
| Interval (cycles) | — |
| Calendar (days) | 365 |
| Labor | 1.5 man-hours |
| LLP | no |
| Tooling | oil-can spanner kit; spectrographic analysis bottle |
| EM Reference | 72-60-00-200 |

Drain hot oil, replace filter element, take oil sample for SOAP (Spectrographic Oil Analysis Program).

---
### 72401 — Magnetic chip detector inspection

| Field | Value |
|-------|-------|
| Interval (hours) | 200 |
| Interval (cycles) | — |
| Calendar (days) | 90 |
| Labor | 0.5 man-hours |
| LLP | no |
| Tooling | MCD removal tool |
| EM Reference | 72-60-00-220 |

Pull all 5 main-bearing chip detectors. Measure ferromagnetic debris. > 50mg → engine quarantine.

---
### 72500 — Fan blade FPI (fluorescent penetrant inspection)

| Field | Value |
|-------|-------|
| Interval (hours) | 5000 |
| Interval (cycles) | 10,000 |
| Calendar (days) | — |
| Labor | 8 man-hours |
| LLP | no |
| Tooling | UV lamp 365nm; penetrant kit Type II; developer |
| EM Reference | 72-30-00-630 |

Remove fan blades, clean, apply penetrant, dwell 20 min, remove excess, apply developer, inspect under UV. Re-balance set on reassembly.

---
### 72600 — HPT blade replacement (LCF limit)

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 12,000 |
| Calendar (days) | — |
| Labor | 24 man-hours |
| LLP | **YES — life-limited** |
| Tooling | Hot-section work-stand; turbine-disk lift fixture; HPT alignment fixtures |
| EM Reference | 72-50-00-400 |

Pull HPT module, replace stage-1 + stage-2 blade sets. Re-balance turbine assembly. Critical LLP — do NOT exceed cycles. CMC blades require qualified handler.

---
### 72700 — Hot section refurbishment

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 18,000 |
| Calendar (days) | — |
| Labor | 240 man-hours |
| LLP | **YES — life-limited** |
| Tooling | full engine work-stand; piece-part inspection bench; stator-vane shop |
| EM Reference | 72-00-00-700 |

Remove engine. Disassemble combustor + HPT + LPT. Replace LLP per LLP table. Inspect all hot-section components per shop manual. Cold section pass-through inspection.

---
### 72701 — Engine performance restoration

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 24,000 |
| Calendar (days) | — |
| Labor | 480 man-hours |
| LLP | **YES — life-limited** |
| Tooling | MRO shop visit |
| EM Reference | 72-00-00-800 |

Full engine teardown to module level. Recoat HPT blades (TBC). Replace fan/LPC blade dovetails as needed. Restore EGT margin. Re-cert run on test stand.

---
### 72050 — EGT margin trending check

| Field | Value |
|-------|-------|
| Interval (hours) | 50 |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 0.25 man-hours |
| LLP | no |
| Tooling | data-bus reader |
| EM Reference | 72-90-00-200 |

Download FADEC trim records, check EGT margin trend vs cycle count. > 5°C/100-cycle decline → schedule borescope.

---
### 72060 — Vibration trending

| Field | Value |
|-------|-------|
| Interval (hours) | 50 |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 0.25 man-hours |
| LLP | no |
| Tooling | FADEC data extract |
| EM Reference | 72-90-00-210 |

Inspect 1×N1 + 1×N2 vibration channels. > 0.5 ips at takeoff → bearing diagnostic.

---
### 72900 — Bird-strike investigation

| Field | Value |
|-------|-------|
| Interval (hours) | event |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 4 man-hours |
| LLP | no |
| Tooling | borescope; fan-blade dent gauge; sample bag |
| EM Reference | 72-30-00-690 |

Following bird ingestion event: full borescope of fan, LPC, HPC. Bird-mass sample for species ID. If any blade has > 6mm leading-edge tear, replace blade.

---
### LLP-FAN-DSK — LLP — Fan disk replacement

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 30,000 |
| Calendar (days) | — |
| Labor | 40 man-hours |
| LLP | **YES — life-limited** |
| Tooling | fan-module work-stand |
| EM Reference | 72-30-00-LLP-1 |

Hard limit. Disk must be removed and scrapped at exactly 30,000 cycles per FAR 33.70 Critical Parts.

---
### LLP-LPT-DSK — LLP — LPT disk set replacement

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 18,000 |
| Calendar (days) | — |
| Labor | 80 man-hours |
| LLP | **YES — life-limited** |
| Tooling | LPT module work-stand |
| EM Reference | 72-50-00-LLP-2 |

All 6 LPT disks scrapped at 18,000 cycles.

---
### LLP-HPT-DSK — LLP — HPT disk set replacement

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 12,000 |
| Calendar (days) | — |
| Labor | 80 man-hours |
| LLP | **YES — life-limited** |
| Tooling | HPT module work-stand |
| EM Reference | 72-50-00-LLP-1 |

Both HPT disks scrapped at 12,000 cycles. Disk forging traceability per FAA AD 2014-XX-XX equivalent.

---
### LLP-HPC-DSK — LLP — HPC disk set replacement

| Field | Value |
|-------|-------|
| Interval (hours) | — |
| Interval (cycles) | 24,000 |
| Calendar (days) | — |
| Labor | 120 man-hours |
| LLP | **YES — life-limited** |
| Tooling | HPC module work-stand |
| EM Reference | 72-30-00-LLP-3 |

All 11 HPC disks scrapped at 24,000 cycles.

---
### 72950 — Engine wash (compressor performance recovery)

| Field | Value |
|-------|-------|
| Interval (hours) | 1500 |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 4 man-hours |
| LLP | no |
| Tooling | core wash cart; demineralized water supply; detergent (B&B-3100 or eq.) |
| EM Reference | 72-00-00-100 |

Motoring wash with detergent + water rinse. Restores ~3°C EGT margin typically. Schedule before margin reaches alarm.

---
### 72951 — Cooling-air filter cleaning

| Field | Value |
|-------|-------|
| Interval (hours) | 1000 |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 1 man-hours |
| LLP | no |
| Tooling | filter wrench; cleaning solvent |
| EM Reference | 72-50-00-300 |

Pull HPT cooling-air filter; ultrasonic clean; re-install. Critical for blade cooling effectiveness.

---
### 72801 — Bird-strike post-event LCF debit

| Field | Value |
|-------|-------|
| Interval (hours) | event |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 0.5 man-hours |
| LLP | **YES — life-limited** |
| Tooling | data-record system |
| EM Reference | 72-00-00-690 |

After confirmed bird-strike: subtract 50 cycles from each disk LCF count, regardless of damage assessment.

---
### 72802 — Hard-landing inspection

| Field | Value |
|-------|-------|
| Interval (hours) | event |
| Interval (cycles) | — |
| Calendar (days) | — |
| Labor | 6 man-hours |
| LLP | no |
| Tooling | borescope; shaft-runout fixture; mount link gauges |
| EM Reference | 72-00-00-695 |

Post hard-landing (> 1.8g): inspect mount-link torque, shaft runout, bearing damage signature.

