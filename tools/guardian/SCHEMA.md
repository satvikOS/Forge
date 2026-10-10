# Forge Guardian — interfaces, files and schemas

The contract every Guardian producer and consumer shares: the shell governor
(`forge-guardian`), the native sensor (`forge-guardian-sensor`), the wrappers
(`forge-job`, `forge-gate`, `forge-nproc`, `forge-guardian-ctl`), the installer
(`forge-guardian-install`), the soak (`soak/forge-guardian-soak`), the Models fleet
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
| Machine pressure state | `forge-guardian` (shell governor), one per health domain | reads `state` / `state.json`; the installer publishes UNKNOWN only while no governor runs (§4.5) |
| Sampled observables | `forge-guardian-sensor run`, a child of the governor | governor falls back to its own sampling only while the sensor is down, and then marks the signals it cannot sample `unavailable` |
| Admission + reservations | `forge-guardian-sensor admit`, serialized under `admission.lock` | `forge-job` calls it; `forge-gate` is the state-only check for callers that do not reserve |
| Crash-loop quarantine | `forge-guardian-sensor release` (records) / `admit` (refuses) | `forge-guardian-ctl quarantine` lists and clears |
| Load shedding (signals) | `forge-guardian` only | nothing else signals registered jobs, except a job's own wrapper forwarding to its child |
| Governor lifecycle (start, stop, cutover) | launchd, driven by `forge-guardian-install` and `forge-guardian-ctl` | the installer signals only a governor it has verified (the old one at a cutover, §4.5); ctl signals only a verified unsupervised governor (§2.1); neither ever signals a job |

A health domain is one `FORGE_HEALTH_DIR` (default `~/.forge-health`). Two domains share
nothing and never block each other.

## 2. Files in a health domain

All created with `umask 077` (dirs 0700, files 0600). The domain directory itself is
0700. Every published file is written to a temporary file beside it that no reader's
glob matches — `<name>.tmp.<pid>` for the governor, the sensor and the installer's
UNKNOWN publication — and `rename(2)`d into place; a failed or short write is never
renamed (the previous good file stays, and goes stale). Every JSONL file and log is
appended one whole record per line, or not at all (§7.2).

| Path | Writer | Purpose |
|---|---|---|
| `state` | governor; installer (§4.5) | one word: `GREEN` `YELLOW` `ORANGE` `RED` `UNKNOWN`. Its **mtime** is the liveness signal (`forge-gate`, single-instance guard). Back-dated to 1970-01-02 on orderly stop, and by the installer once no governor runs. |
| `state.json` | governor; installer (UNKNOWN only, §4.5) | §4 |
| `sensor.env`, `sensor.json` | sensor | §3. Same snapshot, two encodings: `.env` for zsh (no fork to parse), `.json` for everything else. |
| `policy.json` | user / installer | §6. Installed from `policy.default.json` if absent; never overwritten by an upgrade. |
| `policy.env` | sensor | flattened effective policy (§6), rewritten when `policy.json` changes. |
| `jobs/<pid>.job` | `forge-guardian-sensor admit`, `forge-job` (legacy path), `forge_law7.gpu_envelope` | envelopes, §5; registry limits, §6 |
| `admission.lock` | admit, release, quarantine-clear | `fcntl` lock serializing every admission decision and every registry or ledger change the sensor makes (zsh `zsystem flock` and Python `fcntl.lockf` interoperate with it); taking it waits at most 30 s |
| `guardian.lock/` | governor | single-instance lock dir: `pid`, `pstart`, `started` (§2.1) |
| `guardian.pid` | `forge-guardian-ctl start` (unsupervised only) | `<pid>TAB<lstart>` of a governor ctl started itself (§2.1) |
| `sensor.lock` | sensor | `fcntl` single-instance lock for the sensor; holds its pid as text (the lock, not the text, is authoritative) |
| `history.jsonl` (+`.1`…) | governor | one compact line per poll (§4.3), rotated at `logs.history_mib / (logs.generations + 1)` per file |
| `events.jsonl` (+`.1`…) | sensor, governor | discrete events (§7), rotated at `logs.rotate_mib` by the sensor (by the governor only while no fresh sensor snapshot exists) |
| `events/inbox/*.jsonl` | any local producer (Forge app, workers) | events to ingest (§7.1): kind `gpu_error`, `stall` or `cancel_latency` only; the sensor copies valid lines into `events.jsonl` with `source` = the inbox file name, then deletes the file |
| `session/current.json`, `session/previous.json`, `session/boots.jsonl` | sensor | §8 |
| `session/report_watermark`, `session/report_seen`, `session/reports_baseline.json` | sensor | DiagnosticReports scan state (§10): the scan watermark (epoch); the keys `<floor(mtime)> <name>` of reports already emitted or baselined (newest 5000, pruned below the rescan window); the first scan's 30-day summary |
| `session/watch_offsets.json` | sensor | read offsets (`ino`, `dev`, `off`) of the policy's `watch_logs` files |
| `crashes/<sig>.jsonl` (+`.1`) | release | crash ledger per job signature (§9.2); rotated at 1 MiB, one generation kept |
| `quarantine/<sig>.json`, `quarantine/cleared.jsonl` | release / quarantine-clear (through ctl) | §9.3 |
| `reservations.history.jsonl` (+`.1`) | release | declared vs measured peak per finished job (§9.2); rotated at 1 MiB, one generation kept |
| `incidents/<UTC>-<kind>/`, `incidents/.ratelimit/<key>` | sensor `incident` | §10; `.ratelimit/<key>` holds the epoch of the last automatic bundle for that rate key |
| `log/guardian.log`, `log/guardian.out`, `log/sensor.log`, `log/launchd.out`, `log/launchd.err` | governor, sensor, launchd | rotated at `logs.rotate_mib`, `logs.generations` kept; the two launchd files are truncated in place (launchd holds them open) |
| `bin/<tool>` | installer | symlinks into the installed release |
| `guardian.starts` | governor | start epochs for the restart-loop breaker (§4.4; ≤ 32 lines) |
| `notify/<kind>` | governor | per-kind notification rate-limit stamps |
| `smart.out` | governor | output of the background SMART probe |
| `guardian.installed.json` | installer | `{schema "forge.guardian.installed/1", version, release, installed_at, source_commit, plist_sha256, previous}` — distinct from `installed.json`, which belongs to the Forge.app installer |
| `soak/<UTC>/` | `forge-guardian-soak` | bounded soak: `config.json`, `samples.jsonl`, `status.json`, `summary.json`, and `pid` (§2.1) |

Each release under `~/Library/Application Support/ForgeGuardian/releases/<version>/` carries
`MANIFEST.json` = `{schema "forge.guardian.manifest/1", version, source_commit, built_at,
version_basis, files {path: sha256}}`. The version is `2.0.0+<12 hex>` over the sorted
`path sha256` lines; the sensor binary is not byte-reproducible (its ad-hoc signature embeds a
build-time identifier), so its SOURCES are hashed instead (`version_basis: "sources"`).

The sensor binary is located, by every tool, in this order: `$FORGE_GUARDIAN_SENSOR_BIN`
(explicit; if set but not executable, admission fails closed), then the tool's own resolved
directory (`${0:A:h}`), then `$STATE_DIR/bin`.

The evidence aggregate — `log/`, `history.jsonl*`, `events.jsonl*`, `events/`, `incidents/`
(its `.ratelimit/` included), `reservations.history.jsonl*` and `crashes/` — is held under
`logs.cap_mib` (default 64 MiB) by the governor's housekeeping, at its first poll and then
every 10 min: incident directories older than `logs.retention_days` are removed; rotated
generations numbered above `logs.generations` are removed; while the total is still over the
cap, the oldest rotated files (`log/*.N`, `history.jsonl.N`, `events.jsonl.N`,
`reservations.history.jsonl.N`) and then the oldest incident directories go. Live files are
never deleted, and nothing outside these names is touched. Crash ledgers (`crashes/<sig>.jsonl`
and its `.1`) are counted but never pruned by housekeeping: they are the evidence `release`
counts for a quarantine, and `release` bounds them itself (1 MiB rotation with one generation;
a ledger untouched for `logs.retention_days` whose signature is not quarantined is deleted under
`admission.lock`). Sometimes what housekeeping never deletes (live files, crash ledgers,
`events/`, `incidents/.ratelimit/`) is over the cap by itself, and no pruning can reach the cap.
Then the newest incident directory and the `.1` generation of each rotated file are KEPT, and
only older ones are pruned. Pruning to no effect would otherwise destroy the freshest evidence
(review 2026-10-08 round 2, R13 regression). What remains is then bounded by that floor plus one
incident plus one rotation of each log. When the total is still over the cap after pruning, that
is logged once (R13: the ledgers used to be outside the sum).

