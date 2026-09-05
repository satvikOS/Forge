# FORGE_FT_ARCHELIX — ARC and HELIX in the feature-tree IR

Candidate flag, **default OFF**. Everything here was measured; nothing is asserted.

## What the two ops are

```
%1 = ARC([x y; x y mx my; ...])                  closed PROFILE, lines + true arcs
%2 = HELIX(pitch, height, radius
           [, cx,cy,cz, axx,axy,axz] [, LEFT])   a true helical WIRE
%3 = SWEEP(%prof, %pathWire
           [, PLACE, deg, ax,ay,az, tx,ty,tz]
           [, FRENET])                           the consumer
```

`ARC` row forms:

* `x y` — the segment **arriving** at this vertex from the previous one is a straight line.
* `x y mx my` — that segment is the circular arc from the previous vertex, **through**
  `(mx,my)`, ending at `(x,y)`.
* Row 0 is the start point, and if it carries four numbers the **closing** segment
  (last vertex back to the first) is an arc instead of the straight `.close()` line.

## Why a through-point, and not a radius or a bulge

Measured over all 17,900 BenchCAD `code_gen` GT programs:

| construct | rows | note |
|---|---|---|
| `threePointArc` | 1,496 | arcs inside a closed profile |
| `radiusArc` | 417 | always a **sweep path**, never a profile (pipe_elbow / duct_elbow) |
| `cq.Wire.makeHelix` | 405 | **always** a sweep spine; all 405 call sites pass exactly 3 positional args |
| `sagittaArc` | 0 | — |

CadQuery's `radiusArc` is *defined* as a `sagittaArc`, which is *defined* as a
`threePointArc` (`cadquery/cq.py`). So one through-point primitive closes both call
sites exactly, with the conversion performed where the reference implementation
performs it.

`POLY`'s bulge column already existed and is **not** sufficient. Both sketch readers
normalise an arc's sweep into `(-pi, pi]` and return the **minor** arc
(`src/Sketcher.cpp`, "MINOR-ARC NORMALISATION"), which is why `profPoly` must refuse
`|bulge| > 1`. A circlip's outer band sweeps 342 degrees. `profArc` therefore **splits**
any arc wider than 120 degrees into equal sub-arcs on its own circle — same centre,
same radius, same endpoints, extra vertices lying **on** the arc. Exact, not a
tessellation.

A three-point arc also fixes major/minor **and** winding with no sign convention to get
wrong, which a bulge or a signed radius does not.

## Why SWEEP's profile placement is explicit

`SWEEP(%prof, %path, PLACE, deg, ax,ay,az, tx,ty,tz)` rotates the section about the
**world origin** and then translates it — the same composition, in the same order, as
the IR's own `ROTATE` + `TRANSLATE`.

It is not derived from the spine tangent on purpose. A screw thread's section is tilted
by the lead angle (10.1 degrees on `worm_screw`, `atan(9.425 / (2*pi*8.4))`), so
re-framing it onto the tangent would shrink the swept area by `cos(lead)` ≈ 1.6 % —
**inside** the corpus gate's 5 % volume tolerance, i.e. a silent wrong answer.

## Flag-OFF is byte-identical

Two builds of the same tree, same cmake-js configuration, differing only in
`-DFORGE_FT_ARCHELIX`:

| arm | dylib sha256 |
|---|---|
| candidate baseline (before this change) | `c048106dcbfed1e4d68658958d97427ccbe25eded3f9acedb896f8e1a681765d` |
| candidate, flag **OFF**, after           | `689119e578d357c592baf71eedf36aaedd75279c552c40fee28b12ea4c59da39` |

Behavioural A/B over **all 243 rows** of `data/forge/benchcad_ir_gt` (train + heldout),
whole verifier record compared as parsed JSON *and* as raw bytes:

```
IDENTICAL (parsed JSON) 243/243
IDENTICAL (raw bytes)   243/243
```

(`scripts/ab_verifier_identity.py`, report `reports/ab_flagoff_identity.json` in the
Models repo.)

For context, the same A/B between `tools/pinned/forge_verify` and the candidate
**baseline** — i.e. the drift the shared working tree already carries, before this
change — is 236/243, the 7 differences being `bbox` only, on curved parts, with volume /
genus / faceCount identical everywhere. `bbox` is derived from
`tessellate(h, 0.5, 0.8)`, so that drift is a tessellation change, not a geometry one.

## The pin was not touched

`tools/pinned/forge_verify` (`45e9ad9a9b88…`) and its dylib
(`20fe6e74845bb886…`) are unchanged on disk. All new work lives in
`forge-kernel/build-archelix` (flag OFF), `build-archelix-on` (ARCHELIX only) and
`build-ax-sel` (ARCHELIX + DIR_SELECTORS).

## Analytic acceptance tests

`scripts/test_ft_archelix.py` in the Models repo. Every case asserts a **closed form**,
never a number captured from the kernel.

