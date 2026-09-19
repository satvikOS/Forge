#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# forge_cxx_cache_selftest.sh — ★ PROVE THE COMPILE CACHE CANNOT SERVE A STALE
# OBJECT.
#
# tools/gates/forge_cxx_cache.sh makes four mutation proofs (the prose gate, the
# panel ratchet, the model-tree gate and the desktop crash-isolation gate) reuse
# the objects a mutation did not change. That is the whole speedup and it is also
# the whole risk, because THE FASTEST MUTATION PROOF IS ONE THAT DOES NOT
# REBUILD, and it is worthless: it runs the UNMUTATED binary and passes.
#
# That has happened in this repository. run_step_unit_decline_gate.sh built its
# library in three places and the one call site missing the rebuild was the
# MUTATION ROUND ITSELF; the rewrite set the source mtime to now, landing in the
# same second as the previous build made cmake judge the library current, and the
# unmutated binary ran. The gate passed and printed "mutation stayed GREEN -- the
# gate does not test the defect". It accused itself of being blind, on a
# second-boundary race.
#
# So this file asserts the property directly, in about five seconds, on inputs
# small enough to read. Every case below is a way the cache could be wrong:
#
#   1  a warm rebuild of unchanged sources REUSES (or the cache does nothing)
#   2  editing a .cpp recompiles THAT unit and the binary's behaviour CHANGES
#   3  editing a HEADER recompiles EVERY unit that could see it
#   4  changing a -D recompiles everything (flags are part of the key)
#   5  changing the compile flags cannot resurrect an earlier binary
#   6  a mutation applied and then REVERTED returns the original behaviour
#      (the cache is content-addressed, so going back is a hit, not a miss)
#   7  two sources with IDENTICAL bytes at DIFFERENT paths get different objects
#   8  a rewrite STAMPED OLDER than its own cached object is still seen -- the
#      deterministic, stronger form of the race that defeated the gate above
#
# Exit 0 iff every case passes. Anything else means the cache is not safe to use
# and the four gates above are no longer proving what they claim.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[fcc-selftest] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[fcc-selftest] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[fcc-selftest] cannot enter repo root $ROOT"; exit 1; }
. "$ROOT/tools/gates/forge_cxx_cache.sh"

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[fcc-selftest] no $CXX on PATH"; exit 1; }

W="$(mktemp -d "${TMPDIR:-/tmp}/fcc_selftest.XXXXXX")"
cleanup() {
  rm -rf "$W"
  [ -d "$W" ] && echo "[fcc-selftest] WARNING: kept $W -- rm -rf did not remove it"
}
trap cleanup EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); echo "  PASS  $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; }

# ★ PORTABLE IN-PLACE EDIT. `sed -i ''` is BSD/macOS only: GNU sed reads the ''
# as the SCRIPT and the expression as a FILENAME, so on ubuntu it edits nothing,
# exits 2, and every mutation case below reports "THE MUTATION DID NOT REACH THE
# BINARY" -- a red gate blaming the cache for a defect in this file. This selftest
# is wired into run_ui_contract_test.sh, which runs on ubuntu-latest, so it must
# not use the macOS spelling that the macOS-only gates around it can.
subst() {   # subst <sed-expression> <file>
  local e="$1" f="$2" t="$2.fccsub"
  sed "$e" "$f" > "$t" || { rm -f "$t"; return 1; }
  mv -f "$t" "$f"
}

mkdir -p "$W/tree/inc" "$W/tree/src"
cat > "$W/tree/inc/answer.hpp" <<'EOF'
#pragma once
inline int headerAnswer() { return 10; }
EOF
cat > "$W/tree/src/a.cpp" <<'EOF'
#include "answer.hpp"
int fromA() { return 1 + headerAnswer(); }
EOF
cat > "$W/tree/src/b.cpp" <<'EOF'
int fromB() { return 100; }
EOF
cat > "$W/tree/src/main.cpp" <<'EOF'
#include <cstdio>
int fromA();
int fromB();
int main() { std::printf("%d\n", fromA() + fromB()); return 0; }
EOF
# Case 7 needs a second file whose BYTES are identical to another. Same content,
# different path: the object key must still differ or one would shadow the other.
cp "$W/tree/src/b.cpp" "$W/tree/src/b_twin.cpp"
cat > "$W/tree/src/b_twin.cpp" <<'EOF'
int fromB() { return 100; }
EOF

