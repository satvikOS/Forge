# ArchDisc Forge — root invariants

This file is an **instruction cache**, not a dumping ground: only things worth loading
on almost every turn. Conditional material lives in subsystem docs, `tools/*/README.md`,
or skills. The failure mode this guards against is instruction inflation — every
correction becoming another sentence until the file is contradictory, stale and diluted.

## What this repository is

**Archie reasons. Forge executes. Nothing free-form mutates engineering state.**

```
intent → Archie reasoning → engineering inventory → typed IR
       → Forge native C++ execution → CAD/CAE/CAM → validation → repair → verified artifact
```

Layer order, and the order work must be built in:
`L0 Guardian → L1 shell → L2 document graph → L3 Archie → L4 typed IR → L5 kernel
→ L6 assembly → L7 CAE → L8 CAM/DFM → L9 viz → L10 interop → L11 evaluation`

## Hard invariants

1. **C++20/23 native product core.** No Electron, no browser app architecture, no
   JavaScript/TypeScript in the Forge runtime. `frontend/`, `electron/`, `ui/` are
   legacy and are not the product.
2. **Geometry truth is B-Rep/parametric, never a rendered mesh.** A mesh import is
   reference geometry until reconstructed, and reconstruction has a *measured* error.
3. **Every mutation is a transaction**: prepare → resolve references → dry run →
   execute → validate geometry → validate semantics → commit or roll back. No partial
   mutation is ever visible to the user.
4. **Semantic references, not `face_128`.** Feature provenance + role + geometric
   signature + adjacency. If identity cannot be resolved confidently, pause and replan —
   never silently bind a destructive edit to a guessed face.
5. **The AI never drives CAD by screen coordinates.** It calls typed operations that
   return structured success/failure and immutable evidence IDs.
6. **Resource safety is correctness.** A result that collapses the workstation, GPU
   stack or build environment is a failed result.
7. **No benchmark claim without stored evidence.** No "done" unless acceptance tests pass.
8. **Never mutate generated/vendor data as source.** Never edit a script that is
   currently executing.

## Before you build

```sh
forge-guardian-ctl status          # must be RUNNING and publishing
forge-gate --need green || exit 75
cmake --build build -j "$(forge-nproc)"     # never a hardcoded -j
```

`forge-nproc` is the only sanctioned source of build parallelism. Wrap long jobs in
`forge-job --name X --peak-gb N --restartable -- …` so Guardian can shed them.
See `tools/guardian/README.md`.

## Concurrency

One mutating agent, one worktree, one branch, one declared write set.

```sh
git worktree add -b work/<task> .claude/worktrees/<task> HEAD
```

Never `git checkout` in the shared checkout — it moves HEAD out from under every other
agent and every read-only auditor. Never reuse an existing worktree path. Never bare
`git stash`; the stack is shared. These four are enforced by
`.claude/hooks/forge-bash-guard.py`, not by this paragraph — if you find yourself
arguing with the hook, the hook is probably right.

Write-set exclusion and the evidence gate are enforced by `forge-program`
(`orchestration/program/`). Two agents cannot hold overlapping paths, and `done`
refuses evidence that states no measurement.

## Verification — the part that actually matters

Compiling is not evidence. "The agent said success" is not evidence. A screenshot is not
evidence. A file existing is not evidence.

Layer verification: buildability → local behaviour → integration → domain-visible output
→ regressions and invariants → **does the evidence actually correspond to the
requirement that was asked for**. The last layer is the one this program has failed
before: a metric named `compiled` was really `status == "ok"`, which meant *built AND
all assertions passed*, so a build rate cited as independent was controlled by the
endpoint beside it.

Three rules with scars behind them:

- **A vector of observables, never one.** Volume alone has passed a wrong shape four
  times here. In one case no single observable caught it — COM was clean on the sphere,
  bbox clean on the cylinder.
- **Prove the arms differ.** A null A/B usually means the harness is broken. "Zero
  differences across three variants" was once one binary compared against itself.
- **A level is not a trend.** A large steady number is not an emergency; a moving one is.

After implementing, name the three most likely ways the work is wrong, test those
hypotheses, and report the evidence. Adversarial completion is a phase, not a sentiment.

## Deletion

`DISCOVER → CLASSIFY → VERIFY RECOVERABILITY → VERIFY NOT ACTIVE → DRY RUN → DELETE → AUDIT`

Never delete because something "looks unused". A clean, unlocked, witnessed worktree can
still be load-bearing — check `lsof`, not `git`. "Git tracked" is not "backed up":
confirm the commit is on the correct remote first, and for weights or datasets too large
for GitHub require a second verified durable copy before removing the only one.

## Escalate only for

Unavailable required information, destructive ambiguity, credentials, licensing
ambiguity, user-owned irreversible data, unsafe hardware state. Everything else is an
ordinary technical decision: make it, record why, continue.
