#!/bin/zsh
# ============================================================================
# forge_job_admission_gate.sh -- forge-job's v2 admission + release contract
# (SCHEMA.md §5 envelopes, §9 admission/release/quarantine).
#
#   usage: forge_job_admission_gate.sh [path/to/forge-job]
#
# What it pins, each as a VECTOR of observables (rc, did the child run, what the
# sensor was asked, what is left in jobs/):
#   * sensor path: admitted -> the child runs under its envelope and the sensor sees
#     `release --rc 0`; denied (1) -> 75 and the child never ran; 75 -> 75; 2 -> 2;
#     quarantined (78) -> 78 with the exact `quarantine clear` command printed;
#   * crash accounting: a child killed by SEGV -> `release --signal SEGV`; a wrapper
#     TERMed from outside -> `release --external-term` and the child got TERM;
#   * a TERM during the admission WAIT stops the wrapper at once, does not start the
#     job, and leaves no orphaned admission/gate process behind;
#   * legacy path (no sensor anywhere): an atomic envelope with v1 keys in order,
#     schema=2, boot, pstart (checked against `ps -o lstart`), owner, cmd LAST,
#     removed on exit; a newline in --name cannot forge an earlier key;
#   * then re-runs, unchanged, forge_job_usr1_gate.sh, forge_job_usage_gate.sh and the
#     resilience harness dimensions cooperative_shed and query_costs_no_slot
#     (skip with FJ_SKIP_COMPANIONS=1).
#
# HERMETIC: a private FORGE_HEALTH_DIR / ARCHIE_HEALTH_DIR under mktemp, the sensor is
# test/stub-sensor-admit via FORGE_GUARDIAN_SENSOR_BIN, every process this gate starts
# is recorded in a pid FILE (command-substitution subshells lose array appends) and
# reaped; a wall-clock watchdog bounds the whole run. Nothing outside $ROOT is touched
# and nothing this gate did not start is ever signalled.
# ============================================================================
set -u
setopt NULL_GLOB
zmodload zsh/datetime
zmodload zsh/stat 2>/dev/null
HERE=${0:A:h}
JOB=${1:-$HERE/../forge-job}
[[ -f $JOB ]] || { print -u2 "no forge-job at $JOB"; exit 1 }
JOB=${JOB:A}
STUB=$HERE/stub-sensor-admit
[[ -x $STUB ]] || { print -u2 "stub sensor missing: $STUB"; exit 1 }

PASS=0; FAIL=0
ck() { # ck <desc> <0=ok> [detail]
  if (( $2 == 0 )); then (( PASS++ )); print -r -- "    ok   $1${3:+  ($3)}"
  else (( FAIL++ )); print -r -- "    FAIL $1${3:+  ($3)}"; fi
}
t() { "$@" >/dev/null 2>&1; print $?; }      # exit status of a test command, as a word

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fjadmit.XXXXXX") || exit 1
ROOT=${ROOT:a}     # TMPDIR ends in '/': forge-job passes normalised absolute paths
PIDFILE=$ROOT/started.pids; : > $PIDFILE
reap() { local p; while read -r p; do [[ $p == <1-> ]] && kill -9 $p 2>/dev/null; done < $PIDFILE; return 0 }
GATE_BUDGET=${GATE_BUDGET:-420}
# The watchdog's own sleep is recorded too: killing only the watchdog subshell orphans
# its sleep, which then holds this gate's stdout open -- a `gate | grep` waits it out.
{ sleep $GATE_BUDGET & print -r -- $! > $ROOT/watchdog.sleep; wait $!
  print -u2 "[admission-gate] WALL-CLOCK EXCEEDED (${GATE_BUDGET}s) -- reaping and failing"
  while read -r p; do [[ $p == <1-> ]] && kill -9 $p 2>/dev/null; done < $PIDFILE
  kill -TERM $$ 2>/dev/null; sleep 2; kill -9 $$ 2>/dev/null
} &
WATCHDOG=$!
trap 'kill -9 $WATCHDOG $(cat $ROOT/watchdog.sleep 2>/dev/null) 2>/dev/null; reap; rm -rf "$ROOT"' EXIT

