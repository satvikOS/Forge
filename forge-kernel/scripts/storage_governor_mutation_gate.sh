#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# storage_governor_mutation_gate.sh — prove the storage safety gate CAN FAIL.
#
# SR-3: "a gate whose failure path cannot produce a non-zero exit is not a gate.
# PROVE your gate can fail by mutating the code under test and showing it goes
# red." A suite of 187 green checks is worth nothing on its own — green is also
# what a vacuous suite prints. This script breaks ONE safety property at a time
# in the real source and requires storage_governor_test to go RED for each.
#
# Every mutation below corresponds to a property s21.3 names:
#   roots ($HOME, /, volume roots, unresolved vars), symlink escape, dirty
#   trees, HOT/lease pinning (forge-kernel/build), quarantine, the two-proof
#   worktree lock rule, the safe direction of pid liveness, authority, the
#   PURGED terminal state, and the tamper-evident receipt + its SHA-256.
#
# It restores the sources afterwards and VERIFIES the restoration byte-for-byte
# (a mutation harness that leaves the tree modified is a hazard, not a gate).
#
# Usage: bash forge-kernel/scripts/storage_governor_mutation_gate.sh
# Exit 0 iff EVERY mutation was caught and the tree was restored.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 1

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
GOV="forge-kernel/src/native/storage/StorageGovernor.cpp"
SHA="forge-kernel/src/native/util/Sha256.cpp"
TST="forge-kernel/test/native/storage/storage_governor_test.cpp"

WORK="$(mktemp -d /tmp/forge_storage_mut.XXXXXX)"
cp "$GOV" "$WORK/GOV.orig"
cp "$SHA" "$WORK/SHA.orig"

restore() { cp "$WORK/GOV.orig" "$GOV"; cp "$WORK/SHA.orig" "$SHA"; }
cleanup() { restore; rm -rf "$WORK"; }
trap cleanup EXIT

echo "[mut] building the UNMUTATED baseline"
$CXX -std=c++20 -O1 -Wall -Wextra -Werror -I "$INC" -c "$TST" -o "$WORK/test.o" || exit 2
$CXX -std=c++20 -O1 -Wall -Wextra -Werror -I "$INC" -c "$GOV" -o "$WORK/gov.o" || exit 2
$CXX -std=c++20 -O1 -Wall -Wextra -Werror -I "$INC" -c "$SHA" -o "$WORK/sha.o" || exit 2
$CXX -std=c++20 -O1 "$WORK/gov.o" "$WORK/sha.o" "$WORK/test.o" -o "$WORK/baseline" || exit 2
if ! "$WORK/baseline" >"$WORK/base.out" 2>&1; then
  echo "[mut] BASELINE IS ALREADY RED — fix the gate before trusting this harness"
  cat "$WORK/base.out"; exit 1
fi
echo "[mut] baseline GREEN: $(grep RESULT "$WORK/base.out")"
echo ""

caught=0; missed=0

run_mut() {   # $1 = description, $2 = python mutation program
  local name="$1" prog="$2"
  restore
  if ! python3 -c "$prog"; then
    echo "  ANCHOR-LOST  $name"
    echo "               the mutation no longer applies; the harness is stale, not the gate"
    missed=$((missed+1)); return
  fi
  if ! $CXX -std=c++20 -O1 -I "$INC" -c "$GOV" -o "$WORK/m_gov.o" 2>"$WORK/e.log"; then
    echo "  NO-COMPILE   $name"; missed=$((missed+1)); return; fi
  if ! $CXX -std=c++20 -O1 -I "$INC" -c "$SHA" -o "$WORK/m_sha.o" 2>"$WORK/e.log"; then
    echo "  NO-COMPILE   $name"; missed=$((missed+1)); return; fi
  rm -f "$WORK/m_test"
  if ! $CXX -std=c++20 -O1 "$WORK/m_gov.o" "$WORK/m_sha.o" "$WORK/test.o" -o "$WORK/m_test" \
        2>"$WORK/link.log"; then
    echo "  NO-LINK      $name  (not a catch)"; missed=$((missed+1)); return; fi

  local out rc
  out="$("$WORK/m_test" 2>&1)"; rc=$?
  # 126/127 mean the binary never executed. Counting that as RED would be the
  # gate "passing" on a harness error — the exact mistake this file exists to
  # rule out. It is a harness fault, never a catch.
  if [ "$rc" -eq 126 ] || [ "$rc" -eq 127 ]; then
    echo "  DID-NOT-RUN  $name (rc=$rc) — harness fault, not a catch"
    missed=$((missed+1)); return
  fi
  if [ "$rc" -ne 0 ]; then
    echo "  RED          $name"
    printf '%s\n' "$out" | grep '\[FAIL\]' | head -2 | sed 's/^/                 /'
    caught=$((caught+1))
  else
    echo "  GREEN        $name   <-- THE GATE DID NOT CATCH THIS"
    missed=$((missed+1))
  fi
}

G="p='$GOV';s=open(p).read();"
S="p='$SHA';s=open(p).read();"
W="open(p,'w').write(s);"

echo "[mut] each mutation below MUST turn the gate red"

# ── managed-root authority ───────────────────────────────────────────────────
run_mut "\$HOME is accepted as a managed root" \
"${G}o='if (!home_.empty() && (canon == home_ || lex == home_))';assert s.count(o)==1,'a';s=s.replace(o,'if (false)');${W}"

run_mut "/ and volume roots are accepted as managed roots" \
"${G}o='if (looksLikeVolumeRoot(lex) || looksLikeVolumeRoot(canon))';assert s.count(o)==1,'a';s=s.replace(o,'if (false)');${W}"

