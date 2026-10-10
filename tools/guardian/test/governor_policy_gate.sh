#!/bin/zsh
# ============================================================================
# GOVERNOR POLICY GATE (T-173..T-176) — the decision logic, in library mode
#
# Sources the REAL forge-guardian with FORGE_GUARDIAN_LIB=1 and drives its own
# functions: advance() (the hysteresis machine), classify(), evidence_step(),
# critical_inputs(), decide(), map_sensor(), sensor_fresh_check(), load_policy().
# Nothing is re-implemented here except the EXPECTED table, which is copied from
# SCHEMA.md §4.4 by hand -- so a change to the code that drifts from the contract
# turns this red, and a change to the contract must be made here on purpose.
#
# Hermetic: a private FORGE_HEALTH_DIR / ARCHIE_HEALTH_DIR; no daemon is started,
# no process is signalled, nothing outside the private root is written.
# Usage: governor_policy_gate.sh [path/to/forge-guardian]
# ============================================================================
set -u
SRC=${1:-${0:A:h}/../forge-guardian}
[[ -f "$SRC" ]] || { print -u2 "no guardian at $SRC"; exit 1 }
SRC=${SRC:A}
ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fg_policy.XXXXXX")
trap 'rm -rf "$ROOT"' EXIT
export FORGE_HEALTH_DIR="$ROOT/health" ARCHIE_HEALTH_DIR="$ROOT/ah"
unset FORGE_GUARDIAN_POLL FORGE_GUARDIAN_SETTLE FORGE_GUARDIAN_TERM_GRACE
mkdir -p "$FORGE_HEALTH_DIR"

PASS=0; FAIL=0
ck() { # ck <desc> <want> <got>
  if [[ "$2" == "$3" ]]; then (( PASS++ )); print "    ok   $1  ($3)"
  else (( FAIL++ )); print "    FAIL $1  (got '$3' want '$2')"; fi
}
export FORGE_GUARDIAN_LIB=1
source "$SRC" || { print "    FAIL could not source $SRC"; exit 1; }
unset FORGE_GUARDIAN_LIB
print "[policy] daemon under test: $SRC"
need_fns=(advance classify evidence_step critical_inputs decide map_sensor sensor_fresh_check load_policy thermal_pct)
missing_fns=()
for f in $need_fns; do (( ${+functions[$f]} )) || missing_fns+=($f); done
if (( ${#missing_fns} )); then
  print "    FAIL the daemon lacks ${missing_fns[*]} (pre-v2): this gate cannot run"
  print "\n[policy] 0 passed, 1 failed"
  exit 1
fi

# ---- helpers ---------------------------------------------------------------------
reset_machine() { STATE=$1; CAND=$1; CONFIRM=0; CRITICAL_NOW=0; TRANSITIONED=0 }
# polls_to FROM TO -> REPLY = the poll on which STATE first became TO (0 = never in 20)
polls_to() {
  local i; reset_machine $1; REPLY=0
  for i in {1..20}; do advance $2; [[ $STATE == $2 ]] && { REPLY=$i; return }; done
}
all_ok() { O_ST_VMP=ok; O_ST_SWAP=ok; O_ST_PAGEOUTS=ok; O_ST_DISK=ok; O_ST_THERMAL=ok; O_ST_FREE=ok
           SENSOR_ENABLED=0; SENSOR_FRESH=0; CRITICAL_NOW=0; PEVENT_CRIT_NEW=0; PUBLISH_FAILED=0 }
idle() { O_VMP=1; O_FREE=90; O_SWU=0; O_SWT=2048; O_PORATE=0; O_DISK=200; O_THERM=100 }
# one full decision the way the daemon's loop takes it -> NEW
decide_now() { classify; evidence_step; critical_inputs; decide }
typeset -A RANK; RANK=(GREEN 0 YELLOW 1 ORANGE 2 RED 3)

print "== 1. every transition of SCHEMA §4.4, with its exact hysteresis count =="
# escalate_polls=2, deescalate_polls=6 (policy defaults)
typeset -A WANT
for a in GREEN YELLOW ORANGE RED UNKNOWN; do for b in GREEN YELLOW ORANGE RED UNKNOWN; do
  [[ $a == $b ]] && continue
  case "$a:$b" in
    *:UNKNOWN)                     WANT[$a:$b]=1 ;;   # losing evidence closes admission AT ONCE
    UNKNOWN:ORANGE|UNKNOWN:RED)    WANT[$a:$b]=2 ;;   # pressure out of UNKNOWN: escalate_polls
    UNKNOWN:*)                     WANT[$a:$b]=6 ;;   # health out of UNKNOWN: deescalate_polls
    GREEN:*|YELLOW:ORANGE|YELLOW:RED|ORANGE:RED) WANT[$a:$b]=2 ;;
    *)                             WANT[$a:$b]=6 ;;
  esac
done; done
for k in ${(ok)WANT}; do
  polls_to ${k%%:*} ${k##*:}
  ck "$k after exactly ${WANT[$k]} confirming poll(s)" ${WANT[$k]} $REPLY
done
print "  -- a confirmation must be CONSECUTIVE --"
reset_machine GREEN; advance ORANGE; advance GREEN; advance ORANGE
ck "GREEN: ORANGE, GREEN, ORANGE is not 2 consecutive ORANGE" GREEN $STATE
advance ORANGE; ck "  ...the next ORANGE makes it 2" ORANGE $STATE
reset_machine RED; for i in 1 2 3 4 5; do advance GREEN; done; advance YELLOW
ck "RED: 5x GREEN then YELLOW restarts the count" RED $STATE
reset_machine UNKNOWN; for i in 1 2 3 4 5; do advance GREEN; done; advance UNKNOWN; for i in 1 2 3 4 5; do advance GREEN; done
ck "UNKNOWN: 5 healthy polls, one evidence gap, 5 more -> still UNKNOWN" UNKNOWN $STATE
advance GREEN; ck "  ...the 6th consecutive healthy poll -> GREEN" GREEN $STATE

print "== 2. the evidence step (SCHEMA §3.3): incomplete -> UNKNOWN, never hides pressure =="
for s in vm_pressure swap pageouts disk thermal; do
  all_ok; idle
  case $s in vm_pressure) O_ST_VMP=unavailable ;; swap) O_ST_SWAP=invalid ;; pageouts) O_ST_PAGEOUTS=stale ;; disk) O_ST_DISK=unavailable ;; thermal) O_ST_THERMAL=unavailable ;; esac
  decide_now
  ck "required $s missing at an idle vector -> UNKNOWN" UNKNOWN $NEW
  ck "  ...and evidence.missing names exactly it" $s "${MISSING[*]}"
