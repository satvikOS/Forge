#!/usr/bin/env bash
# check_includes.sh — catch the libc++-transitively-included-but-libstdc++-requires
# class of missing #includes BEFORE pushing (CI runs on ubuntu/libstdc++; the Mac's
# Apple-clang/libc++ silently provides these, so a local compile passes but CI fails).
# Usage: bash check_includes.sh <file.cpp> [file2 ...]   (no args = scan all native src+test)
# bash-3.2 compatible (macOS default) — no associative arrays.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

# header|regex pairs — symbol present without its header => CI (libstdc++) build fail
PAIRS=(
  'algorithm|std::(sort|stable_sort|find|find_if|min_element|max_element|clamp|nth_element|partial_sort|shuffle|count|count_if|remove|remove_if|unique|reverse|fill|lower_bound|upper_bound|transform|for_each|any_of|all_of|none_of|copy|copy_if|generate|swap_ranges|minmax|max\(|min\()'
  'numeric|std::(accumulate|iota|inner_product|reduce|partial_sum|adjacent_difference)'
  'cstring|std::(memcpy|memset|memmove|strlen|strcmp)'
  'functional|std::(function|hash|bind|greater|less|ref|cref|plus|multiplies)'
  'limits|std::numeric_limits'
  'cstdint|(u?int(8|16|32|64)_t)'
)

if [ "$#" -gt 0 ]; then FILES=("$@"); else
  FILES=(); while IFS= read -r f; do FILES+=("$f"); done < <(ls forge-kernel/src/native/*.cpp forge-kernel/src/native/*/*.cpp forge-kernel/test/native/*.cpp forge-kernel/test/native/*/*.cpp 2>/dev/null)
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
if [ "$flags" -ne 0 ]; then echo "[check_includes] $flags missing-include issue(s)"; exit 1; fi
echo "[check_includes] OK (${#FILES[@]} files, no missing standard includes)"
