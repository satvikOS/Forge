#!/usr/bin/env python3
"""forge_deps_contract_test — gates three contracts of forge_deps.py itself.

drift_gate_test.sh proves `verify` detects drift. Nothing proved these:

  A  The module docstring is the WRITTEN CONTRACT for the lock's hash vocabulary.
     It described `"<sha256(file)>  <relpath>"` lines and said symlinks are
     neither followed nor hashed. tree_digest() has hashed `<digest>  <kind>
     <rel>` with resolved links since the empty-anchor-set fix. Anyone
     recomputing a fingerprint from the prose got a value `verify` can never
     match. This case computes the digest from the DOCUMENTED formula and
     asserts tree_digest agrees, then asserts the docstring still states it.

  B  `import-bundle --activate` checked only that the tar hashes to its own
     manifest, which proves the bundle is internally consistent and nothing
     more. A bundle exported for a different lock or triplet activated in
     silence, populating .forge-local/prefixes/<triplet> from a plane the
     repository never pinned.

  C  `TarFile.extract(..., filter=...)` is PEP 706 and the wrapper invokes a bare
     `python3`. On an interpreter without it, --activate raised TypeError after
     every check had passed. Tested by removing tarfile.data_filter, which is the
     attribute the feature-detection reads.

Run: python3 tools/deps/tests/forge_deps_contract_test.py
"""
import argparse
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # do not litter tools/deps/ with __pycache__

REPO = Path(__file__).resolve().parents[3]
TOOL = REPO / "tools" / "deps" / "forge_deps.py"
SCRATCH_MEMBER = "selfcheck-scratch"

PASS = 0
FAIL = 0


def ok(msg: str) -> None:
    global PASS
    PASS += 1
    print(f"  PASS  {msg}")


def bad(msg: str) -> None:
    global FAIL
    FAIL += 1
    print(f"  FAIL  {msg}")


def load_module():
    spec = importlib.util.spec_from_file_location("forge_deps_under_test", TOOL)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


# ── A. the docstring's definition is the one tree_digest implements ──────────
def case_a(fd, tmp: Path) -> None:
    root = tmp / "prefix"
    (root / "include").mkdir(parents=True)
    (root / "lib").mkdir()
    (root / "include" / "version.hpp").write_bytes(b"#define V 1\n")
    (root / "lib" / "libreal.1.dylib").write_bytes(b"MACHO-ish\n")
    os.symlink("libreal.1.dylib", root / "lib" / "libreal.dylib")     # resolves
    os.symlink("gone.dylib", root / "lib" / "libmissing.dylib")       # dangles

    got = fd.tree_digest(root, ["include/*.hpp", "lib/*.dylib"])

    # Recomputed from the DOCUMENTED formula, not from tree_digest's internals.
    entries = [
        ("include/version.hpp", "file", sha256_bytes(b"#define V 1\n")),
        ("lib/libmissing.dylib", "dangling", sha256_bytes(b"gone.dylib")),
        ("lib/libreal.1.dylib", "file", sha256_bytes(b"MACHO-ish\n")),
        ("lib/libreal.dylib", "link", sha256_bytes(b"MACHO-ish\n")),
    ]
    entries.sort(key=lambda e: e[0].encode())
    want = sha256_bytes(
        "".join(f"{dig}  {kind}  {rel}\n" for rel, kind, dig in entries).encode())

    if got.get("sha256") == want:
        ok("A: tree_digest matches the documented <digest>  <kind>  <relpath> formula")
    else:
        bad(f"A: tree_digest {got.get('sha256')} != documented formula {want}")
    if got.get("files") == 2 and got.get("links") == 2:
        ok("A2: file and link counts are recorded separately (2 files, 2 links)")
    else:
        bad(f"A2: counts are {got.get('files')} files / {got.get('links')} links, want 2/2")

    doc = fd.__doc__ or ""
    required = ['"<digest>  <kind>  <relpath>"', "file | link | dangling"]
    missing = [r for r in required if r not in doc]
    forbidden = ['"<sha256(file)>  <relpath>"', "Symlinks are NOT followed"]
    present = [f for f in forbidden if f in doc]
    if not missing and not present:
        ok("A3: the module docstring states the definition the code implements")
    else:
        bad(f"A3: docstring missing {missing} / still claims {present}")


