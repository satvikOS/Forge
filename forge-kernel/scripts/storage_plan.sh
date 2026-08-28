#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# storage_plan.sh — build and run the native storage governor in DRY RUN.
#
# This script is a LAUNCHER. Every decision about what may be reclaimed lives in
# forge::native::storage (C++); there is deliberately no rm, no unlink, no
# `git worktree prune`, and no `git worktree remove` anywhere below this line.
# The reason is not stylistic: a shell script that can both decide and delete is
# one typo in a variable expansion away from `rm -rf /`. The C++ tool cannot
# delete at all, so the worst a bug here can do is print a wrong plan.
#
# Usage:
#   bash forge-kernel/scripts/storage_plan.sh [workspace] [outdir]
# Defaults: workspace = the repo this script lives in
#           outdir    = forge-kernel/reports
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKSPACE="${1:-$ROOT}"
OUTDIR="${2:-$ROOT/forge-kernel/reports}"
CXX="${CXX:-clang++}"

case "$WORKSPACE" in
  /) echo "storage_plan: refusing '/' as a workspace"; exit 2 ;;
  "$HOME") echo "storage_plan: refusing \$HOME as a workspace"; exit 2 ;;
  /*) : ;;
  *) echo "storage_plan: workspace must be an absolute path, got '$WORKSPACE'"; exit 2 ;;
esac
# The C++ registry re-checks all of the above, and several rules this script
# does not implement. The checks here only fail fast with a clearer message.

BINDIR="$(mktemp -d /tmp/forge_storage_govern.XXXXXX)"
trap 'rm -rf "$BINDIR"' EXIT
BIN="$BINDIR/storage_govern"

echo "[storage] building forge::native::storage governor (pure C++20, no deps)"
if ! $CXX -std=c++20 -O2 -I "$ROOT/forge-kernel/include" \
      "$ROOT/forge-kernel/src/native/storage/StorageGovernor.cpp" \
      "$ROOT/forge-kernel/tools/storage_govern_main.cpp" -o "$BIN"; then
  echo "[storage] BUILD FAILED"; exit 1
fi

mkdir -p "$OUTDIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TXT="$OUTDIR/storage_plan.txt"
JSON="$OUTDIR/storage_plan.json"

echo "[storage] dry-run planning over $WORKSPACE"
"$BIN" --workspace "$WORKSPACE" \
       --pushed-ref "${PUSHED_REF:-refs/remotes/origin/archdisc}" \
       --hot-days "${HOT_DAYS:-7}" --stale-days "${STALE_DAYS:-14}" \
       --out "$TXT" --json "$JSON"
rc=$?

{ echo; echo "generated: $STAMP  (dry run — nothing was deleted)"; } >> "$TXT"
echo "[storage] plan written: $TXT"
echo "[storage] plan written: $JSON"
echo "[storage] NOTHING WAS DELETED. Acting on this plan is a separate, human decision."
exit "$rc"
