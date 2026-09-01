#!/usr/bin/env python3
"""Reproduce every number in implementation/sacrosanct/FORGE_DELETION_PLAN.md.

    python3 implementation/sacrosanct/tools/forge_deletion_inventory.py

Run it from the repo root, in a tree pinned to origin. It measures rather than asserts:
`git ls-files` for membership, newline counts for LOC, byte sizes rounded up to KiB
for tracked size (NOT `du`, which reports allocated 4K blocks and reads larger), and a
hand-written synonym table -- printed in full -- for the gate-3 coverage mapping.

It is NOT a CI gate and it deletes nothing. It exists so a reader can re-derive the
plan's figures on their own tree and see immediately where they have drifted.
"""
from __future__ import annotations

import os
import re
import subprocess
import sys

# --------------------------------------------------------------------------- helpers

def git_files(*pathspecs: str) -> list[str]:
    out = subprocess.run(["git", "ls-files", "--", *pathspecs],
                         capture_output=True, text=True, check=True).stdout
    return [ln for ln in out.splitlines() if ln]


def loc(files: list[str]) -> int:
    total = 0
    for f in files:
        try:
            with open(f, "rb") as fh:
                total += fh.read().count(b"\n")
        except OSError:
            pass
    return total


def kib(files: list[str]) -> int:
    total = 0
    for f in files:
        try:
            total += (os.path.getsize(f) + 1023) // 1024
        except OSError:
            pass
    return total


def group(label: str, *pathspecs: str) -> tuple[int, int, int]:
    fs = git_files(*pathspecs)
    n, l, k = len(fs), loc(fs), kib(fs)
    print(f"  {label:<44} files={n:<6} loc={l:<8} KiB={k}")
    return n, l, k


# --------------------------------------------------------------------------- 1. inventory

def inventory() -> None:
    print("=" * 78)
    print("1. INVENTORY -- the 'old Forge versions' candidate set (tracked files only)")
    print("=" * 78)
    group("F1  frontend/src/forge-v4", "frontend/src/forge-v4")
    group("F2  frontend/src/kernel  (2nd kernel, in JS)", "frontend/src/kernel")
    group("F3  frontend/src/foundation", "frontend/src/foundation")
    group("F4  frontend/src/ai", "frontend/src/ai")
    group("    frontend TOTAL", "frontend")
    e2e_all = git_files("e2e")
    e2e_forge = set(git_files("e2e/forge"))
    e2e_root = [f for f in e2e_all if f not in e2e_forge]
    print(f"  {'F6  e2e root push-* specs':<44} files={len(e2e_root):<6} "
          f"loc={loc(e2e_root):<8} KiB={kib(e2e_root)}")
    group("F7  e2e/forge  (the gate-3 reference)", "e2e/forge")
    group("F8  electron", "electron")
    group("F9  N-API binding layer",
          "forge-kernel/src/binding*", "forge-kernel/src/ft/binding_ft.cpp")
    group("F10 forge-kernel/test JS harness",
          "forge-kernel/test/*.js", "forge-kernel/test/*.mjs", "forge-kernel/test/*.cjs")
    group("    forge-kernel/test C++ (the REPLACEMENT, kept)",
          "forge-kernel/test/*.cpp", "forge-kernel/test/*.hpp")
    group("F11 projects", "projects")

    whole = git_files("frontend", "e2e", "electron", "projects",
                      "playwright.config.js", "electron-builder.yml",
                      "forge-kernel/src/binding*", "forge-kernel/src/ft/binding_ft.cpp",
                      "forge-kernel/test/*.js", "forge-kernel/test/*.mjs",
                      "forge-kernel/test/*.cjs")
    whole = sorted(set(whole))
    print(f"\n  CANDIDATE SET TOTAL: files={len(whole)}  loc={loc(whole)}  "
          f"KiB={kib(whole)}   (repo tracks {len(git_files())} files)")

    print("\n  -- is there a forge-v1/v2/v3 in the tree? --")
    vs: dict[str, int] = {}
    for f in git_files():
        for m in re.findall(r"forge-v\d+", f):
            vs[m] = vs.get(m, 0) + 1
    for k in sorted(vs):
        print(f"     {k}: {vs[k]} paths")
    ghost = git_files("frontend/src/forge-app*")
    print(f"     frontend/src/forge-app (the v3 app): {len(ghost)} tracked files"
          f"  <- POSITIVE CONTROL: forge-v4 has {len(git_files('frontend/src/forge-v4*'))}")


