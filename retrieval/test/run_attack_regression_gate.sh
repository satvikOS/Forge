#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_attack_regression_gate.sh — the three attacks that broke PR #246 stay dead.
#
#   phase 1  build attack_regression_gate.cpp warning-free against the real
#            retrieval sources and run it: every proved attack (a registered
#            secret in a non-ASCII spelling; an approval spent on another
#            endpoint, client or result handling; one host corroborating itself
#            through userinfo, a trailing dot or a port) plus its controls
#   phase 2  the fold tables against Unicode itself: unicode_fold_dump prints
#            every modelled code point and unicode_fold_ucd_check.py justifies
#            each against python's unicodedata and a verbatim confusables.txt
#            16.0.0 subset
#   phase 3  THE RED PROOF, run every time. One mechanism at a time is removed
#            from a COPY of the source, the copy is rebuilt, and the case the
#            mutation names must go RED. A removal that leaves the gate green
#            is a mechanism nothing measures, and this script fails.
#
#   --red-against <rev>   ALSO build this gate's source against the retrieval/
#            tree at <rev> (e.g. 1dd9ed9b, the tree the attacks were proved on)
#            and require every PROVED attack case to fail there. Needs that rev
#            in the local clone; CI's shallow checkout does not have it, so CI
#            relies on phase 3, which needs no history.
#
# Hermetic: no socket (every transport is an in-process capture), no daemon,
# nothing from this workstation. Tools: $CXX, python3.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

RED_AGAINST=""
if [ "${1:-}" = "--red-against" ]; then
  RED_AGAINST="${2:-}"
  if [ -z "$RED_AGAINST" ]; then
    echo "usage: $0 [--red-against <rev>]" >&2
    exit 2
  fi
fi

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
OUT="$(mktemp -d /tmp/forge_attack_gate.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT

GATE_SRC="retrieval/test/attack_regression_gate.cpp"
SRCS=(
  retrieval/src/Json.cpp
  retrieval/src/Redactor.cpp
  retrieval/src/SearchRequest.cpp
  retrieval/src/EvidenceRecord.cpp
  retrieval/src/HttpTransport.cpp
  retrieval/src/SearxngClient.cpp
  retrieval/src/PlanValue.cpp
  retrieval/src/EvidenceDigest.cpp
)
# A corpus that silently shrank is not the corpus that was shown RED.
MIN_CASES=90
# The attacks as the adversarial review PROVED them against 1dd9ed9b.
PROVED_IDS="R01 R03 R05 A01 A07 H01 H02 H03"

echo "[attack] compiler: $($CXX --version | head -1)"

# ── phase 1 ──────────────────────────────────────────────────────────────────
for src in "${SRCS[@]}"; do
  if ! "$CXX" $FLAGS -Iretrieval/include -c "$src" -o "$OUT/$(basename "${src%.cpp}").o"; then
    echo "[attack] COMPILE FAILED: $src"
    exit 1
  fi
done
if ! "$CXX" $FLAGS -Iretrieval/include -c "$GATE_SRC" -o "$OUT/gate_main.o"; then
  echo "[attack] COMPILE FAILED: $GATE_SRC"
  exit 1
fi

objs_except() {   # objs_except <basename-without-.o> : every library object but that one
  local s b
  for s in "${SRCS[@]}"; do
    b="$(basename "${s%.cpp}")"
    [ "$b" = "$1" ] || printf '%s\n' "$OUT/$b.o"
  done
}

rm -f "$OUT/gate"
# shellcheck disable=SC2046
if ! "$CXX" $FLAGS "$OUT/gate_main.o" $(objs_except NONE) -o "$OUT/gate"; then
  echo "[attack] LINK FAILED"
  exit 1
fi
if [ ! -x "$OUT/gate" ]; then
  echo "[attack] FATAL: the link reported success and produced no binary." >&2
  exit 1
fi

