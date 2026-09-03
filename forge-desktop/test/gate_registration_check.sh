#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gate_registration_check.sh — IS EVERY forge-desktop GATE ACTUALLY EXECUTED?
#
# THE DEFECT CLASS, ONE LEVEL UP FROM #107.
#
#   #107 was "a file nothing compiles cannot break". CI now compiles
#   forge-desktop on every pull request (the `desktop` job) and run_desktop.sh
#   drives its gates, so that one is closed and MEASURED closed.
#
#   This gate exists for its successor: A GATE THAT IS BUILT BUT NEVER RUN
#   CANNOT FAIL EITHER, and it looks even more like safety than an uncompiled
#   file does, because the binary is right there in the build directory.
#
#   The seam is exact and it is structural. forge-desktop/CMakeLists.txt
#   decides what gets BUILT; `cmake --build` with no --target builds every
#   add_executable (there is no EXCLUDE_FROM_ALL in that file — checked).
#   run_desktop.sh decides what gets RUN, and it does so from a HARDCODED list
#   of `run_gate <target> <mutation numbers...>` lines, NOT a glob. Nothing
#   compares the two lists.
#
#   So: add prose_gate.cpp, add its add_executable, add it to
#   run_syntax_gate.sh's CHECKED array so THAT gate stays green — and forget the
#   one `run_gate` line. The result is a gate that compiles clean, is never
#   executed, contributes no mutations, and leaves ci_desktop_gate.sh's pinned
#   EXPECTED_MUTATIONS untouched. Every check in the repository stays green
#   while the gate written to catch developer prose in a panel never runs once.
#
#   That is not hypothetical bookkeeping: ui/test is safe from this by
#   construction because run_ui.sh:60 is `TESTS=(ui/test/*_test.cpp)`, a glob.
#   forge-desktop/test is the one gate directory in the repository that is
#   enumerated BY HAND, which is why this check covers that directory and not
#   the other.
#
# WHAT IT ASSERTS. Three things, each in BOTH directions where that is meaningful:
#
#   1. The set of gate executables built by forge-desktop/CMakeLists.txt is
#      EXACTLY the set executed by run_desktop.sh. A built-but-not-run gate is
#      the orphan above. A run-but-not-built gate would die at runtime, but it
#      dies here first, by name, in one second instead of after an OCCT install.
#
#   2. Every forge-desktop/test/*_gate.cpp is accounted for: either it is a
#      CMake gate target, or it is named in AD_HOC below together with the
#      runner script that compiles it itself.
#
#   3. Every AD_HOC runner IS invoked on a real, non-comment line of a workflow.
#      A gate compiled by a script nobody calls is the same silence with an
#      extra step. kernel-tests.yml is 67% comment lines (659 of 979), so a
#      mention proves nothing and only executable lines are counted.
#
# IT REFUSES RATHER THAN GUESSES, the house rule for the op-vocabulary
# generators. If an `add_executable(` or a `run_gate` appears in a form this
# script cannot parse — a name built by a variable, an invocation indented into
# a conditional — it exits RED asking to be taught, instead of quietly reading a
# shorter list and passing. A parser that silently skips what it does not
# understand is exactly the failure it is here to prevent.
#
# WHAT IT DOES NOT DO. It does not run a gate, compile anything, or check that a
# gate's assertions are any good — ci_desktop_gate.sh's mutation proof is what
# says a gate can fail. This only says the gate is WIRED IN. Those are different
# claims and this script makes only the second one.
#
# Needs bash, grep, sed, sort. No compiler, no SDK, no network: seconds on any
# runner, which is why it can sit in a cheap ubuntu job instead of behind a
# 30-minute macOS build.
#
# Its own red paths are proved by gate_registration_selftest.sh.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="${FORGE_DESKTOP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CMAKE_FILE="$ROOT/forge-desktop/CMakeLists.txt"
RUN_DESKTOP="$ROOT/forge-desktop/test/run_desktop.sh"
TEST_DIR="$ROOT/forge-desktop/test"
WORKFLOW_DIR="$ROOT/.github/workflows"

# Gate sources that are deliberately NOT CMake targets: their runner compiles
# them ad hoc. Format: "<source basename>|<runner script basename>".
# Both runners are invoked from kernel-tests.yml; check 3 proves that, so this
# list cannot become a place to hide a gate nobody calls.
AD_HOC=(
  "differential_solid_gate.cpp|run_differential_solid_gate.sh"
  "appcast_check.cpp|appcast_selftest.sh"
)

FAIL=0
red() {
  echo "[gate-reg] RED: $*"
  if [ -n "${GITHUB_ACTIONS:-}" ]; then echo "::error::$*"; fi
  FAIL=1
}