# --------------------------------------------------------------------------- 2. gate 3

# JS tool -> C++ command id performing the same modelling operation.
# This table is the ONLY judgement in this script. Every pair is printed so a
# reader can reject any one of them individually.
SYNONYM = {
    "part.chamfer":          "part.chamfer",
    "part.fillet":           "part.fillet",
    "part.variable-fillet":  "part.variable_fillet",
    "part.extrude":          "part.extrude",
    "part.revolve":          "part.revolve",
    "part.loft":             "part.loft",
    "part.shell":            "part.shell",
    "part.fuse":             "part.boolean_union",
    "part.cut":              "part.boolean_subtract",
    "part.subtract":         "part.boolean_subtract",
    "part.common":           "part.boolean_intersect",
    "part.intersect":        "part.boolean_intersect",
    "part.linear-pattern":   "part.pattern_linear",
    "part.circular-pattern": "part.pattern_circular",
    "part.holes":            "part.hole",
    "part.grid-holes":       "part.pattern_grid",
    "part.translate":        "part.move",
    "sketch.add-circle":     "part.sketch_circle",
    # -- added 2026-08-31, after #140 made ten kernel primitives user-invocable.
    # WITHOUT these rows this script reported 11.0% BOTH BEFORE AND AFTER #140:
    # the registry grew 30 -> 41 and the measured coverage did not move, because
    # the JS names are part.make-* and the new C++ ids are part.primitive_*. A
    # stale synonym table is an instrument that cannot see the thing it measures.
    # Each pair below was checked on BOTH sides before it was added -- same
    # primitive, same parameters, same units -- not matched on the name:
    #   part.make-box       ForgeToolBridge.js:1009  (dx,dy,dz mm -> forge.makeBox)
    #                       PartCommands.cpp:775     (dx,dy,dz -> BOX, requirePositive x3)
    #   part.make-cylinder  ForgeToolBridge.js:1016  (radius,height -> makeCylinder)
    #                       PartCommands.cpp:811     (-> CYL)
    #   part.make-sphere    ForgeToolBridge.js:1022  PartCommands.cpp:901  (-> SPHERE)
    #   part.make-cone      ForgeToolBridge.js:1027  (r1,r2,h)  PartCommands.cpp:853 (-> CONE)
    #   part.make-torus     ForgeToolBridge.js:1034  (major,minor) PartCommands.cpp:928 (-> TORUS)
    #   part.make-prism     ForgeToolBridge.js:1040  (nSides,circumRadius,height)
    #                       PartCommands.cpp:970     (-> PRISM)
    #   part.make-tube      ForgeToolBridge.js:1069  (rOuter,rInner,height; rInner<rOuter)
    #                       PartCommands.cpp:1011    (-> TUBE, same rInner<rOuter guard)
    #   part.rotate         ForgeToolBridge.js:1102  (axis + angle in RADIANS)
    #                       PartCommands.cpp:1108    (-> ROTATE)
    "part.make-box":         "part.primitive_box",
    "part.make-cylinder":    "part.primitive_cylinder",
    "part.make-sphere":      "part.primitive_sphere",
    "part.make-cone":        "part.primitive_cone",
    "part.make-torus":       "part.primitive_torus",
    "part.make-prism":       "part.primitive_prism",
    "part.make-tube":        "part.primitive_tube",
    "part.rotate":           "part.rotate",
    # NOT added, and each absence is a fact rather than an oversight:
    #   part.make-ellipsoid / part.make-pyramid / part.make-wedge / part.pipe /
    #   part.sweep  -- no C++ command emits an op for any of these.
    #   part.sketch_rect / part.sketch_rounded_rect / part.sketch_polygon -- the
    #   C++ side has them and the JS side does NOT, so they cannot raise
    #   coverage; they are counted in "C++ commands with NO JS counterpart".
}