```
[PASS] ARC circle from 2 semicircles           615.752160 vs pi r^2 h        rel 1.7e-10
[PASS] ARC 320-degree major arc + chord        610.328439 vs analytic        rel 2.9e-10
[PASS] ARC 40-degree minor arc + chord         5.423721   vs analytic        rel 1.3e-08
[PASS] ARC rounded rectangle (closing arc)     3111.238898 vs w h -(4-pi)r^2 rel 1.2e-11
[PASS] ARC rrect agrees with kernel RRECT      3111.238898 both
[PASS] ARC refuses collinear 3 points
[PASS] ARC refuses a 3-number row (POLY bulge pasted into an ARC)
[PASS] HELIX tube = pi a^2 L  [1 turn]         1584.128732 vs 1584.128813    rel 5.1e-08
[PASS] HELIX tube = pi a^2 L  [3.5 turns]      2340.079177 vs 2340.078963    rel 9.1e-08
[PASS] HELIX tube = pi a^2 L  [6 turns]        1423.221843 vs 1423.221628    rel 1.5e-07
[PASS] HELIX left-hand tube volume
[PASS] HELIX honours its centre
[PASS] HELIX refuses pitch <= 0
[PASS] SWEEP refuses a SOLID as its path
```

The major-arc case is the load-bearing one: if the minor-arc reader were ever reached
it returns the **complement** — a 5.42 sliver where the answer is 610.33 — with no
error. The minor case is its twin, and the two together prove the through-point is read
rather than ignored.

`pi a^2 L` is Weyl's tube formula (the curvature corrections vanish for a curve in R^3).
It is a strong test because a helix wrong in pitch, turn count **or** radius has a
different arc length, so one number checks all three.

## Against real ground truth

`scripts/cq_to_ir_archelix.py` (the candidate transpiler — a COPY, because 14 shard
harvests were running against `cq_to_ir.py` at the time) transpiled random non-holdout
rows; each tree's volume was compared with the volume of the solid its OWN GT program
builds in CadQuery.

| sample | within 5 % | median &#124;dvol&#124; | note |
|---|---|---|---|
| 24 arc rows (circlip / dog_bone / dome_cap / rivet / snap_clip / spline_hub / wing_nut) | 21 / 24 | **0.0000 %** | 1 lost to a `FILLET` refusal, 2 to defect 2 below |
| 20 helix rows (torsion_spring / worm_screw / pan_head_screw) | 19 / 20 | **0.0000 %** | 1 lost to defect 3 below |

"0.0000 %" is literal: most rows agree with CadQuery to every printed digit.

`ARC` also round-trips exactly through STEP — a circlip profile exported and re-voxelised
against itself scores **voxel IoU 1.0** at 64^3.

## Static coverage over the 17,900, re-measured

| measure | baseline (`cq_to_ir.py`) | candidate | delta |
|---|---|---|---|
| rows with an exact IR op for **every** call | 13,797 / 17,900 = **77.1 %** | 15,903 / 17,900 = **88.8 %** | **+11.7 pts / +2,106 rows** |
| rows the transpiler will actually attempt (`--scan`, holdout excluded) | 12,903 / 17,858 = **72.3 %** | 14,588 / 17,858 = **81.7 %** | **+9.4 pts / +1,685 rows** |

The two rows differ because the second also refuses `slot2D`, partial `revolve`, `taper`,
`shell`, `mirrorY`, `cboreHole`, `cskHole` — semantic gaps, not vocabulary gaps — and
because the 417 **arc-path** sweeps (pipe_elbow / duct_elbow) are counted as covered by
the first and declined by the second, under the cause `sweep-path`. Closing those needs a
third op (an OPEN arc PATH wire) and is not in this change.

`arc-in-profile` (1,698 rows) and `helix` (404) disappear from the decline table entirely.

## Throughput: the 64^3 voxel pass is where curved parts cost

| part | compile + measure | 64^3 self-IoU | result |
|---|---|---|---|
| `BOX(20,10,4)` | 0.04 s | **5.5 s** | IoU 1.0 |
| ARC circlip profile, extruded | 0.07 s | **92.2 s** | IoU 1.0 |
| HELIX 6-turn tube | 2.30 s | **> 480 s** | killed, still running |
| HELIX 1-turn tube | 0.9 s | **> 400 s** | killed at a 400 s ceiling |

Measured on a box already running 16 shard harvests, so these are loaded-machine numbers —
but the *ratio* is the point. The corpus builder runs `--iou-timeout 180`; a helical
solid does not finish in that, and the gated sample duly returned
`gatefail / iou-kernel-timeout`. **HELIX is exact and still yields ~0 corpus rows until
the voxel pass gets cheaper on B-spline lateral faces** (or helix rows get their own
budget). That is the next bottleneck for this op, and it is a rasterisation cost, not a
geometry fault.

---

# THREE DEFECTS FOUND WHILE MEASURING. NONE IS CAUSED BY THIS CHANGE.

## 1. `bbox` collapses on helical solids with an even number of turns

`FeatureTreeCompiler::bboxOf` measures the result by `tessellate(h, 0.5, 0.8)`. On a
helical tube (`p=4, R=12, a=1`) against CadQuery's own bounding box of the same solid:

