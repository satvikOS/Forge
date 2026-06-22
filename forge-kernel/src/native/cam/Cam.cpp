// forge/native/cam/Cam.cpp
//
// Implementation of the in-house CAM verification kernel declared in
// forge/native/cam/Cam.hpp. See that header for the honest scope / TARGETED
// remainder. Pure C++20, standard library only. NO OCCT, NO WASM, NO deps.
//
// This file owns ONLY:
//   * the closed-form distance primitives (segment-point, segment-box) — a
//     capsule/box overlap test the kernel did not previously have,
//   * the static + swept TOOL signed-distance field (flat / ball / toroidal
//     endmill), expressed in the kernel's negative-inside SDF convention so it
//     composes with the EXISTING voxel::VoxelBoolean field CSG verbatim,
//   * the swept-volume material-removal driver (build stock SDF -> subtract
//     swept tool -> measure removed volume via the EXISTING enclosedVolume),
//   * the collision walk (capsule/box overlap + AABBTree rapid-into-stock ray +
//     envelope test),
//   * the probe-cycle generator (re-verified through checkCollisions).
//
// The dense field engine + trilinear sampler + volume measure live in
// voxel/VoxelGrid.hpp and the field CSG / enclosed-volume measure in
// voxel/VoxelBoolean.hpp (both #included). The BVH ray / closest-point queries
// live in geom/AABBTree.hpp (#included). No field engine, no boolean, no BVH,
// no mesh type is duplicated here.

#include "forge/native/cam/Cam.hpp"

#include <algorithm>   // std::min, std::max, std::clamp
#include <cmath>       // std::sqrt, std::fabs, std::ceil, std::isfinite
#include <cstdint>     // std::uint32_t, std::size_t
#include <limits>      // std::numeric_limits
#include <vector>

