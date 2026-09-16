#!/usr/bin/env python3
# ─────────────────────────────────────────────────────────────────────────────
# gen_numeral_lexicon.py — generate the CLOSED numeral lexicon the redactor uses
# to recognise a NUMBER SPELLED IN WORDS, and the Unicode digit fold it uses to
# recognise a number spelled in a script other than ASCII.
#
# WHY THIS IS GENERATED AND NOT HAND-WRITTEN
#   The redactor's stance is "membership is the test" (Redactor.cpp: a shape is
#   not a licence). The same stance applies in reverse here: a numeral word is a
#   numeral word because it IS one, not because it looks like one. Enumerating
#   the lexicon mechanically is the only way to get the German und-compounds and
#   the 700-odd Unicode decimal digits right, and the only way to make "why is
#   this word in the table?" answerable by re-running a script.
#
# OUTPUT (committed, so the C++ builds with no Python in the loop):
#   ../include/forge/retrieval/generated/NumeralLexicon.inc
#
# Regenerate with:
#   python3 retrieval/tools/gen_numeral_lexicon.py
# and commit BOTH this file and the .inc. The .inc carries a digest of the
# generator's own source so a hand-edit of the output is detectable.
#
# DELIBERATE OMISSIONS, each of which is a false-positive decision, not an
# oversight (see retrieval/test/numeral_redaction_gate.cpp, NEGATIVE arm):
#   * "single", "double", "triple", "dozen", "pair"  — multipliers/quantities,
#     not values written in an engineering dimension. "double shear" must live.
#   * plural SCALE words "tens", "hundreds", "thousands", "millions" — they
#     denote an order of magnitude, never a value ("tens of thousands of cycles").
#     Plural FRACTION words ("quarters", "eighths") ARE included: "three
#     quarters inch" is a real dimension.
#   * the bare letter "o" as dictated zero — it collides with "o'clock" and with
#     every single-letter token. "oh" is included; "o" is not.
# ─────────────────────────────────────────────────────────────────────────────
import hashlib
import pathlib
from fractions import Fraction
import sys
import unicodedata

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "include" / "forge" / "retrieval" / "generated" / "NumeralLexicon.inc"

# ── roles ───────────────────────────────────────────────────────────────────
# A word may carry SEVERAL roles; the reader tries each and emits every value it
# can compose. An extra candidate can only ever cause an extra redaction or an
# extra residue report (both fail-closed); a missing candidate sends a secret.
R_UNIT = 1 << 0   # 0..9, and any word usable as a cardinal digit position
R_TEEN = 1 << 1   # 10..19
R_TENS = 1 << 2   # 20,30,...,90
R_SCALE = 1 << 3  # 100, 1000, 1e6, 1e9
R_FRACDEN = 1 << 4  # fraction DENOMINATOR: "three QUARTERS", "five EIGHTHS"
R_POINT = 1 << 5  # decimal-point word: "point", "decimal", "komma", "virgule"
R_AND = 1 << 6    # connector: "and", "und", "et"

# ── English ─────────────────────────────────────────────────────────────────
EN = {}


def add(table, word, role, value):
    w = word.lower()
    if w in table:
        table[w] = (table[w][0] | role, table[w][1] if table[w][1] is not None else value)
        # A word carrying two roles must carry ONE value; every such word in this
        # generator (seventh=7 as unit and as denominator) agrees by construction.
        if table[w][1] != value:
            raise SystemExit(f"role/value conflict for {w!r}: {table[w][1]} vs {value}")
    else:
        table[w] = (role, value)


_EN_UNITS = {
    "zero": 0, "nought": 0, "naught": 0, "oh": 0, "nil": 0,
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9,
}
_EN_TEENS = {
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_EN_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_EN_SCALES = {"hundred": 1e2, "thousand": 1e3, "million": 1e6, "billion": 1e9}
# ordinal spelling -> cardinal value. These double as fraction denominators
# ("a THIRD", "five EIGHTHS") except where the ordinal is not used that way.
_EN_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11,
    "twelfth": 12, "thirteenth": 13, "fourteenth": 14, "fifteenth": 15,
    "sixteenth": 16, "seventeenth": 17, "eighteenth": 18, "nineteenth": 19,
    "twentieth": 20, "thirtieth": 30, "fortieth": 40, "fiftieth": 50,
    "sixtieth": 60, "seventieth": 70, "eightieth": 80, "ninetieth": 90,
    "hundredth": 100, "thousandth": 1000, "millionth": 1e6,
}
# ordinals that are NOT fraction denominators in engineering English
_NOT_DENOM = {"first", "second"}

