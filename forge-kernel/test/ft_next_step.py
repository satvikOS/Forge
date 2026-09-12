#!/usr/bin/env python3
"""Does this refusal tell the user WHAT TO DO, or only what went wrong?

WHY THIS IS A FILE AND NOT A `case` PATTERN. ft_silent_noop_gate.sh section 6
states the requirement in its own words -- "a refusal with no next step is a
dead end in a UI, and part.draft had one until this section existed" -- and then
enforced it with

    case "$err" in *" instead"*|*"Write "*|*"Cut "*|*"Use "*|*"or "*) PASS

MEASURED: a refusal that is a PURE DIAGNOSIS, carrying no remedy of any kind,
passed 52/52 on the substring " or ". Almost every English sentence of any
length contains one of those five. The section written to answer "a gate that
states an invariant and does not enforce it" had that same defect inside it.

WHAT IS CHECKED INSTEAD. A next step is an IMPERATIVE CLAUSE: a clause whose
FIRST word is a verb the reader can act on. The message is cut at clause
boundaries -- sentence end, semicolon, ", or ", ", and ", " -- " -- and a
leading conjunction ("so", "then", "or", "and", "but") is dropped, so
"... pull directions -- so use a smaller angle" is found in mid-sentence while
"the keyword has no resolver, so nothing could have matched" is not: `nothing`
is not a verb anyone can do.

The verb list is CLOSED, small, and written below. It is a weaker instrument
than reading English and a far stronger one than a substring, and --self-proof
runs it over fixtures in BOTH directions (real refusals must pass, pure
diagnoses must fail) before the gate believes a word of it.

Usage:
  ft_next_step.py --self-proof      prove the predicate, then exit 0/1
  ft_next_step.py --scan <file.cpp> every refuse(op, "...") message in the file
                                    must carry a next step; exit 1 naming those
                                    that do not
  ft_next_step.py "<message>"       exit 0 and print the clause found, else 1

WHY --scan EXISTS. Only TWO of the six refuse() call sites in
FeatureTreeCompiler.cpp can be reached by any IR fixture in this tree -- the
other four need their kernel call to RAISE, and nothing here makes it. So
"every refusal ends with a next step" is a claim execution cannot check, and the
previous version of this commit asserted it for all six on the strength of two.
A source scan can check all six, the same way the swallow scan checks catch
blocks no input reaches.
"""
import re
import sys

# Verbs a user of a CAD application can actually carry out. Every one of them is
# used by a refusal that ships in FeatureTreeCompiler.cpp today; the rest are the
# obvious neighbours, and the list is meant to stay short. A verb added here
# weakens the check, so add one only with a refusal that needs it.
ACTIONS = {
    "use", "write", "cut", "fuse", "model", "build", "size", "carry",
    "select", "set", "choose", "name", "replace", "remove", "delete",
    "split", "trim", "extend", "thicken", "re-run", "rerun", "rewrite",
    "state", "express", "convert", "draw", "sketch", "move", "scale", "try",
    "check", "cap", "sew",
}
CONJUNCTIONS = re.compile(r"^(?:so|then|or|and|but|instead)\s+", re.I)
CLAUSE = re.compile(r"(?:\.\s+|\.$|;\s*|,\s*(?:or|and|then)\s+|\s+--\s+|\s+—\s+)")


def next_step(message):
    """The first imperative clause in `message`, or None."""
    for part in CLAUSE.split(message or ""):
        part = part.strip().lstrip("([\"'` ").strip()
        part = CONJUNCTIONS.sub("", part)
        word = re.match(r"([A-Za-z][A-Za-z-]*)", part)
        if word and word.group(1).lower() in ACTIONS:
            return part
    return None


