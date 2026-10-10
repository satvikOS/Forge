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
zsh tools/guardian/forge-guardian-install install --dry-run   # what install would do + the
                                                        # reservation preflight; changes nothing
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

### What an install does, how long it takes, how it exits

`forge-guardian-install install --dry-run` reads the domain and prints what `install` would do —
it writes, builds, starts and signals nothing (launchctl is only asked to `print`). `install`
(after staging, before the cutover), `install --dry-run` and `status` run the **reservation
preflight** (report only): v2 admission holds every live envelope's reservation,
`max(declared peak_gb, measured)`, against the heavy budget `RAM − memory.os_reserve_gb`, so a live
envelope whose declaration *alone* exceeds that budget (on this 36 GiB Mac: the archie-sidecar's v1
envelope declared 31 GiB against 36 − 6 = 30) is reported as `RESERVATION EXCEEDS THE HEAVY BUDGET …
heavy admission will be denied while it is registered.` Every job declaring more than
`memory.light_job_gb` is then denied until that job is re-registered with a declaration that fits,
or stops. The installer never edits, re-registers or signals that job or any other service.

The budget it prints is the engine's. `admit` reads `policy.json` at every call and rejects the
*whole* file when any key is outside SCHEMA §6's bounds (the defaults, `os_reserve` 6, apply then).
So the preflight asks a sensor for exactly that evaluation (`forge-guardian-sensor policy
--state-dir ~/.forge-health --env`, read-only): `install` asks the staged sensor (the one that
admits after the install), `--dry-run` asks `FORGE_GUARDIAN_SENSOR_PREBUILT` or the installed
sensor, and `status` asks the installed sensor. When no sensor can answer (for example a dry run
from sources before the first v2 install, or a rollback to v1), the installer checks only `memory.os_reserve_gb`, against the
engine's bound 2 – RAM−2 GiB. The line says which of these it did and why a value was rejected.

The envelopes it counts are the engine's too (SCHEMA §5, §6), rule for rule: an envelope larger
than 64 KiB is read up to 64 KiB and counted as `unverifiable` (it used to be skipped: a false
all-clear); `peak_gb` is read as `strtod` reads it, so `31.0`, `3.1e1`, ` 31` and `31.` are 31 GiB,
not "unreadable"; the first occurrence of a key wins, keys after `cmd` included; a zombie is dead;
and a registry the engine cannot read completely (more than 1024 envelopes or 4096 entries, an
envelope it cannot open, `jobs` not a readable directory) is reported as `UNREADABLE REGISTRY`,
because every admission then exits 75. `install_gate.sh` 0c checks each rule against the real
sensor's own reading of the same envelope.

