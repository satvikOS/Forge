#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# unicode_fold_ucd_check.py — judge the redactor's fold tables against Unicode.
#
#   unicode_fold_ucd_check.py <dump.tsv> <confusables-subset.txt>
#
# <dump.tsv> is what unicode_fold_dump prints: every code point foldForMatch()
# MODELS, with the ASCII it folds to, its script and its Nd zero. Everything not
# in the dump is refused by the redactor, so a MISSING entry costs usability and
# never privacy — and the checks below are aimed the other way: a modelled entry
# must never fold to ASCII that Unicode does not say it means.
#
# ORACLES, none of them the table under test:
#   * unicodedata (the UCD compiled into this python3) — General_Category, the
#     decimal value of Nd digits, NFD / NFKC decompositions, character names;
#   * confusables.txt 16.0.0 (a verbatim subset kept as a fixture, so the check
#     is hermetic) — the UTS #39 prototype of each look-alike.
#
# Exit 0 only when every modelled code point is justified by exactly the rule
# its range claims, and every Nd digit and every fullwidth/halfwidth form whose
# compatibility decomposition is one ASCII character is modelled.
# ─────────────────────────────────────────────────────────────────────────────
import io
import sys
import unicodedata

UCD = tuple(int(x) for x in unicodedata.unidata_version.split("."))
# The tables are written from Unicode 16.0.0. An older python UCD does not know
# the Nd ranges added since; such an entry may be UNASSIGNED here, never wrong.
UCD_OLDER_THAN_TABLES = UCD < (16, 0, 0)

failures = []


def fail(msg):
    failures.append(msg)


def load_dump(path):
    rows = {}
    for line in io.open(path, encoding="ascii"):
        cp_hex, ascii_hex, script, zero_hex = line.rstrip("\n").split("\t")
        ascii = bytes.fromhex(ascii_hex).decode("ascii")
        rows[int(cp_hex, 16)] = (ascii, script, int(zero_hex, 16))
    return rows


def load_confusables(path):
    proto = {}
    for line in io.open(path, encoding="utf-8"):
        body = line.split("#", 1)[0].strip()
        if not body:
            continue
        src, tgt = [f.strip() for f in body.split(";")[:2]]
        proto[int(src, 16)] = "".join(chr(int(t, 16)) for t in tgt.split())
    return proto


def reader_key(s, proto):
    """Case-blind UTS #39 skeleton of an ASCII string, as Redactor.cpp's
    appendSkeleton claims to compute it — derived HERE from confusables.txt:
    map each ASCII character by its prototype (0->O, 1->l, I->l, |->l, m->rn),
    then close the classes under case."""
    out = []
    for ch in s.lower():
        ch = {"i": "l"}.get(ch, ch)  # 'i' is the lower case of 'I', whose prototype is 'l'
        mapped = proto.get(ord(ch), ch)
        mapped = mapped.lower().replace("i", "l")
        out.append(mapped)
    return "".join(out)


