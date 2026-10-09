#!/usr/bin/env bash
# gate_result_selftest.sh — prove forge.gate_result/v1 can say NO.
#
# A schema that can only ever be filled in green is decoration. Every case below
# drives the REAL scripts (gate_result.sh, release_gate_results.sh), and the
# mutation section re-runs the cases against copies with one defence removed
# and REQUIRES each copy to be caught -- a mutant that survives fails this file.
#
#   bash tools/gates/gate_result_selftest.sh
#
# Text processing only: bash, jq, perl. No network, no compiler, ~10 s.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.." || exit 2
ROOT="$PWD"
GR_SHIPPED="$ROOT/tools/gates/gate_result.sh"
RGR_SHIPPED="$ROOT/tools/gates/release_gate_results.sh"
REG_SHIPPED="$ROOT/tools/gates/ratchet_gates.txt"
W="$(mktemp -d "${TMPDIR:-/tmp}/gr_selftest.XXXXXX")"; trap 'rm -rf "$W"' EXIT
SHA=0123456789abcdef0123456789abcdef01234567
export GITHUB_SHA="$SHA"
unset FORGE_GATE_RESULTS GITHUB_STEP_SUMMARY

# cases <gate_result.sh> <release_gate_results.sh dir> -> prints ok/FAIL lines,
# returns the number of FAILED checks. Used on the shipped scripts (must be 0)
# and on every mutant (must be > 0).
cases() {
  local G="$1" RDIR="$2" D; D="$(mktemp -d "$W/c.XXXX")"
  local fails=0
  ck() { if [ "$2" = "$3" ]; then echo "    ok    $1"; else echo "    FAIL  $1 (wanted '$2', got '$3')"; fails=$((fails+1)); fi; }
  acc() { jq -r "select(.gate==\"$1\") | .acceptance" "$2" | tail -1; }
  st()  { jq -r "select(.gate==\"$1\") | .status" "$2" | tail -1; }
  local IN="$G" R="$D/r.jsonl"

  # 1 ★ the ratchet rule at the PRODUCER: a ratchet at zero misses still cannot accept
  bash "$G" emit --gate c.ratchet0 --kind ratchet --status PASSED --exit-code 0 --known-misses 0 --input "$IN" --out "$R" 2>/dev/null
  ck "1  ratchet PASSED, 0 known misses -> acceptance=false" false "$(acc c.ratchet0 "$R")"
  bash "$G" emit --gate c.ratchet2 --kind ratchet --status PASSED --exit-code 0 --known-misses 2 --known-blocked 1 --input "$IN" --out "$R" 2>/dev/null
  ck "1b ratchet PASSED, 2 misses + 1 blocked -> acceptance=false" false "$(acc c.ratchet2 "$R")"
  bash "$G" emit --gate c.hard --kind hard --status PASSED --exit-code 0 --input "$IN" --out "$R" 2>/dev/null
  ck "1c (control) hard gate PASSED -> acceptance=true" true "$(acc c.hard "$R")"

  # 2 ★ the ratchet rule at the CHECKER: a hand-edited "acceptance": true is invalid
  jq -c 'select(.gate=="c.ratchet0") | .acceptance = true' "$R" > "$D/forged.jsonl"
  bash "$G" validate "$D/forged.jsonl" > "$D/v2.out" 2>&1; ck "2  forged ratchet acceptance=true is REJECTED" 1 $?
  # 2b a PASSED hard gate quietly downgraded is ALSO a disagreement, not a choice
  jq -c 'select(.gate=="c.hard") | .acceptance = false' "$R" > "$D/down.jsonl"
  bash "$G" validate "$D/down.jsonl" >/dev/null 2>&1; ck "2b hard gate with acceptance edited to false is REJECTED" 1 $?
  # 2c a NOT_RUN record forged to acceptance=true
  bash "$G" emit --gate c.nr --kind hard --status NOT_RUN --reason "skipped" --input "$IN" --out "$D/nr.jsonl" 2>/dev/null
  jq -c '.acceptance = true' "$D/nr.jsonl" > "$D/nrf.jsonl"
  bash "$G" validate "$D/nrf.jsonl" >/dev/null 2>&1; ck "2c forged NOT_RUN acceptance=true is REJECTED" 1 $?
  bash "$G" validate "$R" >/dev/null 2>&1; ck "2d (control) the honest records validate" 0 $?

  # 3 ★ a release verdict that REQUIRES a ratchet cannot be ACCEPTED
  bash "$G" verdict --require c.hard,c.ratchet0 "$R" >/dev/null 2>&1; ck "3  verdict over a ratchet -> NOT ACCEPTED" 1 $?
  bash "$G" verdict --require c.hard "$R" >/dev/null 2>&1;            ck "3b (control) verdict over a hard PASS -> ACCEPTED" 0 $?

  # 4 NOT_RUN must say why, and carries no exit code
  bash "$G" emit --gate c.nr2 --kind hard --status NOT_RUN --input "$IN" --out "$D/x.jsonl" >/dev/null 2>&1
  ck "4  NOT_RUN without --reason is refused" 2 $?
  bash "$G" emit --gate c.nr3 --kind hard --status NOT_RUN --reason r --exit-code 0 --input "$IN" --out "$D/x.jsonl" >/dev/null 2>&1
  ck "4b NOT_RUN with an exit code is refused" 2 $?

  # 5 acceptance is derived, never passed in; a ratchet must state its misses
  bash "$G" emit --gate c.a --kind hard --status PASSED --acceptance true --input "$IN" --out "$D/x.jsonl" >/dev/null 2>&1
  ck "5  --acceptance is refused" 2 $?
  bash "$G" emit --gate c.r --kind ratchet --status PASSED --exit-code 0 --input "$IN" --out "$D/x.jsonl" >/dev/null 2>&1
  ck "5b a ratchet without --known-misses is refused" 2 $?
  bash "$G" emit --gate c.p --kind hard --status PASSED --exit-code 1 --input "$IN" --out "$D/x.jsonl" >/dev/null 2>&1
  ck "5c PASSED with exit code 1 is refused" 2 $?

  # 7 aggregates: PASSED-but-not-accepted components must not roll up to acceptance
  bash "$G" aggregate --gate c.agg --component c.hard,c.ratchet0 --from "$R" --out "$D/agg.jsonl" 2>/dev/null
  ck "7  aggregate(hard PASS, ratchet PASS@0) -> acceptance=false" false "$(acc c.agg "$D/agg.jsonl")"
  ck "7b ... and its status is still PASSED (nothing failed)" PASSED "$(st c.agg "$D/agg.jsonl")"
  cat "$R" "$D/agg.jsonl" | jq -c 'if .gate=="c.agg" then .acceptance=true else . end' > "$D/aggf.jsonl"
  bash "$G" validate "$D/aggf.jsonl" >/dev/null 2>&1; ck "7c forged aggregate acceptance=true is REJECTED" 1 $?
  bash "$G" aggregate --gate c.agg2 --component c.hard --from "$R" --out "$D/agg2.jsonl" 2>/dev/null
  ck "7d (control) aggregate(hard PASS) -> acceptance=true" true "$(acc c.agg2 "$D/agg2.jsonl")"

  # 8 a required gate with NO record is NOT_RUN, not a pass
  bash "$G" verdict --require c.hard,c.never_ran "$R" > "$D/v8.out" 2>&1; ck "8  missing required gate -> NOT ACCEPTED" 1 $?
  grep -q 'c.never_ran *NOT_RUN' "$D/v8.out"; ck "8b ... and it is reported as NOT_RUN" 0 $?
  bash "$G" aggregate --gate c.agg3 --component c.hard,c.never_ran --from "$R" --out "$D/agg3.jsonl" 2>/dev/null
  ck "8c aggregate with a missing component -> NOT_RUN" NOT_RUN "$(st c.agg3 "$D/agg3.jsonl")"

  # 9 `run` maps exit codes honestly and stays transparent
  bash "$G" run --gate c.f --kind hard --input "$IN" --out "$D/run.jsonl" -- bash -c 'exit 3' >/dev/null 2>&1
  ck "9  run: rc 3 is propagated" 3 $?
  ck "9b run: rc 3 -> FAILED" FAILED "$(st c.f "$D/run.jsonl")"
  bash "$G" run --gate c.b --kind hard --blocked-rc 3 --input "$IN" --out "$D/run.jsonl" -- bash -c 'exit 3' >/dev/null 2>&1
  ck "9c run: declared blocked rc -> BLOCKED" BLOCKED "$(st c.b "$D/run.jsonl")"
  bash "$G" run --gate c.k --kind ratchet --known-misses-from 'fail=([0-9]+)' --input "$IN" --out "$D/run.jsonl" \
    -- bash -c 'echo "TOTAL pass=10 fail=5"' >/dev/null 2>&1
  ck "9d run: ratchet misses read from output" 5 "$(jq -r 'select(.gate=="c.k") | .known_misses' "$D/run.jsonl")"
  bash "$G" run --gate c.ok --kind hard --input "$IN" --out "$D/run.jsonl" -- true >/dev/null 2>&1
  ck "9e (control) run: rc 0 -> PASSED" PASSED "$(st c.ok "$D/run.jsonl")"

  # 10 ★ THE RELEASE PATH. The exact shape T-185 measured: archdisc push, kernel-tests
  #    cancelled (kgate=skip), publish and acceptance SKIPPED, job green.
  local RO="$D/rel_skip.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=push GR_REF=refs/heads/archdisc GR_REF_TYPE=branch \
      GR_MODE=auto GR_KGATE=skip GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=skipped \
      GR_ACCEPT=skipped GR_KERNEL_DIR="$D/none" bash "$RDIR/release_gate_results.sh" ) >/dev/null 2>&1
  ck "10  release with kgate=skip: recorder exits 0 (the job stays green)" 0 $?
  ck "10b ... release.publish is NOT_RUN" NOT_RUN "$(st release.publish "$RO")"
  ck "10c ... release.live_acceptance is NOT_RUN" NOT_RUN "$(st release.live_acceptance "$RO")"
  ck "10d ... release.acceptance is NOT accepted" false "$(acc release.acceptance "$RO")"
  ck "10e ... and reads NOT_RUN, not PASSED" NOT_RUN "$(st release.acceptance "$RO")"

  # 11 ★ kernel-tests GREEN, ratchets holding known misses, publish + live acceptance ran.
  mkdir -p "$D/k/gate-results-kernel" "$D/k/gate-results-s0"
  bash "$G" emit --gate kernel.nafems_accuracy --kind ratchet --status PASSED --exit-code 0 --known-misses 2 \
    --known-blocked 1 --input "$IN" --out "$D/k/gate-results-kernel/kernel.jsonl" 2>/dev/null
  bash "$G" emit --gate kernel.s0_conformance --kind ratchet --status PASSED --exit-code 0 --known-misses 5 \
    --input "$IN" --out "$D/k/gate-results-s0/s0_conformance.jsonl" 2>/dev/null
  RO="$D/rel_go.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=push GR_REF=refs/heads/archdisc GR_MODE=auto GR_KGATE=go \
      GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=success GR_ACCEPT=success GR_KERNEL_DIR="$D/k" \
      bash "$RDIR/release_gate_results.sh" ) >/dev/null 2>&1
  ck "11  published release over known-miss ratchets: recorder exits 0" 0 $?
  ck "11b ... release.acceptance status PASSED (nothing failed)" PASSED "$(st release.acceptance "$RO")"
  ck "11c ... but acceptance=false (ratchets hold known misses)" false "$(acc release.acceptance "$RO")"
  ck "11d ... and the known misses are carried (2 NAFEMS + 5 s0)" 7 "$(jq -r 'select(.gate=="release.acceptance") | .known_misses' "$RO")"

  # 12 (control: the arms DIFFER) every component a hard PASS -> ACCEPTED.
  #    kernel.s0_conformance and kernel.nafems_accuracy are REGISTERED ratchets
  #    (ratchet_gates.txt), so a hard record for them is refused. The only route to
  #    a hard verdict is the reviewed one: remove the entry from the registry. This
  #    control runs a copy of the scripts whose registry has had that review.
  local CONV="$D/converted"; mkdir -p "$CONV"
  cp "$G" "$CONV/gate_result.sh"; cp "$RDIR/release_gate_results.sh" "$CONV/"
  grep -vE '^kernel\.(s0_conformance|nafems_accuracy)[[:space:]]' "$(dirname "$G")/ratchet_gates.txt" \
    > "$CONV/ratchet_gates.txt" 2>/dev/null
  mkdir -p "$D/k2/gate-results-x"
  bash "$CONV/gate_result.sh" emit --gate kernel.nafems_accuracy --kind hard --status PASSED --exit-code 0 --input "$IN" --out "$D/k2/gate-results-x/k.jsonl" 2>/dev/null
  bash "$CONV/gate_result.sh" emit --gate kernel.s0_conformance --kind hard --status PASSED --exit-code 0 --input "$IN" --out "$D/k2/gate-results-x/k.jsonl" 2>/dev/null
  RO="$D/rel_clean.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=push GR_REF=refs/heads/archdisc GR_MODE=auto GR_KGATE=go \
      GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=success GR_ACCEPT=success GR_KERNEL_DIR="$D/k2" \
      bash "$CONV/release_gate_results.sh" ) >/dev/null 2>&1
  ck "12  (control) all hard PASS, ratchets converted by a registry review -> release ACCEPTED" true "$(acc release.acceptance "$RO")"
  # ... and the SAME records, judged by the scripts as shipped, are refused.
  RO="$D/rel_clean_shipped.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=push GR_REF=refs/heads/archdisc GR_MODE=auto GR_KGATE=go \
      GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=success GR_ACCEPT=success GR_KERNEL_DIR="$D/k2" \
      bash "$RDIR/release_gate_results.sh" ) >/dev/null 2>&1
  ck "12b ... the same hard records under the shipped registry -> release NOT accepted" false "$(acc release.acceptance "$RO")"
  ck "12c ... and the relabelled s0 record is NOT copied: s0 reads NOT_RUN" NOT_RUN "$(st kernel.s0_conformance "$RO")"

  # 13 kernel records never fetched -> those components NOT_RUN -> not accepted
  RO="$D/rel_nok.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=push GR_REF=refs/heads/archdisc GR_MODE=auto GR_KGATE=go \
      GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=success GR_ACCEPT=success \
      bash "$RDIR/release_gate_results.sh" ) >/dev/null 2>&1
  ck "13  kernel records absent -> release NOT accepted" false "$(acc release.acceptance "$RO")"
  ck "13b ... reads NOT_RUN" NOT_RUN "$(st release.acceptance "$RO")"
  ck "13c ... and the absent kernel gate is an EXPLICIT NOT_RUN record" NOT_RUN "$(st kernel.nafems_accuracy "$RO")"
  ck "13d ... which says why" 1 "$(jq -r 'select(.gate=="kernel.nafems_accuracy") | (.reason | length > 20)' "$RO" | grep -c true)"
  # 11 again: when the producer's record IS there, nothing is invented beside it.
  ck "13e (control) a fetched record is not shadowed by an invented NOT_RUN" 1 \
     "$(jq -r 'select(.gate=="kernel.nafems_accuracy") | .status' "$D/rel_go.jsonl" | grep -c .)"

  # 14 a dispatch dry run is never a release
  RO="$D/rel_dry.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=workflow_dispatch GR_REF=refs/heads/archdisc GR_MODE=dryrun \
      GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=skipped GR_ACCEPT=skipped \
      bash "$RDIR/release_gate_results.sh" ) >/dev/null 2>&1
  ck "14  dispatch dry run -> release.publish NOT_RUN" NOT_RUN "$(st release.publish "$RO")"
  ck "14b ... release NOT accepted" false "$(acc release.acceptance "$RO")"

  # 15 ★ THE SHAPE MEASURED ON ALL 8 RECENT archdisc RUNS (35359967943..35414490107):
  #    FORGE_AUTORELEASE=off -> mode=brake, kgate never asked, publish + acceptance
  #    skipped, job SUCCESS. Every release component must read NOT_RUN, not PASSED.
  RO="$D/rel_brake.jsonl"
  ( cd "$ROOT" && env FORGE_GATE_RESULTS="$RO" GR_EVENT=push GR_REF=refs/heads/archdisc GR_REF_TYPE=branch \
      GR_MODE=brake GR_KGATE= GR_BUILD=success GR_SELFCONTAINED=success GR_PUBLISH=skipped GR_ACCEPT=skipped \
      bash "$RDIR/release_gate_results.sh" ) >/dev/null 2>&1
  ck "15  brake run (the measured shape): recorder exits 0" 0 $?
  ck "15b ... release.kernel_gate NOT_RUN" NOT_RUN "$(st release.kernel_gate "$RO")"
  ck "15c ... release.publish NOT_RUN" NOT_RUN "$(st release.publish "$RO")"
  ck "15d ... release.acceptance NOT accepted" false "$(acc release.acceptance "$RO")"
  jq -r 'select(.gate=="release.publish") | .reason' "$RO" | grep -q 'brake'
  ck "15e ... and the publish record names the brake as the reason" 0 $?

  # 16 ★ A RATCHET CANNOT ACCEPT BY CALLING ITSELF HARD. `kind` is declared by the
  #    caller, so "a ratchet never accepts" held only for ratchets that SAID so.
  #    MEASURED at 14f4a277: `run --gate kernel.s0_conformance --kind hard` over
  #    "[s0-ratchet] pass=70 fail=5" recorded acceptance=true, validated, and
  #    `verdict` printed ACCEPTED. Three independent defences, each tested here.
  #    (a) the PRODUCER refuses a registered ratchet id under any other kind
  bash "$G" emit --gate kernel.s0_conformance --kind hard --status PASSED --exit-code 0 --input "$IN" \
    --out "$D/x16.jsonl" >/dev/null 2>&1
  ck "16  emit: registered ratchet kernel.s0_conformance as kind=hard is refused" 2 $?
  bash "$G" emit --gate kernel.nafems_accuracy --kind selftest --status NOT_RUN --reason r --input "$IN" \
    --out "$D/x16.jsonl" >/dev/null 2>&1
  ck "16b emit: ... under ANY non-ratchet kind (selftest, NOT_RUN) too" 2 $?
  #    (b) the CHECKER rejects such a record however it was written -- a hand-made
  #    one that is otherwise perfectly self-consistent (hard, PASSED, 0 misses,
  #    acceptance=true agrees with the derivation for a HARD gate).
  jq -c 'select(.gate=="kernel.s0_conformance") | .kind="hard" | .known_misses=0 | .known_blocked=null | .acceptance=true' \
    "$D/k/gate-results-s0/s0_conformance.jsonl" > "$D/relabel.jsonl"
  bash "$G" validate "$D/relabel.jsonl" > "$D/v16.out" 2>&1; ck "16c validate: a registered ratchet recorded as hard is REJECTED" 1 $?
  grep -q 'registered RATCHET' "$D/v16.out"; ck "16d ... and the defect names the registry" 0 $?
  bash "$G" verdict --require kernel.s0_conformance "$D/relabel.jsonl" >/dev/null 2>&1
  ck "16e verdict over the relabelled record -> NOT ACCEPTED" 1 $?
  #    (c) `run` refuses to record a RATCHET SCRIPT under a non-ratchet kind, and
  #    refuses BEFORE running it (a misconfigured step is not a measurement).
  printf '#!/usr/bin/env bash\ntouch "%s/ran16"\necho "pass=9 fail=4"\n' "$D" > "$D/probe_ratchet.sh"
  bash "$G" run --gate c.unregistered --kind hard --input "$IN" --out "$D/x16.jsonl" -- bash "$D/probe_ratchet.sh" >/dev/null 2>&1
  ck "16f run: an unregistered id over a *ratchet* script as kind=hard is refused" 2 $?
  ck "16g ... before the script ran" no "$( [ -e "$D/ran16" ] && echo yes || echo no )"
  bash "$G" run --gate c.unregistered --kind ratchet --known-misses-from 'fail=([0-9]+)' --input "$IN" \
    --out "$D/x16.jsonl" -- bash "$D/probe_ratchet.sh" >/dev/null 2>&1
  ck "16h (control) the same script as kind=ratchet runs, rc 0" 0 $?
  ck "16i (control) ... and records acceptance=false with its 4 misses" "false 4" \
     "$(jq -r 'select(.gate=="c.unregistered") | "\(.acceptance) \(.known_misses)"' "$D/x16.jsonl" | tail -1)"
  #    (d) every kernel ratchet the RELEASE requires is in the registry, so the
  #    release path cannot be handed a hard s0/NAFEMS record either (12b/12c).
  local req missing=""
  for req in $(sed -n 's/^KERNEL_REQUIRED="\(.*\)"$/\1/p' "$RDIR/release_gate_results.sh"); do
    grep -qE "^${req//./\\.}[[:space:]]" "$(dirname "$G")/ratchet_gates.txt" 2>/dev/null || missing="$missing $req"
  done
  ck "16j every release-required kernel ratchet is registered" "" "$missing"
  #    (e) the registry is FAIL-CLOSED: without it nothing can be judged.
  local NOREG="$D/noreg"; mkdir -p "$NOREG"; cp "$G" "$NOREG/gate_result.sh"
  bash "$NOREG/gate_result.sh" emit --gate c.hard2 --kind hard --status PASSED --exit-code 0 --input "$IN" \
    --out "$D/x16.jsonl" >/dev/null 2>&1
  ck "16k a missing ratchet registry refuses to emit (fail closed)" 2 $?
  bash "$NOREG/gate_result.sh" validate "$R" >/dev/null 2>&1
  ck "16l ... and refuses to validate" 2 $?

  return "$fails"
}

