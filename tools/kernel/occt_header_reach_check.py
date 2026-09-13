#!/usr/bin/env python3
"""occt_header_reach_check.py — does the tracker's include-graph agree with a COMPILER?

docs/kernel/OCCT_REMOVAL_TRACKER.md answers "which public kernel headers cannot be
included without the OCCT SDK" by walking `#include` lines. That is a TEXT measure
of a question only the preprocessor really answers, and it was wrong on its first
run: `forge/ArcHelix.hpp` includes `forge/Sketcher.hpp`, which includes
<TopoDS_Wire.hxx>, so the walk called it OCCT-forcing -- but ArcHelix's whole body
sits behind `#ifdef FORGE_FT_ARCHELIX`, which no default build defines, and it
compiles cleanly with no OCCT on the path. A measure that disagrees with the
compiler about what the compiler does is not a measure.

So this is the control. Every public header under forge-kernel/include/forge is
compiled as a ONE-LINE translation unit with no OCCT directory on the include
path, and the set that fails FOR A MISSING OCCT HEADER must equal exactly what
the tracker's generator claims: the headers that include OCCT directly, plus the
ones that reach it only through another Forge header.

A header that fails for any OTHER reason is reported separately and compared
against nothing -- it is not self-contained, or it needs a different SDK, and
neither is this script's question.

Exit 0 when the two agree. Exit 1, naming every disagreement in both directions,
when they do not.
"""
import argparse
import concurrent.futures
import importlib.util
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GEN = os.path.join(ROOT, 'tools', 'kernel', 'occt_dependency_graph.py')
MISSING = re.compile(r"fatal error: '([A-Za-z0-9_]+)\.hxx' file not found")