for w, v in _EN_UNITS.items():
    add(EN, w, R_UNIT, float(v))
for w, v in _EN_TEENS.items():
    add(EN, w, R_TEEN, float(v))
for w, v in _EN_TENS.items():
    add(EN, w, R_TENS, float(v))
for w, v in _EN_SCALES.items():
    add(EN, w, R_SCALE, float(v))
for w, v in _EN_ORDINALS.items():
    role = R_TEEN if 10 <= v <= 19 else (R_TENS if v in (20, 30, 40, 50, 60, 70, 80, 90)
                                         else (R_SCALE if v >= 100 else R_UNIT))
    if w not in _NOT_DENOM:
        role |= R_FRACDEN
    add(EN, w, role, float(v))
    # plural ordinals are fraction denominators only: "five eighths"
    if w not in _NOT_DENOM:
        add(EN, w + "s", R_FRACDEN, float(v))
# "half"/"halves"/"quarter"/"quarters" are denominators with no cardinal reading.
for w, v in {"half": 2, "halves": 2, "quarter": 4, "quarters": 4}.items():
    add(EN, w, R_FRACDEN, float(v))
for w in ("point", "decimal"):
    add(EN, w, R_POINT, 0.0)
add(EN, "and", R_AND, 0.0)

# ── German ──────────────────────────────────────────────────────────────────
# Needed verbatim by the census: siebenundvierzig (47), sechsundneunzig (96),
# siebzehn (17). The und-compounds are decomposed by the C++ reader's splitter,
# so only the ATOMS are listed here.
DE = {}
for w, v in {"null": 0, "eins": 1, "ein": 1, "eine": 1, "zwei": 2, "drei": 3,
             "vier": 4, "fuenf": 5, "sechs": 6, "sieben": 7, "acht": 8, "neun": 9}.items():
    add(DE, w, R_UNIT, float(v))
for w, v in {"zehn": 10, "elf": 11, "zwoelf": 12, "dreizehn": 13, "vierzehn": 14,
             "fuenfzehn": 15, "sechzehn": 16, "siebzehn": 17, "achtzehn": 18,
             "neunzehn": 19}.items():
    add(DE, w, R_TEEN, float(v))
for w, v in {"zwanzig": 20, "dreissig": 30, "vierzig": 40, "fuenfzig": 50,
             "sechzig": 60, "siebzig": 70, "achtzig": 80, "neunzig": 90}.items():
    add(DE, w, R_TENS, float(v))
for w, v in {"hundert": 1e2, "tausend": 1e3}.items():
    add(DE, w, R_SCALE, float(v))
add(DE, "und", R_AND, 0.0)
add(DE, "komma", R_POINT, 0.0)

# ── French ──────────────────────────────────────────────────────────────────
# Needed verbatim by the census: quarante-sept (47). Hyphens are token
# separators in the reader, so the atoms suffice.
FR = {}
for w, v in {"zero": 0, "un": 1, "une": 1, "deux": 2, "trois": 3, "quatre": 4,
             "cinq": 5, "six": 6, "sept": 7, "huit": 8, "neuf": 9}.items():
    add(FR, w, R_UNIT, float(v))
for w, v in {"dix": 10, "onze": 11, "douze": 12, "treize": 13, "quatorze": 14,
             "quinze": 15, "seize": 16}.items():
    add(FR, w, R_TEEN, float(v))
for w, v in {"vingt": 20, "trente": 30, "quarante": 40, "cinquante": 50,
             "soixante": 60}.items():
    add(FR, w, R_TENS, float(v))
for w, v in {"cent": 1e2, "cents": 1e2, "mille": 1e3}.items():
    add(FR, w, R_SCALE, float(v))
