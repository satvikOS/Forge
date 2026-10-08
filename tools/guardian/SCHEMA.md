# Forge Guardian — interfaces, files and schemas

The contract every Guardian producer and consumer shares: the shell governor
(`forge-guardian`), the native sensor (`forge-guardian-sensor`), the wrappers
(`forge-job`, `forge-gate`, `forge-nproc`, `forge-guardian-ctl`), the Models fleet
(`archdisc-Models/scripts/forge_law7.py` and the `/tmp/archie_health` readers) and the
in-app reader (`forge_ui` `GuardianStatus`). Change a field here first, then every
producer and consumer named here, in one change.

Compatibility rule: **additive only.** A v1 consumer must keep working against a v2
producer. Never rename or retype an existing key; never repurpose a value. When a
value is unavailable, publish the explicit unavailable form defined below — never a
default that reads as healthy.

## 1. One authority per decision

| Decision | Authority | Everyone else |
|---|---|---|
| Machine pressure state | `forge-guardian` (shell governor), one per health domain | reads `state` / `state.json` |
| Sampled observables | `forge-guardian-sensor run`, a child of the governor | governor falls back to its own sampling only while the sensor is down, and then marks the signals it cannot sample `unavailable` |
| Admission + reservations | `forge-guardian-sensor admit`, serialized under `admission.lock` | `forge-job` calls it; `forge-gate` is the state-only check for callers that do not reserve |
| Crash-loop quarantine | `forge-guardian-sensor release` (records) / `admit` (refuses) | `forge-guardian-ctl quarantine` lists and clears |
| Load shedding (signals) | `forge-guardian` only | nothing else signals registered jobs, except a job's own wrapper forwarding to its child |

A health domain is one `FORGE_HEALTH_DIR` (default `~/.forge-health`). Two domains share
nothing and never block each other.

## 2. Files in a health domain

All created with `umask 077` (dirs 0700, files 0600). The domain directory itself is
0700. Every published file is written to `<name>.tmp.<pid>` and `rename(2)`d into place;
a failed or short write is never renamed (the previous good file stays, and goes stale).

| Path | Writer | Purpose |
|---|---|---|
| `state` | governor | one word: `GREEN` `YELLOW` `ORANGE` `RED` `UNKNOWN`. Its **mtime** is the liveness signal (`forge-gate`, single-instance guard). Back-dated to 1970 on orderly stop. |
| `state.json` | governor | §4 |
| `sensor.env`, `sensor.json` | sensor | §3. Same snapshot, two encodings: `.env` for zsh (no fork to parse), `.json` for everything else. |
| `policy.json` | user / installer | §6. Installed from `policy.default.json` if absent; never overwritten by an upgrade. |
| `policy.env` | sensor | flattened effective policy (§6), rewritten when `policy.json` changes. |
| `jobs/<pid>.job` | `forge-guardian-sensor admit`, `forge-job` (legacy path), `forge_law7.gpu_envelope` | envelopes, §5 |
| `admission.lock` | admit | `fcntl` lock serializing every admission decision (zsh `zsystem flock` and Python `fcntl.lockf` interoperate with it) |
| `guardian.lock/` | governor | single-instance lock dir (`pid`, `started`) |
| `sensor.lock` | sensor | `fcntl` single-instance lock for the sensor |
| `history.jsonl` (+`.1`…) | governor | one compact line per poll (§4.3), rotated, `logs.history_mib` total |
| `events.jsonl` (+`.1`…) | sensor, governor | discrete events (§7), rotated |
| `events/inbox/*.jsonl` | any local producer (Forge app, workers) | events to ingest; the sensor moves processed files to `events/done/` and deletes them after ingest |
| `session/current.json`, `session/previous.json`, `session/boots.jsonl` | sensor | §8 |
| `crashes/<sig>.jsonl` | release | crash ledger per job signature |
| `quarantine/<sig>.json` | release / ctl | §9 |
| `reservations.history.jsonl` | release | declared vs measured peak per finished job |
| `incidents/<UTC>-<kind>/` | sensor `incident` | §10 |
| `log/guardian.log`, `log/guardian.out`, `log/sensor.log`, `log/launchd.out`, `log/launchd.err` | governor, sensor, launchd | rotated at `logs.rotate_mib`, `logs.generations` kept |
| `bin/<tool>` | installer | symlinks into the installed release |

