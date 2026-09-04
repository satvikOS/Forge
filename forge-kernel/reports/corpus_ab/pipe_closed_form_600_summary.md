# Is OCCT an ORACLE for TKOffset families E and F, or only a participant?

probe rows: 600  ·  applicable: 600  ·  not applicable: 0  ·  errors: 0

## Where the closed form applies at all

A mitred sweep whose section is wide compared with the leg length folds
through itself at the bend, and then encloses strictly LESS than
area*length. Those parts are excluded by evidence, not by taste.

| fold-free (oracle applies) | 600 | 100.0% |
|---|---:|---:|
| folds at the bend (oracle does not apply) | 0 | 0.0% |

## What OCCT's own answer obeys, on the fold-free parts

Two named closed forms, on the SAME parts. They differ by 6.7% at this
turn angle, so no tolerance in play can confuse them.

| OCCT MakePipe volume fits ... | parts | of fold-free |
|---|---:|---:|
| the MITRE closed form  A*(L1+L2) | 0 | 0.0% |
| the TRANSFORMED form  A*(L1+L2*cos30) | 600 | 100.0% |
| FIRST LEG ONLY  A*L1 | 0 | 0.0% |
| none of the three | 0 | 0.0% |

OCCT BRepCheck_Analyzer over the same parts: valid=600  invalid=0  no-shape/threw=0

### The threshold is not doing the work

| rel tolerance | fits MITRE | fits TRANSFORMED |
|---|---:|---:|
| 1e-09 | 0 | 578 |
| 1e-07 | 0 | 600 |
| 1e-06 | 0 | 600 |
| 1e-04 | 0 | 600 |
| 1e-02 | 0 | 600 |

OCCT residual against the TRANSFORMED form, fold-free parts: min 0.000e+00 · median 7.318e-16 · max 6.726e-09
OCCT residual against the MITRE     form, fold-free parts: min 6.699e-02 · median 6.699e-02 · max 6.699e-02
