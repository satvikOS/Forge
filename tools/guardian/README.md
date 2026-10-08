# Forge Guardian — workstation resource governor (L0, development tier)

Implements the policy of `06_FORGE_GUARDIAN_OOM_CRASH_AND_RESOURCE_SAFETY.md` for the
**development workstation**: the machine that builds Forge, trains and serves Archie, and runs
autonomous agent fleets. Every interface, file and schema it shares with its consumers is in
[`SCHEMA.md`](SCHEMA.md); the tunables are in [`policy.default.json`](policy.default.json).

There is no in-product C++ guardian yet. This tier is the one machine-wide admission authority;
the app reads its published state (T-179), and the Models fleet reads its envelopes and Law-7
signal (`archdisc-Models/scripts/forge_law7.py`).

## Components

| Binary | Role |
|---|---|
| `forge-guardian` | The governor (zsh). One per health domain (`FORGE_HEALTH_DIR`, default `~/.forge-health`). Classifies GREEN/YELLOW/ORANGE/RED/UNKNOWN from a vector of observables with hysteresis, publishes atomically, actuates load shedding, keeps history/events/logs bounded. Supervises the sensor. |
| `forge-guardian-sensor` | Native (Objective-C++) sensor and admission engine. `run` samples memory pressure events, thermal state, swap, pageouts, per-volume disk, sleep/wake, registered jobs' process-tree footprints, DiagnosticReports and watched logs; every signal carries `ok/unavailable/stale/invalid`. `admit`/`release` serialize reservations and the crash-loop quarantine; `incident` writes evidence bundles. |
| `forge-gate` | State-only admission check (`--need`), plus a resource check through `admit --dry-run` when given `--peak-gb/--disk-gb/...`. Fails closed on a missing, stale or clock-skewed state. |
| `forge-job` | Runs a command under an envelope: admission through the engine, signal forwarding (USR1 = checkpoint, never lethal), release with exit status for crash accounting. |
| `forge-nproc` | The only sanctioned build parallelism: state-based, minus threads reserved by other jobs; 2 when the governor is absent. |
| `forge-guardian-ctl` | `status` (read-only), `start/stop/restart`, `diagnose`, `incident`, `quarantine list/clear`, `reservations`, `history`, `version`, and `install/upgrade/rollback/uninstall`. |
| `forge-guardian-install` | Versioned install under `~/Library/Application Support/ForgeGuardian`, generated LaunchAgent, verification, automatic rollback. |
| `forge-stallguard` | Bounds a wedged job from outside by watching a file its work advances. |
| `soak/forge-guardian-soak` | Bounded 1–24 h soak of the installed governor with harmless admission probes. |

## Install, operate, remove

```sh
zsh tools/guardian/forge-guardian-install install      # builds the sensor, stages, validates,
                                                        # installs, starts, verifies, or rolls back
forge-guardian-ctl status                               # first line: RUNNING pid=… (launchd-supervised)
forge-guardian-ctl diagnose                             # deep read-only checks, PASS/WARN/FAIL
forge-guardian-ctl incident --note "screen went green"  # preserve the moment + recent history
forge-guardian-ctl quarantine list
forge-guardian-ctl rollback                             # previous release
forge-guardian-ctl uninstall                            # keeps ~/.forge-health state and evidence
```

Layout: releases in `~/Library/Application Support/ForgeGuardian/releases/2.0.0+<hash>/` with
`current` and `previous` symlinks; `~/.forge-health/bin/<tool>` and `~/.local/bin/<tool>` are
symlinks into `current`. Nothing is ever written in place (a running zsh reads its script
incrementally). The LaunchAgent `com.archdisc.forge.guardian` is generated for the resolving user
(escaped, `plutil`-linted, read back); `RunAtLoad`, `KeepAlive`, `ThrottleInterval 30`,
`ProcessType Standard`, `Nice 5`, logs in `~/.forge-health/log/launchd.{out,err}`.

**Coverage, stated plainly.** A user LaunchAgent runs while this user is logged in. It is not a
boot-time service: nothing is governed before login, and a logout stops it. It is not a hardware
monitor: a user-space service cannot prevent a kernel panic, a GPU/display fault or power loss;
it can only capture evidence around them and keep heavy work from starting on a sick machine.

## States

| State | Means | Actuation | Heavy admission |
|---|---|---|---|
| GREEN | complete, fresh evidence; nominal | none | open |
| YELLOW | pageouts starting, disk < 45 GiB, thermal *fair* | none; `-j nperf/2` | closed for `--need green` |
| ORANGE | OS pressure WARNING, real pageout traffic, disk < 25 GiB, thermal *serious* | SIGUSR1 to priority ≥ 7 | closed |
| RED | OS pressure CRITICAL, sustained thrash, disk < 12 GiB, thermal *critical* | USR1 all → TERM one restartable job (settle 180 s, one TERM per 45 s) | closed |
| UNKNOWN | no sustained evidence: starting, stopping, or a required signal missing/stale/invalid | none | closed |

Escalation needs 2 confirming polls, recovery 6 (~30 s) — including recovery from UNKNOWN, so a
restarted governor earns GREEN rather than assuming it. **Critical bypasses hysteresis**: OS
pressure CRITICAL, a critical pressure event, a required volume below the red floor, or a failed
state publication moves to RED on the poll that observes it, and the sensor's SIGUSR2 makes that
poll happen at once. Missing evidence never hides real pressure: if what is available already says
ORANGE or RED, that is published and acted on.

## Rules that are not negotiable

