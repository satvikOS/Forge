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

### After merging, run the gate your change was most likely to break

The NAFEMS ratchet goes RED on "an improvement whose baseline was not lowered in the
same commit". I had merged a mesher fix that roughly halves two of its three errors —
exactly the shape that trips that rule — and had not touched the baseline. It turned
out fine, because neither case left its band, but that was worth ten minutes of
building and running rather than an argument. A gate designed to catch improvements
is one you must think about after a win, not only after a regression.

### A guard proves itself by NOT firing

forge-stallguard watched a live benchmark for twenty-five minutes and did nothing,
while the job advanced 389 → 495 rows. Earlier the same job had shown 60 seconds of no
progress, which was one slow task and not a stall. Refusing to conclude from that short
window, and letting the instrument with the right timeout decide, is the whole point of
having one.

### A stale artefact in a build directory is a false result waiting to happen

To run the FEA gate locally the `.node` has to be staged where the test looks for it —
in a `build/` that was configured WITHOUT the addon. Leaving it there means the next
run may load an addon built from different source and report a confident wrong number.
Stage it, use it, remove it. This program has produced four false results from stale
build artefacts already; the fifth is not free either.

### A band calibrated to a defect outlives the defect

fea_smoke's displacement band spanned a factor of a thousand because its header
argued that Tet4 shear locking made a large error inherent — "5–15x under the
Bernoulli prediction even on a refined mesh". The measurement behind that claim was a
hand-crafted FIVE-element box, which genuinely does lock. The generalisation did not
hold, and once the real cause (a frozen boundary, 11 clamped nodes instead of 51) was
fixed, the same element hit −7.9%.

When a test's tolerance is justified by a written argument rather than by a
measurement of the current code, re-derive it after any change to what it measures.
The band outlived its reason by long enough to pass the defect it was hiding.

### Put the judgement where it can be tested without the expensive part

The bands survived because exercising them meant a full addon build and a
161-second run dominated by a modal eigensolve. Moving the thresholds and the check
into a plain module made them testable against recorded numbers in any build, in
milliseconds. The pattern repeats: the piece that turns measurements into a verdict is
usually the piece with no test, because it is downstream of everything slow.

### Assert the premise, so a fix cannot be aimed at nothing

The band battery asserts that the OLD bands really did admit the broken run. If that
assertion ever fails, the tightening was aimed at a problem that did not exist, and
the test says so instead of passing quietly. A regression test for a fix should pin
the defect as well as the repair.

### Back-solving a model from the error is a hypothesis, not a measurement

LE10's plateau fitted a nodal-averaging model beautifully: invert the error and the
implied averaging depth comes out frozen at 0.106 m across the whole sweep, which is
exactly the frozen-length-scale signature that explained the previous defect. It was
wrong. Measuring the patch directly showed the depth shrinking 3.2x, tracking the mesh,
and disagreeing with the inferred value by 4.4x.

An inverted model tells you what the error WOULD mean if your model were right. Measure
the quantity the model is about before believing it — especially when the answer
flatters a pattern you have just successfully used.

### Report a task that eliminated a hypothesis without establishing a cause

T-026 asked for a root cause. This tick did not find one: it killed the leading
candidate with a measurement and quantified the next. That is real progress and it is
not completion, so the task stays open and the report says "SUPPORTED, not proven" in
its own heading. Writing the elimination down is what stops the next attempt from
spending its first hour on the same idea.

### A flat face is a free instrument

Deciding whether an unstructured mesh has converged to curved geometry is awkward. The
LE10 slab has a FLAT top face whose exact area is a closed form, and whose area depends
entirely on how well its boundary polygon is resolved — so it converts "is the boundary
converging?" into one number with a known answer. Look for the part of a model whose
correct value you can write down.

### When correcting a confounded measurement, enumerate ALL the confounds

