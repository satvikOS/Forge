#!/usr/bin/env python3
"""abc_ofs_corpus.py — turn PROVEN abc_ofs translations into canonical training rows.

    {"image": null, "messages": [system, user, assistant]}

    system     the ONE canonical prompt, READ from the existing corpus
               (canonicalize_dataset.canonical_system_prompt) — never retyped
    user       gt_framing.user_decomp(census) over the KERNEL-MEASURED face
               census of the solid the assistant's own IR builds. NOT the
               dataset's caption, NOT the FeatureScript feature names — the
               same instrument that framed every other source frames this one,
               which is what makes the sources uniform.
    assistant  the IR that abc_ofs_verify.py PROVED rebuilds that solid

WHY THIS FILE EXISTS RATHER THAN A SECOND PIPELINE. The mandatory door is
archdisc-Models/scripts/canonicalize_dataset.py, and the intended change is the
one-line adapter registration plus the emit arm in
scripts/abc_ofs_canonicalize.patch. This agent runs inside an isolated Forge
worktree and the harness REFUSES writes into the archdisc-Models checkout, so
the patch could not be installed on disk. Rather than fork the door, this file
IMPORTS it and calls ITS functions — preflight_instruments, canonical_system_
prompt, stage_measure, build_row — and the trainer's own validate_corpus.
check_row, with the adapter registered in memory exactly as the patch registers
it on disk. Nothing about acceptance, framing or validation is reimplemented
here; if the door changes, this run changes with it.

Rules honoured, and asserted rather than described:
  R1  in == accepted + rejected, asserted; every rejection carries a reason.
  R2  the adapter does not reason (abc_ofs_adapter.py).
  R3  a missing input directory raises; it never yields zero rows quietly.
  R4  contamination is scanned BEFORE the corpus is declared usable, with
      scan_census_contamination.py, which enumerates holdouts from disk at run
      time — a holdout created after a corpus is what retro-contaminates it.
  R5  every emitted row is re-validated by validate_corpus.check_row.

Usage:
  python3 scripts/abc_ofs_corpus.py --verified <abc_ofs_verify --out dir> \\
      --verify <forge_verify> --out <corpus dir> [--models-root ...]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys


def load_door(models_root: str):
    """Import the REAL canonicalize_dataset / validate_corpus / gt_framing."""
    sp = os.path.join(models_root, "scripts")
    if not os.path.isdir(sp):
        raise SystemExit(f"REFUSING: no scripts/ under {models_root} — the door is not here.")
    sys.path.insert(0, sp)
    import canonicalize_dataset as door       # noqa: E402
    import validate_corpus                    # noqa: E402
    import gt_framing                         # noqa: E402
    return door, validate_corpus, gt_framing


def stage_verified_pairs(verified_dir: str, out_dir: str) -> int:
    """Copy the PASSED models' (step, ir) into one flat directory for the adapter."""
    res = os.path.join(verified_dir, "results.jsonl")
    emi = os.path.join(verified_dir, "emitted.jsonl")
    for p in (res, emi):
        if not os.path.exists(p):
            raise SystemExit(f"REFUSING: {p} missing — run scripts/abc_ofs_verify.py first.")
    passed = set()
    for ln in open(res):
        r = json.loads(ln)
        if r.get("fail") is None and "compare" in r:
            passed.add(r["id"])
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for ln in open(emi):
        j = json.loads(ln)
        if j["id"] not in passed:
            continue
        src = j["outstep"]
        if not os.path.exists(src):
            continue
        with open(src, "rb") as a, open(os.path.join(out_dir, j["id"] + ".step"), "wb") as b:
            b.write(a.read())
        with open(os.path.join(out_dir, j["id"] + ".ir"), "w") as b:
            b.write(j["ir"])
        n += 1
    return n


