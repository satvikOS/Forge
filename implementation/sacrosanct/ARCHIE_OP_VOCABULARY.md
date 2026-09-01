# Archie's op vocabulary — the ops a USER can reach

**The rule.** Archie may only emit feature-tree IR that a human user of the Forge
app could also have produced. The app's entire user-facing surface is the
`forge::ui` command registry — menus, ribbon, palette, context menu and the
Archie tools panel all render from it (`forge-desktop/src/ForgeFrame.cpp` calls
`idsInCategory` / `ids` / `search` / `buildToolCatalog`) — so *what a user can do*
is exactly *what a registered command emits*. The kernel accepts far more than
that, and training on the kernel's table would teach Archie an API the product
does not expose.

That sentence was, for the ribbon, false. `drawToolbar` filtered the registry
through `workspaceCategories()`, a hand-written list of category names, and that
list claimed `"Part"` for no workspace at all — so the commands
`registerPartCommands` filed under `"Part"` (21 of them at that revision, 31 now)
rendered on **no ribbon in any of the eight workspaces**, including every command
that builds geometry. The other four
surfaces enumerate the registry directly and were always complete, which is why
the vocabulary itself was never wrong and nothing went red. The ribbon now uses
`ribbonCategories()`, which makes that list total over the categories the
registry actually holds, and `ui/test/app_surface_reachability_test.cpp` asserts
per surface that every registered command is reachable — the gate that would
have caught it.

## The three files

| file | what it is |
|---|---|
| `implementation/sacrosanct/archie_op_vocabulary.json` | the asset: every op a user can invoke, with its exact signature, parameter names, units, defaults, constraints and worked examples |
| `implementation/sacrosanct/tools/gen_archie_op_vocabulary.py` | derives that JSON **from the sources**; `--check` fails if the committed file is not what the sources imply |
| `ui/test/archie_op_vocabulary_test.cpp` | the runtime gate: builds the same registry the app builds, diffs every command contract against the JSON, and **dispatches all 54 recorded examples**, comparing the statement the document actually recorded token by token |

Nothing in the JSON is hand-written. Op names, argument names, defaults,
arities, parameter schemas, selection signatures and enabled predicates are read
out of `FeatureTree.hpp`, `FeatureTreeCompiler.cpp`, `FeatureIr.cpp`,
`PartCommands.cpp`, `ForgeShell.cpp` and `ForgeFrame.cpp`. The parser is
deliberately brittle: an unrecognised construct raises instead of being skipped,
because a vocabulary that silently drops an op is worse than one that fails to
build.

```
python3 implementation/sacrosanct/tools/gen_archie_op_vocabulary.py --write   # regenerate
python3 implementation/sacrosanct/tools/gen_archie_op_vocabulary.py --check   # gate on drift
bash ui/test/run_ui.sh                                                        # runtime gate
```

## What the asset says

Measured at this revision: the registry holds **45 commands**; **30 of them emit
feature-IR**, reaching **28 distinct op names**. The kernel defines **46** ops
(`opFromName`), so **18 ops plus the `RESULT` terminal are unreachable by any
user** and are listed under `forbidden_ops`.

Every number in that paragraph, and every op row in the table below, is now
checked by `--check` against the JSON it describes. None of it was, and all of
it had drifted: the prose read 31 commands / 16 emitting / 14 ops / 26 forbidden
/ 27 examples where the machine-checked asset said 34 / 19 / 17 / 23 / 32, and
the op table listed 14 of the 17 — `RECT`, `CIRCLE` and `TRANSLATE` were absent
from it, under a paragraph asserting the op-name set is closed. The doc thus
understated the registry by three commands and the vocabulary by three ops while
its own gate was green.

Two properties keep it honest rather than merely correct today. EVERY occurrence
of a number is checked, not the first — `27` and `14` each appeared twice, and a
first-match check reported the doc clean after one of each pair was fixed. And a
sentence REWORDED past its pattern fails as loudly as a wrong number, because a
check that silently stops checking is the failure it was written to prevent.

