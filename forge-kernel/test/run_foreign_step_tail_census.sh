#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_foreign_step_tail_census.sh — T-149 driver: build the census harness,
# prove it fires, build the corpus manifest, run the census, emit the report.
#
# NO PRODUCTION SOURCE IS TOUCHED. This script compiles the EXISTING
# src/native/**.cpp tree unmodified into a private archive and links the new
# test TU against it. It writes nothing outside $OBJDIR, the report path, and
# the manifest/census artefacts under $OUTDIR.
#
# ★ THIS BINARY IS NOT A DROP BUILD. Like build_corpus_ab_coverage.sh it is
#   built with NO FORGE_*_DROP_* macro and WITH the OCCT include path, because
#   several members of src/native/brep are OCCT-TopoDS-typed by design. It
#   proves nothing about the OCCT closure or the symbol census; that is what
#   scripts/occt_closure_count.sh measures, and this task asserts that number is
#   UNCHANGED (see --assert-symbols below) rather than assuming it.
#
# MODES
#   --selftest        build, then run the harness selftest in BOTH directions:
#                     normal (must exit 0) and --invert (must exit non-zero).
#                     A selftest that cannot fail is not evidence.
#   --manifest        build the corpus manifest only
#   --census          build + manifest + run the census
#   --report          everything, then emit forge-kernel/reports/FOREIGN_STEP_TAIL.md
#   (no mode)         same as --report
#
# OPTIONS
#   --roots "a b c"   corpus roots (default: the worktree root + $FORGE_STEP_CORPUS_ROOTS)
#   --jobs N          parallel forked readers (default: forge-nproc, else 4)
#   --timeout-ms N    per-file wall timeout (default 60000)
#   --sew-tol X       sew tolerance handed to readForeignStep (default -1.0 =
#                     the product's automatic default). ANY other value produces
#                     a clearly-labelled SIDE column and is never the headline.
#   --limit N         census only the first N lexable files (smoke runs)
#   --sidecar-sew-tol X
#                     ALSO re-read every DECLINED_OPEN file at sew tolerance X and
#                     report it as an explicitly labelled SIDE column. Widening the
#                     tolerance reconstructs nothing; the column exists so the size
#                     of the temptation is on the record. Never the headline.
#   --reuse-census    do not re-run the census; reuse $OUTDIR/census.jsonl, but
#                     ONLY after proving the corpus list is byte-identical to the
#                     one that census was produced from
#   --assert-symbols N / --addon PATH
#                     after the census, assert the shipped addon's OCCT symbol
#                     count is still N (A3).
#
# exit: 0 all asserted identities held / 1 an assertion failed / 2 build or I/O
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$KERNEL/.." && pwd)"
cd "$KERNEL" || exit 2

MODE="report"
JOBS_DEFAULT="$(command -v forge-nproc >/dev/null 2>&1 && forge-nproc 2>/dev/null || echo 4)"
[ -z "${JOBS_DEFAULT// /}" ] && JOBS_DEFAULT=4
JOBS="$JOBS_DEFAULT"
TIMEOUT_MS=60000
SEW_TOL="-1.0"
LIMIT=""
ROOTS=""
ASSERT_SYMBOLS=""
ADDON=""
REUSE_CENSUS=0
SIDECAR_SEW_TOL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --selftest) MODE="selftest" ;;
    --manifest) MODE="manifest" ;;
    --census)   MODE="census" ;;
    --report)   MODE="report" ;;
    --roots)        ROOTS="${2:?--roots needs a value}"; shift ;;
    --jobs)         JOBS="${2:?--jobs needs a value}"; shift ;;
    --timeout-ms)   TIMEOUT_MS="${2:?--timeout-ms needs a value}"; shift ;;
    --sew-tol)      SEW_TOL="${2:?--sew-tol needs a value}"; shift ;;
    --limit)        LIMIT="${2:?--limit needs a value}"; shift ;;
    --assert-symbols) ASSERT_SYMBOLS="${2:?--assert-symbols needs N}"; shift ;;
    --addon)        ADDON="${2:?--addon needs a path}"; shift ;;
    --reuse-census) REUSE_CENSUS=1 ;;
    --sidecar-sew-tol) SIDECAR_SEW_TOL="${2:?--sidecar-sew-tol needs a value}"; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

