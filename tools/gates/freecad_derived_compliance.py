#!/usr/bin/env python3
# ============================================================================
# freecad_derived_compliance.py -- IS EVERY FreeCAD-DERIVED LIBRARY SHIPPABLE?
#
# Forge takes code and data from FreeCAD (LGPL-2.1-or-later) under two binding
# conditions: the derived part lives ONLY under third_party/freecad-derived/<name>/
# as its OWN SHARED LIBRARY, linked dynamically; and it travels with its licence
# text, a dated record of what was changed, a notice, and a THIRD_PARTY notice
# entry. A component that is compiled into the application, or shipped without
# those files, is a licence defect in a commercial product -- and nothing about it
# would fail a build or a test. This is the check that fails.
#
# HERMETIC: python3 and the files in the tree. No compiler, no network, no FreeCAD
# checkout; the imported files are verified against the SHA-256 recorded when they
# were imported. The optional --build and --bundle modes additionally read BUILT
# artefacts with otool/nm (macOS) and are run where those artefacts exist.
#
# usage:
#   python3 tools/gates/freecad_derived_compliance.py                 # the tree
#   python3 tools/gates/freecad_derived_compliance.py --build DIR [--kernel LIB]
#   python3 tools/gates/freecad_derived_compliance.py --bundle Forge.app
#   python3 tools/gates/freecad_derived_compliance.py --selftest      # proves it can fail
#
# exit: 0 compliant / 1 a finding / 2 bad usage or a tool missing
# ============================================================================
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BASE_REL = "third_party/freecad-derived"
MANIFEST_REL = BASE_REL + "/MANIFEST.json"
NOTICES_REL = "third_party/notices/NOTICES.md"
LOCK_REL = "third_party/manifest/deps.lock.json"
DESKTOP_CMAKE_REL = "forge-desktop/CMakeLists.txt"
KERNEL_CMAKE_REL = "forge-kernel/CMakeLists.txt"
PACKAGER_REL = "forge-desktop/package_macos.sh"
BUNDLE_VERIFY_REL = "third_party/licenses/verify_bundle_licences.sh"

# SHA-256 of the GNU Lesser General Public License version 2.1 text as the FSF
# publishes it (the same bytes as third_party/licenses/LGPL-2.1.txt).
LGPL21_SHA256 = "e237fa56668030e928551ddd60f05df5fe957f75eab874bbd017e085ed722e7c"
LGPL_SPDX = re.compile(r"^LGPL-2\.[01](-only|-or-later)$")
CODE_SUFFIXES = (".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".cmake")
# Headers a derived component may never include. Each is a dependency the owner
# excluded: OCCT (the kernel is going OCCT-free), Qt, Coin3D, Python, and
# FreeCAD's own application layers (which would drag all of the above in).
FORBIDDEN_INCLUDES = [
    (re.compile(r"#\s*include\s*[<\"][^>\"]+\.hxx[>\"]"), "an OCCT header (.hxx)"),
    (re.compile(r"#\s*include\s*[<\"](TopoDS|BRep|Geom|gp_|Standard_|TopExp|BOPAlgo)"), "an OCCT header"),
    (re.compile(r"#\s*include\s*[<\"](Q[A-Z]\w*|Qt\w+/)"), "a Qt header"),
    (re.compile(r"#\s*include\s*[<\"]Inventor/"), "a Coin3D header"),
    (re.compile(r"#\s*include\s*[<\"](Python\.h|pybind11|boost/python)"), "a Python binding header"),
    (re.compile(r"#\s*include\s*[<\"](Base|App|Gui|Mod)/"), "a FreeCAD application header"),
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def read(root, rel):
    p = os.path.join(root, rel)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8", errors="replace") as fh:
        return fh.read()


class Findings:
    def __init__(self):
        self.items = []

    def add(self, component, what):
        self.items.append("%s: %s" % (component, what))


def load_manifest(root, f):
    text = read(root, MANIFEST_REL)
    if text is None:
        f.add("manifest", "%s is missing; every FreeCAD-derived component must be recorded there"
              % MANIFEST_REL)
        return None
    try:
        m = json.loads(text)
    except ValueError as e:
        f.add("manifest", "%s is not valid JSON (%s)" % (MANIFEST_REL, e))
        return None
    comps = m.get("components")
    if not isinstance(comps, list) or not comps:
        f.add("manifest", "%s lists no components" % MANIFEST_REL)
        return None
    return comps


def check_tree(root):
    f = Findings()
    comps = load_manifest(root, f)
    base = os.path.join(root, BASE_REL)
    on_disk = sorted(d for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))) \
        if os.path.isdir(base) else []
    if comps is None:
        return f
    listed = []
    for c in comps:
        for key in ("name", "path", "upstream_commit", "license", "cmake_target", "library",
                    "notice_entry"):
            if not c.get(key):
                f.add(c.get("name", "?"), "the manifest entry has no %s" % key)
        listed.append(c.get("name"))
    for d in on_disk:
        if d not in listed:
            f.add(d, "%s/%s exists but is not in %s" % (BASE_REL, d, MANIFEST_REL))
    for c in comps:
        name = c.get("name", "?")
        if name not in on_disk:
            f.add(name, "listed in the manifest but %s/%s does not exist" % (BASE_REL, name))
            continue
        check_component(root, c, f)
    return f