| op | command(s) | the form(s) a user can emit |
|---|---|---|
| `RECT` | part.sketch_rect | `RECT(width, height)`<br>`RECT(width, height, cx, cy)` |
| `CIRCLE` | part.sketch_circle | `CIRCLE(radius)`<br>`CIRCLE(radius, cx, cy)` |
| `TRANSLATE` | part.move | `TRANSLATE(%body, dx, dy, dz)` |
| `RRECT` | part.sketch_rounded_rect | `RRECT(width, height, corner_radius)`<br>`RRECT(width, height, corner_radius, cx, cy)` |
| `REGPOLY` | part.sketch_polygon | `REGPOLY(radius, sides)`<br>`REGPOLY(radius, sides, cx, cy, rotation)` |
| `RING` | part.section_ring | `RING(rx, ry, z)`<br>`RING(rx, ry, z, cx, cy, p, seg)` |
| `BOX` | part.primitive_box | `BOX(dx, dy, dz)`<br>`BOX(dx, dy, dz, cx, cy, cz)` |
| `CYL` | part.primitive_cylinder | `CYL(radius, height)`<br>`CYL(radius, height, cx, cy, cz, axx, axy, axz)` |
| `CONE` | part.primitive_cone | `CONE(radius_base, radius_top, height)`<br>`CONE(radius_base, radius_top, height, cx, cy, cz, axx, axy, axz)` |
| `SPHERE` | part.primitive_sphere | `SPHERE(radius)`<br>`SPHERE(radius, cx, cy, cz)` |
| `TORUS` | part.primitive_torus | `TORUS(major_radius, minor_radius)`<br>`TORUS(major_radius, minor_radius, cx, cy, cz, axx, axy, axz)` |
| `PRISM` | part.primitive_prism | `PRISM(sides, radius, height)`<br>`PRISM(sides, radius, height, cx, cy, cz)` |
| `TUBE` | part.primitive_tube | `TUBE(outer_radius, inner_radius, height)`<br>`TUBE(outer_radius, inner_radius, height, cx, cy, cz)` |
| `ROTATE` | part.rotate | `ROTATE(%body, angle, axx, axy, axz)`<br>`ROTATE(%body, angle, axx, axy, axz, ox, oy, oz)` |
| `EXTRUDE` | part.extrude | `EXTRUDE(%profile, distance)`<br>`EXTRUDE(%profile, distance, dirx, diry, dirz)` |
| `REVOLVE` | part.revolve | `REVOLVE(%profile, angle)`<br>`REVOLVE(%profile, angle, 0, 0, 0, axx, axy, axz)` |
| `LOFT` | part.loft | `LOFT(%wire...)`, `+ RULED`, `+ OPEN` |
| `TRANSLATE` | part.move | `TRANSLATE(%body, dx, dy, dz)` |
| `HOLE` | part.hole | `HOLE(%body, diameter, x, y, z)`<br>`HOLE(%body, diameter, x, y, z, 0, 0, 1, depth)` |
| `CBORE` | part.counterbore | `CBORE(%body, diameter, cbore_diameter, cbore_depth, x, y, z)` |
| `FILLET` | part.fillet | `FILLET(%body, radius, ALL\|CONVEX\|RIM\|VERTICAL\|"<face selector>")` |
| `CHAMFER` | part.chamfer | `CHAMFER(%body, distance, ALL\|CONVEX\|RIM\|VERTICAL\|"<face selector>")` |
| `BLEND` | part.variable_fillet | `BLEND(%body, radius_start, radius_end)`<br>`BLEND(%body, radius_start, radius_end, ALL, SMOOTH)` |
| `SHELL` | part.shell | `SHELL(%body, thickness)`<br>`SHELL(%body, thickness, open_axx, open_axy, open_axz)` |
| `PATTERN` | part.pattern_linear / _circular / _grid | `PATTERN(%body, LINEAR, count, dx[, dy, dz])`<br>`PATTERN(%body, POLAR, count, total_angle)`<br>`PATTERN(%body, GRID, nx, ny, dx, dy)` |
| `MIRROR` | part.mirror | `MIRROR(%body, XY\|XZ\|YZ)` |
| `FUSE` / `CUT` / `COMMON` | part.boolean_union / _subtract / _intersect | `FUSE(%body, %tool)` etc. |

Details that a wrong signature would teach wrongly, all derived from the kernel
header rather than assumed:

* **`HOLE`'s second argument is a DIAMETER** (`HOLE(%body, dia, cx, cy, cz ...)`),
  and so is `CBORE`'s second and third (`dia`, `cboreDia`). `FILLET`/`BLEND` take
  a **radius**; `CHAMFER` takes a **distance**. The JSON carries
  `"semantic": "diameter"` vs `"radius"` per argument, with the rule that
  classified it.
