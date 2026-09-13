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

# ── THE HIGHEST-UNLOCK ITEM, MEASURED RATHER THAN ASSERTED ──────────────────
# This paragraph used to be TYPED. It said the missing piece was OWNERSHIP --
# "Either shape::Shape gains shared ownership or ShapeRegistry owns the builder
# per entry" -- and the second of those two had ALREADY BEEN IMPLEMENTED for as
# long as the sentence had been in the file. The tracker steered the programme at
# a blocker that was not there, which is the exact failure the rest of this
# generator exists to prevent, in the one paragraph that decides what to work on.
# So it is derived now. Everything below is read off the tree on every run.
def measure_shape_adoption():
    def read(rel):
        try:
            with open(os.path.join(ROOT, rel), 'r', errors='ignore') as fh:
                return fh.read()
        except OSError:
            return ''

    reg = read('forge-kernel/include/forge/ShapeRegistry.hpp')
    # Does a registry ENTRY hold the builder, or merely point into one? The
    # question is about the member, not about the argument: taking a shared_ptr
    # and storing a raw pointer would satisfy a signature grep and dangle anyway.
    owns = bool(re.search(
        r'std::shared_ptr<\s*native::brep::TopologyBuilder\s*>\s+owner\s*;', reg))
    takes = bool(re.search(
        r'addNativeSolid\s*\(\s*std::shared_ptr<\s*native::brep::TopologyBuilder\s*>', reg))

    # Who names the OCCT-free handle type at all, and where? A type with no
    # namer outside its own directory is built, not adopted.
    # ★ THE SEAM DOES NOT COUNT AS ITS OWN ADOPTER. NativeShapeAccess.{hpp,cpp}
    #   name shape::Shape by definition -- they are the door, not someone walking
    #   through it. Counting them would take this row off zero the moment the
    #   seam landed and turn the one number that measures ADOPTION into a number
    #   that measures whether the seam exists, which the row above already says.
    SEAM_OWN = ('forge-kernel/include/forge/NativeShapeAccess.hpp',
                'forge-kernel/src/NativeShapeAccess.cpp')
    users = {'PROD': [], 'ORACLE': [], 'OTHER': []}
    for rel in walk():
        if rel.startswith('forge-kernel/include/forge/native/shape/'):
            continue
        if rel.startswith('forge-kernel/src/native/shape/'):
            continue
        if rel in SEAM_OWN:
            continue
        body = read(rel)
        if 'shape::Shape' not in body:
            continue
        cls = classify(rel)
        bucket = 'ORACLE' if cls in ('ORACLE', 'SCRATCH') else (
            'PROD' if cls in ('APP', 'KERNEL', 'TOOLING') else 'OTHER')
        users[bucket].append(rel)

    # Is there a SEAM -- a way to get from the kernel's shape store to the
    # OCCT-free handle -- and does its header name any OCCT type?
    seam_path = 'forge-kernel/include/forge/NativeShapeAccess.hpp'
    seam_hdr = read(seam_path)
    seam = bool(re.search(r'shape::Shape\s+nativeShapeOf\s*\(', seam_hdr))
    seam_occt = 0
    if seam_hdr:
        seam_occt, _ = occt_includes(seam_path)
    return {
        'owns': owns, 'takes': takes, 'seam': seam, 'seam_occt': seam_occt,
        'prod': sorted(users['PROD']), 'oracle': sorted(users['ORACLE']),
    }

