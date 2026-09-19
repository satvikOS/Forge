#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# forge_cxx_cache.sh — SOURCED, never executed. A parallel, content-addressed
# compile for the gate scripts whose mutation proofs rebuild the same sources
# once per mutation.
#
# ── WHY IT EXISTS (T-160) ───────────────────────────────────────────────────
# MEASURED on merged head 29070823, from the GitHub Actions per-step timings:
#
#   forge::ui workstation gates        2,858 s total
#     what a USER reads   (13 muts)    1,203 s   42.1%
#     docked-tab pin      ( 6 muts)      585 s   20.5%
#     model/sketch tabs   ( 4 muts)      416 s   14.6%
#   OCCT kernel smoke                  3,175 s total
#     Desktop CRASH-ISOLATION (8 muts) 1,091 s   34.4%
#
# Every one of those steps spends its time the same way: ONE clang++ invocation
# naming ~47-50 translation units, which the driver compiles STRICTLY SERIALLY,
# repeated once per mutation from scratch. The prose gate alone compiles 14 x 47
# = 658 translation units to prove 13 mutations; 13 of those 14 builds differ
# from the first by AT MOST ONE source file.
#
# ── ★ WHAT THIS MUST NEVER DO ───────────────────────────────────────────────
# A mutation proof exists to show a gate can go RED. The fastest mutation proof
# is one that does not rebuild — and it is worthless, because it runs the
# UNMUTATED binary and passes. That has already happened in this repository
# (run_step_unit_decline_gate.sh: the mutation's rewrite landed in the same
# second as the previous build, cmake judged the library current, the unmutated
# binary ran, and the gate printed "mutation stayed GREEN — the gate does not
# test the defect" — it accused itself of being blind, on a second-boundary
# race).
#
# SO THIS CACHE IS KEYED ON CONTENT, NEVER ON A TIMESTAMP. An object is reused
# only when ALL of the following are byte-identical to the run that produced it:
#
#   1. the translation unit's own bytes          (shasum of the file)
#   2. its path                                  (a moved file is a new key)
#   3. the exact compile flags, in order         (includes every -D and -I)
#   4. the compiler's own --version banner       (a toolchain change invalidates)
#   5. the EPOCH — the bytes of every file under every in-tree -I directory and
#      every directory holding a named source. Any header edit anywhere in the
#      tree changes the epoch and therefore EVERY key, forcing a full rebuild.
#
# (5) is deliberately far more conservative than a dependency scan: it does not
# ask which headers a TU included, it invalidates the whole cache when any
# in-tree header moves at all. Over-invalidation costs seconds; under-
# invalidation is the defect above.
#
# EXTERNAL include roots (/usr, /opt, /Library, /Applications, an Xcode SDK) are
# NOT hashed — they are the toolchain, they are pinned by (4) for the compiler
# and by the job's `brew install` step for the SDKs, and they cannot change
# while a gate script is running. THEY ARE NOT AN INPUT A MUTATION TOUCHES.
# fcc_report_epoch prints which roots were hashed and which were excluded, so
# that judgement is visible in the CI log rather than assumed.
#
# THE CACHE IS PER-RUN. Callers are expected to put FCC_CACHE inside their own
# mktemp -d work directory, so it is created empty, is never shared between two
# invocations of a gate, and is deleted with the rest of the work tree. Nothing
# from a previous checkout, a previous branch or a previous mutation sweep can
# ever be reused. fcc_build refuses a cache directory it did not create.
#
# THE PROOF THAT THIS IS SAFE IS THE GATES' OWN MUTATION SWEEPS. If a stale
# object were ever served, the mutation built from it would run unmutated code
# and the gate would print "STAYED GREEN — unfalsifiable" and fail the job. The
# sweeps are the cache's self-test and they run on every push.
#
# ── USAGE ───────────────────────────────────────────────────────────────────
#   . tools/gates/forge_cxx_cache.sh
#   FCC_CXX=clang++
#   FCC_CFLAGS=(-std=c++20 -O2 -Wall -Wextra -Werror -I "$t/ui/include")
#   FCC_LDFLAGS=()                      # link-only flags (-L/-l/-Wl,...)
#   FCC_SRCS=("$t"/ui/src/*.cpp "$t/ui/test/x_test.cpp")
#   FCC_CACHE="$WORK/objcache"
#   fcc_build "$WORK/bin" "$WORK/build.log"   # 0 ok, 1 build failed
#   echo "$FCC_COMPILED compiled, $FCC_REUSED reused"
#
# bash 3.2 ONLY: macos-latest runners ship bash 3.2.57. No `wait -n`, no
# associative arrays, no `mapfile`.
# ─────────────────────────────────────────────────────────────────────────────

