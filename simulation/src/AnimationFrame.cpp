#include "forge/simulation/AnimationFrame.hpp"

#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

namespace forge {
namespace simulation {
namespace {

constexpr std::uint64_t kFnvOffset = 1469598103934665603ULL;
constexpr std::uint64_t kFnvPrime  = 1099511628211ULL;

inline void hashByte(std::uint64_t& h, unsigned char b) {
    h ^= static_cast<std::uint64_t>(b);
    h *= kFnvPrime;
}

inline void hashU64(std::uint64_t& h, std::uint64_t v) {
    for (int i = 0; i < 8; ++i) hashByte(h, static_cast<unsigned char>((v >> (8 * i)) & 0xFF));
}

// IEEE-754 bit pattern, with -0.0 folded onto +0.0 so that values which compare
// equal also hash equal.
inline void hashDouble(std::uint64_t& h, double d) {
    if (d == 0.0) d = 0.0;
    std::uint64_t bits = 0;
    std::memcpy(&bits, &d, sizeof(bits));
    hashU64(h, bits);
}

inline void hashString(std::uint64_t& h, const std::string& s) {
    hashU64(h, static_cast<std::uint64_t>(s.size()));
    for (char c : s) hashByte(h, static_cast<unsigned char>(c));
}

bool allFinite(const double* p, std::size_t n) {
    for (std::size_t i = 0; i < n; ++i) {
        if (!std::isfinite(p[i])) return false;
    }
    return true;
}

}  // namespace

const char* toString(ValidityState s) {
    switch (s) {
        case ValidityState::Valid:    return "Valid";
        case ValidityState::Degraded: return "Degraded";
        case ValidityState::Invalid:  return "Invalid";
        case ValidityState::Diverged: return "Diverged";
    }
    return "Unknown";
}

std::uint64_t computeResultHash(const AnimationFrame& f) {
    std::uint64_t h = kFnvOffset;
    hashU64(h, f.frameIndex);
    hashDouble(h, f.simTime);
    hashU64(h, f.geometryRevision);
    hashU64(h, f.solverStep);

    hashU64(h, static_cast<std::uint64_t>(f.bodies.size()));
    for (const auto& b : f.bodies) {
        hashU64(h, static_cast<std::uint64_t>(b.body));
        for (double v : b.position)        hashDouble(h, v);
        for (double v : b.rotation)        hashDouble(h, v);
        for (double v : b.linearVelocity)  hashDouble(h, v);
        for (double v : b.angularVelocity) hashDouble(h, v);
    }

    hashU64(h, static_cast<std::uint64_t>(f.nodalDisplacement.size()));
    for (double v : f.nodalDisplacement) hashDouble(h, v);

    hashU64(h, static_cast<std::uint64_t>(f.probes.size()));
    for (const auto& p : f.probes) {
        hashString(h, p.name);
        hashDouble(h, p.value);
    }
    return h;
}

FrameCheck checkFrame(const AnimationFrame& f) {
    FrameCheck r;
    if (f.geometryRevision == 0) {
        r.reason = "frame does not name a geometry revision (geometryRevision == 0)";
        return r;
    }
    if (f.resultHash == 0) {
        r.reason = "frame does not name its content (resultHash == 0)";
        return r;
    }
    if (!std::isfinite(f.simTime) || f.simTime < 0.0) {
        r.reason = "simTime is not a finite non-negative time";
        return r;
    }
    if (f.validity == ValidityState::Diverged) {
        r.reason = "validity_state=Diverged: the integrator produced no physical state";
        return r;
    }
    if (f.bodies.empty() && f.nodalDisplacement.empty()) {
        r.reason = "frame carries no state (no body transforms and no nodal field)";
        return r;
    }
    if (f.nodalDisplacement.size() % 3 != 0) {
        r.reason = "nodalDisplacement size is not a multiple of 3 (x,y,z per node)";
        return r;
    }
    for (const auto& b : f.bodies) {
        if (!allFinite(b.position.data(), 3) || !allFinite(b.rotation.data(), 9) ||
            !allFinite(b.linearVelocity.data(), 3) || !allFinite(b.angularVelocity.data(), 3)) {
            r.reason = "body transform contains a non-finite value";
            return r;
        }
    }
    if (!f.nodalDisplacement.empty() &&
        !allFinite(f.nodalDisplacement.data(), f.nodalDisplacement.size())) {
        r.reason = "nodal displacement field contains a non-finite value";
        return r;
    }
    for (const auto& p : f.probes) {
        if (!std::isfinite(p.value)) {
            r.reason = "probe '" + p.name + "' is non-finite";
            return r;
        }
    }
    // Last, because it is the most expensive and the least likely: a frame
    // whose declared hash does not match its content has been mutated after
    // emission and is not the thing the solver produced.
    if (f.resultHash != computeResultHash(f)) {
        r.reason = "resultHash does not match frame content (frame was altered after emission)";
        return r;
    }
    r.accepted = true;
    return r;
}

bool FrameSink::accept(const AnimationFrame& f) {
    const FrameCheck c = checkFrame(f);
    if (!c.accepted) {
        rejections_.push_back("frame " + std::to_string(f.frameIndex) + ": " + c.reason);
        return false;
    }
    if (!frames_.empty()) {
        const AnimationFrame& prev = frames_.back();
        if (f.frameIndex != prev.frameIndex + 1) {
            rejections_.push_back("frame " + std::to_string(f.frameIndex) +
                                  ": frameIndex is not previous+1 (a frame was dropped or reordered)");
            return false;
        }
        if (f.solverStep <= prev.solverStep) {
            rejections_.push_back("frame " + std::to_string(f.frameIndex) +
                                  ": solverStep did not advance");
            return false;
        }
        if (f.simTime < prev.simTime) {
            rejections_.push_back("frame " + std::to_string(f.frameIndex) +
                                  ": simTime moved backwards");
            return false;
        }
    }
    hashU64(seqHash_, f.resultHash);
    frames_.push_back(f);
    return true;
}

void FrameSink::clear() {
    frames_.clear();
    rejections_.clear();
    seqHash_ = kFnvOffset;
}

std::uint64_t sequenceHash(const std::vector<AnimationFrame>& frames) {
    std::uint64_t h = kFnvOffset;
    for (const auto& f : frames) hashU64(h, f.resultHash);
    return h;
}

}  // namespace simulation
}  // namespace forge
