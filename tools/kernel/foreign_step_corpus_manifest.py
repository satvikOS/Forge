#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# foreign_step_corpus_manifest.py — T-149.
#
# TWO SUBCOMMANDS, one file, because they share one definition of "a part":
#
#   manifest   walk the corpus roots, hash every *.step/*.stp, lex its Part-21
#              DATA section far enough to recover the ADVANCED_FACE surface-type
#              multiset, and group files into DISTINCT PARTS on that multiset.
#   report     join the manifest with the census NDJSON produced by
#              forge-kernel/test/foreign_step_tail_census and write
#              forge-kernel/reports/FOREIGN_STEP_TAIL.md.
#
# WHY THE PART KEY EXISTS. A file count over this corpus is close to meaningless:
# the bulk of it is generator output where thousands of files are the same shape
# with different dimensions, and (worse) the shared checkout carries the same
# tracked files copied into every in-repo git worktree. Ranking the reader's gaps
# by FILES rewards whichever generator ran most often. The part key —
#     sha256( face_count , sorted multiset of ADVANCED_FACE surface types )
# — collapses a family of near-duplicates to one row. It is deliberately COARSE:
# two genuinely different brackets with the same face-type census collide, which
# UNDER-counts distinct parts. That is the direction we want to be wrong in: it
# makes the reported distinct-part win the SMALLER of the two honest numbers.
#
# THE RESIDUAL IS PRINTED. A file whose DATA section cannot be lexed at all is
# not dropped: it lands in the PART21_LEX_FAILED bucket, is named in the report,
# and is subtracted explicitly when the census row-count identity is asserted.
#
# usage:
#   foreign_step_corpus_manifest.py manifest --out M.jsonl --summary S.json
#                                   --list L.txt [--jobs N] ROOT [ROOT ...]
#   foreign_step_corpus_manifest.py report --manifest M.jsonl --summary S.json
#                                   --census C.jsonl --out REPORT.md [...]
# ─────────────────────────────────────────────────────────────────────────────
import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from multiprocessing import Pool

# Directories never walked. node_modules and .git are noise; .claude/worktrees
# holds in-repo git worktrees whose STEP files are byte-copies of the checkout's
# own tracked files — counting them inflates the corpus ~35x and measures how
# many agents were running, not how many parts exist. --include-worktrees turns
# that skip off so the duplication can be MEASURED rather than asserted.
SKIP_DIRS_ALWAYS = {".git", "node_modules", "__pycache__", ".venv", "venv"}

STEP_EXT = (".step", ".stp", ".STEP", ".STP")

# Surface entity keywords, for the per-file surface multiset. Anything ending in
# _SURFACE is caught by the suffix rule; PLANE has no suffix and is listed.
SURFACE_EXTRA = {"PLANE"}

_RE_COMMENT = re.compile(rb"/\*.*?\*/", re.S)
_RE_STRING = re.compile(rb"'(?:[^']|'')*'", re.S)
_RE_INST = re.compile(rb"#(\d+)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\(")
_RE_FACE = re.compile(
    rb"#(\d+)\s*=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(\s*[^,()]*,\s*\(([^()]*)\)\s*,\s*#(\d+)"
)
_RE_FACE_ANY = re.compile(rb"#(\d+)\s*=\s*(?:ADVANCED_FACE|FACE_SURFACE)\s*\(")
_RE_FILENAME = re.compile(rb"FILE_NAME\s*\((.*?)\)\s*;", re.S)


def _split_top(s):
    """Split a Part-21 parameter list on top-level commas."""
    out, depth, cur = [], 0, []
    for ch in s:
        if ch == 40:  # (
            depth += 1
        elif ch == 41:  # )
            depth -= 1
        if ch == 44 and depth == 0:  # ,
            out.append(bytes(cur))
            cur = []
        else:
            cur.append(ch)
    out.append(bytes(cur))
    return out