BRIDGE = "frontend/src/ai/ForgeToolBridge.js"
MANIFEST = "implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv"


def gate3() -> None:
    print()
    print("=" * 78)
    print("2. GATE 3 -- does the C++ forge::ui registry cover what the JS app exposes?")
    print("=" * 78)
    if not (os.path.exists(BRIDGE) and os.path.exists(MANIFEST)):
        print("  one of the two surfaces is absent from this tree -- cannot measure")
        return

    src = open(BRIDGE).read()
    js = sorted(set(re.findall(r"\{ name: '([^']+)'", src)))
    disc: dict[str, set[str]] = {}
    for name, d in re.findall(r"\{ name: '([^']+)', discipline: '([^']+)'", src):
        disc.setdefault(d, set()).add(name)

    cpp = sorted({ln.split("\t")[0] for ln in open(MANIFEST)
                  if ln.strip() and not ln.startswith("#")})

    covered = {j: c for j, c in SYNONYM.items() if c in cpp and j in js}
    print(f"  JS FORGE_TOOLS total             : {len(js)}")
    print(f"  C++ registry commands (manifest) : {len(cpp)}")
    print(f"  JS tools with a C++ counterpart  : {len(covered)}")
    print(f"  JS tools with NO counterpart     : {len(js) - len(covered)}")
    print(f"  COVERAGE                         : {100.0 * len(covered) / len(js):.1f}%")
    print("\n  per discipline (covered / total):")
    for d in sorted(disc, key=lambda k: -len(disc[k])):
        c = len([n for n in disc[d] if n in covered])
        print(f"    {d:<12} {c:>3} / {len(disc[d]):>3}")

    reached = set(covered.values())
    print(f"\n  C++ commands reached by some JS tool: {len(reached)} / {len(cpp)}")
    print("  C++ commands with NO JS counterpart :",
          ", ".join(sorted(set(cpp) - reached)))

    print("\n  the synonym table, in full (reject any row you disagree with):")
    for j in sorted(SYNONYM):
        mark = "ok " if j in covered else "?? "
        print(f"    {mark}{j:<24} -> {SYNONYM[j]}")


# --------------------------------------------------------------------------- 3. reachability

def js_reachability() -> None:
    print()
    print("=" * 78)
    print("3. WHICH JS ACCEPTANCE FILES ARE STILL REACHABLE")
    print("=" * 78)
    tests = {os.path.basename(f) for f in git_files(
        "forge-kernel/test/*.js", "forge-kernel/test/*.mjs", "forge-kernel/test/*.cjs")}

    cited: set[str] = set()
    for p in (".github/workflows/kernel-tests.yml", "package.json",
              "forge-kernel/CMakeLists.txt", "forge-kernel/BUILD_AND_VERIFY_RIGOR.sh"):
        if os.path.exists(p):
            cited |= set(re.findall(r"[A-Za-z0-9_.-]+\.(?:mjs|cjs|js)", open(p).read()))
    for f in git_files("forge-kernel/test/*.sh"):
        cited |= set(re.findall(r"[A-Za-z0-9_.-]+\.(?:mjs|cjs|js)", open(f).read()))

    imported: set[str] = set()
    dlopen = 0
    for f in git_files("forge-kernel/test/*.js", "forge-kernel/test/*.mjs",
                       "forge-kernel/test/*.cjs"):
        body = open(f, errors="replace").read()
        if "forge-kernel.node" in body:
            dlopen += 1
        for m in re.findall(r"""(?:from|require\()\s*['"]([^'"]+)['"]""", body):
            if m.endswith((".mjs", ".cjs", ".js")):
                imported.add(os.path.basename(m))

    invoked = tests & cited
    reach = tests & (cited | imported)
    print(f"  JS acceptance files                     : {len(tests)}")
    print(f"  invoked by CI / npm / CMake / shell     : {len(invoked)}")
    print(f"  additionally imported by another test   : {len(reach - invoked)}")
    print(f"  REACHABLE                               : {len(reach)}")
    print(f"  NOT reachable (no invoker, no importer) : {len(tests - reach)}")
    print(f"  files that require the .node addon      : {dlopen}")
    print("\n  reachable, by name:")
    for n in sorted(reach):
        print(f"    {n}")


