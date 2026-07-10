# K2 — the exact mesh boolean had no work budget, and it killed CI for four days

## Symptom

`Kernel + Guards` was red or dying from 2026-07-08 to 2026-07-10. The `native` job:

    2026-07-08 .. 07-09   failed at 18s   MISSING <cstdint>: src/native/capi/forge_capi.cpp
    2026-07-10 (fixed)    ran 45m16s      cancelled by timeout-minutes: 45
    2026-07-10 (raised)   ran 2h00m15s    "The job has exceeded the maximum execution time of 2h"
                                          Terminate orphan process: forge_native_brep_native_boolean_test

Three defects stacked. The include bug killed the job in 18 seconds and **hid** the hang behind it
for three days. Fixing the include exposed a job-length hang. Raising the cap exposed that the hang
is unbounded, not merely slow.

## Root cause

`forge::native::mesh::exactArrangementBoolean` (src/native/mesh/MeshBooleanExact.cpp) runs

    an O(|A| . |B|) face-pair arrangement, every predicate and construction in arbitrary-precision
    ExactReal arithmetic, followed by an O(n^2) constrained retriangulation per face

with **no iteration cap, no deadline, and no work estimate**. On `booleanSolid(box, sphere, Common)`
— a tessellated sphere poking through a planar box face, `testCurvedCrossingCeiling` in
`native_boolean_test.cpp` — it does not finish. Measured in isolation:

    42% CPU, 4.5 MB RSS, no result after 600s, killed by watchdog

Low RSS and steady CPU: not a memory blow-up, not an infinite loop. An unbounded one.

Bisected exactly:

    b7815380^  (3836b1af)   native_boolean_test PASS in 61s
    b7815380                native_boolean_test HANG

`b7815380` (2026-07-06) is *"brep/Boolean: escalate mesh-operand boolean to exact engine (GAP 3, K2)"*
— it swapped `meshBooleanNative` for `meshBooleanExact`, whose second stage is the exact arrangement.
It landed three days after CI's last green (2026-07-03).

## Fix

The file's own contract, stated in its header, is **"detect, never fake"**: `ok = true` only on a
validated closed 2-manifold; `ok = false` otherwise, with a reason. An honest `ok = false` was
therefore always a legal result. It simply had to be reachable in bounded time.

`exactArrangementBoolean` now takes a wall-clock budget, checked every 16 iterations of the imprint
loop and of both retriangulation loops:

    FORGE_EXACT_BOOL_BUDGET_MS   default 5000; <= 0 disables the bound
    reason on exceed             "exact arrangement over budget (imprint | retriangulate A | retriangulate B)"

The caller (`meshBooleanExact`) already handles `ok = false` from the exact stage by returning the
more informative failure. `assertHonest` in the gate accepts "valid solid OR honest ok=false", so the
previously-hanging case now reports:

    [sphere-union-sphere FUSE] honestly deferred: result not a closed 2-manifold
    [native:brep/native_boolean_test] PASS — RESULT: 141 / 141 checks passed

This does not make the boolean weaker. It makes an existing failure mode *reachable* instead of
infinite. The real work — a broad-phase over the arrangement so the exact path is O(k) in the number
of genuinely intersecting pairs rather than O(|A|.|B|) — remains open, and is the right way to raise
the budget's ceiling later.

## The harness bug this exposed

`test/native/run_native.sh` had **no per-test timeout**. A hung test held its slot in the job-cap
forever, so a single non-terminating gate consumed the entire CI job. `timeout(1)` is coreutils and
absent on macOS, so the script now forks a killer, reaps whichever finishes first, and returns 124:

    [native:<name>] TEST TIMEOUT — exceeded ${TEST_TIMEOUT}s, killed.

Default `TEST_TIMEOUT=300`. A hang is now a loud red failure in seconds, not a two-hour silence.

`ONLY=<substring>` was added to isolate one gate while debugging. It refuses to claim a full pass:

    [native] FILTERED RUN (ONLY=brep/native_boolean_test): 1 of 138 gates ran and passed — NOT a full gate

## Verify

    # the hang, reproduced and bounded
    ONLY=brep/native_boolean_test TEST_TIMEOUT=300 bash forge-kernel/test/native/run_native.sh

    # the hang, unbounded (will be killed at 300s by the watchdog)
    FORGE_EXACT_BOOL_BUDGET_MS=0 ONLY=brep/native_boolean_test bash forge-kernel/test/native/run_native.sh

    # the full gate
    bash forge-kernel/test/native/run_native.sh