**1. A level is not a trend.** A resident 30B model holding memory, with swap large and steady
and no pageouts, is GREEN. Escalation needs a signal that is moving.

**2. Never signal a process whose identity is not proven.** Only registered envelopes are ever
signalled, and only after the pid is verified as the same process (start time, boot session;
SCHEMA §5). A reused pid is reaped, an unverifiable one is never signalled, and protected
processes (Claude, WindowServer, loginwindow, Finder, Dock, launchd, the governor, its sensor, its
own ancestors…) are refused even if an envelope names them. No pattern kills, ever.

**3. Fail closed, and say why.** An absent instrument is not evidence of a healthy machine. A
missing, stale, future-dated or unparseable state denies; a sensor reading that failed is
`unavailable`, never a default. The old governor published thermal = 100 % for months on this Mac
because `pmset -g therm` prints no `CPU_Speed_Limit` on Apple Silicon.

**4. Admission is a reservation, not a look.** `admit` decides under one lock: identity-verified
reservations (max of declared and measured peak) plus the new job must fit `RAM − os_reserve`, and
the new job plus every reservation not yet resident must fit what is available now. Two jobs can
no longer pass the same gate on the same headroom.

## Crash loops, incidents, sessions

- **Quarantine:** 3 crashes (SEGV, BUS, ILL, ABRT, FPE, TRAP, SYS, KILL) of one job signature in
  15 min quarantine it; `forge-job` then refuses it with exit 78 and prints the exact
  `forge-guardian-ctl quarantine clear <sig> --reason "…"` that releases it. A changed command line
  is a new signature. The governor itself backs off (UNKNOWN, gates closed) after 5 starts in 15 min.
- **Incidents** (`incidents/<UTC>-<kind>/`, ≤ 512 KiB each, 30-day retention): automatic on RED,
  quarantine, an unclean previous session, panic/GPU/WindowServer/shutdown-stall/Jetsam reports and
  watched-log GPU errors; manual via `forge-guardian-ctl incident`. A bundle holds the state, the
  sensor snapshot, the recent history and events, the envelopes and the relevant reports;
  `--with-log` adds a bounded unified-log window. Inaccessible evidence is recorded as inaccessible.
- **Sessions:** each start classifies how the previous session ended — `service_restart`,
  `service_interrupted`, `orderly_stop_then_reboot`, `kernel_panic` (only with a panic report in the
  gap), or `unclean_unknown`. A changed boot or a heartbeat gap is evidence, never a diagnosis.

## Bounds

Idle cost measured on this Mac: sensor 0.05 % of one core and 7 MiB RSS; the governor's steady
state forks only its poll sleep. Logs, history, events and incidents share a 64 MiB cap with
rotation; a full disk never truncates a published file (write, fsync, rename — or keep the old one
and go stale, which closes the gates).

## Tests

All hermetic: private `FORGE_HEALTH_DIR`/`ARCHIE_HEALTH_DIR`, a fake home for the installer, stubs
for observation commands. CI: `guardian` and `guardian_v2` jobs in `.github/workflows/kernel-tests.yml`.

| Gate | Pins |
|---|---|
| `test/guardian_red_survival_gate.sh` | survives RED stage 3; no GREEN on start/stop |
| `test/governor_policy_gate.sh` | every transition, hysteresis, evidence step, critical bypass |
| `test/governor_runtime_gate.sh` | real daemon: no-sensor fallback, sensor death, stale/malformed snapshots, USR2 latency, skew, logs/cap, disk-full, Law-7 dir safety, notifications, restart breaker |
| `test/sensor_gate.sh` | native signals with status, injection, session classification, reports, torn writes, idle cost |
| `test/admission_gate.sh` | serialized reservations (8 concurrent → exactly the fitting subset), identity, quarantine |
| `test/forge_job_admission_gate.sh` | forge-job exit mapping, crash release, legacy path |
| `test/install_gate.sh` | install/upgrade/rollback/uninstall, plist escaping, real home untouched |
| `test/guardian_single_instance_gate.sh` | one governor per domain, fail-open on a stale lock, 11 mutations |
| `test/forge_job_usr1_gate.sh`, `test/forge_job_usage_gate.sh` | USR1 is cooperative; `--help` costs no gate slot |
| `forge-guardian-actuator-test`, `forge-guardian-selftest` | shed targeting; classifier vectors (library mode) |
| `forge-kernel/test/resilience_harness.mjs` | scored family benchmark + 4 reintroduced production defects |

Test hooks (never set in production): `FORGE_GUARDIAN_SENSOR=0`, `FORGE_GUARDIAN_SENSOR_BIN`,
`FORGE_GUARDIAN_POLL`, `FORGE_GUARDIAN_SETTLE`, `FORGE_GUARDIAN_TERM_GRACE`,
`FORGE_GUARDIAN_NOTIFY_CMD`, `FORGE_GUARDIAN_DISKUTIL`, `FORGE_GUARDIAN_HOME`,
`FORGE_GUARDIAN_LAUNCHCTL`, and the sensor's `FORGE_SENSOR_TEST=1` injection family.

## Known limits

- Real memory-pressure, sleep/wake and thermal transitions are exercised through the same handlers
  by test injection; inducing them for real (`memory_pressure -S`, heating the machine) is not done.
- Reservations are estimates; macOS has no hard per-process memory ceiling here. Jobs must still
  bound their own allocations and handle allocation failure.
- GPU faults are seen only through DiagnosticReports, watched logs and the local event inbox; the
  Forge renderer's Vulkan device-loss reporting into that inbox is T-179.
- Folders protected by macOS privacy (TCC) are not scanned; that evidence is reported as unavailable.
