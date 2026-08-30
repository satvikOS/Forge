#!/usr/bin/env python3
"""name_corpus_axes.py -- name the axes of the overall-envelope triple in a corpus.

WHY
---
`implementation/sacrosanct/findings/ARCHIE_SHIFTS_THE_DIMENSIONS_DOWN_A_RANK.md`
measured, on 441 scored rows re-verified through the pinned verifier, that on the
rows Archie fails it does NOT fail to perceive the part's size. Sorted extents are
rotation-invariant and only 4.3% of the failing rows are pose-consistent, so it is
not orientation either. What the failures show is a RANK SHIFT: the candidate's
extent at rank i equals the reference's at rank i-1, in 67 of 116 failing rows
against a shuffled-null 99th percentile of 10. The largest extent is exact to 0.1%
in 67% of failing rows while the middle and smallest are right only 14-16% of the
time. That is a BINDING defect -- the right numbers assigned to the wrong axes.

Every generation prompt in the corpus hands the model the envelope as three bare
numbers in a fixed order:

    Rebuild this exact solid from construction ops. Overall envelope 107.1 x 65.2 x 47.5 mm.

Nothing in that string says which number is X, which is Y and which is Z; the
binding is positional and must be inferred. This script names it:

    Rebuild this exact solid from construction ops. Overall envelope X=107.1 mm, Y=65.2 mm, Z=47.5 mm.

Only the labels are added. The numbers, their order, their printed precision and
every other byte of the row are untouched -- so a paired A/B against the original
corpus differs in the axis binding and in nothing else.

WHERE THE AXIS NAMES COME FROM  (they are derived, never guessed)
----------------------------------------------------------------
The chain is closed end to end in source:

  1. KERNEL. `forge-kernel/src/native/brep/StepRead.cpp:1232` fills the box as
     `bboxMin[0]=p.x, bboxMin[1]=p.y, bboxMin[2]=p.z`, and
     `src/tools/forge_verify.cpp:438` prints it as `"bbox":{"min":[0,1,2],...}`.
     Index 0 is X, 1 is Y, 2 is Z.

  2. GENERATORS. Every script that wrote an envelope string into this corpus uses
     the same idiom, `ext = [bb["max"][i] - bb["min"][i] for i in range(3)]`,
     printed in the order 0, 1, 2:
       archdisc-Models/scripts/build_decomp_tasks.py:63,67   ("- overall envelope:")
       archdisc-Models/scripts/build_vision_corpus.py:222,227 ("  overall envelope:")
       archdisc-Models/scripts/wellpose_gen_corpus.py:47,50  ("Measured: ... about")
       archdisc-Models/scripts/build_gen_ir_gt.py:101,104    (same phrasing)
       archdisc-Models/scripts/gt_framing.py:262,265         ("Overall envelope")

  3. PER-ROW WITNESS. Provenance is an argument about the corpus; this script also
     demands evidence from the row in front of it, and REFUSES to label a row that
     has none. Two independent witnesses are read, both kernel-measured:
       * the bounding box printed in the SAME prompt -- `X[lo, hi] Y[..] Z[..]`
         (census / title-block rows) or the census JSON `"bbox":{"min","max"}`
         (target-inventory rows). Confirms all three slots.
       * the `VERIFY(..., "bbox.x=..", "bbox.y=..", "bbox.z=..")` claims in the
         assistant target. Confirms whichever slots it names.
     A row whose witness CONTRADICTS the assumed mapping is skipped, not guessed
     at. A row with no witness at all is skipped. A wrong name is worse than none.

  Measured over expert3d_v1_clean2/train.jsonl: 2,755 rows carry a full bbox
  witness and 2,755 of 2,755 agree with slot order (X, Y, Z) -- zero
  counterexamples, across four independently written generators. 6,667 further
  rows carry a bbox.z claim and 6,667 of 6,667 agree; that claim discriminates
  (Z differs from both X and Y) on 6,226 of them, so it is not a vacuous check.

THE CONTAMINATION GUARD MUST STILL SEE THE ENVELOPE  (Law 8)
------------------------------------------------------------
`contamination_guard.py` rule R3 catches eval geometry re-described in prose by
matching stated envelope triples against measured eval-part fingerprints. A new
phrasing that R3 cannot parse would silently disable that rule on this corpus --
evading the guard rather than passing it. The default `--style axis` output is
exactly `LABELLED_RE`'s form (`X=.. mm, Y=.. mm, Z=.. mm`), which that guard was
built to recognise. `--check` runs a POSITIVE CONTROL that re-parses every
rewritten line through the guard's own `stated_envelopes()` and fails if the
triple stops being visible to it.

`--style lwt` writes the `length (X) .. mm, width (Y) .. mm, thickness (Z) .. mm`
form instead. It is offered for a second arm of the experiment, but it is NOT the
default, for two measured reasons: the guard's NAMED_RE does not parse it (the
parenthesised axis breaks the pattern, so R3 would go blind), and length/width/
thickness assert a role that is false whenever Z is the longest axis, which is
1,963 of the 9,422 labelled rows here (20.8%). The axis letter is both the safe label and
the useful one, since POLY/RECT are in XY and EXTRUDE runs along Z.

USAGE
-----
  # what would happen, no writes
  python3 scripts/name_corpus_axes.py --check IN.jsonl

  # write the transformed corpus
  python3 scripts/name_corpus_axes.py --apply IN.jsonl --out OUT.jsonl

  # verify a transformed corpus round-trips to the original, byte for byte
  python3 scripts/name_corpus_axes.py --verify IN.jsonl --out OUT.jsonl

Exit code is non-zero on any failed check, so this is gate-usable.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import io
import itertools
import json
import os
import re
import sys

# --------------------------------------------------------------------------- #
#  envelope phrasings                                                          #
# --------------------------------------------------------------------------- #
# A number as the generators print it: %.3f, %.4g or %.3g. Kept deliberately
# narrow -- an exponent form or a negative extent is not something any of the five
# generators can emit, and a pattern that matched one would be matching something
# this script has not established the provenance of.
_N = r"\d+(?:\.\d+)?"
_TRIPLE = r"(%s)\s*x\s*(%s)\s*x\s*(%s)" % (_N, _N, _N)

# Each family: (name, compiled regex with 3 numeric groups, prefix, suffix).
# The regex must match the WHOLE span that gets rewritten, so that rewriting is a
# pure span replacement and everything outside it is copied verbatim.
FAMILIES = [
    # build_decomp_tasks.py / decompose_longtree*.py
    ("census", re.compile(r"- overall envelope: " + _TRIPLE + r" mm"),
     "- overall envelope: ", ""),
    # build_vision_corpus.py / build_shaded_vision_corpus.py title block
    ("title", re.compile(r"  overall envelope: " + _TRIPLE + r" mm"),
     "  overall envelope: ", ""),
    # wellpose_gen_corpus.py / build_gen_ir_gt.py
    ("measured", re.compile(r"Measured: overall envelope about " + _TRIPLE + r" mm"),
     "Measured: overall envelope about ", ""),
    # gt_framing.py user_decomp
    ("inventory",
     re.compile(r"Rebuild this exact solid from construction ops\. Overall envelope "
                + _TRIPLE + r" mm\."),
     "Rebuild this exact solid from construction ops. Overall envelope ", "."),
]

# --------------------------------------------------------------------------- #
#  witnesses                                                                   #
# --------------------------------------------------------------------------- #
_SN = r"([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)"
BBOX_BRACKET = re.compile(
    r"X\[" + _SN + r",\s*" + _SN + r"\]\s+"
    r"Y\[" + _SN + r",\s*" + _SN + r"\]\s+"
    r"Z\[" + _SN + r",\s*" + _SN + r"\]"
)
BBOX_JSON = re.compile(
    r'"bbox":\s*\{\s*"min":\s*\[([^\]]*)\],\s*"max":\s*\[([^\]]*)\]', re.S
)
VERIFY_AXIS = re.compile(r'"bbox\.([xyz])\s*=\s*' + _SN + r'"')

AXES = ("X", "Y", "Z")


def _agrees(stated: float, measured: float) -> bool:
    """Does a printed envelope number agree with a full-precision measurement?

    The generators print %.3f / %.4g / %.3g, so the stated value carries as few as
    three significant figures. The tolerance is the printing error, not a fudge
    factor: a genuine slot mismatch is a different DIMENSION of the part and is
    orders of magnitude larger than this.
    """
    return abs(stated - measured) <= max(abs(measured) * 1e-3, 5e-3)


def _prompt_bbox(user: str):
    """Kernel bbox stated in the prompt itself -> ([extX, extY, extZ], source)."""
    m = BBOX_BRACKET.search(user)
    if m:
        g = [float(x) for x in m.groups()]
        return [g[1] - g[0], g[3] - g[2], g[5] - g[4]], "prompt-bracket"
    m = BBOX_JSON.search(user)
    if m:
        try:
            lo = [float(x) for x in m.group(1).replace("\n", " ").split(",")]
            hi = [float(x) for x in m.group(2).replace("\n", " ").split(",")]
        except ValueError:
            return None, None
        if len(lo) == 3 and len(hi) == 3:
            return [hi[i] - lo[i] for i in range(3)], "prompt-json"
    return None, None


def _verify_axes(assistant: str):
    """Axis extents claimed by VERIFY() in the target -> {slot index: value}."""
    out = {}
    for axis, val in VERIFY_AXIS.findall(assistant):
        try:
            out["xyz".index(axis.lower())] = float(val)
        except ValueError:
            continue
    return out


class Skip(Exception):
    def __init__(self, reason, detail=""):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


def bind_axes(user: str, assistant: str):
    """Establish the slot -> axis binding for one row, or raise Skip.

    Returns (family, match, stated_triple, witnessed_slots, witness_sources).
    `witnessed_slots` is the set of slot indices independently confirmed for THIS
    row; the binding itself is slot i -> AXES[i], from the generator provenance
    documented in the module docstring.
    """
    hits = []
    for name, rx, _pre, _suf in FAMILIES:
        found = list(rx.finditer(user))
        if found:
            hits.append((name, found))
    if not hits:
        raise Skip("no-envelope-statement")
    if len(hits) > 1:
        raise Skip("multiple-envelope-families",
                   "+".join(h[0] for h in hits))
    family, found = hits[0]
    if len(found) > 1:
        # Two envelope statements in one prompt: which one describes the part is
        # not decidable from the text, so neither is labelled.
        raise Skip("multiple-envelope-statements", "%s x%d" % (family, len(found)))
    m = found[0]
    stated = [float(g) for g in m.groups()]

    witnessed = set()
    sources = []
    bbox, src = _prompt_bbox(user)
    if bbox is not None:
        for i in range(3):
            if not _agrees(stated[i], bbox[i]):
                raise Skip("witness-contradiction",
                           "%s slot%d stated %.6g vs measured %.6g"
                           % (src, i, stated[i], bbox[i]))
        witnessed |= {0, 1, 2}
        sources.append(src)
    for slot, val in _verify_axes(assistant).items():
        if not _agrees(stated[slot], val):
            raise Skip("witness-contradiction",
                       "verify bbox.%s stated %.6g vs claimed %.6g"
                       % (AXES[slot].lower(), stated[slot], val))
        witnessed.add(slot)
        if "target-verify" not in sources:
            sources.append("target-verify")
    if not witnessed:
        raise Skip("no-axis-witness")
    return family, m, stated, witnessed, sources


# --------------------------------------------------------------------------- #
#  rewriting                                                                   #
# --------------------------------------------------------------------------- #
STYLES = ("axis", "lwt")
_ROLE = ("length", "width", "thickness")


def render(style: str, nums) -> str:
    """The labelled envelope body. Number text is copied, never reformatted."""
    if style == "axis":
        return ", ".join("%s=%s mm" % (AXES[i], nums[i]) for i in range(3))
    if style == "lwt":
        return ", ".join("%s (%s) %s mm" % (_ROLE[i], AXES[i], nums[i])
                         for i in range(3))
    raise ValueError("unknown style %r" % style)


def _labelled_re(style: str):
    """The inverse pattern, used to prove a rewrite is reversible."""
    if style == "axis":
        body = r",\s*".join(r"%s=(%s) mm" % (AXES[i], _N) for i in range(3))
    else:
        body = r",\s*".join(r"%s \(%s\) (%s) mm" % (_ROLE[i], AXES[i], _N)
                            for i in range(3))
    return body


UNLABEL = {
    style: [
        (name,
         re.compile(re.escape(pre) + _labelled_re(style) + re.escape(suf)),
         pre, suf)
        for name, _rx, pre, suf in FAMILIES
    ]
    for style in STYLES
}


def unlabel(user: str, style: str) -> str:
    """Strip the labels back off -- the exact inverse of `rewrite`."""
    for _name, rx, pre, suf in UNLABEL[style]:
        def sub(m):
            return "%s%s x %s x %s mm%s" % (pre, m.group(1), m.group(2),
                                            m.group(3), suf)
        user = rx.sub(sub, user)
    return user


def rewrite(user: str, family: str, m, style: str) -> str:
    """Replace only the matched envelope span. Everything else is copied."""
    pre, suf = next((p, s) for n, _r, p, s in FAMILIES if n == family)
    body = render(style, [m.group(1), m.group(2), m.group(3)])
    return user[:m.start()] + pre + body + suf + user[m.end():]


# --------------------------------------------------------------------------- #
#  guard visibility (Law 8 positive control)                                   #
# --------------------------------------------------------------------------- #
def _load_guard():
    """contamination_guard.stated_envelopes, or None with a reason."""
    for base in (os.environ.get("ARCHDISC_MODELS"),
                 "/Users/account_clawteam1/archdisc-Models"):
        if not base:
            continue
        path = os.path.join(base, "scripts")
        if os.path.isfile(os.path.join(path, "contamination_guard.py")):
            if path not in sys.path:
                sys.path.insert(0, path)
            try:
                import contamination_guard  # type: ignore
                return contamination_guard.stated_envelopes, None
            except Exception as exc:  # pragma: no cover - import-environment only
                return None, "import failed: %s" % exc
    return None, "contamination_guard.py not found"


def guard_sees(stated_envelopes, text: str, triple) -> bool:
    """Is the rewritten triple still parsed by the guard's R3 extractor?"""
    want = sorted(float(x) for x in triple)
    for got in stated_envelopes(text):
        if all(abs(got[i] - want[i]) <= 1e-6 * max(abs(want[i]), 1.0)
               for i in range(3)):
            return True
    return False


