// forge/native/implicit/MeshToFRep.cpp
//
// Implementation of forge::native::implicit::MeshToFRep — the mesh -> evaluable
// implicit field bridge declared in MeshToFRep.hpp. See the header for the
// honest scope / robustness statement.
//
// Pure C++20, standard library + the existing forge/native headers only.
// NO OCCT, NO WASM, NO third-party libs.

#include "forge/native/implicit/MeshToFRep.hpp"

// CI portability: explicitly include EVERY standard header used below. A missing
// include compiles on Mac libc++ (transitive) but FAILS CI's libstdc++.
#include <algorithm>     // std::min, std::max, std::sort, std::clamp
#include <array>         // std::array
#include <cmath>         // std::sqrt, std::fabs, std::isfinite
#include <cstddef>       // std::size_t
#include <cstdint>       // std::uint32_t, std::uint64_t
#include <functional>    // (priority_queue / comparator parity with sibling modules)
#include <limits>        // std::numeric_limits
#include <memory>        // std::make_shared, std::shared_ptr
#include <numeric>       // (accumulate/iota parity with sibling modules)
#include <stdexcept>     // std::runtime_error
#include <utility>       // std::move
#include <vector>        // std::vector

namespace forge {
namespace native {
namespace implicit {

// ===========================================================================
// Local helpers (anonymous namespace — do NOT leak symbols)
// ===========================================================================
namespace {

// implicit::Vec3 <-> mesh::Vec3 bridges (the SDF tree speaks implicit::Vec3,
// the BVH speaks mesh::Vec3; they are the same three doubles).
inline mesh::Vec3 toMesh(const Vec3& v) { return mesh::Vec3{v.x, v.y, v.z}; }

inline bool finite3(const Vec3& v) {
    return std::isfinite(v.x) && std::isfinite(v.y) && std::isfinite(v.z);
}

// Three fixed, mutually non-parallel, generic ray directions for the parity
// vote. Each is "almost axis-aligned" but tilted by irrational-looking small
// components so it is exceedingly unlikely to graze a shared edge/vertex of a
// well-formed mesh, and the three together make a grazing tie a non-event.
constexpr int kNumRays = 3;
const Vec3 kRayDirs[kNumRays] = {
    Vec3{ 1.0,        0.0123456, 0.0076543},
    Vec3{ 0.0091234,  1.0,       0.0061728},
    Vec3{ 0.0054321,  0.0083210, 1.0       },
};

// Count how many triangles the ray (origin, dir) crosses over [0, maxT], using
// the BVH's nearest-forward-hit query repeatedly: shoot, count the nearest hit,
// advance the origin just past it, and repeat until no more forward hits remain
// within the remaining length. `dir` need not be unit. Returns -1 if a hit is
// found but cannot be advanced (a self-stuck ray) so the caller can discard this
// ray's vote rather than loop forever.
int countCrossings(const geom::AABBTree& tree, const Vec3& origin,
                   const Vec3& dir, double maxT, double advanceEps) {
    int crossings = 0;
    mesh::Vec3 o = toMesh(origin);
    const mesh::Vec3 d = toMesh(dir);
    double remaining = maxT;

    // Hard iteration cap: a ray cannot cross more triangles than exist; add slack
    // for the per-hit re-launch. Prevents any pathological infinite loop.
    const std::size_t cap = tree.triangleCount() * 2 + 16;
    for (std::size_t iter = 0; iter < cap; ++iter) {
        geom::RayHit h = tree.rayIntersect(o, d, remaining);
        if (!h.hit) break;
        ++crossings;
        // Advance the origin just past the hit point along the ray. We step in
        // PARAMETRIC units (t) scaled by advanceEps so the step is tiny relative
        // to the model but always strictly forward.
        const double step = h.t + advanceEps;
        if (!(step > 0.0)) return -1;          // cannot make forward progress
        o = mesh::Vec3{o.x + d.x * step, o.y + d.y * step, o.z + d.z * step};
        remaining -= step;
        if (!(remaining > 0.0)) break;
    }
    return crossings;
}

} // namespace

// ===========================================================================
// MeshFieldNode — the custom SdfNode that wraps a mesh evaluator.
//
// This is what makes a mesh a first-class SDF operand: it answers eval(p) by
// delegating to the shared MeshFieldEvaluator, so unionOp / intersectionOp /
// differenceOp / smoothUnionOp / IsoMesher treat it identically to a sphere().
// ===========================================================================
namespace {

class MeshFieldNode final : public SdfNode {
public:
    explicit MeshFieldNode(std::shared_ptr<const MeshFieldEvaluator> ev)
        : ev_(std::move(ev)) {}
    double eval(const Vec3& p) const override { return ev_->eval(p); }
private:
    std::shared_ptr<const MeshFieldEvaluator> ev_;
};

} // namespace

// ===========================================================================
// MeshFieldEvaluator
// ===========================================================================
MeshFieldEvaluator::MeshFieldEvaluator(std::vector<double> positions,
                                       std::vector<std::uint32_t> indices,
                                       geom::AABBTree tree,
                                       double diag)
    : positions_(std::move(positions)),
      indices_(std::move(indices)),
      tree_(std::move(tree)),
      diag_(diag) {}

double MeshFieldEvaluator::eval(const Vec3& p) const {
    // Non-finite query: report a large positive (outside) sentinel rather than
    // propagate a NaN through downstream CSG. This never fabricates a surface.
    if (!finite3(p)) return std::numeric_limits<double>::infinity();

    // ---- MAGNITUDE: exact closest-triangle Euclidean distance via the BVH ----
    geom::ClosestResult cr = tree_.closestPoint(toMesh(p));
    if (!cr.ok) return std::numeric_limits<double>::infinity();  // empty tree
    const double dist = std::sqrt(std::max(0.0, cr.dist2));

    // ---- SIGN: ray-parity, MAJORITY vote across kNumRays generic directions ----
    // Ray length must exceed the model so a ray launched from inside always exits.
    // diag_ is the AABB diagonal; 2*diag from any interior point clears the box.
    const double rayLen = 2.0 * diag_ + 1.0;
    // A tiny strictly-forward re-launch step, scaled to the model so it is small
    // relative to the smallest feature yet always escapes the just-hit triangle.
    const double advanceEps = (diag_ > 0.0) ? diag_ * 1e-9 : 1e-12;

    int insideVotes = 0, validVotes = 0;
    for (int i = 0; i < kNumRays; ++i) {
        const int c = countCrossings(tree_, p, kRayDirs[i], rayLen, advanceEps);
        if (c < 0) continue;                   // discard a self-stuck ray
        ++validVotes;
        if (c % 2 == 1) ++insideVotes;         // ODD crossings => inside
    }

    // If every ray was discarded (extreme degeneracy), fall back to "outside":
    // we refuse to fabricate an inside classification we could not verify.
    const bool inside =
        (validVotes > 0) && (insideVotes * 2 > validVotes);

    return inside ? -dist : dist;
}

// ===========================================================================
// MeshFRepResult::field — wrap the evaluator as a composable Sdf
// ===========================================================================
Sdf MeshFRepResult::field() const {
    if (!ok || !eval) return Sdf{};            // empty handle on failure
    return Sdf(std::make_shared<MeshFieldNode>(eval));
}

// ===========================================================================
// MeshToFRep::build
// ===========================================================================
MeshFRepResult MeshToFRep::build(const mesh::HalfEdgeMesh& mesh) {
    MeshFRepResult out;

    // (1) An empty mesh (no faces) is an honest failure.
    if (mesh.faceCount() == 0) {
        out.reason = "empty mesh (no faces)";
        return out;
    }

    // (2) Audit topology. The ray-parity SIGN is only meaningful for a CLOSED,
    //     2-manifold, consistently-wound mesh; otherwise we refuse honestly.
    mesh::ValidityReport rep = mesh.validate();
    out.closed = rep.watertight;
    out.manifold = rep.manifold;
    if (!rep.watertight) {
        out.reason = "open mesh (not watertight) — parity sign undefined";
        return out;
    }
    if (!rep.manifold) {
        out.reason = "non-manifold mesh — parity sign undefined";
        return out;
    }
    if (!rep.twinsConsistent) {
        out.reason = "inconsistent winding — parity sign undefined";
        return out;
    }

    // (3) Export the soup and build the BVH. The BVH rejects (ok=false) any
    //     degenerate / non-finite / out-of-range triangle — surface those.
    std::vector<double>        positions;
    std::vector<std::uint32_t> indices;
    mesh.toSoup(positions, indices);

    if (indices.empty() || indices.size() % 3 != 0) {
        out.reason = "empty / malformed triangle soup";
        return out;
    }

    geom::AABBTree tree;
    if (!tree.build(positions, indices, geom::SplitMethod::Median)) {
        out.reason = "BVH build rejected the soup (degenerate triangles)";
        return out;
    }

    // (4) The bounding box must have positive extent (a zero-extent AABB has no
    //     interior and no usable ray length).
    geom::Aabb bb = tree.bounds();
    if (!bb.valid()) {
        out.reason = "invalid bounding box";
        return out;
    }
    const double dx = bb.maxx - bb.minx;
    const double dy = bb.maxy - bb.miny;
    const double dz = bb.maxz - bb.minz;
    const double diag = std::sqrt(dx * dx + dy * dy + dz * dz);
    if (!(diag > 0.0) || !std::isfinite(diag)) {
        out.reason = "zero-extent / non-finite bounding box";
        return out;
    }

    // Success — build the shared evaluator.
    out.numTriangles = indices.size() / 3;
    out.eval = std::make_shared<MeshFieldEvaluator>(
        std::move(positions), std::move(indices), std::move(tree), diag);
    out.ok = true;
    out.reason = "";
    return out;
}

// ===========================================================================
// MeshToFRep::defaultGrid
// ===========================================================================
GridSpec MeshToFRep::defaultGrid(const MeshFieldEvaluator& ev,
                                 int n, int marginCells) {
    GridSpec g;
    if (n < 1) n = 1;
    if (marginCells < 0) marginCells = 0;

    const geom::Aabb bb = ev.bounds();
    const double dx = bb.maxx - bb.minx;
    const double dy = bb.maxy - bb.miny;
    const double dz = bb.maxz - bb.minz;
    const double longest = std::max(dx, std::max(dy, dz));

    // Cubic cell size from the longest axis split into n cells.
    const double cell = (longest > 0.0) ? (longest / static_cast<double>(n))
                                        : 1.0;
    const double pad = static_cast<double>(marginCells) * cell;

    g.min = Vec3{bb.minx - pad, bb.miny - pad, bb.minz - pad};
    g.max = Vec3{bb.maxx + pad, bb.maxy + pad, bb.maxz + pad};

    // Cell counts per axis so cells stay ~cubic; at least 1 each.
    auto cellsFor = [cell](double extent) {
        int c = static_cast<int>(std::ceil(extent / cell));
        return c < 1 ? 1 : c;
    };
    g.nx = cellsFor((g.max.x - g.min.x));
    g.ny = cellsFor((g.max.y - g.min.y));
    g.nz = cellsFor((g.max.z - g.min.z));
    return g;
}

} // namespace implicit
} // namespace native
} // namespace forge
