#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_source_classifier_gate.sh — a hostname must not be able to buy authority.
#
#   phase 1  build source_classifier_gate.cpp warning-free against the real
#            retrieval sources and run it: 90 hostile, malformed and legitimate
#            URLs, each pinned to the exact tier it must classify to
#   phase 2  THE RED PROOF, run every time. Each guard in the host canonicaliser
#            and the domain matcher is removed from a COPY of SearxngClient.cpp,
#            the gate is rebuilt against the copy, and a NAMED case must fail.
#            A removal that leaves the gate green means that guard is either
#            dead or unmeasured, and this script fails.
#
# WHY THIS EXISTS. classifySource() granted tiers by host substring, so
# ecfr.attacker-cdn.example was LawOrRegulator. Against that unfixed source this
# same gate reports 43 passed, 47 failed (measured 2026-09-14). The suite beside
# it could not see the defect because it only ever asserted what the classifier
# must ACCEPT.
#
# Hermetic: no socket, no fixture, no daemon, nothing from this workstation. The
# only tools are $CXX and python3 (to apply the mutations with an exact-match
# check). Exit 0 only if phase 1 is green AND every mutation was caught by the
# case it names.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT" || exit 2

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
OUT="$(mktemp -d /tmp/forge_classifier.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT

GATE_SRC="retrieval/test/source_classifier_gate.cpp"
# SearxngClient.cpp is the unit under test and the only file mutated; the rest
# are compiled ONCE and reused, so a mutation costs one translation unit.
OTHER_SRCS=(
  retrieval/src/Json.cpp
  retrieval/src/Redactor.cpp
  retrieval/src/SearchRequest.cpp
  retrieval/src/EvidenceRecord.cpp
  retrieval/src/HttpTransport.cpp
)
UNIT="retrieval/src/SearxngClient.cpp"

echo "[classifier] compiler: $($CXX --version | head -1)"

# ── phase 1 ──────────────────────────────────────────────────────────────────
OBJS=()
for src in "${OTHER_SRCS[@]}" "$GATE_SRC"; do
  obj="$OUT/$(basename "${src%.cpp}").o"
  if ! "$CXX" $FLAGS -Iretrieval/include -c "$src" -o "$obj"; then
    echo "[classifier] COMPILE FAILED: $src"
    exit 1
  fi
  OBJS+=("$obj")
done
if ! "$CXX" $FLAGS -Iretrieval/include -c "$UNIT" -o "$OUT/SearxngClient.o"; then
  echo "[classifier] COMPILE FAILED: $UNIT"
  exit 1
fi
rm -f "$OUT/gate"
if ! "$CXX" $FLAGS "${OBJS[@]}" "$OUT/SearxngClient.o" -o "$OUT/gate"; then
  echo "[classifier] LINK FAILED"
  exit 1
fi
if [ ! -x "$OUT/gate" ]; then
  echo "[classifier] FATAL: the link reported success and produced no binary." >&2
  exit 1
fi

"$OUT/gate" > "$OUT/clean.log" 2>&1
rc=$?
if [ ! -s "$OUT/clean.log" ]; then
  echo "[classifier] FATAL: the gate wrote an empty log. It did not run." >&2
  exit 1
fi
summary="$(tail -1 "$OUT/clean.log")"
if [ "$rc" -ne 0 ]; then
  cat "$OUT/clean.log"
  echo "[classifier] PHASE 1 FAILED (exit $rc): $summary"
  exit 1
fi
if ! printf '%s\n' "$summary" | grep -qE '^[0-9]+ passed, 0 failed$'; then
  cat "$OUT/clean.log"
  echo "[classifier] phase 1 exited 0 without a '0 failed' summary. Refusing to report a pass."
  exit 1
fi
passed="${summary%% passed*}"
# A gate whose corpus silently shrank is not the gate that was shown RED.
if [ "$passed" -lt 90 ]; then
  cat "$OUT/clean.log"
  echo "[classifier] phase 1 ran only $passed cases; the corpus shown RED had 90."
  exit 1
fi
echo "[classifier] phase 1 (hostile hostname corpus) PASSED — $summary"

# ── phase 2: the RED proof ───────────────────────────────────────────────────
echo
echo "[classifier] phase 2: RED proof — remove one guard at a time from a copy"
MUT_TOTAL=0
MUT_CAUGHT=0
MUT_BAD=0

