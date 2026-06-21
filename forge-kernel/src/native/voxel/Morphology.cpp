// forge/native/voxel/Morphology.cpp
//
// Implementation of the PicoGK-class voxel SDF morphology declared in
// forge/native/voxel/Morphology.hpp. See that header for the exact level-set
// offset identity (f_offset = f - d), the honesty rules, and the reuse map.
//
// This file owns ONLY the field arithmetic and the composition of the offset
// steps. The dense field + trilinear sampler + cell-center volume measure come
// from voxel/VoxelGrid.hpp; the shared voxel->mesh contour comes from
// voxel/VoxelMesh.hpp (which itself reuses implicit/IsoMesher + mesh/HalfEdgeMesh).
// No grid, no mesher, no mesh type, no predicate is duplicated here.
//
// Pure C++20. No external dependencies. No OCCT, no WASM.

#include "forge/native/voxel/Morphology.hpp"

#include <cmath>

namespace forge {
namespace native {
namespace voxel {

namespace {

// True iff x is a finite real (no NaN/Inf). Degenerate offsets are rejected.
inline bool isFiniteD(double x) { return std::isfinite(x); }

// Apply f' = f - d to a COPY of `in` (value semantics: input is never mutated).
// Subtracting d shifts the whole signed field so the zero set { f = 0 } moves to
// the old { f = d } iso-surface — the exact SDF offset for a distance field.
VoxelGrid<float> applyOffsetCopy(const VoxelGrid<float>& in, double d) {
    VoxelGrid<float> out = in;            // deep copy (dense vector of samples)
    std::vector<float>& v = out.data();
    const float df = static_cast<float>(d);
    for (float& s : v) s -= df;           // f' = f - d, node-wise (exact)
    return out;
}

} // namespace

// ---------------------------------------------------------------------------
// Volume measures.
// ---------------------------------------------------------------------------

bool Morphology::isEmpty(const VoxelGrid<float>& g, double iso) {
    // The solid { f <= iso } is empty iff no NODE is inside. Checking nodes (not
    // just cell centers) is the strict test: if even one node is <= iso the field
    // crosses the iso and a non-empty surface exists. Conversely if every node is
    // strictly > iso the trilinear interpolant is > iso everywhere (convex combo
    // of values all > iso) so no point is inside — genuinely empty.
    const std::vector<float>& v = g.data();
    const float isoF = static_cast<float>(iso);
    for (float s : v)
        if (s <= isoF) return false;
    return true;
}

double Morphology::fieldVolume(const VoxelGrid<float>& g, double iso) {
    // Occupied volume of { f <= iso } by the grid's own cell-center (midpoint
    // Riemann) rule. This is the header-only "meshed volume" proxy: it converges
    // to both the marching-cubes enclosed volume and the analytic volume as the
    // spacing shrinks. Returns 0 for an empty solid.
    return g.occupiedVolumeByCenter(iso, /*insideIsLeq=*/true);
}

double Morphology::meshVolume(const VoxelGrid<float>& g, bool& ok, double iso) {
    // Route through the SHARED voxel->mesh contour (marching cubes + HalfEdgeMesh),
    // no second mesher. ok mirrors the contour's ok: false on an empty field
    // (no surface) or a rejected non-manifold soup (MC33 TARGETED in VoxelMesh).
    ContourResult cr = VoxelMesh::contour(g, iso);
    ok = cr.ok;
    if (!cr.ok) return 0.0;
    return cr.mesh.signedVolume();
}

// ---------------------------------------------------------------------------
// Core: signed offset f' = f - d.
// ---------------------------------------------------------------------------
MorphResult Morphology::offset(const VoxelGrid<float>& in, double d, double iso) {
    MorphResult r;
    if (!isFiniteD(d)) {
        // Degenerate (NaN/Inf) distance: honest failure, field returned unchanged.
        r.grid  = in;
        r.ok    = false;
        r.empty = isEmpty(in, iso);
        return r;
    }
    r.grid  = applyOffsetCopy(in, d);
    r.ok    = true;
    r.empty = isEmpty(r.grid, iso);
    return r;
}

// ---------------------------------------------------------------------------
// Dilate (grow): f' = f - r,  r >= 0.
// ---------------------------------------------------------------------------
MorphResult Morphology::dilate(const VoxelGrid<float>& in, double r, double iso) {
    MorphResult res;
    if (!isFiniteD(r) || r < 0.0) {
        // Negative / non-finite radius is degenerate for dilate (use offset() for
        // signed moves). Honest failure, unchanged field.
        res.grid  = in;
        res.ok    = false;
        res.empty = isEmpty(in, iso);
        return res;
    }
    return offset(in, +r, iso);   // grow: subtract r
}

// ---------------------------------------------------------------------------
// Erode (shrink): f' = f + r,  r >= 0.
// ---------------------------------------------------------------------------
MorphResult Morphology::erode(const VoxelGrid<float>& in, double r, double iso) {
    MorphResult res;
    if (!isFiniteD(r) || r < 0.0) {
        res.grid  = in;
        res.ok    = false;
        res.empty = isEmpty(in, iso);
        return res;
    }
    // Erode == offset by -r (add r to the field). If r >= the solid's inradius
    // the field becomes strictly > iso everywhere and the result is HONESTLY
    // empty (offset() sets empty=true, ok stays true). We never fabricate a
    // surface to keep a solid alive.
    return offset(in, -r, iso);
}

// ---------------------------------------------------------------------------
// Open = erode then dilate (same radius). Removes thin convex protrusions.
// ---------------------------------------------------------------------------
MorphResult Morphology::open(const VoxelGrid<float>& in, double r, double iso) {
    MorphResult e = erode(in, r, iso);
    if (!e.ok) return e;                    // propagate degenerate-input failure
    // Erode-then-dilate. If the erode emptied the solid, dilating an all-positive
    // field by r (subtracting r) may or may not re-cross iso; we report the
    // honest result of the composed field either way.
    MorphResult d = dilate(e.grid, r, iso);
    return d;
}

// ---------------------------------------------------------------------------
// Close = dilate then erode (same radius). Fills thin concave gaps.
// ---------------------------------------------------------------------------
MorphResult Morphology::close(const VoxelGrid<float>& in, double r, double iso) {
    MorphResult d = dilate(in, r, iso);
    if (!d.ok) return d;
    MorphResult e = erode(d.grid, r, iso);
    return e;
}

} // namespace voxel
} // namespace native
} // namespace forge
