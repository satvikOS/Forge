#!/bin/bash
# occt_drop_gate.sh — LOCAL macOS proxy for the Linux strict-link drop gate.
#
# WHY: macOS links the .node with `-undefined dynamic_lookup` (flat namespace), which MASKS
# undefined symbols — a toolkit drop can link + load fine on macOS yet FAIL on Linux strict-link
# (this is exactly what reverted past drops: TKG2d 15->14 passed all macOS gates but broke Linux).
# The Linux CI (.github/workflows/kernel-tests.yml, run_native.sh on ubuntu-latest, ON PUSH) is the
# ultimate gate. This script is the LOCAL pre-flight so a drop is only pushed once it is symbol-safe.
#
# METHOD (the CMakeLists §TKBool methodology, codified): a toolkit TKX is a SAFE drop candidate iff
# every undefined symbol in the .node that TKX exports is ALSO exported by some OTHER still-linked
# toolkit. If TKX has an EXCLUSIVE export that the .node needs, dropping it leaves an undefined
# symbol → Linux strict-link fails. This computes that intersection.
#
# usage: bash scripts/occt_drop_gate.sh <TKX>            e.g. TKDESTEP
#        (run AFTER core 34/34 + Models-OS 13/13 already pass on the candidate build)
# NB: no `set -e` — greps legitimately return 1 (symbol-not-found is expected), which would
# otherwise abort this diagnostic mid-run.
TKX="${1:?usage: occt_drop_gate.sh <ToolkitName e.g. TKDESTEP>}"
NODE="${FORGE_KERNEL:-$(cd "$(dirname "$0")/.." && pwd)/build/Release/forge-kernel.node}"
[ -f "$NODE" ] || { echo "FATAL: .node not found: $NODE"; exit 2; }

# resolve the EXACT lib${TKX} path from the .node's own link list (robust — no dir guessing)
LIBX="$(otool -L "$NODE" | grep -oE "/[^ ]*lib${TKX}\.[0-9.]*dylib" | head -1)"
if [ -z "$LIBX" ] || [ ! -f "$LIBX" ]; then
  # not directly linked (transitive): fall back to the OCCT lib dir of a known-linked toolkit
  OCCT_LIB="$(dirname "$(otool -L "$NODE" | grep -oE "/[^ ]*libTKernel\.[0-9.]*dylib" | head -1)")"
  LIBX="$(ls "$OCCT_LIB"/lib${TKX}.*dylib 2>/dev/null | head -1)"
fi
[ -f "$LIBX" ] || { echo "FATAL: lib${TKX} dylib not resolvable from $NODE link list"; exit 2; }

# 1. symbols the .node still needs (undefined), stripped of the leading _
UNDEF=$(mktemp); nm -u "$NODE" 2>/dev/null | sed 's/^ *//; s/^_//' | sort -u > "$UNDEF"
# 2. symbols TKX EXPORTS (global defined text/data)
XEXP=$(mktemp); nm -gU "$LIBX" 2>/dev/null | awk '{print $3}' | sed 's/^_//' | grep -v '^$' | sort -u > "$XEXP"
# 3. of TKX's exports, which does the .node actually need?
NEEDED_FROM_X=$(comm -12 "$UNDEF" "$XEXP")

# 4. for each needed-from-X symbol, is it ALSO provided by another linked TK lib?
OTHER_LIBS=$(otool -L "$NODE" | grep -oE '/[^ ]*libTK[A-Za-z0-9]+\.dylib' | grep -v "lib${TKX}\.dylib" | sort -u)
EXCLUSIVE=""
if [ -n "$NEEDED_FROM_X" ]; then
  ALLOTHER=$(mktemp)
  for L in $OTHER_LIBS; do nm -gU "$L" 2>/dev/null | awk '{print $3}' | sed 's/^_//'; done | sort -u > "$ALLOTHER"
  while IFS= read -r sym; do
    [ -z "$sym" ] && continue
    grep -qxF "$sym" "$ALLOTHER" || EXCLUSIVE="$EXCLUSIVE$sym"$'\n'
  done <<< "$NEEDED_FROM_X"
  rm -f "$ALLOTHER"
fi

echo "== occt drop-gate: $TKX =="
echo "  .node undefined symbols: $(wc -l < "$UNDEF" | tr -d ' ')"
echo "  $TKX exports needed by .node: $(printf '%s\n' "$NEEDED_FROM_X" | grep -c . || true)"
NX=$(printf '%s' "$EXCLUSIVE" | grep -c . || true)
echo "  ...of those, EXCLUSIVE to $TKX (block the drop): $NX"
rm -f "$UNDEF" "$XEXP"
if [ "$NX" -eq 0 ]; then
  echo "  VERDICT: DROP-SAFE (local) — remove $TKX from OCCT_LIBS, rebuild, re-run core 34/34 + Models-OS 13/13,"
  echo "           then PUSH so the Linux run_native.sh CI confirms (the ultimate gate)."
  exit 0
else
  echo "  VERDICT: NOT SAFE — $TKX exclusively provides these symbols the .node needs:"
  printf '%s' "$EXCLUSIVE" | sed 's/^/    /' | head -20
  echo "  Route those call sites native first, or keep $TKX. (This is what Linux strict-link would red.)"
  exit 1
fi
