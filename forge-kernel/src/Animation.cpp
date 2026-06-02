#include "forge/Animation.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace forge { namespace animation {

namespace {

void lerp3(const double a[3], const double b[3], double t, double out[3]) {
    out[0] = a[0] + (b[0] - a[0]) * t;
    out[1] = a[1] + (b[1] - a[1]) * t;
    out[2] = a[2] + (b[2] - a[2]) * t;
}

// Catmull-Rom-style cubic Hermite between p1 and p2 (i and i+1), with
// tangents m1, m2 derived from finite differences.
void hermite3(const double p1[3], const double p2[3],
              const double m1[3], const double m2[3],
              double t, double out[3]) {
    const double t2 = t * t, t3 = t2 * t;
    const double h00 =  2*t3 - 3*t2 + 1;
    const double h10 =      t3 - 2*t2 + t;
    const double h01 = -2*t3 + 3*t2;
    const double h11 =      t3 -    t2;
    for (int c = 0; c < 3; ++c) {
        out[c] = h00 * p1[c] + h10 * m1[c] + h01 * p2[c] + h11 * m2[c];
    }
}

void evaluateTrack(const Track& tr, double time, double out[3]) {
    if (tr.keys.empty()) { out[0] = out[1] = out[2] = 0; return; }
    if (tr.keys.size() == 1 || time <= tr.keys.front().time) {
        std::copy(tr.keys.front().value, tr.keys.front().value + 3, out);
        return;
    }
    if (time >= tr.keys.back().time) {
        std::copy(tr.keys.back().value, tr.keys.back().value + 3, out);
        return;
    }
    // Find the segment.
    auto it = std::upper_bound(tr.keys.begin(), tr.keys.end(), time,
        [](double t, const Keyframe& k) { return t < k.time; });
    const std::size_t i1 = static_cast<std::size_t>(it - tr.keys.begin());
    const std::size_t i0 = i1 - 1;
    const auto& k0 = tr.keys[i0];
    const auto& k1 = tr.keys[i1];
    const double dt = k1.time - k0.time;
    const double u  = (time - k0.time) / dt;
    if (tr.interpolation == Interpolation::Linear) {
        lerp3(k0.value, k1.value, u, out);
        return;
    }
    // Cubic Hermite: build tangents from neighbours.
    double m0[3], m1[3];
    auto tangent = [&](std::size_t centre, double dst[3]) {
        const std::size_t prev = (centre == 0) ? 0 : centre - 1;
        const std::size_t next = (centre + 1 < tr.keys.size()) ? centre + 1 : centre;
        const auto& pk = tr.keys[prev];
        const auto& nk = tr.keys[next];
        const double span = nk.time - pk.time;
        if (span < 1e-12) { dst[0]=dst[1]=dst[2]=0; return; }
        for (int c = 0; c < 3; ++c)
            dst[c] = (nk.value[c] - pk.value[c]) * dt / span;
    };
    tangent(i0, m0);
    tangent(i1, m1);
    hermite3(k0.value, k1.value, m0, m1, u, out);
}

} // namespace

double duration(const Inputs& in) {
    double d = 0;
    for (const auto& t : in.tracks) {
        if (!t.keys.empty()) d = std::max(d, t.keys.back().time);
    }
    return d;
}

std::vector<Sample> evaluateAll(const Inputs& in, double time) {
    std::vector<Sample> out;
    out.reserve(in.tracks.size());
    for (const auto& tr : in.tracks) {
        Sample s{};
        s.name = tr.name;
        evaluateTrack(tr, time, s.value);
        out.push_back(std::move(s));
    }
    return out;
}

std::vector<Frame> sampleRange(const Inputs& in, double t0, double t1,
                               std::uint32_t frameCount) {
    if (frameCount < 2) throw std::invalid_argument("sampleRange: frameCount ≥ 2");
    if (t1 < t0)        throw std::invalid_argument("sampleRange: t1 ≥ t0");
    std::vector<Frame> out;
    out.reserve(frameCount);
    for (std::uint32_t i = 0; i < frameCount; ++i) {
        const double t = t0 + (t1 - t0) * i / (frameCount - 1);
        Frame f{};
        f.time = t;
        f.values = evaluateAll(in, t);
        out.push_back(std::move(f));
    }
    return out;
}

}} // namespace forge::animation
