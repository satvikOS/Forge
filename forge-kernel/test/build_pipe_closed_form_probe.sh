#!/usr/bin/env bash
# build_pipe_closed_form_probe.sh — build test/pipe_closed_form_probe.cpp.
#
# ONE translation unit, PURE OCCT. It deliberately links no forge object and no
# forge archive: the whole point of the probe is to answer "is OCCT right here?"
# without any forge code in the loop, so that its verdict cannot be an artefact
# of the engine under test. If this ever needs a forge symbol to link, the probe
# has stopped being independent and the change should be rejected rather than
# the link line extended.
#
# A GATE THAT CANNOT BUILD CANNOT FAIL, so the build runs the probe's own
# positive control (--selftest) before reporting success. That control requires
# OCCT to MATCH the closed form on a straight spine; if it does not, the ORACLE
# is wrong and the build fails here rather than emitting corpus numbers nobody
# should read.
#
# Output: the binary path on stdout as  BIN=<path>.  Exit 0 iff built and the
# positive control passed.
set -uo pipefail
KERNEL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$KERNEL" || exit 2

CXX="${CXX:-clang++}"
OCCT="${OCCT_ROOT:-/opt/homebrew/opt/opencascade}"
if [ ! -e "$OCCT/include/opencascade/Standard_Version.hxx" ]; then
  if [ -e "/usr/local/opt/opencascade/include/opencascade/Standard_Version.hxx" ]; then
    OCCT="/usr/local/opt/opencascade"
  else
    echo "FATAL: OCCT not found (brew install opencascade or set OCCT_ROOT)" >&2
    exit 2
  fi
fi

OUTDIR="${OUTDIR:-$KERNEL/.build-corpus-ab}"
mkdir -p "$OUTDIR" || exit 2
OUT="$OUTDIR/pipe_closed_form_probe"

if ! "$CXX" -std=c++20 -O2 \
      -I "$KERNEL/include" -I "$OCCT/include/opencascade" \
      "$KERNEL/test/pipe_closed_form_probe.cpp" \
      -L "$OCCT/lib" -Wl,-rpath,"$OCCT/lib" \
      -lTKernel -lTKMath -lTKG2d -lTKG3d -lTKGeomBase -lTKBRep -lTKTopAlgo \
      -lTKPrim -lTKGeomAlgo -lTKBO -lTKBool -lTKShHealing -lTKFillet -lTKOffset \
      -lTKDESTEP -lTKXSBase \
      -o "$OUT" 2> "$OUTDIR/pipe_probe.link.err"; then
  echo "[pipe-probe] BUILD FAILED:" >&2
  tail -40 "$OUTDIR/pipe_probe.link.err" >&2
  exit 1
fi

# THE POSITIVE CONTROL, before any corpus number exists.
if ! "$OUT" --selftest; then
  echo "[pipe-probe] POSITIVE CONTROL FAILED — the oracle disagrees with OCCT on a" >&2
  echo "             STRAIGHT spine, so the probe is what is broken. No corpus run." >&2
  exit 1
fi

# Record the tree this binary was built from. A number whose SHA is unknown is
# not a measurement — this repo has already discarded one full corpus run that
# was built at one commit and measured at another.
cat > "$OUTDIR/pipe_probe_stamp.json" <<STAMPJSON
{
  "built_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_head": "$(git -C "$KERNEL" rev-parse HEAD 2>/dev/null || echo unknown)",
  "dirty_files_in_src_include_test": $(git -C "$KERNEL" status --porcelain -- "$KERNEL/src" "$KERNEL/include" "$KERNEL/test" 2>/dev/null | wc -l | tr -d ' '),
  "occt_root": "$OCCT",
  "binary": "$OUT"
}
STAMPJSON

echo "BIN=$OUT"