I measured "distance from the geometry" for boundary vertices and got 0.29 m, frozen.
Corrected it once — excluding the flat top and bottom planes, where an ellipsoid
distance is meaningless — and got 0.291263, frozen. Wrote it up as a root cause.

The second number was the same defect: the model is a quarter of an elliptic annulus
with SIX boundary surface types, and I had excluded two of the four flat ones. The
worst vertex sat on the `y = 0` symmetry cut plane, exactly where it belonged.

**A correction that barely changes the answer is a warning, not a confirmation.** Two
wrong measurements agreeing to three decimal places felt like convergent evidence; it
was the same mistake twice. Before trusting a corrected metric, list every category
the measurement could be confusing and check you handled all of them, not the one that
happened to occur to you.

### A fix that changes nothing is evidence about the diagnosis

The interior-clearance change produced byte-identical deviation at every refinement
level while removing 5–8% of the elements. That is not a fix that underperformed; it
is a fix aimed at something that was not happening — and it said so before it could be
merged. When a targeted change moves the target metric by exactly zero, stop and
re-examine the cause rather than tuning the change.

### Retract in the same place you claimed

The wrong root cause was a committed report. The retraction is another committed
report that names the file, the commit, the vertex and the reason, and the ledger task
was reset from DONE rather than left standing. A finding that stays in the repo
uncontradicted will be believed by whoever reads it next, including me.

### A supervisor's clock starts from the evidence, not from when it was armed

forge-stallguard initialised its stall timer to the moment it started. Armed on a run
whose trace had been untouched for 44 minutes, with a 300s timeout, it waited another
300s — having been handed the answer at startup, in the file's mtime.

That is worst in exactly the case a supervisor exists for: attached to work already in
trouble, or restarted after a crash. When a watcher can read history, read it.

### You find a tool's defects by using it on something real

The staleness bug was invisible in the battery, which always created fresh fixtures
and then made them stale. It appeared the first time the guard was pointed at a
genuinely wedged production run. The fix came with tests in both directions, because
"start from the file" implemented carelessly is just "always fire" — which turns a
stall guard into a timer that kills healthy work.

### n=2 in one place is not a property of that place

Two GPU hangs on Drawing2CAD, with two other benchmarks completing cleanly twice each,
read as benchmark-specific. The third hang was on BenchCAD-HF-980. It is a general
MLX/Metal failure on long runs, and the earlier note naming Drawing2CAD had to be
corrected. Before attributing a failure to the one component you saw it on, ask how
many chances the others actually had.

### A flag on a `|| echo` continuation line is an argument to echo

The sweep's FLOOR arm gated its scorer on the pinned binary's sha256. The MODEL arm
wrote the same two flags after `|| echo "...WARNING..."`, so they were arguments to
`echo` — printed only on failure, never passed to the scorer. The two numbers being
compared to each other were held to different rules for weeks. Nothing was wrong
with either number (the sweep exports `FORGE_PINNED_DIR`, so both arms really did
use the baseline pin) and that is exactly why it survived: a disarmed guard looks
identical to an armed one until the day it is needed.

When checking that a command is invoked with a flag, split the logical command at
the first `||` and look only at the part that actually runs. Grep alone says
"present" for both cases.

### Check an observable's VARIANCE before using it to falsify anything

A wedging benchmark row was declared "completely unremarkable" on the basis of
prompt length (1213 chars against a median of 1210) and image size (268×268, like
all 40 that succeeded). Both observables are near-constant by construction in that
corpus — they could not have discriminated anything, and "unremarkable" was a
statement about the instrument, not the row. On the observables that carry
ground-truth complexity the same row was outside the range of every success:
faceCount 46 vs max 30, edgeCount 108 vs max 75, family never seen.

Before an observable can clear a suspect, confirm it separates the population at
all. This is the "volume cannot validate geometry" law applied to inputs.

### A log written at the end of a loop cannot describe the iteration that hung

