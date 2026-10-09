#!/usr/bin/env bash
# fetch_gate_results.sh — download another workflow's forge.gate_result/v1
# records for ONE commit, so a consumer judges acceptance from the records the
# producer wrote instead of from that workflow's colour.
#
#   fetch_gate_results.sh <workflow-file> <commit-sha> <out-dir>
#
# Downloads every artifact named gate-results-* from the newest run of
# <workflow-file> for <commit-sha> into <out-dir>/<artifact>/*.jsonl.
#
# ★ IT NEVER FAILS THE CALLER. A record that could not be fetched is not a
#   PASS and not a FAIL -- it is absent, and release_gate_results.sh turns an
#   absent component into NOT_RUN, which can never accept. Failing here instead
#   would turn "could not ask" into a red publish job, which is the opposite
#   error: the publish decision is the kernel gate's, and stays the kernel gate's.
#   It always prints what it did and how many records it got.
#
# Needs: gh (preinstalled on GitHub runners), GH_TOKEN with actions:read,
# GITHUB_REPOSITORY.
set -uo pipefail
WF="${1:?usage: fetch_gate_results.sh <workflow-file> <sha> <out-dir>}"
SHA="${2:?usage: fetch_gate_results.sh <workflow-file> <sha> <out-dir>}"
OUT="${3:?usage: fetch_gate_results.sh <workflow-file> <sha> <out-dir>}"
mkdir -p "$OUT"
say() { echo "[fetch-gate-results] $*"; }

if ! command -v gh >/dev/null 2>&1; then
  say "gh not found -- no records fetched; every component will read NOT_RUN"; exit 0
fi
REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then say "GITHUB_REPOSITORY unset -- no records fetched"; exit 0; fi

ERR="$(mktemp "${TMPDIR:-/tmp}/fgr.XXXXXX")"
# `gh api` prints an error BODY on stdout, so an answer is only an id if it is digits.
RID="$(gh api "repos/$REPO/actions/workflows/$WF/runs?head_sha=$SHA&per_page=1" \
          --jq '.workflow_runs[0].id // empty' 2>"$ERR")" || RID=""
if ! printf '%s' "$RID" | grep -qE '^[0-9]+$'; then
  say "no $WF run id for $SHA (reply '$(printf '%.80s' "$RID")'; $(head -c 200 "$ERR" | tr '\n' ' '))"
  rm -f "$ERR"; exit 0
fi
say "$WF run $RID for $SHA"
if ! gh run download "$RID" --repo "$REPO" --pattern 'gate-results-*' --dir "$OUT" 2>"$ERR"; then
  say "download failed: $(head -c 300 "$ERR" | tr '\n' ' ')"
fi
rm -f "$ERR"
N="$(find "$OUT" -type f -name '*.jsonl' -exec cat {} + 2>/dev/null | grep -c . || true)"
say "fetched $N record(s) into $OUT"
exit 0
