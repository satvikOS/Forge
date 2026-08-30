#!/usr/bin/env python3
"""Measure a corpus of feature-tree IR against the committed op vocabulary.

This is the tool a training run uses BEFORE it trains: it answers "how much of
this corpus is inside the vocabulary a user can actually reach", per statement
and per program, and names the ops that put a program outside it. A corpus that
scores low is not a reason to widen Archie's emission -- it is the measurement
that says which Forge commands are missing.

    python3 implementation/sacrosanct/tools/measure_vocabulary_coverage.py FILE...

Any text file works: every `%<id> = OP(...)` line is a statement, and a run of
statements separated by fewer than two blank lines is one program. --jsonl reads
{"messages": [...]} rows and scans the assistant turn instead.
"""
import argparse
import collections
import json
import os
import re
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
VOCAB = os.path.join(REPO, "implementation", "sacrosanct", "archie_op_vocabulary.json")
STMT = re.compile(r"%\d+\s*=\s*([A-Z][A-Z0-9]*)\s*\(")


def load_vocabulary(path=VOCAB):
    with open(path) as fh:
        doc = json.load(fh)
    return doc, set(doc["emission_policy"]["allowed_ops"])


def programs_in(text):
    """Split a blob into programs: a run of IR statements with no blank-line gap."""
    out, cur = [], []
    for line in text.split("\n"):
        ops = STMT.findall(line)
        if ops:
            cur.extend(ops)
        elif not line.strip() and cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+")
    ap.add_argument("--jsonl", action="store_true",
                    help="each line is {\"messages\": [...]}; scan the assistant turn")
    ap.add_argument("--vocabulary", default=VOCAB)
    args = ap.parse_args(argv)

    doc, allowed = load_vocabulary(args.vocabulary)
    freq = collections.Counter()
    progs = []
    for path in args.files:
        with open(path) as fh:
            text = fh.read()
        if args.jsonl:
            for line in text.split("\n"):
                if not line.strip():
                    continue
                row = json.loads(line)
                for msg in row.get("messages", []):
                    if msg.get("role") == "assistant":
                        progs.extend(programs_in(msg.get("content", "")))
        else:
            progs.extend(programs_in(text))
    for p in progs:
        freq.update(p)

    total = sum(freq.values())
    if total == 0:
        print("no `%<id> = OP(...)` statement found in %d file(s)" % len(args.files))
        return 1
    inside = sum(v for k, v in freq.items() if k in allowed)
    clean = sum(1 for p in progs if all(o in allowed for o in p))
    print("corpus:      %d file(s), %d program(s), %d statement(s)"
          % (len(args.files), len(progs), total))
    print("vocabulary:  %s (%d user-invocable ops)"
          % (os.path.relpath(args.vocabulary, REPO), len(allowed)))
    print("statements inside the vocabulary: %d/%d = %.1f%%" % (inside, total, 100.0 * inside / total))
    print("programs fully inside it:         %d/%d = %.1f%%"
          % (clean, len(progs), 100.0 * clean / len(progs)))
    print()
    print("%-12s %6s  %s" % ("op", "count", "status"))
    for op, n in freq.most_common():
        print("%-12s %6d  %s" % (op, n, "allowed" if op in allowed else "FORBIDDEN"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
