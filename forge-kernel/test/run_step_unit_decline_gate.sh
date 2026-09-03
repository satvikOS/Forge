#!/usr/bin/env bash
# run_step_unit_decline_gate.sh — build + run step_unit_decline_gate, then PROVE
# it can fail by reverting the fix it pins.
#
# Exit 0 iff the gate built, passed clean, AND the mutation turned it red.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL/.." || exit 2
CXX="${CXX:-clang++}"

OCCT="${OCCT_ROOT:-}"
if [ -z "$OCCT" ]; then
  for c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade /usr; do
    [ -e "$c/include/opencascade/Standard_Version.hxx" ] && { OCCT="$c"; break; }
  done
fi
[ -n "$OCCT" ] || { echo "[step-unit] FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2; }

SRC=forge-kernel/src/native/brep/StepAnalytic.cpp
BUILD="${STEP_UNIT_BUILD:-forge-kernel/build-unit}"

# ★ STEP 0: REFUSE unless the fix is present in the source being compiled. Built
#   without it the gate would pass over code that is not there -- the same shape
#   as a translation unit that is entirely #ifdef'd out compiling rc=0.
echo "[0/4] the decline under test is PRESENT in the source"
if ! grep -q "deferring to the foreign reader" "$SRC"; then
  echo "[step-unit] FATAL: StepAnalytic.cpp does not decline a non-mm unit context." >&2
  echo "[step-unit] Either the fix was reverted or it moved. Refusing to report success." >&2
  exit 2
fi
echo "      ok"

build_lib() {
  if [ ! -f "$BUILD/CMakeCache.txt" ]; then
    cmake -S forge-kernel -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
          -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=OFF \
          > /tmp/su_cfg.log 2>&1 || { echo "[step-unit] configure failed:" >&2; tail -25 /tmp/su_cfg.log >&2; return 1; }
  fi
  cmake --build "$BUILD" -j"${JOBS:-3}" --target forge_kernel_core > /tmp/su_build.log 2>&1 \
    || { echo "[step-unit] library build failed:" >&2; tail -25 /tmp/su_build.log >&2; return 1; }
}

link_gate() {
  # LINK THE REAL LIBRARY. -Wl,-undefined,dynamic_lookup would turn a missing
  # symbol into a runtime jump to address zero, and this gate CALLS into the
  # kernel, so a dynamic_lookup harness would SIGSEGV instead of failing to link.
  "$CXX" -std=c++20 -O1 -DFORGE_NATIVE_BREP=1 \
    -Iforge-kernel/include -I"$OCCT/include/opencascade" \
    -Iforge-kernel/3rdParty/planegcs -Iforge-kernel/3rdParty/planegcs_eigen_shim \
    forge-kernel/test/step_unit_decline_gate.cpp -o /tmp/step_unit_gate \
    -L "$BUILD" -lforge_kernel_core -Wl,-rpath,"$BUILD" \
    -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" 2> /tmp/su_link.log \
    || { echo "[step-unit] link failed:" >&2; tail -25 /tmp/su_link.log >&2; return 1; }
}

echo "[1/4] build"
# Same reason as restore(): a previous run may have left source and library with
# the same mtime, which cmake reads as "up to date".
touch "$SRC"
build_lib || exit 2
link_gate || exit 2

echo "[2/4] run (clean tree)"
OUT=$(/tmp/step_unit_gate 2>&1); rc=$?
echo "$OUT" | sed 's/^/      /'
[ "$rc" -ne 0 ] && { echo "[step-unit] RED — the clean run failed."; exit 1; }

echo "[3/4] mutation — remove the decline; case 2b must go RED"
cp "$SRC" /tmp/su_src.orig
restore() {
  cp /tmp/su_src.orig "$SRC"
  # ★ TOUCH, OR THE REBUILD IS A NO-OP. MEASURED: after a cp that landed in the
  #   same second as the previous build, the source and libforge_kernel_core.dylib
  #   shared an mtime to the second, cmake judged the library current, skipped the
  #   compile, and left the MUTATED code linked while the source held the fix --
  #   the clean re-run then failed for a reason no diff could show.
  touch "$SRC"
  build_lib >/dev/null 2>&1 || true
}
trap restore EXIT
python3 - "$SRC" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
i=s.find("    // ── DECLINE A FILE THAT IS NOT IN MILLIMETRES")
j=s.find("    }\n", s.find("deferring to the foreign reader"))
if i>0 and j>i: open(p,"w").write(s[:i]+s[j+6:])
PY
if grep -q "deferring to the foreign reader" "$SRC"; then
  echo "      ★ mutation did not apply (source shape changed) — reporting BROKEN, not green"
  exit 1
fi
if build_lib && link_gate; then
  /tmp/step_unit_gate >/dev/null 2>&1; m=$?
else
  m=2
fi
restore
if [ "$m" -eq 2 ]; then
  echo "      ★ mutation INCONCLUSIVE — the library did not rebuild, so the gate never ran."
  echo "        A build failure is NOT evidence the mutation was caught."
  exit 1
elif [ "$m" -eq 0 ]; then
  echo "      ★ mutation stayed GREEN — the gate does not test the defect"
  exit 1
fi
echo "      caught (exit $m)"

echo "[4/4] rebuild clean and re-run (the mutation must leave no residue)"
build_lib && link_gate || exit 2
OUT2=$(/tmp/step_unit_gate 2>&1); rc2=$?
if [ "$rc2" -ne 0 ]; then
  echo "[step-unit] RED — the tree did not come back clean:"; echo "$OUT2" | sed 's/^/      /'; exit 1
fi
echo "[step-unit] GREEN — clean run passes and the mutation was caught."
