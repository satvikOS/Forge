#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ir_parse_parity.sh — T-132: every EXISTING program parses exactly as it did.
#
# Builds ir_parse_fingerprint.cpp twice, kernel-free (the same unresolved-symbol
# arrangement as build_op_record_gate.sh): once against the forge::ft parser at
# BASE_REF (the tree before the op-record change), once against the working
# tree. Runs both over the same corpora and requires the two outputs to be
# byte-identical: same programs, same outcome class, same digest of every tree
# field (or of every refusal's kind, line, offending text, message and
# checkpoint).
#
# Corpora: every tracked *.ir and the programs of ui/test/differential_corpus.hpp
# in THIS repo, plus any JSON / JSONL files named in $IR_CORPUS (colon-separated) -- e.g. an export of
# every IR program tracked in archdisc-Models.
#
#   BASE_REF=<commit> [IR_CORPUS=a.jsonl:b.jsonl] bash run_ir_parse_parity.sh
#
# BASE_REF defaults to HEAD~1 (the parent of the op-record commit when run on
# it). Exit 0 iff the outputs are identical and at least one program was read.
# Exit 1 on any difference (the first ones are shown), 2 on a setup failure.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 2
KERNEL="$(cd "$HERE/../.." && pwd)" || exit 2
REPO="$(cd "$KERNEL/.." && pwd)" || exit 2
[ -n "$REPO" ] || { echo "[parse-parity] repo root resolved to the empty string"; exit 2; }
OUT="${OUT:-$KERNEL/test/ft/build-parity}"   # build-*/ is gitignored
BASE_REF="${BASE_REF:-HEAD~1}"
BASE_SHA="$(git -C "$REPO" rev-parse --verify "$BASE_REF^{commit}" 2>/dev/null)" || {
  echo "[parse-parity] BASE_REF '$BASE_REF' is not a commit"; exit 2; }
rm -rf "$OUT" && mkdir -p "$OUT/base" || exit 2

if [ -z "${OCCT_INC:-}" ]; then
  for _c in /opt/homebrew/include/opencascade /opt/homebrew/opt/opencascade/include/opencascade \
            /usr/local/opt/opencascade/include/opencascade /usr/include/opencascade \
            /usr/local/include/opencascade ; do
    [ -d "$_c" ] && { OCCT_INC="$_c"; break; }
  done
fi
[ -n "${OCCT_INC:-}" ] && [ -d "$OCCT_INC" ] || { echo "OCCT headers not found; set OCCT_INC" >&2; exit 2; }
if [ -z "${OCCT_LIB:-}" ]; then
  for _l in "$(dirname "$OCCT_INC")/../lib" /opt/homebrew/lib /opt/homebrew/opt/opencascade/lib \
            /usr/local/opt/opencascade/lib /usr/lib/x86_64-linux-gnu /usr/local/lib /usr/lib ; do
    for _e in dylib so ; do
      [ -e "$_l/libTKernel.$_e" ] && { OCCT_LIB="$(cd "$_l" && pwd)"; break 2; }
    done
  done
fi
[ -n "${OCCT_LIB:-}" ] || { echo "libTKernel not found; set OCCT_LIB" >&2; exit 2; }

# The BASE parser: forge-kernel/include and src/ft exactly as they were at BASE_REF.
git -C "$REPO" archive "$BASE_SHA" forge-kernel/include forge-kernel/src/ft \
    | tar -x -C "$OUT/base" || { echo "[parse-parity] cannot extract $BASE_SHA"; exit 2; }

CXX="${CXX:-clang++}"
case "$(uname -s)" in
  Darwin) UNDEF=(-Wl,-undefined,dynamic_lookup -Wl,-no_fixup_chains) ;;
  *)      UNDEF=(-Wl,--unresolved-symbols=ignore-all) ;;
