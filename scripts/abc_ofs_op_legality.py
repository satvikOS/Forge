#!/usr/bin/env python3
"""Every op in every emitted tree must be USER-INVOCABLE.

Archie may only emit feature-tree IR that a human user of the Forge app can also
produce. A corpus that teaches an op no command exposes teaches an API the product
does not have. The authority is implementation/sacrosanct/archie_op_vocabulary.json,
which is DERIVED from the sources rather than transcribed.
"""
import collections, json, re, sys

vocab_path = sys.argv[1]
emitted_path = sys.argv[2]

V = json.load(open(vocab_path))
allowed = {o["op"] for o in V["ops"]}
forbidden = {o["op"] for o in V.get("forbidden_ops", [])}
# RESULT is a statement form, not an op row; the kernel executes it.
statement_forms = {"RESULT", "VERIFY", "INPUT"}

OP = re.compile(r"=\s*([A-Z][A-Z0-9_]*)\s*\(")
STMT = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*\(", re.M)

hist = collections.Counter()
illegal = collections.Counter()
rows = 0
for ln in open(emitted_path):
    j = json.loads(ln)
    ir = j.get("ir") or ""
    rows += 1
    ops = set()
    for m in OP.finditer(ir):
        ops.add(m.group(1))
    for m in STMT.finditer(ir):
        ops.add(m.group(1))
    for o in ops:
        hist[o] += 1
        if o not in allowed and o not in statement_forms:
            illegal[o] += 1

print(f"rows                 : {rows}")
print(f"user-invocable ops   : {len(allowed)}")
print(f"ops used by corpus   : {len(hist)}")
print()
print("op histogram (rows containing the op):")
for o, n in hist.most_common():
    mark = "  <-- NOT USER-INVOCABLE" if o in illegal else ""
    print(f"  {o:10s} {n:6d}{mark}")
print()
if illegal:
    print("FAIL: ops outside the user-invocable vocabulary:", dict(illegal))
    sys.exit(1)
print("PASS: every op emitted is user-invocable (or a kernel statement form).")
