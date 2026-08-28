#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# tkoffset_ledger_gate.sh — regression gate on the OCCT link ledger of a built
# .node. Fails if the closure grows, if a NEW phantom appears, or if TKOffset's
# symbol count goes UP.
#
# WHY THIS EXISTS. Adding a native engine can quietly make the ledger WORSE, and
# neither the compiler nor the A/B suites can see it. MEASURED 2026-08-28: wiring
# the family-E circle path (BRepPrimAPI_MakeCylinder / MakeHalfSpace) added TKPrim
# as a CALLED-BUT-UNLINKED library, taking the DEFAULT build from OCCT_PHANTOM 2 to
# 3 — invisible on macOS because the addon links `-undefined dynamic_lookup`, and a
# hard link failure on the Linux strict-link CI. It was caught only by re-running
# the closure count on the default build. This gate makes that check cheap enough
# to run every time.
#
# The ceilings are the MEASURED state of the tree, not aspirations:
#   OCCT_CLOSURE <= 14   the ledger number; falls only when a library stops loading
#   OCCT_PHANTOM <= 2    TKBO and TKG2d, both pre-existing
#   TKOffset     <= 42   the default build; a drop build is far lower
# Lower them as the programme moves; never raise one to make a build pass.
#
# usage:
#   bash forge-kernel/scripts/tkoffset_ledger_gate.sh BINARY
#        [--max-closure N] [--max-phantom N] [--max-tkoffset N]
#
# exit: 0 every ceiling held / 1 a ceiling was exceeded / 2 binary or tools missing.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COUNT="$ROOT/forge-kernel/scripts/occt_closure_count.sh"
OCCT_LIB="${OCCT_LIB_DIR:-/opt/homebrew/opt/opencascade/lib}"

BIN=""; MAX_CLOSURE=14; MAX_PHANTOM=2; MAX_TKOFFSET=42
while [ $# -gt 0 ]; do
  case "$1" in
    --max-closure)  MAX_CLOSURE="${2:?}"; shift ;;
    --max-phantom)  MAX_PHANTOM="${2:?}"; shift ;;
    --max-tkoffset) MAX_TKOFFSET="${2:?}"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  BIN="$1" ;;
  esac
  shift
done
[ -n "$BIN" ] || { echo "FATAL: BINARY required" >&2; exit 2; }
[ -f "$BIN" ] || { echo "FATAL: not found: $BIN" >&2; exit 2; }
[ -f "$COUNT" ] || { echo "FATAL: occt_closure_count.sh not found" >&2; exit 2; }

JSON="$("$COUNT" "$BIN" --json)" || { echo "FATAL: closure count failed" >&2; exit 2; }
# The JSON is emitted by occt_closure_count.sh with fixed keys; parse without jq so
# the gate has no dependency the kernel build does not already have.
get() { printf '%s' "$JSON" | sed -n "s/.*\"$1\":\([0-9]*\).*/\1/p"; }
CLOSURE="$(get closure)"; PHANTOM="$(get phantom)"; DIRECT="$(get direct)"
[ -n "$CLOSURE" ] && [ -n "$PHANTOM" ] || { echo "FATAL: could not parse closure JSON" >&2; exit 2; }

TKO=0
if [ -f "$OCCT_LIB/libTKOffset.7.9.dylib" ]; then
  nm -gU "$OCCT_LIB"/libTKOffset.*.dylib 2>/dev/null \
    | awk 'NF>=3{print $3} NF==2{print $2}' | sort -u > "${TMPDIR:-/tmp}/.tko.exp.$$"
  nm -u "$BIN" 2>/dev/null | sed 's/^ *//' | sort -u > "${TMPDIR:-/tmp}/.tko.und.$$"
  TKO=$(comm -12 "${TMPDIR:-/tmp}/.tko.und.$$" "${TMPDIR:-/tmp}/.tko.exp.$$" | grep -c .)
  rm -f "${TMPDIR:-/tmp}/.tko.exp.$$" "${TMPDIR:-/tmp}/.tko.und.$$"
fi

echo "== TKOffset ledger gate: $(basename "$BIN") =="
printf '  OCCT_DIRECT   = %-4s\n' "$DIRECT"
printf '  OCCT_CLOSURE  = %-4s (ceiling %s)\n' "$CLOSURE"  "$MAX_CLOSURE"
printf '  OCCT_PHANTOM  = %-4s (ceiling %s)\n' "$PHANTOM"  "$MAX_PHANTOM"
printf '  TKOffset syms = %-4s (ceiling %s)\n' "$TKO"      "$MAX_TKOFFSET"

RC=0
if [ "$CLOSURE" -gt "$MAX_CLOSURE" ]; then
  echo "FAIL: OCCT_CLOSURE $CLOSURE exceeds ceiling $MAX_CLOSURE" >&2; RC=1
fi
if [ "$PHANTOM" -gt "$MAX_PHANTOM" ]; then
  echo "FAIL: OCCT_PHANTOM $PHANTOM exceeds ceiling $MAX_PHANTOM — a library is CALLED" >&2
  echo "      with no link record. Name it on the link line (OCCT_LIBS in CMakeLists)." >&2
  RC=1
fi
if [ "$TKO" -gt "$MAX_TKOFFSET" ]; then
  echo "FAIL: TKOffset symbols $TKO exceeds ceiling $MAX_TKOFFSET" >&2; RC=1
fi
[ $RC -eq 0 ] && echo "  PASS — every ceiling held"
exit $RC
