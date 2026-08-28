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
| `forge-kernel/src/Features.cpp` | in-flight | KRN call-site changes | same call sites |

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
