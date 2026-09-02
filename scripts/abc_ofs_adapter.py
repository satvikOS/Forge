#!/usr/bin/env python3
"""abc_ofs_adapter.py — the `abc_ofs` source adapter for canonicalize_dataset.py.

THIS IS AN ADAPTER, AND ADAPTERS MAY NOT REASON (canonicalize_dataset R2). All
of the judgement — what an ofs tree means, which ring is a hole, whether the
model can be translated at all — happens EARLIER, in abc_ofs_to_ir.py, and is
PROVED by abc_ofs_verify.py before a single row is offered here. What this file
does is walk a directory of already-verified pairs and yield them:

    <verified_dir>/<model-id>.step   the solid the KERNEL built from the IR
    <verified_dir>/<model-id>.ir     the IR text that built it

The adapter therefore yields exactly what `local_step_dir` yields — a geometry
path the shared stages measure with our own instruments — plus the construction
sequence, so the assistant side is READ from a proven artefact rather than
invented at emit time.

INSTALLATION (the patch in abc_ofs_canonicalize.patch does exactly this):

    from abc_ofs_adapter import adapter_abc_ofs, abc_ofs_assistant
    ADAPTERS["abc_ofs"] = adapter_abc_ofs

plus the emit arm in main() that calls abc_ofs_assistant(rec) for this source
instead of the blanket "IR recovery is not wired for this source" rejection.
"""
from __future__ import annotations

import hashlib
import os


def adapter_abc_ofs(raw_dir: str, limit):
    """Yield one RawRecord per VERIFIED (step, ir) pair under raw_dir.

    R3 — an unimplemented adapter raises; this one is implemented, so it must
    also refuse to look implemented when its input is absent: a missing or empty
    directory raises rather than yielding zero rows, because "no data" and "not
    wired up" must not look alike downstream.
    """
    from canonicalize_dataset import RawRecord            # the door owns the type

    if not os.path.isdir(raw_dir):
        raise FileNotFoundError(
            f"abc_ofs: {raw_dir} does not exist. It must be the --out directory of "
            "scripts/abc_ofs_verify.py, holding <id>.step + <id>.ir for the models "
            "that PASSED the differential gate."
        )
    names = sorted(n for n in os.listdir(raw_dir) if n.endswith(".step"))
    if not names:
        raise FileNotFoundError(
            f"abc_ofs: no .step under {raw_dir} — refusing to yield zero rows silently."
        )
    n = 0
    for nm in names:
        stem = nm[:-len(".step")]
        ir_path = os.path.join(raw_dir, stem + ".ir")
        if not os.path.exists(ir_path):
            # NEVER SILENTLY DROP A ROW (R1): yield it and let the shared stages
            # reject it with a measured reason, rather than skipping it here.
            ir_path = None
        yield RawRecord(
            uid=hashlib.sha256(("abc_ofs/" + stem).encode()).hexdigest()[:16],
            geometry_path=os.path.join(raw_dir, nm),
            construction_seq={"ir_path": ir_path, "model": stem},
            provenance={"adapter": "abc_ofs", "model": stem,
                        "source": "ABC / Onshape public documents (ofs FeatureScript)",
                        "licence": "UNVERIFIED — see MODEL_DATA.md section 3"},
        )
        n += 1
        if limit and n >= limit:
            return


def abc_ofs_assistant(rec) -> str:
    """The assistant side: the IR that the kernel PROVED rebuilds this solid.

    Not a recovery, not a guess — the exact text abc_ofs_verify.py compiled and
    then measured against an independent OCCT build of the same tree. If it is
    missing, raise: an empty assistant side must fail loudly, never quietly.
    """
    seq = rec.construction_seq or {}
    p = seq.get("ir_path")
    if not p or not os.path.exists(p):
        raise FileNotFoundError(f"abc_ofs: no verified IR beside {rec.geometry_path}")
    with open(p) as fh:
        ir = fh.read().strip()
    if not ir:
        raise ValueError(f"abc_ofs: empty IR at {p}")
    return ir


def abc_ofs_census(rec) -> dict:
    """The KERNEL-MEASURED face census of this solid, written beside it.

    Read from disk, not measured here: an adapter that spawned a kernel to
    decide what a row says would be reasoning. scripts/abc_ofs_corpus.py writes
    `<id>.census.json` next to `<id>.step` from forge_verify's own
    `census:"full"` output, so this is a lookup with no judgement in it.
    """
    import json
    seq = rec.construction_seq or {}
    stem = seq.get("model")
    p = os.path.join(os.path.dirname(rec.geometry_path), f"{stem}.census.json")
    if not os.path.exists(p):
        raise FileNotFoundError(f"abc_ofs: no kernel census beside {rec.geometry_path}")
    with open(p) as fh:
        return json.load(fh)