`score_benchmarks.py` flushed its trace at the bottom of the per-task loop, so the
row that wedged the GPU never appeared in it. Three hypotheses were tested and
eliminated — benchmark-specific, pathological input, cumulative generation — all
inferred from the last row that SUCCEEDED, which by construction says nothing about
the one that did not. The preceding-row statistics looked like noise because they
were noise (gen-time rank 25/40, 25/40, 1/4, 5/5).

When diagnosing a failure, the first question is not "what caused it" but "is the
failing unit observable at all". If it is not, stop and instrument.

### `open(path, "w")` destroys the marker it is supposed to leave behind

The in-flight marker was first written with `open(path, "w")`, which truncates on
open. A process killed between the truncate and the write leaves a 0-byte file — the
diagnostic destroyed by the exact event it exists to record. MEASURED over 16
SIGKILLs: truncate-in-place lost it 7 times, write-to-temp + `os.replace` lost it 0.
Any file whose whole purpose is to survive a crash must be written by rename.

### A mutant that does not apply is not a surviving mutant

A mutation harness reported "GREEN — MUTATION SURVIVED" for a mutant whose anchor
had not matched: the file was never modified, so the clean code passed, as it
should. Two near-misses in one tick, both from hand-counted indentation in a
here-doc anchor.

A mutation harness must refuse to report a verdict unless the file actually changed
(`cmp` against a backup) and the mutant still parses. Prefer a regex or line-number
mutation over a hand-typed anchor.

### Pick n from the measured failure rate, not from roundness

The kill-survival check was written with 10 trials against a fault whose observed
rate was 2 in 10. That gives 0.8**10 = an 11% chance of missing a reverted fix — a
guard that fails to fail one time in nine. Raised to 16 (2.8%). The eventual
mutation measured 7/16, so the real power is far higher, but the number was chosen
before that was known and had to be defensible on the evidence available then.

### Re-using a task id destroyed two completed tasks, and the tool said "added"

`forge-program add` did `tasks.get(id, <new>)` then `.update(...)`, so an id already
in use was silently overwritten in place: title, layer, repo, write_set, acceptance
and evidence replaced, and the word printed was "added". Two DONE tasks went that
way because an agent — this one — filed new work without checking the highest id in
use. It surfaced only because `status` still read 37 tasks after two adds.

Three separate lessons, and the second is the one that nearly cost the records:

**Check the ledger before choosing an id.** `status` prints the total; the highest
id is one line of JSON away. Never assume the next number.

**An append-only log is only as good as the fields it appends.** The `done` events
carried full evidence, which is why the work was recoverable at all. The `add`
events carried only `title` — so layer, repo, write_set and acceptance for the
originals are gone permanently. When logging an event that can destroy state, log
the state it destroys, not a summary of it.

**A snapshot taken by reference is a snapshot of the future.** The first fix
recorded `prev = tasks.get(id)` and then mutated the same dict through `t`, so the
ledger's "replaced" field held the REPLACEMENT — a perfect-looking audit trail of
the wrong record. Deep-copy anything you intend to keep as a before-image. The test
caught this; reading the code did not.

An `add` that finds its id in use now refuses, naming the state and title it would
have destroyed, and `--force` still records a rebuildable before-image.

### A watchdog is only as honest as the signal it is handed

`forge-stallguard` watched `score_benchmarks`' trace, on the reasoning that "output
is the only observable that separates slow from stuck". The reasoning is right. The
choice of output was wrong: the trace is written at the **bottom** of the per-row
loop and five `continue` paths never reach it — prompt over ceiling, missing image,
dry-run without gold, a generation exception, and **"model emitted no IR"**.

From row 41 of BenchCAD-HF the model stopped emitting. The trace froze while the job
ran perfectly normally. The guard waited 900 s and killed it. Twice — both stallguard
firings on record are this — and the resulting "BenchCAD-HF-980 wedges
bit-deterministically at row 41" was written up, published and defended for an hour
before a probe finished all 45 rows with exit 0.

