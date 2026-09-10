# ArchDisc autonomous execution — the tick runbook

One "tick" of the autonomous loop. It is written to be executed by an agent that
remembers **nothing** from the previous tick: context is compacted, sessions end,
the machine reboots. Every fact a tick needs is read from disk.

The doctrine this implements is `02_CLAUDE_MANUAL_TO_FORGE_OPERATING_MODEL.md`:

`DISCOVER → BASELINE → PLAN → RESERVE_RESOURCES → ISOLATE → IMPLEMENT_SMALL → BUILD → VERIFY_LOCAL → VERIFY_INDEPENDENT → BENCHMARK → INTEGRATE → CLEAN → RECORD`

---

## 0. RESOURCE GATE — always first, no exceptions

```sh
forge-guardian-ctl status | head -1        # must say RUNNING
forge-gate --need green --wait 600 --why "loop tick" || exit 75
```

If Guardian is not running, **start it and do nothing else this tick**. An
unguarded long run is how a workstation dies. If the gate denies for the whole
600s, the tick is a legitimate no-op — record it and reschedule; do not
"just try anyway".

## 1. DISCOVER — read state from disk, never from memory

```sh
forge-program status
forge-program ready
```

`ready` already excludes tasks whose dependencies are unmet **and** tasks whose
write set collides with something `IN_PROGRESS`. Take the first task that shows no
`WRITE-SET CONFLICT`. If nothing is ready, go to §7 (housekeeping) — a tick with no
implementation work still does cleanup and re-verification, and is not wasted.

## 2. BASELINE — prove the starting point is green before touching it

Never begin work on top of an unknown baseline; you cannot attribute a failure
afterwards.

```sh
git -C <repo> status --porcelain      # must be clean, or the dirt must be explained
git -C <repo> rev-parse HEAD
<the task's baseline command from tasks.json>
```

If the baseline is already red, the tick's job is to **fix or characterise the
baseline**, not to add to it. Record that and stop.

## 3. ISOLATE — one mutating agent, one worktree, one branch

```sh
git -C <repo> worktree add -b work/<task-id> "<repo>/.claude/worktrees/<task-id>" HEAD
```

Rules that have each already cost this program a day:

- **Never `git checkout` in the shared checkout.** It moves HEAD out from under
  every other agent and every read-only auditor attached to it.
- **Never reuse an existing worktree path.** `worktree add` fails when the path
  exists, and your `cd` then lands in a *pre-existing worktree on another branch*,
  where a `reset --hard` destroys someone else's work.
- **Never commit into the shared checkout while read-only agents are reading it.**
- **Never edit a script that is currently executing.** zsh reads scripts
  incrementally; an in-place edit corrupts the running process.

Then `forge-program claim <id> --owner loop-<tick>`.

## 4. IMPLEMENT — smallest coherent patch

`inspect → state hypothesis → smallest patch → compile the narrow target → run the
target test → inspect the diff → widen the test → commit`

Forbidden, from doc 07: giant reformatting, opportunistic unrelated cleanup, deleting
files that "look unused" without dependency proof, disabling a failing test to get
green, changing the acceptance criteria after the fact, silently adding a dependency,
editing generated/vendor code as source.

Builds go through the governor, always:

```sh
forge-job --name build-<task-id> --priority 5 --peak-gb 8 --restartable -- \
  cmake --build build -j "$(forge-nproc)"
```

Never hardcode `-j`. `forge-nproc` is the only sanctioned source, and it drops to 2
under pressure and 1 at RED.

## 5. VERIFY — falsifiably, and independently

Doc 02 §4 and doc 18 of the directive: a task is **not** done because code compiled,
a file exists, a screenshot looks right, or an agent said "success".

Engineering truth for this program comes from: geometry checks, constraint
satisfaction, dimensions, topology, invariants, round trips, solver convergence,
collision tests, manufacturing rules, benchmarks, resource telemetry.

Two lessons hold specifically here:

- **A vector of observables, never one.** Volume alone has passed a wrong shape four
  separate times in this program; in one case (a native quadric offset) *no single*
  observable caught it — COM was clean on the sphere, bbox clean on the cylinder.