# mutate <label> <needle> <replacement> <required failing case ids...>
mutate() {
  local label="$1" needle="$2" replacement="$3"
  shift 3
  MUT_TOTAL=$((MUT_TOTAL + 1))
  local W="$OUT/mut_$MUT_TOTAL"
  mkdir -p "$W"
  cp "$UNIT" "$W/SearxngClient.cpp"

  if ! python3 - "$W/SearxngClient.cpp" "$needle" "$replacement" <<'PY'
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
    echo "[classifier]   COULD NOT APPLY '$label' — the source has drifted from this gate."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  if cmp -s "$W/SearxngClient.cpp" "$UNIT"; then
    echo "[classifier]   NO-OP '$label' — the copy is byte-identical to the source."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi

  rm -f "$W/gate"
  # The copy compiles with the REAL headers; -w because a removed guard can
  # legitimately leave an unused variable, and this phase measures behaviour.
  if ! "$CXX" -std=c++20 -O1 -w -Iretrieval/include -c "$W/SearxngClient.cpp" -o "$W/SearxngClient.o" \
         2> "$W/build.log" ||
     ! "$CXX" -std=c++20 "${OBJS[@]}" "$W/SearxngClient.o" -o "$W/gate" 2>> "$W/build.log" ||
     [ ! -x "$W/gate" ]; then
    echo "[classifier]   MUTANT DID NOT BUILD '$label' — a build error is not a RED gate."
    head -5 "$W/build.log"
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi

  "$W/gate" > "$W/gate.log" 2>&1
  local mrc=$?
  if [ ! -s "$W/gate.log" ]; then
    echo "[classifier]   MUTANT WROTE NO LOG '$label' — it did not run."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  if [ "$mrc" -eq 0 ]; then
    echo "[classifier]   NOT RED: '$label' — the gate still passed. This guard is unmeasured."
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  local id missing=""
  for id in "$@"; do
    grep -qF "  FAIL [$id] " "$W/gate.log" || missing="$missing $id"
  done
  if [ -n "$missing" ]; then
    echo "[classifier]   RED FOR THE WRONG REASON: '$label' — named case(s)$missing did not fail."
    grep '  FAIL ' "$W/gate.log" | head -5
    MUT_BAD=$((MUT_BAD + 1))
    return
  fi
  MUT_CAUGHT=$((MUT_CAUGHT + 1))
  echo "[classifier]   RED as required: '$label' -> $* ($(tail -1 "$W/gate.log"))"
}

mutate "domain match without a label boundary" \
  "  return host.size() > domain.size() && endsWith(host, domain) &&
         host[host.size() - domain.size() - 1] == '.';" \
  "  return endsWith(host, domain);" \
  H06 H12

mutate "domain match as a substring" \
  "  if (host == domain) return true;" \
  "  if (host.find(domain) != std::string::npos) return true;" \
  H02 H03

mutate "LDH character test removed (a raw UTF-8 homoglyph label reaches the allowlist)" \
  '      if (!ldh) return "";' \
  '      (void)ldh;' \
  I07

mutate "R-LDH / A-label (xn--) test removed" \
  "    if (len >= 4 && host[label_start + 2] == '-' && host[label_start + 3] == '-') return \"\";" \
  "" \
  I01 I02

mutate "empty-label test removed" \
  '    if (len == 0 || len > 63) return "";' \
  '    if (len > 63) return "";' \
  C06 C07

mutate "authority ends at '/' only (host read out of the fragment and query)" \
  'url.find_first_of("/?#\\", start)' \
  'url.find_first_of("/", start)' \
  U01 U02 B02 B03

mutate "userinfo split at the FIRST '@'" \
  "authority.rfind('@')" \
  "authority.find('@')" \
  B08

mutate "any scheme may carry an authority grant" \
  '  if (!a.scheme_valid || !a.http_scheme || !a.port_valid) return "";' \
  '  if (!a.port_valid) return "";' \
  S02 S03

mutate "port not validated" \
  "      if (c < '0' || c > '9') { a.port_valid = false; break; }" \
  "      (void)c;" \
  P04

mutate "trailing dot not stripped (positive control must notice)" \
  "  if (!host.empty() && host.back() == '.') host.pop_back();
  if (host.empty() || host.size() > 253) return \"\";" \
  "  if (host.empty() || host.size() > 253) return \"\";" \
  G03

echo "[classifier] mutations: $MUT_CAUGHT of $MUT_TOTAL caught by their named case"
if [ "$MUT_BAD" -ne 0 ] || [ "$MUT_CAUGHT" -ne "$MUT_TOTAL" ] || [ "$MUT_TOTAL" -lt 10 ]; then
  echo "[classifier] PHASE 2 FAILED — $MUT_BAD mutation(s) not demonstrated RED."
  exit 1
fi
echo "[classifier] phase 2 (RED proof) PASSED — all $MUT_TOTAL guards are observable"
echo
echo "[classifier] SOURCE CLASSIFIER GATE PASSED"
exit 0
