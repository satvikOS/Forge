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
  'algorithm|std::(sort|stable_sort|find|find_if|min_element|max_element|clamp|nth_element|partial_sort|shuffle|count|count_if|remove\([^;]*,|remove_if|unique|reverse|fill|lower_bound|upper_bound|transform|for_each|any_of|all_of|none_of|copy|copy_if|generate|swap_ranges|minmax|max\(|min\()'
  'numeric|std::(accumulate|iota|inner_product|reduce|partial_sum|adjacent_difference)'
  'cstring|std::(memcpy|memset|memmove|strlen|strcmp)'
  'functional|std::(function|hash|bind|greater|less|ref|cref|plus|multiplies)'
  'limits|std::numeric_limits'
  'cstdint|(u?int(8|16|32|64)_t)'
)

# -- --self-test: PROVE THE GATE CAN FAIL -------------------------------------
# This file is a heuristic over text, and a heuristic only ever observed saying OK
# is indistinguishable from `exit 0`. The `remove` entry in particular carries a
# discriminator -- <algorithm>'s std::remove is the THREE-argument range form,
# <cstdio>'s is the ONE-argument path form -- and that discriminator is worth
# exactly as much as the evidence that it still flags what it is meant to flag.
# Every fixture below is a positive or a negative control; a wrong verdict is RED.
if [ "${1:-}" = "--self-test" ]; then
  T="$(mktemp -d "${TMPDIR:-/tmp}/check_includes_selftest.XXXXXX")" || exit 3
  trap 'rm -rf "$T"' EXIT
  fails=0
  ncase=0
  mk() { printf '%s\n' "$2" > "$T/$1.cpp"; }
  chk() {
    name="$1"; want="$2"
    ncase=$((ncase+1))
    out="$(bash "${BASH_SOURCE[0]}" "$T/$name.cpp" 2>&1)"; rc=$?
    if [ "$want" = flag ] && [ "$rc" -eq 0 ]; then
      echo "[self-test] MISS: $name should have been flagged, was not"; fails=$((fails+1))
    elif [ "$want" = ok ] && [ "$rc" -ne 0 ]; then
      echo "[self-test] FALSE POSITIVE: $name should be clean -- $out"; fails=$((fails+1))
    else
      echo "[self-test] ok   $name (expected $want)"
    fi
  }

  # The regression this discriminator exists for. <cstdio>'s std::remove(path) is not
  # <algorithm>, and demanding <algorithm> for it stopped forge-desktop's entire tier-2
  # differential from ever compiling in CI -- the gate that compares the SOLIDS.
  mk stdio_remove '#include <cstdio>
#include <string>
void f(const std::string& p) { std::remove(p.c_str()); }'
  chk stdio_remove ok

  # ...and the case it must still catch, unchanged.
  mk range_remove '#include <vector>
void f(std::vector<int>& v) { v.erase(std::remove(v.begin(), v.end(), 3), v.end()); }'
  chk range_remove flag

  mk range_remove_ok '#include <algorithm>
#include <vector>
void f(std::vector<int>& v) { v.erase(std::remove(v.begin(), v.end(), 3), v.end()); }'
  chk range_remove_ok ok

  mk remove_if '#include <vector>
void f(std::vector<int>& v, bool(*p)(int)) { std::remove_if(v.begin(), v.end(), p); }'
  chk remove_if flag

  # One control per remaining PAIR, so a future edit that guts a whole entry is loud.
  mk sort_missing '#include <vector>
void f(std::vector<int>& v) { std::sort(v.begin(), v.end()); }'
  chk sort_missing flag

  mk accumulate_missing '#include <vector>
int f(std::vector<int>& v) { return std::accumulate(v.begin(), v.end(), 0); }'
  chk accumulate_missing flag

  mk memcpy_missing 'void f(char* a, char* b) { std::memcpy(a, b, 4); }'
  chk memcpy_missing flag

  mk function_missing 'void f() { std::function<void()> g; }'
  chk function_missing flag

  mk limits_missing 'double f() { return std::numeric_limits<double>::max(); }'
  chk limits_missing flag

  mk cstdint_missing 'uint32_t f() { return 0; }'
  chk cstdint_missing flag

  mk clean '#include <algorithm>
#include <cstdint>
#include <limits>
#include <vector>
uint32_t f(std::vector<int>& v) { std::sort(v.begin(), v.end()); return 0; }'
  chk clean ok

  if [ "$fails" -ne 0 ]; then
    echo "[self-test] RED -- $fails of $ncase controls gave the wrong verdict"; exit 1
  fi
  echo "[self-test] OK -- $ncase controls, every one the expected verdict"
  exit 0
fi

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