- **Prove the arms differ.** A null A/B result usually means the harness is broken,
  not that the change did nothing. Run a positive control before believing a zero.
- **Run a new gate against the UNFIXED code first.** If it is green before the fix, it
  is not testing the fix. Two vacuous gates in one session: one whose panel never drew
  because the default workspace did not hold it, and one that sent an empty tool list
  so every case failed for an unrelated reason — and its red-then-green control
  "passed" on that same wrong reason. A control that fires for the wrong cause is
  worse than no control.
- **Delete the binary before rebuilding it.** A failed compile leaves the previous
  executable in place, and running it reprints the old result as the new one. Four
  stale-artefact incidents in one session: an OCCT ledger measuring a `.node` nothing
  rebuilds, orphan-source counts taken from leftover object files, a gate linked
  against a stale `libforge_ui.a`, and a `/tmp` probe answering for a failed build.
- **One heavy job per build directory.** Two runs of the same suite against one
  `APP_BUILD` rebuild and execute each other's mutated binaries — identical code
  reported 109 mutations once and 133 the next time. Doc 06 states it: the same build
  directory is never shared.
- **Do not declare a resource the job already gates itself on.** Wrapping the
  benchmark sweep in `forge-job --gpu` made the health signal report `gpu_jobs=1`, and
  the sweep's own Law 7 check refused to start — it saw a GPU job that was itself.

Then spawn an independent validator against the branch that is told to **falsify**
the result, not reproduce it.

## 5b. PREFLIGHT — before every push, without exception

```sh
bash tools/preflight/forge-preflight
```

It DISCOVERS what to run rather than naming it: every `--check` generator under
`implementation/sacrosanct/tools`, every workflow file, both gate-registration
ratchets, and the cheap self-contained gates.

This exists because a hand-written battery let me break CI twice in one session on
the same two-sided system — `--check` on the vocabulary JSON against its sources,
and `--check` on the C++ header against that JSON's sha. Fixing the first moved the
sha and broke the second. The battery I verified with listed only the check I
already knew about, and a hand-listed battery is incomplete the moment anyone adds
a generator — it reports PASS for what it contains and says nothing about the rest.

A CI cycle here is 35–45 minutes. Preflight is seconds.

## 6. INTEGRATE — one integrator, serially

One PR/merge at a time. CI green **and** the branch rebuilt on the target branch
before the next merge begins.

`CANCELLED is never a pass` — read the check *description*, not the bucket. A
supersession and a genuine timeout look identical in the status column and need
opposite responses.

Record with mandatory evidence:

```sh
forge-program done <id> --commit <sha> \
  --evidence "what was MEASURED, with numbers"
```

The ledger refuses evidence shorter than 20 characters on purpose.

## 7. CLEAN — every tick, whether or not work landed

```sh
git -C <repo> worktree list                       # any merged worktree still present?
git -C <repo> worktree remove <path>              # only after integration is confirmed
du -sh <repo>/.claude/worktrees/* 2>/dev/null     # the #1 hiding place for disk
df -g / | awk 'NR==2{print $4"Gi free"}'
ls ~/.forge-health/jobs/                          # stale envelopes = a leaked process
```

`DISCOVER → CLASSIFY → VERIFY RECOVERABILITY → VERIFY NOT ACTIVE → DRY RUN → DELETE → AUDIT`

Never delete on "looks unused". Two traps already sprung in this program:

- A worktree that is clean, unlocked and witnessed can still be **load-bearing** —
  another repo was running a binary built inside it. Check `lsof`, not just `git`.
- A cleanup's own keep-rule can be broken: one compared against a ref that *merging
  had just deleted*, so it kept everything for ever. Ask a cleanup **why** it kept
  something, not just what it deleted.

For source, confirm the commit is on the correct remote before deleting locally —
and note that "git tracked" is not the same as "backed up". For weights and datasets
too large for GitHub, require a second verified durable copy first.

## 8. RECORD — and choose the next wake

Append the tick outcome to the ledger. Then `ScheduleWakeup`:

- waiting on nothing in particular → 1200–1800s
- waiting on an external run the harness cannot notify about (CI, a deploy) → match
  the delay to how fast that thing actually changes