H=$ROOT/health; mkdir -m 700 -p $H
export FORGE_HEALTH_DIR=$H ARCHIE_HEALTH_DIR=$ROOT/archie
export FORGE_GUARDIAN_SENSOR_BIN=$STUB FG_STUB_LOG=$ROOT/calls.log FG_STUB_PIDFILE=$PIDFILE
unset FG_STUB_ADMIT_RC FG_STUB_ADMIT_SLEEP FG_STUB_RELEASE_RC 2>/dev/null

# The job. It records that it ran, whether its wrapper's envelope existed while it
# ran, the envelope itself and its mode, and the wrapper's start time as ps sees it.
CH=$ROOT/job.sh
cat > $CH <<'EOS'
#!/bin/zsh
MARK=$1; MODE=$2
print $$ >> "$FJ_PIDFILE"
print "STARTED pid=$$ ppid=$PPID" >> $MARK
E="$FORGE_HEALTH_DIR/jobs/$PPID.job"
if [[ -f $E ]]; then
  print ENVELOPE_SEEN >> $MARK
  cat "$E" > "$MARK.envelope"
  stat -f %Lp "$E" > "$MARK.mode"
fi
LC_ALL=C ps -o lstart= -p $PPID > "$MARK.lstart"
case $MODE in
  ok)   print FINISHED >> $MARK; exit 0 ;;
  rc3)  print FINISHED >> $MARK; exit 3 ;;
  segv) kill -SEGV $$; sleep 5; exit 0 ;;
  term) trap 'print GOT_TERM >> $MARK; exit 143' TERM
        print READY >> $MARK
        for i in {1..150}; do sleep 0.1 & wait $!; done
        print NO_TERM >> $MARK; exit 0 ;;
esac
EOS
chmod +x $CH
export FJ_PIDFILE=$PIDFILE

