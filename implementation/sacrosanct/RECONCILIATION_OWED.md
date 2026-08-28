# Reconciliation owed — in-flight work vs merged track work

**Opened 2026-08-28.** This is a debt register, not a status report. Every row is a file where two
independent large changes exist and only one of them is in the working tree.

## The situation

The main checkout carries **37 modified + 48 untracked** files of uncommitted kernel work that
predates this session (`FeatureTreeCompiler.cpp` alone is **+1451 lines**). Wave-2 tracks modified
five of those same files on branches that forked from the **committed** state.

Both sides are preserved and neither is lost:

- **Track work is COMMITTED** on the integration branch (`497b2056` APPB, `0c099ef6` KRN).
- **In-flight work is PRESERVED** byte-for-byte in the working tree.

But they are not combined. `git apply` of the track hunks onto the in-flight versions fails — the
regions overlap. Auto-resolving would mean guessing, and guessing wrong here silently corrupts
either 1451 lines of someone's kernel work or a parser fix that closes release-blocking §0 gaps.

## What this means concretely

> **Building from the working tree today gives you the OLD parser.** The `HEAD` commit has APPB's
> fail-closed parser; the working-tree `FeatureTreeCompiler.cpp` does not. A build from a clean
> checkout of `HEAD` behaves differently from a build of the working tree. That divergence is real
> and is the entire content of this file.

## The debt

| File | In-flight | Track | Conflict |
| --- | --- | --- | --- |
| `forge-kernel/src/ft/FeatureTreeCompiler.cpp` | +1451 lines (pre-session) | APPB fail-closed parser, §0.4 reconciliation, §0.11 chunk chain | overlapping regions in `parse()` |
| `forge-kernel/CMakeLists.txt` | +578 lines | KRN target additions | adjacent target blocks |
| `forge-kernel/src/native/brep/NativeThickSolid.cpp` | in-flight | KRN native whole-solid offset | same functions |
| `forge-kernel/include/forge/native/brep/NativeThickSolid.hpp` | in-flight | KRN declarations | same header region |
| `forge-kernel/src/Features.cpp` | in-flight | **SHELL sign contract** + KRN call sites | same functions |
| `forge-kernel/src/LoftGuide.cpp` | in-flight | TKOFF ThruSections/MakePipeShell | same functions |

Reconciled cleanly and needing nothing: `forge-kernel/include/forge/ft/FeatureTree.hpp`.

## How to settle it

The in-flight author's intent is not recoverable from the diff alone, so this is **not** a task to
hand to an agent that will pick a side. Order of operations:

1. The in-flight work should be **committed on its own branch first** — it is the older, larger, and
   less understood change, and it currently exists in exactly one place on one machine. Until it is
   committed it is one `git checkout --` away from gone.
2. Then reconcile with a real three-way merge, where git can see both parents.
3. Then re-run `forge-kernel/test/ft/build_s0_acceptance.sh` and confirm it still reports
   **42 pass / 5 fail** rather than regressing to 6/14.

## Why it was not forced

Sacrosanct forbids destroying work to make a merge succeed, and the operating rules forbid
`git checkout --` on unstaged work precisely because it reverts the whole edit rather than the part
you meant. A backup of all 37 files is held at
`scratchpad/inflight-backup/`, and the six colliding originals at `scratchpad/park_w2/`.

---

## Update 2026-08-28, after waves 2 and 3

Now **seven** files carry debt, not five. The additions are `Features.cpp` (which gained the SHELL
sign-contract fix on top of the KRN changes) and `LoftGuide.cpp`.

**The highest-value item is now `Features.cpp`.** HEAD carries the fix that makes `part.shell`
hollow *inward* on both routes; the working tree does not. Until reconciled, a build from the
working tree still produces the outward body — 564.926 instead of 424 on the smoke's own box, a 33%
error that moves the part's outer dimensions, which every drawing, DFM and mass consumer reads.

