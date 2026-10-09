#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_draft_angle_vs_draft_corpus.sh — T-298: NativeDraftAngle::draftFaces is
# compiled and exported but no production entry point reaches it. Produce the
# numbers a wire-or-retire decision needs. NOTHING IS WIRED AND NOTHING IS
# DELETED here; the decision is the user's.
#
#   [N|all] [OUTDIR]                  corpus sample size (default all) and output dir
#   KERNEL_BUILD=<forge-kernel cmake build dir holding libforge_kernel_core>
#                                     (default: forge-kernel/build-k, then <repo>/build-k)
#   APP_BUILD=<forge-desktop cmake build dir>   optional: nm the desktop binaries too
#   CORPUS=<dir of .step>             default: the 600-part gold_ref_steps corpus
#   PART_TIMEOUT=<s>  (default 120)   wall-clock bound per harness process
#   JOBS=<n>          (default 1)     parts in flight at once (each is one process)
#   SKIP_CORPUS=1                     build, selftest, reachability and fixtures only
#   --mutations                       (anywhere on the line) also run M below
#
# CHECKS (each prints PASS / FAIL / NOT_RUN; exit 0 iff no FAIL). None of them is
# a threshold on how well NativeDraftAngle does: this task measures, it does not
# grade, so the corpus checks are about whether every number was PRODUCED.
#   B   test/draft_angle_vs_draft_corpus.cpp builds -Wall -Wextra -Werror against
#       the built libforge_kernel_core.
#   S   its --selftest: every engine slot is wired to the engine it names, in both
#       directions; the OCCT reference and the cylinder closed form are pinned;
#       the comparator and the swept-region check can each say NO.
#   R1  per OBJECT of libforge_kernel_core (nm -u on every .o): which objects demand
#       NativeDraftAngle's draftFaces. Recorded, and the method is proved live by
#       its positive control: Features.cpp.o must demand the NativeDraft.cpp
#       overload it is known to call. (A method that cannot see that caller cannot
#       be trusted to report "no caller".)
#   R2  the dylib DEFINES (exports) NativeDraftAngle's draftFaces.
#   R3  APP_BUILD set: nm -u on every Mach-O under it — which demand it.
#   R4  source: which production sources under forge-kernel/src, forge-kernel/include,
#       forge-desktop, ui and forge-kernel/src/binding.cpp include
#       NativeDraftAngle.hpp (the only declaration of that overload; a TU without
#       it cannot name the function) or mention forge::occtdraft at all.
#   F   the closed-form fixtures (test/occt_query_tail_gate.cpp [F]) with the AABB
#       bridge off and on: NativeDraftAngle 11/11 within 1e-9, 2/2 refused — the
#       same bar [F] sets, re-run here so the corpus numbers sit beside it.
#   C   every sampled part produced a row for every (case, engine): an answer, a
#       named decline, a TIMEOUT row or a crash row. A part with a missing row
#       would read exactly like a clean decline.
#   Σ   the totals and the decision table (summary.txt).
#   M   --mutations: each defect in the `mutate` list is injected into a COPY of
#       the harness (or of NativeDraftAngle.cpp, compiled INTO the harness so its
#       definition binds before the dylib's), and every one must turn S or F red.
#       A mutant that stays green FAILS this script: a check that cannot fail is
#       not a check. The count is printed from MUT_TOTAL, never typed.
#
# Native C++ and shell only. No node, no addon, no .mjs.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$KERNEL/test/$(basename "${BASH_SOURCE[0]}")"
PART_TIMEOUT="${PART_TIMEOUT:-120}"

# ── the per-process bound ────────────────────────────────────────────────────
# `timeout` is GNU coreutils; without it a watchdog kills only THIS process, by
# PID (never pkill: peers share this machine).
run_bounded() {   # run_bounded BIN ARGS... -> rc (124 on timeout)
  if command -v timeout >/dev/null 2>&1; then
    timeout -s KILL "$PART_TIMEOUT" "$@"
    return $?
  fi
  "$@" &
  local pid=$! waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$PART_TIMEOUT" ]; then
      kill -9 "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 124
    fi
    sleep 1; waited=$((waited + 1))
  done
  wait "$pid"
}

