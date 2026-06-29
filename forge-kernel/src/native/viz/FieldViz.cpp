// forge/native/viz/FieldViz.cpp
//
// Implementation of the CAE field-visualization pipeline declared in
// forge/native/viz/FieldViz.hpp.
//
// The CONTOUR filter delegates to the validated implicit::IsoMesher (the shared
// marching-cubes mesher); nothing in this file re-derives the 256-case table.
// Pure C++20, standard library only. No external deps, no OCCT, no WASM.

#include "forge/native/viz/FieldViz.hpp"

#include <algorithm>
#include <cmath>
#include <memory>
#include <stdexcept>

namespace forge {
namespace native {
namespace viz {

// ===========================================================================
// 1) WARP BY VECTOR
// ===========================================================================
std::vector<Vec3> warpByVector(const std::vector<Vec3>& positions,
                               const std::vector<Vec3>& displacements,
                               double scale) {
    if (positions.size() != displacements.size())
        throw std::runtime_error(
            "viz::warpByVector: positions and displacements must be the same length");
    std::vector<Vec3> out;
    out.reserve(positions.size());
    for (std::size_t i = 0; i < positions.size(); ++i)
        out.push_back(positions[i] + displacements[i] * scale);  // x' = x + scale·u
    return out;
}

// ===========================================================================
// 2) VIRIDIS COLORMAP
//
// 11 anchor points (t = 0, 0.1, …, 1.0) sampled from matplotlib's viridis
// (perceptually-uniform, colour-blind-safe). Embedded as DATA, not third-party
// source. The colormap is luminance-monotonic by construction (its design goal),
// which the gate verifies via the Rec.601 luma of each anchor.
// ===========================================================================
namespace {

constexpr int kViridisN = 11;
constexpr double kViridis[kViridisN][3] = {
    {0.267004, 0.004874, 0.329415}, // t=0.0  dark purple
    {0.282623, 0.140926, 0.457517}, // t=0.1
    {0.253935, 0.265254, 0.529983}, // t=0.2
    {0.206756, 0.371758, 0.553117}, // t=0.3
    {0.163625, 0.471133, 0.558148}, // t=0.4
    {0.127568, 0.566949, 0.550556}, // t=0.5  teal
    {0.134692, 0.658636, 0.517649}, // t=0.6
    {0.266941, 0.748751, 0.440573}, // t=0.7
    {0.477504, 0.821444, 0.318195}, // t=0.8
    {0.741388, 0.873449, 0.149561}, // t=0.9
    {0.993248, 0.906157, 0.143936}, // t=1.0  yellow
};

} // namespace

RGB viridisUnit(double t) {
    // Clamp the normalized coordinate to [0,1] (out-of-range maps to endpoints).
    if (!(t > 0.0)) t = 0.0;       // also catches NaN -> 0
    if (t > 1.0) t = 1.0;

    // Map t to a fractional index into the anchor table and linearly interpolate
    // between the two bracketing anchors.
    const double f = t * (kViridisN - 1);
    int i0 = static_cast<int>(std::floor(f));
    if (i0 < 0) i0 = 0;
    if (i0 > kViridisN - 2) i0 = kViridisN - 2;   // keep i0+1 in range
    const int i1 = i0 + 1;
    const double s = f - i0;                       // local fraction in [0,1]

    RGB c;
    c.r = kViridis[i0][0] + s * (kViridis[i1][0] - kViridis[i0][0]);
    c.g = kViridis[i0][1] + s * (kViridis[i1][1] - kViridis[i0][1]);
    c.b = kViridis[i0][2] + s * (kViridis[i1][2] - kViridis[i0][2]);
    return c;
}

RGB viridis(double value, double vmin, double vmax) {
    const double span = vmax - vmin;
    // Degenerate / inverted range: everything is the first colour (honest, not
    // a division-by-zero). A valid range normalizes then clamps.
    if (!(span > 0.0)) return viridisUnit(0.0);
    return viridisUnit((value - vmin) / span);
}

Range autoRange(const std::vector<double>& values) {
    Range r;
    if (values.empty()) return r;  // {0,0}
    r.vmin = r.vmax = values[0];
    for (double v : values) {
        if (v < r.vmin) r.vmin = v;
        if (v > r.vmax) r.vmax = v;
    }
    return r;
}

std::vector<RGB> colormapField(const std::vector<double>& values,
                               double vmin, double vmax) {
    std::vector<RGB> out;
    out.reserve(values.size());
    for (double v : values) out.push_back(viridis(v, vmin, vmax));
    return out;
}

std::vector<RGB> colormapFieldAuto(const std::vector<double>& values,
                                   Range& outRange) {
    outRange = autoRange(values);
    return colormapField(values, outRange.vmin, outRange.vmax);
}

// ===========================================================================
// 3) STRUCTURED SCALAR FIELD + CONTOUR
// ===========================================================================
namespace {

// Linear vertex index, matching IsoMesher: (k·VY + j)·VX + i.
inline std::size_t vidx(int i, int j, int k, int VX, int VY) {
    return (static_cast<std::size_t>(k) * VY + j) * VX + i;
}

// Trilinear interpolation of a scalar grid at a point, clamped to the box.
// At a grid vertex this returns the stored nodal value exactly.
double sampleScalar(const Vec3& min, const Vec3& max, int nx, int ny, int nz,
                    const std::vector<double>& vals, const Vec3& p) {
    const int VX = nx + 1, VY = ny + 1;
    auto axis = [](double pc, double lo, double hi, int n, int& i, double& t) {
        double f = (hi > lo) ? (pc - lo) / (hi - lo) * n : 0.0;  // in [0,n]
        if (f < 0.0) f = 0.0;
        if (f > n)   f = n;
        i = static_cast<int>(std::floor(f));
        if (i > n - 1) i = n - 1;   // keep i+1 a valid vertex
        if (i < 0)     i = 0;
        t = f - i;
    };
    int i, j, k; double tx, ty, tz;
    axis(p.x, min.x, max.x, nx, i, tx);
    axis(p.y, min.y, max.y, ny, j, ty);
    axis(p.z, min.z, max.z, nz, k, tz);

    const double c000 = vals[vidx(i,   j,   k,   VX, VY)];
    const double c100 = vals[vidx(i+1, j,   k,   VX, VY)];
    const double c010 = vals[vidx(i,   j+1, k,   VX, VY)];
    const double c110 = vals[vidx(i+1, j+1, k,   VX, VY)];
    const double c001 = vals[vidx(i,   j,   k+1, VX, VY)];
    const double c101 = vals[vidx(i+1, j,   k+1, VX, VY)];
    const double c011 = vals[vidx(i,   j+1, k+1, VX, VY)];
    const double c111 = vals[vidx(i+1, j+1, k+1, VX, VY)];

    const double c00 = c000 + tx * (c100 - c000);
    const double c10 = c010 + tx * (c110 - c010);
    const double c01 = c001 + tx * (c101 - c001);
    const double c11 = c011 + tx * (c111 - c011);
    const double c0  = c00  + ty * (c10  - c00);
    const double c1  = c01  + ty * (c11  - c01);
    return c0 + tz * (c1 - c0);
}

// Sdf adapter: presents a StructuredScalarField to the SHARED implicit::IsoMesher
// (eval(p) == field.sample(p)). This is the entire reason no second marching-
// cubes routine exists — the field is meshed by the same validated mesher the
// implicit/voxel stages use (cf. voxel::GridFieldSdf).
class FieldSdf : public implicit::SdfNode {
public:
    explicit FieldSdf(const StructuredScalarField& f) : f_(&f) {}
    double eval(const implicit::Vec3& p) const override { return f_->sample(p); }
private:
    const StructuredScalarField* f_;
};

} // namespace

bool StructuredScalarField::valid() const {
    return nx >= 1 && ny >= 1 && nz >= 1 && values.size() == vertexCount();
}

double StructuredScalarField::sample(const Vec3& p) const {
    return sampleScalar(min, max, nx, ny, nz, values, p);
}

Mesh contour(const StructuredScalarField& field, double isovalue) {
    if (!field.valid())
        throw std::runtime_error(
            "viz::contour: invalid StructuredScalarField (bad dims or values size)");

    // Wrap the field as an Sdf and march it over its OWN grid (one MC cell per
    // field cell), so the surface is extracted from the actual nodal values.
    auto node = std::make_shared<FieldSdf>(field);
    implicit::Sdf sdf(node);

    implicit::GridSpec grid;
    grid.min = field.min;
    grid.max = field.max;
    grid.nx  = field.nx;
    grid.ny  = field.ny;
    grid.nz  = field.nz;

    return implicit::IsoMesher::march(sdf, grid, isovalue);
}

// ===========================================================================
// 4) STRUCTURED VECTOR FIELD + RK4 STREAMLINE
// ===========================================================================
bool StructuredVectorField::valid() const {
    return nx >= 1 && ny >= 1 && nz >= 1 && values.size() == vertexCount();
}

Vec3 StructuredVectorField::sample(const Vec3& p) const {
    // Trilinear sample component-wise (reuse the scalar sampler per channel by
    // viewing each component; here inlined to avoid three temporary arrays).
    const int VX = nx + 1, VY = ny + 1;
    auto axis = [](double pc, double lo, double hi, int n, int& i, double& t) {
        double f = (hi > lo) ? (pc - lo) / (hi - lo) * n : 0.0;
        if (f < 0.0) f = 0.0;
        if (f > n)   f = n;
        i = static_cast<int>(std::floor(f));
        if (i > n - 1) i = n - 1;
        if (i < 0)     i = 0;
        t = f - i;
    };
    int i, j, k; double tx, ty, tz;
    axis(p.x, min.x, max.x, nx, i, tx);
    axis(p.y, min.y, max.y, ny, j, ty);
    axis(p.z, min.z, max.z, nz, k, tz);

    const Vec3& v000 = values[vidx(i,   j,   k,   VX, VY)];
    const Vec3& v100 = values[vidx(i+1, j,   k,   VX, VY)];
    const Vec3& v010 = values[vidx(i,   j+1, k,   VX, VY)];
    const Vec3& v110 = values[vidx(i+1, j+1, k,   VX, VY)];
    const Vec3& v001 = values[vidx(i,   j,   k+1, VX, VY)];
    const Vec3& v101 = values[vidx(i+1, j,   k+1, VX, VY)];
    const Vec3& v011 = values[vidx(i,   j+1, k+1, VX, VY)];
    const Vec3& v111 = values[vidx(i+1, j+1, k+1, VX, VY)];

    auto lerp = [](const Vec3& a, const Vec3& b, double t) { return a + (b - a) * t; };
    Vec3 c00 = lerp(v000, v100, tx);
    Vec3 c10 = lerp(v010, v110, tx);
    Vec3 c01 = lerp(v001, v101, tx);
    Vec3 c11 = lerp(v011, v111, tx);
    Vec3 c0  = lerp(c00, c10, ty);
    Vec3 c1  = lerp(c01, c11, ty);
    return lerp(c0, c1, tz);
}

namespace {
// Is p strictly inside the field box (with a tiny tolerance)? Used to stop a
// streamline that has left the domain rather than integrate clamped data.
bool insideBox(const Vec3& p, const Vec3& lo, const Vec3& hi) {
    const double e = 1e-12;
    return p.x >= lo.x - e && p.x <= hi.x + e &&
           p.y >= lo.y - e && p.y <= hi.y + e &&
           p.z >= lo.z - e && p.z <= hi.z + e;
}
} // namespace

std::vector<Vec3> streamline(const StructuredVectorField& field,
                             const Vec3& seed, double dt, int steps) {
    if (!field.valid())
        throw std::runtime_error("viz::streamline: invalid StructuredVectorField");
    std::vector<Vec3> path;
    if (steps < 0) steps = 0;
    path.reserve(static_cast<std::size_t>(steps) + 1);
    Vec3 p = seed;
    path.push_back(p);
    for (int s = 0; s < steps; ++s) {
        if (!insideBox(p, field.min, field.max)) break;
        // Classical RK4 on dp/dt = v(p).
        const Vec3 k1 = field.sample(p);
        const Vec3 k2 = field.sample(p + k1 * (dt * 0.5));
        const Vec3 k3 = field.sample(p + k2 * (dt * 0.5));
        const Vec3 k4 = field.sample(p + k3 * dt);
        p = p + (k1 + k2 * 2.0 + k3 * 2.0 + k4) * (dt / 6.0);
        path.push_back(p);
    }
    return path;
}

} // namespace viz
} // namespace native
} // namespace forge