# Run forge-job (bounded). RC=TIMEOUT when it had to be killed; OUT = its output;
# WP = the wrapper pid (env execs, so $! is the wrapper itself).
run_job() {
  local deadline=$1; shift
  : > $ROOT/calls.log
  env "$@" > $ROOT/out 2>&1 &
  WP=$!; print $WP >> $PIDFILE
  local i
  for i in {1..$(( deadline * 10 ))}; do kill -0 $WP 2>/dev/null || break; sleep 0.1; done
  if kill -0 $WP 2>/dev/null; then kill -9 $WP 2>/dev/null; wait $WP 2>/dev/null; RC=TIMEOUT
  else wait $WP; RC=$?; fi
  OUT=$(<$ROOT/out)
}
calls() { cat $ROOT/calls.log 2>/dev/null }
call_line() { grep -m1 "^$1 " $ROOT/calls.log 2>/dev/null }   # first call of a subcommand
has_word() { [[ " $1 " == *" $2 "* ]] }                       # word-in-line test
# Independent oracle for SCHEMA §5: sha256(name NUL argv joined by NUL)[:16].
oracle_sig() { python3 -I -c 'import hashlib,sys; print(hashlib.sha256(b"\0".join(a.encode() for a in sys.argv[1:])).hexdigest()[:16])' "$@" }
jobs_left() { local -a j; j=($H/jobs/*.job(N)); print ${#j} }

print "== sensor path: admitted =="
M=$ROOT/m.ok; rm -f $M*
HB=$ROOT/hb; : > $HB
run_job 20 FG_STUB_ADMIT_RC=0 $JOB --name adm --priority 6 --peak-gb 1.5 --restartable --gpu --threads 4 \
  --disk-gb 2 --disk-path $ROOT --heartbeat $HB --stall-s 60 --need yellow --wait 30 -- $CH $M ok
A=$(call_line admit); R=$(call_line release)
SIG=$(oracle_sig adm $CH $M ok)
ck "admitted: wrapper rc=0"                                  $(( RC != 0 )) "rc=$RC"
ck "admitted: the child ran to completion"                   $(t grep -q FINISHED $M)
ck "admitted: the envelope existed while the child ran"      $(t grep -q ENVELOPE_SEEN $M)
ck "admitted: admit called with --pid <wrapper pid>"         $(t has_word "$A" "--pid $WP") "${A:0:90}…"
ck "admitted: admit carries name/peak/priority/need/wait/owner" \
  $(t eval 'has_word "$A" "--name adm" && has_word "$A" "--peak-gb 1.5" && has_word "$A" "--priority 6" && has_word "$A" "--need yellow" && has_word "$A" "--wait 30" && has_word "$A" "--owner forge-job"')
ck "admitted: admit carries --restartable --gpu --threads 4"  $(t eval 'has_word "$A" --restartable && has_word "$A" --gpu && has_word "$A" "--threads 4"')
ck "admitted: admit carries --disk-gb 2 --disk-path <abs>"   $(t has_word "$A" "--disk-gb 2 --disk-path $ROOT")
ck "admitted: admit carries --heartbeat <abs> --stall-s 60"  $(t eval 'has_word "$A" "--heartbeat $HB" && has_word "$A" "--stall-s 60"')
ck "admitted: --sig = sha256(name NUL argv)[:16] (python oracle)" $(t has_word "$A" "--sig $SIG") "oracle=$SIG"
ck "admitted: --cmd is the command line"                     $(t eval '[[ "$A" == *"--cmd ${(q)${:-$CH $M ok}}"* ]]')
ck "admitted: the sensor saw release --pid <wrapper> --rc 0" $(t eval 'has_word "$R" "--pid $WP" && has_word "$R" "--rc 0"') "$R"
ck "admitted: release has no --signal / --external-term"     $(t eval '! has_word "$R" --signal && ! has_word "$R" --external-term')
ck "admitted: admit was called BEFORE release"               $(t eval '[[ $(calls | head -1) == admit* && $(calls | tail -1) == release* ]]')
ck "admitted: no envelope left behind"                       $(( $(jobs_left) != 0 )) "left=$(jobs_left)"

print "== sensor path: refusals never run the child =="
for pair in "1:75:denied" "75:75:cannot-decide" "2:2:usage" "78:78:quarantined"; do
  arc=${pair%%:*}; rest=${pair#*:}; want=${rest%%:*}; what=${rest#*:}
  M=$ROOT/m.ref$arc; rm -f $M*
  run_job 15 FG_STUB_ADMIT_RC=$arc $JOB --name refused --peak-gb 1 -- $CH $M ok
  ck "admit rc=$arc ($what) -> wrapper rc=$want"       $(( RC != want )) "rc=$RC"
  ck "admit rc=$arc ($what) -> the child NEVER ran"    $(t test ! -e $M)
  ck "admit rc=$arc ($what) -> no release call"        $(t eval '! grep -q "^release" $ROOT/calls.log')
done
SIGQ=$(oracle_sig refused $CH $ROOT/m.ref78 ok)
ck "quarantined: the exact clear command is printed" \
  $(t eval '[[ "$OUT" == *"forge-guardian-ctl quarantine clear $SIGQ --reason \""* ]]') "$(print -r -- "$OUT" | grep -m1 'quarantine clear')"

print "== crash and stop accounting =="
M=$ROOT/m.segv; rm -f $M*
run_job 15 $JOB --name crasher --peak-gb 1 -- $CH $M segv
R=$(call_line release)
ck "SEGV child: wrapper rc=139 (128+11)"                     $(( RC != 139 )) "rc=$RC"
ck "SEGV child: release --rc 139 --signal SEGV"              $(t eval 'has_word "$R" "--rc 139" && has_word "$R" "--signal SEGV"') "$R"
ck "SEGV child: NOT marked --external-term (it is a crash)"  $(t eval '! has_word "$R" --external-term')

M=$ROOT/m.rc3; rm -f $M*
run_job 15 $JOB --name exit3 --peak-gb 1 -- $CH $M rc3
R=$(call_line release)
ck "rc=3 child: wrapper rc=3, release --rc 3, no --signal"   $(t eval '[[ $RC == 3 ]] && has_word "$R" "--rc 3" && ! has_word "$R" --signal') "rc=$RC $R"

M=$ROOT/m.term; rm -f $M*
: > $ROOT/calls.log
env $JOB --name stopped --peak-gb 1 -- $CH $M term > $ROOT/out 2>&1 &
WP=$!; print $WP >> $PIDFILE
for i in {1..50}; do grep -q READY $M 2>/dev/null && break; sleep 0.1; done
kill -TERM $WP
for i in {1..100}; do kill -0 $WP 2>/dev/null || break; sleep 0.1; done
if kill -0 $WP 2>/dev/null; then kill -9 $WP; RC=TIMEOUT; else wait $WP; RC=$?; fi
R=$(call_line release)
ck "outside TERM: the child received TERM"                   $(t grep -q GOT_TERM $M)
ck "outside TERM: wrapper exits with the child's rc (143)"   $(( RC != 143 )) "rc=$RC"
ck "outside TERM: release --external-term"                   $(t has_word "$R" --external-term) "$R"
ck "outside TERM: release --rc 143 --signal TERM"            $(t eval 'has_word "$R" "--rc 143" && has_word "$R" "--signal TERM"')
ck "outside TERM: no envelope left behind"                   $(( $(jobs_left) != 0 ))

M=$ROOT/m.slow; rm -f $M*
: > $ROOT/calls.log
n0=$(wc -l < $PIDFILE)
t0=$EPOCHREALTIME
env FG_STUB_ADMIT_SLEEP=30 $JOB --name slow --peak-gb 1 -- $CH $M ok > $ROOT/out 2>&1 &
WP=$!; print $WP >> $PIDFILE
for i in {1..50}; do grep -q '^admit' $ROOT/calls.log 2>/dev/null && break; sleep 0.1; done
sleep 0.5
t1=$EPOCHREALTIME
kill -TERM $WP
for i in {1..100}; do kill -0 $WP 2>/dev/null || break; sleep 0.1; done
if kill -0 $WP 2>/dev/null; then kill -9 $WP; RC=TIMEOUT; else wait $WP; RC=$?; fi
t2=$EPOCHREALTIME
lat=$(( t2 - t1 ))
ck "TERM during the admission wait: wrapper stops promptly"  $(( lat > 3.0 )) "$(printf '%.2f' $lat)s after TERM, rc=$RC"
ck "TERM during the admission wait: rc=143, child never ran" $(t eval '[[ $RC == 143 && ! -e $M ]]') "rc=$RC"
# The stub admit process (recorded in the pid file) must be gone -- it was ours.
sleep 0.3
alive=0; for p in $(tail -n +$(( n0 + 1 )) $PIDFILE); do [[ $p == <1-> ]] && kill -0 $p 2>/dev/null && (( alive++ )); done
nrec=$(( $(wc -l < $PIDFILE) - n0 ))
ck "TERM during the admission wait: the wrapper and its admit process are both gone" $(( alive != 0 || nrec < 2 )) "recorded=$nrec alive=$alive"

M=$ROOT/m.usr1adm; rm -f $M*
: > $ROOT/calls.log
env FG_STUB_ADMIT_SLEEP=2 $JOB --name usr1-during-admission --peak-gb 1 -- $CH $M ok > $ROOT/out 2>&1 &
WP=$!; print $WP >> $PIDFILE
for i in {1..50}; do grep -q '^admit' $ROOT/calls.log 2>/dev/null && break; sleep 0.1; done
sleep 0.3; kill -USR1 $WP
for i in {1..150}; do kill -0 $WP 2>/dev/null || break; sleep 0.1; done
if kill -0 $WP 2>/dev/null; then kill -9 $WP; RC=TIMEOUT; else wait $WP; RC=$?; fi
ck "USR1 during the admission wait: the wrapper survives, the job runs after admission (rc 0)" \
  $(t eval '[[ $RC == 0 ]] && grep -q FINISHED $M') "rc=$RC"

print "== sensor misconfiguration and release outcomes =="
M=$ROOT/m.nobin; rm -f $M*
run_job 10 FORGE_GUARDIAN_SENSOR_BIN=$ROOT/no-such-sensor $JOB --name nobin --peak-gb 1 -- $CH $M ok
ck "explicit FORGE_GUARDIAN_SENSOR_BIN missing -> 75, child never ran" $(t eval '[[ $RC == 75 && ! -e $M ]]') "rc=$RC"

M=$ROOT/m.rq; rm -f $M*
run_job 15 FG_STUB_RELEASE_RC=78 $JOB --name nowq --peak-gb 1 -- $CH $M ok
SIGR=$(oracle_sig nowq $CH $M ok)
ck "release rc=78: wrapper still returns the child's rc (0)" $(( RC != 0 )) "rc=$RC"
ck "release rc=78: says QUARANTINED and prints the clear command" \
  $(t eval '[[ "$OUT" == *QUARANTINED* && "$OUT" == *"quarantine clear $SIGR --reason"* ]]')

M=$ROOT/m.rf; rm -f $M*
run_job 15 FG_STUB_RELEASE_RC=70 $JOB --name relfail --peak-gb 1 -- $CH $M ok
ck "release failed (70): the envelope existed during the run" $(t grep -q ENVELOPE_SEEN $M)
ck "release failed (70): forge-job removes its own envelope"  $(( $(jobs_left) != 0 )) "left=$(jobs_left)"

print "== usage errors never reach the sensor =="
for args in "--priority 12" "--peak-gb abc" "--stall-s 5" "--threads 0" "--need purple" "--disk-path /tmp" "--sig XYZ"; do
  run_job 5 $JOB ${=args} -- /usr/bin/true
  ck "'$args' -> 2, no admit call" $(t eval '[[ $RC == 2 ]] && ! grep -q "^admit" $ROOT/calls.log') "rc=$RC"
done
run_job 5 $JOB --name
ck "'--name' with no value -> 2 (not a set -u crash)"       $(t eval '[[ $RC == 2 && "$OUT" != *"parameter not set"* ]]') "rc=$RC"

print "== legacy path: no sensor anywhere =="
# A private copy of forge-job in a directory WITHOUT a sibling sensor, and a domain whose
# bin/ has only forge-gate: the only way left is today's gate + forge-job's own envelope.
L=$ROOT/legacy; LB=$ROOT/legacy-tools; mkdir -m 700 -p $L/bin $LB
cp $JOB $LB/forge-job; chmod 755 $LB/forge-job
ck "legacy: the private copy is byte-identical to the forge-job under test" $(t cmp -s $JOB $LB/forge-job)
cat > $L/bin/forge-gate <<EOS
#!/bin/zsh
print -r -- "\${(j: :)\${(q)@}}" >> $ROOT/gate.calls
print -r -- \$\$ >> $PIDFILE
if [[ -n \${FJ_GATE_SLEEP:-} ]]; then
  trap 'kill \$SP 2>/dev/null; exit 143' TERM
  sleep \$FJ_GATE_SLEEP & SP=\$!; wait \$SP
fi
exit \${FJ_GATE_RC:-0}
EOS
chmod +x $L/bin/forge-gate
M=$ROOT/m.leg; rm -f $M*; : > $ROOT/gate.calls
# v1 flags only, so the envelope checks below also mean something against a v1 wrapper.
run_job 20 -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR=$L $LB/forge-job --name legacy-job --priority 7 --peak-gb 2.5 --restartable -- $CH $M ok
E=$M.envelope
ck "legacy: wrapper rc=0 and the child ran"                  $(t eval '[[ $RC == 0 ]] && grep -q FINISHED $M') "rc=$RC"
ck "legacy: forge-gate consulted with --need green --wait 900 --why legacy-job" \
  $(t grep -q -- '--need green --wait 900 --why legacy-job' $ROOT/gate.calls) "$(<$ROOT/gate.calls)"
ck "legacy: the envelope existed while the child ran"        $(t test -s $E)
keys=$(sed -n 's/=.*//p' $E 2>/dev/null | head -7 | tr '\n' ' ')
ck "legacy: v1 keys first, in today's order"                 $(t test "$keys" = "pid name priority can_restart peak_gb gpu started ") "$keys"
ck "legacy: v1 values (pid=wrapper, priority 7, can_restart 1, peak 2.5)" \
  $(t eval 'grep -qx "pid=$WP" $E && grep -qx priority=7 $E && grep -qx can_restart=1 $E && grep -qx peak_gb=2.5 $E && grep -qx gpu=0 $E')
ck "legacy: schema=2 and owner=forge-job"                    $(t eval 'grep -qx schema=2 $E && grep -qx owner=forge-job $E')
bootnow=$(sysctl -n kern.bootsessionuuid)
ck "legacy: boot = kern.bootsessionuuid"                     $(t grep -qx "boot=$bootnow" $E) "$(grep '^boot=' $E)"
ls_ps=$(<$M.lstart); ls_ps=${(j: :)${=ls_ps}}
strftime -r -s ps_ep '%a %b %d %H:%M:%S %Y' "$ls_ps" 2>/dev/null || ps_ep=-1
env_ps=$(sed -n 's/^pstart=//p' $E | head -1)
d=$(( ${env_ps:-0} - ps_ep )); (( d < 0 )) && d=$(( -d ))
ck "legacy: pstart = the wrapper's start per ps -o lstart (±1s)" $(( !(ps_ep > 0 && d <= 1) )) "pstart=$env_ps ps=$ps_ep ('$ls_ps')"
st=$(sed -n 's/^started=//p' $E | head -1)
ck "legacy: started is an epoch not before pstart"           $(t eval '(( st >= env_ps && st - env_ps < 30 ))') "started=$st"
ck "legacy: sig = the SCHEMA §5 oracle"                      $(t grep -qx "sig=$(oracle_sig legacy-job $CH $M ok)" $E)
ck "legacy: cmd is the LAST line and is the command line"    $(t test "$(tail -1 $E)" = "cmd=$CH $M ok") "$(tail -1 $E)"
ck "legacy: envelope mode 0600"                              $(t test "$(<$M.mode)" = 600) "mode=$(<$M.mode 2>/dev/null)"
tmpl=($L/jobs/*.tmp.*(N))
ck "legacy: no temp file left in jobs/ (written tmp + rename)" $(( ${#tmpl} != 0 ))
legleft=($L/jobs/*.job(N))
ck "legacy: envelope removed on exit"                        $(( ${#legleft} != 0 ))

M=$ROOT/m.v2; rm -f $M*; : > $ROOT/hb2
run_job 20 -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR=$L $LB/forge-job --name legacy-v2 --peak-gb 1 --threads 3 --heartbeat $ROOT/hb2 --stall-s 30 -- $CH $M ok
ck "legacy: --threads/--heartbeat/--stall-s recorded in the envelope" \
  $(t eval 'grep -qx threads=3 $M.envelope && grep -qx "heartbeat=$ROOT/hb2" $M.envelope && grep -qx stall_s=30 $M.envelope') "rc=$RC"

M=$ROOT/m.inj; rm -f $M*
run_job 20 -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR=$L $LB/forge-job --name $'evil\ncan_restart=1' --peak-gb 1 -- $CH $M ok
ck "legacy: a newline in --name cannot forge an earlier key" \
  $(t eval '[[ "$(sed -n "s/^can_restart=//p" $M.envelope | head -1)" == 0 ]] && grep -qx "name=evil can_restart=1" $M.envelope') \
  "first can_restart=$(sed -n 's/^can_restart=//p' $M.envelope | head -1)"

print "== R7: an envelope stays far below 64 KiB: values capped at 4000 bytes, absurd paths/numbers refused =="
# SCHEMA §6: an envelope over 64 KiB is `unverifiable` (never signalled); the governor
# used to DELETE it, and the legacy path wrote a 70 000-byte argv into cmd= uncapped.
# The writers cap cmd= at 4 KiB: 4000 bytes, as admit's one_line(v, 4000).
nbytes() { print -rn -- "$1" | wc -c | tr -d ' ' }
utf8_ok() { python3 -I -c 'import sys; open(sys.argv[1], "rb").read().decode("utf-8")' "$1" 2>/dev/null }
BIG=$(head -c 70000 /dev/zero | tr '\0' a)
M=$ROOT/m.big; rm -f $M*
run_job 30 -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR=$L $LB/forge-job --name bigargs --peak-gb 1 -- $CH $M ok "$BIG"
cmdv=$(sed -n 's/^cmd=//p' $M.envelope 2>/dev/null)
ck "legacy, a 70 000-byte argument: the job ran (rc 0) and its envelope is < 8 KiB" \
  $(t eval '[[ $RC == 0 ]] && grep -q FINISHED $M && (( $(wc -c < $M.envelope) < 8192 ))') "rc=$RC envelope=$(wc -c < $M.envelope 2>/dev/null | tr -d ' ')B"
ck "legacy: cmd= is exactly the first 4000 bytes of the command line" \
  $(t eval '(( $(nbytes "$cmdv") == 4000 )) && [[ "$CH $M ok $BIG" == "$cmdv"* ]]') "cmd=$(nbytes "$cmdv")B"
M=$ROOT/m.bigs; rm -f $M*
run_job 30 FG_STUB_ADMIT_RC=0 $JOB --name bigargs --peak-gb 1 -- $CH $M ok "$BIG"
cmdv=$(sed -n 's/^cmd=//p' $M.envelope 2>/dev/null)
ck "sensor path: the --cmd given to admit is the first 4000 bytes too" \
  $(t eval '[[ $RC == 0 ]] && (( $(nbytes "$cmdv") == 4000 )) && [[ "$CH $M ok $BIG" == "$cmdv"* ]]') "rc=$RC cmd=$(nbytes "$cmdv")B"
MB=$(repeat 3000 print -rn -- 'é')     # 6000 bytes, 2 per character
for loc in C en_US.UTF-8; do
  M=$ROOT/m.mb.$loc; rm -f $M*
  run_job 30 -u FORGE_GUARDIAN_SENSOR_BIN LC_ALL=$loc FORGE_HEALTH_DIR=$L $LB/forge-job --name "x$MB" --peak-gb 1 -- $CH $M ok "$MB"
  sed -n 's/^name=//p' $M.envelope > $M.name 2>/dev/null; sed -n 's/^cmd=//p' $M.envelope > $M.cmd 2>/dev/null
  ck "LC_ALL=$loc: a multibyte name and argv are capped at <= 4000 bytes on a character boundary (valid UTF-8)" \
    $(t eval '[[ $RC == 0 ]] && (( $(wc -c < $M.name) - 1 <= 4000 && $(wc -c < $M.cmd) - 1 <= 4000 && $(wc -c < $M.cmd) - 1 >= 3990 )) && utf8_ok $M.name && utf8_ok $M.cmd') \
    "rc=$RC name=$(( $(wc -c < $M.name 2>/dev/null || print 1) - 1 ))B cmd=$(( $(wc -c < $M.cmd 2>/dev/null || print 1) - 1 ))B"
done
LONGP=$ROOT/$(head -c 1100 /dev/zero | tr '\0' h)
run_job 5 $JOB --name hb --peak-gb 1 --heartbeat $LONGP -- /usr/bin/true
ck "--heartbeat longer than PATH_MAX (1024): usage error 2, admit never asked" $(t eval '[[ $RC == 2 ]] && ! grep -q "^admit" $ROOT/calls.log') "rc=$RC"
run_job 5 $JOB --name dk --peak-gb 1 --disk-gb 1 --disk-path $LONGP -- /usr/bin/true
ck "--disk-path longer than PATH_MAX: usage error 2, admit never asked" $(t eval '[[ $RC == 2 ]] && ! grep -q "^admit" $ROOT/calls.log') "rc=$RC"
run_job 5 $JOB --name th --peak-gb 1 --threads $(repeat 40 print -rn 9) -- /usr/bin/true
ck "a 40-digit --threads: usage error 2, admit never asked"   $(t eval '[[ $RC == 2 ]] && ! grep -q "^admit" $ROOT/calls.log') "rc=$RC"

M=$ROOT/m.legslow; rm -f $M*
n0=$(wc -l < $PIDFILE)
env -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR=$L FJ_GATE_SLEEP=20 $LB/forge-job --name legslow --peak-gb 1 -- $CH $M ok > $ROOT/out 2>&1 &
WP=$!; print $WP >> $PIDFILE
for i in {1..50}; do grep -q legslow $ROOT/gate.calls 2>/dev/null && break; sleep 0.1; done
sleep 0.5; t1=$EPOCHREALTIME
kill -TERM $WP
for i in {1..250}; do kill -0 $WP 2>/dev/null || break; sleep 0.1; done
if kill -0 $WP 2>/dev/null; then kill -9 $WP; RC=TIMEOUT; else wait $WP; RC=$?; fi
lat=$(( EPOCHREALTIME - t1 ))
ck "legacy: TERM during a slow forge-gate stops the wrapper promptly" $(( lat > 3.0 )) "$(printf '%.2f' $lat)s, rc=$RC"
ck "legacy: ... and the job is NOT started afterwards"      $(t test ! -e $M)
sleep 0.3
alive=0; for p in $(tail -n +$(( n0 + 1 )) $PIDFILE); do [[ $p == <1-> ]] && kill -0 $p 2>/dev/null && (( alive++ )); done
nrec=$(( $(wc -l < $PIDFILE) - n0 ))
ck "legacy: ... and the forge-gate it was waiting on is not orphaned" $(( alive != 0 || nrec < 2 )) "recorded=$nrec alive=$alive"

M=$ROOT/m.legusr1; rm -f $M*
env -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR=$L FJ_GATE_SLEEP=2 $LB/forge-job --name legusr1 --peak-gb 1 --need orange -- $CH $M ok > $ROOT/out 2>&1 &
WP=$!; print $WP >> $PIDFILE
for i in {1..50}; do grep -q legusr1 $ROOT/gate.calls 2>/dev/null && break; sleep 0.1; done
sleep 0.3; kill -USR1 $WP
for i in {1..150}; do kill -0 $WP 2>/dev/null || break; sleep 0.1; done
if kill -0 $WP 2>/dev/null; then kill -9 $WP; RC=TIMEOUT; else wait $WP; RC=$?; fi
ck "legacy: USR1 while forge-gate waits does not kill the wrapper; the job runs (rc 0)" \
  $(t eval '[[ $RC == 0 ]] && grep -q FINISHED $M') "rc=$RC"

if [[ ${FJ_SKIP_COMPANIONS:-0} != 1 ]]; then
  print "== companions, unchanged =="
  for g in forge_job_usr1_gate.sh forge_job_usage_gate.sh; do
    gout=$(env -u FORGE_GUARDIAN_SENSOR_BIN -u FORGE_HEALTH_DIR zsh $HERE/$g 2>&1); grc=$?
    ck "$g passes ($(print -r -- "$gout" | grep -Eo '[0-9]+ passed, [0-9]+ failed' | tail -1))" $grc
  done
  REPO=${HERE:h:h:h}
  HARN=$REPO/forge-kernel/test/resilience_harness.mjs
  if [[ -f $HARN ]] && command -v node >/dev/null; then
    for dim in cooperative_shed query_costs_no_slot; do
      for attempt in 1 2 3; do
        jo=$ROOT/harness.$dim.$attempt.jsonl
        hout=$(env -u FORGE_GUARDIAN_SENSOR_BIN -u FORGE_HEALTH_DIR node $HARN --only $dim --tools ${JOB:h} --json-out $jo 2>&1); hrc=$?
        (( hrc == 3 )) && { print "    ..   harness $dim: THE LIVE SYSTEM MOVED (another agent) -- inconclusive, rerunning"; continue; }
        break
      done
      rec=$(grep "\"id\":\"$dim\"" $jo 2>/dev/null | tail -1)
      sc=$(print -r -- "$rec" | sed -n 's/.*"dimension_score":\([0-9.]*\).*/\1/p')
      ck "resilience_harness --only $dim scores 1.000 against ${JOB:h:t}/forge-job" \
        $(t eval '[[ $hrc == 0 && $sc == 1 ]]') "rc=$hrc score=${sc:-?} $(print -r -- "$rec" | sed -n 's/.*"checks":\([0-9]*\),"passed":\([0-9]*\).*/\2\/\1 checks/p')"
    done
  else
    ck "resilience harness available" 1 "missing $HARN or node"
  fi
fi

print ""
print "RESULT: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