The aggregate of `log/`, `history.jsonl*`, `events.jsonl*`, `events/` and `incidents/`
is held under `logs.cap_mib` (default 64 MiB) by the governor's housekeeping, oldest
first, and incidents older than `logs.retention_days` are removed.

## 3. Sensor snapshot — `sensor.env` / `sensor.json`

Schema id `forge.guardian.sensor/1`. Every signal carries a status:

| status | meaning |
|---|---|
| `ok` | sampled this tick, value parsed and in range |
| `unavailable` | the platform/API does not provide it here, or the call failed |
| `stale` | last good value is older than `sensor_stale_polls × poll_s` (only for derived/infrequent signals) |
| `invalid` | sampled but malformed / out of range (e.g. negative, NaN, total < used) |

A value whose status is not `ok` is published as `-1` (numbers) or `none` (words) in
`.env`, and `null` in `.json`. **Consumers must test the status, never the value.**

### 3.1 `sensor.env` keys (KEY=VALUE, one per line, no quoting, no spaces in values)

```
schema=forge.guardian.sensor/1
version=<sensor version>
pid=<sensor pid>
seq=<monotonic counter, +1 per snapshot>
ts=<epoch seconds, float>            ts_s=<epoch seconds, int>
mono_ms=<mach_continuous_time in ms>  (does not jump with the wall clock; counts sleep)
boot_uuid=<kern.bootsessionuuid>      boot_epoch=<kern.boottime seconds>
rebaseline=0|1                        (1 on the first snapshot after start and after wake: rates are not deltas)
poll_s=<int>

vmp=1|2|4                 vmp_st=…    kern.memorystatus_vm_pressure_level
pevent=normal|warn|critical|none      pevent_st=…   last DISPATCH_SOURCE_TYPE_MEMORYPRESSURE event
pevent_ts=<epoch s>  pevent_warn_n=<int>  pevent_crit_n=<int>      (counts since sensor start)
freepct=<0..100>          freepct_st=…  kern.memorystatus_level
mem_total_b=…  mem_avail_b=…  mem_free_b=…  mem_wired_b=…  mem_compressed_b=…  mem_st=…
                          mem_avail_b = (free + inactive + speculative + purgeable) pages × page size
swap_used_mb=<int>  swap_total_mb=<int>  swap_growth_mb_min=<float>  swap_st=…
pageouts_total=<int>  pageout_rate_ps=<float pages/s>  swapout_rate_ps=<float>  pageouts_st=…
thermal=nominal|fair|serious|critical|none   thermal_st=…   NSProcessInfo.thermalState
load1=<float>  cpu_busy_pct=<int>  ncpu=<int>  nperf=<int>  cpu_st=…
vol_n=<K>
vol<i>_path=<configured path, ~ expanded>  vol<i>_mount=<f_mntonname>  vol<i>_fsid=<hex>
vol<i>_avail_b=<f_bavail×f_bsize>  vol<i>_total_b=…  vol<i>_growth_b_min=<float, negative = shrinking>  vol<i>_st=…
disk_min_avail_gib=<int, floor, over all volumes with st=ok>   disk_st=ok|unavailable (ok iff every configured volume is ok)
jobs_n=<J>
job<j>_pid=…  job<j>_name=…  job<j>_identity=ok|dead|mismatch|unverifiable
job<j>_fp_b=<process-tree phys_footprint>  job<j>_res_b=<process-tree resident>  job<j>_peak_fp_b=<max fp seen>
job<j>_reserved_b=<declared peak, bytes>  job<j>_hb_age_s=<-1 if no heartbeat declared>
reserved_b=<Σ reserved over identity-ok jobs>  budget_b=<mem_total_b − os_reserve>  overcommit=0|1
sleep_n=<int>  last_sleep_ts=<epoch|-1>  last_wake_ts=<epoch|-1>
self_cpu_s=<float>  self_rss_b=<int>  self_fds=<int>
errors=<sampling errors since start>
```

