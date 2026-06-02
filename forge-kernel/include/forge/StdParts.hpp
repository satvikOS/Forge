#pragma once

// Forge-204 — parametric standard parts library.
//
// Each generator returns a triangle-mesh (`positions`, `indices`) that
// the renderer + Forge-178/198 glTF export consume directly. The mesh
// is positioned at the origin with sensible local axes:
//
//   * Bolts/nuts/washers/bearings: axis = +Z, top face at +Z.
//   * Spur gears: axis = +Z, face width centred on Z = 0.
//
// Catalogue codes match ISO/ANSI conventions where applicable
// (M3..M16 thread sizes, common bearing series).

#include <cstdint>
#include <vector>

namespace forge { namespace stdparts {

struct Mesh {
    std::vector<float>         positions;
    std::vector<std::uint32_t> indices;
};

struct BoltSpec {
    double diameter;    // nominal thread diameter
    double length;      // total bolt length (excl head)
    double headHeight;  // hex head height
    double headWidth;   // across-flats of the hex
};

struct NutSpec {
    double innerDiameter;
    double height;
    double width;       // across-flats
};

struct WasherSpec {
    double innerDiameter;
    double outerDiameter;
    double thickness;
};

struct BearingSpec {
    double innerDiameter;
    double outerDiameter;
    double width;
};

struct SpurGearSpec {
    double module;         // gear module
    std::uint32_t teeth;
    double faceWidth;
    double pressureAngle;  // radians; 20° ≈ 0.349
};

Mesh makeBolt(const BoltSpec& spec, std::uint32_t shankSegments);
Mesh makeNut(const NutSpec& spec, std::uint32_t boreSegments);
Mesh makeWasher(const WasherSpec& spec, std::uint32_t segments);
Mesh makeBearing(const BearingSpec& spec, std::uint32_t segments);
Mesh makeSpurGear(const SpurGearSpec& spec, std::uint32_t teethSamples);

// Convenience: ISO M-series bolt + nut from the M code (3, 4, 5, 6, 8,
// 10, 12, 16, 20, 24). Returns spec with default head dims per ISO 4014.
BoltSpec specForMetricBolt(std::uint32_t mCode, double length);
NutSpec  specForMetricNut(std::uint32_t mCode);

}} // namespace forge::stdparts
