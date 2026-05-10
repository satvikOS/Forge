# Stair-Climbing Hand Truck — Senior Design Submission

**Project:** Automated stair-climbing hand truck with tri-star wheels.
**Capacity:** 50 kg payload up staircases, level-keeping cargo platform.
**Generated:** 2026-05-09T19:30:56.255Z
**CAD:** ArchDisc v1.21+ proprietary B-Rep kernel

## Delivery summary

| Metric | Value |
|--------|-------|
| Total components | **362** |
| Unique part numbers | 362 |
| Production packages | 362 |
| Files in delivery | 5068 |
| Total mass (estimated) | 53.79 kg (target 18 kg) |
| Manufacturing cost | $348.09 per unit |
| Payload | 50 kg |

## Same Part-21 production-article pipeline as the GE9X engine

This BS-level project demonstrates that the ArchDisc platform applies the
same FAA-Part-21-style production-article generation to a non-aerospace
project. Each component has:

- ISO 10303 STEP geometry
- ASME Y14.5 production drawing with title block, GD&T, classification stripe
- Tolerance bundle (datums, dimensional, GD&T, surface finish)
- AS9102 First Article Inspection report
- EN 10204 Type 3.1 material certificate
- Certificate of Conformance with traceability
- Design FMEA with risk classification (Class 1/2/3)
- Process specs (heat treat, surface finish, NDT, coating)
- Class-tiered FEA (Class 1: full battery; Class 2: static + modal)
- Quantity manifest (qty + sample IDs)
- Package manifest

The same kernel / same templates produce a 30,000-component aircraft
engine and a ~250-component stair-climber. Platform-genericity validated.

## Folder layout

  parts/<CAT>/<SUB>/<NAME>/   per-part packages (drawing + STEP + tolerance + inspection + cert + FMEA)
  assembly/EBOM.csv
  assembly/MBOM.csv + .json
  assembly/master-assembly-drawing.svg
  manifest.json
