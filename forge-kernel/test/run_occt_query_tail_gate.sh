#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_occt_query_tail_gate.sh — T-148: five single-owner OCCT QUERY symbols out
# of libforge_kernel_core, with nothing a caller can observe moving.
#
#   KERNEL_BUILD=<cmake build dir of forge-kernel>   (default: forge-kernel/build-k)
#   OCCT_SYMBOLS_CEILING=<N>      the ratchet this change sets (default 498)
#   BASE_DYLIB=<pre-change libforge_kernel_core.dylib>   optional: ARRIVALS check
#   BASE_SRC=<pre-change forge-kernel source dir>        optional, with BASE_DYLIB:
#                                 BEFORE/AFTER diff of the observable record
#   CORPUS_LIST=<file of STEP paths>                    optional: corpus pass
#
# CHECKS (each prints PASS / FAIL / NOT_RUN; exit 0 iff no FAIL):
#   S1  per OBJECT: none of NativeFilletChamfer.o / NativeDraftLocal.o /
#       BodyInventory.o names any of the five departed symbols (nm -u on the .o,
#       not only on the dylib — a dylib can lose a symbol another owner still
#       names, and a .o is where an owner is visible).
#   S2  the dylib names none of the five.
#   S3  ARRIVALS empty: no OCCT symbol the BASE_DYLIB did not already take.
#   S4  occt_closure_count.sh --assert-symbols N passes and N-1 FAILS, so the
#       ceiling measures this tree rather than being inert.
#   G   test/occt_query_tail_gate.cpp, -Wall -Wextra -Werror, linked against the
#       built dylib: [A] lift bit-exact, [B] ring-edge reader vs the replaced
#       adaptor, [C] bodyInventory vs constructor+Perform (+ the corpus pass).
#   S5  with BASE_DYLIB: the PRE-change dylib FAILS --assert-symbols N, so the
#       ceiling is set by this change and not by drift elsewhere.
#   AB  BEFORE/AFTER: the gate's --emit record built against BASE_SRC+BASE_DYLIB
#       and against this tree must be byte-identical.
#   M   --mutations: each defect in the `mutate` list at the bottom is injected
#       into a COPY of the engine sources, the gate is rebuilt against the copy,
#       and every one must turn it RED (the C++ gate exits non-zero, or — with
#       BASE_SRC/BASE_DYLIB — the AB record moves). A mutant that stays green
#       FAILS this script: a check that cannot fail is not a check. The count
#       is printed from MUT_TOTAL, never typed into a comment.
#
# Native C++ and shell only. No node, no addon.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

WANT_MUT=0
for a in "$@"; do
  case "$a" in
    --mutations) WANT_MUT=1 ;;
    *) echo "usage: $0 [--mutations]   (env: KERNEL_BUILD OCCT_SYMBOLS_CEILING BASE_DYLIB BASE_SRC CORPUS_LIST)"; exit 2 ;;
  esac
done