ENGINES="occt arr loc ang"     # the harness's own order within a case
CASES="wall cyl"

# ── one part (the xargs worker): every (case, engine) row, or a row saying why not
if [ "${1:-}" = "--part" ]; then
  BIN="$2"; step="$3"; out="$4"
  name="$(basename "$step" .step)"
  tmp="$out.tmp"; : > "$tmp"
  run_bounded "$BIN" "$step" --name="$name" > "$tmp" 2>/dev/null; rc=$?
  if [ "$rc" -ne 0 ] && ! grep -q '"error"' "$tmp"; then
    first_missing=1
    for cs in $CASES; do
      grep -q "\"case\":\"$cs\",\"applicable\":false" "$tmp" && continue
      for eng in $ENGINES; do
        grep -q "\"case\":\"$cs\",\"engine\":\"$eng\"" "$tmp" && continue
        if [ "$first_missing" -eq 1 ]; then
          # The engine the process was IN when it died: re-running it would only
          # spend the bound again. Say what happened to it.
          first_missing=0
          if [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
            printf '{"part":"%s","case":"%s","engine":"%s","answered":false,"threw":false,"timeout":true,"reason":"TIMEOUT after %ss (the process died in this engine or before it, e.g. reading the STEP)","ms":%s}\n' \
              "$name" "$cs" "$eng" "$PART_TIMEOUT" "$((PART_TIMEOUT * 1000))" >> "$tmp"
          else
            printf '{"part":"%s","case":"%s","engine":"%s","answered":false,"threw":true,"crashed":true,"reason":"process exit %s (in this engine or before it)","ms":0}\n' \
              "$name" "$cs" "$eng" "$rc" >> "$tmp"
          fi
          continue
        fi
        # Any LATER engine never ran: run it alone (with OCCT beside it as the
        # reference when OCCT did not hang), and keep only its row.
        engs="$eng"
        if [ "$eng" != occt ] && grep -q "\"case\":\"$cs\",\"engine\":\"occt\",\"answered\"" "$tmp"; then
          engs="occt,$eng"
        fi
        run_bounded "$BIN" "$step" --name="$name" --cases="$cs" --engines="$engs" > "$tmp.one" 2>/dev/null; rc1=$?
        if grep "\"case\":\"$cs\",\"engine\":\"$eng\"" "$tmp.one" >> "$tmp"; then :
        elif [ "$rc1" -eq 124 ] || [ "$rc1" -eq 137 ]; then
          printf '{"part":"%s","case":"%s","engine":"%s","answered":false,"threw":false,"timeout":true,"reason":"TIMEOUT after %ss (run alone)","ms":%s}\n' \
            "$name" "$cs" "$eng" "$PART_TIMEOUT" "$((PART_TIMEOUT * 1000))" >> "$tmp"
        else
          printf '{"part":"%s","case":"%s","engine":"%s","answered":false,"threw":true,"crashed":true,"reason":"process exit %s (run alone)","ms":0}\n' \
            "$name" "$cs" "$eng" "$rc1" >> "$tmp"
        fi
        rm -f "$tmp.one"
      done
    done
  fi
  mv "$tmp" "$out"
  exit 0
fi

cd "$KERNEL" || exit 2
WANT_MUT=0
POS=()
for a in "$@"; do
  case "$a" in
    --mutations) WANT_MUT=1 ;;
    --*) echo "usage: $0 [N|all] [OUTDIR] [--mutations]"; exit 2 ;;
    *) POS+=("$a") ;;
  esac
done
N="${POS[0]:-all}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${POS[1]:-$KERNEL/.build-draft-angle-vs-draft/run-$TS}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
JOBS="${JOBS:-1}"
CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT="/usr/local/opt/opencascade"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || { echo "FATAL: OCCT not found (set OCCT_ROOT)"; exit 2; }
OCCT_LIB="$OCCT/lib"

if [ -z "${KERNEL_BUILD:-}" ]; then
  for c in "$KERNEL/build-k" "$KERNEL/../build-k"; do
    [ -f "$c/libforge_kernel_core.dylib" ] && { KERNEL_BUILD="$c"; break; }
  done