### 3.2 `sensor.json`

The same snapshot as an object: `{"schema", "version", "pid", "seq", "ts", "mono_ms",
"boot": {"uuid", "epoch"}, "rebaseline", "poll_s", "signals": {<name>: {"status", "value"|fields…, "unit"}},
"volumes": [...], "jobs": [...], "reservations": {...}, "power": {...}, "self": {...}, "errors": n}`.
Signal names: `vm_pressure`, `pressure_event`, `free_pct`, `memory`, `swap`, `pageouts`,
`thermal`, `cpu`, `disk` (aggregate over `volumes`).

### 3.3 Required evidence

`policy.required_signals` (default `vm_pressure swap pageouts disk thermal`) must all be
`ok` and the snapshot fresh (`ts` within `sensor_stale_polls × poll_s` of now, and not
more than 5 s in the future) for the governor to publish GREEN or YELLOW. Otherwise it
publishes `UNKNOWN` — unless the evidence it does have says ORANGE or RED, in which case
that state is published and acted on (missing evidence never hides real pressure).

## 4. Governor publication

### 4.1 `state.json` (schema `forge.guardian.state/2`; every v1 key retained)

v1 keys, unchanged: `state`, `reason`, `ts`, `epoch`, `build_jobs_max`, `spawn_agents_ok`,
`heavy_jobs_ok`, `observables{vm_pressure_level, free_pct, swap_used_mb, swap_total_mb,
pageout_rate_pages_per_poll, disk_avail_gb, loadavg, cpu_speed_limit_pct, registered_jobs}`,
`host{ram_gb, ncpu, nperf}`. An unavailable observable is `-1`.

v2 additions:

```
"schema": "forge.guardian.state/2",
"seq": <int>,
"evidence_complete": true|false,
"evidence": {"source": "sensor"|"fallback", "sensor_age_s": <int|-1>, "missing": ["thermal", ...]},
"critical_now": true|false,          // this poll saw a condition that bypasses hysteresis
"thermal_state": "nominal|fair|serious|critical|none",
"admission": {"heavy_open": bool, "reason": "..."},
"reservations": {"reserved_gb": x, "budget_gb": y, "overcommit": bool, "jobs": n},
"volumes": [{"mount": "...", "avail_gb": n, "floor_gb": n, "status": "ok|unavailable"}],
"disk_hardware": "Verified|Failing|Unsupported|UNKNOWN",
"guardian": {"pid": n, "version": "...", "started": <epoch>}
```

`heavy_jobs_ok` is true only when `state == GREEN` **and** `evidence_complete`.
`spawn_agents_ok` is true only for GREEN or YELLOW with complete evidence.

### 4.2 Law-7 `status.json` (`$ARCHIE_HEALTH_DIR`, default `/tmp/archie_health`)

v1 keys unchanged: `state`, `reason`, `swap_gib`, `halt`, `gpu_jobs`, `registered_jobs`,
`free_pct`, `pageout_rate`, `disk_avail_gb`, `producer`, `ts`, `iso`. Addition:
`evidence_complete`. The directory must be a real directory owned by the user (not a
symlink) or the governor refuses to write into it and logs why.

### 4.3 `history.jsonl` line

`{"t":<epoch>,"s":"GREEN","r":"nominal","vmp":1,"pe":"normal","fp":88,"sw":[used_mb,total_mb],"po":<rate/5s>,"th":"nominal","dk":<min avail gib>,"rs":[reserved_gb,budget_gb],"j":<jobs>,"ev":1}`

### 4.4 State semantics and transitions

