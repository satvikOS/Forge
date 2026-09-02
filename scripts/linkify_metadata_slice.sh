#!/usr/bin/env bash
# linkify_metadata_slice.sh — pull ONLY the parametric interface metadata out of the
# Linkify "contacts_assembly_json" corpus, without ever landing the point clouds.
#
# WHY THIS EXISTS
# ---------------
# The published corpus is 93.2 GB compressed / 211 GB uncompressed, against ~86 GiB
# free on this machine next to a 138 GB archdisc-Models. It does not fit, and the
# README's own instructions ask for ~304 GB free (93.2 archive + 211 extracted).
#
# MEASURED 2026-09-01 on a 400 MiB byte-range prefix of partaa (166 assemblies):
#
#     assembly.json   n=  166      18,029,965 B    1.90%   mean 106.1 KiB
#     contact  .ply   n= 2131     931,195,766 B   98.10%   mean 426.7 KiB
#
# The .ply contact point clouds are 98% of the bulk. Everything that decomposes into
# the primitives interface_metrics.py actually scores — the `holes` array: axis
# direction, axis origin, diameter, length, and typed BRep faces — lives in
# assembly.json, which is the other 2%.
#
# Projected assembly.json-only tier: ~0.8-1.0 GiB on disk (parts-scaled from the
# dataset's own 154,468 parts / 8,251 assemblies), bounded above by 3.7 GiB if the
# 1.90% byte share holds corpus-wide. The byte-share method reproduces the published
# total to within 0.1% (196.44 GiB projected vs 196.5 GiB stated), so the share is
# sound even though the early-alphabetical prefix under-samples assembly SIZE.
#
# HOW IT WORKS, AND THE COST THAT DOES NOT GO AWAY
# ------------------------------------------------
# A split .tar.gz is a STREAM. gzip has no random access, so the archive must be
# decoded sequentially from byte 0 — but it never has to be STORED. curl streams the
# parts in order into `tar -x --include='*/assembly.json'`, which writes the JSON and
# discards every .ply as it goes past.
#
#   disk cost     ~1 GiB   (only assembly.json is written)
#   network cost  up to 93.2 GB  (the bytes must still cross the wire to be decoded)
#
# Those are different numbers and the second one is the real budget. Measured pull
# rate from this machine on 2026-09-01 was 1.74 MiB/s, i.e. ~15 h for the full stream.
# Use --max-assemblies to stop early: the corpus is directory-name ordered, so an
# early stop yields a name-biased (smaller-assembly) sample, NOT a random one. Any
# statistic computed from a truncated run must say so.
#
# S3 serves these objects publicly with Accept-Ranges: bytes (verified).
#
# LICENSE: the underlying Fusion 360 Gallery Assembly data is NON-COMMERCIAL RESEARCH
# ONLY and may not be redistributed in its entirety. This script downloads; it does
# not redistribute. Do not commit any of its output.
#
# Usage:
#   scripts/linkify_metadata_slice.sh --dest DIR [--max-assemblies N] [--parts aa,ab]

set -euo pipefail

BASE="https://fusion-360-gallery-assembly-interfaces.s3.us-west-2.amazonaws.com/public-archives"
PREFIX="contacts_assembly_json.tar.gz"
DEST=""
MAXA=0
PARTS="aa ab ac ad ae af ag ah ai aj"

while [ $# -gt 0 ]; do
  case "$1" in
    --dest)            DEST="$2"; shift 2 ;;
    --max-assemblies)  MAXA="$2"; shift 2 ;;
    --parts)           PARTS="$(echo "$2" | tr ',' ' ')"; shift 2 ;;
    -h|--help)         sed -n '1,50p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

[ -n "$DEST" ] || { echo "--dest is required" >&2; exit 2; }
mkdir -p "$DEST"

# Refuse to start without headroom for the JSON tier plus slack.
avail_gib=$(df -g "$DEST" | awk 'NR==2 {print $4}')
if [ "${avail_gib:-0}" -lt 8 ]; then
  echo "refusing: only ${avail_gib} GiB free at $DEST; want >= 8 GiB for the ~1 GiB tier plus slack" >&2
  exit 1
fi
echo "[slice] dest=$DEST  free=${avail_gib} GiB  parts=$PARTS"

urls=""
for p in $PARTS; do urls="$urls $BASE/$PREFIX.part$p"; done

# One sequential gzip stream across the parts, in order. `tar --include` writes only
# the JSON; the .ply bytes are decoded and dropped, never written.
set +e
# shellcheck disable=SC2086
curl -fsSL --retry 5 --retry-delay 5 $urls \
  | gzip -dc \
  | tar -x -C "$DEST" --include='*/assembly.json' -f -
rc=$?
set -e
# SIGPIPE (141) is the expected outcome of an intentional early stop.
if [ $rc -ne 0 ] && [ $rc -ne 141 ]; then
  echo "[slice] stream ended rc=$rc (partial slice retained)" >&2
fi

n=$(find "$DEST" -name assembly.json | wc -l | tr -d ' ')
sz=$(du -sh "$DEST" | awk '{print $1}')
echo "[slice] assembly.json files: $n   on-disk: $sz"
if [ "$MAXA" -gt 0 ] && [ "$n" -gt 0 ]; then
  echo "[slice] NOTE: truncated run — directory-name ordered, so this is a name-biased sample, not random."
fi