# ------------------------------------------------------- 4. what still runs node

NODE_SOURCES = (".github/workflows/kernel-tests.yml",
                ".github/workflows/desktop-release.yml",
                "package.json",
                "forge-kernel/CMakeLists.txt",
                "forge-desktop/CMakeLists.txt")


def node_consumers() -> None:
    """Every place in the tree that EXECUTES node, by name.

    "A gate you delete along with a file is a gate that stops protecting you
    silently" -- so the deletion order needs this list, not an impression of it.
    """
    print()
    print("=" * 78)
    print("4. WHAT EXECUTES NODE -- the gates a JS deletion would silently retire")
    print("=" * 78)
    pat = re.compile(r"^\s*(?:run:|\"[\w:.-]+\"\s*:)?.*?\b(node|npm|npx|cmake-js)\b.*$",
                     re.M)
    total = 0
    for src in NODE_SOURCES:
        if not os.path.exists(src):
            print(f"  {src}: ABSENT from this tree")
            continue
        hits = []
        for i, ln in enumerate(open(src, errors="ignore").read().splitlines(), 1):
            body = ln.split("#")[0]
            if re.search(r"\b(node|npm|npx|cmake-js)\b", body) and \
               not re.search(r"node_modules/\.bin/#", body):
                hits.append((i, ln.strip()))
        print(f"\n  {src}  -- {len(hits)} line(s) naming a node runtime")
        for i, ln in hits:
            print(f"     {i:>5}: {ln[:150]}")
        total += len(hits)
    print(f"\n  TOTAL: {total} lines across {len(NODE_SOURCES)} files")
    print("  NOTE: `git grep -n 'playwright\\|e2e' .github/workflows/` finds NOTHING on")
    print("  either branch -- no CI job runs any of the 404 Playwright specs. That is")
    print("  the argument for replacing them before deleting them, not for deleting them.")


# ---------------------------------------- 5. C++ harnesses that are not gates yet