def main():
    if len(sys.argv) != 3:
        sys.stderr.write(__doc__ if __doc__ else "usage: dump.tsv confusables-subset.txt\n")
        return 2
    rows = load_dump(sys.argv[1])
    proto = load_confusables(sys.argv[2])
    if len(proto) < 100:
        print("[ucd] FATAL: the confusables fixture has %d entries; it did not load." % len(proto))
        return 1

    counts = {}

    def rule(name):
        counts[name] = counts.get(name, 0) + 1

    # ── 1. ASCII is the identity, and nothing else claims to be ASCII ─────────
    for cp in range(0x80):
        if cp not in rows or rows[cp][0] != chr(cp):
            fail("U+%04X: ASCII must fold to itself" % cp)
    rule_ascii = sum(1 for cp in rows if cp < 0x80)

    # ── 2. every Nd code point in this UCD is modelled, with its value ────────
    nd_in_ucd = 0
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        ch = chr(cp)
        if unicodedata.category(ch) != "Nd":
            continue
        nd_in_ucd += 1
        want = unicodedata.decimal(ch)
        got = rows.get(cp)
        if got is None:
            fail("U+%04X %s is Nd (value %d) and is NOT modelled" % (cp, unicodedata.name(ch, "?"), want))
            continue
        ascii, script, zero = got
        if ascii != str(want) or zero != cp - want or script != "Common":
            fail("U+%04X Nd value %d folds to %r zero=%X script=%s" % (cp, want, ascii, zero, script))

    # ── 3. every modelled entry is justified by the rule for its kind ─────────
    for cp, (ascii, script, zero) in sorted(rows.items()):
        if cp < 0x80:
            continue
        ch = chr(cp)
        cat = unicodedata.category(ch)
        name = unicodedata.name(ch, "<unnamed>")
        nfkc = unicodedata.normalize("NFKC", ch)
        nfd = unicodedata.normalize("NFD", ch)

        if zero != 0:
            if cat == "Nd":
                rule("Nd digit")
            elif cat == "Cn" and UCD_OLDER_THAN_TABLES:
                rule("Nd digit (unassigned in this older UCD)")
            else:
                fail("U+%04X %s carries an Nd zero but is %s" % (cp, name, cat))
            continue

        if len(ascii) == 1 and ascii.isdigit():
            # superscript / subscript: a <super>/<sub> decomposition to that digit
            if nfkc == ascii and cat == "No":
                rule("super/subscript digit (NFKC)")
            else:
                fail("U+%04X %s folds to digit %r but NFKC is %r (%s)" % (cp, name, ascii, nfkc, cat))
            continue

        if 0xFF01 <= cp <= 0xFF5E:
            if nfkc == ascii and len(ascii) == 1:
                rule("fullwidth ASCII variant (NFKC <wide>)")
                if ascii.isalpha() and script != "Latin":
                    fail("U+%04X fullwidth letter must be script Latin, is %s" % (cp, script))
            else:
                fail("U+%04X %s folds to %r but NFKC is %r" % (cp, name, ascii, nfkc))
            continue

        if script == "Latin":
            base, marks = nfd[0], nfd[1:]
            if ord(base) < 0x80 and base.isalpha() and marks and all(
                    unicodedata.category(m) == "Mn" for m in marks) and ascii == base:
                rule("Latin letter, canonical decomposition")
            elif nfkc.isascii() and nfkc == ascii:
                rule("Latin letter, compatibility decomposition")
            elif ch.casefold() == ascii:
                rule("Latin letter, full case folding")
            else:
                fail("U+%04X %s folds to %r; NFD=%r NFKC=%r casefold=%r" %
                     (cp, name, ascii, nfd, nfkc, ch.casefold()))
            if not name.startswith("LATIN "):
                fail("U+%04X %s is script Latin but is not a LATIN letter" % (cp, name))
            continue

        if script in ("Cyrillic", "Greek", "Armenian"):
            want_prefix = script.upper() + " "
            if not name.startswith(want_prefix):
                fail("U+%04X %s claims script %s" % (cp, name, script))
            p = proto.get(cp)
            if p is None:
                fail("U+%04X %s is folded as a confusable but has NO entry in confusables.txt" % (cp, name))
            elif not (len(ascii) == 1 and ascii.isalpha()):
                fail("U+%04X %s confusable must fold to one ASCII letter, got %r" % (cp, name, ascii))
            elif reader_key(ascii, proto) != reader_key(p, proto):
                fail("U+%04X %s folds to %r but its UTS #39 prototype is %r (skeletons differ)" %
                     (cp, name, ascii, p))
            else:
                rule("UTS #39 confusable, prototype %s" % ("exact" if p == ascii else "same skeleton class"))
            if not cat.startswith("L"):
                fail("U+%04X %s is folded as a letter but is %s" % (cp, name, cat))
            continue

        if script == "Common":
            if any(c.isalnum() for c in ascii):
                # Only ONE Common entry may yield a letter: MULTIPLICATION SIGN -> x,
                # and only because confusables.txt says so.
                if proto.get(cp) == ascii:
                    rule("Common symbol, UTS #39 prototype is a letter")
                else:
                    fail("U+%04X %s is Common but folds to alphanumeric %r without a prototype" %
                         (cp, name, ascii))
                continue
            if cat[0] in "LNM":
                fail("U+%04X %s (%s) is a letter, number or mark folded as punctuation %r" %
                     (cp, name, cat, ascii))
                continue
            if nfkc.isascii() and nfkc == ascii:
                rule("Common, NFKC")
            elif cp in proto and reader_key(proto[cp], proto) == reader_key(ascii, proto):
                rule("Common, UTS #39 prototype")
            elif cp in proto and proto[cp].isascii() and proto[cp] != ascii:
                fail("U+%04X %s folds to %r but its UTS #39 prototype is ASCII %r" %
                     (cp, name, ascii, proto[cp]))
            elif ascii == " ":
                rule("Common symbol with no ASCII form, folded to a token break")
            else:
                fail("U+%04X %s folds to %r with no NFKC or UTS #39 basis" % (cp, name, ascii))
            continue

        fail("U+%04X %s has unknown script %r" % (cp, name, script))

    # ── 4. coverage the requirement names: fullwidth AND halfwidth forms ──────
    for cp in range(0xFF00, 0xFFF0):
        ch = chr(cp)
        nfkc = unicodedata.normalize("NFKC", ch)
        if len(nfkc) == 1 and ord(nfkc) < 0x80 and cp not in rows:
            fail("U+%04X %s decomposes to ASCII %r and is NOT modelled" %
                 (cp, unicodedata.name(ch, "?"), nfkc))

    print("[ucd] python unicodedata %s; tables written from 16.0.0%s" %
          (unicodedata.unidata_version, " (older UCD: new Nd may be unassigned)" if UCD_OLDER_THAN_TABLES else ""))
    print("[ucd] modelled code points: %d (ASCII %d); Nd in this UCD: %d" % (len(rows), rule_ascii, nd_in_ucd))
    for name in sorted(counts):
        print("[ucd]   %5d  %s" % (counts[name], name))
    if failures:
        for f in failures:
            print("[ucd] FAIL " + f)
        print("[ucd] UCD CHECK FAILED: %d" % len(failures))
        return 1
    print("[ucd] UCD CHECK PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