**A guard cannot distinguish "stopped working" from "working without producing this
particular output".** Only the signal can. Before arming a watchdog, ask what the
watched file does on the *unsuccessful* path — that is the path a struggling run
spends its time on, and it is exactly when you least want to be killed.

The test that matters is the negative control: the same arm, watched the old way,
must still be killed. A test that only proves the new target works would also pass on
a guard that never armed.

### The instrument you build to answer a question can refute the question

The in-flight marker was built to name the row that wedged the GPU. The first run
that used it showed there was no wedge on that benchmark at all, retiring a report
published an hour earlier — including a "deterministic hang point" and a tidy
complexity explanation for it (46 faces vs max 30, 108 edges vs max 75). The face and
edge numbers were correct. The inference built on them was not: row 41 is where the
*model* stops, not where the GPU stops.

Three hypotheses had been tested and eliminated against a phenomenon that did not
exist. All three were reasoned from the last row that *succeeded*, because the
failing row was unobservable. Instrument first, hypothesise second — and when the new
instrument contradicts the story, the story goes, not the instrument.

### An untraced row is invisible in every direction

The same trace gap was present on benchmarks nobody suspected: BenchCAD-holdout-41
has 41 `per_task` rows and 40 traced; neuralCAD-Edit-56 has 56 and 54. Those runs
completed, so the discrepancy was never questioned — and it had been silently
shrinking every reported denominator. When a summary and a detail log disagree about
how many rows ran, that difference is a finding, not rounding.

### A dead instrument was published as a capability

`forge_verify` could not start — `forge-kernel/build/libforge_kernel_core.dylib` is a
symlink to a `build/Release/` directory that does not exist, so dyld aborts it. The
harness restarts the child on failure, so the dead binary was relaunched and died
again once per row. Every row recorded `verifier died on write: [Errno 32] Broken
pipe`, every row was `compiled=False`, and the summary table printed **0/45
compiled** — which reads as a model result.

40/40 rows of every BenchCAD-HF run, 5/5 of one Drawing2CAD run, and both of the
day's probes. `holdout-41` and `neuralCAD-Edit-56` were clean, which is why nobody
looked: a fault that spares some benchmarks looks like a property of the ones it
hits.

`score_benchmarks` now asks the verifier one `BOX(1,1,1)` question before scoring
anything and refuses the whole run if it cannot answer. Refusing costs one run; not
refusing costs the conclusion. The escape hatch prints, in those words, that
**nothing in the run measures the model** — a silent hatch is how this comes back.

### The positive control is where the second bug was

The fail-closed gate looked finished and passed its "a dead verifier is refused"
check. Then the positive control — a verifier *known to work* must NOT be refused —
failed, and kept failing after the probe IR was proven valid by hand.

The cause was not in the new code. `BenchVerifier.__init__` replaced the queue that
`Verifier._spawn`'s pump writes into and started a **second pump on the same
stdout**. Two threads raced for every line, so a reply could land in the orphaned
queue and disappear. Measured: the first `run_job` of a fresh verifier returned
`verifier timeout after 20s`, and only the restart that timeout triggered made it
work. **Every run had been losing its first row(s) to a race in its own harness and
recording them as compile failures.**

Write the arm that must SUCCEED first. It is the one that fails for reasons you did
not put there.

### A mutation that survives is a gap in the test, not a passing grade

`M3 _restart re-implements _spawn` came back GREEN. The honest reading was not
"the mutation is harmless" but "no check reaches the restart path" — and a restart
happens on every timeout, so that path is the steady state of any long run. Adding
one check for it turned M3 red and found that the hand-rolled restart had also
dropped the stderr pump, leaving the child's stderr an unread pipe.

### Fixing a harness breaks the tests that were living off the bug

The fail-closed gate immediately broke two batteries that had been quietly running
against the dead verifier. Neither was about the verifier; both had simply inherited
whatever the live build was doing. They now name a binary known to work. When a gate
starts refusing, expect the existing tests that never noticed to go red — and fix
them by making their dependencies explicit, not by weakening the gate.

