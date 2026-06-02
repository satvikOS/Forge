#pragma once

// Forge-175 — Acoustic room simulation.
//
// Image-source method (Allen & Berkley 1979) for early reflections on a
// shoebox room, plus a statistical Eyring exponential-decay late tail
// for diffuse reverberation. The result is a per-octave-band impulse
// response (6 bands: 125 / 250 / 500 / 1k / 2k / 4k Hz) plus the
// standard ISO-3382 room-acoustics metrics:
//
//   * RT60     per band      (reverberation time, -60 dB extrapolated
//                             from EDC slope in the -5 dB → -35 dB band)
//   * EDC      per band      (Schroeder backward-integrated energy decay)
//   * C50, C80 per band      (clarity 0..50 ms vs late, 0..80 ms vs late)
//   * D50      per band      (definition, early/total energy)
//
// Geometry: shoebox of size (Lx × Ly × Lz) metres. Each of the 6 walls
// has an absorption coefficient per band; α ∈ [0, 1). Source position
// (xs, ys, zs) and receiver position (xr, yr, zr) live inside the room.

#include <array>
#include <cstdint>
#include <vector>

namespace forge { namespace acoustics {

constexpr std::size_t NUM_BANDS = 6;
constexpr double      BAND_HZ[NUM_BANDS] = { 125, 250, 500, 1000, 2000, 4000 };

struct Shoebox {
    double Lx, Ly, Lz;                                   // m
    // Per-wall absorption per band:
    //   walls[0] = -X face,  walls[1] = +X
    //   walls[2] = -Y,       walls[3] = +Y
    //   walls[4] = -Z,       walls[5] = +Z
    std::array<std::array<double, NUM_BANDS>, 6> walls;
    // Per-band air absorption coefficient m (m⁻¹) — typical values
    //   0.0001 (125Hz) … 0.0080 (4kHz) for 50% RH at 20°C.
    std::array<double, NUM_BANDS> airAtten;
};

struct AcousticConfig {
    Shoebox room;
    double sourceX, sourceY, sourceZ;
    double recvX,   recvY,   recvZ;
    int    maxOrder;        // image-source recursion depth (≥ 4, typ. 12)
    double speedOfSound;    // m/s (default 343)
    double sampleRateHz;    // e.g. 48000
    double irLengthSec;     // total impulse-response duration
    double sourcePowerW;    // acoustic power (1e-3 W is typ. speech-like)
    unsigned long randomSeed; // for the stochastic tail
};

struct AcousticResult {
    int    sampleRateHz;
    int    samples;
    // Per-band impulse responses, each length = samples.
    std::array<std::vector<double>, NUM_BANDS> irPerBand;
    // Combined broadband IR (sum of bands).
    std::vector<double> irCombined;
    // Per-band metrics.
    std::array<double, NUM_BANDS> rt60Sec;
    std::array<double, NUM_BANDS> c50Db;
    std::array<double, NUM_BANDS> c80Db;
    std::array<double, NUM_BANDS> d50;
    // Per-band EDC samples (dB). One entry per `edcStrideSamples`.
    std::array<std::vector<double>, NUM_BANDS> edcDb;
    int    edcStrideSamples;
    // Diagnostic.
    int    imageSourcesEvaluated;
    double sabineRt60Mid;   // analytical Sabine RT60 at 500 Hz (cross-check)
};

AcousticResult simulate(const AcousticConfig& cfg);

}} // namespace forge::acoustics