fi
KERNEL_BUILD="${KERNEL_BUILD:-$KERNEL/build-k}"
DYLIB="$KERNEL_BUILD/libforge_kernel_core.dylib"
[ -f "$DYLIB" ] || { echo "FATAL: no $DYLIB — build target forge_kernel_core first"; exit 2; }
OBJ="$KERNEL_BUILD/CMakeFiles/forge_kernel_core.dir"
REPO="$(cd "$KERNEL/.." && pwd)"

mkdir -p "$OUTDIR/parts" || exit 2
FAILS=0
verdict() { printf '[draft-angle-vs-draft] %-7s %s\n' "$1" "$2" | tee -a "$OUTDIR/verdicts.txt"; [ "$1" = "FAIL" ] && FAILS=$((FAILS + 1)); return 0; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
echo "[draft-angle-vs-draft] kernel build $KERNEL_BUILD"
echo "[draft-angle-vs-draft] dylib sha256 $(sha "$DYLIB")"
echo "[draft-angle-vs-draft] head $(git -C "$KERNEL" rev-parse HEAD 2>/dev/null)  out $OUTDIR"

# ── B build ──────────────────────────────────────────────────────────────────
BIN="$OUTDIR/draft_angle_vs_draft_corpus"
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo -lTKBRep -lTKTopAlgo
           -lTKPrim -lTKBO -lTKBool -lTKShHealing -lTKOffset -lTKDESTEP -lTKXSBase)
if "$CXX" -std=c++20 -O2 -Wall -Wextra -Werror -DFORGE_NATIVE_BREP=1 \
     -I "$KERNEL/include" -I "$OCCT/include/opencascade" "$KERNEL/test/draft_angle_vs_draft_corpus.cpp" \
     -L "$KERNEL_BUILD" -lforge_kernel_core -L "$OCCT_LIB" "${OCCT_LIBS[@]}" \
     -Wl,-rpath,"$KERNEL_BUILD" -Wl,-rpath,"$OCCT_LIB" -o "$BIN" 2> "$BIN.err"; then
  verdict PASS "B the harness builds (-Wall -Wextra -Werror)"
else
  verdict FAIL "B the harness did not build"; sed -n '1,40p' "$BIN.err"; exit 1
fi

# ── S selftest ───────────────────────────────────────────────────────────────
"$BIN" --selftest > "$OUTDIR/selftest.log" 2>&1; rc=$?
cat "$OUTDIR/selftest.log"
[ "$rc" -eq 0 ] && verdict PASS "S selftest (every slot wired to its engine; controls say yes AND no)" \
                || { verdict FAIL "S selftest exit $rc"; exit 1; }

# ── R reachability ───────────────────────────────────────────────────────────
undef() { nm -u "$1" 2>/dev/null | sed 's/^[[:space:]]*//; s/^_//' | grep -v '^$' | sort -u; }
ANG_O="$OBJ/src/native/brep/NativeDraftAngle.cpp.o"
ARR_O="$OBJ/src/native/brep/NativeDraft.cpp.o"
FEAT_O="$OBJ/src/Features.cpp.o"
# The two overloads, by their MANGLED names as their own objects define them:
# NativeDraftAngle's takes a std::vector, NativeDraft's an NCollection_List.
ANG_SYM="$(nm -gU "$ANG_O" 2>/dev/null | awk '{print $3}' | sed 's/^_//' | grep 'occtdraft10draftFaces' | grep 'vector' | head -1)"
ARR_SYM="$(nm -gU "$ARR_O" 2>/dev/null | awk '{print $3}' | sed 's/^_//' | grep 'occtdraft10draftFaces' | grep 'NCollection_List' | head -1)"
{
  echo "NativeDraftAngle overload: $ANG_SYM"; echo "  = $(echo "$ANG_SYM" | c++filt)"
  echo "NativeDraft overload:      $ARR_SYM"; echo "  = $(echo "$ARR_SYM" | c++filt)"
} > "$OUTDIR/reachability.txt"
if [ -z "$ANG_SYM" ] || [ -z "$ARR_SYM" ]; then
  verdict FAIL "R1 could not read the two draftFaces definitions from their objects"