**A separate defect was found and deliberately NOT fixed**, because fixing it would have landed as a
conflict in exactly these files: `ft/FeatureTreeCompiler.cpp:1238` `opShell` selects a face through
a **1-based** `TopTools_IndexedMapOfShape` and passes it to `part::shell`, which resolves through a
**0-based** `TopExp_Explorer`. Measured on a cube: `inferFeature(k)` equals `part.shell([k-1])` for
every k, and `part.shell([6])` throws *"face id 6 out of range"*. With the default open axis it
selects the z=0 face and shell then opens the y=0 face. **Invisible on a cube because every face
gives V=424** — which is precisely why the feature-tree smokes pass. Fix it during reconciliation.

The recommendation is unchanged and now more urgent: **commit the in-flight kernel work to its own
branch.** Seven files of hand-applied patches is the point at which hand-applying stops being safe.

---

## Update after wave 4 — now 8 files

`forge-kernel/src/Healing.cpp` joins the register. The highest-value entries are unchanged:
`Features.cpp` (HEAD hollows inward on both routes; the working tree still produces the outward
body) and `FeatureTreeCompiler.cpp`.

**A second measurable consequence has appeared.** The METRIC track fixed the silent-box fallback in
the *committed* parser: an unknown op in TAIL POSITION used to build green and silently drop the
preceding ops — `%1 = BOX(20,20,20,0,0,0)` followed by `%2 = FOOBAR(7,8,9)` returned ok with
volume 504 = 7·8·9, i.e. FOOBAR became a box. That is fixed at HEAD.

**The working-tree `FeatureTreeCompiler.cpp` still contains the tail-dropping `fail()` and the
`OpCode::Box` default.** So the divergence now costs, measurably:

| | HEAD | working tree |
| --- | --- | --- |
| s0 conformance | 54 pass / 5 fail | 33 pass / 14 fail |
| unknown op in tail position | rejected | **silently becomes a BOX** |

Committing the in-flight work to its own branch is no longer just hygiene — the working tree is now
the version that scores an unknown operator as a valid solid.

---

## Cross-track conflicts, 2026-08-28 — three branches deferred

These are conflicts BETWEEN TRACKS, not with the in-flight work. All commits are safe on their
branches; none is lost. They need real resolution rather than an auto-merge.

| Branch | Conflicting paths | Nature |
| --- | --- | --- |
| `worktree-wf_46ab8b53-ead-1` | `Features.cpp`, `native_vs_occt_features_gap1.mjs` | content — two tracks edited the same kernel function |
| `worktree-wf_5dcbcd5f-963-8` | `StorageGovernor.{hpp,cpp}`, `storage_govern_main.cpp`, `storage_plan.sh`, `storage_governor_test.cpp`, plan artifacts | **add/add — two waves independently BUILT THE SAME SUBSYSTEM** |
| `worktree-wf_e04fbd3d-e24-2` | `IoExchange.cpp`, `StepRead.cpp` | content — STEP import path |

The storage one is a process finding, not just a merge chore: two separate waves were each briefed
to "find it; if it is not on your branch, re-create it", and both re-created it. That instruction is
correct in isolation and duplicative in aggregate. A future brief must name the branch to build ON
when prior work exists, rather than leaving re-creation to the agent's judgement.

Resolution rule: keep the version with the stronger test evidence, and re-run BOTH tracks' gates
against the merged result. Neither may be discarded on recency.

---

## The debt is now visible as a CAPABILITY GAP, 2026-08-28

`ui/test/feature_ir_test.cpp` compares the UI's op table against the kernel's, parsed as data. In a
clean checkout of HEAD it passes. In the working tree it fails:

```
FAIL  kernel.size() == 40                    got 43, want 40
FAIL  irOpTable().size() == kernel.size()    got 40, want 43
```

**The in-flight `FeatureTreeCompiler.cpp` defines three operations the UI has never been told
about.** A user cannot invoke them, and — more importantly — a model trained on the kernel's
vocabulary could emit them while the application has no command that produces them.

That is precisely the failure that produced the v4a collapse: a model emitting ops the executing
side does not accept. The gate that would have caught that now exists and is red, for a real reason.

Third measured cost of the divergence, alongside s0 conformance (54/5 at HEAD vs 33/14 here) and
the unknown-operator-scores-as-a-box behaviour.