| State | Means | Actuation |
|---|---|---|
| GREEN | complete, fresh evidence; nominal | none; heavy admission open |
| YELLOW | early pressure (pageouts starting, disk < yellow floor, thermal fair) | none; no speculative work; `-j nperf/2` |
| ORANGE | OS warning, real pageout traffic, disk < orange floor, thermal serious | SIGUSR1 to priority ≥ 7 |
| RED | OS critical, sustained thrash, disk < red floor, thermal critical | staged: USR1 all → TERM one restartable (settle + TERM grace) |
| UNKNOWN | no sustained evidence: starting, stopping, or a required signal missing/stale/invalid | none; heavy admission closed; `-j2` |

Hysteresis (`confirm_needed`): into UNKNOWN immediately; out of UNKNOWN to ORANGE/RED after
`escalate_polls`, to GREEN/YELLOW after `deescalate_polls`; GREEN→anything and
YELLOW→ORANGE/RED and ORANGE→RED after `escalate_polls`; everything else
`deescalate_polls`. **Bypass:** `vmp == 4`, a `critical` pressure event since the previous
poll, a required volume below the red floor, or a failed state publication moves to RED on
the poll that observes it. The sensor sends SIGUSR2 to the governor on every warn/critical
pressure event, so that poll happens at once rather than at the next tick.

## 5. Job envelopes — `jobs/<pid>.job`

KEY=VALUE lines; readers take the **first** occurrence of a key; `cmd` is written last
and may contain `=` and spaces. v1 keys (unchanged): `pid`, `name`, `priority` (0 critical
… 9 speculative), `can_restart` (0|1), `peak_gb` (decimal, may be fractional), `gpu` (0|1),
`started` (epoch s when the envelope was written), `cmd`.

v2 keys (all optional for readers; written by `admit`):

```
schema=2
pstart=<epoch seconds of the process start, proc_pidinfo pbi_start_tvsec>
boot=<kern.bootsessionuuid at registration>
sig=<job signature, 16 hex = sha256(name NUL argv joined by NUL)[:16]>
threads=<int, CPU threads the job may use>
disk_gb=<decimal>  disk_path=<abs path>  disk_fsid=<hex>  disk_avail0_b=<avail at admission>
heartbeat=<abs path whose mtime the job advances>  stall_s=<int>
admitted=<epoch>  admit_state=<state at admission>  owner=forge-job|forge_law7|forge-app
```

**Identity.** An envelope names a process, not a number. Before anything signals or counts
an envelope's pid it verifies, in order: the pid is alive; if `boot` is present it equals
the current boot uuid; if `pstart` is present it equals the process's start second (±1);
otherwise, if `started` is present, the process started no later than `started + 5`
(the envelope is written after its process starts, so a younger process is a reused pid);
otherwise the identity is `unverifiable`. Only `ok` identities are signalled or counted as
reservations. Dead and mismatched envelopes are reaped by the governor; unverifiable ones are
kept but never signalled.

## 6. Policy — `policy.json` → `policy.env`

`policy.default.json` in this directory is the schema by example (`forge.guardian.policy/1`).
The sensor flattens the effective policy (defaults overlaid by `policy.json`) into
`policy.env` with `_`-joined keys, lists space-joined:

```
poll_s=5  escalate_polls=2  deescalate_polls=6  sensor_stale_polls=3
required_signals=vm_pressure swap pageouts disk thermal
memory_os_reserve_gb=6  memory_instant_margin_gb=2  memory_enforce_instant_fit=1  memory_light_job_gb=0.5
disk_floors_gib_yellow=45  disk_floors_gib_orange=25  disk_floors_gib_red=12  disk_admission_floor=yellow
thermal_fair=YELLOW  thermal_serious=ORANGE  thermal_critical=RED
eviction_settle_s=180  eviction_term_grace_s=45
crash_loop_max_crashes=3  crash_loop_window_s=900  crash_loop_crash_signals=SEGV BUS ILL ABRT FPE TRAP SYS KILL
guardian_restart_loop_max_starts=5  guardian_restart_loop_window_s=900  guardian_restart_loop_backoff_s=300
logs_cap_mib=64  logs_rotate_mib=4  logs_generations=3  logs_history_mib=6  logs_incident_max_kib=512  logs_retention_days=30
notifications_enabled=1  notifications_min_interval_s=1800
reports_scan_interval_s=600  smart_interval_s=21600
```

