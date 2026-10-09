#!/usr/bin/env bash
# run_nurbs_input_validation_gate.sh — T-153: an assert() is not input validation.
#
# Builds and runs forge-kernel/test/nurbs_input_validation_gate.cpp, which feeds
# malformed NURBS input (zero / negative / NaN / inf weights, non-monotone and
# non-finite knots, degree vs control-point count, empty spans and domains,
# ragged nets, non-finite parameters) to the native evaluator and asserts a
# typed REFUSAL. Pure C++ + bash: no node, no CMake, no OCCT.
#
# STEPS (each prints PASS/FAIL; exit 0 iff every step that ran passed)
#   battery     (always) gate + Nurbs.cpp, -O2 -DNDEBUG (the SHIPPED config —
#               every assert compiled out) AND -O1 with asserts LIVE. Both green.
#   --pre REF   FAILING-FIRST: the same gate compiled against Nurbs.hpp/.cpp from
#               git REF (e.g. the merge-base) must go RED in both builds.
#   --mutants   each guard deleted in turn from a copy of Nurbs.cpp; every mutant
#               must turn the battery RED on its named killer case. M1 is A1's
#               proof: the zero-weight guards removed -> the gate names the NaN.
#   --ab REF    valid input is BIT-IDENTICAL: --dump-valid from REF vs this tree
#               (cmp), plus a perturbed-evaluator CONTROL that must differ.
#   --bench REF ns/eval, REF vs this tree, min of 5 interleaved runs (report only).
#   --readers   the IMPORT BOUNDARY, portable (no corpus): compiles every
#               forge-kernel/src/native TU (NDEBUG and asserts live), links the
#               gate with -DNURBS_GATE_READERS and runs synthetic STEP + IGES
#               files, one corrupt B-spline each; every one must be refused under
#               its NAMED unsupported key, no evaluator may see it, and the valid
#               controls must import cleanly. With --pre REF it must FAIL on REF's
#               sources; with --mutants a StepRead mutant (validate() reverted to
#               the pre-T-153 size-only check) must FAIL it.
#   --corpus    A2: the same linked gate over the 22-file fixture below (real
#               STEP files that reached the zero-denominator division). Needs the
#               archdisc-Models corpus ($CORPUS_ROOT); without it the step reports
#               NOT_RUN and the script exits 3 — never a silent pass. --pre and
#               --mutants apply as for --readers.
#   --residual  A3: every assert() left under forge-kernel/src/native, each
#               matched to a written justification below; an unjustified assert,
#               or a justification whose assert is gone, FAILS.
#   --all REF   everything above.
#
# ENV  OUT=<dir> build dir (default: a temp dir, removed on exit unless KEEP=1)
#      CXX (default clang++, else c++)   JOBS (default 6)
#      CORPUS_ROOT (default <repo>/../archdisc-Models)
#
# Exit: 0 all ran steps passed / 1 a step failed / 2 usage or build error /
#       3 everything that ran passed but --corpus could not run (no corpus).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KERNEL="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$KERNEL/.." && pwd)"
GATE_SRC="$KERNEL/test/nurbs_input_validation_gate.cpp"

PRE=""; AB=""; BENCH=""; DO_MUT=0; DO_CORPUS=0; DO_RESID=0; DO_READERS=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pre)      PRE="${2:?--pre needs a git ref}"; shift ;;
    --ab)       AB="${2:?--ab needs a git ref}"; shift ;;
    --bench)    BENCH="${2:?--bench needs a git ref}"; shift ;;
    --mutants)  DO_MUT=1 ;;
    --corpus)   DO_CORPUS=1 ;;
    --readers)  DO_READERS=1 ;;
    --residual) DO_RESID=1 ;;
    --all)      PRE="${2:?--all needs a git ref}"; AB="$2"; BENCH="$2"; DO_MUT=1; DO_CORPUS=1; DO_RESID=1; DO_READERS=1; shift ;;
    -h|--help)  awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *)          echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -n "${CXX:-}" ]; then :; elif command -v clang++ >/dev/null 2>&1; then CXX=clang++; else CXX=c++; fi
JOBS="${JOBS:-6}"
CORPUS_ROOT="${CORPUS_ROOT:-$REPO/../archdisc-Models}"
if [ -n "${OUT:-}" ]; then mkdir -p "$OUT" || exit 2; else
  OUT="$(mktemp -d "${TMPDIR:-/tmp}/t153_nurbs_gate.XXXXXX")" || exit 2
  [ "${KEEP:-0}" = 1 ] || trap 'rm -rf "$OUT"' EXIT
