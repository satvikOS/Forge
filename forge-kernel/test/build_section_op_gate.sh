#!/usr/bin/env bash
# build_section_op_gate.sh — build + run the SECTION op gate, then PROVE it can fail.
#
# SIX translation units, deliberately: the probe itself, the three kernel sources
# forge::section actually needs (Booleans.cpp, ShapeRegistry.cpp,
# LineageRegistry.cpp), the forge::ft parser TU and the graph audit. It does NOT
# build the kernel. A gate that needed a 40-minute OCCT build is a gate nobody
# runs, and this one is well under a minute.
#
# ── LINK POLICY, stated because it is the one thing here that is not obvious ──
# The gate calls forge::section() and forge::ft::parse(). parse() lives in the
# same translation unit as compile(), which references ~20 further forge symbols
# (massProperties, tessellate, faceInventory, loft, ...) that this harness does
# not link. The gate never calls compile(), so those references are never
# executed. Apple's ld leaves them for the dynamic loader under
# `-undefined dynamic_lookup`; GNU ld has NO equivalent that works — its
# `--unresolved-symbols=ignore-all` links and then the loader refuses the binary
# at startup. This is the same policy, and the same reason, as
# test/ft/build_s0_acceptance.sh, and it is why this gate runs on macOS in CI.
#
# ── SR-3: A GATE THAT CANNOT FAIL IS NOT A GATE ──────────────────────────────
# After the clean run, every --mutate case is run and each MUST exit non-zero.
# The mutations are the real failure modes: reading the section as a body,
# welding two distinct loops into one, and accepting an empty section.
#
# Exit 0 iff the gate built, passed clean, and every mutation turned it red.
set -uo pipefail

KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"

# Search the usual prefixes rather than assuming one: hardcoding the Homebrew
# path is what made a sibling suite unrunnable on Linux, where CI runs.
OCCT="${OCCT_ROOT:-}"
if [ -z "$OCCT" ]; then
  for _c in /opt/homebrew/opt/opencascade \
            /usr/local/opt/opencascade \
            /usr ; do
    [ -e "$_c/include/opencascade/Standard_Version.hxx" ] && { OCCT="$_c"; break; }
  done
fi
if [ -z "$OCCT" ] || [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  echo "[section-gate] FATAL: OCCT not found (brew install opencascade, or set OCCT_ROOT)" >&2
  exit 2
fi

OUT="${OUT:-$KERNEL/test/.section_gate}"
mkdir -p "$OUT" || exit 2

FLAGS=(-std=c++20 -O1 -g0
       -I"$KERNEL/include" -I"$OCCT/include/opencascade"
       -I"$KERNEL/3rdParty/planegcs" -I"$KERNEL/3rdParty/planegcs_eigen_shim")

# FORGE_NATIVE_BREP is deliberately NOT defined. The native route is a separate
# engine with its own gates; this gate is about the OCCT operator that SECTION is
# wired to, and compiling the native branches in would make the answer depend on
# a runtime switch nobody set.
compile_tu() {   # compile_tu <src> <obj> [extra warning flags...]
  local src="$1" obj="$2"; shift 2
  if ! "$CXX" "${FLAGS[@]}" "$@" -c "$src" -o "$obj" 2> "$OUT/$(basename "$obj").err"; then
    echo "[section-gate] COMPILE FAILED: $src" >&2
    tail -40 "$OUT/$(basename "$obj").err" >&2
    exit 2
  fi
}

echo "[1/6] compile forge::ShapeRegistry"
compile_tu "$KERNEL/src/ShapeRegistry.cpp"   "$OUT/ShapeRegistry.o"
echo "[2/6] compile forge::LineageRegistry"
compile_tu "$KERNEL/src/LineageRegistry.cpp" "$OUT/LineageRegistry.o"
echo "[3/6] compile forge::section + the other three booleans"
compile_tu "$KERNEL/src/Booleans.cpp"        "$OUT/Booleans.o"
echo "[4/6] compile forge::ft parser"
compile_tu "$KERNEL/src/ft/FeatureTreeCompiler.cpp" "$OUT/FeatureTreeCompiler.o"
echo "[4b/6] compile forge::ft graph audit"
compile_tu "$KERNEL/src/ft/GraphAudit.cpp"   "$OUT/GraphAudit.o" -Wall -Wextra
echo "[5/6] compile the gate"
compile_tu "$KERNEL/test/section_op_gate.cpp" "$OUT/section_op_gate.o" -Wall -Wextra -Werror

case "$(uname -s)" in
  Darwin) UNDEF=(-Wl,-undefined,dynamic_lookup -Wl,-no_fixup_chains) ;;
  *)      UNDEF=(-Wl,--unresolved-symbols=ignore-all) ;;
esac

echo "[6/6] link"
if ! "$CXX" -std=c++20 \
      "$OUT/section_op_gate.o" "$OUT/Booleans.o" "$OUT/ShapeRegistry.o" \
      "$OUT/LineageRegistry.o" "$OUT/FeatureTreeCompiler.o" "$OUT/GraphAudit.o" \
      -o "$OUT/section_op_gate" \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
      -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      "${UNDEF[@]}" 2> "$OUT/link.err"; then
  echo "[section-gate] LINK FAILED:" >&2
  tail -40 "$OUT/link.err" >&2
  exit 2
fi

echo
"$OUT/section_op_gate"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "[section-gate] RED — the clean run failed (exit $rc)."
  exit 1
fi

# ── the falsifiability proof ────────────────────────────────────────────────
# Each mutation must make the gate exit non-zero. A mutation that stays green
# means the assertion it attacks is not actually being made.
echo
echo "[section-gate] proving the gate can fail"
BAD=0
for m in 1 2 3; do
  if "$OUT/section_op_gate" --mutate "$m" > "$OUT/mutate_$m.log" 2>&1; then
    echo "[section-gate] MUTATION $m STAYED GREEN — that assertion is not being made."
    sed -n '1,20p' "$OUT/mutate_$m.log"
    BAD=1
  else
    echo "[section-gate]   mutation $m -> RED (as required)"
  fi
done
if [ "$BAD" -ne 0 ]; then
  echo "[section-gate] RED — an unfalsifiable check is not a check."
  exit 1
fi

echo
echo "[section-gate] GREEN — SECTION measured, and all 3 mutations proved red."
exit 0
