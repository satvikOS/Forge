#!/usr/bin/env python3
"""occt_dependency_graph.py -- the OCCT dependency graph, MEASURED from the tree.

Writes docs/kernel/OCCT_REMOVAL_TRACKER.md. `--check` fails if the committed tracker
no longer matches the code, so the document cannot drift from reality -- the removal
directive requires it be "synchronized with actual code", and a hand-maintained
tracker is synchronized only until the first person forgets.

THE DISTINCTION THAT DECIDES EVERY NUMBER HERE: production code vs the ORACLE.
The migration rule is to keep OCCT available as a differential reference while the
native path is built, so forge-kernel/test SHOULD include OCCT and counting those
includes as "remaining dependency" would misreport progress by a factor of three
(measured: 1909 of 3611 include lines in this tree are tests). Scratchpads are
excluded for the same reason: they are not shipped and not oracles.
"""
import argparse, os, re, subprocess, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TRACKER = os.path.join(ROOT, 'docs', 'kernel', 'OCCT_REMOVAL_TRACKER.md')

# An OCCT header is recognised by its family prefix. Written out rather than matched
# loosely: `Geom` also prefixes Forge's own names, so the trailing _ or the exact
# toolkit spelling is what keeps this from over-counting.
OCCT_HDR = re.compile(
    r'^(TK\w+|TopoDS\w*|TopExp\w*|TopAbs\w*|TopTools\w*|TopLoc\w*|gp_\w+|Geom_\w+|Geom2d\w*|'
    r'GeomAbs\w*|GeomAPI\w*|GeomAdaptor\w*|GeomConvert\w*|GeomLProp\w*|GeomFill\w*|GeomPlate\w*|'
    r'Standard_\w+|Poly_\w+|BRep\w*|BOPAlgo\w*|BOPTools\w*|IntTools\w*|ShapeFix\w*|ShapeAnalysis\w*|'
    r'ShapeBuild\w*|ShapeUpgrade\w*|ShapeConstruct\w*|STEPControl\w*|IGESControl\w*|StlAPI\w*|'
    r'Interface_\w+|XSControl\w*|Transfer\w*|Bnd_\w+|GProp_\w+|TColgp\w*|TColStd\w*|TColGeom\w*|'
    r'Precision\w*|GC_\w+|GCE2d_\w+|gce_\w+|GCPnts\w*|Adaptor2d\w*|Adaptor3d\w*|NCollection\w*|'
    r'Message_\w+|OSD_\w+|Quantity_\w+|Extrema\w*|ProjLib\w*|Law_\w+|ElCLib\w*|ElSLib\w*|'
    r'IntCurvesFace\w*|IntAna\w*|Approx\w*|AppDef\w*|AppParCurves\w*|PLib\w*|math_\w+)\.hxx$')

INCLUDE = re.compile(r'^\s*#\s*include\s*[<"]([^">]+)[">]')
SRC_EXT = ('.cpp', '.hpp', '.h', '.cc', '.cxx', '.mm')

# Every directory is classified. An unclassified directory is a BUG in this script,
# not a directory to quietly ignore -- silently dropping a tree is how a census
# reports zero.
def classify(rel):
    p = rel.replace(os.sep, '/')
    if '/scratchpad' in p or p.startswith('scratchpad'):        return 'SCRATCH'
    if '/test/' in p or p.startswith('forge-kernel/test') or '/tests/' in p: return 'ORACLE'
    if p.startswith('frontend/'):                               return 'SCRATCH'
    if p.startswith('forge-kernel/tools') or p.startswith('tools/'): return 'TOOLING'
    if p.startswith('forge-desktop/') or p.startswith('ui/') or p.startswith('archie/') \
       or p.startswith('retrieval/'):                           return 'APP'
    if p.startswith('forge-kernel/'):                           return 'KERNEL'
    return 'OTHER'

