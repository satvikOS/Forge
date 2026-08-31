#!/bin/bash
# occt_callsite_census.sh — for each OCCT class named on stdin (one per line), report the
# source files and line counts that reference it under forge-kernel/src and include.
# Comment-only lines (leading // or *) are excluded so a doc mention is never counted as
# a call site.
set -u
# ROOT used to default to an absolute path inside an EPHEMERAL agent worktree
# (.claude/worktrees/wf_3d73768d-f43-4) — exactly the kind of directory
# tools/storage/reap_worktrees.sh exists to delete. Once that worktree was reaped every grep
# below silently matched nothing and the census printed "sites=0" for every class: a fabricated
# clean result on the one metric (OCCT call sites -> zero) this script exists to measure.
# Default to the checkout this script actually lives in, and REFUSE to report on a missing tree.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT=${ROOT:-$HERE/../forge-kernel}
if [ ! -d "$ROOT/src" ] || [ ! -d "$ROOT/include" ]; then
    echo "occt_callsite_census: ROOT='$ROOT' has no src/ and include/ — refusing to report 0 call" >&2
    echo "                      sites for a tree that is not there. Set ROOT to a forge-kernel." >&2
    exit 2
fi
ROOT="$(cd "$ROOT" && pwd -P)"
while read -r cls; do
    [ -z "$cls" ] && continue
    hits=$(grep -rn --include='*.cpp' --include='*.hpp' --include='*.h' --include='*.hxx' \
             -w "$cls" "$ROOT/src" "$ROOT/include" 2>/dev/null \
           | grep -v -E ':[0-9]+: *(//|\*|/\*)')
    n=$(printf '%s' "$hits" | grep -c . )
    files=$(printf '%s\n' "$hits" | sed 's/:.*//' | sort -u | sed "s|$ROOT/||" | tr '\n' ' ')
    printf '%-40s sites=%-4s files: %s\n' "$cls" "$n" "$files"
done
