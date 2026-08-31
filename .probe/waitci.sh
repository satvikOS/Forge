#!/usr/bin/env bash
# Emit ONE line per check as it reaches a terminal state, exit when none pending.
prev=""
for i in $(seq 1 120); do
  s=$(gh pr checks 102 --json name,bucket 2>/dev/null) || { sleep 30; continue; }
  [ -z "$s" ] && { sleep 30; continue; }
  cur=$(echo "$s" | jq -r '.[] | select(.bucket!="pending") | "\(.bucket)\t\(.name)"' | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev="$cur"
  if echo "$s" | jq -e 'all(.bucket!="pending")' >/dev/null 2>&1; then
    echo "=== ALL CHECKS TERMINAL ==="
    gh pr checks 102 2>&1 | sed 's/\t/  /g'
    exit 0
  fi
  sleep 30
done
echo "=== TIMED OUT WAITING ==="
gh pr checks 102 2>&1 | sed 's/\t/  /g'