* **Lengths are mm, angles are degrees** (`feature_tree_ir.md`: "Angles are
  degrees"; its worked example reports mm³ and mm).
* **Numbers print as `%.10g`** — `12.0` is emitted as `12`, never `12.000000`.
* `MIRROR`'s user form takes a **bare plane keyword**, never the kernel's
  6-number point+normal form.
* `PATTERN`'s counts are **total instances including the original**, must be
  whole numbers ≥ 2, and `POLAR`'s angle is a **total** sweep (step = angle/n).
* Optional argument groups are **all-or-nothing**: supplying `depth` to
  `part.hole` also emits the axis triple `0, 0, 1` before it, which is why the
  9-argument form exists and an 6-argument one does not.

## How a training run consumes it

**1 — filter the corpus (before training).** Every target program is scored
against the vocabulary; a program containing an op outside `allowed_ops`, an
argument count outside that op's `emitted_forms`, or a parameter that breaks a
command's `constraints` is a program no user could have produced. Either drop it
or record it as a coverage gap:

```
python3 implementation/sacrosanct/tools/measure_vocabulary_coverage.py <corpus files>
python3 implementation/sacrosanct/tools/measure_vocabulary_coverage.py --jsonl train.jsonl
```

**2 — state the contract in the prompt.** `emission_policy.rules` is written to
be pasted into the system turn verbatim, with `emission_policy.allowed_ops` as
the closed op list and each op's `emitted_forms[].arguments` as the argument
order. Use `emitted_forms[].examples[].ir_text` as the few-shot examples: every
one of them is a statement the live registry has actually recorded (the gate
dispatches all 54 on every CI run), not a hand-written illustration.

**3 — constrain decoding.** The op-name set is closed and small, so a grammar- or
mask-constrained decoder can be built directly from the file: at a statement
head, only the 28 names are legal; after the name, the argument count is bounded
by `arity.min_args`/`max_args` and further by the emitted forms; keyword slots
have enumerated domains (`ALL|VERTICAL|RIM|CONVEX`, `XY|YZ|XZ`,
`LINEAR|POLAR|GRID`, `RULED`, `OPEN`, `SMOOTH`).

**4 — verify the emission (reward / repair).** Before compiling, check the
emitted program against the same three rules the app enforces: op in vocabulary,
argument count in a listed form, every `%N` strictly earlier than the statement
it appears in. `forge::ui::validateIr` is the same check in C++, and the gate
asserts that every recorded example passes it.

## What the constraint costs, measured

On the repo's own IR corpus (the four kernel smoke suites, the only
feature-tree-IR corpus in the tree at this revision):

```
$ python3 implementation/sacrosanct/tools/measure_vocabulary_coverage.py \
      forge-kernel/test/ft/ft_smoke.mjs forge-kernel/test/ft/ft_organic_smoke.mjs \
      forge-kernel/test/ft/ft_bore_count.mjs forge-kernel/test/ft/ft_unified_edit.mjs
corpus:      4 file(s), 53 program(s), 183 statement(s)
vocabulary:  implementation/sacrosanct/archie_op_vocabulary.json (28 user-invocable ops)
statements inside the vocabulary: 137/183 = 74.9%
programs fully inside it:         29/53 = 54.7%
```

The ops that still put a program outside are `INPUT` (12), `DEFEATURE` (10),
`RESIZEBORE` (6), `TAG` (5), `WIRE` (4), `VERIFY` (4), `SWEEP` (2) and
`PUSHFACE` (2) — direct-edit and authoring ops, not shapes. (Programs are split
on blank lines, so "53 programs" is a heuristic count; the statement figure is
exact.)

The series is the whole argument, each row MEASURED with the command above at
the revision named:

| when | statements inside | programs fully inside |
|---|---|---|
| before any creator existed | 45.4% | 0.0% |
| after `RECT`, `CIRCLE`, `RING`, `TRANSLATE` and the corrected `LOFT` | 48.6% | 3.8% (2/53) |
| after the ten kernel primitives (this change) | **74.9%** | **54.7%** (29/53) |

