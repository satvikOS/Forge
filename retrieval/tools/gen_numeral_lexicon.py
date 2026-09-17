#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# gen_numeral_lexicon.py — derive the redactor's NUMERAL WORD tables from CLDR.
#
# WHY. The redactor's default-deny rule is on NUMBERS, and it used to know only
# one spelling of a number: digits. "thickness forty seven point six two five mm"
# carried a registered secret dimension to the search engine with status=Ok,
# because no digit was ever present for the value scan to read. A number word is
# a digit in another script; the fix is the one the Unicode tables already use —
# derive what a numeral LOOKS LIKE from the authoritative data, not from a list of
# cases someone thought of.
#
# SOURCE. Unicode CLDR rule-based number formatting (RBNF), the spellout rule
# sets of every locale (https://cldr.unicode.org, common/rbnf/*.xml). They are
# read through the ICU that ships with macOS (libicucore), which compiles exactly
# that data: `unum_open(UNUM_SPELLOUT, locale)` and every public
# %spellout-numbering*, %spellout-cardinal* and %spellout-ordinal* rule set.
# The CLDR and ICU versions are recorded in the generated header. Nothing here
# is copied library code; the ICU calls only FORMAT numbers, and everything the
# redactor knows is inferred below from the formatted text.
#
# WHAT IS DERIVED.
#   pieces   Each spellout is split into pieces at spaces, hyphens and the soft
#            hyphens CLDR places at morpheme boundaries ("sieben<SHY>und<SHY>
#            vierzig"). Each piece is folded to ASCII through the redactor's OWN
#            fold table (unicode_fold_dump output), so a piece means exactly the
#            letters the scans see. A piece containing a code point the fold does
#            not model is dropped: text carrying it is refused before any numeral
#            reading could matter.
#   roles    CARD(v) adds v, MULT(v) multiplies, CONJ joins ("und", "og", "y"),
#            DEC separates the fraction ("point", "Komma", "virgule"). A piece
#            that is a whole spellout on its own gets CARD(that number); every
#            other role and value is INFERRED by requiring the reader's grammar
#            (evaluate() below, mirrored in Redactor.cpp) to reproduce the number
#            CLDR spelled. The fit is measured and printed per locale.
#   weak     A numeral word that is ALSO an ordinary English word ("to" is 2 in
#            Danish, "on" is 10 in Turkish, "due" is 2 in Italian) cannot be
#            stripped on sight without destroying English queries. Such words are
#            listed as AMBIGUOUS, from the Webster's Second word list shipped in
#            /usr/share/dict/web2 (public domain), plus the short curated lists
#            below, each entry justified. An ambiguous word is still READ: it
#            joins a numeral phrase next to an unambiguous one, and its value is
#            always checked against the registered secret dimensions.
#
# OUTPUTS (both checked in, both regenerated only by this script):
#   retrieval/include/forge/retrieval/generated/NumeralLexicon.inc
#   retrieval/test/fixtures/numerals/cldr-spellout-sample.tsv   (raw ICU text,
#       read by attack_regression_gate's numeral phase on any platform)
#
# usage: gen_numeral_lexicon.py <unicode_fold_dump.tsv> [--web2 /usr/share/dict/web2]
#        [--report]
# macOS only (libicucore). Deterministic for a given ICU/CLDR version.
# ─────────────────────────────────────────────────────────────────────────────
import argparse
import collections
import ctypes
import itertools
import os
import re
import sys
import unicodedata

CARD, MULT, CONJ, DEC = 0, 1, 2, 3
KIND_NAME = {CARD: "CARD", MULT: "MULT", CONJ: "CONJ", DEC: "DEC"}
SMALL_MULTS = [10, 20, 100]
BIG_MULTS = [1000, 10**6, 10**9, 10**12]

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_INC = os.path.join(ROOT, "retrieval/include/forge/retrieval/generated/NumeralLexicon.inc")
OUT_SAMPLE = os.path.join(ROOT, "retrieval/test/fixtures/numerals/cldr-spellout-sample.tsv")

