#!/usr/bin/env python3
"""freecad_derived_lgpl_gate.py -- the LGPL boundary around third_party/freecad-derived.

Forge may take FreeCAD code (LGPL-2.1-or-later) and adapt it, on two conditions that
make that safe for a commercial product: the derived code lives ONLY under
third_party/freecad-derived/<component>/ with its licence paperwork beside it, and it
ships as a SEPARATE SHARED LIBRARY that Forge links dynamically. This gate turns both
into checks a pull request cannot pass without. Stdlib only, no build, no network.

SOURCE MODE (default) -- per component directory:
  paperwork   COPYING.LGPL is the full LGPL-2.1 text; MODIFICATIONS.md exists and is
              dated; NOTICE exists; manifest.json has an entry whose path exists;
              THIRD_PARTY_NOTICES.md has a section heading naming the component.
  headers     every C/C++ source and header carries an LGPL SPDX identifier.
  modified    when MODIFICATIONS.md lists upstream files with their upstream sha256
              ("| `file` | verbatim | `sha` |"), a VERBATIM file must still hash to it,
              and a MODIFIED one must differ from it AND carry a MODIFIED FOR FORGE
              notice. A silent edit to a file recorded as verbatim is a failure.
  isolation   no OCCT, Qt, Coin3D or Python header is included; the component's
              CMakeLists builds its code with add_library(... SHARED) and nothing else.
  boundary    no build file OUTSIDE third_party/freecad-derived names one of a
              component's source files -- which is what compiling it into
              forge_desktop, forge_kernel_worker or libforge_kernel_core would take.

BINARY MODE (--binary FILE --library LIB, repeatable pairs are not needed: give every
Forge binary with --binary and every built component library with --library):
  every symbol a component library exports must be UNDEFINED (imported) in each Forge
  binary that mentions it, never defined there; and a binary that imports one must
  carry a load command for that library (otool -L). A static copy fails.

Exit 0 green, 1 a check failed, 2 the gate could not run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

FD_REL = Path("third_party/freecad-derived")
SRC_EXT = {".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".inl"}
COMPILED_EXT = {".c", ".cc", ".cpp", ".cxx"}

LGPL_MARKERS = (
    "GNU LESSER GENERAL PUBLIC LICENSE",
    "Version 2.1, February 1999",
    "TERMS AND CONDITIONS FOR COPYING, DISTRIBUTION AND MODIFICATION",
    "END OF TERMS AND CONDITIONS",
    "How to Apply These Terms to Your New Libraries",
)
LGPL_MIN_BYTES = 24000

FORBIDDEN_INCLUDE = re.compile(
    r'^\s*#\s*include\s*[<"]('
    r'[A-Za-z0-9_]+\.hxx'                       # every OCCT header is *.hxx
    r'|(?:Standard|TopoDS|BRep|Geom|Geom2d|gp|TopExp|TopAbs|TColStd|Precision)_[A-Za-z0-9_]*\.h(?:xx)?'
    r'|Q[A-Z][A-Za-z]+(?:\.h)?|Qt[A-Za-z]+/[^>"]*|qglobal\.h'   # Qt
    r'|Inventor/[^>"]*|Coin/[^>"]*'              # Coin3D
    r'|Python\.h|pybind11/[^>"]*|boost/python[^>"]*|CXX/[^>"]*'  # Python
    r')[>"]', re.M)
FORBIDDEN_CMAKE = re.compile(
    r'find_package\s*\(\s*(Qt[0-9]*|OpenCASCADE|OCC|Coin|Coin3D|Python[0-9]*|PySide[0-9]*|pybind11)\b',
    re.I)
SPDX_LGPL = re.compile(r"SPDX-License-Identifier:\s*LGPL-2\.1")
ADD_LIBRARY = re.compile(r"add_library\s*\(\s*([A-Za-z0-9_\-]+)\s+([A-Z]+)?", re.M)
MOD_ROW = re.compile(r"^\|\s*`([^`]+)`\s*\|\s*\**(verbatim|modified)\**\s*\|\s*`([0-9a-f]{64})`\s*\|", re.M)
DATE = re.compile(r"\b20[0-9]{2}-[01][0-9]-[0-3][0-9]\b")


class Gate:
    def __init__(self) -> None:
        self.checks = 0
        self.failures: list[str] = []

    def check(self, ok: bool, what: str) -> bool:
        self.checks += 1
        if not ok:
            self.failures.append(what)
            print(f"  FAIL  {what}")
        return ok


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def strip_cmake_comments(text: str) -> str:
    return "\n".join(line.split("#", 1)[0] for line in text.splitlines())


def component_dirs(root: Path) -> list[Path]:
    base = root / FD_REL
    if not base.is_dir():
        return []
    return sorted(p for p in base.iterdir() if p.is_dir() and not p.name.startswith("."))


def tracked_sources(root: Path) -> list[Path]:
    """Every C/C++ file in the tree -- git's list when there is one, a walk otherwise."""
    try:
        out = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=True)
        files = [root / f for f in out.stdout.decode().split("\0") if f]
    except (OSError, subprocess.CalledProcessError):
        files = [p for p in root.rglob("*") if p.is_file()]
    return [p for p in files if p.suffix in SRC_EXT and p.is_file()]