KERNEL_BUILD="${KERNEL_BUILD:-$KERNEL/build-k}"
case "$KERNEL_BUILD" in /*) ;; *) KERNEL_BUILD="$KERNEL/$KERNEL_BUILD" ;; esac
CEILING="${OCCT_SYMBOLS_CEILING:-498}"
CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT="/usr/local/opt/opencascade"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || { echo "FATAL: OCCT not found (set OCCT_ROOT)"; exit 2; }
OCCT_LIB="${OCCT_LIB:-$OCCT/lib}"
sha() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }

DYLIB=""
for c in "$KERNEL_BUILD/libforge_kernel_core.dylib" "$KERNEL_BUILD/libforge_kernel_core.so"; do
  [ -f "$c" ] && { DYLIB="$c"; break; }
done
[ -n "$DYLIB" ] || { echo "FATAL: no libforge_kernel_core in $KERNEL_BUILD — build target forge_kernel_core first"; exit 2; }
OBJ="$KERNEL_BUILD/CMakeFiles/forge_kernel_core.dir/src"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/occt_query_tail.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
verdict() { printf '[occt-query-tail] %-4s %s\n' "$1" "$2"; [ "$1" = "FAIL" ] && FAILS=$((FAILS + 1)); return 0; }

# The five departed symbols, Itanium-mangled WITHOUT the Mach-O leading '_'.
cat > "$TMP/departed" <<'SYMS'
_ZN17BRepAdaptor_Curve10InitializeERK11TopoDS_Edge
_ZN17BRepAdaptor_CurveC1Ev
_ZN26BRepExtrema_DistShapeShape7PerformERK21Message_ProgressRange
_ZN6ElCLib8InPeriodEddd
_ZNK17BRepAdaptor_Curve2D1EdR6gp_PntR6gp_Vec
SYMS
sort -u "$TMP/departed" -o "$TMP/departed"

undef() { # undef FILE -> undefined symbols, one per line, Mach-O '_' stripped
  if [ "$(uname -s)" = "Darwin" ]; then nm -u "$1" 2>/dev/null | sed 's/^[[:space:]]*//; s/^_//'
  else nm -u "$1" 2>/dev/null | awk '{print $NF}'; fi | grep -v '^$' | sort -u
}
occt_exports() {
  for f in "$OCCT_LIB"/libTK*.dylib "$OCCT_LIB"/libTK*.so; do
    [ -f "$f" ] || continue; [ -L "$f" ] && continue
    if [ "$(uname -s)" = "Darwin" ]; then
      nm -gU "$f" 2>/dev/null | awk '$2=="T"||$2=="D"||$2=="S"||$2=="B"||$2=="I"{print $3}' | sed 's/^_//'
    else nm -D --defined-only "$f" 2>/dev/null | awk '{print $NF}'; fi
  done | sort -u
}

echo "[occt-query-tail] kernel build: $KERNEL_BUILD"
echo "[occt-query-tail] dylib sha256: $(sha "$DYLIB")"

# ── S1 per object ────────────────────────────────────────────────────────────
S1=0
for o in native/brep/NativeFilletChamfer.cpp.o native/brep/NativeDraftLocal.cpp.o BodyInventory.cpp.o; do
  if [ ! -f "$OBJ/$o" ]; then verdict FAIL "S1 object missing: $OBJ/$o"; S1=1; continue; fi
  hit="$(undef "$OBJ/$o" | comm -12 - "$TMP/departed")"
  if [ -n "$hit" ]; then
    S1=1; echo "  $o still names:"; echo "$hit" | sed 's/^/    /' | c++filt
  fi
done
[ "$S1" -eq 0 ] && verdict PASS "S1 no migrated object names a departed symbol (nm -u per .o)" \
                || verdict FAIL "S1 a migrated object still names a departed symbol"

# ── S2 the dylib ─────────────────────────────────────────────────────────────
undef "$DYLIB" > "$TMP/dylib.undef"
hit="$(comm -12 "$TMP/dylib.undef" "$TMP/departed")"
[ -z "$hit" ] && verdict PASS "S2 the dylib names none of the five" \
              || { verdict FAIL "S2 the dylib still names:"; echo "$hit" | c++filt | sed 's/^/    /'; }

