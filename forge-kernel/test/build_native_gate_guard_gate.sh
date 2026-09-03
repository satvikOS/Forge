#!/usr/bin/env bash
# build_native_gate_guard_gate.sh — build + run test/native_gate_guard_gate.cpp, then
# PROVE it can fail by reverting the fix it pins.
#
# ★ FORGE_NATIVE_BREP IS DEFINED HERE ON PURPOSE, AND THAT IS THE WHOLE POINT.
#   The guard this gate tests lives inside `#ifdef FORGE_NATIVE_BREP` in
#   FeatureTreeCompiler.cpp. Built WITHOUT that define the guard does not exist,
#   the gate passes vacuously, and the run reports success over nothing at all —
#   the same shape as a translation unit that is entirely #ifdef'd out compiling
#   rc=0. Step 0 below therefore asserts the guard text is actually present in
#   the source being compiled, so a future edit that moves or renames it cannot
#   silently turn this gate into a no-op.
#
# Exit 0 iff the gate built, passed clean, AND both mutations turned it red.
set -uo pipefail

KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"

OCCT="${OCCT_ROOT:-}"
if [ -z "$OCCT" ]; then
  for _c in /opt/homebrew/opt/opencascade /usr/local/opt/opencascade /usr; do
    [ -e "$_c/include/opencascade/Standard_Version.hxx" ] && { OCCT="$_c"; break; }
  done