"$OUT/gate" > "$OUT/clean.log" 2>&1
rc=$?
if [ ! -s "$OUT/clean.log" ]; then
  echo "[attack] FATAL: the gate wrote an empty log. It did not run." >&2
  exit 1
fi
summary="$(tail -1 "$OUT/clean.log")"
if [ "$rc" -ne 0 ]; then
  cat "$OUT/clean.log"
  echo "[attack] PHASE 1 FAILED (exit $rc): $summary"
  exit 1
fi
if ! printf '%s\n' "$summary" | grep -qE '^[0-9]+ passed, 0 failed$'; then
  cat "$OUT/clean.log"
  echo "[attack] phase 1 exited 0 without a '0 failed' summary. Refusing to report a pass."
  exit 1
fi
passed="${summary%% passed*}"
if [ "$passed" -lt "$MIN_CASES" ]; then
  cat "$OUT/clean.log"
  echo "[attack] phase 1 ran only $passed cases; the corpus shown RED had at least $MIN_CASES."
  exit 1
fi
for id in $PROVED_IDS; do
  if ! grep -qF "  ok   [$id] " "$OUT/clean.log"; then
    cat "$OUT/clean.log"
    echo "[attack] phase 1: proved-attack case $id did not run. Refusing to report a pass."
    exit 1
  fi
done
echo "[attack] phase 1 (proved attacks + controls) PASSED — $summary"

# ── phase 2: the fold tables against the UCD ─────────────────────────────────
echo
echo "[attack] phase 2: every modelled code point against unicodedata + confusables.txt"
CONFUSABLES="retrieval/test/fixtures/unicode/confusables-16.0.0-subset.txt"
UCDCHECK="retrieval/test/unicode_fold_ucd_check.py"
if [ ! -f "$CONFUSABLES" ] || [ ! -f "$UCDCHECK" ]; then
  echo "[attack] FATAL: $CONFUSABLES or $UCDCHECK is missing." >&2
  exit 1
fi
build_dump() {   # build_dump <Redactor.o> <out>
  "$CXX" -std=c++20 -O1 -w -Iretrieval/include retrieval/test/unicode_fold_dump.cpp "$1" -o "$2"
}
if ! build_dump "$OUT/Redactor.o" "$OUT/dump"; then
  echo "[attack] could not build unicode_fold_dump"
  exit 1
fi
"$OUT/dump" > "$OUT/dump.tsv" 2> "$OUT/dump.err"
if [ ! -s "$OUT/dump.tsv" ]; then
  echo "[attack] FATAL: unicode_fold_dump printed nothing." >&2
  exit 1
fi
python3 "$UCDCHECK" "$OUT/dump.tsv" "$CONFUSABLES" > "$OUT/ucd.log" 2>&1
urc=$?
if [ "$urc" -ne 0 ] || ! grep -q '^\[ucd\] UCD CHECK PASSED$' "$OUT/ucd.log"; then
  cat "$OUT/ucd.log"
  echo "[attack] PHASE 2 FAILED (exit $urc)"
  exit 1
fi
grep -E '^\[ucd\] (python|modelled)' "$OUT/ucd.log"
echo "[attack] phase 2 (fold tables vs Unicode data) PASSED"

# ── phase 3: the RED proof ───────────────────────────────────────────────────
echo
echo "[attack] phase 3: RED proof — remove one mechanism at a time from a copy"
MUT_TOTAL=0
MUT_CAUGHT=0
MUT_BAD=0

# mutate <label> <source file> <needle> <replacement> <required failing ids... | UCD>
mutate() {
  local label="$1" unit="$2" needle="$3" replacement="$4"
  shift 4
  MUT_TOTAL=$((MUT_TOTAL + 1))
  local W="$OUT/mut_$MUT_TOTAL" base
  base="$(basename "${unit%.cpp}")"
  mkdir -p "$W"
  cp "$unit" "$W/$base.cpp"

  if ! python3 - "$W/$base.cpp" "$needle" "$replacement" <<'PY'
import io, sys
path, needle, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding="utf-8").read()
n = s.count(needle)
if n != 1:
    sys.stderr.write("needle matched %d times (need exactly 1): %r\n" % (n, needle))
    sys.exit(3)