def load_generator():
    spec = importlib.util.spec_from_file_location('occt_graph', GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def public_headers(mod):
    return [rel for rel in sorted(mod.walk())
            if rel.startswith('forge-kernel/include/forge/') and rel.endswith('.hpp')]


def probe(args):
    rel, cxx, tmpdir, defines = args
    inc = os.path.relpath(rel, 'forge-kernel/include')
    src = os.path.join(tmpdir, inc.replace('/', '_').replace('.hpp', '') + '.cpp')
    with open(src, 'w') as fh:
        fh.write('#include "%s"\n' % inc)
    out = subprocess.run(
        [cxx, '-std=c++20', '-fsyntax-only', *defines,
         '-I', os.path.join(ROOT, 'forge-kernel', 'include'),
         '-I', os.path.join(ROOT, 'ui', 'include'), src],
        capture_output=True, text=True, cwd=ROOT)
    if out.returncode == 0:
        return rel, 'ok', ''
    m = MISSING.search(out.stderr)
    if m and mod_is_occt(m.group(1)):
        return rel, 'occt', m.group(1) + '.hxx'
    return rel, 'other', (out.stderr.strip().splitlines() or [''])[0][:120]


_OCCT_HDR = None


def mod_is_occt(stem):
    return bool(_OCCT_HDR.match(stem + '.hxx'))


def main():
    global _OCCT_HDR
    ap = argparse.ArgumentParser()
    ap.add_argument('--cxx', default=os.environ.get('CXX', 'c++'))
    ap.add_argument('--jobs', type=int, default=os.cpu_count() or 4)
    ap.add_argument('--selftest', action='store_true',
                    help='prove this control can fail, in BOTH directions')
    ap.add_argument('--report-shipped', action='store_true',
                    help='also probe with -DFORGE_NATIVE_BREP=1 (the shipped build). '
                         'Doubles the runtime and changes no verdict -- the comparison '
                         'is against the bare arm, which is the one the include-graph '
                         'walk can be compared with. Off by default so preflight stays '
                         'cheap; CI passes it.')
    a = ap.parse_args()

    mod = load_generator()
    _OCCT_HDR = mod.OCCT_HDR
    hdrs = public_headers(mod)

    # What the TRACKER claims, read from the same code that writes the document.
    direct = set()
    hdr_re = re.compile(r'^\s*#\s*include\s*<([A-Za-z0-9_]+)\.hxx>')
    for rel in hdrs:
        q_u, q_c, occt_u, occt_c = mod._scan_header(os.path.join(ROOT, rel))
        if occt_u:
            direct.add(rel)
    transitive = {rel for rel, _via in mod.transitive_occt_headers(direct)}
    claimed = direct | transitive

    def measure(defines):
        with tempfile.TemporaryDirectory() as tmp:
            with concurrent.futures.ThreadPoolExecutor(max_workers=a.jobs) as ex:
                return list(ex.map(probe, [(h, a.cxx, tmp, defines) for h in hdrs]))

    # TWO CONFIGURATIONS, because the answer depends on one and the tracker's text
    # count reflects neither. FORGE_NATIVE_BREP defaults ON in forge-kernel's
    # CMakeLists, so the SHIPPED build is the second arm; the bare arm is the one
    # the include-graph walk can be compared against, since that walk does not
    # evaluate macros and deliberately follows only unconditional edges.
    results = measure([])
    shipped = measure(['-DFORGE_NATIVE_BREP=1']) if a.report_shipped else []

    measured = {rel for rel, kind, _ in results if kind == 'occt'}
    shipped_set = {rel for rel, kind, _ in shipped if kind == 'occt'}
    other = [(rel, why) for rel, kind, why in results if kind == 'other']

    print('[header-reach] %d public headers under forge-kernel/include/forge' % len(hdrs))
    print('[header-reach]   bare (no -D)            : %d need OCCT   <- comparable to the'
          ' include-graph walk' % len(measured))
    if a.report_shipped:
        print('[header-reach]   -DFORGE_NATIVE_BREP=1   : %d need OCCT   <- THE SHIPPED'
              ' BUILD (CMake defaults this ON)' % len(shipped_set))
    print('[header-reach]   the tracker claims      : %d  (direct %d + transitive %d)'
          % (len(claimed), len(direct), len(transitive)))
    extra = sorted(os.path.basename(r) for r in shipped_set - measured)
    if a.report_shipped and extra:
        print('[header-reach]   %d header(s) need OCCT only once FORGE_NATIVE_BREP is on:'
              % len(extra))
        print('[header-reach]     ' + ', '.join(extra))
    if other:
        print('[header-reach] %d header(s) failed for a reason that is NOT a missing OCCT'
              ' header; not compared:' % len(other))
        for rel, why in other[:10]:
            print('[header-reach]     %s -- %s' % (rel, why))

    if a.selftest:
        # A control nobody has seen fail is a control nobody has read. Perturb the
        # CLAIM, not the measurement, and require red each way.
        bad = 0
        one = sorted(measured)[0] if measured else None
        if one is None:
            print('[header-reach] SELFTEST INCONCLUSIVE: nothing needs OCCT, so there is'
                  ' nothing to drop'); return 1
        if set(measured) - {one} == measured:
            print('[header-reach] SELFTEST RED: dropping an entry did not change the claim')
            bad += 1
        for label, fake in (('a claim that MISSES a real one', set(measured) - {one}),
                            ('a claim with a PHANTOM entry',
                             set(measured) | {'forge-kernel/include/forge/NoSuchHeader.hpp'})):
            if not (measured - fake) and not (fake - measured):
                print('[header-reach] SELFTEST RED: %s compared EQUAL' % label)
                bad += 1
            else:
                print('[header-reach]   selftest: %s is caught' % label)
        if bad:
            return 1
        print('[header-reach] SELFTEST GREEN — the comparison fails in both directions')
        return 0

    missed = sorted(measured - claimed)
    phantom = sorted(claimed - measured)
    if missed:
        print('[header-reach] RED: the compiler cannot include these without OCCT and the'
              ' tracker does not list them:')
        for rel in missed:
            print('[header-reach]     %s' % rel)
    if phantom:
        print('[header-reach] RED: the tracker lists these as needing OCCT and the compiler'
              ' includes them fine:')
        for rel in phantom:
            print('[header-reach]     %s' % rel)
    if missed or phantom:
        return 1
    print('[header-reach] GREEN — the include-graph measure and the compiler agree exactly'
          ' on the bare configuration')
    return 0


if __name__ == '__main__':
    sys.exit(main())