def write_kernel_censuses(verify_bin: str, pairs_dir: str, ids) -> int:
    """Write <id>.census.json beside each proven solid, from the KERNEL.

    Read back through INPUT() on the solid the kernel itself wrote, so the
    census describes the artefact the assistant side actually produces — not
    the reference arm, and certainly not the dataset's own annotation.

    Written to DISK rather than passed in memory so the adapter can hand it to
    the door as a lookup. An adapter that spawned a kernel to decide what a row
    says would be reasoning, which R2 forbids.
    """
    n = 0
    for mid in ids:
        step = os.path.join(pairs_dir, mid + ".step")
        rec = {"id": mid, "ir": "%1 = INPUT()\nRESULT(%1)\n",
               "inputStep": step, "census": "full"}
        pr = subprocess.run([verify_bin], input=json.dumps(rec) + "\n",
                            capture_output=True, text=True, timeout=300)
        for ln in pr.stdout.splitlines():
            ln = ln.strip()
            if not ln.startswith("{"):
                continue
            try:
                r = json.loads(ln)
            except Exception:
                continue
            if r.get("id") == mid and r.get("ok") and r.get("census"):
                with open(os.path.join(pairs_dir, mid + ".census.json"), "w") as fh:
                    json.dump(r["census"], fh)
                n += 1
    return n


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--verified", required=True, help="abc_ofs_verify.py --out directory")
    ap.add_argument("--verify", required=True, help="path to forge_verify")
    ap.add_argument("--out", required=True)
    ap.add_argument("--models-root", default="/Users/account_clawteam1/archdisc-Models")
    ap.add_argument("--max-faces", type=int, default=None,
                    help="truncate the per-face census (truncation is DECLARED in the payload)")
    a = ap.parse_args()

    door, validate_corpus, gt_framing = load_door(a.models_root)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from abc_ofs_adapter import (adapter_abc_ofs, abc_ofs_assistant,    # noqa: E402
                                 abc_ofs_census)

    # The patch registers exactly this. Registering it in memory keeps ONE door.
    door.ADAPTERS["abc_ofs"] = adapter_abc_ofs

    os.makedirs(a.out, exist_ok=True)
    pairs = os.path.join(a.out, "verified_pairs")
    n_pairs = stage_verified_pairs(a.verified, pairs)
    print(f"[abc_ofs] verified (step, ir) pairs staged: {n_pairs}")
    if n_pairs == 0:
        raise SystemExit("REFUSING TO WRITE AN EMPTY CORPUS — no model passed the gate.")

    have = door.preflight_instruments()
    print(f"[abc_ofs] measurement backends: {', '.join(have)}")
    system = door.canonical_system_prompt()
    print(f"[abc_ofs] system prompt: {len(system)} chars, read from {door.CANON_SYSTEM_SOURCE}")

    ids = sorted(n[:-len(".step")] for n in os.listdir(pairs) if n.endswith(".step"))
    n_cen = write_kernel_censuses(a.verify, pairs, ids)
    print(f"[abc_ofs] kernel face censuses written: {n_cen}/{len(ids)}")

    seen: set = set()
    accepted, rejected = [], []
    n_in = 0
    for rec in door.ADAPTERS["abc_ofs"](pairs, None):
        n_in += 1
        try:
            payload, rej = door.stage_measure(rec, seen)
        except Exception as e:
            rejected.append(door.Rejection(rec.uid, "measure", f"{type(e).__name__}: {e}"))
            continue
        if rej is not None:
            rejected.append(rej)
            continue
        try:
            c = abc_ofs_census(rec)
        except Exception as e:
            rejected.append(door.Rejection(rec.uid, "emit", f"{type(e).__name__}: {e}"))
            continue
        try:
            asst = abc_ofs_assistant(rec)
        except Exception as e:
            rejected.append(door.Rejection(rec.uid, "emit", f"{type(e).__name__}: {e}"))
            continue
        user = gt_framing.user_decomp(c, max_faces=a.max_faces)
        accepted.append(door.build_row(system, user, asst, None))

    # R1: the counts must reconcile, or we do not know what we built.
    assert n_in == len(accepted) + len(rejected), \
        f"ROW RECONCILIATION FAILED: in={n_in} accepted={len(accepted)} rejected={len(rejected)}"

    # R5: the trainer's own gate, not a reimplementation of it.
    for row in accepted:
        why = validate_corpus.check_row(row, require_image_resolves=True)
        if why:
            raise SystemExit(f"FATAL: writer produced a non-conforming row: {why}")

    train = os.path.join(a.out, "train.jsonl")
    with open(train, "w") as fh:
        for row in accepted:
            fh.write(json.dumps(row) + "\n")
    with open(os.path.join(a.out, "rejected.jsonl"), "w") as fh:
        for r in rejected:
            fh.write(json.dumps(r.__dict__) + "\n")
    print(f"[abc_ofs] in={n_in} accepted={len(accepted)} rejected={len(rejected)}")
    for r in rejected[:10]:
        print(f"[abc_ofs]   rejected@{r.stage}: {r.reason[:120]}")

    # R4: scanned BEFORE the corpus is called usable, by the tool that
    # enumerates holdouts from disk at run time.
    scan = os.path.join(a.models_root, "scripts", "scan_census_contamination.py")
    pr = subprocess.run([sys.executable, scan, train], capture_output=True, text=True)
    sys.stdout.write(pr.stdout)
    if pr.returncode != 0:
        sys.stdout.write(pr.stderr)
        raise SystemExit("REFUSING TO CERTIFY: the contamination scan did not pass.")
    print(f"[abc_ofs] wrote {train}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