def check_component(root, c, f):
    name = c["name"]
    rel = c["path"]
    if rel != "%s/%s" % (BASE_REL, name):
        f.add(name, "its path %r is not %s/%s -- derived code lives there and nowhere else"
              % (rel, BASE_REL, name))
    comp = os.path.join(root, rel)
    if not re.fullmatch(r"[0-9a-f]{40}", c.get("upstream_commit", "")):
        f.add(name, "the manifest's upstream_commit is not a full 40-digit commit")
    if not LGPL_SPDX.match(c.get("license", "")):
        f.add(name, "the manifest's licence %r is not LGPL-2.x" % c.get("license"))

    # ── the three files that must travel with the library ──────────────────
    lic = os.path.join(comp, "COPYING.LGPL")
    if not os.path.isfile(lic):
        f.add(name, "COPYING.LGPL is missing -- the library would ship without its licence text")
    elif sha256(lic) != LGPL21_SHA256:
        f.add(name, "COPYING.LGPL is not the full, unmodified LGPL-2.1 text (sha256 differs)")
    mods = read(comp, "MODIFICATIONS.md")
    if mods is None:
        f.add(name, "MODIFICATIONS.md is missing -- LGPL-2.1 s2 requires a notice of changes")
    elif not re.search(r"^##\s+\d{4}-\d{2}-\d{2}\b", mods, re.M):
        f.add(name, "MODIFICATIONS.md records no dated change (a '## YYYY-MM-DD' heading)")
    readme = read(comp, "README.md")
    if readme is None:
        f.add(name, "README.md (the component's notice) is missing")
    else:
        if c.get("upstream_commit") and c["upstream_commit"] not in readme:
            f.add(name, "README.md does not name the upstream commit")
        if "COPYING.LGPL" not in readme:
            f.add(name, "README.md does not point at COPYING.LGPL")

    # ── the import record ───────────────────────────────────────────────────
    rec_text = read(comp, "component.json")
    rec = None
    if rec_text is None:
        f.add(name, "component.json (the per-file import record) is missing")
    else:
        try:
            rec = json.loads(rec_text)
        except ValueError as e:
            f.add(name, "component.json is not valid JSON (%s)" % e)
    if rec is not None:
        if rec.get("upstream", {}).get("commit") != c.get("upstream_commit"):
            f.add(name, "component.json and the manifest name different upstream commits")
        link = rec.get("linkage", {})
        if link.get("kind") != "shared":
            f.add(name, "component.json records linkage %r, not shared" % link.get("kind"))
        if link.get("cmake_target") != c.get("cmake_target"):
            f.add(name, "component.json and the manifest name different CMake targets")
        accepted = rec.get("license", {}).get("card_licences_accepted") or []
        for a in accepted:
            if not LGPL_SPDX.match(a):
                f.add(name, "component.json accepts the non-LGPL licence %r" % a)
        recorded = set()
        for entry in rec.get("files", []):
            p = entry.get("path", "")
            recorded.add(os.path.normpath(p))
            full = os.path.join(comp, p)
            if not os.path.isfile(full):
                f.add(name, "recorded file %s is missing" % p)
                continue
            if sha256(full) != entry.get("sha256"):
                f.add(name, "%s differs from its recorded import (sha256) -- record the change "
                      "in MODIFICATIONS.md and re-import" % p)
            if not LGPL_SPDX.match(entry.get("license") or ""):
                f.add(name, "%s is recorded under licence %r, which is not LGPL"
                      % (p, entry.get("license")))
        res = os.path.join(comp, "Resources")
        for dp, _, fn in os.walk(res):
            for leaf in fn:
                r = os.path.normpath(os.path.relpath(os.path.join(dp, leaf), comp))
                if r not in recorded:
                    f.add(name, "%s is in the component but not in component.json" % r)

    # ── it is a SHARED library, and every source says so ────────────────────
    cm = read(comp, "CMakeLists.txt")
    target = c.get("cmake_target", "")
    if cm is None:
        f.add(name, "CMakeLists.txt is missing")
    else:
        libs = re.findall(r"add_library\(\s*([A-Za-z0-9_]+)\s+([A-Z]+)?", cm)
        if not any(t == target and kind == "SHARED" for t, kind in libs):
            f.add(name, "CMakeLists.txt does not build %s as add_library(... SHARED)" % target)
        for t, kind in libs:
            if kind != "SHARED":
                f.add(name, "CMakeLists.txt builds %s as %s -- a derived component must be SHARED"
                      % (t, kind or "a default (static) library"))
    for dp, _, fn in os.walk(comp):
        # Resources/ is the imported DATA, verified by hash above; the SPDX and
        # include rules apply to the code around it.
        if os.path.relpath(dp, comp).replace(os.sep, "/").split("/")[0] == "Resources":
            continue
        for leaf in fn:
            if not (leaf.endswith(CODE_SUFFIXES) or leaf == "CMakeLists.txt"):
                continue
            full = os.path.join(dp, leaf)
            relp = os.path.relpath(full, root)
            with open(full, encoding="utf-8", errors="replace") as fh:
                body = fh.read()
            head = "\n".join(body.splitlines()[:5])
            if not re.search(r"SPDX-License-Identifier:\s*LGPL-2\.[01]", head):
                f.add(name, "%s has no LGPL SPDX-License-Identifier in its first lines" % relp)
            for rx, what in FORBIDDEN_INCLUDES:
                if rx.search(body):
                    f.add(name, "%s includes %s, which a derived component may not use"
                          % (relp, what))

    # ── the application links it, and compiles none of it ──────────────────
    desktop = read(root, DESKTOP_CMAKE_REL) or ""
    kernel = read(root, KERNEL_CMAKE_REL) or ""
    if not re.search(r"add_subdirectory\(\s*\"?\$\{FORGE_ROOT\}/%s\"?" % re.escape(rel), desktop):
        f.add(name, "%s does not build it with add_subdirectory()" % DESKTOP_CMAKE_REL)
    for lineno, raw in enumerate(desktop.splitlines(), 1):
        line = raw.split("#", 1)[0]
        if rel in line and "add_subdirectory" not in line:
            f.add(name, "%s:%d names a path inside the component outside add_subdirectory() -- "
                  "its sources must not be compiled into another target" % (DESKTOP_CMAKE_REL, lineno))
    if not re.search(r"target_link_libraries\([^)]*\b%s\b" % re.escape(target), desktop, re.S):
        f.add(name, "%s never links %s by target name" % (DESKTOP_CMAKE_REL, target))
    if BASE_REL in kernel or target in kernel:
        f.add(name, "%s mentions it -- libforge_kernel_core must not contain derived code"
              % KERNEL_CMAKE_REL)

    # ── the notices ─────────────────────────────────────────────────────────
    notices = read(root, NOTICES_REL) or ""
    entry = c.get("notice_entry", "")
    section = re.search(r"^## %s .*?(?=^## |\Z)" % re.escape(entry), notices, re.M | re.S)
    if section is None:
        f.add(name, "%s has no '## %s' notice entry" % (NOTICES_REL, entry))
    else:
        if "LGPL" not in section.group(0):
            f.add(name, "its notice entry does not state the LGPL")
        if "dynamic" not in section.group(0):
            f.add(name, "its notice entry does not state dynamic linkage")
    lock_text = read(root, LOCK_REL)
    try:
        lock = json.loads(lock_text) if lock_text else {}
    except ValueError:
        lock = {}
    dep = next((d for d in lock.get("dependencies", []) if d.get("name") == entry), None)
    if dep is None:
        f.add(name, "%s has no dependency named %s" % (LOCK_REL, entry))
    else:
        if dep.get("source", {}).get("path") != rel:
            f.add(name, "the lock entry's source path is not %s" % rel)
        if "dynamic" not in dep.get("license", {}).get("linkage", ""):
            f.add(name, "the lock entry does not record dynamic linkage")

    # ── and the packager ships the licence files ────────────────────────────
    for script in (PACKAGER_REL, BUNDLE_VERIFY_REL):
        text = read(root, script) or ""
        if BASE_REL.split("/")[-1] not in text:
            f.add(name, "%s does not handle the freecad-derived licence files" % script)