FCC_CXX="$CXX"
FCC_LDFLAGS=()
FCC_CACHE="$W/cache"
FCC_JOBS="$(fcc_jobs)"
DEF="-DFCC_SELFTEST=1"

# Sets RB_OUT to the program's stdout. NOT a command substitution: fcc_build's
# FCC_COMPILED / FCC_REUSED counters are the other half of every assertion below
# and a subshell would swallow them.
RB_OUT=""
rebuild() {  # rebuild <out-name>
  local out="$W/$1"
  FCC_CFLAGS=(-std=c++20 -O1 -Wall -Wextra -Werror "$DEF" -I "$W/tree/inc")
  FCC_SRCS=("$W/tree/src/a.cpp" "$W/tree/src/b.cpp" "$W/tree/src/main.cpp")
  if ! fcc_build "$out" "$W/$1.log"; then RB_OUT=BUILDFAIL; return 1; fi
  RB_OUT="$("$out" 2>/dev/null)" || RB_OUT=RUNFAIL
  return 0
}

# ── 1. cold build, then a warm one ──────────────────────────────────────────
rebuild bin1; r1="$RB_OUT"; c1="$FCC_COMPILED"; u1="$FCC_REUSED"
if [ "$r1" = "111" ] && [ "$c1" -eq 3 ] && [ "$u1" -eq 0 ]; then
  ok "1a: a cold build compiles all 3 units and the program answers 111"
else
  bad "1a: cold build gave [$r1] compiled=$c1 reused=$u1 (want 111 / 3 / 0)"
fi
rebuild bin2; r2="$RB_OUT"; c2="$FCC_COMPILED"; u2="$FCC_REUSED"
if [ "$r2" = "111" ] && [ "$c2" -eq 0 ] && [ "$u2" -eq 3 ]; then
  ok "1b: an unchanged rebuild reuses all 3 objects and still answers 111"
else
  bad "1b: warm build gave [$r2] compiled=$c2 reused=$u2 (want 111 / 0 / 3)"
fi

# ── 2. ★ a source edit MUST reach the binary ────────────────────────────────
# This is the case the whole file exists for.
subst 's/return 1 + headerAnswer();/return 7 + headerAnswer();/' "$W/tree/src/a.cpp"
rebuild bin3; r3="$RB_OUT"; c3="$FCC_COMPILED"; u3="$FCC_REUSED"
if [ "$r3" = "117" ] && [ "$c3" -eq 1 ] && [ "$u3" -eq 2 ]; then
  ok "2: ★ editing a .cpp recompiles exactly that unit and the answer moves 111 -> 117"
else
  bad "2: ★ STALE OBJECT RISK — after editing a.cpp the program said [$r3] (want 117), compiled=$c3 reused=$u3 (want 1 / 2)"
fi

# ── 3. ★ a header edit MUST reach every unit that could see it ──────────────
subst 's/return 10;/return 20;/' "$W/tree/inc/answer.hpp"
rebuild bin4; r4="$RB_OUT"; c4="$FCC_COMPILED"; u4="$FCC_REUSED"
if [ "$r4" = "127" ] && [ "$c4" -eq 3 ] && [ "$u4" -eq 0 ]; then
  ok "3: ★ editing a header invalidates every object and the answer moves 117 -> 127"
else
  bad "3: ★ STALE HEADER RISK — after editing answer.hpp the program said [$r4] (want 127), compiled=$c4 reused=$u4 (want 3 / 0)"
fi

# ── 4/5. the flags are part of the key ──────────────────────────────────────
DEF="-DFCC_SELFTEST=2"
rebuild bin5; r5="$RB_OUT"; c5="$FCC_COMPILED"; u5="$FCC_REUSED"
if [ "$r5" = "127" ] && [ "$c5" -eq 3 ] && [ "$u5" -eq 0 ]; then
  ok "4: changing a -D recompiles all 3 units rather than reusing the old flags' objects"
