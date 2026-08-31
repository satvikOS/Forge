#!/usr/bin/env bash
# ============================================================================
# drift_gate_selfcheck.sh — gates drift_gate_test.sh.
#
# drift_gate_test.sh proves `forge_deps.py verify` detects drift. Nothing proved
# that drift_gate_test.sh itself fails when it should. Both cases below were real
# and both were SILENT:
#
#   A  With all four boost headers missing, the four unchecked `cp`s failed, the
#      perturbing `printf >>` CREATED the only file in the fixture, that one file
#      became the whole anchor set, its digest differed from the lock, and
#      content_drift reported PASS. MEASURED before the fix: "6 passed, 0 failed",
#      exit 0, proving nothing about a one-byte change to a real header.
#
#   B  The EXIT trap reported a perturbed tracked source instead of restoring it,
#      while the file's own comment called the trap the safety net. Any exit
#      between a case's perturbation and its restore left GCS.cpp modified.
#
# Case B runs the REAL cleanup() and restore() extracted from the gate, against a
# fixture, so it never touches the vendored source.
# ============================================================================
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)" || {
  echo "[selfcheck] cannot resolve the repo root"; exit 1; }
[ -n "$REPO" ] || { echo "[selfcheck] repo root resolved to the empty string"; exit 1; }
cd "$REPO" || { echo "[selfcheck] cannot enter repo root $REPO"; exit 1; }

TARGET="tools/deps/tests/drift_gate_test.sh"
PASS=0
FAIL=0
T="$(mktemp -d "${TMPDIR:-/tmp}/forge_drift_selfcheck.XXXXXX")"
cleanup_self() {
  rm -rf "$T"
  if [ -d "$T" ]; then echo "[selfcheck] WARNING: kept $T -- rm -rf did not remove it" >&2; fi
}
trap cleanup_self EXIT

ok()  { PASS=$((PASS + 1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }

# ── A. a fixture the case cannot build must FAIL the case, not pass it ───────
# FORGE_DRIFT_REAL_BOOST poisons the source of the four anchor headers. The gate
# must report the fixture precondition and must NOT report content_drift PASS.
aout="$(FORGE_DRIFT_REAL_BOOST=/nonexistent/boost/prefix \
        FORGE_NODE_MODULES="${FORGE_NODE_MODULES:-$REPO/node_modules}" \
        bash "$TARGET" 2>&1)" && arc=0 || arc=$?
if [ "$arc" -eq 0 ]; then
  bad "A: an unbuildable content_drift fixture still exited 0"
elif printf '%s' "$aout" | grep -q "PASS  content_drift"; then
  bad "A: content_drift reported PASS with no real header to mismatch against"
elif ! printf '%s' "$aout" | grep -q "content_drift FIXTURE"; then
  bad "A: the gate failed but never named the fixture precondition: $(printf '%s' "$aout" | tail -2)"
else
  ok "A: an unbuildable content_drift fixture fails the case by name (rc=$arc)"
fi
# The tracked source must be back after that run — case A exercised the real gate.
if git -C "$REPO" diff --quiet -- forge-kernel/3rdParty/planegcs/GCS.cpp; then
  ok "A2: the poisoned run left the vendored GCS.cpp unmodified"
else
  bad "A2: the poisoned run left forge-kernel/3rdParty/planegcs/GCS.cpp MODIFIED"
fi

# ── B. the EXIT trap must RESTORE, not just report ───────────────────────────
RESTORE_FN="$(sed -n '/^restore() {/,/^}/p' "$TARGET")"
CLEAN_FN="$(sed -n '/^cleanup() {/,/^}/p' "$TARGET")"
if [ -z "$RESTORE_FN" ] || [ -z "$CLEAN_FN" ]; then
  bad "B: could not extract restore()/cleanup() from $TARGET"
else
  printf 'original bytes\n' > "$T/tracked.cpp"
  cp "$T/tracked.cpp" "$T/backup"
  printf 'PERTURBED\n' > "$T/tracked.cpp"        # as a case leaves it mid-run
  bout="$(
    PLANEGCS="$T/tracked.cpp"
    BACKUP="$T/backup"
    BACKUP_VALID=1
    RESTORE_FAILED=0
    sha_of() { shasum -a 256 < "$1" | awk '{print $1}'; }
    eval "$RESTORE_FN"
    eval "$CLEAN_FN"
    cleanup
  )" 2>&1
  if [ "$(cat "$T/tracked.cpp")" = "original bytes" ]; then
    ok "B: the EXIT trap restored the perturbed source instead of only reporting it"
  else
    bad "B: the EXIT trap left the source perturbed [$(cat "$T/tracked.cpp")] out=[$bout]"
  fi
  if [ ! -e "$T/backup" ]; then
    ok "B2: the backup is removed once the original bytes are provably back"
  else
    bad "B2: the backup survived a verified restore"
  fi
fi

echo
echo "[selfcheck] $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