# ── built artefacts ─────────────────────────────────────────────────────────
def tool(name):
    path = shutil.which(name)
    if path is None:
        print("[fc-compliance] %s is not on PATH; --build/--bundle need it" % name)
        sys.exit(2)
    return path


def linked(binary):
    out = subprocess.run([tool("otool"), "-L", binary], capture_output=True, text=True)
    return [l.strip().split(" ")[0] for l in out.stdout.splitlines()[1:]]


def defines_symbols(binary, prefix):
    out = subprocess.run([tool("nm"), "-gU", binary], capture_output=True, text=True)
    return [l for l in out.stdout.splitlines() if (" _" + prefix) in l]


def check_build(root, build, kernel_lib):
    f = Findings()
    comps = load_manifest(root, f) or []
    for c in comps:
        name, lib = c["name"], c["library"]
        dylib = os.path.join(build, lib)
        if not os.path.isfile(dylib):
            f.add(name, "%s was not built into %s" % (lib, build))
            continue
        hdr = subprocess.run([tool("otool"), "-hv", dylib], capture_output=True, text=True).stdout
        if "DYLIB" not in hdr:
            f.add(name, "%s is not a dynamic library" % dylib)
        exported = defines_symbols(dylib, "forge_fcmat_") if name == "materials" else ["x"]
        if not exported:
            f.add(name, "%s exports none of its interface" % lib)
        for exe in ("forge_desktop", "forge_kernel_worker"):
            p = os.path.join(build, exe)
            if not os.path.isfile(p):
                f.add(name, "%s is not in %s" % (exe, build))
                continue
            if ("@rpath/" + lib) not in linked(p):
                f.add(name, "%s does not load @rpath/%s" % (exe, lib))
            if name == "materials" and defines_symbols(p, "forge_fcmat_"):
                f.add(name, "%s DEFINES the library's symbols -- it was compiled in statically" % exe)
        if kernel_lib:
            if any(lib in l for l in linked(kernel_lib)):
                f.add(name, "libforge_kernel_core loads %s" % lib)
            if name == "materials" and defines_symbols(kernel_lib, "forge_fcmat_"):
                f.add(name, "libforge_kernel_core defines the library's symbols")
    return f


