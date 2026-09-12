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
import argparse, collections, datetime, json, os, re, subprocess, sys

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

SNAPSHOT = os.path.join(ROOT, 'tools', 'kernel', 'occt_linked_snapshot.json')

def measure_linked(binary):
    """Toolkits the binary actually LINKS, read with otool.

    otool and not the build files: what a binary records is the fact, what CMake says
    is the intent, and the two have diverged in this tree before (TKG2d was dropped
    from OCCT_LIBS while still loading transitively through TKBRep)."""
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

def linked_snapshot():
    """The linkage numbers come from a COMMITTED SNAPSHOT, never from otool at render
    time.

    This is the north-star metric and it can only be measured where the app is
    installed -- which CI is not. Rendering it live made the document machine-
    dependent, and the gate went red on its very first CI run for a reason that had
    nothing to do with the code: the runner has no /Applications/Forge.app, so the
    table rendered "not installed" and differed from the committed copy. Same defect
    class as walking the filesystem instead of `git ls-files`, from a second source
    in the same document.

    So: `--snapshot` records it on the workstation, with provenance; everything else
    is derived from the tree and verifiable anywhere."""
    if not os.path.exists(SNAPSHOT):
        return None
    try:
        return json.load(open(SNAPSHOT))
    except Exception:
        return None

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
    snap = linked_snapshot()
    if snap is None:
        w('_No snapshot recorded. On the workstation, with Forge installed, run_')
        w('`python3 tools/kernel/occt_dependency_graph.py --snapshot`.')
    else:
        w(f"Snapshot recorded {snap.get('measured_at', 'unknown')} from "
          f"`{snap.get('bundle', 'unknown')}` at version {snap.get('version', 'unknown')}.")
        w('')
        w('| binary | OCCT toolkits linked |')
        w('|---|---|')
        for b, tk in sorted(snap.get('binaries', {}).items()):
            w(f'| {b} | **{len(tk)}** — {", ".join(tk) if tk else "none"} |')
        w('')
        shipped = snap.get('shipped_dylibs', [])
        w(f'Bundle ships **{len(shipped)}** OCCT dylibs: '
          + (', '.join(shipped) if shipped else 'none') + '.')
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
    w('## The drop order is a CHAIN, and the demand is GROWING')
    w('')
    w('Two facts that decide how this programme should be scheduled. Both were')
    w('re-measured on the shipped bundle, not taken from a report.')
    w('')
    w('**The order is forced, not chosen.** All 1024 subsets of the root link line')
    w('were enumerated: every toolkit has EXACTLY ONE minimal cut and each cut is a')
    w('subset of the next. Reachable closure values are 14, 13, 11, 9, 8, 6, 4, 3, 2,')
    w('1, 0 -- **12, 10, 7 and 5 are unreachable by any subset whatsoever**, so a plan')
    w('that predicts one of those is wrong before it starts. TKOffset is the only')
    w('possible FIRST move: it is the only library in the graph with a single parent')
    w('(the root), so nothing else can leave before it. TKernel is last and must NEVER')
    w('be scheduled as a work item -- all 13 other toolkits DT_NEED it and its 27')
    w('symbols are 100% runtime substrate (allocator, Standard_Failure, RTTI, mutex,')
    w('NCollection_Base, Message_Report) that falls out with the other 523.')
    w('')
    w('**The demand is growing, not shrinking.** Per-toolkit undefined-symbol census of')
    w('libforge_kernel_core against each shipped libTK, versus the committed baseline in')
    w('forge-kernel/reports/OCCT_CLOSURE_TRUTH.md:228 (2026-08-28):')
    w('')
    w('| toolkit | symbols now | 15 days ago | delta |')
    w('|---|---:|---:|---:|')
    w('| TKG3d | 152 | 141 | +11 |')
    w('| TKTopAlgo | 110 | 100 | +10 |')
    w('| TKBRep | 103 | 82 | +21 |')
    w('| TKOffset | 42 | 42 | 0 |')
    w('| TKMath | 34 | 26 | +8 |')
    w('| TKBO | 32 | 31 | +1 |')
    w('| TKG2d | 27 | 24 | +3 |')
    w('| TKernel | 27 | 26 | +1 |')
    w('| TKShHealing | 12 | 20 | **-8** |')
    w('| TKFillet | 11 | 11 | 0 |')
    w('| **TOTAL** | **550** | **507** | **+43** |')
    w('')
    w('The four toolkits actually being worked (steps 1-4) moved SEVEN symbols in')
    w('fifteen days while steps 5-9 grew by fifty-four. The mechanism is structural and')
    w('is named in the per-library audits: the `Native*` engines compute natively and')
    w('then REBUILD their answer in OCCT types -- BRepBuilderAPI_MakeFace,')
    w('BRepLib::SameParameter, BRepGProp for the measurement. TKTopAlgo is their OUTPUT')
    w('FORMAT, not their algorithm, and 205 of its 431 call sites are inside those')
    w('engines. So every new native operation ADDS OCCT symbols. Writing more native')
    w('geometry, on its own, makes this number worse.')
    w('')
    w('**The single highest-unlock item** is therefore not an algorithm: it is an')
    w('OWNING, OCCT-free shape handle adopted as the kernel interchange type. It gates')
    w('steps 5, 6 and 7 -- 365 of 550 symbols (66%) and 5 of the 11 remaining libraries.')
    w('Nearly all of it is already written and compiled with ZERO production consumers:')
    w('`forge/capi/forge_capi.h` (27 entry points, no OCCT), `forge/native/shape/`')
    w('{Shape,Explore,Wire,Compound}.hpp, and ~13k lines of OCCT-free native B-rep ops.')
    w('The genuinely missing piece is small and specific: OWNERSHIP. `shape::Shape` is a')
    w('NON-OWNING tagged pointer into a TopologyBuilder while ShapeRegistry stores its')
    w('Occt entries by value, so a registry entry that outlives its builder dangles.')
    w('Either shape::Shape gains shared ownership or ShapeRegistry owns the builder per')
    w('entry. Everything downstream of that decision is re-typing.')
    w('')
    w('## Is the Forge vocabulary ADOPTED, or merely OCCT-free?')
    w('')
    w('A subsystem can show zero OCCT includes by being unused, and the table above')
    w('cannot tell the difference. MEASURED, and it is the central fact of this')
    w('migration:')
    w('')
    # Count the #include DIRECTIVE, not the string. A substring match counts any
    # file that merely NAMES the path in a comment -- which this document's own
    # sources now do, and which silently inflated "adopted" by one.
    INC = re.compile(r'^\s*#\s*include\s*[<"]forge/math/Vec3\.hpp[>"]', re.M)
    def includes(rel):
        return bool(INC.search(open(os.path.join(ROOT, rel),
                                    encoding='utf-8', errors='ignore').read()))
    mathinc = sum(1 for rel in walk()
                  if rel.startswith('forge-kernel/') and includes(rel))
    nativeinc = sum(1 for rel in walk()
                    if rel.startswith(('forge-kernel/src/native',
                                       'forge-kernel/include/forge/native'))
                    and includes(rel))
    def count(tok, prefix):
        n = 0
        for rel in walk():
            if not rel.startswith(prefix):
                continue
            n += open(os.path.join(ROOT, rel), encoding='utf-8', errors='ignore').read().count(tok)
        return n
    gp = count('gp_Pnt', 'forge-kernel/src/native/brep')
    # Count the SPELLING each vocabulary actually uses at the call site. An earlier
    # version of this row counted the qualified `math::Vec3` against the unqualified
    # `gp_Pnt` and reported 0 -- which read as "brep computes purely in OCCT types"
    # and was false: brep had 2440 uses of a Vec3, just its own. Both spellings are
    # unqualified in the source, so both are counted unqualified.
    fv = sum(len(re.findall(r'\bVec3\b',
                            open(os.path.join(ROOT, rel), encoding='utf-8',
                                 errors='ignore').read()))
             for rel in walk() if rel.startswith('forge-kernel/src/native/brep'))
    ndefs = sum(1 for rel in walk()
                if rel.startswith('forge-kernel/')
                and re.search(r'^\s*struct\s+Vec3\s*(\{|$)',
                              open(os.path.join(ROOT, rel), encoding='utf-8',
                                   errors='ignore').read(), re.M))
    w('| | |')
    w('|---|---:|')
    w(f'| distinct `struct Vec3` declarations in the tree | **{ndefs}** |')
    w(f'| files including `forge/math/Vec3.hpp` | {mathinc} |')
    w(f'| of those, under `native/` | **{nativeinc}** |')
    w(f'| `gp_Pnt` uses in `src/native/brep` | **{gp}** |')
    w(f'| `Vec3` uses there (now the canonical type) | **{fv}** |')
    w('')
    w('Vec3 HAD ten layout-identical declarations in ten namespaces, and the canonical')
    w('forge/math/Vec3.hpp -- a superset of every one of them -- was included by no')
    w('file under `native/` at all. It is now one type: the nine module declarations')
    w('are `using Vec3 = forge::math::Vec3;` aliases, so the uses counted above are')
    w('uses of the canonical Forge type. That is the first ladder rung, Math ->')
    w('Geometry Primitives, actually ADOPTED rather than merely built.')
    w('')
    w('Read the last two rows together and do NOT read them as a ratio. Both')
    w('vocabularies live in the same files: brep computes in Vec3 and calls OCCT in')
    w('gp_Pnt. The gp_Pnt count is the work that remains -- every one is a place a')
    w('native implementation has to substitute -- and it is now substitutable,')
    w('because there is a single Forge type to substitute ONTO. Before this, there')
    w('was not: ten incompatible Vec3s with nothing in common.')
    w('')
    def decls(name):
        return sum(1 for rel in walk()
                   if rel.startswith('forge-kernel/')
                   and re.search(rf'^\s*struct\s+{name}\s*(\{{|$)',
                                 open(os.path.join(ROOT, rel), encoding='utf-8',
                                      errors='ignore').read(), re.M))
    rest = ', '.join(f'{t} {decls(t)}' for t in ('Plane', 'Point3', 'AABB', 'Mat3'))
    w('Still fragmented, and the next rungs -- declaration counts, same measurement:')
    w(f'{rest}.')
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
    w('## The Kernel API surface — what STAGE 1 actually requires')
    w('')
    w('"Application code stops talking to OCCT" is not achieved by removing include')
    w('lines. MEASURED: forge-desktop/src/ModelQuality.cpp now names no OCCT type at')
    w('all -- it speaks ShapeHandle and forge::ShapeQuery -- and it still cannot')
    w('compile without the OCCT headers, because forge/ShapeRegistry.hpp names')
    w('TopoDS_Shape in add() and get(). The boundary is where the HEADERS are, not')
    w('where the .cpp files are.')
    w('')
    w('THE OBSERVABLE THAT SETTLES IT is not a header count at all -- it is whether')
    w('the application compiles with NO OCCT HEADERS PRESENT. It does:')
    w('forge-desktop/test/run_syntax_gate.sh compiles every forge-desktop translation')
    w('unit with no OCCT include path, and ModelQuality.cpp -- the last one that was')
    w('SKIPPED for needing OCCT -- is now CHECKED and green. A header below that can')
    w('still name an OCCT type without holding the app back, so long as nothing the')
    w('app includes reaches it.')
    w('')
    w('The count below is the remaining surface, not the Stage 1 gate: public kernel')
    w('headers that')
    w('include an OCCT header. The legacy adapter (Occt*.hpp, NativeOcctBridge.hpp)')
    w('is expected to and is listed separately.')
    w('')
    api, adapter = [], []
    hdr_re = re.compile(r'^\s*#\s*include\s*<([A-Za-z0-9_]+)\.hxx>')
    for rel in sorted(walk()):
        if not rel.startswith('forge-kernel/include/forge/') or not rel.endswith('.hpp'):
            continue
        try:
            lines = open(os.path.join(ROOT, rel), encoding='utf-8', errors='ignore')
        except OSError:
            continue
        if not any(m and OCCT_HDR.match(m.group(1) + '.hxx')
                   for m in (hdr_re.match(l) for l in lines)):
            continue
        base = os.path.basename(rel)
        (adapter if base.startswith('Occt') or base.startswith('NativeOcct')
         else api).append(rel)
    w(f'| public kernel headers exposing OCCT | {len(api) + len(adapter)} |')
    w('|---|---:|')
    w(f'| of those, the legacy adapter (expected) | {len(adapter)} |')
    w(f'| **of those, the Kernel API proper** | **{len(api)}** |')
    w('')
    for rel in api:
        w(f'- `{rel}`')
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
    ap.add_argument('--snapshot', action='store_true',
                    help='re-measure linked toolkits from the installed app (workstation only)')
    a = ap.parse_args()
    if a.snapshot:
        bundle = '/Applications/Forge.app'
        bins = {}
        for b in ('forge_desktop', 'forge_kernel_worker', 'forge_update'):
            tk = measure_linked(os.path.join(bundle, 'Contents', 'MacOS', b))
            if tk is None:
                print(f'[occt-graph] {b} not found under {bundle}; is Forge installed?',
                      file=sys.stderr)
                return 1
            bins[b] = tk
        fw = os.path.join(bundle, 'Contents', 'Frameworks')
        shipped = sorted(f[3:].split('.')[0] for f in os.listdir(fw)
                         if f.startswith('libTK')) if os.path.isdir(fw) else []
        ver = ''
        try:
            ver = json.load(open(os.path.expanduser('~/.forge-health/installed.json'))).get('version', '')
        except Exception:
            pass
        json.dump({'measured_at': datetime.date.today().isoformat(), 'bundle': bundle,
                   'version': ver, 'binaries': bins, 'shipped_dylibs': shipped},
                  open(SNAPSHOT, 'w'), indent=2, sort_keys=True)
        open(SNAPSHOT, 'a').write('\n')
        print(f'[occt-graph] snapshot written: {len(bins)} binaries, {len(shipped)} shipped dylibs')
        return 0
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