# --------------------------------------------------------------------------- #
#  driver                                                                      #
# --------------------------------------------------------------------------- #
def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Stats:
    def __init__(self):
        self.rows = 0
        self.changed = 0
        self.by_family = collections.Counter()
        self.skips = collections.Counter()
        self.skip_examples = collections.defaultdict(list)
        self.witness = collections.Counter()
        self.slot_witness = collections.Counter()
        self.sources = collections.Counter()
        self.degenerate = collections.Counter()
        self.guard_blind = 0
        self.guard_blind_examples = []
        self.irreversible = 0
        self.irreversible_examples = []

    def report(self, out=sys.stdout):
        p = lambda *a: print(*a, file=out)
        p("rows read                 %6d" % self.rows)
        p("rows TRANSFORMED          %6d" % self.changed)
        p("rows SKIPPED              %6d" % (self.rows - self.changed))
        p("")
        p("transformed, by prompt family:")
        for k, v in sorted(self.by_family.items()):
            p("    %-12s %6d" % (k, v))
        p("")
        p("skipped, by reason:")
        for k, v in self.skips.most_common():
            p("    %-28s %6d" % (k, v))
            for d in self.skip_examples[k][:3]:
                p("        e.g. %s" % d)
        p("")
        p("per-row axis witness on the transformed rows:")
        for k, v in sorted(self.witness.items()):
            p("    %-28s %6d" % (k, v))
        p("  slots independently confirmed:")
        for i in range(3):
            p("    %s  %6d / %d" % (AXES[i], self.slot_witness[i], self.changed))
        p("  witness sources:")
        for k, v in self.sources.most_common():
            p("    %-28s %6d" % (k, v))
        p("  rows where two extents are EQUAL (their order is immaterial):")
        for k, v in sorted(self.degenerate.items()):
            p("    %-28s %6d" % (k, v))
        p("")
        p("checks:")
        p("    label round-trips to original    %s"
          % ("FAIL (%d rows)" % self.irreversible if self.irreversible else "ok"))
        for d in self.irreversible_examples[:3]:
            p("        %s" % d)
        p("    guard R3 still parses the triple %s"
          % ("FAIL (%d rows)" % self.guard_blind if self.guard_blind else "ok"))
        for d in self.guard_blind_examples[:3]:
            p("        %s" % d)