# ── S3 arrivals ──────────────────────────────────────────────────────────────
if [ -n "${BASE_DYLIB:-}" ] && [ -f "${BASE_DYLIB:-}" ]; then
  occt_exports > "$TMP/occt.exports"
  comm -12 "$TMP/dylib.undef" "$TMP/occt.exports" > "$TMP/now.occt"
  undef "$BASE_DYLIB" | comm -12 - "$TMP/occt.exports" > "$TMP/base.occt"
  arr="$(comm -13 "$TMP/base.occt" "$TMP/now.occt")"
  dep="$(comm -23 "$TMP/base.occt" "$TMP/now.occt")"
  echo "  OCCT symbols: base $(wc -l < "$TMP/base.occt" | tr -d ' ') -> now $(wc -l < "$TMP/now.occt" | tr -d ' ')"
  echo "  departures ($(printf '%s' "$dep" | grep -c . )):"; printf '%s\n' "$dep" | grep . | c++filt | sed 's/^/    /'
  missing="$(comm -23 "$TMP/departed" <(printf '%s\n' "$dep" | grep . | sort -u))"
  if [ -z "$arr" ] && [ -z "$missing" ]; then verdict PASS "S3 ARRIVALS empty; all five departed"
  else
    [ -n "$arr" ] && { echo "  ARRIVALS:"; printf '%s\n' "$arr" | c++filt | sed 's/^/    /'; }
    [ -n "$missing" ] && { echo "  expected departures that did not happen:"; printf '%s\n' "$missing" | c++filt | sed 's/^/    /'; }
    verdict FAIL "S3 arrivals non-empty or a departure missing"
  fi
else
  verdict NOT_RUN "S3 arrivals (set BASE_DYLIB=<pre-change libforge_kernel_core>)"
fi

# ── S4 the ratchet is not inert ──────────────────────────────────────────────
bash scripts/occt_closure_count.sh "$DYLIB" --quiet --assert-symbols "$CEILING" >/dev/null 2>&1; rcN=$?
bash scripts/occt_closure_count.sh "$DYLIB" --quiet --assert-symbols "$((CEILING - 1))" >/dev/null 2>&1; rcM=$?
if [ "$rcN" -eq 0 ] && [ "$rcM" -eq 1 ]; then
  verdict PASS "S4 --assert-symbols $CEILING exits 0 and $((CEILING - 1)) exits 1"
else
  verdict FAIL "S4 --assert-symbols $CEILING exit=$rcN (want 0), $((CEILING - 1)) exit=$rcM (want 1)"
fi

# ── S5 the ceiling is THIS change's ──────────────────────────────────────────
if [ -n "${BASE_DYLIB:-}" ] && [ -f "${BASE_DYLIB:-}" ]; then
  bash scripts/occt_closure_count.sh "$BASE_DYLIB" --quiet --assert-symbols "$CEILING" >/dev/null 2>&1; rcB=$?
  [ "$rcB" -eq 1 ] && verdict PASS "S5 the pre-change dylib FAILS --assert-symbols $CEILING" \
                   || verdict FAIL "S5 the pre-change dylib exit=$rcB on --assert-symbols $CEILING (want 1)"
else
  verdict NOT_RUN "S5 pre-change dylib vs the ceiling (set BASE_DYLIB=)"
fi

# ── G the C++ gate ───────────────────────────────────────────────────────────
OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo -lTKBRep -lTKTopAlgo
           -lTKPrim -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset -lTKDESTEP -lTKXSBase)
build_gate() { # build_gate SRC_ROOT DYLIB_DIR OUT EXTRA_FLAGS...
  local root="$1" ddir="$2" out="$3"; shift 3
  "$CXX" -std=c++20 -O2 -Wall -Wextra -Werror -Wno-unused-function -DFORGE_NATIVE_BREP=1 "$@" \
    -I "$root/include" -I "$OCCT/include/opencascade" \
    "$root/test/occt_query_tail_gate.cpp" \
    -L "$ddir" -lforge_kernel_core -L "$OCCT_LIB" "${OCCT_LIBS[@]}" \
    -Wl,-rpath,"$ddir" -Wl,-rpath,"$OCCT_LIB" -o "$out" 2> "$out.err"
}
if build_gate "$KERNEL" "$(dirname "$DYLIB")" "$TMP/gate"; then
  ARGS=()
  [ -n "${CORPUS_LIST:-}" ] && ARGS+=(--corpus "$CORPUS_LIST")
  ARGS+=(--emit "$TMP/after.emit")
  "$TMP/gate" "${ARGS[@]}"; rc=$?
  [ "$rc" -eq 0 ] && verdict PASS "G the C++ gate (0 failed)" || verdict FAIL "G the C++ gate exit=$rc"