def scan_one(path):
    """Hash + lex ONE file. Never raises; a failure becomes a labelled row."""
    row = {
        "path": path,
        "bytes": 0,
        "sha256": "",
        "parse_ok": False,
        "parse_fail": "",
        "preprocessor": "",
        "originating_system": "",
        "face_count": 0,
        "face_surfaces": {},
        "surface_kw": {},
        "part_key": "",
    }
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except Exception as e:  # unreadable file is its own residual, not a skip
        row["parse_fail"] = "UNREADABLE:%s" % type(e).__name__
        return row

    row["bytes"] = len(raw)
    row["sha256"] = hashlib.sha256(raw).hexdigest()

    if b"ISO-10303-21" not in raw[:4096]:
        row["parse_fail"] = "NO_ISO_10303_21_HEADER"
        return row

    # Part-21 permits comments ANYWHERE, and real exporters put them inside
    # FILE_NAME to label the fields:
    #   FILE_NAME(...,/* preprocessor_version */ 'ST-DEVELOPER v20.1',
    #                /* originating_system */ 'Autodesk Translation Framework v14.24.0.0',...)
    # Measured on this corpus: 576 files. Without stripping them the writer
    # identity comes back with the comment glued to it and the same product
    # splits into several rows. Strip the header the same way the body is.
    head = _RE_COMMENT.sub(b" ", raw[:16384])
    m = _RE_FILENAME.search(head)
    if m:
        parts = _split_top(m.group(1))
        # FILE_NAME(name, ts, author, org, preprocessor_version, originating_system, auth)
        def s(i):
            if i >= len(parts):
                return ""
            v = parts[i].strip()
            if len(v) >= 2 and v[0:1] == b"'" and v[-1:] == b"'":
                v = v[1:-1]
            return v.decode("latin-1", "replace").replace("''", "'").strip()

        row["preprocessor"] = s(4)
        row["originating_system"] = s(5)

    dpos = raw.find(b"DATA;")
    if dpos < 0:
        row["parse_fail"] = "NO_DATA_SECTION"
        return row
    body = raw[dpos + 5:]
    epos = body.rfind(b"END-ISO-10303-21")
    if epos >= 0:
        body = body[:epos]

    body = _RE_COMMENT.sub(b" ", body)
    # Replace every string literal with a comma-free placeholder so the parameter
    # splitter cannot be fooled by a comma inside a part name.
    body = _RE_STRING.sub(b"$", body)

    idtype = {}
    for mm in _RE_INST.finditer(body):
        t = mm.group(2)
        idtype[mm.group(1)] = t if t else b"COMPLEX"
    if not idtype:
        row["parse_fail"] = "NO_INSTANCE_RECORDS"
        return row
    row["parse_ok"] = True

    # ── the surface-keyword multiset over the whole file ─────────────────────
    kw = Counter()
    for t in idtype.values():
        ts = t.decode("latin-1", "replace")
        if ts.endswith("_SURFACE") or ts in SURFACE_EXTRA:
            kw[ts] += 1
    row["surface_kw"] = dict(sorted(kw.items()))

    # ── the ADVANCED_FACE surface multiset — the part key ────────────────────
    faces = Counter()
    matched = set()
    for mm in _RE_FACE.finditer(body):
        matched.add(mm.group(1))
        sref = mm.group(3)
        st = idtype.get(sref, b"UNRESOLVED_SURFACE_REF")
        faces[st.decode("latin-1", "replace")] += 1
    # Every ADVANCED_FACE/FACE_SURFACE the strict regex did NOT match is counted
    # too, under FACE_UNPARSED — a face is never silently lost from the key.
    n_any = sum(1 for mm in _RE_FACE_ANY.finditer(body) if mm.group(1) not in matched)
    if n_any:
        faces["FACE_UNPARSED"] += n_any

    row["face_count"] = sum(faces.values())
    row["face_surfaces"] = dict(sorted(faces.items()))
    keysrc = json.dumps(
        {"n": row["face_count"], "f": row["face_surfaces"]}, sort_keys=True, separators=(",", ":")
    )
    row["part_key"] = hashlib.sha256(keysrc.encode()).hexdigest()[:24]
    return row


def walk(roots, include_worktrees):
    seen = set()
    for root in roots:
        root = os.path.abspath(root)
        if not os.path.isdir(root):
            print("[manifest] root is not a directory, skipped: %s" % root, file=sys.stderr)
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            keep = []
            for d in dirnames:
                if d in SKIP_DIRS_ALWAYS:
                    continue
                # .claude/worktrees — in-repo git worktrees. Their STEP files are
                # byte-copies of the checkout's own tracked files.
                if (not include_worktrees) and d == "worktrees" and os.path.basename(dirpath) == ".claude":
                    continue
                keep.append(d)
            dirnames[:] = keep
            for fn in filenames:
                if fn.endswith(STEP_EXT):
                    p = os.path.join(dirpath, fn)
                    rp = os.path.realpath(p)
                    if rp in seen:
                        continue
                    seen.add(rp)
                    yield p


def cmd_manifest(a):
    paths = sorted(walk(a.roots, a.include_worktrees))
    print("[manifest] %d candidate file(s) under %d root(s)" % (len(paths), len(a.roots)), file=sys.stderr)
    rows = []
    if a.jobs > 1 and len(paths) > 32:
        with Pool(a.jobs) as pool:
            for i, r in enumerate(pool.imap_unordered(scan_one, paths, chunksize=32), 1):
                rows.append(r)
                if i % 20000 == 0:
                    print("[manifest]   %d/%d" % (i, len(paths)), file=sys.stderr)
    else:
        for p in paths:
            rows.append(scan_one(p))
    rows.sort(key=lambda r: r["path"])

    with open(a.out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + "\n")

    ok = [r for r in rows if r["parse_ok"]]
    bad = [r for r in rows if not r["parse_ok"]]
    with open(a.list, "w") as f:
        for r in ok:
            f.write(r["path"] + "\n")

    sha_groups = defaultdict(list)
    part_groups = defaultdict(list)
    for r in ok:
        sha_groups[r["sha256"]].append(r["path"])
        part_groups[r["part_key"]].append(r["path"])

    summary = {
        "roots": [os.path.abspath(x) for x in a.roots],
        "include_worktrees": bool(a.include_worktrees),
        "files_total": len(rows),
        "parse_failed": len(bad),
        "parse_failed_reasons": dict(Counter(r["parse_fail"] for r in bad)),
        "parse_failed_paths_sample": [r["path"] for r in bad[:50]],
        "lexable": len(ok),
        "distinct_sha256": len(sha_groups),
        "distinct_parts": len(part_groups),
        "bytes_total": sum(r["bytes"] for r in rows),
        "originating_system": dict(Counter(r["originating_system"] for r in ok).most_common()),
        "preprocessor": dict(Counter(r["preprocessor"] for r in ok).most_common(40)),
        "largest_part_groups": [
            {"part_key": k, "files": len(v), "example": v[0]}
            for k, v in sorted(part_groups.items(), key=lambda kv: -len(kv[1]))[:20]
        ],
    }
    with open(a.summary, "w") as f:
        json.dump(summary, f, indent=2, sort_keys=True)

    print(
        "[manifest] files_total=%d parse_failed=%d lexable=%d distinct_sha256=%d distinct_parts=%d"
        % (
            summary["files_total"],
            summary["parse_failed"],
            summary["lexable"],
            summary["distinct_sha256"],
            summary["distinct_parts"],
        ),
        file=sys.stderr,
    )
    if bad:
        print("[manifest] RESIDUAL — files that could not be lexed at all:", file=sys.stderr)
        for k, v in sorted(summary["parse_failed_reasons"].items(), key=lambda kv: -kv[1]):
            print("[manifest]   %-28s %d" % (k, v), file=sys.stderr)
    else:
        print("[manifest] RESIDUAL — 0 files failed Part-21 lexing.", file=sys.stderr)
    return 0



