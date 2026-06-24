// forge/native/brep/Pattern.cpp
//
// Implementation of the IN-HOUSE ANALYTIC FEATURE PATTERN (Pattern.hpp): linear /
// circular / mirror replication of a rigid tool solid, boolean-merged into ONE
// native brep::Solid. Pure C++20, reuses booleanSolid + SolidFactory unchanged.
// No OCCT, no WASM. See the header for the strategy + honest map.

#include "forge/native/brep/Pattern.hpp"

#include <cmath>
#include <map>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

// Build a row-major 3x3 rotation that takes the unit axis k by angle `ang`
// (Rodrigues). Returns the 9 entries for RigidTransform::r.
void rodrigues(const Vec3& axisRaw, double ang, double r[9]) {
    Vec3 k = vnorm(axisRaw);
    const double c = std::cos(ang), s = std::sin(ang), t = 1.0 - c;
    const double x = k.x, y = k.y, z = k.z;
    // standard axis-angle rotation matrix, row-major.
    r[0] = c + x * x * t;     r[1] = x * y * t - z * s; r[2] = x * z * t + y * s;
    r[3] = y * x * t + z * s; r[4] = c + y * y * t;     r[5] = y * z * t - x * s;
    r[6] = z * x * t - y * s; r[7] = z * y * t + x * s; r[8] = c + z * z * t;
}

// Householder reflection across the plane through `o` with unit normal `n`:
//   reflect(p) = p - 2*((p-o)·n) n  = R p + t,  R = I - 2 n n^T,  t = 2 (o·n) n.
RigidTransform mirrorTransform(const Vec3& o, const Vec3& nRaw) {
    Vec3 n = vnorm(nRaw);
    RigidTransform xf;
    xf.r[0] = 1 - 2 * n.x * n.x; xf.r[1] = -2 * n.x * n.y;    xf.r[2] = -2 * n.x * n.z;
    xf.r[3] = -2 * n.y * n.x;    xf.r[4] = 1 - 2 * n.y * n.y; xf.r[5] = -2 * n.y * n.z;
    xf.r[6] = -2 * n.z * n.x;    xf.r[7] = -2 * n.z * n.y;    xf.r[8] = 1 - 2 * n.z * n.z;
    double on = vdot(o, n);
    xf.t = vscale(n, 2.0 * on);
    xf.det = -1.0; // a reflection is improper
    return xf;
}

// Ordered ring of vertex pointers around a face's outer loop, in loop order.
std::vector<Vertex*> outerRingVerts(Face* f) {
    std::vector<Vertex*> out;
    Loop* lp = f->outerLoop;
    if (!lp) return out;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
        out.push_back(c->originVertex());
        c = c->next;
    }
    return out;
}

// Collect the unique vertices and surfaces of a solid (via its shells/faces).
void collectUnique(Solid* s, std::vector<Vertex*>& verts, std::vector<Surface*>& surfs) {
    std::map<Vertex*, bool> sv;
    std::map<Surface*, bool> ss;
    for (Shell* sh : s->shells) {
        for (Face* f : sh->faces) {
            for (Vertex* v : outerRingVerts(f)) {
                if (!sv[v]) { sv[v] = true; verts.push_back(v); }
            }
            if (f->surface && !ss[f->surface]) { ss[f->surface] = true; surfs.push_back(f->surface); }
        }
    }
}

} // namespace

// ---------------------------------------------------------------------------
// patternTransforms — enumerate the per-instance rigid transforms (instance 0 is
// always the identity = the as-built tool).
// ---------------------------------------------------------------------------
std::vector<RigidTransform> patternTransforms(const PatternSpec& spec) {
    std::vector<RigidTransform> out;
    switch (spec.kind) {
    case PatternKind::Linear: {
        int n = spec.count < 1 ? 1 : spec.count;
        for (int k = 0; k < n; ++k) {
            RigidTransform xf; // identity rotation
            xf.t = vscale(spec.step, (double)k);
            xf.det = 1.0;
            out.push_back(xf);
        }
        break;
    }
    case PatternKind::Circular: {
        int n = spec.count < 1 ? 1 : spec.count;
        for (int k = 0; k < n; ++k) {
            // Rotation about the axis line (axisOrigin, axisDir) by k*angleStep.
            // For a point p:  p' = axisOrigin + R*(p - axisOrigin) = R p + (axisOrigin - R*axisOrigin).
            RigidTransform xf;
            rodrigues(spec.axisDir, spec.angleStep * k, xf.r);
            // translation so the axisOrigin is the fixed pivot.
            Vec3 rOrigin = xf.applyDir(spec.axisOrigin); // R * axisOrigin (no t yet)
            xf.t = vsub(spec.axisOrigin, rOrigin);
            xf.det = 1.0;
            out.push_back(xf);
        }
        break;
    }
    case PatternKind::Mirror: {
        // instance 0 = identity (original), instance 1 = the reflection.
        RigidTransform id; out.push_back(id);
        out.push_back(mirrorTransform(spec.planeOrigin, spec.planeNormal));
        break;
    }
    }
    return out;
}

