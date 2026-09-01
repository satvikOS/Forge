#!/usr/bin/env python3
"""document_roundtrip_check.py — does a .fpart round trip change the SOLID?

Driven by ui/test/run_document_roundtrip_gate.sh, which compiles the emitter and
finds a forge_verify binary. This half asks the kernel to build each program and
compares what came back.

═══ WHY A VECTOR AND NOT A VOLUME ═════════════════════════════════════════════

Volume cannot validate geometry. The divergence theorem computes a volume from a
surface integral, so a shell that self-intersects — a shell describing no solid
at all — can return exactly the right number. Four measured cases in this
programme have already turned on that, and in one of them NO SINGLE observable
caught the defect: the centre of mass was clean on the sphere and the bounding
box was clean on the cylinder.

So every comparison here is over a VECTOR, and every component of it is the
KERNEL's own measurement of the built solid, read out of forge_verify:

  volume            MassProps
  bbox min/max      six numbers, so a part that is the right size in the wrong
                    place is not the right part
  faceCount         topology
  edgeCount         topology
  vertexCount       topology
  shellCount        the fixture has TWO — the shroud encloses a void — so a
                    round trip that lost the shroud would move this alone
  genus             the fixture is genus 6; a lost hole moves it
  bodies            one; a lost fuse makes it two
  valid             BRepCheck
  surfaceArea       sum of the per-face census areas
  surfaceCentroid   area-weighted centroid of the boundary. This is the CENTRE
                    the census can give exactly: forge_verify reports per-face
                    area and centroid but not the volumetric centre of mass, and
                    a surface centroid computed from the kernel's own inventory
                    is a measured quantity, where a volumetric one would be a
                    number this script invented. It moves for the same reasons a
                    centre of mass moves and for some it does not: it is
                    sensitive to a face being ADDED, which a mass property is not.
  kindHistogram     how many planes, cylinders, cones, spheres, tori, b-splines.
                    A defect that keeps every count and every scalar but swaps a
                    cylinder for a b-spline is a different part.

═══ WHAT IS ASSERTED ══════════════════════════════════════════════════════════

  1. before, after and after2 all BUILD. "Both sides failed identically" is not
     a round trip, and it is the way this gate would most easily be green for
     nothing.
  2. vector(before) == vector(after) == vector(after2), component by component,
     exactly. No tolerance: these are meant to be the same program, and a
     tolerance here would be a place for a real difference to hide.
  3. POSITIVE CONTROL — vector(full) != vector(before). The fixture is saved with
     a suppression and a rollback bar, so the document AS WRITTEN and the
     document AS BUILT are different solids. If the instrument cannot tell those
     two apart, it could not have told before from after either, and (2) would be
     green for the wrong reason.
  4. MUTATION PROOF — five fields of the saved document are corrupted in turn and
     each must move the vector. A gate that cannot show its instrument noticing a
     lost SUPPRESSED line would stay green if the reader stopped reading it.

Exit 0 on pass, 1 on a failed assertion, 3 when the kernel could not be used at
all — never a silent skip.
"""
import json
import os
import subprocess
import sys

# forge_verify batches one JSON record per line; a big fixture takes a few
# seconds, and a hang must fail rather than sit.
TIMEOUT_S = 300

COMPONENTS = [
    "valid", "volume", "faceCount", "edgeCount", "vertexCount", "bodies",
    "genus", "shellCount", "bboxMin", "bboxMax", "surfaceArea",
    "surfaceCentroid", "kindHistogram",
]