The middle row is the one worth reading twice. Five creators moved the STATEMENT
figure by 3.2 points and the PROGRAM figure from zero to two: a program is inside
the vocabulary only if EVERY statement is, so the shape ops the app was missing
were poisoning whole programs, not a few lines. `BOX` (30 statements) and `CYL`
(17) were the two most-used ops in the corpus and neither had a command — the app
even seeded a `BOX` into every new document while giving the user no way to
author one.

**Read that the right way.** It never said the constraint was wrong. It said the
app was missing commands, and the fix was to add them rather than to widen what
Archie may emit. Ten of them are now added and this file picked them up on the
next `--write`; the remaining gap is the direct-edit family (`TAG`, `DEFEATURE`,
`PUSHFACE`, `RESIZEBORE`), `INPUT`, `VERIFY`, and the three ops that need a
points token forge::ui does not model (`POLY`, `WIRE`, `SWEEP`).

## What the derivation found, and what it means for training

These are recorded in the JSON under `derived_defects` and `value_kind_closure`,
each with the evidence that produced it. The runtime gate drives the ones that
can be driven. Two of the original four are now CLOSED; the entries are kept
because a reader who saw the old ones needs to know they moved, and why.

1. **CLOSED (D-021, D-023) — the vocabulary was not closed, and now is.**
   `EXTRUDE`/`REVOLVE` consume a `PROFILE` and `LOFT` consumes a `WIRE`, and no
   user-invocable op produced either: from an empty document, no legal program
   existed. `part.sketch_rect` and `part.sketch_circle` closed `PROFILE`;
   `part.section_ring` (`RING`) closed `WIRE`. `value_kind_closure.gaps` — which
   the artifact computes about ITSELF — is now `[]`, and
   `produced_by_allowed_ops` is `PROFILE, SOLID, WIRE`. A training target may now
   begin from nothing.
2. **CLOSED (D-023) — `part.loft` emitted a statement the kernel refuses.** The
   command resolved `PROFILE` values while `opLoft` puts every `%ref` through
   `refWire`, which throws "is not a WIRE section (use RING(...) or
   WIRE([...]))". `LOFT` was *invocable* and *not compilable* through the user
   surface. MEASURED through `forge_verify` -> `forge::ft::compileText`:
   `RECT(40,40); CIRCLE(10); LOFT(%1,%2)` fails at op `%3` with that exact
   message, while `RING(20,20,0); RING(10,10,30); LOFT(%1,%2)` builds a solid of
   volume 21928.4. The command now resolves `IrValueKind::Wire`, its signature is
   `atLeast(EntityKind::Wire, 2)`, and `part.section_ring` supplies the sections.
   **UI-shaped `LOFT` is now trainable** — as `LOFT(%wire, %wire, ...)`, never
   over profiles.
3. **One command declares an op it never emits** — `edit.delete`, whose `DELETE`
   is not a kernel op at all. The three `model.*` stubs that used to sit beside it
   (`model.extrude`, `model.fillet`, `model.shell`, which touched only
   `DocumentStats`) are retired and the keymap reaches `part.*`; the gate asserts
   by name that none of them is in this list any more. It dispatches `edit.delete`
   and asserts the Part document gains nothing while dispatch answers `Ok`. A
   `featureIrOp` must not be read as evidence that an op is reachable; only
   `commands[].emits_feature_ir` is.
4. **CLOSED — the shipped app's `PROFILE` seed was invalid.**
   `ForgeFrame::wirePartCommands` seeded `sketch.base` with op `"SKETCH"`, which
   `opFromName` does not accept, so `validateIr` answered `unknown_op`, the seed
   bound no value, and every profile-consuming command in the Part workspace was
   permanently unreachable — silently. It now seeds through `seedDefaultPart()`
   from the same `defaultPartStatements` table `KernelScene::build()` compiles,
   and reports the failure rather than swallowing it. The generator no longer
   emits a seed defect, which is how this entry was found to be stale.
5. **CLOSED — ten kernel ops the app implemented and no user could ask for.**
   `BOX`, `CYL`, `CONE`, `SPHERE`, `TORUS`, `PRISM`, `TUBE`, `RRECT`, `REGPOLY`
   and `ROTATE` were in `opFromName`, in `forge::ui::irOpTable()`, built by
   `Primitives.cpp` — and in `forbidden_ops`, because no command emitted them. The
   app *seeded* a `BOX` into every new document. Each now has a command, each
   emits the kernel's own argument order, and each was MEASURED against closed
   form through `forge_verify` -> `forge::ft::compileText` before the command was
   written — a vector of observables (volume, bbox, face count, genus), never
   volume alone, because the divergence theorem gives a self-intersecting shell the
   right volume. `TORUS` and `TUBE` report **genus 1**, which is the observable
   that says the hole is really there.
