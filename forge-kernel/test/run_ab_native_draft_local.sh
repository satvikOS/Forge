#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ab_native_draft_local.sh — LIVE-OCCT A/B for the GENERAL native DRAFT.
#
# Compiles test/ab_native_draft_local.cpp together with the engine it exercises —
# src/native/brep/NativeDraftLocal.cpp — against OCCT and runs it. Exit 0 iff
# every volume / area / centre-of-mass / bounding-box / topology / Euler / genus
# / validity assertion holds, BOTH equal-observable NEGATIVE CONTROLS are
# rejected, and every DEFER control declines with the NAMED reason.
#
# It also asserts the POINT of the exercise on the OBJECT FILE. THREE toolkits,
# not one:
#   * TKOffset   — the toolkit being dropped. Zero is the whole exercise.
#   * TKGeomBase — a FREE RIDER that leaves the closure at drop step 6 only
#   * TKGeomAlgo — a FREE RIDER that leaves at step 5 only
# The two free riders cost nothing today precisely because the kernel has no
# references of its own left to them (reports/OCCT_DROP_ORDER.md section 4.2). A
# new reference from this engine would silently convert two zero-cost closure
# points into two funded work items, and nothing else in the build would notice.
# So they are checked here, at the only moment they could be reintroduced.
#
# TKOffset is LINKED here, on purpose: the A/B's reference half calls
# BRepOffsetAPI_DraftAngle. The zero-import claim is about the ENGINE's object
# file, which is compiled separately below, and with -Werror.
#
# --mutations additionally proves the harness CAN fail: SEVEN defects are injected
# into a COPY of the engine and each must turn the A/B red. A gate that cannot
# fail is not a gate.
#
# OCCT root is the brew default; override with OCCT_ROOT= (matches CMakeLists).
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2

WANT_MUT=0
for a in "$@"; do
  case "$a" in
    --mutations) WANT_MUT=1 ;;
    *) echo "[ab-draft-local] unknown flag: $a" >&2; exit 2 ;;
  esac
done

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[ab-draft-local] OCCT not found at $OCCT_ROOT — 'brew install opencascade' or set OCCT_ROOT="
    exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"

CXX="${CXX:-clang++}"
INC="forge-kernel/include"
OUT="$(mktemp -d "${TMPDIR:-/tmp}/forge_ab_draft_local.XXXXXX")"
trap 'rm -rf "$OUT"' EXIT

ENGINE=forge-kernel/src/native/brep/NativeDraftLocal.cpp
HARNESS=forge-kernel/test/ab_native_draft_local.cpp

OCCT_LIBS=(-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKGeomAlgo
           -lTKBRep -lTKTopAlgo -lTKShHealing -lTKPrim -lTKOffset -lTKBO -lTKBool)

echo "[ab-draft-local] OCCT $OCCT_ROOT"

build_one() {   # build_one <engine.cpp> <out-binary>
  # -Wno-deprecated-declarations: OCCT 7.9's own NCollection headers call
  # sprintf(3). That is OCCT's code, not ours; the ENGINE is compiled -Werror
  # below with no waiver.
  "$CXX" -std=c++20 -O1 -Wall -Wextra -Wno-deprecated-declarations \
      -DFORGE_NATIVE_BREP=1 \
      -I "$INC" -I "$OCCT_INC" \
      "$HARNESS" "$1" \
      -L "$OCCT_LIB" "${OCCT_LIBS[@]}" -o "$2" 2>"$OUT/build.err"
}

if ! build_one "$ENGINE" "$OUT/ab_draft_local"; then
  echo "[ab-draft-local] BUILD/LINK FAIL"; sed -n '1,120p' "$OUT/build.err"; exit 1
fi

# ── PROOF OF THE POINT: the engine's own object file, compiled alone, -Werror ──
if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -Werror -Wno-deprecated-declarations \
     -DFORGE_NATIVE_BREP=1 -I "$INC" -I "$OCCT_INC" \
     -c "$ENGINE" -o "$OUT/engine.o" 2>"$OUT/engine.err"; then
  echo "[ab-draft-local] engine-only -Werror compile FAILED"
  sed -n '1,80p' "$OUT/engine.err"; exit 1
