#!/usr/bin/env bash
# ============================================================================
# drift_gate_test.sh — proves `forge_deps.py verify` actually DETECTS drift.
#
# A verify that only ever prints OK is worthless. Each case below perturbs one
# thing and asserts verify fails with the specific finding, then restores it.
# The baseline case asserts verify passes, so the suite cannot pass by failing
# everything.
# ============================================================================
set -u

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEPS="python3 $REPO/tools/deps/forge_deps.py"
PLANEGCS="$REPO/forge-kernel/3rdParty/planegcs/GCS.cpp"
BACKUP="$(mktemp "${TMPDIR:-/tmp}/GCS.cpp.orig.XXXXXX")"
# Populate the backup IMMEDIATELY. mktemp creates a ZERO-BYTE file, and restore()'s `[ -f ]` guard
# cannot tell that placeholder from a real backup — so before this line existed, any exit between
# mktemp and the `cp` further down (a failed `brew --prefix`, a missing prefix, ^C) fired the EXIT
# trap and copied an EMPTY file over the vendored GCS.cpp, truncating real source to zero bytes.
cp "$PLANEGCS" "$BACKUP"
BACKUP_VALID=1
PASS=0
FAIL=0

restore() {
  # Restore only from a backup we KNOW holds the original bytes. Existence is not validity.
  if [ "${BACKUP_VALID:-0}" = "1" ] && [ -s "$BACKUP" ]; then
    cp "$BACKUP" "$PLANEGCS"
  elif [ -f "$BACKUP" ]; then
    echo "[drift-gate] REFUSING to restore: backup is empty or unverified — leaving $PLANEGCS untouched" >&2
  fi
  rm -f "$BACKUP"
}
trap restore EXIT

# $1 name, $2 expect(pass|fail), $3 needle, rest: env assignments
run_case() {
  local name="$1" expect="$2" needle="$3"; shift 3
  local out rc
  out="$(env "$@" $DEPS verify --quiet 2>&1)"
  rc=$?
  local verdict="FAIL"
  if [ "$expect" = "fail" ]; then
    [ $rc -ne 0 ] && printf '%s' "$out" | grep -qF "$needle" && verdict="PASS"
  else
    [ $rc -eq 0 ] && printf '%s' "$out" | grep -qF "$needle" && verdict="PASS"
  fi
  if [ "$verdict" = "PASS" ]; then
    PASS=$((PASS + 1)); echo "  PASS  $name (verify rc=$rc, matched: $needle)"
  else
    FAIL=$((FAIL + 1)); echo "  FAIL  $name (expected $expect, rc=$rc)"
    printf '%s\n' "$out" | tail -12
  fi
}

NM="FORGE_NODE_MODULES=${FORGE_NODE_MODULES:-$REPO/../../../node_modules}"

echo "drift_gate_test: repo=$REPO"
echo

# 0. Baseline — the plane as committed must verify clean.
run_case baseline pass "deps verify: OK" "$NM"

# 1. CONTENT drift: build a prefix that has every anchor file but one byte of
#    difference, so the failure is a genuine hash mismatch and not just a
#    missing file. This is the case that proves the fingerprint is a real check.
FAKE="$(mktemp -d "${TMPDIR:-/tmp}/forge-fake-boost.XXXXXX")"
REAL_BOOST="$(brew --prefix boost 2>/dev/null || echo /opt/homebrew/opt/boost)"
mkdir -p "$FAKE/include/boost/graph" "$FAKE/include/boost/math/constants"
cp "$REAL_BOOST/include/boost/version.hpp"                       "$FAKE/include/boost/"
cp "$REAL_BOOST/include/boost/graph/adjacency_list.hpp"          "$FAKE/include/boost/graph/"
cp "$REAL_BOOST/include/boost/graph/connected_components.hpp"    "$FAKE/include/boost/graph/"
cp "$REAL_BOOST/include/boost/math/constants/constants.hpp"      "$FAKE/include/boost/math/constants/"
printf '\n// one byte of drift\n' >> "$FAKE/include/boost/graph/adjacency_list.hpp"
run_case content_drift fail "installed_anchor_sha256 DRIFT" \
  "$NM" "FORGE_DEPS_PREFIX_BOOST=$FAKE"
rm -rf "$FAKE"

# 2. Wrong prefix entirely: the anchor globs match nothing. Without the
#    empty-set guard this would hash to sha256("") and could never fail.
run_case wrong_prefix fail "an empty glob set would otherwise fingerprint" \
  "$NM" "FORGE_DEPS_PREFIX_BOOST=/opt/homebrew/opt/opencascade"

# 3. Missing prefix: an unresolvable dependency is drift, not a silent skip.
run_case missing_prefix fail "installed_anchor_sha256 could not be computed" \
  "$NM" "FORGE_DEPS_PREFIX_BOOST=/nonexistent/forge/prefix"

# 4. Patch drift: revert one of the recorded Forge edits in the vendored planegcs
#    source and confirm the patch contract catches it.
# (backup already taken at startup; this re-take is a no-op kept for clarity)
cp "$PLANEGCS" "$BACKUP"
python3 - "$PLANEGCS" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
t = p.read_text()
assert '#include "forge_planegcs_stub.h"' in t, "fixture precondition failed"
p.write_text(t.replace('#include "forge_planegcs_stub.h"',
                       '#include <Base/Console.h>', 1))
PY
run_case patch_drift fail "PATCH DRIFT" "$NM"
restore

# 5. After restoring, the baseline must pass again — proves case 4 perturbed the
#    tree rather than breaking the tool.
run_case restored pass "deps verify: OK" "$NM"

echo
echo "drift_gate_test: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