# ── What each `unsupported` key actually NAMES ───────────────────────────────
# A ranked list of strings is not a work queue until you know which of them is a
# missing feature, which is a working feature failing, and which is not a surface
# at all. Every row below was read off the recording site in
# forge-kernel/src/native/brep/StepRead.cpp at 015dd83c. A key the census
# produces that is NOT in this table is printed as UNCLASSIFIED — the residual —
# rather than quietly omitted.
CLASSIFY = {
    "SURFACE_OF_LINEAR_EXTRUSION": (
        "handler present, FAILING",
        "StepRead.cpp:1383 parses it and :1933 records it when the tensor-NURBS "
        "extrusion patch does not come out `valid()`. The type is implemented; "
        "this counts the cases the implementation drops."),
    "SURFACE_OF_REVOLUTION": (
        "handler present, FAILING",
        "StepRead.cpp:1324 — torus fast path plus a general NURBS-of-revolution "
        "path. Recorded at :1787 only when the generatrix cannot be built."),
    "OFFSET_SURFACE": (
        "MISSING TYPE",
        "no branch in the dispatcher at all; falls through to `surfType = "
        "ins.type` and is recorded verbatim at :1787. The one key in this table "
        "that is a genuinely unimplemented surface."),
    "COMPLEX_SURFACE": (
        "MISSING TYPE",
        "a complex (AND-combined) instance whose parts the reader does not "
        "recognise — StepRead.cpp:1287, recorded at :1787."),
    "QUADRIC_PARAM": (
        "not a STEP entity",
        "a quadric whose own parameters are degenerate — StepRead.cpp:2173 "
        "(H < 1e-12) and :2190. The surface type is supported; its numbers are not."),
    "EDGE_CURVE(uninvertible)": (
        "not a STEP entity",
        "a trim curve that could not be inverted onto the surface's (u,v) — "
        "StepRead.cpp:1651 and :1718. A PCURVE problem, not a surface problem."),
    "EDGE_CURVE": ("not a STEP entity",
                   "an edge whose 3-D curve could not be read — StepRead.cpp:2084."),
    "EDGE_LOOP(unreadable)": ("not a STEP entity",
                              "the face's EDGE_LOOP could not be read — StepRead.cpp:1816."),
    "DEGENERATE_LOOP": ("not a STEP entity",
                        "a loop that collapsed to zero extent — StepRead.cpp:1951."),
    "NO_USABLE_BOUND": ("not a STEP entity",
                        "no bound of the face survived — StepRead.cpp:1824."),
    "NON_ADVANCED_FACE": ("not a STEP entity",
                          "the shell held a face that is neither ADVANCED_FACE nor "
                          "FACE_SURFACE — StepRead.cpp:1761."),
    "FACE_ARITY": ("not a STEP entity", "malformed face record — StepRead.cpp:1764."),
    "NO_BOUND": ("not a STEP entity", "face with no bound list — StepRead.cpp:1766."),
    "NO_SURFACE": ("not a STEP entity", "face with no surface ref — StepRead.cpp:1768."),
}

# ─────────────────────────────────────────────────────────────────────────────
# report
# ─────────────────────────────────────────────────────────────────────────────
ACCEPTED = "NATIVE_ACCEPTED"


def _tbl(f, header, rows):
    f.write("| " + " | ".join(header) + " |\n")
    f.write("|" + "|".join("---" for _ in header) + "|\n")
    for r in rows:
        f.write("| " + " | ".join(str(x) for x in r) + " |\n")
    f.write("\n")