else
  NOBJ=0; : > "$OUTDIR/ang_demanders.txt"; : > "$OUTDIR/arr_demanders.txt"
  while IFS= read -r o; do
    NOBJ=$((NOBJ + 1))
    u="$(undef "$o")"
    # Here-strings, not pipes: under pipefail a `grep -q` that stops reading early
    # makes the writer's SIGPIPE the pipeline's status.
    grep -qxF "$ANG_SYM" <<< "$u" && echo "${o#$OBJ/}" >> "$OUTDIR/ang_demanders.txt"
    grep -qxF "$ARR_SYM" <<< "$u" && echo "${o#$OBJ/}" >> "$OUTDIR/arr_demanders.txt"
  done < <(find "$OBJ" -name '*.o' | LC_ALL=C sort)
  {
    echo "objects of libforge_kernel_core scanned (nm -u): $NOBJ"
    echo "objects demanding the NativeDraftAngle overload: $(grep -c . "$OUTDIR/ang_demanders.txt")"
    sed 's/^/  /' "$OUTDIR/ang_demanders.txt"
    echo "objects demanding the NativeDraft overload (positive control): $(grep -c . "$OUTDIR/arr_demanders.txt")"
    sed 's/^/  /' "$OUTDIR/arr_demanders.txt"
  } >> "$OUTDIR/reachability.txt"
  if ! grep -qxF "src/Features.cpp.o" "$OUTDIR/arr_demanders.txt"; then
    verdict FAIL "R1 positive control: Features.cpp.o does not demand the NativeDraft overload — the nm method is blind"
  else
    verdict PASS "R1 $NOBJ core objects: $(grep -c . "$OUTDIR/ang_demanders.txt") demand NativeDraftAngle's draftFaces (control: Features.cpp.o demands NativeDraft's)"
  fi
  nm -gU "$DYLIB" 2>/dev/null | awk '{print $3}' | sed 's/^_//' > "$OUTDIR/dylib_defined.txt"
  grep -qxF "$ANG_SYM" "$OUTDIR/dylib_defined.txt" \
    && verdict PASS "R2 the dylib exports NativeDraftAngle's draftFaces (compiled and exported)" \
    || verdict FAIL "R2 the dylib does not export it — the premise of this task moved"
  if [ -n "${APP_BUILD:-}" ] && [ -d "${APP_BUILD:-}" ]; then
    : > "$OUTDIR/app_ang_demanders.txt"; : > "$OUTDIR/app_arr_demanders.txt"; NAPP=0
    while IFS= read -r f; do
      file -b "$f" 2>/dev/null | grep -q 'Mach-O' || continue
      NAPP=$((NAPP + 1))
      u="$(undef "$f")"
      grep -qxF "$ANG_SYM" <<< "$u" && echo "${f#$APP_BUILD/}" >> "$OUTDIR/app_ang_demanders.txt"
      grep -qxF "$ARR_SYM" <<< "$u" && echo "${f#$APP_BUILD/}" >> "$OUTDIR/app_arr_demanders.txt"
    done < <(find "$APP_BUILD" -type f \( -name '*.o' -o -perm -u+x \) | LC_ALL=C sort)
    {
      echo "APP_BUILD $APP_BUILD: Mach-O files scanned (nm -u): $NAPP"
      echo "  demanding the NativeDraftAngle overload: $(grep -c . "$OUTDIR/app_ang_demanders.txt")"
      sed 's/^/    /' "$OUTDIR/app_ang_demanders.txt"
      echo "  demanding the NativeDraft overload: $(grep -c . "$OUTDIR/app_arr_demanders.txt")"
    } >> "$OUTDIR/reachability.txt"
    verdict PASS "R3 desktop build: $NAPP Mach-O files, $(grep -c . "$OUTDIR/app_ang_demanders.txt") demand NativeDraftAngle's draftFaces"
  else
    verdict NOT_RUN "R3 desktop binaries (set APP_BUILD=<forge-desktop build dir>); R4 covers its sources"
  fi
