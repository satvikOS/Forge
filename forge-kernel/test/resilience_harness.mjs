#!/usr/bin/env node
/**
 * ForgeResilience — the RESOURCE_RESILIENCE family harness (directive §53, doc 08).
 *
 * WHY THIS FILE EXISTS. A 13-family keyword sweep of the benchmark tree credited nine
 * families; four of those were false positives (DFM/CAM matched no text at all — the
 * letters matched INSIDE other words; ASSEMBLY matched the prose "Same assembly as …").
 * RESOURCE_RESILIENCE was the sharpest genuine absence, named in the ledger as:
 *   "Guardian shed nothing all session because nothing registered, and there is no
 *    harness that would have caught that either." (T-133)
 *
 * WHAT IT SCORES. Not "does Guardian exist" — whether the L0 resource governor keeps
 * its own contracts under pressure. Every dimension below was derived from a MEASURED
 * production failure in the 24h before it was written, and every dimension is scored by
 * OBSERVING BEHAVIOUR of a private Guardian, never by grepping source:
 *
 *   D1 cooperative_shed        0.30  Guardian's stage-1 shed is SIGUSR1, documented as
 *      "checkpoint now and reduce your footprint". The DEFAULT DISPOSITION of SIGUSR1
 *      is TERMINATE, and forge-job never trapped it, so every registered job died on
 *      the gentlest signal in the system. guardian.log 2026-09-14 17:31:57
 *      "shed sig=USR1 -> job='knowing-v1-lora' pid=78851"; the trainer logged rc=158
 *      (128+30) the same second. THIS is why "registered jobs" read 0 all session:
 *      jobs registered, were asked to checkpoint, and died.
 *
 *   D2 admission_vs_eviction   0.25  forge-gate ADMITTED a job declaring peak_gb=25 and
 *      the RED ladder then TERMed it for using 25 GB. 5 TERMs in 44 s to one pid,
 *      0 of 8000 iterations banked. The file header already promised "never SIGKILL a
 *      job that has not first had a TERM AND A GRACE PERIOD" — that grace period had
 *      no implementation. A documented-but-absent safety property is the worst kind.
 *
 *   D3 query_costs_no_slot     0.20  forge-job's arg loop ended in `*) break`, so an
 *      unrecognised flag became the COMMAND: `forge-job --help` reached
 *      `forge-gate --need green --wait 900`. Measured 2026-09-16: six such processes
 *      alive at once, oldest 13m21s, each holding a gate slot, two real builds queued
 *      behind them. A typo cost a quarter hour of wall clock per agent.
 *
 *   D4 green_is_reachable      0.15  The ladder has `disk < 45GiB -> YELLOW` while
 *      forge-job defaults to `--need green`, so on a box that could not reach 45 GiB
 *      free EVERY default job waited 900 s and exited 75. Reclaiming to 61 GiB flipped
 *      it GREEN/nominal. An unreachable green is a system-wide throughput zero.
 *
 *   D5 shed_targeting          0.10  The property NO observed defect violated, and it
 *      is here on purpose: a rubric that is only a list of this week's bugs cannot
 *      notice a fix-shaped regression. Guardian must signal ONLY registered,
 *      unprotected pids, most-speculative-first, and must reap dead registrations.
 *
 * WHAT 1.0 MEANS. Under a private Guardian driven into RED: a job that registers and
 * declares an envelope survives the whole cooperative ladder without losing work; is
 * never evicted for filling the envelope admission accepted; one eviction decision
 * produces exactly one signal; the shedder still sheds once settling is over (so 1.0
 * cannot be bought by disarming it); asking the tooling what it does consumes no
 * resource slot while REAL work still passes admission (so 1.0 cannot be bought by
 * bypassing the gate); the ladder has a GREEN attainable on this host's actual disk and
 * is monotone in every observable; and nothing unregistered or protected is signalled.
 *
 * THREE ANTI-THEATRE COUNTER-OBSERVABLES, each of which makes a degenerate "fix" score
 * WORSE rather than better:
 *   D1.c5  the wrapper must actually REGISTER (surviving USR1 by never registering is 0)
 *   D2.B1  pressure persisting past the settling window must still produce an eviction
 *   D3.real a real invocation must still reach forge-gate (fast-because-ungated is 0)
 *
 * HERMETIC. Everything runs in a private FORGE_HEALTH_DIR under $TMPDIR with stub
 * observation commands on PATH, following the precedent in
 * tools/guardian/test/forge_job_usr1_gate.sh. Guardian's lock, registry, state file and
 * log are ALL $STATE_DIR-scoped (forge-guardian:60-74 says so explicitly and the code
 * does it), so a private instance neither sees nor blocks the live daemon, and signals
 * only pids this harness registered. The live daemon and the live Archie sidecar are
 * never touched, and that is WITNESSED, not asserted: every run reads ~/.forge-health's
 * published state, its registered-job count and the live guardian pid before and after,
 * prints both, and exits 3 if either moved.
 *
 * FAULT INJECTION IS AT THE OBSERVATION BOUNDARY, NOT IN THE CODE. D2 drives a REAL
 * forge-guardian daemon into RED by shadowing sysctl/memory_pressure/vm_stat/df/pmset
 * on PATH. The daemon's own sample(), classify() and actuation ladder execute. D4 and
 * D5 source the REAL daemon with FORGE_GUARDIAN_LIB=1 (forge-guardian:~320 exists for
 * exactly this) so they exercise the shipped functions. Nothing here re-implements the
 * thing it tests — a test that does that proves nothing.
 *
 * OUTPUT FORMAT — matches the family-harness precedents in this directory
 * (cadscore_harness.mjs, cadgen_aggregate.mjs / cadgenbench_eval.mjs --json-out):
 *   one APPEND-mode JSONL record per case, keyed (kind,id), carrying `gate` and
 *   `cad_score` under the same names cadgen_aggregate.mjs averages, plus the
 *   family-specific axes. kind is 'resilience' (never 'gen'/'edit'), so
 *   cadgen_aggregate.mjs correctly ignores these rows rather than folding a resource
 *   number into a geometry number; `--aggregate f.jsonl …` here applies the same
 *   dedup-by-(kind,id)-and-average-over-runs semantics to this family.
 *
 * USAGE
 *   node forge-kernel/test/resilience_harness.mjs                  # score tools/guardian
 *   node forge-kernel/test/resilience_harness.mjs --tools DIR      # score another tree
 *   node forge-kernel/test/resilience_harness.mjs --json-out r.jsonl --label shipped
 *   node forge-kernel/test/resilience_harness.mjs --aggregate a.jsonl b.jsonl
 *   node forge-kernel/test/resilience_harness.mjs --reintroduce    # ★ falsifiability, by git rev
 *   node forge-kernel/test/resilience_harness.mjs --reintroduce --from-tree   # …and in CI
 *   node forge-kernel/test/resilience_harness.mjs --gate 0.60      # release-gate floor
 *
 * ★ --reintroduce is the deliverable that separates a benchmark from an assertion
 * suite. It scores an all-fixes baseline, then re-scores it with each of the four
 * MEASURED defects put back one at a time, and FAILS unless every one scores strictly
 * lower than the baseline. A rubric that cannot tell a known defect from its fix is
 * theatre, and this is the command that proves it is not.
 *
 * Dependency-free: Node builtins + zsh + the guardian tree under test.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const getFlag = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const getAll = (f) => { const out = []; for (let i = 0; i < argv.length; i++) if (argv[i] === f) { let j = i + 1; while (j < argv.length && !argv[j].startsWith('--')) out.push(argv[j++]); } return out; };

const JSON_OUT = getFlag('--json-out', null);
const LABEL = getFlag('--label', null);
const KEEP = has('--keep');
const VERBOSE = has('--verbose');
const ONLY = getFlag('--only', null);            // run one dimension by id

// ── tiny formatting kit, same shape as cadgen_aggregate.mjs ──────────────────
const f3 = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(3) : String(x));
const pad = (s, n) => { s = String(s); return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length); };
const lpad = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rule = (n = 78) => '─'.repeat(n);

// ── shell helpers ────────────────────────────────────────────────────────────
function zsh(script, opts = {}) {
  const r = spawnSync('/bin/zsh', ['-c', script], {
    encoding: 'utf8', timeout: opts.timeout || 120000,
    env: { ...process.env, ...(opts.env || {}) },
    cwd: opts.cwd || REPO,
  });
  return { rc: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '', stderr: r.stderr || '', timedOut: !!r.error && r.error.code === 'ETIMEDOUT' };
}
function mktemp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `resil-${tag}-`));
  return d;
}
function write(p, s, mode) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); if (mode) fs.chmodSync(p, mode); }
const cleanups = [];
function onCleanup(fn) { cleanups.push(fn); }
function runCleanups() { while (cleanups.length) { try { cleanups.pop()(); } catch { /* best effort */ } } }
process.on('exit', runCleanups);
process.on('SIGINT', () => { runCleanups(); process.exit(130); });