def run(in_path: str, out_path, style: str, stats: Stats):
    """Stream the corpus. `out_path` None means check-only (no writes)."""
    stated_envelopes, guard_err = _load_guard()
    if guard_err:
        print("[warn] guard positive control unavailable: %s" % guard_err,
              file=sys.stderr)

    sink = io.open(out_path, "w", encoding="utf-8", newline="") if out_path else None
    try:
        with io.open(in_path, "r", encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    if sink:
                        sink.write(line)
                    continue
                stats.rows += 1
                row = json.loads(line)
                msgs = row.get("messages") or []
                ui = next((i for i, m in enumerate(msgs)
                           if m.get("role") == "user"), None)
                ai = next((i for i, m in enumerate(msgs)
                           if m.get("role") == "assistant"), None)
                if ui is None:
                    stats.skips["no-user-turn"] += 1
                    if sink:
                        sink.write(line)
                    continue
                user = msgs[ui].get("content") or ""
                assistant = msgs[ai].get("content") if ai is not None else ""
                try:
                    family, m, stated, witnessed, sources = bind_axes(
                        user, assistant or "")
                except Skip as sk:
                    stats.skips[sk.reason] += 1
                    if sk.detail and len(stats.skip_examples[sk.reason]) < 3:
                        stats.skip_examples[sk.reason].append(sk.detail)
                    if sink:
                        sink.write(line)
                    continue

                new_user = rewrite(user, family, m, style)

                # Reversibility: stripping the labels must give back the exact
                # original user turn. This is what proves the transformation added
                # labels and changed no number, no order and no other character.
                back = unlabel(new_user, style)
                if back != user:
                    stats.irreversible += 1
                    if len(stats.irreversible_examples) < 3:
                        stats.irreversible_examples.append(
                            "%s: %r -> %r" % (family, user[m.start():m.end()],
                                              new_user[m.start():m.start() + 90]))
                    if sink:
                        sink.write(line)
                    continue

                # Law 8 positive control: R3 must still see the envelope.
                if stated_envelopes is not None:
                    span = new_user[m.start():m.start() + 160]
                    if not guard_sees(stated_envelopes, span, stated):
                        stats.guard_blind += 1
                        if len(stats.guard_blind_examples) < 3:
                            stats.guard_blind_examples.append(span.split("\n")[0])

                stats.changed += 1
                stats.by_family[family] += 1
                key = "".join(AXES[i] if i in witnessed else "-" for i in range(3))
                stats.witness["witnessed " + key] += 1
                for i in witnessed:
                    stats.slot_witness[i] += 1
                for s in sources:
                    stats.sources[s] += 1
                for i, j in itertools.combinations(range(3), 2):
                    if _agrees(stated[i], stated[j]):
                        stats.degenerate["%s == %s" % (AXES[i], AXES[j])] += 1

                msgs[ui]["content"] = new_user
                if sink:
                    sink.write(json.dumps(row, ensure_ascii=False) + "\n")
    finally:
        if sink:
            sink.close()


def verify_pair(in_path: str, out_path: str, style: str) -> int:
    """Prove OUT is IN plus labels: unlabel(OUT) must equal IN, row for row."""
    bad = 0
    n = 0
    labelled = 0
    with io.open(in_path, encoding="utf-8") as a, io.open(out_path, encoding="utf-8") as b:
        for la, lb in itertools.zip_longest(a, b):
            if la is None or lb is None:
                print("FAIL: line counts differ", file=sys.stderr)
                return 1
            n += 1
            ra, rb = json.loads(la), json.loads(lb)
            for ma, mb in itertools.zip_longest(ra.get("messages") or [],
                                               rb.get("messages") or []):
                if ma is None or mb is None:
                    bad += 1
                    break
                if ma.get("role") != mb.get("role"):
                    bad += 1
                    break
                ca = ma.get("content") or ""
                cb = mb.get("content") or ""
                if ma.get("role") == "user":
                    if ca != cb:
                        labelled += 1
                    if unlabel(cb, style) != ca:
                        bad += 1
                        if bad <= 3:
                            print("row %d does not round-trip" % n, file=sys.stderr)
                elif ca != cb:
                    bad += 1
                    if bad <= 3:
                        print("row %d: %s turn changed" % (n, ma.get("role")),
                              file=sys.stderr)
            if ra.get("image") != rb.get("image"):
                bad += 1
    print("verify: %d rows, %d user turns labelled, %d defects" % (n, labelled, bad))
    return 1 if bad else 0


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Name the axes of the overall-envelope triple in a corpus.")
    ap.add_argument("--check", metavar="IN",
                    help="report what would change; write nothing")
    ap.add_argument("--apply", metavar="IN", help="transform IN into --out")
    ap.add_argument("--verify", metavar="IN",
                    help="prove --out is IN plus labels (round-trip)")
    ap.add_argument("--out", metavar="OUT", help="output corpus for --apply/--verify")
    ap.add_argument("--style", default="axis", choices=STYLES,
                    help="axis: 'X=1 mm, Y=2 mm, Z=3 mm' (default, guard-visible); "
                         "lwt: 'length (X) 1 mm, ...'")
    args = ap.parse_args(argv)

    chosen = [x for x in (args.check, args.apply, args.verify) if x]
    if len(chosen) != 1:
        ap.error("give exactly one of --check / --apply / --verify")

    if args.verify:
        if not args.out:
            ap.error("--verify needs --out")
        return verify_pair(args.verify, args.out, args.style)

    in_path = args.check or args.apply
    if not os.path.isfile(in_path):
        print("no such corpus: %s" % in_path, file=sys.stderr)
        return 2
    before = sha256(in_path)

    out_path = None
    if args.apply:
        if not args.out:
            ap.error("--apply needs --out")
        if os.path.abspath(args.out) == os.path.abspath(in_path):
            print("refusing to write over the input corpus", file=sys.stderr)
            return 2
        out_path = args.out + ".partial"
        os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)

    stats = Stats()
    run(in_path, out_path, args.style, stats)

    after = sha256(in_path)
    if before != after:
        print("FAIL: the input corpus changed under us", file=sys.stderr)
        return 1

    print("=" * 72)
    print("%s  %s" % ("CHECK" if args.check else "APPLY", in_path))
    print("style: %s     input sha256 %s (unchanged)" % (args.style, before[:16]))
    print("=" * 72)
    stats.report()

    failed = stats.irreversible or stats.guard_blind
    if args.apply and not failed:
        os.replace(out_path, args.out)
        print("\nwrote %s  sha256 %s" % (args.out, sha256(args.out)[:16]))
    elif args.apply:
        os.remove(out_path)
        print("\nchecks FAILED -- no output written", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
