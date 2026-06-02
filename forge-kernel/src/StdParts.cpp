#include "forge/StdParts.hpp"

#include <cmath>
#include <cstdint>
#include <stdexcept>
#include <utility>

namespace forge { namespace stdparts {

namespace {

constexpr double kPi = 3.14159265358979323846;

void pushVertex(Mesh& m, double x, double y, double z) {
    m.positions.push_back(static_cast<float>(x));
    m.positions.push_back(static_cast<float>(y));
    m.positions.push_back(static_cast<float>(z));
}

void pushTri(Mesh& m, std::uint32_t a, std::uint32_t b, std::uint32_t c) {
    m.indices.push_back(a);
    m.indices.push_back(b);
    m.indices.push_back(c);
}

// Emit a closed cylinder along Z (z0 → z1) with `n` side segments.
// Returns the base vertex index. Triangulates the side walls + both caps.
std::uint32_t emitCylinder(Mesh& m, double radius, double z0, double z1,
                            std::uint32_t n) {
    const std::uint32_t base = static_cast<std::uint32_t>(m.positions.size() / 3);
    // Side ring at z0 (0..n-1), at z1 (n..2n-1)
    for (std::uint32_t i = 0; i < n; ++i) {
        const double t = 2.0 * kPi * i / n;
        pushVertex(m, radius * std::cos(t), radius * std::sin(t), z0);
    }
    for (std::uint32_t i = 0; i < n; ++i) {
        const double t = 2.0 * kPi * i / n;
        pushVertex(m, radius * std::cos(t), radius * std::sin(t), z1);
    }
    const std::uint32_t centreBot = static_cast<std::uint32_t>(m.positions.size() / 3);
    pushVertex(m, 0, 0, z0);
    const std::uint32_t centreTop = static_cast<std::uint32_t>(m.positions.size() / 3);
    pushVertex(m, 0, 0, z1);

    // Side walls (CCW from outside).
    for (std::uint32_t i = 0; i < n; ++i) {
        const std::uint32_t i1 = (i + 1) % n;
        const std::uint32_t a = base + i;
        const std::uint32_t b = base + i1;
        const std::uint32_t c = base + n + i1;
        const std::uint32_t d = base + n + i;
        pushTri(m, a, b, c);
        pushTri(m, a, c, d);
    }
    // Bottom cap (facing -Z)
    for (std::uint32_t i = 0; i < n; ++i) {
        const std::uint32_t i1 = (i + 1) % n;
        pushTri(m, centreBot, base + i1, base + i);
    }
    // Top cap (facing +Z)
    for (std::uint32_t i = 0; i < n; ++i) {
        const std::uint32_t i1 = (i + 1) % n;
        pushTri(m, centreTop, base + n + i, base + n + i1);
    }
    return base;
}

// Emit a hex prism along Z (z0 → z1) with the given across-flats width.
// Used for bolt heads + nuts (outer profile only).
std::uint32_t emitHexPrism(Mesh& m, double acrossFlats, double z0, double z1) {
    const std::uint32_t base = static_cast<std::uint32_t>(m.positions.size() / 3);
    const double radius = acrossFlats / std::cos(kPi / 6.0) * 0.5;  // hex corner radius
    for (std::uint32_t i = 0; i < 6; ++i) {
        const double t = kPi / 6.0 + 2.0 * kPi * i / 6.0;
        pushVertex(m, radius * std::cos(t), radius * std::sin(t), z0);
    }
    for (std::uint32_t i = 0; i < 6; ++i) {
        const double t = kPi / 6.0 + 2.0 * kPi * i / 6.0;
        pushVertex(m, radius * std::cos(t), radius * std::sin(t), z1);
    }
    const std::uint32_t centreBot = static_cast<std::uint32_t>(m.positions.size() / 3);
    pushVertex(m, 0, 0, z0);
    const std::uint32_t centreTop = static_cast<std::uint32_t>(m.positions.size() / 3);
    pushVertex(m, 0, 0, z1);
    for (std::uint32_t i = 0; i < 6; ++i) {
        const std::uint32_t i1 = (i + 1) % 6;
        const std::uint32_t a = base + i;
        const std::uint32_t b = base + i1;
        const std::uint32_t c = base + 6 + i1;
        const std::uint32_t d = base + 6 + i;
        pushTri(m, a, b, c);
        pushTri(m, a, c, d);
    }
    for (std::uint32_t i = 0; i < 6; ++i) {
        const std::uint32_t i1 = (i + 1) % 6;
        pushTri(m, centreBot, base + i1, base + i);
        pushTri(m, centreTop, base + 6 + i, base + 6 + i1);
    }
    return base;
}

// Emit an annular ring (washer): inner radius ri, outer ro, z0..z1.
void emitAnnularPrism(Mesh& m, double ri, double ro, double z0, double z1,
                      std::uint32_t n) {
    const std::uint32_t base = static_cast<std::uint32_t>(m.positions.size() / 3);
    for (std::uint32_t i = 0; i < n; ++i) {
        const double t = 2.0 * kPi * i / n;
        const double c = std::cos(t), s = std::sin(t);
        pushVertex(m, ri * c, ri * s, z0);        // 0: inner bot
        pushVertex(m, ro * c, ro * s, z0);        // 1: outer bot
        pushVertex(m, ri * c, ri * s, z1);        // 2: inner top
        pushVertex(m, ro * c, ro * s, z1);        // 3: outer top
    }
    for (std::uint32_t i = 0; i < n; ++i) {
        const std::uint32_t j = (i + 1) % n;
        const std::uint32_t a0 = base + i * 4 + 0;
        const std::uint32_t a1 = base + i * 4 + 1;
        const std::uint32_t a2 = base + i * 4 + 2;
        const std::uint32_t a3 = base + i * 4 + 3;
        const std::uint32_t b0 = base + j * 4 + 0;
        const std::uint32_t b1 = base + j * 4 + 1;
        const std::uint32_t b2 = base + j * 4 + 2;
        const std::uint32_t b3 = base + j * 4 + 3;
        // Outer side (+r): a1, b1, b3 / a1, b3, a3
        pushTri(m, a1, b1, b3); pushTri(m, a1, b3, a3);
        // Inner side (-r), flipped winding so the normal points inward
        pushTri(m, a0, a2, b2); pushTri(m, a0, b2, b0);
        // Top cap (+z): a2, a3, b3 / a2, b3, b2
        pushTri(m, a2, a3, b3); pushTri(m, a2, b3, b2);
        // Bottom cap (-z), flipped
        pushTri(m, a0, b0, b1); pushTri(m, a0, b1, a1);
    }
}

} // namespace

Mesh makeBolt(const BoltSpec& spec, std::uint32_t shankSegments) {
    if (spec.diameter <= 0 || spec.length <= 0 || spec.headHeight <= 0 || spec.headWidth <= 0)
        throw std::invalid_argument("makeBolt: all dimensions > 0");
    if (shankSegments < 6) shankSegments = 6;
    Mesh m;
    // Head sits above z=0; shank extends downward from z=0 to z=-length.
    emitHexPrism(m, spec.headWidth, 0.0, spec.headHeight);
    emitCylinder(m, spec.diameter * 0.5, -spec.length, 0.0, shankSegments);
    return m;
}

Mesh makeNut(const NutSpec& spec, std::uint32_t boreSegments) {
    if (spec.innerDiameter <= 0 || spec.height <= 0 || spec.width <= 0)
        throw std::invalid_argument("makeNut: all dimensions > 0");
    if (boreSegments < 6) boreSegments = 6;
    Mesh m;
    // Outer hex shell + inner cylindrical hole. We don't boolean-subtract
    // (this is a preview-quality mesh); we just emit both surfaces.
    emitHexPrism(m, spec.width, 0.0, spec.height);
    emitCylinder(m, spec.innerDiameter * 0.5, 0.0, spec.height, boreSegments);
    return m;
}

Mesh makeWasher(const WasherSpec& spec, std::uint32_t segments) {
    if (spec.innerDiameter <= 0 || spec.outerDiameter <= spec.innerDiameter || spec.thickness <= 0)
        throw std::invalid_argument("makeWasher: invalid dimensions");
    if (segments < 12) segments = 12;
    Mesh m;
    emitAnnularPrism(m, spec.innerDiameter * 0.5, spec.outerDiameter * 0.5,
                     0.0, spec.thickness, segments);
    return m;
}

Mesh makeBearing(const BearingSpec& spec, std::uint32_t segments) {
    if (spec.innerDiameter <= 0 || spec.outerDiameter <= spec.innerDiameter || spec.width <= 0)
        throw std::invalid_argument("makeBearing: invalid dimensions");
    if (segments < 16) segments = 16;
    Mesh m;
    const double iD = spec.innerDiameter, oD = spec.outerDiameter, w = spec.width;
    const double thick = (oD - iD) * 0.5 * 0.25;     // race wall thickness
    // Inner race: iD/2 → iD/2 + thick
    emitAnnularPrism(m, iD * 0.5, iD * 0.5 + thick, -w * 0.5, w * 0.5, segments);
    // Outer race: oD/2 - thick → oD/2
    emitAnnularPrism(m, oD * 0.5 - thick, oD * 0.5, -w * 0.5, w * 0.5, segments);
    return m;
}

Mesh makeSpurGear(const SpurGearSpec& spec, std::uint32_t teethSamples) {
    if (spec.module <= 0 || spec.teeth < 4 || spec.faceWidth <= 0)
        throw std::invalid_argument("makeSpurGear: invalid spec");
    if (teethSamples < 8) teethSamples = 8;
    Mesh m;
    // Reference + addendum + dedendum radii.
    const double rp = spec.module * spec.teeth * 0.5;
    const double ra = rp + spec.module;
    const double rd = rp - 1.25 * spec.module;
    const double w  = spec.faceWidth;

    // Per-tooth angle. Each tooth occupies (2π / z), within which a
    // tooth crest of half-thickness `tHalf` at the addendum is centred,
    // with the addendum-crest connecting to the dedendum at the trough.
    const double toothAngle = 2.0 * kPi / spec.teeth;
    const double tHalf = 0.4 * toothAngle * 0.5;     // 80% land, 20% gap

    // Build the outer rim profile: alternating addendum/dedendum points.
    // 4 vertices per tooth (root-left, tip-left, tip-right, root-right).
    std::vector<std::pair<double, double>> ring;      // (x, y) on z = ±w/2
    ring.reserve(spec.teeth * 4);
    for (std::uint32_t k = 0; k < spec.teeth; ++k) {
        const double centre = k * toothAngle;
        ring.emplace_back(rd * std::cos(centre - toothAngle / 2 + tHalf),
                          rd * std::sin(centre - toothAngle / 2 + tHalf));
        ring.emplace_back(ra * std::cos(centre - tHalf),
                          ra * std::sin(centre - tHalf));
        ring.emplace_back(ra * std::cos(centre + tHalf),
                          ra * std::sin(centre + tHalf));
        ring.emplace_back(rd * std::cos(centre + toothAngle / 2 - tHalf),
                          rd * std::sin(centre + toothAngle / 2 - tHalf));
    }
    const std::uint32_t N = static_cast<std::uint32_t>(ring.size());

    const std::uint32_t base = static_cast<std::uint32_t>(m.positions.size() / 3);
    // Bottom ring + top ring + centre top + centre bot.
    for (const auto& p : ring) pushVertex(m, p.first, p.second, -w * 0.5);
    for (const auto& p : ring) pushVertex(m, p.first, p.second,  w * 0.5);
    const std::uint32_t centreBot = base + 2 * N;
    pushVertex(m, 0, 0, -w * 0.5);
    const std::uint32_t centreTop = base + 2 * N + 1;
    pushVertex(m, 0, 0,  w * 0.5);

    // Side walls (CCW from outside).
    for (std::uint32_t i = 0; i < N; ++i) {
        const std::uint32_t j = (i + 1) % N;
        const std::uint32_t a = base + i;
        const std::uint32_t b = base + j;
        const std::uint32_t c = base + N + j;
        const std::uint32_t d = base + N + i;
        pushTri(m, a, b, c); pushTri(m, a, c, d);
    }
    // Caps
    for (std::uint32_t i = 0; i < N; ++i) {
        const std::uint32_t j = (i + 1) % N;
        pushTri(m, centreBot, base + j, base + i);
        pushTri(m, centreTop, base + N + i, base + N + j);
    }

    (void)teethSamples;
    return m;
}

BoltSpec specForMetricBolt(std::uint32_t mCode, double length) {
    // ISO 4014 hex bolts: head height ≈ 0.65·d, across-flats per table.
    static const struct { std::uint32_t m; double afWidth; } AF[] = {
        { 3,  5.5}, { 4,  7.0}, { 5,  8.0}, { 6, 10.0},
        { 8, 13.0}, {10, 17.0}, {12, 19.0}, {16, 24.0},
        {20, 30.0}, {24, 36.0},
    };
    double af = 0;
    for (const auto& row : AF) if (row.m == mCode) { af = row.afWidth; break; }
    if (af == 0) throw std::invalid_argument("specForMetricBolt: unsupported M-code");
    BoltSpec s{};
    s.diameter = static_cast<double>(mCode);
    s.length = length;
    s.headHeight = 0.65 * s.diameter;
    s.headWidth = af;
    return s;
}

NutSpec specForMetricNut(std::uint32_t mCode) {
    static const struct { std::uint32_t m; double afWidth; double h; } TB[] = {
        { 3,  5.5, 2.4}, { 4,  7.0, 3.2}, { 5,  8.0, 4.7}, { 6, 10.0,  5.2},
        { 8, 13.0, 6.8}, {10, 17.0, 8.4}, {12, 19.0,10.8}, {16, 24.0, 14.8},
        {20, 30.0,18.0}, {24, 36.0,21.5},
    };
    double af = 0, h = 0;
    for (const auto& row : TB) if (row.m == mCode) { af = row.afWidth; h = row.h; break; }
    if (af == 0) throw std::invalid_argument("specForMetricNut: unsupported M-code");
    NutSpec s{};
    s.innerDiameter = static_cast<double>(mCode);
    s.height = h;
    s.width = af;
    return s;
}

}} // namespace forge::stdparts