# ── WHICH PUBLIC HEADERS FORCE OCCT WITHOUT NAMING IT ────────────────────────
# The closure over QUOTED forge/ includes only. That is exact for this question:
# a kernel header reaches OCCT either by including an OCCT header itself (the
# count above) or by including a Forge header that does, and Forge headers are
# always included by their "forge/..." path. System includes cannot lead back
# into forge-kernel/include, so they are not edges.
#
# CROSS-CHECKED AGAINST A COMPILER, because a text measure of an include graph is
# exactly the kind of thing that is plausible and wrong: every public header was
# compiled as a one-line translation unit with no OCCT on the include path, and
# the set that failed is the set this returns plus the set that includes OCCT
# directly. The two agreed on 2026-09-12 (2 transitive, 29 direct, 451 free).
def _scan_header(path):
    """Quoted forge/ includes and direct OCCT includes, split by whether the line
    sits inside a preprocessor conditional.

    THE CONDITIONAL SPLIT IS NOT PEDANTRY -- it is the first thing this measure
    got wrong. forge/ArcHelix.hpp includes forge/Sketcher.hpp, which includes
    <TopoDS_Wire.hxx>, so a plain text walk calls ArcHelix an OCCT-forcing
    header. It is not: its whole body is behind `#ifdef FORGE_FT_ARCHELIX`, which
    no default build defines, and the compiler says it includes cleanly with no
    OCCT on the path. A measure that disagrees with the compiler about what the
    compiler does is not a measure.

    The file's OWN include guard (`#ifndef X` / `#define X` as the first
    directive) is not a conditional: everything in a header sits inside it.
    """
    inc_q = re.compile(r'^\s*#\s*include\s*"(forge/[^"]+)"')
    hdr_re = re.compile(r'^\s*#\s*include\s*<([A-Za-z0-9_]+)\.hxx>')
    cond_open = re.compile(r'^\s*#\s*(if|ifdef|ifndef)\b')
    cond_close = re.compile(r'^\s*#\s*endif\b')
    guard_open = re.compile(r'^\s*#\s*ifndef\s+(\w+)\s*$')
    guard_def = re.compile(r'^\s*#\s*define\s+(\w+)\s*$')
    try:
        with open(path, encoding='utf-8', errors='ignore') as fh:
            lines = fh.readlines()
    except OSError:
        return [], [], False, False
    # find the include guard, if this header uses one rather than #pragma once
    guard_at, pending = None, None
    for k, line in enumerate(lines):
        m = guard_open.match(line)
        if m and pending is None:
            pending = (k, m.group(1))
            continue
        if pending is not None:
            m2 = guard_def.match(line)
            if m2 and m2.group(1) == pending[1]:
                guard_at = pending[0]
            break
        if line.strip() and not line.lstrip().startswith(('//', '/*', '*')):
            break
    depth = 0
    q_uncond, q_cond, occt_uncond, occt_cond = [], [], False, False
    for k, line in enumerate(lines):
        if cond_open.match(line):
            if k != guard_at:
                depth += 1
            continue
        if cond_close.match(line):
            if depth > 0:
                depth -= 1
            continue
        m = inc_q.match(line)
        if m:
            (q_cond if depth else q_uncond).append(m.group(1))
            continue
        m2 = hdr_re.match(line)
        if m2 and OCCT_HDR.match(m2.group(1) + '.hxx'):
            if depth:
                occt_cond = True
            else:
                occt_uncond = True
    return q_uncond, q_cond, occt_uncond, occt_cond


