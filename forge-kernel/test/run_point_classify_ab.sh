#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_point_classify_ab.sh — build and run the T-145 point-classification A/B.
#
# Compiles test/point_classify_ab_gate.cpp against the SHIPPED kernel library
# (build-app/libforge_kernel_core.dylib) plus OCCT, and runs it over the 600-part
# gold corpus one part per process.
#
# CORPUS. The same corpus test/run_corpus_ab_coverage.sh:14 uses:
#   /Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps
# Override with CORPUS=<dir>. Sampling is a STRIDE, never a prefix: this corpus's
# ordering is undocumented and holdouts in this programme are sorted hardest-first,
# so a prefix is a biased sample.
#
#   usage: test/run_point_classify_ab.sh [N] [BULK_PROBES]
#     N            parts to sample (default 40; 0 or "all" = whole corpus)
#     BULK_PROBES  uniform probes per part (default 400)
#   env: CORPUS=<dir> PART_TIMEOUT=120 OFFSET=0 OUTDIR=<dir>
#
# ── THE STRUCTURAL DISTINCTNESS PROOF ───────────────────────────────────────
# The binary asserts the arms behave differently. This script asserts they ARE
# different code, which is an nm question:
#
#   * the GATE's own object file MUST import BRepClass3d  — else "arm A" is not
#     actually the OCCT classifier and the A/B compares the new path with itself,
#     which is the exact failure mode this programme keeps hitting;
#   * the SEAM's object file (src/ShapeClassify.cpp.o) MUST import ZERO
#     BRepClass3d — else "arm B" is the OCCT classifier wearing a new name.
#
# Both are checked below and either one failing fails the run.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KERNEL="$ROOT/forge-kernel"
BUILD="$KERNEL/build-app"
cd "$ROOT"

NSPEC="${1:-40}"
BULK="${2:-400}"
PART_TIMEOUT="${PART_TIMEOUT:-120}"
OFFSET="${OFFSET:-0}"
CORPUS="${CORPUS:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[pc-ab] FATAL: OCCT not found at $OCCT_ROOT — set OCCT_ROOT=" >&2; exit 2
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

DYLIB="$BUILD/libforge_kernel_core.dylib"
if [ ! -e "$DYLIB" ]; then
  echo "[pc-ab] FATAL: $DYLIB missing — cmake --build forge-kernel/build-app --target forge_kernel_core" >&2
  exit 2
fi

TS="$(date +%Y%m%d-%H%M%S)"
OUTDIR="${OUTDIR:-$KERNEL/.build-point-classify-ab/run-$TS}"
mkdir -p "$OUTDIR"
BIN="$OUTDIR/point_classify_ab_gate"

CXX="${CXX:-clang++}"

# ── build ───────────────────────────────────────────────────────────────────
echo "[pc-ab] OCCT      $OCCT_ROOT"
echo "[pc-ab] kernel    $DYLIB"
echo "[pc-ab] out       $OUTDIR"

OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKPrim -lTKShHealing -lTKBO -lTKBool
           -lTKDESTEP -lTKXSBase)

if ! "$CXX" -std=gnu++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 \
      -I "$KERNEL/include" -I "$OCCT_INC" \
      "$KERNEL/test/point_classify_ab_gate.cpp" \
      -o "$BIN" \
      "$DYLIB" -Wl,-rpath,"$BUILD" \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -Wl,-rpath,"$OCCT_LIB" \
      2>"$OUTDIR/build.err"; then
  echo "[pc-ab] BUILD/LINK FAIL"; sed -n '1,120p' "$OUTDIR/build.err"; exit 1
fi
echo "[pc-ab] built     $BIN"

# ── structural distinctness proof ───────────────────────────────────────────
# (a) the GATE really calls the OCCT classifier
if ! "$CXX" -std=gnu++20 -O1 -DFORGE_NATIVE_BREP=1 \
      -I "$KERNEL/include" -I "$OCCT_INC" \
      -c "$KERNEL/test/point_classify_ab_gate.cpp" -o "$OUTDIR/gate.o" \
      2>"$OUTDIR/gate_compile.err"; then
  echo "[pc-ab] FAIL — gate TU would not compile standalone"
  sed -n '1,60p' "$OUTDIR/gate_compile.err"; exit 1
fi
NGATE=$(nm -u "$OUTDIR/gate.o" | c++filt | grep -c 'BRepClass3d')
echo "[pc-ab] arm A proof: gate.o BRepClass3d imports = $NGATE  (must be > 0)"
if [ "$NGATE" -eq 0 ]; then
  echo "[pc-ab] FAIL — the gate does not import BRepClass3d, so 'arm A' is not the"
  echo "               OCCT classifier and this A/B compares one path with itself."
  exit 1
fi

# (b) the SEAM imports none of it
SEAM_O="$BUILD/CMakeFiles/forge_kernel_core.dir/src/ShapeClassify.cpp.o"
if [ ! -e "$SEAM_O" ]; then
  echo "[pc-ab] FAIL — $SEAM_O missing; is src/ShapeClassify.cpp in the source list?" >&2
  exit 1