def check_bundle(root, app):
    f = Findings()
    comps = load_manifest(root, f) or []
    for c in comps:
        name, lib = c["name"], c["library"]
        fw = os.path.join(app, "Contents", "Frameworks", lib)
        if not os.path.isfile(fw):
            f.add(name, "Forge.app/Contents/Frameworks/%s is missing" % lib)
        lic = os.path.join(app, "Contents", "Resources", "licenses", "freecad-derived", name)
        for leaf in ("COPYING.LGPL", "MODIFICATIONS.md", "README.md"):
            if not os.path.isfile(os.path.join(lic, leaf)):
                f.add(name, "the bundle ships the library without licenses/freecad-derived/%s/%s"
                      % (name, leaf))
        if os.path.isfile(os.path.join(lic, "COPYING.LGPL")) and \
                sha256(os.path.join(lic, "COPYING.LGPL")) != LGPL21_SHA256:
            f.add(name, "the bundled COPYING.LGPL is not the LGPL-2.1 text")
        exe = os.path.join(app, "Contents", "MacOS", "forge_desktop")
        if os.path.isfile(exe) and shutil.which("otool") and ("@rpath/" + lib) not in linked(exe):
            f.add(name, "the bundled forge_desktop does not load @rpath/%s" % lib)
    return f