def unregistered_cpp() -> None:
    """Which top-level forge-kernel/test/*.cpp are outside FORGE_AB_GATES -- and,
    separately, WHY.

    ★ READ THIS BEFORE QUOTING THE COUNT. The first version of this section
    printed the raw "27 outside FORGE_AB_GATES" and called them files no gate
    runs. That was WRONG on two counts, both caught by reading the CMakeLists
    rather than grepping it:

      1. CTEST IS NOT THE ONLY RUNNER. forge-kernel/test/run_ab_all.sh drives 8
         A/B harnesses through `run_ab_native_$t.sh`, a name it BUILDS BY
         VARIABLE EXPANSION, so no grep for a script basename can see the edge.
         CI invokes run_ab_all.sh, not ctest, for those.
      2. EIGHT ARE DELIBERATE, DOCUMENTED EXCLUSIONS with the measurement that
         excluded them recorded in the CMakeLists "2b" comment block -- e.g.
         native_hlr_perf and native_hlr_import_perf end in an unconditional
         `return 0;` (registering them would add a test THAT CANNOT FAIL),
         golden_corpus_measure is a CLI tool that exits 2 with no argv, and
         native_vs_occt_fillet_var is RED on a REAL measured disagreement --
         native matches the closed form to 4.6e-15 rel while OCCT differs by
         4.444e-05, over a 1e-6 threshold. That is an open engineering gap, NOT
         a wiring omission, and registering it is not a one-line fix.

    So this section reports THREE buckets, not one number, and it names the
    exclusion note it read.
    """
    print()
    print("=" * 78)
    print("5. C++ A/B HARNESSES PRESENT AS SOURCE BUT NOT REGISTERED WITH CTEST")
    print("=" * 78)
    cml_path = "forge-kernel/CMakeLists.txt"
    if not os.path.exists(cml_path):
        print("  no forge-kernel/CMakeLists.txt on this tree")
        return
    cml = open(cml_path, errors="ignore").read()
    m = re.search(r"set\(FORGE_AB_GATES(.*?)\n\s*\)", cml, re.S)
    listed = set()
    if m:
        for ln in m.group(1).splitlines():
            ln = ln.split("#")[0].strip()
            if ln:
                listed.add(ln)
    # git pathspec '*' crosses '/', so restrict to the TOP level of test/
    srcs = [f for f in git_files("forge-kernel/test/*.cpp") if f.count("/") == 2]
    stems = {os.path.splitext(os.path.basename(f))[0]: f for f in srcs}
    named = set()
    for _tgt, path in re.findall(r"add_executable\(\s*(\w+)\s+([^\s)]+)", cml):
        named.add(os.path.splitext(os.path.basename(path.strip('"')))[0])
    missing_src = sorted(g for g in listed if g not in stems)
    print(f"  FORGE_AB_GATES entries              : {len(listed)}")
    print(f"  top-level forge-kernel/test/*.cpp   : {len(stems)}")
    print(f"  listed but source ABSENT            : {len(missing_src)} {missing_src}"
          "   <- negative control: a typo in the list would show up here")
    unreg = sorted(k for k in stems if k not in listed and k not in named)
    print(f"  source present, NOT in FORGE_AB_GATES: {len(unreg)}")

    # bucket (b): the CMakeLists "2b" comment block records the measurement that
    # excluded each of these. An exclusion with a number attached is a decision,
    # not an oversight.
    try:
        note = cml[cml.index("2b. standalone A/B oracles"):cml.index("set(FORGE_TEST_OCCT_LIBS")]
    except ValueError:
        note = ""
    # bucket (a): named by ANY shell harness in the tree. Deliberately a broad
    # net -- run_ab_all.sh builds its script names by expansion, so a narrow
    # "is this script itself reachable" test produces FALSE DARKNESS.
    shell = {}
    for f in git_files("forge-kernel/test/*.sh", "forge-kernel/tools/*.sh",
                       "scripts/*.sh", ".github/workflows/*.yml"):
        try:
            shell[f] = open(f, errors="ignore").read()
        except OSError:
            pass
    a, b, c = [], [], []
    for k in unreg:
        hits = sorted(f for f, t in shell.items() if k in t)
        if hits:
            a.append((k, hits))
        elif k in note:
            b.append(k)
        else:
            c.append(k)
    print(f"     (a) named by a shell harness or workflow : {len(a)}")
    for k, h in a:
        print(f"         {k:<40} {h[0]}" + (f"  (+{len(h)-1} more)" if len(h) > 1 else ""))
    print(f"     (b) DELIBERATE exclusion, measurement in the CMakeLists 2b note : {len(b)}")
    for k in b:
        print(f"         {k}")
    print(f"     (c) neither -- genuinely unaccounted for : {len(c)}")
    for k in c:
        print(f"         {k:<40} {loc([stems[k]]):>6} lines")
    print("     NOTE: (a) means SOMETHING NAMES IT, not that CI runs it. Proving the"
          "\n     latter needs the runner graph, and run_ab_all.sh's `run_ab_native_$t.sh`"
          "\n     expansion is invisible to a basename grep -- so do not upgrade (a) to"
          "\n     'covered' without following that edge by hand.")


# ------------------------------------- 6. what the frontend bundle can contain

