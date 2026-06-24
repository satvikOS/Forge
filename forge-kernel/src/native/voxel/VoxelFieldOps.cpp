// forge/native/voxel/VoxelFieldOps.cpp
//
// Implementation of the PicoGK-class voxel-field op set declared in
// forge/native/voxel/VoxelFieldOps.hpp — offset / shell / fillet(smooth-boolean)
// / mesh->grid round-trip. See that header for the exact level-set identities,
// the honesty posture, and the reuse map.
//
// This file owns ONLY:
//   * the node-wise field arithmetic for offset (delegated identity f' = f - d),
//     shell (|f| - t/2) and the inward wall (max(f, -f - t)),
//   * the node-wise Quilez smin/smax port for the rounded (filleted) booleans,
//   * the hand-offs to the already-validated enclosed-volume measure, the shared
//     voxel->mesh contour, and the shared mesh->grid voxelizer,
//   * the closed-form spherical-shell volume oracle for the gate.
//
// The dense field engine, trilinear sampler and volume measure all live in
// voxel/VoxelGrid.hpp; the alignment predicate + sharp booleans live in
// voxel/VoxelBoolean.hpp; the mesh<->grid seams live behind voxel/VoxelMesh.hpp
// and implicit/MeshToSDF.hpp. No field engine, no mesher, no mesh type, no
// predicate is duplicated here.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#include "forge/native/voxel/VoxelFieldOps.hpp"

#include <algorithm>   // std::clamp, std::min, std::max
#include <cmath>       // std::fabs, std::isfinite, M_PI fallback

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