# ── curated additions, each with its basis ───────────────────────────────────
# English readings of numbers that CLDR's en spellout rules do not produce but
# that English writers use for digits, fractions and the decimal point.
MANUAL_PIECES = {
    "en": [
        ("nought", CARD, 0, False), ("naught", CARD, 0, False), ("nil", CARD, 0, False),
        ("zilch", CARD, 0, False),
        # fraction denominators: "five eighths", "three quarters", "one half"
        ("half", CARD, 2, True), ("halves", CARD, 2, True),
        ("quarter", CARD, 4, True), ("quarters", CARD, 4, True),
        ("dot", DEC, 0, False), ("decimal", DEC, 0, False),
        ("and", CONJ, 0, False),
    ],
}
# English numeral words with a common NON-numeral sense. Read, never stripped
# on sight: "which one", "one-way", "per second", "first principal stress",
# "oh", "half-life", "a quarter turn".
EN_WEAK = {"one", "first", "second", "oh", "nil", "naught", "nought", "zilch",
           "half", "halves", "quarter", "quarters"}
# Words not in Webster's Second (1934) that modern engineering English uses and
# that read as numerals somewhere. Found by running the reader over this
# repository's own prose and code, 34 MB (--corpus prints every candidate):
#   eng (engineering; lb), sep (separator, September; eo 7), trims/tris (trim,
#   triangles, trisodium; lt), fem (finite element method; da/nb/nn/sv 5),
#   zeroes (plural of zero; ca), undos (plural of undo; ca/es), anim
#   (animation; fil), sta (station; cs/hr), sti (speech transmission index; hr).
EXTRA_AMBIGUOUS = {"eng", "sep", "trims", "tris", "fem", "zeroes", "undos", "anim", "sta", "sti"}

INTS = sorted(set(
    list(range(0, 1001)) + list(range(1001, 2101)) +
    [k * 1000 for k in range(2, 21)] + [k * 10000 for k in range(3, 11)] +
    [k * 100000 for k in range(2, 11)] +
    [2 * 10**6, 5 * 10**6, 10**7, 10**9, 2 * 10**9, 10**12, 2 * 10**12,
     47625, 1000047, 21000, 101000, 999999, 123456]))
DECIMALS = [47.625, 0.5, 1.25, 3.75, 12.05, 7.1, 1.875]
SAMPLE_INTS = [7, 21, 47, 97, 147, 1947, 47625, 1000047]
SAMPLE_DECIMALS = [47.625, 1.875, 12.05]