def frontend_reachability() -> None:
    """Which frontend modules can the SHIPPED bundle possibly contain?

    Vite has exactly one entry (frontend/index.html -> src/main.jsx;
    vite.config.js declares no extra rollupOptions.input, verified). A module no
    walk from there reaches cannot be in frontend/dist, so deleting it cannot
    change the shipped app.

    NOT REACHED IS NOT UNUSED. `npm run forge:unit` runs
    frontend/src/kernel/forge/__tests__/*.test.mjs and `npm test` runs
    frontend/src/__tests__/*.mjs -- both are outside the bundle graph and both
    are live gates. This section measures BUNDLE membership only.
    """
    import glob as _glob
    print()
    print("=" * 78)
    print("6. FRONTEND -- what the shipped Vite bundle can reach")
    print("=" * 78)
    root = os.path.abspath(".")
    static = re.compile(r"""(?:^|[\s;{(=])import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]""", re.M)
    dyn = re.compile(r"""import\s*\(\s*['"]([^'"]+)['"]\s*\)""")
    req = re.compile(r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""")
    glb = re.compile(r"""import\.meta\.glob(?:Eager)?\s*\(\s*\[?\s*['"]([^'"]+)['"]""")
    expf = re.compile(r"""export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]""")
    exts = ["", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css",
            "/index.js", "/index.jsx", "/index.mjs"]

    def resolve(frm, spec):
        if not spec.startswith("."):
            return None            # bare specifier -> node_modules, not a tree file
        p = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
        for e in exts:
            if os.path.isfile(p + e):
                return p + e
        return None

    tracked = {os.path.join(root, f) for f in git_files("frontend")}
    code = {f for f in tracked
            if os.path.splitext(f)[1] in (".js", ".jsx", ".mjs", ".cjs")}
    if not code:
        print("  no frontend/ on this tree")
        return
    roots = [os.path.join(root, r) for r in
             ("frontend/src/main.jsx", "frontend/src/App.jsx", "frontend/vite.config.js")]
    roots = [r for r in roots if os.path.isfile(r)]
    seen, globs = set(), []
    stack = list(roots)
    while stack:
        f = stack.pop()
        if f in seen or not os.path.isfile(f):
            continue
        seen.add(f)
        if os.path.splitext(f)[1] not in (".js", ".jsx", ".mjs", ".cjs"):
            continue
        txt = open(f, errors="ignore").read()
        for sp in (set(static.findall(txt)) | set(dyn.findall(txt))
                   | set(req.findall(txt)) | set(expf.findall(txt))):
            t = resolve(f, sp)
            if t:
                stack.append(t)
        for g in glb.findall(txt):
            hits = _glob.glob(os.path.normpath(os.path.join(os.path.dirname(f), g)),
                              recursive=True)
            globs.append((os.path.relpath(f, root), g, len(hits)))
            stack.extend(hits)
    reached = {f for f in seen if f in code}
    orphan = sorted(code - reached)
    print(f"  tracked frontend code files        : {len(code)}")
    print(f"  reachable from the ONE Vite entry  : {len(reached)}")
    print(f"  NOT reachable (cannot be bundled)  : {len(orphan)}")
    print(f"  import.meta.glob roots expanded    : {len(globs)}")
    # POSITIVE CONTROL: the CommandBar -> ForgeShellV4 -> ForgeRunner ->
    # ForgeToolBridge chain is proved live by e2e/forge/cadgenbench-cua-helper.js.
    # If the walk misses any of them it is broken and the count above is fiction.
    ctrl = ["frontend/src/forge-v4/ForgeShellV4.jsx", "frontend/src/ai/ForgeToolBridge.js",
            "frontend/src/forge-v4/CommandBar.jsx", "frontend/src/ai/ForgeRunner.js",
            "frontend/src/forge-v4/kernelDispatch.js"]
    bad = [c for c in ctrl if os.path.join(root, c) not in reached]
    print("  POSITIVE CONTROL (known-live chain) :",
          "all 5 reached" if not bad else f"BROKEN -- missed {bad}")
    by = {}
    for f in orphan:
        d = os.path.dirname(os.path.relpath(f, root))
        by[d] = by.get(d, 0) + 1
    print("  unreachable, by directory (top 12):")
    for d, n in sorted(by.items(), key=lambda kv: -kv[1])[:12]:
        print(f"     {n:>5}  {d}")


def main() -> int:
    if not os.path.isdir(".git") and not os.path.exists(".git"):
        print("run me from the repo root", file=sys.stderr)
        return 2
    sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                         capture_output=True, text=True).stdout.strip()
    print(f"tree at HEAD = {sha}\n")
    inventory()
    gate3()
    js_reachability()
    node_consumers()
    unregistered_cpp()
    frontend_reachability()
    print("\n(measurement only -- this script deletes nothing)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