add(FR, "et", R_AND, 0.0)
add(FR, "virgule", R_POINT, 0.0)

# Merge. On collision the ENGLISH reading wins for the value and the roles are
# unioned, because the surrounding text is overwhelmingly English.
MERGED = {}
for table, lang in ((EN, "en"), (DE, "de"), (FR, "fr")):
    for w, (role, val) in table.items():
        if w in MERGED:
            r0, v0, l0 = MERGED[w]
            MERGED[w] = (r0 | role, v0, l0)
        else:
            MERGED[w] = (role, val, lang)

# ── Unicode digit fold ──────────────────────────────────────────────────────
# EVERY code point Unicode calls a decimal digit (category Nd), mapped to its
# ASCII digit. This is the whole of class B: at HEAD every non-ASCII byte is
# dropped before the numeric scan ever sees it, so a fullwidth, Arabic-Indic or
# Devanagari spelling of a secret reaches the wire with status Ok.
nd = []
for cp in range(0x110000):
    ch = chr(cp)
    if unicodedata.category(ch) == "Nd" and cp > 0x7F:
        nd.append((cp, unicodedata.digit(ch)))

# Fullwidth ASCII variants (U+FF01..U+FF5E -> U+0021..U+007E). This is what turns
# the fullwidth FULL STOP in ４７．６２５ into a decimal point; folding the digits
# alone would leave "47" and "625" as two unrelated values.
fullwidth = [(cp, cp - 0xFEE0) for cp in range(0xFF01, 0xFF5F)]
# Arabic decimal and thousands separators.
fullwidth += [(0x066B, ord(".")), (0x066C, ord(","))]

# ── ROUND 3, defect 3c: DASHES ──────────────────────────────────────────────
# `a one<EN DASH>two punch of tolerance stackup` lost "one two", and the plain
# ASCII `a one-two punch` does not. An en dash was UNMODELLED, so it folded to
# \x01, which made the run carry an unmodelled code point and the policy refused
# it. A dash is not an unnameable byte: it is the ASCII hyphen, typeset.
#
# DERIVED from the Unicode category, not typed out: EVERY code point in category
# Pd is an ASCII '-', plus U+2212 MINUS SIGN, which is Sm but is the same mark.
# Folding it means the typographic spelling is judged EXACTLY as the ASCII
# spelling is — the same principle the confusable table applies to letters.
#
# SOFT HYPHEN U+00AD IS DEDUCTED DELIBERATELY: it is category Cf and belongs to
# the INVISIBLE table. Folding it to '-' would break "for<SHY>ty" into "for" and
# "ty" and reopen the round-1 soft-hyphen bypass, which round 2 closed.
_dash_cps = set()
for cp in range(0x80, 0x110000):
    if unicodedata.category(chr(cp)) == "Pd":
        _dash_cps.add(cp)
_dash_cps.add(0x2212)  # MINUS SIGN (Sm), the same mark in a different category
_dash_cps -= {cp for cp, _ in fullwidth}
for cp in sorted(_dash_cps):
    if unicodedata.category(chr(cp)) in ("Cf", "Mn", "Me"):
        raise SystemExit(f"dash U+{cp:04X} is also an invisible code point")
    fullwidth.append((cp, ord("-")))

