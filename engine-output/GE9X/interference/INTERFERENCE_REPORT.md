# GE9X Interference Detection Report

Generated: 2026-05-09T16:26:22.801Z

## Method

Group every component by category/subsystem, compute the union bounding
box per group, then perform pairwise AABB overlap check on the
88 groups.

A bbox-level overlap doesn't mean physical interference — most of these
are expected (the LP shaft passes through every disk's bore, casings
enclose blades). The list below is for triage: anomalously large
overlaps between groups that *shouldn't* coexist suggest a positioning
bug.

## Summary

| Metric | Value |
|--------|-------|
| Components with valid solids | 29,693 |
| Category/subsystem groups | 88 |
| Group-pair AABB overlaps | 1615 |

## Top 20 overlaps (by volume)

| Volume (m³) | Group A | Count | Group B | Count |
|-------------|---------|-------|---------|-------|
| 20.6046 | FAS/WSH | 432 | FAS/NUT | 432 |
| 20.5154 | FAS/BLT | 432 | FAS/WSH | 432 |
| 20.5108 | FAS/BLT | 432 | FAS/NUT | 432 |
| 11.2692 | ELEC/HRN | 24 | FAS/BLT | 432 |
| 11.2692 | ELEC/HRN | 24 | FAS/WSH | 432 |
| 11.2692 | ELEC/HRN | 24 | FAS/NUT | 432 |
| 9.3285 | HYD/LIN | 36 | FAS/BLT | 432 |
| 9.3285 | HYD/LIN | 36 | FAS/WSH | 432 |
| 9.3285 | HYD/LIN | 36 | FAS/NUT | 432 |
| 9.2968 | FAS/BLT | 432 | MNT/TAG | 200 |
| 9.2968 | FAS/WSH | 432 | MNT/TAG | 200 |
| 9.2968 | FAS/NUT | 432 | MNT/TAG | 200 |
| 9.2128 | ELEC/HRN | 24 | HYD/LIN | 36 |
| 9.0314 | FAS/BLT | 432 | FIRE/DET | 60 |
| 9.0314 | FAS/WSH | 432 | FIRE/DET | 60 |
| 9.0314 | FAS/NUT | 432 | FIRE/DET | 60 |
| 8.9473 | FIRE/DET | 60 | MNT/TAG | 200 |
| 8.9252 | HYD/LIN | 36 | MNT/TAG | 200 |
| 8.8307 | ELEC/HRN | 24 | MNT/TAG | 200 |
| 8.7996 | FAS/BLT | 432 | ELEC/CNN | 180 |