### 2.1 Process identity files: `guardian.lock/`, `guardian.pid`, `soak/<UTC>/pid`

A pid alone names nothing: pids are reused. Each of these files records which PROCESS it names,
and every reader verifies that before it trusts or signals anything.

**`guardian.lock/`** is created with `mkdir(2)` by the governor that wins the domain and removed
by it when it exits (a SIGKILLed governor leaves it behind, naming a dead or reused pid). It holds
three files, written in this order:

| file | content |
|---|---|
| `pid` | the governor's pid, canonical decimal (§5) |
| `pstart` | the governor's process start in **epoch seconds** (a positive integer of at most 12 digits): `proc_pidinfo` `pbi_start_tvsec` through `forge-guardian-sensor pidinfo`, else `ps -o lstart=` printed with `TZ=UTC` in the C locale and parsed back in UTC. Absent only when neither could be read. |
| `started` | `LC_ALL=C ps -o lstart=` text (`Thu Oct  8 19:39:53 2026`) — the **local time of the writer**. Legacy: kept for v1 readers and published as `guardian_started`. |

**Who is the governor.** A reader treats the lock holder as the live governor of the domain
only when all of these hold. Every reader applies the same rule: the sensor's `governor_check`
(used by `admit` and by `pidinfo --state-dir` for ancestor protection), `forge-gate`,
`forge-nproc`, `forge-guardian-ctl`, `forge-guardian-install` and `forge-guardian-soak`.

1. `pid` is canonical and that process is alive.
2. When `pstart` exists, it is a regular file (not a symlink) holding a positive integer of at
   most 12 digits, and the process's start in epoch seconds is within **±1 s** of it. The
   comparison is numeric, so it means the same in every time zone and locale (review 2026-10-08
   round 2, FO-4 regression: comparing the local-time text made `TZ=UTC admit`, and every
   admission after a system time-zone change, refuse a live governor). A `pstart` that is
   present but unreadable, a symlink, empty or not an epoch identifies nobody, and the reader
   never falls back to `started`.
