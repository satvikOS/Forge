#!/usr/bin/env bash
# "A gate that cannot BUILD cannot FAIL and looks like silence." Configure the
# kernel with tests on and BUILD the target the re-registration adds, then run it
# through ctest by its registered name.
set -uo pipefail
W=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2
B="$W/.probe/build-cmake"
cd "$W/forge-kernel" || exit 2
cmake -S . -B "$B" -DFORGE_BUILD_TESTS=ON -DFORGE_BUILD_NODE_ADDON=OFF \
      -DFORGE_BUILD_DESKTOP_FOUNDATION=OFF -DFORGE_BUILD_DESKTOP_RENDERER=OFF \
      -DFORGE_BUILD_DESKTOP_UI=OFF -DCMAKE_BUILD_TYPE=Release > "$W/.probe/cmake_configure.log" 2>&1
rc=$?
echo "configure rc=$rc"
tail -6 "$W/.probe/cmake_configure.log"
[ "$rc" != 0 ] && exit 3
cmake --build "$B" --target forge_gate_ab_native_thicken_occt -j 8 > "$W/.probe/cmake_build.log" 2>&1
rc=$?
echo "build rc=$rc"
tail -12 "$W/.probe/cmake_build.log"
[ "$rc" != 0 ] && exit 4
ls -la "$B/forge_gate_ab_native_thicken_occt" 2>/dev/null
cd "$B" || exit 2
ctest -R '^kernel\.ab\.ab_native_thicken_occt$' --output-on-failure 2>&1 | tail -20
