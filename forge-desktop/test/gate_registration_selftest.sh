#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# gate_registration_selftest.sh — PROVE gate_registration_check.sh CAN FAIL.
#
# The check it drives is a comparison between two hand-maintained lists. A
# comparison that has never been seen to disagree is indistinguishable from a
# script that prints its verdict and exits 0, and this repository has shipped
# exactly that shape before. So every documented red path is driven here against
# a stub tree built in a temp directory — no compiler, no repository state
# touched, ~1 second — plus one GREEN case, without which this suite would pass
# equally well against a check that always exits 1.
#
# Each case asserts the EXIT STATUS and that the failure names the right thing,
# so a check that went red for an unrelated reason does not count as proof.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK="$HERE/gate_registration_check.sh"
PASS=0; FAIL=0

if [ ! -x "$CHECK" ]; then
  echo "[gate-reg-selftest] RED: $CHECK missing or not executable"; exit 1
fi

# Build a stub repo. $1 = dir. Remaining args select the defect to inject.
make_tree() {
  local d="$1"; local defect="${2:-none}"
  mkdir -p "$d/forge-desktop/test" "$d/.github/workflows"

  # two ordinary gates, both built and both run
  cat > "$d/forge-desktop/CMakeLists.txt" <<'CM'
add_executable(forge_desktop main.cpp)
add_executable(forge_desktop_alpha_gate test/alpha_gate.cpp)
add_executable(forge_desktop_beta_gate test/beta_gate.cpp)
CM
  cat > "$d/forge-desktop/test/run_desktop.sh" <<'RD'
run_gate() { :; }
run_gate forge_desktop_alpha_gate 1 2
run_gate forge_desktop_beta_gate 1
RD
  : > "$d/forge-desktop/test/alpha_gate.cpp"
  : > "$d/forge-desktop/test/beta_gate.cpp"
  # the ad-hoc pair the real check hardcodes
  : > "$d/forge-desktop/test/differential_solid_gate.cpp"
  : > "$d/forge-desktop/test/appcast_check.cpp"
  : > "$d/forge-desktop/test/run_differential_solid_gate.sh"
  : > "$d/forge-desktop/test/appcast_selftest.sh"
  cat > "$d/.github/workflows/ci.yml" <<'WF'
jobs:
  x:
    steps:
      - run: bash forge-desktop/test/run_differential_solid_gate.sh
      - run: bash forge-desktop/test/appcast_selftest.sh
WF

  case "$defect" in
    none) ;;
    orphan)      # built, never run
      sed -i.bak '/beta_gate 1/d' "$d/forge-desktop/test/run_desktop.sh" ;;
    phantom)     # run, never built
      sed -i.bak '/beta_gate/d' "$d/forge-desktop/CMakeLists.txt" ;;
    varname)     # add_executable whose name is a variable
      echo 'add_executable(${GATE_NAME} x.cpp)' >> "$d/forge-desktop/CMakeLists.txt" ;;
    hidden_call) # an invocation indented into a conditional
      printf 'if true; then\n  run_gate forge_desktop_gamma_gate 1\nfi\n' \
        >> "$d/forge-desktop/test/run_desktop.sh" ;;
    unaccounted) # a gate source that is neither a target nor ad hoc
      : > "$d/forge-desktop/test/prose_gate.cpp" ;;
    adhoc_runner_gone)
      rm -f "$d/forge-desktop/test/run_differential_solid_gate.sh" ;;
    adhoc_stale)   # the AD_HOC entry describes a tree that no longer exists
      rm -f "$d/forge-desktop/test/run_differential_solid_gate.sh" \
            "$d/forge-desktop/test/differential_solid_gate.cpp" ;;
    adhoc_only_in_comment)
      cat > "$d/.github/workflows/ci.yml" <<'WF2'
jobs:
  x:
    steps:
      # we used to run forge-desktop/test/run_differential_solid_gate.sh here
      - run: bash forge-desktop/test/appcast_selftest.sh
WF2
      ;;
    no_run_desktop) rm -f "$d/forge-desktop/test/run_desktop.sh" ;;
  esac
}

# $1 = label, $2 = defect, $3 = expected rc, $4 = regex the output must match
case_() {
  local label="$1" defect="$2" want_rc="$3" want_re="$4"
  local d; d="$(mktemp -d)"
  make_tree "$d" "$defect"
  local out rc
  out="$(FORGE_DESKTOP_ROOT="$d" GITHUB_ACTIONS= bash "$CHECK" 2>&1)"; rc=$?
  local ok=1
  [ "$rc" -eq "$want_rc" ] || ok=0
  printf '%s' "$out" | grep -qE "$want_re" || ok=0
  if [ "$ok" -eq 1 ]; then
    printf '  ok    %-26s rc=%s\n' "$label" "$rc"; PASS=$((PASS+1))
  else
    printf '  FAIL  %-26s rc=%s (wanted %s matching /%s/)\n' "$label" "$rc" "$want_rc" "$want_re"
    printf '%s\n' "$out" | sed 's/^/          | /'
    FAIL=$((FAIL+1))
  fi
  rm -rf "$d"
}

echo "[gate-reg-selftest] driving gate_registration_check.sh's documented paths"

case_ "green (control)"        none                  0 'EVERY FORGE-DESKTOP GATE IS WIRED IN'
case_ "built but never run"    orphan                1 'beta_gate is BUILT .* never executed'
case_ "run but never built"    phantom               1 'executes forge_desktop_beta_gate but .* does not build it'
case_ "add_executable(\$VAR)"   varname               1 'only [0-9]+ name a literal target'
case_ "run_gate hidden in if"  hidden_call           1 'mentions run_gate .* only .* column-0'
case_ "gate source unaccounted" unaccounted          1 'prose_gate.cpp is neither a CMake gate target'
case_ "ad-hoc runner missing"  adhoc_runner_gone     1 'runner run_differential_solid_gate.sh does not exist'
case_ "AD_HOC list is stale"   adhoc_stale           1 'AD_HOC names run_differential_solid_gate.sh .* the list is stale'
case_ "ad-hoc only in comment" adhoc_only_in_comment 1 'not invoked on any executable line'
case_ "run_desktop.sh absent"  no_run_desktop        1 'run_desktop.sh is missing'

echo "[gate-reg-selftest] $PASS passed, $FAIL failed"
if [ "$FAIL" -ne 0 ]; then
  echo "[gate-reg-selftest] RED — the registration check does not fail where it claims to"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error::gate_registration_check.sh did not fail on $FAIL of its documented red paths"
  exit 1
fi
echo "[gate-reg-selftest] GREEN — all $PASS cases behaved as documented (9 red paths + 1 green control)"
