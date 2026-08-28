#!/bin/bash
# occt_callsite_census.sh — for each OCCT class named on stdin (one per line), report the
# source files and line counts that reference it under forge-kernel/src and include.
# Comment-only lines (leading // or *) are excluded so a doc mention is never counted as
# a call site.
set -u
ROOT=${ROOT:-/Users/account_clawteam1/archdisc-Mech/.claude/worktrees/wf_3d73768d-f43-4/forge-kernel}
while read -r cls; do
    [ -z "$cls" ] && continue
    hits=$(grep -rn --include='*.cpp' --include='*.hpp' --include='*.h' --include='*.hxx' \
             -w "$cls" "$ROOT/src" "$ROOT/include" 2>/dev/null \
           | grep -v -E ':[0-9]+: *(//|\*|/\*)')
    n=$(printf '%s' "$hits" | grep -c . )
    files=$(printf '%s\n' "$hits" | sed 's/:.*//' | sort -u | sed "s|$ROOT/||" | tr '\n' ' ')
    printf '%-40s sites=%-4s files: %s\n' "$cls" "$n" "$files"
done
