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

## Third defect, found while the tripwire was being handled: the timeout is ignored

`archie_loop.Verifier.measure()` has this signature:

```python
def measure(self, ir, input_step=None, out_step=None, timeout=180):
    ...
    self.proc.stdin.write(json.dumps(job) + "\n")
    self.proc.stdin.flush()
    line = self.proc.stdout.readline()          # <- blocking, unbounded
```

**`timeout` is never read.** There is no queue, no reader thread, no alarm --
nothing that could enforce it. `CensusVerifier` does the same job with
`self.q.get(timeout=self.timeout)` and a reader thread, which is exactly the
machinery missing here.

So the parameter documents a guarantee the function does not provide, and every
caller passing `timeout=` is relying on something that cannot happen.

**Observed live, on the 600-row emission:** the run stopped emitting at row 415.
The verifier child sat at 100% CPU with 8+ minutes of CPU time accumulated on a
single request and no output. The parent was blocked in `readline()`. A row whose
kernel computation does not return does not fail after 180 s -- it stops the run
for ever.

This compounds the missing respawn in the nastiest way. The three available
responses to a hung verifier are all bad:

  * wait, and the run may never finish;
  * kill the child, and every remaining row is silently recorded as failed;
  * kill the run, and four hours are gone.

**The minimal fix that preserves comparability** is the timeout ALONE -- a reader
thread and a bounded `q.get`, no recycle. A timeout changes nothing for a row that
completes, so rows already emitted stay comparable with rows emitted after it; it
only bounds the rows that would otherwise hang, which currently produce nothing at
all. The recycle is the part that resets kernel registry state between rows and so
is the part that must wait until both arms are emitted.

## It happened, 40 minutes after this was written

The verifier child became a zombie at row 416. The run did not stop:

    [ho1187] round 1: 53 ops compiled=False
             gate: the tree does not compile: verifier produced no output

That is the silent degradation described above, in the log, on the real run. The
only reason the damage was **one row** rather than 185 is that a LOAD-SPIKE alert
prompted a look at the process tree, where `pid 34576 ... Z <defunct>` was
visible. Nothing in the emission's own output distinguished "the model wrote a
tree that does not compile" from "there is no longer a verifier".

Reading it correctly took one more step. Two things had to be told apart:

  * `pid 34576` reported 0.00 GB and 0:00.00 CPU -- which looks like a process
    that never ran, and is actually what `ps` shows for a **zombie**;
  * `pid 21184` was a `forge_verify` at 99% CPU with `ppid=1` -- an ORPHAN from
    the two-row diagnostic retry killed during the tripwire. Its parent was gone
    but the child survived and kept a core busy, which is most of what the
    load-spike alert was reporting.

Killing the orphan and stopping the run took the machine from swap 36.5 GB /
free 37% to **swap 576 MB / free 93%** within seconds, which also settles what
the memory event was: the MLX model, not the five scorers that were shed first.
Shedding them was still right -- it was the only load that could be shed without
destroying data -- but it was not the cause.

**Resolution.** 415 valid rows were kept, ho1187 dropped, and a 185-row remainder
built and verified to cover exactly 600. The run resumed under the patched
verifier (timeout + respawn), with the v1 arm chained behind it in the same
script so the two cannot race for the GPU.

**What generalises:** an artifact that records instrument failure in the same
field as model failure cannot be audited after the fact. `compiled=False` meant
both "the model was wrong" and "there was no instrument", and only the process
table could tell them apart -- for a run that had already finished, nothing
could. Rows now carry `_timeout` and `_verifier_restarted` for exactly this
reason.

## The fix proved itself on the exact row that caused the incident

The resumed run reached the same task, `ho1187`, and this time:

    [verifier] timeout after 180s; respawn #1
    [ho1187] round 1: 53 ops compiled=False
             gate: the tree does not compile: verifier timeout after 180s

So `ho1187` is **reproducibly pathological**, not a random flake -- it wedges the
kernel, and it was doing so when the child died the first time. Under the old
code that row ended the useful part of a four-hour run. Under the fix it costs
180 seconds and the run continues; 15 rows were emitted past it.