**The cutover never shows a stop-time GREEN.** The hand-copied v1 governor's TERM trap publishes
GREEN "guardian stopped" (`heavy_jobs_ok: true`, a fresh epoch). So a running governor that is not
positively a v2 one is not TERMed: its identity is proven (launchd's pid, argv, start time), it is
SIGSTOPped and re-verified, its whole process tree is frozen, UNKNOWN is published into
`state.json`, the Law-7 `status.json` and a fresh `state`, the tree is SIGKILLed (no trap runs), and
only then is the label booted out. A launchd KeepAlive respawn in that instant finds a governed
domain and refuses. The same holds for `rollback` and `uninstall`. A v2 governor is booted out
normally: its own TERM trap publishes UNKNOWN. Rolling back *to* v1 still lets v1 publish GREEN
"armed" when it starts, without evidence. That is v1's behaviour, not the installer's.

**It waits for evidence, not just a process.** After the bootstrap verifies (launchd pid = the
plist's program = the lock holder, `state` republished; `FORGE_GUARDIAN_VERIFY_S`, default 40),
`install` waits up to `FORGE_GUARDIAN_EVIDENCE_S` (default **120**) for `state.json` to say
`evidence_complete: true` with a state other than UNKNOWN. A healthy install therefore takes about
`deescalate_polls × poll_s` (6 × 5 s ≈ **30 s**) longer than the restart itself. A new governor
earns GREEN, it does not assume it.

| exit | meaning |
|---|---|
| 0 | done (installed and evidenced, rolled back, uninstalled, or already installed) |
| 1 | failed; a failed install/rollback is rolled back to the state before the run (including when the new service stops running or publishing while its evidence is awaited) |
| 2 | usage, or refused (e.g. the real launchctl for a home that is not this user's; `--dry-run` with anything but install) |
| 3 | another `forge-guardian-install` holds the install lock |
| **4** | **installed and LEFT RUNNING, but its evidence did not become complete** within `FORGE_GUARDIAN_EVIDENCE_S`; the message names what is missing. Not rolled back: the v1 it would return to reported health it never measured. The new governor keeps heavy admission closed and says why (`forge-guardian-ctl status`, `diagnose`) |
| 70 | internal error |

**Installer restarts count toward the restart-loop breaker** (decision, 2026-10-09). The governor
backs off (UNKNOWN, gates closed, no sensor, 300 s) after 5 starts within 900 s
(`guardian_restart_loop`). Every start counts, deliberate ones included: install, upgrade,
rollback, the rollback inside a failed install, `forge-guardian-ctl restart`. The breaker exists
to stop a loop, and from the governor's side an install loop looks the same as a crash loop.
So an install whose restart is the governor's fifth start within 15 minutes exits 4 with
"evidence is incomplete: restart_loop": the new governor runs, keeps the gates closed for the
300 s backoff and then governs normally on its own. Wait it out, or (deliberately, as the gates
do) remove `~/.forge-health/guardian.starts` before installing.

**Process identity across time zones.** A v2 governor's `guardian.lock/pstart` holds its start in
epoch seconds; the installer, the soak, the sensor, `forge-gate`, `forge-nproc` and
`forge-guardian-ctl` compare that number (±1 s), never the local-time `lstart` text, so a caller
with another `TZ` still recognises a live governor. A
`pstart` that is present but not an epoch identifies nobody. Only a lock without `pstart` (v1's)
is compared by its `started` text.

**Soak.** `soak/forge-guardian-soak start|status|stop` records its own process as
`<pid> TAB <lstart> TAB <start epoch>`. `stop` signals only that verified process. If it refuses
(the recorded pid is not running, is not this soak, or started at another time), it says
`not signalling` and exits **1**. It also exits 1 if the soak is still running 10 s after TERM.

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

**4. Admission is a reservation, not a look.** `admit` decides under one lock: the reservations of
every live envelope — identity verified or unverifiable (an unverifiable job is never signalled, but
its memory is not free), each the max of declared and measured peak — plus the new job must fit
`RAM − os_reserve`, and
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
state forks only its poll sleep. Logs, history, events, incidents and the release ledgers
(`reservations.history.jsonl`, `crashes/`) share a 64 MiB cap (`logs.cap_mib`, SCHEMA §2) with
rotation. Housekeeping never deletes live files, crash ledgers, `events/` or
`incidents/.ratelimit/`; when those alone exceed the cap, the newest incident and each `.1`
generation are kept too, so the total can stay above the cap (logged once; SCHEMA §2). A full
disk never truncates a published file. Each one is written to a temporary file beside it and
renamed over the old one; a failed write is never renamed, so the old file stays and goes stale,
which closes the gates. Only the sensor also flushes the data before the rename
(`F_FULLFSYNC`, else `fsync`). The governor's and the installer's publications are not fsynced: a
power loss can lose or truncate their latest write, which readers then treat as missing or
unparseable, and fail closed (rule 3). A failed append is cut back off, so no record is ever glued
to a fragment (SCHEMA §7.2).

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
| `test/forge_job_admission_gate.sh` | forge-job exit mapping, crash release, legacy path; the resilience harness's forge-job dimensions ported to zsh (D1 cooperative shed here, D3 is `forge_job_usage_gate.sh`) |
| `test/install_gate.sh` | install/upgrade/rollback/uninstall, plist escaping, no stop-time GREEN at any v1 cutover (sampled ≤ 10 ms, KeepAlive respawn modelled), reservation preflight against the engine's budget (`os_reserve` as a real sensor evaluates `policy.json`) and over the envelopes the engine counts (56 single-envelope cases, preflight vs the sensor's `snapshot`), lock identity across time zones, real home untouched |
| `test/guardian_single_instance_gate.sh` | one governor per domain, fail-open on a stale lock, 11 mutations |
| `test/forge_job_usr1_gate.sh`, `test/forge_job_usage_gate.sh` | USR1 is cooperative; `--help` costs no gate slot |
| `forge-guardian-actuator-test`, `forge-guardian-selftest` | shed targeting; classifier vectors (library mode) |
| `forge-kernel/test/resilience_harness.mjs` | scored family benchmark + 4 reintroduced production defects (JS: no Guardian gate runs it by default; `FJ_RUN_JS_HARNESS=1` opts in) |

Test hooks (never set in production). Governor: `FORGE_GUARDIAN_SENSOR=0`,
`FORGE_GUARDIAN_SENSOR_BIN`, `FORGE_GUARDIAN_POLL`, `FORGE_GUARDIAN_SMART_S` (the SMART interval;
policy `smart_interval_s` is ≥ 600 s), `FORGE_GUARDIAN_SETTLE`, `FORGE_GUARDIAN_TERM_GRACE`,
`FORGE_GUARDIAN_UNKNOWN_NOTIFY_S` (how long UNKNOWN lasts before it is notified, default 120),
`FORGE_GUARDIAN_NOTIFY_CMD`, `FORGE_GUARDIAN_NOTIFY=1` (an unsupervised governor uses the desktop
notifier), `FORGE_GUARDIAN_DISKUTIL`, and `FORGE_GUARDIAN_LIB=1` (sourcing defines the functions
and returns: the selftest, the actuator test and several gates run it as a library). Installer and ctl:
`FORGE_GUARDIAN_HOME`, `FORGE_GUARDIAN_LAUNCHCTL`, `FORGE_GUARDIAN_SENSOR_PREBUILT`,
`FORGE_GUARDIAN_INSTALL_TESTS` and `FORGE_GUARDIAN_TEST_TIMEOUT` (`--run-tests`). Sensor: the
`FORGE_SENSOR_TEST=1` injection family.

## Known limits

- Real memory-pressure, sleep/wake and thermal transitions are exercised through the same handlers
  by test injection; inducing them for real (`memory_pressure -S`, heating the machine) is not done.
- Reservations are estimates; macOS has no hard per-process memory ceiling here. Jobs must still
  bound their own allocations and handle allocation failure.
- GPU faults are seen only through DiagnosticReports, watched logs and the local event inbox; the
  Forge renderer's Vulkan device-loss reporting into that inbox is T-179.
- Folders protected by macOS privacy (TCC) are not scanned; that evidence is reported as unavailable.
