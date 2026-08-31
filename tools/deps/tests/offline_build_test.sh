#!/usr/bin/env bash
# ============================================================================
# offline_build_test.sh — Sacrosanct 3.1 s21.2: PROVE the clean offline build.
#
# s21.2 asks CI to *demonstrate* a build with the network denied. An assertion
# ("FORGE_NETWORK=OFF is set") is not a demonstration. This gate denies the
# network for real and then builds through it.
#
# WHY TWO DENIAL MECHANISMS, NOT ONE
# ----------------------------------
# The repo already has a working dyld interposer (retrieval/test/net_denied_interpose.c)
# that turns socket()/connect()/getaddrinfo() into abort(). It is the right tool for
# the CONFIGURE step: cmake is /opt/homebrew/bin/cmake, an unrestricted binary, so
# DYLD_INSERT_LIBRARIES loads into it and a configure-time file(DOWNLOAD) — which
# CMake runs inside its own process and which no CMake-level override can intercept —
# dies immediately.
#
# It is NOT sufficient for the BUILD step, and this gate measures that rather than
# hoping. macOS SIP strips DYLD_* from the environment when exec'ing a protected
# binary, and the removal is permanent for all descendants. The Unix Makefiles
# generator runs every recipe through /bin/sh, and make is /usr/bin/make — both
# SIP-protected. So under DYLD alone the compiler, the linker and any custom command
# run with the network FULLY AVAILABLE while the log still reads like a pass. Phase 2
# asserts that hole exists, so nobody later "simplifies" this gate down to DYLD only.
#
# The build step is therefore denied with sandbox-exec (deny network*), which is
# enforced by the kernel on the whole process tree and survives exec of SIP binaries.
#
# EVERY phase asserts a measured value, and each denial mechanism is proved capable
# of failing (a real fetch is attempted and must be refused) as well as capable of
# passing (the same fetch must succeed unsandboxed, or the "denial" proves nothing).
# ============================================================================
set -u

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
KERNEL="$REPO/forge-kernel"
OUT="${TMPDIR:-/tmp}/forge_offline_build_test.$$"
PRESET="${FORGE_OFFLINE_PRESET:-macos-arm64-release-make}"
TARGET="${FORGE_OFFLINE_TARGET:-forge_kernel_core}"
BUILD="$REPO/.forge-local/builds/$PRESET"
mkdir -p "$OUT"

pass=0; fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
note() { echo "        $1"; }

echo "offline_build_test: repo=$REPO"
echo "offline_build_test: preset=$PRESET target=$TARGET"
echo

if [ "$(uname -s)" != "Darwin" ]; then
  echo "offline_build_test: SKIP — both denial mechanisms are macOS-specific."
  echo "  A skip is not a pass; on Linux use the CI network namespace instead."
  exit 0
fi

# ── phase 0: build the interposer and prove it can kill a real socket ────────
CC="${CC:-clang}"
if ! "$CC" -dynamiclib -O1 "$REPO/retrieval/test/net_denied_interpose.c" \
      -o "$OUT/net_denied.dylib" 2>"$OUT/interpose.build.log"; then
  bad "phase0 interposer failed to build"; sed 's/^/        /' "$OUT/interpose.build.log"
  echo; echo "offline_build_test: $pass passed, $((fail+1)) failed"; exit 1
fi
printf '#include <sys/socket.h>\nint main(){return socket(AF_INET,SOCK_STREAM,0)>=0?0:1;}\n' > "$OUT/probe.c"
"$CC" -O0 "$OUT/probe.c" -o "$OUT/probe" 2>/dev/null

"$OUT/probe" >/dev/null 2>&1; bare=$?
if [ "$bare" -eq 0 ]; then ok "phase0 baseline: an unguarded socket() succeeds (rc=0)"
else bad "phase0 baseline: socket() failed unguarded (rc=$bare) — the probe is broken, not the network"; fi

DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" "$OUT/probe" >/dev/null 2>&1; interposed=$?
if [ "$interposed" -eq 134 ]; then ok "phase0 interposer aborts a real socket() (rc=134 SIGABRT)"
else bad "phase0 interposer did NOT abort (rc=$interposed) — every later phase would be unfalsifiable"; fi

# ── phase 1: is there even a network to deny? ───────────────────────────────
# Without this, a disconnected laptop scores a perfect green and proves nothing.
/usr/bin/curl -sS -m 10 https://registry.npmjs.org -o /dev/null 2>/dev/null; live=$?
if [ "$live" -eq 0 ]; then
  ok "phase1 the network is REACHABLE unguarded (curl rc=0) — denial is meaningful"
  NET_LIVE=1
