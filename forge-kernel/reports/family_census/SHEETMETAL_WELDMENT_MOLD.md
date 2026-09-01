# Family census — SHEET METAL · WELDMENTS · MOLD / DIE

**Pinned tree:** `a457bea2e9e82a129ea7b0b719fb8a4b56ccaad9`
(`origin/claude/sacrosanct-execution-20260828`, fetched 2026-08-31).
Every `file:line` below is against that SHA.

**Method.** Two independent passes, and the report says which one backs each claim.

1. **Source pass.** Read every `.cpp` implementation end to end — not headers, not
   grep counts. A header that documents a capability and a body that returns its
   input are two different facts, and this family has several of those pairs.
2. **Measured pass.** Executed the shipped N-API addon
   `forge-kernel/build/Release/forge-kernel.node` (built 2026-08-28) with probe
   scripts. That binary is built from a tree that differs from the pinned tree in
   these files **only** by dead-`#include` removal (commit `8b42b9ad`, "zero code
   lines changed") and by `BRepBndLib::Add` → `native::brep::shapeAabb` AABB-source
   swaps — verified by `diff`. No behavioural difference on any path cited here.
   Numbers labelled **MEASURED** came out of that binary.

**Claims I could NOT verify** are listed in the last section rather than softened
in place.

---

## 0. The finding that outranks all three families

> **Every OCCT-only application module silently discards all but the FIRST lump of a
> multi-lump body, and the native engine is ON by default in the shipped addon.**

`forge::sheet`, `forge::sheetextend`, `forge::weld` and `forge::mold` are all
OCCT-only. They reach their input through `ShapeRegistry::get()`
(`forge-kernel/src/ShapeRegistry.cpp:56`), which for a `NativeSolid` handle
materialises an OCCT shape via `occtFromNativeSolid(*e.solid)`
(`ShapeRegistry.cpp:76`). A native `Solid` is one solid. Two disjoint lumps go in;
one comes out. No throw, no diagnostic, no flag on the result.

**MEASURED** — one body, two disjoint 100×60×2 and 25×60×2 plates, `forge.fuse`:

| probe | result |
|---|---|
| `kindOf(cmp)` | `nativeSolid` — the native engine is on (`nativeBrepEnabled() === true`) |
| `massProps(cmp).volume` | **15000.0** (native side sees both lumps) |
| `translate(cmp,0,0,0)` | 15000.0 — native→native, no loss |
| `sheetextend.flatten(cmp, [], 2)` | kind `occt`, **12000** — 3000 mm³ (20%) gone |
| `sheetMetal.unfold(cmp, …)` | **12000.00** — gone |
| `weldments.endCap(cmp, 0, 10, 0)` | **13200** = lump 1 + a cap on lump 1's end — lump 2 gone, cap on the wrong body |
| `mold.analyseDraft(cmp, +Z, 3°)` | **6 faces**, not 12 — half the part invisible to draft analysis |

This is the exact failure mode the owner's constraint names: the system does not
refuse the long tree, it **succeeds while deleting material**. A weldment frame is
disjoint members before they are welded; a mould insert set is two blocks; a
sheet-metal assembly is several blanks. All three families are multi-lump by nature,
and the seam they all sit on loses lumps.

Cheapest honest fix, in the spirit of REPRESENT / REPAIR / TOLERATE: make the bridge
lump-aware (`occtFromNativeSolid` over a lump list → `TopoDS_Compound`); until then,
make it **name what it dropped** rather than return quietly. Refusing is the last
resort, and it is still better than the present silent loss.

---

## 1. SHEET METAL

### 1.1 What is in the repo

Four separate modules, none of which knows about the others:

| module | lines | what it is |
|---|---:|---|
| `forge::sheet` (`src/SheetMetal.cpp`) | 791 | the BRep authoring chain — flanges, hem, jog, corners, unfold, flat pattern |
| `forge::sheetextend` (`src/SheetMetalExtended.cpp`) | 928 | gauge tables, bend math, multi-bend BRep unfold, DXF, relief cut, cost |
| `forge::sheetmetal` (`src/SheetMetalFlatPattern.cpp`) | 85 | BRep-free DIN 6935 K-factor / bend-allowance / developed-length calculator |
| `ft::OpCode::Fold` (`src/ft/FeatureTreeCompiler.cpp:1299`) | ~35 | the IR's one sheet-metal op: a BOX + ROTATE + FUSE flange macro |

### 1.2 Census

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| base flange | **YES, real.** `SheetMetal.cpp:363` — face from wire + `occtPrism` | no | React app only (`sheetMetalDispatch.js:99`); **no** `forge::ui` command | SOLID (+ a WIRE/SKETCH input it cannot get from the IR) | IR op + UI command | none |
| edge flange | **partial.** `SheetMetal.cpp:407` — fuses an **axis-aligned brick**; `extentX/Y` use `abs()` components so only axis-aligned rectangular bases work; **`reliefMode` is ignored** (param commented out at `:412`); **no bend radius geometry** — the corner is square, the radius exists only as metadata | no | React only | SOLID | real bend geometry (arc + tangent walls) on an arbitrary edge | none |
| contour flange | **ABSENT** | no | no | PROFILE + SOLID | new | none |
| miter flange | **NO.** `SheetMetal.cpp:550` is a bare `for` loop of `edgeFlange`. The header at `:135` claims "miters adjacent flanges"; the file header at `:15` claims "+ small chamfer between adjacent flanges to eliminate overlap". **Neither is in the body.** Adjacent flanges interpenetrate | no | React only | SOLID | actual corner miter/trim | none |
| bend (sketched) | **NO GEOMETRY.** `SheetMetal.cpp:591` records a `BendRecord` and returns the input shape unchanged (`:625-629`, the comment admits it). **MEASURED:** vol 12000 → 12000 | no | React only | SOLID | split the face + hinge-rotate one side | none |
| **unfold** | **NO.** `SheetMetal.cpp:716` returns `brickAt(baseLen + Σ devLength, baseWid, thickness)` — a **rectangular block**. Every hole, notch and relief in the part is erased | no | React only | SOLID | see 1.4 | none |
| **FLAT PATTERN** | **NO.** `SheetMetal.cpp:748` returns a **4-point rectangle wire** (`:772`) of the same two numbers. There is no outline, no hole loop, no bend line | no | React only | needs a PROFILE/2D-DRAWING kind the IR does not have | see 1.4 | none |
| multi-bend BRep unfold | **PRESENT BUT INERT.** `SheetMetalExtended.cpp:385` is a real partition-and-rotate. It partitions by **`TopAbs_SOLID`** (`:353`) and its own comment (`:347-352`) states the assumption "every solid sub-volume is wholly on one side". `edgeFlange` **fuses** the flange onto the base, so the formed part is ONE solid and the assumption never holds: the whole part lands in one group and the code either `continue`s (`:456`) or rigidly rotates the entire body. **MEASURED:** volume AND centre-of-mass identical for bend-edge indices 0,1,2,3 | no | **nothing calls it** | SOLID | feed it un-fused lumps, or partition by face | none |
| corner relief | **`forge::sheet` is a NO-OP.** `SheetMetal.cpp:700` validates `sizeMm` then `return attachAndReturn(src, …)` — `vertexId`, `params` and `mode` are all commented out. **MEASURED:** vol 12000 → 12000. **`forge::sheetextend::cornerRelief` (`:759`) is REAL** — a genuine `BRepAlgoAPI_Cut`, **MEASURED** 12108.0 → 12072.9 | no | **`sheetextend` version reachable by nobody**; the React app calls the no-op one (`sheetMetalDispatch.js:192`) | SOLID | point the app at `sheetextend` | none |
| jog | **partial.** `SheetMetal.cpp:635` = one `edgeFlange` + a second bend record. There is no Z-step geometry: a jog needs two opposed bends and a return-to-plane | no | React only | SOLID | second flange with reversed offset | none |
| hem | **partial.** `SheetMetal.cpp:568` = one 90° `edgeFlange` + a 180° bend record. **`hemType` is ignored** (`:571`), so closed / open / tear-drop / rolled are the same geometry | no | React only | SOLID | fold-back geometry per type | none |
| louver / lance / dimple / rib / drawn cutout / cross break | **JS-composed only**, `sheetMetalDispatch.js:357-441`. Box/cylinder stamps cut or fused. **Defect:** `placeStamp` (`:341`) never translates the stamp — every forming feature lands at the ORIGIN. The `position` argument is destructured and echoed back but never applied | no | React only | SOLID | translate the stamp; then real form geometry | none |
| punch / punch tool library | **ABSENT** | no | no | SOLID + a tool-library concept | new | none |
| **K-factor / bend-allowance tables** | **YES, real and correct.** `SheetMetalFlatPattern.cpp:16` DIN 6935 K(R/T) per material; `:35` `computeBend`; `:53` `unfoldChain`. `SheetMetalExtended.cpp:238` real SAE/ASTM gauge tables. **MEASURED:** `gaugeProperties("steel",16)` → 1.519 mm / 7860 kg·m⁻³ (correct); `bendAllowance(90,3,2,0.44)` → BA 6.0947, BD 3.9053, setback 5.000 (matches the closed form) | no | `forge.sheetmetal.*` bound at `binding.cpp:8174`; `forge.sheetextend.*` at `:16398` — **neither has a single caller anywhere in the repo** | none — pure numbers | wire it up | none |
| DXF flat-pattern export | **YES, real.** `SheetMetalExtended.cpp:570` emits AC1009. **MEASURED:** 447 bytes, valid header | no | **no callers** | none | wire it up | none |
| cost estimate | **YES, real.** `SheetMetalExtended.cpp:870`. **MEASURED:** returns real mass/cut-time/USD | no | **no callers** | none | wire it up | none |
| `FOLD` — the IR's flange | **YES, real.** `FeatureTree.hpp:122`, `FeatureTreeCompiler.cpp:1299`. BOX + ROTATE-about-hinge + FUSE from verified native ops | **YES** | **NO** — `ArchieOpVocabulary.hpp:186`: "no command in the forge::ui registry emits it" | SOLID | one UI command | scored as plain geometry by CADGenBench, like any solid |

### 1.3 Two unit defects, both MEASURED

**(a) The bend radius the app sets never reaches the kernel.**
`sheet_bind::readParams` (`binding.cpp:4800`) reads the key **`minBendRadius`**.
`sheetMetalDispatch.js:61` returns the key **`bendRadius`**. Non-matching keys fall
to the default. **MEASURED**, same call three ways:

| params | `bend.radius` recorded | flat width |
|---|---:|---:|
| `{thickness:2, bendRadius:3, kFactor:0.44}` | **0.5** (the default) | 102.168 |
| `{thickness:2, minBendRadius:3, kFactor:0.44}` | 3 | 106.095 |

Every bend the app produces is developed at R = 0.5 mm regardless of what the user
typed.

**(b) The shipped regression guard is anchored to a degrees-as-radians bug.**
`test/sheet_flat_pattern_smoke.js:32` passes `90` to a parameter the binding names
`angleRad` (`binding.cpp`, `SmEdgeFlange`) and passes straight through.
**MEASURED:** that call gives `devLength = 124.200` — which is (0.5 + 0.44·2) × **90
radians**. Flat width 224.2. The same call with π/2 gives 102.168. The test asserts
`flatW > 200 && flatW < 240` (`:49`) — a band that the **correct** call fails. The
React app does convert (`D2R`, `sheetMetalDispatch.js:122`), so the app and its own
kernel smoke test disagree about the units. The app-level e2e (`e2e/push-43-sheet-flat.spec.js:175`)
asserts only `wdt > 99`, which cannot tell a correct develop from either wrong one.

**(c) The flat pattern omits the flange's own material.** `flatLen = baseLen + Σ devLength`
(`SheetMetal.cpp:769`) adds the bend allowance and never the flange length.
**MEASURED**, 100 mm base + 25 mm flange, 90°, R3, t2, K0.44:

| path | developed length |
|---|---:|
| `sheetMetal.flatPattern` (BRep) | **106.095** |
| `sheetmetal.unfoldChain` (the correct calculator, same inputs) | **131.095** |

Difference **25.000 mm** — exactly the flange. Cut to this flat pattern and the
flange does not exist.

### 1.4 Answers

**1. Already built and merely unreachable — call this out first.**

The **entire `forge::sheetextend` module** — 928 lines, bound to JS at
`binding.cpp:16398` — has **zero callers**. Not one test, not one frontend import,
not one e2e spec. A repo-wide grep for `sheetextend` returns exactly four files: the
header, the implementation, the binding, and one line of `docs/KERNEL_PARITY_PLAN.md`.
Inside it, **MEASURED** as working: real SAE/ASTM gauge tables, correct
BA/BD/setback math, a real DXF writer, a real corner-relief boolean cut, a real cost
model. Five of its six functions work and nothing calls them. (The sixth,
`flatten`, is the inert one — see 1.2.)

`forge::sheetmetal` (the DIN 6935 calculator) is likewise bound and uncalled — and
it is the module that computes the developed length **correctly**, while the BRep
path the app actually uses computes it wrong by a whole flange.

And `FOLD` is a real, compiling IR op that no user can reach
(`ArchieOpVocabulary.hpp:186`).

The `forge::ui` C++ shell has **no** sheet-metal surface at all: zero commands, and
no `Sheetmetal` workspace (`WorkspaceProfile.hpp:23-32` lists Part, Sketch,
Assembly, Surface, Manufacturing, Drawing, Simulation, Archie). Its own reachability
test uses the string `"Sheetmetal"` as a **fake category** with the comment
*"claimed by no workspace, now or ever"* (`ui/test/app_surface_reachability_test.cpp:371`).

**2. New IR value kind required.**

Two, and they are the reason this family cannot be an IR family today:

- A **SHEET/BLANK** value kind — a solid that carries `{thickness, kFactor, bend
  list}`. `SheetMetalRegistry` (`SheetMetal.hpp:93`) already IS this side-table; the
  IR simply has no way to name it. Without it, `FOLD` produces a sharp-cornered
  wall with **no bend record**, so a `FOLD` chain can never be flattened — the IR's
  one sheet-metal op is unflattenable by construction.
- A **FLAT PATTERN / 2D-DRAWING** value kind. The flat pattern is not a solid and
  not a `PROFILE` (which the IR fixes to the Z=0 sketch plane): it is an outline
  plus hole loops plus bend lines on separate layers. `RESULT(%n)` can only bind a
  SOLID.

**3. Genuinely absent, and how long.**

- *Days:* wire `sheetextend` + `sheetmetal` to the app; fix the `bendRadius`/`minBendRadius`
  key mismatch; fix the smoke test's units; add the flange length to `flatLen`;
  translate the JS forming stamps.
- *Weeks:* real bend geometry (arc + tangent walls, an actual radius rather than a
  metadata field); a working `flatten` (partition by face, or keep lumps un-fused
  until unfold); real corner relief and miter in `forge::sheet`; hem types; a real jog.
- *Months:* a general flat pattern — bend-graph walk, face-tree flattening,
  neutral-axis offsets in 3-D, holes and forms carried through the develop, collision
  detection on unfold. The `SheetMetal.hpp:29-46` "UNFOLD LIMITS" header says exactly this and is
  honest about it. Add contour flange and a punch-tool library on top.
- *Blocked on the IR:* everything above is invisible to Archie until the SHEET and
  FLAT-PATTERN value kinds exist.

**4. Minimal honest version.**

A sheet-metal system that cannot flatten is not one. The smallest thing that makes
this real:

1. Point the app at `forge::sheetextend` and `forge::sheetmetal` instead of the
   `forge::sheet` approximations — this alone replaces a rectangle with a correct
   developed length and a real DXF, and costs days.
2. Add the flange length to the develop (a one-line correctness fix worth 25 mm on
   the shipped example).
3. Make `flatten` work on the parts the repo actually builds — the cheapest route
   is to stop fusing the flange in `edgeFlange` and keep the lumps until unfold,
   which also exercises the §0 bridge fix.
4. Add one IR op pair — `SHEET(...)`/`FLATTEN(%body)` — and one `forge::ui` command
   for `FOLD`. Then a sheet-metal part is something Archie can emit and a user can
   click.

Everything else is decoration until a flat pattern is a real outline.

---

## 2. WELDMENTS / STRUCTURAL FRAMES

### 2.1 Census

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| structural member along a skeleton | **GEOMETRY IS A SOLID BOX for every profile.** `Weldments.cpp:295` calls `sweepRectTubeAlongSegment` (`:156`), which reads only `w` and `h` and emits `occtBoxSolid`. `t`, `tw`, `tf`, `d` are never read for geometry. It also sweeps only along the **dominant axis**, so any non-axis-aligned path is silently squared off. `Alignment` is ignored (`:158`) | no | React only (`weldmentsDispatch.js:161`); **no** `forge::ui` command | SOLID | real section profiles + a real sweep | none |
| — the 7-profile library | **numerically real, geometrically unused.** `profileArea` (`Weldments.cpp:121`) computes correct I/C/rect-tube/round-tube/angle/channel/flat-bar areas — and feeds **only the cut-list weight** | — | — | — | — | — |
| **trim / extend at joints** | **NO GEOMETRY AT ALL.** `Weldments.cpp:504` copies member A, writes a metadata field, and **`(void)memberB;`** (`:520`). Miter records a hard-coded **`miterDeg = 45.0`** (`:516`) regardless of the actual joint angle | no | React only | SOLID | a real section/cope boolean | none |
| — cope / saddle cut | **PLANNER ONLY, DEAD CODE.** `frontend/src/foundation/CopeCut.js` is 145 lines of correct closed-form saddle math whose own docstring says *"the actual material removal is a boolean subtract handled by the foundation Features layer"*. A repo-wide grep for `CopeCut` outside that file returns **nothing** | no | no | SOLID | connect the planner to a boolean | none |
| gusset | **a brick at the bbox min corner.** `Weldments.cpp:399` ignores `vertexId` (`:401`) and fuses an axis-aligned box at `(xmin,ymin,zmin)`. It is not triangular and it is not at the joint | no | React only | SOLID | triangular plate at a real vertex | none |
| end cap | **always the +X bbox end.** `Weldments.cpp:350` ignores `openingEdgeId` and `offsetMm` (`:351-353`) | no | React only | SOLID | pick the real opening | none |
| weld bead | **a cube at the edge midpoint.** `Weldments.cpp:449` fuses a `2·beadSize` box centred on each selected edge's midpoint. It is not swept along the edge, and `BeadKind` is ignored (`:452`) | no | React only | SOLID | sweep a bead section along the joint curve | none |
| cut list / BOM | **real per member, but there is no assembly.** `Weldments.cpp:527` returns the `MemberRecord` list. Each `structuralMember` call creates its **own** `WeldmentRoot` with exactly **one** member (`:329-345`); the header at `:528-531` concedes "the JS facade is responsible for concatenation" | no | React only (`WeldmentCutlistPanel.jsx`) | needs an ASSEMBLY kind | a real weldment root | none |
| weld strength / group / heat / distortion | **real analysis, unrelated to modelling.** `FilletWeld.cpp` (AISC J2 / AWS D1.1), `WeldGroup.cpp` (elastic-vector), `WeldHeatInput.cpp`, `WeldElectrode.cpp`, `WeldingFea.cpp` (Goldak + J2 plasticity, 436 lines) | no | React workbenches | none | — | none |

### 2.2 MEASURED

One 1000 mm member, three profiles, and the joint ops:

| probe | result |
|---|---|
| `RectTube 50×50×**3**` | `massProps.volume` = **2 500 000** = a **solid** 50×50×1000 box. The 3 mm wall is not modelled |
| `RoundTube d50 t3` | **2 500 000** — a 50×50 **box**; `d` is never read for geometry |
| `IBeam 50×100, tw 5, tf 8` | **5 000 000** = a solid 50×100×1000 box. No web, no flanges |
| cut-list weight, RectTube | **4.4274 kg** — correct for the real 564 mm² section |
| geometry mass of the same member | 2 500 000 mm³ × 7.85e-6 = **19.6 kg** |
| `trimMember` butt / miter / coped | volume **2 500 000 → 2 500 000** in all three. Coped records `miterDeg: 0` |
| `gusset(member, 0, size 60, thk 8)` | **+4800 mm³**, not 60·60·8 = 28 800. The brick is 83% buried inside the member it is meant to reinforce |
| `endCap(member, 0, 10, 0)` | **+25 000** = 50×50×10, correct size, always on +X |

The geometry and the cut list disagree by **4.4×** on the same member. Whichever one
a downstream consumer trusts, the other is wrong.

Two silent substitutions in the binding: `parseTrimMode` (`binding.cpp:5428`) and
`parseBeadKind` (`:5435`) return the **first enum value** for any unrecognised
string. `parseProfileKind` (`:5379`) throws. The same file treats an unknown profile
as an error and an unknown trim mode as a butt joint.

### 2.3 Answers

**1. Already built and merely unreachable.**
Less here than in sheet metal, and it should be said plainly rather than padded.

- `CopeCut.js` — a correct, complete saddle-cut planner with **no consumers**. It is
  the one weldment asset that is genuinely finished and disconnected.
- `profileArea` (`Weldments.cpp:121`) — a correct 7-profile section library used
  only for a weight number, never for geometry. The data to build real sections is
  already there.
- The whole `forge::weld` namespace is bound at `binding.cpp:6651` and has **no**
  `forge::ui` command and no IR op — reachable only from the React app.

**2. New IR value kind required.**
An **ASSEMBLY / MULTI-BODY** kind, and it is the blocker. A weldment is *n* members
that stay individually identifiable through trims, beads and the cut list. The IR
has PROFILE, SOLID, WIRE — one value per op, and every boolean collapses two into
one. `cutList` already fails on this in C++ (one root per member). Adjacent, and
also missing: a **SKELETON / CURVE-NETWORK** kind (the IR's `WIRE` is a single
closed ring, not a frame graph) and a **SECTION-PROFILE-LIBRARY** concept.

**3. Genuinely absent, and how long.**
- *Days:* build the seven real section profiles as closed wires and extrude them —
  `profileArea` already proves the dimensions are understood; make
  `parseTrimMode`/`parseBeadKind` throw instead of substituting.
- *Weeks:* a real sweep along an arbitrary path (not the dominant axis); connect
  `CopeCut.js` to a boolean; put the gusset at a real joint vertex as a triangular
  plate; sweep the bead along the joint curve; a single weldment root that owns
  every member.
- *Months:* the frame layer — a 3-D skeleton, automatic joint detection, trim/extend
  as a solved joint system rather than per-pair, and a cut list keyed to member
  identity that survives editing.
- *Blocked on the IR:* everything, until an ASSEMBLY kind exists.

**4. Minimal honest version.**
A weldment system whose members are boxes and whose joints do nothing is
decorative. The smallest real version:
1. Real section geometry for the seven profiles (days, and it removes the 4.4×
   geometry-vs-BOM contradiction).
2. One real joint operation — miter, via `BRepAlgoAPI_Section` between two members —
   so `trimMember` changes the geometry it claims to trim.
3. One weldment root that owns *n* members, so the cut list is a BOM rather than a
   single row.

That is a frame you can cut and weld. Gussets, caps and bead cosmetics can wait.

---

## 3. MOLD / DIE

`src/Mold.cpp` (477 lines) is the file the brief asked about. It is a **TKBO call
site** — `reports/TKBO_BOOLEAN_STATE.md:205` records `Cut ×2, Splitter ×1` at
`Mold.cpp:345,393,315`, and `reports/TOOLKIT_ELIMINATION_MAP.md:357-361` lists
`BRepAlgoAPI_Splitter` ×3 and `BRepAlgoAPI_Cut` ×2 with **"— none —"** in the native
replacement column.

### 3.1 Census

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| **draft ANALYSIS** | **YES, genuinely real and correct.** `Mold.cpp:153` — per-face outward normal at the parametric centroid, orientation-corrected, classified positive / negative / vertical against the pull direction. **MEASURED:** a 100×100×60 box pulled +Z → 1 positive, 1 negative, 4 vertical. Exactly right | no | React `MoldWorkbench.jsx:25` | needs no new kind (reports numbers, not geometry) | already done | none |
| **draft CONSTRUCTION** | **YES via OCCT, 0% native.** `forge::part::draftFaces` (`include/forge/Features.hpp:174`, `src/Features.cpp:2078`), bound at `binding.cpp:5089`. `reports/CORPUS_AB_COVERAGE.md:184`: DRAFT native **0.0%** vs OCCT **88.0%** over 565 parts, −88.0% [−90.6, −85.3], McNemar p = 4.9e-150. `reports/TOOLKIT_ELIMINATION_MAP.md:265`: "the whole ladder is blocked on family J" | **NO** — there is no `DRAFT` op in the 40-op `OpCode` table | no `forge::ui` command | SOLID | an IR op + a UI command; native parity is the separate OCCT-zero programme | scored as plain geometry |
| **parting LINE** | **YES, real — and thrown away.** `Mold.cpp:194-226` genuinely detects silhouette edges (the two adjacent faces' normals disagree in sign against the pull). `partingLines` is returned and then **never used** | no | React `kernelDispatch.js:464` | needs a CURVE-ON-SOLID kind | — | none |
| **parting SURFACE** | **NO — it is a flat plane.** `Mold.cpp:243-293` ignores `partingLines` entirely and builds a **rectangular patch through the bbox centre, perpendicular to the pull**, sized 1.5× the diagonal (`:253`, `:272`, `:293`). The header at `:20-25` claims the wire is stitched from the silhouette and extruded. It is not | no | React | SURFACE (does not exist) | a real ruled/swept surface from the parting curve | none |
| core / cavity split | **partial, and lossy.** `Mold.cpp:299` — real `BRepAlgoAPI_Splitter` + per-half `Cut`. But it keeps only the **highest-Z and lowest-Z** solids (`:325-333`) and discards everything between | no | React `kernelDispatch.js:473` | SOLID | keep every piece; split on the real surface | none |
| shut-off surfaces | **ABSENT** — repo-wide grep for `shutoff` / `shut-off` / `shut_off`: zero hits | no | no | SURFACE | new | none |
| shrinkage compensation | **ABSENT** — the only `shrink` hits are concrete creep, prestress losses and earthwork mass-haul | no | no | none (a scale) | trivial once there is a mould feature | none |
| slides / lifters / side actions | **ABSENT** — zero hits for `lifter`, `side action`, `ejector`. `analyseDraft` *identifies* the negative-draft faces that need them and nothing consumes that | no | no | SOLID + ASSEMBLY | new | none |
| cooling channels | **YES, real.** `Mold.cpp:359` — a real cylinder per channel, real `BRepAlgoAPI_Cut` | no | React `MoldCoolingPanel.jsx:436` | SOLID | — | none |
| runner / sprue / gate | **YES, real.** `Mold.cpp:403` — tapered cone + cylinders | no | React `MoldWorkbench.jsx:48` | SOLID | — | none |
| flow simulation | **YES, real.** `MoldFlow.cpp` — Hele-Shaw + Cross-WLF | no | React `MoldFlowWorkbench.jsx:224` | none | — | none |

### 3.2 The parting detector cannot see the parting lines that matter — MEASURED

`computeParting`'s silhouette test is `dots[0] * dots[1] < 0.0` (`Mold.cpp:223`) over
**edges**. A parting line that runs across the *interior* of a face has no edge to
find, and a zero-draft wall gives a product of exactly zero, which is not `< 0`.

| part | result |
|---|---|
| **box** 100×100×60 | `computeParting` **THROWS**: "no silhouette edges found (part may have no draft along pullDir)" |
| **cylinder** r50 h80 | **THROWS** |
| **sphere** r50 | **THROWS** — and a sphere's equator is the textbook parting line |
| **cone** r60→r30 h80 | works: `partingLineCount = 1` |

A vertical-walled part — the normal state of a moulded part before draft is applied,
and the most common thing a user will click this on — has no parting line by this
test. `mold.parting`, `mold.cavity` and `mold.core` in the React app
(`kernelDispatch.js:464-508`) all fail there.

### 3.3 The two mould halves do not close — MEASURED

Cone r60→r30 h80 (volume 527 787.6) inside a 300³ block that fully encloses it:

| quantity | value |
|---|---:|
| block | 27 000 000 |
| block − part | 26 472 212 |
| cavity | 13 242 423 |
| core | 13 072 870 |
| **cavity + core** | **26 315 293** |
| **missing** | **156 919 mm³** |

The parting slab is `max(1, 0.01·diag)` thick (`Mold.cpp:284`), the splitter returns
three solids (below, slab, above), and `:325-333` keeps only the extreme-Z pair. The
slab's own material is dropped, so the two halves are separated by a ≈1.7 mm gap.
A mould whose halves do not meet does not close.

Separately, `kernelDispatch.js:496` builds the mould block with `f.makeBox(bw,bh,bd)`
and never translates it. **MEASURED:** `forge.makeBox(10,20,30)` has centre of mass
`[5,10,15]` — the corner is at the origin. Any part not sitting in the +++ octant at
the origin is not enclosed by its own mould block.

### 3.4 Answers

**1. Already built and merely unreachable.**

- **`draftFaces` is the big one.** Real draft *construction* at 88% on the corpus,
  bound to JS — and there is **no `DRAFT` op in the IR** and no `forge::ui` command.
  Archie cannot ask for draft on any face of any part. Adding `DRAFT(%body, "sel",
  angleDeg, neutralPlane)` to the op table is one op, one builder case, one UI
  command, and it unlocks the single most-used mould-design feature in every
  competitor. This is the cheapest capability in this census.
- `analyseDraft`, `insertCoolingChannels` and `buildRunnerSystem` are all real, all
  bound at `binding.cpp:7099`, and all invisible to the IR.
- The silhouette edges `computeParting` already computes correctly are discarded by
  the very function that computes them — the hard half of parting-line detection is
  done and unused.

**2. New IR value kind required.**

**SURFACE** — and this family is blocked on it more completely than the other two.
A parting surface, a shut-off surface and a runner split are all *surfaces*: not
watertight, not solids, and unnameable in an IR whose kinds are PROFILE / SOLID /
WIRE. That is precisely why `computeParting` returns a thin **prism** — it needed
something the SOLID world could hold. (SURFACE is already assigned to another
agent; this census assumes it lands and notes that mould/die is its most demanding
consumer, because a parting surface must be *trimmed to a curve*, not just a patch.)
Also wanted: a **CURVE-ON-SOLID** kind for the parting line itself, and an
**ASSEMBLY** kind for the core/cavity/slide/lifter set.

**3. Genuinely absent, and how long.**

- *Days:* `DRAFT` as an IR op + a UI command over the existing `draftFaces`;
  shrinkage as a uniform scale; keep every solid from the splitter so cavity + core
  tile the block; translate the mould block to the part.
- *Weeks:* a parting surface built from the parting **curve** instead of a plane
  (needs SURFACE); a silhouette detector that finds curves inside faces, not just
  sign-flipping edges.
- *Months:* shut-off surfaces (automatic hole capping and patching — the single
  hardest thing in mould design), slides and lifters driven by the negative-draft
  faces `analyseDraft` already finds, and multi-cavity tooling.
- *Blocked elsewhere:* native draft is 0.0% and gates the whole OCCT drop ladder.
  That is the OCCT-zero programme's problem, not this family's — mould/die works
  today on OCCT draft and should not wait for native parity.

**4. Minimal honest version.**

Mould/die is the family closest to real, because analysis, cooling and runners
already work. The smallest thing that makes it real:
1. `DRAFT` in the IR and in the UI. Without draft construction there is nothing to
   mould.
2. A parting surface built from the detected parting curve, and a split that keeps
   every piece so cavity + core = block. Today's flat plane is correct only for
   parts whose parting line happens to lie on the bbox equator.
3. A parting-line detector that does not throw on a cylinder.

Shut-off surfaces, slides and lifters are the next tier and are genuinely months.

---

## 4. Benchmark relevance — the honest answer

**No target benchmark scores sheet metal, weldments, or mould design. None.**

- **CADGenBench** scores `0.4·shape + 0.4·interface + 0.2·topology`, gated by
  validity, on the resulting solid (`CADGENBENCH_SPEC.md:162`, `:280`, `:406`).
  There is no manufacturing-toolset axis, no flat-pattern score, no cut-list score,
  no draft-analysis score. `COMMUNITY_TRENDS.md:364-366` states it directly:
  CADGenBench is "geometry-correctness, not manufacturability".
- The seven post-CADGenBench targets (`sacrosanct.md:18-24` — BenchCAD,
  neuralCAD-Edit, Drawing2CAD, ParaCAD, Text2CAD-Bench, HistCAD, MUSE) are CAD
  *program generation* benchmarks over text, drawings and edit histories. **MUSE**
  is the only manufacturability-adjacent one, and `COMMUNITY_TRENDS.md:369-371`
  marks it "potential future Forge target, not currently implemented".

**What this does and does not mean.**

It means: none of these three families will move a benchmark number **as a family**.
Building a real flat-pattern engine to raise a CADGenBench score is a category
error, and any plan that justifies them that way is justifying them falsely.

It also means the reverse is **not** true, and the distinction matters:

- These families are geometry. A sheet-metal bracket, a welded frame and a moulded
  housing are all scored by CADGenBench as ordinary solids. What blocks Archie there
  is not "no sheet-metal benchmark" — it is that the 18-op user-invocable vocabulary
  cannot express a bent, radiused, relieved plate at all, and `FOLD` (which could
  approximate one) is forbidden. **That** is a benchmark-relevant fact hiding inside
  a family that is not benchmark-scored.
- The §0 bridge defect is benchmark-relevant on its own terms: any op that routes a
  multi-lump native body through an OCCT-only module silently loses material and
  reports success. A validity gate that only checks watertightness will pass it.

And independent of every benchmark: the owner's claim is *"all CAD op families …
CATIA/NX grade"*. A CAD system without a flat pattern, without a real weldment
joint, and without a parting surface is not NX-grade, whatever it scores. Both
answers are true at once, and neither excuses the other.

---

## 5. What I could NOT verify

- **Native (`FORGE_NATIVE_BREP`) branches in these files.** All three modules carry
  gated native paths that their own comments say defer 100% of the time today
  (`SheetMetal.cpp:50-66`, `SheetMetalExtended.cpp:389-403`, `Weldments.cpp:194-215`).
  I read them; I did not build with the gate on to confirm they still defer. The
  comments are specific about *why* they defer (no OCCT-wire → native importer) and
  I found no contradicting code, but this is a read, not a measurement.
- **The React workbenches end to end.** I verified their kernel call sites by
  reading and verified the kernel functions by execution. I did not launch Electron
  and click through `SheetMetalWorkbench`, `WeldmentsWorkbench` or `MoldWorkbench`.
  The Playwright specs exist (`e2e/push-43`, `push-178`, `push-08`, `v4-201`) — I did
  not run them.
- **Whether `forge-desktop` compiles at all.** The `forge::ui` command registry is
  the authority for "user-invocable" in `ArchieOpVocabulary.hpp`, and I read it
  directly. I did not build the desktop shell.
- **`exportDxf` output correctness beyond the header.** MEASURED 447 bytes with a
  valid `AC1009` header; I did not open it in a DXF reader or check the entity
  geometry against the source faces.
- **Anything about `HSSRoundBending.cpp` / `BoltedFlange.cpp`.** Adjacent names,
  read only far enough to confirm they are analysis calculators, not modelling ops.
