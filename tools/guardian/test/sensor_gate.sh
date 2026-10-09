#!/bin/zsh
# ============================================================================
# SENSOR GATE -- forge-guardian-sensor (T-173)
#
# Builds the native sensor into a private dir and proves, against THIS Mac:
#   - the snapshot is valid JSON, every signal carries a status, and the real
#     values are real (thermal is AVAILABLE natively -- the shell governor read
#     `pmset -g therm`, which prints nothing here, and defaulted to 100 = healthy);
#   - pidinfo, run mode (publication, single instance, parent death, injection,
#     SIGUSR2 latency, orderly stop), session classification, report
#     classification, watch_logs, inbox ingestion, publish failure, idle cost.
#
# Everything runs in a private mktemp root with explicit private state dirs. It
# never touches ~/.forge-health, /tmp/archie_health or launchd, never signals a
# process it did not start, and reaps every pid it started (recorded in a FILE:
# command-substitution subshells lose array appends).
#
# usage: sensor_gate.sh [--bin PREBUILT]     (default: build from ../sensor)
#   SCAN_IN_POLICY=1  put reports.scan_interval_s=1 in the test policies instead of
#                     FORGE_SENSOR_TEST_SCAN_S=1 -- only for running these cases against
#                     a pre-2026-10-08 binary, which accepted that value (it is now out of
#                     SCHEMA §6's 60-86400 range) and knew no test hook for it.
# Cases tagged [ID] reproduce a finding of the 2026-10-08 review.
# ============================================================================
set -u
setopt NULL_GLOB 2>/dev/null || true
zmodload zsh/datetime

HERE=${0:A:h}
GUARD_DIR=${HERE:h}
SRC_DIR=$GUARD_DIR/sensor
PREBUILT=""
if [[ ${1:-} == --bin ]]; then PREBUILT=${2:-}; fi

