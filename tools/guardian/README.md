# Forge Guardian — workstation resource governor (L0, development tier)

Implements the policy of `06_FORGE_GUARDIAN_OOM_CRASH_AND_RESOURCE_SAFETY.md` for the
**development workstation**. The in-product C++ `ForgeGuardian` (L0 of the layer
architecture in doc 04) enforces the same doctrine inside the app; this tier protects
the machine that builds and trains it, during long autonomous runs.

## Why this exists

The predecessor, `healthmon.sh`, was a **detector**: it emitted text lines and nothing
acted on them. Doc 06 is explicit that `"do not OOM" in a prompt is not a safety
control` — it must become a memory-pressure watcher, an admission controller, process
ceilings, a build-parallelism governor, cancellation and watchdogs. Guardian is that.

## Components

| Binary | Role |
|---|---|
| `forge-guardian` | The daemon. Samples a vector of observables every 5s, classifies GREEN/YELLOW/ORANGE/RED with hysteresis, publishes state atomically, actuates load-shedding. |
| `forge-gate` | Admission control. A heavy job calls this before starting; exits non-zero if the machine cannot take it. **Fails closed** when the daemon is dead or its state is stale. |
| `forge-job` | Envelope wrapper. Registers `{pid, name, priority, can_restart, peak_gb}` so Guardian is *able* to shed this job — and only jobs that opted in. |
| `forge-nproc` | The only sanctioned source of build parallelism. Returns fewer jobs as pressure rises; returns 2 (not `hw.ncpu`) when Guardian is absent. |
| `forge-guardian-ctl` | start / stop / status / tail. |
| `forge-guardian-selftest` | 19 assertions: classifier across all four tiers, the level-vs-trend regression, parallelism degradation, daemon liveness. |
| `forge-guardian-actuator-test` | 10 assertions: shed ordering, cooperative-then-coercive escalation, and the safety refusals. |

## State machine

Classification requires a **vector**, never one number:

- `kern.memorystatus_vm_pressure_level` — the OS's own truth (1 normal / 2 warning / 4 critical)
- pageout **rate** (monotonic delta per poll)
- swap used as a **fraction of swap provisioned** (macOS grows the swapfile on demand; an absolute MB figure is meaningless)
- free disk, thermal `CPU_Speed_Limit`, load average, registered-job count

| State | Trigger | Action |
|---|---|---|
| GREEN | nominal | full concurrency, build `-j(perf_cores-2)` |
| YELLOW | pageouts starting, disk < 45Gi, thermal < 90% | no speculative work, `-j5` |
| ORANGE | OS pressure WARNING, real pageout traffic, disk < 25Gi | SIGUSR1 (checkpoint+shrink) to priority ≥ 7 jobs, `-j2` |
| RED | OS pressure CRITICAL, sustained thrash, disk < 12Gi | staged: all checkpoint → TERM the single most speculative restartable job, `-j1` |

Escalation needs 2 confirming polls (~10s); de-escalation needs 6 (~30s). A flapping
governor is worse than none.

## Three rules that are not negotiable

**1. A level is not a trend.** The predecessor fired `MEMORY-LOW` every ten minutes for
an hour while a 30B training job sat resident and swap moved *down*. A resident model
holding 7GB is wanted, not an emergency. Escalation requires a signal that is *moving*.
The selftest pins this as an explicit regression: `free 7%, swap 6000M, zero pageouts →
GREEN`.

**2. Never signal an unregistered process.** A machine-wide `pkill` once killed every
parallel agent's server at once. Guardian may only signal PIDs that registered an
envelope, and refuses outright for a protected comm (`claude`, `WindowServer`,
`loginwindow`, `Finder`, `kernel_task`, `launchd`, itself) even if a job file names one.
The actuator test plants a job file pointing at the live `claude` PID and asserts the
refusal is logged and the process survives.

**3. Fail closed.** `forge-gate` denies when the state file is missing or older than 60s.
An absent instrument is not evidence of a healthy machine — a defect that has already
cost this program a 33,816-model corpus wrongly condemned as `corrupt:parse_failed`.

## Usage

```sh
forge-job --name build-kernel --priority 5 --peak-gb 8 --restartable -- \
  cmake --build build -j "$(forge-nproc)"

forge-gate --need green --wait 900 --why "corpus A/B" || exit 75
```

## The Law-7 producer

Guardian also writes `/tmp/archie_health/status.json`, the health signal the
archdisc-Models training fleet gates on. That file had **seventeen consumers and no
producer** — and four of them returned `{"state": "GREEN"}` from a bare
`except Exception`, so the memory guard actively asserted health for as long as the
file was absent, which was always. Guardian already computed this state, so it is the
natural producer. `gpu_jobs` counts registered jobs that declared `--gpu`; GPU work
that never registered an envelope is invisible to it, and consumers must not read a
`0` as proof the GPU is idle.

**Consumers must not read `gpu_jobs` directly.** It is a scalar with no pids in it,
so a job reading `gpu_jobs != 0` cannot tell somebody else's trainer from its own
envelope — and a job launched under `forge-job --gpu` blocks on ITSELF. That is not
hypothetical: it is why the benchmark sweep stopped declaring `--gpu`, and why this
file reported an idle GPU for hours with a 26 GiB model resident. Use
`archdisc-Models/scripts/forge_law7.py`, which reads this daemon's envelope
directory and excludes any envelope whose pid is the caller or one of its ancestors
(`forge-job` registers under its own pid and then execs the job, so ancestry, not
equality, is what has to work). It also fails closed on an absent or stale
instrument, skips envelopes whose pid is dead, and — because it runs between tasks
in a harness holding a 26 GiB checkpoint — walks the process tree with a libproc
syscall rather than forking `ps`.

`gpu_jobs` is a derived echo of the envelope directory, recomputed once per poll.
It can lag the registry by one poll but can never exceed what registered, so a
difference means staleness, not detection of unregistered work.

## Supervision

`com.archdisc.forge.guardian.plist` runs it under launchd with `KeepAlive`, so it
survives its own crash and reboot. Resurrection is verified with a positive control
(kill the launchd-owned PID, assert a *different* PID comes back) rather than by
observing that "a guardian is running" — an earlier version of that check passed by
finding a stale second instance.

## Known limitations

- Shell tier, not the C++ product `ForgeGuardian`. It governs builds, training and
  agent fleets; it does not yet arbitrate Metal/GPU allocations or the in-app worker
  processes described in doc 06.
- Predictive allocation (estimate peak from model size / DOF count / triangle estimate,
  then reconcile estimate against measured peak) is **not implemented**; `peak_gb` is
  currently declared by the caller and not enforced as a ceiling.
- No crash-loop breaker or quarantine of a repeatedly-crashing job signature yet.