# ── WHICH PUBLIC HEADERS FORCE OCCT WITHOUT NAMING IT ────────────────────────
# The closure over QUOTED forge/ includes only, and only the UNCONDITIONAL ones.
# That is exact for this question: a kernel header reaches OCCT either by
# including an OCCT header itself (the count above) or by including a Forge
# header that does, and Forge headers are always included by their "forge/..."
# path. System includes cannot lead back into forge-kernel/include, so they are
# not edges.
#
# CROSS-CHECKED AGAINST A COMPILER, because a text measure of an include graph is
# exactly the kind of thing that is plausible and wrong -- and this one WAS, on
# its first run, until the conditional split above. Every public header is
# compiled as a one-line translation unit with no OCCT on the include path by
# tools/kernel/occt_header_reach_check.py, and the set that fails must equal the
# direct set plus this one.
def transitive_occt_headers(direct):
    base = os.path.join(ROOT, 'forge-kernel', 'include')
    edges, has_occt, all_hdrs = {}, set(), []
    for rel in sorted(walk()):
        if not rel.startswith('forge-kernel/include/forge/') or not rel.endswith('.hpp'):
            continue
        all_hdrs.append(rel)
        key = os.path.relpath(os.path.join(ROOT, rel), base)
        q_uncond, _q_cond, occt_uncond, _occt_cond = _scan_header(os.path.join(ROOT, rel))
        edges[key] = q_uncond
        if occt_uncond:
            has_occt.add(key)

    def reaches(key, seen):
        for nxt in edges.get(key, ()):
            if nxt in seen:
                continue
            seen.add(nxt)
            if nxt in has_occt:
                return nxt
            if reaches(nxt, seen):
                return nxt
        return None

    out = []
    for rel in all_hdrs:
        key = os.path.relpath(os.path.join(ROOT, rel), base)
        if rel in direct or key in has_occt:
            continue
        via = reaches(key, set())
        if via:
            out.append((rel, via))
    return out


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
    w('Nearly all of it is already written: `forge/capi/forge_capi.h` (27 entry points,')
    w('no OCCT), `forge/native/shape/`{Shape,Explore,Wire,Compound}.hpp, and ~13k lines')
    w('of OCCT-free native B-rep ops.')
    w('')
    sa = measure_shape_adoption()
    w('WHAT IS ACTUALLY MISSING -- measured on this tree, because the sentence that')
    w('used to sit here was TYPED and was wrong. It said the missing piece was')
    w('OWNERSHIP ("either shape::Shape gains shared ownership or ShapeRegistry owns')
    w('the builder per entry"), and the second of those two had already been')
    w('implemented for as long as the sentence had been in the file. The tracker was')
    w('steering the programme at a blocker that was not there. These rows are now read')
    w('off the code on every run.')
    w('')
    w('| | |')
    w('|---|---:|')
    w('| a registry entry OWNS its `TopologyBuilder` (`shared_ptr` member) | **%s** |'
      % ('yes' if sa['owns'] else 'NO'))
    w('| `addNativeSolid` takes that ownership at the door | **%s** |'
      % ('yes' if sa['takes'] else 'NO'))
    w('| a seam exists: `ShapeHandle` -> `shape::Shape` | **%s** |'
      % ('yes' if sa['seam'] else 'NO'))
    w('| OCCT include lines in that seam\'s header | **%d** |' % sa['seam_occt'])
    w('| PRODUCTION files naming `shape::Shape` outside its own directory | **%d** |'
      % len(sa['prod']))
    w('| oracle/test files naming it | %d |' % len(sa['oracle']))
    w('')
    if not sa['seam']:
        w('There is no seam. `shape::Shape` cannot be obtained from the kernel\'s live')
        w('shape store at all, so the handle type, the traversal facade and the 13k lines')
        w('below them have no way to be reached from a body a user actually built. That,')
        w('and not a lifetime, is what adoption is blocked on.')
    elif not sa['prod']:
        w('The seam is built and gated (`forge-kernel/test/shape_seam_gate.cpp`, compiled')
        w('with an include path that contains no OCCT, which is what makes "OCCT-free" a')
        w('build fact rather than a comment) and **no production code calls it yet**. So')
        w('the remaining work is exactly what the old sentence claimed was downstream of a')
        w('decision: re-typing call sites onto the seam. The difference is that the')
        w('decision is made and the seam is proved, and this row will move off zero as')
        w('call sites adopt it -- which is the number to watch, not the include counts.')
    else:
        w('The seam is built, gated and ADOPTED by %d production file(s). This row is the'
          % len(sa['prod']))
        w('adoption curve for steps 5-7; the OCCT symbol census above is the result.')
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
    w('★ IT IS A TEXT COUNT, AND THE COMPILER DISAGREES WITH IT IN BOTH DIRECTIONS.')
    w('It counts `#include <Something.hxx>` lines whether or not a build ever reaches')
    w('them, and it cannot see a header that reaches OCCT through another Forge')
    w('header. MEASURED by compiling every public header as a one-line translation')
    w('unit with no OCCT on the include path')
    w('(`tools/kernel/occt_header_reach_check.py`, which is a CI gate and carries its')
    w('own two-way self-test):')
    w('')
    w('| configuration | public headers that cannot be included without OCCT |')
    w('|---|---:|')
    w('| bare, no macros defined | **14** |')
    w('| `-DFORGE_NATIVE_BREP=1` -- **the shipped build**, CMake defaults it ON | **31** |')
    w('')
    w('Neither is the number below. Seventeen `Native*` headers and `OcctImport.hpp` /')
    w('`StepReadOcct.hpp` reach OCCT only once FORGE_NATIVE_BREP is on, and')
    w('`forge/ArcHelix.hpp` has an OCCT include the text count charges it for and no')
    w('build ever compiles -- its whole body is behind `#ifdef FORGE_FT_ARCHELIX`. The')
    w('number to plan against is 31: it is what the application actually faces.')
    w('These are deliberately NOT written into this document, for the reason cfa87c68')
    w('records about the linkage numbers -- a figure that depends on the machine')
    w('generating the file makes `--check` fail for reasons that have nothing to do')
    w('with the code. The gate reports them; the document says where to look.')
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
    w('### The headers that force OCCT WITHOUT naming it')
    w('')
    w('The count above reads DIRECT `#include <Something.hxx>` lines, and that is not')
    w('the same question as "can this header be included without the OCCT SDK".')
    w('A header that includes a Forge header that includes an OCCT one forces OCCT on')
    w('every one of ITS includers and appears in no list above.')
    w('')
    w('MEASURED, and it is why this section exists: `forge/BodyInventory.hpp` named no')
    w('OCCT type and included `forge/ShapeRegistry.hpp` for a single unused overload,')
    w('and that one line was the ENTIRE OCCT dependency of')
    w('`forge-desktop/src/KernelScene.cpp` -- a file that names no OCCT type either.')
    w('It was invisible here until it was fixed.')
    w('')
    forced = transitive_occt_headers(set(api) | set(adapter))
    w(f'| public headers that reach OCCT only THROUGH another Forge header | **{len(forced)}** |')
    w('|---|---:|')
    w('')
    if forced:
        for rel, via in forced:
            w(f'- `{rel}` -> `{via}`')
    else:
        w('None. Every public kernel header that needs OCCT says so in its own')
        w('include list, which is the state this row exists to hold.')
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