run_mut "unresolved-variable roots (\$VAR, ~) are accepted" \
"${G}o='return RootVerdict::UNRESOLVED_VARIABLE;';assert s.count(o)>=1,'a';s=s.replace(o,'return RootVerdict::OK;');${W}"

run_mut "a symlink escaping a registered root is not rejected" \
"${G}o='return RootVerdict::SYMLINK_ESCAPE;';assert s.count(o)>=1,'a';s=s.replace(o,'return RootVerdict::OK;');${W}"

run_mut "paths outside every managed root are no longer refused" \
"${G}o='reason = \"outside every registered managed root — no deletion authority\";';assert s.count(o)==1,'a';s=s.replace(o,'reason = \"x\"; if(false)');${W}"

# ── the pinning rules ────────────────────────────────────────────────────────
run_mut "a DIRTY working tree no longer pins" \
"${G}o='if (a.dirty == Tri::YES) {';assert s.count(o)==1,'a';s=s.replace(o,'if (false) {');${W}"

run_mut "HOT no longer pins (forge-kernel/build becomes a candidate)" \
"${G}o='if (a.state == State::HOT) {';assert s.count(o)==1,'a';s=s.replace(o,'if (false) {');${W}"

run_mut "an open LEASE no longer pins" \
"${G}o='if (a.lease.held) {';assert s.count(o)==1,'a';s=s.replace(o,'if (false) {');${W}"

run_mut "QUARANTINED no longer pins" \
"${G}o='if (a.state == State::QUARANTINED) {';assert s.count(o)==1,'a';s=s.replace(o,'if (false) {');${W}"

run_mut "PURGED stops being terminal" \
"${G}o='bool isTerminal(State s) { return s == State::PURGED; }';assert s.count(o)==1,'a';s=s.replace(o,'bool isTerminal(State s) { (void)s; return false; }');${W}"

# ── the worktree two-proof lock rule ─────────────────────────────────────────
run_mut "a LIVE lock holder is treated as stale (live-locked record reclaimable)" \
"${G}o='const int alive = lockHolderLiveness(lockReason);';assert s.count(o)==1,'a';s=s.replace(o,'const int alive = 0;');${W}"

run_mut "pid liveness answers in the UNSAFE direction (EPERM read as gone)" \
"${G}o='return (errno == ESRCH) ? 0 : 1;';assert s.count(o)==1,'a';s=s.replace(o,'return 0;');${W}"

# The EMPTY lock: `git worktree lock` with no --reason writes a ZERO-BYTE file, so
# guarding the lock rule on the reason TEXT reads a locked record as unlocked. This
# mutation restores exactly that guard and the gate must go red.
run_mut "an EMPTY git lock file is read as UNLOCKED (guarding on the text, not the file)" \
"${G}o='        if (lockPresent) {\n            // git says LOCKED but the checkout is gone.';assert s.count(o)==1,'a';s=s.replace(o,'        if (!lockReason.empty()) {\n            // git says LOCKED but the checkout is gone.');${W}"

run_mut "a lock naming no pid is assumed dead instead of QUARANTINED" \
"${G}o='const std::string tag = \"(pid \";';assert s.count(o)==1,'a';s=s.replace(o,'const std::string tag = \"(PIDPID \";');${W}"

# ── the tamper-evident receipt ───────────────────────────────────────────────
run_mut "the receipt digests a CONSTANT instead of the plan" \
"${G}o='r.planSha256      = ::forge::native::util::sha256Hex(planJson);';assert s.count(o)==1,'a';s=s.replace(o,'r.planSha256 = ::forge::native::util::sha256Hex(\"constant\");');${W}"

run_mut "verifyReceipt always returns true" \
"${G}o='    why.clear();';assert s.count(o)==1,'a';s=s.replace(o,'    why.clear(); if(true) return true;');${W}"

run_mut "the receipt self-digest check is skipped (receipt body editable)" \
"${G}o='    if (declaredSelf != actualSelf) {';assert s.count(o)==1,'a';s=s.replace(o,'    if (false) {');${W}"

run_mut "the plan-vs-receipt digest check is skipped" \
"${G}o='    if (declaredPlan != actualPlan) {';assert s.count(o)==1,'a';s=s.replace(o,'    if (false) {');${W}"

run_mut "a receipt claiming deletions is accepted" \
"${G}o='    if (deletes != \"0\") {';assert s.count(o)==1,'a';s=s.replace(o,'    if (false) {');${W}"

run_mut "a receipt with NO digest line is trusted (fails open)" \
"${G}o='        why = \"receipt has no receipt_sha256 line — cannot be verified, so it is REFUSED\";\n        return false;';assert s.count(o)==1,'a';s=s.replace(o,'        return true;');${W}"

run_mut "SHA-256 is broken (one round constant altered)" \
"${S}o='0x428a2f98u';assert s.count(o)==1,'a';s=s.replace(o,'0x428a2f99u');${W}"

run_mut "SHA-256 length padding dropped (length-extension)" \
"${S}o='        for (int i = 7; i >= 0; --i)';assert s.count(o)==1,'a';s=s.replace(o,'        for (int i = 7; i >= 8; --i)');${W}"

# ── restoration must be byte-exact ───────────────────────────────────────────
restore
echo ""
if ! cmp -s "$WORK/GOV.orig" "$GOV" || ! cmp -s "$WORK/SHA.orig" "$SHA"; then
  echo "[mut] FATAL: sources were NOT restored byte-for-byte"; exit 1
fi
echo "[mut] sources restored byte-for-byte"
echo "[mut] mutations caught: $caught   MISSED: $missed"
if [ "$missed" -ne 0 ]; then
  echo "[mut] RESULT: FAIL — $missed mutation(s) slipped past the gate"
  exit 1
fi
echo "[mut] RESULT: PASS — every safety property has a mutation that turns the gate red"
