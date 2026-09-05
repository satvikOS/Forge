#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_ft_edge_selector_gate.sh — build the CANDIDATE kernel with directional
# edge selectors and prove they ARE CadQuery's, edge for edge.
#
# THREE THINGS ARE CHECKED, and all three have to hold:
#   1. CadQuery's selection == the kernel's, per selector, on 10 reference solids;
#   2. the Python MIRROR in scripts/cq_to_ir.py (which decides what may enter the
#      corpus) == the kernel's;
#   3. the flag OFF reproduces the previous kernel byte for byte on the whole
#      existing corpus (scripts/verify_ab.py).
#
# NEVER touches tools/pinned/ and never builds in forge-kernel/build — both are
# shared with running harvests. Candidate trees only.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="${MODELS:-/Users/account_clawteam1/archdisc-Models}"
PY="${PY:-$MODELS/.venv/bin/python}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
cd "$KERNEL"

# The candidate trees must be configured EXACTLY like the tree the pin came from
# (cmake-js flags included) or the link line loses `-undefined dynamic_lookup`
# and 400 OCCT symbols go missing — an hour lost to a configuration difference,
# not a code one.
cfg() {
  cmake -S . -B "$1" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_CXX_FLAGS="-D_DARWIN_USE_64_BIT_INODE=1 -D_LARGEFILE_SOURCE -D_FILE_OFFSET_BITS=64 -DBUILDING_NODE_EXTENSION" \
    -DCMAKE_SHARED_LINKER_FLAGS="-undefined dynamic_lookup" \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_LIBRARY_OUTPUT_DIRECTORY="$KERNEL/$1/Release" \
    -DCMAKE_JS_INC="$HOME/.cmake-js/node-arm64/v26.0.0/include/node" \
    -DCMAKE_JS_LIB= -DCMAKE_JS_SRC= -DCMAKE_JS_VERSION=7.4.0 \
    -DNODE_ARCH=arm64 -DNODE_RUNTIME=node -DNODE_RUNTIMEVERSION=26.0.0 \
    -DFORGE_BUILD_DESKTOP_FOUNDATION=ON \
    -DFORGE_FT_DIR_SELECTORS="$2" >/dev/null
}

echo "== configure + build candidates (ON and OFF) =="
cfg build-selectors ON      || exit 1
cfg build-selectors-off OFF || exit 1
make -C build-selectors     -j"$(sysctl -n hw.ncpu)" forge_verify || exit 1
make -C build-selectors-off -j"$(sysctl -n hw.ncpu)" forge_verify || exit 1

echo "== build the selector probe =="
clang++ -std=c++20 -O2 -arch arm64 -Iinclude -I"$OCCT/include/opencascade" \
  -DFORGE_NATIVE_BREP test/ft_edge_selector_test.cpp \
  -Lbuild-selectors/Release -lforge_kernel_core \
  -Wl,-rpath,"$KERNEL/build-selectors/Release" -Wl,-rpath,"$OCCT/lib" \
  -o build-selectors/ft_edge_selector_test || exit 1

RC=0
echo
echo "== 1+2. kernel selection == CadQuery == python mirror =="
"$PY" "$MODELS/scripts/selector_gate.py" \
  --bin "$KERNEL/build-selectors/ft_edge_selector_test" || RC=1

echo
echo "== 3. flag OFF reproduces the previous kernel on the whole corpus =="
"$PY" "$MODELS/scripts/verify_ab.py" \
  --a "$KERNEL/build-selectors-off/forge_verify" \
  --b "$KERNEL/build-selectors/forge_verify" \
  --rows "$MODELS/data/forge/benchcad_ir_gt/train.jsonl" \
  --rows "$MODELS/data/forge/benchcad_ir_gt/heldout.jsonl" | tail -6 || RC=1

exit $RC