# ── ICU (the CLDR RBNF data compiled into macOS) ────────────────────────────
class Icu:
    UNUM_SPELLOUT = 5
    UNUM_DEFAULT_RULESET = 6
    UNUM_PUBLIC_RULESETS = 7

    def __init__(self):
        lib = ctypes.CDLL("/usr/lib/libicucore.A.dylib")
        lib.unum_open.restype = ctypes.c_void_p
        lib.unum_open.argtypes = [ctypes.c_int, ctypes.c_void_p, ctypes.c_int32, ctypes.c_char_p,
                                  ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        lib.unum_close.argtypes = [ctypes.c_void_p]
        lib.unum_formatDouble.restype = ctypes.c_int32
        lib.unum_formatDouble.argtypes = [ctypes.c_void_p, ctypes.c_double, ctypes.c_void_p, ctypes.c_int32,
                                          ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        lib.unum_getTextAttribute.restype = ctypes.c_int32
        lib.unum_getTextAttribute.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int32,
                                              ctypes.POINTER(ctypes.c_int)]
        lib.unum_setTextAttribute.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_int32,
                                              ctypes.POINTER(ctypes.c_int)]
        lib.unum_getLocaleByType.restype = ctypes.c_char_p
        lib.unum_getLocaleByType.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
        lib.uloc_countAvailable.restype = ctypes.c_int32
        lib.uloc_getAvailable.restype = ctypes.c_char_p
        lib.uloc_getAvailable.argtypes = [ctypes.c_int32]
        lib.ulocdata_getCLDRVersion.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
        lib.u_getVersion.argtypes = [ctypes.c_void_p]
        self.lib = lib

    def versions(self):
        v = (ctypes.c_uint8 * 4)()
        st = ctypes.c_int(0)
        self.lib.ulocdata_getCLDRVersion(v, ctypes.byref(st))
        cldr = "%d.%d" % (v[0], v[1])
        self.lib.u_getVersion(v)
        return cldr, "%d.%d" % (v[0], v[1])

    def languages(self):
        out = set()
        for i in range(self.lib.uloc_countAvailable()):
            out.add(self.lib.uloc_getAvailable(i).decode().split("_")[0])
        return sorted(out)

    def open(self, lang):
        st = ctypes.c_int(0)
        f = self.lib.unum_open(self.UNUM_SPELLOUT, None, 0, lang.encode(), None, ctypes.byref(st))
        if not f or st.value > 0:
            return None, None
        st = ctypes.c_int(0)
        actual = self.lib.unum_getLocaleByType(f, 1, ctypes.byref(st))  # ULOC_VALID_LOCALE
        return f, (actual.decode() if actual else "")

    def rulesets(self, f):
        buf = (ctypes.c_uint16 * 8192)()
        st = ctypes.c_int(0)
        n = self.lib.unum_getTextAttribute(f, self.UNUM_PUBLIC_RULESETS, buf, 8192, ctypes.byref(st))
        return [r for r in bytes(buf)[: 2 * n].decode("utf-16-le").split(";") if r]

    def format(self, f, ruleset, x):
        b = ruleset.encode("utf-16-le")
        arr = (ctypes.c_uint16 * (len(b) // 2)).from_buffer_copy(b)
        st = ctypes.c_int(0)
        self.lib.unum_setTextAttribute(f, self.UNUM_DEFAULT_RULESET, arr, len(b) // 2, ctypes.byref(st))
        if st.value > 0:
            return None
        buf = (ctypes.c_uint16 * 2048)()
        st = ctypes.c_int(0)
        n = self.lib.unum_formatDouble(f, float(x), buf, 2048, None, ctypes.byref(st))
        if st.value > 0:
            return None
        return bytes(buf)[: 2 * n].decode("utf-16-le")


# ── the redactor's own fold ─────────────────────────────────────────────────
def load_fold(path):
    fold = {}
    for line in open(path, encoding="ascii"):
        cp, hexbytes, _script, _zero = line.rstrip("\n").split("\t")
        fold[int(cp, 16)] = bytes.fromhex(hexbytes).decode("ascii")
    return fold


def fold_piece(piece, fold):
    out = []
    for ch in piece:
        a = fold.get(ord(ch))
        if a is None:
            return None
        out.append(a)
    s = "".join(out).lower()
    return s if s and re.fullmatch(r"[a-z]+", s) else None


def split_pieces(text):
    """Pieces of a spellout: runs of letters and marks, split at everything else
    (space, hyphen, U+00AD SOFT HYPHEN, apostrophes)."""
    pieces, cur = [], []
    for ch in text:
        if unicodedata.category(ch)[0] in "LM":
            cur.append(ch)
        else:
            if cur:
                pieces.append("".join(cur))
            cur = []
    if cur:
        pieces.append("".join(cur))
    return pieces


# ── the grammar (MIRRORED in Redactor.cpp: numeralGrammarValue) ─────────────
def evaluate(tokens):
    """tokens: [(kind, value)] with no DEC. CARD adds; MULT >= 1000 closes a
    group; a smaller MULT multiplies the low part of the running group
    ("quatre vingt" = 80, "cent vingt" = 120, "neljä kymmentä" = 40)."""
    total, cur, seen = 0, 0, False
    for k, v in tokens:
        if k == CONJ:
            continue
        if k == DEC:
            return None
        seen = True
        if k == CARD:
            cur += v
        elif v >= 1000:
            total += (cur if cur else 1) * v
            cur = 0
        else:
            low = cur % v
            cur = cur + v if low == 0 else cur - low + low * v
    return total + cur if seen else None


def evaluate_prefix(tokens):
    """The multiplier-FIRST order: Swahili "mia mbili" = 100 x 2, "elfu mbili
    mia tatu na tano" = 2305. A MULT takes the CARDs that follow it (up to a
    CONJ or the next MULT) as its multiplicand."""
    total, i, seen = 0, 0, False
    while i < len(tokens):
        k, v = tokens[i]
        if k == DEC:
            return None
        if k == CONJ:
            i += 1
            continue
        seen = True
        if k == CARD:
            total += v
            i += 1
            continue
        j = i + 1
        while j < len(tokens) and tokens[j][0] == CARD:
            j += 1
        m = evaluate(tokens[i + 1:j]) if j > i + 1 else None
        total += v * (m if m else 1)
        i = j
    return total if seen else None


def concat_groups(tokens):
    """Digit-string reading: the phrase as consecutive NUMBERS written side by
    side. "nineteen forty seven" = 1947, "ten ten" = 1010, "four seven six two
    five" = 47625. A new number starts where a CARD cannot continue the previous
    one: a unit after a unit or after a teen, or tens after anything that is not
    a round hundred."""
    groups, cur, last = [], [], None
    for k, v in tokens:
        if k == DEC:
            return None
        if k == CONJ:
            cur.append((k, v))
            last = None
            continue
        split = False
        if k == CARD and last is not None and last[0] == CARD:
            a = last[1]
            if v < 10:
                split = a < 10 or a % 10 != 0
            elif v < 100:
                split = not (a >= 100 and a % 100 == 0)
            else:
                split = True
        if split and cur:
            groups.append(cur)
            cur = []
        cur.append((k, v))
        last = (k, v)
    if cur:
        groups.append(cur)
    parts = []
    for g in groups:
        gv = evaluate(g)
        if gv is None:
            return None
        parts.append(str(gv))
    return "".join(parts) if parts else None


def integer_readings(tokens):
    """(value, digit string) pairs an integer phrase can mean."""
    out = set()
    for fn in (evaluate, evaluate_prefix):
        v = fn(tokens)
        if v is not None:
            out.add(str(v))
    c = concat_groups(tokens)
    if c is not None:
        out.add(c)
    return out


def readings(tokens):
    """Every value the phrase can mean; a DEC splits it into an integer part and
    a fraction written as digits or as a number."""
    if not any(k == DEC for k, _ in tokens):
        return {float(s) for s in integer_readings(tokens)}
    i = next(n for n, (k, _) in enumerate(tokens) if k == DEC)
    j = i
    while j < len(tokens) and tokens[j][0] == DEC:
        j += 1
    ints = integer_readings(tokens[:i]) if i > 0 else {"0"}
    frac = tokens[j:]
    if not ints or not frac or any(k == DEC for k, _ in frac):
        return set()
    fracs = set()
    if all(k != MULT for k, _ in frac):
        fracs.add("".join(str(v) for k, v in frac if k != CONJ))
    fracs |= integer_readings(frac)
    return {float("%s.%s" % (a, b)) for a in ints for b in fracs if b}


def matches(x, vals):
    return any(abs(v - x) <= 1e-9 * max(1.0, abs(x)) for v in vals)


def sample_readings(pieces, assign, cap=64):
    options = [sorted(assign.get(p, ())) for p in pieces]
    if any(not o for o in options):
        return None
    out = set()
    for n, combo in enumerate(itertools.product(*options)):
        if n >= cap:
            break
        out |= readings([(k, v) for (k, v, _o) in combo])
    return out


# ── inference ────────────────────────────────────────────────────────────────
def infer(samples):
    """samples: [(x, pieces, ordinal_ruleset)]. Returns piece -> {(kind, value, ordinal)}."""
    assign = collections.defaultdict(set)
    for x, pieces, ordinal in samples:
        if len(pieces) == 1 and float(x).is_integer():
            v = int(x)
            assign[pieces[0]].add((CARD, v, ordinal))
            if v in SMALL_MULTS or v in BIG_MULTS:
                assign[pieces[0]].add((MULT, v, ordinal))
    by_piece = collections.defaultdict(list)
    for s in samples:
        for p in set(s[1]):
            by_piece[p].append(s)

    def spread(rows, cap):
        # Score over the WHOLE range a piece occurs in, not its first rows: the
        # first rows of "mil" are all "un mil ...", where CARD 999 fits as well
        # as MULT 1000 and only "dau mil" tells them apart.
        step = max(1, len(rows) // cap)
        return rows[::step][:cap]

    def solve(p):
        rel = [s for s in by_piece[p] if all(q in assign or q == p for q in s[1])]
        if not rel:
            return False
        ordinal = all(s[2] for s in rel)
        rel = spread(rel, 240)
        cands = {(CONJ, 0), (DEC, 0)} | {(MULT, m) for m in SMALL_MULTS + BIG_MULTS}
        for x, pieces, _o in spread(rel, 24):
            if not float(x).is_integer():
                continue
            trial = dict(assign)
            trial[p] = {(CARD, 0, False)}
            for base in (sample_readings(pieces, trial, cap=8) or ()):
                d = int(x) - int(base)
                if 0 < d < 10**13:
                    cands.add((CARD, d))
        scored = []
        for c in sorted(cands):
            trial = dict(assign)
            trial[p] = {(c[0], c[1], ordinal)}
            score = sum(1 for x, pieces, _o in rel
                        if (lambda r: bool(r) and matches(x, r))(sample_readings(pieces, trial)))
            # Ties go to the role that explains the most with the least: a
            # multiplier over an arbitrary addend, a joiner over either.
            scored.append((score, {CONJ: 3, MULT: 2, DEC: 1, CARD: 0}[c[0]], c))
        scored.sort(reverse=True)
        score, _, best = scored[0]
        if score >= max(1, (len(rel) * 6 + 9) // 10):
            assign[p] = {(best[0], best[1], ordinal)}
            return True
        return False

    def reproduced():
        return sum(1 for x, pieces, _o in samples
                   if (lambda r: r is not None and matches(x, r))(sample_readings(pieces, assign)))

    stuck = set()
    for _round in range(40):
        changed = False
        for p in sorted(q for q in by_piece if q not in assign and q not in stuck):
            changed |= solve(p)
        if changed:
            continue
        # No piece has a sample whose other pieces are all known: two unknowns
        # always travel together (Irish "a náid", Filipino "dalawáng pû't").
        # Hypothesise the most frequent unknown is a joiner, and keep the
        # hypothesis only if it lets strictly more of CLDR be reproduced.
        unknown = sorted((q for q in by_piece if q not in assign and q not in stuck),
                         key=lambda q: (-len(by_piece[q]), q))
        if not unknown:
            break
        before = reproduced()
        snapshot = {k: set(v) for k, v in assign.items()}
        p = unknown[0]
        assign[p] = {(CONJ, 0, False)}
        for _inner in range(8):
            if not any(solve(q) for q in sorted(q for q in by_piece if q not in assign and q not in stuck)):
                break
        if reproduced() <= before:
            assign.clear()
            assign.update(snapshot)
            stuck.add(p)
    return assign


NUMX = 4  # a CLDR numeral piece whose role could not be inferred: READ, not valued
KIND_NAME[NUMX] = "NUMX"


# ── word recognition (MIRRORED in Redactor.cpp: readLetterRun) ──────────────
def num_locales(word, union, maxlen, english):
    """Locales in which `word` is a NUMERAL WORD: a sequence of that locale's
    pieces, at least one of them a number, a joiner (CONJ) only between two
    numbers, a decimal word (DEC) never inside a word, and an ordinal piece
    only last, optionally followed by a plural 's'. Single letters are never
    numeral words. Mirrors readLetterRun() in Redactor.cpp."""
    n = len(word)
    if n < 2:
        return set()
    # state per position: locale -> bitmask {1: after a number, 2: after a
    # joiner, 4: after an ordinal}; position 0 is the start for every locale.
    reach = [dict() for _ in range(n + 1)]
    found = set()
    for i in range(n):
        states = reach[i]
        if i > 0 and not states:
            continue
        for j in range(i + 1, min(n, i + maxlen) + 1):
            for (loc, kind, _value, ordinal) in union.get(word[i:j], ()):
                if kind == DEC:
                    continue
                mask = 0 if i == 0 else states.get(loc, 0)
                if i > 0 and mask == 0:
                    continue
                if kind == CONJ:
                    if i == 0 or not (mask & 1):
                        continue
                    nxt = 2
                else:
                    if i > 0 and not (mask & 3):
                        continue
                    nxt = 4 if ordinal else 1
                reach[j][loc] = reach[j].get(loc, 0) | nxt
        if i == n - 1 and word[i] == "s" and english in states and states[english] & 4:
            # English fraction denominators only ("five eighths"). Other
            # languages' plural ordinals are CLDR pieces of their own; a
            # generic plural 's' read "primes" and "zeros" as numerals.
            found.add(english)
    for loc, mask in reach[n].items():
        if mask & 5:
            found.add(loc)
    return found


ROMAN = re.compile(r"m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})")


def is_roman(word):
    return len(word) >= 2 and ROMAN.fullmatch(word) is not None


def cstr(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def extract(icu, fold):
    """Every locale whose own CLDR spellout rules format numbers into text the
    redactor's fold can read. Returns [(lang, samples, rows, dropped)]."""
    langs = icu.languages()
    langs.remove("en")
    langs.insert(0, "en")
    out = []
    en_sig = None
    for lang in langs:
        f, valid = icu.open(lang)
        if f is None:
            continue
        if lang != "en" and (valid in ("", "root") or not valid.startswith(lang)):
            icu.lib.unum_close(f)
            continue
        rss = [r for r in icu.rulesets(f)
               if re.fullmatch(r"%spellout-(numbering|cardinal|ordinal)(-[a-z-]+)?", r)]
        samples, rows, dropped = [], [], 0
        for rs in rss:
            ordinal = "ordinal" in rs
            year = "year" in rs
            for x in list(INTS) + ([] if (ordinal or year) else DECIMALS):
                text = icu.format(f, rs, x)
                if not text:
                    continue
                raw = split_pieces(text)
                pieces = [fold_piece(p, fold) for p in raw]
                if not raw or any(p is None for p in pieces):
                    dropped += 1
                    continue
                samples.append((x, tuple(pieces), ordinal))
                if not ordinal and not year and (x in SAMPLE_INTS or x in SAMPLE_DECIMALS):
                    rows.append((rs, x, text))
        icu.lib.unum_close(f)
        # A locale whose spellouts the fold almost never reads (Russian and
        # Vietnamese, where only stray look-alike letters survive) contributes
        # noise, not numerals: text in that script is refused before reading.
        if not samples or len(samples) < 0.02 * (len(samples) + dropped):
            continue
        # A locale without rules of its own falls back to root, which is English.
        sig = tuple(s[1] for s in samples[:1200])
        if lang == "en":
            en_sig = sig
        elif sig == en_sig:
            continue
        out.append((lang, samples, rows, dropped))
    return out


def valued(assign, pieces):
    """sample_readings with unvalued pieces read as joiners."""
    a = {p: {((CONJ if k == NUMX else k), v, o) for (k, v, o) in assign.get(p, ())} for p in pieces}
    return sample_readings(pieces, a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fold_dump")
    ap.add_argument("--web2", default="/usr/share/dict/web2")
    ap.add_argument("--cache", help="reuse/store the (slow) inference result here")
    ap.add_argument("--corpus", nargs="*", default=[],
                    help="English text files: print words the reader would strip that are not listed as ambiguous")
    ap.add_argument("--no-write", action="store_true")
    ap.add_argument("--verify-cxx", help="numeral_word_dump binary built against the CURRENT tables")
    args = ap.parse_args()

    import json
    fold = load_fold(args.fold_dump)
    icu = Icu()
    cldr, icuv = icu.versions()
    print("[numerals] CLDR %s via ICU %s" % (cldr, icuv))

    if args.cache and os.path.exists(args.cache):
        cache = json.load(open(args.cache))
        locales = [(e["lang"], [(x, tuple(p), o) for x, p, o in e["samples"]],
                    [tuple(r) for r in e["rows"]], e["dropped"],
                    {p: {tuple(a) for a in v} for p, v in e["assign"].items()}) for e in cache]
    else:
        locales = []
        for lang, samples, rows, dropped in extract(icu, fold):
            locales.append((lang, samples, rows, dropped, infer(samples)))
            print("[numerals] inferred %s" % lang, flush=True)
        if args.cache:
            json.dump([{"lang": l, "samples": [[x, list(p), o] for x, p, o in s], "rows": r,
                        "dropped": d, "assign": {p: sorted(list(a) for a in v) for p, v in asg.items()}}
                       for l, s, r, d, asg in locales], open(args.cache, "w"))

    # ── final tables: manual additions, unvalued pieces, de-duplicated locales ──
    tables, stats, fixture = [], [], []
    for lang, samples, rows, dropped, assign in locales:
        if len(samples) < 0.02 * (len(samples) + dropped):
            continue  # see extract(): a cache written before that rule
        assign = {p: set(v) for p, v in assign.items()}
        for text, kind, value, ordinal in MANUAL_PIECES.get(lang, []):
            assign.setdefault(text, set()).add((kind, value, ordinal))
        values_with = collections.defaultdict(set)
        for x, pieces, _o in samples:
            for p in pieces:
                values_with[p].add(x)
        for p, xs in values_with.items():
            if p not in assign:
                # Not inferred. A piece that occurs across twenty or more
                # different numbers is a linker (Irish "is", Lithuanian "ir"),
                # not a number of its own.
                assign[p] = {(CONJ if len(xs) >= 20 else NUMX, 0, False)}
        for p in [p for p in assign if len(p) == 1]:
            # A one-letter NUMBER piece (Catalan "u" in "vint-i-u") glues
            # into junk ("uu", "tt"); one-letter joiners are kept.
            assign[p] = {r for r in assign[p] if r[0] == CONJ}
            if not assign[p]:
                del assign[p]
        frozen = sorted((p, tuple(sorted(v))) for p, v in assign.items())
        twin = next((t for t in tables if t[2] == frozen), None)
        ok = sum(1 for x, p, _o in samples if (lambda r: r is not None and matches(x, r))(valued(assign, p)))
        stats.append((lang, len(samples), ok, dropped, len(assign), twin[0] if twin else ""))
        if not twin:
            tables.append((lang, assign, frozen))
        loc_name = twin[0] if twin else lang
        for rs, x, text in rows:
            pieces = tuple(fold_piece(p, fold) for p in split_pieces(text))
            r = valued(assign, pieces)
            fixture.append((loc_name, lang, rs, x, 1 if (r and matches(x, r)) else 0,
                            text.replace("­", "")))

    loc_index = {lang: i for i, (lang, _a, _f) in enumerate(tables)}
    union = collections.defaultdict(list)
    for lang, assign, _f in tables:
        for p, roles in assign.items():
            for (k, v, o) in roles:
                union[p].append((loc_index[lang], k, v, o))
    maxlen = max(len(p) for p in union)
    en = loc_index["en"]

    for lang, n, ok, dropped, npieces, twin in stats:
        print("[numerals] %-4s samples=%6d reproduced=%6d (%5.1f%%) unfoldable=%5d pieces=%4d%s"
              % (lang, n, ok, 100.0 * ok / n, dropped, npieces, (" = " + twin) if twin else ""))

    # ── ambiguity: numeral words that are also English words ──
    # Words of 1-2 letters are never stripped on sight (Redactor.cpp rule), so
    # only longer words need a listing.
    words = set()
    for line in open(args.web2, encoding="latin-1"):
        w = line.strip()
        if re.fullmatch(r"[A-Za-z]{3,}", w):
            words.add(w.lower())
    # The redactor's own public vocabulary: every string literal in the sets it
    # deliberately KEEPS (standards bodies, engineering vocabulary, units,
    # material context words). "ISA 5.1" must not lose its body to Filipino.
    vocab = set()
    src = open(os.path.join(ROOT, "retrieval/src/Redactor.cpp"), encoding="utf-8").read()
    for fn in ("standardsBodies", "publicCapitalizedVocabulary", "unitWords", "materialContextWords"):
        m = re.search(r"const StrSet& %s\(\) \{(.*?)\n\}" % fn, src, re.S)
        if not m:
            sys.exit("[numerals] FATAL: %s() not found in Redactor.cpp" % fn)
        vocab |= {w.lower() for w in re.findall(r'"([A-Za-z]{3,})"', m.group(1))}
    ambiguous = set()
    for w in sorted(words | vocab | EXTRA_AMBIGUOUS):
        locs = num_locales(w, union, maxlen, en)
        if locs and not (en in locs and w not in EN_WEAK):
            ambiguous.add(w)
        elif not locs and is_roman(w):
            ambiguous.add(w)
    ambiguous |= EN_WEAK
    unread = sorted(w for w in EXTRA_AMBIGUOUS if w not in ambiguous)
    if unread:
        sys.exit("[numerals] FATAL: curated ambiguous words the reader does not read as numerals: %s" % unread)
    print("[numerals] web2 words=%d, vocabulary words=%d, ambiguous numeral words=%d"
          % (len(words), len(vocab), len(ambiguous)))

    if args.corpus:
        counts = collections.Counter()
        for path in args.corpus:
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            counts.update(m.lower() for m in re.findall(r"[A-Za-z]{3,}", text))
        for w, c in counts.most_common():
            if w in ambiguous:
                continue
            locs = num_locales(w, union, maxlen, en)
            if locs and en not in locs:
                print("[corpus] strong %-20s x%-6d %s" % (w, c, ",".join(tables[i][0] for i in sorted(locs))))
            elif not locs and len(w) >= 4 and is_roman(w):
                print("[corpus] roman  %-20s x%d" % (w, c))

    if args.verify_cxx:
        # THE TWINS AGREE. The tables were inferred under this file's rules; the
        # C++ reads text under its own. Every dictionary word, both readers.
        import subprocess
        allwords = sorted({w.lower() for w in (line.strip() for line in open(args.web2, encoding="latin-1"))
                           if re.fullmatch(r"[A-Za-z]{2,}", w)} | vocab | set(EN_WEAK) | set(union))
        proc = subprocess.run([args.verify_cxx], input="\n".join(allwords) + "\n",
                              capture_output=True, text=True, check=True)
        bad = []
        for line in proc.stdout.splitlines():
            w, num, amb, _conj, _dec = line.split("\t")
            py_num = bool(num_locales(w, union, maxlen, en)) or is_roman(w)
            py_amb = py_num and (len(w) <= 2 or w in ambiguous or
                                 (is_roman(w) and not num_locales(w, union, maxlen, en) and len(w) <= 3))
            if (num == "1") != py_num:
                bad.append("%s numeral c++=%s python=%s" % (w, num, int(py_num)))
            elif py_amb and amb != "1":
                bad.append("%s ambiguous c++=%s python=1" % (w, amb))
        print("[numerals] twin check: %d words through both readers, %d disagreements" % (len(allwords), len(bad)))
        for b in bad[:40]:
            print("[numerals]   DISAGREE %s" % b)
        if bad:
            return 1

    if args.no_write:
        return 0

    os.makedirs(os.path.dirname(OUT_INC), exist_ok=True)
    rows_out = sorted((p, i, k, v, o) for p, lst in union.items() for (i, k, v, o) in lst)
    with open(OUT_INC, "w", encoding="utf-8") as out:
        out.write("// " + "-" * 77 + "\n")
        out.write("// GENERATED by retrieval/tools/gen_numeral_lexicon.py. DO NOT EDIT BY HAND.\n")
        out.write("//\n")
        out.write("// Source: Unicode CLDR %s rule-based number formatting, the spellout rule\n" % cldr)
        out.write("// sets of every locale (common/rbnf/*.xml), as formatted by ICU %s. Each piece\n" % icuv)
        out.write("// is folded through the redactor's own fold table; its role and value are\n")
        out.write("// inferred by requiring the reader's grammar to reproduce what CLDR spelled.\n")
        out.write("// Ambiguous words: numeral words that are also words of /usr/share/dict/web2\n")
        out.write("// (Webster's Second, public domain), plus the generator's curated lists.\n")
        out.write("//\n// Reproduction of CLDR by the grammar, per locale:\n")
        for lang, n, ok, dropped, npieces, twin in stats:
            out.write("//   %-4s %6d / %6d spellouts (%5.1f%%)%s\n"
                      % (lang, ok, n, 100.0 * ok / n, (" - identical to " + twin) if twin else ""))
        out.write("// " + "-" * 77 + "\n")
        out.write('constexpr char kNumeralCldrVersion[] = "%s";\n' % cldr)
        out.write("constexpr const char* const kNumeralLocales[] = {\n")
        for i in range(0, len(tables), 10):
            out.write("    " + " ".join(cstr(t[0]) + "," for t in tables[i:i + 10]) + "\n")
        out.write("};\n")
        out.write("constexpr unsigned char kNumeralEnglish = %d;\n" % en)
        out.write("// kind: 0 CARD (adds), 1 MULT (multiplies), 2 CONJ (joins), 3 DEC (decimal\n")
        out.write("// separator), 4 NUMX (a CLDR numeral piece whose role was not inferred).\n")
        out.write("struct NumeralPieceRow {\n  const char* text;\n  unsigned char locale;\n"
                  "  unsigned char kind;\n  bool ordinal;\n  double value;\n};\n")
        out.write("constexpr NumeralPieceRow kNumeralPieces[] = {\n")
        for p, i, k, v, o in rows_out:
            out.write("    {%s, %d, %d, %s, %s},\n" % (cstr(p), i, k, "true" if o else "false", "%d.0" % v))
        out.write("};\n")
        out.write("constexpr const char* const kNumeralAmbiguousWords[] = {\n")
        amb = sorted(ambiguous)
        for i in range(0, len(amb), 8):
            out.write("    " + " ".join(cstr(w) + "," for w in amb[i:i + 8]) + "\n")
        out.write("};\n")
    os.makedirs(os.path.dirname(OUT_SAMPLE), exist_ok=True)
    with open(OUT_SAMPLE, "w", encoding="utf-8") as out:
        out.write("# CLDR %s spellouts formatted by ICU %s (retrieval/tools/gen_numeral_lexicon.py).\n" % (cldr, icuv))
        out.write("# table-locale\tlocale\truleset\tvalue\tvalue-reproduced-by-grammar\ttext (soft hyphens removed)\n")
        for loc, lang, rs, x, ok, text in fixture:
            out.write("%s\t%s\t%s\t%r\t%d\t%s\n" % (loc, lang, rs, float(x), ok, text))
    print("[numerals] wrote %s (%d pieces, %d locales, %d ambiguous)" % (OUT_INC, len(rows_out), len(tables), len(ambiguous)))
    print("[numerals] wrote %s (%d rows)" % (OUT_SAMPLE, len(fixture)))
    return 0


if __name__ == "__main__":
    sys.exit(main())


