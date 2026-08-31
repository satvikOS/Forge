#!/usr/bin/env python3
"""occt_toolkit_map.py -- the TOOLKIT ELIMINATION MAP, measured from built artefacts.

WHY THIS EXISTS
---------------
scripts/occt_closure_count.sh answers "how many OCCT libraries load?" (the ledger
number). It does NOT answer "what has to land before each one stops loading?" -- and
because the ledger is a CLOSURE, that second question is the one that orders the work.
A toolkit keeps loading while ANY live call site needs it, directly or through another
toolkit, so driving one family to parity can move OCCT_CLOSURE by exactly zero.

This script produces the map: per toolkit, who pulls it, which translation units call
it, and therefore which families must ALL land before it leaves.

METHOD -- two stages, with DIFFERENT evidential status. Do not conflate them.
  1. ATTRIBUTION (measured, `nm`). For every object file in the build, `nm -u`
     (undefined symbols) is intersected with `nm -gU` (exports) of each closure dylib.
     A TU pulls toolkit TKX iff it references a symbol that ONLY TKX exports among the
     closure toolkits -- the same exclusivity rule scripts/occt_drop_gate.sh uses to
     decide drop safety. This is the load-bearing claim.
  2. LOCATION (`grep`). The OWNING class of each symbol is read out of the Itanium
     mangling by its <length><name> rule -- the FIRST source-name component is the
     nested-name qualifier, i.e. the class the symbol belongs to. Later components are
     PARAMETER types (a TopoDS_Edge argument does not make a TU a TopoDS_Edge call
     site) and are discarded. The class is then located by name in the TU.

Where stage 2 finds no line -- symbol emitted from a header or template, class reached
through a typedef -- the call site is reported UNDETERMINED. It is never guessed.

The DT_NEEDED graph among the toolkits comes from `otool -l` on the OCCT dylibs
themselves, which is what makes the elimination ORDER exact: a toolkit can only leave
when nothing still in the closure pulls it, so the closure falls from the top of the
DAG and no amount of native work reorders that.

usage:
    python3 scripts/occt_toolkit_map.py [--kroot DIR] [--json OUT] [--quiet]

exit: 0 ok / 2 a binary, object dir, or OCCT toolkit could not be located (a partial
      graph would fabricate an elimination order, so this is never a soft failure).
"""
import argparse, collections, glob, json, os, re, subprocess, sys