else
  note "phase1 network NOT reachable from this host (curl rc=$live)."
  note "        The denial phases below cannot distinguish 'denied' from 'absent',"
  note "        so they are reported but NOT counted as proof."
  NET_LIVE=0
fi

# ── phase 2: measure the DYLD hole, so it is never mistaken for coverage ─────
DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" /bin/sh -c "$OUT/probe" >/dev/null 2>&1; viash=$?
if [ "$viash" -eq 0 ]; then
  ok "phase2 CONFIRMED: DYLD interposition is STRIPPED below /bin/sh (rc=0, not 134)"
  note "        => the interposer secures CONFIGURE only. The build step needs the sandbox."
else
  bad "phase2 expected the interposer to be stripped below /bin/sh but got rc=$viash"
  note "        If macOS changed this, the sandbox may be redundant — re-derive, do not assume."
fi

# ── phase 3: the sandbox must deny a REAL fetch, whole-tree ──────────────────
cat > "$OUT/deny.sb" <<'SB'
(version 1)
(allow default)
(deny network*)
SB
sandbox-exec -f "$OUT/deny.sb" /usr/bin/curl -sS -m 10 https://registry.npmjs.org -o /dev/null 2>/dev/null; sbx=$?
sandbox-exec -f "$OUT/deny.sb" /bin/sh -c '/usr/bin/curl -sS -m 10 https://github.com -o /dev/null' 2>/dev/null; sbxsh=$?
if [ "$NET_LIVE" -eq 1 ]; then
  if [ "$sbx" -ne 0 ]; then ok "phase3 sandbox denies a real fetch (curl rc=$sbx, was 0 unguarded)"
  else bad "phase3 sandbox did NOT deny the fetch (rc=0) — the build proof would be vacuous"; fi
  if [ "$sbxsh" -ne 0 ]; then ok "phase3 sandbox denial SURVIVES /bin/sh (rc=$sbxsh) — whole-tree"
  else bad "phase3 sandbox denial did not survive /bin/sh (rc=0)"; fi

  # The canaries above fail at DNS. That alone would leave the loophole "only name
  # resolution was blocked; a hardcoded IP still gets out". Hit a literal IP so the
  # claim is outbound TCP denial, not merely a broken resolver.
  /usr/bin/curl -sS -m 8 -o /dev/null https://1.1.1.1 2>/dev/null; ipbare=$?
  sandbox-exec -f "$OUT/deny.sb" /usr/bin/curl -sS -m 8 -o /dev/null https://1.1.1.1 2>/dev/null; ipsbx=$?
  if [ "$ipbare" -eq 0 ] && [ "$ipsbx" -ne 0 ]; then
    ok "phase3 sandbox blocks outbound TCP to a LITERAL IP (rc=$ipsbx vs $ipbare unguarded) — not just DNS"
  elif [ "$ipbare" -ne 0 ]; then
    note "phase3 literal-IP baseline unreachable (rc=$ipbare); uncounted"
  else
    bad "phase3 a literal IP got out of the sandbox (rc=0) — only DNS was being denied"
  fi
else
  note "phase3 sandbox curl rc=$sbx, via-sh rc=$sbxsh (uncounted: no live network baseline)"
fi

# ── phase 4: the interposer must kill a configure-time file(DOWNLOAD) ────────
# file(DOWNLOAD) runs inside cmake and CANNOT be overridden in CMake, so this is
# the one configure-time fetch only the interposer can stop. It must go red.
# Destination is an absolute path under $OUT on purpose: in `cmake -P` script mode
# CMAKE_CURRENT_BINARY_DIR is the CWD, so a relative destination drops the artifact
# into whatever directory the gate was invoked from — the repo root, in practice.
cat > "$OUT/dl.cmake" <<C
file(DOWNLOAD "https://registry.npmjs.org/node-addon-api" "$OUT/dl_probe.out" TIMEOUT 10 STATUS st)
message(STATUS "file(DOWNLOAD) returned: \${st}")
C
DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" cmake -P "$OUT/dl.cmake" >"$OUT/dl.log" 2>&1; dlrc=$?
if grep -q "NETWORK DENIED" "$OUT/dl.log"; then
  ok "phase4 interposer aborted a real configure-time file(DOWNLOAD) (rc=$dlrc)"
else
  bad "phase4 file(DOWNLOAD) was NOT denied inside cmake (rc=$dlrc)"; sed 's/^/        /' "$OUT/dl.log"
