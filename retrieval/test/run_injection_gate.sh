#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_injection_gate.sh — prove that hostile retrieved text cannot move geometry.
#
#   phase 1  compile every retrieval source warning-free, build and run the
#            injection gate against the hostile fixture corpus
#   phase 2  NEGATIVE COMPILATION. Fourteen snippets that must FAIL to build,
#            plus one positive control that must SUCCEED. This is the strongest
#            form of the claim: the forbidden line is not refused at runtime, it
#            cannot be written.
#   phase 3  re-run the whole gate under the dyld interposer that aborts on any
#            socket()/connect()/getaddrinfo()
#   phase 4  THE RED PROOF. Five independent one-line weakenings are applied to
#            COPIES OF THE REAL SOURCES and the gate is rebuilt against each. A
#            weakening that does not turn the gate RED is a failure of this
#            script, because it would mean the gate cannot detect that defect.
#            A gate that has never been seen failing is not a gate.
#
# Nothing here opens a socket. Exit 0 only if every phase did what it claims.
# Override the compiler with CXX=clang++.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

CXX="${CXX:-clang++}"
FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
INC="-Iretrieval/include"
FIXTURES="$ROOT/retrieval/test/fixtures"
OUT="$(mktemp -d /tmp/forge_injection.XXXXXX)"
trap 'rm -rf "$OUT"' EXIT

SRCS=(
  retrieval/src/Json.cpp
  retrieval/src/Redactor.cpp
  retrieval/src/SearchRequest.cpp
  retrieval/src/EvidenceRecord.cpp
  retrieval/src/EvidenceDigest.cpp
  retrieval/src/PlanValue.cpp
  retrieval/src/HttpTransport.cpp
  retrieval/src/SearxngClient.cpp
)

echo "[injection] compiler: $($CXX --version | head -1)"

# ── phase 1: build and run ───────────────────────────────────────────────────
if ! "$CXX" $FLAGS $INC retrieval/test/injection_gate.cpp "${SRCS[@]}" -o "$OUT/injection_gate"; then
  echo "[injection] BUILD FAILED"
  exit 1
fi
echo "[injection] built $OUT/injection_gate"

"$OUT/injection_gate" "$FIXTURES" > "$OUT/gate.log" 2>&1
rc=$?
# A run that writes nothing DID NOT RUN, whatever it exited with.
if [ ! -s "$OUT/gate.log" ]; then
  echo "[injection] FATAL: the gate wrote an empty log. It did not run." >&2
  exit 1
fi
cat "$OUT/gate.log"
if [ "$rc" -ne 0 ]; then
  echo "[injection] PHASE 1 FAILED (exit $rc)"
  exit "$rc"
fi
# Exit 0 is not enough: the gate must have declared a clean run.
if ! grep -qE '^[0-9]+ passed, 0 failed$' "$OUT/gate.log"; then
  echo "[injection] phase 1 exited 0 without declaring '0 failed'. Refusing to call it a pass."
  exit 1
fi
echo "[injection] phase 1 (hostile corpus) PASSED"

# ── phase 2: negative compilation ────────────────────────────────────────────
# The positive control runs FIRST. If the legitimate path does not build, every
# negative case would "fail to compile" for the wrong reason and this phase would
# report a perfect score while proving nothing.
echo
echo "[injection] phase 2: negative compilation"
if ! "$CXX" $FLAGS $INC -fsyntax-only retrieval/test/negative/positive_control.cpp \
        2> "$OUT/positive.log"; then
  echo "[injection] FATAL: the positive control does not compile. The negative phase" >&2
  echo "[injection] would be vacuous — every case would 'fail' for an unrelated reason." >&2
  cat "$OUT/positive.log" >&2
  exit 1
fi
echo "[injection]   positive control compiles (the legitimate path is buildable)"