PASS=0; FAIL=0
ck() { # ck <desc> <exit-status-of-condition>
  if (( $2 == 0 )); then (( PASS++ )); print -r -- "    ok   $1"
  else (( FAIL++ )); print -r -- "    FAIL $1"; fi
}
note() { print -r -- "    ..   $*" }
sect() { print -r -- ""; print -r -- "== $*" }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fg_sensor_gate.XXXXXX")
ROOT=${ROOT:A}
PIDFILE=$ROOT/started.pids; : >"$PIDFILE"
MNT=""
note_pid() { print -r -- "$1" >>"$PIDFILE" }
reap() {
  local p
  if [[ -r $PIDFILE ]]; then
    while read -r p; do [[ -n $p && $p == <-> ]] && kill -9 "$p" 2>/dev/null; done <"$PIDFILE"
  fi
  return 0
}
cleanup() {
  kill -9 ${WATCHDOG:-0} 2>/dev/null
  reap
  if [[ -n $MNT ]]; then hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""; fi
  chmod -R u+rwx "$ROOT" 2>/dev/null
  rm -rf "$ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Wall-clock bound on the WHOLE gate. Short sleeps so an orphaned watchdog child
# dies within a second of the gate.
GATE_BUDGET=${GATE_BUDGET:-600}
{
  integer i
  for (( i = 0; i < GATE_BUDGET; i++ )); do sleep 1; done
  print -u2 "[sensor_gate] WALL-CLOCK EXCEEDED (${GATE_BUDGET}s) -- reaping and failing"
  if [[ -r $PIDFILE ]]; then while read -r wp; do [[ -n $wp ]] && kill -9 "$wp" 2>/dev/null; done <"$PIDFILE"; fi
  kill -TERM $$ 2>/dev/null; sleep 2; kill -9 $$ 2>/dev/null
} &
WATCHDOG=$!

# ---------------------------------------------------------------- helpers
envv() { # envv FILE KEY -> value (no fork)
  local l
  [[ -r $1 ]] || return 1
  while IFS= read -r l; do [[ $l == "$2="* ]] && { print -r -- "${l#*=}"; return 0 }; done <"$1"
  return 1
}
pyj() { # pyj FILE EXPR  (d = the parsed JSON)
  python3 -I -c 'import json,sys
d=json.load(open(sys.argv[1]))
print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null
}
json_ok() { python3 -I -c 'import json,sys; json.load(open(sys.argv[1]))' "$1" 2>/dev/null }
wait_until() { # wait_until SECONDS 'zsh condition'
  local deadline=$(( EPOCHREALTIME + $1 ))
  while (( EPOCHREALTIME < deadline )); do eval "$2" && return 0; sleep 0.1; done
  eval "$2"
}
alive() { kill -0 "$1" 2>/dev/null }
count_kind() { # count_kind FILE KIND -> number of events whose OWN kind is KIND
  [[ -r $1 ]] || { print 0; return }
  python3 -I -c 'import json,sys
n=0
for l in open(sys.argv[1]):
    try:
        if json.loads(l).get("kind")==sys.argv[2]: n+=1
    except Exception: pass
print(n)' "$1" "$2"
}
write_policy() { # write_policy D [extra json members]
  mkdir -p "$1"
  local scan=""
  (( ${SCAN_IN_POLICY:-0} )) && scan="\"reports\": {\"scan_interval_s\": 1}, "
  print -r -- "{$scan\"watch_logs\": [{\"path\": \"$ROOT/watch/gpu.log\", \"kind\": \"gpu_error\", \"patterns\": [\"GPU Hang\", \"MTLCommandBufferError\"]}]${2:+, $2}}" >"$1/policy.json"
}
# start_sensor D [extra run args] -> sets SPID (env from the caller's exports)
start_sensor() {
  local d=$1; shift
  "$B" run --state-dir "$d" "$@" >>"$ROOT/sensor.out" 2>&1 &
  SPID=$!
  note_pid $SPID
}

mkdir -p "$ROOT/watch" "$ROOT/reps_empty"
export FORGE_SENSOR_TEST=1
export FORGE_SENSOR_TEST_REPORT_DIRS=$ROOT/reps_empty
export FORGE_SENSOR_INJECT=$ROOT/inject
export FORGE_SENSOR_TEST_SCAN_S=1   # reports scan every second (test mode only)
: >"$FORGE_SENSOR_INJECT"

# ================================================================ A. build
sect "A. build"
t0=$EPOCHREALTIME
if [[ -n $PREBUILT ]]; then B=$PREBUILT; brc=0
else B=$("$SRC_DIR/build.sh" --out "$ROOT/build" 2>"$ROOT/build.err"); brc=$?; fi
note "build: $(printf '%.1f' $(( EPOCHREALTIME - t0 )))s -> $B"
ck "build.sh exits 0 and produces an executable" $(( brc == 0 && ${#B} > 0 ? 0 : 1 ))
[[ -x ${B:-/nonexistent} ]] || { cat "$ROOT/build.err"; print "FATAL: no sensor binary"; exit 1 }
v=$("$B" --version)
[[ $v =~ '^forge-guardian-sensor [0-9]+\.[0-9]+\.[0-9]+$' ]]; ck "--version prints 'forge-guardian-sensor <semver>' ($v)" $?
"$B" --help | grep -q usage; ck "--help prints usage" $?
"$B" bogus >/dev/null 2>&1; ck "unknown command exits 2" $(( $? == 2 ? 0 : 1 ))

# Idle-cost sensor: started now at the DEFAULT poll, measured at the end (>= 60 s).
IDLE_D=$ROOT/idle
write_policy "$IDLE_D"
FORGE_SENSOR_INJECT= start_sensor "$IDLE_D"
IDLE_PID=$SPID
IDLE_T0=$EPOCHREALTIME

# ================================================================ B. policy
sect "B. policy defaults and validation"
"$B" policy --json >"$ROOT/pol_builtin.json"
python3 -I -c 'import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
sys.exit(0 if a==b else 1)' "$ROOT/pol_builtin.json" "$GUARD_DIR/policy.default.json"
ck "built-in defaults == tools/guardian/policy.default.json (deep equality)" $?
"$B" policy --env --policy "$GUARD_DIR/policy.default.json" | grep -v '^policy_source=' >"$ROOT/pe_file"
"$B" policy --env | grep -v '^policy_source=' >"$ROOT/pe_builtin"
cmp -s "$ROOT/pe_file" "$ROOT/pe_builtin"; ck "policy.env from the file == policy.env from built-ins" $?
grep -qx 'disk_floors_gib_yellow=45' "$ROOT/pe_builtin" && grep -qx 'required_signals=vm_pressure swap pageouts disk thermal' "$ROOT/pe_builtin" \
  && grep -qx 'crash_loop_crash_signals=SEGV BUS ILL ABRT FPE TRAP SYS KILL' "$ROOT/pe_builtin"
ck "policy.env carries the SCHEMA §6 key names" $?
print -r -- '{"disk": {"floors_gib": {"yellow": 10, "orange": 25, "red": 12}}, "poll_s": 2}' >"$ROOT/bad1.json"
out=$("$B" policy --env --policy "$ROOT/bad1.json" 2>"$ROOT/bad1.err"); rc=$?
(( rc == 1 )) && grep -q 'strictly ordered' "$ROOT/bad1.err" && [[ $(print -r -- "$out" | grep '^poll_s=') == poll_s=5 ]]
ck "mis-ordered floors -> rejected WHOLE (poll_s stays 5), reason named" $?
print -r -- '{"disk": {"floors_gib": {"yellow": 45.5}}}' >"$ROOT/bad3.json"
"$B" policy --policy "$ROOT/bad3.json" >/dev/null 2>"$ROOT/bad3.err"; rc=$?
(( rc == 1 )) && grep -q 'must be an integer' "$ROOT/bad3.err"; ck "a fractional disk floor is rejected (the governor compares whole GiB)" $?
grep -qx 'disk_volumes=~ /private/tmp' "$ROOT/pe_builtin"; ck "policy.env carries the additive disk_volumes key" $?
print -r -- '{"memroy": {"os_reserve_gb": 1}}' >"$ROOT/bad2.json"
"$B" policy --policy "$ROOT/bad2.json" >/dev/null 2>"$ROOT/bad2.err"; rc=$?
(( rc == 1 )) && grep -q 'unknown key memroy' "$ROOT/bad2.err"; ck "unknown key -> rejected" $?
print -r -- '{"poll_s": 2, "memory": {"os_reserve_gb": 4}}' >"$ROOT/good.json"
out=$("$B" policy --env --policy "$ROOT/good.json"); rc=$?
(( rc == 0 )) && [[ $out == *$'\npoll_s=2\n'* || $out == poll_s=2$'\n'* ]] && [[ $out == *'memory_os_reserve_gb=4'* && $out == *'memory_instant_margin_gb=2'* ]]
ck "a partial policy overlays the defaults" $?

# SCHEMA §6 bounds: ONE table. For every key: min and max accepted, min-1 and max+1
# rejected WHOLE (review 2026-10-08 R2: poll_s 4000 accepted here and refused by `run`;
# R3: logs.generations 1e9 wedged sensor and governor at 100 % CPU).
RAMH=$(( $(sysctl -n hw.memsize) / 1073741824.0 / 2 ))
python3 -I - "$B" "$ROOT/bounds" "$RAMH" >"$ROOT/bounds.out" <<'PY'
import json, os, subprocess, sys
B, d, ramh = sys.argv[1], sys.argv[2], float(sys.argv[3])
os.makedirs(d, exist_ok=True)
T = [("poll_s",1,60),("escalate_polls",1,10),("deescalate_polls",1,60),("sensor_stale_polls",2,12),
     ("memory.os_reserve_gb",2,ramh),("memory.instant_margin_gb",0,16),("memory.light_job_gb",0,2),
     ("eviction.settle_s",0,3600),("eviction.term_grace_s",1,600),
     ("crash_loop.max_crashes",1,100),("crash_loop.window_s",60,86400),
     ("guardian_restart_loop.max_starts",2,100),("guardian_restart_loop.window_s",60,86400),
     ("guardian_restart_loop.backoff_s",10,3600),("logs.cap_mib",8,1024),("logs.rotate_mib",1,64),
     ("logs.generations",1,10),("logs.history_mib",1,64),("logs.incident_max_kib",64,4096),
     ("logs.retention_days",1,365),("notifications.min_interval_s",60,86400),
     ("reports.scan_interval_s",60,86400),("smart.interval_s",600,604800)]
def obj(k, v):
    o = v
    for p in reversed(k.split(".")): o = {p: o}
    return o
def rc_of(o):
    f = os.path.join(d, "p.json")
    json.dump(o, open(f, "w"))
    return subprocess.run([B, "policy", "--policy", f, "--env"], capture_output=True).returncode
bad = []
for k, lo, hi in T:
    real = k.startswith("memory.")
    step = 0.5 if real else 1
    cases = [(lo, 0), (hi if real else int(hi), 0), (lo - step, 1), ((hi + step) if real else int(hi) + 1, 1), (10**9, 1)]
    for v, want in cases:
        rc = rc_of(obj(k, v))
        if rc != want: bad.append("%s=%s: rc %d, want %d" % (k, v, rc, want))
for fl, want in (({"red": 9998, "orange": 9999, "yellow": 10000}, 0), ({"red": 10001, "orange": 10002, "yellow": 10003}, 1),
                 ({"red": 1, "orange": 2, "yellow": 10001}, 1)):
    rc = rc_of({"disk": {"floors_gib": fl}})
    if rc != want: bad.append("disk.floors_gib=%s: rc %d, want %d" % (fl, rc, want))
print("\n".join(bad) if bad else "all bounds enforced")
sys.exit(1 if bad else 0)
PY
brc=$?
note "$(head -c 600 "$ROOT/bounds.out" | tr '\n' ';')"
ck "[R2][R3] every SCHEMA §6 bound: min/max accepted, min-1/max+1/1e9 rejected whole" $brc
print -r -- '{"logs": {"generations": 1000000000}}' >"$ROOT/gen.json"
"$B" policy --env --policy "$ROOT/gen.json" >"$ROOT/gen.env" 2>"$ROOT/gen.err"; rc=$?
(( rc == 1 )) && grep -qx 'logs_generations=3' "$ROOT/gen.env" && grep -q '1..10' "$ROOT/gen.err"
ck "[R3] logs.generations=1e9 -> rejected whole, policy.env keeps generations=3 (rc=$rc)" $?
print -r -- '{"poll_s": 4000}' >"$ROOT/poll.json"
"$B" policy --env --policy "$ROOT/poll.json" >"$ROOT/poll.env" 2>/dev/null; rc=$?
(( rc == 1 )) && grep -qx 'poll_s=5' "$ROOT/poll.env"; ck "[R2] poll_s=4000 -> rejected whole, policy.env keeps poll_s=5 (rc=$rc)" $?
"$B" run --state-dir "$ROOT/poll61" --poll 61 >/dev/null 2>"$ROOT/poll61.err" & pp=$!; note_pid $pp
wait_until 2 '! alive $pp'; alive $pp && { kill -TERM $pp; wait_until 2 '! alive $pp'; rc=124; } || { wait $pp; rc=$?; }
(( rc == 2 )); ck "[R2] run --poll 61 -> usage (2): the same 1..60 range as policy.json (rc=$rc)" $?
pol_rc() { print -r -- "$1" >"$ROOT/rs.json"; "$B" policy --env --policy "$ROOT/rs.json" >"$ROOT/rs.env" 2>"$ROOT/rs.err"; print $? }
(( $(pol_rc '{"required_signals": []}') == 1 )) && grep -qx 'required_signals=vm_pressure swap pageouts disk thermal' "$ROOT/rs.env"
ck "[FO-3] required_signals [] -> rejected whole (policy.env keeps all five)" $?
(( $(pol_rc '{"required_signals": ["vm_pressure", "swap", "pageouts"]}') == 1 )) && grep -q 'missing disk' "$ROOT/rs.err"
ck "[FO-3] required_signals without disk (a core signal) -> rejected" $?
(( $(pol_rc '{"required_signals": ["vm_pressure", "swap", "pageouts", "disk", "cpu"]}') == 1 ))
ck "[FO-3] required_signals naming cpu (not one of the five) -> rejected" $?
(( $(pol_rc '{"required_signals": ["vm_pressure", "swap", "swap", "pageouts", "disk"]}') == 1 ))
ck "[FO-3] required_signals listing swap twice (not a set) -> rejected" $?
(( $(pol_rc '{"required_signals": ["disk", "pageouts", "swap", "vm_pressure"]}') == 0 )) && grep -qx 'required_signals=disk pageouts swap vm_pressure' "$ROOT/rs.env"
ck "[FO-3] A/B: the core four without thermal -> accepted" $?
(( $(pol_rc '{"sensor_stale_polls": 1000000000}') == 1 )) && grep -qx 'sensor_stale_polls=3' "$ROOT/rs.env"
ck "[FO-3] sensor_stale_polls=1e9 -> rejected (2..12)" $?

# ================================================================ C. snapshot
sect "C. snapshot on this Mac"
t0=$EPOCHREALTIME
"$B" snapshot >"$ROOT/snap.json"; rc=$?
note "snapshot latency $(printf '%.0f' $(( (EPOCHREALTIME - t0) * 1000 ))) ms"
ck "snapshot exits 0" $rc
json_ok "$ROOT/snap.json"; ck "snapshot is valid JSON" $?
python3 -I - "$ROOT/snap.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1]))
names=["vm_pressure","pressure_event","free_pct","memory","swap","pageouts","thermal","cpu","disk"]
ok=all(d["signals"][n]["status"] in ("ok","unavailable","stale","invalid") for n in names)
sys.exit(0 if ok and set(names)<=set(d["signals"]) else 1)
PY
ck "every one of the 9 signals carries a status" $?
[[ $(pyj "$ROOT/snap.json" 'd["signals"]["vm_pressure"]["status"]') == ok && $(pyj "$ROOT/snap.json" 'd["signals"]["vm_pressure"]["value"] in (1,2,4)') == True ]]
r_=$?; ck "vm_pressure ok and in {1,2,4} ($(pyj "$ROOT/snap.json" 'd["signals"]["vm_pressure"]["value"]'))" $r_
TH=$(pyj "$ROOT/snap.json" 'd["signals"]["thermal"]["value"]')
[[ $(pyj "$ROOT/snap.json" 'd["signals"]["thermal"]["status"]') == ok && $TH == (nominal|fair|serious|critical) ]]
ck "T-173 HEADLINE: thermal is AVAILABLE natively: status ok, value '$TH'" $?
python3 -I -c 'import json,sys
s=json.load(open(sys.argv[1]))["signals"]["swap"]
sys.exit(0 if s["status"]=="ok" and 0<=s["used_mb"]<=s["total_mb"]<10_000_000 else 1)' "$ROOT/snap.json"
r_=$?; ck "swap totals plausible ($(pyj "$ROOT/snap.json" 'd["signals"]["swap"]["used_mb"]')/$(pyj "$ROOT/snap.json" 'd["signals"]["swap"]["total_mb"]') MiB)" $r_
(( $(pyj "$ROOT/snap.json" 'sum(1 for v in d["volumes"] if v["status"]=="ok")') >= 1 )); ck ">= 1 volume ok" $?
[[ $(pyj "$ROOT/snap.json" 'd["signals"]["memory"]["total_b"]') == $(sysctl -n hw.memsize) ]]
r_=$?; ck "memory total == hw.memsize ($(sysctl -n hw.memsize))" $r_
[[ $(pyj "$ROOT/snap.json" 'd["boot"]["uuid"]') == $(sysctl -n kern.bootsessionuuid) ]]; ck "boot uuid == kern.bootsessionuuid" $?
fp=$(pyj "$ROOT/snap.json" 'd["signals"]["free_pct"]["value"]'); kl=$(sysctl -n kern.memorystatus_level)
(( fp >= kl - 3 && fp <= kl + 3 )); ck "free_pct ($fp) agrees with kern.memorystatus_level ($kl)" $?

JXA=$(osascript -l JavaScript -e 'ObjC.import("Foundation"); $.NSProcessInfo.processInfo.thermalState' 2>/dev/null)
words=(nominal fair serious critical)
if [[ $JXA == <0-3> ]]; then
  [[ ${words[JXA+1]} == $TH ]]; ck "thermal agrees with an independent reader (JXA, another process: ${words[JXA+1]})" $?
fi
python3 -I - "$B" <<'PY'
import json,re,subprocess,sys
# back to back, so the two readings describe the same moment
snap=json.loads(subprocess.run([sys.argv[1],"snapshot"],capture_output=True,text=True).stdout)
out=subprocess.run(["/usr/bin/vm_stat"],capture_output=True,text=True).stdout
ps=int(re.search(r"page size of (\d+)",out).group(1))
g=lambda k:int(re.search(k+r":\s+(\d+)",out).group(1))
want=(g("Pages free")+g("Pages inactive")+g("Pages speculative")+g("Pages purgeable"))*ps
got=snap["signals"]["memory"]["avail_b"]
print("    ..   mem_avail_b %d vs vm_stat (free+inactive+speculative+purgeable) %d: ratio %.4f"%(got,want,got/want))
sys.exit(0 if 0.9<got/want<1.1 else 1)
PY
ck "mem_avail_b agrees with vm_stat's own page counts within 10 %" $?

# RED ON OLD: the shell governor's thermal reading on this machine.
print -r -- "  -- red-on-old: the 834c7269 governor's thermal observable"
mkdir -p "$ROOT/old"
if git -C "$GUARD_DIR" show 834c7269:tools/guardian/forge-guardian >"$ROOT/old/forge-guardian" 2>/dev/null; then
  OLDTH=$(FORGE_HEALTH_DIR=$ROOT/old/h ARCHIE_HEALTH_DIR=$ROOT/old/ah FORGE_GUARDIAN_LIB=1 zsh -c 'source "$1"; sample; print -r -- "$O_THERM"' _ "$ROOT/old/forge-guardian" 2>/dev/null)
  PM=$(pmset -g therm 2>/dev/null | grep -c CPU_Speed_Limit)
  note "pmset CPU_Speed_Limit lines: $PM; old governor O_THERM=$OLDTH (published as cpu_speed_limit_pct, no status field)"
  (( PM == 0 )) && [[ $OLDTH == 100 ]]
  ck "old path: pmset has no thermal reading here, yet the old governor publishes 100 (healthy) -- the defect" $?
  grep -q '"cpu_speed_limit_pct"' "$ROOT/old/forge-guardian" && ! grep -q 'thermal_st' "$ROOT/old/forge-guardian"
  ck "old state.json has no thermal status at all (the gate's thermal-ok check cannot pass on it)" $?
else
  note "git show 834c7269 unavailable: red-on-old for thermal skipped"
fi

# ================================================================ D. pidinfo
sect "D. pidinfo"
line=$("$B" pidinfo $$)
lst=$(ps -o lstart= -p $$)
pst=$(date -j -f "%a %b %d %T %Y" "$lst" +%s 2>/dev/null)
pp=${${line#*ppid=}%% *}; ps_=${${line#*pstart=}%% *}; uu=${${line#*uid=}%% *}
[[ $line == *identity=alive* && $pp == $PPID && $uu == $UID ]] && (( ps_ - pst <= 2 && pst - ps_ <= 2 ))
ck "\$\$ alive, ppid=$pp (== $PPID), uid=$uu, pstart=$ps_ within 2 s of ps lstart ($pst)" $?
sleep 0 & cpid=$!; wait $cpid
[[ $("$B" pidinfo $cpid) == "pid=$cpid identity=dead" ]]; ck "a reaped child is dead" $?
"$B" pidinfo nope >/dev/null 2>&1; ck "pidinfo of a non-pid exits 2" $(( $? == 2 ? 0 : 1 ))
[[ $("$B" pidinfo 1) == *comm=launchd*identity=alive* ]]; ck "another user's process (launchd) is resolved via kern.proc" $?

# ACT-1: comm stays percent-encoded, and protected=0|1 is computed by the sensor from
# SCHEMA §5's ONE list on the DECODED name (the governor matched 'Claude Helper*'
# against 'Claude%20Helper' and signalled every Claude helper).
mkdir -p "$ROOT/ch"; CH_BIN="$ROOT/ch/Claude Helper"
print -l '#include <unistd.h>' 'int main(void) { for (;;) pause(); }' >"$ROOT/ch/ch.c"
if xcrun clang -O0 -o "$CH_BIN" "$ROOT/ch/ch.c" >/dev/null 2>&1; then
  "$CH_BIN" & CHP=$!; note_pid $CHP; sleep 0.2
  line=$("$B" pidinfo $CHP)
  [[ $line == *" protected=1 comm=Claude%20Helper identity=alive" ]]; ck "[ACT-1] 'Claude Helper' -> protected=1, comm=Claude%20Helper still encoded and last before identity ($line)" $?
  kill -9 $CHP 2>/dev/null
else
  note "clang unavailable: the 'Claude Helper' arm is skipped"
fi
[[ $("$B" pidinfo $$) == *" uid=$UID protected=0 comm=zsh identity=alive" ]]; ck "[ACT-1] this gate's own zsh -> protected=0" $?
[[ $("$B" pidinfo 1) == *" protected=1 comm=launchd "* ]]; ck "[ACT-1] pid 1 (launchd, root) -> protected=1" $?
RP=$(ps -axo pid=,uid=,comm= | awk '$2 == 0 && $1 > 1 && $3 !~ /launchd$/ { print $1; exit }')
[[ $("$B" pidinfo $RP) == *" uid=0 protected=1 "* ]]; ck "[ACT-1] a root-owned pid ($RP) -> protected=1 (another uid)" $?
DG=$ROOT/dg; mkdir -p "$DG/guardian.lock" "$ROOT/fg"
print -r -- 'zmodload zsh/zselect; while :; do zselect -t 360000; done' >"$ROOT/fg/forge-guardian"
zsh "$ROOT/fg/forge-guardian" & FG=$!; note_pid $FG
print -r -- $FG >"$DG/guardian.lock/pid"; ps -p $FG -o lstart= >"$DG/guardian.lock/started"
sleep 30 & SL=$!; note_pid $SL
out=$("$B" pidinfo --state-dir "$DG" $FG $$ $SL)
[[ ${(f)out}[1] == *" protected=1 "* && ${(f)out}[2] == *" protected=1 "* && ${(f)out}[3] == *" protected=0 "* ]]
ck "[ACT-1] --state-dir: the guardian.lock holder and its ancestor (this shell) protected=1, a plain sleeper protected=0" $?
kill -9 $FG $SL 2>/dev/null

# ================================================================ E. run mode
sect "E. run mode"
D1=$ROOT/d1
write_policy "$D1"
print -r -- "torn" >"$D1/sensor.json.tmp.99999"; print -r -- "keep" >"$D1/unrelated.tmp.99999"
start_sensor "$D1" --poll 1
S1=$SPID
t0=$EPOCHREALTIME
wait_until 3 '[[ -s $D1/sensor.env && -s $D1/sensor.json ]]'
r_=$?; ck "sensor.env + sensor.json appear ($(printf '%.2f' $(( EPOCHREALTIME - t0 ))) s; limit 2 polls + start)" $r_
[[ ! -e $D1/sensor.json.tmp.99999 && -e $D1/unrelated.tmp.99999 ]]; ck "a stale sensor tmp file from a killed sensor is removed at start; nothing else" $?
agree=1
for i in {1..10}; do
  e_seq=$(envv "$D1/sensor.env" seq); j_seq=$(pyj "$D1/sensor.json" 'd["seq"]')
  if [[ $e_seq == $j_seq ]]; then
    e_v=$(envv "$D1/sensor.env" vmp); j_v=$(pyj "$D1/sensor.json" 'd["signals"]["vm_pressure"]["value"]')
    e_t=$(envv "$D1/sensor.env" thermal); j_t=$(pyj "$D1/sensor.json" 'd["signals"]["thermal"]["value"]')
    e_s2=$(envv "$D1/sensor.env" seq)
    [[ $e_s2 == $e_seq ]] || continue
    [[ $e_v == $j_v && $e_t == $j_t ]] && agree=0
    break
  fi
  sleep 0.05
done
ck "sensor.env and sensor.json agree (seq=$e_seq vmp=$e_v thermal=$e_t)" $agree
s_a=$(envv "$D1/sensor.env" seq); sleep 2.2; s_b=$(envv "$D1/sensor.env" seq)
(( s_b > s_a )); ck "seq advances ($s_a -> $s_b in 2.2 s at --poll 1)" $?
[[ $(stat -f %Lp "$D1/sensor.env") == 600 && $(stat -f %Lp "$D1/sensor.json") == 600 && $(stat -f %Lp "$D1/session") == 700 \
   && $(stat -f %Lp "$D1/events/inbox") == 700 && $(stat -f %Lp "$D1/session/current.json") == 600 ]]
ck "umask 077: published files 0600, directories the sensor creates 0700" $?
"$B" run --state-dir "$ROOT/fresh" --poll 1 >/dev/null 2>&1 & fpid=$!; note_pid $fpid
wait_until 3 '[[ -s $ROOT/fresh/sensor.env ]]'; kill -TERM $fpid; wait_until 3 '! alive $fpid'
[[ $(stat -f %Lp "$ROOT/fresh") == 700 ]]; ck "a domain dir the sensor creates is 0700" $?
[[ -s $D1/policy.env ]] && grep -q '^poll_s=5$' "$D1/policy.env"; ck "policy.env written at start" $?

"$B" run --state-dir "$D1" --poll 1 >"$ROOT/dup.out" 2>&1 &
dpid=$!; note_pid $dpid
wait_until 5 '! alive $dpid'; wait $dpid; drc=$?
(( drc == 3 )) && grep -q "pid $S1" "$ROOT/dup.out"; ck "a second run on the same domain exits 3 naming the holder (rc=$drc)" $?

print -r -- "vmp=4" >"$FORGE_SENSOR_INJECT"
wait_until 3 '[[ $(envv $D1/sensor.env vmp) == 4 ]]'
[[ $(envv "$D1/sensor.env" vmp) == 4 && $(envv "$D1/sensor.env" vmp_st) == ok ]]; ck "injection vmp=4 reflected (vmp=4 vmp_st=ok)" $?
print -r -- "thermal_st=unavailable" >"$FORGE_SENSOR_INJECT"
wait_until 3 '[[ $(envv $D1/sensor.env thermal_st) == unavailable ]]'
[[ $(envv "$D1/sensor.env" thermal) == none && $(envv "$D1/sensor.env" thermal_st) == unavailable ]]
ck "thermal_st=unavailable -> 'thermal=none thermal_st=unavailable'" $?
sleep 0.3
[[ $(pyj "$D1/sensor.json" 'd["signals"]["thermal"]["value"]') == None && $(envv "$D1/sensor.env" vmp_st) == ok ]]
ck "  ...json value null; the other signals still ok (one failure blocks nothing)" $?
print -r -- "freepct=-5"$'\n'"swap_used_mb=900"$'\n'"swap_total_mb=100"$'\n'"mem_st=unavailable" >"$FORGE_SENSOR_INJECT"
wait_until 3 '[[ $(envv $D1/sensor.env freepct_st) == invalid ]]'
[[ $(envv "$D1/sensor.env" freepct_st) == invalid && $(envv "$D1/sensor.env" freepct) == -1 \
   && $(envv "$D1/sensor.env" swap_st) == invalid && $(envv "$D1/sensor.env" swap_used_mb) == -1 \
   && $(envv "$D1/sensor.env" mem_st) == unavailable && $(envv "$D1/sensor.env" mem_total_b) == -1 \
   && $(envv "$D1/sensor.env" budget_b) == -1 && $(envv "$D1/sensor.env" thermal_st) == ok ]]
ck "negative -> invalid; used > total -> invalid; unavailable -> -1; derived budget -> -1" $?
sleep 0.3
[[ $(envv "$D1/sensor.env" overcommit) == -1 && $(pyj "$D1/sensor.json" 'd["reservations"]["overcommit"]') == None ]]
ck "[SEM-6] budget unavailable -> overcommit=-1 in .env and null in .json, never a healthy-looking 0/false" $?
: >"$FORGE_SENSOR_INJECT"
wait_until 3 '[[ $(envv $D1/sensor.env freepct_st) == ok ]]'; ck "injection cleared -> real values back" $?
[[ $(envv "$D1/sensor.env" overcommit) == (0|1) && $(pyj "$D1/sensor.json" 'd["reservations"]["overcommit"] in (True, False)') == True ]]
ck "[SEM-6] A/B: budget available again -> overcommit is a 0|1 verdict" $?

grep '"kind":"thermal"' "$D1/events.jsonl" | grep -q '"state":"none","prev":"nominal"' \
  && grep '"kind":"thermal"' "$D1/events.jsonl" | grep -q '"state":"nominal","prev":"none"'
ck "thermal events on each change (nominal -> none -> nominal)" $?
GiB=1073741824
write_policy "$D1" '"memory": {"os_reserve_gb": 4}'
wait_until 3 'grep -qx "memory_os_reserve_gb=4" $D1/policy.env'; ck "policy.json changed -> policy.env rewritten (mtime watch)" $?
wait_until 3 '[[ $(envv $D1/sensor.env budget_b) == $(( $(sysctl -n hw.memsize) - 4 * GiB )) ]]'; ck "  ...and the budget follows (mem_total - 4 GiB)" $?
print -r -- '{"disk": {"floors_gib": {"yellow": 1, "orange": 2, "red": 3}}}' >"$D1/policy.json"
wait_until 3 '(( $(count_kind $D1/events.jsonl policy_error) >= 1 ))'
(( $(count_kind "$D1/events.jsonl" policy_error) >= 1 )) && grep -qx 'memory_os_reserve_gb=6' "$D1/policy.env"
ck "an invalid policy.json -> policy_error event and the defaults in effect" $?
write_policy "$D1"; sleep 0.2; kill -HUP $S1
wait_until 3 'grep -q "policy loaded (SIGHUP)" $D1/log/sensor.log'; ck "SIGHUP reloads the policy" $?
! grep -q 'IORegisterForSystemPower failed\|memory-pressure source unavailable' "$D1/log/sensor.log"
ck "the memory-pressure source and the IOKit power notification registered" $?

t0=$EPOCHREALTIME
kill -TERM $S1
wait_until 3 '! alive $S1'; wait $S1; trc=$?
note "SIGTERM -> exit in $(printf '%.0f' $(( (EPOCHREALTIME - t0) * 1000 ))) ms"
(( trc == 0 )); ck "SIGTERM -> exit 0" $?
[[ $(pyj "$D1/session/current.json" 'd["orderly_stop"]') == True ]]; ck "  ...session orderly_stop true" $?
tail -1 "$D1/events.jsonl" | grep -q '"kind":"sensor_stop","orderly":true'; ck "  ...sensor_stop event, orderly true" $?
json_ok "$D1/sensor.json" && [[ -s $D1/sensor.env ]]; ck "  ...published files left in place" $?

# rotation
D7=$ROOT/d7; write_policy "$D7" '"logs": {"rotate_mib": 1, "generations": 2}'
python3 -I -c 'import json,sys
with open(sys.argv[1],"w") as f:
    for i in range(9000): f.write(json.dumps({"ts":1.0,"kind":"filler","i":i,"pad":"x"*100})+"\n")' "$D7/events.jsonl"
print -r -- '{"ts":0,"kind":"gen1"}' >"$D7/events.jsonl.1"
start_sensor "$D7" --poll 1; S7=$SPID
wait_until 4 '[[ -e $D7/events.jsonl.2 ]]'
[[ $(<"$D7/events.jsonl.2") == '{"ts":0,"kind":"gen1"}' ]] && (( $(stat -f %z "$D7/events.jsonl.1") > 1048576 )) \
  && (( $(stat -f %z "$D7/events.jsonl" 2>/dev/null || print 0) < 65536 ))
ck "events.jsonl rotates at logs.rotate_mib (1 MiB): .1 -> .2, current -> .1, fresh current" $?
kill -TERM $S7; wait_until 3 '! alive $S7'

# R3: logs.generations=1e9 made every rotation 1e9 renames on the main queue: the
# sensor sat at 100 % CPU and ignored SIGTERM and parent exit. Rejected now, and the
# rotation loop is bounded whatever it is given.
D7b=$ROOT/d7b; write_policy "$D7b" '"logs": {"rotate_mib": 1, "generations": 1000000000}'
python3 -I -c 'import json,sys
with open(sys.argv[1],"w") as f:
    for i in range(18000): f.write(json.dumps({"ts":1.0,"kind":"filler","i":i,"pad":"x"*100})+"\n")' "$D7b/events.jsonl"
start_sensor "$D7b" --poll 1; S7b=$SPID
wait_until 3 '[[ -s $D7b/sensor.env ]]'; sleep 1.5
t0=$EPOCHREALTIME; kill -TERM $S7b
wait_until 3 '! alive $S7b'; gone=$?
note "generations=1e9: SIGTERM -> $( (( gone == 0 )) && printf 'exit in %.0f ms' $(( (EPOCHREALTIME - t0) * 1000 )) || print 'STILL ALIVE after 3 s')"
(( gone == 0 )) && grep -q 'policy rejected' "$D7b/log/sensor.log"
ck "[R3] a policy with logs.generations=1e9 is rejected, and the sensor still answers SIGTERM within 3 s" $?
alive $S7b && kill -9 $S7b 2>/dev/null

# FO-3: thermal may be left out of required_signals, and that is logged at every start.
D12=$ROOT/d12; write_policy "$D12" '"required_signals": ["vm_pressure", "swap", "pageouts", "disk"]'
start_sensor "$D12" --poll 1; S12=$SPID
wait_until 3 '[[ -s $D12/sensor.env ]]'
grep -qx 'required_signals=vm_pressure swap pageouts disk' "$D12/policy.env" && grep -q 'omits thermal' "$D12/log/sensor.log"
ck "[FO-3] required_signals without thermal: accepted and logged at start" $?
kill -TERM $S12; wait_until 3 '! alive $S12'

# ================================================================ F. parent + SIGUSR2
sect "F. parent death and SIGUSR2 to the governor"
D2=$ROOT/d2
write_policy "$D2"
cat >"$ROOT/fake_parent.zsh" <<'FP'
zmodload zsh/datetime
trap 'print -r -- $EPOCHREALTIME >>"$USR2_LOG"' USR2
"$@" --parent $$ &
spid=$!
print -r -- $spid >"$SPID_FILE"
while kill -0 $spid 2>/dev/null; do wait $spid; done
FP
: >"$ROOT/usr2.log"
print -r -- "pressure=critical" >"$ROOT/ev_inject"
USR2_LOG=$ROOT/usr2.log SPID_FILE=$ROOT/s2.pid FORGE_SENSOR_INJECT_EVENT=$ROOT/ev_inject \
  zsh "$ROOT/fake_parent.zsh" "$B" run --state-dir "$D2" --poll 1 >>"$ROOT/sensor.out" 2>&1 &
FPID=$!; note_pid $FPID
wait_until 3 '[[ -s $ROOT/s2.pid ]]'
S2=$(<"$ROOT/s2.pid"); note_pid $S2
wait_until 3 '[[ $(envv $D2/sensor.env pid) == $S2 ]]'
[[ $("$B" pidinfo $S2) == *"ppid=$FPID "* ]]; ck "sensor runs as a child of the fake governor ($FPID)" $?
crit0=$(envv "$D2/sensor.env" pevent_crit_n)
t0=$EPOCHREALTIME
kill -USR1 $S2
wait_until 2 '[[ -s $ROOT/usr2.log ]]'
t1=$(head -1 "$ROOT/usr2.log" 2>/dev/null)
lat_ms=$(( t1 > 0 ? (t1 - t0) * 1000 : 99999 ))
note "SIGUSR2 latency (inject -> governor trap): $(printf '%.1f' $lat_ms) ms"
(( t1 > 0 && lat_ms < 1000 )); ck "injected critical pressure delivers SIGUSR2 to the parent within 1 s" $?
grep -q '"kind":"pressure","level":"critical"' "$D2/events.jsonl"; ck "  ...pressure event appended (level critical)" $?
[[ $(envv "$D2/sensor.env" pevent) == critical && $(envv "$D2/sensor.env" pevent_crit_n) == $(( crit0 + 1 )) ]]
r_=$?; ck "  ...published before the signal: pevent=critical, crit_n $crit0 -> $(envv "$D2/sensor.env" pevent_crit_n)" $r_
n_before=$(wc -l <"$ROOT/usr2.log")
print -r -- "pressure=normal" >"$ROOT/ev_inject"
kill -USR1 $S2; sleep 1.2
n_after=$(wc -l <"$ROOT/usr2.log")
(( n_after == n_before )) && [[ $(envv "$D2/sensor.env" pevent) == normal ]]
ck "A/B: a NORMAL pressure event does not signal the governor ($n_before -> $n_after USR2)" $?
print -r -- "pressure=warn" >"$ROOT/ev_inject"
kill -USR1 $S2
wait_until 2 '(( $(wc -l <$ROOT/usr2.log) > n_after ))'; ck "  ...and WARN does" $?

print -r -- "sleep" >"$ROOT/ev_inject"; kill -USR1 $S2
wait_until 2 '(( $(count_kind $D2/events.jsonl will_sleep) == 1 ))'
[[ $(pyj "$D2/session/current.json" 'd["asleep"] and d["last_sleep_ts"] is not None') == True ]]
ck "injected sleep -> will_sleep event, session persisted as asleep" $?
sleep 1.1
print -r -- "wake" >"$ROOT/ev_inject"; kill -USR1 $S2
rb=0; for i in {1..60}; do [[ $(envv "$D2/sensor.env" rebaseline) == 1 ]] && { rb=1; break }; sleep 0.01; done
wait_until 2 '(( $(count_kind $D2/events.jsonl did_wake) == 1 ))'
slept=$(grep '"kind":"did_wake"' "$D2/events.jsonl" | python3 -I -c 'import json,sys; print(json.loads(sys.stdin.read())["slept_s"])')
(( slept >= 1.0 && slept < 3.0 )) && (( rb == 1 )) && [[ $(envv "$D2/sensor.env" sleep_n) == 1 && $(pyj "$D2/session/current.json" 'd["asleep"]') == False ]]
ck "injected wake -> did_wake (slept_s=$slept), an immediate rebaseline=1 snapshot, sleep_n=1" $?

t0=$EPOCHREALTIME
kill -9 $FPID
wait_until 3 '! alive $S2'
pd=$(( EPOCHREALTIME - t0 ))
note "parent SIGKILL -> sensor exit in $(printf '%.0f' $(( pd * 1000 ))) ms"
! alive $S2 && (( pd < 2.0 )); ck "parent death -> sensor exits within 2 s" $?
tail -1 "$D2/events.jsonl" | grep -q '"reason":"parent_exit"'; ck "  ...recorded as sensor_stop reason parent_exit" $?

# ================================================================ G. session
sect "G. session continuity"
D3=$ROOT/d3; R3=$ROOT/reps3; mkdir -p "$R3"
write_policy "$D3"
cls_of() { pyj "$D3/session/previous.json" 'd["classification"]' }
run3() { # run3 BOOT -> S3
  FORGE_SENSOR_TEST_BOOT_UUID=$1 FORGE_SENSOR_TEST_REPORT_DIRS=$R3 "$B" run --state-dir "$D3" --poll 1 >>"$ROOT/sensor.out" 2>&1 &
  S3=$!; note_pid $S3
  wait_until 3 "[[ \$(pyj $D3/session/current.json 'd[\"sensor_pid\"]') == $S3 ]]"
}
run3 BOOT-A; kill -9 $S3; wait $S3 2>/dev/null
run3 BOOT-A
[[ $(cls_of) == service_interrupted ]]; r_=$?; ck "kill -9, same boot -> service_interrupted ($(cls_of))" $r_
kill -TERM $S3; wait_until 3 '! alive $S3'
run3 BOOT-B
[[ $(cls_of) == orderly_stop_then_reboot ]]; r_=$?; ck "orderly stop + new boot uuid -> orderly_stop_then_reboot ($(cls_of))" $r_
kill -9 $S3; wait $S3 2>/dev/null
sleep 1.1; : >"$R3/x.panic"            # dated inside the gap: after the last heartbeat
run3 BOOT-C
[[ $(cls_of) == kernel_panic && $(pyj "$D3/session/previous.json" 'd["evidence"]["panic_report"]') == $R3/x.panic ]]
ck "kill -9 + new boot + a .panic dated in the gap -> kernel_panic, report path recorded" $?
ls -d "$D3"/incidents/*-unclean_boot >/dev/null 2>&1; ck "  ...an unclean_boot incident bundle was created" $?
kill -9 $S3; wait $S3 2>/dev/null
touch -t "$(date -r $(( EPOCHSECONDS - 3600 )) +%Y%m%d%H%M.%S)" "$R3/x.panic"   # now OUTSIDE the next gap
run3 BOOT-D
[[ $(cls_of) == unclean_unknown && $(pyj "$D3/session/previous.json" 'd["evidence"]["panic_report"]') == None ]]
ck "kill -9 + new boot, nothing in the gap -> unclean_unknown (never asserted a panic)" $?
"$B" session --state-dir "$D3" >"$ROOT/sess.json"
[[ $(pyj "$ROOT/sess.json" 'd["previous"]["classification"]') == unclean_unknown && $(pyj "$ROOT/sess.json" 'd["current"]["boot_uuid"]') == BOOT-D ]]
ck "'session' prints previous (classified) and current" $?
(( $(wc -l <"$D3/session/boots.jsonl") == 4 )); ck "boots.jsonl has one line per classified start (4)" $?
kill -TERM $S3; wait_until 3 '! alive $S3'

# ================================================================ H. reports
sect "H. DiagnosticReports classification"
RP=$ROOT/reps; mkdir -p "$RP"
mkjetsam() { # mkjetsam FILE REASON...
  local f=$1; shift
  python3 -I - "$f" "$@" <<'PY'
import json,sys
f=sys.argv[1]; reasons=sys.argv[2:]
procs=[{"name":"proc%d"%i,"pid":100+i,"reason":r} for i,r in enumerate(reasons)]+[{"name":"Python","pid":99,"rpages":1}]
with open(f,"w") as o:
    o.write(json.dumps({"bug_type":"298","os_version":"macOS test"})+"\n")
    o.write(json.dumps({"largestProcess":"Python","processes":procs},indent=2))
PY
}
mkjetsam "$RP/JetsamEvent-2026-10-07-000001.ips" per-process-limit
mkjetsam "$RP/JetsamEvent-2026-10-07-000002.ips" vm-pageshortage per-process-limit
print -r -- '{"bug_type":"210","panic_string":"panic(cpu 1): watchdog timeout\nmore"}' >"$RP/panic-full-2026-10-07-000003.panic"
: >"$RP/WindowServer_2026-10-07-000004.ips"; : >"$RP/Python_2026-10-07-000005_Satvik.ips"
: >"$RP/disk writes_2026-10-07-000006_Satvik.diag"; : >"$RP/shutdown_stall_2026-10-07.shutdownStall"
: >"$RP/GPURestart_2026-10-07.ips"; : >"$RP/random.txt"
"$B" reports --since 0 --dirs "$RP" >"$ROOT/reps.json"; ck "reports exits 0" $?
python3 -I - "$ROOT/reps.json" <<'PY'
import json,sys
r={x["file"]:x for x in json.load(open(sys.argv[1]))}
want={"JetsamEvent-2026-10-07-000001.ips":"jetsam","JetsamEvent-2026-10-07-000002.ips":"jetsam",
 "panic-full-2026-10-07-000003.panic":"panic","WindowServer_2026-10-07-000004.ips":"windowserver",
 "Python_2026-10-07-000005_Satvik.ips":"app_crash","disk writes_2026-10-07-000006_Satvik.diag":"resource",
 "shutdown_stall_2026-10-07.shutdownStall":"shutdown_stall","GPURestart_2026-10-07.ips":"gpu","random.txt":"other"}
bad=[(k,v,r.get(k,{}).get("category")) for k,v in want.items() if r.get(k,{}).get("category")!=v]
print("    ..   categories mismatched:",bad) if bad else None
sys.exit(1 if bad else 0)
PY
ck "all 9 SCHEMA §10 categories classified" $?
s1=$(pyj "$ROOT/reps.json" '[x for x in d if x["file"].endswith("000001.ips")][0]["summary"]')
[[ $s1 == *"per-process limit, not system-wide exhaustion"* && $(pyj "$ROOT/reps.json" '[x for x in d if x["file"].endswith("000001.ips")][0]["incident_worthy"]') == False ]]
ck "per-process-only Jetsam summarized as per-process, no incident ('${s1[1,70]}...')" $?
s2=$(pyj "$ROOT/reps.json" '[x for x in d if x["file"].endswith("000002.ips")][0]["summary"]')
[[ $s2 != *"per-process limit"* && $s2 == *vm-pageshortage* && $(pyj "$ROOT/reps.json" '[x for x in d if x["file"].endswith("000002.ips")][0]["incident_worthy"]') == True ]]
ck "vm-pageshortage Jetsam is NOT per-process and is incident-worthy" $?
[[ $(pyj "$ROOT/reps.json" '[x for x in d if x["category"]=="panic"][0]["summary"]') == "panic: panic(cpu 1): watchdog timeout" ]]
ck "panic summary carries the first panic_string line" $?
# SEM-1: the real report this machine produced moved into Retired/ at macOS's daily
# run, and the check that guarded on the top-level path silently stopped running. Look
# in both; a report present in neither is a logged skip, one found but misclassified
# is a failure.
REAL=""
for rd in /Library/Logs/DiagnosticReports /Library/Logs/DiagnosticReports/Retired; do
  [[ -r $rd/JetsamEvent-2026-10-07-181917.ips ]] && { REAL=$rd; break; }
done
if [[ -n $REAL ]]; then
  "$B" reports --since 1791400000 --until 1791500000 --dirs "$REAL" >"$ROOT/real.json"
  rs=$(pyj "$ROOT/real.json" '[x for x in d if x["file"]=="JetsamEvent-2026-10-07-181917.ips"][0]["summary"]')
  note "real report ($REAL): $rs"
  [[ $rs == *"per-process limit, not system-wide exhaustion"*knowledgeconstructiond*Python* ]]
  ck "the REAL JetsamEvent-2026-10-07-181917.ips: per-process (knowledgeconstructiond), largest Python" $?
else
  note "SKIPPED (logged): JetsamEvent-2026-10-07-181917.ips is in neither /Library/Logs/DiagnosticReports nor its Retired/ on this machine"
fi
RR=$ROOT/repsR; mkdir -p "$RR/Retired"
mkjetsam "$RR/Retired/JetsamEvent-2026-10-03-215334.ips" jettisoned vm-compressor-space-shortage
cp -p "$RR/Retired/JetsamEvent-2026-10-03-215334.ips" "$RR/JetsamEvent-2026-10-03-215334.ips"   # same report, both places
mkjetsam "$RR/Retired/JetsamEvent-2026-10-07-181917.ips" per-process-limit
FORGE_SENSOR_TEST_REPORT_DIRS=$RR "$B" reports --since 0 >"$ROOT/repsR.json"
[[ $(pyj "$ROOT/repsR.json" 'sorted(x["file"] for x in d)') == "['JetsamEvent-2026-10-03-215334.ips', 'JetsamEvent-2026-10-07-181917.ips']" ]]
ck "[SEM-1] the default report dirs include Retired/: a report found only there is listed" $?
[[ $(pyj "$ROOT/repsR.json" '[x["path"] for x in d if x["file"].startswith("JetsamEvent-2026-10-03")]') == "['$RR/JetsamEvent-2026-10-03-215334.ips']" ]]
ck "[SEM-1] the same report in the top level and in Retired/ (same name and mtime) is listed ONCE, the top-level copy" $?
[[ $(pyj "$ROOT/repsR.json" '[x["incident_worthy"] for x in d if x["file"].startswith("JetsamEvent-2026-10-03")][0]') == True ]]
ck "[SEM-1] ...and the system-wide (compressor-space-shortage) kill found in Retired/ is incident-worthy" $?

# run-mode scanning: baseline on first run, events + incident afterwards
D4=$ROOT/d4; R4=$ROOT/reps4; mkdir -p "$R4"
write_policy "$D4"
cp "$RP/JetsamEvent-2026-10-07-000001.ips" "$R4/"
mkdir -p "$R4/Retired"; mkjetsam "$R4/Retired/JetsamEvent-2026-10-03-215334.ips" jettisoned vm-compressor-space-shortage
FORGE_SENSOR_TEST_REPORT_DIRS=$R4 start_sensor "$D4" --poll 1
S4=$SPID
wait_until 3 '[[ -s $D4/session/reports_baseline.json ]]'
[[ $(pyj "$D4/session/reports_baseline.json" 'd["categories"]["jetsam"]["count"]') == 2 ]]
ck "[SEM-1] first run writes reports_baseline.json counting Retired/ too (jetsam count 2)" $?
[[ $(pyj "$D4/session/reports_baseline.json" 'any("vm-compressor-space-shortage" in x["summary"] for x in d["categories"]["jetsam"]["details"])') == True ]]
ck "[SEM-1] ...the retired system-wide compressor-exhaustion kill is in the baseline details" $?
sleep 1.5
(( $(count_kind "$D4/events.jsonl" report) == 0 )) && [[ ! -d $D4/incidents ]]
ck "  ...and emits no report events and no incidents" $?
mkjetsam "$R4/JetsamEvent-2026-10-08-000002.ips" vm-pageshortage
wait_until 4 '(( $(count_kind $D4/events.jsonl report) >= 1 ))'
grep '"kind":"report"' "$D4/events.jsonl" | grep -q 'vm-pageshortage'; ck "a new pageshortage Jetsam -> report event" $?
wait_until 3 'ls -d $D4/incidents/*-report >/dev/null 2>&1'
ls -d "$D4"/incidents/*-report >/dev/null 2>&1 && json_ok "$(print -l "$D4"/incidents/*-report(N) | head -1)/summary.json"
ck "  ...and an incident bundle with a valid summary.json" $?
mkjetsam "$R4/JetsamEvent-2026-10-08-000003.ips" per-process-limit
wait_until 4 '(( $(count_kind $D4/events.jsonl report) >= 2 ))'
ninc=$(print -l "$D4"/incidents/*-report(N) | wc -l | tr -d ' ')
(( $(count_kind "$D4/events.jsonl" report) == 2 && ninc == 1 )); ck "a per-process Jetsam -> report event but no second incident ($ninc)" $?
mkjetsam "$ROOT/jx.ips" per-process-limit; mv "$ROOT/jx.ips" "$R4/Retired/JetsamEvent-2026-10-08-000004.ips"
wait_until 4 '(( $(count_kind $D4/events.jsonl report) >= 3 ))'
grep '"kind":"report"' "$D4/events.jsonl" | grep -q 'Retired/JetsamEvent-2026-10-08-000004.ips'
ck "[SEM-1] a report that reaches Retired/ between two scans (macOS's daily move) -> still a report event" $?
nr0=$(count_kind "$D4/events.jsonl" report)
mv "$R4/JetsamEvent-2026-10-08-000002.ips" "$R4/Retired/"; sleep 2.2
(( $(count_kind "$D4/events.jsonl" report) == nr0 )); ck "[SEM-1] retiring an already-reported file (a move keeps its mtime) does not report it again ($nr0)" $?

# R8: a first run under a clock one day ahead leaves the watermark in the future; after
# the clock is corrected, panic and GPU reports must still be reported.
D11=$ROOT/d11; R11=$ROOT/reps11; mkdir -p "$R11"; write_policy "$D11"
FORGE_SENSOR_TEST_REPORT_DIRS=$R11 FORGE_SENSOR_TEST_NOW=$(( EPOCHSECONDS + 86400 )) start_sensor "$D11" --poll 1; S11=$SPID
wait_until 3 '[[ -s $D11/session/report_watermark ]]'; kill -TERM $S11; wait_until 3 '! alive $S11'
wm11=$(<"$D11/session/report_watermark")
FORGE_SENSOR_TEST_REPORT_DIRS=$R11 start_sensor "$D11" --poll 1; S11=$SPID
wait_until 3 '[[ -s $D11/sensor.env ]]'
: >"$R11/Kernel-2026-10-08-120000.panic"; : >"$R11/gpuRestart-2026-10-08-120000.ips"
wait_until 5 '(( $(count_kind $D11/events.jsonl report) >= 2 ))'
nr=$(count_kind "$D11/events.jsonl" report)
note "watermark after the future-clock run: ${wm11%%.*} (now $EPOCHSECONDS); report events after the correction: $nr"
(( nr == 2 )); ck "[R8] after a backward clock step (watermark 1 day ahead) a new panic and a GPU report are still reported ($nr)" $?
sleep 2.2
(( $(count_kind "$D11/events.jsonl" report) == 2 )); ck "[R8] ...exactly once each across later scans" $?
kill -TERM $S11; wait_until 3 '! alive $S11'

# ================================================================ I. watch_logs
sect "I. watch_logs"
print -r -- "old history: GPU Hang long ago" >"$ROOT/watch/gpu.log"
sleep 2.2   # the running D4 sensor sees the file and starts at its END
print -r -- "2026-10-08 kIOGPU: GPU Hang detected on queue 3" >>"$ROOT/watch/gpu.log"
wait_until 3 '(( $(count_kind $D4/events.jsonl gpu_error) >= 1 ))'
sleep 1.2
(( $(count_kind "$D4/events.jsonl" gpu_error) == 1 )); ck "an appended pattern -> exactly one gpu_error event (history ignored)" $?
grep '"kind":"gpu_error"' "$D4/events.jsonl" | grep -q '"line":"2026-10-08 kIOGPU: GPU Hang detected on queue 3"'
ck "  ...carrying the source and the line" $?
print -r -- "GPU Hang again" >>"$ROOT/watch/gpu.log"; sleep 2.2
(( $(count_kind "$D4/events.jsonl" gpu_error) == 1 )); ck "the same pattern within 60 s is rate-limited (still 1)" $?
: >"$ROOT/watch/gpu.log"; sleep 1.2
print -r -- "MTLCommandBufferError: out of memory" >>"$ROOT/watch/gpu.log"
wait_until 3 '(( $(count_kind $D4/events.jsonl gpu_error) >= 2 ))'
(( $(count_kind "$D4/events.jsonl" gpu_error) == 2 )); ck "truncation handled: a new line after truncation is read (2 events)" $?
kill -TERM $S4; wait_until 3 '! alive $S4'

# ================================================================ J. inbox
sect "J. events/inbox ingestion"
D5=$ROOT/d5; write_policy "$D5"
start_sensor "$D5" --poll 1
S5=$SPID
wait_until 3 '[[ -s $D5/sensor.env ]]'
mkdir -p "$D5/events/inbox"
{
  print -r -- '{"kind":"gpu_error","n":1}'
  print -r -- 'not json at all'
  print -r -- '{"kind":"stall","n":2,"ts":1.5}'
  print -r -- '[1,2,3]'
  print -r -- "{\"kind\":\"gpu_error\",\"pad\":\"$(printf '%5000s' '' | tr ' ' x)\"}"
  print -r -- '{"kind":"cancel_latency","n":3}'
  print -r -- '{"foo":1}'                                                   # SEM-7: no kind
  print -r -- '{"kind":"stall","from":"RED","n":5,"ts":"later"}'            # SEM-7: ts not a number
  print -r -- '{"kind":"transition","from":"RED","to":"GREEN","n":6}'       # SEM-7: a governor-only kind
  print -r -- '{"kind":true,"n":7}'                                         # SEM-7: kind not a string
  print -r -- '{"z":{"ts":1},"kind":"gpu_error","n":4,"detail":{"ts":2}}'  # nested ts keys
} >"$D5/events/inbox/app.jsonl.tmp"
mv "$D5/events/inbox/app.jsonl.tmp" "$D5/events/inbox/app.jsonl"
wait_until 4 '[[ ! -e $D5/events/inbox/app.jsonl && $(envv $D5/sensor.env inbox_invalid) -ge 3 ]]'
[[ ! -e $D5/events/inbox/app.jsonl ]]; ck "inbox file removed after ingestion" $?
(( $(grep -c '"source":"app.jsonl"' "$D5/events.jsonl") == 4 )); ck "4 valid lines copied with source=app.jsonl" $?
[[ $(envv "$D5/sensor.env" inbox_invalid) == 7 && $(envv "$D5/sensor.env" inbox_ingested) == 4 ]]
r_=$?; ck "[SEM-7] 7 invalid lines counted (non-JSON, non-object, > 4 KiB, no kind, string ts, governor-only kind, non-string kind): ingested $(envv "$D5/sensor.env" inbox_ingested), invalid $(envv "$D5/sensor.env" inbox_invalid)" $r_
python3 -I - "$D5/events.jsonl" <<'PY'
import json, sys
bad = []
for l in open(sys.argv[1]):
    o = json.loads(l)
    if o.get("source") != "app.jsonl": continue
    if not (isinstance(o.get("kind"), str) and isinstance(o.get("ts"), (int, float)) and not isinstance(o.get("ts"), bool)): bad.append(l)
    if o.get("kind") in ("transition", "shed", "reap"): bad.append(l)
    if not l.startswith('{"ts":'): bad.append("ts not first: " + l)
sys.exit(1 if bad else 0)
PY
ck "[SEM-7] every ingested line has a string kind a producer may send and a numeric ts, written FIRST" $?
grep '"n":2' "$D5/events.jsonl" | grep -q '"ts":1.5'; ck "  ...a producer's own ts is kept" $?
# SEM-7: lines whose nested "ts" keys come first must not be dropped from (or mis-windowed
# in) an incident bundle.
python3 -I -c 'import json,sys
with open(sys.argv[1],"w") as f:
    for i,k in enumerate("abcdefghijklmnopqrstuvwx"): f.write(json.dumps({k:{"ts":1},"kind":"gpu_error","i":i})+"\n")' "$D5/events/inbox/nest.jsonl.tmp"
mv "$D5/events/inbox/nest.jsonl.tmp" "$D5/events/inbox/nest.jsonl"
wait_until 4 '[[ ! -e $D5/events/inbox/nest.jsonl ]]'; sleep 0.3
IDN=$("$B" incident --state-dir "$D5" --kind manual --window-min 5 2>/dev/null)
nn=$(grep -c '"source":"nest.jsonl"' "$IDN/events.jsonl" 2>/dev/null || print 0)
(( nn == 24 )); ck "[SEM-7] all 24 inbox lines with nested ts keys are in the incident window ($nn)" $?
kill -TERM $S5; wait_until 3 '! alive $S5'

# R10: an inbox file that cannot be removed is ingested ONCE, not on every tick.
D10=$ROOT/d10; write_policy "$D10"; mkdir -p "$D10/events/inbox"
for i in 1 2 3; do print -r -- "{\"kind\":\"stall\",\"i\":$i}"; done >"$D10/events/inbox/z.jsonl"
chmod 500 "$D10/events/inbox"
start_sensor "$D10" --poll 1; S10=$SPID
wait_until 3 '[[ -s $D10/sensor.env ]]'; sleep 4
ing=$(envv "$D10/sensor.env" inbox_ingested)
(( ing == 3 )) && (( $(grep -c '"source":"z.jsonl"' "$D10/events.jsonl") == 3 ))
ck "[R10] an unremovable inbox file (chmod 500 inbox) is ingested once in 4+ ticks (inbox_ingested=$ing)" $?
(( $(grep -c 'z.jsonl not removed' "$D10/log/sensor.log") == 1 )); ck "[R10] ...and its 'not removed' line is logged once" $?
kill -TERM $S10; wait_until 3 '! alive $S10'; chmod 700 "$D10/events/inbox"

# ================================================================ K. publish failure
sect "K. publish failure: full disk, unwritable dir"
pub_fail_arm() { # pub_fail_arm LABEL D BREAK_CMD FIX_CMD
  local label=$1 d=$2 brk=$3 fix=$4
  write_policy "$d"
  start_sensor "$d" --poll 1
  local sp=$SPID
  wait_until 3 "[[ -s $d/sensor.json ]]"
  local seq0=$(envv "$d/sensor.env" seq) err0=$(envv "$d/sensor.env" errors)
  eval "$brk"
  local i bad=0 seqs=""
  for i in {1..12}; do
    json_ok "$d/sensor.json" || bad=1
    alive $sp || bad=2
    sleep 0.25
  done
  local seq_mid=$(envv "$d/sensor.env" seq)
  eval "$fix"
  wait_until 4 "(( \$(envv $d/sensor.env seq) > $seq_mid ))"
  local seq1=$(envv "$d/sensor.env" seq) err1=$(envv "$d/sensor.env" errors)
  note "$label: seq $seq0 -> $seq_mid (during failure) -> $seq1; errors $err0 -> $err1"
  (( bad == 0 )); ck "$label: sensor.json valid at every read during the failure, sensor alive" $?
  (( seq_mid <= seq0 + 1 )); ck "$label: no partial publication during the failure (seq held at $seq_mid)" $?
  (( seq1 > seq_mid && err1 > err0 )); ck "$label: publishing resumes and the errors counter rose ($err0 -> $err1)" $?
  [[ -z $(print -l "$d"/*.tmp.*(N)) ]]; ck "$label: no tmp files left behind" $?
  alive $sp; ck "$label: the sensor kept running" $?
  kill -TERM $sp; wait_until 3 "! alive $sp"
}
mkdir -p "$ROOT/mnt"
if hdiutil create -size 2m -fs HFS+ -volname fgtest "$ROOT/fg.dmg" >/dev/null 2>&1 \
   && hdiutil attach -nobrowse -mountpoint "$ROOT/mnt" "$ROOT/fg.dmg" >/dev/null 2>&1; then
  MNT=$ROOT/mnt
  pub_fail_arm "full-disk" "$MNT/h" 'dd if=/dev/zero of=$MNT/fill bs=4096 >/dev/null 2>&1; dd if=/dev/zero of=$MNT/fill2 bs=512 >/dev/null 2>&1; sync' 'rm -f $MNT/fill $MNT/fill2'
  grep -q '"kind":"publish_error"' "$MNT/h/events.jsonl" && note "publish_error event recorded on the full disk"
  # RED ON OLD: the 834c7269 governor's publish() on the same full volume.
  if [[ -s $ROOT/old/forge-guardian ]]; then
    OH=$MNT/oldh; mkdir -p "$OH"
    FORGE_HEALTH_DIR=$OH ARCHIE_HEALTH_DIR=$ROOT/old/ah FORGE_GUARDIAN_LIB=1 zsh -c 'source "$1"; O_SWU=0; publish GREEN nominal 8' _ "$ROOT/old/forge-guardian" >/dev/null 2>&1
    dd if=/dev/zero of=$MNT/fill bs=4096 >/dev/null 2>&1; dd if=/dev/zero of=$MNT/fill2 bs=512 >/dev/null 2>&1
    FORGE_HEALTH_DIR=$OH ARCHIE_HEALTH_DIR=$ROOT/old/ah FORGE_GUARDIAN_LIB=1 zsh -c 'source "$1"; O_SWU=0; publish RED pressure 1' _ "$ROOT/old/forge-guardian" >/dev/null 2>&1
    orc=$?
    rm -f $MNT/fill $MNT/fill2
    note "old publish() on the full volume: rc=$orc, state=$(<"$OH/state"), no error counter or event exists in its output"
    (( orc == 0 )) && [[ $(<"$OH/state") == GREEN ]] && ! grep -q errors "$OH/state.json"
    ck "red-on-old: the old publish() reports success (rc 0) while RED was never published and counts nothing" $?
  fi
  hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""
else
  note "hdiutil volume unavailable here: full-disk arm skipped"
fi
# R6: a torn append on a full disk must not glue itself to the next record. On a full
# HFS+ volume write(2) fills the last block's slack and returns short; the fragment had
# no newline, so the next append (anybody's) was glued to it and both were lost.
# Deterministic: cleared.jsonl ends ~1 KiB short of a block boundary, the volume is full,
# and quarantine-clear appends a ~2 KiB record (zero-length quarantine files: removing
# one frees no data block).
mkdir -p "$ROOT/mnt6"
if hdiutil create -size 2m -fs HFS+ -volname fgtorn "$ROOT/fg6.dmg" >/dev/null 2>&1 \
   && hdiutil attach -nobrowse -mountpoint "$ROOT/mnt6" "$ROOT/fg6.dmg" >/dev/null 2>&1; then
  MNT=$ROOT/mnt6
  QD=$MNT/q; mkdir -p "$QD/quarantine"; : >"$QD/admission.lock"
  : >"$QD/quarantine/aaaa.json"; : >"$QD/quarantine/bbbb.json"
  python3 -I -c 'import json,sys
with open(sys.argv[1],"w") as f:
    i=0
    while f.tell() < 3000: f.write(json.dumps({"sig":"pre%d"%i,"reason":"prefill","ts":1.0})+"\n"); i+=1' "$QD/quarantine/cleared.jsonl"
  python3 -I -c 'import os,sys
fd=os.open(sys.argv[1],os.O_WRONLY|os.O_CREAT,0o600)
for bs in (65536,4096,512,1):
    try:
        while True: os.write(fd,b"\0"*bs)
    except OSError: pass
os.close(fd)' "$MNT/fill"
  "$B" quarantine-clear --state-dir "$QD" --sig aaaa --reason "$(printf 'r%.0s' {1..1900})" >/dev/null 2>"$ROOT/torn.err"; trc=$?
  rm -f "$MNT/fill"
  "$B" quarantine-clear --state-dir "$QD" --sig bbbb --reason after >/dev/null 2>&1; arc=$?
  note "on the full volume: rc $trc ($(head -c 120 "$ROOT/torn.err")); after freeing: rc $arc"
  python3 -I -c 'import json,sys
ls=open(sys.argv[1],"rb").read().split(b"\n")
assert ls[-1]==b"", "no trailing newline"
for l in ls[:-1]: json.loads(l)
assert json.loads(ls[-2])["sig"]=="bbbb"' "$QD/quarantine/cleared.jsonl" 2>/dev/null
  ck "[R6] after a short append on a full disk, every line of the ledger is whole JSON and the next record survives (rc $trc then $arc)" $?
  hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""
else
  note "hdiutil volume unavailable here: the torn-append arm is skipped"
fi
D6=$ROOT/d6
pub_fail_arm "unwritable-dir" "$D6" 'chmod 0500 $D6' 'chmod 0700 $D6'
grep -q '"kind":"publish_error".*"errno":13' "$D6/events.jsonl"; ck "unwritable-dir: publish_error event with errno 13 (EACCES)" $?

# ================================================================ M. incidents
sect "M. incident bundles"
D8=$ROOT/d8; write_policy "$D8"
start_sensor "$D8" --poll 1; S8=$SPID
wait_until 3 '[[ -s $D8/sensor.json ]]'
python3 -I -c 'import json,sys,time
now=time.time()
with open(sys.argv[1],"w") as f:
    f.write(json.dumps({"t":int(now-7200),"s":"GREEN","r":"old"})+"\n")
    for i in range(30): f.write(json.dumps({"t":int(now-29+i),"s":"GREEN","r":"recent"})+"\n")' "$D8/history.jsonl"
print -r -- "{\"state\": \"RED\", \"epoch\": $EPOCHSECONDS}" >"$D8/state.json"
t0=$EPOCHREALTIME
"$B" incident --state-dir "$D8" --kind manual --note "gate test" --window-min 1 --with-log >"$ROOT/inc.out" 2>"$ROOT/inc.err"; rc=$?
it=$(( EPOCHREALTIME - t0 ))
IDIR=$(<"$ROOT/inc.out")
note "incident --with-log over 1 min: $(printf '%.2f' $it) s; $IDIR"
(( rc == 0 )) && [[ -d $IDIR && $IDIR == $D8/incidents/*-manual ]]; ck "incident prints the bundle path (incidents/<UTC>-manual)" $?
json_ok "$IDIR/summary.json" && [[ $(pyj "$IDIR/summary.json" 'd["kind"]+"|"+d["note"]+"|"+d["state_json"]["state"]+"|"+str(d["sensor_json"]["schema"])') == "manual|gate test|RED|forge.guardian.sensor/1" ]]
ck "summary.json: kind, note, copies of state.json and sensor.json" $?
(( $(grep -c '"r": "recent"' "$IDIR/history.jsonl") == 30 && $(grep -c '"r": "old"' "$IDIR/history.jsonl") == 0 ))
ck "history.jsonl holds the window only (30 recent lines, not the 2-hour-old one)" $?
[[ -s $IDIR/unified_log.txt && -s $IDIR/reports.json && -s $IDIR/events.jsonl ]]; ck "unified_log.txt, reports.json, events.jsonl present" $?
note "unified log status: $(pyj "$IDIR/summary.json" 'd["files"]["unified_log.txt"]["status"]'), $(stat -f %z "$IDIR/unified_log.txt") bytes"
tot=0; for f in "$IDIR"/*(.); do (( tot += $(stat -f %z "$f") )); done
(( tot <= 512 * 1024 )); ck "bundle within logs.incident_max_kib (512 KiB): $tot bytes" $?
"$B" incident --state-dir "$D8" --kind red --note one >/dev/null 2>&1; r1=$?
"$B" incident --state-dir "$D8" --kind red --note two >/dev/null 2>"$ROOT/inc2.err"; r2=$?
"$B" incident --state-dir "$D8" --kind manual --note again >/dev/null 2>&1; r3=$?
(( r1 == 0 && r2 == 1 && r3 == 0 )) && grep -q rate-limited "$ROOT/inc2.err"
ck "automatic kinds rate-limited (red: 0 then 1), manual is not" $?
"$B" incident --state-dir "$D8" --kind bogus >/dev/null 2>&1; (( $? == 2 )); ck "unknown kind -> 2" $?
grep -q '"kind":"incident","dir":' "$D8/events.jsonl" && ! grep '"kind":"incident"' "$D8/events.jsonl" | grep -q '"kind":"manual"'
ck "incident events carry incident_kind, never a duplicate 'kind' key" $?
D9=$ROOT/d9; mkdir -p "$D9"; print -r -- '{"logs": {"incident_max_kib": 64}}' >"$D9/policy.json"   # the SCHEMA §6 minimum
cp "$D8/history.jsonl" "$D9/"; cp "$D8/sensor.json" "$D9/"
IDIR9=$("$B" incident --state-dir "$D9" --kind manual --window-min 1 --with-log 2>/dev/null)
tot=0; for f in "$IDIR9"/*(.); do (( tot += $(stat -f %z "$f") )); done
(( tot <= 64 * 1024 )) && json_ok "$IDIR9/summary.json"; ck "a 64 KiB cap is honoured too ($tot bytes, summary still valid)" $?
kill -TERM $S8; wait_until 3 '! alive $S8'

# ================================================================ N. test hooks inert
sect "N. test hooks are inert outside FORGE_SENSOR_TEST=1"
print -r -- "vmp=4"$'\n'"thermal=critical" >"$ROOT/inert_inject"
for mode in unset 0 yes; do
  if [[ $mode == unset ]]; then env -u FORGE_SENSOR_TEST FORGE_SENSOR_INJECT=$ROOT/inert_inject FORGE_SENSOR_TEST_BOOT_UUID=FAKE "$B" snapshot >"$ROOT/inert.json"
  else env FORGE_SENSOR_TEST=$mode FORGE_SENSOR_INJECT=$ROOT/inert_inject FORGE_SENSOR_TEST_BOOT_UUID=FAKE "$B" snapshot >"$ROOT/inert.json"; fi
  [[ $(pyj "$ROOT/inert.json" '"injected" not in d and d["boot"]["uuid"]!="FAKE"') == True ]]
  ck "FORGE_SENSOR_TEST=$mode: injection and boot-uuid override ignored" $?
done
env FORGE_SENSOR_TEST=1 FORGE_SENSOR_INJECT=$ROOT/inert_inject FORGE_SENSOR_TEST_BOOT_UUID=FAKE "$B" snapshot >"$ROOT/inert.json"
[[ $(pyj "$ROOT/inert.json" 'd["signals"]["vm_pressure"]["value"]==4 and d["signals"]["thermal"]["value"]=="critical" and d["boot"]["uuid"]=="FAKE"') == True ]]
ck "A/B: with FORGE_SENSOR_TEST=1 the same hooks apply" $?
[[ $(env FORGE_SENSOR_TEST=1 FORGE_SENSOR_TEST_NOW=1700000000 "$B" snapshot | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["ts"])') == 1700000000 \
   && $(env -u FORGE_SENSOR_TEST FORGE_SENSOR_TEST_NOW=1700000000 "$B" snapshot | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["ts"] > 1.7e9 + 86400)') == True ]]
ck "FORGE_SENSOR_TEST_NOW overrides the clock only in test mode" $?
DN=$ROOT/dn; write_policy "$DN"
print -r -- "pressure=critical" >"$ROOT/ev_inert"
env -u FORGE_SENSOR_TEST FORGE_SENSOR_INJECT_EVENT=$ROOT/ev_inert "$B" run --state-dir "$DN" --poll 1 >>"$ROOT/sensor.out" 2>&1 &
SN=$!; note_pid $SN
wait_until 3 '[[ -s $DN/sensor.env ]]'
kill -USR1 $SN; sleep 1.2
alive $SN && (( $(count_kind "$DN/events.jsonl" pressure) == 0 )); ck "outside test mode SIGUSR1 is ignored: sensor alive, no injected pressure event" $?
kill -TERM $SN; wait_until 3 '! alive $SN'

# ================================================================ L. idle cost
sect "L. idle cost at the default poll (5 s)"
cpu_s() { # ps time "M:SS.ss" or "H:MM:SS" -> seconds
  local t=$(ps -o time= -p $1 2>/dev/null | tr -d ' ')
  local -a p; p=(${(s.:.)t})
  if (( ${#p} == 3 )); then print $(( p[1] * 3600 + p[2] * 60 + p[3] )); else print $(( p[1] * 60 + p[2] )); fi
}
el=$(( EPOCHREALTIME - IDLE_T0 ))
(( el < 5 )) && sleep $(( 5 - el ))
c0=$(cpu_s $IDLE_PID); w0=$EPOCHREALTIME; maxrss=0
while (( EPOCHREALTIME - w0 < 60 )); do
  r=$(ps -o rss= -p $IDLE_PID | tr -d ' '); (( r > maxrss )) && maxrss=$r
  sleep 5
done
c1=$(cpu_s $IDLE_PID); w1=$EPOCHREALTIME
pct=$(( (c1 - c0) / (w1 - w0) * 100 ))
note "idle: $(printf '%.3f' $(( c1 - c0 ))) s CPU over $(printf '%.1f' $(( w1 - w0 ))) s = $(printf '%.3f' $pct) % of one core; max RSS $(( maxrss / 1024 )) MiB ($maxrss KiB); self_cpu_s=$(envv "$IDLE_D/sensor.env" self_cpu_s) seq=$(envv "$IDLE_D/sensor.env" seq)"
(( pct < 1.0 )); ck "idle CPU < 1 % of one core over 60 s" $?
(( maxrss < 102400 )); ck "max RSS < 100 MiB" $?
[[ $(envv "$IDLE_D/sensor.env" poll_s) == 5 ]]; ck "  ...measured at poll_s=5" $?
kill -TERM $IDLE_PID; wait_until 3 '! alive $IDLE_PID'

sect "sensor stderr (should be empty but for the expected duplicate refusal)"
grep -v 'refusing a second instance' "$ROOT/sensor.out" | head -5

print -r -- ""
print -r -- "sensor_gate: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
