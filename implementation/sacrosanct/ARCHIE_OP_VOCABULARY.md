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
list claimed `"Part"` for no workspace at all — so the 21 commands
`registerPartCommands` files under `"Part"` rendered on **no ribbon in any of the
eight workspaces**, including every command that builds geometry. The other four
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
| `ui/test/archie_op_vocabulary_test.cpp` | the runtime gate: builds the same registry the app builds, diffs every command contract against the JSON, and **dispatches all 32 recorded examples**, comparing the statement the document actually recorded token by token |

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

Measured at this revision: the registry holds **34 commands**; **19 of them emit
feature-IR**, reaching **17 distinct op names**. The kernel defines **40** ops
(`opFromName`), so **23 ops plus the `RESULT` terminal are unreachable by any
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
| `EXTRUDE` | part.extrude | `EXTRUDE(%profile, distance)`<br>`EXTRUDE(%profile, distance, dirx, diry, dirz)` |
| `REVOLVE` | part.revolve | `REVOLVE(%profile, angle)`<br>`REVOLVE(%profile, angle, 0, 0, 0, axx, axy, axz)` |
| `LOFT` | part.loft | `LOFT(%profile...)`, `+ RULED`, `+ OPEN` |
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
dispatches all 32 on every CI run), not a hand-written illustration.

**3 — constrain decoding.** The op-name set is closed and small, so a grammar- or
mask-constrained decoder can be built directly from the file: at a statement
head, only the 17 names are legal; after the name, the argument count is bounded
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
statements inside the vocabulary: 83/183 = 45.4%
programs fully inside it:         0/53 = 0.0%
```

The ops that put them outside are `BOX` (30), `CYL` (17), `INPUT` (12),
`DEFEATURE` (10), `RESIZEBORE` (6), `TAG` (5), `WIRE` (4), `VERIFY` (4),
`RING` (3), `SWEEP` (2), `PUSHFACE` (2), `RECT`/`RRECT`/`CIRCLE`/`TRANSLATE`/
`FOLD` (1 each). (Programs are split on blank lines, so "53 programs" is a
heuristic count; the statement figure is exact.)

**Read that the right way.** It does not say the constraint is wrong. It says the
app is missing commands: more than half of what the kernel's own reference parts
do — primitives, sketch profiles, direct edits — has no button. Widening Archie's
vocabulary would paper over that; adding the commands fixes it, and this file
then picks them up automatically on the next `--write`.

## Four things the derivation found, and what they mean for training

These are recorded in the JSON under `derived_defects` and `value_kind_closure`,
each with the evidence that produced it. The runtime gate drives the ones that
can be driven.

1. **The vocabulary is not closed.** `EXTRUDE`/`REVOLVE` consume a `PROFILE` and
   `LOFT` consumes a `WIRE`, and **no user-invocable op produces either** — their
   producers (`RECT`, `CIRCLE`, `RING`, `WIRE`, …) are all forbidden. So a
   training target may only *begin* with those ops if the document already holds a
   seeded sketch. Sequences must otherwise start from a `%ref` the task provides.
2. **`part.loft` emits a statement the kernel refuses.** The command resolves
   `PROFILE` values, and `opLoft` calls `refWire`, which throws "is not a WIRE
   section (use RING(...) or WIRE([...]))". `LOFT` is therefore *invocable* and
   *not compilable* through the user surface. Do not train on UI-shaped `LOFT`
   until the command feeds it wire sections.
3. **Four commands declare an op they never emit** — `model.extrude`,
   `model.fillet`, `model.shell` (ForgeShell stubs that touch only
   `DocumentStats`) and `edit.delete` (whose `DELETE` is not a kernel op at all).
   The gate dispatches the three `model.*` ones and asserts the Part document
   gains nothing while dispatch answers `Ok`. Their `featureIrOp` must not be read
   as evidence that an op is reachable; only `commands[].emits_feature_ir` is.
4. **The shipped app's `PROFILE` seed is invalid.** `ForgeFrame::wirePartCommands`
   seeds `sketch.base` with op `"SKETCH"`, which `opFromName` does not accept, so
   `validateIr` answers `unknown_op`, the seed binds no value and — today —
   `EXTRUDE`, `REVOLVE` and `LOFT` are unreachable *in the running app* even
   though their commands are registered.

## Keeping it true

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