# ── the self-proof ──────────────────────────────────────────────────────────
# MUST-PASS are the refusals this kernel ships, verbatim from forge_verify's
# stdout. MUST-FAIL are what each of them looks like with the remedy removed and
# nothing else changed -- which is precisely the edit this predicate exists to
# catch -- plus the counterexample that broke the old check.
MUST_PASS = [
    'op %3 (line 3): POCKET: depth 10.000000 is NOT APPLIED -- this op discarded it and '
    'degraded to CUT(%body, %tool), a through-cut that is the same solid for every depth. '
    'Write CUT explicitly if a through-cut is what you mean, or size the tool body to the '
    'pocket depth first.',
    'op %3 (line 3): RIB: thickness 2.000000 is NOT APPLIED -- this op discarded it and '
    'degraded to FUSE(%body, %tool), which is the same solid for every thickness. Write '
    'FUSE explicitly if a plain union is what you mean, or build the rib body at its true '
    'thickness first.',
    'op %2 (line 2): THREAD: not implemented -- dia=10.000000 pitch=1.500000 len=20.000000 '
    'were read and DISCARDED, and the unthreaded body was returned as a success. Cut the '
    'thread as geometry (HELIX + SWEEP + CUT), or carry it as a PMI note.',
    'op %3 (line 3): REPLACEFACE: not implemented -- the selector "LARGEST" and the tool '
    'body were resolved and DISCARDED, and the unchanged body was returned as a success. '
    'Cut and re-fuse the region explicitly (CUT + FUSE) instead.',
    'op %2 (line 2): DRAFT: the kernel declined to draft 6 face(s) at 3.000000 deg about '
    'pull Z. No draft has ever succeeded on this build -- tested on 8 shapes, angles and '
    'pull directions -- so use a smaller angle only if you have seen one work, or model '
    'the taper as geometry (a LOFT or a CUT with an angled tool) '
    '[kernel raised Standard_NoSuchObject]',
    'op %2 (line 2): FILLET: quoted selector "face:top" is NOT APPLIED -- the edge selector '
    'is a KEYWORD only (ALL | VERTICAL | RIM | HORIZONTAL). It used to be read as ALL, '
    'which acts on EVERY edge of the body instead of the ones named. Use a keyword.',
]
MUST_FAIL = [
    # THE COUNTEREXAMPLE that passed the old check on the substring " or ".
    'op %2 (line 2): DRAFT: the kernel declined to draft 6 face(s) at 3.000000 deg about '
    'pull Z. No draft has ever succeeded on this build, on any shape or angle or pull '
    'direction [kernel raised Standard_NoSuchObject]',
    # each MUST_PASS above with its remedy sentence deleted and nothing else
    'op %3 (line 3): POCKET: depth 10.000000 is NOT APPLIED -- this op discarded it and '
    'degraded to CUT(%body, %tool), a through-cut that is the same solid for every depth.',
    'op %3 (line 3): RIB: thickness 2.000000 is NOT APPLIED -- this op discarded it and '
    'degraded to FUSE(%body, %tool), which is the same solid for every thickness.',
    'op %2 (line 2): THREAD: not implemented -- dia=10.000000 pitch=1.500000 len=20.000000 '
    'were read and DISCARDED, and the unthreaded body was returned as a success.',
    'op %3 (line 3): REPLACEFACE: not implemented -- the selector "LARGEST" and the tool '
    'body were resolved and DISCARDED, and the unchanged body was returned as a success.',
    'op %2 (line 2): FILLET: selector `CONVEX` is NOT IMPLEMENTED here -- this op resolves '
    'ALL | VERTICAL | RIM | HORIZONTAL only. It is not that no edge matched; the keyword '
    'has no resolver, so nothing could have matched.',
    # the bare diagnosis part.draft actually shipped before section 6 existed
    'op %2 (line 2): DRAFT: [kernel raised Standard_NoSuchObject]',
    '',
]


def self_proof():
    bad = []
    for m in MUST_PASS:
        if next_step(m) is None:
            bad.append("MISSED a real next step in: %s" % m[:110])
    for m in MUST_FAIL:
        found = next_step(m)
        if found is not None:
            bad.append("ACCEPTED a pure diagnosis on %r in: %s" % (found[:60], m[:110]))
    for line in bad:
        print("  self-proof FAIL  %s" % line)
    if bad:
        return 1
    print("  self-proof  next-step predicate: %d real refusals accepted, %d pure "
          "diagnoses rejected" % (len(MUST_PASS), len(MUST_FAIL)))
    return 0


def blank_noncode(text):
    """Comments to spaces, string literals KEPT -- a refusal message IS a literal.
    Offsets are preserved so a line number is still true."""
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                out[i] = " "
                i += 1
        elif c == "/" and i + 1 < n and text[i + 1] == "*":
            out[i] = out[i + 1] = " "
            i += 2
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                if text[i] != "\n":
                    out[i] = " "
                i += 1
            if i < n:
                out[i] = " "
                if i + 1 < n:
                    out[i + 1] = " "
                i += 2
        elif c in "\"'":
            quote = c
            i += 1
            while i < n and text[i] != quote:
                if text[i] == "\\":
                    i += 1
                i += 1
            if i < n:
                i += 1
        else:
            i += 1
    return "".join(out)


def scan(path):
    """Every refuse(op, "...") message in `path` must carry a next step."""
    raw = open(path, encoding="utf-8").read()
    code = blank_noncode(raw)          # the doc comment showing `refuse(op, "...")`
                                       # is prose, not a call site
    bad, seen = [], 0
    for m in re.finditer(r"\brefuse\(op,\s", code):
        depth, i, n = 1, m.end(), len(code)
        while i < n and depth:
            if code[i] == "(":
                depth += 1
            elif code[i] == ")":
                depth -= 1
            i += 1
        blob = code[m.end():i - 1]
        msg = "".join(p.replace('\\"', '"')
                      for p in re.findall(r'"((?:[^"\\]|\\.)*)"', blob))
        if not msg:
            continue
        seen += 1
        line = raw[:m.start()].count("\n") + 1
        step = next_step(msg)
        if step is None:
            bad.append((line, msg))
    if not seen:
        print("  FAIL  no refuse(op, \"...\") call sites found in %s -- the scan is "
              "matching nothing" % path)
        return 1
    for line, msg in bad:
        print("  FAIL  %s:%d refuses with a diagnosis and no next step: %s"
              % (path, line, msg[:140]))
    if bad:
        return 1
    print("  scan  all %d refuse() call sites end with a next step (only 2 of them "
          "are reachable by any IR fixture in this tree)" % seen)
    return 0


def main(argv):
    if len(argv) == 2 and argv[1] == "--self-proof":
        return self_proof()
    if len(argv) == 3 and argv[1] == "--scan":
        return scan(argv[2])
    if len(argv) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    found = next_step(argv[1])
    if found is None:
        return 1
    print(found)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