- background work already tracked by the harness → a long fallback (1200s+); you are
  re-invoked when it finishes, so polling is waste

## Stop conditions — stopping is not failure

Stop the tick immediately, and record why, when:

- a required write escapes the task's declared write set
- the repository is unexpectedly dirty
- the baseline is not reproducible
- Guardian reports ORANGE or RED
- the disk reserve is violated
- tool or kernel output contradicts the plan's assumption
- three materially identical repair attempts have failed → the ledger AUTO-BLOCKS at
  three, which is deliberate: `STOP → COLLECT EVIDENCE → FIND ROOT CAUSE → REPLAN`,
  never endless symptom-patching
- a destructive operation has no rollback

## Escalate to the user only for

Unavailable required information, destructive ambiguity, credentials, licensing
ambiguity, user-owned irreversible data, or an unsafe hardware state. Everything else
is an ordinary technical decision — make it, record the reasoning, continue.

### A guard that names a state nobody publishes is an absent guard, not a weak one

`health_blocks()` — the brake that runs before EVERY task of a four-hour sweep —
tripped on `"DANGER"`/`"TRIPWIRE"`. forge-guardian emits GREEN/YELLOW/ORANGE/RED and
never has emitted anything else. On the state axis the brake was dead code for as
long as it has existed, and the only thing that could stop a run was the HALT file.
It read like a working safety check in every review.

When a consumer tests a producer's value against a literal, go read the producer and
enumerate what it can actually emit. Then write the test both ways: RED must stop
work AND YELLOW must not, because a brake that never fires passes the second and a
brake that always fires passes the first.

### Parent CPU is the wrong observable for a driver process

A scorer 62 minutes in with 0.53s of CPU and 29 MB RSS looks hung. It was not: it was
a thin Python driver blocked in `read()` on a pipe while its `forge_verify` child ran
at 99.7%. The observables that answer the question are child liveness and log growth,
measured twice over an interval — not the parent's CPU, and not elapsed time.

### The instrument you are reading may not be the instrument that exists

`gpu_jobs != 0` was implemented three times by three consumers, each with a different
idea of what the number counted, and one of them (`moe_gate._self_is_heavy`) was
calibrated to a monitor that had been replaced. It subtracted itself from a count it
was no longer in. Size is not identity: to exclude yourself from a registry, match on
pid ancestry, not on a threshold that happens to correlate.

Corollary: before adding a "these two instruments disagree, fail closed" check, find
out whether one is DERIVED from the other. `status.json.gpu_jobs` is computed by the
guardian from the same envelope directory the consumer reads, so it can lag by a poll
but can never exceed it — a refusal on that difference could only ever be a false
alarm, and I shipped one before catching it.

### Read the code you are replacing for its reasons, not just its behaviour

The function I deleted carried a docstring explaining that nothing on that path may
fork, because fork(2) from a process holding a 17 GiB checkpoint makes the kernel
reserve swap for the whole copy-on-write address space — measured once at
swap 2.5 → 11.8 GiB with the machine wedged. My replacement called `ps` in a loop. The
memory guard would have become the thing that exhausted memory. When a rewrite drops
a function, the constraint it encoded has to be re-homed and re-tested, or it is
rediscovered the expensive way.

### A suite that cries wolf in its own supported deployment is worse than no suite

The guardian's fault-injection selftest reported `FAIL daemon not running` against a
healthy launchd-supervised daemon, because it gated on a pid file only an
*unsupervised* start writes. 17 passes and one permanent, meaningless red — exactly
the shape that teaches a reader to skim past the red line. Key liveness to the thing
consumers actually depend on (here: publishing), and prove the new check still goes
red for absent AND for present-but-stale, or you have replaced a false failure with a
check that always passes.

### Bound the stochastic component, not just the deterministic one

`planner.plan()` had no timeout. The verifier on the next screen had a thread, a
queue, a kill and a restart, with a comment explaining that a timeout means "a bad
task costs one task". The careful engineering had gone to the deterministic C++
component and none to the LLM — the one that can degenerate into a repetition loop.
A row decoded for 37 minutes against a p90 of 60s, holding the GPU under Law 7 and
stalling every other job on the machine.