done
all_ok; idle; O_ST_FREE=unavailable; decide_now
ck "free_pct is NOT required by default: missing it stays GREEN" GREEN $NEW
all_ok; idle; decide_now; ck "all required ok -> GREEN (control)" GREEN $NEW
all_ok; idle; SENSOR_ENABLED=1; SENSOR_FRESH=0; SENSOR_WHY="stale 12s > 3s"; decide_now
ck "a configured sensor that is not fresh -> UNKNOWN" UNKNOWN $NEW
ck "  ...missing names the sensor" sensor "${MISSING[*]}"
all_ok; idle; O_ST_THERMAL=unavailable; O_VMP=2; decide_now
ck "thermal missing + OS WARNING -> ORANGE (missing evidence never hides pressure)" ORANGE $NEW
all_ok; idle; O_ST_THERMAL=unavailable; O_VMP=4; decide_now
ck "thermal missing + OS CRITICAL -> RED" RED $NEW
all_ok; idle; O_ST_THERMAL=unavailable; O_DISK=40; decide_now
ck "thermal missing + disk YELLOW -> UNKNOWN (only ORANGE/RED outrank missing evidence)" UNKNOWN $NEW
all_ok; idle; O_ST_VMP=unavailable; O_VMP=1; decide_now
ck "vm_pressure unavailable is NOT read as level 1 = healthy" UNKNOWN $NEW

print "== 3. CRITICAL_NOW bypasses hysteresis (RED on the observing poll) =="
all_ok; idle; reset_machine GREEN; O_VMP=4; decide_now; advance $NEW
ck "GREEN + vm_pressure=4 -> RED on ONE poll" RED $STATE
ck "  ...CRITICAL_NOW was set" 1 $CRITICAL_NOW
all_ok; idle; reset_machine UNKNOWN; O_DISK=$(( DISK_FLOOR_RED - 1 )); decide_now; advance $NEW
ck "UNKNOWN + disk below the red floor -> RED on ONE poll" RED $STATE
all_ok; idle; reset_machine GREEN; PEVENT_CRIT_NEW=1; decide_now; advance $NEW
ck "GREEN + a critical pressure event, vector idle -> RED on ONE poll" RED $STATE
ck "  ...reason names the event" 1 $([[ $REASON == *pressure\ event* ]] && print 1 || print 0)
all_ok; idle; reset_machine YELLOW; PUBLISH_FAILED=1; PUB_FAIL="state.json(errno 28)"; decide_now; advance $NEW
ck "YELLOW + a failed publication -> RED on ONE poll" RED $STATE
ck "  ...the failure flag is consumed (one poll, not for ever)" 0 $PUBLISH_FAILED
all_ok; idle; reset_machine GREEN; O_PORATE=9000; O_SWU=1950; O_SWT=2048; decide_now; advance $NEW
ck "CONTROL: thrash RED is NOT a bypass -> still GREEN after 1 poll" GREEN $STATE
ck "  ...CRITICAL_NOW stays 0 for thrash" 0 $CRITICAL_NOW
decide_now; advance $NEW; ck "  ...and RED after the 2nd" RED $STATE
all_ok; idle; reset_machine GREEN; O_VMP=2; decide_now; advance $NEW
ck "CONTROL: OS WARNING is not a bypass -> GREEN after 1 poll" GREEN $STATE
all_ok; idle; reset_machine RED; decide_now; advance $NEW
ck "leaving RED is never bypassed (1 idle poll stays RED)" RED $STATE

print "== 4. thermal: the sensor word maps onto the ladder; policy can move it =="
for w want in nominal GREEN fair YELLOW serious ORANGE critical RED; do
  idle; thermal_pct $w; O_THERM=$REPLY; classify; ck "thermal $w" $want $CLASS
done
print "thermal_fair=ORANGE\nthermal_serious=RED" > "$FORGE_HEALTH_DIR/policy.env"; load_policy
idle; thermal_pct fair; O_THERM=$REPLY; classify; ck "policy thermal_fair=ORANGE -> fair is ORANGE" ORANGE $CLASS
idle; thermal_pct serious; O_THERM=$REPLY; classify; ck "policy thermal_serious=RED -> serious is RED" RED $CLASS
rm -f "$FORGE_HEALTH_DIR/policy.env"; load_policy

print "== 5. disk floors come from policy.env =="
ck "defaults (no policy.env) 45/25/12" "45/25/12" "$DISK_FLOOR_YELLOW/$DISK_FLOOR_ORANGE/$DISK_FLOOR_RED"
print "disk_floors_gib_yellow=100\ndisk_floors_gib_orange=60\ndisk_floors_gib_red=30\nescalate_polls=3\ndeescalate_polls=4" > "$FORGE_HEALTH_DIR/policy.env"; load_policy
ck "policy floors loaded" "100/60/30" "$DISK_FLOOR_YELLOW/$DISK_FLOOR_ORANGE/$DISK_FLOOR_RED"
for d want in 150 GREEN 99 YELLOW 59 ORANGE 29 RED; do idle; O_DISK=$d; classify; ck "disk ${d}Gi under 100/60/30" $want $CLASS; done
idle; O_DISK=29; classify; ck "disk under the POLICY red floor is CRITICAL_NOW" 1 $CRITICAL_NOW
idle; O_DISK=40; classify; ck "disk 40Gi is ORANGE under 100/60/30 (it is YELLOW under the defaults)" ORANGE $CLASS
polls_to GREEN ORANGE; ck "escalate_polls=3 from policy" 3 $REPLY
polls_to ORANGE GREEN; ck "deescalate_polls=4 from policy" 4 $REPLY
print "disk_floors_gib_yellow=20\ndisk_floors_gib_orange=25\ndisk_floors_gib_red=12\nescalate_polls=abc" > "$FORGE_HEALTH_DIR/policy.env"; load_policy
ck "unordered floors are refused -> defaults" "45/25/12" "$DISK_FLOOR_YELLOW/$DISK_FLOOR_ORANGE/$DISK_FLOOR_RED"
ck "a non-numeric escalate_polls is refused -> default" 2 $ESCALATE_N
ck "  ...and both are reported as policy errors" 1 $([[ $POLICY_ERRORS == *floors* && $POLICY_ERRORS == *escalate_polls=abc* ]] && print 1 || print 0)
rm -f "$FORGE_HEALTH_DIR/policy.env"; load_policy