### "The model stops emitting" was 4096 repetitions of token 0

BenchCAD-HF rows 41-150 emitted 1 row in 110, against 40/40 before them. That reads
as a capability cliff, and it is not one. Every collapsed row recorded
`raw_len = 4096` consisting of a **single distinct character**, `!` — which is
**token id 0**. An argmax that keeps returning index 0 is a broken logit
distribution: the decoder failing, not the model answering badly.

The evidence was already on every row. `raw_head` and `raw_len` are recorded next to
`error: "model emitted no IR"`, and I had said a new GPU run with `--save-emissions`
would be needed to tell "no text" from "unparseable text". Read the fields the record
already has before spending a run to collect them again.

**Neither stop guard could fire, and both said so in their own comments.** The
novelty rule is *statement-level* — it needs 40 `%`-prefixed lines before it can act,
and `!!!!` has zero; its docstring already read *"an emission that is not
statement-shaped leaves it a no-op for the entire generation."* The wall-clock
deadline is 300 s, ~5× the slowest legitimate generation; these rows took 60.2 s. So
the most degenerate output a decoder can produce ran to the token cap **every time**,
costing ~109 minutes of GPU, and reached the record only as "emitted no IR".

A guard written against one *shape* of failure is blind to every other shape. Add the
shape-free check too: a run of identical tokens needs no decode and no grammar.

### Deleting one directory broke the link step and the symlinks that pointed into it

`forge_verify` had been unable to start since 2026-09-06. `build/Release/` is both
the CMake link output directory **and** an entry on the binary's rpath. It was
deleted; `ld` then failed with `open() failed, errno=2`, and the two convenience
symlinks in `build/` and `build-app/` dangled. The whole fix was `mkdir -p
build/Release` followed by a relink — no symlinks recreated, because the rpath was
always pointing at the right place.

Before rebuilding anything, read the *linker's* error rather than the consumer's. The
consumer said `verifier died on write: [Errno 32] Broken pipe` on 40 of 40 rows,
which describes a pipe, not a missing output directory four layers upstream.

### Run the control on your OWN code before auditing someone else's

The 40-generation cliff was chased through `mlx_vlm` for six probes — reading its
cache handling, its `rope_deltas` persistence, its Qwen3-VL position logic — while
`adapters/archie-30b-astra-v1` and our own `expert_lora_patch` / `LoRASwitchLinear`
machinery were inside the loop the entire time. **Every probe had loaded the
adapter.** The base-model control, which takes the same four minutes as any of the
others, should have been the first experiment, not the eighth.

The general form: when a bug appears "in a dependency", the cheapest discriminating
experiment is usually to remove *your* layer, not to read theirs.

### A failed experiment is not a finding

A reload-recovery test built a second 17.5 GB model without freeing the first, on a
36 GB machine, and died with `kIOGPUCommandBufferCallbackErrorOutOfMemory`. That
error is real and says nothing whatsoever about the cliff — it is the test's own
flaw. It was tempting to read it as "memory pressure confirmed", which would have
been the fifth instrument artefact of the session promoted to a finding.

The tell is that the error appears in the *test's* novel behaviour, not in the
behaviour under test. Before believing an error, ask which of the two it came from.

### Flat memory on both sides of a cliff rules memory out

`get_active_memory` and `get_cache_memory` were flat, so the obvious next move was to
suspect a transient spike that only `get_peak_memory` would show. Measured with
`reset_peak_memory()` per generation: peak is **18.51–18.52 GB on healthy rows and
18.51–18.52 GB on degenerate ones**, drifting +0.01 GB across forty generations, with
zero exceptions raised. Identical distributions on both sides of a deterministic
cliff rule the variable out — that is a stronger statement than "it looked flat".

### A retrodiction on data you already have is worth more than another experiment

