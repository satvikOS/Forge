#pragma once

// Forge-209 — keyframe animation kernel.
//
// Per-track keyframe storage + evaluation. Each track is named (typically
// "<body>.<channel>" where channel is one of translation/rotationEuler/
// scale) and carries an ordered list of {time, value[3]} keyframes.
//
// Two interpolation modes:
//   * Linear    — straight lerp between adjacent keyframes.
//   * CubicHermite — Catmull-Rom-style tangents from finite differences.
// Both clamp to the first/last value before/after the active range.
//
// `evaluateAll(tracks, t)` returns the value of every track at time t.
// `sampleRange(tracks, t0, t1, n)` returns n equally-spaced frames
// (useful for offline export / scrubbing previews).

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace animation {

enum class Interpolation : std::uint8_t {
    Linear      = 0,
    CubicHermite = 1,
};

struct Keyframe {
    double time;
    double value[3];
};

struct Track {
    std::string name;
    Interpolation interpolation;
    std::vector<Keyframe> keys;
};

struct Inputs {
    std::vector<Track> tracks;
};

double duration(const Inputs& in);

struct Sample {
    std::string name;
    double value[3];
};

std::vector<Sample> evaluateAll(const Inputs& in, double time);

struct Frame {
    double time;
    std::vector<Sample> values;
};

std::vector<Frame> sampleRange(const Inputs& in, double t0, double t1,
                               std::uint32_t frameCount);

}} // namespace forge::animation