When auditing a loop for robustness, list the calls that can block and check the
bound is on the one whose runtime you cannot predict.

### An existing guard is not coverage until you read its preconditions

A decode-time repetition guard was ON and did not fire. It could not have: it
requires 40 statement-shaped lines before it is permitted to return True, so an
emission that never becomes statement-shaped leaves it a no-op for the whole
generation. "There is already a guard for that" is a claim about a name; read the
threshold and ask which inputs reach it.

### Stop at a boundary the callee already has

The obvious way to bound a call is a thread plus a kill. On a process holding 7.5 GiB
of weights and a live Metal queue, that risks abandoning half-finished GPU work. The
generation API already called a per-token hook, so the deadline went there and stops
decoding at a token boundary with nothing to abandon. Prefer a cancellation point the
callee already exposes.

### Say which stops were yours

A backstop that truncates output creates rows that look exactly like the model
emitting a broken tree. Record the reason (`eos | novelty | deadline | max_tokens`)
and classify a self-inflicted stop ahead of every model-failure class, or the next
person to read the numbers will attribute your safety margin to the model. The same
mislabelling — a generation collapse reported as `ft parse line` — is what hid an
18.5% failure class until a taxonomy was built for it.

### Parent CPU said "hung", child liveness said "working", and the trace settled it

Three observables disagreed about one process. The trace file was the one that
mattered, because it is flushed per row and its mtime is a direct measurement of
progress. Prefer the observable that the work itself updates over the ones the OS
reports about the process.

### When the fix is blocked by the thing it fixes, that is a deadlock — break it

A sweep stalled on one row for 69 minutes. The patch that bounds exactly that failure
was written and tested, and could not be merged because the stalled sweep was
executing the file out of the main checkout. Waiting was not conservative; it was the
deadlock. The move is to establish what is durable first (both completed benchmarks
had gate/composite/verdict/trace on disk), stop the stalled work deliberately, merge,
and relaunch — and to check what else you are about to take down with it (the
independent floor run was five hours in and was kept alive).

### Verify a fix by reading its signal, not by trusting the change

The relaunch printed exactly the admission line the fix was built for — and then
published `gpu_jobs=2` for a single resident model, because the wrapper and the script
each registered an envelope. If I had stopped at "the acceptance line appeared", a
ten-hour run would have published a Law-7 signal that contradicted Law 7. Read the
number the fix was supposed to correct, not the log line saying it ran.

### A held branch diverges; `--ff-only` failing is information, not an obstacle

Three commits held for a sweep meant main moved on underneath them. The ff-only merge
refused, which is the correct behaviour and the moment to look. Resolving an add/add
conflict by picking a side is only safe once you have DIFFED the two versions and can
say what the losing side contained — here the branch file was main's plus one class,
a strict superset, and saying so took one command.

### Two plausible causes, both refuted, before the real one

A 69-minute row invited three explanations in turn: token-cap truncation (refuted —
the emissions stopped at lengths from 1,827 to 6,605 characters, so no single cap),
the corpus teaching VERIFY spam (refuted — training rows carry a median of ONE VERIFY
line, max 1), and huge vision prefill (refuted — all 283 images are identical 400x400,
about 225 tokens, including the row in flight). Each took one measurement to kill.
Killing a hypothesis cheaply is worth more than defending it; write the refutations
down, because the next reader will have the same idea.

### A number carried one file further than its caveat

`p = -6.70` blocked a task for weeks. Its own source report said, on the same commit
day, that the sequences are non-monotone and "the `p` values in section 2 are noise
rather than rates", and the harness prints that warning at runtime. The baseline file
recorded them anyway as "observed orders of accuracy", my block note quoted the
baseline, and by then the caveat was two hops behind the number.

Computed pairwise, that exponent ranges from **-2092 to +4.35** depending only on which
consecutive pair you pick, because one denominator is `log(0.16035/0.16038) = -0.0002`.
It was `log(something) / log(almost 1)`.

When a statistic justifies a decision, open the file it came from and read what that
file says about it. A derived number does not carry its own preconditions.

### "The error grows under refinement" needs the refinement to have happened