3. Only when `pstart` is absent (a v1 governor's lock) is `started` compared: as text, whitespace
   runs collapsed, against the process's `lstart` formatted in the reader's own time zone (in the
   C locale; the sensor, ctl and the soak also accept the reader's locale). That matches only a
   reader in the writer's zone; it is kept so that admission keeps working across an install
   from v1.
4. The process's argv ends in `forge-guardian` (the basename of its last argv word).

A reader for which any step fails acts as if no governor runs: `admit` exits 75, `forge-gate`
denies (1), `forge-nproc` prints 2, `forge-guardian-ctl status` reports no identifiable governor
and ctl never signals it, and the installer and the soak treat the lock as not held.

The governor's own acquisition is fail-open by design (a wrongly refused start leaves the domain
ungoverned while launchd respawns it). An existing lock is stale, and is reclaimed, when its
`pstart` is an epoch that the holder no longer matches (±1 s) or, without a usable `pstart`,
when `started` differs from the holder's C-locale `lstart`. The new governor refuses to start
(exit 3) only when the holder is a live `forge-guardian`, or when `state` is fresh (mtime within
three polls, at least 3 s: the upgrade window, in which a governor that holds no lock is still
publishing).

**`guardian.pid`** is written only by `forge-guardian-ctl start` for an UNSUPERVISED governor:
`<pid>TAB<lstart>`, the `LC_ALL=C ps -o lstart=` text with whitespace collapsed (local time of the
writer). ctl trusts it only for a verified governor: canonical, alive, argv ending in
`forge-guardian`, and started when recorded. The start is compared as an epoch (±1 s) when a third
TAB field holds one, or when the pid is the `guardian.lock` holder and the lock has `pstart`;
otherwise the `lstart` text is compared in the reader's locale or C. A bare pid (the old format)
is never verified. `start`, `stop` and `restart` remove a pid file that does not verify (and never
signal it), and remove it whenever launchd supervises the domain.

**`soak/<UTC>/pid`** is `<pid>TAB<lstart>TAB<start epoch>` of the soak process itself.
`soak/<UTC>/status.json` carries the same three as `pid`, `pid_started` and `pid_pstart` (0 when
unknown), beside `status`, `reason`, `ts`, `deadline`, `samples`, `probes_ok` and `probes_bad`.
`stop` signals only a recorded process that is canonical, alive, runs `forge-guardian-soak start`
and started at the recorded epoch (±1 s; a file without the epoch is compared by its `lstart`
text).

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

`forge-guardian-sensor run --state-dir D [--poll S] [--parent PID] [--policy FILE]` publishes both
files every poll (`--poll` 1–60; exit 3 while another sensor holds `sensor.lock`). With `--parent`
it stops when that process exits and sends it SIGUSR2 on every warn/critical pressure event (only
while that pid is still the process it was when the sensor started); TERM/INT stop it in order,
HUP reloads the policy. `forge-guardian-sensor snapshot [--state-dir D] [--policy FILE]` prints
one `sensor.json` object on stdout and publishes nothing (no pressure-event source:
`pressure_event` is `unavailable` there).

### 3.1 `sensor.env` keys (KEY=VALUE, one per line, no quoting, no spaces in values)

Words that could contain a space or a shell metacharacter (names, paths, mounts) are
percent-encoded (`%20` for a space; `none` for an empty word).

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
                          before the first event: pevent=normal, pevent_st=ok, pevent_ts=-1 while the
                          dispatch source is armed; `unavailable` in a one-shot snapshot (no source)
freepct=<0..100>          freepct_st=…  kern.memorystatus_level
mem_total_b=…  mem_avail_b=…  mem_free_b=…  mem_wired_b=…  mem_compressed_b=…  mem_st=…
                          mem_avail_b = ((free_count − speculative_count) + inactive + speculative + purgeable)
                          pages × page size. host_statistics64's free_count already contains the
                          speculative pages (vm_stat's "Pages free" is free_count − speculative_count),
                          so the plain sum would count them twice.
swap_used_mb=<int>  swap_total_mb=<int>  swap_growth_mb_min=<float>  swap_st=…
pageouts_total=<int>  pageout_rate_ps=<float pages/s>  swapout_rate_ps=<float>  pageouts_st=…
thermal=nominal|fair|serious|critical|none   thermal_st=…   NSProcessInfo.thermalState
load1=<float>  cpu_busy_pct=<int>  ncpu=<int>  nperf=<int>  cpu_st=…
vol_n=<K>
vol<i>_path=<configured path, ~ expanded>  vol<i>_mount=<f_mntonname>  vol<i>_fsid=<hex>
vol<i>_avail_b=<f_bavail×f_bsize>  vol<i>_total_b=…  vol<i>_growth_b_min=<float, negative = shrinking>  vol<i>_st=…
disk_min_avail_gib=<int, floor, over all volumes with st=ok>   disk_st=ok|unavailable (ok iff every configured volume is ok)
jobs_n=<J>                (every regular *.job read, whatever its identity)
job<j>_pid=<the envelope's pid=, or its file stem while the key is absent>
                          (-1 when not canonical, §5: identity dead, never counted)
job<j>_name=…  job<j>_identity=ok|dead|mismatch|unverifiable
job<j>_fp_b=<process-tree phys_footprint>  job<j>_res_b=<process-tree resident>  job<j>_peak_fp_b=<max fp seen>
                          (-1 when not measured: a job that is not live)
job<j>_reserved_b=<the reservation: max(declared peak, measured peak footprint), bytes>
job<j>_declared_b=<declared peak_gb, bytes>  job<j>_sig=<job signature>  job<j>_hb_age_s=<-1 if no heartbeat>
job<j>_file=<the envelope's file name>    WHICH envelope this verdict is about: two envelopes can name
                          one pid (a reused pid's stale file beside the live job's), so a verdict is
                          matched by file, never by pid alone (§5)
jobs_st=ok|unavailable    (unavailable: the registry could not be read completely, §6)
reserved_b=<Σ job<j>_reserved_b over LIVE jobs — identity ok or unverifiable (§5); -1 when jobs_st is
                          unavailable or a live envelope's peak_gb is unreadable: never a smaller total>
budget_b=<mem_total_b − os_reserve; -1 when mem_st is not ok>
overcommit=0|1|-1         (reserved_b > budget_b; -1 when either side is -1, never a 0 that reads as "fits")
inbox_ingested=<lines since start>  inbox_invalid=<lines since start>   (injected=… only in test mode)
sleep_n=<int>  last_sleep_ts=<epoch|-1>  last_wake_ts=<epoch|-1>
self_cpu_s=<float>  self_rss_b=<int>  self_fds=<int>
errors=<sampling errors since start>
```

### 3.2 `sensor.json`

The same snapshot as an object: `{"schema", "version", "pid", "seq", "ts", "ts_s", "mono_ms",
"boot": {"uuid", "epoch"}, "rebaseline", "poll_s", "signals": {<name>: {"status", "value"|fields…, "unit"}},
"volumes": [...], "jobs": [...], "reservations": {...}, "power": {...}, "self": {...}, "errors": n}`.
Signal names: `vm_pressure`, `pressure_event`, `free_pct`, `memory`, `swap`, `pageouts`,
`thermal`, `cpu`, `disk` (aggregate over `volumes`).

Each `jobs[]` entry: `{"pid", "name", "identity", "sig", "pstart" (the process's start, or null),
"priority", "can_restart", "gpu", "peak_gb", "fp_b", "res_b", "peak_fp_b", "declared_b",
"reserved_b", "hb_age_s", "threads", "disk_gb", "file"}` (null where not measured or not
declared), plus `"peak_readable": false` only when the envelope's `peak_gb` did not parse and
`"oversize": true` only when the envelope is larger than 64 KiB (kept as unverifiable, §6).

`"reservations"`: `{"status": "ok|unavailable" (= jobs_st), "reserved_b": n|null, "budget_b": n|null,
"overcommit": true|false|null, "jobs": n}` — `reserved_b`, `budget_b` and `overcommit` are null
exactly when §3.1 publishes -1.

### 3.3 Required evidence

A domain with NO sensor configured (`FORGE_GUARDIAN_SENSOR=0`, or no binary found) may publish
GREEN from complete fallback evidence. A domain WITH a sensor configured treats a snapshot that is
not fresh as missing evidence even when fallback sampling could see everything — the sensor is
part of the required evidence there.

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
`host{ram_gb, ncpu, nperf}`. An unavailable observable is `-1` (`loadavg` is a string: `"-1"`).
`registered_jobs` is -1 when the registry is unavailable (§6). `cpu_speed_limit_pct` is published
only when pmset MEASURED a CPU_Speed_Limit; the sensor's thermal word is never turned into a
percentage here.

v2 additions (`observables.pageout_rate_pages_per_poll` keeps its v1 name but is normalised to
pages per **5 s** regardless of the poll interval, so its thresholds mean the same at any POLL):

```
"schema": "forge.guardian.state/2",
"seq": <int>,
"evidence_complete": true|false,
"evidence": {"source": "sensor"|"fallback", "sensor_age_s": <int|-1>, "missing": ["thermal", ...]},
            // -1 = no snapshot; a snapshot more than 5 s in the future is missing evidence.
            // `missing` may also name the pseudo-signals `sensor` (a sensor is configured but its
            // snapshot is not fresh), `restart_loop` (breaker backoff, §4.4) and `guardian` (no
            // governor is running: published by a governor that exits unexpectedly, §4.4, and by
            // the installer, §4.5); consumers must treat ANY entry they do not recognise as
            // missing evidence.
"critical_now": true|false,          // this poll saw a condition that bypasses hysteresis
"thermal_state": "nominal|fair|serious|critical|none",
"admission": {"heavy_open": bool, "reason": "..."},
"reservations": {"reserved_gb": x|-1, "budget_gb": y|-1, "overcommit": true|false|null, "jobs": n|-1,
                 "status": "ok|unavailable"},
"jobs_st": "ok|unavailable",         // the registry (§6); = reservations.status
"volumes": [{"mount": "...", "avail_gb": n, "floor_gb": n, "status": "ok|unavailable|invalid"}],
            // floor_gb is the policy floor named by disk_admission_floor (not the effective
            // floor + outstanding reservations, which admit computes per decision)
"disk_hardware": "Verified|Failing|Unsupported|UNKNOWN",
"guardian": {"pid": n, "version": "...", "started": <epoch at which this daemon began governing>},
"guardian_pid": n,                   // the publishing governor's pid (= guardian.lock/pid)
"guardian_started": "<lstart text>", // = guardian.lock/started: C locale, LOCAL time of the writer
"guardian_pstart": <epoch|-1>        // = guardian.lock/pstart, its process start; -1 when unknown
```

`heavy_jobs_ok` is true only when `state == GREEN` **and** `evidence_complete`.
`spawn_agents_ok` is true only for GREEN or YELLOW with complete evidence.

`reservations` comes from the sensor snapshot while it is fresh and publishes `reserved_b` /
`budget_b`: `reserved_gb` = reserved_b, `budget_gb` = budget_b (GiB, one decimal, truncated),
`overcommit` = the sensor's verdict, `jobs` = the number of envelopes the sensor verified `ok`.
Otherwise (fallback) it is the governor's own: `reserved_gb` = Σ declared `peak_gb` of the
envelopes its reaper kept (live), `budget_gb` = RAM − `memory.os_reserve_gb`, `overcommit` =
reserved > budget, `jobs` = `registered_jobs`. A side that is unavailable is -1 and `overcommit`
is then null, never a measured-looking 0.0 / false (review 2026-10-08 SEM-6). While `jobs_st` is
`unavailable`, `reserved_gb`, `jobs` and `observables.registered_jobs` are -1 and `overcommit`
null.

`guardian_pid`, `guardian_started` and `guardian_pstart` say WHO published; §4.6 says how a
consumer uses them. A `state.json` without them (v1's, or the installer's, §4.5) names no live
governor.

### 4.2 Law-7 `status.json` (`$ARCHIE_HEALTH_DIR`, default `/tmp/archie_health`)

v1 keys unchanged: `state`, `reason`, `swap_gib`, `halt`, `gpu_jobs`, `registered_jobs`,
`free_pct`, `pageout_rate`, `disk_avail_gb`, `producer`, `ts`, `iso`. Additions:
`evidence_complete`, and from the governor `guardian_pid`, `guardian_started`, `guardian_pstart`
(the same values as in `state.json`). `producer` is `forge-guardian`, or `forge-guardian-install`
for the installer's UNKNOWN (§4.5), which carries none of the three `guardian_*` keys.
Observables that are not `ok` are -1 (`swap_gib` too); `registered_jobs` and `gpu_jobs` are -1
while the registry is unavailable (§6). `gpu_jobs` counts registered envelopes that declared
`gpu=1`; unregistered GPU work is invisible to it, so 0 is not proof the GPU is idle. `halt` is
true while `$ARCHIE_HEALTH_DIR/HALT` exists.

The directory must be a real directory owned by the user (not a symlink) or the governor refuses
to write into it and logs why. The governor creates it (0700) when it is absent; the installer
never does.

### 4.3 `history.jsonl` line

`{"t":<epoch>,"s":"GREEN","r":"nominal","vmp":1,"pe":"normal","fp":88,"sw":[used_mb,total_mb],"po":<rate/5s>,"th":"nominal","dk":<min avail gib>,"rs":[reserved_gb,budget_gb],"j":<jobs>,"ev":1}`

Numbers that are not `ok` are -1, as in `state.json`; `rs` entries and `j` are -1 while
unavailable (§4.1).

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
pressure event, so that poll happens at once rather than at the next tick. A poll confirms a
candidate only when it carries new evidence (a new sensor `seq`, or a full poll period in
fallback), and a de-escalation never counts a SIGUSR2 wake-up poll (review 2026-10-08 R5); the
RED ladder likewise climbs one rung per such poll.

**Stopping.** TERM, INT and the other trappable signals whose default action would end the
daemon — HUP QUIT ALRM USR1 PIPE XCPU XFSZ VTALRM PROF SYS ABRT EMT (`STOP_SIGNALS`) — run the
orderly stop: UNKNOWN "guardian stopped" (" (SIGHUP)" etc. for that group) into `state`,
`state.json` and the Law-7 file; the sensor is TERMed (≤ 2 s); the lock is removed and `state` is
back-dated to 1970-01-02; exit 0. Any other exit of a governing daemon (an error, a `set -u`
death of the script) publishes UNKNOWN "guardian exited unexpectedly" with
`evidence.missing: ["guardian"]` from its EXIT trap. Not trapped: KILL and STOP (they cannot be)
and the synchronous faults SEGV BUS ILL FPE TRAP (a handler that returns would re-run the
faulting instruction and hang the governor; launchd restarts a dead governor, never a wedged
one). After those the files keep the dead governor's last publication: it stops being live
evidence at once for every reader that verifies the lock holder (§2.1, §4.6), and at the 60 s
freshness bound for every other reader. SIGUSR2 is the sensor's wake-up, never a stop.

**Restart-loop breaker.** Every start appends its epoch to `guardian.starts` (at most 32 kept;
entries more than 60 s in the future are dropped). A start counts when
`0 ≤ now − start ≤ guardian_restart_loop.window_s`. With `max_starts` or more in the window the
governor publishes UNKNOWN (`evidence.missing: ["restart_loop"]`, `build_jobs_max` 2) every poll
for `backoff_s`, without its sensor, emits `guardian_restart_loop`, and then governs normally.
Every start counts, deliberate ones included: install, upgrade, rollback, the rollback inside a
failed install and `forge-guardian-ctl restart` (decision 2026-10-09; see README).

### 4.5 Installer publication (cutover and uninstall)

`forge-guardian-install` publishes into the domain only while no governor runs, and only
UNKNOWN. It does so at every stop of the service, with one of three reasons: install or upgrade
"guardian upgrade in progress"; rollback, including the rollback inside a failed install,
"guardian rollback in progress"; uninstall "guardian uninstalled: this domain is not governed".

A stop never leaves a stop-time GREEN (review 2026-10-08 INS-3): a v1 governor's TERM trap
publishes GREEN "guardian stopped" with `heavy_jobs_ok: true` and a fresh epoch. So a running
governor whose script does not positively carry the v2 stop publication is:

1. identified: launchd's pid for the label, argv equal to the plist's program, and its start
   epoch captured BEFORE any file is switched;
2. SIGSTOPped and verified again (on a mismatch it is SIGCONTed and left to an ordinary bootout);
3. frozen with its whole process tree, level by level, so no child can land a GREEN later or keep
   publishing after its parent dies;
4. UNKNOWN is published with `state` left FRESH, so a launchd KeepAlive respawn in that instant
   finds the domain governed and refuses (exit 3, §2.1) before it installs its GREEN trap;
5. the frozen tree is SIGKILLed (no trap runs), the label is booted out, and UNKNOWN is published
   again, now with `state` back-dated to 1970-01-02.

A v2 governor is booted out with TERM (its own trap publishes UNKNOWN), and the installer then
publishes UNKNOWN with `state` back-dated. The installer never publishes while a verified
governor (§2.1) other than the frozen one holds `guardian.lock`.

The installer's `state.json`:

```
{"schema": "forge.guardian.state/2", "state": "UNKNOWN", "reason": "<reason>", "ts": "<iso>",
 "epoch": <now>, "seq": 0, "build_jobs_max": 2, "spawn_agents_ok": false,
 "evidence_complete": false, "heavy_jobs_ok": false,
 "evidence": {"source": "fallback", "sensor_age_s": -1, "missing": ["guardian"]},
 "critical_now": false, "thermal_state": "none",
 "admission": {"heavy_open": false, "reason": "<reason>"},
 "reservations": {"reserved_gb": -1, "budget_gb": -1, "overcommit": null, "jobs": -1},
 "volumes": [], "disk_hardware": "UNKNOWN",
 "observables": {every v1 observable -1 ("loadavg": "-1"), "registered_jobs": <live envelopes>},
 "host": {"ram_gb", "ncpu", "nperf"}}
```

It has no `guardian`, `guardian_pid`, `guardian_started`, `guardian_pstart` or `jobs_st`: it names
no governor, because none runs. The Law-7 `status.json` gets `{"state": "UNKNOWN", "reason",
"swap_gib": -1, "halt", "gpu_jobs", "registered_jobs", "free_pct": -1, "pageout_rate": -1,
"disk_avail_gb": -1, "producer": "forge-guardian-install", "ts", "iso", "evidence_complete": false}`,
and only when that directory already exists as a real directory owned by the user (the installer
never creates it) and, for a home that is not the user's own, only when `ARCHIE_HEALTH_DIR` names
it explicitly. `registered_jobs` / `gpu_jobs` count the regular `*.job` files whose canonical pid
is alive.

### 4.6 Reading the publication: what makes it live

A fresh-looking file is not a live governor: one killed by SIGKILL or jetsam leaves its last
publication standing until the 60 s freshness bound (review 2026-10-08 FO-4). A consumer
therefore requires both:

- **freshness**: the `state` mtime (where it reads `state`) and the `state.json` `epoch` are each
  at most 60 s old and not more than 5 s in the future;
- **a live governor**: the `guardian.lock` holder verified as in §2.1.

`admit` (75), `forge-gate` (deny) and `forge-nproc` (prints 2) check both. A reader that cannot
inspect the lock should at least require `guardian_pid` to name a live `forge-guardian` process
whose start is `guardian_pstart` (±1 s); a publication without these keys names no live governor.

`forge-nproc` prints `build_jobs_max` from a `state.json` that passes both checks (its mtime and
its `epoch`), otherwise 2; then it subtracts the CPU threads of other jobs (§9.1).

## 5. Job envelopes — `jobs/<pid>.job`

KEY=VALUE lines; readers take the **first** occurrence of a key; `cmd` is written last
and may contain `=` and spaces. Every value is one line of at most 4000 bytes (§6). v1 keys
(unchanged): `pid`, `name`, `priority` (0 critical … 9 speculative), `can_restart` (0|1),
`peak_gb` (decimal, may be fractional), `gpu` (0|1), `started` (epoch s when the envelope was
written), `cmd`.

v2 keys (all optional for readers; written by `admit`):

```
schema=2
pstart=<epoch seconds of the process start, proc_pidinfo pbi_start_tvsec>
boot=<kern.bootsessionuuid at registration>
sig=<job signature, 16 hex>: sha256(name NUL argv joined by NUL)[:16] when the producer knows the argv
    (forge-job computes it and passes --sig); otherwise admit computes sha256(name NUL cmd)[:16] over
    the recorded cmd string. Readers use the recorded sig; a changed command line is a new signature.
threads=<int, CPU threads the job may use>
disk_gb=<decimal>  disk_path=<abs path>  disk_fsid=<hex>  disk_avail0_b=<avail at admission>
heartbeat=<abs path whose mtime the job advances>  stall_s=<int>
admitted=<epoch>  admit_state=<state at admission>  owner=forge-job|forge_law7|forge-app
```

A legacy writer may create the file before filling it: the sensor takes the pid from the file
stem only while the `pid=` key is absent, and the governor gives an envelope without a valid pid
10 s before it reaps it.

**Identity.** An envelope names a process, not a number. Before anything signals or counts
an envelope's pid it verifies, in order: the pid is canonical (otherwise the envelope is
`invalid`); the pid is alive; if `boot` is present it equals the current boot uuid; if `pstart`
is present it equals the process's start second (±1); otherwise, if `started` is present, the
process started no later than `started + 5` (the envelope is written after its process starts,
so a younger process is a reused pid); otherwise the identity is `unverifiable`. An envelope
larger than 64 KiB is `unverifiable` whatever its keys (§6).

- **Signalled:** only `ok` identities, and only when not protected (below).
- **Counted as reservations:** every LIVE envelope, identity `ok` or `unverifiable`.
  Unverifiable is a reason never to signal a pid, never a reason to treat its memory as free
  (review 2026-10-08 FO-5: a live 24 GiB job without `started` was admitted past). `admit` (budget,
  instant and disk fit), the sensor's `reserved_b` and the installer's reservation preflight all
  count this way. A live envelope whose `peak_gb` is not a decimal ≥ 0 is not a reservation of 0:
  `admit` exits 75 and `reserved_b` is -1 while it is registered.
- **Reaped** by the governor: dead, mismatched and invalid envelopes. Unverifiable ones are kept.
- **One verdict per FILE.** With a fresh snapshot the governor takes the sensor's verdict for that
  envelope file (`job<j>_file`) and only when the sensor read the same pid from it; a sensor that
  publishes no `job<j>_file` is matched by pid. The canonical-pid check comes before any sensor
  verdict. An envelope newer than the snapshot waits for the next one (it is neither reaped nor
  signalled on an older verdict). Without a fresh sensor the governor verifies each envelope
  itself (`pidinfo`, else `ps`), cached per file for 60 s.

**Protected processes — ONE list, applied by every component that can signal or admit.** A pid
is never signalled (governor) and never admitted as a job (`admit` exits 1, "protected or
foreign process") when: pid ≤ 1; its owner is unknown or is not the calling uid; it is the
governor (the `guardian.lock` holder, protected even unverified), one of the governor's
ancestors (of the holder when it verifies as the live governor, §2.1; in the governor itself,
the ppid chain recorded when it started), or the sensor (the `sensor.lock` holder; the
governor's own sensor child); or its process name — `p_comm`, *decoded* — is one of `claude`,
`node`, `Claude`, any name beginning `Claude Helper`, `WindowServer`, `loginwindow`, `Finder`,
`Dock`, `SystemUIServer`, `kernel_task`, `launchd`, `sshd`, `forge-guardian`,
`forge-guardian-sensor` (or its 16-character truncation `forge-guardian-s`). An unknown name is
protected. Pids are canonical decimal (no sign, no leading zero, ≤ 99999); anything else in an
envelope is invalid and the envelope is reaped (review 2026-10-08 ACT-1, ACT-3); the sensor
publishes it with `job<j>_pid=-1`, identity `dead`. Shells are NOT on the list: `forge-job`
wrappers are zsh, and the governor must be able to shed them.

`forge-guardian-sensor pidinfo [--state-dir D] PID...` answers with one line per pid:

```
pid=N ppid=P pstart=S uid=U protected=0|1 comm=<percent-encoded> identity=alive
pid=N identity=dead
```

`pstart` is epoch seconds. `comm=` is percent-encoded (`%20` for a space, `none` for an empty
name) and stays the field just before `identity=`; `protected=` comes before `comm=` and is
computed from the list above on the DECODED name, so no consumer has to re-derive it. Without
`--state-dir` it covers pid ≤ 1, the owner and the names; with `--state-dir D` it also covers D's
lock holder, the verified governor's ancestors and D's `sensor.lock` holder. The governor always
calls `pidinfo --state-dir "$STATE_DIR"` and honours `protected=1` (anything but a clear `0`); it
also decodes `comm=` and applies the name list itself, so either one protects (review ACT-1: the
governor matched `Claude Helper*` against the encoded `Claude%20Helper`). Exit 0, or 2 (usage:
no PID, or one that is not a positive integer).

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
disk_volumes=<percent-encoded paths, space-joined, leading ~ expanded by the reader>  policy_source=<file|defaults>
guardian_restart_loop_max_starts=5  guardian_restart_loop_window_s=900  guardian_restart_loop_backoff_s=300
logs_cap_mib=64  logs_rotate_mib=4  logs_generations=3  logs_history_mib=6  logs_incident_max_kib=512  logs_retention_days=30
notifications_enabled=1  notifications_min_interval_s=1800
reports_scan_interval_s=600  smart_interval_s=21600
```

Disk floors are whole GiB ≥ 1, and `eviction_term_grace_s` ≥ 1. Unknown keys reject the whole
`policy.json` (keys beginning with `_` are comments). Disk floors are absolute minimums.
`watch_logs` (at most 16 entries of `{path, kind: "gpu_error", patterns: [≤ 64 strings]}`) is used
by the sensor only and is not flattened into `policy.env`. `forge-guardian-sensor policy
[--state-dir D] [--policy FILE] [--env]` prints the effective policy (JSON, or the `policy.env`
form); it exits 1 when the file was rejected (the defaults are printed).

**Bounds — ONE table, enforced identically by the sensor (policy.json → policy.env) and the
governor (policy.env, defensively).** A value outside its range rejects that key (sensor: the
whole file → defaults + `policy_error`; governor: that key → default + `policy_error`). The bounds
exist because an accepted-but-absurd value is a denial of service on the governor itself
(review 2026-10-08: `logs.generations=1e9` wedged both processes at 100 % CPU; `poll_s=1e9` was
accepted by the governor and refused by the sensor, so the sensor never started again).

| key | range | key | range |
|---|---|---|---|
| poll_s | 1–60 | escalate_polls | 1–10 |
| deescalate_polls | 1–60 | sensor_stale_polls | 2–12 |
| memory.os_reserve_gb | 2 – RAM−2 | memory.instant_margin_gb | 0–16 |
| memory.light_job_gb | 0–2 | disk.floors_gib.* | 1–10000, red < orange < yellow |
| eviction.settle_s | 0–3600 | eviction.term_grace_s | 1–600 |
| crash_loop.max_crashes | 1–100 | crash_loop.window_s | 60–86400 |
| guardian_restart_loop.max_starts | 2–100 | guardian_restart_loop.window_s | 60–86400 |
| guardian_restart_loop.backoff_s | 10–3600 | logs.cap_mib | 8–1024 |
| logs.rotate_mib | 1–64 | logs.generations | 1–10 |
| logs.history_mib | 1–64 | logs.incident_max_kib | 64–4096 |
| logs.retention_days | 1–365 | notifications.min_interval_s | 60–86400 |
| reports.scan_interval_s | 60–86400 | smart.interval_s | 600–604800 |

RAM is `hw.memsize` in GiB. `memory.os_reserve_gb` ≤ RAM−2 always leaves at least 2 GiB of heavy
budget, and accepts the shipped default 6 on an 8 GiB Mac; the earlier bound RAM/2 refused it
there, so the installed `policy.json` lost that key at every start (review 2026-10-08 round 2).
(Test hooks, never production: `FORGE_SENSOR_TEST_MEMSIZE_B` under `FORGE_SENSOR_TEST=1`, and
`RAM_BYTES` in the governor's library mode, stand in for another Mac's RAM.)

`required_signals` must be a set drawn from `vm_pressure swap pageouts disk thermal` and must
contain at least `vm_pressure swap pageouts disk`: an empty or core-less list would let the
governor publish GREEN with no evidence at all (review FO-3). `thermal` may be omitted only on a
platform whose sensor reports it `unavailable` by design; doing so is logged at every start.

**Registry limits.** A health domain holds at most 1024 envelopes: regular files named `*.job`
(names beginning with `.` are ignored; FIFOs, directories, symlinks and anything else are never
opened, never deleted, and are not envelopes). The registry is UNAVAILABLE — never a silently
shorter one (review R4) — when `jobs/` holds more than 4096 entries of any kind, holds more than
1024 envelopes, or an envelope cannot be read (an error other than vanishing, or turning into a
non-regular file, between the listing and the read). Then `admit` exits 75 (cannot decide); the
sensor publishes `jobs_st=unavailable`, `reserved_b=-1` and `overcommit=-1`; and the governor
publishes `jobs_st=unavailable` (state.json `jobs_st` and `reservations.status`) with
`registered_jobs`, `gpu_jobs`, `reservations.jobs` and `reserved_gb` all -1 and `overcommit`
null. The governor counts the regular `*.job` files itself, and with a fresh snapshot it also
takes the sensor's `jobs_st`; a regular envelope it cannot open is reaped as `unreadable`. Above
1024 it counts and verifies none of them (to order a shed it reads only the first 1024 by name,
and logs that), but it still **reaps, in a bounded batch**: each poll reads at most 1024
envelopes, starting where the previous batch stopped (wrapping round, so live envelopes that sort
first cannot hide dead ones for ever), and removes only those whose verdict needs no identity
check: unreadable, no canonical pid (after the same 10 s grace), or a pid that is not running.
An envelope whose pid is running is kept and never signalled from there. A flood of stale
envelopes (crashed jobs, a runaway harness) therefore drains on its own. Once the count is back
within the limit, the normal walk resumes and `jobs_st` returns to `ok`. (Review 2026-10-08
round 2: with no reaping above the limit, 1100 dead envelopes kept every `admit` at 75 until a
human deleted them.) An envelope larger than 64 KiB is not deleted:
its first 64 KiB are read and it is `unverifiable` (never signalled; its declared reservation
counted while its pid is alive). Writers cap every value at **4000 bytes**, on one line
(`admit`'s `one_line(v, 4000)`; `forge-job` caps by bytes without splitting a UTF-8 sequence),
under the readers' 4096-byte line cap. The effective floor of a volume is the policy floor plus
the outstanding disk reservations of live jobs on that volume (§9.1). Policy may raise a
floor; tools refuse a `policy.json` whose floors are not strictly ordered `red < orange <
yellow`, and fall back to the defaults with a logged error.

## 7. Events — `events.jsonl`

One JSON object per line, `ts` and `kind` first: `{"ts": <epoch float>, "kind": "...", ...}`.
Kinds and their fields:

| kind | writer | fields |
|---|---|---|
| `sensor_start` | sensor | `version`, `pid`, `parent`, `poll_s`, `policy_source`, `policy_error` (when the policy was rejected), `session` (the previous session's classification, or null), `boot_uuid` |
| `sensor_stop` | sensor | `orderly` (bool), `reason` (`sigterm`, `sigint`, `parent_exit`), `pid`, `session_errno` |
| `pressure` | sensor | `level` (`normal`, `warn`, `critical`), `vmp`, `seq`, `injected` (test mode only) |
| `thermal` | sensor | `state`, `prev`, `status`, `seq` |
| `will_sleep` | sensor | `sleep_n` |
| `did_wake` | sensor | `slept_s` (null when unknown) |
| `report` | sensor | `category`, `file`, `mtime`, `bug_type` (or null), `summary`, and for Jetsam `per_process_limit_only` |
| `gpu_error` | sensor (`watch_logs`), inbox | from a watched log: `source` (its path), `pattern`, `line`, `suppressed` (identical hits folded within 60 s); from the inbox: §7.1 |
| `stall` | governor, inbox | `pid`, `name`, `age_s` |
| `cancel_latency` | governor, inbox | `pid`, `s` (TERM → gone, at poll resolution) |
| `transition` | governor | `from`, `to`, `reason` |
| `shed` | governor | `sig` (the job signature, or null), `signal`, `pid`, `name` |
| `reap` | governor | `pid` (-1 when not a number), `why` |
| `quarantine` | release | `sig`, `name`, `crashes` |
| `incident` | sensor | `dir`, `incident_kind` (not `kind`, which is the event's own key), `note` |
| `publish_error` | governor, sensor | `file`, `errno` (-1 when unknown, e.g. a failed append); the sensor adds `error`, and `why` for a snapshot |
| `policy_error` | governor, sensor | governor: `"source": "governor"`, `errors`; sensor: `error`, `source` (the policy file), `why` |
| `guardian_restart_loop` | governor | `starts`, `window_s`, `backoff_s` |

### 7.1 The inbox — `events/inbox/*.jsonl`

A local producer (the Forge app, a worker) reports what it observed itself by writing a file
`events/inbox/<name>.jsonl` (to a temporary name first, then renamed, so the sensor never reads
half of it). Each tick the sensor ingests at most 64 files (`*.jsonl`, not beginning with `.`) and
at most 256 lines of at most 4 KiB from each file; the rest of a file is counted in
`inbox_invalid`. A line is valid only when it is a JSON object whose `kind` is `gpu_error`, `stall`
or `cancel_latency`, and whose `ts`, if present, is a number (default: the ingestion time). The
kinds the governor and the sensor own — a transition, a shed, a pressure event, a sensor_stop —
cannot be forged through the inbox (review SEM-7). A valid line is appended to `events.jsonl` as
`{"ts", "kind", "source": "<inbox file name>", <the producer's other fields>}` — `ts`, `kind` and
`source` first; a producer's own `source` is replaced. The file is then deleted; a file that
cannot be deleted is ingested once and skipped while it stays unchanged (review R10).

### 7.2 Appends: one whole record per line, or none

Every JSONL file and log in the domain is appended ONE WHOLE RECORD at a time:
`events.jsonl`, `history.jsonl`, `log/guardian.log` (governor); `events.jsonl`, `log/sensor.log`,
`reservations.history.jsonl`, `crashes/<sig>.jsonl`, `session/boots.jsonl`,
`quarantine/cleared.jsonl` (sensor). The rule (review 2026-10-08 R6):

- each record is ONE `write(2)` on an `O_APPEND` descriptor of a regular file — never a FIFO or a
  device; the sensor also refuses a symlink, while the governor follows one to a regular file;
- when the file does not end in a newline (another writer's fragment that could not be taken
  back), the record starts with one;
- a short write (a full volume) is taken back: the writer's bytes are exactly `[end − n, end)`, and
  they are cut off with `ftruncate` while the file still ends there — never once another writer
  has appended after them. The sensor cuts in-process. The governor, which has no `ftruncate`,
  runs `forge-guardian-sensor append --file F --truncate-to N --if-size M` (or `dd` when no sensor
  binary exists — then nothing else appends in that domain), only on a failed write, so its steady
  state stays fork-free;
- the governor logs `APPEND FAILED` and emits `publish_error` (`errno` -1) once per streak.

So a file keeps its previous length after a failed append, and a fragment can only survive as its
own invalid line (when the cut was impossible: another writer appended after it, or the writer
died before cutting). Readers skip a line that does not parse.

`forge-guardian-sensor append --file F [--line TEXT]` appends one record (TEXT, or stdin without
`--line`) by this rule: exit 0; 1 failed (the file keeps its previous length); 2 usage (a relative
path, a newline inside the record, more than 1 MiB). `append --file F --truncate-to N --if-size M`
cuts F back to N bytes only while it is exactly M bytes: exit 0 when F is now N bytes (cut, or
already N); 1 when it was not cut (another size, or not a regular file); 2 usage (M < N, or
combined with `--line`).

## 8. Session continuity — `session/`

`current.json`: `{"boot_uuid", "boot_epoch", "sensor_start", "last_heartbeat",
"last_heartbeat_mono_ms", "orderly_stop": bool, "orderly_stop_ts", "stop_reason", "sleeps",
"last_sleep_ts", "last_wake_ts", "asleep": bool, "sensor_pid", "sensor_version"}`, rewritten
(`F_FULLFSYNC`) at start, every 60 s, on sleep/wake, and on orderly stop (`stop_reason`:
`sigterm`, `sigint` or `parent_exit`; null otherwise).

At start the sensor moves the old `current.json` to `previous.json` — the old record's keys
plus `classification`, `classified_ts`, `classified_boot_uuid` and `evidence` — and appends the
same object to `boots.jsonl`:

| Evidence | classification |
|---|---|
| same boot, `orderly_stop` | `service_restart` |
| same boot, no `orderly_stop` | `service_interrupted` (sensor killed or crashed; boot continued) |
| new boot, `orderly_stop` | `orderly_stop_then_reboot` (shutdown, restart or logout observed) |
| new boot, no `orderly_stop`, panic report dated in the gap | `kernel_panic` (report path recorded) |
| new boot, no `orderly_stop`, nothing explaining it | `unclean_unknown` — **never** asserted to be a panic, power loss or a green screen |
| the old `current.json` is unreadable or corrupt | `unclean_unknown`, with a `note` saying so |

The gap (`gap_s = boot_epoch − last_heartbeat`), panic reports correlated over
`[last_heartbeat, now]` (a panic report is written at the NEXT boot, after boot_epoch), any reports dated in it, and whether the last
record said the machine was asleep are recorded alongside, as evidence, not as a cause.

The other files in `session/` (`report_watermark`, `report_seen`, `reports_baseline.json`,
`watch_offsets.json`) are the sensor's scan state (§2, §10). `forge-guardian-sensor session
--state-dir D` prints `{"previous": <previous.json or null>, "current": <current.json or null>}`.

## 9. Admission, reservations, crash loops

### 9.1 `forge-guardian-sensor admit`

```
forge-guardian-sensor admit --state-dir D --pid PID --name N --peak-gb G
    [--priority P] [--restartable] [--gpu] [--threads T]
    [--disk-gb X --disk-path PATH] [--heartbeat FILE --stall-s S]
    [--need green|yellow|orange|red] [--sig SIG] [--cmd STR] [--owner forge-job]
    [--wait SECONDS] [--dry-run] [--json] [--policy FILE]
exit 0  admitted; the envelope jobs/PID.job is written (not with --dry-run)
exit 1  denied; reason on stderr (and in --json output). Includes "protected or foreign process" (§5)
        and a PID that is not alive
exit 2  usage error
exit 75 the domain cannot decide — fail closed: no state, stale state, clock skew, no live governor
        (§2.1), an unreadable registry or a live envelope's unreadable peak_gb, memory evidence not
        ok for a non-light job, a --disk-path that cannot be statfs'ed, admission.lock held for more
        than 30 s, an envelope that cannot be written, a missing domain
exit 78 the job signature is quarantined
```

Under `admission.lock` (held only for the decision, never while waiting): protected or foreign
pid (§5) → quarantine check → state freshness (`state` mtime and `state.json` epoch, ≤ 60 s old,
≥ −5 s) → a live governor (the verified `guardian.lock` holder, §2.1, §4.6) → state rank vs
`--need` (UNKNOWN ranks with RED; a word nobody knows denies everything) → identity-verified
registry → memory fit → disk fit → the pid is alive → write the envelope atomically → release
the lock. `--wait` (at most 7 days) retries
every 5 s until the deadline, re-taking the lock each time; it retries on 1 and 75, and returns
0, 2 and 78 at once, as well as a protected or foreign pid. stdout carries the decision
(`--json` for the object); callers that run a job keep the job's own stdout clean by sending it
to stderr.

The holders are every LIVE envelope — identity `ok` or `unverifiable` (§5) — except the
requesting pid's own (a re-admission replaces its envelope). Memory fit (bytes; G =
`--peak-gb`; jobs with G ≤ `memory_light_job_gb` skip both tests and need no memory evidence):

* **budget**: Σ reserved(live holders) + G ≤ `mem_total_b − os_reserve_gb`, where a job's
  reservation is `max(peak_gb, measured peak footprint)` — a measurement can raise a
  reservation, never shrink it below the declaration.
* **instant** (when `memory_enforce_instant_fit`): G + Σ max(0, reserved_i − resident_i) +
  `instant_margin_gb` ≤ `mem_avail_b`. Resident, not footprint: a job whose pages are
  compressed or swapped out will need them back in RAM.

Disk fit, per volume V (the fsid of `--disk-path`, walking up to the nearest existing directory;
`avail` is the sensor's own reading of a configured volume on that fsid when it is `ok`, else
`statfs`): `avail − Σ outstanding − X ≥ floor(disk_admission_floor)`, over the live envelopes,
other than the requester's, that declared `disk_gb > 0` on V's fsid (review 2026-10-08 SEM-3,
never under-count):

* when exactly one such job exists and it recorded `disk_avail0_b`, the drop in free space since
  its admission is credited to it: `outstanding = max(0, disk_gb − max(0, disk_avail0_b − avail))`;
* with two or more, who wrote what is unknowable, so each counts its full declaration
  `disk_gb` (the per-job credit used to credit EVERY job with the whole drop: two jobs that
  declared 30 GiB each on a volume that had dropped 20 GiB counted 20 outstanding instead of
  ≥ 40).

CPU: `threads` is recorded and summed; `forge-nproc` subtracts the threads reserved by other
jobs — envelopes whose canonical pid is alive, is not its caller or one of the caller's
ancestors, and verifies `ok` (boot, then `pstart` ±1, else `started + 5`; unverifiable ones are
not counted) — never going below 1. CPU oversubscription is not denied.

GPU: on Apple Silicon GPU memory is unified memory and is part of `peak_gb`; `--gpu` is the
Law-7 marker (one heavy GPU job at a time), not a separate pool.

`forge-gate [--need green|yellow|orange|red] [--wait S] [--why TEXT] [--peak-gb G] [--disk-gb X
--disk-path P] [--threads T] [--gpu]` is the state check for callers that do not reserve. Each
attempt requires freshness and a live governor (§4.6) — without them it denies at once — then
the state rank (UNKNOWN with RED; a word it does not know never admits). With any resource flag
it then runs `forge-guardian-sensor admit --dry-run` for its own pid; an admit exit of 2 or 78
denies at once. A state or resource refusal is retried every 5 s until `--wait` (whole seconds)
runs out. Every argument it does not know, and a `--need` that is not one of the four words, is
a usage error (exit 2): a misspelled flag must never skip a check (review SEM-2, FO-1, FO-2).
Resource flags without a sensor deny.

### 9.2 `forge-guardian-sensor release`

`release --state-dir D --pid PID [--rc N] [--signal NAME] [--external-term]` takes
`admission.lock`, removes `jobs/PID.job` when its identity is ok, dead or unverifiable, and
refuses only a MISMATCH (a reused pid's envelope belongs to somebody else); without `--signal`,
rc > 128 is read as signal rc − 128 and recorded with `signal_inferred: true`. It appends
`{ts, sig, name, pid, declared_gb, measured_peak_gb, wall_s, rc, signal, signal_inferred,
external_term, identity}` to `reservations.history.jsonl` (null where unknown), and when the job
ended by one of `crash_loop_crash_signals` and the wrapper did not itself forward an external
TERM/INT, appends `{ts, pid, name, signal, rc, cmd (≤ 1024 bytes)}` to `crashes/<sig>.jsonl`. Both
files rotate at 1 MiB with one generation (`.1`). Crashes are counted over the ledger and its
`.1`, inside `window_s` and after the last clear of that signature; `max_crashes` of them write
`quarantine/<sig>.json` = `{sig, name, cmd (≤ 4000 bytes), crashes: [...], since, since_iso,
incident, max_crashes, window_s}` and create an incident bundle. A crash ledger untouched for
`logs.retention_days` whose signature is not quarantined is deleted. Exit 0; 1 no envelope for
the pid, or a mismatch; 2 usage (also an unknown signal name); 70 the envelope could not be
removed; 75 `admission.lock` held for more than 30 s; 78 this release created a quarantine.

### 9.3 Quarantine

`admit` refuses a quarantined `sig` with exit 78. Only `forge-guardian-ctl quarantine clear
SIG --reason TEXT` (SIG = 16 hex) removes it, through `forge-guardian-sensor quarantine-clear
--state-dir D --sig SIG --reason TEXT` under `admission.lock`: the reason (≤ 2000 bytes), user
and time are appended to `quarantine/cleared.jsonl`, and crashes before that clear are never
counted again. A changed command line is a different signature by construction.

### 9.4 Installer preflight (report only for reservations)

`forge-guardian-install install|upgrade` (with or without `--dry-run`) first checks its
environment and exits 1 when any check fails: macOS, not root, the zsh modules `zsh/system`
`zsh/datetime` `zsh/stat` `zsh/files` load, `plutil` and `shasum` exist, every tool and shared
file is present in the source tree, the sensor sources (or an executable
`FORGE_GUARDIAN_SENSOR_PREBUILT`) exist, and the home exists.

The **reservation preflight** runs in `install` (after staging and validation, before any
cutover), in `install --dry-run` and in `status`. It never writes, re-registers or signals
anything. It prints the heavy budget `RAM − os_reserve` with the ENGINE's `memory.os_reserve_gb`,
and names where that came from. `admit` evaluates `policy.json` at every call, and a file with any
key outside §6's bounds is rejected whole, so the built-in default (6) applies. The preflight
therefore asks a sensor for that evaluation, `forge-guardian-sensor policy --state-dir <domain>
--env` (read-only): in `install` the staged sensor (the one that admits after the install), in
`--dry-run` `FORGE_GUARDIAN_SENSOR_PREBUILT` or else the installed sensor, and in `status` the
installed sensor. It reports `<policy.json>, as the sensor evaluates it`, `the built-in default:
there is no <policy.json>`, or `the built-in default: the sensor rejects <policy.json> whole
(<reason>)`. When no sensor answers (none installed and none prebuilt, a release without one, or a
stand-in), the installer reconstructs that one key the way the sensor reads it. A `policy.json`
that is not a regular file, does not set the key, sets it to a non-number, or sets it outside
**2 – RAM−2** (the same bound as §6) gives the default, and the line says why. A value in range is
used and marked `memory.os_reserve_gb only` (the other keys are not validated). `policy.env` is
not consulted: it is the running sensor's evaluation as of its last reload, and `admit` reads
`policy.json` itself. Then, over the LIVE
envelopes as §5 and §6 count them, rule for rule as the sensor's registry reader: regular
`*.job` files without a leading dot (`lstat`; a symlink or FIFO is not an envelope); the first
64 KiB read, and a larger envelope is `unverifiable` whatever its keys and **counted** (§6); lines
cut at 4096 bytes, one trailing CR dropped, the **first** occurrence of a key wins (keys after `cmd`
too); a canonical pid (the file stem only while `pid=` is absent) of a process that is running and
not a zombie; same boot; `pstart` ±1, else `started + 5` (both parsed as `strtoll` reads them),
else unverifiable — counted too. `peak_gb` is read as the engine's `parse_dbl` reads it: `strtod`
over the trimmed value (≤ 64 bytes, the whole of it, finite, ≥ 0), so `31.0000000000000`, `3.1e1`,
` 31`, `31.` and `0x1fp0` are all 31. A registry the engine cannot read completely — `jobs` not a
readable directory, more than 4096 entries or 1024 envelopes (§6), an envelope that cannot be
opened — is reported as `UNREADABLE REGISTRY: … every admission is undecidable (exit 75)` and no
envelope is reported. Otherwise it reports:

- `UNREADABLE RESERVATION: jobs/<file> … declares peak_gb='…'` (or `declares no peak_gb`) — every
  admission is undecidable (75) while it is registered;
- `RESERVATION EXCEEDS THE HEAVY BUDGET: jobs/<file> '<name>' (pid N, live, identity …) declares
  peak_gb=G > B GiB` — heavy admission (every job above `memory.light_job_gb`) will be denied while
  it is registered, followed by `Report only: nothing was changed or signalled`. The identity reads
  `unverifiable, larger than 64 KiB` for an oversize envelope, and a `G` that is not a plain decimal
  is followed by its value (`3.1e1 (= 31 GiB)`);
- otherwise, when the live declarations together exceed the budget, that they do (report only);
  else that the live envelopes fit.

The preflight reports declarations; the engine reserves `max(declared, measured)` (§9.1), so a job
whose footprint outgrew its declaration can still close admission. `install_gate.sh` (0c) holds the
two readers together: one envelope at a time, the preflight's verdict must be the sensor's
`snapshot --state-dir` verdict for that envelope.

`install --dry-run` (refused with exit 2 for anything but install/upgrade) prints what `install`
would do — the current and previous releases, hand-copied tools it would snapshot as the rollback
target, the plist, how the running governor would be stopped (§4.5) — and the reservation
preflight; it writes, builds, starts and signals nothing, and asks launchctl only to `print`.

## 10. Incidents — `incidents/<UTC>-<kind>/`

`forge-guardian-sensor incident --state-dir D --kind K [--note TEXT] [--job SIG]
[--window-min M] [--with-log]` writes, within `logs_incident_max_kib`:
`summary.json` (schema `forge.guardian.incident/1`: `ts`, `kind`, `note`, `boot`, `session`
classification, copies of `state.json` and `sensor.json`, envelopes, quarantines), `history.jsonl`
(the last `M` minutes), `events.jsonl` (same window), `reports.json` (DiagnosticReports in the
window: name, mtime, size, category, `bug_type`, and for Jetsam the largest process and the kill
reasons), and with `--with-log` a `unified_log.txt` excerpt (`log show` over the window,
predicate limited to kernel/WindowServer/GPU subsystems, 30 s timeout, 256 KiB cap). It prints
the bundle's directory. Exit 0; 1 rate-limited; 2 usage; 70 the bundle could not be written.
Kinds: `manual`, `red`, `crash_loop`, `unclean_boot`, `report`, `gpu_error`.
Automatic kinds are rate-limited to one per key per 10 min (stamp: `incidents/.ratelimit/<key>`),
where the key is `crash_loop:<sig>` (one job's quarantine never suppresses another's bundle),
`report:<category>`, and the kind itself for `red` (the governor asks for one on every
transition into RED), `unclean_boot`, `gpu_error` and any kind requested on the command line;
`manual` is never rate-limited. Inaccessible evidence is recorded as inaccessible, never
requested with elevated privilege.

### Report categories (DiagnosticReports, user and system directories)

The report directories are `/Library/Logs/DiagnosticReports`, `~/Library/Logs/DiagnosticReports`
and each one's `Retired/`: macOS moves every report into `Retired/` at its daily run, so a scan of
the top level alone lost them (review 2026-10-08 SEM-1). Reports are found by mtime and
remembered by key `<floor(mtime)> <name>` (`session/report_seen`); a move keeps the mtime, so a
report seen in one place and later in the other is the same report. Each scan covers
`(min(watermark, now − scan_interval − 120 s), ∞)`; a watermark more than 5 s in the future is a
backward clock step, and the scan restarts from `now − scan_interval − 120 s` with `report_seen`
preventing repeats (review R8). The first scan ever writes `session/reports_baseline.json` (30
days, by category) and emits nothing; later scans emit at most the 200 newest new reports.
`forge-guardian-sensor reports --since EPOCH [--until EPOCH] [--dirs a:b] [--max N]` prints the
classified reports with `since ≤ mtime ≤ until` (defaults: now, these directories, the newest 500)
as a JSON array, one entry per report key.

`panic` (`*.panic`, `panic-full-*`), `jetsam` (`JetsamEvent-*.ips`), `gpu` (names containing
`GPU`/`gpuRestart`/`AGX`), `windowserver` (`WindowServer*`), `shutdown_stall`
(`*.shutdownStall`), `app_crash` (`*.ips`/`*.crash` of Forge, forge-*, Python, MLX workers),
`resource` (`*.diag`: cpu_resource, disk writes), `other`. A Jetsam report whose kills are all
`per-process-limit` is a per-process limit, not system-wide memory exhaustion; the category
summary says which. A `report` incident is made for `panic`, `gpu`, `windowserver`,
`shutdown_stall`, and a parsed Jetsam with kills that are not all `per-process-limit`.

## 11. Exit codes

Shared meanings: `0` ok · `1` denied/failed check · `2` usage · `3` refused duplicate instance
(or a held lock) · `70` internal error · `75` cannot decide, fail closed (EX_TEMPFAIL) · `78`
quarantined (EX_CONFIG). Per tool:

| tool | exits |
|---|---|
| `forge-guardian` | `0` orderly stop (TERM, INT, `STOP_SIGNALS`, §4.4) · `2` any argument (the daemon takes none) · `3` another governor holds the domain (a live lock holder, or a fresh `state`) · `130`/`143` INT/TERM before it governs |
| `forge-guardian-sensor` | `0` `1` `2` · `3` `run` while another sensor holds `sensor.lock` · `70` `75` `78` — per command: `admit` §9.1, `release` §9.2, `pidinfo` §5, `append` §7.2, `incident` §10 |
| `forge-gate` | `0` admitted · `1` denied · `2` usage |
| `forge-nproc` | always `0`; prints a number (2 is the fail-safe value, §4.6) |
| `forge-job` | the command's own exit status once it ran · `2` usage (or the sensor's usage refusal) · `75` not admitted, or the domain cannot decide · `78` quarantined · `130`/`143` stopped by INT/TERM while waiting for admission |
| `forge-guardian-ctl` | `0` ok, and every read-only command · `1` a start, stop or restart that did not complete (or no sensor for `incident`) · `2` usage, or refused (`FORGE_GUARDIAN_HOME` is not this user's home while launchctl is the real one) |
| `forge-guardian-install` | `0` done (installed with complete evidence, already installed, rolled back, uninstalled, `--dry-run`, `status`) · `1` failed; a failed install or rollback is rolled back to the state before the run · `2` usage or refused (`--dry-run` with anything but install/upgrade; the real launchctl for a home that is not this user's) · `3` another install holds the install lock · `4` installed and LEFT RUNNING, but its evidence did not become complete within `FORGE_GUARDIAN_EVIDENCE_S` (default 120 s; e.g. `restart_loop`, §4.4) · `70` internal error |
| `forge-guardian-soak` | `0` ok · `1` `stop` refused (no soak, or the recorded process is not this soak) or the soak outlived TERM by 10 s; `status` found no soak · `2` usage · `3` `start` while a soak runs |