// ---------------------------------------------------------------------------
// transformSolidInPlace — transform vertices + surface frames. For a PROPER
// transform (det >= 0) the winding is preserved, so we only move geometry. For an
// IMPROPER (mirror) transform the half-edge winding would invert; we reverse every
// outer loop's coedge ring so the solid stays outward-oriented and 2-manifold.
// ---------------------------------------------------------------------------
void transformSolidInPlace(const RigidTransform& xf, Solid* s, TopologyBuilder& tb) {
    (void)tb;
    std::vector<Vertex*> verts;
    std::vector<Surface*> surfs;
    collectUnique(s, verts, surfs);

    for (Vertex* v : verts) {
        Vec3 p = xf.applyPoint(Vec3{v->point.x, v->point.y, v->point.z});
        v->point.x = p.x; v->point.y = p.y; v->point.z = p.z;
    }
    for (Surface* su : surfs) {
        su->origin = xf.applyPoint(su->origin);   // a point
        su->axis   = vnorm(xf.applyDir(su->axis));   // a direction (orthonormal r keeps it unit)
        su->refDir = vnorm(xf.applyDir(su->refDir)); // a direction
    }

    if (xf.det < 0.0) {
        // Reflection inverted the orientation. Reverse each outer loop so the
        // coedge winding is restored to outward (CCW as seen from outside). We
        // relink next<->prev around every loop (a pure traversal reversal — the
        // edges + their two coedges are unchanged, only the walk direction flips).
        std::map<Loop*, bool> done;
        for (Shell* sh : s->shells) {
            for (Face* f : sh->faces) {
                Loop* lp = f->outerLoop;
                if (!lp || done[lp]) continue;
                done[lp] = true;
                Coedge* c = lp->first;
                for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                    Coedge* nx = c->next;
                    std::swap(c->next, c->prev);  // reverse the walk
                    c = nx;
                }
            }
        }
        // The surface normal of a reflected frame (binormal = axis x refDir is a
        // pseudovector) also flips; toggling `reversed` keeps normalAt pointing
        // outward, consistent with the reversed winding above. (The boolean re-
        // derives outward orientation geometrically regardless, so this just makes
        // the standalone mirrored solid itself well-oriented.)
        for (Surface* su : surfs) su->reversed = !su->reversed;
    }
}

// ---------------------------------------------------------------------------
// applyPattern — the feature op.
// ---------------------------------------------------------------------------
BooleanResult applyPattern(const Solid& base,
                           const ToolBuilder& toolBuilder,
                           const PatternSpec& spec,
                           BoolOp op,
                           const PrimitiveOptions& primOpt,
                           const BooleanOptions& boolOpts) {
    BooleanResult res;

    std::vector<RigidTransform> xforms = patternTransforms(spec);
    if (xforms.empty()) { res.reason = "pattern: no instances enumerated"; return res; }

    // Keep the factories that own the tool topology alive for the lifetime of the
    // result (the boolean references their faces during the merge, and an
    // intermediate-step view may outlive this call).
    auto factories = std::make_shared<std::vector<std::shared_ptr<SolidFactory>>>();

    // STRATEGY — ONE feature = ONE boolean. Build ALL N tool instances and merge
    // them into a SINGLE COMPOUND tool solid (each instance is a separate SHELL of
    // one Solid in one factory's builder), then do a SINGLE booleanSolid(base,
    // compound, op). For NON-OVERLAPPING instances this is far more robust than
    // accumulating cuts one-at-a-time: a sequential chain degrades because the
    // first instance whose imprint defers to the mesh fallback turns the running
    // solid into a planar facet soup, which then breaks every later analytic
    // imprint. A single boolean imprints all N disjoint hole-circles onto the
    // base's faces in one pass (the planar CDT handles many disjoint constraint
    // loops), keeping the whole feature on the exact analytic path.
    //
    // booleanSolid gathers faces over ALL of B's shells and tessellates over all
    // shells, so a multi-shell compound B is a valid operand. The N disjoint
    // closed shells together are a valid (disconnected) closed 2-manifold point
    // set for the boolean's ray-cast point-in-solid classification.
    auto toolFac = std::make_shared<SolidFactory>(primOpt);
    factories->push_back(toolFac);
    Solid* compound = nullptr;             // the single multi-shell tool solid
    for (std::size_t i = 0; i < xforms.size(); ++i) {
        Solid* inst = toolBuilder(*toolFac);
        if (!inst) { res.reason = "pattern: tool builder returned null"; return res; }
        transformSolidInPlace(xforms[i], inst, toolFac->builder());
        if (i == 0) {
            compound = inst;               // first instance owns the compound Solid
        } else {
            // fold this instance's shells into the compound Solid (same builder),
            // so the compound is ONE Solid carrying N disjoint closed shells.
            for (Shell* sh : inst->shells)
                toolFac->builder().addShellToSolid(compound, sh);
        }
    }
    if (!compound) { res.reason = "pattern: no compound tool built"; return res; }

    BooleanResult step = booleanSolid(base, *compound, op, boolOpts);
    if (!step.ok) { res.ok = false; res.reason = step.reason; return res; }

    const Solid* current = step.solid;
    std::shared_ptr<TopologyBuilder> currentOwner = step.owner;
    res.usedMeshFallback = step.usedMeshFallback;

    res.ok = true;
    res.reason = (op == BoolOp::Cut) ? "ok (pattern cut)"
               : (op == BoolOp::Fuse) ? "ok (pattern fuse)"
                                      : "ok (pattern common)";
    res.solid = const_cast<Solid*>(current);

    // The owner must retain BOTH the final merged topology AND every per-instance
    // tool factory (so any view into an intermediate step stays valid for the
    // caller's lifetime). Bundle them in a Holder and hand back an ALIASING
    // shared_ptr that points at the real TopologyBuilder while keeping the Holder
    // (and thus the factories) alive: when the caller drops res.owner, both go.
    struct Holder {
        std::shared_ptr<TopologyBuilder> tb;
        std::shared_ptr<std::vector<std::shared_ptr<SolidFactory>>> facs;
    };
    auto holder = std::make_shared<Holder>(Holder{currentOwner, factories});
    res.owner = std::shared_ptr<TopologyBuilder>(holder, currentOwner.get());
    return res;
}

} // namespace brep
} // namespace native
} // namespace forge
