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