fi
NSEAM=$(nm -u "$SEAM_O" | c++filt | grep -c 'BRepClass3d')
echo "[pc-ab] arm B proof: ShapeClassify.cpp.o BRepClass3d imports = $NSEAM  (must be 0)"
if [ "$NSEAM" -ne 0 ]; then
  echo "[pc-ab] FAIL — the seam imports the OCCT classifier:"
  nm -u "$SEAM_O" | c++filt | grep 'BRepClass3d'
  exit 1
fi

# whole-library state, for the record (Task 1 migrates no consumer, so this is
# expected to still be 7 — the number the migration has to drive to 0).
NLIB=$(nm -u "$DYLIB" | c++filt | grep -c 'BRepClass3d')
NTRI=$(nm -u "$DYLIB" | c++filt | grep -c 'BRep_Tool::Triangulation')
echo "[pc-ab] whole-library: BRepClass3d = $NLIB, BRep_Tool::Triangulation = $NTRI"

# ── corpus ──────────────────────────────────────────────────────────────────
if [ ! -d "$CORPUS" ]; then echo "[pc-ab] FATAL: corpus not found: $CORPUS" >&2; exit 2; fi
ALL="$OUTDIR/corpus.list"
LC_ALL=C find "$CORPUS" -maxdepth 1 -name '*.step' | LC_ALL=C sort > "$ALL"
TOTAL=$(grep -c . "$ALL")
if [ "$TOTAL" -eq 0 ]; then echo "[pc-ab] FATAL: no .step in $CORPUS" >&2; exit 2; fi

if [ "$NSPEC" = "all" ] || [ "$NSPEC" = "0" ]; then NSAMPLE="$TOTAL"; else NSAMPLE="$NSPEC"; fi
[ "$NSAMPLE" -gt "$TOTAL" ] && NSAMPLE="$TOTAL"
STRIDE=$(( TOTAL / NSAMPLE )); [ "$STRIDE" -lt 1 ] && STRIDE=1

SEL="$OUTDIR/selected.list"
awk -v s="$STRIDE" -v o="$OFFSET" -v n="$NSAMPLE" \
  '(NR - 1) % s == (o % s) { if (c++ < n) print }' "$ALL" > "$SEL"
NSEL=$(grep -c . "$SEL")
echo "[pc-ab] corpus $TOTAL parts, sampling $NSEL with stride $STRIDE offset $OFFSET, $BULK bulk probes/part"
echo "[pc-ab] corpus dir: $CORPUS"

# ── per-part timeout, portably ───────────────────────────────────────────────
# MEASURED on this box: neither `timeout` nor `gtimeout` exists (coreutils is not
# installed), so `timeout N cmd` exited 127 for EVERY part and the run recorded 40
# parts of "no_output" — which an earlier version of the aggregator below scored as
# PASS. A missing tool must not read as a green gate, so the runner picks a
# mechanism that is actually present and the aggregator (further down) now fails on
# any part that produced no verdict.
#
# perl's alarm(2) survives execve, which is the standard portable `timeout`.
if command -v timeout >/dev/null 2>&1;   then TMO=(timeout)
elif command -v gtimeout >/dev/null 2>&1; then TMO=(gtimeout)
elif command -v perl >/dev/null 2>&1;     then TMO=(perl -e 'alarm shift; exec @ARGV or exit 127')
else
  echo "[pc-ab] FATAL: no timeout mechanism (timeout/gtimeout/perl all absent)." >&2
  echo "               Refusing to run without one: a hung part would stall the gate" >&2
  echo "               silently and an untimed run is not a measurement." >&2
  exit 2
fi
echo "[pc-ab] timeout   ${TMO[*]} ${PART_TIMEOUT}s/part"

RESULTS="$OUTDIR/results.jsonl"
: > "$RESULTS"
START=$(date +%s)
i=0
while IFS= read -r step; do
  i=$((i+1))
  out=$("${TMO[@]}" "$PART_TIMEOUT" "$BIN" "$step" "$BULK" 2>>"$OUTDIR/parts.err")
  rc=$?
  if [ -n "$out" ]; then echo "$out" >> "$RESULTS"
  else echo "{\"part\":\"$(basename "$step")\",\"status\":\"no_output\",\"rc\":$rc}" >> "$RESULTS"
  fi
  if [ $((i % 10)) -eq 0 ]; then
    echo "[pc-ab] $i/$NSEL  ($(( $(date +%s) - START ))s)"
  fi
done < "$SEL"
ELAPSED=$(( $(date +%s) - START ))
echo "[pc-ab] done: $i parts in ${ELAPSED}s"

# ── aggregate ───────────────────────────────────────────────────────────────
python3 - "$RESULTS" <<'PY'
import json, sys, collections
rows = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: rows.append(json.loads(line))
    except Exception: pass

st = collections.Counter(r.get("status","?") for r in rows)
fails = collections.Counter(r.get("fail","") for r in rows if r.get("status")=="fail")
scored = [r for r in rows if r.get("status") in ("pass","fail")]

