#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_calculator_gate.sh — the engineering-calculator wiring, with its proof.
#
# It lives in forge-desktop/test, beside run_parameters_gate.sh and for the
# same reason: it compiles a *_gate.cpp from this directory ITSELF rather than
# through CMake, because the arms it links need no OCCT and no SDK -- the three
# calculators this family wires include nothing but <cmath> and <stdexcept>. It
# is declared in gate_registration_check.sh's AD_HOC as that gate's runner, so
# a workflow that stops calling it turns the registration check red.
#
# ui/test/run_ui.sh already compiles and runs engineering_calculator_test.cpp on
# every push, so the headless half of the clean pass is covered there. This
# script exists for the two halves it cannot do:
#
#   1. THE VALUE MATCH. run_ui.sh links no kernel -- that is what lets the whole
#      UI suite run headless -- so it cannot check that dispatching
#      `sim.flow_circular_pipe` returns the number forge::circpipe::analyse
#      returns. That comparison needs both arms linked at once, and it is
#      forge-desktop/test/calculator_value_gate.cpp, built here without CMake
#      because the three calculators this family wires include nothing but
#      <cmath> and <stdexcept>.
#
#   2. THE PROOF THAT ANY OF IT CAN FAIL. A gate nobody has SEEN go red is
#      indistinguishable from a gate that cannot. Every mutation below breaks
#      one real link in the chain, in real source, and the run is red or this
#      script is.
#
# THE CHAIN, and the mutation that cuts each link:
#
#   1  registerCalculatorCommands() adds nothing      -> the command is gone
#   2  two answers swapped in the generated bridge    -> a number under the
#                                                        wrong name
#   3  a kernel input renamed and the schema stale    -> the derivation drifts
#   4  a label set back to the kernel's member name   -> an identifier on screen
#   5  a developer sentence in a label                -> the prose scanner
#   6  the second derivation neutered to find nothing -> the gate's own
#                                                        instrument
#   7  the kernel seam unplugged                      -> no answer at all
#
# 6 is the one that matters most. Every field-name check in the headless gate is
# an application of one small parser; if that parser could be emptied and the
# gate stay green, all of them would be decoration.
#
# Each mutation runs against a COPY of the tree, so nothing edits the working
# checkout. A mutation that fails to COMPILE is reported as a broken mutation,
# never as a red gate -- "it did not build" is not "the check fired".
#
# Usage: bash forge-desktop/test/run_calculator_gate.sh [--mutations]
#        (no argument = the clean run only)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || {
  echo "[calc-gate] cannot resolve the repo root"; exit 1; }
[ -n "$ROOT" ] || { echo "[calc-gate] repo root resolved to the empty string"; exit 1; }
cd "$ROOT" || { echo "[calc-gate] cannot enter repo root $ROOT"; exit 1; }