else
  bad "4: changing -D gave [$r5] compiled=$c5 reused=$u5 (want 127 / 3 / 0)"
fi
DEF="-DFCC_SELFTEST=1"
rebuild bin6; r6="$RB_OUT"; c6="$FCC_COMPILED"; u6="$FCC_REUSED"
if [ "$r6" = "127" ] && [ "$c6" -eq 0 ] && [ "$u6" -eq 3 ]; then
  ok "5: switching the flags back reuses the objects built under them, and only those"
else
  bad "5: restoring -D gave [$r6] compiled=$c6 reused=$u6 (want 127 / 0 / 3)"
fi

# ── 6. a revert must be a HIT that restores the ORIGINAL behaviour ──────────
subst 's/return 20;/return 10;/' "$W/tree/inc/answer.hpp"
subst 's/return 7 + headerAnswer();/return 1 + headerAnswer();/' "$W/tree/src/a.cpp"
rebuild bin7; r7="$RB_OUT"; c7="$FCC_COMPILED"; u7="$FCC_REUSED"
if [ "$r7" = "111" ]; then
  ok "6: reverting both edits restores 111 (compiled=$c7 reused=$u7) — the key is content, not history"
else
  bad "6: after reverting both edits the program said [$r7] (want 111), compiled=$c7 reused=$u7"
fi

# ── 7. identical bytes at different paths are different objects ─────────────
# b.cpp and b_twin.cpp hold the same bytes. If the key were content alone they
# would collide, and a build naming both would link one object twice while the
# other source silently never compiled. The link itself is EXPECTED to fail here
# (both define fromB), so only the object identity is read.
if [ "$(shasum -a 256 < "$W/tree/src/b.cpp" )" != "$(shasum -a 256 < "$W/tree/src/b_twin.cpp")" ]; then
  bad "7: the fixture is wrong — b.cpp and b_twin.cpp no longer hold identical bytes"
else
  FCC_CFLAGS=(-std=c++20 -O1 -Wall -Wextra -Werror "$DEF" -I "$W/tree/inc")
  FCC_SRCS=("$W/tree/src/b.cpp" "$W/tree/src/b_twin.cpp")
  fcc_build "$W/objonly.out" "$W/objonly.log" >/dev/null 2>&1
  if [ "${#FCC_OBJS[@]}" -eq 2 ] && [ "${FCC_OBJS[0]}" != "${FCC_OBJS[1]}" ]; then
    ok "7: two sources with identical bytes at different paths get 2 distinct objects"
  else
    bad "7: identical-byte sources at different paths mapped to ${#FCC_OBJS[@]} object(s): ${FCC_OBJS[*]}"
  fi
fi

# ── 8. ★ THE SECOND-BOUNDARY RACE THAT DEFEATED THE MTIME GATE ──────────────
# Rewrite a source and rebuild IMMEDIATELY, inside the same second as the
# previous build. An mtime-based decision judges the object current and runs
# unmutated code. A content-addressed one cannot.
# Waiting for the two to land in the same second would make the case a coin
# toss, so the timestamp is forced the other way and the test becomes
# DETERMINISTIC and strictly stronger: the rewritten source is stamped in 1970,
# i.e. OLDER than the object already in the cache. Every mtime-based decision --
# make, cmake, ninja, a hand-rolled `[ src -nt obj ]` -- judges that object
# current and runs unmutated code. A content-addressed one cannot.
subst 's/return 100;/return 500;/' "$W/tree/src/b.cpp"
touch -t 197001020000 "$W/tree/src/b.cpp"
rebuild bin8; r8="$RB_OUT"; c8="$FCC_COMPILED"
if [ "$r8" = "511" ] && [ "$c8" -eq 1 ]; then
  ok "8: ★ a source rewritten and then stamped OLDER than its cached object still recompiled (511)"
else
  bad "8: ★ a source stamped older than its object gave [$r8] (want 511), compiled=$c8 (want 1) — THE MUTATION DID NOT REACH THE BINARY"
fi

echo
echo "[fcc-selftest] $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