The complaint text names the timeout, which is the part that matters for audit:
the row is still recorded `compiled=False`, but a reader can now tell WHY. The
scorer keeps the distinction independently -- it re-builds each candidate itself
and classifies its own timeouts as refusals rather than zeros -- so a row that
defeats the kernel is never silently counted as a model failure at either stage.

Rate after the fix: about 44 s/row excluding the one 180 s stall, against 35 s/row
before, and the compile rate is unchanged (4 of 15, versus 26% over the first 415).

## The leak, observed again on the v1 arm (2026-08-29 03:22)

An OOM tripwire fired at swap 7.4 G. The cause is the same unfixed leak, now on the
second arm:

    pid 92840  forge_verify (v1 emission)   4.07 GB resident, 4h26m, never recycled
    the three CensusVerifier scorer children  0.04-0.06 GB each

The contrast is the whole finding in one line: the wrapper WITH the recycle stays
under 60 MB across the same workload; the wrapper WITHOUT it is at 4 GB and climbing.

**What was NOT done, and why.** The obvious intervention -- kill the child and let
the new respawn path give it a fresh one -- would free 4 GB instantly and cost at
most one row. It was rejected: that row would be recorded as a failure caused by ME,
not by the model, and it would sit in v1's data as an unearned zero. Injecting a
failure into one arm of a paired comparison to reclaim memory is not a trade worth
making while the machine is functioning.

**Why it is functioning.** Swap read 9.8 -> 15.1 -> 19.6 GB across two minutes, which
looks alarming, but free% held at 36% (the stable band all night is 35-44%), the
verifier was flat at 4.05 -> 4.00 GB, and Pageouts moved +35 in 30 s. Almost no actual
paging. The swap figure is macOS growing its swap file, not the machine thrashing --
the same distinction that made the earlier 36.5 G reading survivable. Disk fell
156 -> 139 GiB, which is that swap file, a second-order effect worth tracking.

**The material difference from five hours ago:** the timeout+respawn fix is in. When
the v5cap verifier died at ~4h it silently poisoned every later row. If this one
dies, the run loses one row and continues. The leak is still unfixed, but it is no
longer the same class of risk.

The recycle remains deferred until both arms are emitted, for the reason given
above: it resets kernel registry state between rows, and the arms must share an
instrument.

## Resolved by itself, 18 minutes later -- and the restraint was the right call

    [verifier] timeout after 180s; respawn #1
    [ho448] round 1: 21 ops  compiled=False
            gate: the tree does not compile: verifier timeout after 180s

`ho448` wedged the kernel, the timeout fired, the child was killed and respawned.
Measured immediately after:

    verifier   4.07 GB (4h26m old)  ->  0.03 GB (3m31s old)
    swap       19.6 G -> 1.5 G
    free%      36% -> 40% (touching 79% during the reclaim)
    disk       139 GiB -> 155 GiB   (the swap file handed back)
    v1         continues, 334/600, with exactly ONE row affected

**The timeout+respawn turns out to bound the leak as a side effect.** The periodic
recycle was deliberately withheld because it resets kernel registry state between
rows and the two arms must share an instrument. But a wedged row happens often
enough -- roughly 1 in 100 here -- that the timeout acts as an OPPORTUNISTIC recycle,
and it fires on a row that genuinely defeated the kernel rather than on an arbitrary
schedule. Memory stayed bounded without the comparability cost.

**And the decision not to intervene was vindicated on its own terms.** Killing the
child by hand would have reclaimed the same 4 GB, but the row it was working on
would have been recorded as a failure caused by the operator -- an unearned zero
inside one arm of a paired comparison. Waiting cost 18 minutes of an alarming swap
figure and produced an identical reclaim, with the failure correctly attributable to
`ho448`, which really did take more than 180 s.

The leak is still real and still unfixed. What this shows is that it is now
self-limiting in practice, which is why it did not need to be traded against the
integrity of the measurement.