# ── self-test ───────────────────────────────────────────────────────────────
def copy_tree(dst):
    for rel in (BASE_REL,):
        shutil.copytree(os.path.join(REPO, rel), os.path.join(dst, rel))
    for rel in (NOTICES_REL, LOCK_REL, DESKTOP_CMAKE_REL, KERNEL_CMAKE_REL, PACKAGER_REL,
                BUNDLE_VERIFY_REL):
        os.makedirs(os.path.dirname(os.path.join(dst, rel)), exist_ok=True)
        shutil.copyfile(os.path.join(REPO, rel), os.path.join(dst, rel))


def edit(path, old, new):
    with open(path, encoding="utf-8") as fh:
        s = fh.read()
    if old not in s:
        raise RuntimeError("self-test cannot apply its mutation to %s: %r not found" % (path, old))
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(s.replace(old, new))


def selftest():
    comp = BASE_REL + "/materials"
    card = comp + "/Resources/Materials/Standard/Metal/Steel/Steel-S235JR.FCMat"

    def m_rm(rel):
        return lambda t: os.remove(os.path.join(t, rel))

    def m_edit(rel, old, new):
        return lambda t: edit(os.path.join(t, rel), old, new)

    def m_append(rel, text):
        def go(t):
            with open(os.path.join(t, rel), "a", encoding="utf-8") as fh:
                fh.write(text)
        return go

    def m_extra(t):
        with open(os.path.join(t, comp, "Resources/Materials/Standard/Unrecorded.FCMat"), "w") as fh:
            fh.write("General:\n  UUID: \"x\"\n")

    def m_notice(t):
        p = os.path.join(t, NOTICES_REL)
        with open(p, encoding="utf-8") as fh:
            s = fh.read()
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(re.sub(r"^## freecad-materials .*?(?=^## |\Z)", "", s, flags=re.M | re.S))

    cases = [
        ("no licence text", m_rm(comp + "/COPYING.LGPL"), "COPYING.LGPL is missing"),
        ("no modifications record", m_rm(comp + "/MODIFICATIONS.md"), "MODIFICATIONS.md is missing"),
        ("a truncated licence", m_edit(comp + "/COPYING.LGPL", "That's all there is to it!", ""),
         "not the full, unmodified"),
        ("an undated modifications record", m_edit(comp + "/MODIFICATIONS.md", "## 2026-09-15", "## soon"),
         "no dated change"),
        ("a static library", m_edit(comp + "/CMakeLists.txt", "forge_fcmaterials SHARED", "forge_fcmaterials STATIC"),
         "SHARED"),
        ("a card edited without a record", m_edit(card, "7800 kg/m^3", "7850 kg/m^3"), "differs from its recorded import"),
        ("a non-LGPL card", m_edit(comp + "/component.json", "\"license\": \"LGPL-2.0-or-later\"",
                                   "\"license\": \"CC-BY-SA-4.0\""), "which is not LGPL"),
        ("an OCCT include", m_edit(comp + "/src/fcmat_bundle.cpp", "#include \"forge_fcmat/fcmat_bundle.h\"",
                                   "#include \"forge_fcmat/fcmat_bundle.h\"\n#include <TopoDS_Shape.hxx>"),
         "OCCT header"),
        ("a Qt include", m_edit(comp + "/src/fcmat_bundle.cpp", "#include \"forge_fcmat/fcmat_bundle.h\"",
                                "#include \"forge_fcmat/fcmat_bundle.h\"\n#include <QString>"), "Qt header"),
        ("no notice entry", m_notice, "notice entry"),
        ("derived sources compiled into the app", m_edit(DESKTOP_CMAKE_REL,
            "\"${CMAKE_CURRENT_SOURCE_DIR}/src/MaterialBundle.cpp\"\n    \"${CMAKE_CURRENT_SOURCE_DIR}/src/ForgeFrame.cpp\")\ntarget_include_directories(forge_desktop_core PUBLIC",
            "\"${CMAKE_CURRENT_SOURCE_DIR}/src/MaterialBundle.cpp\"\n    \"${FORGE_ROOT}/third_party/freecad-derived/materials/src/fcmat_bundle.cpp\"\n    \"${CMAKE_CURRENT_SOURCE_DIR}/src/ForgeFrame.cpp\")\ntarget_include_directories(forge_desktop_core PUBLIC"),
         "outside add_subdirectory"),
        ("the kernel linking it", m_append(KERNEL_CMAKE_REL, "\n# forge_fcmaterials\n"), "libforge_kernel_core"),
        ("an unrecorded file", m_extra, "not in component.json"),
        ("no manifest", m_rm(MANIFEST_REL), "MANIFEST.json is missing"),
        ("no SPDX header", m_edit(comp + "/include/forge_fcmat/fcmat_bundle.h",
                                  "/* SPDX-License-Identifier: LGPL-2.1-or-later */", "/* header */"),
         "no LGPL SPDX"),
        ("a packager that stages no licence files", m_edit(PACKAGER_REL, "freecad-derived", "fc-removed"),
         "does not handle the freecad-derived"),
    ]
    bad = 0
    with tempfile.TemporaryDirectory(prefix="fc_compliance_") as work:
        clean = os.path.join(work, "clean")
        copy_tree(clean)
        f = check_tree(clean)
        if f.items:
            print("[fc-compliance selftest] RED: the CLEAN copy is not compliant, so every case "
                  "below would pass for the wrong reason:")
            for i in f.items:
                print("    " + i)
            return 1
        print("[fc-compliance selftest] clean copy GREEN")
        for n, (label, mutate, expect) in enumerate(cases, 1):
            t = os.path.join(work, "case%d" % n)
            copy_tree(t)
            mutate(t)
            f = check_tree(t)
            hit = [i for i in f.items if expect in i]
            if not hit:
                bad += 1
                print("[fc-compliance selftest] case %d (%s) STAYED GREEN for %r; findings: %s"
                      % (n, label, expect, f.items))
            else:
                print("[fc-compliance selftest] case %d (%s): RED <- %s" % (n, label, hit[0]))
    if bad:
        print("[fc-compliance selftest] RED: %d case(s) did not fail" % bad)
        return 1
    print("[fc-compliance selftest] GREEN -- clean passes and all %d cases fail" % len(cases))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=REPO)
    ap.add_argument("--build")
    ap.add_argument("--kernel")
    ap.add_argument("--bundle")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.build:
        f = check_build(a.root, a.build, a.kernel)
        mode = "build %s" % a.build
    elif a.bundle:
        f = check_bundle(a.root, a.bundle)
        mode = "bundle %s" % a.bundle
    else:
        f = check_tree(a.root)
        mode = "tree"
    if f.items:
        print("[fc-compliance] RED (%s) -- %d finding(s):" % (mode, len(f.items)))
        for i in f.items:
            print("  - " + i)
        return 1
    print("[fc-compliance] GREEN (%s) -- every FreeCAD-derived component is a shared library "
          "with its licence, modifications record, notice and import record" % mode)
    return 0


if __name__ == "__main__":
    sys.exit(main())