FREECAD_HEADER = re.compile(r"This file is part of the FreeCAD CAx development system", re.I)


def source_mode(root: Path, g: Gate) -> None:
    base = root / FD_REL
    comps = component_dirs(root)

    # provenance: FreeCAD source lives inside the boundary or nowhere. This is the
    # check that is RED on a tree where planegcs was vendored into the kernel and
    # compiled statically into libforge_kernel_core.
    stray = []
    for p in tracked_sources(root):
        rel = p.relative_to(root)
        if rel.parts[:2] == ("third_party", "freecad-derived"):
            continue
        try:
            head = "\n".join(p.read_text(errors="replace").splitlines()[:40])
        except OSError:
            continue
        if FREECAD_HEADER.search(head):
            stray.append(str(rel))
    g.check(not stray,
            f"FreeCAD-derived source lives only under {FD_REL}; found {len(stray)} outside it"
            + (f": {', '.join(stray[:6])}{' ...' if len(stray) > 6 else ''}" if stray else ""))

    print(f"[lgpl] {len(comps)} component(s) under {FD_REL}")
    if not comps:
        return

    manifest_path = base / "manifest.json"
    entries: dict[str, dict] = {}
    if g.check(manifest_path.is_file(), f"{FD_REL}/manifest.json exists"):
        try:
            manifest = json.loads(manifest_path.read_text())
            for e in manifest.get("components", []):
                entries[e.get("name", "")] = e
                g.check((root / e.get("path", "/nonexistent")).is_dir(),
                        f"manifest entry {e.get('name')!r} names a directory that exists ({e.get('path')})")
                g.check("LGPL" in str(e.get("license", "")),
                        f"manifest entry {e.get('name')!r} records an LGPL licence")
                commit = e.get("upstream_commit") or (e.get("upstream") or {}).get("commit", "")
                g.check(bool(re.fullmatch(r"[0-9a-f]{40}", commit or "")),
                        f"manifest entry {e.get('name')!r} records the full upstream commit")
        except json.JSONDecodeError as exc:
            g.check(False, f"manifest.json parses ({exc})")

    notices_path = base / "THIRD_PARTY_NOTICES.md"
    notices = notices_path.read_text() if notices_path.is_file() else ""
    g.check(notices_path.is_file(), f"{FD_REL}/THIRD_PARTY_NOTICES.md exists")

    for comp in comps:
        name = comp.name
        rel = comp.relative_to(root)
        print(f"[lgpl] component {name}")
        by_path = [e for e in entries.values() if Path(e.get("path", "")) == rel]
        g.check(name in entries or bool(by_path), f"{name}: has an entry in manifest.json")
        g.check(bool(re.search(rf"^##\s+.*\b{re.escape(name)}\b", notices, re.M)),
                f"{name}: has a section in THIRD_PARTY_NOTICES.md")

        lic = comp / "COPYING.LGPL"
        if g.check(lic.is_file(), f"{name}: ships COPYING.LGPL"):
            text = lic.read_text(errors="replace")
            g.check(lic.stat().st_size >= LGPL_MIN_BYTES and all(m in text for m in LGPL_MARKERS),
                    f"{name}: COPYING.LGPL is the complete LGPL-2.1 text")
        mods = comp / "MODIFICATIONS.md"
        mods_text = ""
        if g.check(mods.is_file() and mods.stat().st_size > 0, f"{name}: ships MODIFICATIONS.md"):
            mods_text = mods.read_text(errors="replace")
            g.check(bool(DATE.search(mods_text)), f"{name}: MODIFICATIONS.md dates its changes")
        g.check((comp / "NOTICE").is_file() or (comp / "NOTICE.md").is_file(), f"{name}: ships a NOTICE")

        sources = [p for p in comp.rglob("*") if p.is_file() and p.suffix in SRC_EXT]
        for p in sources:
            head = "\n".join(p.read_text(errors="replace").splitlines()[:12])
            g.check(bool(SPDX_LGPL.search(head)),
                    f"{name}: {p.relative_to(comp)} carries an LGPL SPDX identifier")
            m = FORBIDDEN_INCLUDE.search(p.read_text(errors="replace"))
            g.check(m is None,
                    f"{name}: {p.relative_to(comp)} includes no OCCT / Qt / Coin3D / Python header"
                    + (f" (found {m.group(0).strip()!r})" if m else ""))

        # recorded upstream files: verbatim must match, modified must differ and say so
        for rel_file, status, want in MOD_ROW.findall(mods_text):
            f = comp / rel_file
            if not g.check(f.is_file(), f"{name}: recorded upstream file {rel_file} exists"):
                continue
            have = sha256(f)
            if status == "verbatim":
                g.check(have == want, f"{name}: {rel_file} is recorded VERBATIM and still matches upstream")
            else:
                g.check(have != want, f"{name}: {rel_file} is recorded MODIFIED and differs from upstream")
                g.check("MODIFIED FOR FORGE" in f.read_text(errors="replace"),
                        f"{name}: {rel_file} carries its dated MODIFIED FOR FORGE notice")

        cml = comp / "CMakeLists.txt"
        if g.check(cml.is_file(), f"{name}: has a CMakeLists.txt that builds it"):
            ctext = strip_cmake_comments(cml.read_text(errors="replace"))
            libs = ADD_LIBRARY.findall(ctext)
            g.check(any(kind == "SHARED" for _, kind in libs), f"{name}: builds an add_library(... SHARED)")
            for target, kind in libs:
                g.check(kind in ("SHARED", "MODULE"),
                        f"{name}: add_library({target} {kind or '<default>'}) is not SHARED -- a static or object "
                        "library is how derived code ends up inside a Forge binary")
            g.check(FORBIDDEN_CMAKE.search(ctext) is None,
                    f"{name}: CMakeLists.txt finds no Qt / OCCT / Coin3D / Python package")

    # boundary: nothing outside the directory compiles a component's source file
    compiled = {}
    for comp in comps:
        for p in comp.rglob("*"):
            if p.is_file() and p.suffix in COMPILED_EXT and "test" not in p.relative_to(comp).parts:
                compiled[str(p.relative_to(root))] = comp.name
    build_files = []
    for pattern in ("CMakeLists.txt", "*.cmake", "*.sh"):
        for p in root.rglob(pattern):
            parts = p.relative_to(root).parts
            if parts[:2] == ("third_party", "freecad-derived") or ".git" in parts or "node_modules" in parts \
                    or any(part.startswith("build") for part in parts[:-1]) or ".claude" in parts:
                continue
            build_files.append(p)
    # A CMake file naming a component source is compiling it (that is all CMake
    # does with a .cpp path). A shell script is only flagged on a line that also
    # invokes a compiler: tools may legitimately NAME a source, e.g. to perturb it.
    compiler = re.compile(r"(\$\{?CXX\b|\$\{?CC\b|\bclang\+\+|\bclang\b|\bg\+\+|\bc\+\+|\bgcc\b|\bcompile_[a-z_]+\b)")
    for p in build_files:
        text = p.read_text(errors="replace")
        if "freecad-derived" not in text:
            continue
        is_cmake = p.name == "CMakeLists.txt" or p.suffix == ".cmake"
        lines = strip_cmake_comments(text).splitlines() if is_cmake else text.splitlines()
        g.checks += 1
        for src, comp_name in compiled.items():
            tail = src.split("third_party/freecad-derived/", 1)[1]
            for line in lines:
                if tail in line and (is_cmake or compiler.search(line)):
                    g.check(False,
                            f"{comp_name}: {p.relative_to(root)} compiles {src} -- a Forge build file must "
                            "LINK the component's shared library, never compile its sources")