fi

# ── phase 5: configure forge-kernel with the network denied ─────────────────
DYLD_INSERT_LIBRARIES="$OUT/net_denied.dylib" \
  cmake -S "$KERNEL" --preset "$PRESET" -DFORGE_BUILD_NODE_ADDON=OFF \
  >"$OUT/configure.log" 2>&1; cfg=$?
if [ "$cfg" -eq 0 ]; then ok "phase5 configure SUCCEEDED with the network denied (rc=0)"
else bad "phase5 configure failed (rc=$cfg)"; tail -25 "$OUT/configure.log" | sed 's/^/        /'; fi

if grep -q "network lint OK" "$OUT/configure.log"; then
  ok "phase5 ForgeDeps network lint ran: $(grep -o 'network lint OK[^"]*' "$OUT/configure.log" | head -1)"
else bad "phase5 the network lint did not run — FORGE_NETWORK=OFF may not be in effect"; fi

if grep -q "FORGE_NETWORK=OFF" "$OUT/configure.log"; then
  ok "phase5 configure confirms FORGE_NETWORK=OFF"
else bad "phase5 configure never reported FORGE_NETWORK=OFF"; fi

# ── phase 6: BUILD, whole tree denied, with canaries inside that same tree ───
# Touch one real source so the compiler and linker genuinely run under denial
# rather than make reporting an up-to-date no-op as a pass.
TU="$KERNEL/src/native/capi/forge_capi.cpp"
[ -f "$TU" ] && touch "$TU"

cat > "$OUT/inner.sh" <<INNER
set -u
/usr/bin/curl -sS -m 10 https://registry.npmjs.org -o /dev/null 2>/dev/null; echo "CANARY_DIRECT=\$?"
/bin/sh -c '/usr/bin/curl -sS -m 10 https://github.com -o /dev/null' 2>/dev/null; echo "CANARY_VIA_SH=\$?"
/usr/bin/git clone --depth 1 https://github.com/nodejs/node-addon-api "$OUT/clone_probe" >/dev/null 2>&1; echo "CANARY_GIT=\$?"
/usr/bin/curl -sS -m 8 -o /dev/null https://1.1.1.1 2>/dev/null; echo "CANARY_IP=\$?"
cmake --build "$BUILD" --target "$TARGET" -j"\${FORGE_OFFLINE_JOBS:-3}"
echo "BUILD_RC=\$?"
INNER

sandbox-exec -f "$OUT/deny.sb" /bin/bash "$OUT/inner.sh" >"$OUT/build.log" 2>&1

cd="$(grep -o 'CANARY_DIRECT=[0-9]*' "$OUT/build.log" | cut -d= -f2)"
cs="$(grep -o 'CANARY_VIA_SH=[0-9]*' "$OUT/build.log" | cut -d= -f2)"
cg="$(grep -o 'CANARY_GIT=[0-9]*'    "$OUT/build.log" | cut -d= -f2)"
ci="$(grep -o 'CANARY_IP=[0-9]*'     "$OUT/build.log" | cut -d= -f2)"
br="$(grep -o 'BUILD_RC=[0-9]*'      "$OUT/build.log" | cut -d= -f2)"

if [ "$NET_LIVE" -eq 1 ]; then
  if [ "${cd:-x}" != "0" ] && [ "${cs:-x}" != "0" ] && [ "${cg:-x}" != "0" ] && [ "${ci:-x}" != "0" ]; then
    ok "phase6 all four canaries REFUSED inside the build's own tree (direct=$cd via_sh=$cs git=$cg literal_ip=$ci)"
  else
    bad "phase6 a canary reached the network during the build (direct=${cd:-?} via_sh=${cs:-?} git=${cg:-?} literal_ip=${ci:-?})"
  fi
else
  note "phase6 canaries direct=${cd:-?} via_sh=${cs:-?} git=${cg:-?} literal_ip=${ci:-?} (uncounted: no live network baseline)"
fi

if [ "${br:-1}" = "0" ]; then ok "phase6 '$TARGET' BUILT with the network denied (rc=0)"
else bad "phase6 build failed (rc=${br:-?})"; tail -30 "$OUT/build.log" | sed 's/^/        /'; fi

if grep -qE "Built target $TARGET|Linking" "$OUT/build.log"; then
  ok "phase6 the log shows real compilation/linking, not an up-to-date no-op"
else
  bad "phase6 no compile/link line — the build may have been a no-op"
fi

echo
echo "offline_build_test: logs in $OUT"
echo "offline_build_test: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
exit 0