# ── shared bundle fixture ────────────────────────────────────────────────────
def make_bundle(fd, tmp: Path, name: str, lock_sha: str, triplet: str) -> Path:
    out = tmp / name
    with tarfile.open(out, "w:gz") as tf:
        tf.add(fd.LOCK, arcname="deps.lock.json")
        data = b"marker\n"
        ti = tarfile.TarInfo(f"forge-local/{SCRATCH_MEMBER}/marker.txt")
        ti.size = len(data)
        tf.addfile(ti, io.BytesIO(data))
    manifest = {
        "bundle_sha256": fd.sha256_file(out),
        "bundle_bytes": out.stat().st_size,
        "lock_sha256": lock_sha,
        "triplet": triplet,
        "members": [SCRATCH_MEMBER],
        "absolute_symlinks": [],
    }
    Path(str(out) + ".manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return out


def run_tool(*argv: str):
    return subprocess.run([sys.executable, str(TOOL), *argv],
                          capture_output=True, text=True)


# ── B. --activate must refuse a bundle this repository does not pin ──────────
def case_b(fd, tmp: Path) -> None:
    real_lock = fd.sha256_file(fd.LOCK)
    real_triplet = json.loads(fd.LOCK.read_text())["triplet"]

    wrong_lock = make_bundle(fd, tmp, "wrong-lock.tgz", "0" * 64, real_triplet)
    r = run_tool("import-bundle", "--input", str(wrong_lock), "--activate")
    if r.returncode != 0 and "does not pin" in (r.stdout + r.stderr):
        ok("B: --activate refuses a bundle exported for a different deps.lock.json")
    else:
        bad(f"B: --activate accepted a foreign lock (rc={r.returncode})")

    wrong_trip = make_bundle(fd, tmp, "wrong-triplet.tgz", real_lock, "solaris-vax")
    r = run_tool("import-bundle", "--input", str(wrong_trip), "--activate")
    if r.returncode != 0 and "triplet" in (r.stdout + r.stderr):
        ok("B2: --activate refuses a bundle built for a different triplet")
    else:
        bad(f"B2: --activate accepted a foreign triplet (rc={r.returncode})")

    # and the check is not simply "always refuse": a matching bundle verifies.
    good = make_bundle(fd, tmp, "matching.tgz", real_lock, real_triplet)
    r = run_tool("import-bundle", "--input", str(good), "--verify-only")
    if r.returncode == 0 and "lock sha256 OK" in r.stdout:
        ok("B3: a bundle that matches the lock and the triplet still verifies clean")
    else:
        bad(f"B3: a matching bundle was refused (rc={r.returncode}) {r.stdout}{r.stderr}")


# ── C. --activate must refuse an interpreter with no PEP 706 filter ──────────
def case_c(fd, tmp: Path) -> None:
    real_lock = fd.sha256_file(fd.LOCK)
    real_triplet = json.loads(fd.LOCK.read_text())["triplet"]
    good = make_bundle(fd, tmp, "filter-probe.tgz", real_lock, real_triplet)
    args = argparse.Namespace(input=str(good), verify_only=False, activate=True)

    saved = getattr(tarfile, "data_filter", None)
    if saved is None:
        bad("C: this interpreter has no tarfile.data_filter, so the case cannot run")
        return
    del tarfile.data_filter
    try:
        rc = fd.cmd_import_bundle(args)
    finally:
        tarfile.data_filter = saved
    if rc != 0:
        ok("C: --activate refuses an interpreter whose tarfile has no PEP 706 filter")
    else:
        bad("C: --activate extracted with no PEP 706 extraction filter available")


def main() -> int:
    fd = load_module()
    with tempfile.TemporaryDirectory(prefix="forge_deps_contract.") as td:
        tmp = Path(td)
        case_a(fd, tmp / "a")
        case_b(fd, tmp)
        case_c(fd, tmp)
    # A run that REFUSES writes nothing; a reverted fix does. Say so either way.
    leaked = fd.LOCAL / SCRATCH_MEMBER
    if leaked.exists():
        shutil.rmtree(leaked)
        bad(f"cleanup: {leaked} was extracted and had to be removed")
    print()
    print(f"[forge_deps_contract] {PASS} passed, {FAIL} failed")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