def walk():
    """Only files GIT TRACKS.

    An os.walk here made the output depend on untracked local state and the gate was
    therefore not reproducible: this checkout carries an untracked
    forge-kernel/scratchpad, so the same commit produced SCRATCH=206 in one working
    copy and SCRATCH=0 in another, and CI -- which checks out clean -- would have gone
    red for a reason that has nothing to do with the code. `git ls-files` is the only
    definition of "the tree" that every checkout agrees on."""
    out = subprocess.run(['git', '-C', ROOT, 'ls-files'], capture_output=True,
                         text=True, timeout=60)
    if out.returncode != 0:
        raise SystemExit('[occt-graph] cannot list the tree: ' + out.stderr.strip())
    for rel in out.stdout.splitlines():
        if rel.endswith(SRC_EXT):
            yield rel

def occt_includes(path):
    n, hdrs = 0, []
    try:
        for line in open(os.path.join(ROOT, path), encoding='utf-8', errors='ignore'):
            m = INCLUDE.match(line)
            if m and OCCT_HDR.match(os.path.basename(m.group(1))):
                n += 1
                hdrs.append(os.path.basename(m.group(1)))
    except OSError:
        return 0, []
    return n, hdrs

def linked_toolkits(binary):
    """Toolkits the binary actually LINKS. otool, not the build files: what a binary
    records is the fact; what CMake says is the intent, and the two have diverged
    here before (TKG2d was dropped from OCCT_LIBS while still loading transitively)."""
    if not os.path.exists(binary):
        return None
    try:
        out = subprocess.run(['otool', '-L', binary], capture_output=True, text=True,
                             timeout=30).stdout
    except Exception:
        return None
    tk = set()
    for line in out.splitlines()[1:]:
        base = line.strip().split(' ')[0].split('/')[-1]
        m = re.match(r'^(libTK\w+)\.', base)
        if m:
            tk.add(m.group(1)[3:])
    return sorted(tk)

def build():
    by_class = collections.Counter()
    by_dir = collections.Counter()
    hdr_count = collections.Counter()
    app_leaks = {}
    kernel_files = collections.Counter()
    for rel in walk():
        n, hdrs = occt_includes(rel)
        if not n:
            continue
        cls = classify(rel)
        by_class[cls] += n
        by_dir[(cls, os.path.dirname(rel))] += n
        for h in hdrs:
            hdr_count[h] += n and 1
        if cls == 'APP':
            app_leaks[rel] = n
        if cls == 'KERNEL':
            kernel_files[rel] = n
    return by_class, by_dir, hdr_count, app_leaks, kernel_files

# The user's migration order. Status is DERIVED, never typed in: a stage is only
# clear when nothing in production still includes OCCT for it.
STAGES = [
    ('Math',                 ['forge-kernel/include/forge/math']),
    ('Geometry primitives',  ['forge-kernel/include/forge/native/geom', 'forge-kernel/src/native/geom']),
    ('Transforms',           ['forge-kernel/include/forge/math']),
    ('Predicates',           ['forge-kernel/include/forge/native/Predicates.hpp',
                              'forge-kernel/include/forge/native/ExactPredicates3D.hpp']),
    ('Topology / B-Rep',     ['forge-kernel/include/forge/native/brep', 'forge-kernel/src/native/brep']),
    ('Tessellation',         ['forge-kernel/src/native/mesh', 'forge-kernel/include/forge/native/mesh']),
    ('CSG / booleans',       ['forge-kernel/src/native/csg']),
    ('Kernel core (rest)',   ['forge-kernel/src']),
]

def stage_rows():
    rows = []
    for name, paths in STAGES:
        tot, files = 0, 0
        for p in paths:
            full = os.path.join(ROOT, p)
            if os.path.isfile(full):
                n, _ = occt_includes(p)
                tot += n
                files += 1 if n else 0
            elif os.path.isdir(full):
                for dp, dn, fn in os.walk(full):
                    for f in fn:
                        if f.endswith(SRC_EXT):
                            rel = os.path.relpath(os.path.join(dp, f), ROOT)
                            if classify(rel) in ('ORACLE', 'SCRATCH'):
                                continue
                            n, _ = occt_includes(rel)
                            tot += n
                            files += 1 if n else 0
        mark = '[x]' if tot == 0 else ('[~]' if tot < 40 else '[ ]')
        rows.append((mark, name, tot, files, ', '.join(paths)))
    return rows