else
  verdict FAIL "G the C++ gate did not build (-Werror)"; sed -n '1,40p' "$TMP/gate.err"
fi

# ── AB before/after ──────────────────────────────────────────────────────────
# Every DECISION and NUMBER must be byte-identical. The rim's decline REASON (rim
# records, field 7) may change in exactly one documented way: a ring that carries
# a curve the rim cannot build is now declined for THAT reason instead of being
# reported as a broken G1 junction (see buildRimContext).
stripwhy() { awk -F'\t' 'BEGIN{OFS="\t"} $1=="rim"{$7=""} {print}' "$1"; }
ab_same() { # ab_same BEFORE AFTER PREFIX -> 0 iff the record did not move
  local b="$1" a="$2" p="$3" bad
  stripwhy "$b" > "$p.before.nowhy"; stripwhy "$a" > "$p.after.nowhy"
  awk -F'\t' '$1=="rim"{print $7}' "$b" > "$p.before.why"
  awk -F'\t' '$1=="rim"{print $7}' "$a" > "$p.after.why"
  paste -d'|' "$p.before.why" "$p.after.why" | awk -F'|' '$1!=$2' | sort | uniq -c > "$p.why.changes"
  bad="$(paste -d'|' "$p.before.why" "$p.after.why" | awk -F'|' '$1!=$2 &&
      $2!="rim: the cap'"'"'s outer ring carries a curve that is neither line nor arc" &&
      $2!="rim: a ring edge carries no 3-D curve"' | head -5)"
  if cmp -s "$p.before.nowhy" "$p.after.nowhy" && [ -z "$bad" ]; then
    if [ -s "$p.why.changes" ]; then
      echo "  rim decline reasons that changed (count  before|after):"; sed 's/^/    /' "$p.why.changes"
    fi
    return 0
  fi
  echo "  differing lines by record type:"
  diff "$p.before.nowhy" "$p.after.nowhy" | grep '^[<>]' | cut -c3- | cut -f1 | sort | uniq -c | sed 's/^/    /'
  diff "$p.before.nowhy" "$p.after.nowhy" | sed -n '1,20p'
  [ -n "$bad" ] && { echo "  undocumented reason changes:"; echo "$bad" | sed 's/^/    /'; }
  return 1
}
if [ -n "${BASE_SRC:-}" ] && [ -d "${BASE_SRC:-}/src" ] && [ -n "${BASE_DYLIB:-}" ] && [ -f "$TMP/after.emit" ]; then
  # The gate #includes "../src/...", so the BEFORE copy of this test is placed
  # beside the BASE sources through symlinks — nothing is written into BASE_SRC.
  mkdir -p "$TMP/base/test" "$TMP/basedylib"
  ln -s "$BASE_SRC/src" "$TMP/base/src"; ln -s "$BASE_SRC/include" "$TMP/base/include"
  cp test/occt_query_tail_gate.cpp "$TMP/base/test/"
  cp "$BASE_DYLIB" "$TMP/basedylib/libforge_kernel_core.dylib"
  if build_gate "$TMP/base" "$TMP/basedylib" "$TMP/gate_before" -DOCCTQ_EMIT_ONLY; then
    BARGS=(--emit "$TMP/before.emit")
    [ -n "${CORPUS_LIST:-}" ] && BARGS+=(--corpus "$CORPUS_LIST")
    "$TMP/gate_before" "${BARGS[@]}" > "$TMP/before.log" 2>&1
    nlines="$(wc -l < "$TMP/after.emit" | tr -d ' ')"
    if ab_same "$TMP/before.emit" "$TMP/after.emit" "$TMP/ab"; then
      verdict PASS "AB BEFORE/AFTER: every decision and number byte-identical ($nlines records)"
    else
      verdict FAIL "AB the observable record moved"
    fi
    [ -n "${EMIT_KEEP:-}" ] && cp "$TMP/before.emit" "$TMP/after.emit" "$EMIT_KEEP/" 2>/dev/null
  else
    verdict FAIL "AB the BEFORE gate did not build against BASE_SRC"; sed -n '1,30p' "$TMP/gate_before.err"
  fi