OBJDIR="${OBJDIR:-$KERNEL/.build-foreign-step-tail}"
OUTDIR="${OUTDIR:-$KERNEL/.foreign-step-tail-out}"
REPORT="${REPORT:-$KERNEL/reports/FOREIGN_STEP_TAIL.md}"
MANIFEST="$OUTDIR/corpus_manifest.jsonl"
MANSUM="$OUTDIR/corpus_manifest_summary.json"
CENSUS_LIST="$OUTDIR/census_list.txt"
CENSUS="$OUTDIR/census.jsonl"
mkdir -p "$OBJDIR/obj" "$OUTDIR" || exit 2

# ── 1. BUILD ────────────────────────────────────────────────────────────────
CXX="${CXX:-clang++}"
INC="include"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2
    exit 2
  fi
fi
OCCT_INC="$OCCT/include/opencascade"
OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
OUT="$OBJDIR/foreign_step_tail_census"
[ "${FORCE:-0}" = "1" ] && { rm -rf "$OBJDIR"; mkdir -p "$OBJDIR/obj"; }

FAIL="$OBJDIR/fail"; : > "$FAIL"
BUILT="$OBJDIR/built"; : > "$BUILT"
CAP=()
cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null || true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done; CAP=(); }
compile() {
  if [ -f "$2" ] && [ "$2" -nt "$1" ]; then return 0; fi
  echo "  CXX $1"
  echo x >> "$BUILT"
  if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c "$1" -o "$2" 2> "$2.err"; then
    echo "SRC FAIL: $1" >&2; tail -20 "$2.err" >&2; echo x >> "$FAIL"; rm -f "$2"
  fi
}

OBJS=()
for src in src/native/*.cpp src/native/*/*.cpp src/OcctPrimBuilder.cpp; do
  [ -e "$src" ] || continue
  obj="$OBJDIR/obj/$(echo "$src" | tr '/.' '__').o"
  OBJS+=("$obj")
  cap compile "$src" "$obj"
done
drain
if [ -s "$FAIL" ]; then
  echo "[t149] native source compile failed ($(wc -l < "$FAIL" | tr -d ' ') file(s))" >&2; exit 2
fi

LIB="$OBJDIR/libforge_native_t149.a"
rm -f "$LIB"
ar -crs "$LIB" "${OBJS[@]}" 2> "$OBJDIR/ar.err" || { echo "[t149] ar FAILED:" >&2; tail -20 "$OBJDIR/ar.err" >&2; exit 2; }

TU="$OBJDIR/obj/foreign_step_tail_census.o"
compile test/foreign_step_tail_census.cpp "$TU"
[ -s "$FAIL" ] && { echo "[t149] harness TU compile failed" >&2; exit 2; }

OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
           -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset"
# shellcheck disable=SC2086
if ! $CXX $FLAGS -I "$INC" -I "$OCCT_INC" "$TU" "$LIB" \
     -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$OUT" 2> "$OBJDIR/link.err"; then
  echo "[t149] LINK FAILED:" >&2; tail -40 "$OBJDIR/link.err" >&2; exit 2
