# planegcs: options memo

T-156. **This memo costs options. It does not choose one, and it is not legal
advice.** The choice is a distribution-model decision for the owner.

## The fact this is about

`forge-kernel/3rdParty/planegcs` is FreeCAD source under `LGPL-2.1-or-later` —
13 of 13 files, one value, no BSD alternative (census and header quote in
`forge-kernel/3rdParty/planegcs/UPSTREAM.md`). Five of its `.cpp` files are
compiled into `add_library(forge_kernel SHARED ...)` **and**
`add_library(forge_kernel_core SHARED ...)`, and
`libforge_kernel_core.dylib` ships in `Forge.app/Contents/Frameworks`.

LGPL-2.1 **§6** is the clause that governs distributing a work that *contains*
the Library rather than linking dynamically against it. §6 is satisfiable — it
lists ways, of which §6(a) (object files permitting relink) and §6(b) (a
shared-library mechanism) are the two that fit here — but a way has to be
**chosen and met**, with the customary notices and a copy of the licence.

Two things are already true and should not be re-litigated: the licence text
ships (`third_party/licenses/LGPL-2.1.txt`, staged by `package_macos.sh`, checked
by `verify_bundle_licences.sh`), and `third_party/licenses/README.md` already
states the §6 problem in its own words. The notices half is done. The relink
half is the open item.

**Vendoring the source in this repository does not discharge it.** The obligation
is triggered by distributing the *binary*, and it runs to whoever receives that
binary — not to whoever can clone the repo.

---

## Option (a) — relink kit: object files plus a documented relink procedure

Ship, with each release, what a recipient needs to substitute their own modified
planegcs and rebuild the library that contains it.

**Engineering cost — small in the tree, recurring in the pipeline.** No source
moves and no build restructuring. What is new is a release artifact: the
compiled objects for the rest of `libforge_kernel_core`, the exact link line,
and a script that performs the relink, produced per release and per architecture
and published where recipients can get them.

**Release risk — the recurring kind, and one business question.** A relink kit
that silently stops relinking is worse than no kit, so it needs a gate that
actually performs a relink against a *modified* planegcs and links the result;
a gate that only checks the files exist would be the quiet instrument this
program has been bitten by before. Separately, this option publishes Forge's own
kernel object code to every recipient. That is not an engineering cost and this
memo does not weigh it.

**Effect on the C++-native goal — neutral.** Nothing moves; the OCCT-zero and
native-kernel programmes are untouched.

---

## Option (b) — separate shared library, mirroring `libforge_expr`

planegcs becomes its own dynamically-linked `.dylib` in `Contents/Frameworks`,
replaceable by the recipient, exactly as `libforge_expr` already is.

**Engineering cost — a known-size job this tree has already done once, at larger
scale, with one genuine complication.**

The precedent is not an analogy; it is the same upstream project at the same
commit. `third_party/freecad-derived/expressions` is FreeCAD
`0a45a0a008d4af7a85601016c5ab31bd26c25b22`, 19 source files, 17,715 lines,
adapted 2026-09-15. planegcs is FreeCAD **`0a45a0a008d4af7a85601016c5ab31bd26c25b22`**
— the identical commit — 13 files, 13,400 lines. Smaller than the job already done.

The scaffolding is mechanical and its shape is fixed by a gate that already
exists: `COPYING.LGPL` (sha256-pinned to the shipped LGPL text), `MODIFICATIONS.md`
(dated; planegcs's edits are already written down in `UPSTREAM.md` and transcribe
directly), `NOTICE`, a `manifest.json` entry, a `## planegcs` section in
`THIRD_PARTY_NOTICES.md`, and a `CMakeLists.txt` declaring
`add_library(forge_gcs SHARED ...)`. **No new gate code is needed**:
`tools/gates/freecad_derived_lgpl_gate.sh` loops over every directory under
`third_party/freecad-derived/`, so a new component directory is picked up
automatically, and `verify_bundle_licences.sh` is likewise manifest-driven.
`forge-kernel/3rdParty/planegcs_eigen_shim` (977 lines, first-party) moves with it.

**The complication, stated plainly, because it is the whole cost.** `libforge_expr`
was consumed from the *application* layer — `ui/src/Parameters.cpp`,
`forge-desktop/src/ExpressionHost.cpp`. planegcs is consumed from *inside the
kernel*: `forge-kernel/src/Sketcher.cpp`, `include/forge/Sketcher.hpp`,
`src/ft/SketchInspect.cpp`, `include/forge/ft/SketchInspect.hpp`,
`src/binding_sketchdiag.cpp` and `test/ft/sketch_solve_test.cpp` — six files, all
under `forge-kernel/`. The existing gate's rule L9 refuses to let
`forge_kernel_core` link the LGPL target at all:

> `red "$t links $target -- only the application executable may, so no library every gate links carries the LGPL dependency"`

— with `forge_kernel_core` named in that list. So adopting the precedent is not
"move a directory and add five files". It requires deciding where the
sketch-solver seam sits: either the `Sketcher` facade leaves `forge_kernel_core`
for the application layer, or L9 is widened for this component and the reason is
written down. That decision, not the file moves, is the work.

