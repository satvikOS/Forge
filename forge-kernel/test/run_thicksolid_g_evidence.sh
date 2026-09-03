#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_thicksolid_g_evidence.sh — build and run the four TKOffset-family-G
# instruments, in the order the argument needs them.
#
# THE QUESTION THEY ANSWER. reports/corpus_ab/THICKSOLID_ATTRIBUTION.md §4 and
# CMakeLists.txt (the family-G block) record that OCCT's own MakeThickSolid
# output is BRepCheck-INVALID on 133/133 of its successes over the 600-part
# corpus. That invites the conclusion "the operation has no correct capability,
# so declaring it UNSUPPORTED in both engines costs nothing." These four
# instruments test that inference instead of accepting it.
#
#   1. thicksolid_occt_validity_probe    the 600-part OCCT baseline, RE-MEASURED
#                                        by a binary that links NO forge source.
#   2. thicksolid_occt_brepcheck_detail  WHICH BRepCheck enumerators, per part,
#                                        result side AND source side.
#   3. thicksolid_occt_canonical_control OCCT on the inputs the SHIPPED call
#                                        sites produce, against closed forms.
#   4. thicksolid_g_flip_cost            BOTH engines on those same inputs, so
#                                        the cost of flipping the option is
#                                        measured rather than inferred.
#
# ★ 1, 2 and 3 link ZERO forge code. A probe that shares an address space with
#   the engine under test cannot be the independent check on that engine's
#   baseline, and the OCCT baseline is the number the whole argument rests on.
#
# usage: test/run_thicksolid_g_evidence.sh [CORPUS_DIR]
#        (CORPUS_DIR defaults to the 600 gold reference solids; omit it to run
#         only the two instruments that need no corpus)
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CORPUS="${1:-/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps}"
CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT=/usr/local/opt/opencascade
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  echo "FATAL: OCCT not found (set OCCT_ROOT)" >&2; exit 2
fi
OUT="${OUT:-$KERNEL/.build-thicksolid-g}"
mkdir -p "$OUT" || exit 2
LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim \
      -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset -lTKDESTEP -lTKXSBase"

build_occt_only() {  # $1 = basename
  echo "  CXX test/$1.cpp (OCCT only, no forge source)"
  # shellcheck disable=SC2086
  $CXX -std=c++20 -O2 -I "$OCCT/include/opencascade" "test/$1.cpp" \
       -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" $LIBS -o "$OUT/$1" || return 1
}

echo "== 1/4 build =="
build_occt_only thicksolid_occt_validity_probe    || exit 1
build_occt_only thicksolid_occt_brepcheck_detail  || exit 1
build_occt_only thicksolid_occt_canonical_control || exit 1

# The flip-cost probe is the ONE that must link the native engine, because it is
# the only one whose question is "what does the native engine do". It reuses the
# archive test/build_corpus_ab_coverage.sh produces so the engine under test is
# the same objects the 600-part A/B measured.
AB_LIB="$KERNEL/.build-corpus-ab/libforge_native_ab.a"
if [ ! -f "$AB_LIB" ]; then
  echo "  (building the native archive via test/build_corpus_ab_coverage.sh)"
  bash test/build_corpus_ab_coverage.sh >/dev/null 2>&1
fi
if [ -f "$AB_LIB" ]; then
  echo "  CXX test/thicksolid_g_flip_cost.cpp (+ the native engine archive)"
  # shellcheck disable=SC2086
  $CXX -std=c++20 -O2 -DFORGE_NATIVE_BREP -I include -I "$OCCT/include/opencascade" \
       test/thicksolid_g_flip_cost.cpp "$AB_LIB" \
       -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" $LIBS -o "$OUT/thicksolid_g_flip_cost" || exit 1
else
  echo "  SKIP flip_cost: no native archive at $AB_LIB" >&2
fi

# A GATE THAT CANNOT BUILD CANNOT FAIL — the containment positive control first.
echo
echo "== 2/4 containment positive control (deliberate SIGSEGV + deliberate spin) =="
"$OUT/thicksolid_occt_validity_probe" --selftest || { echo "SELFTEST FAILED"; exit 1; }

echo
echo "== 3/4 OCCT on the SHIPPED input distribution, against closed forms =="
"$OUT/thicksolid_occt_canonical_control"
if [ -x "$OUT/thicksolid_g_flip_cost" ]; then
  echo
  echo "== 3b/4 BOTH engines on those inputs = the measured cost of the flip =="
  CTL=""
  [ -d "$CORPUS" ] && CTL="$CORPUS/ho0.step $CORPUS/ho10.step $CORPUS/ho1017.step"
  # shellcheck disable=SC2086
  "$OUT/thicksolid_g_flip_cost" $CTL
fi