fi
OUT="$(cd "$OUT" && pwd)"
INC="$KERNEL/include"
REL_FLAGS="-std=c++20 -O2 -DNDEBUG -Wall -Wextra -Werror"
DBG_FLAGS="-std=c++20 -O1 -g -Wall -Wextra -Werror"
FAILED=0; NOT_RUN=0
step() { printf '\n== %s\n' "$*"; }
pass() { printf 'PASS  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILED=1; }
echo "[t153] kernel=$KERNEL out=$OUT cxx=$($CXX --version 2>/dev/null | head -1)"

# Build the battery: $1 out-binary, $2 flags, $3 include dir, $4 Nurbs.cpp
build_gate() {
  # shellcheck disable=SC2086
  $CXX $2 -I "$3" "$GATE_SRC" "$4" -o "$1" 2> "$1.build.log" || { echo "  build failed: $1"; tail -20 "$1.build.log"; return 1; }
}

# Extract Nurbs.hpp / Nurbs.cpp (+ the include tree they need) from a git ref.
extract_ref() {  # $1 ref, $2 dest
  mkdir -p "$2" || return 1
  git -C "$REPO" archive --format=tar "$1" forge-kernel/include forge-kernel/src/native 2>/dev/null \
    | tar -x -C "$2" || { echo "  cannot extract $1"; return 1; }
  [ -f "$2/forge-kernel/src/native/brep/Nurbs.cpp" ] || { echo "  $1 has no Nurbs.cpp"; return 1; }
}

# Literal line substitution: in $1 replace the ONE line exactly equal to $2 by
# $3 (empty $3 deletes it). Fails unless the line occurs exactly once, so a
# mutant can never silently not apply. ENVIRON avoids awk escape processing.
mut_line() {
  local f="$1" n
  n="$(PAT="$2" awk '$0 == ENVIRON["PAT"] { c++ } END { print c + 0 }' "$f")"
  [ "$n" = 1 ] || { echo "  mutant target found $n times (need 1): $2"; return 1; }
  PAT="$2" REP="$3" awk '$0 == ENVIRON["PAT"] { if (ENVIRON["REP"] != "") print ENVIRON["REP"]; next } { print }' "$f" > "$f.tmp" \
    && mv "$f.tmp" "$f"
}

# ---------------------------------------------------------------------------
# 1. battery, both builds, this tree
# ---------------------------------------------------------------------------
step "battery: this tree, -DNDEBUG (shipped) and asserts-live"
for v in rel dbg; do
  flags="$REL_FLAGS"; [ "$v" = dbg ] && flags="$DBG_FLAGS"
  if build_gate "$OUT/gate_$v" "$flags" "$INC" "$KERNEL/src/native/brep/Nurbs.cpp"; then
    "$OUT/gate_$v" > "$OUT/battery_$v.txt" 2> "$OUT/battery_$v.stderr"; rc=$?
    summary="$(tail -1 "$OUT/battery_$v.txt")"
    if [ "$rc" = 0 ]; then pass "battery[$v] exit=0  $summary"
    else fail "battery[$v] exit=$rc  $summary"; grep -v '^\[PASS\]' "$OUT/battery_$v.txt" | head -40; fi
  else fail "battery[$v] did not build"; fi
done

# ---------------------------------------------------------------------------
# 2. failing-first against REF
# ---------------------------------------------------------------------------
if [ -n "$PRE" ]; then
  step "failing-first: the same gate against $PRE ($(git -C "$REPO" rev-parse --short "$PRE" 2>/dev/null))"
  if extract_ref "$PRE" "$OUT/pre"; then
    for v in rel dbg; do
      flags="$REL_FLAGS"; [ "$v" = dbg ] && flags="$DBG_FLAGS"
      if build_gate "$OUT/gate_pre_$v" "$flags" "$OUT/pre/forge-kernel/include" "$OUT/pre/forge-kernel/src/native/brep/Nurbs.cpp"; then
        "$OUT/gate_pre_$v" > "$OUT/pre_$v.txt" 2> "$OUT/pre_$v.stderr"; rc=$?
        nfail="$(grep -c '^\[FAIL\]' "$OUT/pre_$v.txt")"; ncrash="$(grep -c '^\[CRASH\]' "$OUT/pre_$v.txt")"
        # family of each failing case, looked up from this tree's green battery (PASS
        # lines carry "name family"; FAIL lines carry the message instead).
        fams="$(grep -E '^\[(FAIL|CRASH)\]' "$OUT/pre_$v.txt" | awk '{print $2}' | sort -u \
               | awk 'FNR == NR { fam[$2] = $3; next } ($1 in fam) { print fam[$1] }' "$OUT/battery_rel.txt" - | sort -u | tr '\n' ' ')"
        if [ "$rc" != 0 ]; then
          pass "pre[$v] RED as required: exit=$rc  $(tail -1 "$OUT/pre_$v.txt")  failing families: $fams"
          for fam in weights knots degree empty-span shape; do
            echo "$fams" | grep -qw -- "$fam" || fail "pre[$v] family '$fam' did not fail on $PRE"
          done
        else fail "pre[$v] exit=0 on $PRE — the gate does not detect the defect"; fi
      else fail "pre[$v] gate did not build against $PRE"; fi
    done
  else fail "cannot extract $PRE"; fi
fi

# ---------------------------------------------------------------------------
# 3. mutants: each guard removed -> the battery must go red on its killer
# ---------------------------------------------------------------------------
# name | killer case | required text on a killer line ("" = any) | edits (line=>replacement, ;;-separated)
IFS= read -r -d '' MUTANTS <<'EOF' || true
M1_A1_zero_weight_guards|curve_zero_weight_all|the guard did not fire: NaN/inf passed as a point|        const NurbsInputError e = checkWeight(weights[idx]);=>        const NurbsInputError e = NurbsInputError::None;  // MUTANT;;        if (!std::isfinite(w) || w == 0.0) return NurbsInputError::DegenerateDenominator;=>;;        if (!finite3(out)) return NurbsInputError::NonFiniteResult;=>
M2_denominator_check|curve_extrapolated_zero_denominator||        if (!std::isfinite(w) || w == 0.0) return NurbsInputError::DegenerateDenominator;=>
M3_local_weight_check|curve_zero_weight_single||        const NurbsInputError e = checkWeight(weights[idx]);=>        const NurbsInputError e = NurbsInputError::None;  // MUTANT
M4_basis_window_monotone|curve_decreasing_knots||        if (i > lo && knots[i] < knots[i - 1]) return NurbsInputError::DecreasingKnots;=>
M5_findspan_empty_start_span|curve_unclamped_repeated_domain_start||        while (s < n && !(knots[degree] < knots[s + 1])) ++s;=>
M6_findspan_empty_end_span|curve_unclamped_repeated_domain_end||        while (s > degree && !(knots[s] < knots[n + 1])) --s;=>
M7_knot_multiplicity|curve_start_knot_run_exceeds_order||        if (run > p + 1) return NurbsInputError::KnotMultiplicityTooHigh;=>
M8_degree_vs_count|curve_degree_exceeds_points||    if (p >= count) return NurbsInputError::TooFewControlPoints;=>
M9_empty_domain|curve_empty_domain_all_knots_equal||    if (!(knots[p] < knots[count])) return NurbsInputError::EmptyParameterDomain;=>;;    if (!(a < b)) return NurbsInputError::EmptyParameterDomain;=>
M10_validate_curve_weights|curve_zero_weight_single||        const NurbsInputError e = checkWeight(wi);=>        const NurbsInputError e = NurbsInputError::None;  // MUTANT
M11_validate_surface_weights|surf_negative_weight||            const NurbsInputError e = checkWeight(weights[i][j]);=>            const NurbsInputError e = NurbsInputError::None;  // MUTANT
M12_bezier_weight_check|bezier_curve_negative_weight||        const NurbsInputError e = checkWeight(w);=>        const NurbsInputError e = NurbsInputError::None;  // MUTANT
M13_surface_row_shape|surf_ragged_row||        if (control[iu].size() != nV) return refuse(NurbsInputError::RaggedControlNet);=>
M14_nonfinite_parameter|curve_nan_parameter||    if (!std::isfinite(u)) return refuse(NurbsInputError::NonFiniteParameter);=>
M15_bezier_surface_weight_check|bezier_surface_negative_weight||            const NurbsInputError e = checkWeight(wij);=>            const NurbsInputError e = NurbsInputError::None;  // MUTANT
EOF
apply_edits() {  # $1 file, $2 edits string
  local rest="$2" one pat rep
  while [ -n "$rest" ]; do
    one="${rest%%;;*}"; [ "$one" = "$rest" ] && rest="" || rest="${rest#*;;}"
    pat="${one%%=>*}"; rep="${one#*=>}"
    mut_line "$1" "$pat" "$rep" || return 1
  done
}
if [ "$DO_MUT" = 1 ]; then
  step "mutants: each guard removed from a copy of Nurbs.cpp (-DNDEBUG)"
  mkdir -p "$OUT/mut"
  killed=0; total=0
  while IFS='|' read -r name killer need edits; do
    [ -n "$name" ] || continue
    total=$((total + 1))
    src="$OUT/mut/$name.cpp"; cp "$KERNEL/src/native/brep/Nurbs.cpp" "$src"
    if ! apply_edits "$src" "$edits"; then fail "$name: mutant did not apply"; continue; fi
    if cmp -s "$src" "$KERNEL/src/native/brep/Nurbs.cpp"; then fail "$name: mutant is identical to the source"; continue; fi
    if ! build_gate "$OUT/mut/$name" "-std=c++20 -O2 -DNDEBUG" "$INC" "$src"; then fail "$name: mutant did not build"; continue; fi
    "$OUT/mut/$name" > "$OUT/mut/$name.txt" 2>/dev/null; rc=$?
    klines="$(grep -E "^\[(FAIL|CRASH)\] +$killer " "$OUT/mut/$name.txt")"
    if [ "$rc" = 0 ]; then fail "$name SURVIVED (battery exit 0)"
    elif [ -z "$klines" ]; then fail "$name: battery red (exit $rc) but NOT on its killer $killer"
    elif [ -n "$need" ] && ! printf '%s\n' "$klines" | grep -qF -- "$need"; then
      fail "$name: $killer red but without '$need'"; printf '%s\n' "$klines" | head -3
    else
      killed=$((killed + 1))
      pass "$name killed (exit $rc) — $(printf '%s\n' "$klines" | head -1 | cut -c1-170)"
    fi
  done <<< "$MUTANTS"
  echo "  mutants killed: $killed / $total"
  [ "$killed" = "$total" ] || fail "not every mutant was killed"
  # the restore half of the proof: the unmutated source is green again
  "$OUT/gate_rel" > /dev/null 2>&1 && pass "restored source: battery green again" || fail "restored source is not green"
fi

# ---------------------------------------------------------------------------
# 4. A/B: valid input bit-identical to REF
# ---------------------------------------------------------------------------
if [ -n "$AB" ]; then
  step "A/B: valid-input evaluation bit-identical to $AB"
  if [ -d "$OUT/pre" ] || extract_ref "$AB" "$OUT/pre"; then
    build_gate "$OUT/ab_ref" "-std=c++20 -O2 -DNDEBUG" "$OUT/pre/forge-kernel/include" "$OUT/pre/forge-kernel/src/native/brep/Nurbs.cpp" &&
    build_gate "$OUT/ab_new" "-std=c++20 -O2 -DNDEBUG" "$INC" "$KERNEL/src/native/brep/Nurbs.cpp" || fail "A/B builds failed"
    "$OUT/ab_ref" --dump-valid "$OUT/ab_ref.txt" 2> "$OUT/ab_ref.n"; "$OUT/ab_new" --dump-valid "$OUT/ab_new.txt" 2> "$OUT/ab_new.n"
    nvals="$(sed -n 's/.*dump-valid: \([0-9]*\) values.*/\1/p' "$OUT/ab_new.n")"
    if cmp -s "$OUT/ab_ref.txt" "$OUT/ab_new.txt"; then
      pass "bit-identical over $nvals values (md5 $(md5sum "$OUT/ab_new.txt" 2>/dev/null | cut -d' ' -f1 || md5 -q "$OUT/ab_new.txt"))"
    else fail "valid-input evaluation CHANGED vs $AB"; diff "$OUT/ab_ref.txt" "$OUT/ab_new.txt" | head -10; fi
    # CONTROL: the instrument must see a 1-ulp-scale change, or 'identical' means nothing.
    cp "$KERNEL/src/native/brep/Nurbs.cpp" "$OUT/ab_control.cpp"
    if mut_line "$OUT/ab_control.cpp" "        out = Vec3{x / w, y / w, z / w};" "        out = Vec3{x / w, y / w, (z / w) * (1.0 + 1e-15)};  // CONTROL" &&
       build_gate "$OUT/ab_ctl" "-std=c++20 -O2 -DNDEBUG" "$INC" "$OUT/ab_control.cpp"; then
      "$OUT/ab_ctl" --dump-valid "$OUT/ab_ctl.txt" 2>/dev/null
      if cmp -s "$OUT/ab_ctl.txt" "$OUT/ab_new.txt"; then fail "A/B control: a perturbed evaluator was NOT detected"
      else pass "A/B control: perturbed evaluator differs on $(diff "$OUT/ab_ctl.txt" "$OUT/ab_new.txt" | grep -c '^<') lines"; fi
    else fail "A/B control did not build"; fi
  fi
fi

# ---------------------------------------------------------------------------
# 5. bench (report only)
# ---------------------------------------------------------------------------
if [ -n "$BENCH" ]; then
  step "bench: ns per raw evaluate(), $BENCH vs this tree (min of 5 interleaved)"
  if [ -d "$OUT/pre" ] || extract_ref "$BENCH" "$OUT/pre"; then
    [ -x "$OUT/ab_ref" ] || build_gate "$OUT/ab_ref" "-std=c++20 -O2 -DNDEBUG" "$OUT/pre/forge-kernel/include" "$OUT/pre/forge-kernel/src/native/brep/Nurbs.cpp"
    [ -x "$OUT/ab_new" ] || build_gate "$OUT/ab_new" "-std=c++20 -O2 -DNDEBUG" "$INC" "$KERNEL/src/native/brep/Nurbs.cpp"
    : > "$OUT/bench.txt"
    for i in 1 2 3 4 5; do
      echo "ref $("$OUT/ab_ref" --bench)" >> "$OUT/bench.txt"; echo "new $("$OUT/ab_new" --bench)" >> "$OUT/bench.txt"
    done
    for who in ref new; do
      c="$(grep "^$who " "$OUT/bench.txt" | sed 's/.*curve_ns_per_eval=\([0-9.]*\).*/\1/' | sort -g | head -1)"
      s="$(grep "^$who " "$OUT/bench.txt" | sed 's/.*surface_ns_per_eval=\([0-9.]*\).*/\1/' | sort -g | head -1)"
      echo "  $who: curve ${c} ns/eval, surface ${s} ns/eval"
    done
  fi
fi

# ---------------------------------------------------------------------------
# 6. A2: the 22 corpus files
# ---------------------------------------------------------------------------
# Every STEP file of the T-149 corpus (72,573 files) whose readForeignStep
# reached the evaluator's zero-denominator division. All 22 are under
# archdisc-Models/data/external/mmcad_b_raw (re-scanned 2026-10-08: 6,771 files,
# exactly these 22). Columns: path under $CORPUS_ROOT, the first offending
# B-spline entity, the NAMED refusal key readForeignStep must now report.
# MEASURED root cause, over all 111 B-spline entities these files now refuse:
# 60 curves empty_parameter_domain (all knots equal, e.g. 1258.step #5912
# degree 3, mults (4,4), knots (0.,0.)), 37 curves + 6 surfaces
# knot_multiplicity_too_high (degree 3, first knot repeated 6-9 times), 8 curves
# decreasing_knots (e.g. 142.step #8113 knots (1.23E-23, 0.)). Smallest weight
# among them 0.43: NOT ONE is a zero weight. Every zero-denominator hit the BASE
# evaluator took in these files (31 distinct signatures, T-153 evidence) was
# on such a zero-width knot span, where every basis function is 0 -> w == 0.
IFS= read -r -d '' FIXTURE <<'EOF' || true
data/external/mmcad_b_raw/extracted/step00000/1258.step	5912	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/142.step	8113	B_SPLINE_CURVE_WITH_KNOTS(decreasing_knots)
data/external/mmcad_b_raw/extracted/step00000/1436.step	7045	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/1493.step	10322	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/1494.step	10350	B_SPLINE_CURVE_WITH_KNOTS(decreasing_knots)
data/external/mmcad_b_raw/extracted/step00000/1578.step	24229	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/1747.step	4879	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/1899.step	504	B_SPLINE_SURFACE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/1962.step	15789	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/1975.step	5791	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/2014.step	5902	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/2132.step	2076	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/2194.step	23472	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/2272.step	21003	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/2340.step	27112	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/2422.step	17579	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/433.step	8350	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/448.step	7602	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/449.step	5950	B_SPLINE_CURVE_WITH_KNOTS(knot_multiplicity_too_high)
data/external/mmcad_b_raw/extracted/step00000/601.step	80620	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/602.step	80917	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
data/external/mmcad_b_raw/extracted/step00000/928.step	2971	B_SPLINE_CURVE_WITH_KNOTS(empty_parameter_domain)
EOF
compile_native() {  # $1 objdir, $2 flags, $3 kernel root -> $1/libnative.a
  local o="$1" flags="$2" k="$3" s obj pids=() fails="$1/fail"
  mkdir -p "$o/obj"; : > "$fails"
  for s in "$k"/src/native/*.cpp "$k"/src/native/*/*.cpp; do
    obj="$o/obj/$(basename "$(dirname "$s")")__$(basename "$s" .cpp).o"
    # shellcheck disable=SC2086
    { $CXX $flags -I "$k/include" -c "$s" -o "$obj" 2> "$obj.err" || echo "$s" >> "$fails"; } &
    pids+=("$!")
    if [ "${#pids[@]}" -ge "$JOBS" ]; then wait "${pids[0]}"; pids=("${pids[@]:1}"); fi
  done
  for s in "${pids[@]:-}"; do [ -n "$s" ] && wait "$s"; done
  [ -s "$fails" ] && { echo "  native compile failed:"; head -5 "$fails"; return 1; }
  rm -f "$o/libnative.a"; ar -crs "$o/libnative.a" "$o"/obj/*.o
}
# Build the reader-linked gate once per configuration: $1 label, $2 kernel root, $3 flags.
build_linked() {
  local d="$OUT/linked_$1"
  [ -x "$d/gate" ] && return 0
  compile_native "$d" "$3" "$2" || { fail "linked[$1]: native sources did not build"; return 1; }
  # shellcheck disable=SC2086
  $CXX $3 -DNURBS_GATE_READERS -I "$2/include" "$GATE_SRC" "$d/libnative.a" -o "$d/gate" 2> "$d/gate.build.log" \
    || { fail "linked[$1]: gate did not link"; tail -20 "$d/gate.build.log"; return 1; }
}
# $1 label, $2 mode (readers|corpus), $3 expect (pass|fail), $4 killer case ("" = any)
run_linked() {
  local d="$OUT/linked_$1" rc out
  [ -x "$d/gate" ] || { fail "$2[$1]: no gate binary"; return; }
  out="$d/$2.txt"
  if [ "$2" = readers ]; then "$d/gate" --readers > "$out" 2> "$d/$2.stderr"; rc=$?
  else "$d/gate" --corpus "$OUT/fixture.tsv" --root "$CORPUS_ROOT" > "$out" 2> "$d/$2.stderr"; rc=$?; fi
  if [ "$3" = pass ]; then
    if [ "$rc" = 0 ]; then pass "$2[$1] $(tail -1 "$out")"
    else fail "$2[$1] exit=$rc $(tail -1 "$out")"; grep -v '^\[PASS\]' "$out" | head -30; fi
  else
    if [ "$rc" = 0 ]; then fail "$2[$1] exit=0 — the check does not detect the defect"
    elif [ -n "$4" ] && ! grep -qE "^\[(FAIL|CRASH)\] +$4 " "$out"; then fail "$2[$1] red (exit $rc) but not on its killer $4"
    else pass "$2[$1] RED as required: exit=$rc  $(tail -1 "$out")  crash=$(grep -c '^\[CRASH\]' "$out") fail-lines=$(grep -c '^\[FAIL\]' "$out")"; fi
  fi
}
if [ "$DO_READERS" = 1 ] || [ "$DO_CORPUS" = 1 ]; then
  step "reader-linked gate: every forge-kernel/src/native TU, -DNDEBUG and asserts-live"
  build_linked cur_ndebug "$KERNEL" "-std=c++20 -O2 -DNDEBUG"
  build_linked cur_asserts "$KERNEL" "-std=c++20 -O1"
  if [ -n "$PRE" ] && [ -d "$OUT/pre" ]; then
    build_linked pre_ndebug "$OUT/pre/forge-kernel" "-std=c++20 -O2 -DNDEBUG"
    build_linked pre_asserts "$OUT/pre/forge-kernel" "-std=c++20 -O1"
  fi
  if [ "$DO_MUT" = 1 ]; then
    rm -rf "$OUT/mutk"; mkdir -p "$OUT/mutk/forge-kernel/src"
    cp -R "$KERNEL/include" "$OUT/mutk/forge-kernel/" && cp -R "$KERNEL/src/native" "$OUT/mutk/forge-kernel/src/"
    if mut_line "$OUT/mutk/forge-kernel/src/native/brep/StepRead.cpp" \
         "    const NurbsInputError defect = out.validate();" \
         "    const NurbsInputError defect = (out.knots.size() == out.controlPoints.size() + out.degree + 1) ? NurbsInputError::None : NurbsInputError::KnotCountMismatch;  // MUTANT: the pre-T-153 size-only check"; then
      build_linked mut_stepread "$OUT/mutk/forge-kernel" "-std=c++20 -O2 -DNDEBUG"
    else fail "StepRead mutant did not apply"; fi
  fi
fi
if [ "$DO_READERS" = 1 ]; then
  step "readers: synthetic STEP/IGES files, one corrupt B-spline each (import boundary)"
  run_linked cur_ndebug readers pass
  run_linked cur_asserts readers pass
  if [ -n "$PRE" ] && [ -d "$OUT/pre" ]; then
    run_linked pre_ndebug readers fail step_edge_knot_run_corpus_pattern
    run_linked pre_asserts readers fail step_edge_knot_run_corpus_pattern
  fi
  [ "$DO_MUT" = 1 ] && run_linked mut_stepread readers fail step_edge_knot_run_corpus_pattern
fi
if [ "$DO_CORPUS" = 1 ]; then
  step "A2: the 22 corpus files through readForeignStep (fixture: $(printf '%s\n' "$FIXTURE" | grep -vcE '^(#|$)'))"
  printf '%s\n' "$FIXTURE" | grep -vE '^$' > "$OUT/fixture.tsv"
  missing=0
  while IFS="$(printf '\t')" read -r p _ _; do
    case "$p" in ''|'#'*) continue ;; esac
    [ -f "$CORPUS_ROOT/$p" ] || missing=$((missing + 1))
  done < "$OUT/fixture.tsv"
  if [ "$missing" != 0 ]; then
    echo "NOT_RUN  corpus: $missing fixture file(s) absent under CORPUS_ROOT=$CORPUS_ROOT"; NOT_RUN=1
  else
    run_linked cur_ndebug corpus pass
    run_linked cur_asserts corpus pass
    if [ -n "$PRE" ] && [ -d "$OUT/pre" ]; then
      run_linked pre_ndebug corpus fail
      run_linked pre_asserts corpus fail
    fi
    [ "$DO_MUT" = 1 ] && run_linked mut_stepread corpus fail
  fi
fi

# ---------------------------------------------------------------------------
# 7. A3: every assert() left under src/native, justified
# ---------------------------------------------------------------------------
# One line per residual assert:  file ~|~ exact trimmed text ~|~ class ~|~ why.
# ("~|~" because assert texts contain "||".) Classes:
#   NOT-FILE-INPUT        the guarded value never comes from a parsed file
#   VALIDATED-AT-IMPORT   file-derived, but every STEP/IGES NURBS now passes
#                         validate() before it can reach the assert (T-153)
#   FILE-REACHABLE        CAN be reached from parsed file content: NOT fixed
#                         here (outside this task's write set) — named so it
#                         cannot hide; open PR #286 carries the refusal form
#   INTERNAL-INVARIANT    callers establish it; reaching it is a kernel bug
IFS= read -r -d '' JUSTIFIED <<'JEOF' || true
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(curve.valid() && "curveDerivatives on invalid curve");~|~VALIDATED-AT-IMPORT~|~valid() is now T-153's full validate(); StepRead/IgesRead refuse every curve that fails it, so a file curve cannot arrive invalid. An internal caller still can (refusal form: PR #286 curveDerivativesChecked).
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(std::fabs(w0) > 0.0 && "degenerate rational weight (w == 0)");~|~VALIDATED-AT-IMPORT~|~validated weights > 0 and a non-empty span give w0 > 0 inside the domain; w0 == 0 needs extrapolation, i.e. an algorithm's parameter, not file data.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(s > 0.0 && "curveTangent: zero first derivative (cusp)");~|~FILE-REACHABLE~|~a cusp is legal in VALID file geometry; under NDEBUG this hands back NaN. NOT fixed here (outside write set) — PR #286 curveTangentChecked refuses it.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(vnorm(d[1]) > 0.0 && "curveCurvature: zero first derivative (cusp)");~|~FILE-REACHABLE~|~as curveTangent: a legal cusp in file geometry yields NaN under NDEBUG. NOT fixed here — PR #286 curveCurvatureChecked.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(surf.valid() && "surfaceDerivatives on invalid surface");~|~VALIDATED-AT-IMPORT~|~as curveDerivatives: StepRead/IgesRead now validate() every B-spline surface before it exists in the model. Internal callers: PR #286 surfaceDerivativesChecked.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(std::fabs(w0) > 0.0 && "degenerate rational surface weight");~|~VALIDATED-AT-IMPORT~|~as the curve w0: > 0 for validated input inside the domain.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(s > 0.0 && "surfaceNormal: degenerate tangent plane");~|~FILE-REACHABLE~|~a pole / collapsed edge (e.g. a revolved surface on its axis) is legal file geometry; NDEBUG returns NaN. NOT fixed here — PR #286 surfaceNormalChecked.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(curve.valid() && "insertKnot on invalid curve");~|~VALIDATED-AT-IMPORT~|~as curveDerivatives; refusal form PR #286 insertKnotChecked.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(s < p && "insertKnot: knot multiplicity would reach the degree");~|~INTERNAL-INVARIANT~|~a precondition on the knot the CALLER chooses to insert, not on file data; PR #286 measured a SIGSEGV when violated (insertKnot at a clamped end) and refuses it.
forge-kernel/src/native/brep/NurbsCalculus.cpp~|~assert(std::fabs(w) > 0.0 && "insertKnot: degenerate weight");~|~VALIDATED-AT-IMPORT~|~new weights are convex combinations of validated positive weights, hence > 0.
forge-kernel/src/native/brep/Primitives.cpp~|~assert(dx > 0 && dy > 0 && dz > 0);~|~NOT-FILE-INPUT~|~API dimensions, never parsed from a file; src/Primitives.cpp requirePositive() and forge_capi.cpp validate first. Unvalidated only via the N-API binding (JS, frozen). PR #286 declines.
forge-kernel/src/native/brep/Primitives.cpp~|~assert(h > 0 && rB >= 0 && rT >= 0 && (rB > 0 || rT > 0));~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Primitives.cpp~|~assert(r > 0);~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Primitives.cpp~|~assert(R > 0 && r > 0 && r < R);~|~NOT-FILE-INPUT~|~API arguments; src/Primitives.cpp makeTorus also rejects r >= R.
forge-kernel/src/native/brep/Primitives.cpp~|~assert(n >= 3 && R > 0 && h > 0);~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Primitives.cpp~|~assert(dx > 0 && dy > 0 && dz > 0 && ltx >= 0 && ltx <= dx);~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Primitives.cpp~|~assert(rO > rI && rI > 0 && h > 0);~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Primitives.cpp~|~assert(dx > 0 && dy > 0 && h > 0);~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Primitives.cpp~|~assert(rx > 0 && ry > 0 && rz > 0);~|~NOT-FILE-INPUT~|~API arguments (as buildBox).
forge-kernel/src/native/brep/Topology.cpp~|~assert(false && "edge already has two coedges (non-manifold use)");~|~FILE-REACHABLE~|~PR #286 MEASURED it from file content: StepAnalytic::read on three ADVANCED_FACEs sharing one EDGE_CURVE (NDEBUG: a coedge wired into no edge). NOT fixed here — PR #286 makeCoedge refuses a third use.
forge-kernel/src/native/brep/Topology.cpp~|~assert(ring.size() >= 3 && "a face outer loop needs at least 3 vertices");~|~INTERNAL-INVARIANT~|~the file readers reject short rings first (StepRead outerVerts.size() < 3 -> DEGENERATE_LOOP; IgesRead -> IGES_144/510(degenerate)); other callers build rings of a size they choose (PR #286 caller audit).
forge-kernel/src/native/brep/Topology.cpp~|~assert(ring.size() >= 3 && "a face inner loop needs at least 3 vertices");~|~INTERNAL-INVARIANT~|~readers add a hole only when hv.size() >= 3 (StepRead, IgesRead); as the outer-loop case.
JEOF
if [ "$DO_RESID" = 1 ]; then
  step "A3: residual assert() under forge-kernel/src/native"
  # file~|~line~|~trimmed text, code lines only (a comment that MENTIONS
  # assert() is not an assert).
  ( cd "$REPO" && grep -rn --include='*.cpp' --include='*.hpp' -E '(^|[^_[:alnum:]])assert[[:space:]]*\(' forge-kernel/src/native ) \
    | grep -v 'static_assert' \
    | sed -E 's/^([^:]+):([0-9]+):[[:space:]]*/\1~|~\2~|~/; s/[[:space:]]+$//' \
    | grep -vE '~[|]~[0-9]+~[|]~(//|\*)' > "$OUT/asserts.txt"
  printf '%s\n' "$JUSTIFIED" | grep -vE '^(#|$)' > "$OUT/justified.txt"
  A3_AWK='
      function base(p) { sub(/.*\//, "", p); return p }
      FNR == NR { k = $1 "\t" $2; cls[k] = $3; why[k] = $4; seen[k] = 0; next }
      { k = $1 "\t" $3; n++
        if (k in cls) { seen[k] = 1; printf "  %-30s %-20s %s\n", base($1) ":" $2, cls[k], why[k]; c[cls[k]]++ }
        else { un++; printf "  %s:%s  UNJUSTIFIED  %s\n", $1, $2, $3 } }
      END { for (k in seen) if (!seen[k]) { st++; split(k, a, "\t"); printf "  STALE justification (assert gone): %s | %s\n", a[1], a[2] }
            printf "  residual asserts: %d  unjustified: %d  stale: %d   by class:", n, un + 0, st + 0
            for (x in c) printf " %s=%d", x, c[x]; printf "\n"
            exit (un + 0 > 0 || st + 0 > 0) }'
  if awk -F'~[|]~' "$A3_AWK" "$OUT/justified.txt" "$OUT/asserts.txt"; then
    pass "A3 residual list fully justified; Nurbs.cpp asserts: $(grep -c '^forge-kernel/src/native/brep/Nurbs.cpp~' "$OUT/asserts.txt")"
  else fail "A3 residual list has unjustified or stale entries"; fi
  # CONTROLS: the matcher must catch a new unjustified assert AND a stale entry.
  { cat "$OUT/asserts.txt"; echo 'forge-kernel/src/native/brep/Nurbs.cpp~|~1~|~assert(w != 0.0);'; } > "$OUT/asserts_ctl1.txt"
  sed '1d' "$OUT/asserts.txt" > "$OUT/asserts_ctl2.txt"
  if awk -F'~[|]~' "$A3_AWK" "$OUT/justified.txt" "$OUT/asserts_ctl1.txt" > /dev/null; then fail "A3 control: an injected unjustified assert was NOT reported"
  else pass "A3 control: an injected unjustified assert is reported"; fi
  if [ -s "$OUT/asserts.txt" ]; then
    if awk -F'~[|]~' "$A3_AWK" "$OUT/justified.txt" "$OUT/asserts_ctl2.txt" > /dev/null; then fail "A3 control: a stale justification was NOT reported"
    else pass "A3 control: a stale justification is reported"; fi
  fi
fi

echo
if [ "$FAILED" != 0 ]; then echo "T153 GATE: FAIL"; exit 1; fi
if [ "$NOT_RUN" != 0 ]; then echo "T153 GATE: PASS for every step that ran; corpus NOT_RUN"; exit 3; fi
echo "T153 GATE: PASS"; exit 0