**Release risk — medium, and instrumented.** It is a build and packaging change
on the library that ships, but in an area with a working template to copy: the
CI job `parameters and expressions (libforge_expr, LGPL, dynamic)`
(`kernel-tests.yml:360`) already asserts at the *binary* level — `otool -L` names
the dylib among the app's load commands, and the app defines zero of the
library's symbols. The same assertion transfers to `forge_gcs` unchanged.
`freecad_derived_lgpl_selftest.sh` proves the gate can go red on 18 seeded
defects, so the guard is known not to be quiet.

**Effect on the C++-native goal — mildly positive, not a shortcut.** It makes the
boundary between Forge-native kernel code and FreeCAD-derived code explicit and
*measurable in the shipped binary*, using the same otool-based instrument the
OCCT-zero programme uses. It does not by itself remove a single FreeCAD line.

---

## Option (c) — replace planegcs with a native solver

**Engineering cost — the largest by a wide margin.** 13,400 lines of mature,
purpose-built numerics: BFGS / Levenberg-Marquardt / DogLeg with subsystem
decomposition, rank-deficient Jacobian handling and diagnostics, refined over a
decade in FreeCAD's Sketcher. This tree has already replaced planegcs's *linear
algebra* from scratch — `forge::native::linalg` behind a 977-line drop-in
`namespace Eigen` shim, with no real Eigen anywhere in the repository. That was
the tractable half. Convergence behaviour on ill-conditioned and over-constrained
sketches is the other half, and it is precisely where a new solver loses to a
long-tested one.

**Release risk — the highest.** Sketch solving is user-visible on every sketch.
A regression here is not a missing licence line; it is wrong geometry. There is
no independent oracle either: the reference implementation would be planegcs
itself, so it has to be kept while it is being replaced.

**Effect on the C++-native goal — the only option that advances it**, since it
removes the dependency outright rather than repackaging it. As the brief says,
planegcs is mature and purpose-built, so this is the expensive option; and it
answers a *distribution-model* question by rewriting numerics, which is a
mismatch between the problem and the remedy.

---

## Option (d) — obtain different terms upstream

**Engineering cost — near zero in this tree.** The cost is entirely external.

**Release risk — unschedulable.** planegcs is FreeCAD's. The vendored files name
Konstantinos Poulios (2011) and Victor Titov / DeepSOIC (2014) directly, with the
wider body of FreeCAD contributors behind them, and FreeCAD operates no copyright
assignment that would let one party relicense on their behalf. Relicensing would
need agreement from every holder whose code is in these 13 files. The calendar is
not in Forge's control and the outcome is not predictable, so this cannot be the
path that unblocks a release date. It could be pursued in parallel with any of
the above; it does not substitute for one.

---

## What the `libforge_expr` precedent implies

**It implies option (b).** The tree already contains a worked, CI-enforced answer
to "we ship FreeCAD LGPL-2.1-or-later code in a commercial product": make it a
separate shared library, load it dynamically, ship its licence text, its dated
modification record and its notice, and prove all of that on the binary in CI.
`libforge_expr` is that answer, built from the *same FreeCAD commit* planegcs came
from. planegcs is the one place in the tree that departs from a pattern this
repository otherwise implements correctly — and it is the larger obligation of
the two, because static linkage is what makes §6 bite.

This memo records that implication. It does not make the choice; §6 permits (a)
as well, and (a) and (b) are not mutually exclusive — a relink kit can bridge to
a shared library, or stand on its own.

### What adopting (b) would take

1. **Decide the seam.** Either move the `Sketcher` facade out of
   `forge_kernel_core` to the application layer, or widen gate rule L9 for this
   component with the reason recorded. Everything else is mechanical; this is not.
2. Move `forge-kernel/3rdParty/planegcs` (13 files) and
   `forge-kernel/3rdParty/planegcs_eigen_shim` to
   `third_party/freecad-derived/planegcs/`.
3. Add its `CMakeLists.txt` with `add_library(forge_gcs SHARED ...)` — never
   `STATIC` or `OBJECT`; remove `PLANEGCS_SRC` from `forge_kernel` and
   `forge_kernel_core`.
4. Add `COPYING.LGPL` (the sha256-pinned LGPL-2.1 text the gate checks against),
   `MODIFICATIONS.md` (dated, naming commit `0a45a0a…`; the edits are already
   written down in `UPSTREAM.md`), and `NOTICE` (follow
   `expressions/NOTICE`, including its statement that the corresponding source is
   made available with the release).
5. Add the `manifest.json` component entry and the `## planegcs` section of
   `THIRD_PARTY_NOTICES.md`. Update the `planegcs` entry in
   `third_party/manifest/deps.lock.json` from `static (compiled into forge_kernel)`
   to dynamic, and the two sentences in `third_party/licenses/README.md` and
   `verify_bundle_licences.sh` that currently describe planegcs as static.
6. Copy the `libforge_expr` CI job's binary-level assertions for `forge_gcs`:
   `@rpath/libforge_gcs.dylib` among the app's load commands, and zero
   `forge::gcs` strong symbols defined by the app.
7. Re-run `freecad_derived_lgpl_gate.sh`; it should report **2** components.
   Confirm `freecad_derived_lgpl_selftest.sh` still goes red on its 18 defects
   with two components present.

**Release-process obligation that no gate can discharge**, and which the existing
`NOTICE` already commits to for `libforge_expr`: the complete corresponding
source of the library, including the modifications, must be made available
alongside each release that contains it. Adopting (b) extends that commitment to
planegcs. Choosing (a) instead creates the equivalent obligation in a different
shape.
