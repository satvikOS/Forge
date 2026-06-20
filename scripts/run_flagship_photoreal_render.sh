#!/usr/bin/env bash
# run_flagship_photoreal_render.sh — FIRE THE FORGE FLAGSHIP PHOTOREAL RENDERS
# ============================================================================
# Renders ONE full-pipeline, photoreal, CAE-in-motion video per flagship part —
# GE9X turbofan, planetary gearbox, LOX/RP-1 turbopump — from the REAL OCCT
# B-rep solids the kernel builds, with engineer-correct PBR materials per
# component class, a procedural HDRI studio/hangar environment, ≥5 named camera
# angles, and the CAE-in-motion overlays (FEA von-Mises stress colormap, CFD
# streamlines, rotor spin).
#
# RUN THIS ONLY AFTER TRAINING FREES THE GPU.  The flagship capture specs are
# heavy (Electron + native OCCT kernel + r3f + native solvers); per the Mac
# Studio's hardware-calm rule (feedback-hardware-calm) we do ONE heavy step at a
# time — never render while a LoRA train, mlx_lm.server, Vite dev, or another
# Electron run is live. This script REFUSES to start if it detects an active
# training/serve process, unless you pass --force.
#
# Per feedback-headed-tests + feedback-forge-multicam-e2e the specs launch a
# HEADED Mac-Electron window at a watchable pace and capture ≥5 named angles.
#
# USAGE
#   scripts/run_flagship_photoreal_render.sh                 # all three parts
#   scripts/run_flagship_photoreal_render.sh ge9x            # just one
#   scripts/run_flagship_photoreal_render.sh gearbox turbopump
#   FORGE_SKIP_BUILD=1 scripts/run_flagship_photoreal_render.sh   # reuse dist
#   scripts/run_flagship_photoreal_render.sh --force         # ignore GPU guard
#
# OUTPUT (one continuous mp4 per part + clean named hero PNGs):
#   e2e/forge/shots/flagship/<part>/<part>.mp4
#   e2e/forge/shots/flagship/<part>/hero_*.png
#   e2e/forge/shots/flagship/<part>/drawings/<part>_*.svg
# ============================================================================
set -euo pipefail

REPO="/Users/account_clawteam1/archdisc-Mech"
cd "$REPO"

FORCE=0
PARTS=()
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    ge9x|gearbox|turbopump) PARTS+=("$arg") ;;
    *) echo "unknown arg: $arg (expected ge9x|gearbox|turbopump|--force)"; exit 2 ;;
  esac
done
if [ "${#PARTS[@]}" -eq 0 ]; then PARTS=(ge9x gearbox turbopump); fi

# ── GPU / heavy-process guard ───────────────────────────────────────────────
# The render must not contend with a live LoRA train or mlx_lm.server. Look for
# the usual suspects and bail unless --force.
if [ "$FORCE" -ne 1 ]; then
  BUSY="$(pgrep -fl 'mlx_lm|mlx_vlm|lora|train.py|mlx_lm.server|mlx-lm' 2>/dev/null || true)"
  if [ -n "$BUSY" ]; then
    echo "REFUSING TO RENDER — a training/serve process appears to be running:"
    echo "$BUSY"
    echo
    echo "The GPU must be free (feedback-hardware-calm). Wait for training to"
    echo "finish, or re-run with --force if you are certain the GPU is idle."
    exit 1
  fi
  VITE="$(pgrep -fl 'vite' 2>/dev/null || true)"
  if [ -n "$VITE" ]; then
    echo "NOTE: a Vite process is running:"; echo "$VITE"
    echo "The flagship specs load the PROD bundle (frontend/dist), not the dev"
    echo "server, so this won't corrupt the render — but it adds memory pressure."
  fi
fi

# ── Tooling sanity ───────────────────────────────────────────────────────────
command -v npx >/dev/null 2>&1 || { echo "npx not found on PATH"; exit 1; }
if ! command -v ffmpeg >/dev/null 2>&1 \
   && [ ! -e "$REPO/node_modules/ffmpeg-static/ffmpeg" ]; then
  echo "WARNING: neither system ffmpeg nor node_modules/ffmpeg-static found."
  echo "The capture frames will be written but the final mp4 mux will fail."
fi

KERNEL="$REPO/forge-kernel/build/Release/forge-kernel.node"
if [ ! -e "$KERNEL" ]; then
  echo "ERROR: native kernel not built at:"; echo "  $KERNEL"
  echo "Build it first:  npm run forge:kernel:build"
  exit 1
fi
echo "native kernel: $KERNEL"

# ── Build the prod bundle (Electron loads frontend/dist, not the dev server) ──
if [ "${FORGE_SKIP_BUILD:-0}" != "1" ]; then
  echo "── building frontend prod bundle (vite build) ──"
  ( cd frontend && npm run build )
else
  echo "── FORGE_SKIP_BUILD=1 → reusing existing frontend/dist ──"
  [ -e frontend/dist/index.html ] || { echo "frontend/dist/index.html missing — drop FORGE_SKIP_BUILD"; exit 1; }
fi

# ── Render each requested part (headed, one at a time) ───────────────────────
# (bash 3.2 on macOS has no associative arrays — use a case map instead of declare -A)
FAIL=0
for part in "${PARTS[@]}"; do
  case "$part" in
    ge9x)      spec="e2e/forge/demo-flagship-ge9x.spec.js" ;;
    gearbox)   spec="e2e/forge/demo-flagship-gearbox.spec.js" ;;
    turbopump) spec="e2e/forge/demo-flagship-turbopump.spec.js" ;;
    *)         echo "unknown part: $part"; FAIL=1; continue ;;
  esac
  echo
  echo "════════════════════════════════════════════════════════════════════"
  echo "  RENDERING FLAGSHIP: $part   ($spec)"
  echo "════════════════════════════════════════════════════════════════════"
  # Headed, serial; FORGE_E2E=1 is set by the spec's _electron.launch env. The
  # default playwright.config.js test timeout is overridden per-test in the spec.
  if npx playwright test "$spec" --config=playwright.config.js --headed --workers=1; then
    out="e2e/forge/shots/flagship/$part/$part.mp4"
    if [ -e "$out" ]; then
      sz=$(du -h "$out" | cut -f1)
      echo "✓ $part → $out ($sz)"
    else
      echo "✗ $part — spec passed but no mp4 at $out"; FAIL=1
    fi
  else
    echo "✗ $part — render spec FAILED"; FAIL=1
  fi
done

echo
echo "── flagship photoreal render summary ──"
for part in "${PARTS[@]}"; do
  out="e2e/forge/shots/flagship/$part/$part.mp4"
  if [ -e "$out" ]; then echo "  ✓ $out ($(du -h "$out" | cut -f1))"; else echo "  ✗ $out (missing)"; fi
done

exit "$FAIL"