out = s.replace(needle, replacement, 1)
if out == s:
    sys.stderr.write("mutation changed no bytes\n")
    sys.exit(3)
io.open(path, "w", encoding="utf-8").write(out)
PY
  then
    echo "[attack]   COULD NOT APPLY '$label' — the source has drifted from this gate."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  if cmp -s "$W/$base.cpp" "$unit"; then
    echo "[attack]   NO-OP '$label' — the copy is byte-identical to the source."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  # -w: a removed mechanism can legitimately leave an unused variable, and this
  # phase measures behaviour, not warnings. The copy compiles with the REAL headers.
  if ! "$CXX" -std=c++20 -O1 -w -Iretrieval/include -c "$W/$base.cpp" -o "$W/$base.o" 2> "$W/build.log"; then
    echo "[attack]   MUTANT DID NOT BUILD '$label' — a build error is not a RED gate."
    head -5 "$W/build.log"
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi

  if [ "$1" = "UCD" ]; then
    if ! build_dump "$W/$base.o" "$W/dump" 2>> "$W/build.log"; then
      echo "[attack]   MUTANT DUMP DID NOT BUILD '$label'"
      MUT_BAD=$((MUT_BAD + 1))
      return
    fi
    "$W/dump" > "$W/dump.tsv" 2>/dev/null
    python3 "$UCDCHECK" "$W/dump.tsv" "$CONFUSABLES" > "$W/ucd.log" 2>&1
    if [ $? -eq 0 ] || ! grep -q '^\[ucd\] FAIL ' "$W/ucd.log"; then
      echo "[attack]   NOT RED: '$label' — the UCD check still passed."
      MUT_BAD=$((MUT_BAD + 1))
      return
    fi
    MUT_CAUGHT=$((MUT_CAUGHT + 1))
    echo "[attack]   RED as required: '$label' -> $(grep -m1 '^\[ucd\] FAIL ' "$W/ucd.log")"
    return
  fi

  rm -f "$W/gate"
  # shellcheck disable=SC2046
  if ! "$CXX" -std=c++20 "$OUT/gate_main.o" $(objs_except "$base") "$W/$base.o" -o "$W/gate" 2>> "$W/build.log" ||
     [ ! -x "$W/gate" ]; then
    echo "[attack]   MUTANT DID NOT LINK '$label'"
    head -5 "$W/build.log"
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  "$W/gate" > "$W/gate.log" 2>&1
  local mrc=$?
  if [ ! -s "$W/gate.log" ]; then
    echo "[attack]   MUTANT WROTE NO LOG '$label' — it did not run."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  if [ "$mrc" -eq 0 ]; then
    echo "[attack]   NOT RED: '$label' — the gate still passed. This mechanism is unmeasured."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  local id missing=""
  for id in "$@"; do
    grep -qF "  FAIL [$id] " "$W/gate.log" || missing="$missing $id"
  done
  if [ -n "$missing" ]; then
    echo "[attack]   RED FOR THE WRONG REASON: '$label' — named case(s)$missing did not fail."
    grep '  FAIL ' "$W/gate.log" | head -5
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  MUT_CAUGHT=$((MUT_CAUGHT + 1))
  echo "[attack]   RED as required: '$label' -> $* ($(tail -1 "$W/gate.log"))"
}

R=retrieval/src/Redactor.cpp
C=retrieval/src/SearxngClient.cpp
P=retrieval/src/PlanValue.cpp