esac
build() {   # build <tag> <forge-kernel root holding include/ and src/ft/>
  local tag="$1" root="$2"
  local flags=(-std=c++20 -O1 -Wall -Wextra -Werror -I"$root/include" -I"$OCCT_INC"
               -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")
  "$CXX" "${flags[@]}" -c "$root/src/ft/FeatureTreeCompiler.cpp" -o "$OUT/$tag.ftc.o" || return 1
  "$CXX" "${flags[@]}" -c "$root/src/ft/GraphAudit.cpp" -o "$OUT/$tag.ga.o" || return 1
  "$CXX" "${flags[@]}" -I"$HERE" -c "$HERE/ir_parse_fingerprint.cpp" -o "$OUT/$tag.fp.o" || return 1
  "$CXX" -std=c++20 "$OUT/$tag.fp.o" "$OUT/$tag.ftc.o" "$OUT/$tag.ga.o" -o "$OUT/fp_$tag" \
      -L"$OCCT_LIB" -lTKernel "${UNDEF[@]}" 2>/dev/null ||
  "$CXX" -std=c++20 "$OUT/$tag.fp.o" "$OUT/$tag.ftc.o" "$OUT/$tag.ga.o" -o "$OUT/fp_$tag" \
      -L"$OCCT_LIB" -lTKernel "${UNDEF[@]}"
}
echo "[1/3] build the fingerprint against the parser at $BASE_SHA (before)"
build before "$OUT/base/forge-kernel" || { echo "[parse-parity] base build failed"; exit 2; }
echo "[2/3] build the fingerprint against the working tree (after)"
build after "$KERNEL" || { echo "[parse-parity] working-tree build failed"; exit 2; }

CORPORA=()
while IFS= read -r f; do CORPORA+=("$REPO/$f"); done < <(git -C "$REPO" ls-files '*.ir')
if [ -n "${IR_CORPUS:-}" ]; then
  IFS=':' read -r -a EXTRA <<< "$IR_CORPUS"
  CORPORA+=("${EXTRA[@]}")
fi
# differential_corpus.hpp holds its programs as C string literals, one line per
# statement; join each contiguous run into one program. A C literal's body is a
# JSON string body too (\" \\ \n mean the same in both), so it is wrapped as-is.
DIFF_JSON="$OUT/differential_corpus.json"
awk '
  function flush() { if (cur != "") { printf "\"%s\"\n", cur; cur = "" } }
  /^[ \t]*"%[-0-9]+ = .*\\n"/ { s = $0; sub(/^[ \t]*"/, "", s); sub(/\\n"[^"]*$/, "", s);
                                cur = cur s "\\n"; next }
  { flush() }
  END { flush() }' "$REPO/ui/test/differential_corpus.hpp" > "$DIFF_JSON" || exit 2
[ -s "$DIFF_JSON" ] || { echo "[parse-parity] no program read from differential_corpus.hpp"; exit 2; }
CORPORA+=("$DIFF_JSON")

echo "[3/3] fingerprint ${#CORPORA[@]} corpus files with both parsers"
for f in "${CORPORA[@]}"; do [ -r "$f" ] || { echo "[parse-parity] cannot read $f"; exit 2; }; done
"$OUT/fp_before" "${CORPORA[@]}" > "$OUT/before.txt" 2> "$OUT/before.err" || {
  cat "$OUT/before.err"; exit 2; }
"$OUT/fp_after" "${CORPORA[@]}" > "$OUT/after.txt" 2> "$OUT/after.err" || {
  cat "$OUT/after.err"; exit 2; }
echo "  before: $(cat "$OUT/before.err")"
echo "  after : $(cat "$OUT/after.err")"
N="$(wc -l < "$OUT/before.txt" | tr -d ' ')"
if [ "$N" -lt 1 ]; then echo "[parse-parity] no program was read -- RED"; exit 1; fi
if cmp -s "$OUT/before.txt" "$OUT/after.txt"; then
  echo "[parse-parity] $N programs: before == after, field for field. GREEN"
  exit 0
fi
echo "[parse-parity] DIFFERENCES ($(diff "$OUT/before.txt" "$OUT/after.txt" | grep -c '^>') lines):"
diff "$OUT/before.txt" "$OUT/after.txt" | head -20
exit 1