// ═════════════════════════════════════════════════════════════════════════════
//  LIVE-SYSTEM WITNESS — the live daemon and the Archie sidecar must not move.
// ═════════════════════════════════════════════════════════════════════════════
// The names this harness registers inside its PRIVATE dirs. If any of them ever shows
// up in the live registry, the hermetic boundary leaked and the score is worthless.
const HARNESS_JOB_NAMES = ['coop-probe', 'settling-probe', 'speculative', 'critical-ui', 'BOGUS-node-entry', 'usr1-gate'];

function witness() {
  const dir = process.env.FORGE_HEALTH_REAL || path.join(os.homedir(), '.forge-health');
  const st = zsh(`cat ${dir}/state 2>/dev/null; print "|"; ` +
    `for f in ${dir}/jobs/*.job(N); do print "$(sed -n 's/^name=//p' $f | head -1)#$(sed -n 's/^pid=//p' $f | head -1)"; done | sort | tr '\\n' ' '; ` +
    `print "|"; pgrep -f 'forge-guardian$' 2>/dev/null | sort | tr '\\n' ','`);
  const [state, jobsRaw, pids] = st.stdout.split('|').map((s) => s.trim());
  const jobs = jobsRaw.split(/\s+/).filter(Boolean);
  return { state, jobs, pids, raw: st.stdout.trim() };
}

// A LIVE-SYSTEM CHECK MUST BE PRECISE, NOT MERELY STRICT. Counting registered jobs
// tripped on another agent registering a clang++ build mid-run — a true statement about
// the machine and a false accusation of this harness. What must hold is narrower and
// exactly right: the governor is the same process, every job registered BEFORE is still
// registered after (nothing of anyone else's was evicted), and no job this harness names
// ever appears in the live registry. New jobs from other agents are reported, not failed.
function compareWitness(before, after) {
  const problems = [];
  if (before.pids !== after.pids) problems.push(`the live guardian pid changed: ${before.pids || 'none'} → ${after.pids || 'none'}`);
  const lost = before.jobs.filter((j) => !after.jobs.includes(j));
  if (lost.length) problems.push(`registrations that existed before are GONE: ${lost.join(' ')}`);
  const leaked = after.jobs.filter((j) => HARNESS_JOB_NAMES.includes(j.split('#')[0]));
  if (leaked.length) problems.push(`THIS HARNESS leaked into the live registry: ${leaked.join(' ')}`);
  const added = after.jobs.filter((j) => !before.jobs.includes(j));
  return { problems, added };
}

// ═════════════════════════════════════════════════════════════════════════════
//  HERMETIC FIXTURES — written into a private FORGE_HEALTH_DIR per probe.
// ═════════════════════════════════════════════════════════════════════════════

// A child that treats SIGUSR1 as Guardian documents it: checkpoint, keep going.
const CHILD_COOPERATIVE = `#!/bin/zsh
# A well-behaved registered job: checkpoints on USR1, then finishes its work.
MARK="$1"
: > "$MARK"
trap 'print GOT_USR1 >> "$MARK"' USR1
i=0
while (( i < 14 )); do
  print "TICK $i" >> "$MARK"
  sleep 0.4 & wait $!        # interruptible: a foreground sleep defers the trap
  i=$(( i + 1 ))
done
print FINISHED_CLEANLY >> "$MARK"
`;

// A victim that SURVIVES TERM, because the production victim did (a Python handler
// runs between bytecodes). If it died on the first TERM the repeat-TERM defect would
// be invisible: the wrapper's EXIT trap would deregister it and there would be
// nothing left to re-signal.
const VICTIM_RECORDER = `#!/bin/zsh
LOG="$1"
: > "$LOG"
trap 'print "USR1 $(date +%s)" >> "$LOG"' USR1
trap 'print "TERM $(date +%s)" >> "$LOG"' TERM
while true; do sleep 0.3 & wait $!; done
`;

// Observation stubs. The daemon's REAL sample()/classify()/actuation run against
// these; nothing inside forge-guardian is edited. Values come from $OBS.
function writeStubs(binDir, obsFile) {
  write(path.join(binDir, 'sysctl'), `#!/bin/zsh
source "${obsFile}"
case "$*" in
  *kern.memorystatus_vm_pressure_level*) print "$OBS_VMP" ;;
  *vm.swapusage*)   print "total = \${OBS_SWT}.00M  used = \${OBS_SWU}.00M  free = 1000.00M  (encrypted)" ;;
  *vm.loadavg*)     print "{ 1.00 1.00 1.00 }" ;;
  *hw.ncpu*)        print 14 ;;
  *hw.perflevel0.logicalcpu*) print 10 ;;
  *hw.memsize*)     print 38654705664 ;;
  *hw.pagesize*)    print 16384 ;;
  *) /usr/sbin/sysctl "$@" ;;
esac
`, 0o755);
  write(path.join(binDir, 'memory_pressure'), `#!/bin/zsh
source "${obsFile}"
print "System-wide memory free percentage: \${OBS_FREE}%"
`, 0o755);
  write(path.join(binDir, 'vm_stat'), `#!/bin/zsh
source "${obsFile}"
print "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
print "Pageouts:                          \${OBS_PAGEOUTS}."
`, 0o755);
  write(path.join(binDir, 'df'), `#!/bin/zsh
source "${obsFile}"
print "Filesystem 1G-blocks Used Avail Capacity Mounted on"
print "/dev/disk3s5      1000  500 \${OBS_DISK}     50%  /"
`, 0o755);
  write(path.join(binDir, 'pmset'), `#!/bin/zsh
source "${obsFile}"
print "CPU_Scheduler_Limit \t= 100"
print "CPU_Speed_Limit \t= \${OBS_THERM}"
`, 0o755);
}
const OBS_NOMINAL = 'OBS_VMP=1\nOBS_FREE=60\nOBS_SWU=100\nOBS_SWT=2048\nOBS_PAGEOUTS=0\nOBS_DISK=200\nOBS_THERM=100\n';
const OBS_RED = 'OBS_VMP=4\nOBS_FREE=5\nOBS_SWU=1900\nOBS_SWT=2048\nOBS_PAGEOUTS=0\nOBS_DISK=200\nOBS_THERM=100\n';

// A gate stub that ADMITS instantly (for probes where admission is not the subject).
const GATE_ADMIT = `#!/bin/zsh
exit 0
`;
// A gate stub that BLOCKS FOREVER. Reaching it is the defect D3 exists to catch.
const GATE_BLOCK = `#!/bin/zsh
print -u2 "STUB-GATE REACHED"
sleep 600
`;

