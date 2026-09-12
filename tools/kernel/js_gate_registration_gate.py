#!/usr/bin/env python3
"""js_gate_registration_gate.py — every gate written in JavaScript reaches CI.

WHY THIS EXISTS. The repository had THREE green gate-registration checks --
forge-kernel/test/gate_registration_ratchet.sh (*_gate.sh under forge-kernel/
test), tools/gates/shell_gate_registration_ratchet.sh (tree-wide *.sh) and
forge-desktop/test/gate_registration_check.sh -- and not one can see a gate
written in JavaScript. Eleven files match *_gate.{js,mjs}. Ten had never run:
cfd_sod_gate validates the native 1D Euler solver against the EXACT Sod
shock-tube Riemann solution, em_electrostatics_gate against three textbook
capacitor closed forms, setback_clearance_gate guards a real defect in
NativeFilletChamfer.cpp. That is the hole between three correctly-scoped checks.

★ REACHABILITY IS A TRANSITIVE CLOSURE OVER FILES, and getting it wrong in
  EITHER direction makes the ratchet useless:

  - Under-report and it misses the gates it exists to find.
  - Over-report and every wired gate lands in ALLOW until nobody reads the list.

  Both happened while writing this. A basename search over .github/workflows
  alone called 83 of 88 .mjs tests unwired -- CI runs `npm run forge:kernel:test`
  and THAT names dozens of them inside package.json. Following npm scripts fixed
  those and still mis-called fea_nafems_gate.mjs, which no workflow and no npm
  script names: kernel-tests.yml runs fea_nafems_ratchet.sh, and the SHELL SCRIPT
  runs the gate. So the closure walks: workflow -> anything it names -> anything
  THAT names, to a fixed point, over npm script bodies and repo files alike.

★ COMMENTS ARE STRIPPED before matching. fea_nafems_gate.mjs is ALSO mentioned
  in a kernel-tests.yml comment ("# Runs fea_nafems_gate.mjs and ratchets ..."),
  and counting that would have marked it reachable for the wrong reason -- it is
  reachable through the shell script, and would still be "reachable" here if that
  invocation were deleted and only the sentence describing it remained. This is
  the same defect that made the kernel ratchet unfalsifiable (see T-107).

Run with --selftest to prove the ratchet fails in both directions.
"""
import json, os, pathlib, re, subprocess, sys, tempfile

# Pinned gates: each needs a REASON. The ratchet goes red if a pinned gate
# becomes reachable, so progress cannot pass unnoticed and ALLOW cannot ossify.
ALLOW = {
    # Pinned with a MEASURED cost, not a shrug. All three PASS; they are excluded
    # only because 42.6 of the physics suite's 42.7 minutes live in these three,
    # and the job that hosts the fast seven is already the 38-43 min critical path
    # that gates every merge. Wiring them belongs with a decision about a parallel
    # or scheduled job -- this repository currently has NEITHER a scheduled
    # workflow nor a path filter anywhere, so that is a new pattern and wants its
    # own tick. If one becomes reachable this gate goes RED so the pin cannot
    # quietly become permanent.
    'forge-kernel/test/cfd_oblique_shock_gate.mjs': 'PASSES; 299.4s (5.0 min) measured',
    'forge-kernel/test/cfd_ghia_gate.mjs':          'PASSES; 641.5s (10.7 min) measured',
    'forge-kernel/test/cfd_natconv_gate.mjs':       'PASSES; 1612.5s (26.9 min) measured',
}

def tracked(root):
    return subprocess.run(['git', 'ls-files'], cwd=root,
                          capture_output=True, text=True).stdout.split()

def strip_comments(text, path):
    """A comment naming a gate is not an invocation of it."""
    if path.endswith(('.yml', '.yaml', '.sh', '.bash')):
        return re.sub(r'(?m)^\s*#.*$|\s#.*$', '', text)
    if path.endswith(('.js', '.mjs', '.cjs', '.json')):
        text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
        return re.sub(r'(?m)^\s*//.*$', '', text)
    return text

def read(root, rel):
    p = pathlib.Path(root) / rel
    try:
        return strip_comments(p.read_text(errors='replace'), rel)
    except Exception:
        return ''

INVOKE = r'(?:^|[\s;&|`"\'(])(?:node|bash|sh|zsh|npx|ts-node|\./)?\s*[\w./-]*'

