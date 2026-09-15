#!/usr/bin/env bash
# SPDX-License-Identifier: LGPL-2.1-or-later
#
# build_forge_gcs.sh OUT_DIR -- build libforge_gcs as a SHARED library without CMake.
#
# For the script-driven gates that compile a handful of Forge translation units
# by hand: they link THIS library instead of compiling planegcs into their own
# executables, so every test binary exercises the same dynamic boundary the
# application ships. The CMake project beside this file is the authoritative
# build; this script compiles the same six sources with the same definitions.
#
# Prints the absolute path of the library on its last line. Rebuilds an object
# only when its source, or any header of this component, is newer.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${1:?usage: build_forge_gcs.sh OUT_DIR}"
mkdir -p "$OUT/forge_gcs_obj" || exit 2
OUT="$(cd "$OUT" && pwd)"

CXX="${CXX:-clang++}"
if [ -z "${EIGEN3_INCLUDE_DIR:-}" ]; then
  for _e in /opt/homebrew/opt/eigen/include/eigen3 /opt/homebrew/include/eigen3 \
            /usr/local/opt/eigen/include/eigen3 /usr/local/include/eigen3 /usr/include/eigen3; do
    [ -f "$_e/Eigen/Core" ] && { EIGEN3_INCLUDE_DIR="$_e"; break; }
  done
fi
[ -n "${EIGEN3_INCLUDE_DIR:-}" ] || { echo "build_forge_gcs: Eigen headers not found (set EIGEN3_INCLUDE_DIR)" >&2; exit 2; }
if [ -z "${BOOST_INC:-}" ]; then
  for _b in /opt/homebrew/opt/boost/include /opt/homebrew/include /usr/local/opt/boost/include \
            /usr/local/include /usr/include; do
    [ -f "$_b/boost/graph/adjacency_list.hpp" ] && { BOOST_INC="$_b"; break; }
  done
fi
[ -n "${BOOST_INC:-}" ] || { echo "build_forge_gcs: Boost headers not found (set BOOST_INC)" >&2; exit 2; }

FLAGS=(-std=c++20 -O2 -fPIC -w -fvisibility=hidden -fvisibility-inlines-hidden
       -DEIGEN_NO_DEBUG -DFORGE_GCS_BUILDING=1
       -I"$HERE/include" -I"$HERE/compat" -I"$HERE/planegcs"
       -I"$EIGEN3_INCLUDE_DIR" -I"$BOOST_INC")

newest_header=0
while IFS= read -r h; do
  m="$(stat -f '%m' "$h" 2>/dev/null || stat -c '%Y' "$h" 2>/dev/null || echo 0)"
  [ "$m" -gt "$newest_header" ] && newest_header="$m"
done <<EOF
$(find "$HERE/include" "$HERE/compat" "$HERE/planegcs" -name '*.h')
EOF

OBJS=()
for src in planegcs/Constraints.cpp planegcs/GCS.cpp planegcs/Geo.cpp planegcs/SubSystem.cpp \
           planegcs/qp_eq.cpp src/forge_gcs.cpp; do
  obj="$OUT/forge_gcs_obj/$(basename "$src" .cpp).o"
  OBJS+=("$obj")
  if [ -f "$obj" ]; then
    om="$(stat -f '%m' "$obj" 2>/dev/null || stat -c '%Y' "$obj")"
    sm="$(stat -f '%m' "$HERE/$src" 2>/dev/null || stat -c '%Y' "$HERE/$src")"
    if [ "$om" -ge "$sm" ] && [ "$om" -ge "$newest_header" ]; then continue; fi
  fi
  echo "  [forge_gcs] cc $src" >&2
  "$CXX" "${FLAGS[@]}" -c "$HERE/$src" -o "$obj" || { echo "build_forge_gcs: $src failed to compile" >&2; exit 1; }
done

case "$(uname -s)" in
  Darwin) LIB="$OUT/libforge_gcs.dylib"
          LDFLAGS=(-dynamiclib -install_name @rpath/libforge_gcs.dylib) ;;
  *)      LIB="$OUT/libforge_gcs.so"
          LDFLAGS=(-shared -Wl,-soname,libforge_gcs.so) ;;
esac
relink=1
if [ -f "$LIB" ]; then
  relink=0
  for o in "${OBJS[@]}"; do [ "$o" -nt "$LIB" ] && relink=1; done
fi
if [ "$relink" = 1 ]; then
  "$CXX" "${LDFLAGS[@]}" -o "$LIB" "${OBJS[@]}" || { echo "build_forge_gcs: link failed" >&2; exit 1; }
fi
echo "$LIB"
