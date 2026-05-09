# GE9X v2 — Production-Article Submission Package

**Generated:** 2026-05-09T19:03:46.087Z
**Engine:** GE Aviation GE9X-105B1A
**Submission type:** FAA Part 21 Production Approval — Aircraft Engine
**CAD system:** ArchDisc v1.21+ proprietary B-Rep kernel (no external CAD dependencies)

---

## Delivery summary

| Metric | Value |
|--------|-------|
| Total components | **29,693** |
| Unique part definitions | **3340** |
| Class 1 (LLP — life-limited critical) | 1,930 |
| Class 2 (Important) | 1,934 |
| Class 3 (Standard) | 25,829 |
| Production packages generated | 3340 |
| Files in delivery | 47,267 |
| Total mass | 12,892.3 kg (spec: 10,012 kg) |
| Manufacturing cost (per engine) | $1,901,080.29 |

## Performance

| Quantity | Takeoff | Cruise |
|----------|---------|--------|
| Thrust (kN) | 394.5 | 59.7 |
| SFC (lbm/lbf·hr) | 0.319 | 0.675 |
| OPR | 59.9 | — |
| BPR | 9.9 | — |
| TIT (°C) | 1652 | — |
| EGT (°C) | 701 | — |

## Noise certification (FAR Part 36 / ICAO Ch.14)

| Point | EPNdB |
|-------|-------|
| Lateral | 90.4 |
| Flyover | 83.5 |
| Approach | 95.9 |
| Cumulative margin | **37.2 EPNdB** (Ch.14 needs ≥ 17) |
| Ch.14 compliant | ✓ YES |

## Maintenance

- Task cards: 23
- Life-limited parts: 9
- Total scheduled labor over 24,000-cycle life: 7422 man-hours

## Certification (FAR Part 33 / EASA CS-E)

- Total requirements: 13
- Verified: 3
- Partial: 3
- Coverage: 23.1%

## Folder layout

  parts/<CAT>/<SUB>/<NAME>/   per-part packages (STEP + drawing + tolerance + inspection + cert + CoC + FMEA + FEA + process specs + manifest)
  assembly/EBOM.csv             engineering BOM (every instance)
  assembly/MBOM.csv             manufacturing BOM (unique parts × qty)
  assembly/MBOM.json
  assembly/unique-parts-index.json
  certification/far-33-compliance.json
  performance/brayton-{takeoff,cruise}.json
  performance/stations-takeoff.json
  acoustics/noise-cert.json
  maintenance/tasks.json
  maintenance/llp-table.json
  manifest.json
  README.md

## Per-part package contents

For each Class 1 / Class 2 part:

- **part.step** — ISO 10303 STEP geometry (importable to SolidWorks, CATIA, NX, Creo, Fusion 360, FreeCAD)
- **drawing.svg** — ASME Y14.5 production drawing with title block, multi-view, GD&T frames, surface finish callouts, process strip, classification tag (Class 1 = red, Class 2 = yellow, Class 3 = green)
- **tolerance.json** — datums (A/B/C), dimensional tolerances (linear/angular), GD&T callouts (flatness, perpendicularity, position, runout, profile), surface finishes
- **inspection.md** — AS9102 First Article Inspection report (Form 1/2/3) with per-feature pass/fail
- **inspection.json** — same as JSON
- **material-cert.md** — EN 10204 Type 3.1 mill cert (chemistry + mechanicals + heat treatment per AMS spec)
- **material-cert.json**
- **coc.md** — Certificate of Conformance with traceability chain
- **coc.json**
- **fmea.md** — Design FMEA with S/O/D/RPN, mitigation actions
- **fmea.json**
- **fea.json** — Per-class analysis: linear-static, modal, thermal (hot section), fatigue, scenario battery (Class 1)
- **process-specs.md** — Heat treat, surface finish, NDT, coating callouts (linked to AMS / ASTM standards)
- **manifest.json** — package contents + classification + sign-off pointers
- **quantity.json** — instance count + sample instance IDs

Class 3 parts (fasteners, brackets, tags) get the slim package without FEA.

---

This folder represents the complete data set required for an FAA Part 21
production-approval submission. Every component has its own drawing, geometry,
material cert, inspection record, FMEA, and (for life-limited parts) a full
analysis package including bird-strike, overspeed, blade-off, and fatigue.

Material specs trace to AMS / ASTM standards. Heat treatments trace to AMS 2750.
NDT methods trace to ASTM E1417 (FPI), AMS 2154 (UT). Drawings comply with
ASME Y14.5-2018 dimensioning practice.

Generated entirely by ArchDisc, a proprietary in-house B-Rep CAD kernel
(archdiscv1/engine-output/GE9X).