print "== 6. monotonicity: a strictly worse box never classifies better =="
mono() { # mono NAME SETTER v1 v2 ... (values in WORSENING order)
  local name=$1 setter=$2 v prev=-1 ok=1 seq=""; shift 2
  for v in "$@"; do idle; $setter $v; classify; seq+=${CLASS[1]}; (( RANK[$CLASS] < prev )) && ok=0; prev=$RANK[$CLASS]; done
  ck "monotone along $name [$seq]" 1 $ok
}
s_disk() { O_DISK=$1 }; s_vmp() { O_VMP=$1 }; s_po() { O_PORATE=$1; O_SWU=1950; O_SWT=2048 }
s_therm() { O_THERM=$1 }; s_free() { O_FREE=$1; O_PORATE=400 }; s_swap() { O_PORATE=2000; O_SWU=$1; O_SWT=2048 }
mono disk s_disk 4000 500 200 60 46 45 44 30 25 24 13 12 11 4 0
mono vm_pressure s_vmp 1 2 4
mono pageouts@swap95 s_po 0 300 601 1501 6001 9000
mono thermal s_therm 100 95 90 89 70 69 40 39 0
mono free%@pageouts400 s_free 90 50 13 12 5 0
mono swap%@pageouts2000 s_swap 0 1000 1229 1230 1700 1741 2048
print "disk_floors_gib_yellow=300\ndisk_floors_gib_orange=200\ndisk_floors_gib_red=100" > "$FORGE_HEALTH_DIR/policy.env"; load_policy
mono "disk (policy 300/200/100)" s_disk 4000 301 300 299 201 199 101 99 0
rm -f "$FORGE_HEALTH_DIR/policy.env"; load_policy

print "== 7. the sensor snapshot is validated before any arithmetic =="
base_sv() {
  SV=(schema forge.guardian.sensor/1 pid $$ ts_s $EPOCHSECONDS vmp 1 vmp_st ok freepct 60 freepct_st ok
      swap_used_mb 100 swap_total_mb 2048 swap_st ok pageout_rate_ps 0 pageouts_st ok
      disk_min_avail_gib 200 disk_st ok thermal nominal thermal_st ok pevent normal pevent_st ok pevent_crit_n 0 pevent_ts 0
      vol_n 0 jobs_n 0)
}
for k v sig in vmp abc vm_pressure  vmp 3 vm_pressure  swap_used_mb 4096 swap  swap_total_mb -5 swap \
               pageout_rate_ps 1e5 pageouts  pageout_rate_ps -2 pageouts  disk_min_avail_gib 12.5x disk \
               thermal toasty thermal; do
  base_sv; SV[$k]=$v; map_sensor
  sig_status $sig; ck "sensor $k=$v -> $sig invalid" invalid $REPLY
done
base_sv; SV[thermal_st]=unavailable; SV[thermal]=none; map_sensor; sig_status thermal
ck "sensor thermal_st=unavailable passes through" unavailable $REPLY
ck "  ...and publishes thermal_state none, not a word" none $O_THERM_STATE
base_sv; map_sensor; ck "a clean snapshot: every required signal ok" "ok ok ok ok ok" "$O_ST_VMP $O_ST_SWAP $O_ST_PAGEOUTS $O_ST_DISK $O_ST_THERMAL"
base_sv; SV[pageout_rate_ps]=120.5; map_sensor; ck "pageout_rate_ps 120.5 -> 602 pages per 5 s" 602 $O_PORATE
print "  -- critical pressure events since the previous poll --"
SNAP_PID=""; LAST_CRIT_N=0; PREV_POLL_EPOCH=$EPOCHSECONDS
base_sv; map_sensor; ck "first snapshot, no events" 0 $PEVENT_CRIT_NEW
base_sv; SV[pevent_crit_n]=1; SV[pevent]=critical; SV[pevent_ts]=$EPOCHSECONDS; map_sensor
ck "same sensor, crit_n 0 -> 1: a NEW critical event" 1 $PEVENT_CRIT_NEW
base_sv; SV[pevent_crit_n]=1; SV[pevent]=normal; map_sensor
ck "same sensor, crit_n still 1: not new" 0 $PEVENT_CRIT_NEW
base_sv; SV[pid]=99999999; SV[pevent_crit_n]=3; SV[pevent_ts]=$(( EPOCHSECONDS - 3600 )); map_sensor
ck "a different sensor pid whose events are an hour old: not new" 0 $PEVENT_CRIT_NEW
print "  -- freshness: stale, future, dead writer, wrong schema --"
STALE_POLLS=3; POLL=5
base_sv; SENSOR_FRESH=0; sensor_fresh_check $EPOCHSECONDS; ck "fresh snapshot from a live pid" 1 $SENSOR_FRESH
base_sv; SV[ts_s]=$(( EPOCHSECONDS - 16 )); SENSOR_FRESH=0; sensor_fresh_check $EPOCHSECONDS; ck "ts 16 s old at 3x5 s: stale" 0 $SENSOR_FRESH
base_sv; SV[ts_s]=$(( EPOCHSECONDS + 100 )); SENSOR_FRESH=0; sensor_fresh_check $EPOCHSECONDS; ck "ts 100 s in the future: clock skew" 0 $SENSOR_FRESH
ck "  ...says so" 1 $([[ $SENSOR_WHY == *skew* ]] && print 1 || print 0)
base_sv; SV[ts_s]=$(( EPOCHSECONDS + 4 )); SENSOR_FRESH=0; sensor_fresh_check $EPOCHSECONDS; ck "ts 4 s in the future: tolerated" 1 $SENSOR_FRESH
base_sv; SV[pid]=99999999; SENSOR_FRESH=0; sensor_fresh_check $EPOCHSECONDS; ck "writer pid not running" 0 $SENSOR_FRESH
base_sv; SV[schema]=forge.guardian.sensor/9; SENSOR_FRESH=0; sensor_fresh_check $EPOCHSECONDS; ck "unknown schema" 0 $SENSOR_FRESH