AP = argparse.ArgumentParser()
AP.add_argument("--kroot", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
AP.add_argument("--json")
AP.add_argument("--quiet", action="store_true")
A = AP.parse_args()

KROOT = os.path.abspath(A.kroot)
NODE = os.environ.get("FORGE_KERNEL", os.path.join(KROOT, "build/Release/forge-kernel.node"))
# Objects are taken from the SAME build tree as the binary, never a fixed path: pointing
# FORGE_KERNEL at a variant build while reading the default build's objects would attribute
# one arm's call sites to the other arm's closure -- silently, and in the flattering direction.
OBJDIR = os.path.normpath(os.path.join(os.path.dirname(NODE), "..", "CMakeFiles", "forge_kernel.dir"))


def die(msg):
    print("FATAL: %s" % msg, file=sys.stderr)
    sys.exit(2)


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout


if not os.path.isfile(NODE):
    die("binary not found: %s (build first: npm run forge:kernel)" % NODE)
if not os.path.isdir(OBJDIR):
    die("object dir not found: %s" % OBJDIR)

# ---- 1. the closure, straight from the authority script ----------------------
raw = run(["bash", os.path.join(KROOT, "scripts/occt_closure_count.sh"), NODE, "--json"])
try:
    meta = json.loads(raw)
except ValueError:
    die("occt_closure_count.sh did not return JSON; run it directly to see the error")
closure, direct = meta["closure_libs"], set(meta["direct_libs"])

SEARCH = [os.environ.get("OCCT_LIB_DIR", ""), "/opt/homebrew/opt/opencascade/lib",
          "/opt/homebrew/lib", "/usr/local/opt/opencascade/lib", "/usr/local/lib",
          "/usr/lib/x86_64-linux-gnu"]
EXT = ("dylib", "so")


def locate(tk):
    for d in SEARCH:
        if not d:
            continue
        for e in EXT:
            g = sorted(glob.glob(os.path.join(d, "lib%s.*%s*" % (tk, e))))
            if g:
                return g[0]
    die("cannot locate lib%s -- a partial graph would fabricate an order" % tk)


def exports_of(lib):
    s = set()
    for line in run(["nm", "-gU", lib]).splitlines():
        p = line.split()
        if len(p) >= 3 and p[1] in ("T", "D", "S", "B"):
            s.add(p[2].lstrip("_"))
    return s


def undef_of(f):
    return {l.strip().lstrip("_") for l in run(["nm", "-u", f]).splitlines() if l.strip()}


libpath = {tk: locate(tk) for tk in closure}
exports = {tk: exports_of(libpath[tk]) for tk in closure}

# ---- 2. exclusivity: sole exporter among the closure -------------------------
owner = collections.defaultdict(list)
for tk in closure:
    for s in exports[tk]:
        owner[s].append(tk)
exclusive = {tk: set() for tk in closure}
for s, tks in owner.items():
    if len(tks) == 1:
        exclusive[tks[0]].add(s)

# ---- 3. the DT_NEEDED graph among the toolkits -------------------------------
LIBRE = re.compile(r"^lib(TK[A-Za-z0-9]*)[.-]")
DEPCMD = ("cmd LC_LOAD_DYLIB", "cmd LC_LOAD_WEAK_DYLIB",
          "cmd LC_REEXPORT_DYLIB", "cmd LC_LOAD_UPWARD_DYLIB")


def deps_of(path):
    want, res = False, []
    for line in run(["otool", "-l", path]).splitlines():
        s = line.strip()
        if s.startswith(DEPCMD):
            want = True
        elif want and s.startswith("name "):
            m = LIBRE.match(os.path.basename(s.split()[1]))
            if m:
                res.append(m.group(1))
            want = False
    return sorted(set(res))


parents = collections.defaultdict(set)
for tk in closure:
    for c in deps_of(libpath[tk]):
        if c in closure:
            parents[c].add(tk)

# ---- 4. attribute every object file ------------------------------------------
objs = sorted(glob.glob(os.path.join(OBJDIR, "**/*.o"), recursive=True))
if not objs:
    die("no object files under %s" % OBJDIR)
per_tk = collections.defaultdict(lambda: collections.defaultdict(set))
for o in objs:
    u = undef_of(o)
    if not u:
        continue
    src = os.path.relpath(o, OBJDIR)[:-2]
    for tk in closure:
        hit = u & exclusive[tk]
        if hit:
            per_tk[tk][src] |= hit

# ---- 5. locate call sites -----------------------------------------------------
OCCT_CLS = re.compile(r"^[A-Z][A-Za-z0-9]*_[A-Za-z0-9_]+$")


def idents(sym):
    out, i, n = [], 0, len(sym)
    while i < n:
        if sym[i].isdigit():
            j = i
            while j < n and sym[j].isdigit():
                j += 1
            ln = int(sym[i:j])
            if 0 < ln <= n - j:
                out.append(sym[j:j + ln])
                i = j + ln
                continue
            i = j
        else:
            i += 1
    return out


def owning_class(sym):
    for s in idents(sym):
        if OCCT_CLS.match(s):
            return s
    return None


sites = {}
for tk, files in per_tk.items():
    t = {}
    for src, syms in files.items():
        by_cls = collections.defaultdict(set)
        for raw in syms:
            c = owning_class(raw)
            if c:
                by_cls[c].add(raw)
        path = os.path.join(KROOT, src)
        lines = open(path, errors="replace").readlines() if os.path.exists(path) else []
        loc, und = {}, []
        for c, ss in sorted(by_cls.items()):
            hits = [i + 1 for i, L in enumerate(lines)
                    if re.search(r"\b%s\b" % re.escape(c), L)
                    and not L.lstrip().startswith("#include")]
            (loc.__setitem__(c, {"lines": hits, "n_symbols": len(ss)}) if hits
             else und.append({"class": c, "n_symbols": len(ss)}))
        t[src] = {"n_symbols": len(syms), "located": loc, "undetermined": und}
    sites[tk] = t

# ---- 6. the elimination ladder ------------------------------------------------
work = {tk: len(set().union(*per_tk[tk].values())) if per_tk.get(tk) else 0 for tk in closure}
waves, cur, n = [], set(closure), 0
while cur:
    n += 1
    free = sorted(t for t in cur if not (parents.get(t, set()) & cur))
    if not free:
        die("cycle in the toolkit DAG among %s" % sorted(cur))
    waves.append({"wave": n, "toolkits": free,
                  "closure_before": len(cur), "closure_after": len(cur) - len(free)})
    cur -= set(free)

# ---- 7. report ----------------------------------------------------------------
out = {
    "binary": NODE, "n_objects": len(objs),
    "direct": sorted(direct), "closure": closure,
    "waves": waves,
    "toolkits": {tk: {"direct_record": tk in direct,
                      "parents": sorted(parents.get(tk, set())),
                      "symbols_used": work[tk],
                      "files": sorted(per_tk.get(tk, {})),
                      "call_sites": sites.get(tk, {})} for tk in closure},
}
if A.json:
    json.dump(out, open(A.json, "w"), indent=1)

if not A.quiet:
    print("== OCCT toolkit elimination map: %s ==" % os.path.basename(NODE))
    print("   %d objects · OCCT_DIRECT=%d · OCCT_CLOSURE=%d\n" % (len(objs), len(direct), len(closure)))
    print("   %-12s %-7s %8s %7s  %s" % ("toolkit", "record", "symbols", "files", "pulled by"))
    for tk in sorted(closure, key=lambda t: (-work[t], t)):
        print("   %-12s %-7s %8d %7d  %s"
              % (tk, "DIRECT" if tk in direct else "hidden", work[tk],
                 len(per_tk.get(tk, {})), " ".join(sorted(parents.get(tk, set()))) or "(NOTHING)"))
    print("\n== elimination ladder (a toolkit leaves only when parent-free) ==")
    for w in waves:
        tag = ", ".join("%s%s" % (t, "" if work[t] else " [free]") for t in w["toolkits"])
        print("   wave %-2d  closure %2d -> %2d   %s"
              % (w["wave"], w["closure_before"], w["closure_after"], tag))
    free = [t for t in closure if work[t] == 0]
    print("\n   %d toolkits need NO native work (0 exclusive symbols referenced): %s"
          % (len(free), " ".join(sorted(free))))
    print("   They leave exactly when their parents do. Work scheduled against them is wasted.")