# ── R: redaction ─────────────────────────────────────────────────────────────
mutate "redact() transmits what the normaliser could not model" "$R" \
  '  if (!folded.ok()) {
    for (const detail::FoldIssue& issue : folded.issues) {' \
  '  if (false) {
    for (const detail::FoldIssue& issue : folded.issues) {' \
  R07b R10 R11 R12

mutate "no mixed-script rule" "$R" \
  '        } else if (token_script != script && !token_script_flagged) {' \
  '        } else if (false) {' \
  R05 R09

mutate "lexicon matched letter-for-letter (no UTS #39 skeleton)" "$R" \
  "    case '1': case 'i': case 'l': put('l'); return;
    case '0': case 'o': put('o'); return;
    case 'm': put('r'); put('n'); return;" \
  "" \
  R25 R26 R27 R28

mutate "the residue scan reads only the raw form, not the folded one" "$R" \
  'for (const std::string* form : {&decoded, &folded.text}) {' \
  'for (const std::string* form : {&decoded}) {' \
  R20 R22 R24

mutate "Nd digits are not folded by value" "$R" \
  '      if (cp - zero < 10) {' \
  '      if (false) {' \
  F11

mutate "the strict query scan lets a non-ASCII byte through" "$R" \
  '    if (c >= 0x80) {
      residue.push_back("a non-ASCII byte survives in the outgoing value: it did not pass the normaliser");' \
  '    if (false) {
      residue.push_back("a non-ASCII byte survives in the outgoing value: it did not pass the normaliser");' \
  F12

mutate "a confusable folds to the WRONG letter (Cyrillic a -> o)" "$R" \
  '{0x0430, "a", FoldScript::Cyrillic}' \
  '{0x0430, "o", FoldScript::Cyrillic}' \
  UCD

mutate "an Nd range folds off by one" "$R" \
  '0x0966,  0x09E6,' \
  '0x0965,  0x09E6,' \
  UCD

# ── A: approval integrity ────────────────────────────────────────────────────
mutate "the approval is not bound to the client instance" "$C" \
  '  if (approval.client_instance() != instance_.value()) {' \
  '  if (false) {' \
  A06 A14

mutate "search() does not rebuild the request digest from the wire" "$C" \
  '  if (approval.request_digest() != manifestDigestHex(describeRequest(req, preview.handling))) {' \
  '  if (false) {' \
  A07 A08 A09 A10 A11

mutate "the manifest omits min_distinct_publishers" "$C" \
  '  m.emplace_back("handling.min_distinct_publishers", std::to_string(min_distinct_publishers));' \
  '' \
  A07 M03 M08

mutate "the manifest omits the port" "$C" \
  '  m.emplace_back("connect.port", std::to_string(port));' \
  '' \
  M03

mutate "the render summarises the destination from editable fields, not the manifest" \
  retrieval/src/SearchRequest.cpp \
  '    out += "  destination   : " + destination_class + " " + escapeManifestValue(*m_scheme) + "://" +
           escapeManifestValue(*m_host) + ":" + escapeManifestValue(*m_port) + "\n";
    out += "  request       : " + escapeManifestValue(*m_method) + " " + escapeManifestValue(*m_path) + "\n";' \
  '    out += "  destination   : " + destination_class + " " + destination_origin + "\n";
    out += "  request       : " + http_method + " " + path + "\n";' \
  M18

mutate "grant() trusts the preview's own digest field" "$C" \
  '  if (covered != preview.request_digest) return a;' \
  '' \
  M15

# ── H: one host parser, one publisher identity ───────────────────────────────
mutate "corroboration reads the lenient host, not the canonical one" "$C" \
  '  const std::string host = canonicalHost(url);
  if (host.empty()) return "";
  std::vector<std::string_view> labels;' \
  '  const std::string host = publisherFromUrl(url);
  if (host.empty()) return "";
  std::vector<std::string_view> labels;' \
  H09 P01

mutate "no reduction to the registrant" "$C" \
  '  std::size_t keep = 2;' \
  '  std::size_t keep = labels.size();' \
  H06 P01

mutate "gov.uk missing from the multi-label public suffixes" "$C" \
  '    "gov.uk", "ac.uk", "co.uk",' \
  '    "ac.uk", "co.uk",' \
  H12 P01

mutate "min_distinct_publishers counts display hosts, not registrants" "$C" \
  '      const std::string who = corroborationPublisher(e.url);' \
  '      const std::string who = publisherFromUrl(e.url);' \
  H17 H18

mutate "an unidentifiable publisher still corroborates" "$P" \
  '    if (primary_publisher.empty() || corroborating_publisher.empty()) {' \
  '    if (false) {' \
  H09

mutate "PlanValue gets its own URL parser back (the 1dd9ed9b hostOf)" "$P" \
  '  return SearxngClient::corroborationPublisher(url);' \
  '  std::size_t p = url.find("://");
  std::size_t b = (p == std::string::npos) ? 0 : p + 3;
  std::size_t e = url.find_first_of("/?#", b);
  std::string host = url.substr(b, (e == std::string::npos ? url.size() : e) - b);
  const std::size_t colon = host.find(":");
  if (colon != std::string::npos) host = host.substr(0, colon);
  if (host.rfind("www.", 0) == 0) host = host.substr(4);
  return host;' \
  H01 H02 H03 H16

echo "[attack] mutations: $MUT_CAUGHT of $MUT_TOTAL caught by their named case"
if [ "$MUT_BAD" -ne 0 ] || [ "$MUT_CAUGHT" -ne "$MUT_TOTAL" ] || [ "$MUT_TOTAL" -lt 20 ]; then
  echo "[attack] PHASE 3 FAILED — $MUT_BAD mutation(s) not demonstrated RED."
  exit 1
fi
echo "[attack] phase 3 (RED proof) PASSED — all $MUT_TOTAL mechanisms are observable"

# ── optional: the historical RED ─────────────────────────────────────────────
if [ -n "$RED_AGAINST" ]; then
  echo
  echo "[attack] --red-against $RED_AGAINST: this gate's source against that tree"
  H="$OUT/history"
  mkdir -p "$H"
  if ! git -C "$ROOT" archive -o "$H/tree.tar" "$RED_AGAINST" retrieval 2> "$H/archive.err"; then
    cat "$H/archive.err"
    echo "[attack] FATAL: $RED_AGAINST is not in this clone. No historical RED was shown." >&2
    exit 1
  fi
  tar -xf "$H/tree.tar" -C "$H"
  hobjs=()
  for src in "${SRCS[@]}"; do
    [ -f "$H/$src" ] || continue
    "$CXX" -std=c++20 -O1 -w "-I$H/retrieval/include" -c "$H/$src" -o "$H/$(basename "${src%.cpp}").o" ||
      { echo "[attack] FATAL: $src did not build at $RED_AGAINST"; exit 1; }
    hobjs+=("$H/$(basename "${src%.cpp}").o")
  done
  if ! "$CXX" -std=c++20 -O1 -w "-I$H/retrieval/include" "$GATE_SRC" "${hobjs[@]}" -o "$H/gate"; then
    echo "[attack] FATAL: the gate did not build against $RED_AGAINST"
    exit 1
  fi
  "$H/gate" > "$H/gate.log" 2>&1
  hrc=$?
  grep '  FAIL ' "$H/gate.log"
  echo "[attack] at $RED_AGAINST: $(tail -1 "$H/gate.log") (exit $hrc)"
  missing=""
  for id in $PROVED_IDS; do
    grep -qF "  FAIL [$id] " "$H/gate.log" || missing="$missing $id"
  done
  if [ "$hrc" -eq 0 ] || [ -n "$missing" ]; then
    echo "[attack] FATAL: proved-attack case(s)${missing:- (none named)} did not go RED at $RED_AGAINST."
    exit 1
  fi
  echo "[attack] historical RED shown: every proved attack ($PROVED_IDS) fails at $RED_AGAINST"
fi

echo
echo "[attack] ATTACK REGRESSION GATE PASSED"
exit 0