CXX="${CXX:-clang++}"
command -v "$CXX" >/dev/null 2>&1 || { echo "[calc-gate] no $CXX on PATH"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[calc-gate] no python3 on PATH"; exit 1; }

FLAGS="-std=c++20 -O2 -Wall -Wextra -Werror"
GEN="implementation/sacrosanct/tools/gen_calculator_schema.py"

# EXACT pin. A mutation added below must move this number in the SAME change, or
# the sweep silently stops covering it.
MUTATIONS="${MUTATIONS:-7}"

WORK="$(mktemp -d /tmp/forge_calc_gate.XXXXXX)"
cleanup() {
  rm -rf "$WORK"
  if [ -d "$WORK" ]; then echo "[calc-gate] WARNING: kept $WORK -- rm -rf did not remove it"; fi
}
trap cleanup EXIT

FAILURES=0
fail() { echo "[calc-gate] FAIL — $1"; FAILURES=$((FAILURES + 1)); }

# The sources each arm needs. Named once so a mutation copy and the clean run
# cannot build different things.
UI_SRCS="ui/src/EngineeringCalculators.cpp ui/src/CommandRegistry.cpp \
ui/src/SelectionService.cpp ui/src/Types.cpp"
KERNEL_SRCS="forge-kernel/src/CircularPipeFlow.cpp forge-kernel/src/PitotTube.cpp \
forge-kernel/src/PumpNpsh.cpp"

# ── build + run one arm against a given tree ────────────────────────────────
#   0 = the gate passed, 1 = the gate FAILED (what a mutation must produce),
#   2 = it did not build (never a pass and never a proof).
run_headless() {
  local tree="$1"
  local tag="$2"
  local bin="$WORK/headless_$tag"
  # shellcheck disable=SC2086
  ( cd "$tree" && $CXX $FLAGS -I ui/include -I ui/test \
      "-DFORGE_UI_REPO_ROOT=\"$tree\"" \
      -o "$bin" ui/test/engineering_calculator_test.cpp \
      $UI_SRCS ui/src/UserFacingText.cpp ) >"$WORK/$tag.build" 2>&1 || return 2
  "$bin" >"$WORK/$tag.run" 2>&1 || return 1
  return 0
}

run_values() {
  local tree="$1"
  local tag="$2"
  local bin="$WORK/values_$tag"
  # shellcheck disable=SC2086
  ( cd "$tree" && $CXX $FLAGS -I ui/include -I forge-kernel/include -I forge-desktop/src \
      -o "$bin" forge-desktop/test/calculator_value_gate.cpp \
      forge-desktop/src/CalculatorHost.cpp $UI_SRCS $KERNEL_SRCS ) \
      >"$WORK/$tag.build" 2>&1 || return 2
  "$bin" >"$WORK/$tag.run" 2>&1 || return 1
  return 0
}

run_derive() {
  local tree="$1"
  local tag="$2"
  ( cd "$tree" && python3 "$GEN" --check ) >"$WORK/$tag.run" 2>&1 || return 1
  return 0
}

# A copy of exactly the files these three arms read. Copying the whole checkout
# would drag a 480 KB PDF and an 8 600-row CSV through every mutation.
make_tree() {
  local dest="$1"
  mkdir -p "$dest/ui" "$dest/forge-desktop" "$dest/forge-kernel/include/forge" \
           "$dest/forge-kernel/src" "$dest/implementation/sacrosanct/tools" || return 1
  cp -R "$ROOT/ui/include" "$ROOT/ui/src" "$ROOT/ui/test" "$dest/ui/" || return 1
  cp -R "$ROOT/forge-desktop/src" "$ROOT/forge-desktop/test" "$dest/forge-desktop/" || return 1
  cp "$ROOT/forge-kernel/include/forge/CircularPipeFlow.hpp" \
     "$ROOT/forge-kernel/include/forge/PitotTube.hpp" \
     "$ROOT/forge-kernel/include/forge/PumpNpsh.hpp" \
     "$dest/forge-kernel/include/forge/" || return 1
  cp "$ROOT/forge-kernel/src/CircularPipeFlow.cpp" \
     "$ROOT/forge-kernel/src/PitotTube.cpp" \
     "$ROOT/forge-kernel/src/PumpNpsh.cpp" "$dest/forge-kernel/src/" || return 1
  cp "$ROOT/$GEN" "$dest/$GEN" || return 1
  cp "$ROOT/implementation/sacrosanct/forge_calculator_schema.json" \
     "$dest/implementation/sacrosanct/" || return 1
  return 0
}

# ── THE CLEAN RUN ───────────────────────────────────────────────────────────
echo "[calc-gate] clean run"

run_derive "$ROOT" clean_derive
rc=$?
echo "[calc-gate]   derivation --check  exit=$rc"
[ $rc -eq 0 ] || { sed -n '1,20p' "$WORK/clean_derive.run"; fail "the derivation drifted"; }

run_headless "$ROOT" clean_headless
rc=$?
echo "[calc-gate]   headless gate       exit=$rc"
if [ $rc -eq 2 ]; then sed -n '1,30p' "$WORK/clean_headless.build"; fail "the headless gate did not build"
elif [ $rc -ne 0 ]; then sed -n '1,30p' "$WORK/clean_headless.run"; fail "the headless gate is red"
else sed -n '$p' "$WORK/clean_headless.run"; fi

run_values "$ROOT" clean_values
rc=$?
echo "[calc-gate]   value match         exit=$rc"
if [ $rc -eq 2 ]; then sed -n '1,30p' "$WORK/clean_values.build"; fail "the value gate did not build"
elif [ $rc -ne 0 ]; then sed -n '1,30p' "$WORK/clean_values.run"; fail "the value gate is red"
else sed -n '$p' "$WORK/clean_values.run"; grep -m1 'worst relative' "$WORK/clean_values.run"; fi

if [ "${1:-}" != "--mutations" ]; then
  echo "[calc-gate] clean run only (pass --mutations for the falsifiability proof)"
  [ "$FAILURES" -eq 0 ] && echo "[calc-gate] PASS" || echo "[calc-gate] FAIL ($FAILURES)"
  exit $([ "$FAILURES" -eq 0 ] && echo 0 || echo 1)
fi

# ── THE MUTATIONS ───────────────────────────────────────────────────────────
# Each one: build a fresh copy, apply one edit with python3 (so a pattern that
# no longer matches is a LOUD failure rather than a silent no-op), run the arm
# that must catch it, and require exit 1.
echo "[calc-gate] mutation sweep ($MUTATIONS expected)"
RAN=0

mutate() {
  local n="$1"
  local what="$2"
  local arm="$3"
  local script="$4"
  local tree="$WORK/m$n"
  RAN=$((RAN + 1))
  rm -rf "$tree"
  if ! make_tree "$tree"; then fail "mutation $n: could not build a tree copy"; return; fi
  if ! ( cd "$tree" && python3 -c "$script" ) >"$WORK/m$n.edit" 2>&1; then
    cat "$WORK/m$n.edit"
    fail "mutation $n ($what): the edit did not apply -- the pattern has moved"
    return
  fi
  "$arm" "$tree" "m$n"
  local rc=$?
  if [ $rc -eq 1 ]; then
    echo "[calc-gate]   $n $what -> exit=1 CAUGHT"
  elif [ $rc -eq 2 ]; then
    sed -n '1,12p' "$WORK/m$n.build"
    fail "mutation $n ($what): BROKEN MUTATION -- it did not build, so nothing was proved"
  else
    fail "mutation $n ($what): exit=0 -- the gate did NOT catch it"
  fi
}

mutate 1 "the command registration adds nothing" run_values '
import io
p="ui/src/EngineeringCalculators.cpp"; s=open(p).read()
old="    if (registry.add(std::move(c))) ++added;"
assert old in s, "anchor gone"
open(p,"w").write(s.replace(old,"    (void)registry;  // MUTATION: the wiring is cut\n    (void)c;",1))'

mutate 2 "two answers swapped in the generated bridge" run_values '
p="forge-desktop/src/CalculatorKernelBridge.hpp"; s=open(p).read()
a="    out.push_back(r.velocityMs);\n    out.push_back(r.dischargeM3S);"
b="    out.push_back(r.dischargeM3S);\n    out.push_back(r.velocityMs);"
assert a in s, "anchor gone"
open(p,"w").write(s.replace(a,b,1))'

mutate 3 "a kernel input renamed, the schema left behind" run_derive '
p="forge-kernel/include/forge/PitotTube.hpp"; s=open(p).read()
assert "double pitotCoefficient;" in s, "anchor gone"
open(p,"w").write(s.replace("double pitotCoefficient;","double probeCoefficient;",1))'

mutate 4 "a label set back to the kernel member name" run_headless '
p="ui/include/forge/ui/CalculatorSchema.hpp"; s=open(p).read()
a='"'"'{"manningN", "Manning roughness coefficient", ""'"'"'
b='"'"'{"manningN", "manningN", ""'"'"'
assert a in s, "anchor gone"
open(p,"w").write(s.replace(a,b,1))'

mutate 5 "a developer sentence in a label" run_headless '
p="ui/include/forge/ui/CalculatorSchema.hpp"; s=open(p).read()
a='"'"'"Wetted perimeter"'"'"'
b='"'"'"Wetted perimeter (forge::circpipe::Result, not implemented yet)"'"'"'
assert a in s, "anchor gone"
open(p,"w").write(s.replace(a,b,1))'

mutate 6 "the second derivation neutered to find nothing" run_headless '
p="ui/test/engineering_calculator_test.cpp"; s=open(p).read()
old="  std::vector<std::string> out;\n  const std::string open = \"struct \" + structName + \" {\";"
assert old in s, "anchor gone"
new="  std::vector<std::string> out;\n  return out;  // MUTATION: the instrument finds nothing\n  const std::string open = \"struct \" + structName + \" {\";"
open(p,"w").write(s.replace(old,new,1))'

mutate 7 "the kernel seam unplugged" run_values '
p="forge-desktop/src/CalculatorHost.cpp"; s=open(p).read()
old="      if (calcbridge::evaluate(calculatorId, params, outputs)) {"
assert old in s, "anchor gone"
new="      if (false && calcbridge::evaluate(calculatorId, params, outputs)) {  // MUTATION"
open(p,"w").write(s.replace(old,new,1))'

echo "[calc-gate] mutations run: $RAN (pinned $MUTATIONS)"
if [ "$RAN" -ne "$MUTATIONS" ]; then
  fail "the sweep ran $RAN mutations, the pin says $MUTATIONS"
fi

if [ "$FAILURES" -eq 0 ]; then
  echo "[calc-gate] PASS — clean green, and every one of the $RAN cut links went red"
  exit 0
fi
echo "[calc-gate] FAIL — $FAILURES"
exit 1