if [ ! -d "$CORPUS" ]; then
  echo
  echo "corpus dir not found ($CORPUS) — skipping the 600-part instruments" >&2
  exit 0
fi
echo
echo "== 4/4 the 600-part corpus (OCCT baseline + BRepCheck enumerator census) =="
"$OUT/thicksolid_occt_validity_probe" "$CORPUS" --timeout=300 > "$OUT/probe_600.jsonl" 2> "$OUT/probe_600.err"
node -e '
const fs=require("fs");
const rows=fs.readFileSync(process.argv[1],"utf8").trim().split("\n").map(l=>JSON.parse(l));
// ★ PRINT THE WHOLE STATUS HISTOGRAM FIRST, and refuse to summarise over a run
//   that contains anything but OK and DEFER. A TIMEOUT part silently lowers the
//   OK count and lowers the source-validity count with it, and both still LOOK
//   like a clean measurement -- this script reported "132/600, sources 599/600"
//   exactly once, from one part that blew the per-part deadline under load,
//   and nothing in the summary said so. A number that arrives with a quiet
//   denominator is not a measurement.
const by={}; for(const r of rows) by[r.status]=(by[r.status]||0)+1;
console.log("statuses                    :", JSON.stringify(by));
const dirty = rows.filter(r=>r.status!=="OK" && r.status!=="DEFER");
if (dirty.length) {
  console.log("*** " + dirty.length + " part(s) neither OK nor DEFER -- THIS RUN IS NOT A CLEAN MEASUREMENT:");
  for (const d of dirty.slice(0,10)) console.log("      " + d.part + " " + d.status + " " + d.note);
  console.log("*** re-run on an idle machine, or raise --timeout; do not quote the rates below.");
}
const errs = rows.filter(r=>r.err);
if (errs.length) console.log("*** " + errs.length + " part(s) with a non-zero err code");
const ok=rows.filter(r=>r.status==="OK");
console.log("parts                       :", rows.length);
console.log("source BRepCheck VALID      :", rows.filter(r=>r.src.valid===1).length, "/", rows.length);
console.log("OCCT built a result         :", ok.length, "/", rows.length,
            "=", (100*ok.length/rows.length).toFixed(1)+"%");
console.log("  of those BRepCheck VALID  :", ok.filter(r=>r.res.valid===1).length, "/", ok.length);
const grew=ok.filter(r=>r.res.V>=r.src.V);
console.log("  result volume >= source   :", grew.length, "/", ok.length,
            grew.length?("worst "+grew.map(g=>[g.part,g.res.V/g.src.V]).sort((a,b)=>b[1]-a[1])[0].map(x=>typeof x==="number"?x.toFixed(4)+"x":x).join(" ")):"" );
const rr=ok.map(r=>r.res.V/r.src.V).sort((a,b)=>a-b);
if(rr.length) console.log("  median V_res/V_src        :", rr[Math.floor(rr.length/2)].toFixed(4));
process.exit(dirty.length ? 1 : 0);
' "$OUT/probe_600.jsonl" || echo "(the 600-part summary above is NOT clean, or node is missing)"
echo
"$OUT/thicksolid_occt_brepcheck_detail" "$CORPUS" 2> "$OUT/detail.err"

# ── 5. IS THE BASELINE EVEN A FIXED NUMBER? ─────────────────────────────────
# CMakeLists.txt's family-G block records that ho317 "returned OK on one run of
# this harness and SIGSEGV on the next, same binary, same input". If that is
# true of more than one part then "OCCT builds 133/600" is a coin flip, not a
# baseline, and no flip gate should be read against it. Measured here on a
# NAMED, BOUNDED subset -- the six parts whose result encloses MORE volume than
# the source, plus ho317 -- rather than by repeating all 600.
echo
echo "== 5/5 determinism of the OCCT baseline (same binary, same input, 10x) =="
REP="$OUT/repeat"
rm -rf "$REP"; mkdir -p "$REP"
for p in ho1253 ho377 ho849 ho370 ho676 ho744 ho317; do
  [ -f "$CORPUS/$p.step" ] && cp "$CORPUS/$p.step" "$REP/"
done
if [ -n "$(ls -A "$REP" 2>/dev/null)" ]; then
  "$OUT/thicksolid_occt_validity_probe" "$REP" --timeout=300 --repeat=10 \
      > "$OUT/repeat.jsonl" 2>&1 | true
  "$OUT/thicksolid_occt_validity_probe" "$REP" --timeout=300 --repeat=10 \
      > /dev/null 2> "$OUT/repeat.err"
  grep -E "UNSTABLE|NOT constant" "$OUT/repeat.err" || echo "  (every part constant over 10 runs)"
else
  echo "  (subset not present in $CORPUS)"
fi

echo
echo "artefacts in $OUT"
exit 0