6. **OPEN, measured — `SLOT` builds the wrong solid, so it has NO command.**
   `SLOT(len, wid [, cx, cy, angleDeg])` is the fifth kernel profile and the one
   command deliberately not added. Extruded 10 mm and read back through
   `forge_verify`, its area is `|(len - wid)*wid - pi*(wid/2)^2|` at every size and
   its bbox spans `+/-(len - wid)/2` rather than `+/-len/2`:

   | statement | area | an obround is | bbox x |
   |---|---|---|---|
   | `SLOT(40, 12)` | 222.9027 | 449.0973 | −14.000 .. 14.000 |
   | `SLOT(60, 10)` | 421.4602 | 578.5398 | −25.000 .. 25.000 |
   | `SLOT(30, 20)` | 114.1593 | 514.1593 | −5.000 .. 5.000 |
   | `SLOT(100, 4)` | 371.4336 | 396.5664 | −48.000 .. 48.000 |

   Both semicircular end caps bow **inward**: the shape is the straight section
   with a full circle's area removed, not an obround with it added — −50.4% of the
   promised volume on the nominal case, and a part 28 mm long where the statement
   says 40. `profSlot`'s own source is right, so the defect is in how a 180-degree
   arc's direction is resolved downstream; the control is `RRECT`, whose arcs are
   90 degrees and whose area is exact to ten significant figures through the same
   path. Adding the command would have put a broken solid one click away and taught
   Archie a shape `SLOT` is not, so it stays in `forbidden_ops` until the arc is
   fixed and re-measured.

## Keeping it true

* Twenty-three required Part parameters still carry no `hasDefault`, so an
  interactive caller must prompt before those commands can run; the JSON lists
  them under `required_parameters_without_hasDefault`. Every one of the ten
  commands added for the kernel primitives declares `hasDefault` on all of its
  required parameters, so none of them joined that list and a keyboard gesture can
  invoke each of them; the older commands that predate the flag are the whole of
  what remains. `part.extrude.distance` (10), `part.fillet.radius` (1) and
  `part.shell.thickness` (2), the three the keymap binds, were fixed the same way
  earlier, using the exact defaults the retired `model.*` stubs declared.
* `--check` compares the committed JSON byte-for-byte against what the sources
  imply and prints a unified diff on drift. It records **content hashes of the
  eight source files**, not a git sha, so unrelated commits stay quiet and a real
  change fails loudly.
* `ui/test/archie_op_vocabulary_test.cpp` runs inside `bash ui/test/run_ui.sh`,
  which is already the `ui` job in `.github/workflows/kernel-tests.yml`. It is
  the half a text diff cannot cover: the file agreeing with the *running* code.
* When a Forge command is added, renamed, or has a parameter changed, the gate
  goes red and the fix is one command: `--write`, then re-read the diff. If the
  parser meets a construct it does not understand it **refuses to emit a file**
  rather than emitting an incomplete one.
* The parser also carries the incoming source shape: an `OpCode` enumerator whose
  signature sits in the comment block **above** it (the `ARC`/`HELIX` family) is
  read as well as the same-line style, and an op gated behind a build option that
  defaults to OFF is not expected to appear in `forge::ui`'s table. Run against
  the shared checkout's in-flight sources it reaches the real obstacle and names
  it: `kernel op ALIGN is absent from forge::ui::irOpTable()` -- the same drift
  that makes `feature_ir` red there. It refuses to emit a vocabulary while the
  two tables disagree, because there is no consistent one to publish.
* The generator's only judgement is two tables — `UNIT_RULES` (argument name →
  unit/semantic) and `OP_ARG_OVERRIDES` (the name collisions the rules cannot
  settle, e.g. `MIRROR`'s `nx,ny,nz` are a plane normal while `PATTERN GRID`'s
  `nx,ny` are counts). Every override is validated against the parsed signature,
  and anything neither table classifies lands in the JSON's `uncertain` list
  rather than being guessed. One entry sits there today: `PATTERN`'s `axz`, whose
  default the kernel header writes as the compound axis `+Z` rather than as a
  per-argument number.