# ── ROUND 3, defect 2: DIGITS THAT ARE NOT CATEGORY Nd ──────────────────────
# `thickness <circled 4><circled 7>.<circled 6><circled 2><circled 5> mm` reached
# the wire VERBATIM with status=Ok and the post-condition reporting CLEAN, with
# 47.625 registered. The Nd sweep above closed the DECIMAL DIGIT case and these
# are not Nd: a circled, superscript, subscript, parenthesised or dingbat digit
# is category No. Six of ten such forms transmitted at round 2.
#
# DERIVED, NOT HAND-LISTED — the same move the confusable table already makes for
# accented Latin ("a code point whose compatibility decomposition is one ASCII
# letter is that letter"). Two mechanical rules, in order:
#
#   D1  COMPATIBILITY DECOMPOSITION. Take NFKD, drop combining marks. If what is
#       left is pure ASCII, carries at least one digit, carries NO ASCII letter
#       and is built only from digits and the punctuation a number may contain,
#       the code point folds to that decomposition. This is what turns U+2463
#       CIRCLED DIGIT FOUR into "4", U+2477 PARENTHESIZED DIGIT FOUR into "(4)",
#       U+2488 DIGIT ONE FULL STOP into "1." and U+00B2 into "2". The ASCII-letter
#       exclusion is what keeps ROMAN NUMERAL TWELVE (NFKD "XII") out: those are
#       letters, and they are already refused as an unmodelled run.
#   D2  NUMERIC PROPERTY, for the No code points that do not decompose at all —
#       the dingbat negative circled digits U+2776.. and the negative circled
#       numbers U+24EB.. Unicode still gives them an integer value, so they fold
#       to its ASCII spelling. Category No only: Nl (roman numerals) is excluded
#       by D1's reasoning and stays unmodelled.
#
# A code point already claimed by the Nd sweep, the fullwidth table or the
# fraction table is left alone, so no rule here can displace an existing fold.
#
# THE SUPER/SUBSCRIPT SPLIT, and why it is a separate table. mm², mm⁴ and H₂O are
# ordinary engineering typography, not a disguise: they must FOLD, so the value
# layer can read a superscripted number, but they must not by themselves make a
# buffer unsendable — the residue scan's blanket "a decimal digit that is not an
# ASCII digit is on the wire" verdict is right for a circled or fullwidth digit
# and wrong for an exponent. The split is DERIVED too: it is exactly the
# <super>/<sub> compatibility tag Unicode already publishes.
_claimed = {cp for cp, _ in nd} | {cp for cp, _ in fullwidth}


def _compat_digit_fold(cp):
    """(fold_text, is_typographic) or None. D1 then D2; never overrides a claim."""
    ch = chr(cp)
    if cp in _claimed or unicodedata.category(ch) == "Nd":
        return None
    name = unicodedata.name(ch, "")
    if "FRACTION" in name:
        return None  # the fraction table values these exactly; do not truncate
    tag = unicodedata.decomposition(ch).split(" ")[0] if unicodedata.decomposition(ch) else ""
    typographic = tag in ("<super>", "<sub>")
    d = unicodedata.normalize("NFKD", ch)
    d = "".join(c for c in d if not unicodedata.combining(c))
    if (d and d.isascii() and any(c.isdigit() for c in d)
            and not any(c.isalpha() for c in d)
            and all(c in "0123456789().,/+-" for c in d)):
        return (d, typographic)
    if unicodedata.category(ch) == "No":
        try:
            v = unicodedata.numeric(ch)
        except (ValueError, TypeError):
            return None
        if v == int(v) and 0 <= v < 1000:
            return (str(int(v)), typographic)
    return None


compat_digits = []      # blanket-refusable: circled, parenthesised, dingbat, ...
typographic_digits = []  # superscript / subscript: fold, but never refuse alone
for cp in range(0x80, 0x110000):
    got = _compat_digit_fold(cp)
    if got is None:
        continue
    text, typographic = got
    (typographic_digits if typographic else compat_digits).append((cp, text))

# Vulgar fractions and other No code points with a rational value, folded to an
# ASCII "n/d" so the reader values them exactly (0.625, not a truncated decimal).
fractions = []
for cp in range(0x110000):
    ch = chr(cp)
    if unicodedata.category(ch) != "No":
        continue
    try:
        v = unicodedata.numeric(ch)
    except (ValueError, TypeError):
        continue
    name = unicodedata.name(ch, "")
    if "FRACTION" not in name:
        continue
    fr = Fraction(v).limit_denominator(1000)
    if abs(float(fr) - v) > 1e-9:
        continue
    fractions.append((cp, f"{fr.numerator}/{fr.denominator}"))

