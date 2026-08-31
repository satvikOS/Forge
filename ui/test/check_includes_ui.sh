#!/usr/bin/env bash
# check_includes_ui.sh — the UI layer's missing-#include preflight.
#
# forge-kernel/test/native/check_includes.sh covers the libc++-supplies-it /
# libstdc++-does-not traps that have actually broken CI on this repo. The UI
# layer leans on a wider slice of the standard library (containers, optional,
# functional, iosfwd), so this is a SUPERSET for ui/ only — extending the kernel
# script would change what the kernel gate accepts, which is not this file's job.
#
# Usage: bash check_includes_ui.sh [file ...]   (no args = every ui/ file)
# bash-3.2 compatible (macOS default) — no associative arrays.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PAIRS=(
  'string|std::(string|to_string|stoi|stod|getline)'
  'vector|std::vector'
  'map|std::(map|multimap)'
  'unordered_map|std::unordered_map'
  'unordered_set|std::unordered_set'
  'list|std::list'
  'optional|std::(optional|nullopt)'
  'functional|std::(function|hash|bind|greater|less|ref|cref)'
  'algorithm|std::(sort|stable_sort|find|find_if|min_element|max_element|clamp|lower_bound|upper_bound|binary_search|adjacent_find|reverse|transform|count_if|remove_if|min\(|max\()'
  'sstream|std::(ostringstream|istringstream|stringstream)'
  'stdexcept|std::(out_of_range|invalid_argument|runtime_error|logic_error)'
  'cstddef|std::size_t'
  'cstdint|std::(u?int(8|16|32|64)_t)'
  'cstdio|std::(printf|snprintf|fprintf)'
  'cmath|std::(fabs|sqrt|floor|ceil|round|pow)'
  'utility|std::(move|pair|make_pair|swap)'
  'memory|std::(unique_ptr|shared_ptr|make_unique|make_shared)'
)

if [ "$#" -gt 0 ]; then
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do FILES+=("$f"); done < <(ls ui/include/forge/ui/*.hpp ui/src/*.cpp ui/test/*.hpp ui/test/*.cpp 2>/dev/null)
fi

flags=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  for pair in "${PAIRS[@]}"; do
    h="${pair%%|*}"; re="${pair#*|}"
    if grep -qE "$re" "$f" && ! grep -qE "#include <$h>" "$f"; then
      echo "MISSING <$h>: $f"; flags=$((flags+1))
    fi
  done
done
if [ "$flags" -ne 0 ]; then echo "[check_includes_ui] $flags missing-include issue(s)"; exit 1; fi
echo "[check_includes_ui] OK (${#FILES[@]} files, no missing standard includes)"
