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

print "== 8. library mode in a FRESH shell: REPLY must stay a string =="
# `strftime -r -s REPLY` creates REPLY as an INTEGER when it does not exist yet; the
# next REPLY=<word> is then arithmetic and fatal under set -u. resilience_harness D5
# died exactly so, mid-shed. Each probe is a brand-new zsh that has never set REPLY.
probe() { /bin/zsh -c "set -u; $1 export FORGE_GUARDIAN_LIB=1 FORGE_HEALTH_DIR=$ROOT/fresh; source '$SRC'; parse_lstart 'Thu Oct  8 06:08:36 2026'; t=\$REPLY; json_esc speculative; print -r -- \"\$t \$REPLY\"" 2>&1 }
out=$(probe ""); ck "fresh shell: parse_lstart then a string result" 1 $([[ $out == <->\ speculative ]] && print 1 || print 0) "$out"
out=$(probe "typeset -i REPLY=7;"); ck "a sourcing shell with an INTEGER REPLY" 1 $([[ $out == <->\ speculative ]] && print 1 || print 0) "$out"

print "\n[policy] $PASS passed, $FAIL failed"
(( FAIL == 0 ))