Disk floors are absolute minimums. The effective floor of a volume is the policy floor plus
the outstanding disk reservations of live jobs on that volume (§9.2). Policy may raise a
floor; tools refuse a `policy.json` whose floors are not strictly ordered `red < orange <
yellow`, and fall back to the defaults with a logged error.

## 7. Events — `events.jsonl`

One JSON object per line: `{"ts": <epoch float>, "kind": "...", ...}`. Kinds:
`sensor_start`, `sensor_stop` (`orderly`: bool), `pressure` (`level`), `thermal` (`state`),
`will_sleep`, `did_wake` (`slept_s`), `report` (`category`, `file`, `mtime`, `bug_type`,
`summary`), `gpu_error` (`source`, `line`), `transition` (`from`, `to`, `reason`),
`shed` (`sig`, `pid`, `name`), `reap` (`pid`, `why`), `cancel_latency` (`pid`, `s`),
`stall` (`pid`, `name`, `age_s`), `quarantine` (`sig`, `name`, `crashes`), `incident`
(`dir`, `kind`), `publish_error` (`file`, `errno`), `policy_error`, `guardian_restart_loop`.

## 8. Session continuity — `session/`

`current.json`: `{"boot_uuid", "boot_epoch", "sensor_start", "last_heartbeat",
"last_heartbeat_mono_ms", "orderly_stop": bool, "orderly_stop_ts", "sleeps", "last_sleep_ts",
"last_wake_ts"}`, rewritten (fsync) at start, every 60 s, on sleep/wake, and on orderly stop.

At start the sensor moves the old `current.json` to `previous.json`, adds a
`classification` and appends it to `boots.jsonl`:

| Evidence | classification |
|---|---|
| same boot, `orderly_stop` | `service_restart` |
| same boot, no `orderly_stop` | `service_interrupted` (sensor killed or crashed; boot continued) |
| new boot, `orderly_stop` | `orderly_stop_then_reboot` (shutdown, restart or logout observed) |
| new boot, no `orderly_stop`, panic report dated in the gap | `kernel_panic` (report path recorded) |
| new boot, no `orderly_stop`, nothing explaining it | `unclean_unknown` — **never** asserted to be a panic, power loss or a green screen |

The gap (`boot_epoch − last_heartbeat`), any reports dated in it, and whether the last
record said the machine was asleep are recorded alongside, as evidence, not as a cause.

## 9. Admission, reservations, crash loops

### 9.1 `forge-guardian-sensor admit`

```
forge-guardian-sensor admit --state-dir D --pid PID --name N --peak-gb G
    [--priority P] [--restartable] [--gpu] [--threads T]
    [--disk-gb X --disk-path PATH] [--heartbeat FILE --stall-s S]
    [--need green|yellow|orange|red] [--sig SIG] [--cmd STR] [--owner forge-job]
    [--wait SECONDS] [--dry-run] [--json]
exit 0  admitted; the envelope jobs/PID.job is written (not with --dry-run)
exit 1  denied; reason on stderr (and in --json output)
exit 2  usage error
exit 75 the domain cannot decide (no state, stale state, clock skew, unreadable registry) — fail closed
exit 78 the job signature is quarantined
```

Under `admission.lock` (held only for the decision, never while waiting): quarantine check →
state freshness (`state` mtime and `state.json` epoch, ≤ 60 s old, ≥ −5 s) → state rank vs
`--need` (UNKNOWN ranks with RED) → identity-verified registry → memory fit → disk fit →
write the envelope atomically → release the lock. `--wait` retries every 5 s until the
deadline, re-taking the lock each time.

Memory fit (bytes; G = `--peak-gb`; jobs with G ≤ `memory_light_job_gb` skip both tests):