fi
nm -u "$OUT/engine.o" | sed 's/^ *//' | sort -u > "$OUT/engine.undef"

HYG_BAD=0
for TK in TKOffset TKGeomBase TKGeomAlgo; do
  LIBFILE="$(ls "$OCCT_LIB"/lib$TK.*.dylib 2>/dev/null | head -1)"
  if [ -z "$LIBFILE" ]; then
    echo "[ab-draft-local] FAIL — lib$TK not found in $OCCT_LIB; the zero-import"
    echo "                 check would pass VACUOUSLY. Refusing."
    exit 1
  fi
  nm -gU "$LIBFILE" 2>/dev/null | awk 'NF>=3{print $3} NF==2{print $2}' \
    | sort -u > "$OUT/$TK.exports"
  if [ ! -s "$OUT/$TK.exports" ]; then
    echo "[ab-draft-local] FAIL — could not read lib$TK exports; vacuous check refused."
    exit 1
  fi
  N=$(comm -12 "$OUT/engine.undef" "$OUT/$TK.exports" | tee "$OUT/$TK.hits" | grep -c . )
  echo "[ab-draft-local] NativeDraftLocal.o $TK imports: $N"
  if [ "$N" -ne 0 ]; then
    echo "[ab-draft-local] FAIL — the engine imports $TK symbols:"
    c++filt < "$OUT/$TK.hits"
    HYG_BAD=1
  fi
done
[ "$HYG_BAD" -eq 0 ] || exit 1

DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/ab_draft_local"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "[ab-draft-local] FAIL (exit $rc)"
  exit "$rc"
fi

if [ "$WANT_MUT" -eq 0 ]; then
  echo "[ab-draft-local] PASS"
  exit 0
fi

# ── MUTATION PROOF ───────────────────────────────────────────────────────────
# Each mutant is a ONE-LINE edit to a COPY of the engine that changes an answer
# the A/B claims to check. Every one MUST turn the A/B red. A mutant that stays
# green names a claim nothing is actually testing.
#
# `mutate` aborts on a pattern it cannot find, because a stale anchor silently
# takes the mutant AND every later one out of the run.
mutate() {   # mutate <n> <label> <sed-expr...>
  local n="$1"; shift
  local label="$1"; shift
  cp "$ENGINE" "$OUT/mut.cpp"
  local before after
  before="$(md5 -q "$OUT/mut.cpp" 2>/dev/null || md5sum "$OUT/mut.cpp" | cut -d' ' -f1)"
  for e in "$@"; do sed -i '' -e "$e" "$OUT/mut.cpp" 2>/dev/null || sed -i -e "$e" "$OUT/mut.cpp"; done
  after="$(md5 -q "$OUT/mut.cpp" 2>/dev/null || md5sum "$OUT/mut.cpp" | cut -d' ' -f1)"
  if [ "$before" = "$after" ]; then
    echo "[ab-draft-local] MUTATION $n ($label): the anchor did not match — STALE. Refusing."
    exit 1
  fi
  if ! build_one "$OUT/mut.cpp" "$OUT/mut_bin"; then
    echo "  mutation $n ($label): RED (did not compile)"
    return 0
  fi
  DYLD_LIBRARY_PATH="$OCCT_LIB" "$OUT/mut_bin" > "$OUT/mut.log" 2>&1
  local mrc=$?
  if [ "$mrc" -eq 0 ]; then
    echo "  mutation $n ($label): STAYED GREEN — the check it targets is unfalsifiable"
    MUT_BAD=$((MUT_BAD+1))
  else
    local first
    first="$(grep -m1 '  FAIL' "$OUT/mut.log" | sed 's/^  FAIL  //')"
    echo "  mutation $n ($label): RED (exit $mrc) <- ${first:-no FAIL line}"
  fi
  MUT_TOTAL=$((MUT_TOTAL+1))
}