print "== 9. SCHEMA §6 bounds: ONE table, a value outside its range is that key's default (FO-3, R2, R3) =="
# Copied by hand from SCHEMA.md §6 (the gate's expected table, not the code's).
typeset -A BOUND; BOUND=(
  poll_s 1:60  escalate_polls 1:10  deescalate_polls 1:60  sensor_stale_polls 2:12
  disk_floors_gib_red 1:10000
  eviction_settle_s 0:3600  eviction_term_grace_s 1:600
  crash_loop_max_crashes 1:100  crash_loop_window_s 60:86400
  guardian_restart_loop_max_starts 2:100  guardian_restart_loop_window_s 60:86400  guardian_restart_loop_backoff_s 10:3600
  logs_cap_mib 8:1024  logs_rotate_mib 1:64  logs_generations 1:10  logs_history_mib 1:64
  logs_incident_max_kib 64:4096  logs_retention_days 1:365
  notifications_min_interval_s 60:86400  reports_scan_interval_s 60:86400  smart_interval_s 600:604800 )
pol() { print -r -- "$1" > "$FORGE_HEALTH_DIR/policy.env"; load_policy }
bad_b=() good_b=()
for k in ${(ok)BOUND}; do
  lo=${BOUND[$k]%%:*}; hi=${BOUND[$k]##*:}; def=$POL_DEF[$k]
  for v in $(( hi + 1 )) $(( lo - 1 )); do
    (( v < 0 )) && continue
    pol "$k=$v"
    [[ $POL[$k] == $def && $POLICY_ERRORS == *"$k=$v"* ]] || bad_b+=("$k=$v->$POL[$k]")
  done
  for v in $lo $hi; do
    [[ $k == disk_floors_gib_red ]] && (( v >= 25 )) && continue    # must stay < orange
    pol "$k=$v"; [[ $POL[$k] == $v && -z $POLICY_ERRORS ]] || good_b+=("$k=$v->$POL[$k] err='$POLICY_ERRORS'")
  done
done
ck "every out-of-range value is refused -> that key's default + policy_error" "" "${bad_b[*]}"
ck "every in-range boundary value is accepted" "" "${good_b[*]}"
pol "poll_s=4000"; ck "R2: poll_s=4000 (sensor run refuses > 3600) -> default 5" 5 "$POL[poll_s]"
pol "logs_generations=1000000000"; ck "R3: logs_generations=1e9 (wedged rotation at 100% CPU) -> default 3" 3 "$POL[logs_generations]"
pol "sensor_stale_polls=1000000000"; ck "FO-3: sensor_stale_polls=1e9 -> default 3" 3 "$STALE_POLLS"
pol "memory_os_reserve_gb=1"; ck "memory.os_reserve_gb 1 < 2 -> default" 6 "$POL[memory_os_reserve_gb]"
pol "memory_os_reserve_gb=$(( RAM_GB - 1 ))"; ck "memory.os_reserve_gb above RAM-2 -> default" 6 "$POL[memory_os_reserve_gb]"
pol "memory_os_reserve_gb=$(( RAM_GB - 2 ))"; ck "memory.os_reserve_gb = RAM-2 (the maximum) accepted" $(( RAM_GB - 2 )) "$POL[memory_os_reserve_gb]"
pol "memory_os_reserve_gb=2.5"; ck "memory.os_reserve_gb 2.5 accepted" 2.5 "$POL[memory_os_reserve_gb]"
# An 8 GiB Mac (RAM_BYTES is the library-mode hook): the SHIPPED default 6 is RAM-2 and
# must be accepted. The old 2..RAM/2 bound (4) refused it, so the installed policy.json
# lost the key at every start, with a policy_error (review 2026-10-08 round 2).
_ram=$RAM_BYTES; RAM_BYTES=$(( 8 * 1073741824 ))
pol "memory_os_reserve_gb=6"; ck "8 GiB Mac: memory.os_reserve_gb 6 (the shipped default, = RAM-2) accepted, no policy_error" "6|" "$POL[memory_os_reserve_gb]|$POLICY_ERRORS"
pol "memory_os_reserve_gb=6.5"; ck "8 GiB Mac: memory.os_reserve_gb 6.5 (> RAM-2) -> default + policy_error" "6|1" "$POL[memory_os_reserve_gb]|$([[ $POLICY_ERRORS == *memory_os_reserve_gb=6.5* ]] && print 1)"
# Past the third decimal AT the bound (verify, round 2): to_milli truncated 6.0005 to 6.000,
# so the governor accepted what the sensor (a double compare) refuses whole.
bad_=()
for v_ in 6.0005 6.0009 6.00000001; do pol "memory_os_reserve_gb=$v_"; [[ $POLICY_ERRORS == *memory_os_reserve_gb=$v_* ]] || bad_+=("$v_ accepted"); done
for v_ in 6.000 6.0000 5.9999; do pol "memory_os_reserve_gb=$v_"; [[ $POL[memory_os_reserve_gb] == $v_ && -z $POLICY_ERRORS ]] || bad_+=("$v_ refused:$POLICY_ERRORS"); done
ck "8 GiB Mac: 6.0005, 6.0009, 6.00000001 (> RAM-2 past the third decimal) refused; 6.000, 6.0000, 5.9999 accepted" "" "${bad_[*]}"
RAM_BYTES=$_ram; unset _ram
pol "memory_instant_margin_gb=16.5"; ck "memory.instant_margin_gb 16.5 > 16 -> default" 2 "$POL[memory_instant_margin_gb]"
pol "memory_light_job_gb=2.1"; ck "memory.light_job_gb 2.1 > 2 -> default" 0.5 "$POL[memory_light_job_gb]"
print "  -- required_signals: drawn from the five, containing the core four (FO-3) --"
defreq="vm_pressure swap pageouts disk thermal"
for v in "" "thermal" "vm_pressure swap pageouts" "vm_pressure swap pageouts disk free_pct" "vm_pressure swap pageouts disk thermal bogus"; do
  pol "required_signals=$v"
  ck "required_signals='$v' -> refused, default set" "$defreq" "${REQUIRED_SIGNALS[*]}"
done
pol "required_signals=disk pageouts swap vm_pressure"
ck "required_signals without thermal (the core four) is accepted" "disk pageouts swap vm_pressure" "${REQUIRED_SIGNALS[*]}"
pol "required_signals="
all_ok; idle; O_ST_VMP=unavailable; O_ST_SWAP=unavailable; O_ST_PAGEOUTS=unavailable; O_ST_DISK=unavailable; O_ST_THERMAL=unavailable
decide_now
ck "FO-3: required_signals='' + every signal unavailable -> UNKNOWN, never GREEN" UNKNOWN "$NEW"
rm -f "$FORGE_HEALTH_DIR/policy.env"; load_policy

print "== 10. thermal: a WORD is never published as a CPU speed percentage (SEM-5) =="
for w want in fair "thermal state fair" serious "thermal state serious" critical "thermal state critical"; do
  base_sv; SV[thermal]=$w; map_sensor; classify; pub_values
  ck "sensor thermal=$w: cpu_speed_limit_pct -1 (nothing measured a speed)" -1 "$P_THERM"
  ck "  ...reason names the word, no invented percentage" "$want" "$REASON"
done
base_sv; map_sensor; pub_values; ck "sensor thermal=nominal: cpu_speed_limit_pct -1" -1 "$P_THERM"
O_THERM_SRC=pct; O_ST_THERMAL=ok; O_THERM=85; O_THERM_STATE=fair; classify; pub_values
ck "a MEASURED pmset CPU_Speed_Limit 85 is published" 85 "$P_THERM"
ck "  ...and the reason quotes the measurement" "thermal fair (speed 85%)" "$REASON"

print "== 11. reservations the sensor could not measure are -1 / null, not 0.0 / false (SEM-6) =="
base_sv; SV[reserved_b]=33285996544; SV[budget_b]=-1; SV[mem_st]=unavailable; SV[overcommit]=0; map_sensor; pub_values
ck "budget_b=-1 -> budget_gb -1" -1 "$P_BUDGET_GB"
ck "  ...reserved_gb still the measured 31.0" 31.0 "$P_RES_GB"
EVIDENCE_COMPLETE=1; MISSING=(); publish GREEN probe 8 >/dev/null 2>&1
ck "  ...state.json reservations: budget_gb -1, overcommit null" '[31.0, -1, None]' \
   "$(python3 -I -c 'import json,sys; r=json.load(open(sys.argv[1]))["reservations"]; print([r["reserved_gb"], r["budget_gb"], r["overcommit"]])' $FORGE_HEALTH_DIR/state.json 2>&1)"
base_sv; SV[reserved_b]=-1; SV[budget_b]=32212254720; map_sensor; pub_values
ck "reserved_b=-1 -> reserved_gb -1, overcommit unknown" "-1 -1" "$P_RES_GB $P_OVERCOMMIT"
base_sv; SV[reserved_b]=0; SV[budget_b]=32212254720; map_sensor; pub_values
ck "control: measured 0 reserved / 30 budget -> 0.0 / 30.0 / false" "0.0 30.0 0" "$P_RES_GB $P_BUDGET_GB $P_OVERCOMMIT"

print "== 12. percent-encoded volume paths are decoded before use and publication (R11) =="
mkdir -p "$ROOT/vol space"
pol "disk_volumes=$ROOT/vol%20space"
ck "policy disk_volumes=.../vol%20space -> df is asked about '.../vol space'" "$ROOT/vol space" "${DISK_VOLUMES[1]}"
rm -f "$FORGE_HEALTH_DIR/policy.env"; load_policy
base_sv; SV[vol_n]=1; SV[vol0_path]=/x; SV[vol0_mount]='/Volumes/My%20Disk'; SV[vol0_st]=ok; SV[vol0_avail_b]=10737418240; map_sensor
ck "sensor vol0_mount=/Volumes/My%20Disk -> published mount '/Volumes/My Disk'" "/Volumes/My Disk" "${VOL_MOUNT[1]}"

print "== 13. a publication onto a DIRECTORY is a failed publication, not a success (R12) =="
mkdir -p "$ROOT/pubdir/status.json"
PUB_ERRNO=0; write_atomic "$ROOT/pubdir/status.json" '{"x":1}'; r=$?
ck "write_atomic onto a directory returns 1" 1 "$r"
ck "  ...with PUB_ERRNO 21 (EISDIR)" 21 "$PUB_ERRNO"
ck "  ...and nothing was moved inside it" 0 "$(ls "$ROOT/pubdir/status.json" | wc -l | tr -d ' ')"
write_atomic "$ROOT/pubdir/ok.json" '{"x":1}'; ck "control: a plain path still publishes" 0 $?

print "== 14. restart-loop breaker counts only real starts in the window (R9) =="
n=$EPOCHSECONDS
for k in 1 2 3 4 5; do print $(( n + 3600 - k * 60 )); done > "$FORGE_HEALTH_DIR/guardian.starts"
record_start
ck "5 future-dated entries + this start -> 1 start in the window, not 6" 1 "$STARTS_IN_WINDOW"
ck "  ...and the future entries are dropped from the file" 1 "$(wc -l < "$FORGE_HEALTH_DIR/guardian.starts" | tr -d ' ')"
for k in 1 2 3 4; do print $(( n - k * 30 )); done > "$FORGE_HEALTH_DIR/guardian.starts"
record_start; ck "control: 4 real recent starts + this one -> 5" 5 "$STARTS_IN_WINDOW"
rm -f "$FORGE_HEALTH_DIR/guardian.starts"

print "== 15. hysteresis counts evidence, not wake-ups (R5) =="
reset_machine RED; POLL_FRESH=1; WAKE_POLL=0; advance GREEN
POLL_FRESH=1; WAKE_POLL=1; for i in 1 2 3 4 5 6 7 8; do advance GREEN; done
ck "RED: 1 ordinary + 8 USR2 wake-up polls of GREEN evidence -> still RED" RED "$STATE"
WAKE_POLL=0; POLL_FRESH=0; for i in 1 2 3 4 5 6 7 8; do advance GREEN; done
ck "RED: 8 polls that re-read the SAME snapshot -> still RED" RED "$STATE"
POLL_FRESH=1; for i in 1 2 3 4; do advance GREEN; done; ck "  ...5 fresh ordinary polls -> still RED" RED "$STATE"
advance GREEN; ck "  ...the 6th fresh ordinary poll -> GREEN" GREEN "$STATE"
reset_machine GREEN; POLL_FRESH=1; WAKE_POLL=1; advance ORANGE; advance ORANGE
ck "escalation: 2 wake-up polls WITH new evidence still count (GREEN->ORANGE)" ORANGE "$STATE"
reset_machine GREEN; POLL_FRESH=0; WAKE_POLL=1; CRITICAL_NOW=1; advance RED
ck "CRITICAL_NOW -> RED at once, even on a stale wake-up poll" RED "$STATE"
reset_machine GREEN; CRITICAL_NOW=0; POLL_FRESH=0; WAKE_POLL=1; advance UNKNOWN
ck "losing evidence -> UNKNOWN at once, even on a stale wake-up poll" UNKNOWN "$STATE"
POLL_FRESH=1; WAKE_POLL=0; CRITICAL_NOW=0
if (( ${+functions[poll_evidence]} )); then
  EV_SOURCE=sensor; LAST_SEQ=""; LAST_SEQ_PID=""; SV=(seq 7 pid 4242); poll_evidence; a=$POLL_FRESH; poll_evidence; b=$POLL_FRESH
  SV=(seq 8 pid 4242); poll_evidence; c=$POLL_FRESH; SV=(seq 8 pid 4343); poll_evidence; d=$POLL_FRESH
  ck "poll_evidence (sensor): new seq fresh, same seq stale, next seq fresh, new sensor pid fresh" "1 0 1 1" "$a $b $c $d"
  EV_SOURCE=fallback; LAST_POLL_T=$EPOCHREALTIME; POLL=5; poll_evidence; a=$POLL_FRESH
  LAST_POLL_T=$(( EPOCHREALTIME - 6 )); poll_evidence; b=$POLL_FRESH
  ck "poll_evidence (fallback): 0 s since the last sample stale, 6 s at POLL=5 fresh" "0 1" "$a $b"
else
  ck "poll_evidence exists (wake-up polls must not count toward de-escalation)" 1 0
fi
POLL_FRESH=1; WAKE_POLL=0

print "== 16. a torn append never swallows the next record (R6) =="
EVF="$FORGE_HEALTH_DIR/events.jsonl"; rm -rf "$EVF"; mkdir -p "$EVF"
event probe_fail '"n": 1'                                  # events.jsonl is a directory: the append fails
rmdir "$EVF"; print -rn -- '{"ts": 1.000, "kind": "torn", "pad": "xxxx' > "$EVF"   # what a short write leaves behind
event probe_after '"n": 2'
ck "the record appended after a failed append is on its own line and parses" 1 \
   "$(python3 -I -c 'import json,sys
L=open(sys.argv[1]).read().split("\n")
ok=[l for l in L if l.strip().startswith("{") and "probe_after" in l]
try: print(1 if ok and json.loads(ok[-1])["kind"]=="probe_after" else 0)
except Exception: print(0)' "$EVF")"
rm -f "$EVF"
print -rn -- '{"ts": 1791506480.' > "$EVF"                  # a fragment, no failure of OURS on record
APPEND_TORN=(); event probe_after2 '"n": 3'
ck "a file ending in ANOTHER writer's fragment: our record still starts on a new line (last-byte check)" '{"ts": 1791506480.|probe_after2' \
   "$(sed -n 1p "$EVF")|$(tail -1 "$EVF" | plutil -extract kind raw -o - - 2>/dev/null)"
rm -f "$EVF"
event e1 '"n": 1'; event e2 '"n": 2'
ck "ordinary appends: one whole line each, nothing in between" "2|e1 e2" "$(wc -l < "$EVF" | tr -d ' ')|$(for k in $(cut -d'"' -f6 "$EVF"); do print -n "$k "; done | sed 's/ $//')"
rm -f "$EVF"
ck "append_undo exists (a short write is taken back, not left as a fragment)" 1 $(( ${+functions[append_undo]} ))

print "== 17. the sensor's identity verdict is taken per ENVELOPE FILE, and only for a canonical pid (ACT-3) =="
J=$FORGE_HEALTH_DIR/jobs; mkdir -p "$J"
sleep 120 & VPID=$!
sleep 0.2
envf() { print -r -- "pid=$2"$'\n'"name=${1:r}"$'\n'"priority=5"$'\n'"can_restart=0"$'\n'"peak_gb=1"$'\n'"gpu=0"$'\n'"started=1"$'\n'"cmd=x" > "$J/$1"; touch -t 202001010000 "$J/$1" }
envf live.job $VPID; envf stale.job $VPID; envf pad.job 0$VPID
base_sv; SV[jobs_n]=3
SV[job0_pid]=$VPID; SV[job0_identity]=ok;       SV[job0_file]=live.job
SV[job1_pid]=$VPID; SV[job1_identity]=mismatch; SV[job1_file]=stale.job
SV[job2_pid]=$VPID; SV[job2_identity]=ok;       SV[job2_file]=pad.job       # a sensor that read pid=0N as N
map_sensor; SENSOR_FRESH=1; SNAP_TS=$(( EPOCHSECONDS + 5 ))
reap_dead_jobs
ck "two envelopes naming one live pid: the live job's (sensor: ok) is KEPT, the stale one (sensor: mismatch) is reaped" "1 0" \
   "$([[ -e $J/live.job ]] && print -n 1 || print -n 0) $([[ -e $J/stale.job ]] && print 1 || print 0)"
ck "a padded pid (pid=0N) is never given the sensor's verdict for N: reaped as invalid" 0 "$([[ -e $J/pad.job ]] && print 1 || print 0)"
EV=(pid 0$VPID); ENV_MTIME=1; envelope_identity "$J/pad.job" 0$VPID
ck "envelope_identity checks the pid is canonical BEFORE any sensor verdict" invalid "$ID_VERDICT"
kill $VPID 2>/dev/null; zmodload -F zsh/files b:zf_rm; zf_rm -f -- "$J"/*.job(N)
SENSOR_FRESH=0; SV=(); SJOB_ID=(); SJOB_HAS_FILE=0; SJOBS_ST=ok; (( ${+SJOB_FID} )) && SJOB_FID=()

print "== 18. registry limits (SCHEMA §6): above 1024 envelopes the registry is UNAVAILABLE, never shorter (R4) =="
for (( i = 1; i <= 1025; i++ )); do print -r -- "pid=x" > "$J/$i.job"; done
SENSOR_FRESH=0; reap_dead_jobs
ck "1025 envelopes: jobs_st unavailable, registered_jobs -1, none counted (fresh pid-less ones keep their 10 s grace)" "unavailable -1 1025" "${JOBS_ST:-unset} $O_JOBS ${#${(@f)$(print -l $J/*.job(N))}}"
EV_SOURCE=fallback; RES_FROM=envelopes; pub_values
ck "  ...reserved_gb -1, overcommit unknown, reservations.jobs -1" "-1 -1 -1" "$P_RES_GB $P_OVERCOMMIT $P_RES_JOBS"
EVIDENCE_COMPLETE=1; MISSING=(); publish GREEN probe 8 >/dev/null 2>&1
ck "  ...state.json publishes jobs_st and reservations.status unavailable" "unavailable|unavailable|-1" \
   "$(plutil -extract jobs_st raw -o - "$FORGE_HEALTH_DIR/state.json" 2>/dev/null)|$(plutil -extract reservations.status raw -o - "$FORGE_HEALTH_DIR/state.json" 2>/dev/null)|$(plutil -extract observables.registered_jobs raw -o - "$FORGE_HEALTH_DIR/state.json" 2>/dev/null)"
zf_rm -f -- "$J"/<1-1025>.job(N)
for (( i = 1; i <= 1024; i++ )); do print -r -- "pid=x" > "$J/$i.job"; done
reap_dead_jobs
ck "A/B: 1024 envelopes (the limit) -> jobs_st ok, all counted" "ok 1024" "${JOBS_ST:-unset} $O_JOBS"
zf_rm -f -- "$J"/*.job(N)
# Above the limit the registry must still HEAL (review 2026-10-08 round 2, verify 4c): the
# round-2 reaper walked nothing over 1024, so 1100 envelopes of dead pids stayed for ever
# and every admit exited 75 until a human deleted them. Dead and pid-less envelopes are
# reaped in bounded batches (at most 1024 read per poll) while jobs_st stays unavailable;
# a running pid's envelope is kept.
nl=$'\n'
sleep 0 & DEADP=$!; wait $DEADP 2>/dev/null
while kill -0 $DEADP 2>/dev/null; do sleep 0 & DEADP=$!; wait $DEADP 2>/dev/null; done   # a pid nobody runs now
sleep 120 & LIVEP=$!
sleep 0.2
REAP_EV0=$(grep -c '"kind": "reap"' "$FORGE_HEALTH_DIR/events.jsonl" 2>/dev/null)
for (( i = 1; i <= 1100; i++ )); do print -r -- "pid=$DEADP${nl}name=crashed${nl}started=1${nl}cmd=x" > "$J/d$(( 10000 + i )).job"; done
print -r -- "pid=$LIVEP${nl}name=live-job${nl}priority=5${nl}peak_gb=1${nl}started=$EPOCHSECONDS${nl}cmd=x" > "$J/a-live.job"
SENSOR_FRESH=0; JOBS_ST=ok; reap_dead_jobs
left=(${J}/*.job(N))
ck "1101 envelopes (1100 of a dead pid): poll 1 publishes unavailable, -1, and REAPS a bounded batch of the dead (1023 = 1024 read - the live one)" \
   "unavailable -1 78" "${JOBS_ST:-unset} $O_JOBS ${#left}"
ck "  ...the running job's envelope is kept (never judged or signalled over the limit)" 1 "$([[ -e $J/a-live.job ]] && print 1 || print 0)"
ck "  ...and the batch is logged" 1 "$(grep -c 'registry over the limit: reaped 1023 of the 1024 envelopes read' "$LOG" 2>/dev/null)"
RA0=$(grep -c 'registry readable again (jobs_st ok)' "$LOG" 2>/dev/null)
reap_dead_jobs
left=(${J}/*.job(N))
ck "  ...poll 2: back within the limit -> normal walk: the rest reaped, jobs_st ok, the live job counted" "ok 1 1" "${JOBS_ST:-unset} $O_JOBS ${#left}"
ck "  ...every dead envelope produced a reap event (1100)" 1100 "$(( $(grep -c '"kind": "reap"' "$FORGE_HEALTH_DIR/events.jsonl" 2>/dev/null) - REAP_EV0 ))"
ck "  ...and 'registry readable again' is logged" 1 "$(( $(grep -c 'registry readable again (jobs_st ok)' "$LOG" 2>/dev/null) - RA0 ))"
zf_rm -f -- "$J"/*.job(N)
# The batch resumes where the last one stopped: 1024 live envelopes that sort FIRST must not
# hide the dead ones behind them for ever (a fixed "first 1024 by name" window would).
for (( i = 1; i <= 1024; i++ )); do print -r -- "pid=$LIVEP${nl}name=live${nl}started=$EPOCHSECONDS${nl}cmd=x" > "$J/a$(( 10000 + i )).job"; done
for (( i = 1; i <= 10; i++ )); do print -r -- "pid=$DEADP${nl}name=crashed${nl}cmd=x" > "$J/z$(( 100 + i )).job"; done
JOBS_ST=ok; reap_dead_jobs
left=(${J}/*.job(N))
ck "1024 live envelopes sorting first + 10 dead: poll 1 reads the 1024 live ones, reaps nothing" "unavailable 1034" "${JOBS_ST:-unset} ${#left}"
reap_dead_jobs
left=(${J}/z*.job(N)); left2=(${J}/a*.job(N))
ck "  ...poll 2 starts where poll 1 stopped: the 10 dead ones are reaped, all 1024 live kept" "0 1024" "${#left} ${#left2}"
kill $LIVEP 2>/dev/null; wait $LIVEP 2>/dev/null
zf_rm -f -- "$J"/*.job(N); JOBS_ST=ok; REAP_CURSOR=0
base_sv; SV[jobs_st]=unavailable; SV[jobs_n]=0; SV[reserved_b]=-1; map_sensor; SENSOR_FRESH=1; SNAP_TS=$(( EPOCHSECONDS + 5 ))
reap_dead_jobs; pub_values
ck "the sensor's snapshot says jobs_st=unavailable -> the governor publishes it unavailable too" "unavailable -1" "${JOBS_ST:-unset} $P_RES_GB"
SENSOR_FRESH=0; SV=(); SJOBS_ST=ok; reap_dead_jobs
ck "  ...and ok again once the registry reads" ok "${JOBS_ST:-unset}"

print "== 19. housekeeping counts the release ledgers in logs.cap_mib (R13) =="
HD=$FORGE_HEALTH_DIR; mkdir -p "$HD/crashes" "$HD/log"
dd if=/dev/zero of="$HD/reservations.history.jsonl" bs=1048576 count=3 2>/dev/null
dd if=/dev/zero of="$HD/reservations.history.jsonl.1" bs=1048576 count=3 2>/dev/null
dd if=/dev/zero of="$HD/crashes/abcd.jsonl" bs=1048576 count=3 2>/dev/null
dd if=/dev/zero of="$HD/crashes/abcd.jsonl.1" bs=1048576 count=1 2>/dev/null
touch -t 202001010000 "$HD/reservations.history.jsonl.1"
POL[logs_cap_mib]=8; HK_OVER_LOGGED=0
housekeeping
ck "10 MiB of ledgers against an 8 MiB cap: the rotated reservations history is pruned, the live one and every crash ledger kept" "0 1 1 1" \
   "$([[ -e $HD/reservations.history.jsonl.1 ]] && print -n 1 || print -n 0) $([[ -e $HD/reservations.history.jsonl ]] && print -n 1 || print -n 0) $([[ -e $HD/crashes/abcd.jsonl ]] && print -n 1 || print -n 0) $([[ -e $HD/crashes/abcd.jsonl.1 ]] && print 1 || print 0)"
ck "  ...and the ledgers are in the total (3 + 3 + 1 MiB remain counted)" 1 "$(( HK_TOTAL >= 7 * 1048576 ? 1 : 0 ))"
zf_rm -rf -- "$HD/crashes" "$HD"/reservations.history.jsonl*(N)
# The unprunable FLOOR alone over the cap (review 2026-10-08 round 2, verify R13
# regression): 10 MiB of crash ledgers against an 8 MiB cap. Round 2 then pruned EVERY
# prunable item -- the newest incident and history.jsonl.1 too -- without getting under the
# cap. The freshest evidence (the newest incident, every .1) must be kept; older
# generations and older incidents are still pruned.
mkdir -p "$HD/crashes" "$HD/incidents/20261001T000000Z-old" "$HD/incidents/20261009T000000Z-fresh"
for s_ in a b c; do dd if=/dev/zero of="$HD/crashes/$s_.jsonl" bs=1048576 count=3 2>/dev/null; done
dd if=/dev/zero of="$HD/crashes/a.jsonl.1" bs=1048576 count=1 2>/dev/null
print -r -- '{"old":1}' > "$HD/incidents/20261001T000000Z-old/summary.json"
print -r -- '{"fresh":1}' > "$HD/incidents/20261009T000000Z-fresh/summary.json"
print -r -- '{"t":1}' > "$HD/history.jsonl.1"; print -r -- '{"t":0}' > "$HD/history.jsonl.2"
touch -t $(date -v-2d +%Y%m%d%H%M.%S) "$HD/incidents/20261001T000000Z-old" "$HD/history.jsonl.2"
touch -t $(date -v-1d +%Y%m%d%H%M.%S) "$HD/history.jsonl.1"
POL[logs_cap_mib]=8; HK_OVER_LOGGED=0; HK_FLOOR_LOGGED=0
FL0=$(grep -c 'crash ledgers alone are' "$LOG" 2>/dev/null)
housekeeping
ck "10 MiB of crash ledgers (the floor) over an 8 MiB cap: the NEWEST incident and history.jsonl.1 are kept" "1 1" \
   "$([[ -d $HD/incidents/20261009T000000Z-fresh ]] && print -n 1 || print -n 0) $([[ -e $HD/history.jsonl.1 ]] && print 1 || print 0)"
ck "  ...older evidence is still pruned (the older incident, history.jsonl.2)" "0 0" \
   "$([[ -d $HD/incidents/20261001T000000Z-old ]] && print -n 1 || print -n 0) $([[ -e $HD/history.jsonl.2 ]] && print 1 || print 0)"
ck "  ...every crash ledger is kept" 4 "${#${(@f)$(print -l $HD/crashes/*(N.))}}"
ck "  ...and the floor is logged once, naming what was kept" 1 "$(( $(grep -c 'crash ledgers alone are 10 MiB > cap 8 MiB: no pruning reaches the cap, so the newest incident (20261009T000000Z-fresh) and the .1 generations are kept' "$LOG" 2>/dev/null) - FL0 ))"
housekeeping
ck "  ...a second pass keeps them too, and does not log the floor again" "1 1 1" \
   "$([[ -d $HD/incidents/20261009T000000Z-fresh ]] && print -n 1 || print -n 0) $([[ -e $HD/history.jsonl.1 ]] && print -n 1 || print -n 0) $(( $(grep -c 'crash ledgers alone are' "$LOG" 2>/dev/null) - FL0 ))"
POL[logs_cap_mib]=$POL_DEF[logs_cap_mib]
zf_rm -rf -- "$HD/crashes" "$HD/incidents" "$HD"/history.jsonl.<->(N)

print "== 20. fallback disk sampling: a mount point with a space is the WHOLE mount, never its last word (R11) =="
mkdir -p "$ROOT/big disk" "$ROOT/my disk"
df() { # this Mac's df -g layout, inode columns included; avail 99 and 0 GiB
  case $2 in
    *"big disk"*) print "Filesystem 1G-blocks Used Available Capacity iused ifree %iused Mounted on"
                  print "/dev/disk9s1 100 1 99 2% 10 20 33% $ROOT/big disk" ;;
    *"my disk"*)  print "Filesystem 1G-blocks Used Available Capacity iused ifree %iused Mounted on"
                  print "/dev/disk8s1 1 1 0 100% 10 20 33% $ROOT/my disk" ;;
  esac
}
DISK_VOLUMES=("$ROOT/big disk" "$ROOT/my disk")
sample_fallback
unfunction df
ck "two volumes whose mounts share a last word are both measured, by their whole mount" "$ROOT/big disk|$ROOT/my disk|99 0" "${VOL_MOUNT[1]:-}|${VOL_MOUNT[2]:-}|${VOL_AVAIL[*]}"
ck "  ...and the 0 GiB one is the minimum (its RED is not missed)" "0 ok" "$O_DISK $O_ST_DISK"
classify; ck "  ...classify: RED on that volume" RED "$CLASS"
load_policy

print "== 8. library mode in a FRESH shell: REPLY must stay a string =="
# `strftime -r -s REPLY` creates REPLY as an INTEGER when it does not exist yet; the
# next REPLY=<word> is then arithmetic and fatal under set -u. resilience_harness D5
# died exactly so, mid-shed. Each probe is a brand-new zsh that has never set REPLY.
probe() { /bin/zsh -c "set -u; $1 export FORGE_GUARDIAN_LIB=1 FORGE_HEALTH_DIR=$ROOT/fresh; source '$SRC'; parse_lstart 'Thu Oct  8 06:08:36 2026'; t=\$REPLY; json_esc speculative; print -r -- \"\$t \$REPLY\"" 2>&1 }
out=$(probe ""); ck "fresh shell: parse_lstart then a string result" 1 $([[ $out == <->\ speculative ]] && print 1 || print 0) "$out"
out=$(probe "typeset -i REPLY=7;"); ck "a sourcing shell with an INTEGER REPLY" 1 $([[ $out == <->\ speculative ]] && print 1 || print 0) "$out"

print "\n[policy] $PASS passed, $FAIL failed"
(( FAIL == 0 ))