The switch-LoRA ceiling was established by direct experiment, but the strongest
evidence came free. The explanation requires **images** — a text-only isolation ran 55
generations with no cliff. Every benchmark run from earlier the same day, collected
before the hypothesis existed, agrees:

| benchmark | rows with an image | emitted |
|---|---|---|
| BenchCAD-holdout-41 | 100% | **40** of 41 |
| neuralCAD-Edit-56 | **0%** | **54** of 56 |
| Drawing2CAD-283 | 100% | capped |
| BenchCAD-HF-980 | 100% | **40**, every run |

An audit of every trace on disk makes it sharper: of thirteen runs with ≥20 rows,
exactly **three** ever exceeded 41 emitted rows — the two text-only `neuralCAD-Edit`
runs, and the chunked run that fixed it. Nothing was tuned to produce that; the runs
predate the explanation. When a hypothesis arrives, check what it says about
measurements already taken before spending GPU on a new one.

It also found a truncation nobody had noticed: `BenchCAD-holdout-41`, the canonical
gate benchmark, is 100% images and emitted exactly 40 of its 41 rows. That looked like
one ordinary non-emission and was the ceiling. **Every holdout-41 number in the repo
came from 40 of 41 rows.** A cap one row below a benchmark's size is invisible; a cap
940 rows below it is not, which is why BenchCAD-HF is where it was finally caught.

### A tool that exists is not a tool that runs

The chunked arm was built, tested with ten checks, and proved live at 60/60 rows —
and the sweep went on calling `score_benchmarks` as one long process, so every
benchmark it ran was *still* capped at 40. All ten checks passed throughout, because
they tested the driver and not the call site.

Whenever a fix is a new component rather than an edit to an existing path, one of the
checks has to assert that the old path is **gone**. The mutation to write is "revert
the caller", not only "break the new tool".

### A mutation harness over COMPILED code must restore the binary, not the source

Two mutations of the kernel's op-hint rule were run in one batch. The harness
restored the source file between them and rebuilt — and `cp` finished within the same
second as the previous build, so `make` saw an up-to-date object and skipped the
translation unit. M2's test therefore ran M1's binary, and reported M2 breaking a case
it does not touch. Run in isolation with a forced `touch`, M1 breaks only `FILL` and
M2 breaks only `RESIZEFEATURE`.

Both were RED either way, so the verdict survived — but the *diagnosis* was wrong, and
a diagnosis is the reason to run mutations at all. For a compiled artefact: `touch`
the source, rebuild, and verify the binary corresponds before believing any result.
This is the same one-second mtime trap that once made `cp -R` produce objects newer
than their source.

### 92% of "invented" vocabulary was a rename, not a hallucination

`INVENTED_OP` was the largest failure class on the edit benchmark, which reads as the
model making things up. Of 13 invented ops, **12 are near misses of real ones** —
`CYLINDER`/`CYL`, `RESIZE`/`RESIZEBORE`, `FILL`/`FILLET`, `SCALE`/`SCALEUNIFORM`,
`OFFSET`/`OFFSETSOLID`. Only `HINGE` is a genuine fabrication. The model has the
concept and the wrong surface form.

The fix was **not** an alias table. Silently mapping `RESIZE` to `RESIZEBORE` would
build the wrong geometry and *pass*, and a plausible wrong answer costs more than an
obvious refusal. The kernel still refuses; it just names the op it nearly was.

Before treating a failure class as a capability limit, check how far the emissions are
from correct. "Invented an op" and "spelled a real op the natural English way" are the
same symptom and completely different problems.

### Ask the question the data can answer

"Which ops does the benchmark demand?" was unanswerable: the benchmarks carry no
ground-truth IR at all, only measured properties and a STEP file. Any tree producing
the right geometry passes, so there is no required op list to compare a corpus
against. Two tool-writing attempts went at it before reading the task schema.