* **budget**: Σ reserved(identity-ok jobs) + G ≤ `mem_total_b − os_reserve_gb`, where a job's
  reservation is `max(peak_gb, measured peak footprint)` — a measurement can raise a
  reservation, never shrink it below the declaration.
* **instant** (when `memory_enforce_instant_fit`): G + Σ max(0, reserved_i − resident_i) +
  `instant_margin_gb` ≤ `mem_avail_b`. Resident, not footprint: a job whose pages are
  compressed or swapped out will need them back in RAM.

Disk fit, per volume (fsid of `--disk-path`): `avail − Σ outstanding(live jobs on it) − X ≥
floor(disk_admission_floor)`, where `outstanding_i = max(0, disk_gb_i − (disk_avail0_b_i −
avail_now))`, an estimate of what job i has not written yet.

CPU: `threads` is recorded and summed; `forge-nproc` subtracts the threads reserved by jobs
that are not its caller's ancestors. CPU oversubscription is not denied.

GPU: on Apple Silicon GPU memory is unified memory and is part of `peak_gb`; `--gpu` is the
Law-7 marker (one heavy GPU job at a time), not a separate pool.

### 9.2 `forge-guardian-sensor release`

`release --state-dir D --pid PID [--rc N] [--signal NAME] [--external-term]` removes
`jobs/PID.job` (only if its pid/pstart match), appends `{sig, name, declared_gb,
measured_peak_gb, wall_s, rc, signal}` to `reservations.history.jsonl`, and when the job
ended by one of `crash_loop_crash_signals` and the wrapper did not itself forward an external
TERM/INT, appends to `crashes/<sig>.jsonl`; `max_crashes` within `window_s` writes
`quarantine/<sig>.json` = `{sig, name, cmd, crashes: [...], since, incident}` and creates an
incident bundle. Exit 0, or 78 when this release created a quarantine.

### 9.3 Quarantine

`admit` refuses a quarantined `sig` with exit 78. Only `forge-guardian-ctl quarantine clear
SIG --reason TEXT` removes it (the reason, user and time are appended to
`quarantine/cleared.jsonl`). A changed command line is a different signature by construction.

## 10. Incidents — `incidents/<UTC>-<kind>/`

`forge-guardian-sensor incident --state-dir D --kind K [--note TEXT] [--job SIG]
[--window-min M] [--with-log]` writes, within `logs_incident_max_kib`:
`summary.json` (`ts`, `kind`, `note`, `boot`, `session` classification, copies of
`state.json` and `sensor.json`, envelopes, quarantines), `history.jsonl` (the last
`M` minutes), `events.jsonl` (same window), `reports.json` (DiagnosticReports in the window:
name, mtime, size, category, `bug_type`, and for Jetsam the largest process and the kill
reasons), and with `--with-log` a `unified_log.txt` excerpt (`log show` over the window,
predicate limited to kernel/WindowServer/GPU subsystems, 30 s timeout, 256 KiB cap).
Kinds: `manual`, `red`, `crash_loop`, `unclean_boot`, `report`, `gpu_error`.
Automatic kinds are rate-limited to one per kind per 10 min. Inaccessible evidence is
recorded as inaccessible, never requested with elevated privilege.

### Report categories (DiagnosticReports, user and system directories)

`panic` (`*.panic`, `panic-full-*`), `jetsam` (`JetsamEvent-*.ips`), `gpu` (names containing
`GPU`/`gpuRestart`/`AGX`), `windowserver` (`WindowServer*`), `shutdown_stall`
(`*.shutdownStall`), `app_crash` (`*.ips`/`*.crash` of Forge, forge-*, Python, MLX workers),
`resource` (`*.diag`: cpu_resource, disk writes), `other`. A Jetsam report whose kills are all
`per-process-limit` is a per-process limit, not system-wide memory exhaustion; the category
summary says which.

## 11. Exit codes

`0` ok · `1` denied/failed check · `2` usage · `3` refused duplicate instance ·
`70` internal error · `75` cannot decide, fail closed (EX_TEMPFAIL) · `78` quarantined (EX_CONFIG).