namespace forge {
namespace native {
namespace voxel {

namespace {

// True iff x is a finite real (no NaN/Inf). Degenerate distances are rejected.
inline bool isFiniteD(double x) { return std::isfinite(x); }

// Build an empty result-grid that shares `a`'s lattice (dims/origin/spacing),
// ready for a node-wise fill. (Used by the smooth booleans after alignment.)
VoxelGrid<float> makeLike(const VoxelGrid<float>& a) {
    return VoxelGrid<float>(a.nx(), a.ny(), a.nz(), a.origin(), a.spacing(),
                            /*fill=*/0.0f);
}

// Apply a unary node-wise transform g over a COPY of `in` (value semantics).
template <typename G>
VoxelGrid<float> mapCopy(const VoxelGrid<float>& in, G g) {
    VoxelGrid<float> out = in;               // deep copy of the dense samples
    std::vector<float>& v = out.data();
    for (float& s : v) s = static_cast<float>(g(double(s)));
    return out;
}

// Apply a binary node-wise combine over two aligned grids into a fresh grid.
// (Caller MUST have verified alignment via VoxelBoolean::aligned.)
template <typename Op>
VoxelGrid<float> combineAligned(const VoxelGrid<float>& a,
                                const VoxelGrid<float>& b, Op op) {
    VoxelGrid<float> out = makeLike(a);
    const std::vector<float>& da = a.data();
    const std::vector<float>& db = b.data();
    std::vector<float>& dout = out.data();
    const std::size_t n = dout.size();       // == da.size() == db.size() (aligned)
    for (std::size_t i = 0; i < n; ++i)
        dout[i] = static_cast<float>(op(double(da[i]), double(db[i])));
    return out;
}

} // namespace

// ---------------------------------------------------------------------------
// Scalar primitives (Quilez polynomial smin/smax) — same form as SdfOps::smin.
// ---------------------------------------------------------------------------
double VoxelFieldOps::smin(double a, double b, double k) {
    // h = clamp(0.5 + 0.5*(b-a)/k, 0, 1);  smin = mix(b,a,h) - k*h*(1-h).
    double h = 0.5 + 0.5 * (b - a) / k;
    h = std::clamp(h, 0.0, 1.0);
    return (b * (1.0 - h) + a * h) - k * h * (1.0 - h);
}

double VoxelFieldOps::smax(double a, double b, double k) {
    return -VoxelFieldOps::smin(-a, -b, k);
}

// ---------------------------------------------------------------------------
// Volume / occupancy helpers (reuse the already-validated measures).
// ---------------------------------------------------------------------------
double VoxelFieldOps::enclosedVolume(const VoxelGrid<float>& g, double iso) {
    return g.occupiedVolumeByCenter(iso, /*insideIsLeq=*/true);
}

bool VoxelFieldOps::isEmpty(const VoxelGrid<float>& g, double iso) {
    // Empty iff no NODE is inside (strict test): if every node is > iso the
    // trilinear interpolant (a convex combination of node values all > iso) is
    // > iso everywhere, so no point is inside — genuinely empty.
    const std::vector<float>& v = g.data();
    const float isoF = static_cast<float>(iso);
    for (float s : v)
        if (s <= isoF) return false;
    return true;
}

// ---------------------------------------------------------------------------
// (A) OFFSET — f' = f - d  (the single PicoGK-named field-op surface; identical
//     arithmetic to Morphology::offset, one implementation).
// ---------------------------------------------------------------------------
FieldOpResult VoxelFieldOps::offset(const VoxelGrid<float>& in, double d, double iso) {
    FieldOpResult r;
    if (!isFiniteD(d)) {
        r.grid  = in;                 // unchanged copy; honest failure
        r.ok    = false;
        r.empty = isEmpty(in, iso);
        return r;
    }
    r.grid  = mapCopy(in, [d](double f) { return f - d; });
    r.ok    = true;
    r.empty = isEmpty(r.grid, iso);
    return r;
}

// ---------------------------------------------------------------------------
// (B) SHELL / HOLLOW — symmetric thickness-t shell:  f' = |f| - t/2.
// ---------------------------------------------------------------------------
FieldOpResult VoxelFieldOps::shell(const VoxelGrid<float>& in, double t, double iso) {
    FieldOpResult r;
    if (!isFiniteD(t) || !(t > 0.0)) {
        r.grid  = in;                 // unchanged copy; honest failure
        r.ok    = false;
        r.empty = isEmpty(in, iso);
        return r;
    }
    const double half = 0.5 * t;
    // |f| - t/2: the band { |f| <= t/2 } becomes the new solid (total wall t).
    r.grid  = mapCopy(in, [half](double f) { return std::fabs(f) - half; });
    r.ok    = true;
    r.empty = isEmpty(r.grid, iso);
    return r;
}

// ---------------------------------------------------------------------------
// Inward-only wall (PicoGK wall-thickness):  f' = max(f, -(f + t)) = max(f, -f - t).
//   solid(wall) = { f <= 0 } AND NOT { f <= -t }  (the inner-t shell).
// ---------------------------------------------------------------------------
FieldOpResult VoxelFieldOps::shellInward(const VoxelGrid<float>& in, double t, double iso) {
    FieldOpResult r;
    if (!isFiniteD(t) || !(t > 0.0)) {
        r.grid  = in;
        r.ok    = false;
        r.empty = isEmpty(in, iso);
        return r;
    }
    // max(f, -f - t): the difference of the solid and its erosion by t.
    r.grid  = mapCopy(in, [t](double f) { return std::max(f, -f - t); });
    r.ok    = true;
    r.empty = isEmpty(r.grid, iso);
    return r;
}

// ---------------------------------------------------------------------------
// (C) FILLET / ROUND — smooth (rounded) booleans on two aligned fields.
// ---------------------------------------------------------------------------
BooleanResult VoxelFieldOps::smoothUnion(const VoxelGrid<float>& a,
                                         const VoxelGrid<float>& b, double r) {
    BooleanResult res;
    if (!isFiniteD(r) || !(r > 0.0) || !VoxelBoolean::aligned(a, b)) {
        res.ok = false;               // empty grid; honest precondition failure
        return res;
    }
    res.grid = combineAligned(a, b, [r](double fa, double fb) {
        return VoxelFieldOps::smin(fa, fb, r);          // rounded OR (fillet)
    });
    res.ok = true;
    return res;
}

BooleanResult VoxelFieldOps::smoothIntersect(const VoxelGrid<float>& a,
                                             const VoxelGrid<float>& b, double r) {
    BooleanResult res;
    if (!isFiniteD(r) || !(r > 0.0) || !VoxelBoolean::aligned(a, b)) {
        res.ok = false;
        return res;
    }
    res.grid = combineAligned(a, b, [r](double fa, double fb) {
        return VoxelFieldOps::smax(fa, fb, r);          // rounded AND
    });
    res.ok = true;
    return res;
}

BooleanResult VoxelFieldOps::smoothSubtract(const VoxelGrid<float>& a,
                                            const VoxelGrid<float>& b, double r) {
    BooleanResult res;
    if (!isFiniteD(r) || !(r > 0.0) || !VoxelBoolean::aligned(a, b)) {
        res.ok = false;
        return res;
    }
    res.grid = combineAligned(a, b, [r](double fa, double fb) {
        return VoxelFieldOps::smax(fa, -fb, r);         // rounded A \ B
    });
    res.ok = true;
    return res;
}

// ---------------------------------------------------------------------------
// (D) MESH -> SDF GRID round-trip — hand-off to the shared voxelizer.
// ---------------------------------------------------------------------------
implicit::MeshSdfResult VoxelFieldOps::fromMesh(
    const mesh::HalfEdgeMesh& m, const implicit::MeshToSdfSpec& spec) {
    return implicit::MeshToSDF::build(m, spec);
}

// ---------------------------------------------------------------------------
// Closed-form spherical-shell volume oracle (for the SHELL gate).
//   V = 4/3·π·[ (R+t/2)^3 - max(R-t/2, 0)^3 ].
// ---------------------------------------------------------------------------
double shellVolumeSphere(double R, double t) {
    const double half = 0.5 * t;
    const double rOut = R + half;
    const double rIn  = std::max(R - half, 0.0);
    return (4.0 / 3.0) * M_PI * (rOut * rOut * rOut - rIn * rIn * rIn);
}

} // namespace voxel
} // namespace native
} // namespace forge