echo "[gate-result-selftest] the shipped scripts"
cases "$GR_SHIPPED" "$ROOT/tools/gates"; SHIP_FAILS=$?
echo "[gate-result-selftest] shipped: $SHIP_FAILS failed check(s)"

# ── MUTATIONS. Each removes ONE defence; the cases above must catch every one.
# A mutant is a copy in a temp tools/gates/ so release_gate_results.sh finds the
# mutated gate_result.sh beside it, exactly as it finds the shipped one.
mutate() { # mutate <name> <perl substitution>
  local name="$1" expr="$2" d; d="$(mktemp -d "$W/m.XXXX")"
  cp "$GR_SHIPPED" "$RGR_SHIPPED" "$REG_SHIPPED" "$d/"
  perl -0pi -e "$expr" "$d/gate_result.sh"
  if cmp -s "$GR_SHIPPED" "$d/gate_result.sh"; then
    echo "    FAIL  mutant '$name' changed NOTHING -- it cannot prove anything"; return 1
  fi
  # A mutant must remove ONE defence, not break the script: it still has to emit
  # and validate an honest hard-gate record, or it is caught for the wrong reason.
  if ! bash "$d/gate_result.sh" emit --gate m.sane --kind hard --status PASSED --exit-code 0 \
         --input "$d/gate_result.sh" --out "$d/sane.jsonl" >/dev/null 2>&1 \
     || ! bash "$d/gate_result.sh" validate "$d/sane.jsonl" >/dev/null 2>&1; then
    echo "    FAIL  mutant '$name' BROKE the script instead of removing one defence"; return 1
  fi
  local n; cases "$d/gate_result.sh" "$d" > "$d/log" 2>&1; n=$?
  if [ "$n" -gt 0 ]; then echo "    ok    mutant '$name' caught by $n check(s)"; return 0; fi
  echo "    FAIL  mutant '$name' SURVIVED every case"; return 1
}
echo "[gate-result-selftest] mutations (each must be caught)"
MUT_FAILS=0
mutate "ratchets may accept"            's/\n  and \(\.kind != "ratchet"\)//'                         || MUT_FAILS=$((MUT_FAILS+1))
mutate "checker trusts the producer"    's/then "a RATCHET claims acceptance"/then empty/; s/then "acceptance disagrees with the derivation rule"/then empty/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "NOT_RUN needs no reason"        's/\[ -n "\$reason" \] \|\| die "emit: status \$status needs a --reason"/:/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "a missing gate counts as PASS"  's/\\tNOT_RUN\\tfalse\\t-\\tno record/\\tPASSED\\ttrue\\t-\\tno record/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "aggregate trusts PASSED"        's/misses=1; reason="\$\{reason:-a component is not accepted\}"/:/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "run calls every rc a PASS"      's/\[ "\$rc" -eq 0 \] && status=PASSED/status=PASSED/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "an absent component is fine"    's/\{gate:\$c, status:"NOT_RUN", acceptance:false/{gate:\$c, status:"PASSED", acceptance:true/' || MUT_FAILS=$((MUT_FAILS+1))
# T-185 round 2: a ratchet must not escape the rule by declaring another kind.
mutate "emit trusts the declared kind"  's/\n  refuse_relabelled_ratchet "\$gate" "\$kind" emit//' || MUT_FAILS=$((MUT_FAILS+1))
mutate "validate ignores the registry"  's/then "registered RATCHET [^"]*"/then empty/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "run trusts a ratchet command"   's/case "\$w" in \*ratchet\*\)/case "\$w" in *NEVER-MATCHES*)/' || MUT_FAILS=$((MUT_FAILS+1))
mutate "a missing registry is empty"    's/\[ -f "\$REGISTRY" \] \|\| die "ratchet registry/[ -f "\$REGISTRY" ] || return 0; : "ratchet registry/' || MUT_FAILS=$((MUT_FAILS+1))

echo "[gate-result-selftest] shipped failures=$SHIP_FAILS  surviving/no-op mutants=$MUT_FAILS"
if [ "$SHIP_FAILS" -eq 0 ] && [ "$MUT_FAILS" -eq 0 ]; then
  echo "[gate-result-selftest] GREEN -- the schema says NO when it should, and every defence is load-bearing"
  exit 0
fi
echo "[gate-result-selftest] RED"
exit 1
