#!/bin/zsh
# ============================================================================
# ADMISSION GATE -- forge-guardian-sensor admit / release / quarantine (T-174)
#
# A state check is not a reservation. forge-gate (the v1 admission) reads the
# published state, so eight jobs arriving together all see GREEN and all start:
# the RACE section runs that old gate as the negative control and shows 8 of 8
# admitted where the budget holds 4. `admit` decides under one fcntl lock and
# renames the envelope into place before releasing it.
#
# Private domain, hand-written fresh state, FORGE_SENSOR_TEST=1 with injected
# mem_total_b / mem_avail_b so the budget is known. Never touches the live
# domain; signals only the sleepers it started (pids recorded in a FILE).
#
# usage: admission_gate.sh [--bin PREBUILT]     (default: build from ../sensor)
# ============================================================================
set -u
setopt NULL_GLOB 2>/dev/null || true
zmodload zsh/datetime

HERE=${0:A:h}
GUARD_DIR=${HERE:h}
PREBUILT=""
if [[ ${1:-} == --bin ]]; then PREBUILT=${2:-}; fi

PASS=0; FAIL=0
ck() { if (( $2 == 0 )); then (( PASS++ )); print -r -- "    ok   $1"; else (( FAIL++ )); print -r -- "    FAIL $1"; fi }
note() { print -r -- "    ..   $*" }
sect() { print -r -- ""; print -r -- "== $*" }

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fg_admission_gate.XXXXXX")
ROOT=${ROOT:A}
PIDFILE=$ROOT/started.pids; : >"$PIDFILE"
MNT=""
note_pid() { print -r -- "$1" >>"$PIDFILE" }
reap() {
  local p
  [[ -r $PIDFILE ]] && while read -r p; do [[ -n $p && $p == <-> ]] && kill -9 "$p" 2>/dev/null; done <"$PIDFILE"
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
GATE_BUDGET=${GATE_BUDGET:-420}
{
  integer i
  for (( i = 0; i < GATE_BUDGET; i++ )); do sleep 1; done
  print -u2 "[admission_gate] WALL-CLOCK EXCEEDED (${GATE_BUDGET}s) -- reaping and failing"
  [[ -r $PIDFILE ]] && while read -r wp; do [[ -n $wp ]] && kill -9 "$wp" 2>/dev/null; done <"$PIDFILE"
  kill -TERM $$ 2>/dev/null; sleep 2; kill -9 $$ 2>/dev/null
} &
WATCHDOG=$!

# ---------------------------------------------------------------- helpers
GiB=1073741824
pyj() { python3 -I -c 'import json,sys
d=json.load(open(sys.argv[1]))
print(eval(sys.argv[2]))' "$1" "$2" 2>/dev/null }
kvv() { local l; while IFS= read -r l; do [[ $l == "$2="* ]] && { print -r -- "${l#*=}"; return 0 }; done <"$1"; return 1 }
NEWPID=0
new_sleeper() { sleep 900 >/dev/null 2>&1 & NEWPID=$!; note_pid $NEWPID }
fresh_state() { # fresh_state WORD [DIR] [epoch-offset]
  local d=${2:-$D}
  mkdir -p "$d"
  print -r -- "$1" >"$d/state.tmp" && mv -f "$d/state.tmp" "$d/state"
  print -r -- "{\"state\": \"$1\", \"epoch\": $(( EPOCHSECONDS + ${3:-0} )), \"schema\": \"forge.guardian.state/2\"}" >"$d/state.json"
}
inject() { print -r -- "$*" | tr ' ' '\n' >"$FORGE_SENSOR_INJECT" }
adm() { "$B" admit --state-dir "$D" "$@" }
sig_of() { python3 -I -c 'import hashlib,sys; print(hashlib.sha256(sys.argv[1].encode()+b"\0"+sys.argv[2].encode()).hexdigest()[:16])' "$1" "$2" }
pstart_of() { local l=$("$B" pidinfo $1); l=${l#*pstart=}; print -r -- ${l%% *} }
alive() { kill -0 "$1" 2>/dev/null }
# A stand-in governor (review 2026-10-08 FO-4: admit requires the guardian.lock holder
# to be alive, started when guardian.lock/started says, and running forge-guardian).
# A zsh script NAMED forge-guardian that sleeps in zselect: argv ends in forge-guardian
# and it has no children to orphan. Its parent is this gate shell, which therefore is
# "an ancestor of the governor" (SCHEMA §5) -- exactly what one of the cases asserts.
mkdir -p "$ROOT/fg"
print -r -- 'zmodload zsh/zselect; while :; do zselect -t 360000; done' >"$ROOT/fg/forge-guardian"
fake_gov() { # fake_gov DIR -> FGPID; writes DIR/guardian.lock/{pid,started}
  zsh "$ROOT/fg/forge-guardian" & FGPID=$!; note_pid $FGPID
  mkdir -p "$1/guardian.lock"
  print -r -- $FGPID >"$1/guardian.lock/pid"
  ps -p $FGPID -o lstart= >"$1/guardian.lock/started"
}
# A process whose p_comm is "Claude Helper" (protected by name, with a space: ACT-1).
CH_BIN=$ROOT/ch/"Claude Helper"; mkdir -p "$ROOT/ch"
print -l '#include <unistd.h>' 'int main(void) { for (;;) pause(); }' >"$ROOT/ch/ch.c"
xcrun clang -O0 -o "$CH_BIN" "$ROOT/ch/ch.c" >/dev/null 2>&1 || CH_BIN=""

export FORGE_SENSOR_TEST=1
export FORGE_SENSOR_TEST_REPORT_DIRS=$ROOT/reps; mkdir -p "$ROOT/reps"
export FORGE_SENSOR_INJECT=$ROOT/inject
D=$ROOT/h
mkdir -p "$D"
# budget = 28 - 6 = 22 GiB; available 27 GiB (an available figure above the total
# would itself be published as invalid evidence -> 75)
BUDGET_INJ="mem_total_b=$(( 28 * GiB )) mem_avail_b=$(( 27 * GiB ))"
inject $BUDGET_INJ
fresh_state GREEN
fake_gov "$D"; GOV=$FGPID

sect "build"
if [[ -n $PREBUILT ]]; then B=$PREBUILT
else B=$("$GUARD_DIR/sensor/build.sh" --out "$ROOT/build" 2>"$ROOT/build.err") || { cat "$ROOT/build.err"; exit 1 }; fi
[[ -x $B ]]; ck "sensor built ($B)" $?
"$B" --version >/dev/null   # first exec of a new binary pays the code-signing assessment; keep it out of the latencies

# ================================================================ 1. admit within budget
sect "1. admit within budget -> envelope v2"
new_sleeper; A1=$NEWPID
CMD1='python train.py --lr=3e-4 --name "x y" a=b'
t0=$EPOCHREALTIME
adm --pid $A1 --name job-a --peak-gb 5 --cmd "$CMD1" --threads 4 --priority 7 --restartable 2>"$ROOT/e1"; rc=$?
note "admit latency $(printf '%.1f' $(( (EPOCHREALTIME - t0) * 1000 ))) ms"
(( rc == 0 )); ck "5 GiB of a 22 GiB budget -> exit 0" $?
EF=$D/jobs/$A1.job
keys=(${(f)"$(cut -d= -f1 "$EF")"})
[[ ${(j: :)keys[1,7]} == "pid name priority can_restart peak_gb gpu started" ]]; ck "v1 keys first, in order (${(j: :)keys[1,7]})" $?
[[ ${keys[-1]} == cmd && $(tail -1 "$EF") == "cmd=$CMD1" ]]; ck "cmd= is LAST and keeps '=' and spaces" $?
for k in schema pstart boot sig threads admitted admit_state owner; do (( ${keys[(Ie)$k]} > 7 )) || { print "    ..   missing v2 key $k"; break }; done
(( ${keys[(Ie)owner]} > 7 && ${keys[(Ie)schema]} > 7 )); ck "v2 keys present after the v1 keys (schema pstart boot sig threads admitted admit_state owner)" $?
[[ $(kvv "$EF" pstart) == $(pstart_of $A1) ]]; r_=$?; ck "pstart == pidinfo pstart ($(kvv "$EF" pstart))" $r_
[[ $(kvv "$EF" boot) == $(sysctl -n kern.bootsessionuuid) ]]; ck "boot == kern.bootsessionuuid" $?
[[ $(kvv "$EF" sig) == $(sig_of job-a "$CMD1") ]]; r_=$?; ck "sig == sha256(name NUL cmd)[:16] ($(kvv "$EF" sig))" $r_
[[ $(kvv "$EF" peak_gb) == 5 && $(kvv "$EF" priority) == 7 && $(kvv "$EF" can_restart) == 1 && $(kvv "$EF" threads) == 4 \
   && $(kvv "$EF" admit_state) == GREEN && $(kvv "$EF" owner) == forge-job && $(kvv "$EF" schema) == 2 ]]
ck "declared values recorded (peak 5, priority 7, restartable, threads 4, GREEN, forge-job)" $?
[[ $(stat -f %Lp "$EF") == 600 ]]; ck "envelope mode 0600" $?
"$B" snapshot --state-dir "$D" >"$ROOT/snap1.json"
[[ $(pyj "$ROOT/snap1.json" '[j["identity"] for j in d["jobs"]]') == "['ok']" ]]; ck "the sensor verifies the new envelope's identity: ok" $?

# ================================================================ 2. over budget
sect "2. over budget -> deny naming numbers and holders"
new_sleeper; A2=$NEWPID
adm --pid $A2 --name job-b --peak-gb 18 --json >"$ROOT/j2" 2>"$ROOT/e2"; rc=$?
note "$(cat "$ROOT/e2")"
(( rc == 1 )); ck "5 + 18 > 22 -> exit 1" $?
grep -qF "budget: reserved 5.0 + new 18.0 > 22.0 GiB (job-a pid $A1 holds 5.0)" "$ROOT/e2"; ck "reason names the numbers and the holder" $?
[[ $(pyj "$ROOT/j2" 'd["decision"]') == deny && $(pyj "$ROOT/j2" 'd["fit"]["budget"]["ok"]') == False && $(pyj "$ROOT/j2" 'd["fit"]["budget"]["limit_gb"]==22 and d["fit"]["budget"]["reserved_gb"]==5') == True ]]
ck "--json: decision deny, fit.budget.ok false, limit 22.0" $?
[[ ! -e $D/jobs/$A2.job ]]; ck "no envelope written on deny" $?
adm --pid $A2 --name job-b --peak-gb 17 --dry-run 2>/dev/null; ck "A/B: 5 + 17 = 22 <= 22 -> admitted (dry run)" $?
[[ ! -e $D/jobs/$A2.job ]]; ck "--dry-run writes nothing" $?

# ================================================================ 3. fail closed
sect "3. fail closed -> 75"
new_sleeper; A3=$NEWPID
try75() { adm --pid $A3 --name probe --peak-gb 1 --dry-run 2>"$ROOT/e3"; print $? }
mv "$D/state" "$D/state.off"; rc=$(try75); mv "$D/state.off" "$D/state"
(( rc == 75 )); r_=$?; ck "missing state -> 75 ($(head -c 90 "$ROOT/e3"))" $r_
fresh_state GREEN; touch -t "$(date -r $(( EPOCHSECONDS - 120 )) +%Y%m%d%H%M.%S)" "$D/state"; rc=$(try75)
(( rc == 75 )) && grep -q stale "$ROOT/e3"; ck "state mtime 120 s old -> 75 (stale)" $?
fresh_state GREEN "$D" 100; rc=$(try75)
(( rc == 75 )) && grep -q future "$ROOT/e3"; ck "state.json epoch 100 s in the future -> 75" $?
fresh_state GREEN "$D" -120; rc=$(try75)
(( rc == 75 )); ck "state.json epoch 120 s old (state mtime fresh) -> 75" $?
fresh_state GREEN; rm -f "$D/state.json"; rc=$(try75)
(( rc == 75 )); ck "state.json missing -> 75" $?
fresh_state GREEN; chmod 000 "$D/jobs"; rc=$(try75); chmod 700 "$D/jobs"
(( rc == 75 )) && grep -q registry "$ROOT/e3"; ck "unreadable registry -> 75" $?
inject $BUDGET_INJ mem_st=unavailable; rc=$(try75)
(( rc == 75 )) && grep -q 'memory evidence' "$ROOT/e3"; ck "memory evidence unavailable -> 75" $?
adm --pid $A3 --name light --peak-gb 0.3 --dry-run 2>/dev/null; ck "  ...but a light job (0.3 <= 0.5 GiB) skips the memory tests -> 0" $?
inject $BUDGET_INJ
rc=$(try75); (( rc == 0 )); ck "A/B: the same probe with every condition restored -> 0" $?
"$B" admit --state-dir "$ROOT/nonexistent" --pid $A3 --name x --peak-gb 1 2>/dev/null; (( $? == 75 )); ck "no domain at all -> 75" $?

# FO-4: a fresh state file is not a live governor. The state stays fresh and GREEN in
# every case below; only the guardian.lock evidence changes.
GL=$D/guardian.lock
cp "$GL/pid" "$ROOT/gl.pid"; cp "$GL/started" "$ROOT/gl.started"
gl_restore() { mkdir -p "$GL"; cp "$ROOT/gl.pid" "$GL/pid"; cp "$ROOT/gl.started" "$GL/started" }
fresh_state GREEN; rm -rf "$GL"; rc=$(try75); gl_restore
(( rc == 75 )) && grep -q 'governor not running' "$ROOT/e3"; ck "[FO-4] fresh GREEN state but no guardian.lock -> 75 'governor not running' (rc=$rc)" $?
sleep 0 & dg=$!; wait $dg
fresh_state GREEN; print -r -- $dg >"$GL/pid"; rc=$(try75); gl_restore
(( rc == 75 )) && grep -q 'not running' "$ROOT/e3"; ck "[FO-4] guardian.lock names a DEAD pid (a SIGKILLed governor) -> 75 (rc=$rc)" $?
new_sleeper; NG=$NEWPID
fresh_state GREEN; print -r -- $NG >"$GL/pid"; ps -p $NG -o lstart= >"$GL/started"; rc=$(try75); gl_restore
(( rc == 75 )) && grep -q 'is not forge-guardian' "$ROOT/e3"; ck "[FO-4] guardian.lock names a live pid whose argv is not forge-guardian (start time right) -> 75 (rc=$rc)" $?
fresh_state GREEN; print -r -- "Mon Jan  1 00:00:00 2001" >"$GL/started"; rc=$(try75); gl_restore
(( rc == 75 )) && grep -q 'reused' "$ROOT/e3"; ck "[FO-4] the governor's pid but a different start time (pid reused) -> 75 (rc=$rc)" $?
fresh_state GREEN; rm -rf "$GL"
adm --pid $A3 --name probe-real --peak-gb 1 2>"$ROOT/e3"; rc=$?; gl_restore
(( rc == 75 )) && [[ ! -e $D/jobs/$A3.job ]]; ck "[FO-4] a REAL (not --dry-run) admit with no live governor -> 75, no envelope (rc=$rc)" $?
fresh_state GREEN; rc=$(try75)
(( rc == 0 )); ck "[FO-4] A/B: guardian.lock restored (live forge-guardian, matching start) -> 0 (rc=$rc)" $?

# ACT-1: SCHEMA §5 -- never admit a protected or foreign process as a job.
fresh_state GREEN
adm --pid $GOV --name gov --peak-gb 0 --dry-run 2>"$ROOT/e3a"; rc=$?
(( rc == 1 )) && grep -q 'protected or foreign process' "$ROOT/e3a"; ck "[ACT-1] admit --pid <the governor> -> 1 'protected or foreign process' (rc=$rc)" $?
adm --pid $$ --name ancestor --peak-gb 0 --dry-run 2>"$ROOT/e3a"; rc=$?
(( rc == 1 )) && grep -q 'ancestor of the governor' "$ROOT/e3a"; ck "[ACT-1] admit --pid <an ancestor of the governor> -> 1 (rc=$rc)" $?
ROOTPID=$(ps -axo pid=,uid= | awk '$2 == 0 && $1 > 1 { print $1; exit }')
adm --pid $ROOTPID --name rooted --peak-gb 0 --dry-run 2>"$ROOT/e3a"; rc=$?
(( rc == 1 )) && grep -q 'owned by uid 0' "$ROOT/e3a"; ck "[ACT-1] admit --pid <root-owned pid $ROOTPID> -> 1, another uid (rc=$rc)" $?
if [[ -n $CH_BIN ]]; then
  "$CH_BIN" & CHP=$!; note_pid $CHP; sleep 0.2
  adm --pid $CHP --name helper --peak-gb 0 --priority 9 --restartable --need red --dry-run 2>"$ROOT/e3a"; rc=$?
  (( rc == 1 )) && grep -q "protected process name 'Claude Helper'" "$ROOT/e3a"; ck "[ACT-1] admit --pid <a process named 'Claude Helper'> -> 1 (rc=$rc)" $?
  t0=$EPOCHREALTIME
  adm --pid $CHP --name helper --peak-gb 0 --wait 20 --dry-run 2>/dev/null; rc=$?
  (( rc == 1 && EPOCHREALTIME - t0 < 3 )); r_=$?; ck "[ACT-1] ...and --wait does not retry a protected pid (rc=$rc, $(printf '%.1f' $(( EPOCHREALTIME - t0 ))) s)" $r_
  kill -9 $CHP 2>/dev/null
else
  note "clang unavailable: the 'Claude Helper' arm is skipped"
fi
adm --pid $A3 --name ordinary --peak-gb 0 --dry-run 2>/dev/null; ck "[ACT-1] A/B: an ordinary own-uid sleeper -> 0" $?

# ================================================================ 4. state rank
sect "4. state rank vs --need (UNKNOWN ranks with RED)"
need() { fresh_state $1; adm --pid $A3 --name probe --peak-gb 1 --need $2 --dry-run 2>"$ROOT/e4"; print $? }
(( $(need YELLOW green) == 1 )) && grep -qF 'state: YELLOW does not satisfy --need green' "$ROOT/e4"; ck "YELLOW, --need green -> 1" $?
(( $(need YELLOW yellow) == 0 )); ck "YELLOW, --need yellow -> 0" $?
(( $(need UNKNOWN orange) == 1 )); ck "UNKNOWN, --need orange -> 1" $?
(( $(need UNKNOWN red) == 0 )); ck "UNKNOWN, --need red -> 0" $?
(( $(need RED orange) == 1 && $(need ORANGE orange) == 0 )); ck "RED/ORANGE ranks" $?
(( $(need PURPLE red) == 1 )); ck "an unknown state word denies even --need red" $?
fresh_state GREEN

# ================================================================ 5. RACE
sect "5. RACE: 8 concurrent admits, 5 GiB each, 22 GiB budget"
DR=$ROOT/race; fresh_state GREEN "$DR"; fake_gov "$DR"
dist=(); wall=()
for round in {1..5}; do
  fresh_state GREEN "$DR"
  rm -f "$DR"/jobs/*.job(N) "$ROOT"/race.rc.*(N)
  sl=()
  for i in {1..8}; do new_sleeper; sl+=($NEWPID); done
  t0=$EPOCHREALTIME
  bg=()
  for i in {1..8}; do
    ( "$B" admit --state-dir "$DR" --pid ${sl[$i]} --name race-$i --peak-gb 5 2>/dev/null; print $? >"$ROOT/race.rc.$i" ) &
    bg+=($!)
  done
  for j in $bg; do wait $j; done   # never a bare `wait`: the sleepers are children too
  wall+=($(printf '%.0f' $(( (EPOCHREALTIME - t0) * 1000 ))))
  n0=0; for i in {1..8}; do [[ $(<"$ROOT/race.rc.$i") == 0 ]] && (( n0++ )); done
  nenv=${#${(@f)"$(print -l "$DR"/jobs/*.job(N))"}}
  [[ -z $(print -l "$DR"/jobs/*.job(N)) ]] && nenv=0
  dist+=("$n0/$nenv")
  for p in $sl; do kill -9 $p 2>/dev/null; done
done
note "admitted/envelopes per round: ${dist[*]}  (wall per round: ${wall[*]} ms)"
[[ ${dist[*]} == "4/4 4/4 4/4 4/4 4/4" ]]; ck "exactly 4 admitted and 4 envelopes in each of 5 rounds" $?
print -r -- "  -- red-on-old: the 834c7269 forge-gate under the same race"
if git -C "$GUARD_DIR" show 834c7269:tools/guardian/forge-gate >"$ROOT/old-forge-gate" 2>/dev/null; then
  fresh_state GREEN "$DR"; rm -f "$DR"/jobs/*.job(N) "$ROOT"/old.rc.*(N)
  bg=()
  for i in {1..8}; do ( FORGE_HEALTH_DIR=$DR zsh "$ROOT/old-forge-gate" --need green >/dev/null 2>&1; print $? >"$ROOT/old.rc.$i" ) & bg+=($!); done
  for j in $bg; do wait $j; done
  o0=0; for i in {1..8}; do [[ $(<"$ROOT/old.rc.$i") == 0 ]] && (( o0++ )); done
  note "old forge-gate admitted $o0 of 8 (40 GiB declared onto a 22 GiB budget)"
  (( o0 == 8 )); ck "old admission admits all 8: the race check is RED on the old code" $?
fi

# ================================================================ 6. identity
sect "6. identity-verified registry"
rm -f "$D"/jobs/*.job(N)
fresh_state GREEN
new_sleeper; M=$NEWPID; new_sleeper; N=$NEWPID
PSM=$(pstart_of $M)
envl() { # envl PID NAME PEAK EXTRA-LINES...
  local f=$D/jobs/$1.job; shift
  { print -r -- "pid=${f:t:r}"; print -r -- "name=$1"; print -r -- "priority=4"; print -r -- "can_restart=0"
    print -r -- "peak_gb=$2"; print -r -- "gpu=1"; shift 2; local l; for l in "$@"; do print -r -- "$l"; done
    print -r -- "cmd=forge_law7.gpu_envelope(x)"; } >"$f"
}
envl $M mismatched 20 "started=$EPOCHSECONDS" schema=2 "pstart=$(( PSM - 1000 ))"
adm --pid $N --name newjob --peak-gb 15 --dry-run 2>/dev/null; ck "a live pid with the WRONG pstart is not counted (15 admitted beside a 20)" $?
envl $M mismatched 20 "started=$EPOCHSECONDS" schema=2 "pstart=$PSM"
adm --pid $N --name newjob --peak-gb 15 --dry-run 2>"$ROOT/e6"; (( $? == 1 )); ck "A/B: the same envelope with the RIGHT pstart is counted (20 + 15 > 22 -> 1)" $?
rm -f "$D/jobs/$M.job"
sleep 0 & dp=$!; wait $dp
envl $dp deadjob 20 "started=$EPOCHSECONDS"
adm --pid $N --name newjob --peak-gb 15 --dry-run 2>/dev/null; ck "a dead-pid envelope is not counted" $?
rm -f "$D/jobs/$dp.job"
envl $M law7-trainer 26 "started=$EPOCHSECONDS"
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>"$ROOT/e6"; rc=$?
(( rc == 1 )) && grep -qF "law7-trainer pid $M holds 26.0" "$ROOT/e6"; ck "a legacy forge_law7-style envelope (no pstart; started=now) IS counted: 26 + 1 > 22 -> 1, holder named" $?
envl $M law7-trainer 26 "started=$(( PSM - 100 ))"
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>/dev/null; ck "A/B: 'started' 100 s BEFORE the process started -> a reused pid, not counted" $?
# FO-5: "unverifiable" means never SIGNAL the pid, not "its memory is free". A live job
# the engine cannot verify still holds its declared reservation.
envl $M noid 26
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>"$ROOT/e6"; rc=$?
(( rc == 1 )) && grep -qF "noid pid $M holds 26.0" "$ROOT/e6"
ck "[FO-5] no pstart and no started (unverifiable) but ALIVE -> still counted: 26 + 1 > 22 -> 1 (rc=$rc)" $?
envl $M halfsec 26 "started=$EPOCHSECONDS.5"
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>/dev/null; rc=$?
(( rc == 1 )); ck "[FO-5] started=<now>.5 (unparseable -> unverifiable) still counted -> 1 (rc=$rc)" $?
envl $M badpeak 24GiB "started=$EPOCHSECONDS"
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>"$ROOT/e6"; rc=$?
(( rc == 75 )) && grep -q "jobs/$M.job" "$ROOT/e6" && grep -q 'peak_gb' "$ROOT/e6"
ck "[FO-5] a live envelope with peak_gb=24GiB -> 75 naming the file, never read as 0 (rc=$rc)" $?
envl $M nopeak "" "started=$EPOCHSECONDS"; sed -i '' '/^peak_gb=/d' "$D/jobs/$M.job"
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>/dev/null; rc=$?
(( rc == 75 )); ck "[FO-5] a live envelope with NO peak_gb -> 75 (rc=$rc)" $?
rm -f "$D/jobs/$M.job"
sleep 0 & dp=$!; wait $dp
envl $dp deadbadpeak 24GiB "started=$EPOCHSECONDS"
adm --pid $N --name newjob --peak-gb 1 --dry-run 2>/dev/null; ck "[FO-5] A/B: the same bad peak_gb on a DEAD pid's envelope holds nothing -> 0" $?
rm -f "$D"/jobs/*.job(N)
envl $M noid 26
"$B" snapshot --state-dir "$D" >"$ROOT/snap6b.json"
[[ $(pyj "$ROOT/snap6b.json" 'd["reservations"]["reserved_b"] >= 26*2**30') == True ]]
ck "[FO-5] the published reserved_b counts the live unverifiable job too (publisher == engine)" $?
rm -f "$D"/jobs/*.job(N)

# ================================================================ 7. instant fit
sect "7. instant fit: declared-but-not-resident reservations"
inject "mem_total_b=$(( 100 * GiB ))" "mem_avail_b=$(( 10 * GiB ))"   # budget 94, available 10
new_sleeper; X=$NEWPID; new_sleeper; Y=$NEWPID
adm --pid $X --name big-loader --peak-gb 6 2>/dev/null; ck "X: 6 + 0 + margin 2 <= 10 available -> admitted" $?
adm --pid $Y --name small --peak-gb 4 --json --dry-run >"$ROOT/j7" 2>"$ROOT/e7"; rc=$?
note "$(cat "$ROOT/e7")"
(( rc == 1 )) && grep -q '^forge-guardian-sensor admit: instant: ' "$ROOT/e7" && grep -qF "big-loader pid $X has unbacked 6.0" "$ROOT/e7" \
  && [[ $(pyj "$ROOT/j7" 'd["fit"]["budget"]["ok"]') == True ]]
ck "Y (4): budget alone admits (10 <= 94) but 4 + 6 unbacked + 2 > 10 -> instant deny" $?
print -r -- '{"memory": {"enforce_instant_fit": false}}' >"$D/policy.json"
adm --pid $Y --name small --peak-gb 4 --dry-run 2>/dev/null; ck "A/B: memory.enforce_instant_fit=false -> admitted" $?
rm -f "$D/policy.json"
"$B" release --state-dir "$D" --pid $X; ck "release X" $?
adm --pid $Y --name small --peak-gb 4 --dry-run 2>/dev/null; ck "A/B: with X released -> admitted" $?
inject $BUDGET_INJ

# ================================================================ 8. disk fit
sect "8. disk fit"
new_sleeper; K1=$NEWPID; new_sleeper; K2=$NEWPID
mkdir -p "$ROOT/mnt"
if hdiutil create -size 2m -fs HFS+ -volname fgtest "$ROOT/fg.dmg" >/dev/null 2>&1 \
   && hdiutil attach -nobrowse -mountpoint "$ROOT/mnt" "$ROOT/fg.dmg" >/dev/null 2>&1; then
  MNT=$ROOT/mnt
  adm --pid $K1 --name dj --peak-gb 0.1 --disk-gb 0.001 --disk-path "$MNT/out" --json --dry-run >"$ROOT/j8" 2>"$ROOT/e8"; rc=$?
  note "$(cat "$ROOT/e8")"
  (( rc == 1 )) && grep -q 'disk: .* < yellow floor 45 GiB' "$ROOT/e8" && [[ $(pyj "$ROOT/j8" 'd["fit"]["disk"]["mount"]') == $MNT ]]
  ck "tiny hdiutil volume as --disk-path -> deny below the yellow floor (statfs of the real volume)" $?
  hdiutil detach "$MNT" -force >/dev/null 2>&1; MNT=""
else
  note "hdiutil unavailable: tiny-volume arm skipped"
fi
adm --pid $K1 --name dj --peak-gb 0.1 --disk-gb 0.001 --disk-path "$ROOT/out" --json --dry-run >"$ROOT/j8b" 2>/dev/null
ck "A/B: the same request on the main volume -> admitted" $?
AV=$(pyj "$ROOT/j8b" 'd["fit"]["disk"]["avail_gb"]')
XG=$(printf '%.3f' $(( (AV - 45) * 0.6 )))
note "main volume avail $AV GiB; each job declares $XG GiB"
adm --pid $K1 --name dj1 --peak-gb 0.1 --disk-gb $XG --disk-path "$ROOT/out1" 2>/dev/null; ck "job 1 ($XG GiB) admitted" $?
[[ -n $(kvv "$D/jobs/$K1.job" disk_fsid) && -n $(kvv "$D/jobs/$K1.job" disk_avail0_b) ]]; ck "  ...envelope records disk_fsid and disk_avail0_b" $?
adm --pid $K2 --name dj2 --peak-gb 0.1 --disk-gb $XG --disk-path "$ROOT/out2" 2>"$ROOT/e8c"; rc=$?
note "$(cat "$ROOT/e8c")"
(( rc == 1 )) && grep -qF "dj1 pid $K1 has outstanding" "$ROOT/e8c"; ck "job 2 denied: job 1's unwritten reservation is outstanding on the same fsid" $?
"$B" release --state-dir "$D" --pid $K1
adm --pid $K2 --name dj2 --peak-gb 0.1 --disk-gb $XG --disk-path "$ROOT/out2" --dry-run 2>/dev/null; ck "A/B: job 1 released -> job 2 admitted" $?

# SEM-3: one drop in free space, two jobs on the volume. Each job declared H GiB and
# both were admitted at the same avail, which has since dropped H GiB. The old formula
# credited EACH job with the whole drop (outstanding 0); at most H of the 2H declared
# can have been written, and who wrote it is unknowable, so both count in full.
FSID=$(pyj "$ROOT/j8b" 'd["fit"]["disk"]["fsid"]')
H=$(printf '%.3f' $(( (AV - 45) / 2.0 )))
A0=$(python3 -I -c 'import os,sys; s=os.statvfs(sys.argv[1]); print(int(s.f_bavail*s.f_frsize + float(sys.argv[2])*2**30))' "$ROOT" "$H")
rm -f "$D"/jobs/*.job(N)
new_sleeper; S1=$NEWPID; new_sleeper; S2=$NEWPID; new_sleeper; S3=$NEWPID
for sp in $S1 $S2; do
  envl $sp disk-$sp 0.1 schema=2 "pstart=$(pstart_of $sp)" "started=$EPOCHSECONDS" "disk_gb=$H" "disk_path=$ROOT/w$sp" "disk_fsid=$FSID" "disk_avail0_b=$A0"
done
adm --pid $S3 --name dj3 --peak-gb 0.1 --disk-gb $H --disk-path "$ROOT/out3" --json --dry-run >"$ROOT/j8s" 2>"$ROOT/e8s"; rc=$?
note "$(cat "$ROOT/e8s")"
(( rc == 1 )) && [[ $(pyj "$ROOT/j8s" 'round(d["fit"]["disk"]["outstanding_gb"],1) >= round(2*float("'$H'"),1)') == True ]]
ck "[SEM-3] two jobs x $H GiB, volume dropped $H GiB since both admissions: outstanding counts 2 x $H, request of $H denied (rc=$rc)" $?
rm -f "$D/jobs/$S2.job"
adm --pid $S3 --name dj3 --peak-gb 0.1 --disk-gb $H --disk-path "$ROOT/out3" --json --dry-run >"$ROOT/j8t" 2>/dev/null; rc=$?
(( rc == 0 )) && [[ $(pyj "$ROOT/j8t" 'd["fit"]["disk"]["outstanding_gb"] < 1') == True ]]
ck "[SEM-3] A/B: ONE job on the volume -> the drop is attributable to it (outstanding ~0), admitted (rc=$rc)" $?
rm -f "$D"/jobs/*.job(N)

# ================================================================ 9. release
sect "9. release"
rm -f "$D"/jobs/*.job(N)
new_sleeper; R1=$NEWPID; new_sleeper; R2=$NEWPID
adm --pid $R1 --name rel-a --peak-gb 3 --cmd "a" 2>/dev/null && adm --pid $R2 --name rel-b --peak-gb 2 --cmd "b" 2>/dev/null
"$B" release --state-dir "$D" --pid $R1 --rc 0; rc=$?
(( rc == 0 )) && [[ ! -e $D/jobs/$R1.job && -e $D/jobs/$R2.job ]]; ck "release removes only the matching envelope" $?
tail -1 "$D/reservations.history.jsonl" >"$ROOT/h9"
[[ $(pyj "$ROOT/h9" 'd["name"]') == rel-a && $(pyj "$ROOT/h9" 'd["declared_gb"]==3') == True && $(pyj "$ROOT/h9" 'd["sig"]') == $(sig_of rel-a a) \
   && $(pyj "$ROOT/h9" 'd["rc"]') == 0 && $(pyj "$ROOT/h9" '"measured_peak_gb" in d and "wall_s" in d') == True ]]
ck "reservations.history.jsonl: {sig, name, declared_gb, measured_peak_gb, wall_s, rc, signal}" $?
envl $R1 impostor 3 schema=2 "pstart=$(( $(pstart_of $R1) - 500 ))" "started=$EPOCHSECONDS"
"$B" release --state-dir "$D" --pid $R1 2>"$ROOT/e9"; rc=$?
(( rc == 1 )) && [[ -e $D/jobs/$R1.job ]]; ck "an envelope whose pstart does not match is NOT removed (exit 1)" $?
rm -f "$D/jobs/$R1.job"
"$B" release --state-dir "$D" --pid 999999 2>/dev/null; (( $? == 1 )); ck "release with no envelope -> 1" $?
"$B" release --state-dir "$D" --pid $R2

# ================================================================ 10. crash loop
sect "10. crash loop -> quarantine"
new_sleeper; C=$NEWPID
CSIG=$(sig_of crasher "crash.py --boom")
rcs=()
for i in 1 2 3; do
  adm --pid $C --name crasher --peak-gb 0.2 --cmd "crash.py --boom" 2>/dev/null || rcs+=("admit$?")
  "$B" release --state-dir "$D" --pid $C --signal SEGV --rc 139 2>/dev/null; rcs+=($?)
done
note "release exit codes: ${rcs[*]}"
[[ ${rcs[*]} == "0 0 78" ]]; ck "three SEGV releases of one signature: the third exits 78" $?
[[ -s $D/quarantine/$CSIG.json && $(pyj "$D/quarantine/$CSIG.json" 'len(d["crashes"])') == 3 ]]; ck "quarantine/<sig>.json written with the 3 crashes" $?
idir=$(pyj "$D/quarantine/$CSIG.json" 'd["incident"]')
[[ -d $idir && $(pyj "$idir/summary.json" 'd["kind"]') == crash_loop && $(pyj "$idir/summary.json" 'd["job"]') == $CSIG ]]
ck "an incidents/ bundle exists (kind crash_loop, job $CSIG) and the quarantine names it" $?
python3 -I -c 'import json,sys; [json.loads(l) for l in open(sys.argv[1])]' "$D/events.jsonl" && grep -q '"kind":"quarantine"' "$D/events.jsonl"
ck "  ...quarantine event in a valid events.jsonl" $?
adm --pid $C --name crasher --peak-gb 0.2 --cmd "crash.py --boom" 2>"$ROOT/e10"; rc=$?
(( rc == 78 )) && grep -q quarantined "$ROOT/e10"; ck "admit of the quarantined signature -> 78" $?
adm --pid $C --name crasher --peak-gb 0.2 --cmd "crash.py --boom --fixed" --dry-run 2>/dev/null; ck "a changed command line is a different signature -> 0" $?
"$B" quarantine-clear --state-dir "$D" --sig $CSIG --reason "fixed in test" >/dev/null; ck "quarantine-clear -> 0" $?
tail -1 "$D/quarantine/cleared.jsonl" >"$ROOT/c10"
[[ $(pyj "$ROOT/c10" 'd["sig"]') == $CSIG && $(pyj "$ROOT/c10" 'd["user"]') == $(id -un) && $(pyj "$ROOT/c10" 'd["reason"]') == "fixed in test" ]]
ck "  ...cleared.jsonl has {sig, reason, user, ts}" $?
"$B" quarantine-clear --state-dir "$D" --sig $CSIG --reason again 2>/dev/null; (( $? == 1 )); ck "clearing a signature that is not quarantined -> 1" $?
adm --pid $C --name crasher --peak-gb 0.2 --cmd "crash.py --boom" 2>/dev/null; ck "admit after clear -> 0" $?
"$B" release --state-dir "$D" --pid $C --signal SEGV 2>/dev/null; ck "one more crash after the clear does not re-quarantine (pre-clear crashes do not count)" $?
rcs=()
for i in 1 2 3; do
  adm --pid $C --name termed --peak-gb 0.2 --cmd t 2>/dev/null; "$B" release --state-dir "$D" --pid $C --signal TERM --external-term; rcs+=($?)
  adm --pid $C --name termed --peak-gb 0.2 --cmd t 2>/dev/null; "$B" release --state-dir "$D" --pid $C --signal SEGV --external-term; rcs+=($?)
  adm --pid $C --name termed --peak-gb 0.2 --cmd t 2>/dev/null; "$B" release --state-dir "$D" --pid $C --signal TERM; rcs+=($?)
done
[[ ${rcs[*]} == "0 0 0 0 0 0 0 0 0" && ! -e $D/quarantine/$(sig_of termed t).json ]]
ck "--external-term never counts, and TERM is not a crash signal (9 releases, no quarantine)" $?
rcs=()
for i in 1 2 3; do
  adm --pid $C --name inferred --peak-gb 0.2 --cmd i 2>/dev/null; "$B" release --state-dir "$D" --pid $C --rc 134 2>/dev/null; rcs+=($?)
done
[[ ${rcs[*]} == "0 0 78" && $(tail -1 "$D/reservations.history.jsonl" | python3 -I -c 'import json,sys; d=json.loads(sys.stdin.read()); print(d["signal"], d["signal_inferred"])') == "ABRT True" ]]
ck "rc 134 without --signal is inferred as ABRT and counts (third -> 78)" $?
# crash_loop.window_s is bounded 60..86400 (SCHEMA §6), so the spacing is simulated
# with the test clock on the RELEASES (admission itself runs at real time).
print -r -- '{"crash_loop": {"window_s": 60}}' >"$D/policy.json"
rcs=()
for i in 1 2 3; do
  adm --pid $C --name windowed --peak-gb 0.2 --cmd w 2>/dev/null
  FORGE_SENSOR_TEST_NOW=$(( EPOCHSECONDS + 70 * i )) "$B" release --state-dir "$D" --pid $C --signal BUS 2>/dev/null; rcs+=($?)
done
rm -f "$D/policy.json"
[[ ${rcs[*]} == "0 0 0" ]]; ck "A/B: crashes spaced beyond window_s (70 s apart, window 60 s) never quarantine" $?

# R13: the release ledgers are bounded: 1 MiB, one generation.
python3 -I -c 'import json,sys
with open(sys.argv[1],"a") as f:
    while f.tell() < 1100000: f.write(json.dumps({"ts":1.0,"sig":"filler","pad":"x"*200})+"\n")' "$D/reservations.history.jsonl"
rm -f "$D/reservations.history.jsonl.1"
adm --pid $C --name ledgered --peak-gb 0.2 --cmd l 2>/dev/null; "$B" release --state-dir "$D" --pid $C --rc 0
hs=$(stat -f %z "$D/reservations.history.jsonl"); h1=$(stat -f %z "$D/reservations.history.jsonl.1" 2>/dev/null || print 0)
(( hs < 65536 && h1 > 1048576 )) && [[ $(tail -1 "$D/reservations.history.jsonl" | python3 -I -c 'import json,sys; print(json.loads(sys.stdin.read())["name"])') == ledgered ]]
ck "[R13] reservations.history.jsonl > 1 MiB rotates to .1 on the next release (current $hs B, .1 $h1 B)" $?
LSIG=$(sig_of rotcrash r)
python3 -I -c 'import json,sys,time
now=time.time()
with open(sys.argv[1],"w") as f:
    while f.tell() < 1100000: f.write(json.dumps({"ts":1.0,"pid":1,"name":"rotcrash","signal":"SEGV","pad":"x"*200})+"\n")
    for k in (2,1): f.write(json.dumps({"ts":now-k,"pid":1,"name":"rotcrash","signal":"SEGV"})+"\n")' "$D/crashes/$LSIG.jsonl"
adm --pid $C --name rotcrash --peak-gb 0.2 --cmd r 2>/dev/null; "$B" release --state-dir "$D" --pid $C --signal SEGV 2>/dev/null; rc=$?
ls1=$(stat -f %z "$D/crashes/$LSIG.jsonl" 2>/dev/null || print -1)
(( rc == 78 && ls1 < 65536 )) && [[ -s $D/crashes/$LSIG.jsonl.1 && -s $D/quarantine/$LSIG.json ]]
ck "[R13] a crash ledger > 1 MiB rotates, and the two in-window crashes now in .1 still count: third -> 78 (rc=$rc, ledger $ls1 B)" $?
"$B" quarantine-clear --state-dir "$D" --sig $LSIG --reason r13 >/dev/null
print -r -- '{"ts":1.0}' >"$D/crashes/0ldstale0000000.jsonl"; print -r -- '{"ts":1.0}' >"$D/crashes/0ldquarant00000.jsonl"
print -r -- '{"sig":"0ldquarant00000"}' >"$D/quarantine/0ldquarant00000.json"
old=$(date -r $(( EPOCHSECONDS - 40 * 86400 )) +%Y%m%d%H%M.%S); touch -t $old "$D/crashes/0ldstale0000000.jsonl" "$D/crashes/0ldquarant00000.jsonl"
adm --pid $C --name ledgered --peak-gb 0.2 --cmd l 2>/dev/null; "$B" release --state-dir "$D" --pid $C --rc 0
[[ ! -e $D/crashes/0ldstale0000000.jsonl && -e $D/crashes/0ldquarant00000.jsonl ]]
ck "[R13] a crash ledger untouched for 40 days (> retention 30) is pruned; one whose signature is quarantined is kept" $?
rm -f "$D/quarantine/0ldquarant00000.json" "$D/crashes/0ldquarant00000.jsonl"

# ================================================================ 11. --wait
sect "11. --wait retries without holding the lock"
rm -f "$D"/jobs/*.job(N)
fresh_state YELLOW
new_sleeper; W=$NEWPID; new_sleeper; V=$NEWPID
t0=$EPOCHREALTIME
( adm --pid $W --name waiter --peak-gb 1 --need green --wait 12 2>/dev/null; print $? >"$ROOT/w.rc"; print $EPOCHREALTIME >"$ROOT/w.t" ) &
WJ=$!
sleep 0.5
t1=$EPOCHREALTIME
adm --pid $V --name quick --peak-gb 1 --need yellow --dry-run 2>/dev/null; qrc=$?
ql=$(( (EPOCHREALTIME - t1) * 1000 ))
note "a second admit while one waits: rc $qrc in $(printf '%.0f' $ql) ms"
(( qrc == 0 && ql < 1000 )); ck "the lock is not held while waiting (another admit decides in < 1 s)" $?
sleep 1.5; fresh_state GREEN
wait $WJ
we=$(( $(<"$ROOT/w.t") - t0 ))
note "waiter admitted after $(printf '%.1f' $we) s (state went GREEN at ~2 s; retry period 5 s)"
[[ $(<"$ROOT/w.rc") == 0 ]] && (( we > 4 && we < 8 )); ck "--wait retries every 5 s and admits once the state allows" $?
fresh_state YELLOW
t0=$EPOCHREALTIME
adm --pid $V --name waiter2 --peak-gb 1 --need green --wait 3 2>/dev/null; rc=$?
we=$(( EPOCHREALTIME - t0 ))
(( rc == 1 && we >= 2.9 && we < 4.5 )); r_=$?; ck "A/B: --wait 3 at YELLOW gives up after ~3 s with exit 1 ($(printf '%.1f' $we) s)" $r_
fresh_state GREEN

# ================================================================ 12. lock interop
sect "12. admission.lock interoperates with Python fcntl.lockf (forge_law7)"
python3 -I -c 'import fcntl,os,sys,time
fd=os.open(sys.argv[1], os.O_RDWR|os.O_CREAT, 0o600)
fcntl.lockf(fd, fcntl.LOCK_EX)
open(sys.argv[2],"w").write("held")
time.sleep(2.0)' "$D/admission.lock" "$ROOT/held" &
PYL=$!; note_pid $PYL
while [[ ! -s $ROOT/held ]]; do sleep 0.05; done
t0=$EPOCHREALTIME
adm --pid $V --name locked --peak-gb 1 --dry-run 2>/dev/null; rc=$?
lw=$(( EPOCHREALTIME - t0 ))
wait $PYL
t1=$EPOCHREALTIME
adm --pid $V --name unlocked --peak-gb 1 --dry-run 2>/dev/null
uw=$(( EPOCHREALTIME - t1 ))
note "admit under a Python-held lock: $(printf '%.2f' $lw) s; without: $(printf '%.3f' $uw) s"
(( rc == 0 && lw > 1.5 && uw < 0.5 )); ck "admit waits for a lock held via Python lockf, then decides" $?

# ================================================================ 14. registry limits
sect "14. registry limits (SCHEMA §6): never a silently shorter registry"
rm -f "$D"/jobs/*.job(N)
fresh_state GREEN
new_sleeper; HL=$NEWPID; new_sleeper; PR=$NEWPID
PSH=$(pstart_of $HL)
mkmany() { # mkmany COUNT PREFIX PEAK
  python3 -I -c 'import sys,time
d,n,pre,peak,pid,ps=sys.argv[1],int(sys.argv[2]),sys.argv[3],sys.argv[4],sys.argv[5],sys.argv[6]
for i in range(1,n+1):
    open("%s/%s%05d.job"%(d,pre,i),"w").write("pid=%s\nname=%s%05d\npriority=5\ncan_restart=0\npeak_gb=%s\ngpu=0\nstarted=%d\nschema=2\npstart=%s\ncmd=x\n"%(pid,pre,i,peak,int(time.time()),ps))' "$D/jobs" "$1" "$2" "$3" $HL $PSH
}
envl $HL zzzz 20 schema=2 "pstart=$PSH" "started=$EPOCHSECONDS"; mv "$D/jobs/$HL.job" "$D/jobs/zzzz.job"
mkmany 1023 a 0.001
adm --pid $PR --name probe --peak-gb 5 --dry-run 2>"$ROOT/e14"; rc=$?
(( rc == 1 )) && grep -q 'zzzz' "$ROOT/e14"; ck "[R4] 1024 envelopes (the limit): the 20 GiB zzzz.job is counted -> deny (rc=$rc)" $?
mkmany 1024 a 0.001
adm --pid $PR --name probe --peak-gb 5 --dry-run 2>"$ROOT/e14"; rc=$?
note "$(head -c 160 "$ROOT/e14")"
(( rc == 75 )) && grep -q 'more than 1024' "$ROOT/e14"; ck "[R4] 1025 envelopes -> 75 (cannot decide), never a registry silently cut to 1024 (rc=$rc)" $?
"$B" snapshot --state-dir "$D" >"$ROOT/snap14.json"
[[ $(pyj "$ROOT/snap14.json" 'd["reservations"]["status"]') == unavailable ]]; ck "[R4] ...and the snapshot publishes the registry unavailable (jobs_st)" $?
rm -f "$D"/jobs/*(N)
python3 -I -c 'import sys
for i in range(6000): open("%s/%d.job.tmp.%d"%(sys.argv[1],i,i),"w").close()' "$D/jobs"
envl $HL x1 20 schema=2 "pstart=$PSH" "started=$EPOCHSECONDS"
adm --pid $PR --name probe --peak-gb 5 --dry-run 2>"$ROOT/e14"; rc=$?
(( rc == 75 )) && grep -q 'more than 4096 entries' "$ROOT/e14"; ck "[R4] 6000 tmp files + one 20 GiB envelope -> 75, never 'reserved 0' (rc=$rc)" $?
rm -f "$D"/jobs/*(N)

# R7: an envelope > 64 KiB is read (capped) and kept as unverifiable: counted, never
# signalled, never dropped.
envl $HL bigcmd 20 schema=2 "pstart=$PSH" "started=$EPOCHSECONDS"
print -r -- "cmd=$(head -c 70000 /dev/zero | tr '\0' a)" >>"$D/jobs/$HL.job"
"$B" snapshot --state-dir "$D" >"$ROOT/snap14b.json"
[[ $(pyj "$ROOT/snap14b.json" '[(j["identity"], j.get("oversize")) for j in d["jobs"] if j["pid"]=='$HL']') == "[('unverifiable', True)]" ]]
ck "[R7] a 70 KB envelope of a live, verifiable job is listed as unverifiable (never signalled), not dropped" $?
adm --pid $PR --name probe --peak-gb 5 --dry-run 2>"$ROOT/e14"; rc=$?
(( rc == 1 )) && grep -qF "bigcmd pid $HL holds 20.0" "$ROOT/e14"; ck "[R7] ...and its 20 GiB reservation still counts -> deny (rc=$rc)" $?
rm -f "$D"/jobs/*(N)

# R1: only REGULAR *.job files are envelopes; nothing else is ever opened.
envl $HL realjob 20 schema=2 "pstart=$PSH" "started=$EPOCHSECONDS"
mkfifo "$D/jobs/424242.job"; ln -s /dev/zero "$D/jobs/zero.job"; mkdir "$D/jobs/dir.job"
( "$B" snapshot --state-dir "$D" >"$ROOT/snap14c.json" 2>/dev/null; print $? >"$ROOT/snap14c.rc" ) & SJ=$!; note_pid $SJ
wait_s=0; while alive $SJ && (( wait_s < 30 )); do sleep 0.1; (( wait_s++ )); done
alive $SJ && { kill -9 $SJ 2>/dev/null; print 124 >"$ROOT/snap14c.rc"; }
[[ $(<"$ROOT/snap14c.rc") == 0 && $(pyj "$ROOT/snap14c.json" 'd["reservations"]["status"]+"|"+",".join(j["file"] for j in d["jobs"])') == "ok|$HL.job" ]]
r_=$?; ck "[R1] a FIFO, a symlink to /dev/zero and a directory named *.job: never opened, the registry stays readable (snapshot rc $(<"$ROOT/snap14c.rc"))" $r_
adm --pid $PR --name probe --peak-gb 5 --dry-run 2>"$ROOT/e14"; rc=$?
(( rc == 1 )) && grep -qF "realjob pid $HL holds 20.0" "$ROOT/e14"; ck "[R1] ...admit decides on the real envelopes (deny, realjob counted), not 75 (rc=$rc)" $?
rm -rf "$D"/jobs/*(N)

# ================================================================ 13. usage
sect "13. usage errors -> 2"
adm --name x --peak-gb 1 2>/dev/null; (( $? == 2 )); ck "missing --pid -> 2" $?
adm --pid $V --name x --peak-gb 1 --need purple 2>/dev/null; (( $? == 2 )); ck "bad --need -> 2" $?
adm --pid $V --name x --peak-gb 1 --disk-gb 1 2>/dev/null; (( $? == 2 )); ck "--disk-gb without --disk-path -> 2" $?
adm --pid $V --name x --peak-gb -1 2>/dev/null; (( $? == 2 )); ck "negative --peak-gb -> 2" $?
adm --pid $V --name x --peak-gb 1 --sig '../../etc' 2>/dev/null; (( $? == 2 )); ck "a --sig that could escape quarantine/ -> 2" $?

print -r -- ""
print -r -- "admission_gate: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
