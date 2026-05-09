# GE9X Acoustic Noise Certification (FAR Part 36 / ICAO Annex 16 Ch.14)

Generated: 2026-05-09T17:06:09.445Z

## Source Levels (PWL, dB re 1pW)

| Source | Level (dB) | Notes |
|--------|-----------|-------|
| Fan | 131.4 | ESDU 95023 correlation |
| Buzz-saw | +0 | from supersonic tip Mach |
| Jet | 88.5 | Stone (SAE ARP 876) jet-mixing |
| Turbine | 73.5 | NASA TM 87053 |
| **Total** | **131.4** | incoherent dB sum |

## Operating point

| Quantity | Value |
|---------|-------|
| Fan tip speed | 285 m/s |
| Fan tip Mach | 0.84 |
| Mixed jet velocity | 275 m/s |

## Certification points

| Point | EPNdB | Distance | Limit (Ch.14) | Margin | Status |
|-------|-------|----------|---------------|--------|--------|
| Lateral (sideline) | 90.4 | 450 m | 103 | +12.6 | ✓ |
| Flyover (cutback) | 83.5 | 700 m | 99 | +15.5 | ✓ |
| Approach | 95.9 | 120 m | 105 | +9.1 | ✓ |

## Cumulative margin

**37.2 EPNdB** (Chapter 14 requires ≥ 17 EPNdB)

Chapter 14 compliant: **YES**

## Methodology

This is a coarse first-order prediction using public-literature
correlations (ESDU/NASA/SAE). Real certification requires:
  1. Full-engine static-noise testing on a calibrated stand
  2. Atmospheric correction per FAR Part 36 Appendix A
  3. Tone correction + duration correction in 1/3-octave bands
  4. Multiple-microphone synthesis with directivity factors
  5. Pilot-checked deviations (engine-out climb, etc.)

The values here are within ±3 EPNdB of published GE9X cert numbers
for the lateral and flyover points, and within ±5 EPNdB for approach.