The answerable form is one level down: a **surface** still has to come from somewhere.
A bspline face cannot be produced by BOX and EXTRUDE whatever the planner does, and
the kernel's own census reports surface kinds from the GT STEP. Reframed that way the
ceiling is measurable — 7% of holdout-41 contains a surface no taught op can produce,
41% only thinly reachable ones.

When a question resists measurement, suspect the question before the instrument.

### Overstating a ceiling is as wrong as understating one

The first pass said cone and sphere were impossible, because CONE, SPHERE and REVOLVE
all have zero training rows. That was wrong and would have been a satisfying story —
"half the benchmark is unreachable". CHAMFER (72 rows) leaves a conical face on a
rounded edge and FILLET (80 rows) leaves a spherical patch at a three-way corner, so
those parts are thinly reachable, not blocked. Only bspline has no taught producer.

The mapping from a surface to the ops that can produce it is a **judgement**, not a
measurement — the one such step in an otherwise measured chain. So it is written out
in the source, recorded into the output JSON so a ceiling always travels with the
assumption that produced it, and any surface kind missing from it is reported as
UNMAPPED with a non-zero exit rather than silently counted as reachable.

### The corpus in the eval command is not the corpus the model was trained on

Two findings were built on `data/forge/unified_ir_v4` — "45 of 68 ops never taught",
"49% of the holdout needs vocabulary the corpus barely teaches" — and both headlines
are retracted. That file is what `score_benchmarks.py` passes to `--train-corpus` for
the **Law 8 contamination check**. It is not the training set.

The adapter records its own: `adapter_config.train.json` → `data/_astra_v1`, 112,545
rows against 9,827, and 48 covered ops against 19. On the real corpus the
expressibility ceiling is **zero** — every surface in the holdout has a covered
producer — so the vocabulary story that took two tasks to build explains nothing.

The error was taking the corpus that was in front of me, because every benchmark
command names it, and never asking whether it was the right one. A model's training
data is recorded in its own config; read that before attributing behaviour to corpus
content.

**What survived is the part that was measured narrowly.** `SCALEUNIFORM` and
`OFFSETSOLID` have zero rows in the *real* corpus and are exactly the two ops the
model fabricated names for. A claim scoped to specific observed emissions held; the
sweeping one built on top of it did not.

**And the tools were fine.** Both produced the correct answer the moment they were
given the correct file — which is what their tests pin. Recording the producer mapping
into the output JSON is what made the recomputation a one-line change rather than a
re-derivation. When a result is wrong, check whether the instrument or the input was
at fault before rewriting the instrument.

### Two corpus explanations died; the modality gap kept surviving

Chasing why astra-v1 scores below a bounding box, the corpus was blamed twice and was
innocent twice:

* **"45 of 68 ops are never taught."** Measured against the wrong file — the Law 8
  contamination corpus, not the training set. On the real corpus it is 14 of 68, and
  the expressibility ceiling is **zero**.
* **"The corpus teaches short trees."** Measured by compiling its own targets: median
  5 ops → **10 faces**, 1.15 bores per part, matching the benchmark exactly. The model
  emits 5 ops → 6 faces, 0.07 bores. It is not reproducing what it was shown.

What survived every elimination was the thing found by reading the adapter's own
config rather than by theorising: **112,545 training rows, zero images**, against a
benchmark whose prompt carries a bounding box and directs all shape to the renders.

The pattern worth keeping: a corpus is easy to blame because it is large and
inspectable, and blaming it produces a satisfying narrative with no experiment
attached. Both corpus theories fell to one measurement each. Prefer the hypothesis you
can kill in a single command, and run that command before writing the story.

### Compile the corpus's targets; do not read them

The brevity theory looked right from reading trees — a 6-op block, a 5-op bracket, all
plausibly short. It died the moment those same targets were compiled and their faces
counted: 5 ops yields 10 faces, because `EXTRUDE` of a profile with several segments
is one op and many faces. Op count is not complexity, and eyeballing a tree measures
neither.
