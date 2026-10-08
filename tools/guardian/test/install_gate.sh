#!/bin/zsh
# ============================================================================
# install_gate.sh -- forge-guardian-install and forge-guardian-ctl, end to end, in a
# FAKE HOME whose path contains spaces, a double quote, '&', '<' and '>'.
#
#   usage: install_gate.sh [path/to/tools/guardian]
#
# launchd is a STUB ($ROOT/stubbin/launchctl, FORGE_GUARDIAN_LAUNCHCTL) that records
# every call and simulates one service: `bootstrap` reads ProgramArguments,
# EnvironmentVariables and the log paths FROM THE GENERATED PLIST and starts that
# program for real -- i.e. the staged forge-guardian, in the fake domain, with
# FORGE_GUARDIAN_SENSOR=0, FORGE_GUARDIAN_POLL=1 and ARCHIE_HEALTH_DIR redirected into
# $ROOT (the stub refuses to run without that redirect). So "the service verified"
# means a real governor published into the fake domain and holds its lock. The stub
# can be told to fail the next N bootstraps, or to start something that never
# publishes for the next N starts.
#
# The sensor is test/stub-sensor-admit via FORGE_GUARDIAN_SENSOR_PREBUILT.
#
# SAFETY. HOME and FORGE_GUARDIAN_HOME are the fake home; FORGE_GUARDIAN_LAUNCHCTL is
# the stub; PATH starts with a trap `launchctl` that records any bare call; a static
# check proves the tools name /bin/launchctl only as the default and in the interlock;
# and the two cases that deliberately pass the REAL launchctl (to prove the interlock
# refuses) run under sandbox-exec with exec of /bin/launchctl DENIED, so even a broken
# interlock cannot reach the real launchd. (Not every run is sandboxed: a sandboxed
# process cannot exec the setuid /bin/ps, which the verification needs.) The real ~/Library/LaunchAgents, ~/.forge-health, ~/.local/bin,
# ~/Library/Application Support and /tmp/archie_health are listed before and after
# and must be identical (files the live governor rewrites every poll -- state,
# state.json, the Law-7 status.json and their temps -- are compared by name only).
# Every process started is recorded in a pid FILE and reaped; a watchdog bounds it.
# ============================================================================
set -u
setopt NULL_GLOB EXTENDED_GLOB
zmodload zsh/datetime
zmodload -F zsh/stat b:zstat
HERE=${0:A:h}
SRCDIR=${1:-${HERE:h}}; SRCDIR=${SRCDIR:A}
[[ -f $SRCDIR/forge-guardian-install ]] || { print -u2 "no forge-guardian-install in $SRCDIR"; exit 1 }

PASS=0; FAIL=0
ck() { if (( $2 == 0 )); then (( PASS++ )); print -r -- "    ok   $1${3:+  ($3)}"; else (( FAIL++ )); print -r -- "    FAIL $1${3:+  ($3)}"; fi }
t() { ( "$@" ) >/dev/null 2>&1; print $?; }   # a subshell: an `exit` in an eval'd check stays inside it

ROOT=$(mktemp -d "${TMPDIR:-/tmp}/fginstall.XXXXXX") || exit 1
ROOT=${ROOT:a}
PIDFILE=$ROOT/started.pids; : > $PIDFILE
reap() { local p; [[ -r $PIDFILE ]] || return 0; while read -r p; do [[ $p == <1-> ]] && kill -9 $p 2>/dev/null; done < $PIDFILE; return 0 }
GATE_BUDGET=${GATE_BUDGET:-900}
{ sleep $GATE_BUDGET & print -r -- $! > $ROOT/watchdog.sleep; wait $!
  print -u2 "[install-gate] WALL-CLOCK EXCEEDED (${GATE_BUDGET}s) -- reaping and failing"
  while read -r p; do [[ $p == <1-> ]] && kill -9 $p 2>/dev/null; done < $PIDFILE
  kill -TERM $$ 2>/dev/null; sleep 2; kill -9 $$ 2>/dev/null
} &
WATCHDOG=$!
trap 'kill -9 $WATCHDOG $(cat $ROOT/watchdog.sleep 2>/dev/null) 2>/dev/null; reap; rm -rf "$ROOT"' EXIT