# ── confusable skeleton fold, and the invisible fold ────────────────────────
# ROUND 2, defect 1. A homoglyph is not a numeral problem, it is a FOLD problem:
# "f<U+043E>rty <U+0441>even <U+0440>oint ..." is one Cyrillic look-alike per
# numeral word and is visually identical to the plain English spelling. At round
# 1 an unmodelled code point folded to \x01, which BROKE the numeral run, so the
# run was never FORMED and neither the value layer nor the context layer ever saw
# a number. Deny-by-default on an unmodelled code point is right for MATCHING and
# exactly backwards for FORMING A RUN.
#
# EXHAUSTIVENESS IS NOT THE SAFETY PROPERTY HERE, and it must not be, because no
# curated confusable table is ever complete. The C++ reader treats an unmodelled
# code point inside a word as a WILDCARD over ASCII letters (and over the empty
# string), so "f?rty" is recognised as a numeral token whether or not "?" is in
# any table below, and a numeral run carrying such a code point is REFUSED. These
# tables buy PRECISION — the right skeleton, so the right VALUE is composed and
# named in the audit trail — not safety.
SCRIPT_LATIN = 0     # accented Latin, ligatures: a spelling, not a disguise
SCRIPT_CYRILLIC = 1
SCRIPT_GREEK = 2
SCRIPT_FORM = 3      # fullwidth/halfwidth, mathematical alphanumerics, enclosed
SCRIPT_OTHER = 4


def script_of(cp):
    if 0x0400 <= cp <= 0x052F or 0x2DE0 <= cp <= 0x2DFF or 0xA640 <= cp <= 0xA69F:
        return SCRIPT_CYRILLIC
    if 0x0370 <= cp <= 0x03FF or 0x1F00 <= cp <= 0x1FFF:
        return SCRIPT_GREEK
    if (0xFF00 <= cp <= 0xFFEF or 0x1D400 <= cp <= 0x1D7FF or 0x2460 <= cp <= 0x24FF
            or 0x2100 <= cp <= 0x214F or 0x1F100 <= cp <= 0x1F1FF):
        return SCRIPT_FORM
    if (0x0080 <= cp <= 0x024F or 0x1E00 <= cp <= 0x1EFF or 0x2C60 <= cp <= 0x2C7F
            or 0xA720 <= cp <= 0xA7FF or 0xFB00 <= cp <= 0xFB06):
        return SCRIPT_LATIN
    return SCRIPT_OTHER


# 1. MECHANICAL. Every code point whose Unicode compatibility decomposition, with
#    combining marks discarded, is exactly one ASCII letter. This is what folds
#    "é", the fullwidth letters, the mathematical alphanumerics and the enclosed
#    forms, and it is derived, not typed.
confusables = {}
for cp in range(0x80, 0x1FB00):
    ch = chr(cp)
    if unicodedata.category(ch)[0] != "L":
        continue
    d = unicodedata.normalize("NFKD", ch)
    d = "".join(c for c in d if not unicodedata.combining(c))
    if len(d) == 1 and d.isascii() and d.isalpha():
        confusables[cp] = (d, script_of(cp))

# 2. CURATED, and only for the two scripts that produce look-alikes a reader
#    cannot tell apart from Latin at all: Cyrillic and Greek. Nothing here
#    decomposes, so nothing here can be derived. Every entry is a lowercase or
#    uppercase letter whose glyph IS the ASCII letter it maps to.
_CYRILLIC = {
    0x0430: "a", 0x0432: "b", 0x0435: "e", 0x0433: "r", 0x043A: "k", 0x043C: "m",
    0x043D: "h", 0x043E: "o", 0x043F: "n", 0x0440: "p", 0x0441: "c", 0x0442: "t",
    0x0443: "y", 0x0445: "x", 0x0455: "s", 0x0456: "i", 0x0458: "j", 0x0473: "o",
    0x04BB: "h", 0x04CF: "l", 0x0501: "d", 0x051B: "q", 0x051D: "w",
    0x0410: "A", 0x0412: "B", 0x0415: "E", 0x0405: "S", 0x0406: "I", 0x0408: "J",
    0x041A: "K", 0x041C: "M", 0x041D: "H", 0x041E: "O", 0x0420: "P", 0x0421: "C",
    0x0422: "T", 0x0423: "Y", 0x0425: "X", 0x0472: "O", 0x04AE: "Y", 0x04C0: "I",
    0x051A: "Q", 0x051C: "W", 0x0500: "D",
}
_GREEK = {
    0x03B1: "a", 0x03B3: "y", 0x03B5: "e", 0x03B7: "n", 0x03B9: "i", 0x03BA: "k",
    0x03BC: "u", 0x03BD: "v", 0x03BF: "o", 0x03C1: "p", 0x03C3: "o", 0x03C4: "t",
    0x03C5: "u", 0x03C7: "x", 0x03C9: "w", 0x03F2: "c", 0x03F3: "j",
    0x0391: "A", 0x0392: "B", 0x0395: "E", 0x0396: "Z", 0x0397: "H", 0x0399: "I",
    0x039A: "K", 0x039C: "M", 0x039D: "N", 0x039F: "O", 0x03A1: "P", 0x03A4: "T",
    0x03A5: "Y", 0x03A7: "X", 0x03A9: "O", 0x03F9: "C",
}
for table, want in ((_CYRILLIC, SCRIPT_CYRILLIC), (_GREEK, SCRIPT_GREEK)):
    for cp, ascii_ch in table.items():
        # Membership is the test, and so is the BLOCK: a typo in a hex literal
        # here would silently fold a code point from the wrong script.
        if script_of(cp) != want:
            raise SystemExit(f"curated confusable U+{cp:04X} is not in the expected script")
        if unicodedata.category(chr(cp))[0] != "L":
            raise SystemExit(f"curated confusable U+{cp:04X} is not a letter")
        confusables[cp] = (ascii_ch, want)