fi
if [ -z "$OCCT" ] || [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  echo "[gate-guard] FATAL: OCCT not found (brew install opencascade, or set OCCT_ROOT)" >&2
  exit 2
fi

BUILD="${GATE_GUARD_BUILD:-$KERNEL/build-gateguard}"
LIBDIR="$BUILD"

# The mutations edit kernel SOURCES, so the LIBRARY has to be rebuilt for a mutation
# to reach the binary under test. Rebuilding only the gate object would leave every
# mutation "uncaught" for the wrong reason.
rebuild_lib() {
  # CONFIGURE IF NEEDED. The first version of this only ran `cmake --build`, which
  # worked locally because I had configured the directory by hand and never encoded
  # that step. In CI the directory does not exist, so the gate died with
  # "FATAL: library build failed" before running a single check — a "works on my
  # machine" failure in a harness whose whole job is to not be fooled.
  if [ ! -f "$BUILD/CMakeCache.txt" ]; then
    if ! cmake -S "$KERNEL" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
              -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON \
              > "$OUT/libconfig.log" 2>&1; then
      echo "[gate-guard] cmake CONFIGURE failed:" >&2
      tail -30 "$OUT/libconfig.log" >&2
      return 1
    fi
  fi
  if ! cmake --build "$BUILD" -j3 --target forge_kernel_core > "$OUT/libbuild.log" 2>&1; then
    # Say WHY. A harness that reports a build failure without the compiler's reason
    # forces the next reader to reproduce it before they can even start.
    echo "[gate-guard] cmake BUILD failed:" >&2
    tail -30 "$OUT/libbuild.log" >&2
    return 1
  fi
}

OUT="${OUT:-$KERNEL/test/.gate_guard}"
rm -rf "$OUT"; mkdir -p "$OUT" || exit 2

FLAGS=(-std=c++20 -O1 -g0 -DFORGE_NATIVE_BREP=1
       -I"$KERNEL/include" -I"$OCCT/include/opencascade"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

COMPILER_SRC="$KERNEL/src/ft/FeatureTreeCompiler.cpp"

echo "[0/5] the guard under test is PRESENT in the source being compiled"
if ! grep -q "saveNativeGateOverrides" "$COMPILER_SRC"; then
  echo "[gate-guard] FATAL: FeatureTreeCompiler.cpp does not call saveNativeGateOverrides()." >&2
  echo "[gate-guard] Either the fix was reverted or it moved. This gate would otherwise" >&2
  echo "[gate-guard] pass over code that is not there. Refusing to report success." >&2
  exit 2
fi
if ! grep -q "restoreNativeGateOverrides" "$COMPILER_SRC"; then
  echo "[gate-guard] FATAL: no restoreNativeGateOverrides() in the compiler. Refusing." >&2
  exit 2
fi
echo "      ok — both save and restore are called in FeatureTreeCompiler.cpp"

compile_tu() {   # compile_tu <src> <obj> [extra flags...]
  local src="$1" obj="$2"; shift 2
  if ! "$CXX" "${FLAGS[@]}" "$@" -c "$src" -o "$obj" 2> "$OUT/$(basename "$obj").err"; then
    echo "[gate-guard] COMPILE FAILED: $src" >&2
    tail -40 "$OUT/$(basename "$obj").err" >&2
    exit 2
  fi
}

build_all() {
  # LINK AGAINST THE REAL LIBRARY, NOT A HAND-PICKED SET OF TRANSLATION UNITS.
  # The first version of this runner copied build_section_op_gate.sh's TU list plus
  # -Wl,-undefined,dynamic_lookup. It BUILT and then SIGSEGV'd at
  #   main -> forge::ft::compile -> <null>
  # because compile() dispatches to op implementations that were never linked, and
  # dynamic_lookup turns that link error into a runtime jump to address zero.
  # section_op_gate.cpp says so in its own header: "It never calls
  # forge::ft::compile()." A dynamic_lookup harness is only safe for code paths it
  # does not execute, and this gate exists precisely to execute one.
  compile_tu "$KERNEL/test/native_gate_guard_gate.cpp" "$OUT/gate.o" -Wall -Wextra -Werror
  if ! "$CXX" -std=c++20 "$OUT/gate.o" \
        -o "$OUT/gate" \
        -L "$LIBDIR" -lforge_kernel_core -Wl,-rpath,"$LIBDIR" \
        -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" 2> "$OUT/link.err"; then
    echo "[gate-guard] LINK FAILED:" >&2
    tail -40 "$OUT/link.err" >&2
    exit 2
  fi
}

echo "[1/5] build (clean tree)"
rebuild_lib || { echo "[gate-guard] FATAL: library build failed" >&2; exit 2; }
build_all
echo "[2/5] run"
"$OUT/gate"; rc=$?
if [ "$rc" -ne 0 ]; then
  echo "[gate-guard] RED — the clean run failed (exit $rc)."
  exit 1
fi

# ── the falsifiability proof ────────────────────────────────────────────────
# Mutation 1 restores the ONE-BIT guard this fix replaced — the actual historical
# defect. Mutation 2 breaks restore() itself. A mutation that stays green means
# the gate is not testing what it claims to.
cp "$COMPILER_SRC" "$OUT/FeatureTreeCompiler.cpp.orig"
cp "$KERNEL/src/native/brep/NativeRoute.cpp" "$OUT/NativeRoute.cpp.orig"
restore_sources() {
  cp "$OUT/FeatureTreeCompiler.cpp.orig" "$COMPILER_SRC"
  cp "$OUT/NativeRoute.cpp.orig" "$KERNEL/src/native/brep/NativeRoute.cpp"
  # ★ TOUCH, OR THE REBUILD BELOW IS A NO-OP. MEASURED on the neighbouring STEP
  #   gate: a cp that lands in the SAME SECOND as the previous build leaves the
  #   source and libforge_kernel_core.dylib sharing an mtime to the second, cmake
  #   judges the library current, skips the compile, and the MUTATED code stays
  #   linked while the source shows the fix. That is a concrete mechanism for the
  #   "[5/5] RED — the tree did not come back clean" this script reported on
  #   PR #206 while its own 8 invariant checks passed.
  touch "$COMPILER_SRC" "$KERNEL/src/native/brep/NativeRoute.cpp"
  # ★ AND DELETE THE OBJECTS, BECAUSE `touch` ALONE IS NOT ENOUGH — MEASURED IN CI.
  #   `touch` sets mtime to NOW, and the library was also linked NOW. At one-second
  #   filesystem granularity those compare EQUAL, cmake calls the library current,
  #   and the compile is skipped exactly as the comment above fears. That is not
  #   hypothetical: on PR #220 this gate went RED with the clean run passing (8
  #   checks, 0 failures) and BOTH mutations caught, failing only at [5/5] with
  #   `before: feat=1 -> after: feat=0` -- i.e. mutation 2's deletion of the
  #   FEATURES restore was STILL LINKED after being reverted in the source. The
  #   ★ CORRECTED: an earlier version of this comment argued that [5/5]
  #   finishing in 3 SECONDS proved the rebuild was elided. That number DOES NOT
  #   DISCRIMINATE. Comparing sub-step timings between a PASSING archdisc run
  #   (3d886631) and a FAILING one (5dc9aaf0): [1/5] 2m41s vs 2m01s, mutation 1
  #   10s vs 8s, mutation 2 5s vs 4s, the restore window 9s vs 7s, and [5/5]
  #   itself 3s in BOTH. So [5/5] recompiles nothing even when the gate PASSES:
  #   the compile that decides the outcome happens inside restore_sources(), in
  #   that 9s-vs-7s window -- which is exactly where the deletion below lives.
  #   The failing run was uniformly ~25% faster at every phase: a RUNNER-SPEED
  #   signature tightening a one-second collision, not a branch-content
  #   signature, since this gate compiles no file that branch touched.
  #   ★ And the evidentiary asymmetry, because it nearly cost the diagnosis: a
  #   local PASS would NOT refute this. For a race, different hardware has
  #   different timing, so only a reproduction confirms -- treating a
  #   non-reproduction as refutation is how a real race is closed "works for me".
  #   ★★ RETRACTED: an earlier revision of this comment claimed the trigger
  #   REQUIRES a shared, pre-built tree. That was over-generalised from a single
  #   reproduction and is REFUTED. Rate, measured:
  #       attempt 1  shared build-verify, pre-built    -> RED (CI's exact signature)
  #       attempt 2  same tree, back-to-back           -> GREEN
  #       attempt 3  fresh pre-built tree              -> GREEN
  #   1 reproduction in 3. A control that passes 2 of 3 cannot distinguish a fix
  #   from luck, so nothing here is empirically verified by that experiment.
  #   ★ It is a genuine TIMING RACE with a rate, not a deterministic trigger --
  #   which is exactly why it went 3/3 red on one CI branch and green on another
  #   without either branch touching this gate's sources.
  #   ★★ THE DELETION BELOW IS SOUND BY CONSTRUCTION, NOT BY THAT EXPERIMENT:
  #   cmake cannot elide a compile whose output does not exist, whatever the
  #   timestamps do and whichever tree is used. Demonstrating it STATISTICALLY
  #   would need a rate comparison of order 20 runs per arm; that has NOT been
  #   done and is not claimed.
  #   It reproduced on re-run and passed on the same tree locally, because locally
  #   the gate owns its build directory while CI points GATE_GUARD_BUILD at the
  #   SHARED build-verify, whose library an earlier job step had just linked.
  #   Removing the objects makes the recompile a fact rather than a race: cmake
  #   cannot elide a compile whose output does not exist.
  find "$BUILD" -name 'FeatureTreeCompiler.cpp.o' -delete 2>/dev/null || true
  find "$BUILD" -name 'NativeRoute.cpp.o' -delete 2>/dev/null || true
  # REBUILD after restoring. This gate may share a build tree with the rest of the
  # job (CI points GATE_GUARD_BUILD at build-verify), so an early exit mid-mutation
  # would otherwise leave a MUTATED library in place for every later step — a gate
  # that corrupts its neighbours is worse than no gate.
  rebuild_lib >/dev/null 2>&1 || true
}
trap restore_sources EXIT

fails=0

echo "[3/5] mutation 1 — the historical one-bit guard"
python3 - "$COMPILER_SRC" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
s=s.replace("const forge::native::brep::NativeGateOverrides prevGates =\n        forge::native::brep::saveNativeGateOverrides();",
            "const bool prevGates = forge::native::brep::forgeNativeBrepEnabled();")
s=s.replace("forge::native::brep::NativeGateOverrides prev;\n        ~GateGuard() { forge::native::brep::restoreNativeGateOverrides(prev); }",
            "bool prev;\n        ~GateGuard() { forge::native::brep::setForgeNativeBrepEnabled(prev); }")
open(p,"w").write(s)
PY
# step 0 would refuse this build, so bypass it for the mutation only
if grep -q "saveNativeGateOverrides" "$COMPILER_SRC"; then
  echo "      mutation 1 did not apply (source shape changed) — reporting as BROKEN, not green"
  fails=$((fails+1))
else
  rebuild_lib && build_all 2>/dev/null && { "$OUT/gate" >/dev/null 2>&1; m1=$?; } || m1=2
  if [ "${m1:-0}" -eq 2 ]; then
    echo "      * mutation 1 INCONCLUSIVE -- the library did not rebuild, so the gate never ran."
    echo "        A build failure is NOT evidence the mutation was caught."
    fails=$((fails+1));
  elif [ "${m1:-0}" -eq 0 ]; then echo "      ★ mutation 1 stayed GREEN — the gate does not test the defect"; fails=$((fails+1));
  else echo "      caught (exit $m1)"; fi
fi
restore_sources

echo "[4/5] mutation 2 — restore() drops the FEATURES gate"
python3 - "$KERNEL/src/native/brep/NativeRoute.cpp" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read()
s=s.replace("    g_featOverride.store(prev.features, std::memory_order_relaxed);\n","",1)
open(p,"w").write(s)
PY
rebuild_lib && build_all 2>/dev/null && { "$OUT/gate" >/dev/null 2>&1; m2=$?; } || m2=2
if [ "${m2:-0}" -eq 2 ]; then
  echo "      * mutation 2 INCONCLUSIVE -- the library did not rebuild, so the gate never ran."
  echo "        A build failure is NOT evidence the mutation was caught."
  fails=$((fails+1));
elif [ "${m2:-0}" -eq 0 ]; then echo "      ★ mutation 2 stayed GREEN"; fails=$((fails+1));
else echo "      caught (exit $m2)"; fi
restore_sources

echo "[5/5] rebuild clean and re-run (the mutations must leave no residue)"
rebuild_lib && build_all
# ★ PROVE THE REBUILD HAPPENED BEFORE JUDGING THE INVARIANT. restore_sources()
#   deletes both objects, so after a real rebuild they MUST exist again. If they
#   do not, the compile was elided and the library still holds mutated code --
#   in which case the gate below would report a FAILING INVARIANT for what is
#   actually a broken measurement. That mis-attribution is not hypothetical: it
#   cost two agents an afternoon on PR #220. Name the cause here instead.
for obj in FeatureTreeCompiler.cpp.o NativeRoute.cpp.o; do
  if ! find "$BUILD" -name "$obj" | grep -q .; then
    echo "[gate-guard] RED -- the rebuild was ELIDED: $obj was deleted and never"
    echo "             recompiled, so the library may still hold mutated code."
    echo "             This is a MEASUREMENT failure, not an invariant failure --"
    echo "             do not read the checks below as a kernel regression."
    exit 1
  fi
done
"$OUT/gate" > "$OUT/final.log" 2>&1; rc2=$?
if [ "$rc2" -ne 0 ]; then
  # SAY WHY. This ran with >/dev/null 2>&1, so when it went red on PR #206 the
  # log held only "the tree did not come back clean" and the actual failing
  # check was unrecoverable -- the very defect this file's own rebuild_lib()
  # comment criticises. The gate names its failing invariant on stdout.
  echo "[gate-guard] RED -- the clean re-run FAILED after the mutations were reverted (exit $rc2)."
  echo "[gate-guard] --- the gate's own output follows; the FAIL line names the invariant ---"
  sed 's/^/    /' "$OUT/final.log"
  echo "[gate-guard] --- end ---"
  echo "[gate-guard] If those checks PASS here, the fault is the REBUILD, not the invariant."
  exit 1
fi

if [ "$fails" -ne 0 ]; then
  echo "[gate-guard] RED — $fails mutation(s) were not caught."
  exit 1
fi
echo "[gate-guard] GREEN — clean run passes and both mutations were caught."