def invokes(blob, base):
    """Named in an INVOCATION position, not merely mentioned.

    An earlier version absorbed any tracked file whose basename appeared anywhere
    in the corpus. That made a REPORT listing gate names pull every gate it named
    into the "reachable" set, and the ratchet cheerfully declared six gates fine
    that nothing runs. Mentioning is not invoking."""
    pat = (r'(?:^|[\s;&|`"\'(])'                    # start or a shell separator
           r'(?:(?:node|bash|sh|zsh|npx|ts-node)\s+)'  # an interpreter ...
           r'[\w./-]*' + re.escape(base) + r'(?:\s|$|[;&|`"\')])')
    return re.search(pat, blob, re.M) is not None


def reachable_corpus(root):
    """Fixed point: start at the workflows, absorb anything they INVOKE."""
    files = tracked(root)
    # Only a file that can RUN something can extend the corpus. Scanning every
    # tracked file cost 74s per check -- the closure re-reads its candidates each
    # round -- and a .md or .cpp cannot invoke a gate anyway.
    RUNNABLE = ('.sh', '.bash', '.zsh', '.yml', '.yaml', '.json', '.mjs', '.js', '.cjs', '.py')
    by_base = {}
    for f in files:
        if f.endswith(RUNNABLE):
            by_base.setdefault(os.path.basename(f), []).append(f)

    seeds = [f for f in files if f.startswith('.github/workflows/')]
    corpus, seen = [], set(seeds)
    for f in seeds:
        corpus.append(read(root, f))

    # package.json scripts are reachable bodies too, but only those CI invokes.
    try:
        scripts = json.loads((pathlib.Path(root) / 'package.json').read_text()).get('scripts', {})
    except Exception:
        scripts = {}

    changed = True
    while changed:
        changed = False
        blob = '\n'.join(corpus)
        for name, body in scripts.items():
            key = f'npmscript:{name}'
            if key in seen:
                continue
            if re.search(rf'npm run {re.escape(name)}(\s|$|&|;|")', blob, re.M):
                seen.add(key); corpus.append(body); changed = True
        blob = '\n'.join(corpus)
        # ONE pass over the corpus, not one regex per candidate basename. Asking
        # invokes(blob, base) for every runnable file re-scanned the whole corpus
        # thousands of times per round: 74s -> 29s after narrowing the candidates,
        # and ~1s once the direction is inverted like this.
        invoked = {os.path.basename(m.group(1)) for m in
                   re.finditer(r'(?:^|[\s;&|`"\'(])(?:node|bash|sh|zsh|npx|ts-node)\s+'
                               r'([\w./-]+)', blob, re.M)}
        for base in invoked & by_base.keys():
            for p in by_base[base]:
                if p not in seen:
                    seen.add(p); corpus.append(read(root, p)); changed = True
    return '\n'.join(corpus)

def check(root):
    corpus = reachable_corpus(root)
    gates = [f for f in tracked(root) if re.search(r'_gate\.(mjs|js)$', f)]
    # TWO DIFFERENT RULES, and conflating them broke this gate twice:
    #
    #   Absorbing a FILE into the corpus requires an INVOCATION context, or a
    #   report that merely LISTS gate names gets absorbed and every gate it names
    #   looks reachable. (Measured: that declared 6 never-run gates fine.)
    #
    #   Deciding a GATE is reachable accepts any NON-COMMENT mention inside that
    #   corpus, because invocation is often indirect. fea_nafems_ratchet.sh does
    #   GATE="${NAFEMS_GATE:-$HERE/fea_nafems_gate.mjs}" and then `node "$GATE"`;
    #   demanding `node <basename>` called that genuinely-wired gate unwired.
    #   (Measured: that flagged all 11, including the one gate CI does run.)
    #
    # The corpus is already restricted to files CI actually runs, so a mention
    # inside it is evidence; a mention anywhere in the repo is not.
    unreached = [g for g in gates if os.path.basename(g) not in corpus]
    new  = [g for g in unreached if g not in ALLOW]
    gone = [g for g in ALLOW if g not in unreached]
    return gates, unreached, new, gone