| turns | kernel bbox x | true bbox x | kernel bbox y | true bbox y | volume |
|---|---|---|---|---|---|
| 1 | [-13.000, 13.000] | [-13.000, 13.000] | [-13.000, 13.000] | [-13.000, 13.000] | exact |
| 2 | **[ 11.000, 13.000]** | [-13.000, 13.000] | **[ -0.053, 0.053]** | [-13.000, 13.000] | exact |
| 3 | [-13.000, 13.000] | [-13.000, 13.000] | [-13.000, 13.000] | [-13.000, 13.000] | exact |
| 4 | **[ 11.000, 13.000]** | [-13.000, 13.000] | **[ -0.053, 0.053]** | [-13.000, 13.000] | exact |
| 6 | **[ 11.000, 13.000]** | [-13.000, 13.000] | **[ -0.053, 0.053]** | [-13.000, 13.000] | exact |
| 8 | **[ 11.000, 13.000]** | [-13.000, 13.000] | **[ -0.053, 0.053]** | [-13.000, 13.000] | exact |

The reported box is a 2 x 0.1 x H sliver at the seam — the coarse mesh keeps nothing but
the caps. **Volume, genus and validity are exact in every one of these rows**, and the
corpus gate reads volume / genus / voxel IoU, so the gate is not fooled. What *is*
affected is any `VERIFY` assertion on an extent or a position, and `CompileResult.bbox`
generally. `VoxelIoU.cpp:613` tessellates at `(0.05, 0.3)`, ten times finer, and does not
show this.

Not a regression: `bboxOf` is untouched by this change, and it is the same routine that
produces the 7 pin-vs-baseline `bbox` differences noted above.

## 2. ALL-edge `CHAMFER` on a rotated solid of revolution returns a NEGATIVE volume with `ok=true`

Reduced from `rivet_002980_s20260505`:

```
%1 = POLY([0 55.7; 9.6 47.9; 6 47.9; 6 0; 0 0])
%2 = REVOLVE(%1,360,0,1,0)
%3 = ROTATE(%2,120,0.57735,0.57735,0.57735)
%4 = CHAMFER(%3,1.2)
```

| binary | volume | valid | ok |
|---|---|---|---|
| `tools/pinned/forge_verify` | **-5401.515508** | false | **true** |
| candidate, flag OFF / ON | **-5401.515508** | false | **true** |
| same tree without the CHAMFER | 6954.3 (correct) | true | true |
| `CYL(6,47.9)` + `CHAMFER(1.2)` control | 5366.69 | true | true |

Identical on the pin, so it is pre-existing and unrelated to ARC/HELIX. Two things are
wrong at once: the chamfer produces an inverted solid, and `forge_verify` reports
`ok=true` for a body it has already marked `valid=false` with a negative volume. The
corpus gate rejects these rows because a negative volume cannot be within 5 % of a
positive one — but it rejects them for the wrong reason, and a caller that trusts `ok`
gets a garbage solid.

## 3. `FUSE` silently loses material when one operand carries a helical face

Reduced from `worm_screw_013261_s20260505`, the one helix row outside 5 %:

| body | kernel | CadQuery (GT) |
|---|---|---|
| filleted shank alone | 392 146.700702 | 392 146.700424 |
| swept thread alone | 31 672.864733 | 31 672.864733 |
| **`FUSE(shank, thread)`** | **299 159.447995**, `valid=false`, 8 faces | 423 819.563340 |

The two operands are exact to twelve digits. Their union is not: the kernel returns
**less than the shank alone**, having deleted 124 660 mm^3 — and reports `ok=true`.
`HELIX` and `SWEEP` are not implicated; the boolean is.

## THE COMMON THREAD IN DEFECTS 2 AND 3

Both return `ok=true` on a body the kernel has *itself* already marked `valid=false`,
with a volume that is respectively negative and smaller than one operand. `valid` was
right both times and `ok` lied both times.

The corpus gate (`cq_to_ir.py`) reads volume, genus and voxel IoU, and **not** `valid`.
It rejected both rows anyway — a negative volume and a 29 % volume error both miss the
5 % window — but it rejected them for an incidental reason. Adding `valid` to the gate
is one line, costs nothing (it is already in the record), and would have caught both
immediately and for the right reason. It is also the cheapest available guard against the
class of failure this whole exercise is about: a solid that is wrong without saying so.

## 4. (context, not a defect of this change) the directional edge selectors need their own flag

`FILLET/CHAMFER(..., MAX_Z)` and friends are `FORGE_FT_DIR_SELECTORS`, default OFF. With
the flag off the compiler still *parses* the keyword and then reports
`no edges match selector 'MAX_Z'`, identically on the pin and on both candidate arms. The
live `scripts/cq_to_ir.py` emits these selectors, so any harvest run against a kernel
built without that flag loses every row that carries one. Measuring ARC and HELIX
therefore required a third build arm with **both** flags on (`build-ax-sel`).
