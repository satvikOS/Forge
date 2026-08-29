# The long-run verifier is the one without the leak guard

**Measured 2026-08-28, from an OOM tripwire at swap 6.5 GB.**

Two wrappers in this programme drive the same native `forge_verify` child.

`scripts/interface_metrics.py::CensusVerifier` restarts its child every
`recycle` jobs and respawns it on death, and says why:

>  LAW 7: shapes live in a C++ registry that never evicts, so a long-lived
>  child grows without bound (one probe worker reached 16.5 GB). The restart
>  is the only thing that bounds it.

`scripts/archie_loop.py::Verifier` has **neither**. It spawns one child in
`__init__` and never restarts it.

The wrapper WITHOUT the guard is the one used for the longest jobs. Measured on
the running 600-row emission:

    pid 34576  forge_verify  3.76 GB resident  alive 4h 09m, never recycled

against the five sharded `CensusVerifier` scorers running beside it, every one
of which sat at **0.03-0.05 GB**. The guard works; it is simply absent from the
job that needs it most.

## The second half, which is worse

`Verifier.measure()` catches a dead child and returns
`{"ok": False, "error": "verifier died: ..."}`. There is no respawn. So if that
child dies -- OOM-killed, or killed by an operator trying to reclaim its memory --
the run does not abort. It keeps going, and **every remaining row comes back
unverified and is recorded as a failure**. A 600-row run would produce a complete
artifact in which an arbitrary suffix is silently invalid.

That is why the leaking process was NOT killed to reclaim its 3.76 GB during the
tripwire: the reclaim would have corrupted the remaining ~190 rows of a four-hour
run, and nothing in the output would have said so.

## What was done instead, and what was deliberately NOT done

Load that can be recreated was shed: the five box-floor scoring shards and a
two-row diagnostic retry were stopped, sacrificing about 380 scored rows that
cost nothing but time to redo. The emission was left alone.

**The fix is NOT being applied before the chained v1 run**, even though v1 will
leak the same way over its own seven hours. The v1 and v5cap arms must be measured
by the same instrument for the paired comparison to mean anything, and recycling
resets the kernel registry between rows. Registry state should not affect an
independent per-row job -- but "should not" is exactly the kind of assumption this
programme keeps finding to be false, and the comparison is the point of the run.
Memory hygiene does not outrank comparability.

Apply after both arms are emitted: give `archie_loop.Verifier` the same recycle
and respawn `CensusVerifier` already has, and make a dead verifier ABORT rather
than degrade every subsequent row.
