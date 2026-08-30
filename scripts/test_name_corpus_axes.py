#!/usr/bin/env python3
"""test_name_corpus_axes.py -- self-test for the axis-naming corpus transform.

Runs with a bare interpreter (no pytest). Every NEGATIVE control here is a case
where the transform MUST refuse: the whole value of the script is that it labels a
row only when the row itself carries evidence for the label, so a test suite that
only checked the happy path would be testing the wrong thing.

    python3 scripts/test_name_corpus_axes.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import name_corpus_axes as nca  # noqa: E402

FAILURES = []


def check(name, cond, detail=""):
    if cond:
        print("  ok    %s" % name)
    else:
        print("  FAIL  %s   %s" % (name, detail))
        FAILURES.append(name)


def row(user, assistant, image=None):
    return {"image": image,
            "messages": [{"role": "system", "content": "sys"},
                         {"role": "user", "content": user},
                         {"role": "assistant", "content": assistant}]}


# --------------------------------------------------------------------------- #
#  fixtures, copied in shape from the four real generators                     #
# --------------------------------------------------------------------------- #
CENSUS = ("Rebuild this solid from construction ops. Kernel-measured census:\n"
          "\n"
          "- overall envelope: 19.000 x 104.920 x 54.000 mm\n"
          "- bounding box: X[-9.500, 9.500] Y[-52.460, 52.460] Z[-27.000, 27.000] mm\n"
          "- volume: 15311.5 mm^3")
TITLE = ("Read this engineering drawing.\n\n"
         "TITLE BLOCK\n"
         "  units: mm\n"
         "  overall envelope: 244.600 x 244.600 x 37.200 mm\n"
         "  datum extents: X[-122.300, 122.300]  Y[-122.300, 122.300]  "
         "Z[0.000, 37.200]\n")
MEASURED = ("The design features a cylindrical base.\n\n"
            "Measured: overall envelope about 219.5 x 562.5 x 66.53 mm; "
            "2 drilled bores; genus 2.")
MEAS_IR = '%1 = RECT(1, 2, 3, 4)\n%2 = VERIFY(%1, "holes=2", "bbox.z=66.53")\nRESULT(%2)'
INVENTORY = ("Rebuild this exact solid from construction ops. "
             "Overall envelope 279.44 x 99.6 x 21.026 mm.\n\n"
             "TARGET GEOMETRY INVENTORY (full face census, kernel-measured):\n"
             '{\n "bbox": {\n  "min": [\n   -94.900002,\n   -49.799999,\n   0\n  ],\n'
             '  "max": [\n   184.539993,\n   49.799999,\n   21.025999\n  ]\n }\n}')

print("1. the four real prompt families are recognised and labelled")
for name, user, ir, want in (
    ("census", CENSUS, "RESULT(%1)",
     "- overall envelope: X=19.000 mm, Y=104.920 mm, Z=54.000 mm\n"),
    ("title", TITLE, "RESULT(%1)",
     "  overall envelope: X=244.600 mm, Y=244.600 mm, Z=37.200 mm\n"),
    ("measured", MEASURED, MEAS_IR,
     "Measured: overall envelope about X=219.5 mm, Y=562.5 mm, Z=66.53 mm;"),
    ("inventory", INVENTORY, "RESULT(%1)",
     "Overall envelope X=279.44 mm, Y=99.6 mm, Z=21.026 mm."),
):
    fam, m, stated, wit, src = nca.bind_axes(user, ir)
    out = nca.rewrite(user, fam, m, "axis")
    check("%s family labelled" % name, fam == name and want in out,
          "got %r" % out[max(0, m.start() - 5):m.start() + 80])
    check("%s round-trips" % name, nca.unlabel(out, "axis") == user)

print("2. printed precision is copied verbatim, never reformatted")
fam, m, _s, _w, _r = nca.bind_axes(CENSUS, "RESULT(%1)")
out = nca.rewrite(CENSUS, fam, m, "axis")
check("trailing zeros kept (54.000 not 54.0)", "Z=54.000 mm" in out)
check("no other line touched",
      "- bounding box: X[-9.500, 9.500] Y[-52.460, 52.460] Z[-27.000, 27.000] mm" in out
      and "- volume: 15311.5 mm^3" in out)

print("3. NEGATIVE: a row with no evidence for the mapping is refused")
cases = [
    ("no envelope statement", "Remove the hole from the part.", "RESULT(%1)",
     "no-envelope-statement"),
    # envelope present, but nothing anywhere states which number is which axis
    ("no witness at all",
     "Measured: overall envelope about 219.5 x 562.5 x 66.53 mm.",
     '%1 = RECT(1,2,3,4)\n%2 = VERIFY(%1, "holes=0")\nRESULT(%2)',
     "no-axis-witness"),
    # the bbox in the prompt says the slots are in a different order
    ("prompt bbox contradicts the slots",
     CENSUS.replace("19.000 x 104.920 x 54.000", "104.920 x 54.000 x 19.000"),
     "RESULT(%1)", "witness-contradiction"),
    # the target's own VERIFY claim disagrees with slot 2
    ("target VERIFY contradicts slot Z", MEASURED,
     '%1 = RECT(1,2,3,4)\n%2 = VERIFY(%1, "bbox.z=219.5")\nRESULT(%2)',
     "witness-contradiction"),
    # two envelope statements: which one describes the part is undecidable
    ("two envelope statements",
     MEASURED + "\n" + "Measured: overall envelope about 1 x 2 x 3 mm.",
     MEAS_IR, "multiple-envelope-statements"),
    ("two envelope families", CENSUS + "\n" + MEASURED, MEAS_IR,
     "multiple-envelope-families"),
]
for name, user, ir, want in cases:
    try:
        nca.bind_axes(user, ir)
        check(name, False, "was labelled; should have been skipped")
    except nca.Skip as sk:
        check("%s -> %s" % (name, sk.reason), sk.reason == want,
              "got %s, wanted %s" % (sk.reason, want))

print("4. the per-row witness is recorded honestly (not over-claimed)")
_f, _m, _s, wit, src = nca.bind_axes(MEASURED, MEAS_IR)
check("bbox.z-only row claims only Z", wit == {2}, "got %r" % (wit,))
check("  and names its source", src == ["target-verify"], "got %r" % (src,))
_f, _m, _s, wit, src = nca.bind_axes(CENSUS, "RESULT(%1)")
check("prompt-bbox row claims all three", wit == {0, 1, 2}, "got %r" % (wit,))
check("  and names its source", src == ["prompt-bracket"], "got %r" % (src,))

print("5. Law 8: the contamination guard must still SEE the labelled envelope")
stated_envelopes, err = nca._load_guard()
if err:
    check("guard importable", False, err)
else:
    triple = [19.0, 104.92, 54.0]
    axis = nca.render("axis", ["19.000", "104.920", "54.000"])
    lwt = nca.render("lwt", ["19.000", "104.920", "54.000"])
    check("guard R3 parses the DEFAULT axis form",
          nca.guard_sees(stated_envelopes, axis, triple))
    check("guard R3 parses the ORIGINAL bare triple",
          nca.guard_sees(stated_envelopes, "19.000 x 104.920 x 54.000 mm", triple))
    # This is why `axis` is the default and `lwt` is not. If a future guard change
    # teaches NAMED_RE the parenthesised form, this assertion is the thing that
    # tells you the default may be revisited -- it is not a wish for R3 to fail.
    check("guard R3 is BLIND to the lwt form (so it is not the default)",
          not nca.guard_sees(stated_envelopes, lwt, triple))
    check("negative control: a two-number span is not a triple",
          not nca.guard_sees(stated_envelopes, "X=19.000 mm, Y=104.920 mm", triple))

print("6. end to end through the CLI, on a temp corpus")
with tempfile.TemporaryDirectory() as td:
    src_p = os.path.join(td, "in.jsonl")
    out_p = os.path.join(td, "out.jsonl")
    rows = [row(CENSUS, "RESULT(%1)"), row(MEASURED, MEAS_IR),
            row("Remove the hole from the part.", "RESULT(%1)"),
            row(INVENTORY, "RESULT(%1)", image="/x/y.png")]
    with open(src_p, "w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
    before = nca.sha256(src_p)
    rc = nca.main(["--apply", src_p, "--out", out_p])
    check("apply exits 0", rc == 0)
    check("input corpus untouched", nca.sha256(src_p) == before)
    check("verify round-trips", nca.main(["--verify", src_p, "--out", out_p]) == 0)
    got = [json.loads(l) for l in open(out_p)]
    check("row count preserved", len(got) == len(rows))
    check("image field preserved", got[3]["image"] == "/x/y.png")
    check("assistant turns byte-identical",
          all(g["messages"][2]["content"] == r["messages"][2]["content"]
              for g, r in zip(got, rows)))
    check("the edit row is passed through unchanged",
          got[2]["messages"][1]["content"] == "Remove the hole from the part.")
    # --apply onto the input path must refuse rather than destroy the corpus.
    try:
        rc = nca.main(["--apply", src_p, "--out", src_p])
        check("refuses --out == --in", rc == 2, "returned %r" % rc)
    except SystemExit as exc:
        check("refuses --out == --in", exc.code not in (0, None))
    check("input still intact after that refusal", nca.sha256(src_p) == before)

    # A corpus the lwt style cannot label safely must produce NO output file.
    out2 = os.path.join(td, "out_lwt.jsonl")
    rc = nca.main(["--apply", src_p, "--out", out2, "--style", "lwt"])
    check("lwt style FAILS the guard control and writes nothing",
          rc != 0 and not os.path.exists(out2), "rc=%r exists=%s"
          % (rc, os.path.exists(out2)))

print()
if FAILURES:
    print("FAILED: %d" % len(FAILURES))
    for f in FAILURES:
        print("   -", f)
    sys.exit(1)
print("all checks passed")