fi
NCOMPILED="$(wc -l < "$BUILT" | tr -d ' ')"
TOTAL_TU=$(( ${#OBJS[@]} + 1 ))
echo "[t149] compiled $NCOMPILED of $TOTAL_TU translation unit(s), reused $(( TOTAL_TU - NCOMPILED ))" >&2

GIT_HEAD="$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)"
GIT_DIRTY_N="$(git -C "$KERNEL" status --porcelain -- src include 2>/dev/null | wc -l | tr -d ' ')"
cat > "$OBJDIR/build_stamp.json" <<STAMPJSON
{"built_utc":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","git_head":"$GIT_HEAD","dirty_src_include":$GIT_DIRTY_N,"flags":"$FLAGS","occt_root":"$OCCT","binary":"$OUT"}
STAMPJSON
if [ "$GIT_DIRTY_N" != "0" ]; then
  echo "[t149] FATAL: $GIT_DIRTY_N modified file(s) under src/ or include/ — this task must change NO production source." >&2
  git -C "$KERNEL" status --porcelain -- src include >&2
  exit 1
fi

# ── 2. SELFTEST, BOTH DIRECTIONS ────────────────────────────────────────────
# A1. The normal run must exit 0. The --invert run flips both bucket assertions
# and MUST exit non-zero — that is the proof the instrument can fail at all.
echo "── A1  selftest, normal ──────────────────────────────────────────────"
"$OUT" --selftest; RC_NORMAL=$?
echo "[t149] A1 selftest normal exit=$RC_NORMAL (expected 0)"
echo "── A1  selftest, INVERTED (must fail) ────────────────────────────────"
"$OUT" --selftest --invert; RC_INVERT=$?
echo "[t149] A1 selftest inverted exit=$RC_INVERT (expected non-zero)"
A1_OK=1
[ "$RC_NORMAL" -ne 0 ] && { echo "[t149] A1 FAIL: the selftest did not pass" >&2; A1_OK=0; }
[ "$RC_INVERT" -eq 0 ] && { echo "[t149] A1 FAIL: the INVERTED selftest passed — the assertion is inert" >&2; A1_OK=0; }
echo "A1_NORMAL_EXIT=$RC_NORMAL"   >  "$OUTDIR/a1_exit_codes.txt"
echo "A1_INVERTED_EXIT=$RC_INVERT" >> "$OUTDIR/a1_exit_codes.txt"
[ "$A1_OK" -eq 1 ] || exit 1
if [ "$MODE" = "selftest" ]; then echo "[t149] selftest mode complete"; exit 0; fi

# ── 3. MANIFEST ─────────────────────────────────────────────────────────────
MANIFEST_PY="$REPO/tools/kernel/foreign_step_corpus_manifest.py"
[ -e "$MANIFEST_PY" ] || { echo "FATAL: missing $MANIFEST_PY" >&2; exit 2; }
if [ -z "$ROOTS" ]; then
  ROOTS="$REPO ${FORGE_STEP_CORPUS_ROOTS:-}"
fi
echo "── manifest over roots: $ROOTS ───────────────────────────────────────"
# shellcheck disable=SC2086
python3 "$MANIFEST_PY" manifest --out "$MANIFEST" --summary "$MANSUM" \
        --list "$CENSUS_LIST" --jobs "$JOBS" $ROOTS || exit 2
if [ "$MODE" = "manifest" ]; then echo "[t149] manifest mode complete: $MANIFEST"; exit 0; fi

# ── 4. CENSUS ───────────────────────────────────────────────────────────────
RUN_LIST="$CENSUS_LIST"
if [ -n "$LIMIT" ]; then
  RUN_LIST="$OUTDIR/census_list_limited.txt"
  head -n "$LIMIT" "$CENSUS_LIST" > "$RUN_LIST"
  echo "[t149] SMOKE RUN — limited to $LIMIT of $(wc -l < "$CENSUS_LIST" | tr -d ' ') lexable files" >&2
fi
if [ "$REUSE_CENSUS" = "1" ] && [ -s "$CENSUS" ] && [ -s "$OUTDIR/census_list.used.txt" ]; then
  # REUSE IS PROVEN, NOT ASSUMED. The census is only reused when the list this
  # run just derived from the corpus is IDENTICAL, line for line, to the list the
  # existing census.jsonl was actually produced from. Anything else — a file
  # added, removed, or newly failing to lex — and the flag refuses, because a
  # census joined to a manifest it does not correspond to is worse than no census.
  if ! diff -q "$RUN_LIST" "$OUTDIR/census_list.used.txt" >/dev/null; then
    echo "[t149] --reuse-census REFUSED: the corpus list changed since census.jsonl was made." >&2
    diff "$RUN_LIST" "$OUTDIR/census_list.used.txt" | head -10 >&2
    exit 1
  fi
  echo "[t149] --reuse-census: list identical ($(wc -l < "$RUN_LIST" | tr -d ' ') paths); reusing $CENSUS"
else
  echo "── census (sew_tol=$SEW_TOL, jobs=$JOBS, timeout_ms=$TIMEOUT_MS) ──────"
  cp "$RUN_LIST" "$OUTDIR/census_list.used.txt"
  "$OUT" --list "$RUN_LIST" --out "$CENSUS" --jobs "$JOBS" \
         --timeout-ms "$TIMEOUT_MS" --sew-tol "$SEW_TOL" || exit 2
fi
if [ "$MODE" = "census" ]; then echo "[t149] census mode complete: $CENSUS"; exit 0; fi

# ── 4a. SIDE COLUMN — the sew-tolerance lever, run on DECLINED_OPEN only ────
SIDECAR=""
if [ -n "$SIDECAR_SEW_TOL" ]; then
  SIDECAR="$OUTDIR/census_sewtol_${SIDECAR_SEW_TOL}.jsonl"
  python3 - "$CENSUS" "$OUTDIR/declined_open.txt" <<'PYSIDE'
import json, sys
n = 0
with open(sys.argv[2], "w") as w:
    for line in open(sys.argv[1]):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        if r["bucket"] == "DECLINED_OPEN":
            w.write(r["path"] + "\n"); n += 1
print("[t149] DECLINED_OPEN files for the sew-tolerance side column: %d" % n, file=sys.stderr)
PYSIDE
  if [ -s "$OUTDIR/declined_open.txt" ]; then
    echo "── SIDE COLUMN: re-read DECLINED_OPEN at sew_tol=$SIDECAR_SEW_TOL (NOT the headline) ──"
    "$OUT" --list "$OUTDIR/declined_open.txt" --out "$SIDECAR" --jobs "$JOBS" \
           --timeout-ms "$TIMEOUT_MS" --sew-tol "$SIDECAR_SEW_TOL" || exit 2
  else
    echo "[t149] no DECLINED_OPEN files — the sew-tolerance side column is empty." >&2
    SIDECAR=""
  fi
fi

# ── 4b. MEASURE THE IN-REPO DUPLICATION ─────────────────────────────────────
# T-149's briefing sizes the corpus with `find .` over the shared checkout, which
# counts every in-repo git worktree's copy of the same tracked files. That is not
# an opinion to assert in prose — it is measured here, with --include-worktrees,
# so the report quotes a number this script produced.
# The MAIN checkout, not this worktree: `git worktree list` prints it first, and
# it is the only tree that actually contains .claude/worktrees. Deriving it by
# string surgery on $REPO gave a path that does not exist, the `[ -d ]` below was
# false, and the whole measurement vanished with no message — the exact quiet
# failure this report is supposed to be proof against. A miss is now LOUD.
DUP_ROOT="${DUP_ROOT:-$(git -C "$REPO" worktree list 2>/dev/null | head -1 | awk '{print $1}')}"
DUP_SHA="?"; DUP_PARTS="?"; DUP_COPIES="?"
if [ -z "$DUP_ROOT" ] || [ ! -d "$DUP_ROOT" ]; then
  echo "[t149] WARNING: in-repo duplication NOT measured — DUP_ROOT='${DUP_ROOT:-<empty>}' is not a directory." >&2
  echo "[t149]          the report will print '?' for those cells. Set DUP_ROOT=<main checkout> to fix." >&2
fi
if [ -n "$DUP_ROOT" ] && [ -d "$DUP_ROOT" ]; then
  python3 "$MANIFEST_PY" manifest --out "$OUTDIR/dup.jsonl" --summary "$OUTDIR/dup.json" \
          --list "$OUTDIR/dup_list.txt" --jobs "$JOBS" --include-worktrees "$DUP_ROOT" >/dev/null 2>&1
  if [ -s "$OUTDIR/dup.json" ]; then
    read -r DUP_TOTAL DUP_SHA DUP_PARTS <<< "$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
print(d["files_total"], d["distinct_sha256"], d["distinct_parts"])' "$OUTDIR/dup.json")"
    DUP_COPIES=$(( DUP_TOTAL - DUP_SHA ))
    echo "[t149] in-repo duplication at $DUP_ROOT: $DUP_TOTAL files, $DUP_SHA distinct blobs, $DUP_PARTS distinct parts, $DUP_COPIES redundant copies"
  else
    echo "[t149] WARNING: in-repo duplication manifest produced no summary at $OUTDIR/dup.json" >&2
  fi
fi

# ── 5. REPORT + A2 IDENTITY ─────────────────────────────────────────────────
mkdir -p "$(dirname "$REPORT")"
python3 "$MANIFEST_PY" report --manifest "$MANIFEST" --summary "$MANSUM" \
        --census "$CENSUS" --out "$REPORT" \
        --a1-normal "$RC_NORMAL" --a1-inverted "$RC_INVERT" --jobs-used "$JOBS" \
        --sew-tol "$SEW_TOL" --build-stamp "$OBJDIR/build_stamp.json" \
        --dup-distinct-sha "$DUP_SHA" --dup-distinct-parts "$DUP_PARTS" --dup-copies "$DUP_COPIES" \
        ${SIDECAR:+--sidecar-census "$SIDECAR"} ${SIDECAR:+--sidecar-sew-tol "$SIDECAR_SEW_TOL"} \
        ${LIMIT:+--limited "$LIMIT"} || exit 1

# A2 — asserted HERE, in the script, not eyeballed in the markdown.
MAN_TOTAL="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["files_total"])' "$MANSUM")"
MAN_PARSEFAIL="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["parse_failed"])' "$MANSUM")"
CENSUS_ROWS="$(wc -l < "$CENSUS" | tr -d ' ')"
EXPECT=$(( MAN_TOTAL - MAN_PARSEFAIL ))
echo "── A2  identity ──────────────────────────────────────────────────────"
echo "[t149] manifest_total=$MAN_TOTAL  parse_failed=$MAN_PARSEFAIL  expect=$EXPECT  census_rows=$CENSUS_ROWS"
if [ -n "$LIMIT" ]; then
  echo "[t149] A2 SKIPPED — --limit $LIMIT was given, so this is a SMOKE run and the identity cannot hold." >&2
  A2_STATE="skipped(limited)"
elif [ "$CENSUS_ROWS" -ne "$EXPECT" ]; then
  echo "[t149] A2 FAIL: census rows $CENSUS_ROWS != manifest_total - parse_failed = $EXPECT" >&2
  exit 1
else
  echo "[t149] A2 PASS: $CENSUS_ROWS == $MAN_TOTAL - $MAN_PARSEFAIL"
  A2_STATE="pass"
fi

# ── 6. A3 — the shipped addon's OCCT symbol count is UNCHANGED ──────────────
if [ -n "$ASSERT_SYMBOLS" ]; then
  [ -n "$ADDON" ] || { echo "[t149] --assert-symbols needs --addon PATH" >&2; exit 2; }
  echo "── A3  shipped-addon symbol census ───────────────────────────────────"
  bash "$KERNEL/scripts/occt_closure_count.sh" "$ADDON" --assert-symbols "$ASSERT_SYMBOLS" --quiet
  RC_A3=$?
  echo "[t149] A3 occt_closure_count.sh --assert-symbols $ASSERT_SYMBOLS exit=$RC_A3"
  [ "$RC_A3" -eq 0 ] || exit 1
fi

echo "[t149] DONE  report=$REPORT  A1=($RC_NORMAL,$RC_INVERT)  A2=$A2_STATE"
exit 0