fi
{
  echo; echo "SOURCES that include NativeDraftAngle.hpp (production trees; tests listed apart):"
  for d in "$KERNEL/src" "$KERNEL/include" "$REPO/forge-desktop" "$REPO/ui"; do
    [ -d "$d" ] && grep -rlF 'NativeDraftAngle.hpp' "$d" --include='*.cpp' --include='*.hpp' --include='*.h' --include='*.mm' 2>/dev/null
  done | LC_ALL=C sort | sed "s|^$REPO/|  |"
  echo "  (tests:)"; grep -rlF 'NativeDraftAngle.hpp' "$KERNEL/test" 2>/dev/null | LC_ALL=C sort | sed "s|^$REPO/|    |"
  echo; echo "SOURCES that mention forge::occtdraft / occtdraft:: (production trees):"
  for d in "$KERNEL/src" "$REPO/forge-desktop" "$REPO/ui"; do
    [ -d "$d" ] && grep -rnF 'occtdraft::' "$d" --include='*.cpp' --include='*.hpp' --include='*.h' --include='*.mm' 2>/dev/null
  done | grep -v 'occtdraftlocal::' | sed "s|^$REPO/|  |"
} >> "$OUTDIR/reachability.txt"
PROD_INC="$( { for d in "$KERNEL/src" "$KERNEL/include" "$REPO/forge-desktop" "$REPO/ui"; do
  [ -d "$d" ] && grep -rlF 'NativeDraftAngle.hpp' "$d" --include='*.cpp' --include='*.hpp' --include='*.h' --include='*.mm' 2>/dev/null; done; } \
  | grep -v -e '/src/native/brep/NativeDraftAngle.cpp$' -e '/include/forge/native/brep/NativeDraftAngle.hpp$' | grep -c . )"
BINDING_INC="$(grep -cF 'NativeDraftAngle.hpp' "$KERNEL/src/binding.cpp" 2>/dev/null || true)"
verdict PASS "R4 production sources including NativeDraftAngle.hpp besides its own .cpp: $PROD_INC (binding.cpp: ${BINDING_INC:-0})"
cat "$OUTDIR/reachability.txt"

# ── F the closed-form fixtures, bridge off and on ────────────────────────────
for a in off on; do
  "$BIN" --fixtures --aabb="$a" > "$OUTDIR/fixtures_aabb_$a.jsonl" 2> "$OUTDIR/fixtures_aabb_$a.err"
  "$BIN" --summarize "$OUTDIR/fixtures_aabb_$a.jsonl" > "$OUTDIR/fixtures_aabb_$a.summary.txt"
  line="$(grep 'closed-form/ang .*closed form:' "$OUTDIR/fixtures_aabb_$a.summary.txt")"
  echo "  aabb $a: ${line#*closed form: }"
  if echo "$line" | grep -q '11/11 answered within 1e-9' && echo "$line" | grep -q 'refusals 2/2'; then
    verdict PASS "F fixtures, AABB bridge $a: NativeDraftAngle 11/11 within 1e-9 of the closed form, 2/2 refused"
  else
    verdict FAIL "F fixtures, AABB bridge $a: $line"
  fi
done

