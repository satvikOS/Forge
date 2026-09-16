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

digest = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()[:16]


def utf8_literal(cp):
    return "".join(f"\\x{b:02X}" for b in chr(cp).encode("utf-8"))


lines = []
w = lines.append
w("// GENERATED BY retrieval/tools/gen_numeral_lexicon.py — DO NOT EDIT BY HAND.")
w(f"// generator sha256[:16] = {digest}")
w(f"// {len(MERGED)} numeral words (en/de/fr), {len(nd)} non-ASCII decimal digits,")
w(f"// {len(fullwidth)} fullwidth/separator folds, {len(fractions)} vulgar fractions.")
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

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("\n".join(lines) + "\n")
print(f"wrote {OUT}", file=sys.stderr)
print(f"  {len(MERGED)} numeral words, {len(nd)} Nd digits, "
      f"{len(fullwidth)} punct folds, {len(fractions)} fractions", file=sys.stderr)
