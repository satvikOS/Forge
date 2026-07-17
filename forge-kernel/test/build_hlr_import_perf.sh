#!/usr/bin/env bash
# build + run the faceted-import HLR perf probe (links OCCT + OcctImport.cpp).
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL"
CXX="${CXX:-clang++}"
INC="include"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
[ -e "$OCCT/include/opencascade/Standard_Version.hxx" ] || OCCT="/usr/local/opt/opencascade"
OCCT_INC="$OCCT/include/opencascade"; OCCT_LIB="$OCCT/lib"
FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
JOBS="${JOBS:-3}"
OBJDIR="$(mktemp -d /tmp/forge_impperf.XXXXXX)"; trap 'rm -rf "$OBJDIR"' EXIT
FAIL="$OBJDIR/fail"; : > "$FAIL"
CAP=(); cap() { "$@" & CAP+=("$!"); if [ "${#CAP[@]}" -ge "$JOBS" ]; then wait "${CAP[0]}" 2>/dev/null||true; CAP=("${CAP[@]:1}"); fi; }
drain() { local p; for p in "${CAP[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null||true; done; CAP=(); }
OBJS=()
compile() { if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1"; tail -8 "$2.err"; echo x>>"$FAIL"; fi; }
for src in src/native/*.cpp src/native/*/*.cpp; do [ -e "$src" ] || continue; obj="$OBJDIR/$(echo "$src"|tr '/.' '__').o"; OBJS+=("$obj"); cap compile "$src" "$obj"; done
drain
[ -s "$FAIL" ] && { echo "native src compile failed"; exit 1; }
IMP="$OBJDIR/OcctImport.o"
$CXX $FLAGS -I "$INC" -I "$OCCT_INC" -c src/OcctImport.cpp -o "$IMP" 2>"$IMP.err" || { echo "OcctImport compile FAIL"; tail -20 "$IMP.err"; exit 1; }
OBJS+=("$IMP")
OCCT_LIBS="-lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset -lTKHLR"
BIN="$OBJDIR/imp_perf"
# shellcheck disable=SC2086
$CXX $FLAGS -I "$INC" -I "$OCCT_INC" test/native_hlr_import_perf.cpp "${OBJS[@]}" -L "$OCCT_LIB" -Wl,-rpath,"$OCCT_LIB" $OCCT_LIBS -o "$BIN" 2>"$BIN.err" || { echo "LINK FAIL"; tail -30 "$BIN.err"; exit 1; }
"$BIN"; exit $?