MUT_BAD=0
MUT_TOTAL=0
echo "[ab-draft-local] mutation proof (each injected defect must turn the A/B red):"

# WHY THESE MUTANTS AND NOT OTHERS. The first draft of this list removed four
# GUARDS (the vertex residual check, the verbatim-carry short circuit, the
# re-trim range check, the topology self-check) and all four STAYED GREEN. That
# was the harness being right and the mutants being wrong: deleting a defer that
# never fires on valid input changes no answer, so it proves nothing. Every
# mutant below instead injects a WRONG ANSWER and requires the A/B to notice.
#
# ONE PATH IS DELIBERATELY NOT MUTATED HERE: the anchor / re-trim solve. It does
# not fire on ANY case in this A/B (a mutant of it stayed green, which is how
# that was discovered), because it needs a moved vertex touching a curved face
# that the wall itself does not meet along an edge — a valence-4 configuration
# no primitive fixture produces. It is measured on the corpus instead, by
# test/draft_local_probe.cpp, which counts how often it fires.

# 1. THE SIGN. theta = -angleRad mirrors every draft. NativeDraft.cpp's history
#    records this exact defect reaching a first A/B run (cube 5 deg: 1185.18
#    grown against OCCT's 835.23 shrunk).
mutate 1 "draft sign flipped" \
  's/const double theta = angleRad;   \/\/ SIGN/const double theta = -angleRad;   \/\/ SIGN/'

# 2. THE ROTATION AXIS. Move the axis point to the origin: the wall then tilts
#    about the wrong line and the neutral section is no longer pinned.
mutate 2 "rotation axis moved to the origin" \
  's/out.d  = nn.Dot(p0v);/out.d  = 0.0;/'

# 3. THE VERTEX SOLVE. Displace every solved corner by 1e-4 of a millimetre.
#    Either the residual guard catches it and the engine defers, or it does not
#    and the geometry disagrees with OCCT. Both are RED; a green here would mean
#    NOTHING in the harness looks at where a corner actually went.
mutate 3 "solved vertex displaced by 1e-4" \
  's/        rec.pos = cand;/        rec.pos = cand.Translated(gp_Vec(1.0e-4, 0.0, 0.0));/'

# 4. THE WALL EDGE. Stop the rebuilt edge 10% short of its own end vertex.
mutate 4 "rebuilt wall edge stops short of its vertex" \
  's/            t1 = seg.Magnitude();/            t1 = seg.Magnitude() * 0.9;/'

# 5. THE VERBATIM WIRE CARRY — the capability this whole engine exists for. Drop
#    an untouched wire instead of re-adding it, and a bore's inner ring vanishes.
#    A green here would mean the multi-wire claim is untested.
mutate 5 "an untouched inner wire is dropped instead of carried" \
  's/                bb.Add(nf, w);                       \/\/ THE hole-carrying case: verbatim/                { }/'

# 6. THE WALL SURFACE. Keep the ORIGINAL plane on the drafted face while its
#    edges still move — the classic half-applied draft that looks plausible.
mutate 6 "drafted face keeps its original plane" \
  's/            const Plane\& rp = wallPlane\[static_cast<std::size_t>(fi) - 1\];/            Plane rp; if (!outwardPlaneOf(oldF, rp)) return defer("mut");/'

# 7. THE ORIENTATION BOOKKEEPING. Do not flip the new plane normal for a
#    REVERSED face, so half the drafted walls face inwards.
mutate 7 "reversed-face normal not flipped" \
  's/            if (faceMap(fi).Orientation() == TopAbs_REVERSED) nrm.Reverse();/            if (false) nrm.Reverse();/'

echo "[ab-draft-local] $MUT_TOTAL mutation(s) run, $MUT_BAD stayed green"
if [ "$MUT_BAD" -ne 0 ]; then
  echo "[ab-draft-local] FAIL — an unfalsifiable check is not a check"
  exit 1
fi
echo "[ab-draft-local] PASS — A/B green and mutation-proved ($MUT_TOTAL/$MUT_TOTAL red)"
exit 0