# ── parallelism ─────────────────────────────────────────────────────────────
# forge-nproc is the only sanctioned source of build parallelism on the
# workstation (Guardian lowers it under memory pressure). It does not exist on a
# CI runner, so fall back to the same nproc/sysctl idiom run_ui.sh already uses.
# An explicit JOBS= always wins, because every caller already documents that.
fcc_jobs() {
  local n
  if [ -n "${JOBS:-}" ]; then printf '%s\n' "$JOBS"; return 0; fi
  if command -v forge-nproc >/dev/null 2>&1; then
    n="$(forge-nproc 2>/dev/null)"
    case "$n" in ''|*[!0-9]*) ;; *) if [ "$n" -ge 1 ]; then printf '%s\n' "$n"; return 0; fi ;; esac
  fi
  n="$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )"
  case "$n" in ''|*[!0-9]*) n=4 ;; esac
  [ "$n" -ge 1 ] || n=1
  printf '%s\n' "$n"
}

# ── the portable job cap (the same shape run_ui.sh uses) ────────────────────
FCC_PIDS=()
fcc_cap_launch() {
  "$@" &
  FCC_PIDS[${#FCC_PIDS[@]}]="$!"
  if [ "${#FCC_PIDS[@]}" -ge "${FCC_JOBS:-4}" ]; then
    wait "${FCC_PIDS[0]}" 2>/dev/null || true
    FCC_PIDS=("${FCC_PIDS[@]:1}")
  fi
}
fcc_cap_drain() {
  local p
  for p in "${FCC_PIDS[@]:-}"; do [ -n "$p" ] && wait "$p" 2>/dev/null || true; done
  FCC_PIDS=()
}

# ★ EVERY KEY IS THIS HASH. If shasum were missing, fcc__sha would print the empty
# string, every key would collapse to the same value, and the cache would serve one
# object for every translation unit -- the exact stale-object defect this file
# exists to make impossible. It would be caught (the mutation sweeps would go red)
# but it would be caught as "the gate is unfalsifiable", which sends the reader to
# the wrong place entirely. Refuse at source instead.
if ! command -v shasum >/dev/null 2>&1; then
  echo "[fcc] shasum(1) is not on PATH. Every cache key is a shasum, so there is no" >&2
  echo "[fcc] safe degraded mode: refusing rather than keying every object alike." >&2
  exit 1
fi
fcc__sha() { shasum -a 256 | cut -d' ' -f1; }

# Is this include root part of the tree under test, or is it the toolchain?
fcc__is_external() {
  case "$1" in
    /usr/*|/opt/*|/Library/*|/Applications/*|/System/*|/sw/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Every directory whose CONTENT is an input to every translation unit: each
# in-tree -I root, plus the directory of every named source.
#
#   fcc__epoch_dirs in   -> the in-tree roots, one per line (these are hashed)
#   fcc__epoch_dirs ext  -> the toolchain roots, one per line (these are not)
#
# The mode argument exists because both callers need the list from a command
# substitution, and a variable set inside one does not survive the subshell.
fcc__epoch_dirs() {
  local mode="$1" want=0 f d seen ext
  seen=""; ext=""
  for f in "${FCC_CFLAGS[@]}"; do
    if [ "$want" -eq 1 ]; then want=0; d="$f"
    elif [ "$f" = "-I" ]; then want=1; continue
    else case "$f" in -I?*) d="${f#-I}" ;; *) continue ;; esac
    fi
    [ -d "$d" ] || continue
    if fcc__is_external "$d"; then
      case "$ext" in *"$d"$'\n'*) ;; *) ext="$ext$d"$'\n' ;; esac
      continue
    fi
    case "$seen" in *"$d"$'\n'*) ;; *) seen="$seen$d"$'\n' ;; esac
  done
  for f in "${FCC_SRCS[@]}"; do
    d="$(dirname "$f")"
    fcc__is_external "$d" && continue
    case "$seen" in *"$d"$'\n'*) ;; *) seen="$seen$d"$'\n' ;; esac
  done
  if [ "$mode" = ext ]; then printf '%s' "$ext"; else printf '%s' "$seen"; fi
}

# The epoch: one hash over the path AND bytes of every INCLUDABLE file under
# every in-tree input directory. A header edit, a new header, a deleted header
# or a renamed one all move it, and moving it invalidates every object key.
#
# ── ★ WHY TRANSLATION UNITS ARE EXCLUDED, AND WHY THAT IS CHECKED ───────────
# A source directory is usually also an include root (forge-desktop/src is
# passed as -I and holds the .cpp files; so is ui/test). If the epoch hashed
# .cpp files, mutating ONE source would move the epoch and invalidate all fifty
# objects -- the cache would never hit and the whole exercise would be pointless.
#
# Excluding them is sound ONLY while no translation unit is #included by another
# one, because then a .cpp's bytes reach exactly one object: its own, whose key
# already hashes it directly. That premise is CHECKED here on every call rather
# than assumed: if any file in these directories includes a .cpp/.cc/.cxx, the
# epoch falls back to hashing EVERYTHING, the cache stops hitting, and the run is
# merely slow instead of wrong.
fcc__epoch() {
  local dirs old_ifs bad
  dirs="$(fcc__epoch_dirs in)"
  if [ -z "$dirs" ]; then printf 'no-in-tree-inputs\n'; return 0; fi
  old_ifs="$IFS"; IFS=$'\n'
  # shellcheck disable=SC2086
  set -- $dirs
  IFS="$old_ifs"

  bad="$(find "$@" -type f -print0 2>/dev/null \
         | xargs -0 grep -lE '^[[:space:]]*#[[:space:]]*include[[:space:]]*["<][^">]*\.(cpp|cc|cxx|C)[">]' \
                 2>/dev/null | head -1)"
  if [ -n "$bad" ]; then
    # A translation unit IS includable content here. Hash everything: correct,
    # and no cache hits across a source mutation.
    find "$@" -type f -print0 2>/dev/null \
      | LC_ALL=C sort -z | xargs -0 shasum -a 256 2>/dev/null | fcc__sha
    return 0
  fi
  find "$@" -type f \
       ! -name '*.cpp' ! -name '*.cc' ! -name '*.cxx' ! -name '*.C' ! -name '*.c' \
       ! -name '*.m' ! -name '*.mm' -print0 2>/dev/null \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 2>/dev/null \
    | fcc__sha
}

fcc_report_epoch() {
  local dirs ext
  dirs="$(fcc__epoch_dirs in | tr '\n' ' ')"
  ext="$(fcc__epoch_dirs ext | tr '\n' ' ')"
  if [ -n "$dirs" ]; then echo "[fcc] cache epoch hashes: $dirs"
  else echo "[fcc] cache epoch hashes: (nothing in-tree)"; fi
  if [ -n "$ext" ]; then
    echo "[fcc] NOT hashed (toolchain, pinned by the compiler banner and the job's install step): $ext"
  fi
}

fcc__compile_one() {   # <src> <obj> <failfile>
  local src="$1" obj="$2" fail="$3" tmp="$2.tmp.$$"
  if "$FCC_CXX" "${FCC_CFLAGS[@]}" -c "$src" -o "$tmp" 2>"$obj.err"; then
    # Atomic publish: a killed or truncated compile must never become a hit.
    mv -f "$tmp" "$obj" || { echo "[fcc] could not publish object for $src" >> "$fail"; return 1; }
    return 0
  fi
  rm -f "$tmp"
  {
    echo "[fcc] COMPILE FAILED — $src"
    tail -40 "$obj.err"
  } >> "$fail"
  return 1
}

# fcc_build <out_binary> <log_file>
#   0  built (or relinked from cache)
#   1  a translation unit or the link failed; the log holds the compiler output
#   2  misuse (no sources, unwritable cache)
# Sets FCC_COMPILED / FCC_REUSED / FCC_OBJS.
fcc_build() {
  local out="$1" log="$2"
  : > "$log" || return 2
  [ "${#FCC_SRCS[@]}" -gt 0 ] || { echo "[fcc] no sources" >> "$log"; return 2; }
  [ -n "${FCC_CACHE:-}" ] || { echo "[fcc] FCC_CACHE is unset" >> "$log"; return 2; }
  mkdir -p "$FCC_CACHE" || { echo "[fcc] cannot create $FCC_CACHE" >> "$log"; return 2; }
  FCC_JOBS="${FCC_JOBS:-$(fcc_jobs)}"

  local cxxid flagsid epochid base
  cxxid="$("$FCC_CXX" --version 2>&1 | head -3 | fcc__sha)"
  flagsid="$(printf '%s\n' "${FCC_CFLAGS[@]}" | fcc__sha)"
  epochid="$(fcc__epoch)"
  base="$cxxid.$flagsid.$epochid"

  FCC_COMPILED=0; FCC_REUSED=0; FCC_OBJS=()
  local fail="$FCC_CACHE/.fail.$$"
  : > "$fail"
  local s h key obj
  for s in "${FCC_SRCS[@]}"; do
    if [ ! -f "$s" ]; then echo "[fcc] no such source: $s" >> "$log"; rm -f "$fail"; return 2; fi
    h="$(shasum -a 256 "$s" | cut -d' ' -f1)"
    key="$(printf '%s|%s|%s\n' "$base" "$s" "$h" | fcc__sha)"
    obj="$FCC_CACHE/$key.o"
    FCC_OBJS[${#FCC_OBJS[@]}]="$obj"
    if [ -s "$obj" ]; then FCC_REUSED=$((FCC_REUSED + 1)); continue; fi
    FCC_COMPILED=$((FCC_COMPILED + 1))
    fcc_cap_launch fcc__compile_one "$s" "$obj" "$fail"
  done
  fcc_cap_drain

  if [ -s "$fail" ]; then cat "$fail" >> "$log"; rm -f "$fail"; return 1; fi
  rm -f "$fail"

  # ${arr[@]+"${arr[@]}"} and NOT "${arr[@]:-}": under `set -u` bash 3.2 treats an
  # empty array as unset, and the :- form would hand clang a single EMPTY
  # argument, which it reports as "no such file or directory: ''".
  if ! "$FCC_CXX" "${FCC_CFLAGS[@]}" "${FCC_OBJS[@]}" \
       ${FCC_LDFLAGS[@]+"${FCC_LDFLAGS[@]}"} -o "$out" >>"$log" 2>&1; then
    return 1
  fi
  return 0
}

# ── the tree reset, for scripts that mutate a COPY ──────────────────────────
# Callers that keep ONE mutable tree at a CONSTANT path (so that -I and -D are
# identical across every build, which is what makes the object cache useful at
# all) must restore it between mutations. Restoring is not enough: the restore
# must be CHECKED, or a mutation that failed to be undone rides into the next
# round and the sweep measures something nobody wrote.
#
# fcc_reset_tree <pristine> <tree>
#   rebuilds <tree> from <pristine> and PROVES they are identical afterwards.
#   Non-zero means the tree is not trustworthy and the caller must go red.
fcc_reset_tree() {
  local pristine="$1" tree="$2" diffs
  rm -rf "$tree"
  if [ -d "$tree" ]; then echo "[fcc] could not remove $tree"; return 1; fi
  cp -R "$pristine" "$tree" || { echo "[fcc] could not copy $pristine -> $tree"; return 1; }
  diffs="$(diff -rq "$pristine" "$tree" 2>&1 | head -5)"
  if [ -n "$diffs" ]; then
    echo "[fcc] THE RESET DID NOT RESTORE THE TREE — a mutation would compound:"
    printf '%s\n' "$diffs"
    return 1
  fi
  return 0
}

# fcc_assert_mutated <pristine> <tree>
#   The other half: after applying a mutation, SOMETHING must differ. A sed or a
#   python rewrite that matched nothing leaves a pristine tree, and a "mutation"
#   over pristine sources proves only that the gate is green.
fcc_assert_mutated() {
  local pristine="$1" tree="$2"
  if diff -rq "$pristine" "$tree" >/dev/null 2>&1; then return 1; fi
  return 0
}