neg_total=0
neg_bad=0
for snippet in retrieval/test/negative/n*.cpp; do
  neg_total=$((neg_total + 1))
  name="$(basename "$snippet")"
  if "$CXX" $FLAGS $INC -fsyntax-only "$snippet" > "$OUT/$name.log" 2>&1; then
    echo "[injection]   COMPILED (IT MUST NOT): $name"
    neg_bad=$((neg_bad + 1))
  else
    reason="$(grep -m1 -oE "error: [^\[]{0,78}" "$OUT/$name.log" | head -1)"
    echo "[injection]   refused by the compiler: $name  ${reason:-error}"
  fi
done
if [ "$neg_total" -lt 10 ]; then
  echo "[injection] FATAL: only $neg_total negative snippets were found. Expected the full set." >&2
  exit 1
fi
if [ "$neg_bad" -ne 0 ]; then
  echo "[injection] PHASE 2 FAILED: $neg_bad of $neg_total forbidden snippets compiled."
  exit 1
fi
echo "[injection] phase 2 (negative compilation) PASSED — $neg_total forbidden lines are unwritable"

# ── phase 3: the same gate with the network denied ───────────────────────────
echo
if [ "$(uname -s)" = "Darwin" ]; then
  CC="${CC:-clang}"
  if ! "$CC" -dynamiclib -O1 retrieval/test/net_denied_interpose.c -o "$OUT/net_denied.dylib"; then
    echo "[injection] could not build the network-denial interposer"
    exit 1
  fi
  printf '#include <sys/socket.h>\nint main(){return socket(AF_INET,SOCK_STREAM,0)>=0?0:1;}\n' \
    > "$OUT/probe.c"
  "$CC" -O0 "$OUT/probe.c" -o "$OUT/probe" 2>/dev/null
  DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" "$OUT/probe" 2>/dev/null
  probe_rc=$?
  if [ "$probe_rc" -ne 134 ]; then
    echo "[injection] interposer self-test did NOT abort (exit $probe_rc); phase 3 would prove nothing."
    exit 1
  fi
  echo "[injection]   interposer self-test aborted a real socket() as expected"
  DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" \
    "$OUT/injection_gate" "$FIXTURES" > "$OUT/offline.log" 2>&1
  rc3=$?
  if [ "$rc3" -ne 0 ] || ! grep -qE '^[0-9]+ passed, 0 failed$' "$OUT/offline.log"; then
    echo "[injection] PHASE 3 FAILED (exit $rc3)"
    tail -20 "$OUT/offline.log"
    exit 1
  fi
  echo "[injection] phase 3 (network denied) PASSED — $(grep -oE '^[0-9]+ passed' "$OUT/offline.log")"
else
  if [ "${FORGE_ALLOW_NO_DENIAL_PROOF:-0}" = "1" ]; then
    echo "[injection] phase 3 SKIPPED on $(uname -s): the dyld interposer is macOS-only."
    echo "[injection] FORGE_ALLOW_NO_DENIAL_PROOF=1 was set. THIS RUN DOES NOT PROVE THE"
    echo "[injection] NETWORK-DENIED PROPERTY."
  else
    echo "[injection] FATAL: phase 3 cannot run on $(uname -s). Set FORGE_ALLOW_NO_DENIAL_PROOF=1" >&2
    echo "[injection] to accept phases 1-2 only, explicitly." >&2
    exit 1
  fi
fi

# ── phase 4: the RED proof ───────────────────────────────────────────────────
# Each weakening is applied to a COPY of the real sources, not to a re-implemen-
# tation of them, so what goes RED is the real boundary with one real line
# removed. The patch is verified to have changed bytes: a weakening that silently
# fails to apply would rebuild the UNWEAKENED gate, it would pass, and this phase
# would report "the gate cannot detect this" about a defect that is not there.
echo
echo "[injection] phase 4: RED proof — five weakenings of the real boundary"

red_total=0
red_bad=0

red_case() {
  local label="$1" file="$2" needle="$3" replacement="$4"
  red_total=$((red_total + 1))
  local W="$OUT/weak_$red_total"
  rm -rf "$W"
  mkdir -p "$W"
  cp -R retrieval/include "$W/include"
  cp -R retrieval/src "$W/src"

  if ! python3 - "$W/$file" "$needle" "$replacement" <<'PY'
import io, sys
path, needle, replacement = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(path, encoding="utf-8").read()
if needle not in s:
    sys.stderr.write("weakening did not match: %r\n" % needle)
    sys.exit(3)
out = s.replace(needle, replacement, 1)
if out == s:
    sys.stderr.write("weakening changed no bytes\n")
    sys.exit(3)
io.open(path, "w", encoding="utf-8").write(out)
PY
  then
    echo "[injection]   COULD NOT APPLY weakening '$label' — the source has drifted." >&2
    echo "[injection]   Refusing to report a RED proof that did not happen." >&2
    red_bad=$((red_bad + 1))
    return
  fi

  local wsrcs=()
  local s
  for s in "${SRCS[@]}"; do wsrcs+=("$W/${s#retrieval/}"); done

  if ! "$CXX" -std=c++20 -O1 -w "-I$W/include" retrieval/test/injection_gate.cpp \
         "${wsrcs[@]}" -o "$W/gate" 2> "$W/build.log"; then
    # A weakening that does not build cannot demonstrate a RED gate.
    echo "[injection]   WEAKENED BUILD FAILED for '$label'"
    head -5 "$W/build.log"
    red_bad=$((red_bad + 1))
    return
  fi

  "$W/gate" "$FIXTURES" > "$W/gate.log" 2>&1
  local wrc=$?
  local failed
  failed="$(grep -oE '[0-9]+ failed' "$W/gate.log" | tail -1)"
  if [ "$wrc" -eq 0 ]; then
    echo "[injection]   NOT RED: '$label' — the gate still passed. It cannot detect this defect."
    red_bad=$((red_bad + 1))
  else
    echo "[injection]   RED as required: '$label' -> ${failed:-nonzero exit}"
  fi
}

red_case "the unit check stops reading the page" \
  "src/EvidenceRecord.cpp" \
  'if (std::find(wanted.begin(), wanted.end(), lower_unit) == wanted.end()) continue;' \
  'if (false) continue;  // WEAKENED FOR THE RED PROOF'

red_case "invisible and reordering characters survive display()" \
  "src/EvidenceRecord.cpp" \
  'if (isInvisibleOrReordering(cp)) continue;  // dropped entirely' \
  'if (false) continue;  // WEAKENED FOR THE RED PROOF'

red_case "text arguments are no longer checked for inertness" \
  "src/PlanValue.cpp" \
  "if (c == '\"' || c == '\\'' || c == '<' || c == '>' || c == '\`' || c == '\\\\') {" \
  'if (false) {  // WEAKENED FOR THE RED PROOF'

red_case "the evidence digest stops escaping framing bytes" \
  "src/EvidenceDigest.cpp" \
  "if (c == '<' || c == '[') {" \
  'if (false) {  // WEAKENED FOR THE RED PROOF'

red_case "an approval can be spent on a different candidate" \
  "src/PlanValue.cpp" \
  'if (citationDigest(candidate) != approval.digest()) {' \
  'if (false) {  // WEAKENED FOR THE RED PROOF'

if [ "$red_total" -lt 5 ]; then
  echo "[injection] FATAL: only $red_total RED cases ran." >&2
  exit 1
fi
if [ "$red_bad" -ne 0 ]; then
  echo "[injection] PHASE 4 FAILED: $red_bad of $red_total weakenings did not turn the gate RED."
  exit 1
fi
echo "[injection] phase 4 (RED proof) PASSED — all $red_total weakenings were caught"

# ── phase 5: the escape-hatch budget ─────────────────────────────────────────
# UntrustedText::rawForStorage() is the one documented way to get retrieved bytes
# out as a std::string. It exists on purpose and is named so that every use is
# visible in review — but "visible in review" only means something if somebody
# counts. This pins the count. It may FALL freely; it may not RISE without a
# reviewer deciding it should.
#
# The three sites as of this commit are all bytes -> hash or bytes -> numbers:
#   SearxngClient.cpp:519   content_hash = contentHashHex(url + quoted_span)
#   SearxngClient.cpp:537   scanNumericSpans(...) to read the unit off the page
#   EvidenceRecord.cpp      scanNumericSpans(...) inside validateAsNumericFact
# None of them produces a string that becomes an identifier.
RAW_BUDGET=3

count_raw() {   # count_raw <dir>
  # NOT grep -c: that PRINTS 0 and EXITS 1 on no match, so the usual
  # "|| echo 0" fallback captures the wrong zero. wc always succeeds.
  grep -rho 'rawForStorage' "$1" 2>/dev/null | wc -l | tr -d ' '
}

echo
echo "[injection] phase 5: escape-hatch budget"
# SELF-TEST FIRST: a counter that cannot move is not a ratchet.
SELF="$OUT/raw_selftest"
rm -rf "$SELF"
cp -R retrieval/src "$SELF"
printf 'const char* leak(const UntrustedText& t){return t.rawForStorage().c_str();}\n' \
  >> "$SELF/extra_call_site.cpp"
self_n="$(count_raw "$SELF")"
real_n="$(count_raw retrieval/src)"
if [ "$self_n" -le "$real_n" ]; then
  echo "[injection] FATAL: the counter did not notice an added call site" >&2
  echo "[injection] (copy=$self_n real=$real_n). Refusing to report a budget it cannot enforce." >&2
  exit 1
fi
echo "[injection]   self-test: adding one call site moved the count $real_n -> $self_n"

if [ "$real_n" -gt "$RAW_BUDGET" ]; then
  echo "[injection] PHASE 5 FAILED: rawForStorage() is used $real_n times, budget is $RAW_BUDGET."
  grep -rn 'rawForStorage' retrieval/src | sed 's/^/    /'
  echo "[injection] Every new use puts retrieved bytes into a std::string. If the new one is"
  echo "[injection] right, raise RAW_BUDGET in this script and say in the commit why."
  exit 1
fi
if [ "$real_n" -lt "$RAW_BUDGET" ]; then
  echo "[injection] NOTE: rawForStorage() is now used $real_n times (budget $RAW_BUDGET)."
  echo "[injection] Lower RAW_BUDGET to $real_n so the ratchet keeps its teeth."
fi
echo "[injection] phase 5 (escape-hatch budget) PASSED — $real_n of $RAW_BUDGET used"

echo
echo "[injection] INJECTION GATE PASSED"
exit 0
