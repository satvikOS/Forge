#!/usr/bin/env python3
"""forge_deps — the local, pinned, offline dependency plane (Sacrosanct 3.1 s10.6 / s21.2).

The repository is the reproducibility control plane; `.forge-local/` is the workstation
execution plane.  `third_party/manifest/deps.lock.json` is the LOCK: it records, per
dependency, the exact upstream revision, the archive hash (or an explicit null + reason —
never a fabricated one), the enabled features, the patches, and the expected artifact
fingerprint of the activated prefix.  This tool is the only thing that reads or writes it.

Hash vocabulary (kept explicit everywhere, because the two are NOT interchangeable):

  upstream_archive_sha256   sha256 of the UPSTREAM SOURCE ARCHIVE named by `upstream.url`.
                            Authoritative for provenance.  Recorded only when it can be
                            read from a real source (the homebrew-core formula for the
                            exact installed version, or a source archive present in the
                            local mirror).  Otherwise null + `archive_sha256_reason`.

  installed_tree_sha256     sha256 over the CONTENT OF THE INSTALLED PREFIX on this
                            workstation.  Definition (stable, reproducible), and it is
                            the ONE this file implements - see tree_digest():
                              lines  = ["<digest>  <kind>  <relpath>" for every entry
                                        matching verify_globs, relpath sorted bytewise;
                                        kind is one of file | link | dangling]
                              digest = sha256("".join(line + "\\n" for line in lines))
                            A symlink IS followed: one resolving to a regular file is
                            hashed as its TARGET'S CONTENT with kind `link`, and a
                            dangling one is hashed as its literal target string with kind
                            `dangling`.  Skipping links made an anchor set of exactly the
                            names a linker opens (libvulkan.dylib, glslangValidator) hash
                            to sha256("") - a fingerprint that can never fail.  File and
                            link counts are recorded separately.  This is an ARTIFACT
                            fingerprint, not a provenance hash - it changes when the
                            compiler/bottle changes.

  installed_anchor_sha256   the same construction over a small `anchor_globs` set (version
                            headers + the toolkits actually linked).  Cheap enough to run
                            on every configure; `--full` upgrades to the whole tree.

Commands
  hash <name>...            compute the fingerprints for installed prefixes (lock authoring)
  resolve                   apply the prefix resolution order, write deps.resolved.json
  verify [--full] [--quiet] compare installed reality against the lock; nonzero exit on drift
  notices                   regenerate third_party/notices/NOTICES.md from real LICENSE files
  lint-network              fail if any CMake file reaches the network at configure time
  seed                      ONLINE_SEED: populate the local mirror (refuses when offline)
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOCK = REPO / "third_party" / "manifest" / "deps.lock.json"
RESOLVED = REPO / "third_party" / "manifest" / "deps.resolved.json"
LOCAL = REPO / ".forge-local"


# ---------------------------------------------------------------- ANSI (off when not a tty)
def _c(code: str, s: str) -> str:
    return s if not sys.stderr.isatty() else f"\033[{code}m{s}\033[0m"


def warn(s: str) -> None:
    print(_c("33", "WARNING: ") + s, file=sys.stderr)


def err(s: str) -> None:
    print(_c("31", "ERROR:   ") + s, file=sys.stderr)


def info(s: str) -> None:
    print("         " + s, file=sys.stderr)


# ---------------------------------------------------------------- hashing
def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _match_any(rel: str, globs: list[str]) -> bool:
    return any(fnmatch.fnmatch(rel, g) for g in globs)


def tree_digest(root: Path, globs: list[str]) -> dict:
    """The stable prefix fingerprint defined in the module docstring.

    Symlinks are RESOLVED and their target content is hashed, tagged `link`. Homebrew
    ships the names a linker actually opens as symlinks (libvulkan.dylib ->
    libvulkan.1.dylib -> libvulkan.1.4.350.dylib; glslangValidator -> glslang), so
    skipping them made an anchor set of exactly those names hash to the digest of the
    empty string — a fingerprint that can never fail. A dangling link is hashed as its
    literal target string, tagged `dangling`, so a broken prefix is drift, not silence.
    """
    if root is None or not root.is_dir():
        return {"sha256": None, "files": 0, "links": 0, "bytes": 0, "matched": 0,
                "reason": f"prefix does not exist: {root}"}
    entries: list[tuple[str, str, str, int]] = []  # rel, kind, digest, bytes
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        for name in sorted(filenames):
            p = Path(dirpath) / name
            rel = str(p.relative_to(root))
            if not _match_any(rel, globs):
                continue
            if p.is_symlink():
                if p.is_file():          # resolves to a regular file
                    entries.append((rel, "link", sha256_file(p), p.stat().st_size))
                else:
                    tgt = os.readlink(p)
                    entries.append((rel, "dangling",
                                    hashlib.sha256(tgt.encode()).hexdigest(), 0))
            elif p.is_file():
                entries.append((rel, "file", sha256_file(p), p.stat().st_size))
    entries.sort(key=lambda t: t[0].encode())
    h = hashlib.sha256()
    total = 0
    for rel, kind, digest, size in entries:
        total += size
        h.update(f"{digest}  {kind}  {rel}\n".encode())
    nfile = sum(1 for e in entries if e[1] == "file")
    nlink = len(entries) - nfile
    if not entries:
        # A gate that cannot fail is not a passing gate.
        return {"sha256": None, "files": 0, "links": 0, "bytes": 0, "matched": 0,
                "reason": f"no entry under {root} matched {globs} — an empty glob set "
                          "would otherwise fingerprint as sha256(\"\") and always pass"}
    return {"sha256": h.hexdigest(), "files": nfile, "links": nlink,
            "bytes": total, "matched": len(entries)}


# ---------------------------------------------------------------- lock io
def load_lock() -> dict:
    if not LOCK.exists():
        err(f"lock not found: {LOCK}")
        sys.exit(2)
    return json.loads(LOCK.read_text())


# ---------------------------------------------------------------- prefix resolution
def brew_prefix() -> str | None:
    exe = shutil.which("brew")
    if not exe and Path("/opt/homebrew/bin/brew").exists():
        exe = "/opt/homebrew/bin/brew"
    if not exe and Path("/usr/local/bin/brew").exists():
        exe = "/usr/local/bin/brew"
    if not exe:
        return None
    try:
        return subprocess.run([exe, "--prefix"], capture_output=True, text=True,
                              timeout=20, check=True).stdout.strip()
    except Exception:
        return None


def resolve_prefix(dep: dict, triplet: str) -> tuple[Path | None, str, str | None]:
    """Resolution order.  Returns (prefix, source_label, warning_or_None).

    The whole point of this function is that the machine-global Homebrew prefix is the
    LAST resort and is never silent.
    """
    name = dep["name"]
    env_key = "FORGE_DEPS_PREFIX_" + name.upper().replace("-", "_")
    marker = dep.get("layout", {}).get("presence_marker")

    def ok(p: Path) -> bool:
        return (p / marker).exists() if marker else p.is_dir()

    # 1. explicit per-dependency override. FIRST, deliberately: an operator naming a
    #    prefix is an explicit instruction and must beat anything discovered. When this
    #    ranked BELOW the activated prefix, an activated prefix silently swallowed every
    #    override — which is how the drift test found it (both drift cases reported OK).
    if os.environ.get(env_key):
        p = Path(os.environ[env_key])
        return p, f"env:{env_key}", (
            None if ok(p) else f"{name}: {env_key}={p} does not contain {marker}")

    # 2. activated immutable prefix inside the workstation execution plane
    act = LOCAL / "prefixes" / triplet
    if act.is_dir():
        for build in sorted(act.iterdir()):
            cand = build / name
            if cand.is_dir() and ok(cand):
                return cand, f"forge-local-prefix({build.name})", None

    # 3. a mirror root holding every activated dependency
    root = os.environ.get("FORGE_DEPS_ROOT")
    if root and (Path(root) / name).is_dir():
        return Path(root) / name, "env:FORGE_DEPS_ROOT", None

    # 4. LAST RESORT — the machine-global / workspace prefix named by the lock.
    #    Templates keep machine-absolute paths OUT of Git: {brew_prefix} is resolved by
    #    asking brew, {repo} by this file's own location.
    sysp = dep.get("installed", {}).get("system_prefix_template")
    if sysp:
        if "{repo}" in sysp:
            p = Path(sysp.replace("{repo}", str(REPO)))
            if ok(p):
                return p, "repo-workspace", None
            # a worktree has no node_modules of its own; the main checkout may
            for env_root in ("FORGE_NODE_MODULES",):
                if os.environ.get(env_root):
                    q = Path(os.environ[env_root]) / name
                    if ok(q):
                        return q, f"env:{env_root}", (
                            f"{name}: resolved from {env_root}={q} outside this "
                            "worktree — not part of the pinned local plane.")
        elif "{brew_prefix}" in sysp:
            bp = brew_prefix()
            if bp:
                p = Path(sysp.replace("{brew_prefix}", bp))
                if ok(p):
                    return p, "system-fallback(homebrew)", (
                        f"{name}: resolved from the MACHINE-GLOBAL Homebrew prefix {p}. "
                        "This build is NOT reproducible on a clean machine. Seed the "
                        f"local mirror (tools/deps/seed) or set {env_key}.")
        elif ok(Path(sysp)):
            return Path(sysp), "system-fallback(absolute)", (
                f"{name}: resolved from the absolute system path {sysp}.")
    return None, "unresolved", (
        f"{name}: no prefix resolved (tried {env_key}, .forge-local/prefixes/{triplet}, "
        f"FORGE_DEPS_ROOT, then the system prefix template {sysp!r}).")


def dep_prefix(dep: dict, triplet: str) -> tuple[Path | None, str, str | None]:
    if dep["source"]["kind"] == "vendored":
        return REPO / dep["source"]["path"], "vendored", None
    return resolve_prefix(dep, triplet)


def _dep_version_from_prefix(dep: dict, prefix: Path | None) -> str | None:
    """Read the real version out of the installed tree (never trust the path name)."""
    probe = dep.get("layout", {}).get("version_probe")
    if not probe or prefix is None:
        return None
    f = prefix / probe["file"]
    if not f.exists():
        return None
    m = re.search(probe["regex"], f.read_text(errors="replace"))
    return m.group(1) if m else None


# ---------------------------------------------------------------- commands
def cmd_fingerprint(args) -> int:
    lock = load_lock()
    triplet = lock["triplet"]
    names = args.names or [d["name"] for d in lock["dependencies"]]
    out = {}
    for dep in lock["dependencies"]:
        if dep["name"] not in names:
            continue
        root, src, w = dep_prefix(dep, triplet)
        if w:
            warn(w)
        if root is None:
            out[dep["name"]] = {"error": "unresolved"}
            print(f"{dep['name']:16s} UNRESOLVED")
            continue
        lay = dep["layout"]
        full = tree_digest(root, lay["verify_globs"])
        anch = tree_digest(root, lay.get("anchor_globs", lay["verify_globs"]))
        out[dep["name"]] = {"prefix": str(root), "prefix_source": src,
                            "installed_tree_sha256": full,
                            "installed_anchor_sha256": anch}
        for label, d in (("tree", full), ("anch", anch)):
            if d["sha256"] is None:
                err(f"{dep['name']:16s} {label}=NONE — {d.get('reason')}")
            else:
                print(f"{dep['name']:16s} {label}={d['sha256']} "
                      f"({d['files']}f/{d['links']}l, {d['bytes']}B)")
        if args.write_lock:
            fp = {}
            for key, d in (("installed_tree_sha256", full),
                           ("installed_anchor_sha256", anch)):
                fp[key] = {"sha256": d["sha256"], "files": d["files"],
                           "links": d["links"], "bytes": d["bytes"]}
                if d["sha256"] is None:
                    fp[key]["reason"] = d.get("reason")
            fp["computed_from_prefix_source"] = src
            dep["fingerprint"] = fp
    if args.json:
        Path(args.json).write_text(json.dumps(out, indent=2) + "\n")
    if args.write_lock:
        LOCK.write_text(json.dumps(lock, indent=2) + "\n")
        print(f"updated {LOCK.relative_to(REPO)}")
    return 0


def cmd_resolve(args) -> int:
    lock = load_lock()
    triplet = lock["triplet"]
    resolved = {
        "$comment": "GENERATED by tools/deps/forge_deps.py resolve. Records the exact "
                    "realized build and host facts. It never edits deps.lock.json.",
        "lock_sha256": sha256_file(LOCK),
        "triplet": triplet,
        "host": {"sysname": os.uname().sysname, "machine": os.uname().machine,
                 "release": os.uname().release},
        "toolchain": {},
        "dependencies": {},
    }
    for tool, argv in (("cmake", ["cmake", "--version"]),
                       ("ninja", ["ninja", "--version"]),
                       ("node", ["node", "--version"]),
                       ("ccache", ["ccache", "--version"])):
        exe = shutil.which(tool)
        ver = None
        if exe:
            try:
                ver = subprocess.run(argv, capture_output=True, text=True,
                                     timeout=20).stdout.strip().splitlines()[0]
            except Exception:
                ver = None
        resolved["toolchain"][tool] = {"path": exe, "version": ver}

    rc = 0
    for dep in lock["dependencies"]:
        prefix, src, w = dep_prefix(dep, triplet)
        if w:
            (warn if prefix is not None else err)(w)
            if prefix is None:
                rc = 1
        resolved["dependencies"][dep["name"]] = {
            "prefix": str(prefix) if prefix else None,
            "prefix_source": src,
            "locked_version": dep["version"],
            "found_version": _dep_version_from_prefix(dep, prefix),
        }
    RESOLVED.write_text(json.dumps(resolved, indent=2) + "\n")
    print(f"wrote {RESOLVED.relative_to(REPO)}")
    for n, d in resolved["dependencies"].items():
        print(f"  {n:16s} {d['prefix_source']:30s} "
              f"locked={d['locked_version']} found={d['found_version']}")
    return rc


def cmd_verify(args) -> int:
    lock = load_lock()
    triplet = lock["triplet"]
    drift: list[str] = []
    checked = 0
    for dep in lock["dependencies"]:
        name = dep["name"]
        prefix, src, w = dep_prefix(dep, triplet)
        if prefix is None:
            drift.append(f"{name}: UNRESOLVED — {w}")
            continue
        if w and not args.quiet:
            warn(w)
        # 1. version drift.  `expect` lets a probe whose native spelling differs from the
        #    dotted version (boost's "1_90") still be an exact, failing-capable check.
        probe = dep.get("layout", {}).get("version_probe") or {}
        want_ver = probe.get("expect", dep["version"])
        found = _dep_version_from_prefix(dep, prefix)
        if found is not None and found != want_ver:
            drift.append(f"{name}: version drift — lock {want_ver} but installed "
                         f"{found} at {prefix}")
        # 2. fingerprint drift
        lay = dep["layout"]
        key = "installed_tree_sha256" if args.full else "installed_anchor_sha256"
        globs = lay["verify_globs"] if args.full else lay.get("anchor_globs",
                                                              lay["verify_globs"])
        expected = dep.get("fingerprint", {}).get(key, {}).get("sha256")
        actual = tree_digest(prefix, globs)
        checked += 1
        if expected is None:
            drift.append(f"{name}: lock has no {key} — cannot verify (run "
                         f"`tools/deps/forge_deps.py fingerprint {name} --write-lock`)")
        elif actual["sha256"] is None:
            drift.append(f"{name}: {key} could not be computed — {actual.get('reason')}")
        elif actual["sha256"] != expected:
            drift.append(f"{name}: {key} DRIFT\n"
                         f"      lock      {expected}\n"
                         f"      installed {actual['sha256']}  "
                         f"({actual['files']} files at {prefix})")
        elif not args.quiet:
            print(f"  OK  {name:16s} {key:24s} {actual['sha256'][:16]}… "
                  f"({actual['files']}f/{actual['links']}l) via {src}")
        # 3. patch drift — the recorded edits must still be present in the vendored tree
        for patch in dep.get("patches", []):
            for check in patch.get("content_checks", []):
                f = REPO / check["file"]
                if not f.exists():
                    drift.append(f"{name}: patch check target missing: {check['file']}")
                    continue
                text = f.read_text(errors="replace")
                for needle in check.get("must_contain", []):
                    if needle not in text:
                        drift.append(f"{name}: PATCH DRIFT — {check['file']} no longer "
                                     f"contains {needle!r}")
                for needle in check.get("must_not_contain", []):
                    if needle in text:
                        drift.append(f"{name}: PATCH DRIFT — {check['file']} contains the "
                                     f"un-patched upstream line {needle!r} again")
    print()
    if drift:
        err(f"dependency drift: {len(drift)} finding(s)")
        for d in drift:
            print("  - " + d, file=sys.stderr)
        return 1
    print(f"deps verify: OK — {checked} dependency prefix(es) match the lock "
          f"({'full tree' if args.full else 'anchor set'}).")
    return 0


def cmd_notices(args) -> int:
    lock = load_lock()
    triplet = lock["triplet"]
    out = [
        "# Third-party source-use and attribution records",
        "",
        "GENERATED by `tools/deps/forge_deps.py notices` — do not edit by hand.",
        "Every entry is read from the LOCK and, where a license file exists in the",
        "resolved prefix, hashed from that real file on disk. Nothing here is",
        "transcribed from memory; a license text that is not on disk is reported as",
        "an INCOMPLETE record rather than reconstructed.",
        "",
        f"- Lock: `third_party/manifest/deps.lock.json` (sha256 `{sha256_file(LOCK)}`)",
        f"- Triplet: `{triplet}`",
        "",
    ]
    missing = 0
    for dep in lock["dependencies"]:
        prefix, _, _ = dep_prefix(dep, triplet)
        up = dep["upstream"].get("url") or dep["upstream"].get("repository") or "n/a"
        out += [f"## {dep['name']} {dep['version']}", "",
                f"- SPDX: `{dep['license']['spdx']}`",
                f"- Upstream: {up}",
                f"- Linkage: {dep['license']['linkage']}",
                f"- Used for: {dep['purpose']}"]
        lic = dep["license"].get("file_in_prefix")
        if lic and prefix is not None and (prefix / lic).exists():
            p = prefix / lic
            out.append(f"- License text: `{lic}` in the resolved prefix "
                       f"(sha256 `{sha256_file(p)}`, {p.stat().st_size} bytes)")
        elif lic:
            missing += 1
            out.append(f"- License text: **NOT FOUND** at `{lic}` in the resolved "
                       "prefix — attribution record INCOMPLETE")
        else:
            out.append(f"- License text: {dep['license'].get('note', 'not recorded')}")
        out.append("")
    dest = REPO / "third_party" / "notices" / "NOTICES.md"
    dest.write_text("\n".join(out))
    print(f"wrote {dest.relative_to(REPO)} ({len(lock['dependencies'])} entries, "
          f"{missing} incomplete)")
    return 1 if (missing and args.strict) else 0


NETWORK_PATTERNS = [
    ("file-download", "file(DOWNLOAD"),
    ("fetchcontent-declare", "FetchContent_Declare("),
    ("fetchcontent-makeavailable", "FetchContent_MakeAvailable("),
    ("fetchcontent-populate", "FetchContent_Populate("),
    ("externalproject", "ExternalProject_Add("),
    ("git-clone", "git clone"),
    ("curl", "COMMAND curl"),
    ("wget", "COMMAND wget"),
]


def cmd_lint_network(args) -> int:
    """A configure-time fetch is a reproducibility hole. This is the repo-wide gate."""
    roots = [REPO / "forge-kernel", REPO / "third_party", REPO / "tools"]
    # ForgeDeps.cmake is the GUARD: it necessarily spells every pattern it hunts for,
    # in its own pattern table and inside the FATAL_ERROR text of each override. Those
    # are string literals, not calls. Excluded by name so the exclusion is visible, and
    # mirrored exactly by forge_deps_lint_network() in that file.
    guard = REPO / "forge-kernel" / "cmake" / "ForgeDeps.cmake"
    hits = []
    scanned = 0
    skipped_guard = 0
    for root in roots:
        if not root.is_dir():
            continue
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            if p.name != "CMakeLists.txt" and p.suffix != ".cmake":
                continue
            parts = p.parts
            if ".forge-local" in parts or "build" in parts or "node_modules" in parts:
                continue
            if p == guard:
                skipped_guard += 1
                continue
            scanned += 1
            for lineno, line in enumerate(p.read_text(errors="replace").splitlines(), 1):
                if line.lstrip().startswith("#"):
                    continue
                if "FORGE_NETWORK_LINT_ALLOW" in line:
                    continue
                for label, needle in NETWORK_PATTERNS:
                    if needle in line:
                        hits.append((str(p.relative_to(REPO)), lineno, label,
                                     line.strip()))
    print(f"lint-network: scanned {scanned} CMake file(s) under "
          f"forge-kernel/, third_party/, tools/ "
          f"(guard module ForgeDeps.cmake excluded: {skipped_guard})")
    if hits:
        err(f"{len(hits)} configure-time network primitive(s) found:")
        for f, n, label, line in hits:
            print(f"  {f}:{n}: [{label}] {line}", file=sys.stderr)
        return 1
    print("lint-network: OK — no configure-time fetch primitive in any CMake file.")
    return 0


def cmd_seed(args) -> int:
    """ONLINE_SEED. Obtain exactly the missing pinned artifacts and verify their hashes."""
    if os.environ.get("FORGE_NETWORK", "OFF").upper() == "OFF" and not args.allow_network:
        err("FORGE_NETWORK=OFF — seeding is an ONLINE operation and is refused.")
        info("Re-run with FORGE_NETWORK=ON --allow-network to populate the mirror.")
        return 3
    lock = load_lock()
    mirror = LOCAL / "sources"
    mirror.mkdir(parents=True, exist_ok=True)
    todo = []
    for dep in lock["dependencies"]:
        if dep["source"]["kind"] != "archive":
            continue
        url = dep["upstream"].get("url")
        want = dep["upstream"].get("archive_sha256")
        dest = mirror / dep["name"] / dep["version"] / Path(url).name
        if dest.exists() and want and sha256_file(dest) == want:
            print(f"  present  {dep['name']} {dep['version']}")
            continue
        if want is None:
            err(f"{dep['name']}: the lock records archive_sha256=null "
                f"({dep['upstream'].get('archive_sha256_reason')}). Refusing to seed an "
                "artifact whose identity cannot be verified.")
            return 1
        todo.append((dep, url, want, dest))
    if not todo:
        print("seed: mirror already complete for every archive dependency.")
        return 0
    print(f"seed: {len(todo)} archive(s) to fetch")
    for dep, url, want, dest in todo:
        print(f"  fetch {dep['name']} {dep['version']} <- {url}")
        if args.dry_run:
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-fL", "--proto", "=https", "-o", str(dest), url],
                       check=True)
        got = sha256_file(dest)
        if got != want:
            dest.unlink()
            err(f"{dep['name']}: archive hash mismatch — lock {want} got {got}. Discarded.")
            return 1
        print(f"    verified {got}")
    return 0


def _bundle_members(triplet: str) -> list[Path]:
    out = []
    for rel in (f"prefixes/{triplet}", "sources"):
        p = LOCAL / rel
        if p.is_dir():
            out.append(p)
    return out


def cmd_export_bundle(args) -> int:
    """Export the activated local plane so another machine can build offline.

    The bundle is a tar of the lock plus the activated prefixes and source mirror,
    alongside a manifest that records the sha256 of the tar and of the lock. Symlinks
    are stored as links, never dereferenced, so an 'activated prefix' that is really a
    symlink into a machine-global Cellar is exported as a DANGLING link on the target
    machine — and import-bundle says so instead of pretending the bundle is complete.
    """
    import tarfile
    lock = load_lock()
    triplet = lock["triplet"]
    members = _bundle_members(triplet)
    if not members:
        err(f"nothing to export: neither .forge-local/prefixes/{triplet} nor "
            ".forge-local/sources exists. Seed and activate first.")
        return 1
    out = Path(args.output).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    dangling = []
    with tarfile.open(out, "w:gz") as tf:
        tf.add(LOCK, arcname="deps.lock.json")
        for m in members:
            for p in sorted(m.rglob("*")):
                arc = "forge-local/" + str(p.relative_to(LOCAL))
                if p.is_symlink():
                    tgt = os.readlink(p)
                    if os.path.isabs(tgt):
                        dangling.append((arc, tgt))
                tf.add(p, arcname=arc, recursive=False)
            tf.add(m, arcname="forge-local/" + str(m.relative_to(LOCAL)),
                   recursive=False)
    digest = sha256_file(out)
    manifest = {
        "bundle_sha256": digest,
        "bundle_bytes": out.stat().st_size,
        "lock_sha256": sha256_file(LOCK),
        "triplet": triplet,
        "members": [str(m.relative_to(LOCAL)) for m in members],
        "absolute_symlinks": [{"path": a, "target": t} for a, t in dangling],
    }
    mpath = out.with_suffix(out.suffix + ".manifest.json")
    mpath.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"export-bundle: wrote {out} ({out.stat().st_size} bytes)")
    print(f"               sha256 {digest}")
    print(f"               manifest {mpath}")
    if dangling:
        warn(f"{len(dangling)} entr(ies) in this bundle are ABSOLUTE symlinks into this "
             "machine's filesystem. On another machine they will dangle — the bundle is "
             "NOT self-contained. Activate real prefixes, not links, before exporting.")
        for a, t in dangling[:10]:
            info(f"  {a} -> {t}")
    return 0


def cmd_import_bundle(args) -> int:
    import tarfile
    src = Path(args.input).resolve()
    if not src.exists():
        err(f"bundle not found: {src}")
        return 2
    mpath = src.with_suffix(src.suffix + ".manifest.json")
    if not mpath.exists():
        err(f"bundle manifest not found: {mpath}. A bundle without its manifest cannot "
            "be verified and is refused.")
        return 2
    manifest = json.loads(mpath.read_text())
    got = sha256_file(src)
    if got != manifest["bundle_sha256"]:
        err(f"bundle hash mismatch — manifest {manifest['bundle_sha256']} got {got}")
        return 1
    print(f"import-bundle: {src.name} sha256 OK ({got})")
    # bundle_sha256 only proves the tar is INTERNALLY consistent. It says nothing about
    # whether this bundle is the plane THIS repository pins. Without the two checks below
    # a bundle exported for a different lock, or for a different triplet, activated in
    # silence and .forge-local/prefixes/<triplet> was then populated from a plane the lock
    # never named -- the exact drift the lock exists to make impossible.
    lock = load_lock()
    repo_lock_sha = sha256_file(LOCK)
    mismatch = []
    if manifest.get("lock_sha256") != repo_lock_sha:
        mismatch.append(f"lock sha256: bundle {manifest.get('lock_sha256')}, "
                        f"repo {repo_lock_sha}")
    if manifest.get("triplet") != lock["triplet"]:
        mismatch.append(f"triplet: bundle {manifest.get('triplet')!r}, "
                        f"lock {lock['triplet']!r}")
    if mismatch:
        for m in mismatch:
            err(f"bundle does not match this repository - {m}")
        if args.activate:
            # --verify-only is an INSPECTION and still answers; --activate writes, and
            # writing this plane would populate .forge-local/prefixes/<triplet> from a
            # plane the lock never named.
            err("refusing to ACTIVATE a plane this repository does not pin.")
            return 1
        warn("--verify-only: reporting the mismatch rather than refusing; --activate "
             "would refuse.")
    else:
        print(f"               lock sha256 OK ({repo_lock_sha}), triplet {lock['triplet']}")
    with tarfile.open(src, "r:gz") as tf:
        names = tf.getnames()
        print(f"               {len(names)} member(s), triplet {manifest['triplet']}")
        if manifest.get("absolute_symlinks"):
            warn(f"{len(manifest['absolute_symlinks'])} member(s) are absolute symlinks "
                 "into the EXPORTING machine's filesystem; they will dangle here.")
        if args.verify_only:
            print("               --verify-only: nothing extracted.")
            return 0
        if not args.activate:
            err("pass --verify-only or --activate.")
            return 2
        # `filter=` on TarFile.extract is PEP 706, and the wrapper invokes a bare `python3`.
        # On an interpreter without it the call raises TypeError AFTER the checks above have
        # passed, so the operator sees a traceback rather than a refusal. Feature-detect
        # instead of comparing versions: PEP 706 was backported, so the version matrix is
        # 3.12+, 3.11.4+, 3.10.12+, 3.9.17+, 3.8.17+, 3.7.17+, and `data_filter` appears in
        # exactly the releases that carry the parameter.
        if not hasattr(tarfile, "data_filter"):
            err("this interpreter's tarfile has no PEP 706 extraction filter "
                f"(python {sys.version.split()[0]}; needs 3.12+, or 3.11.4 / 3.10.12 / "
                "3.9.17 / 3.8.17 / 3.7.17). Refusing to extract an archive unfiltered.")
            return 1
        LOCAL.mkdir(parents=True, exist_ok=True)
        for m in tf.getmembers():
            if m.name.startswith("forge-local/"):
                m.name = m.name[len("forge-local/"):]
                tf.extract(m, path=LOCAL, filter="tar")
    print(f"               activated into {LOCAL}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(prog="forge_deps", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("fingerprint", aliases=["hash"],
                       help="compute installed-prefix fingerprints (lock authoring)")
    p.add_argument("names", nargs="*")
    p.add_argument("--json", help="also write the raw result here")
    p.add_argument("--write-lock", action="store_true",
                   help="write the computed fingerprints back into deps.lock.json")
    p.set_defaults(fn=cmd_fingerprint)

    p = sub.add_parser("resolve", help="write deps.resolved.json")
    p.set_defaults(fn=cmd_resolve)

    p = sub.add_parser("verify", help="compare installed reality against the lock")
    p.add_argument("--full", action="store_true",
                   help="hash the whole verify_globs tree, not just the anchor set")
    p.add_argument("--quiet", action="store_true")
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser("notices", help="regenerate third_party/notices/NOTICES.md")
    p.add_argument("--strict", action="store_true",
                   help="exit nonzero when a license file is missing")
    p.set_defaults(fn=cmd_notices)

    p = sub.add_parser("lint-network", help="fail on configure-time fetch primitives")
    p.set_defaults(fn=cmd_lint_network)

    p = sub.add_parser("seed", help="ONLINE_SEED the local source mirror")
    p.add_argument("--lock", help="accepted for the Sacrosanct command signature")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--allow-network", action="store_true")
    p.set_defaults(fn=cmd_seed)

    p = sub.add_parser("export-bundle", help="export the activated local plane")
    p.add_argument("--output", required=True)
    p.set_defaults(fn=cmd_export_bundle)

    p = sub.add_parser("import-bundle", help="verify and/or activate an exported bundle")
    p.add_argument("--input", required=True)
    p.add_argument("--verify-only", action="store_true")
    p.add_argument("--activate", action="store_true")
    p.set_defaults(fn=cmd_import_bundle)

    args = ap.parse_args()
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())
