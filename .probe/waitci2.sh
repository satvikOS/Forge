#!/usr/bin/env bash
for i in $(seq 1 60); do
  s=$(gh pr checks 102 --json name,bucket 2>/dev/null)
  if [ -n "$s" ] && echo "$s" | jq -e 'all(.bucket!="pending")' >/dev/null 2>&1; then
    echo "=== ALL CHECKS TERMINAL ==="
    gh pr checks 102 2>&1 | sed 's/\t/  /g'
    exit 0
  fi
  sleep 30
done
echo "=== STILL PENDING AFTER 30 MIN ==="
gh pr checks 102 2>&1 | sed 's/\t/  /g'