// ═════════════════════════════════════════════════════════════════════════════
//  D1 — cooperative_shed: does the cooperative shed preserve work?
// ═════════════════════════════════════════════════════════════════════════════
function d1_cooperative_shed(TOOLS) {
  const checks = [];
  const W = mktemp('coop');
  if (!KEEP) onCleanup(() => fs.rmSync(W, { recursive: true, force: true }));
  fs.mkdirSync(path.join(W, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(W, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(W, 'log'), { recursive: true });
  write(path.join(W, 'bin', 'forge-gate'), GATE_ADMIT, 0o755);
  const child = path.join(W, 'child.sh'); write(child, CHILD_COOPERATIVE, 0o755);
  const mark = path.join(W, 'mark');
  const jobsSeen = path.join(W, 'jobs_seen');

  // Start the job under the SUT's forge-job, watch that it registers, then send the
  // cooperative signal Guardian sends, then observe everything about the outcome.
  const script = `
set -u
export FORGE_HEALTH_DIR=${W}
"${TOOLS}/forge-job" --name coop-probe --priority 9 --peak-gb 1 --restartable --need orange -- "${child}" "${mark}" &
WP=$!
# did it REGISTER? (surviving USR1 by never registering scores zero)
n=0; seen=0
while (( n < 30 )); do
  c=$(ls ${W}/jobs/*.job 2>/dev/null | wc -l | tr -d ' ')
  (( c > 0 )) && { seen=1; break; }
  sleep 0.2; n=$(( n + 1 ))
done
print "REGISTERED=$seen"
sleep 1.5
kill -USR1 "$WP" 2>/dev/null
sleep 3
if kill -0 "$WP" 2>/dev/null; then print "ALIVE=1"; else print "ALIVE=0"; fi
wait "$WP" 2>/dev/null; print "RC=$?"
c=$(ls ${W}/jobs/*.job 2>/dev/null | wc -l | tr -d ' ')
print "LEAKED=$c"
`;
  const r = zsh(script, { timeout: 60000 });
  const grab = (k) => { const m = r.out.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : ''; };
  const markTxt = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8') : '';

  checks.push({ name: 'the wrapper REGISTERED an envelope (an unregistered job is invisible to the shedder)', ok: grab('REGISTERED') === '1', detail: `job files seen=${grab('REGISTERED')}` });
  checks.push({ name: 'the wrapper SURVIVES the cooperative SIGUSR1', ok: grab('ALIVE') === '1', detail: `alive=${grab('ALIVE')}` });
  checks.push({ name: 'the signal REACHED the job, which checkpointed and continued', ok: /GOT_USR1/.test(markTxt), detail: `GOT_USR1 ${/GOT_USR1/.test(markTxt) ? 'present' : 'ABSENT'}` });
  checks.push({ name: 'the job exits rc=0 after being shed (158 = 128+SIGUSR1 = the defect)', ok: grab('RC') === '0', detail: `rc=${grab('RC') || '?'}` });
  checks.push({ name: 'the job completed its WHOLE run, not a truncated one', ok: /FINISHED_CLEANLY/.test(markTxt), detail: `ticks=${(markTxt.match(/TICK /g) || []).length}/14` });
  checks.push({ name: 'the registration is released on exit (no phantom job file)', ok: grab('LEAKED') === '0', detail: `leftover job files=${grab('LEAKED') || '?'}` });

  return { id: 'cooperative_shed', weight: 0.30, checks, evidence: `FORGE_HEALTH_DIR=${W} ${TOOLS}/forge-job --name coop-probe … ; kill -USR1 <wrapper>` };
}

// ═════════════════════════════════════════════════════════════════════════════
//  D2 — admission_vs_eviction: does the gate's admission agree with the ladder?
//  Drives a REAL private forge-guardian into RED through stubbed observations.
// ═════════════════════════════════════════════════════════════════════════════
function runGuardianPhase(TOOLS, { settle, termGrace, seconds, tag }) {
  const W = mktemp(`gd-${tag}`);
  if (!KEEP) onCleanup(() => fs.rmSync(W, { recursive: true, force: true }));
  for (const d of ['bin', 'jobs', 'log', 'stub']) fs.mkdirSync(path.join(W, d), { recursive: true });
  const obs = path.join(W, 'obs');
  fs.writeFileSync(obs, OBS_NOMINAL);
  writeStubs(path.join(W, 'stub'), obs);
  // the REAL forge-gate under test performs admission against the private state file
  fs.copyFileSync(path.join(TOOLS, 'forge-gate'), path.join(W, 'bin', 'forge-gate'));
  fs.chmodSync(path.join(W, 'bin', 'forge-gate'), 0o755);
  const victim = path.join(W, 'victim.sh'); write(victim, VICTIM_RECORDER, 0o755);
  const vlog = path.join(W, 'victim.log');

  const env = {
    FORGE_HEALTH_DIR: W,
    FORGE_GUARDIAN_POLL: '1',
    PATH: `${path.join(W, 'stub')}:${process.env.PATH}`,
  };
  if (settle != null) env.FORGE_GUARDIAN_SETTLE = String(settle);
  if (termGrace != null) env.FORGE_GUARDIAN_TERM_GRACE = String(termGrace);

  const script = `
set -u
"${TOOLS}/forge-guardian" >${W}/guardian.out 2>&1 &
GP=$!
# wait for the private domain to be published before registering anything
n=0; while (( n < 40 )); do [[ -f ${W}/state ]] && break; sleep 0.25; n=$(( n + 1 )); done
print "GUARDIAN_UP=$([[ -f ${W}/state ]] && print 1 || print 0)"
print "STATE0=$(cat ${W}/state 2>/dev/null)"

# ADMISSION, performed by the tree's own forge-gate against the tree's own guardian.
"${W}/bin/forge-gate" --need orange --wait 10 --why admission-probe
print "ADMIT_RC=$?"

# A registered job that declares a large envelope and SURVIVES TERM, exactly like the
# production victim. Registered directly: the registry format is the contract, and a
# wrapper that dies on the first TERM would hide the repeat-TERM defect entirely.
"${victim}" "${vlog}" &
VP=$!
START=$(date +%s)
{ print "pid=$VP"; print "name=settling-probe"; print "priority=9"; print "can_restart=1";
  print "peak_gb=25"; print "gpu=0"; print "started=$START"; print "cmd=victim"; } > ${W}/jobs/probe.job
print "JOB_START=$START"

sleep 1
print 'OBS_VMP=4' > ${obs}.tmp; cat ${obs} | grep -v '^OBS_VMP=' >> ${obs}.tmp; mv ${obs}.tmp ${obs}
print "RED_AT=$(date +%s)"
sleep ${seconds}

# DID THE GOVERNOR SURVIVE THE PRESSURE IT WAS GOVERNING? A daemon that dies at the
# moment it decides to evict leaves the workstation with no governor at all, and
# "zero TERMs" then means "dead", not "grace held". Without this observable those two
# are indistinguishable — measured, the first time this harness ran.
print "GUARDIAN_ALIVE=$(kill -0 $GP 2>/dev/null && print 1 || print 0)"
print "STATE_AGE=$(( $(date +%s) - $(stat -f %m ${W}/state 2>/dev/null || print 0) ))"

kill -TERM $GP 2>/dev/null; sleep 0.6; kill -KILL $GP 2>/dev/null
kill -KILL $VP 2>/dev/null
print "@@VICTIM@@"; cat "${vlog}" 2>/dev/null
print "@@GLOG@@"; cat ${W}/log/guardian.log 2>/dev/null
print "@@GOUT@@"; cat ${W}/guardian.out 2>/dev/null
`;
  const r = zsh(script, { timeout: (seconds + 40) * 1000, env });
  const grab = (k) => { const m = r.out.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : ''; };
  const glog = ((r.out.split('@@GLOG@@')[1] || '').split('@@GOUT@@')[0] || '');
  const gout = (r.out.split('@@GOUT@@')[1] || '');
  const vic = (r.out.split('@@VICTIM@@')[1] || '').split('@@GLOG@@')[0] || '';
  const termStamps = [...vic.matchAll(/^TERM (\d+)$/gm)].map((m) => parseInt(m[1], 10));
  const usr1Stamps = [...vic.matchAll(/^USR1 (\d+)$/gm)].map((m) => parseInt(m[1], 10));
  const shedTerms = (glog.match(/shed sig=TERM/g) || []).length;
  const shedUsr1 = (glog.match(/shed sig=USR1/g) || []).length;
  return {
    W, up: grab('GUARDIAN_UP') === '1', state0: grab('STATE0'), admitRc: grab('ADMIT_RC'),
    jobStart: parseInt(grab('JOB_START') || '0', 10), redAt: parseInt(grab('RED_AT') || '0', 10),
    termStamps, usr1Stamps, shedTerms, shedUsr1, glog, raw: r.out,
    alive: grab('GUARDIAN_ALIVE') === '1', stateAge: parseInt(grab('STATE_AGE') || '999', 10),
    crash: (gout.match(/forge-guardian:\d+:.*$/m) || [''])[0],
  };
}

function d2_admission_vs_eviction(TOOLS) {
  const checks = [];
  // PHASE A — defaults. A job admitted on its declared envelope, driven into RED while
  // it is still settling. A ladder that agrees with its own gate evicts nothing here.
  const A = runGuardianPhase(TOOLS, { settle: null, termGrace: null, seconds: 16, tag: 'A' });
  const ageAtFirstTerm = A.termStamps.length ? A.termStamps[0] - A.jobStart : null;

  checks.push({ name: 'the private guardian came up and published its own domain', ok: A.up, detail: `state=${A.state0 || '?'}` });
  checks.push({ name: 'forge-gate ADMITTED the job on its declared peak_gb=25', ok: A.admitRc === '0', detail: `forge-gate rc=${A.admitRc || '?'}` });
  checks.push({ name: 'the COOPERATIVE stage fired first (RED stage-1 USR1 reached the job)', ok: A.usr1Stamps.length >= 1 || A.shedUsr1 >= 1, detail: `USR1 delivered=${A.usr1Stamps.length}, logged=${A.shedUsr1}` });
  checks.push({
    name: 'NOT evicted while settling — no TERM for filling the envelope admission accepted',
    ok: A.termStamps.length === 0,
    detail: A.termStamps.length === 0 ? 'TERMs in the settling window = 0' : `TERM at job age ${ageAtFirstTerm}s (${A.termStamps.length} total, ${A.shedTerms} logged)`,
  });

  // PHASE B — settling window shortened to 2 s so a 20 s probe can see BOTH halves:
  // the shedder must still shed (anti-disarm), and one decision must produce one TERM.
  const B = runGuardianPhase(TOOLS, { settle: 2, termGrace: 30, seconds: 20, tag: 'B' });
  const firstB = B.termStamps.length ? B.termStamps[0] : null;
  const repeats = firstB == null ? 0 : B.termStamps.filter((t) => t > firstB && t - firstB < 30).length;

  checks.push({
    // ★ HARD, and it was documented as hard long before it was implemented as hard.
    // The header has always claimed "a ladder that stops evicting → D2 zeroed"; the
    // flag was simply missing, so the claim was prose. Measured cost of the gap: a
    // guardian whose eviction is replaced by `if false` — one that can NEVER shed
    // under RED — scored 0.795, ABOVE the shipped tree's 0.617 and above the
    // all-fixes-on-branches 0.750. Writing a counter-observable down is not
    // implementing one.
    name: '★ ANTI-DISARM: pressure persisting past the settling window STILL evicts',
    ok: B.termStamps.length >= 1, hard: true,
    detail: `TERMs after settling = ${B.termStamps.length} (logged ${B.shedTerms})`,
  });
  checks.push({
    name: 'one eviction DECISION produces exactly one TERM (5 in 44s was the defect)',
    ok: B.termStamps.length >= 1 && repeats === 0,
    detail: B.termStamps.length ? `first TERM +0s, repeats within the 30s grace = ${repeats}` : 'no TERM at all — cannot distinguish (see ANTI-DISARM)',
  });
  // ★ THE GOVERNOR MUST OUTLIVE THE PRESSURE. Added after the first real run of this
  // harness caught the SHIPPED grace code CRASHING the daemon at its first
  // eviction (`TERMED_AT[$_jpid]: parameter not set` under zsh `set -u`), which made
  // "zero TERMs" look like a grace that held. A dead governor is the worst outcome on
  // the ladder, and it is also the only way "no eviction" can be a false positive.
  const aliveBoth = A.alive && B.alive && A.stateAge <= 5 && B.stateAge <= 5;
  checks.push({
    name: '★ the GOVERNOR itself survived the pressure and kept publishing',
    ok: aliveBoth, hard: true,
    detail: aliveBoth ? `alive and fresh in both phases (state age ${A.stateAge}s / ${B.stateAge}s)`
      : `A alive=${A.alive}, B alive=${B.alive} (stale state = the EXIT trap de-published)` +
        (A.crash || B.crash ? `  crash: ${(A.crash || B.crash).trim()}` : ''),
  });

  return {
    id: 'admission_vs_eviction', weight: 0.25, checks,
    evidence: `private guardians in ${A.W} (defaults) and ${B.W} (SETTLE=2 TERM_GRACE=30), RED forced via stubbed sysctl kern.memorystatus_vm_pressure_level=4`,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  D3 — query_costs_no_slot: does asking what a tool does consume a resource slot?
// ═════════════════════════════════════════════════════════════════════════════
function d3_query_costs_no_slot(TOOLS) {
  const checks = [];
  const W = mktemp('usage');
  if (!KEEP) onCleanup(() => fs.rmSync(W, { recursive: true, force: true }));
  fs.mkdirSync(path.join(W, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(W, 'jobs'), { recursive: true });
  write(path.join(W, 'bin', 'forge-gate'), GATE_BLOCK, 0o755);

  // Bounded run: zsh on macOS has no timeout(1). "TIMEOUT" as the rc means it blocked,
  // which against a gate that never returns is exactly the defect.
  const bounded = (deadline, args) => {
    const script = `
set -u
export FORGE_HEALTH_DIR=${W}
( "${TOOLS}/forge-job" ${args} > ${W}/out 2>&1 ) & wp=$!
w=0
while (( w < ${deadline} )); do kill -0 $wp 2>/dev/null || break; sleep 1; w=$(( w + 1 )); done
if kill -0 $wp 2>/dev/null; then kill -TERM $wp 2>/dev/null; sleep 1; kill -KILL $wp 2>/dev/null; print "RC=TIMEOUT"
else wait $wp; print "RC=$?"; fi
print "@@OUT@@"; cat ${W}/out 2>/dev/null
`;
    const r = zsh(script, { timeout: (deadline + 20) * 1000 });
    const m = r.out.match(/^RC=(.*)$/m);
    return { rc: m ? m[1].trim() : '?', out: (r.out.split('@@OUT@@')[1] || '') };
  };

  for (const flag of ['--help', '-h', 'help']) {
    const { rc, out } = bounded(5, flag);
    const reached = /STUB-GATE REACHED/.test(out);
    const fast = rc !== 'TIMEOUT';
    const usage = /usage|forge-job/i.test(out);
    checks.push({ name: `'${flag}' answers without consuming a gate slot`, ok: fast && !reached && rc === '0' && usage, detail: `rc=${rc} gate_reached=${reached} usage_printed=${usage}` });
  }
  {
    const { rc, out } = bounded(5, '--no-such-flag -- /bin/true');
    const reached = /STUB-GATE REACHED/.test(out);
    checks.push({ name: 'an unknown flag is a usage error, not a command sent to the gate', ok: rc === '2' && !reached && /unknown option/.test(out), detail: `rc=${rc} gate_reached=${reached} names_the_flag=${/unknown option/.test(out)}` });
  }
  {
    const { rc, out } = bounded(5, '--name x --peak-gb 1');
    checks.push({ name: 'no command at all exits fast with a usage error', ok: rc === '2' && !/STUB-GATE REACHED/.test(out), detail: `rc=${rc}` });
  }
  // THE COUNTER-OBSERVABLE. Everything above is trivially satisfiable by a wrapper
  // that never gates at all — which would destroy the only thing forge-job is for.
  const real = bounded(6, '--name real --peak-gb 1 -- /bin/true');
  const realGated = /STUB-GATE REACHED/.test(real.out);
  checks.push({ name: '★ a REAL job still consults forge-gate (fast-because-ungated scores zero)', ok: realGated, detail: `real invocation reached the gate=${realGated}`, hard: true });

  return { id: 'query_costs_no_slot', weight: 0.20, checks, evidence: `FORGE_HEALTH_DIR=${W} with bin/forge-gate = a stub that never returns` };
}

// ═════════════════════════════════════════════════════════════════════════════
//  D4 — green_is_reachable: is the top of the ladder attainable on this host?
//  Sources the REAL daemon in library mode and calls the REAL classify().
// ═════════════════════════════════════════════════════════════════════════════
function classifySweep(TOOLS, vectors) {
  const W = mktemp('classify');
  if (!KEEP) onCleanup(() => fs.rmSync(W, { recursive: true, force: true }));
  const lines = vectors.map((v, i) =>
    `O_VMP=${v.vmp}; O_FREE=${v.free}; O_SWU=${v.swu}; O_SWT=${v.swt}; O_PORATE=${v.porate}; O_DISK=${v.disk}; O_THERM=${v.therm}; classify; print "R${i}=$CLASS"`).join('\n');
  const script = `
set -u
export FORGE_GUARDIAN_LIB=1
export FORGE_HEALTH_DIR=${W}
source "${TOOLS}/forge-guardian"
unset FORGE_GUARDIAN_LIB
${lines}
`;
  const r = zsh(script, { timeout: 60000 });
  return vectors.map((v, i) => {
    const m = r.out.match(new RegExp(`^R${i}=(\\w+)$`, 'm'));
    return { ...v, cls: m ? m[1] : 'ERR' };
  });
}
const RANK = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3, ERR: 9 };

function d4_green_is_reachable(TOOLS) {
  const checks = [];
  // What disk can this host actually have free? Observed, not assumed.
  const capTxt = zsh(`df -g / | awk 'NR==2{print $2}'`).stdout.trim();
  const capacityGb = parseInt(capTxt, 10) || 0;

  const idle = { vmp: 1, free: 90, swu: 0, swt: 2048, porate: 0, therm: 100 };
  // Bisect the minimum free disk at which an otherwise-idle box classifies GREEN.
  const disks = [];
  for (let d = 0; d <= 4000; d = d < 100 ? d + 1 : d + 50) disks.push(d);
  const swept = classifySweep(TOOLS, disks.map((d) => ({ ...idle, disk: d })));
  const greens = swept.filter((s) => s.cls === 'GREEN');
  const minGreenDisk = greens.length ? Math.min(...greens.map((g) => g.disk)) : null;

  checks.push({
    name: 'a GREEN classification EXISTS for an otherwise-idle box',
    ok: greens.length > 0,
    detail: greens.length ? `minimum free disk for GREEN = ${minGreenDisk} GiB` : 'no vector in a 0–4000 GiB idle sweep classifies GREEN',
  });
  checks.push({
    name: 'that GREEN is ATTAINABLE on this host (threshold ≤ half the filesystem)',
    ok: minGreenDisk != null && capacityGb > 0 && minGreenDisk <= capacityGb / 2,
    detail: `needs ${minGreenDisk == null ? '∞' : minGreenDisk} GiB free of a ${capacityGb} GiB filesystem (df -g /)`,
  });

  // Monotonicity: worsening one observable must never improve the classification.
  // No observed defect violated this — it is here so the rubric can notice a
  // fix-shaped regression, not only the bugs that prompted it.
  const axes = [
    { name: 'disk', worse: [4000, 200, 60, 44, 30, 24, 11, 4].map((d) => ({ ...idle, disk: d })) },
    { name: 'vm_pressure', worse: [1, 2, 4].map((v) => ({ ...idle, disk: 200, vmp: v })) },
    { name: 'pageouts@swap95', worse: [0, 700, 2000, 7000].map((p) => ({ ...idle, disk: 200, porate: p, swu: 1950, swt: 2048 })) },
    { name: 'thermal', worse: [100, 89, 69].map((t) => ({ ...idle, disk: 200, therm: t })) },
  ];
  let monoOk = true; const monoDetail = [];
  for (const ax of axes) {
    const res = classifySweep(TOOLS, ax.worse);
    const ranks = res.map((r) => RANK[r.cls]);
    const ok = ranks.every((r, i) => i === 0 || r >= ranks[i - 1]) && !ranks.includes(9);
    if (!ok) monoOk = false;
    monoDetail.push(`${ax.name}:${res.map((r) => r.cls[0]).join('')}`);
  }
  checks.push({ name: 'the ladder is MONOTONE — a strictly worse box never classifies better', ok: monoOk, detail: monoDetail.join('  ') });

  // And the ladder must still be able to say RED: a "reachable green" bought by
  // classifying everything GREEN is the opposite failure.
  const redProbe = classifySweep(TOOLS, [{ vmp: 4, free: 2, swu: 2000, swt: 2048, porate: 9000, disk: 2, therm: 40 }]);
  checks.push({ name: '★ a genuinely dying box still classifies RED (all-green scores zero)', ok: redProbe[0].cls === 'RED', detail: `worst-case vector → ${redProbe[0].cls}`, hard: true });

  return { id: 'green_is_reachable', weight: 0.15, checks, evidence: `FORGE_GUARDIAN_LIB=1 source ${TOOLS}/forge-guardian; classify() over ${disks.length + axes.reduce((a, x) => a + x.worse.length, 0) + 1} observable vectors; capacity from \`df -g /\`` };
}

// ═════════════════════════════════════════════════════════════════════════════
//  D5 — shed_targeting: only registered, unprotected pids, most speculative first.
// ═════════════════════════════════════════════════════════════════════════════
function d5_shed_targeting(TOOLS) {
  const checks = [];
  const W = mktemp('target');
  if (!KEEP) onCleanup(() => fs.rmSync(W, { recursive: true, force: true }));
  for (const d of ['bin', 'jobs', 'log']) fs.mkdirSync(path.join(W, d), { recursive: true });
  const victim = path.join(W, 'victim.sh'); write(victim, VICTIM_RECORDER, 0o755);

  const script = `
set -u
setopt NULL_GLOB
export FORGE_GUARDIAN_LIB=1
export FORGE_HEALTH_DIR=${W}
source "${TOOLS}/forge-guardian"
unset FORGE_GUARDIAN_LIB

"${victim}" ${W}/spec.log &  SPEC=$!
"${victim}" ${W}/crit.log &  CRIT=$!
"${victim}" ${W}/unreg.log & UNREG=$!
# A registered entry pointing at a PROTECTED comm. PROTECTED_RE matches 'node', and
# this harness is node — a governor that signals it takes the measurement with it.
PROT=$$
sleep 0.5
{ print "pid=$SPEC"; print "name=speculative"; print "priority=8"; print "can_restart=1"; print "peak_gb=1"; print "started=$(date +%s)"; } > ${W}/jobs/spec.job
{ print "pid=$CRIT"; print "name=critical-ui"; print "priority=0"; print "can_restart=0"; print "peak_gb=1"; print "started=$(date +%s)"; } > ${W}/jobs/crit.job
{ print "pid=${process.pid}"; print "name=BOGUS-node-entry"; print "priority=9"; print "can_restart=1"; print "peak_gb=1"; print "started=$(date +%s)"; } > ${W}/jobs/bogus.job

print "ORDER=$(for f in $(shed_order); do job_field "$f" name; done | tr '\\n' ',')"
B=$(grep -c "REFUSED to signal protected" ${W}/log/guardian.log 2>/dev/null; true)
for f in $(shed_order); do p=$(job_field "$f" priority); (( \${p:-5} >= 7 )) || continue; signal_job "$f" USR1 >/dev/null 2>&1; done
sleep 0.8
print "SPEC=$(head -1 ${W}/spec.log 2>/dev/null | awk '{print $1}')"
print "CRIT=$(head -1 ${W}/crit.log 2>/dev/null | awk '{print $1}')"
print "UNREG=$(head -1 ${W}/unreg.log 2>/dev/null | awk '{print $1}')"
print "REFUSED=$(grep -c 'REFUSED to signal protected' ${W}/log/guardian.log 2>/dev/null; true)"
print "NODE_ALIVE=$(kill -0 ${process.pid} 2>/dev/null && print 1 || print 0)"
kill -KILL $CRIT $UNREG 2>/dev/null; sleep 0.4
reap_dead_jobs
print "AFTER_REAP=$(ls ${W}/jobs/crit.job 2>/dev/null | wc -l | tr -d ' ')"
print "SPEC_KEPT=$(ls ${W}/jobs/spec.job 2>/dev/null | wc -l | tr -d ' ')"
kill -KILL $SPEC 2>/dev/null
`;
  const r = zsh(script, { timeout: 60000 });
  const grab = (k) => { const m = r.out.match(new RegExp(`^${k}=(.*)$`, 'm')); return m ? m[1].trim() : ''; };
  const order = grab('ORDER').split(',').filter(Boolean);

  checks.push({ name: 'shed order is most-speculative-first', ok: order[0] === 'BOGUS-node-entry' && order[order.length - 1] === 'critical-ui', detail: `order=${order.join('>')}` });
  checks.push({ name: 'the speculative registered job IS asked to checkpoint', ok: grab('SPEC') === 'USR1', detail: `spec got '${grab('SPEC') || 'nothing'}'` });
  checks.push({ name: 'a CRITICAL registered job is untouched by a cooperative shed', ok: grab('CRIT') === '', detail: `crit got '${grab('CRIT') || 'nothing'}'` });
  checks.push({ name: 'an UNREGISTERED process is invisible to the shedder', ok: grab('UNREG') === '', detail: `unregistered got '${grab('UNREG') || 'nothing'}'` });
  checks.push({ name: 'a registration naming a PROTECTED comm is refused, and it survives', ok: parseInt(grab('REFUSED') || '0', 10) >= 1 && grab('NODE_ALIVE') === '1', detail: `refusals=${grab('REFUSED')} protected_alive=${grab('NODE_ALIVE')}` });
  checks.push({ name: 'dead registrations are reaped and live ones kept', ok: grab('AFTER_REAP') === '0' && grab('SPEC_KEPT') === '1', detail: `dead_left=${grab('AFTER_REAP')} live_kept=${grab('SPEC_KEPT')}` });

  return { id: 'shed_targeting', weight: 0.10, checks, evidence: `FORGE_GUARDIAN_LIB=1 source ${TOOLS}/forge-guardian; shed_order/signal_job/reap_dead_jobs against a PRIVATE jobs dir (${W}/jobs) — the live registry is never moved aside` };
}

// ═════════════════════════════════════════════════════════════════════════════
//  scoring
// ═════════════════════════════════════════════════════════════════════════════
// ★ THE WEIGHT IS DECLARED HERE, OUTSIDE THE PROBE, AND THAT IS THE WHOLE POINT.
// A probe that throws cannot tell us its own weight, and the first version of this
// harness gave a crashed dimension `weight: 0.0` — which removes it from the
// DENOMINATOR as well as the numerator. Measured consequence: deleting
// tools/guardian/forge-gate raised the composite 0.617 → 0.822, exit 0, and at
// `--gate 0.70` the SABOTAGED tree PASSED while the honest shipped tree FAILED.
// A scoring system that drops what it could not measure pays you to break the
// instrument. A dimension that did not run must score ZERO at its full weight.
const DIMENSIONS = [
  ['cooperative_shed', d1_cooperative_shed, 0.30],
  ['admission_vs_eviction', d2_admission_vs_eviction, 0.25],
  ['query_costs_no_slot', d3_query_costs_no_slot, 0.20],
  ['green_is_reachable', d4_green_is_reachable, 0.15],
  ['shed_targeting', d5_shed_targeting, 0.10],
];

function scoreDimension(dim) {
  // A `hard` check is a counter-observable: failing it means the dimension was
  // "passed" by removing the capability, so it zeroes the dimension outright.
  const hard = dim.checks.filter((c) => c.hard);
  const soft = dim.checks;
  const frac = mean(soft.map((c) => (c.ok ? 1 : 0)));
  const gate = hard.every((c) => c.ok);
  dim.score = gate ? frac : 0;
  dim.gate = gate;
  dim.passed = soft.filter((c) => c.ok).length;
  dim.total = soft.length;
  return dim;
}

function runAll(TOOLS, label) {
  const dims = [];
  for (const [id, fn, declaredWeight] of DIMENSIONS) {
    if (ONLY && ONLY !== id) continue;
    process.stderr.write(`  · ${id} …\n`);
    let d;
    try {
      d = fn(TOOLS);
      // The table and the probe must agree, or the table silently stops being the
      // authority it was introduced to be. This is cheap and it is a real guard:
      // without it, editing a probe's weight would quietly change the denominator
      // for crashed runs only.
      if (Math.abs(d.weight - declaredWeight) > 1e-9) {
        throw new Error(`weight disagreement: ${id} probe says ${d.weight}, DIMENSIONS says ${declaredWeight}`);
      }
    } catch (e) {
      // FULL declared weight, score zero, and the crash is a HARD check so
      // scoreDimension() gates the dimension to 0 rather than averaging it away.
      d = {
        id, weight: declaredWeight, evidence: 'crash',
        checks: [{ name: '★ the probe ran at all (a crashed dimension scores zero, it does not vanish)', ok: false, hard: true, detail: String(e && e.message) }],
      };
    }
    dims.push(scoreDimension(d));
  }
  // ★ THE DENOMINATOR IS THE DECLARED TOTAL, NOT THE TOTAL THAT HAPPENED TO RUN.
  // With --only, dims holds one dimension; dividing by its own weight would renormalise
  // a single dimension to a composite of 1.000 under an unchanged "RESILIENCE" label.
  const declaredSum = DIMENSIONS.reduce((a, [, , w]) => a + w, 0);
  const ranSum = dims.reduce((a, d) => a + d.weight, 0);
  const partial = !!ONLY || Math.abs(ranSum - declaredSum) > 1e-9;
  const composite = dims.reduce((a, d) => a + d.weight * d.score, 0) / declaredSum;
  return { label, tools: TOOLS, dims, composite, partial, ranSum, declaredSum };
}

function report(run) {
  console.log('\n' + '═'.repeat(78));
  console.log(` RESOURCE_RESILIENCE  —  ${run.label}`);
  console.log(` tools under test: ${run.tools}`);
  console.log('═'.repeat(78));
  console.log(pad('dimension', 26) + pad('W', 7) + pad('SCORE', 9) + pad('checks', 9) + 'gate');
  console.log(rule(60));
  for (const d of run.dims) {
    console.log(pad(d.id, 26) + pad(d.weight.toFixed(2), 7) + pad(f3(d.score), 9) +
      pad(`${d.passed}/${d.total}`, 9) + (d.gate ? 'ok' : 'ZEROED ✗'));
  }
  console.log(rule(60));
  // A partial run is never labelled RESILIENCE: the number is a FRACTION OF THE WHOLE
  // family, so it is reported against the weight that actually ran and named as partial.
  if (run.partial) {
    console.log(pad('RESILIENCE (PARTIAL)', 26) + pad(run.ranSum.toFixed(2), 7) + pad(f3(run.composite), 9) +
      `  ← ${run.dims.length}/${DIMENSIONS.length} dimensions, ${f3(run.declaredSum - run.ranSum)} of the weight NOT RUN and scored zero`);
  } else {
    console.log(pad('RESILIENCE', 26) + pad('1.00', 7) + pad(f3(run.composite), 9));
  }

  for (const d of run.dims) {
    console.log(`\n ${d.id}  (${f3(d.score)})`);
    for (const c of d.checks) console.log(`   ${c.ok ? 'ok  ' : 'FAIL'} ${c.hard ? '★' : ' '} ${c.name.replace(/^★ /, '')}\n          ${c.detail}`);
    if (VERBOSE) console.log(`        evidence: ${d.evidence}`);
  }
  console.log('\n' + '═'.repeat(78));
}

function emitJsonl(run, file) {
  const recs = run.dims.map((d) => JSON.stringify({
    kind: 'resilience', family: 'RESOURCE_RESILIENCE', id: d.id, label: run.label,
    tools: run.tools, weight: d.weight, gate: !!d.gate, checks: d.total, passed: d.passed,
    dimension_score: d.score, cad_score: d.score, ts: new Date().toISOString(),
  }));
  recs.push(JSON.stringify({
    kind: 'resilience', family: 'RESOURCE_RESILIENCE', id: '__family__', label: run.label,
    tools: run.tools, weight: 1, gate: run.dims.every((d) => d.gate), checks: run.dims.reduce((a, d) => a + d.total, 0),
    passed: run.dims.reduce((a, d) => a + d.passed, 0), dimension_score: run.composite,
    cad_score: run.composite, ts: new Date().toISOString(),
  }));
  fs.appendFileSync(file, recs.join('\n') + '\n');
  console.log(` [json-out] appended ${recs.length} case records → ${file}`);
}

// ═════════════════════════════════════════════════════════════════════════════
//  --aggregate — same dedup-by-(kind,id)-and-average semantics as cadgen_aggregate
// ═════════════════════════════════════════════════════════════════════════════
function aggregate(files) {
  const byKey = new Map();
  for (const f of files) for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const s = line.trim(); if (!s) continue;
    let r; try { r = JSON.parse(s); } catch { continue; }
    if (r.kind !== 'resilience') continue;
    const k = `${r.label}:${r.id}`;
    if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(r);
  }
  const rows = [...byKey.entries()].map(([k, arr]) => ({
    key: k, label: arr[0].label, id: arr[0].id, runs: arr.length,
    score: mean(arr.map((r) => r.dimension_score || 0)),
  }));
  console.log('\n' + '═'.repeat(78));
  console.log(' RESOURCE_RESILIENCE AGGREGATE');
  console.log('═'.repeat(78));
  console.log(pad('label', 40) + pad('dimension', 26) + pad('MEAN', 9) + 'runs');
  console.log(rule(70));
  for (const r of rows.sort((a, b) => a.key.localeCompare(b.key)))
    console.log(pad(r.label, 40) + pad(r.id, 26) + pad(f3(r.score), 9) + r.runs);
  console.log('═'.repeat(78));
}

// ═════════════════════════════════════════════════════════════════════════════
//  ★ --reintroduce — the falsifiability run.
// ═════════════════════════════════════════════════════════════════════════════
// Each mutation is a TEXTUAL reintroduction of a defect that was actually measured in
// production, applied to an all-fixes baseline tree. A mutation that does not apply
// is reported as NOT-APPLICABLE and never silently scored as a pass.
const MUTATIONS = [
  {
    id: 'a_usr1_untrapped', file: 'forge-job',
    why: 'forge-job without the USR1 trap — the politest signal in the system becomes lethal (rc=158).',
    apply: (s) => s.replace(/^trap forward_usr1 USR1$/m, '# (mutation a) trap forward_usr1 USR1'),
  },
  {
    id: 'b_argloop_break', file: 'forge-job',
    why: 'the `*) break` arg loop, so an unrecognised flag becomes the COMMAND and `--help` reaches --wait 900.',
    apply: (s) => s
      .replace(/^ *-h\|--help\|help\) usage; exit 0 ;;$/m, '')
      .replace(/^ *-\*\) print -u2 "forge-job: unknown option '\$1'"; usage >&2; exit 2 ;;$/m, ''),
  },
  {
    // The FAITHFUL reintroduction is the shipped ladder: both grace windows gone, so
    // a job admitted at peak_gb=N is TERMed for reaching N, again every two polls.
    // (An earlier version of this mutation set GRACE_SETTLE=0/GRACE_TERM=0 instead and
    // scored IDENTICAL to the baseline. That was not a rubric failure — it was the
    // nounset crash below masking BOTH trees. Recorded because the difference between
    // "the rubric cannot see it" and "both arms are broken the same way" is the whole
    // discipline: prove the arms differ.)
    id: 'c_admission_eviction_disagree', file: 'forge-guardian',
    why: 'the settling + one-TERM-per-decision grace removed: admit peak_gb=N, then evict at N, repeatedly.',
    apply: (s) => s
      .replace(/^ *# SETTLING GRACE[\s\S]*?^ *fi\n/m, '')
      .replace(/^ *# ONE TERM PER DECISION[\s\S]*?^ *fi\n/m, '')
      .replace(/^ *\[\[ -n "\$_jpid" \]\] && TERMED_AT\[\$_jpid\]=\$_now$/m, ''),
  },
  {
    id: 'd_green_unreachable', file: 'forge-guardian',
    why: 'a ladder whose GREEN is unreachable: the disk rung raised above any attainable free space.',
    apply: (s) => s.replace(/O_DISK < 45/, 'O_DISK < 4500'),
  },
];

// ★ A BASELINE MUST BE A WORKING SYSTEM. Measured by this harness on its first run:
// forge-guardian's admission/eviction grace (83c4f33b, SHIPPED on origin/archdisc, and
// BYTE-FOR-BYTE what is installed at ~/.forge-health/bin/forge-guardian right now) reads
// ${TERMED_AT[$_jpid]} on an associative-array key that does not exist yet, under the
// file's own `set -u`. The daemon therefore DIES at forge-guardian:474 the first time it
// reaches RED stage 3 and tries to evict anything — leaving the workstation with no
// governor at the exact moment it needs one, and making its own grace unreachable.
// Reproduce against the checked-out tree:
//   node forge-kernel/test/resilience_harness.mjs \
//        --only admission_vs_eviction --keep --verbose     # then read $W/guardian.out
// Repair (one line, twice): ${TERMED_AT[$_jpid]:-}. Applied HERE only, at runtime, so
// the falsifiability matrix measures the RUBRIC instead of that bug — never silently:
// the matrix prints the repair and the unrepaired branch is scored beside it.
const NOUNSET_REPAIR = {
  file: 'forge-guardian',
  note: 'TERMED_AT[$_jpid] -> TERMED_AT[$_jpid]:-  (nounset crash SHIPPED at origin/archdisc and INSTALLED live)',
  apply: (s) => s.replace(/\$\{TERMED_AT\[\$_jpid\]\}/g, '${TERMED_AT[$_jpid]:-}'),
};

function materialise(spec, dest) {
  // spec: { 'forge-job': '<rev>', 'forge-guardian': '<rev>', '*': '<rev>' }
  fs.mkdirSync(dest, { recursive: true });
  const names = execFileSync('git', ['-C', REPO, 'ls-tree', '--name-only', `${spec['*']}:tools/guardian`], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter((s) => s && !s.endsWith('/'));
  for (const n of names) {
    const rev = spec[n] || spec['*'];
    const body = execFileSync('git', ['-C', REPO, 'show', `${rev}:tools/guardian/${n}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
    write(path.join(dest, n), body, 0o755);
  }
  return dest;
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const n of fs.readdirSync(src)) {
    const s = path.join(src, n);
    if (!fs.statSync(s).isFile()) continue;
    fs.copyFileSync(s, path.join(dest, n));
    fs.chmodSync(path.join(dest, n), 0o755);
  }
  return dest;
}

// ── --reintroduce --from-tree ────────────────────────────────────────────────
// Mutates the WORKING CHECKOUT's tools/guardian. A mutation whose target text is not
// there is reported ALREADY PRESENT — never silently scored as a pass, and never
// confused with "the rubric could not see it". Both states are printed; only a
// mutation that applies AND fails to move the score is a rubric failure.
function reintroduceFromTree(root) {
  const SRC = path.resolve(getFlag('--tools', path.join(REPO, 'tools', 'guardian')));
  const repair = (dir) => {
    const p = path.join(dir, NOUNSET_REPAIR.file);
    const before = fs.readFileSync(p, 'utf8'); const after = NOUNSET_REPAIR.apply(before);
    fs.writeFileSync(p, after); fs.chmodSync(p, 0o755);
    return { dir, repaired: after !== before };
  };
  const b = repair(copyTree(SRC, path.join(root, 'base')));
  const base = runAll(b.dir, `baseline = working tree${b.repaired ? ' + nounset repair' : ''}`);
  const runs = [base];
  const mutRuns = [];
  for (const m of MUTATIONS) {
    const { dir } = repair(copyTree(SRC, path.join(root, `mut-${m.id}`)));
    const p = path.join(dir, m.file);
    const before = fs.readFileSync(p, 'utf8'); const after = m.apply(before);
    fs.writeFileSync(p, after); fs.chmodSync(p, 0o755);
    const r = runAll(dir, `REINTRODUCED ${m.id}`);
    r.mutation = m; r.applied = after !== before;
    mutRuns.push(r); runs.push(r);
  }
  for (const r of runs) report(r);
  if (JSON_OUT) for (const r of runs) emitJsonl(r, JSON_OUT);

  console.log('\n' + '═'.repeat(78));
  console.log(' ★ FALSIFIABILITY (from the working tree) — an APPLIED defect must score LOWER');
  console.log('═'.repeat(78));
  console.log(pad('tree', 40) + pad('SCORE', 9) + pad('Δ vs base', 12) + 'verdict');
  console.log(rule(78));
  console.log(pad(base.label, 40) + pad(f3(base.composite), 9) + pad('—', 12) + `source: ${SRC}`);
  let ok = true;
  for (const r of mutRuns) {
    const d = r.composite - base.composite;
    const lower = r.composite < base.composite - 1e-9;
    const verdict = !r.applied ? 'ALREADY PRESENT in this tree (defect is shipped)'
      : lower ? 'discriminated ✓' : 'INDISTINGUISHABLE ✗';
    if (r.applied && !lower) ok = false;
    console.log(pad(r.mutation.id, 40) + pad(f3(r.composite), 9) + pad((d >= 0 ? '+' : '') + f3(d), 12) + verdict);
  }
  console.log(rule(78));
  console.log(' VERDICT: ' + (ok ? 'every applicable defect is discriminated ✓'
    : 'the rubric CANNOT tell an applied defect from its fix ✗'));
  console.log('═'.repeat(78));
  return ok ? 0 : 1;
}

function reintroduce() {
  // DEFAULT SHIPPED = origin/archdisc, not the worktree's base. Measured while writing
  // this: origin/archdisc had moved three commits past the audited base and ALREADY
  // carried the grace fix — so the nounset crash is a SHIPPED defect, not a branch one,
  // and scoring only the local base would have reported the opposite.
  const SHIPPED = getFlag('--rev-shipped', 'origin/archdisc');
  const AUDITED = getFlag('--rev-audited', '02de2e15');
  const REV_JOB = getFlag('--rev-forge-job', '4e98420a');      // wip/forge-job-help-and-usr1
  const REV_GUARD = getFlag('--rev-forge-guardian', '83c4f33b'); // the grace fix
  const root = mktemp('reintro');
  if (!KEEP) onCleanup(() => fs.rmSync(root, { recursive: true, force: true }));

  // --from-tree: build every tree from the WORKING CHECKOUT instead of git revisions.
  // This is the form CI runs: it needs no branch names, so it cannot rot when a wip
  // branch is merged or deleted, and it asks the durable question — can this rubric
  // still tell each of the four measured defects from the tree in front of it?
  const FROM_TREE = has('--from-tree');
  if (FROM_TREE) return reintroduceFromTree(root);

  const runs = [];
  // 1. the tree a release gate and a fresh checkout actually get.
  const shippedDir = materialise({ '*': SHIPPED }, path.join(root, 'shipped'));
  const shipped = runAll(shippedDir, `SHIPPED @ ${SHIPPED} (${execFileSync('git', ['-C', REPO, 'rev-parse', '--short', SHIPPED], { encoding: 'utf8' }).trim()})`);
  runs.push(shipped);
  // 2. the base this task was audited against, for continuity with the ledger.
  runs.push(runAll(materialise({ '*': AUDITED }, path.join(root, 'audited')), `audited base @ ${AUDITED}`));
  // 3. the branches AS THEY ARE — every unmerged fix, nothing else touched.
  const asBranchedDir = materialise({ '*': SHIPPED, 'forge-job': REV_JOB, 'forge-guardian': REV_GUARD }, path.join(root, 'asbranched'));
  const asBranched = runAll(asBranchedDir, `branches as-is (forge-job@${REV_JOB})`);
  runs.push(asBranched);
  // 4. the all-fixes baseline = the branches plus the one-line nounset repair, because
  //    a reintroduction baseline has to be a system that works.
  const repair = (dir) => {
    const p = path.join(dir, NOUNSET_REPAIR.file);
    fs.writeFileSync(p, NOUNSET_REPAIR.apply(fs.readFileSync(p, 'utf8'))); fs.chmodSync(p, 0o755);
    return dir;
  };
  const baseDir = repair(materialise({ '*': SHIPPED, 'forge-job': REV_JOB, 'forge-guardian': REV_GUARD }, path.join(root, 'allfixes')));
  const base = runAll(baseDir, 'all-fixes baseline (+ nounset repair)');
  runs.push(base);
  // 5. the baseline with each measured defect put back, one at a time.
  const mutRuns = [];
  for (const m of MUTATIONS) {
    const dir = repair(materialise({ '*': SHIPPED, 'forge-job': REV_JOB, 'forge-guardian': REV_GUARD }, path.join(root, `mut-${m.id}`)));
    const p = path.join(dir, m.file);
    const before = fs.readFileSync(p, 'utf8');
    const after = m.apply(before);
    const applied = after !== before;
    fs.writeFileSync(p, after); fs.chmodSync(p, 0o755);
    const r = runAll(dir, `REINTRODUCED ${m.id}`);
    r.mutation = m; r.applied = applied;
    mutRuns.push(r); runs.push(r);
  }

  for (const r of runs) report(r);
  if (JSON_OUT) for (const r of runs) emitJsonl(r, JSON_OUT);

  console.log('\n' + '═'.repeat(78));
  console.log(' ★ FALSIFIABILITY — every reintroduced defect must score STRICTLY LOWER');
  console.log('═'.repeat(78));
  console.log(pad('tree', 40) + pad('SCORE', 9) + pad('Δ vs base', 12) + 'verdict');
  console.log(rule(78));
  for (const r of runs.slice(0, 3))
    console.log(pad(r.label, 40) + pad(f3(r.composite), 9) + pad('—', 12) +
      (r === shipped ? 'what a release gate actually gets' : r === asBranched ? 'every fix, NONE merged' : 'the base this task was audited on'));
  console.log(pad('all-fixes baseline (+repair)', 40) + pad(f3(base.composite), 9) + pad('—', 12) +
    'baseline; repair = ' + NOUNSET_REPAIR.note);
  let ok = true;
  for (const r of mutRuns) {
    const d = r.composite - base.composite;
    const lower = r.composite < base.composite - 1e-9;
    if (!lower) ok = false;
    console.log(pad(r.mutation.id, 40) + pad(f3(r.composite), 9) + pad((d >= 0 ? '+' : '') + f3(d), 12) +
      (!r.applied ? 'NOT APPLICABLE ✗' : lower ? 'discriminated ✓' : 'INDISTINGUISHABLE ✗'));
    if (!r.applied) ok = false;
  }
  console.log(rule(78));
  console.log(` shipped-vs-fixed GAP = ${f3(base.composite - shipped.composite)}  ` +
    `(${f3(shipped.composite)} → ${f3(base.composite)}; the fixes are on branches, NOT merged)`);
  console.log(' VERDICT: ' + (ok ? 'the rubric discriminates every measured defect ✓'
    : 'the rubric CANNOT tell at least one defect from its fix — that is a finding about the rubric ✗'));
  console.log('═'.repeat(78));
  return ok ? 0 : 1;
}

// ═════════════════════════════════════════════════════════════════════════════
//  main
// ═════════════════════════════════════════════════════════════════════════════
const AGG = getAll('--aggregate');
if (AGG.length) { aggregate(AGG); process.exit(0); }

const before = witness();
let code = 0;
if (has('--reintroduce')) {
  code = reintroduce();
} else {
  const TOOLS = path.resolve(getFlag('--tools', path.join(REPO, 'tools', 'guardian')));
  if (!fs.existsSync(path.join(TOOLS, 'forge-job'))) { console.error(`[fatal] no forge-job under ${TOOLS}`); process.exit(2); }
  const run = runAll(TOOLS, LABEL || `tree @ ${TOOLS}`);
  report(run);
  if (JSON_OUT) emitJsonl(run, JSON_OUT);
  // A family harness is a benchmark, not a gate: it reports a number. --gate turns
  // it into a release gate at an explicit floor, per doc 08.
  const floor = parseFloat(getFlag('--gate', 'NaN'));
  if (isFinite(floor)) {
    if (run.partial) {
      // ★ A PARTIAL RUN CANNOT PASS A RELEASE GATE, and refusing is the only safe
      // answer. `--only shed_targeting --gate 0.70` used to renormalise one 0.10
      // dimension to a composite of 1.000 and exit 0 — a release gate satisfied by
      // choosing which dimension to measure.
      console.log(` GATE: REFUSED — this was a PARTIAL run (${run.dims.length}/${DIMENSIONS.length} dimensions).`);
      console.log(`       A floor may only be applied to a full run; drop --only.`);
      code = 2;
    } else {
      console.log(` GATE: ${f3(run.composite)} vs floor ${f3(floor)} → ${run.composite >= floor ? 'PASS ✓' : 'FAIL ✗'}`);
      code = run.composite >= floor ? 0 : 1;
    }
  }
}
const after = witness();
const w = compareWitness(before, after);
console.log(`\n LIVE SYSTEM WITNESS (the Archie sidecar holds the GPU and serves the demo)`);
console.log(`   before: state=${before.state} guardian=${before.pids || 'none'} jobs=[${before.jobs.join(' ') || 'none'}]`);
console.log(`   after : state=${after.state} guardian=${after.pids || 'none'} jobs=[${after.jobs.join(' ') || 'none'}]`);
if (w.added.length) console.log(`   ·  other agents registered during this run (not ours): ${w.added.join(' ')}`);
if (w.problems.length) {
  for (const p of w.problems) console.log(`   ✗ ${p}`);
  console.log('   ✗ THE LIVE SYSTEM MOVED. This harness must be hermetic; do not trust the score.');
  code = code || 3;
} else {
  console.log('   ✓ same governor pid, every prior registration intact, nothing of ours in the live registry');
}
process.exit(code);