The inference `negative order => formulation error` is sound only if the mesh actually
refined at the place the answer is read. Here `targetEdge` fell 2.9x and the tet count
rose 4.5x while `h_local` at the probe fell 1.46x, and once went the wrong way. The
model refines everywhere except where it is measured. Before concluding anything from a
convergence sweep, verify the independent variable moved.

### Search for prior work before treating a blocked task as research

The root cause had already been established, mutation-proven and committed — under a
filename the block note never mentioned, and the note pointed at two artefact paths
that do not exist (`reports/FEA_NAFEMS_GAP.md`, `test/fea_nafems_convergence.mjs`; both
live under `forge-kernel/`). One `find -iname '*NAFEMS*'` would have found it. Check the
repo for the answer before scheduling the investigation.

### A test that cannot exhibit the defect is not evidence

I fixed the boundary densifier, proved it on a unit cube, and committed. A cube cannot
exhibit an aspect-ratio defect: all its triangles are isotropic, so 4-way subdivision
and longest-edge bisection give byte-identical output. The repo's own `fea_smoke` then
ran for twelve minutes at 100% CPU on a 10:1 beam, where my scheme over-refined the
short direction 16x.

Before claiming a geometric fix, ask which shapes could distinguish it from a wrong
one, and mesh those. The claim I made was true and insufficient, which is the harder
kind of wrong to notice.

### Build the baseline from a pinned commit, not from a reverted file

To measure before/after I restored the old source, launched the build, and restored
the new source — racing the compiler for the one translation unit that mattered. The
"baseline" could have been built from the fixed code and I would not have known. A
`git worktree add --detach <sha>` costs a checkout and makes the race impossible.

### Report the criterion you set, especially when you miss it

Acceptance said the convergence harness must report `monotone: YES`. It reports NO.
The work still moved four independent observables by an order of magnitude — clamped
nodes 11 -> 51, displacement -91.2% -> -7.9%, stress -52.2% -> -6.1%, first mode
+226.4% -> +4.1% — and NAFEMS LE1 from -61.5% to -3.46%, inside its band. All of that
is worth shipping, and none of it converts a missed criterion into a met one. Record
the miss in the same breath as the wins and file what remains.

### A wide band is not a gate

`fea_smoke` printed "PASS — within engineering plausibility band" on a run with a
-91.2% displacement error and a +226% first mode. It passed on the defect that an
entire task existed to fix. When a test's verdict is stable across an order-of-
magnitude change in the thing it measures, it is reporting that it ran, not that the
number is right.

### Independent observables are what make a mechanism believable

Displacement, peak stress and modal frequency do not share a formula. All three moved
together and landed within 8%, and the log named the mechanism directly: the clamped
face carried ELEVEN nodes because its node set was the frozen one. One observable
would have been a number; three plus a legible cause is an explanation.

### A guard that can hang cannot report anything

The mutation that disabled forge-stallguard's stall check made the guard loop for
ever — correctly, since a supervisor with nothing to report should not exit. The
battery therefore HUNG instead of failing, and the mutation harness sat there with no
verdict at all. Bound every mutant run, and label a hang distinctly from a clean
failure so the two are never confused: both are red, but only one of them means what
you think it means.

### Output is what separates slow from wedged

Two composite drivers were running on this machine. Both reported **0.0% CPU**,
because in both cases the work was in a `forge_verify` child. One was progressing at
four rows a minute and one had produced nothing in an hour. `ps` could not tell them
apart; the log files could, instantly. When supervising work, watch the artefact the
work updates, never the process.

### Split a task rather than work around a write-set conflict

The ledger refused T-029 because it overlapped a file another task was holding. The
answer was not to override it but to split off the half that conflicts with nothing —
a standalone tool — and leave the wiring for when the hold lifts. Most of the value
landed immediately and the invariant stayed intact.

### The right pgrep can still match the wrong process

Two `composite_score.py` processes were running on the same task file: one six hours
old, one ninety minutes old. `pgrep -f` returned the wrong one and I nearly measured
the healthy job while diagnosing the stalled one. Disambiguate by something the
processes do not share — here `lsof` on their stdout — rather than by a pattern that
happens to match today.