def measure(verify_bin, ir_path):
    """Build one feature-IR program through the kernel and read the vector back."""
    try:
        ir = open(ir_path).read()
    except OSError as exc:
        return None, "cannot read %s: %s" % (ir_path, exc)
    if not ir.strip():
        return None, "the program is empty"
    record = json.dumps({"id": os.path.basename(ir_path), "census": "full", "ir": ir})
    try:
        proc = subprocess.run([verify_bin], input=record + "\n", capture_output=True,
                              text=True, timeout=TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None, "forge_verify did not finish in %ds" % TIMEOUT_S
    out = proc.stdout.strip()
    if not out:
        return None, "forge_verify wrote nothing (rc=%d): %s" % (
            proc.returncode, proc.stderr.strip()[-300:])
    try:
        d = json.loads(out.split("\n")[0])
    except ValueError as exc:
        return None, "forge_verify did not emit JSON: %s" % exc
    if not d.get("ok"):
        return None, "kernel refused the program: %s (failedOpId=%s)" % (
            str(d.get("error"))[:300], d.get("failedOpId"))
    census = d.get("census")
    if not census or "faces" not in census:
        return None, "forge_verify returned no face census — was it built without it?"
    faces = census["faces"]
    area = sum(f["area"] for f in faces)
    if area <= 0.0:
        return None, "the built solid has no surface area"
    centroid = [sum(f["area"] * f["centroid"][k] for f in faces) / area for k in range(3)]
    vector = {
        "valid": bool(d.get("valid")),
        "volume": round(float(d["volume"]), 6),
        "faceCount": int(d["faceCount"]),
        "edgeCount": int(d["edgeCount"]),
        "vertexCount": int(d.get("vertexCount", -1)),
        "bodies": int(d.get("bodies", -1)),
        "genus": int(d.get("genus", -1)),
        "shellCount": int(d.get("shellCount", -1)),
        "bboxMin": [round(v, 6) for v in d["bbox"]["min"]],
        "bboxMax": [round(v, 6) for v in d["bbox"]["max"]],
        "surfaceArea": round(area, 6),
        "surfaceCentroid": [round(v, 6) for v in centroid],
        "kindHistogram": census.get("kind_histogram", {}),
    }
    return vector, None


def differing(a, b):
    return [c for c in COMPONENTS if a[c] != b[c]]


def show(name, v):
    print("  %-9s volume=%.6f faces=%d edges=%d verts=%d bodies=%d genus=%d shells=%d valid=%s"
          % (name, v["volume"], v["faceCount"], v["edgeCount"], v["vertexCount"],
             v["bodies"], v["genus"], v["shellCount"], v["valid"]))
    print("            bbox=[%s]..[%s]"
          % (", ".join("%g" % x for x in v["bboxMin"]),
             ", ".join("%g" % x for x in v["bboxMax"])))
    print("            area=%.6f surfaceCentroid=[%s]"
          % (v["surfaceArea"], ", ".join("%g" % x for x in v["surfaceCentroid"])))
    print("            faces by kind: %s"
          % ", ".join("%s=%d" % kv for kv in sorted(v["kindHistogram"].items())))


# ── the five mutations ──────────────────────────────────────────────────────
# Each drops or changes ONE field of the saved document. Each must move the
# vector; the report says WHICH components moved, which is the evidence that
# "use a vector of observables" is doing work rather than decorating a volume
# check.
def mutate_drop_suppressed(text):
    """The SUPPRESSED flag: the rib that was turned off gets built again."""
    return "\n".join(l for l in text.split("\n") if l != "SUPPRESSED")


def mutate_drop_rollback(text):
    """The rollback bar: the three statements past it get built."""
    return "\n".join(l for l in text.split("\n") if not l.startswith("ROLLBACK "))


def mutate_arg_value(text):
    """One ARG: the plate becomes 130 wide instead of 120."""
    return text.replace("ARG num 120\n", "ARG num 130\n", 1)


def mutate_drop_arg(text):
    """One ARG deleted: the statement's arity breaks, so it and its chain fall
    out of the build and the tree says so."""
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line == "OP HOLE":
            del lines[i + 1]          # the %ref, so HOLE loses its body
            break
    return "\n".join(lines)


def mutate_kind(text):
    """One KIND: solid claimed where a profile is produced. The kernel does not
    read KIND, so this one is EXPECTED NOT to move the geometry — it is here as
    the gate's own NEGATIVE control, and it is reported, not required."""
    return text.replace("KIND profile\n", "KIND solid\n", 1)


MUTATIONS = [
    ("drop the SUPPRESSED flag", mutate_drop_suppressed, True),
    ("drop the ROLLBACK bar", mutate_drop_rollback, True),
    ("change one ARG num 120 -> 130", mutate_arg_value, True),
    ("delete one ARG from a HOLE", mutate_drop_arg, True),
    ("change one KIND profile -> solid", mutate_kind, False),
]


def main():
    if len(sys.argv) != 4:
        print("usage: document_roundtrip_check.py <forge_verify> <emit-bin> <work-dir>")
        return 3
    verify_bin, emit_bin, work = sys.argv[1], sys.argv[2], sys.argv[3]
    if not os.access(verify_bin, os.X_OK):
        print("[roundtrip] no usable forge_verify at %s" % verify_bin)
        return 3

    failures = []

    def check(ok, what):
        print("  %s %s" % ("PASS" if ok else "FAIL", what))
        if not ok:
            failures.append(what)
        return ok

    # ── 1. measure the four programs ─────────────────────────────────────────
    print("[roundtrip] measuring, through %s" % verify_bin)
    vectors = {}
    for name in ("full", "before", "after", "after2"):
        v, why = measure(verify_bin, os.path.join(work, name + ".ir"))
        if v is None:
            print("  FAIL %s did not build: %s" % (name, why))
            failures.append("%s did not build" % name)
        else:
            vectors[name] = v
            show(name, v)
    if len(vectors) != 4:
        print("[roundtrip] VERDICT: FAIL — %d of 4 programs did not build" % (4 - len(vectors)))
        return 1

    # ── 2. the round trip changed nothing ────────────────────────────────────
    print("[roundtrip] the round trip:")
    d1 = differing(vectors["before"], vectors["after"])
    check(not d1, "save -> load leaves every observable unchanged"
                  + ("" if not d1 else " (moved: %s)" % ", ".join(d1)))
    d2 = differing(vectors["after"], vectors["after2"])
    check(not d2, "a SECOND save -> load leaves every observable unchanged"
                  + ("" if not d2 else " (moved: %s)" % ", ".join(d2)))
    check(vectors["before"]["valid"], "the solid the round trip preserves is BRepCheck-valid")
    check(vectors["before"]["bodies"] == 1, "and it is one body, not a pile of pieces")
    check(vectors["before"]["shellCount"] >= 2,
          "with an enclosed void, so shellCount is load-bearing (got %d)"
          % vectors["before"]["shellCount"])
    check(vectors["before"]["genus"] > 0,
          "and a non-trivial genus, so a lost hole would show (got %d)"
          % vectors["before"]["genus"])

    # ── 3. the positive control ──────────────────────────────────────────────
    print("[roundtrip] positive control — the instrument can tell two programs apart:")
    moved = differing(vectors["full"], vectors["before"])
    check(bool(moved),
          "the document AS WRITTEN and the document AS BUILT measure differently"
          + (" (moved: %s)" % ", ".join(moved) if moved else ""))

    # ── 4. mutation proof ────────────────────────────────────────────────────
    print("[roundtrip] mutation proof — corrupt one saved field at a time:")
    saved = open(os.path.join(work, "doc.fpart")).read()
    for label, fn, must_move in MUTATIONS:
        text = fn(saved)
        if text == saved:
            check(False, "mutation '%s' changed nothing in the file — it is not testing anything"
                  % label)
            continue
        mpath = os.path.join(work, "mutant.fpart")
        mir = os.path.join(work, "mutant.ir")
        open(mpath, "w").write(text)
        rc = subprocess.run([emit_bin, "--reload", mpath, mir], capture_output=True,
                            text=True, timeout=TIMEOUT_S)
        if rc.returncode != 0:
            check(False, "mutation '%s': the reloader itself failed (rc=%d)" % (label, rc.returncode))
            continue
        v, why = measure(verify_bin, mir)
        if v is None:
            # A mutation the kernel cannot build at all is CAUGHT — that is a
            # difference of the sharpest kind.
            if must_move:
                check(True, "mutation '%s' caught: the program no longer builds (%s)"
                      % (label, why[:80]))
            else:
                check(True, "control '%s': not required to move; it did not build (%s)"
                      % (label, why[:60]))
            continue
        moved = differing(vectors["before"], v)
        if must_move:
            check(bool(moved), "mutation '%s' caught by: %s"
                  % (label, ", ".join(moved) if moved else "NOTHING"))
        else:
            print("  NOTE control '%s' moved: %s"
                  % (label, ", ".join(moved) if moved else "nothing, as expected"))

    if failures:
        print("[roundtrip] VERDICT: FAIL — %d check(s):" % len(failures))
        for f in failures:
            print("    - %s" % f)
        return 1
    print("[roundtrip] VERDICT: PASS — the .fpart round trip preserves the SOLID on "
          "%d observables, proved against a positive control and %d mutations"
          % (len(COMPONENTS), sum(1 for m in MUTATIONS if m[2])))
    return 0


if __name__ == "__main__":
    sys.exit(main())