# ── M mutation proof (--mutations) ───────────────────────────────────────────
if [ "$WANT_MUT" -eq 1 ]; then
  MUT_TOTAL=0; MUT_GREEN=0
  mutate() { # mutate NAME REL_FILE OLD NEW   (REL_FILE relative to forge-kernel/)
    local name="$1" rel="$2" old="$3" new="$4" d="$OUTDIR/mut/$1" n rc why="" extra=()
    MUT_TOTAL=$((MUT_TOTAL + 1))
    mkdir -p "$d/test" "$d/src/native/brep"
    cp test/draft_angle_vs_draft_corpus.cpp "$d/test/"
    cp src/native/brep/NativeDraftAngle.cpp "$d/src/native/brep/"
    n="$(grep -cF -- "$old" "$rel")"
    if [ "$n" != 1 ]; then
      MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: STALE — its anchor matches $n lines of $rel (want 1)"; return
    fi
    # A LITERAL splice (no regex), strings through ENVIRON so nothing is an escape.
    OLD="$old" NEW="$new" awk 'BEGIN { o = ENVIRON["OLD"]; r = ENVIRON["NEW"] }
      { buf = buf $0 "\n" }
      END { i = index(buf, o); printf "%s", substr(buf, 1, i - 1) r substr(buf, i + length(o)) }' \
      "$rel" > "$d/$rel"
    if cmp -s "$d/$rel" "$rel"; then
      MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: STALE — the substitution changed nothing"; return
    fi
    case "$rel" in src/*) extra=("$d/src/native/brep/NativeDraftAngle.cpp") ;; esac
    if ! "$CXX" -std=c++20 -O2 -w -DFORGE_NATIVE_BREP=1 -I "$KERNEL/include" -I "$OCCT/include/opencascade" \
         "$d/test/draft_angle_vs_draft_corpus.cpp" ${extra[@]+"${extra[@]}"} \
         -L "$KERNEL_BUILD" -lforge_kernel_core -L "$OCCT_LIB" "${OCCT_LIBS[@]}" \
         -Wl,-rpath,"$KERNEL_BUILD" -Wl,-rpath,"$OCCT_LIB" -o "$d/bin" 2> "$d/build.err"; then
      MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: the mutant did not BUILD"; sed -n '1,10p' "$d/build.err"; return
    fi
    "$d/bin" --selftest > "$d/selftest.log" 2>&1; rc=$?
    [ "$rc" -ne 0 ] && why="S selftest exit $rc ($(grep -m1 'SELFTEST FAIL:' "$d/selftest.log" | sed 's/^ *SELFTEST FAIL: //'))"
    "$d/bin" --fixtures > "$d/fixtures.jsonl" 2>/dev/null
    "$d/bin" --summarize "$d/fixtures.jsonl" > "$d/fixtures.summary.txt" 2>&1
    line="$(grep 'closed-form/ang .*closed form:' "$d/fixtures.summary.txt")"
    if ! { echo "$line" | grep -q '11/11 answered within 1e-9' && echo "$line" | grep -q 'refusals 2/2'; }; then
      why="${why:+$why; }F ${line#*closed form: }"
    fi
    if [ -n "$why" ]; then echo "  M $name: RED <- $why"
    else MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: STAYED GREEN — the check it targets is unfalsifiable"; fi
  }
  echo "[draft-angle-vs-draft] mutation proof (each injected defect must turn S or F red):"
  # the harness: each slot, the adjudicator, the comparator
  mutate ang-slot-calls-arr   test/draft_angle_vs_draft_corpus.cpp \
    'r.shape = forge::occtdraft::draftFaces(c.shape, c.origin, c.pull, c.faceIds, c.deg * kDeg, &why);' \
    'r.shape = forge::occtdraft::draftFaces(c.shape, c.faces, c.pull, c.deg * kDeg, gp_Pln(c.origin, c.pull)); (void)why;'
  # (No mutant on runOcct's `!allAdded` branch: on OCCT 7.9 it is unreachable --
  #  Remove() of a rejected face throws first -- so a mutant there cannot be red.)
  mutate frustum-sense        test/draft_angle_vs_draft_corpus.cpp \
    'const bool boss = n.Dot(radial) > 0.0;' 'const bool boss = n.Dot(radial) < 0.0;'
  mutate swept-check-blind    test/draft_angle_vs_draft_corpus.cpp \
    'info->materialOk =' 'info->materialOk = true ||'
  mutate comparator-blind     test/draft_angle_vs_draft_corpus.cpp \
    'std::string geomDisagreements(const Obs& a, const Obs& b, double scale) {' \
    'std::string geomDisagreements(const Obs&, const Obs&, double) { return ""; }
std::string geomDisagreementsUnused(const Obs& a, const Obs& b, double scale) {'
  # the engine under measurement: the harness must SEE a defect in it
  mutate engine-angle-sign    src/native/brep/NativeDraftAngle.cpp \
    'const double t = std::tan(angleRad);' 'const double t = std::tan(-angleRad);'
  mutate engine-boss-bore     src/native/brep/NativeDraftAngle.cpp \
    'const double s = (nrm.Dot(gp_Dir(radial)) >= 0.0) ? 1.0 : -1.0;' \
    'const double s = (nrm.Dot(gp_Dir(radial)) >= 0.0) ? -1.0 : 1.0;'
  mutate engine-noop          src/native/brep/NativeDraftAngle.cpp \
    'if (std::fabs(t) < kTiny) return src;' 'if (std::isfinite(t)) return src;'
  if [ "$MUT_GREEN" -eq 0 ]; then verdict PASS "M $MUT_TOTAL/$MUT_TOTAL mutants turned the gate red"
  else verdict FAIL "M $MUT_GREEN of $MUT_TOTAL mutants stayed green or were stale"; fi
else
  verdict NOT_RUN "M mutation proof (pass --mutations)"
fi

# ── C the corpus ─────────────────────────────────────────────────────────────
if [ "${SKIP_CORPUS:-0}" = "1" ]; then
  verdict NOT_RUN "C corpus (SKIP_CORPUS=1)"
else
  [ -d "$CORPUS" ] || { verdict FAIL "C corpus dir not found: $CORPUS"; exit 1; }
  ALL="$OUTDIR/corpus.list"
  LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$ALL"
  TOTAL="$(grep -c . "$ALL")"
  case "$N" in all|0) N="$TOTAL" ;; esac
  [ "$N" -gt "$TOTAL" ] && N="$TOTAL"
  STRIDE=$(( TOTAL / N )); [ "$STRIDE" -lt 1 ] && STRIDE=1
  SAMPLE="$OUTDIR/sample.list"
  awk -v s="$STRIDE" -v want="$N" '(NR - 1) % s == 0 && kept < want { print; kept++ }' "$ALL" > "$SAMPLE"
  NSAMPLE="$(grep -c . "$SAMPLE")"
  cat > "$OUTDIR/manifest.json" <<JSON
{"generated_utc":"$TS","corpus_dir":"$CORPUS","corpus_total":$TOTAL,"stride":$STRIDE,"realised_n":$NSAMPLE,
 "part_timeout_s":$PART_TIMEOUT,"jobs":$JOBS,"kernel_head":"$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null)",
 "dylib_sha256":"$(sha "$DYLIB")","harness_sha256":"$(sha "$BIN")","aabb_bridge":"off (the shipped default)"}
JSON
  T0="$(date +%s)"
  while IFS= read -r step; do
    printf '%s\0%s\0' "$step" "$OUTDIR/parts/$(basename "$step" .step).jsonl"
  done < "$SAMPLE" | xargs -0 -n 2 -P "$JOBS" bash -c 'PART_TIMEOUT='"$PART_TIMEOUT"' bash "$0" --part "$1" "$2" "$3"' "$SELF" "$BIN"
  T1="$(date +%s)"
  RESULTS="$OUTDIR/results.jsonl"; : > "$RESULTS"
  MISSING=0
  while IFS= read -r step; do
    name="$(basename "$step" .step)"; f="$OUTDIR/parts/$name.jsonl"
    if [ ! -s "$f" ]; then
      printf '{"part":"%s","error":"no output at all"}\n' "$name" >> "$RESULTS"; MISSING=$((MISSING + 1)); continue
    fi
    cat "$f" >> "$RESULTS"
    grep -q '"error"' "$f" && continue
    for cs in $CASES; do
      grep -q "\"case\":\"$cs\",\"applicable\":false" "$f" && continue
      for eng in $ENGINES; do
        grep -q "\"case\":\"$cs\",\"engine\":\"$eng\"" "$f" || { MISSING=$((MISSING + 1)); echo "  missing row: $name $cs $eng"; }
      done
    done
  done < "$SAMPLE"
  echo "  $NSAMPLE parts in $((T1 - T0)) s with JOBS=$JOBS; $(grep -c . "$RESULTS") rows -> $RESULTS"
  [ "$MISSING" -eq 0 ] && verdict PASS "C every one of $NSAMPLE parts has a row for every (case, engine) or an error row" \
                       || verdict FAIL "C $MISSING (part, case, engine) rows missing"
  "$BIN" --summarize "$RESULTS" > "$OUTDIR/summary.txt" 2>&1
  verdict PASS "Σ summary -> $OUTDIR/summary.txt"
  cat "$OUTDIR/summary.txt"
fi

echo "[draft-angle-vs-draft] $FAILS FAIL"
[ "$FAILS" -eq 0 ]
