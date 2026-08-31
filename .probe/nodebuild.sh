#!/usr/bin/env bash
set -uo pipefail
W=/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_4ddb00d8-b61-2
B="$W/.probe/build-node"
cd "$W/forge-kernel" || exit 2
cmake -S . -B "$B" -DFORGE_BUILD_TESTS=OFF -DFORGE_BUILD_NODE_ADDON=ON \
      -DFORGE_BUILD_DESKTOP_FOUNDATION=OFF -DFORGE_BUILD_DESKTOP_RENDERER=OFF \
      -DFORGE_BUILD_DESKTOP_UI=OFF -DCMAKE_BUILD_TYPE=Release > "$W/.probe/node_cfg.log" 2>&1
echo "configure rc=$?"; tail -4 "$W/.probe/node_cfg.log"
cmake --build "$B" --target forge_kernel -j 8 > "$W/.probe/node_build.log" 2>&1
echo "build rc=$?"; tail -6 "$W/.probe/node_build.log"
find "$B" -name 'forge-kernel.node' -o -name 'forge_kernel.node' | head