else
  verdict NOT_RUN "AB before/after (set BASE_SRC=<pre-change forge-kernel> and BASE_DYLIB=)"
fi

# ── M mutation proof (--mutations) ───────────────────────────────────────────
if [ "$WANT_MUT" -eq 1 ]; then
  # Mutants run on the fixture matrix only (no corpus), so they are judged
  # against a fixture-only BEFORE record.
  MUT_BEFORE=""
  if [ -x "$TMP/gate_before" ]; then
    if [ -n "${CORPUS_LIST:-}" ]; then
      "$TMP/gate_before" --emit "$TMP/before.fixtures.emit" > /dev/null 2>&1 && MUT_BEFORE="$TMP/before.fixtures.emit"
    else
      MUT_BEFORE="$TMP/before.emit"
    fi
  fi
  [ -n "$MUT_BEFORE" ] || echo "  (no BEFORE record: mutants are judged by the C++ gate alone)"
  MUT_TOTAL=0; MUT_GREEN=0
  mutate() { # mutate NAME REL_FILE OLD NEW
    local name="$1" rel="$2" old="$3" new="$4" d="$TMP/mut/$1" f n rc why
    MUT_TOTAL=$((MUT_TOTAL + 1))
    mkdir -p "$d/src/native/brep" "$d/test"
    cp src/native/brep/NativeFilletChamfer.cpp src/native/brep/NativeDraftLocal.cpp "$d/src/native/brep/"
    cp src/BodyInventory.cpp "$d/src/"
    cp test/occt_query_tail_gate.cpp "$d/test/"
    ln -s "$KERNEL/include" "$d/include"
    f="$d/$rel"
    n="$(grep -cF -- "$old" "$f")"
    if [ "$n" != 1 ]; then
      MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: STALE — its anchor matches $n lines of $rel (want 1)"; return
    fi
    # A LITERAL splice at awk's index(): no regex, no glob, linear in the file
    # (bash's ${s/pat/rep} is quadratic on a 150 KB source and treats quotes in
    # the replacement differently across bash versions). The strings travel
    # through ENVIRON, not -v, so a backslash in an anchor is not an escape.
    OLD="$old" NEW="$new" awk 'BEGIN { o = ENVIRON["OLD"]; r = ENVIRON["NEW"] }
      { buf = buf $0 "\n" }
      END { i = index(buf, o); printf "%s", substr(buf, 1, i - 1) r substr(buf, i + length(o)) }' \
      "$rel" > "$f"
    if cmp -s "$f" "$rel"; then
      MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: STALE — the substitution changed nothing"; return
    fi
    # BodyInventory.cpp is compiled INTO the mutant gate, so the executable's
    # copy of forge::bodyInventory (the mutated one) is the one [C] calls.
    if ! "$CXX" -std=c++20 -O2 -w -DFORGE_NATIVE_BREP=1 -I "$d/include" -I "$OCCT/include/opencascade" \
         "$d/test/occt_query_tail_gate.cpp" "$d/src/BodyInventory.cpp" \
         -L "$(dirname "$DYLIB")" -lforge_kernel_core -L "$OCCT_LIB" "${OCCT_LIBS[@]}" \
         -Wl,-rpath,"$(dirname "$DYLIB")" -Wl,-rpath,"$OCCT_LIB" -o "$d/gate" 2> "$d/build.err"; then
      MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: the mutant did not BUILD"; sed -n '1,10p' "$d/build.err"; return
    fi
    "$d/gate" --emit "$d/after.emit" > "$d/run.log" 2>&1; rc=$?
    why=""
    [ "$rc" -ne 0 ] && why="C++ gate exit $rc, $(grep -c '\[FAIL\]' "$d/run.log") failed, first: $(grep -m1 '\[FAIL\]' "$d/run.log" | sed 's/^ *\[FAIL\] //')"
    if [ -n "$MUT_BEFORE" ] && [ -f "$d/after.emit" ] && ! ab_same "$MUT_BEFORE" "$d/after.emit" "$d/ab" > "$d/ab.log" 2>&1; then
      why="${why:+$why; }AB record moved ($(diff "$d/ab.before.nowhy" "$d/ab.after.nowhy" | grep -c '^>') lines)"
    fi
    if [ -n "$why" ]; then echo "  M $name: RED <- $why"
    else MUT_GREEN=$((MUT_GREEN + 1)); echo "  M $name: STAYED GREEN — the check it targets is unfalsifiable"; fi
  }
  echo "[occt-query-tail] mutation proof (each injected defect must turn the gate red):"
  # [A] the periodic lift
  mutate lift-no-clamp      src/native/brep/NativeDraftLocal.cpp \
    'return u < lo ? lo : u;' 'return u;'
  mutate lift-fixed-period  src/native/brep/NativeDraftLocal.cpp \
    'const double period = hi - lo;' 'const double period = 6.28318530717958647692; (void)hi;'
  # [B] the ring-edge reader
  mutate d1-sign            src/native/brep/NativeFilletChamfer.cpp \
    'return X * (-r * std::sin(t)) + Y * (r * std::cos(t));' 'return X * (r * std::sin(t)) + Y * (r * std::cos(t));'
  mutate curve-unlocated    src/native/brep/NativeFilletChamfer.cpp \
    'try { gc = BRep_Tool::Curve(e, f, l); } catch (...) { return false; }' \
    'TopLoc_Location L; try { gc = BRep_Tool::Curve(e, L, f, l); } catch (...) { return false; }'
  mutate no-trim-unwrap     src/native/brep/NativeFilletChamfer.cpp \
    'Handle(Geom_TrimmedCurve) tc = Handle(Geom_TrimmedCurve)::DownCast(gc);' 'Handle(Geom_TrimmedCurve) tc;'
  mutate reason-not-named   src/native/brep/NativeFilletChamfer.cpp \
    'if (!kindWhy.empty()) { why = kindWhy; continue; }' '(void)kindWhy;'
  # The AB record alone: one ulp on a rim arc's sweep moves predictedDv/bandArea.
  mutate arc-sweep-ulp      src/native/brep/NativeFilletChamfer.cpp \
    'sg.theta = std::fabs(rc.last - rc.first);' 'sg.theta = std::nextafter(std::fabs(rc.last - rc.first), 10.0);'
  # [C] the claim the BodyInventory change rests on: the two-shape constructor
  # PERFORMS. A constructor that only loads must turn [C] red.
  mutate ctor-only-loads    src/BodyInventory.cpp \
    'BRepExtrema_DistShapeShape distance(solids[c.i], solids[c.j]);' \
    'BRepExtrema_DistShapeShape distance; distance.LoadS1(solids[c.i]); distance.LoadS2(solids[c.j]);'
  if [ "$MUT_GREEN" -eq 0 ]; then verdict PASS "M all $MUT_TOTAL mutants turn the gate red"
  else verdict FAIL "M $MUT_GREEN of $MUT_TOTAL mutants stayed green, were stale, or did not build"; fi
fi

if [ "$FAILS" -eq 0 ]; then echo "[occt-query-tail] PASS"; exit 0; fi
echo "[occt-query-tail] FAIL ($FAILS)"; exit 1