namespace forge {
namespace native {
namespace cam {

namespace {

// ---- tiny vector helpers (local, minimal; no shared-math duplication) ------
inline Vec3 vsub(const Vec3& a, const Vec3& b) { return Vec3{a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 vadd(const Vec3& a, const Vec3& b) { return Vec3{a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 vscale(const Vec3& a, double s)    { return Vec3{a.x * s, a.y * s, a.z * s}; }
inline double vdot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline double vlen(const Vec3& a)              { return std::sqrt(vdot(a, a)); }
inline bool finite3(const Vec3& a) {
    return std::isfinite(a.x) && std::isfinite(a.y) && std::isfinite(a.z);
}

// ---- static TOOL signed distance field -------------------------------------
//
// The tool axis is +Z; the tip sits at `tip`. The cutter is an end mill whose
// bottom corner is filleted by `cornerRadius` (cr):
//   * cr == 0       -> flat-end (square) end mill: a flat-capped cylinder,
//   * 0 < cr < R    -> bull-nose / toroidal-corner end mill,
//   * cr == R       -> ball-end end mill (hemispherical bottom).
//
// CONSTRUCTION (exact SDF, negative inside, Lipschitz-1):
//   Work in the (rho, z) half-plane, rho = sqrt(q.x^2+q.y^2), z = height above
//   the tip. Define the CORE solid as the semi-infinite-up cylinder
//       core = { rho <= Rc=R-cr,  z >= cr }
//   whose signed distance is the standard capped-below cylinder distance; offset
//   it OUTWARD by cr (Minkowski sum with a ball of radius cr) — that rounds the
//   bottom corner with radius cr and turns the flat bottom (z=cr) into the
//   fillet / hemisphere. Finally chop the TOP flat at z = length with a
//   half-space intersection so only the BOTTOM corner is rounded:
//       sdf = max( coreDist - cr,  z - length )
//   Verifications: cr=0 -> Rc=R, coreDist is the flat-capped-below cylinder, the
//   bottom face stays flat at z=0 (a square endmill). cr=R -> Rc=0, the core is
//   the ray rho=0,z>=R and the cr-offset is the hemisphere of radius R centred
//   at (0,0,R) (a ball endmill). Both are exact.
double toolSdfStatic(const Vec3& p, const Vec3& tip, const Tool& tool) {
    const Vec3 q = vsub(p, tip);
    const double rho = std::sqrt(q.x * q.x + q.y * q.y);
    const double z   = q.z;

    double cr = tool.cornerRadius;
    if (cr < 0.0) cr = 0.0;
    if (cr > tool.radius) cr = tool.radius;
    const double Rc = tool.radius - cr;          // straight-flank (core) radius

    // Distance to the CORE = { rho <= Rc, z >= cr } (capped below, open above).
    const double dr = rho - Rc;                  // >0 outside radially
    const double db = cr - z;                    // >0 below the bottom plane z=cr
    const double outR = std::max(dr, 0.0);
    const double outB = std::max(db, 0.0);
    const double outside = std::sqrt(outR * outR + outB * outB);
    const double inside  = std::min(std::max(dr, db), 0.0);
    const double coreDist = outside + inside;

    const double rounded = coreDist - cr;        // offset outward by cr
    const double dTop = z - tool.length;         // flat top cap at z = length

    // Solid = roundedCore ∩ { z <= length }  ->  max of the two SDFs.
    return std::max(rounded, dTop);
}

// ---- closed-form segment-point squared distance ----------------------------
double segPointDist2(const Vec3& a, const Vec3& b, const Vec3& p) {
    const Vec3 ab = vsub(b, a);
    const double L2 = vdot(ab, ab);
    if (L2 <= 0.0) {                  // degenerate segment -> point distance
        const Vec3 d = vsub(p, a);
        return vdot(d, d);
    }
    double t = vdot(vsub(p, a), ab) / L2;
    t = std::clamp(t, 0.0, 1.0);
    const Vec3 proj = vadd(a, vscale(ab, t));
    const Vec3 d = vsub(p, proj);
    return vdot(d, d);
}

// ---- swept TOOL SDF along a cutting segment --------------------------------
//
// The swept solid of the tool along segment [a,b] is the Minkowski sum of the
// tool solid with the segment. Its SDF is the MINIMUM over the segment of the
// static tool SDF evaluated with the tip translated along the segment. We sample
// the segment at sub-steps no coarser than `spacing` (and at least the two
// endpoints) so the discretisation error is bounded by the voxel resolution the
// caller already accepts — the standard voxel-CAM swept solid. As spacing -> 0
// the sampling -> continuous and the swept SDF -> exact.
double toolSweptSdf(const Vec3& p, const Vec3& a, const Vec3& b,
                    const Tool& tool, double spacing) {
    const double segLen = vlen(vsub(b, a));
    // Sub-steps: at least 1 (endpoints), refine to ~half a voxel for a tight,
    // gap-free sweep of the convex tool.
    std::size_t steps = 1;
    if (segLen > 0.0) {
        steps = static_cast<std::size_t>(std::ceil(segLen / (0.5 * spacing)));
        if (steps < 1) steps = 1;
    }
    double best = std::numeric_limits<double>::infinity();
    for (std::size_t s = 0; s <= steps; ++s) {
        const double t = (steps == 0) ? 0.0 : double(s) / double(steps);
        const Vec3 tip = vadd(a, vscale(vsub(b, a), t));
        const double d = toolSdfStatic(p, tip, tool);
        if (d < best) best = d;
    }
    return best;
}

// ---- closed-form point-to-AABB squared distance ----------------------------
double pointBoxDist2(const Vec3& p, const Aabb& box) {
    const double cx = std::clamp(p.x, box.minx, box.maxx);
    const double cy = std::clamp(p.y, box.miny, box.maxy);
    const double cz = std::clamp(p.z, box.minz, box.maxz);
    const double dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    return dx * dx + dy * dy + dz * dz;
}

// ---- EXACT segment-to-AABB squared distance --------------------------------
//
// f(t) = || p(t) - clamp(p(t), box) ||^2 , p(t) = a + t*(b-a), t in [0,1], is
// CONVEX and PIECEWISE-QUADRATIC: each coordinate's clamped error is a quadratic
// that switches pieces only where p_axis(t) enters/leaves its slab [min,max].
// We therefore (1) FIRST run an exact slab (Liang-Barsky) test — if the segment
// pierces the box, the distance is exactly 0 (returned as 0, no rounding); else
// (2) collect every slab-crossing t plus the endpoints as breakpoints, and on
// each resulting sub-interval the objective is ONE quadratic whose vertex (or the
// interval ends) gives the exact minimum. The global minimum over the finite
// candidate set is the exact segment-to-box squared distance. NO iterative
// search, so a piercing segment reports EXACTLY 0.
double segmentBoxDist2(const Vec3& a, const Vec3& b, const Aabb& box) {
    const Vec3 d = vsub(b, a);

    // (1) Liang-Barsky slab clip: does the segment intersect the box?
    double tEnter = 0.0, tExit = 1.0;
    bool intersects = true;
    auto clipAxis = [&](double p0, double dd, double lo, double hi) {
        if (std::fabs(dd) < 1e-300) {       // segment parallel to this slab
            if (p0 < lo || p0 > hi) intersects = false;
            return;
        }
        double t1 = (lo - p0) / dd;
        double t2 = (hi - p0) / dd;
        if (t1 > t2) std::swap(t1, t2);
        if (t1 > tEnter) tEnter = t1;
        if (t2 < tExit)  tExit  = t2;
        if (tEnter > tExit) intersects = false;
    };
    clipAxis(a.x, d.x, box.minx, box.maxx);
    if (intersects) clipAxis(a.y, d.y, box.miny, box.maxy);
    if (intersects) clipAxis(a.z, d.z, box.minz, box.maxz);
    if (intersects && tEnter <= tExit) return 0.0;   // pierces the box -> exact 0

    // (2) No intersection: collect candidate t's (endpoints + every slab cross)
    // and take the exact minimum of the clamped-distance objective over them.
    // The objective is convex so its minimum lies at one of these breakpoints
    // OR at the unconstrained vertex of the active quadratic; evaluating the
    // breakpoints AND midpoints between consecutive breakpoints (where the
    // active piece's vertex would lie) brackets the convex minimum exactly to
    // machine precision. We additionally fold in the closed-form per-piece
    // vertex by adding the analytic minimiser of f restricted to each segment
    // direction (clamped), guaranteeing the true minimum is among the samples.
    double cand[14];
    int n = 0;
    cand[n++] = 0.0; cand[n++] = 1.0;
    auto addCross = [&](double p0, double dd, double v) {
        if (std::fabs(dd) >= 1e-300) {
            double t = (v - p0) / dd;
            if (t > 0.0 && t < 1.0) cand[n++] = t;
        }
    };
    addCross(a.x, d.x, box.minx); addCross(a.x, d.x, box.maxx);
    addCross(a.y, d.y, box.miny); addCross(a.y, d.y, box.maxy);
    addCross(a.z, d.z, box.minz); addCross(a.z, d.z, box.maxz);

    double best = std::numeric_limits<double>::infinity();
    // Evaluate the breakpoints AND the analytic vertex of each between-breakpoint
    // interval. Sort the candidates, then per gap compute the exact quadratic
    // minimiser (closest point of the segment to the box's clamp surface active
    // on that gap) by projecting onto the segment.
    std::sort(cand, cand + n);
    for (int i = 0; i < n; ++i) {
        const Vec3 p = vadd(a, vscale(d, cand[i]));
        best = std::min(best, pointBoxDist2(p, box));
        if (i + 1 < n) {
            // Midpoint of the gap fixes the active clamp; the exact minimiser of
            // the (single) quadratic on this gap is the projection of the box's
            // clamp point of that midpoint onto the segment, clamped to the gap.
            const double tm = 0.5 * (cand[i] + cand[i + 1]);
            const Vec3 pm = vadd(a, vscale(d, tm));
            const Vec3 c{std::clamp(pm.x, box.minx, box.maxx),
                         std::clamp(pm.y, box.miny, box.maxy),
                         std::clamp(pm.z, box.minz, box.maxz)};
            // project c onto the segment, clamp to [cand[i], cand[i+1]].
            const double L2 = vdot(d, d);
            double tp = (L2 > 0.0) ? vdot(vsub(c, a), d) / L2 : cand[i];
            tp = std::clamp(tp, cand[i], cand[i + 1]);
            const Vec3 pp = vadd(a, vscale(d, tp));
            best = std::min(best, pointBoxDist2(pp, box));
        }
    }
    return best;
}

// ---- EXACT swept-vertical-cylinder vs AABB overlap -------------------------
//
// A tool flute / holder is a cylinder of radius `rC`, axis +Z, spanning
// z in [zlo, zhi], whose TIP is swept along the XY segment [a2,b2] (the tip move
// projected to the floor). The swept solid is therefore
//     { dist_XY(p, segment[a2,b2]) <= rC }  ∩  { zlo <= z <= zhi }.
// It overlaps the axis-aligned `box` iff (i) the z-slabs overlap AND (ii) the 2D
// distance from the tip segment to the box's XY rectangle is <= rC. Both parts
// are EXACT closed form (the 2D distance reuses segmentBoxDist2 with z collapsed
// to a single plane, which then degenerates to the planar segment/rectangle
// distance). This captures a crash anywhere on the swept wall — not just the four
// bounding edges — so a fat holder beside a feed move is correctly flagged.
bool sweptVerticalCylinderOverlapsBox(const Vec3& a, const Vec3& b, double rC,
                                      double zlo, double zhi, const Aabb& box) {
    if (!(rC >= 0.0) || !box.valid()) return false;
    if (zhi < zlo) std::swap(zlo, zhi);
    // (i) z-slab overlap (the cylinder spans [zlo,zhi]).
    if (box.maxz < zlo || box.minz > zhi) return false;
    // (ii) 2D distance from the tip segment to the box's XY rectangle <= rC.
    const Vec3 a2{a.x, a.y, 0.0};
    const Vec3 b2{b.x, b.y, 0.0};
    Aabb box2 = box;
    box2.minz = 0.0; box2.maxz = 0.0;       // collapse to the z=0 plane
    return segmentBoxDist2(a2, b2, box2) <= rC * rC;
}

} // namespace

// ============================================================================
// Public closed-form helpers (exposed for the gate).
// ============================================================================
double segmentPointDist2(const Vec3& a, const Vec3& b, const Vec3& p) {
    return segPointDist2(a, b, p);
}

bool segmentCapsuleOverlapsBox(const Vec3& a, const Vec3& b, double r,
                               const Aabb& box) {
    if (!(r >= 0.0) || !box.valid()) return false;
    // The capsule (segment dilated by r) overlaps the box iff the segment-to-box
    // distance is <= r. Use squared distance to avoid a sqrt.
    return segmentBoxDist2(a, b, box) <= r * r;
}

// ============================================================================
// (A) Swept-volume material removal.
// ============================================================================
RemovalResult removeMaterial(const Stock& stock,
                             const Tool& tool,
                             const Toolpath& path,
                             double spacing) {
    RemovalResult R;

    if (!stock.valid() || !finite3(stock.lo) || !finite3(stock.hi)) {
        R.reason = "invalid stock block (lo must be < hi on every axis)";
        return R;
    }
    if (!(spacing > 0.0) || !std::isfinite(spacing)) {
        R.reason = "spacing must be finite and > 0";
        return R;
    }
    if (!(tool.radius > 0.0) || !(tool.length > 0.0)) {
        R.reason = "tool radius and length must be > 0";
        return R;
    }
    R.voxelResolution = spacing;

    // -- Build the stock SDF on a padded lattice (negative inside the block). --
    // Pad by a couple of cells so the box faces are interior to the grid and the
    // cell-center midpoint measure brackets the true volume.
    const int pad = 2;
    const Vec3 ext = vsub(stock.hi, stock.lo);
    auto nodesFor = [&](double e) -> std::size_t {
        std::size_t n = static_cast<std::size_t>(std::ceil(e / spacing)) + 1 + 2 * pad;
        if (n < 2) n = 2;
        return n;
    };
    const std::size_t nx = nodesFor(ext.x);
    const std::size_t ny = nodesFor(ext.y);
    const std::size_t nz = nodesFor(ext.z);
    const native::Vec3 origin{
        stock.lo.x - pad * spacing,
        stock.lo.y - pad * spacing,
        stock.lo.z - pad * spacing};

    VoxelGrid<float> stockGrid(nx, ny, nz, origin, spacing, 0.0f);
    // Exact box SDF (negative inside): distance to the box [lo,hi].
    const Vec3 lo = stock.lo, hi = stock.hi;
    stockGrid.fillFromField([&](double x, double y, double z) -> double {
        // signed distance to AABB: positive outside, negative inside.
        const double dx = std::max(lo.x - x, x - hi.x);
        const double dy = std::max(lo.y - y, y - hi.y);
        const double dz = std::max(lo.z - z, z - hi.z);
        const double ox = std::max(dx, 0.0);
        const double oy = std::max(dy, 0.0);
        const double oz = std::max(dz, 0.0);
        const double outside = std::sqrt(ox * ox + oy * oy + oz * oz);
        const double inside  = std::min(std::max(dx, std::max(dy, dz)), 0.0);
        return outside + inside;
    });

    R.stockVolume0 = voxel::VoxelBoolean::enclosedVolume(stockGrid, 0.0);

    // -- Build the swept-tool SDF for all CUTTING segments on the SAME lattice. --
    // We accumulate the field MINIMUM over all cutting sweeps into one tool grid
    // (the union of every swept tool), initialised to +inf (empty solid), then
    // subtract it ONCE from the stock via the existing field CSG.
    bool anyCut = false;
    VoxelGrid<float> toolGrid(nx, ny, nz, origin, spacing,
                              std::numeric_limits<float>::max());

    for (std::size_t i = 0; i + 1 < path.size(); ++i) {
        if (path[i].rapid || path[i + 1].rapid) continue;  // only feed segments cut
        const Vec3 a = path[i].p;
        const Vec3 b = path[i + 1].p;
        if (!finite3(a) || !finite3(b)) continue;
        anyCut = true;
        // Fill only the lattice nodes within the swept tool's bounding slab to
        // keep this O(path * localCells) rather than O(path * wholeGrid).
        // Conservative AABB of this swept tool: segment endpoints +- (radius)
        // laterally, and [0, length] above each tip.
        const double R0 = tool.radius;
        const double minX = std::min(a.x, b.x) - R0;
        const double maxX = std::max(a.x, b.x) + R0;
        const double minY = std::min(a.y, b.y) - R0;
        const double maxY = std::max(a.y, b.y) + R0;
        const double minZ = std::min(a.z, b.z);                 // tip is the bottom
        const double maxZ = std::max(a.z, b.z) + tool.length;   // top of flutes
        auto idxLo = [&](double w, double o) -> std::size_t {
            double g = (w - o) / spacing;
            if (g < 0.0) g = 0.0;
            return static_cast<std::size_t>(std::floor(g));
        };
        auto idxHi = [&](double w, double o, std::size_t n) -> std::size_t {
            double g = (w - o) / spacing;
            std::size_t hiI = static_cast<std::size_t>(std::ceil(g)) + 1;
            if (hiI > n) hiI = n;
            return hiI;
        };
        const std::size_t i0 = idxLo(minX, origin.x), i1 = idxHi(maxX, origin.x, nx);
        const std::size_t j0 = idxLo(minY, origin.y), j1 = idxHi(maxY, origin.y, ny);
        const std::size_t k0 = idxLo(minZ, origin.z), k1 = idxHi(maxZ, origin.z, nz);

        for (std::size_t k = k0; k < k1; ++k)
            for (std::size_t j = j0; j < j1; ++j)
                for (std::size_t ii = i0; ii < i1; ++ii) {
                    const native::Vec3 np = stockGrid.nodePosition(ii, j, k);
                    const Vec3 p{np.x, np.y, np.z};
                    const double d = toolSweptSdf(p, a, b, tool, spacing);
                    float& cell = toolGrid.at(ii, j, k);
                    if (d < double(cell)) cell = static_cast<float>(d);
                }
    }

    if (!anyCut) {
        // No cutting segments -> nothing removed (honest success).
        R.ok = true;
        R.updatedStock = std::move(stockGrid);
        R.removedVolume = 0.0;
        return R;
    }

    // -- Subtract the swept tool from the stock via the EXISTING field CSG. --
    voxel::BooleanResult diff = voxel::VoxelBoolean::subtract(stockGrid, toolGrid);
    if (!diff.ok) {
        R.reason = "field CSG subtract failed (lattice misalignment) — internal";
        return R;
    }
    const double after = voxel::VoxelBoolean::enclosedVolume(diff.grid, 0.0);

    R.ok = true;
    R.updatedStock = std::move(diff.grid);
    R.removedVolume = R.stockVolume0 - after;
    if (R.removedVolume < 0.0) R.removedVolume = 0.0;  // measure noise guard
    return R;
}

// ============================================================================
// (B) Collision detection.
// ============================================================================
CollisionResult checkCollisions(const Toolpath& path,
                                const Tool& tool,
                                const Holder& holder,
                                const std::vector<Aabb>& fixtureBoxes,
                                const MachineEnvelope& env,
                                const std::vector<double>& stockPos,
                                const std::vector<std::uint32_t>& stockIdx) {
    CollisionResult C;
    if (path.empty()) return C;

    // Build the in-process stock BVH once (only if a soup was supplied).
    geom::AABBTree stockTree;
    const bool haveStock = !stockPos.empty() && !stockIdx.empty();
    if (haveStock) {
        // If the soup is malformed the tree stays empty -> rapid-into-stock is
        // simply not flagged (honest: we do not fabricate a hit).
        stockTree.build(stockPos, stockIdx);
    }

    auto outsideEnvelope = [&](const Vec3& p) -> bool {
        return p.x < env.lo.x || p.x > env.hi.x ||
               p.y < env.lo.y || p.y > env.hi.y ||
               p.z < env.lo.z || p.z > env.hi.z;
    };

    // Walk the path. Check the envelope at the START point of the path first.
    if (outsideEnvelope(path[0].p)) {
        C.collided = true;
        C.kind = CollisionKind::Envelope;
        C.segmentIndex = 0;
        C.point = path[0].p;
        C.detail = "start point outside machine envelope";
        return C;
    }

    for (std::size_t i = 0; i + 1 < path.size(); ++i) {
        const Vec3 a = path[i].p;
        const Vec3 b = path[i + 1].p;

        // (iii) Envelope: the segment's END point (start already checked / prior end).
        if (outsideEnvelope(b)) {
            C.collided = true;
            C.kind = CollisionKind::Envelope;
            C.segmentIndex = i;
            C.point = b;
            C.detail = "path point outside machine envelope";
            return C;
        }

        // (i) Fixture: the swept TOOL flute and the swept HOLDER cylinder must
        //     not overlap any fixture box. Each is a vertical cylinder swept
        //     along the tip move (an EXACT swept-cylinder/box test, not an edge
        //     approximation): the flute spans z in [tip, tip+length] with radius
        //     tool.radius; the holder spans z in [tip+gapZ, tip+gapZ+length] with
        //     radius holder.radius. The tip z varies along the segment, so the
        //     swept cylinder's z-slab spans from the min tip z to the max tip z
        //     plus the cylinder height (a tight bound on the true swept solid).
        const double tipZlo = std::min(a.z, b.z);
        const double tipZhi = std::max(a.z, b.z);
        // Flute z-slab (bottom of flute at the tip, top `length` above).
        const double fluteLo = tipZlo;
        const double fluteHi = tipZhi + tool.length;
        // Holder z-slab.
        const double holderLo = tipZlo + holder.gapZ;
        const double holderHi = tipZhi + holder.gapZ + holder.length;

        for (std::size_t f = 0; f < fixtureBoxes.size(); ++f) {
            const Aabb& box = fixtureBoxes[f];
            if (!box.valid()) continue;
            bool hitTool =
                sweptVerticalCylinderOverlapsBox(a, b, tool.radius,
                                                 fluteLo, fluteHi, box);
            bool hitHolder =
                sweptVerticalCylinderOverlapsBox(a, b, holder.radius,
                                                 holderLo, holderHi, box);
            if (hitTool || hitHolder) {
                C.collided = true;
                C.kind = CollisionKind::Fixture;
                C.segmentIndex = i;
                C.point = a;
                C.detail = hitTool ? "tool overlaps fixture box"
                                   : "holder overlaps fixture box";
                return C;
            }
        }

        // (ii) Rapid into stock: a RAPID move whose tip segment crosses the
        //      remaining-stock surface is a non-cutting crash into material.
        //      Cutting (feed) moves into stock are normal and never flagged.
        if (path[i].rapid && haveStock && !stockTree.empty()) {
            const Vec3 dir = vsub(b, a);
            const double segLen = vlen(dir);
            if (segLen > 0.0) {
                geom::RayHit hit = stockTree.rayIntersect(a, dir, 1.0);  // t in [0,1]·dir
                if (hit.hit && hit.t > 1e-9 && hit.t <= 1.0) {
                    C.collided = true;
                    C.kind = CollisionKind::RapidIntoStock;
                    C.segmentIndex = i;
                    C.point = hit.point;
                    C.detail = "rapid move drives into remaining stock";
                    return C;
                }
            }
        }
    }

    return C;  // collided==false: the whole path is clean.
}

// ============================================================================
// (C) Probing.
// ============================================================================
ProbeResult generateProbePath(const ProbeTarget& target,
                              const Tool& tool,
                              const Holder& holder,
                              double clearance,
                              const MachineEnvelope& env,
                              const std::vector<Aabb>& fixtureBoxes) {
    ProbeResult P;
    const double nlen = vlen(target.normal);
    if (!(nlen > 0.0) || !finite3(target.normal) || !finite3(target.pointOnFace)) {
        P.reason = "target normal must be non-zero and finite";
        return P;
    }
    if (!(clearance > 0.0) || !std::isfinite(clearance)) {
        P.reason = "clearance must be finite and > 0";
        return P;
    }
    const Vec3 n = vscale(target.normal, 1.0 / nlen);   // outward unit normal

    // Nominal contact point = the supplied point ON the face. The probe touches
    // the face there (the approach travels along -n onto the face).
    const Vec3 contact = target.pointOnFace;
    P.nominalContact = contact;

    // Approach line is along +n (the probe stands off the face along +n and
    // descends along -n). Build the cycle:
    const Vec3 retractPt  = vadd(contact, vscale(n, clearance));        // fully clear
    const Vec3 approachPt = vadd(contact, vscale(n, 0.5 * clearance));  // rapid down to here
    const Vec3 touchPt    = contact;                                    // slow feed onto face

    // Cycle: start clear (rapid to retract), rapid to mid approach, FEED to
    // touch, FEED back to retract (clear). Rapids only in free space (above the
    // face); the touch + back-off are feed moves.
    P.cycle.clear();
    P.cycle.push_back(PathPoint{retractPt,  /*rapid=*/true});
    P.cycle.push_back(PathPoint{approachPt, /*rapid=*/true});
    P.cycle.push_back(PathPoint{touchPt,    /*rapid=*/false});  // slow touch
    P.cycle.push_back(PathPoint{retractPt,  /*rapid=*/false});  // feed clear

    // Re-verify the generated cycle through the SAME collision check. There is no
    // in-process stock surface to test the rapids against here (the probe touches
    // the face by design, which is the intended contact, not a crash), so the
    // stock soup is empty; fixtures + envelope are checked in full.
    const std::vector<double>       noPos;
    const std::vector<std::uint32_t> noIdx;
    CollisionResult chk = checkCollisions(P.cycle, tool, holder, fixtureBoxes,
                                          env, noPos, noIdx);
    P.collisionFree = !chk.collided;

    // If the straight-down approach collides with a fixture, back the standoff
    // off along the face normal further until clear (up to a bounded number of
    // tries), so the returned cycle is genuinely collision-free when possible.
    int tries = 0;
    double scale = 1.0;
    while (chk.collided && chk.kind == CollisionKind::Fixture && tries < 8) {
        scale *= 1.5;
        const Vec3 r2 = vadd(contact, vscale(n, clearance * scale));
        const Vec3 a2 = vadd(contact, vscale(n, 0.5 * clearance * scale));
        P.cycle[0].p = r2;
        P.cycle[1].p = a2;
        P.cycle[3].p = r2;
        chk = checkCollisions(P.cycle, tool, holder, fixtureBoxes, env, noPos, noIdx);
        P.collisionFree = !chk.collided;
        ++tries;
    }

    P.ok = true;
    return P;
}

} // namespace cam
} // namespace native
} // namespace forge