REAL_HOME=$(/usr/bin/dscl . -read "/Users/$USERNAME" NFSHomeDirectory 2>/dev/null)
REAL_HOME=${REAL_HOME#NFSHomeDirectory: }
[[ -d $REAL_HOME ]] || { print -u2 "cannot determine the real home (dscl)"; exit 1 }
SANDBOX=()
if [[ -x /usr/bin/sandbox-exec ]] && /usr/bin/sandbox-exec -p '(version 1)(allow default)(deny process-exec (literal "/bin/launchctl"))' /usr/bin/true 2>/dev/null; then
  SANDBOX=(/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny process-exec (literal "/bin/launchctl"))')
fi

# ---- the real system, before ---------------------------------------------------------
snap_real() {
  {
    print "== ~/Library/LaunchAgents"; ls -lA "$REAL_HOME/Library/LaunchAgents"
    print "== ~/.local/bin";           ls -lA "$REAL_HOME/.local/bin"
    print "== ~/.forge-health (names; live temps excluded)"; ls -1A "$REAL_HOME/.forge-health" | grep -v '\.tmp'
    print "== ~/.forge-health/bin";    ls -lA "$REAL_HOME/.forge-health/bin"
    print "== ~/.forge-health/jobs";   ls -1A "$REAL_HOME/.forge-health/jobs"
    print "== installed.json";         stat -f '%z %m %Sp' "$REAL_HOME/.forge-health/installed.json"
    print "== guardian.installed.json / policy.json"; ls -la "$REAL_HOME/.forge-health/guardian.installed.json" "$REAL_HOME/.forge-health/policy.json"
    print "== ~/Library/Application Support (names)"; ls -1A "$REAL_HOME/Library/Application Support"
    print "== ForgeGuardian";          ls -la "$REAL_HOME/Library/Application Support/ForgeGuardian"
    print "== /tmp/archie_health (names; live temps excluded)"; ls -1A /tmp/archie_health | grep -v '\.tmp'
    print "== live launchd entry";     /bin/launchctl list | awk '$3=="com.archdisc.forge.guardian"'
  } 2>&1
}
snap_real > $ROOT/real.before

# ---- the tree under test, copied (so one test can change a source) --------------------
SRC=$ROOT/src; mkdir -p $SRC/test
for f in $SRCDIR/*(.); do cp -p $f $SRC/; done
for f in $SRCDIR/test/*(.); do cp -p $f $SRC/test/; done
INST=$SRC/forge-guardian-install
CTL=$SRC/forge-guardian-ctl
# IG_CTL=<path> runs the ctl sections against another forge-guardian-ctl (red-on-old);
# that ctl then runs under the launchctl-denying sandbox, since nothing vouches for it.
[[ -n ${IG_CTL:-} ]] && CTL=${IG_CTL:A}
ck "the copied installer/ctl/forge-job are byte-identical to the tree under test" \
  $(t eval 'cmp -s $SRCDIR/forge-guardian-install $INST && cmp -s $SRCDIR/forge-guardian-ctl $CTL && cmp -s $SRCDIR/forge-job $SRC/forge-job')

# ---- the fake home -------------------------------------------------------------------
FAKEH="$ROOT/Home \"Q\" & <x>"
mkdir -p "$FAKEH/Library/LaunchAgents" "$FAKEH/.local/bin"
FH="$FAKEH/.forge-health"
APP="$FAKEH/Library/Application Support/ForgeGuardian"
PLIST="$FAKEH/Library/LaunchAgents/com.archdisc.forge.guardian.plist"
ARCH=$ROOT/archie; mkdir -p $ARCH
SD=$ROOT/stub; mkdir -p $SD

# A hand-copied v1 install, like the workstation's today.
mkdir -m 755 -p "$FH/bin" "$FH/jobs" "$FH/log" "$FH/incidents/20261001T000000Z-manual"
LEGACY_TOOLS=(forge-guardian forge-gate forge-job forge-nproc forge-guardian-ctl forge-stallguard forge-guardian-selftest forge-guardian-actuator-test)
for tl in $LEGACY_TOOLS; do
  git -C $SRCDIR show 834c7269:tools/guardian/$tl > "$FH/bin/$tl" 2>/dev/null || cp $SRC/$tl "$FH/bin/$tl"
  chmod 755 "$FH/bin/$tl"
done
print -r -- '#!/bin/sh
echo not-a-guardian-tool' > "$FH/bin/forge-program"; chmod 755 "$FH/bin/forge-program"
LEGACY_SHA=$(cd "$FH/bin" && shasum -a 256 $LEGACY_TOOLS)
print -r -- '{"app": "Forge", "note": "owned by the Forge.app installer"}' > "$FH/installed.json"
INSTALLED_SHA=$(shasum -a 256 < "$FH/installed.json")
print -r -- '{"t":1791000000,"s":"GREEN","r":"nominal","vmp":1,"pe":"normal","fp":80,"sw":[100,2048],"po":0,"th":"nominal","dk":120,"rs":[0.0,30.0],"j":0,"ev":1}' > "$FH/history.jsonl"
print -r -- '{"ts": 1791000000, "kind": "manual", "note": "seeded evidence"}' > "$FH/incidents/20261001T000000Z-manual/summary.json"
print -r -- "seeded log line" > "$FH/log/guardian.log"
ln -s "$FH/bin/forge-job" "$FAKEH/.local/bin/forge-job"
print -r -- '#!/bin/sh
echo user-owned regular file' > "$FAKEH/.local/bin/forge-nproc"; chmod 755 "$FAKEH/.local/bin/forge-nproc"
# A live registered job: it must survive every operation, envelope included.
zsh -c 'trap "" USR1 TERM; while :; do sleep 1; done' &
LIVEJOB=$!; print $LIVEJOB >> $PIDFILE
print -r -- "pid=$LIVEJOB
name=live-job
priority=0
can_restart=0
peak_gb=1
gpu=0
started=$EPOCHSECONDS
cmd=sleeper" > "$FH/jobs/$LIVEJOB.job"
# The legacy plist (paths into ~/.forge-health/bin), built with python's JSON escaping.
python3 -I -c '
import json,sys
h=sys.argv[1]
print(json.dumps({"Label":"com.archdisc.forge.guardian","ProgramArguments":["/bin/zsh",h+"/.forge-health/bin/forge-guardian"],
 "RunAtLoad":True,"KeepAlive":True,"ThrottleInterval":10,"StandardOutPath":h+"/.forge-health/log/guardian.out",
 "StandardErrorPath":h+"/.forge-health/log/guardian.err","ProcessType":"Background","LowPriorityIO":True,"Nice":5}))' "$FAKEH" > $ROOT/legacy.json
plutil -convert xml1 -o "$PLIST" $ROOT/legacy.json && chmod 644 "$PLIST"
LEGACY_PLIST_SHA=$(shasum -a 256 < "$PLIST")

# ---- stubs ---------------------------------------------------------------------------
mkdir -p $ROOT/stubbin $ROOT/pathbin
cat > $ROOT/pathbin/launchctl <<EOS
#!/bin/sh
echo "BARE launchctl \$*" >> $ROOT/bare.log
exit 99
EOS
chmod +x $ROOT/pathbin/launchctl
STUB=$ROOT/stubbin/launchctl
cat > $STUB <<'EOS'
#!/bin/zsh
# A launchd stand-in for ONE label. State lives in $STUB_DIR.
set -u
: ${STUB_DIR:?} ${STUB_ARCHIE:?} ${STUB_PIDFILE:?} ${STUB_HOME:?}
print -r -- "${(j: :)${(q)@}}" >> $STUB_DIR/calls.log
LABEL=com.archdisc.forge.guardian
pidf=$STUB_DIR/service.pid; loadedf=$STUB_DIR/loaded
running_pid() { local p; [[ -r $pidf ]] && p=$(<$pidf) && [[ $p == <1-> ]] && kill -0 $p 2>/dev/null && print -r -- $p; }
count_down() { local n=0; [[ -r $1 ]] && n=$(<$1); (( n > 0 )) && { print $(( n - 1 )) > $1; return 0; }; return 1; }
start() {
  local pl prog0 prog1 fhd out err
  pl=$(<$loadedf)
  prog0=$(plutil -extract ProgramArguments.0 raw -o - "$pl"); prog1=$(plutil -extract ProgramArguments.1 raw -o - "$pl")
  fhd=$(plutil -extract EnvironmentVariables.FORGE_HEALTH_DIR raw -o - "$pl" 2>/dev/null) || fhd="$STUB_HOME/.forge-health"
  out=$(plutil -extract StandardOutPath raw -o - "$pl"); err=$(plutil -extract StandardErrorPath raw -o - "$pl")
  if count_down $STUB_DIR/nopublish_n; then
    sleep 300 >/dev/null 2>&1 </dev/null &!
  else
    env -i HOME="$STUB_HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C FORGE_HEALTH_DIR="$fhd" \
      ARCHIE_HEALTH_DIR="$STUB_ARCHIE" FORGE_GUARDIAN_SENSOR=0 FORGE_GUARDIAN_POLL=1 \
      "$prog0" "$prog1" >> "$out" 2>> "$err" < /dev/null &!
  fi
  print -r -- $! > $pidf; print -r -- $! >> $STUB_PIDFILE
}
stop() {
  local p i; p=$(running_pid) || return 0
  [[ -n $p ]] || return 0
  kill -TERM $p 2>/dev/null
  for i in {1..100}; do kill -0 $p 2>/dev/null || break; sleep 0.1; done
  kill -0 $p 2>/dev/null && kill -9 $p 2>/dev/null
  rm -f $pidf
}
case ${1:-} in
  list)
    print "PID	Status	Label"
    [[ -f $loadedf ]] && { p=$(running_pid); print "${p:--}	0	$LABEL"; }
    exit 0 ;;
  print)
    [[ ${2:-} == gui/<->/$LABEL && -f $loadedf ]] || { print -u2 "Could not find service \"$LABEL\" in domain"; exit 113; }
    p=$(running_pid)
    print "${2} = {"; print "	active count = 1"; print "	path = $(<$loadedf)"
    if [[ -n $p ]]; then print "	state = running"; print ""; print "	pid = $p"; else print "	state = not running"; fi
    print "	resource coalition = {"; print "		state = active"; print "	}"
    print "}"; exit 0 ;;
  bootstrap)
    [[ -f $loadedf ]] && { print -u2 "Bootstrap failed: 5: Input/output error"; exit 5; }
    count_down $STUB_DIR/fail_bootstrap_n && { print -u2 "Bootstrap failed: 5: Input/output error"; exit 5; }
    print -r -- "${3:?}" > $loadedf; start; exit 0 ;;
  bootout)
    [[ -f $loadedf ]] || { print -u2 "Boot-out failed: 113: Could not find specified service"; exit 113; }
    stop; rm -f $loadedf; exit 0 ;;
  kickstart)
    [[ -f $loadedf ]] || exit 113
    if [[ ${2:-} == -k ]]; then stop; start; elif [[ -z $(running_pid) ]]; then start; fi
    exit 0 ;;
  *) print -u2 "stub launchctl: unsupported: $*"; exit 64 ;;
esac
EOS
chmod +x $STUB

ENVV=(-u FORGE_HEALTH_DIR -u FORGE_GUARDIAN_SENSOR_BIN -u FORGE_GUARDIAN_INSTALL_TESTS
      HOME="$FAKEH" FORGE_GUARDIAN_HOME="$FAKEH" FORGE_GUARDIAN_LAUNCHCTL=$STUB
      FORGE_GUARDIAN_SENSOR_PREBUILT=$SRC/test/stub-sensor-admit FORGE_GUARDIAN_VERIFY_S=10
      PATH="$ROOT/pathbin:/usr/bin:/bin:/usr/sbin:/sbin" TMPDIR="$ROOT/"
      STUB_DIR=$SD STUB_ARCHIE=$ARCH STUB_PIDFILE=$PIDFILE STUB_HOME="$FAKEH")
# run <bounded seconds> <program> args... ; sets RC and OUT
run() {
  local deadline=$1; shift
  env $ENVV "${@[1,-1]}" > $ROOT/run.out 2>&1 &
  local p=$! i; print $p >> $PIDFILE
  for i in {1..$(( deadline * 10 ))}; do kill -0 $p 2>/dev/null || break; sleep 0.1; done
  if kill -0 $p 2>/dev/null; then kill -9 $p; wait $p 2>/dev/null; RC=TIMEOUT; else wait $p; RC=$?; fi
  OUT=$(<$ROOT/run.out)
}
inst() { local d=$1; shift; run $d /bin/zsh $INST "$@"; }
ctl()  { if [[ -n ${IG_CTL:-} && ${#SANDBOX} -gt 0 ]]; then run 60 $SANDBOX /bin/zsh $CTL "$@"; else run 60 /bin/zsh $CTL "$@"; fi; }
calls_since() { tail -n +$(( $1 + 1 )) $SD/calls.log 2>/dev/null; }
ncalls() { [[ -f $SD/calls.log ]] && wc -l < $SD/calls.log | tr -d ' ' || print 0; }
svc_pid() { [[ -r $SD/service.pid ]] && print -r -- $(<$SD/service.pid); }
rel_of() { [[ -L "$APP/$1" ]] && print -r -- ${"$(readlink "$APP/$1")":t}; }
px() { plutil -extract "$1" raw -o - "$PLIST" 2>/dev/null; }
mode() { stat -f %Lp "$1" 2>/dev/null; }
fresh_state() { local -a m; zstat -A m +mtime -- "$FH/state" 2>/dev/null && (( EPOCHSECONDS - m[1] <= 5 )); }

print "== preconditions =="
ck "sandbox-exec available to deny /bin/launchctl in the interlock cases" $(( ${#SANDBOX} == 0 ))
# Static: the only mentions of /bin/launchctl are the default and the interlock test.
for f in $INST $CTL; do
  sl=$(grep -n '/bin/launchctl' $f | grep -v 'LAUNCHCTL=\${FORGE_GUARDIAN_LAUNCHCTL:-/bin/launchctl}' | grep -v '\${LAUNCHCTL:A} == /bin/launchctl' | grep -v '^[0-9]*:#' | grep -v 'default /bin/launchctl')
  ck "static: ${f:t} invokes launchctl only through \$LAUNCHCTL" $(( ${#sl} != 0 )) "${sl[1,120]}"
done
# Positive control: the stub runs the LEGACY service from the legacy plist.
env $ENVV $STUB bootstrap gui/$UID "$PLIST"
for i in {1..60}; do fresh_state && break; sleep 0.25; done
LEGPID=$(svc_pid)
ck "stub launchd runs the legacy governor and it publishes in the fake domain" $(t eval 'fresh_state && kill -0 $LEGPID') "pid=$LEGPID"
ck "the governor's Law-7 output went to the private ARCHIE dir" $(t test -f $ARCH/status.json)

# A RUNNING WRAPPER MUST SURVIVE THE SWITCH. zsh reads a script incrementally
# (measured: overwriting a running 20 KB script in place made it execute the NEW tail;
# replacing it by rename kept the old one), so the installer may only ever rename.
CHS=$ROOT/survivor.sh
cat > $CHS <<'EOS'
#!/bin/zsh
print STARTED >> $1
for i in {1..${2:-40}}; do sleep 0.2; done
print FINISHED >> $1
EOS
chmod +x $CHS
start_survivor() {   # start_survivor <mark> <ticks>: a forge-job launched from ~/.forge-health/bin
  env -u FORGE_GUARDIAN_SENSOR_BIN FORGE_HEALTH_DIR="$FH" FG_STUB_LOG=$ROOT/surv.calls \
    "$FH/bin/forge-job" --name survivor --peak-gb 1 --need red -- $CHS $1 $2 > $1.out 2>&1 &
  SURV=$!; print $SURV >> $PIDFILE
  local i; for i in {1..80}; do grep -q STARTED $1 2>/dev/null && break; sleep 0.1; done
}
await_survivor() {
  local i; for i in {1..300}; do kill -0 $SURV 2>/dev/null || break; sleep 0.1; done
  if kill -0 $SURV 2>/dev/null; then kill -9 $SURV; SURV_RC=TIMEOUT; else wait $SURV; SURV_RC=$?; fi
}

print "== 1. first install over a hand-copied v1 install =="
start_survivor $ROOT/surv1 40
ck "a v1 forge-job is running from .forge-health/bin (regular file) with its envelope" $(t eval 'grep -q STARTED $ROOT/surv1 && [[ -f "$FH/jobs/$SURV.job" && ! -L "$FH/bin/forge-job" ]]') "pid=$SURV"
n0=$(ncalls)
inst 120 install
V=$(rel_of current)
(( RC == 0 )) || { print -r -- "$OUT" | sed 's/^/      | /' | tail -25; }
ck "install exits 0"                                        $(( RC != 0 )) "rc=$RC"
ck "it reports 'installed 2.0.0+<12 hex>'"                  $(t eval '[[ $V == 2.0.0+[0-9a-f](#c12) && "$OUT" == *"installed $V"* ]]') "$V"
ck "launchctl: bootout, then bootstrap of the new plist"    $(t eval '[[ "$(calls_since $n0 | grep -E "^(bootout|bootstrap)" | cut -d" " -f1 | tr "\n" " ")" == "bootout bootstrap " ]]') "$(calls_since $n0 | cut -c1-40 | tr '\n' ';')"
ck "no bare launchctl was ever executed"                    $(t test ! -e $ROOT/bare.log)
LEG=$(print -r -- "$APP"/releases/legacy-*(N/:t))
ck "previous -> the legacy snapshot"                        $(t eval '[[ -n $LEG && $(rel_of previous) == $LEG ]]') "previous=$(rel_of previous)"
ck "the legacy snapshot holds the hand-copied tools byte for byte" \
  $(t eval '[[ "$(cd "$APP/releases/$LEG/bin" && shasum -a 256 $LEGACY_TOOLS)" == "$LEGACY_SHA" ]]')
ck "the legacy snapshot keeps the replaced plist"           $(t eval '[[ "$(shasum -a 256 < "$APP/releases/$LEG/launchd.plist.previous")" == "$LEGACY_PLIST_SHA" ]]')
bad=0; for tl in forge-guardian forge-gate forge-job forge-nproc forge-guardian-ctl forge-guardian-install forge-guardian-sensor forge-stallguard forge-guardian-selftest forge-guardian-actuator-test; do
  [[ -L "$FH/bin/$tl" && "$(readlink "$FH/bin/$tl")" == "$APP/current/bin/$tl" && -x "$FH/bin/$tl" ]] || { bad=1; print "      not linked: $tl"; }
done
ck "all 10 tools in .forge-health/bin are symlinks to current/bin" $bad
ck "a foreign regular file in .forge-health/bin is left alone" $(t eval '[[ -f "$FH/bin/forge-program" && ! -L "$FH/bin/forge-program" ]]')
ck ".forge-health is 0700"                                  $(t test "$(mode "$FH")" = 700) "mode=$(mode "$FH")"
ck "policy.json installed from policy.default.json, 0600"   $(t eval 'cmp -s "$FH/policy.json" $SRC/policy.default.json && [[ $(mode "$FH/policy.json") == 600 ]]')
# plist
ck "plist lints"                                            $(t plutil -lint "$PLIST")
ck "plist ProgramArguments = [/bin/zsh, \$APP/current/bin/forge-guardian] (exact, parsed back)" \
  $(t eval '[[ $(px ProgramArguments.0) == /bin/zsh && $(px ProgramArguments.1) == "$APP/current/bin/forge-guardian" && -z $(px ProgramArguments.2) ]]') "$(px ProgramArguments.1)"
ck "plist env: PATH, FORGE_HEALTH_DIR (fake home), LC_ALL=C" \
  $(t eval '[[ $(px EnvironmentVariables.PATH) == /usr/bin:/bin:/usr/sbin:/sbin && $(px EnvironmentVariables.FORGE_HEALTH_DIR) == "$FH" && $(px EnvironmentVariables.LC_ALL) == C ]]')
ck "plist log paths: launchd.out / launchd.err in the fake domain" \
  $(t eval '[[ $(px StandardOutPath) == "$FH/log/launchd.out" && $(px StandardErrorPath) == "$FH/log/launchd.err" ]]')
ck "plist keys: Label RunAtLoad KeepAlive ThrottleInterval=30 ProcessType=Standard Nice=5 ExitTimeOut=10" \
  $(t eval '[[ $(px Label) == com.archdisc.forge.guardian && $(px RunAtLoad) == true && $(px KeepAlive) == true && $(px ThrottleInterval) == 30 && $(px ProcessType) == Standard && $(px Nice) == 5 && $(px ExitTimeOut) == 10 ]]')
ck "plist mode 0644"                                        $(t test "$(mode "$PLIST")" = 644)
ck "plist contains no path of the real home ($REAL_HOME)"   $(t eval '! grep -qF "$REAL_HOME" "$PLIST"')
ck "plist XML escapes & < > (raw file has &amp; &lt; &gt;)" $(t eval 'grep -qF "&amp;" "$PLIST" && grep -qF "&lt;x&gt;" "$PLIST"')
# release
RD="$APP/releases/$V"
ck "release dir modes: release/bin/share 0755, bin/* 0555, share/* 0444" \
  $(t eval '[[ $(mode "$RD") == 755 && $(mode "$RD/bin") == 755 && $(mode "$RD/share") == 755 ]] && for f in "$RD"/bin/*; do [[ $(mode $f) == 555 ]] || exit 1; done; for f in "$RD"/share/*; do [[ $(mode $f) == 444 ]] || exit 1; done')
mbad=0; mlist=()
for f in "$RD"/bin/*(.) "$RD"/share/*(.); do
  rel=${f#$RD/}; mlist+=($rel)
  want=$(plutil -extract "files.${rel//./\\.}" raw -o - "$RD/MANIFEST.json" 2>/dev/null)
  [[ $want == $(shasum -a 256 < $f | cut -c1-64) ]] || { mbad=1; print "      manifest mismatch: $rel"; }
done
nman=$(plutil -extract files json -o - "$RD/MANIFEST.json" 2>/dev/null | grep -o '":"' | wc -l | tr -d ' ')
ck "MANIFEST.json hashes match every release file (${#mlist} files)" $(( mbad || ${#mlist} != 12 )) "files=${#mlist}"
ck "MANIFEST lists exactly the release files"               $(( nman != ${#mlist} )) "manifest=$nman"
ck "the release holds the staged tools byte for byte"       $(t eval 'cmp -s $SRC/forge-job "$RD/bin/forge-job" && cmp -s $SRC/forge-guardian "$RD/bin/forge-guardian" && cmp -s $SRC/test/stub-sensor-admit "$RD/bin/forge-guardian-sensor"')
# record + service
IJ="$FH/guardian.installed.json"
ck "guardian.installed.json: version, release, previous, plist_sha256" \
  $(t eval '[[ $(plutil -extract version raw -o - "$IJ") == $V && $(plutil -extract release raw -o - "$IJ") == "$RD" && $(plutil -extract previous raw -o - "$IJ") == $LEG && $(plutil -extract plist_sha256 raw -o - "$IJ") == $(shasum -a 256 < "$PLIST" | cut -c1-64) ]]')
S1=$(svc_pid)
ck "the service runs the NEW governor: args = /bin/zsh \$APP/current/bin/forge-guardian" \
  $(t eval '[[ "$(ps -ww -o args= -p $S1)" == "/bin/zsh $APP/current/bin/forge-guardian" ]]') "pid=$S1"
ck "the legacy governor is gone"                            $(t eval '! kill -0 $LEGPID')
ck "guardian.lock holds the service pid; state is fresh"    $(t eval '[[ $(<"$FH/guardian.lock/pid") == $S1 ]] && fresh_state')
ck "~/.local/bin: forge-job kept, forge-gate + forge-guardian-ctl created as links to .forge-health/bin" \
  $(t eval 'for tl in forge-job forge-gate forge-guardian-ctl; do [[ -L "$FAKEH/.local/bin/$tl" && "$(readlink "$FAKEH/.local/bin/$tl")" == "$FH/bin/$tl" ]] || exit 1; done')
ck "~/.local/bin/forge-nproc (a regular file) is NOT replaced, and a warning says so" \
  $(t eval '[[ -f "$FAKEH/.local/bin/forge-nproc" && ! -L "$FAKEH/.local/bin/forge-nproc" && "$OUT" == *"forge-nproc is a regular file"* ]]')
await_survivor
ck "the v1 wrapper running across the switch completed normally (rc 0, child finished, envelope removed)" \
  $(t eval '[[ $SURV_RC == 0 ]] && grep -q FINISHED $ROOT/surv1 && [[ ! -e "$FH/jobs/$SURV.job" ]]') "rc=$SURV_RC"
ck "Forge.app's installed.json untouched; the live job's envelope kept" \
  $(t eval '[[ "$(shasum -a 256 < "$FH/installed.json")" == "$INSTALLED_SHA" && -f "$FH/jobs/$LIVEJOB.job" ]]')

print "== 2. the same inputs again: a no-op =="
n0=$(ncalls); PLSHA=$(shasum -a 256 < "$PLIST")
inst 120 install
ck "second install exits 0 and prints 'already installed $V'" $(t eval '[[ $RC == 0 && "$OUT" == *"already installed $V"* ]]') "rc=$RC"
ck "zero bootout/bootstrap calls"                           $(t eval '! calls_since $n0 | grep -qE "^(bootout|bootstrap|kickstart)"') "$(calls_since $n0 | cut -c1-30 | tr '\n' ';')"
ck "service pid, current, previous and plist all unchanged"  $(t eval '[[ -n $V && $(svc_pid) == $S1 && $(rel_of current) == $V && $(rel_of previous) == $LEG && "$(shasum -a 256 < "$PLIST")" == "$PLSHA" ]]')

print "== 3. a changed source => a new version, previous set =="
print -r -- "# changed by install_gate" >> $SRC/forge-nproc
start_survivor $ROOT/surv3 40
JSHA=$(shasum -a 256 < "$APP/releases/$V/bin/forge-job")
ck "a v2 forge-job is running from .forge-health/bin -> current (release $V), admitted by the sensor" \
  $(t eval 'grep -q STARTED $ROOT/surv3 && [[ -f "$FH/jobs/$SURV.job" ]] && grep -q "^admit .*--pid $SURV " $ROOT/surv.calls') "pid=$SURV"
n0=$(ncalls)
inst 120 install
V2=$(rel_of current)
ck "upgrade exits 0 with a NEW version"                     $(t eval '[[ $RC == 0 && $V2 != $V && $V2 == 2.0.0+* ]]') "rc=$RC $V -> $V2"
ck "previous -> the old current"                            $(t eval '[[ -n $V && $(rel_of previous) == $V ]]')
ck "the service was restarted onto the new release"         $(t eval '[[ -n $(svc_pid) && $(svc_pid) != $S1 ]] && calls_since $n0 | grep -q "^bootstrap"')
ck "the new release carries the changed file"               $(t cmp -s $SRC/forge-nproc "$APP/releases/$V2/bin/forge-nproc")
ck "the old release is intact (immutable)"                  $(t eval '[[ -n $V && -f "$APP/releases/$V/bin/forge-nproc" ]] && ! cmp -s $SRC/forge-nproc "$APP/releases/$V/bin/forge-nproc"')
await_survivor
ck "the v2 wrapper running across the upgrade completed: rc 0, child finished, sensor saw release --rc 0" \
  $(t eval '[[ $SURV_RC == 0 ]] && grep -q FINISHED $ROOT/surv3 && [[ ! -e "$FH/jobs/$SURV.job" ]] && grep -q "^release .*--pid $SURV --rc 0" $ROOT/surv.calls') "rc=$SURV_RC"
ck "the script it was executing was never rewritten (old release forge-job byte-identical)" \
  $(t eval '[[ "$(shasum -a 256 < "$APP/releases/$V/bin/forge-job")" == "$JSHA" ]]')

print "== 4. rollback swaps current and previous =="
inst 120 rollback
ck "rollback exits 0"                                       $(( RC != 0 )) "rc=$RC"
ck "current=$V previous=$V2"                                $(t eval '[[ -n $V && -n $V2 && $(rel_of current) == $V && $(rel_of previous) == $V2 ]]') "current=$(rel_of current) previous=$(rel_of previous)"
ck "the service runs again and the record says $V"          $(t eval '[[ -n $V ]] && kill -0 $(svc_pid) && fresh_state && [[ $(plutil -extract version raw -o - "$IJ") == $V ]]')

print "== 5a. verification failure (bootstrap refused) => automatic rollback, exit 1 =="
print -r -- "# changed again" >> $SRC/forge-nproc
PLSHA=$(shasum -a 256 < "$PLIST")
print 1 > $SD/fail_bootstrap_n
inst 120 install
ck "exit 1"                                                 $(( RC != 1 )) "rc=$RC"
ck "it says what failed and that it rolled back"            $(t eval '[[ "$OUT" == *"bootstrap failed"* && "$OUT" == *"rolled back"* ]]')
ck "current/previous restored ($V / $V2)"                   $(t eval '[[ -n $V && -n $V2 && $(rel_of current) == $V && $(rel_of previous) == $V2 ]]') "current=$(rel_of current) previous=$(rel_of previous)"
ck "plist restored byte for byte; record still says $V"     $(t eval '[[ -n $V && "$(shasum -a 256 < "$PLIST")" == "$PLSHA" && $(plutil -extract version raw -o - "$IJ") == $V ]]')
S5=$(svc_pid)
ck "the previous service was bootstrapped again and verified" $(t eval '[[ "$(ps -ww -o args= -p $S5)" == "/bin/zsh $APP/current/bin/forge-guardian" ]] && fresh_state && [[ "$OUT" == *"verified"* ]]')

print "== 5b. verification failure (service up but never publishes) => automatic rollback =="
print 1 > $SD/nopublish_n
t0=$EPOCHREALTIME
inst 120 install
ck "exit 1 after the verification budget"                   $(t eval '[[ $RC == 1 ]] && (( EPOCHREALTIME - t0 >= 9 ))') "rc=$RC $(printf '%.1f' $(( EPOCHREALTIME - t0 )))s"
ck "the reason names the failed check"                      $(t eval '[[ "$OUT" == *"did not verify"* && "$OUT" == *"runs '"'"'sleep 300'"'"'"* ]]') "$(print -r -- "$OUT" | grep -m1 FAILED | cut -c1-150)"
ck "current=$V again and the old service runs, verified"    $(t eval '[[ -n $V && $(rel_of current) == $V ]] && kill -0 $(svc_pid) && [[ "$(ps -ww -o args= -p $(svc_pid))" == "/bin/zsh $APP/current/bin/forge-guardian" ]] && fresh_state')
ck "the live job's envelope survived all of it"             $(t test -f "$FH/jobs/$LIVEJOB.job")

print "== 6. forge-guardian-ctl against the installed service (stub launchd) =="
ctl status
ck "ctl status: first line 'RUNNING pid=<service> (launchd-supervised)'" $(t test "${OUT%%$'\n'*}" = "RUNNING pid=$(svc_pid) (launchd-supervised)") "${OUT%%$'\n'*}"
ck "ctl status: installed version and registered jobs shown" $(t eval '[[ "$OUT" == *"installed: $V"* && "$OUT" == *"registered jobs: 1"* && "$OUT" == *"live-job pid=$LIVEJOB identity=ok"* ]]')
ctl diagnose
ck "ctl diagnose: plist, release, launchd, lock and links PASS" \
  $(t eval '[[ "$OUT" == *"PASS  plist lints"* && "$OUT" == *"PASS  plist program resolves into the current release ($V)"* && "$OUT" == *"PASS  launchd: com.archdisc.forge.guardian running"* && "$OUT" == *"PASS  the lock holder is the supervised process"* && "$OUT" == *"PASS  bin/forge-job ->"* ]]')
ck "ctl diagnose: the disabled sensor is a FAIL and the exit is 1" $(t eval '[[ $RC == 1 && "$OUT" == *"FAIL  no sensor process for this domain"* ]]') "rc=$RC"
n0=$(ncalls); SP=$(svc_pid)
ctl restart
ck "ctl restart: kickstart -k, a new pid that publishes"    $(t eval '[[ $RC == 0 ]] && calls_since $n0 | grep -q "^kickstart -k gui/$UID/com.archdisc.forge.guardian" && [[ $(svc_pid) != $SP ]] && fresh_state') "rc=$RC"
ctl stop
ck "ctl stop: bootout, the governor is gone"                $(t eval '[[ $RC == 0 ]] && grep -q "^bootout" $SD/calls.log && [[ ! -f $SD/loaded ]]')
ctl status
ck "ctl status after stop: NOT RUNNING, exit 0"             $(t eval '[[ $RC == 0 && "${OUT%%$'"'"'\n'"'"'*}" == "NOT RUNNING"* ]]') "${OUT%%$'\n'*}"
ctl start
ck "ctl start: bootstrap, RUNNING again"                    $(t eval '[[ $RC == 0 && "$OUT" == *"started under launchd pid="* ]] && fresh_state') "rc=$RC"
(( ${#SANDBOX} )) && run 30 $SANDBOX env FORGE_GUARDIAN_LAUNCHCTL=/bin/launchctl /bin/zsh $CTL stop
ck "ctl refuses the REAL launchctl for a fake home (exit 2), service untouched" $(t eval '[[ $RC == 2 && "$OUT" == *refusing* ]] && kill -0 $(svc_pid)') "rc=$RC"

print "== 7. the installer refuses the real launchctl for a fake home =="
n0=$(ncalls)
(( ${#SANDBOX} )) && run 60 $SANDBOX env FORGE_GUARDIAN_LAUNCHCTL=/bin/launchctl /bin/zsh $INST install
ck "install with the real launchctl + fake home: exit 2, nothing changed" $(t eval '[[ $RC == 2 && "$OUT" == *refusing* && $(rel_of current) == $V ]]') "rc=$RC"

print "== 8. uninstall keeps state and evidence =="
SU=$(svc_pid)
inst 120 uninstall
ck "uninstall exits 0 and says the tools are now unavailable" $(t eval '[[ $RC == 0 && "$OUT" == *UNAVAILABLE* ]]') "rc=$RC"
ck "service booted out and stopped; plist removed"          $(t eval '[[ ! -f $SD/loaded && ! -f "$PLIST" ]] && ! kill -0 $SU')
bad=0; for tl in forge-guardian forge-gate forge-job forge-nproc forge-guardian-ctl forge-guardian-install forge-guardian-sensor forge-stallguard forge-guardian-selftest forge-guardian-actuator-test; do [[ -e "$FH/bin/$tl" || -L "$FH/bin/$tl" ]] && bad=1; done
ck "the tool links in .forge-health/bin are gone; forge-program kept" $(t eval '(( ! bad )) && [[ -f "$FH/bin/forge-program" ]]')
ck "~/.local/bin links into .forge-health removed; the regular forge-nproc kept" \
  $(t eval '[[ ! -e "$FAKEH/.local/bin/forge-job" && ! -L "$FAKEH/.local/bin/forge-gate" && ! -L "$FAKEH/.local/bin/forge-guardian-ctl" && -f "$FAKEH/.local/bin/forge-nproc" ]]')
ck "state, history, log, incidents, policy.json, installed.json, live envelope all kept" \
  $(t eval '[[ -f "$FH/state" && -s "$FH/history.jsonl" && -s "$FH/log/guardian.log" && -f "$FH/incidents/20261001T000000Z-manual/summary.json" && -f "$FH/policy.json" && "$(shasum -a 256 < "$FH/installed.json")" == "$INSTALLED_SHA" && -f "$FH/jobs/$LIVEJOB.job" ]]')
ck "it names the live job it leaves ungoverned"             $(t eval '[[ "$OUT" == *"live-job"* ]]')
ck "releases kept without --purge"                          $(t test -d "$APP/releases/$V")
inst 60 uninstall --purge
ck "uninstall --purge removes the application directory"    $(t eval '[[ $RC == 0 && ! -e "$APP" ]]') "rc=$RC"

print "== 9. --run-tests runs the hermetic gates against the STAGED release =="
n0=$(ncalls)
ENVV+=(FORGE_GUARDIAN_INSTALL_TESTS=forge_job_usage_gate.sh)
inst 180 install --run-tests
ck "a good tree: the gate passes and the install completes" $(t eval '[[ $RC == 0 && "$OUT" == *"PASS forge_job_usage_gate.sh"* && -n $(rel_of current) ]]') "rc=$RC"
VG=$(rel_of current)
SRC2=$ROOT/src2; cp -Rp $SRC $SRC2
grep -v '^    -h|--help|help) usage; exit 0 ;;$' $SRC/forge-job > $SRC2/forge-job.new && mv $SRC2/forge-job.new $SRC2/forge-job && chmod 755 $SRC2/forge-job
n0=$(ncalls)
run 180 /bin/zsh $INST install --run-tests --from $SRC2
ck "a broken forge-job (the --help defect): the staged gate FAILS, install exits 1" $(t eval '[[ $RC == 1 && "$OUT" == *"FAIL forge_job_usage_gate.sh"* ]]') "rc=$RC"
ck "... and nothing changed: current is still $VG, no launchctl call" $(t eval '[[ -n $VG && $(rel_of current) == $VG ]] && ! calls_since $n0 | grep -qE "^(bootout|bootstrap)"')
ck "no staging or tx directory left behind"                 $(t eval '[[ -d "$APP" && -z $(print -r -- "$APP"/staging.*(N) "$APP"/tx.*(N) "$APP"/build.*(N)) ]]')

print "== 10. forge-guardian-ctl read-only views over a private domain (synthetic v2 files) =="
CD=$ROOT/ctl-domain
ctlp() { run 60 env FORGE_HEALTH_DIR=$CD FG_STUB_LOG=$ROOT/ctl.calls "$@"; }
ctlp /bin/zsh $CTL status
ck "status of a domain that does not exist: exit 0, 'NOT RUNNING', no shell error" \
  $(t eval '[[ $RC == 0 && "${OUT%%$'"'"'\n'"'"'*}" == "NOT RUNNING" && "$OUT" != *"parameter not set"* && "$OUT" != *"no such file"* ]]') "rc=$RC"
mkdir -m 700 -p $CD/jobs $CD/quarantine $CD/session $CD/log $CD/bin
for i in 1 2 3 4; do mkdir -p $CD/incidents/2026100${i}T000000Z-manual; print -r -- "{\"ts\": 1, \"kind\": \"manual\", \"note\": \"note-$i\"}" > $CD/incidents/2026100${i}T000000Z-manual/summary.json; done
print -r -- "{\"state\": \"UNKNOWN\", \"reason\": \"evidence incomplete: thermal\", \"epoch\": $EPOCHSECONDS, \"seq\": 7, \"build_jobs_max\": 2, \"evidence_complete\": false, \"evidence\": {\"source\": \"sensor\", \"sensor_age_s\": 1, \"missing\": [\"thermal\"]}, \"disk_hardware\": \"Verified\"}" > $CD/state.json
print UNKNOWN > $CD/state
print -r -- "schema=forge.guardian.sensor/1
version=2.0.0
pid=$LIVEJOB
seq=42
ts=$EPOCHSECONDS.5
ts_s=$EPOCHSECONDS
vmp=1
vmp_st=ok
pevent=normal
pevent_st=ok
pevent_warn_n=0
pevent_crit_n=0
freepct=55
freepct_st=ok
mem_total_b=38654705664
mem_avail_b=21474836480
mem_compressed_b=1073741824
mem_st=ok
swap_used_mb=100
swap_total_mb=2048
swap_growth_mb_min=0.0
swap_st=ok
pageout_rate_ps=0.0
swapout_rate_ps=0.0
pageouts_st=ok
thermal=none
thermal_st=unavailable
load1=2.50
cpu_busy_pct=12
cpu_st=ok
vol_n=1
vol0_mount=/
vol0_avail_b=119185342464
vol0_growth_b_min=-5.0
vol0_st=ok
disk_min_avail_gib=111
disk_st=ok
jobs_n=1
job0_pid=$LIVEJOB
job0_name=svc
job0_identity=ok
job0_fp_b=2147483648
job0_res_b=2147483648
job0_peak_fp_b=3221225472
job0_reserved_b=33285996544
job0_hb_age_s=-1
reserved_b=33285996544
budget_b=32212254720
overcommit=1
errors=0" > $CD/sensor.env
print -r -- "pid=$LIVEJOB
name=svc
priority=6
can_restart=1
peak_gb=31
gpu=1
started=$EPOCHSECONDS
schema=2
owner=forge-job
cmd=serve" > $CD/jobs/$LIVEJOB.job
QS=0123456789abcdef
print -r -- "{\"sig\": \"$QS\", \"name\": \"crashy\", \"cmd\": \"crashy --go\", \"crashes\": [{\"ts\": 1}, {\"ts\": 2}, {\"ts\": 3}], \"since\": 1791000000}" > $CD/quarantine/$QS.json
print -r -- "{\"classification\": \"unclean_unknown\", \"last_heartbeat\": 1791000000.5, \"boot_epoch\": 1791000100, \"orderly_stop\": false}" > $CD/session/previous.json
print -r -- "logs_cap_mib=1" > $CD/policy.env
head -c 600000 /dev/zero > $CD/log/guardian.log
print -r -- '{"t":1791000000,"s":"GREEN","r":"nominal","vmp":1,"pe":"normal","fp":80,"sw":[100,2048],"po":0,"th":"nominal","dk":120,"rs":[1.0,30.0],"j":1,"ev":1}
{"t":1791000005,"s":"UNKNOWN","r":"evidence incomplete: thermal","vmp":1,"pe":"normal","fp":79,"sw":[100,2048],"po":3,"th":"none","dk":120,"rs":[31.0,30.0],"j":1,"ev":0}' > $CD/history.jsonl
ctlp /bin/zsh $CTL status
ck "status: exit 0; evidence INCOMPLETE naming thermal"     $(t eval '[[ $RC == 0 && "$OUT" == *"evidence: INCOMPLETE"*"missing: thermal"* ]]') "rc=$RC"
ck "status: each sensor signal with its status (thermal none [unavailable], vm_pressure 1 [ok])" \
  $(t eval '[[ "$OUT" == *"thermal         none  [unavailable]"* && "$OUT" == *"vm_pressure     1  [ok]"* && "$OUT" == *"sensor: pid=$LIVEJOB (alive)"* ]]')
ck "status: reservations reserved 31.0 / budget 30.0 GiB, overcommit=1" $(t eval '[[ "$OUT" == *"reserved 31.0 / budget 30.0 GiB, overcommit=1"* ]]')
ck "status: the job with identity/footprint/reservation from the sensor" $(t eval '[[ "$OUT" == *"svc pid=$LIVEJOB identity=ok footprint=2.0GiB reserved=31.0GiB"* ]]')
ck "status: the quarantine and its clear command"           $(t eval '[[ "$OUT" == *"$QS  name=crashy"*"quarantine clear $QS --reason"* ]]')
ck "status: the latest 3 incidents, newest first, not the 4th" $(t eval '[[ "$OUT" == *"incidents: 4 (latest 3)"* && "$OUT" == *"20261004T000000Z-manual  note-4"* && "$OUT" != *"20261001T000000Z"* ]]')
ck "status: previous session classification"               $(t eval '[[ "$OUT" == *"previous session: unclean_unknown"* ]]')
ck "status: logs+evidence measured against the policy cap"  $(t eval '[[ "$OUT" == *"logs+evidence: 0."*" MiB of 1 MiB cap"* ]]') "$(print -r -- "$OUT" | grep logs+evidence)"
ck "status: disk hardware from state.json"                  $(t eval '[[ "$OUT" == *"disk hardware: Verified"* ]]')
ctlp /bin/zsh $CTL history 2
ck "history 2: two human-readable rows (GREEN then UNKNOWN)" $(t eval '[[ $RC == 0 && $(print -r -- "$OUT" | grep -cE " (GREEN|UNKNOWN) ") == 2 && "$OUT" == *"[31.0,30.0]"* ]]')
ctlp /bin/zsh $CTL reservations
ck "reservations: declared vs measured vs reserved per job"  $(t eval '[[ $RC == 0 && "$OUT" == *"svc"*"$LIVEJOB"*"ok"*"31"*"3.0"*"31.0"* ]]')
ctlp /bin/zsh $CTL quarantine clear $QS
ck "quarantine clear without --reason: usage error 2, file kept" $(t eval '[[ $RC == 2 && -f $CD/quarantine/$QS.json ]]') "rc=$RC"
ctlp FORGE_GUARDIAN_SENSOR_BIN=$SRC/test/stub-sensor-admit /bin/zsh $CTL quarantine clear $QS --reason "fixed the crash"
ck "quarantine clear via the sensor: quarantine-clear --state-dir D --sig S --reason R; file removed" \
  $(t eval '[[ $RC == 0 && ! -e $CD/quarantine/$QS.json ]] && grep -qF -- "quarantine-clear --state-dir $CD --sig $QS --reason fixed\\ the\\ crash" $ROOT/ctl.calls && grep -q "fixed the crash" $CD/quarantine/cleared.jsonl') "rc=$RC"
print -r -- "{\"sig\": \"$QS\", \"name\": \"crashy\"}" > $CD/quarantine/$QS.json
ctlp /bin/zsh $CTL quarantine clear $QS --reason 'no "sensor" here'
ck "quarantine clear with no sensor installed: done directly, reason recorded as valid JSON" \
  $(t eval '[[ $RC == 0 && ! -e $CD/quarantine/$QS.json ]] && tail -1 $CD/quarantine/cleared.jsonl | plutil -extract reason raw -o - - | grep -qx "no \"sensor\" here"') "rc=$RC"
ctlp FORGE_GUARDIAN_SENSOR_BIN=$SRC/test/stub-sensor-admit /bin/zsh $CTL incident --note "operator note"
IDIR=${${OUT##*incident: }%%$'\n'*}
ck "incident: the sensor is asked (--kind manual --note), the bundle path is printed and exists" \
  $(t eval '[[ $RC == 0 && -f "$IDIR/summary.json" ]] && grep -qF -- "incident --state-dir $CD --kind manual --note operator\\ note" $ROOT/ctl.calls') "$IDIR"

print "== 11. the real system did not move =="
ck "no bare launchctl was executed during the whole gate"   $(t test ! -e $ROOT/bare.log)
snap_real > $ROOT/real.after
if cmp -s $ROOT/real.before $ROOT/real.after; then ck "real LaunchAgents, .forge-health, .local/bin, Application Support, /tmp/archie_health and the live launchd entry: identical listings" 0
else ck "real system listings identical" 1; diff $ROOT/real.before $ROOT/real.after | head -20; fi

print ""
print "RESULT: $PASS passed, $FAIL failed"
(( FAIL == 0 ))