for f in "$CMAKE_FILE" "$RUN_DESKTOP"; do
  if [ ! -f "$f" ]; then
    echo "[gate-reg] RED: $f is missing; a list that is not there cannot be compared"
    [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::$f is missing"
    exit 1
  fi
done

# ── parse, refusing anything ambiguous ───────────────────────────────────────
# Every add_executable( must name its target on the SAME line. A target whose
# name comes from a variable compiles and registers correctly and is invisible
# here, so it is refused rather than skipped.
ae_total=$(grep -cE '^[[:space:]]*add_executable\(' "$CMAKE_FILE") || ae_total=0
ae_parsed=$(grep -cE '^[[:space:]]*add_executable\([A-Za-z_][A-Za-z0-9_]*' "$CMAKE_FILE") || ae_parsed=0
if [ "$ae_total" -ne "$ae_parsed" ]; then
  red "forge-desktop/CMakeLists.txt has $ae_total add_executable( but only $ae_parsed name a literal target on the same line; teach this script the other form rather than letting it read a short list"
fi

BUILT=$(grep -oE '^[[:space:]]*add_executable\([A-Za-z_][A-Za-z0-9_]*' "$CMAKE_FILE" \
        | sed -E 's/.*add_executable\(//' | grep -E '_gate$' | sort -u)

# run_gate must be the function definition or a column-0 invocation. Anything
# else (indented into an `if`, built from a variable) is refused.
rg_all=$(grep -cE '(^|[^A-Za-z0-9_])run_gate([^A-Za-z0-9_]|$)' "$RUN_DESKTOP" \
         | head -1) || rg_all=0
rg_comment=$(grep -E '(^|[^A-Za-z0-9_])run_gate([^A-Za-z0-9_]|$)' "$RUN_DESKTOP" \
             | grep -cE '^[[:space:]]*#') || rg_comment=0
rg_def=$(grep -cE '^run_gate\(\)' "$RUN_DESKTOP") || rg_def=0
rg_call=$(grep -cE '^run_gate[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' "$RUN_DESKTOP") || rg_call=0
rg_accounted=$(( rg_comment + rg_def + rg_call ))
if [ "$rg_all" -ne "$rg_accounted" ]; then
  red "run_desktop.sh mentions run_gate $rg_all times but only $rg_accounted are a comment, the definition, or a column-0 invocation; an invocation this script cannot see is a gate it cannot vouch for"
fi

RUN=$(grep -oE '^run_gate[[:space:]]+[A-Za-z_][A-Za-z0-9_]*' "$RUN_DESKTOP" \
      | awk '{print $2}' | sort -u)

# ── 1. built set == run set ──────────────────────────────────────────────────
orphans=$(comm -23 <(printf '%s\n' "$BUILT") <(printf '%s\n' "$RUN"))
phantoms=$(comm -13 <(printf '%s\n' "$BUILT") <(printf '%s\n' "$RUN"))

if [ -n "$orphans" ]; then
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    red "$t is BUILT by forge-desktop/CMakeLists.txt and never executed by run_desktop.sh — add a 'run_gate $t <mutations...>' line, or delete the target. A gate that is built but never run cannot fail."
  done <<< "$orphans"
fi
if [ -n "$phantoms" ]; then
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    red "run_desktop.sh executes $t but forge-desktop/CMakeLists.txt does not build it — the run would die on a missing binary"
  done <<< "$phantoms"
fi

# ── 2. every *_gate.cpp is a CMake target or declared ad hoc ─────────────────
for src in "$TEST_DIR"/*_gate.cpp; do
  [ -e "$src" ] || continue
  b=$(basename "$src")
  stem="${b%.cpp}"
  if printf '%s\n' "$BUILT" | grep -qx "forge_desktop_$stem"; then continue; fi
  declared=""
  for pair in "${AD_HOC[@]}"; do
    if [ "${pair%%|*}" = "$b" ]; then declared="${pair##*|}"; fi
  done
  if [ -z "$declared" ]; then
    red "$b is neither a CMake gate target (forge_desktop_$stem) nor declared in AD_HOC with the runner that compiles it — so nothing here can say whether it ever runs"
  elif [ ! -f "$TEST_DIR/$declared" ]; then
    red "$b is declared ad hoc but its runner $declared does not exist"
  fi
done

# ── 3. every ad-hoc runner is invoked on a real workflow line ────────────────
# Comment lines are stripped first: kernel-tests.yml is 67% comments and a
# script named only in prose is a script nobody runs.
for pair in "${AD_HOC[@]}"; do
  runner="${pair##*|}"
  hits=0
  if [ -d "$WORKFLOW_DIR" ]; then
    hits=$(cat "$WORKFLOW_DIR"/*.yml 2>/dev/null | sed 's/^[[:space:]]*#.*$//' \
           | grep -cF "$runner") || hits=0
  fi
  if [ "$hits" -eq 0 ]; then
    red "$runner compiles a gate ad hoc but is not invoked on any executable line of any workflow — it never runs on a pull request"
  fi
done

# ── verdict ──────────────────────────────────────────────────────────────────
n_built=$(printf '%s\n' "$BUILT" | grep -c . ) || n_built=0
n_run=$(printf '%s\n' "$RUN" | grep -c . ) || n_run=0
n_adhoc=${#AD_HOC[@]}

if [ "$FAIL" -ne 0 ]; then
  echo "[gate-reg] FAILED — see the RED lines above"
  exit 1
fi
echo "[gate-reg] $n_built CMake gate targets, all $n_run executed by run_desktop.sh; $n_adhoc ad-hoc gates, each with a runner invoked by a workflow"
printf '%s\n' "$BUILT" | sed 's/^/[gate-reg]   built+run  /'
for pair in "${AD_HOC[@]}"; do printf '[gate-reg]   ad-hoc     %s (via %s)\n' "${pair%%|*}" "${pair##*|}"; done
echo "[gate-reg] EVERY FORGE-DESKTOP GATE IS WIRED IN"
