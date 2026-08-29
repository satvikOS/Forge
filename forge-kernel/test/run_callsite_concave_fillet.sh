#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_callsite_concave_fillet.sh — CALL-SITE proof for the native CONCAVE blend.
#
# Unlike run_ab_native_fillet_concave.sh (which compiles the engine TU alone), this
# links the WHOLE node-free kernel, forge_kernel_core, and drives the real public
# entry points forge::part::filletEdges / chamferEdges. It builds and runs the test
# in BOTH configurations:
#
#   1. DEFAULT           — the OCCT BRepFilletAPI fallback is still compiled. A pass
#                          here is a regression test: nothing broke.
#   2. FILLET-DROP       — cmake -DFORGE_FILLET_DROP_NATIVE=ON removes TKFillet from
#                          the link list and compiles out every BRepFilletAPI call.
#                          A reflex fillet that still returns a solid can then ONLY
#                          have come from forge::occtfillet, so a pass here is a
#                          proof of ROUTING, not just of result.
#
# Both builds are full kernel builds (~420 TUs); pass an existing build dir in
# FORGE_BUILD_DIR / FORGE_DROP_BUILD_DIR to reuse one. Set SKIP_DROP=1 to run only
# the default configuration.
#
# NOTE ON THE DROP BUILD: it is an EXPERIMENT here, not a proposal. The CMake option
# stays OFF by default — flipping it needs the corpus A/B recorded in CMakeLists.txt,
# and the engine still declines curved adjacent faces and two-blend vertices, which
# OCCT serves. This script only measures that the concave route works when TKFillet
# is gone.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
KROOT="$ROOT/forge-kernel"
cd "$ROOT"

OCCT_ROOT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT_ROOT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT_ROOT="/usr/local/opt/opencascade"
  else
    echo "[callsite] OCCT not found at $OCCT_ROOT — set OCCT_ROOT="; exit 1
  fi
fi
OCCT_INC="$OCCT_ROOT/include/opencascade"
OCCT_LIB="$OCCT_ROOT/lib"
CXX="${CXX:-clang++}"
NODE_MODULES="${FORGE_NODE_MODULES:-$ROOT/node_modules}"

BIN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/forge_callsite.XXXXXX")"
trap 'rm -rf "$BIN_DIR"' EXIT

rc_all=0

# $1 = build dir, $2 = label, $3.. = extra cmake args
run_config() {
  local bdir="$1"; shift
  local label="$1"; shift
  echo "[callsite] === $label (build dir: $bdir) ==="
  if [ ! -f "$bdir/CMakeCache.txt" ]; then
    if ! cmake -S "$KROOT" -B "$bdir" -DCMAKE_BUILD_TYPE=Release \
         -DFORGE_BUILD_DESKTOP_FOUNDATION=ON \
         -DFORGE_NODE_MODULES="$NODE_MODULES" "$@" > "$BIN_DIR/$label.cfg.log" 2>&1; then
      echo "[callsite] CONFIGURE FAILED"; tail -20 "$BIN_DIR/$label.cfg.log"; return 1
    fi
  fi
  if ! cmake --build "$bdir" --target forge_kernel_core -j "${FORGE_JOBS:-6}" \
       > "$BIN_DIR/$label.build.log" 2>&1; then
    echo "[callsite] BUILD FAILED"; grep -m 20 -E "error:|Error" "$BIN_DIR/$label.build.log"; return 1
  fi
  echo "[callsite] forge_kernel_core built"

  local defs=()
  case "$*" in *FORGE_FILLET_DROP_NATIVE=ON*) defs+=(-DFORGE_FILLET_DROP_NATIVE=1);; esac
  if ! "$CXX" -std=c++20 -O1 -Wall -Wextra -DFORGE_NATIVE_BREP=1 "${defs[@]+"${defs[@]}"}" \
       -I "$KROOT/include" -I "$OCCT_INC" \
       "$KROOT/test/callsite_concave_fillet_test.cpp" \
       -L "$bdir" -lforge_kernel_core -L "$OCCT_LIB" \
       -Wl,-rpath,"$bdir" -Wl,-rpath,"$OCCT_LIB" \
       -o "$BIN_DIR/callsite_$label" 2> "$BIN_DIR/$label.link.log"; then
    echo "[callsite] TEST BUILD/LINK FAILED"; sed -n '1,40p' "$BIN_DIR/$label.link.log"; return 1
  fi

  # PROOF for the drop config: the built library must not name TKFillet at all.
  case "$*" in
    *FORGE_FILLET_DROP_NATIVE=ON*)
      local n
      n=$(otool -L "$bdir/libforge_kernel_core.dylib" | grep -c "TKFillet" || true)
      echo "[callsite] libforge_kernel_core.dylib TKFillet link records: $n"
      if [ "$n" -ne 0 ]; then echo "[callsite] FAIL — TKFillet still linked in the drop build"; return 1; fi
      ;;
  esac

  "$BIN_DIR/callsite_$label"
  local rc=$?
  [ "$rc" -eq 0 ] && echo "[callsite] $label PASS" || echo "[callsite] $label FAIL (exit $rc)"
  return "$rc"
}

run_config "${FORGE_BUILD_DIR:-$KROOT/build-callsite}" default || rc_all=1

if [ "${SKIP_DROP:-0}" != "1" ]; then
  run_config "${FORGE_DROP_BUILD_DIR:-$KROOT/build-callsite-drop}" drop \
             -DFORGE_FILLET_DROP_NATIVE=ON || rc_all=1
fi

exit "$rc_all"