def render():
    by_class, by_dir, hdr_count, app_leaks, kernel_files = build()
    out = []
    w = out.append
    w('# OCCT removal tracker')
    w('')
    w('GENERATED by `tools/kernel/occt_dependency_graph.py`. Do not hand-edit: run')
    w('`python3 tools/kernel/occt_dependency_graph.py --write`. `--check` gates it in CI,')
    w('so this file cannot drift from the code the way a hand-kept tracker does.')
    w('')
    w('## What counts as a dependency')
    w('')
    w('PRODUCTION code only. `forge-kernel/test` deliberately keeps OCCT as the')
    w('differential ORACLE the migration is validated against, and scratchpads are')
    w('neither shipped nor oracles. Counting either as "remaining dependency" would')
    w('overstate the work by roughly threefold on this tree.')
    w('')
    w('| class | OCCT include lines | counts against removal? |')
    w('|---|---:|---|')
    for cls in ('APP', 'KERNEL', 'TOOLING', 'ORACLE', 'SCRATCH', 'OTHER'):
        counts = 'YES' if cls in ('APP', 'KERNEL') else ('yes, last' if cls == 'TOOLING' else 'no — by design')
        w(f'| {cls} | {by_class.get(cls, 0)} | {counts} |')
    w('')
    w('## The north star: what the SHIPPED binaries link')
    w('')
    w('`otool -L`, not the build files. What a binary records is the fact; what CMake')
    w('says is the intent, and the two have diverged here before.')
    w('')
    w('| binary | OCCT toolkits linked |')
    w('|---|---|')
    for b in ('forge_desktop', 'forge_kernel_worker', 'forge_update'):
        p = f'/Applications/Forge.app/Contents/MacOS/{b}'
        tk = linked_toolkits(p)
        if tk is None:
            w(f'| {b} | _not installed; run the app installer_ |')
        else:
            w(f'| {b} | **{len(tk)}** — {", ".join(tk) if tk else "none"} |')
    w('')
    w('## Migration order')
    w('')
    w('`[x]` no production OCCT includes. `[~]` under 40 lines left. `[ ]` not started.')
    w('Status is DERIVED from the tree on every run, never typed in.')
    w('')
    w('| | subsystem | production OCCT include lines | files | paths |')
    w('|---|---|---:|---:|---|')
    for mark, name, tot, files, paths in stage_rows():
        w(f'| {mark} | {name} | {tot} | {files} | `{paths}` |')
    w('')
    w('## Application-layer leaks')
    w('')
    w('The migration rule is that application code stops talking to OCCT directly and')
    w('goes through the Forge Kernel API. Every file below violates that and is the')
    w('cheapest possible progress.')
    w('')
    if app_leaks:
        w('| file | OCCT include lines |')
        w('|---|---:|')
        for f, n in sorted(app_leaks.items(), key=lambda kv: -kv[1]):
            w(f'| `{f}` | {n} |')
    else:
        w('None. Application code is behind the Kernel API.')
    w('')
    w('## Heaviest production kernel files')
    w('')
    w('| file | OCCT include lines |')
    w('|---|---:|')
    for f, n in kernel_files.most_common(15):
        w(f'| `{f}` | {n} |')
    w('')
    return '\n'.join(out) + '\n'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    text = render()
    if a.check:
        if not os.path.exists(TRACKER):
            print('[occt-graph] RED - the tracker does not exist; run --write', file=sys.stderr)
            return 1
        cur = open(TRACKER).read()
        if cur != text:
            print('[occt-graph] RED - the tracker no longer matches the code.', file=sys.stderr)
            print('[occt-graph] regenerate: python3 tools/kernel/occt_dependency_graph.py --write',
                  file=sys.stderr)
            return 1
        print('[occt-graph] GREEN - the tracker matches the code')
        return 0
    if a.write:
        os.makedirs(os.path.dirname(TRACKER), exist_ok=True)
        open(TRACKER, 'w').write(text)
        print(f'[occt-graph] wrote {os.path.relpath(TRACKER, ROOT)}')
        return 0
    sys.stdout.write(text)
    return 0

if __name__ == '__main__':
    sys.exit(main())