# 3. INVISIBLES. A zero-width or combining code point inside a word is a run
#    breaker at round 1 and a disguise in general; it folds to NOTHING, so
#    "forty<ZWSP>seven" reads exactly as "fortyseven" does.
invisible = []
for cp in range(0x80, 0x110000):
    cat = unicodedata.category(chr(cp))
    if cat in ("Cf", "Mn", "Me"):
        invisible.append(cp)

digest = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()[:16]


def utf8_literal(cp):
    return "".join(f"\\x{b:02X}" for b in chr(cp).encode("utf-8"))


lines = []
w = lines.append
w("// GENERATED BY retrieval/tools/gen_numeral_lexicon.py — DO NOT EDIT BY HAND.")
w(f"// generator sha256[:16] = {digest}")
w(f"// {len(MERGED)} numeral words (en/de/fr), {len(nd)} non-ASCII decimal digits,")
w(f"// {len(fullwidth)} fullwidth/separator folds, {len(fractions)} vulgar fractions,")
w(f"// {len(compat_digits)} non-Nd compatibility digits, {len(typographic_digits)} super/subscript digits.")
w("//")
w("// Regenerate: python3 retrieval/tools/gen_numeral_lexicon.py")
w("")
w("// Role bits. A word may carry several; the reader tries each reading and keeps")
w("// EVERY value it can compose, because an extra candidate is fail-closed.")
w("inline constexpr unsigned char kRoleUnit    = 1u << 0;")
w("inline constexpr unsigned char kRoleTeen    = 1u << 1;")
w("inline constexpr unsigned char kRoleTens    = 1u << 2;")
w("inline constexpr unsigned char kRoleScale   = 1u << 3;")
w("inline constexpr unsigned char kRoleFracDen = 1u << 4;")
w("inline constexpr unsigned char kRolePoint   = 1u << 5;")
w("inline constexpr unsigned char kRoleAnd     = 1u << 6;")
w("")
w("struct NumeralWordEntry { const char* word; unsigned char roles; double value; };")
w("")
w("inline constexpr NumeralWordEntry kNumeralWords[] = {")
for word in sorted(MERGED):
    role, val, lang = MERGED[word]
    bits = []
    for bit, nm in ((R_UNIT, "kRoleUnit"), (R_TEEN, "kRoleTeen"), (R_TENS, "kRoleTens"),
                    (R_SCALE, "kRoleScale"), (R_FRACDEN, "kRoleFracDen"),
                    (R_POINT, "kRolePoint"), (R_AND, "kRoleAnd")):
        if role & bit:
            bits.append(nm)
    w(f'    {{"{word}", static_cast<unsigned char>({" | ".join(bits)}), {val!r}}},  // {lang}')
