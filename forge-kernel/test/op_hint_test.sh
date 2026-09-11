#!/bin/bash
# op_hint_test.sh — an unknown op must name the real one it nearly is.
#
# WHY
# ---
# MEASURED on the 2026-09-10 sweep (reports/sweep_20260910T220154): of 13 invented
# ops emitted by archie-30b-astra-v1, TWELVE are near misses of real ops and only one
# (HINGE) is a true hallucination. The model has the concept and the wrong surface
# form:
#
#   CYLINDER -> CYL          RESIZE -> RESIZEBORE       FILL  -> FILLET
#   SCALE    -> SCALEUNIFORM OFFSET -> OFFSETSOLID      RESIZEFEATURE -> RESIZEBORE
#
# The hint existed but only matched ONE direction -- a real op appearing INSIDE the
# invented name -- so it fired for CYLINDER and missed the other seven occurrences,
# where the invented name is the shorter plain-English stem. It was also a
# hand-written duplicate of the op table that had DRIFTED: SCALEUNIFORM and
# OFFSETSOLID are real ops and were absent from it.
#
# NO ALIASING. The kernel still REFUSES the tree. A table that silently mapped RESIZE
# to RESIZEBORE would build the wrong geometry and pass -- the worst outcome. This
# only improves the repair instruction handed back.
set -uo pipefail
K="$(cd "$(dirname "$0")/.." && pwd)"
V="${FORGE_VERIFY:-$K/build/forge_verify}"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad(){ FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

if [[ ! -x "$V" ]]; then
  echo "  SKIP-BLOCKED: no forge_verify at $V (build forge_kernel_core first)"
  exit 2
fi

err_for() {  # err_for <OPNAME> -> the kernel's error string
  printf '{"id":"h","ir":"%%0 = %s(1,1,1)\\nRESULT(%%0)"}\n' "$1" \
    | "$V" 2>/dev/null | head -1 \
    | python3 -c 'import json,sys
try: print(json.loads(sys.stdin.read()).get("error",""))
except Exception: print("")'
}

want_hint() {  # want_hint <OP> <EXPECTED-REAL-OP>
  local e; e="$(err_for "$1")"
  if [[ "$e" != *"unknown op"* ]]; then
    bad "$1 was not reported as an unknown op at all ($e)"; return
  fi
  if [[ "$e" == *"$2"* ]]; then ok "$1 -> names \`$2\`"
  else bad "$1 -> no mention of \`$2\`: $e"; fi
}

echo "== a near miss names the real op =="
want_hint CYLINDER       CYL
want_hint RESIZE         RESIZEBORE
want_hint FILL           FILLET
want_hint SCALE          SCALEUNIFORM     # absent from the old hand-written list
want_hint OFFSET         OFFSETSOLID      # absent from the old hand-written list
want_hint RESIZEFEATURE  RESIZEBORE       # neither contains the other; shared prefix

echo ""
echo "== a single match reads as a RENAME, not a composition =="
E="$(err_for CYLINDER)"
[[ "$E" == *"did you mean"* ]] && ok "CYLINDER says 'did you mean'" \
  || bad "CYLINDER still says compose: $E"

echo ""
echo "== REGRESSION: a genuine composite keeps the composition wording =="
E="$(err_for HOLEPATTERN)"
[[ "$E" == *"HOLE"* && "$E" == *"PATTERN"* ]] \
  && ok "HOLEPATTERN still names both constituents" \
  || bad "HOLEPATTERN lost its hint: $E"
[[ "$E" == *"compose them"* ]] && ok "  and still says compose them" \
  || bad "  but no longer says compose them: $E"

echo ""
echo "== NO FALSE SUGGESTIONS =="
# A guard that suggests something for everything is not a guard.
E="$(err_for HINGE)"
[[ "$E" == *"unknown op"* ]] && ok "HINGE is still refused" || bad "HINGE was accepted"
[[ "$E" == *"did you mean"* || "$E" == *"spells this with"* ]] \
  && bad "HINGE got a hint it does not deserve: $E" \
  || ok "  and gets NO hint — it is a true hallucination"

echo ""
echo "== POSITIVE CONTROL: a real op is not reported unknown =="
E="$(err_for CYL)"
[[ "$E" == *"unknown op"* ]] && bad "CYL, a real op, was reported unknown: $E" \
  || ok "CYL is accepted as a real op"

echo ""
echo "[op-hint] $((PASS+FAIL)) checks, $FAIL failures"
[[ "$FAIL" -eq 0 ]] || exit 1
