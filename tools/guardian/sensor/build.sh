#!/bin/zsh
# build.sh [--out DIR] [--debug] -- compile forge-guardian-sensor.
# Prints the output path; exits non-zero on failure. The binary is linked to a temp
# name and renamed into place, so a running sensor's executable is never rewritten.
set -u
HERE=${0:A:h}
OUT="$HERE/build"
DEBUG=0
while (( $# )); do
  case "$1" in
    --out) [[ $# -ge 2 ]] || { print -u2 "build.sh: --out needs a directory"; exit 2 }; OUT=$2; shift 2 ;;
    --debug) DEBUG=1; shift ;;
    -h|--help) print "usage: build.sh [--out DIR] [--debug]"; exit 0 ;;
    *) print -u2 "build.sh: unknown option '$1'"; exit 2 ;;
  esac
done
mkdir -p "$OUT" || exit 1
OUT=${OUT:A}
if (( DEBUG )); then OPT=(-O0 -g); else OPT=(-O2); fi
SRCS=("$HERE"/*.mm(N))
(( ${#SRCS} )) || { print -u2 "build.sh: no sources in $HERE"; exit 1 }
BIN="$OUT/forge-guardian-sensor"
TMP="$BIN.tmp.$$"
xcrun clang++ -std=c++20 $OPT -Wall -Wextra -Werror -fobjc-arc \
  -mmacosx-version-min=13.0 \
  -I"$HERE" "${SRCS[@]}" \
  -framework Foundation -framework IOKit -framework CoreFoundation \
  -o "$TMP" || { rm -f "$TMP"; print -u2 "build.sh: compile failed"; exit 1 }
mv -f "$TMP" "$BIN" || { rm -f "$TMP"; exit 1 }
print -r -- "$BIN"
