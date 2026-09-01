#!/usr/bin/env python3
"""Prove a defer-label change is BEHAVIOUR-NEUTRAL: every native arm identical
except `note`.

Modelled on the inertness proof in reports/corpus_ab/THICKSOLID_ATTRIBUTION.md
section 1, which is the discipline this repository already applies to the
FK_DEFER channel: a diagnostic that changes a predicate is not a diagnostic.

usage:  python3 compare_inertness.py BEFORE_results.jsonl AFTER_results.jsonl

Exit 0 iff every native payload and every top-level field is identical and the
OCCT arm differs at most in a centre-of-mass component within 1e-12. Anything
else is printed, never summarised away.

RESULT for this directory (600 parts, 6600 rows, 32ee7485 -> 40c6073d):

    1. native arm identical except `note` : 6600/6600
    2. top-level fields identical         : 6599/6600
    3. OCCT arm byte-identical            : 6587/6600
       (+12 differing only in a com component within 1e-12)
    notes that changed: 81, ALL of them
       THRUSECTIONS  ...|xlate_edge_count_mismatch -> ...|xlate_not_a_translate_length

The ONE row in (2) is ho317/THICKSOLID, whose OCCT arm went CRASH(signal 11) ->
OK. It is not this change: THICKSOLID does not call NativeLoftPipe.cpp, its
native arm is byte-identical in both runs (DEFER q_planar_wire_not_circle_or_
polygon), and the SAME binary run six times on that one part segfaults on one of
the six. OCCT's BRepOffsetAPI_MakeThickSolid is not reproducible on this part —
which is worth knowing on its own, because family G's flip gate is defined
against that baseline.
"""
import json, sys, collections

def load(p):
    d = {}
    for line in open(p):
        line = line.strip()
        if not line: continue
        r = json.loads(line)
        d[(r["part"], r["family"])] = r
    return d

A = load(sys.argv[1])   # BEFORE
B = load(sys.argv[2])   # AFTER
keys = sorted(set(A) & set(B))
print("rows compared            : %d   (before %d, after %d)" % (len(keys), len(A), len(B)))

same_native_but_note = 0
native_payload_diff = []
note_changed = collections.Counter()
top_diff = []
occt_identical = 0
occt_com_only = 0
occt_other = []

for k in keys:
    a, b = A[k], B[k]
    an, bn = dict(a.get("native") or {}), dict(b.get("native") or {})
    an_note, bn_note = an.pop("note", ""), bn.pop("note", "")
    if an == bn:
        same_native_but_note += 1
    else:
        native_payload_diff.append((k, {f: (an.get(f), bn.get(f)) for f in an
                                        if an.get(f) != bn.get(f)}))
    if an_note != bn_note:
        note_changed[(a["family"], an_note[:70], bn_note[:70])] += 1

    ta = {f: a[f] for f in a if f not in ("native", "occt")}
    tb = {f: b[f] for f in b if f not in ("native", "occt")}
    if ta != tb:
        top_diff.append((k, {f: (ta.get(f), tb.get(f)) for f in ta if ta.get(f) != tb.get(f)}))

    ao, bo = dict(a.get("occt") or {}), dict(b.get("occt") or {})
    if ao == bo:
        occt_identical += 1
    else:
        d = {f: (ao.get(f), bo.get(f)) for f in ao if ao.get(f) != bo.get(f)}
        if set(d) <= {"com"} and d.get("com") and all(
                abs(x - y) <= 1e-12 * max(1.0, abs(x), abs(y))
                for x, y in zip(d["com"][0], d["com"][1])):
            occt_com_only += 1
        else:
            occt_other.append((k, d))

print()
print("1. native arm identical except `note` : %d/%d" % (same_native_but_note, len(keys)))
for k, d in native_payload_diff[:10]:
    print("     PAYLOAD DIFFERS %s %s" % (k, d))
print("2. top-level fields identical         : %d/%d" % (len(keys) - len(top_diff), len(keys)))
for k, d in top_diff[:10]:
    print("     TOP DIFFERS %s %s" % (k, d))
print("3. OCCT arm byte-identical            : %d/%d" % (occt_identical, len(keys)))
print("   OCCT arm differing only in com within 1e-12 : %d" % occt_com_only)
for k, d in occt_other[:6]:
    print("     OCCT DIFFERS %s %s" % (k, list(d)))
print()
print("notes that changed (%d rows):" % sum(note_changed.values()))
for (fam, o, n), c in note_changed.most_common(12):
    print("   %4d  %-14s %-60s -> %s" % (c, fam, o or "(empty)", n or "(empty)"))

verdict = (not native_payload_diff) and (not top_diff) and (not occt_other)
print()
print("VERDICT:", "INERT (geometry unchanged, only the recorded label moved)" if verdict
      else "NOT INERT — investigate the rows above")
sys.exit(0 if verdict else 1)
