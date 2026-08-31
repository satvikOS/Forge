#!/usr/bin/env bash
# DROP HYGIENE on the object file, not on the comment: the new path must not
# reference BRepOffset*, BRepOffsetAPI* or BRepPrimAPI*, and must not pull in a
# toolkit the closure did not already have.
set -uo pipefail
W=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2
O="$W/.probe/build-cmake/CMakeFiles/forge_kernel_core.dir/src/native/brep/NativeThickenShell.cpp.o"
[ -f "$O" ] || { echo "FATAL: object not found: $O"; exit 2; }
echo "object: $O"
for pat in BRepOffset BRepOffsetAPI BRepPrimAPI; do
  n=$(nm -u "$O" | c++filt | grep -c "$pat" )
  echo "  undefined symbols matching $pat : $n"
done
echo
echo "  BRepAlgoAPI_* imports (TKBO, already in the closure and already used by the n-ary fuse):"
nm -u "$O" | c++filt | grep -o 'BRepAlgoAPI_[A-Za-z]*' | sort -u | sed 's/^/    /'
echo "  ShapeUpgrade_* imports (TKShHealing, likewise):"
nm -u "$O" | c++filt | grep -o 'ShapeUpgrade_[A-Za-z]*' | sort -u | sed 's/^/    /'
echo "  forge:: imports:"
nm -u "$O" | c++filt | grep -o 'forge::occt[A-Za-z]*' | sort -u | sed 's/^/    /'
echo
echo "  OCCT toolkits on the SHIPPED core dylib's load closure:"
otool -L "$W/.probe/build-cmake/libforge_kernel_core.dylib" | grep -o 'libTK[A-Za-z0-9]*' | sort -u | tr '\n' ' '
echo
echo "  TKOffset in that closure: $(otool -L "$W/.probe/build-cmake/libforge_kernel_core.dylib" | grep -c 'libTKOffset')"