def main(root):
    gates, unreached, new, gone = check(root)
    print(f'[js-gate-registration] *_gate.{{js,mjs}}: {len(gates)}  '
          f'unreached: {len(unreached)}  pinned: {len(ALLOW)}')
    for g in unreached:
        print(f'    {g}' + (f'   (pinned: {ALLOW[g]})' if g in ALLOW else ''))
    rc = 0
    if new:
        print('[js-gate-registration] RED — a JS gate does not reach CI:')
        for g in new:
            print(f'    {g}')
        print('[js-gate-registration] It sits in the tree looking like coverage and never runs.')
        print('[js-gate-registration] Wire it into a workflow, an npm script CI invokes, or a')
        print('[js-gate-registration] script one of those runs — or add it to ALLOW with a reason.')
        rc = 1
    if gone:
        print('[js-gate-registration] RED ON AN IMPROVEMENT — these now run:')
        for g in gone:
            print(f'    {g}')
        print('[js-gate-registration] Remove them from ALLOW.')
        rc = 1
    if rc == 0:
        print('[js-gate-registration] GREEN — every JS gate reaches CI.')
    return rc

def _baseline(root, td):
    """A clone of HEAD plus the working-tree diff, asserted GREEN.

    Before this gate landed, ten gates were unreached, so a bare clone of HEAD is
    red on its own and every mutation's RED would be unattributable."""
    dst = pathlib.Path(td) / 'r'
    subprocess.run(['git', 'clone', '-q', '--no-hardlinks', '--depth', '1',
                    'file://' + os.path.abspath(root), str(dst)],
                   check=True, capture_output=True)
    diff = subprocess.run(['git', 'diff', 'HEAD'], cwd=root,
                          capture_output=True, text=True).stdout
    if diff.strip():
        subprocess.run(['git', 'apply', '--allow-empty', '-'], cwd=dst,
                       input=diff, text=True, check=True)
    _, _, new, gone = check(dst)
    if new or gone:
        raise SystemExit('[js-gate-registration] selftest VOID — baseline already red:\n   '
                         + '\n   '.join(new + gone))
    return dst

PHANTOM = 'forge-kernel/test/zqxprobe_gate.mjs'
WF      = '.github/workflows/kernel-tests.yml'

def selftest(root):
    ok = True
    cases = []

    def add(name, mutate, want_red):
        cases.append((name, mutate, want_red))

    def _track(d, rel):
        """git add it. tracked() reads `git ls-files`, deliberately -- an earlier
        gate counted an untracked scratchpad and produced different numbers in
        different checkouts. The consequence here is that a phantom which is only
        WRITTEN is invisible, and cases 1 and 3 reported GREEN against a defect
        they were built to catch."""
        subprocess.run(['git', 'add', '-f', rel], cwd=d, check=True, capture_output=True)

    def phantom_only(d):
        (d / PHANTOM).write_text('process.exit(0)\n'); _track(d, PHANTOM)
    add('a NEW JS gate that nothing runs', phantom_only, True)

    def wired(d):
        phantom_only(d)
        (d / WF).write_text((d / WF).read_text() +
                            f'\n      - name: zqx probe\n        run: node {PHANTOM}\n')
    add('...and wiring it for real clears the gate', wired, False)

    def commented(d):
        phantom_only(d)
        (d / WF).write_text((d / WF).read_text() +
                            f'\n        # TODO: wire {PHANTOM} into CI one day\n')
    add('...but a COMMENT naming it does NOT count as wiring', commented, True)

    def pinned_now_runs(d):
        # The ratchet must notice PROGRESS too, or ALLOW silently becomes permanent.
        # The fixture is READ OUT OF ALLOW rather than named here: hardcoding one
        # is what made the neighbouring shell selftest go stale the moment its
        # example gate was genuinely wired (T-107).
        target = sorted(ALLOW)[0]
        (d / WF).write_text((d / WF).read_text() +
                            f'\n      - name: zqx pinned\n        run: node {target}\n')
    add('a PINNED gate that becomes reachable', pinned_now_runs, True)

    def control(d):
        (d / WF).write_text((d / WF).read_text() + '\n        # an edit naming no gate\n')
    add('control: an edit naming no gate leaves the verdict alone', control, False)

    for name, mutate, want_red in cases:
        with tempfile.TemporaryDirectory() as td:
            dst = _baseline(root, td)
            mutate(dst)
            _, _, new, gone = check(dst)
            red = bool(new or gone)
            good = (red == want_red)
            print(f'  {"RED " if red else "GREEN"}  {name}'
                  f'{"" if good else "   <- WRONG, wanted " + ("RED" if want_red else "GREEN")}')
            ok &= good
    return ok

if __name__ == '__main__':
    root = pathlib.Path(__file__).resolve().parents[2]
    if '--selftest' in sys.argv:
        print('[js-gate-registration] selftest — the ratchet must fail in both directions')
        sys.exit(0 if selftest(root) else 1)
    sys.exit(main(root))
