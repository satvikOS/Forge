#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# curve_kind_rtti_gate.sh — the binding check for T-146, by NAME.
#
# Doc 11 §4.2 prohibits a native engine reaching for OCCT as its normal internal
# path. NativeLoftPipe classified every edge curve through OCCT RTTI
# (`c->IsKind(STANDARD_TYPE(Geom_X))` under a Geom_TrimmedCurve unwrap loop) and
# was the ONLY owner of six `Geom_*::get_type_descriptor()` symbols; removing the
# last IsKind call in forge-kernel/src took `Standard_Transient::IsKind` with it.
# MEASURED on forge-kernel.node: OCCT_SYMBOLS 539 -> 532.
#
# WHY THIS EXISTS BESIDE THE RATCHET. The ledger ratchet asserts a TOTAL, so it
# goes green on any seven symbols and cannot say which. Worse, a total is silent
# about the thing actually forbidden here: a re-added `STANDARD_TYPE(Geom_Circle)`
# that displaces seven symbols elsewhere keeps the ceiling and reinstates the
# violation. This gate names the seven and checks the WHOLE LIBRARY, which is
# also what stops the fix being faked by moving the RTTI to another translation
# unit -- an undefined symbol is a property of the link, not of a file.
#
# THE ARTIFACT IS ALWAYS EXPLICIT. occt_closure_count.sh resolves its binary by a
# fallback search, and this session watched that silently measure
# libforge_kernel_core.dylib when it was handed a path that did not exist -- the
# "stale-artifact trap" that script's own header records. So this gate takes the
# binary as argument 1 and REFUSES to guess.
#
# usage: curve_kind_rtti_gate.sh <binary> [--expect-present]
#   default          exit 0 iff none of the named symbols is undefined
#   --expect-present exit 0 iff ALL SIX Geom_* descriptors ARE undefined; this is
#                    the self-test direction, used to prove the gate can fail at
#                    all. A gate never seen to fire is indistinguishable from one
#                    that cannot.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BIN="${1:-}"
MODE="${2:-}"
if [ -z "$BIN" ]; then
  echo "FATAL: no binary given. usage: $0 <binary> [--expect-present]" >&2
  exit 2
fi
if [ ! -f "$BIN" ]; then
  # Not "assume the default": a gate that cannot find its subject must FAIL, not
  # silently measure a different one.
  echo "FATAL: artifact not found: $BIN" >&2
  exit 2
fi
if ! command -v c++filt >/dev/null 2>&1; then
  echo "FATAL: c++filt not on PATH; the census cannot run and must not report PASS" >&2
  exit 2
fi

# The six curve descriptors, plus the IsKind entry point they were read through.
DESCRIPTORS='Geom_(Line|Circle|Ellipse|BezierCurve|BSplineCurve|TrimmedCurve)::get_type_descriptor'
ISKIND='Standard_Transient::IsKind'

UNDEF="$(nm -u "$BIN" 2>/dev/null | c++filt)"
if [ -z "$UNDEF" ]; then
  echo "FATAL: nm -u produced no output for $BIN — cannot certify absence" >&2
  exit 2
fi

FOUND_DESC="$(printf '%s\n' "$UNDEF" | grep -E "$DESCRIPTORS" | sort || true)"
FOUND_ISKIND="$(printf '%s\n' "$UNDEF" | grep -F "$ISKIND" | sort || true)"
N_DESC="$(printf '%s' "$FOUND_DESC" | grep -c . || true)"
N_ISKIND="$(printf '%s' "$FOUND_ISKIND" | grep -c . || true)"

echo "== curve-kind RTTI gate: $(basename "$BIN") =="
echo "  Geom_* get_type_descriptor undefined : $N_DESC  (required: 0)"
echo "  Standard_Transient::IsKind undefined : $N_ISKIND  (required: 0)"

if [ "$MODE" = "--expect-present" ]; then
  if [ "$N_DESC" -eq 6 ]; then
    echo "  SELF-TEST ok — the six descriptors are present on this artifact,"
    echo "  so the default direction of this gate is capable of failing."
    exit 0
  fi
  echo "  SELF-TEST FAILED: expected 6 descriptors, saw $N_DESC" >&2
  exit 1
fi

if [ "$N_DESC" -ne 0 ] || [ "$N_ISKIND" -ne 0 ]; then
  echo
  echo "FAIL: OCCT curve RTTI is back on the link line." >&2
  [ -n "$FOUND_DESC" ]   && printf '%s\n' "$FOUND_DESC"   | sed 's/^/  /' >&2
  [ -n "$FOUND_ISKIND" ] && printf '%s\n' "$FOUND_ISKIND" | sed 's/^/  /' >&2
  echo >&2
  echo "Classify edge curves with BRepAdaptor_Curve(edge).GetType() against the" >&2
  echo "GeomAbs_* enum constants instead; enum constants are not symbols. Keep the" >&2
  echo "BRep_Tool::Curve(e,f,l).IsNull() guard in front of the adaptor — without it" >&2
  echo "a pcurve-only edge is classified rather than declined (test/curve_kind_ab" >&2
  echo "_probe.cpp carries that control). Moving the RTTI to another translation" >&2
  echo "unit does NOT satisfy this gate: it reads the whole library." >&2
  exit 1
fi

echo "  PASS — no OCCT curve RTTI anywhere in this library"
exit 0