def s(k): return sum(int(r.get(k,0) or 0) for r in scored)
farT, farD = s("farTotal"), s("farDisc")
nearT, nearD = s("nearTotal"), s("nearDisc")
nA, nB, refus, aThrew = s("nA"), s("nB"), s("refusals"), s("armAThrew")

print("")
print("================ T-145 POINT-CLASSIFY A/B — AGGREGATE ================")
print(f"parts                : {len(rows)}")
for k,v in sorted(st.items()): print(f"  status {k:<22}: {v}")
if fails:
    for k,v in sorted(fails.items()): print(f"  fail   {k:<22}: {v}")
print(f"arm A samples (OCCT) : {nA}")
print(f"arm B samples (seam) : {nB}")
print(f"arm A threw          : {aThrew}")
print(f"arm B refusals       : {refus}")
print(f"FAR  probes          : {farT}    discordant: {farD}"
      + ("   <-- MUST BE 0" if farD else "   OK"))
print(f"NEAR probes          : {nearT}    discordant: {nearD}"
      + (f"   ({100.0*nearD/nearT:.4f}% — reported, not gated)" if nearT else ""))
if farT: print(f"FAR  concordance     : {100.0*(farT-farD)/farT:.4f}%")
if nearT: print(f"NEAR concordance     : {100.0*(nearT-nearD)/nearT:.4f}%")

# per-part NEAR discordance, not hidden
nz = [(r["part"], r.get("nearDisc",0), r.get("nearTotal",0))
      for r in scored if int(r.get("nearDisc",0) or 0) > 0]
print(f"parts with NEAR discordance: {len(nz)}")
for p,d,t in sorted(nz, key=lambda x:-x[1])[:20]:
    print(f"    {p:<28} {d}/{t}")

# deferrals are the decision-relevant number
dfr = [r for r in rows if r.get("status")=="deferred"]
print(f"parts arm B DEFERRED whole: {len(dfr)}")
reasons = collections.Counter((r.get("firstRefusal","") or "")[:90] for r in dfr)
for k,v in reasons.most_common(12): print(f"    {v:>4}  {k}")

soup = collections.Counter(r.get("soup","?") for r in scored)
for k,v in sorted(soup.items()): print(f"  soup {k:<26}: {v}")

# ── THE VERDICT ────────────────────────────────────────────────────────────
# An earlier version of this block was `farD==0 and not hard`, and it printed
# PASS over a run in which every single part had status "no_output" (the
# `timeout` binary did not exist, so all 4 parts exited 127 and were never
# scored). Zero discordance out of zero samples is not agreement, it is absence
# of measurement. So the verdict now requires the measurement to have HAPPENED:
# every part must carry a real verdict, and both arms must have produced samples.
hard    = [r for r in rows if r.get("status")=="fail"]
KNOWN   = ("pass","fail","deferred")
unscored= [r for r in rows if r.get("status") not in KNOWN]

reasons = []
if not rows:                 reasons.append("no results at all")
if unscored:                 reasons.append(f"{len(unscored)} part(s) produced no verdict")
if not scored:               reasons.append("no part was scored (pass/fail)")
if scored and nA == 0:       reasons.append("arm A produced ZERO samples")
if scored and nB == 0:       reasons.append("arm B produced ZERO samples")
if scored and farT == 0:     reasons.append("ZERO far-field probes — the stratum the gate gates on is empty")
if farD:                     reasons.append(f"FAR discordance {farD}")
if hard:                     reasons.append(f"{len(hard)} hard failure(s)")

if unscored:
    us = collections.Counter(r.get("status","?") for r in unscored)
    for k,v in sorted(us.items()): print(f"  UNSCORED {k:<20}: {v}")

print("")
if reasons:
    print("VERDICT: FAIL")
    for r in reasons: print(f"    - {r}")
else:
    # The verdict carries the deferral rate on purpose. CONCORDANCE and COVERAGE are
    # different questions: this gate answers "where both arms answer, do they agree",
    # and a PASS printed on its own next to a 50% deferral rate would read as "the
    # migration is ready" when half the corpus has no native answer at all. The
    # deferral rate is what decides whether a consumer can be migrated; it is printed
    # in the verdict line so it cannot be quoted without it.
    ndef = len(dfr); npass = len(rows) - ndef
    rate = (100.0*ndef/len(rows)) if rows else 0.0
    print(f"VERDICT: PASS on CONCORDANCE  (FAR {farT} probes, 0 discordant; "
          f"NEAR {nearT} probes, {nearD} discordant)")
    print(f"         COVERAGE IS SEPARATE: {ndef}/{len(rows)} parts ({rate:.1f}%) had NO "
          f"native answer (importOcctSolid declined); {npass} parts were comparable.")
    print( "         Migrating a consumer today would THROW on those parts.")
print("=====================================================================")
sys.exit(1 if reasons else 0)
PY
rc=$?
echo "[pc-ab] results: $RESULTS"
exit "$rc"
