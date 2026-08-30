# The emission-time verifier is not recorded anywhere, and my eval script lied about it

**2026-08-29.** Two defects found while chaining the v6r8 evaluation, one of them mine.

## 1. My own script announced success after a failure

`scripts/eval_v6r8_e600.sh` ended with:

    .venv/bin/python scripts/archie_loop.py ... >> "$LOG" 2>&1
    echo "V6R8_EMIT_DONE rc=$? $(date)" >> "$LOG"
    echo "V6R8_EVAL_READY_TO_SCORE" >> "$LOG"

`READY_TO_SCORE` was written **unconditionally**. The emission died `rc=1` in **zero
seconds** and the log duly reported the run ready to score. A 600-row emission takes
about three hours; the only reason this was caught is that the timestamps were
identical.

Fixed: the marker is now written only when `rc=0` AND `emissions.jsonl` has rows, and a
failure writes `V6R8_EVAL_FAILED rc=... rows=...` and exits non-zero. This is the same
failure mode the programme keeps meeting -- an artifact that misreports what it did --
and it is worth recording that I wrote a fresh instance of it while documenting the
others.

## 2. Why it failed: the default verifier path does not exist

    forge_verify not built at archdisc-Mech/forge-kernel/build/forge_verify

`archie_loop.py:59-62` resolves the verifier from `$FORGE_VERIFY`, falling back to
`forge-kernel/build/forge_verify`. **That build directory is the cmake-js NODE ADDON
build** -- it holds `build/Release/forge-kernel.node` (8.9 MB, Aug 28 00:56) and has no
`forge_verify` target at all (`make: No rule to make target 'forge_verify'`). Building
it there would mean reconfiguring the directory that produces a shipped artifact, so
the fix is the env override, not a reconfigure.

## 3. The part that matters for the SCORE: v5cap's emission verifier is unrecoverable

The v5cap e600 emission ran Aug 28 20:46-23:30 and succeeded, so it had a working
verifier. **Which one is not recorded anywhere:**

* `emissions.jsonl` rows carry only `id, ir, round, ops, loop_gate_passed`.
* the three trace files name no verifier.
* the default path has held no `forge_verify` since at least Aug 28 00:56.

So v5cap must have run with some `FORGE_VERIFY` that is not written down. The v6r8 run
pins the emission-time verifier to the frozen binary the SCORER uses
(sha256 `45e9ad9a9b88...`) and logs it -- reproducible, and stated.

**The honest caveat that has to travel with the v6r8-vs-v5cap number: if v5cap's
emission loop used a different verifier, that is an uncontrolled difference between the
arms, in the planner<->verifier loop that shapes what the model emits.** It is not
detectable after the fact from the artefacts. It is recorded here rather than
discovered later.

**Fix owed:** `archie_loop.py` should stamp the verifier path AND its sha256 into every
emission row, the way `composite_score.py` already stamps its own into every scored
record. The scorer's provenance discipline exists precisely because "a composite is only
comparable within ONE binary"; the emitter has the same property and none of the
discipline.