w("};")
w("")
w("// (code point, ASCII digit) for every Unicode Nd outside ASCII.")
w("struct CodePointFold { unsigned int cp; const char* ascii; };")
w("")
w("inline constexpr CodePointFold kDigitFolds[] = {")
for cp, v in nd:
    w(f'    {{0x{cp:04X}u, "{v}"}},')
w("};")
w("")
w("inline constexpr CodePointFold kPunctFolds[] = {")
for cp, target in fullwidth:
    ch = chr(target)
    esc = {'"': '\\"', "\\": "\\\\", "?": "?"}.get(ch, ch)
    w(f'    {{0x{cp:04X}u, "{esc}"}},')
w("};")
w("")
w("inline constexpr CodePointFold kFractionFolds[] = {")
for cp, text in fractions:
    w(f'    {{0x{cp:04X}u, "{text}"}},')
w("};")
w("")
# ROUND 3, defect 2. Membership is the test here too: a code point may be claimed
# by exactly one fold table, so a later rule can never silently displace an
# earlier one.
_frac_cps = {cp for cp, _ in fractions}
for cp, _text in compat_digits + typographic_digits:
    if cp in _frac_cps or cp in _claimed or cp in confusables:
        raise SystemExit(f"compat-digit U+{cp:04X} collides with another fold table")
w("// ROUND 3, defect 2 — DIGITS THAT ARE NOT CATEGORY Nd, derived from the")
w("// compatibility decomposition (D1) and from the Unicode numeric property (D2).")
w("// Circled, parenthesised, dingbat, enclosed and full-stop digit forms. These")
w("// carry the SAME weight as a fullwidth or Arabic-Indic digit: seeing one in an")
w("// outgoing buffer means the redactor did not read the number it was looking at.")
w("inline constexpr CodePointFold kCompatDigitFolds[] = {")
for cp, text in compat_digits:
    w(f'    {{0x{cp:04X}u, "{text}"}},')
w("};")
w("")
w("// Superscript and subscript digits — the <super>/<sub> compatibility tag. They")
w("// FOLD, so 'thickness <sup4><sup7>.<sup6><sup2><sup5> mm' is read as a number")
w("// and stripped, but they are NOT on their own grounds to refuse a buffer: mm2,")
w("// mm4 and H2O are ordinary engineering typography.")
w("inline constexpr CodePointFold kTypographicDigitFolds[] = {")
for cp, text in typographic_digits:
    w(f'    {{0x{cp:04X}u, "{text}"}},')
w("};")
w("")
w("// Script tags for the confusable fold. A token that mixes ASCII letters with a")
w("// NON-ZERO script tag is a mixed-script token: 'f<U+043E>rty' reads as 'forty'")
w("// and is not one. kScriptLatin is accented Latin and ligatures — an ordinary")
w("// spelling, never on its own a disguise.")
w("inline constexpr unsigned char kScriptLatin    = 0;")
w("inline constexpr unsigned char kScriptCyrillic = 1;")
w("inline constexpr unsigned char kScriptGreek    = 2;")
w("inline constexpr unsigned char kScriptForm     = 3;")
w("inline constexpr unsigned char kScriptOther    = 4;")
w("")
w("struct ConfusableFold { unsigned int cp; const char* ascii; unsigned char script; };")
w("")
w("inline constexpr ConfusableFold kConfusableFolds[] = {")
for cp in sorted(confusables):
    ascii_ch, sc = confusables[cp]
    w(f'    {{0x{cp:04X}u, "{ascii_ch}", {sc}}},')
w("};")
w("")
w("// Zero-width, format and combining code points. They fold to NOTHING: a")
w("// zero-width space inside a numeral run must not break the run, and a")
w("// combining acute must not make 'f<e-acute>rty' a different word from 'forty'.")
w("inline constexpr unsigned int kInvisibleCodePoints[] = {")
for cp in invisible:
    w(f"    0x{cp:04X}u,")
w("};")
w("")

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines) + "\n")
print(f"wrote {OUT}", file=sys.stderr)
print(f"  {len(MERGED)} numeral words, {len(nd)} Nd digits, "
      f"{len(fullwidth)} punct folds, {len(fractions)} fractions, "
      f"{len(compat_digits)} compat digits, {len(typographic_digits)} super/sub digits", file=sys.stderr)
