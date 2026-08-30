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
    print("\n(measurement only -- this script deletes nothing)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