def binary_mode(binaries: list[Path], libraries: list[Path], g: Gate) -> None:
    def nm(path: Path, args: list[str]) -> set[str]:
        out = subprocess.run(["nm", *args, str(path)], capture_output=True, text=True)
        if out.returncode != 0:
            raise RuntimeError(f"nm failed on {path}: {out.stderr.strip()}")
        syms = set()
        for line in out.stdout.splitlines():
            parts = line.split()
            if parts:
                syms.add(parts[-1])
        return syms

    for lib in libraries:
        if not g.check(lib.is_file(), f"library {lib} exists"):
            continue
        exported = nm(lib, ["-gU"])
        print(f"[lgpl] {lib.name}: {len(exported)} exported symbol(s)")
        g.check(len(exported) > 0, f"{lib.name} exports its interface")
        for b in binaries:
            if not g.check(b.is_file(), f"binary {b} exists"):
                continue
            defined = nm(b, ["-gU"])
            undefined = nm(b, ["-u"])
            static_copies = sorted(exported & defined)
            g.check(not static_copies,
                    f"{b.name} DEFINES {len(static_copies)} symbol(s) of {lib.name} "
                    f"(e.g. {static_copies[:3]}) -- the LGPL library is compiled into it")
            # An object file has no load commands to carry; for it the static-copy
            # check above is the whole question.
            if exported & undefined and b.suffix != ".o":
                load = subprocess.run(["otool", "-L", str(b)], capture_output=True, text=True).stdout
                g.check(lib.name in load,
                        f"{b.name} imports {lib.name}'s symbols and carries its load command")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[2]))
    ap.add_argument("--binary", action="append", default=[])
    ap.add_argument("--library", action="append", default=[])
    args = ap.parse_args()
    g = Gate()
    root = Path(args.root).resolve()
    if not (root / FD_REL).parent.is_dir():
        print(f"[lgpl] cannot run: {root} has no third_party directory", file=sys.stderr)
        return 2
    if args.binary or args.library:
        if not (args.binary and args.library):
            print("[lgpl] binary mode needs at least one --binary and one --library", file=sys.stderr)
            return 2
        try:
            binary_mode([Path(b) for b in args.binary], [Path(l) for l in args.library], g)
        except (OSError, RuntimeError) as exc:
            print(f"[lgpl] cannot run: {exc}", file=sys.stderr)
            return 2
    else:
        source_mode(root, g)
    if g.failures:
        print(f"[lgpl] RED -- {len(g.failures)} of {g.checks} check(s) failed")
        return 1
    print(f"[lgpl] GREEN -- {g.checks} check(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