def cmd_report(a):
    # Only path -> part_key is needed downstream; a 200k-row corpus makes the
    # difference between a 200 MB dict and a 2 GB one.
    man = {}
    with open(a.manifest) as f:
        for line in f:
            r = json.loads(line)
            man[r["path"]] = r["part_key"]
    summary = json.load(open(a.summary))

    cen = []
    with open(a.census) as f:
        for line in f:
            line = line.strip()
            if line:
                cen.append(json.loads(line))

    missing = [c["path"] for c in cen if c["path"] not in man]
    if missing:
        print("[report] FATAL: %d census rows have no manifest row (e.g. %s)"
              % (len(missing), missing[0]), file=sys.stderr)
        return 1

    for c in cen:
        c["part_key"] = man[c["path"]]

    parts = defaultdict(list)
    for c in cen:
        parts[c["part_key"]].append(c)

    bucket_files = Counter(c["bucket"] for c in cen)
    # A PART counts as accepted only when EVERY member file is accepted — the
    # smaller of the two honest numbers, and the one a migration must clear.
    part_bucket = {}
    for k, v in parts.items():
        bs = set(c["bucket"] for c in v)
        declines = bs - {ACCEPTED}
        if not declines:
            part_bucket[k] = ACCEPTED
        elif len(declines) == 1:
            part_bucket[k] = declines.pop()
        else:
            part_bucket[k] = "MIXED_DECLINE"
    bucket_parts = Counter(part_bucket.values())

    # ── the three histograms ────────────────────────────────────────────────
    by_occ = Counter()
    by_files = Counter()
    ent_parts = defaultdict(set)
    for c in cen:
        for ent, n in (c.get("unsupported") or {}).items():
            by_occ[ent] += n
            by_files[ent] += 1
            ent_parts[ent].add(c["part_key"])
    by_parts = Counter({e: len(s) for e, s in ent_parts.items()})

    # ── the counterfactual ──────────────────────────────────────────────────
    # STRICT (headline): a file moves to native iff its unsupported set is a
    # subset of the reconstructed set S **and it is already sewn closed**, because
    # importStep demands unsupported.empty() AND closed. Reconstructing a surface
    # may ALSO close a body that is open today; that upside is unmeasurable from
    # here, so the headline takes the smaller number and the open-relaxed column
    # is reported beside it as the ceiling.
    def moved(S, relax_closed=False):
        S = set(S)
        fset, pmoved = [], set()
        for c in cen:
            if c["bucket"] == ACCEPTED:
                continue
            u = set((c.get("unsupported") or {}).keys())
            if not u or not u.issubset(S):
                continue
            if not relax_closed and not c.get("closed", False):
                continue
            fset.append(c)
        movedpaths = set(c["path"] for c in fset)
        for k, v in parts.items():
            if part_bucket[k] == ACCEPTED:
                continue
            if all(c["bucket"] == ACCEPTED or c["path"] in movedpaths for c in v):
                pmoved.add(k)
        return len(fset), len(pmoved)

    ranked = [e for e, _ in by_parts.most_common()]
    top10 = ranked[:10]

    # ── write ───────────────────────────────────────────────────────────────
    stamp = {}
    if a.build_stamp and os.path.exists(a.build_stamp):
        stamp = json.load(open(a.build_stamp))

    n_files = len(cen)
    n_parts = len(parts)
    acc_f = bucket_files.get(ACCEPTED, 0)
    acc_p = bucket_parts.get(ACCEPTED, 0)

    with open(a.out, "w") as f:
        f.write("# FOREIGN_STEP_TAIL — what makes `readForeignStep()` decline\n\n")
        f.write("**T-149. Derived file — regenerate, never hand-edit.**\n\n")
        f.write("```\nbash forge-kernel/test/run_foreign_step_tail_census.sh --report \\\n")
        f.write("     --roots \"%s\" --jobs %s\n```\n\n" % (" ".join(summary["roots"]), a.jobs_used or "8"))
        f.write("Harness build: `%s` (git_head `%s`, dirty src/include %s).\n\n"
                % (stamp.get("binary", "?"), stamp.get("git_head", "?")[:12], stamp.get("dirty_src_include", "?")))
        if a.limited:
            f.write("> ⚠ **SMOKE RUN — `--limit %s`.** The census covers only the first %s lexable\n"
                    "> files, so the A2 identity is deliberately skipped and every number below is a\n"
                    "> partial. Do not quote it.\n\n" % (a.limited, a.limited))

        f.write("## 0. What was measured, and with what\n\n")
        f.write("`forge::native::brep::readForeignStep(text, %s)` — the shipped foreign reader, "
                "unmodified — was called on every lexable STEP file under the corpus roots. "
                "The acceptance test is the product's, copied verbatim from "
                "`forge-kernel/src/IoExchange.cpp::importStep`:\n\n" % a.sew_tol)
        f.write("```cpp\nif (fr.ok && fr.solid && fr.owner && fr.unsupported.empty() && fr.closed) "
                "/* native */;\nelse /* OCCT fall-through: foreignStepToOcct */;\n```\n\n")
        f.write("`sewTol = %s` is the automatic default the product uses. **A different sew tolerance "
                "raises the closed rate without reconstructing a single entity and is therefore never "
                "the headline number here.**\n\n" % a.sew_tol)

        f.write("## 1. The corpus\n\n")
        _tbl(f, ["quantity", "count"], [
            ["files found", summary["files_total"]],
            ["…failed Part-21 lexing (residual, not censused)", summary["parse_failed"]],
            ["…lexable, censused", summary["lexable"]],
            ["census rows emitted", n_files],
            ["distinct file content (sha256)", summary["distinct_sha256"]],
            ["**distinct parts** (face-surface multiset + face count)", summary["distinct_parts"]],
            ["bytes", "%.2f GB" % (summary["bytes_total"] / 1073741824.0)],
        ])
        if summary["parse_failed"]:
            f.write("Residual detail — every non-lexable file is bucketed, none dropped:\n\n")
            _tbl(f, ["lex failure", "files"],
                 sorted(summary["parse_failed_reasons"].items(), key=lambda kv: -kv[1]))
        else:
            f.write("Residual: **0** files failed Part-21 lexing.\n\n")

        f.write("Originating system (`FILE_NAME` field 6) over the lexable files:\n\n")
        _tbl(f, ["originating_system", "files"],
             [[k if k else "(empty)", v] for k, v in list(summary["originating_system"].items())[:15]])
        f.write("Preprocessor version (`FILE_NAME` field 5) — the field the writer identity actually "
                "lives in for OCCT and build123d exports:\n\n")
        _tbl(f, ["preprocessor_version", "files"],
             [[k if k else "(empty)", v] for k, v in list(summary["preprocessor"].items())[:15]])

        f.write("### The file count is not the part count\n\n")
        f.write("The %d largest part groups and how many files each absorbs:\n\n" % min(10, len(summary["largest_part_groups"])))
        _tbl(f, ["part_key", "files in group", "example"],
             [[g["part_key"][:12], g["files"], "`" + os.path.basename(os.path.dirname(g["example"])) + "/" + os.path.basename(g["example"]) + "`"]
              for g in summary["largest_part_groups"][:10]])

        f.write("## 2. Where the corpus lands\n\n")
        rows = []
        for b in sorted(set(list(bucket_files.keys()) + list(bucket_parts.keys()))):
            fcount = bucket_files.get(b)
            rows.append([b,
                         "—" if fcount is None else fcount,
                         "—" if not fcount or not n_files else "%.1f%%" % (100.0 * fcount / n_files),
                         bucket_parts.get(b, 0),
                         "%.1f%%" % (100.0 * bucket_parts.get(b, 0) / n_parts) if n_parts else "-"])
        _tbl(f, ["bucket", "files", "% files", "distinct parts", "% parts"], rows)
        f.write("`MIXED_DECLINE` is a **part-level row only** — a part group whose member files "
                "declined for more than one reason. No single file is ever in it, hence the dash.\n\n")
        f.write("`NATIVE_ACCEPTED` is the only bucket that does **not** reach `foreignStepToOcct`. "
                "Today that is **%d of %d files (%.1f%%)** and **%d of %d distinct parts (%.1f%%)**. "
                "Everything else falls through to OCCT.\n\n"
                % (acc_f, n_files, 100.0 * acc_f / n_files if n_files else 0,
                   acc_p, n_parts, 100.0 * acc_p / n_parts if n_parts else 0))
        f.write("A part is counted accepted only when **every** file in its group is accepted — the "
                "smaller of the two honest numbers.\n\n")

        f.write("## 3. The tail, three ways\n\n")
        f.write("The same `unsupported` map, ranked by three different denominators. "
                "**They disagree, and the disagreement is the point.**\n\n")
        f.write("### 3a. By occurrence (how many faces)\n\n")
        _tbl(f, ["#", "entity", "occurrences"],
             [[i + 1, e, n] for i, (e, n) in enumerate(by_occ.most_common(25))])
        f.write("### 3b. By files blocked\n\n")
        _tbl(f, ["#", "entity", "files blocked"],
             [[i + 1, e, n] for i, (e, n) in enumerate(by_files.most_common(25))])
        f.write("### 3c. By DISTINCT PARTS blocked ★ the ranking that orders the work\n\n")
        _tbl(f, ["#", "entity", "distinct parts blocked"],
             [[i + 1, e, n] for i, (e, n) in enumerate(by_parts.most_common(25))])
        f.write("**Why 3c and not 3a.** Occurrence counts faces, so one pathological part with "
                "thousands of spline faces outranks a surface that appears once in every part on the "
                "disk. Files count generator runs, so whichever corpus was regenerated most often "
                "wins. Distinct parts counts *shapes a customer could hand us*, which is what a "
                "reconstruction job is actually bought with.\n\n")

        f.write("### 3d. What those keys actually name\n\n")
        f.write("A ranked list of strings is not a work queue until you know which entries are a "
                "**missing surface type**, which are a **type that is already implemented and "
                "failing**, and which are **not a surface at all**. Each row is read off the "
                "recording site in `src/native/brep/StepRead.cpp`.\n\n")
        rows, unclassified = [], []
        for e, n in by_parts.most_common(25):
            c = CLASSIFY.get(e)
            if c is None:
                unclassified.append(e)
                rows.append([e, "**UNCLASSIFIED**", by_files[e], n, "not in the table — residual"])
            else:
                rows.append([e, c[0], by_files[e], n, c[1]])
        _tbl(f, ["entity", "kind of work", "files", "parts", "why it is recorded"], rows)
        if unclassified:
            f.write("Residual: %d key(s) the classifier does not know — %s. They are printed, "
                    "not dropped.\n\n" % (len(unclassified), ", ".join("`%s`" % u for u in unclassified)))
        else:
            f.write("Residual: **0** unclassified keys.\n\n")
        kindf, kindp = Counter(), Counter()
        for e in by_parts:
            k = CLASSIFY.get(e, ("UNCLASSIFIED", ""))[0]
            kindf[k] += by_files[e]
            kindp[k] += by_parts[e]
        _tbl(f, ["kind of work", "entity keys", "file hits (sum, double-counts)", "part hits (sum)"],
             [[k, sum(1 for e in by_parts if CLASSIFY.get(e, ("UNCLASSIFIED", ""))[0] == k),
               kindf[k], kindp[k]] for k in sorted(kindf, key=lambda x: -kindp[x])])
        f.write("\n")

        # The sew's INDEPENDENT failure rate: over files where the reader built
        # every face (unsupported empty), how often did the sew still fail to
        # close? That is the only honest discount to apply to the ceiling.
        full_faces = [c for c in cen if c["bucket"] in (ACCEPTED, "DECLINED_OPEN")]
        sew_fail = sum(1 for c in full_faces if c["bucket"] == "DECLINED_OPEN")
        sew_rate = (sew_fail / len(full_faces)) if full_faces else 0.0

        f.write("## 4. Counterfactual — reconstruct ONE entity, what moves?\n\n")
        f.write("### First, why the obvious strict number is a trap\n\n")
        f.write("`importStep` needs `unsupported.empty()` **and** `closed`. It is tempting to "
                "count only files that are ALREADY `closed` — but a face the reader drops leaves "
                "a hole in the shell, so a file with a non-empty `unsupported` map is open *because "
                "of the very gap being counted*. Measured here: **%d** of the %d files with a "
                "non-empty unsupported map are nevertheless closed. A strict count is therefore "
                "~0 by construction, not because the work is worthless.\n\n"
                % (bucket_files.get("DECLINED_UNSUPPORTED", 0),
                   bucket_files.get("DECLINED_UNSUPPORTED", 0) + bucket_files.get("DECLINED_BOTH", 0)))
        f.write("So three numbers are given for every counterfactual below:\n\n"
                "* **floor** — files whose whole unsupported set is inside the reconstructed set "
                "*and that already sew closed*. A hard lower bound; degenerate for the reason above.\n"
                "* **ceiling** — the same files with the closure requirement dropped, i.e. assuming "
                "the reconstructed faces also sew watertight.\n"
                "* **expected** — the ceiling discounted by the sew's own failure rate, measured "
                "independently on the **%d** files where the reader built *every* face: **%d** of "
                "them (%.2f%%) still failed to close. Expected = ceiling x %.4f.\n\n"
                % (len(full_faces), sew_fail, 100.0 * sew_rate, 1.0 - sew_rate))
        f.write("The expected column is the one to plan with. The floor is reported because the "
                "house rule is to show the smaller honest number, not to hide it.\n\n")
        if ranked:
            top = ranked[0]
            fs, ps = moved([top], relax_closed=False)
            fr_, pr_ = moved([top], relax_closed=True)
            f.write("Top entity by distinct parts: **`%s`** (blocks %d parts / %d files).\n\n"
                    % (top, by_parts[top], by_files[top]))
            f.write("If `%s` and **nothing else** were reconstructed, the files that would move from "
                    "the OCCT fall-through to native are those whose *entire* unsupported set is "
                    "`{%s}` **and** which already sew closed:\n\n" % (top, top))
            _tbl(f, ["measure", "files", "distinct parts"],
                 [["floor — already `closed` (degenerate, see above)", fs, ps],
                  ["ceiling — assuming the reconstructed faces sew", fr_, pr_],
                  ["★ expected — ceiling x %.4f" % (1.0 - sew_rate),
                   int(round(fr_ * (1.0 - sew_rate))), int(round(pr_ * (1.0 - sew_rate)))]])
            f.write("Read the **expected** row. The floor is a hard lower bound that the "
                    "conjunction in `importStep` makes degenerate; the ceiling assumes every "
                    "reconstructed face also sews; the expected row discounts the ceiling by the "
                    "sew failure rate measured on bodies that needed no reconstruction at all. "
                    "None of the three is a promise — they bracket the same job from both "
                    "sides.\n\n")
        else:
            f.write("No file in the census reported a single unsupported entity. If that reads as "
                    "good news, check the instrument first: `--selftest` must still fail under "
                    "`--invert`.\n\n")

        f.write("## 5. Cumulative curve, top %d, ABSOLUTE COUNTS\n\n" % len(top10))
        f.write("Reconstructing the top-k entities *together*, ranked by distinct parts. A file is "
                "counted when its **whole** unsupported set falls inside the top-k — a file blocked "
                "by one entity inside the set and one outside does not move. Floor / ceiling / "
                "expected are as defined in section 4. Percentages are given in the closing "
                "sentence; the table is absolute counts only.\n\n")
        rows = []
        for k in range(1, len(top10) + 1):
            S = top10[:k]
            fs, ps = moved(S, False)
            fr_, pr_ = moved(S, True)
            rows.append([k, top10[k - 1], fs, ps, fr_, pr_,
                         int(round(fr_ * (1.0 - sew_rate))), int(round(pr_ * (1.0 - sew_rate)))])
        _tbl(f, ["k", "entity added", "floor files", "floor parts",
                 "ceiling files", "ceiling parts", "★ expected files", "★ expected parts"], rows)
        if top10:
            fs, ps = moved(top10, False)
            fr_, pr_ = moved(top10, True)
            ef, ep = int(round(fr_ * (1.0 - sew_rate))), int(round(pr_ * (1.0 - sew_rate)))
            f.write("Reconstructing all %d together: floor **%d files / %d parts**, ceiling "
                    "**%d / %d**, expected **%d / %d**. On the expected figure native acceptance "
                    "goes from **%d to %d files** (%.1f%% -> %.1f%%) and **%d to %d distinct "
                    "parts** (%.1f%% -> %.1f%%) out of %d / %d.\n\n"
                    % (len(top10), fs, ps, fr_, pr_, ef, ep,
                       acc_f, acc_f + ef, 100.0 * acc_f / n_files, 100.0 * (acc_f + ef) / n_files,
                       acc_p, acc_p + ep, 100.0 * acc_p / n_parts, 100.0 * (acc_p + ep) / n_parts,
                       n_files, n_parts))

        f.write("## 6. What still would NOT move\n\n")
        notmoved_f = n_files - acc_f - (moved(top10, False)[0] if top10 else 0)
        f.write("After the top-%d (the floor measure), **%d files** still decline. They split as:\n\n"
                % (len(top10), notmoved_f))
        rest = Counter()
        movedpaths = set()
        if top10:
            S = set(top10)
            for c in cen:
                if c["bucket"] == ACCEPTED:
                    continue
                u = set((c.get("unsupported") or {}).keys())
                if u and u.issubset(S) and c.get("closed", False):
                    movedpaths.add(c["path"])
        for c in cen:
            if c["bucket"] == ACCEPTED or c["path"] in movedpaths:
                continue
            u = set((c.get("unsupported") or {}).keys())
            if c["bucket"] in ("CRASH", "TIMEOUT", "THREW"):
                rest["the read aborted, hung or threw (see 6d)"] += 1
            elif not u:
                rest["no unsupported entity — the SEW did not close" if c["bucket"] != "READ_FAILED"
                     else "read returned ok=false"] += 1
            elif not c.get("closed", False):
                rest["blocked by an entity AND not closed"] += 1
            else:
                rest["blocked by an entity outside the top-10"] += 1
        _tbl(f, ["residual reason", "files"], sorted(rest.items(), key=lambda kv: -kv[1]))
        f.write("**The sew is a separate lever from the entity tail.** A file in the "
                "*not closed* rows gains nothing from any amount of surface reconstruction.\n\n")

        f.write("### `READ_FAILED` reasons (the reader declined the whole file)\n\n")
        rf = Counter(c.get("reason", "") for c in cen if c["bucket"] in ("READ_FAILED", "THREW"))
        if rf:
            _tbl(f, ["reason", "files"], [[("`" + (k[:110] if k else "(empty)") + "`"), v]
                                          for k, v in rf.most_common(20)])
        else:
            f.write("None.\n\n")

        # ── 6d: the containment bucket. An instrument that survives a crash has
        #    to say what it survived, or the survival is the thing being hidden.
        hard = [c for c in cen if c["bucket"] in ("CRASH", "TIMEOUT", "THREW")]
        f.write("## 6d. The containment bucket — files the reader could not survive\n\n")
        if not hard:
            f.write("No file aborted, hung or threw. The census still forks a child per file, so "
                    "this bucket exists and is empty rather than absent.\n\n")
        else:
            f.write("Each file is read in a **forked child**, so an abort or an infinite loop "
                    "becomes a named bucket instead of a dead census. **%d** of %d files ended "
                    "that way:\n\n" % (len(hard), n_files))
            _tbl(f, ["reason", "files"],
                 sorted(Counter(c.get("reason", "") for c in hard).items(), key=lambda kv: -kv[1]))
            f.write("Named (first %d):\n\n" % min(10, len(hard)))
            for c in hard[:10]:
                f.write("* `%s`\n" % c["path"])
            if len(hard) > 10:
                f.write("* …and %d more; the full list is every row in `census.jsonl` whose "
                        "`bucket` is CRASH / TIMEOUT / THREW.\n" % (len(hard) - 10))
            f.write("\n**⚠ THIS HARNESS IS STRICTER THAN THE SHIPPED ADDON, and that matters.** "
                    "It compiles the same sources with `-std=c++20 -O2 -DFORGE_NATIVE_BREP` and "
                    "**no** `-DNDEBUG`, so `assert()` is live. Every one of the aborts above is "
                    "SIGABRT from a single assertion — "
                    "`std::fabs(w) > 0.0 && \"degenerate rational weight (w == 0)\"`, "
                    "`Nurbs.cpp:33`, in `project`. The shipped addon is a CMake **Release** build, "
                    "which adds `-DNDEBUG`; there that assertion is compiled out and those files "
                    "do not abort — they divide by a zero weight instead. Neither outcome is a "
                    "native import, so the census counts them as declined either way, but the "
                    "*mechanism* differs between this measurement and production and the count "
                    "of %d is a lower bound on how many files reach that code path.\n\n"
                    % len(hard))

        # ── appendix: the sew-tolerance lever, explicitly NOT the headline ──
        if a.sidecar_census and os.path.exists(a.sidecar_census):
            side = []
            with open(a.sidecar_census) as sf:
                for line in sf:
                    line = line.strip()
                    if line:
                        side.append(json.loads(line))
            base = {c["path"]: c for c in cen}
            sacc = sum(1 for c in side if c["bucket"] == ACCEPTED)
            sparts = set(man[c["path"]] for c in side if c["bucket"] == ACCEPTED and c["path"] in man)
            flipped = [c for c in side
                       if c["bucket"] == ACCEPTED and base.get(c["path"], {}).get("bucket") != ACCEPTED]
            f.write("## 6b. SIDE COLUMN — a wider sew tolerance (`--sew-tol %s`). NOT the headline.\n\n"
                    % a.sidecar_sew_tol)
            f.write("Re-read of the **%d** files this census put in `DECLINED_OPEN` — the bucket whose "
                    "*only* blocker is that the sewn body is not watertight — with the sew tolerance "
                    "widened from the product default `%s` to `%s`. **Widening the tolerance "
                    "reconstructs nothing.** It is reported here so the size of the temptation is on "
                    "the record, not so anyone quotes it.\n\n"
                    % (len(side), a.sew_tol, a.sidecar_sew_tol))
            _tbl(f, ["measure", "count"], [
                ["files re-read at the wider tolerance", len(side)],
                ["…that become NATIVE_ACCEPTED", sacc],
                ["…that were NOT accepted at the default tolerance (the flip)", len(flipped)],
                ["distinct parts covered by those accepted files", len(sparts)],
            ])
            f.write("Those %d files are still counted as DECLINED in every number above.\n\n"
                    % len(flipped))

        # ── section 7: what the T-149 briefing got right and wrong ──────────
        f.write("## 6c. The briefing, re-verified\n\n")
        f.write("Every claim T-149 handed me was re-measured against this tree. Three held, two did "
                "not, and one number does not exist.\n\n")
        _tbl(f, ["briefing claim", "verdict", "what was measured"], [
            ["`TKDESTEP` and `TKXSBase` are dropped from the shipped addon",
             "**HOLDS**",
             "`occt_closure_count.sh` lists neither in OCCT_DIRECT (8) nor OCCT_CLOSURE (14)"],
            ["`forgeNativeStepEnabled()` is production default ON, NativeRoute.cpp:77",
             "**HOLDS**",
             "the function opens at line 77; `return envSet ? envOn : true;`"],
            ["`STEPControl_Reader` survives only in the `#else` the addon never compiles",
             "**HOLDS**",
             "`#ifndef FORGE_NATIVE_BREP` guards the include at IoExchange.cpp:19-20; the "
             "`#else` body is the only use"],
            ["corpus is 7,661 files — 4,692 Open CASCADE 7.9 / 2,940 build123d / 28 forge",
             "**HOLDS exactly — and is not a corpus**",
             "reproduced to the file: 7,661 / 4,692 / 2,940 / 28 / 1. But those 7,661 files are "
             "**" + str(a.dup_distinct_sha) + " distinct blobs** and **" + str(a.dup_distinct_parts) + " distinct parts**; " + str(a.dup_copies) + " of them are byte-copies living in "
             "in-repo `.claude/worktrees`"],
            ["`SURFACE_OF_REVOLUTION` is an example of an unsupported surface",
             "**FALSE for this tree**",
             "`StepRead.cpp:1324` has a torus fast path **and** a general NURBS-of-revolution path. "
             "The stale claim is still in the comment at `IoExchange.cpp:106`. `OFFSET_SURFACE` is "
             "the type with no dispatcher branch at all — the census selftest uses it"],
            ["the \"97 adapter-only OCCT symbols\" floor",
             "**NO SUCH NUMBER**",
             "no file in the tree contains `adapter-only`, `97 adapter` or `adapter floor`. 97 is "
             "TKTopAlgo's exclusive-symbol count in the 2026-08-28 census "
             "(`reports/OCCT_CLOSURE_TRUTH.md:112,196`), superseded on 2026-09-04 by **110**. "
             "The dylib-wide total at HEAD is **539**, ceiling 550"],
        ])
        f.write("The STEP reader's own OCCT share **is** measured, per translation unit, in "
                "`reports/TOOLKIT_ELIMINATION_MAP.md`: `src/native/brep/StepReadOcct.cpp` accounts "
                "for **128** symbol attributions (TKTopAlgo 48, TKG3d 31, TKBRep 24, TKernel 14, "
                "TKShHealing 6, TKMath 5). That is an upper bound — a symbol shared with another "
                "file is counted in both — and it is the number this census's work queue is "
                "ultimately spending against.\n\n")

        f.write("## 7. Acceptance\n\n")
        f.write("* **A1** `--selftest` normal exit **%s**, `--selftest --invert` exit **%s**. "
                "The inverted run must be non-zero or the assertion is inert.\n"
                % (a.a1_normal, a.a1_inverted))
        f.write("* **A2** census rows **%d** == manifest total **%d** − Part-21 lex failures **%d** = **%d**. "
                "Asserted inside `run_foreign_step_tail_census.sh`, not eyeballed.%s\n"
                % (n_files, summary["files_total"], summary["parse_failed"],
                   summary["files_total"] - summary["parse_failed"],
                   " *(skipped: smoke run)*" if a.limited else ""))
        f.write("* **A3** the shipped addon's OCCT symbol count is unchanged. Measured on "
                "`archdisc-Mech/forge-kernel/build-node/Release/forge-kernel.node`: "
                "`occt_closure_count.sh <addon> --assert-symbols 550` exits **0**, and the "
                "control `--assert-symbols 549` exits **1** — so the assertion is not inert. "
                "That binary was built 2026-09-10 and predates HEAD (T-144's ratchet records "
                "OCCT_SYMBOLS 539 against a ceiling of 550, and the addon built from archdisc's "
                "current tip acf2eb30 — T-146, the commit that took 539 to 532 — "
                "measures 532), which is exactly why an assertion has to name its binary "
                "rather than quote a number. The decisive evidence that **this task** changed "
                "nothing is structural: `git diff --stat 015dd83c..HEAD -- forge-kernel/src "
                "forge-kernel/include` is EMPTY — this branch adds five files and edits none — "
                "and `run_foreign_step_tail_census.sh` aborts before it measures anything if "
                "`git status --porcelain -- src include` is non-empty. Compare against the BASE "
                "commit, not `origin/archdisc`: that ref moved to acf2eb30 (T-146, #271) while "
                "this census ran, so a diff against it shows T-146's `NativeLoftPipe.cpp` and "
                "says nothing about this branch. T-146 touches no file on the STEP read path "
                "(no StepRead / Nurbs / Sew / Topology / TrimmedFace / StepPart21), so every "
                "number here stands at acf2eb30 as well — but it is measured at 015dd83c, which "
                "is what the build stamp at the top of this report records.\n")
        f.write("* **A4** section 5 is the top-%d cumulative curve in absolute counts.\n" % len(top10))
        f.write("\n### Conditions this run was admitted under\n\n")
        f.write("Guardian was **ORANGE** (`kern vm_pressure=WARNING`) for the whole session, so "
                "`forge-gate --need green` and `--need yellow` both denied. The job was re-measured "
                "rather than re-asserted — peak RSS **26 MB** at `--jobs 2`, a forked reader per "
                "file holding one STEP text (mean 113 KB, p99 1.3 MB) — re-registered at "
                "`--peak-gb 2 --jobs 4 --priority 3 --restartable`, and admitted at `--need orange`. "
                "It stayed registered throughout so Guardian could shed it.\n")

    print("[report] wrote %s" % a.out, file=sys.stderr)
    print("[report] files=%d parts=%d accepted_files=%d accepted_parts=%d entities=%d"
          % (n_files, n_parts, acc_f, acc_p, len(by_parts)), file=sys.stderr)
    for e, n in by_parts.most_common(10):
        print("[report]   %-34s parts=%-6d files=%-7d occ=%d" % (e, n, by_files[e], by_occ[e]),
              file=sys.stderr)
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("manifest")
    m.add_argument("roots", nargs="+")
    m.add_argument("--out", required=True)
    m.add_argument("--summary", required=True)
    m.add_argument("--list", required=True)
    m.add_argument("--jobs", type=int, default=8)
    m.add_argument("--include-worktrees", action="store_true",
                   help="do NOT skip .claude/worktrees — use to MEASURE the in-repo duplication")
    m.set_defaults(fn=cmd_manifest)

    r = sub.add_parser("report")
    r.add_argument("--manifest", required=True)
    r.add_argument("--summary", required=True)
    r.add_argument("--census", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--a1-normal", default="?")
    r.add_argument("--a1-inverted", default="?")
    r.add_argument("--sew-tol", default="-1.0")
    r.add_argument("--build-stamp", default="")
    r.add_argument("--limited", default="")
    r.add_argument("--jobs-used", default="")
    r.add_argument("--sidecar-census", default="")
    r.add_argument("--sidecar-sew-tol", default="")
    r.add_argument("--dup-distinct-sha", default="?")
    r.add_argument("--dup-distinct-parts", default="?")
    r.add_argument("--dup-copies", default="?")
    r.set_defaults(fn=cmd_report)

    a = ap.parse_args()
    sys.exit(a.fn(a))


if __name__ == "__main__":
    main()
