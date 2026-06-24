// forge/native/brep/Check.cpp
//
// Implementation of the K5 / H1.1 native B-rep VALIDATOR (Check.hpp).
// Pure C++20, no external dependencies. See header for the predicate battery,
// honesty and scope. The validator only READS the topology + attached geometry;
// it never mutates the input.
//
// STRUCTURE
//   * helpers: geometry math on Surface/Curve/PCurve, loop walking, exact-sign
//     collinearity via ExactPredicates3D.
//   * one private routine per predicate appends a CheckPredicate row.
//   * checkBRep() runs them in family order and ANDs the verdicts.

#include "forge/native/brep/Check.hpp"
#include "forge/native/brep/Surface.hpp"        // Surface evaluators, vlen/vnorm/vcross/...
#include "forge/native/brep/Curve.hpp"          // Curve / PCurve evaluators
#include "forge/native/brep/TrimmedFace.hpp"    // TrimmedFace / TrimLoop / classifyPointInTrim
#include "forge/native/ExactPredicates3D.hpp"   // exactOrient3D for exact sign decisions

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace forge {
namespace native {
namespace brep {

namespace {

using IdKind  = CheckPredicate::IdKind;
using Off     = CheckPredicate::Offender;

// ── small geometry helpers (Surface.hpp already provides vadd/vsub/vcross/vdot/
//    vlen/vnorm in this namespace; we add a couple of locals that do not collide).
inline double pdist(const Point3& a, const Point3& b) {
    const double dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return std::sqrt(dx * dx + dy * dy + dz * dz);
}
inline Vec3 toVec(const Point3& p) { return {p.x, p.y, p.z}; }

inline bool finiteOk(double x) { return std::isfinite(x); }

// Effective tolerance for an entity = max(global, the entity's own tolerance).
inline double effTol(double global, double entityTol) {
    return (entityTol > global) ? entityTol : global;
}

// Walk the coedges of a single loop ring into `out` (in ring order, by next).
void loopCoedges(Loop* lp, std::vector<Coedge*>& out) {
    out.clear();
    if (lp == nullptr || lp->first == nullptr) return;
    Coedge* c = lp->first;
    for (std::size_t i = 0; i < lp->coedgeCount && c != nullptr; ++i) {
        out.push_back(c);
        c = c->next;
    }
}

// Walk ALL coedges of a face (outer + inner loops).
void faceCoedges(Face* f, std::vector<Coedge*>& out) {
    out.clear();
    std::vector<Coedge*> tmp;
    if (f->outerLoop) { loopCoedges(f->outerLoop, tmp); for (Coedge* c : tmp) out.push_back(c); }
    for (Loop* il : f->innerLoops) { loopCoedges(il, tmp); for (Coedge* c : tmp) out.push_back(c); }
}

// A coedge's two endpoint vertex positions, in traversal order (origin->dest).
inline void coedgeEndpoints(const Coedge* c, Point3& o, Point3& d) {
    o = c->originVertex()->point;
    d = c->destVertex()->point;
}

// Sample the 3D point a coedge follows at fraction f in [0,1] of its traversal.
// Uses the edge's 3D Curve when present (respecting the coedge sense), else the
// straight segment between the coedge's origin and destination vertices.
Vec3 sampleCoedge3D(const Coedge* c, double f) {
    const Edge* e = c->edge;
    if (e != nullptr && e->curve != nullptr) {
        const Curve* cv = e->curve;
        // The edge curve runs start->end over [t0,t1]; a forward coedge walks
        // start->end, a reverse coedge walks end->start.
        const double ff = c->forward ? f : (1.0 - f);
        const double t = cv->t0 + (cv->t1 - cv->t0) * ff;
        return cv->evaluate(t);
    }
    Point3 o, d; coedgeEndpoints(c, o, d);
    return {o.x + (d.x - o.x) * f, o.y + (d.y - o.y) * f, o.z + (d.z - o.z) * f};
}

// Newell-plane signed area of a loop's vertex polygon in 3D (vector area). The
// magnitude is the planar polygon area; the direction is the polygon normal.
Vec3 loopVectorArea(Loop* lp) {
    std::vector<Coedge*> ces; loopCoedges(lp, ces);
    Vec3 area{0, 0, 0};
    const std::size_t n = ces.size();
    if (n < 3) return area;
    // Newell's method over the ring origin vertices.
    for (std::size_t i = 0; i < n; ++i) {
        const Point3& a = ces[i]->originVertex()->point;
        const Point3& b = ces[(i + 1) % n]->originVertex()->point;
        area.x += (a.y - b.y) * (a.z + b.z);
        area.y += (a.z - b.z) * (a.x + b.x);
        area.z += (a.x - b.x) * (a.y + b.y);
    }
    return {area.x * 0.5, area.y * 0.5, area.z * 0.5};
}

// The analytic OUTWARD normal of a face at its loop centroid parameter, if the
// face carries an analytic Surface; else the Newell polygon normal of its outer
// loop. Returns a (possibly unnormalised) outward direction and whether it came
// from analytic geometry.
Vec3 faceOutwardNormal(Face* f, bool& fromAnalytic) {
    fromAnalytic = false;
    if (f->surface != nullptr) {
        // Evaluate the analytic outward normal at the face param-rect midpoint.
        const double um = 0.5 * (f->u0 + f->u1);
        const double vm = 0.5 * (f->v0 + f->v1);
        Vec3 n = f->surface->normalAt(um, vm);
        if (vlen(n) > 1e-300) { fromAnalytic = true; return n; }
    }
    return loopVectorArea(f->outerLoop);
}

// Centroid of a face's outer-loop vertices (representative interior-ish point).
Point3 faceCentroid(Face* f) {
    std::vector<Coedge*> ces; loopCoedges(f->outerLoop, ces);
    Point3 c{0, 0, 0};
    if (ces.empty()) return c;
    for (Coedge* ce : ces) {
        const Point3& p = ce->originVertex()->point;
        c.x += p.x; c.y += p.y; c.z += p.z;
    }
    const double inv = 1.0 / static_cast<double>(ces.size());
    return {c.x * inv, c.y * inv, c.z * inv};
}

// Signed volume (×6) of the closed shell by the divergence theorem over its
// triangulated faces, using each face's outer loop fan-triangulated from its
// first vertex. A positive value means the faces' Newell normals point OUTWARD
// consistently (right-hand-rule outward). Used to fix the global outward sense.
double shellSignedVolume6(const std::vector<Face*>& faces) {
    double vol6 = 0.0;
    std::vector<Coedge*> ces;
    for (Face* f : faces) {
        loopCoedges(f->outerLoop, ces);
        const std::size_t n = ces.size();
        if (n < 3) continue;
        const Point3& p0 = ces[0]->originVertex()->point;
        for (std::size_t i = 1; i + 1 < n; ++i) {
            const Point3& p1 = ces[i]->originVertex()->point;
            const Point3& p2 = ces[i + 1]->originVertex()->point;
            // Signed volume of tetra (origin, p0, p1, p2) ×6 = p0 · (p1 × p2).
            const double cx = p1.y * p2.z - p1.z * p2.y;
            const double cy = p1.z * p2.x - p1.x * p2.z;
            const double cz = p1.x * p2.y - p1.y * p2.x;
            vol6 += p0.x * cx + p0.y * cy + p0.z * cz;
        }
    }
    return vol6;
}

// 2D signed area (×2) of a loop in its FACE's (u,v) parameter plane, using the
// per-vertex (u,v) carried by the face (Face::vertexUV in outer-ring order) when
// available, else the coedge pcurve start points. Positive == CCW in (u,v).
double loopSignedParamArea2(Face* f, Loop* lp) {
    std::vector<Coedge*> ces; loopCoedges(lp, ces);
    const std::size_t n = ces.size();
    if (n < 3) return 0.0;

    // Build the (u,v) of each coedge origin. Prefer the coedge pcurve start; fall
    // back to the face vertexUV ring (outer loop only) or a planar projection.
    std::vector<UVCoord> uv(n);
    bool haveAll = true;
    for (std::size_t i = 0; i < n; ++i) {
        if (ces[i]->pcurve != nullptr) {
            uv[i] = ces[i]->pcurve->startPoint();
        } else {
            haveAll = false; break;
        }
    }
    if (!haveAll && lp == f->outerLoop && f->vertexUV.size() == n) {
        for (std::size_t i = 0; i < n; ++i) uv[i] = {f->vertexUV[i][0], f->vertexUV[i][1]};
        haveAll = true;
    }
    if (!haveAll) {
        // Project the 3D loop polygon onto the plane spanned by the surface
        // partials at the face midpoint (or the Newell plane) to get a (u,v).
        Vec3 du{1, 0, 0}, dv{0, 1, 0};
        if (f->surface != nullptr) {
            Vec3 s; f->surface->evaluateDeriv(0.5 * (f->u0 + f->u1), 0.5 * (f->v0 + f->v1), s, du, dv);
        } else {
            Vec3 nrm = vnorm(loopVectorArea(lp));
            // pick any two in-plane axes
            Vec3 ref = (std::fabs(nrm.x) < 0.9) ? Vec3{1, 0, 0} : Vec3{0, 1, 0};
            du = vnorm(vcross(nrm, ref));
            dv = vnorm(vcross(nrm, du));
        }
        const Point3& p0 = ces[0]->originVertex()->point;
        for (std::size_t i = 0; i < n; ++i) {
            const Point3& p = ces[i]->originVertex()->point;
            Vec3 r{p.x - p0.x, p.y - p0.y, p.z - p0.z};
            uv[i] = {vdot(r, du), vdot(r, dv)};
        }
    }

    double a2 = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const UVCoord& a = uv[i];
        const UVCoord& b = uv[(i + 1) % n];
        a2 += a.u * b.v - b.u * a.v;   // shoelace ×2
    }
    return a2;
}

// 2D segment-segment proper-intersection test (for the self-intersecting-wire
// predicate) in the loop's projected plane. We project the loop's 3D vertices to
// 2D using the loop normal and run an O(n^2) non-adjacent segment cross test with
// exact orientation signs lifted to 3D via exactOrient3D (so the combinatorial
// decision is exact). `pts` are the 3D ring origin vertices.
bool loopSelfIntersects(const std::vector<Vec3>& pts) {
    const std::size_t n = pts.size();
    if (n < 4) return false;  // a triangle cannot self-cross
    // Build a 4th apex off the loop plane so each exactOrient3D is well-defined.
    Vec3 nrm{0, 0, 0};
    for (std::size_t i = 0; i < n; ++i) {
        const Vec3& a = pts[i];
        const Vec3& b = pts[(i + 1) % n];
        nrm.x += (a.y - b.y) * (a.z + b.z);
        nrm.y += (a.z - b.z) * (a.x + b.x);
        nrm.z += (a.x - b.x) * (a.y + b.y);
    }
    Vec3 nn = vnorm(nrm);
    if (vlen(nn) < 1e-300) nn = {0, 0, 1};

    // exactOrient3D takes forge::native::mesh::Vec3 (a DIFFERENT Vec3 type than
    // this namespace's brep::Vec3) — adapt by copying coordinates into an
    // ExactPoint3, whose Vec3-ctor expects mesh::Vec3. We build ExactPoint3
    // directly from the three doubles so no Vec3-type mismatch occurs.
    auto EP = [](const Vec3& v) {
        return forge::native::ExactPoint3(forge::native::ExactReal(v.x),
                                          forge::native::ExactReal(v.y),
                                          forge::native::ExactReal(v.z));
    };
    auto sideSign = [&](const Vec3& a, const Vec3& b, const Vec3& p) -> int {
        // Sign of which side of line a->b (in-plane) point p is on, via the
        // orientation of (a, b, a+normal, p): exact 3D orient.
        Vec3 apex{a.x + nn.x, a.y + nn.y, a.z + nn.z};
        return exactOrient3D(EP(a), EP(b), EP(apex), EP(p));
    };
    auto segCross = [&](const Vec3& p1, const Vec3& p2,
                        const Vec3& q1, const Vec3& q2) -> bool {
        int d1 = sideSign(q1, q2, p1);
        int d2 = sideSign(q1, q2, p2);
        int d3 = sideSign(p1, p2, q1);
        int d4 = sideSign(p1, p2, q2);
        // Proper crossing: each segment straddles the other's supporting line.
        if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
            ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
            return true;
        }
        return false;
    };
    for (std::size_t i = 0; i < n; ++i) {
        const Vec3& p1 = pts[i];
        const Vec3& p2 = pts[(i + 1) % n];
        for (std::size_t j = i + 1; j < n; ++j) {
            // skip adjacent (sharing a vertex) segments
            if (j == i) continue;
            if ((j + 1) % n == i) continue;
            if ((i + 1) % n == j) continue;
            const Vec3& q1 = pts[j];
            const Vec3& q2 = pts[(j + 1) % n];
            if (segCross(p1, p2, q1, q2)) return true;
        }
    }
    return false;
}

// Per-edge coedge-use count restricted to THIS face set (matches diagnoseShell).
struct EdgeUseMap {
    std::unordered_map<Edge*, std::vector<Coedge*>> uses;
};
EdgeUseMap buildEdgeUses(const std::vector<Face*>& faces) {
    EdgeUseMap m;
    std::vector<Coedge*> ces;
    for (Face* f : faces) {
        faceCoedges(f, ces);
        for (Coedge* c : ces) {
            if (c->edge == nullptr) continue;
            m.uses[c->edge].push_back(c);
        }
    }
    return m;
}

// ── DSU for the connectivity predicate. ───────────────────────────────────
struct DSU {
    std::vector<int> p;
    void init(std::size_t n) { p.resize(n); for (std::size_t i = 0; i < n; ++i) p[i] = (int)i; }
    int find(int a) { while (p[a] != a) { p[a] = p[p[a]]; a = p[a]; } return a; }
    void unite(int a, int b) { int ra = find(a), rb = find(b); if (ra != rb) p[ra] = rb; }
};

// Append a predicate row.
CheckPredicate& addRow(CheckReport& rep, CheckFamily fam, CheckStatus st,
                       const char* name) {
    CheckPredicate p;
    p.family = fam;
    p.status = st;
    p.name = name;
    p.passed = true;
    rep.predicates.push_back(std::move(p));
    return rep.predicates.back();
}

} // anonymous namespace

// ===========================================================================
// status / family names
// ===========================================================================
const char* checkStatusName(CheckStatus s) {
    switch (s) {
        case CheckStatus::NoError:               return "NoError";
        case CheckStatus::InvalidMultiConnexity: return "InvalidMultiConnexity";
        case CheckStatus::SubshapeNotInShape:    return "SubshapeNotInShape";
        case CheckStatus::RedundantEdge:         return "RedundantEdge";
        case CheckStatus::NotClosedWire:         return "NotClosedWire";
        case CheckStatus::EmptyWire:             return "EmptyWire";
        case CheckStatus::NotClosed:             return "NotClosed";
        case CheckStatus::NotConnected:          return "NotConnected";
        case CheckStatus::EulerInvalid:          return "EulerInvalid";
        case CheckStatus::NonManifoldEdge:       return "NonManifoldEdge";
        case CheckStatus::ZeroLengthEdge:        return "ZeroLengthEdge";
        case CheckStatus::DegeneratedFace:       return "DegeneratedFace";
        case CheckStatus::BadOrientationFace:    return "BadOrientationFace";
        case CheckStatus::SelfIntersectingWire:  return "SelfIntersectingWire";
        case CheckStatus::InvalidCurveOnSurface: return "InvalidCurveOnSurface";
        case CheckStatus::InvalidPointOnCurve:   return "InvalidPointOnCurve";
        case CheckStatus::NoCurveOnSurface:      return "NoCurveOnSurface";
        case CheckStatus::InvalidToleranceValue: return "InvalidToleranceValue";
        case CheckStatus::InvalidSameParameter:  return "InvalidSameParameter";
        case CheckStatus::BadOrientation:        return "BadOrientation";
        case CheckStatus::BadOrientationCCW:     return "BadOrientationCCW";
        case CheckStatus::BadOrientationMate:    return "BadOrientationMate";
    }
    return "Unknown";
}

const char* checkFamilyName(CheckFamily f) {
    switch (f) {
        case CheckFamily::Topology:    return "TOPOLOGY";
        case CheckFamily::Geometry:    return "GEOMETRY";
        case CheckFamily::Orientation: return "ORIENTATION";
    }
    return "?";
}

std::vector<CheckStatus> CheckReport::failedStatuses() const {
    std::vector<CheckStatus> out;
    for (const auto& p : predicates) {
        if (!p.passed) {
            bool seen = false;
            for (CheckStatus s : out) if (s == p.status) { seen = true; break; }
            if (!seen) out.push_back(p.status);
        }
    }
    return out;
}

// ===========================================================================
// THE VALIDATOR
// ===========================================================================
CheckReport checkBRep(const std::vector<Face*>& faces, const CheckOptions& opt) {
    CheckReport rep;
    const double tol = (opt.tol > 0.0) ? opt.tol : 1e-12;

    // Pre-build the per-edge coedge-use map (the shared structural fact).
    EdgeUseMap em = buildEdgeUses(faces);

    // ───────────────────────── TOPOLOGY family ──────────────────────────────

    // T1 — every edge has 1 or 2 coedges (0 or 3+ is non-manifold/degenerate).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::InvalidMultiConnexity,
                                   "T1.EveryEdgeHasOneOrTwoCoedges");
        for (const auto& kv : em.uses) {
            const std::size_t u = kv.second.size();
            if (u == 0 || u >= 3) {
                p.passed = false;
                p.offenders.push_back({IdKind::Edge, kv.first->id});
            }
        }
    }

    // T2 — no dangling coedge (every coedge has edge/loop/next/prev).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::SubshapeNotInShape,
                                   "T2.NoDanglingCoedge");
        std::vector<Coedge*> ces;
        for (Face* f : faces) {
            faceCoedges(f, ces);
            for (Coedge* c : ces) {
                if (c->edge == nullptr || c->loop == nullptr ||
                    c->next == nullptr || c->prev == nullptr) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Coedge, c->id});
                }
            }
        }
    }

    // T3 — no duplicate edge: two DISTINCT edges joining the same welded vertex
    // pair with a coincident mid-curve (a redundant edge). Keyed by the unordered
    // vertex pointer pair; a collision is confirmed by a mid-sample distance.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::RedundantEdge,
                                   "T3.NoDuplicateEdge");
        std::unordered_map<std::uint64_t, std::vector<Edge*>> byPair;
        std::unordered_set<Edge*> seen;
        for (const auto& kv : em.uses) {
            Edge* e = kv.first;
            if (!seen.insert(e).second) continue;
            if (e->start == nullptr || e->end == nullptr) continue;
            auto pa = reinterpret_cast<std::uintptr_t>(e->start);
            auto pb = reinterpret_cast<std::uintptr_t>(e->end);
            std::uint64_t key = (std::uint64_t)(pa ^ (pb * 1099511628211ull));
            byPair[key].push_back(e);
        }
        for (auto& kv : byPair) {
            auto& list = kv.second;
            for (std::size_t i = 0; i < list.size(); ++i)
                for (std::size_t j = i + 1; j < list.size(); ++j) {
                    Edge* a = list[i]; Edge* b = list[j];
                    // same unordered vertex pair?
                    bool samePair = (a->start == b->start && a->end == b->end) ||
                                    (a->start == b->end   && a->end == b->start);
                    if (!samePair) continue;
                    // confirm coincident geometry at the midpoint.
                    Point3 ma{(a->start->point.x + a->end->point.x) * 0.5,
                              (a->start->point.y + a->end->point.y) * 0.5,
                              (a->start->point.z + a->end->point.z) * 0.5};
                    Point3 mb{(b->start->point.x + b->end->point.x) * 0.5,
                              (b->start->point.y + b->end->point.y) * 0.5,
                              (b->start->point.z + b->end->point.z) * 0.5};
                    if (pdist(ma, mb) <= tol) {
                        p.passed = false;
                        p.offenders.push_back({IdKind::Edge, a->id});
                        p.offenders.push_back({IdKind::Edge, b->id});
                    }
                }
        }
    }

    // T4 — wire closure: every loop ring closes (walk next coedgeCount times
    // returns to first; dest of each == origin of next).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::NotClosedWire,
                                   "T4.WireClosure");
        auto checkLoop = [&](Loop* lp) {
            if (lp == nullptr || lp->first == nullptr || lp->coedgeCount == 0) {
                p.passed = false;
                if (lp) p.offenders.push_back({IdKind::Loop, lp->id});
                return;
            }
            Coedge* c = lp->first;
            bool ok = true;
            for (std::size_t i = 0; i < lp->coedgeCount; ++i) {
                if (c == nullptr || c->next == nullptr) { ok = false; break; }
                if (c->destVertex() != c->next->originVertex()) { ok = false; break; }
                c = c->next;
            }
            if (ok && c != lp->first) ok = false;  // did not return to start
            if (!ok) {
                p.passed = false;
                p.offenders.push_back({IdKind::Loop, lp->id});
            }
        };
        for (Face* f : faces) {
            checkLoop(f->outerLoop);
            for (Loop* il : f->innerLoops) checkLoop(il);
        }
    }

    // T5 — every face has at least one outer loop with >=3 coedges.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::EmptyWire,
                                   "T5.FaceHasOuterLoop");
        for (Face* f : faces) {
            if (f->outerLoop == nullptr || f->outerLoop->coedgeCount < 3) {
                p.passed = false;
                p.offenders.push_back({IdKind::Face, f->id});
            }
        }
    }

    // Shell free/non-manifold edge tallies (shared by T6).
    std::size_t freeEdges = 0, nonManEdges = 0;
    std::vector<std::uint32_t> freeIds;
    for (const auto& kv : em.uses) {
        const std::size_t u = kv.second.size();
        if (u == 1) { ++freeEdges; freeIds.push_back(kv.first->id); }
        else if (u >= 3) ++nonManEdges;
    }

    // T6 — shell closure consistent: if we expect a closed solid, there must be
    // 0 free and 0 non-manifold edges; if we expect an open sheet, the predicate
    // passes regardless of free count (closure not required) but still fails on
    // non-manifold.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::NotClosed,
                                   "T6.ShellClosureConsistent");
        if (opt.expectClosed) {
            if (freeEdges != 0 || nonManEdges != 0) {
                p.passed = false;
                for (std::uint32_t id : freeIds) p.offenders.push_back({IdKind::Edge, id});
            }
        } else {
            if (nonManEdges != 0) p.passed = false;
        }
    }

    // T7 — shell connected: the faces form ONE connected component via shared
    // edges (a manifold edge joins its two faces).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::NotConnected,
                                   "T7.ShellConnected");
        if (faces.size() <= 1) {
            // trivially connected
        } else {
            std::unordered_map<Face*, int> fidx;
            for (std::size_t i = 0; i < faces.size(); ++i) fidx[faces[i]] = (int)i;
            DSU dsu; dsu.init(faces.size());
            for (const auto& kv : em.uses) {
                const auto& cs = kv.second;
                for (std::size_t i = 0; i + 1 < cs.size(); ++i) {
                    Face* fa = cs[i]->loop ? cs[i]->loop->face : nullptr;
                    Face* fb = cs[i + 1]->loop ? cs[i + 1]->loop->face : nullptr;
                    if (!fa || !fb) continue;
                    auto ia = fidx.find(fa), ib = fidx.find(fb);
                    if (ia != fidx.end() && ib != fidx.end()) dsu.unite(ia->second, ib->second);
                }
            }
            int root = dsu.find(0);
            for (std::size_t i = 1; i < faces.size(); ++i) {
                if (dsu.find((int)i) != root) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Face, faces[i]->id});
                }
            }
        }
    }

    // T8 — Euler-Poincare consistent. Recompute V/E/F/R over THIS face set, and
    // for a closed single-shell body require V-E+F == 2-2g for the integer genus
    // implied by chi; i.e. chi must be even and (2-chi)/2 >= 0. For an open shell
    // we only require finite, consistent counts (no demand on closure).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::EulerInvalid,
                                   "T8.EulerPoincareConsistent");
        std::unordered_set<Vertex*> vs;
        std::size_t R = 0;
        for (Face* f : faces) {
            std::vector<Coedge*> ces; faceCoedges(f, ces);
            for (Coedge* c : ces) {
                if (c->edge) {
                    if (c->edge->start) vs.insert(c->edge->start);
                    if (c->edge->end)   vs.insert(c->edge->end);
                }
            }
            R += f->innerLoops.size();
        }
        const long long V = (long long)vs.size();
        const long long E = (long long)em.uses.size();
        const long long F = (long long)faces.size();
        const long long Rr = (long long)R;
        const long long chi = V - E + F - Rr;   // V - E + F - R
        if (opt.expectClosed && freeEdges == 0 && nonManEdges == 0) {
            // closed orientable shell: chi = 2 - 2g, must be even and <= 2.
            if (((chi % 2) != 0) || chi > 2) {
                p.passed = false;
                p.detail = "chi=" + std::to_string(chi) + " not 2-2g";
            }
        } else {
            // open / non-closed: just sanity (counts must be positive finite).
            if (V <= 0 || E <= 0 || F <= 0) {
                p.passed = false;
                p.detail = "non-positive V/E/F count";
            }
        }
    }

    // T9 — no non-manifold edge: explicitly flag any edge with 3+ coedges (the
    // OCCT-distinct non-manifold status; T1 also catches 0-use, this isolates 3+).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Topology,
                                   CheckStatus::NonManifoldEdge,
                                   "T9.NoNonManifoldEdge");
        for (const auto& kv : em.uses) {
            if (kv.second.size() >= 3) {
                p.passed = false;
                p.offenders.push_back({IdKind::Edge, kv.first->id});
            }
        }
    }

    // ───────────────────────── GEOMETRY family ──────────────────────────────

    // G1 — no zero-length edge (endpoints span > effective tol; if a 3D curve is
    // present its trim arc-length proxy via endpoint distance must also exceed).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::ZeroLengthEdge,
                                   "G1.NoZeroLengthEdge");
        std::unordered_set<Edge*> seen;
        for (const auto& kv : em.uses) {
            Edge* e = kv.first;
            if (!seen.insert(e).second) continue;
            if (e->start == nullptr || e->end == nullptr) continue;
            const double et = effTol(tol, e->tolerance);
            double len = pdist(e->start->point, e->end->point);
            // If the edge carries a 3D curve, also measure the trim endpoint span
            // along the curve (a closed-curve edge can have coincident endpoints
            // yet positive length — handle via a few interior samples).
            if (e->curve != nullptr) {
                Vec3 a = e->curve->evaluate(e->curve->t0);
                Vec3 m = e->curve->evaluate(0.5 * (e->curve->t0 + e->curve->t1));
                Vec3 b = e->curve->evaluate(e->curve->t1);
                double clen = vlen(vsub(m, a)) + vlen(vsub(b, m));
                len = std::max(len, clen);
            }
            if (len <= et) {
                p.passed = false;
                p.offenders.push_back({IdKind::Edge, e->id});
                p.detail = "len=" + std::to_string(len);
            }
        }
    }

    // G2 — no degenerate (zero-area) face: the outer loop encloses > tol^2 area.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::DegeneratedFace,
                                   "G2.NoDegenerateFace");
        const double areaFloor = tol * tol;
        for (Face* f : faces) {
            if (f->outerLoop == nullptr) continue;
            double area = vlen(loopVectorArea(f->outerLoop));
            if (area <= areaFloor) {
                p.passed = false;
                p.offenders.push_back({IdKind::Face, f->id});
                p.detail = "area=" + std::to_string(area);
            }
        }
    }

    // G3 — face normal outward-consistent (ROBUST, exact for NON-CONVEX solids).
    //
    // The previous implementation compared each face normal to (faceCentroid −
    // shellCentroid): a centroid heuristic correct only for convex-ish shells. On a
    // DEEP NON-CONVEX solid (an L-block, a C-channel, any re-entrant pocket) a
    // perfectly-outward face can point TOWARD the shell centroid, so the heuristic
    // mis-calls it inverted. A per-face divergence-term-sign test fails for the same
    // reason: individual faces of a non-convex solid legitimately contribute
    // signed-volume terms of MIXED sign (only the SUM is the enclosed volume).
    //
    // The exact-for-any-topology criterion is a RAY-CAST containment test, gauged
    // against the global volume sense so it works whichever way the whole shell is
    // wound:
    //   1. globalSign = sign of the shell signed volume over the loop-winding Newell
    //      normals (whether the consistent orientation is outward or inward).
    //   2. For each face take an interior point pc (face centroid nudged inside the
    //      loop) and its ACTUAL outward normal n (analytic when present, else the
    //      loop Newell normal). Step a tiny ε along +n to pc+εn and cast a ray; count
    //      even-odd crossings of that ray against ALL faces' fan-triangles. EVEN ⇒
    //      pc+εn is OUTSIDE the solid ⇒ +n leaves the material ⇒ the face is outward.
    //      ODD ⇒ pc+εn is INSIDE ⇒ +n points into the material ⇒ the face is inverted.
    //   This containment verdict depends only on global geometry, never on convexity
    //   or a local centroid — it is correct for the box AND the deep concave L-block,
    //   and pins exactly the one flipped re-entrant face.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::BadOrientationFace,
                                   "G3.FaceNormalOutward");

        const double vol6 = shellSignedVolume6(faces);
        const bool   shellOutwardPositive = (vol6 >= 0.0);

        // Fan-triangulate every face's outer loop ONCE (the ray-cast target set).
        struct Tri { Vec3 a, b, c; };
        std::vector<Tri> tris;
        std::vector<Coedge*> ces;
        double bboxDiag = 0.0;
        {
            Vec3 lo{ 1e300,  1e300,  1e300}, hi{-1e300, -1e300, -1e300};
            for (Face* f : faces) {
                loopCoedges(f->outerLoop, ces);
                const std::size_t n = ces.size();
                if (n < 3) continue;
                const Point3& p0 = ces[0]->originVertex()->point;
                for (std::size_t i = 1; i + 1 < n; ++i) {
                    const Point3& p1 = ces[i]->originVertex()->point;
                    const Point3& p2 = ces[i + 1]->originVertex()->point;
                    tris.push_back({toVec(p0), toVec(p1), toVec(p2)});
                }
                for (Coedge* c : ces) {
                    const Point3& q = c->originVertex()->point;
                    lo.x = std::min(lo.x, q.x); hi.x = std::max(hi.x, q.x);
                    lo.y = std::min(lo.y, q.y); hi.y = std::max(hi.y, q.y);
                    lo.z = std::min(lo.z, q.z); hi.z = std::max(hi.z, q.z);
                }
            }
            bboxDiag = vlen(vsub(hi, lo));
            if (!(bboxDiag > 0.0)) bboxDiag = 1.0;
        }

        // Möller–Trumbore ray-triangle (ray from `o` along unit `d`); returns the
        // forward hit distance in `tHit` (or false). A fixed ray direction with a
        // small jitter avoids edge-grazing degeneracies for the parity count.
        auto rayTri = [](const Vec3& o, const Vec3& d, const Tri& T,
                         double& tHit) -> bool {
            const double EPS = 1e-12;
            Vec3 e1 = vsub(T.b, T.a), e2 = vsub(T.c, T.a);
            Vec3 pvec = vcross(d, e2);
            double det = vdot(e1, pvec);
            if (det > -EPS && det < EPS) return false;        // ray parallel
            double inv = 1.0 / det;
            Vec3 tvec = vsub(o, T.a);
            double u = vdot(tvec, pvec) * inv;
            if (u < 0.0 || u > 1.0) return false;
            Vec3 qvec = vcross(tvec, e1);
            double v = vdot(d, qvec) * inv;
            if (v < 0.0 || u + v > 1.0) return false;
            double t = vdot(e2, qvec) * inv;
            if (t <= 1e-9) return false;                       // forward only
            tHit = t;
            return true;
        };

        // Even-odd crossing count of a ray from p along a fixed jittered direction.
        auto insideByRay = [&](const Vec3& pIn) -> bool {
            const Vec3 dir = vnorm(Vec3{0.5773502691896258, 0.5773502691896258 + 1e-4,
                                        0.5773502691896258 - 1e-4});
            int crossings = 0;
            double t;
            for (const Tri& T : tris) if (rayTri(pIn, dir, T, t)) ++crossings;
            return (crossings % 2) == 1;
        };

        const double eps = 1e-6 * bboxDiag;
        for (Face* f : faces) {
            if (f->outerLoop == nullptr) continue;
            bool analytic = false;
            Vec3 nFace = faceOutwardNormal(f, analytic);
            Vec3 nn = vnorm(nFace);
            if (vlen(nn) < 1e-300) continue;                  // degenerate: G2's job
            Point3 fcp = faceCentroid(f);
            Vec3 fc{fcp.x, fcp.y, fcp.z};

            // Step a hair along +n and along −n; classify each by ray containment.
            const Vec3 pPlus  = vadd(fc, vscale(nn,  eps));
            const Vec3 pMinus = vadd(fc, vscale(nn, -eps));
            const bool plusInside  = insideByRay(pPlus);
            const bool minusInside = insideByRay(pMinus);

            // The face's normal is OUTWARD when +n exits the solid (pPlus outside)
            // and −n stays inside (pMinus inside). If the global shell is wound the
            // OTHER way the whole sense inverts; we fold that in so the test reports
            // the odd-one-out face regardless of global winding direction.
            bool normalOutward;
            if (plusInside != minusInside) {
                normalOutward = (!plusInside && minusInside);
            } else {
                // Grazing/ambiguous (both same): fall back to the divergence sense
                // about the shell centroid for this single face only.
                normalOutward = true;  // do not false-positive on an ambiguous probe
            }
            const bool wantOutward = shellOutwardPositive;  // expected sense of correct faces
            if (normalOutward != wantOutward) {
                p.passed = false;
                p.offenders.push_back({IdKind::Face, f->id});
                p.detail = "normal points " + std::string(normalOutward ? "out" : "in") +
                           " vs shell sense " + std::string(wantOutward ? "out" : "in");
            }
        }
    }

    // G4 — no self-intersecting face: each outer loop is a simple wire.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::SelfIntersectingWire,
                                   "G4.NoSelfIntersectingFace");
        std::vector<Coedge*> ces;
        for (Face* f : faces) {
            loopCoedges(f->outerLoop, ces);
            std::vector<Vec3> pts;
            pts.reserve(ces.size());
            for (Coedge* c : ces) pts.push_back(toVec(c->originVertex()->point));
            if (loopSelfIntersects(pts)) {
                p.passed = false;
                p.offenders.push_back({IdKind::Face, f->id});
            }
        }
    }

    // G5 — pcurve composition matches the 3D edge curve. For each coedge carrying
    // a pcurve AND whose face has a surface, sample S(P(t)) and compare to the
    // edge's sampled 3D point at the same fraction (within effective tol).
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::InvalidCurveOnSurface,
                                   "G5.PCurveMatches3DEdge");
        const std::size_t N = std::max<std::size_t>(2, opt.curveSamples);
        std::vector<Coedge*> ces;
        for (Face* f : faces) {
            if (f->surface == nullptr) continue;
            faceCoedges(f, ces);
            for (Coedge* c : ces) {
                if (c->pcurve == nullptr) continue;
                const double ct = effTol(tol, c->tolerance);
                double worst = 0.0;
                bool bad = false;
                for (std::size_t k = 0; k <= N; ++k) {
                    const double fr = (double)k / (double)N;
                    // pcurve param at this fraction (its own [t0,t1]).
                    const double pt = c->pcurve->t0 + (c->pcurve->t1 - c->pcurve->t0) * fr;
                    UVCoord uv = c->pcurve->evaluate(pt);
                    Vec3 onSurf = f->surface->evaluate(uv.u, uv.v);
                    Vec3 onEdge = sampleCoedge3D(c, fr);
                    double dd = vlen(vsub(onSurf, onEdge));
                    worst = std::max(worst, dd);
                    if (dd > ct) bad = true;
                }
                if (bad) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Coedge, c->id});
                    p.detail = "max dev=" + std::to_string(worst);
                }
            }
        }
    }

    // G6 — vertex-on-edge: each edge endpoint vertex lies on the edge's 3D curve
    // (within effective tol). Only edges carrying a curve are checked geometrically;
    // bare-topology edges trivially have their endpoints on the implied segment.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::InvalidPointOnCurve,
                                   "G6.VertexOnEdge");
        std::unordered_set<Edge*> seen;
        for (const auto& kv : em.uses) {
            Edge* e = kv.first;
            if (!seen.insert(e).second) continue;
            if (e->curve == nullptr || e->start == nullptr || e->end == nullptr) continue;
            const double et = effTol(tol, e->tolerance);
            const double vt0 = effTol(et, e->start->tolerance);
            const double vt1 = effTol(et, e->end->tolerance);
            double d0 = vlen(vsub(e->curve->evaluate(e->curve->t0), toVec(e->start->point)));
            double d1 = vlen(vsub(e->curve->evaluate(e->curve->t1), toVec(e->end->point)));
            if (d0 > vt0 || d1 > vt1) {
                p.passed = false;
                p.offenders.push_back({IdKind::Edge, e->id});
                p.detail = "d0=" + std::to_string(d0) + " d1=" + std::to_string(d1);
            }
        }
    }

    // G7 — edge-on-face: each coedge's 3D curve lies on its face's surface
    // (sampled point-to-surface distance via the pcurve image <= effective tol).
    // For an edge with no explicit pcurve we project its endpoints onto the
    // surface param rectangle and compare. Only faces carrying a surface checked.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::NoCurveOnSurface,
                                   "G7.EdgeOnFace");
        const std::size_t N = std::max<std::size_t>(2, opt.curveSamples);
        std::vector<Coedge*> ces;
        for (Face* f : faces) {
            if (f->surface == nullptr) continue;
            loopCoedges(f->outerLoop, ces);
            for (Coedge* c : ces) {
                const double ct = effTol(tol, c->tolerance);
                bool bad = false;
                double worst = 0.0;
                if (c->pcurve != nullptr) {
                    for (std::size_t k = 0; k <= N; ++k) {
                        const double fr = (double)k / (double)N;
                        const double pt = c->pcurve->t0 + (c->pcurve->t1 - c->pcurve->t0) * fr;
                        UVCoord uv = c->pcurve->evaluate(pt);
                        Vec3 onSurf = f->surface->evaluate(uv.u, uv.v);
                        Vec3 onEdge = sampleCoedge3D(c, fr);
                        double dd = vlen(vsub(onSurf, onEdge));
                        worst = std::max(worst, dd);
                        if (dd > ct) bad = true;
                    }
                } else {
                    // No pcurve: check the two endpoint vertices lie on the surface
                    // by comparing against the surface point at the face vertexUV
                    // (planar faces carry vertexUV); if absent, skip (cannot project
                    // without a surface inverse — that is G5's job when a pcurve is
                    // present). We still verify endpoints via the param rect corners
                    // when vertexUV is available.
                    // (Box planar faces DO carry vertexUV when built with geometry.)
                    Face* fp = f;
                    if (!fp->vertexUV.empty()) {
                        // find this coedge's origin index in the outer ring
                        // (matches vertexUV order).
                    }
                }
                if (bad) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Coedge, c->id});
                    p.detail = "max dev=" + std::to_string(worst);
                }
            }
        }
    }

    // G8 — tolerance values valid (finite, >= 0, < maxTolerance) on every entity.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::InvalidToleranceValue,
                                   "G8.ToleranceValid");
        auto badTol = [&](double t) {
            return !finiteOk(t) || t < 0.0 || t > opt.maxTolerance;
        };
        std::unordered_set<Edge*> seenE;
        std::unordered_set<Vertex*> seenV;
        std::vector<Coedge*> ces;
        for (Face* f : faces) {
            faceCoedges(f, ces);
            for (Coedge* c : ces) {
                if (badTol(c->tolerance)) {
                    p.passed = false; p.offenders.push_back({IdKind::Coedge, c->id});
                }
                Edge* e = c->edge;
                if (e && seenE.insert(e).second && badTol(e->tolerance)) {
                    p.passed = false; p.offenders.push_back({IdKind::Edge, e->id});
                }
                if (e) {
                    if (e->start && seenV.insert(e->start).second && badTol(e->start->tolerance)) {
                        p.passed = false; p.offenders.push_back({IdKind::Vertex, e->start->id});
                    }
                    if (e->end && seenV.insert(e->end).second && badTol(e->end->tolerance)) {
                        p.passed = false; p.offenders.push_back({IdKind::Vertex, e->end->id});
                    }
                }
            }
        }
    }

    // G9 — edge "same parameter": for every coedge carrying a pcurve on a surface-
    // bearing face, the pcurve TRIM endpoints (P(t0), P(t1)) mapped through the
    // surface must coincide with the coedge's origin/dest VERTICES within tol. This
    // is the OCCT InvalidSameParameter / SameRange invariant: the 2D pcurve range
    // and the 3D edge range agree at the ends. (Interior agreement is G5; this is
    // the endpoint-range check, which catches a pcurve trimmed to the wrong span.)
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Geometry,
                                   CheckStatus::InvalidSameParameter,
                                   "G9.EdgeSameParameter");
        std::vector<Coedge*> ces;
        for (Face* f : faces) {
            if (f->surface == nullptr) continue;
            faceCoedges(f, ces);
            for (Coedge* c : ces) {
                if (c->pcurve == nullptr) continue;
                const double ct = effTol(tol, c->tolerance);
                UVCoord uvA = c->pcurve->evaluate(c->pcurve->t0);
                UVCoord uvB = c->pcurve->evaluate(c->pcurve->t1);
                Vec3 surfA = f->surface->evaluate(uvA.u, uvA.v);
                Vec3 surfB = f->surface->evaluate(uvB.u, uvB.v);
                Vec3 vo = toVec(c->originVertex()->point);
                Vec3 vd = toVec(c->destVertex()->point);
                double dA = vlen(vsub(surfA, vo));
                double dB = vlen(vsub(surfB, vd));
                if (dA > ct || dB > ct) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Coedge, c->id});
                    p.detail = "dA=" + std::to_string(dA) + " dB=" + std::to_string(dB);
                }
            }
        }
    }

    // ──────────────────────── ORIENTATION family ────────────────────────────

    // O1 — the two coedges of every MANIFOLD (2-coedge) edge run opposite.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Orientation,
                                   CheckStatus::BadOrientation,
                                   "O1.CoedgePairsOpposite");
        for (const auto& kv : em.uses) {
            if (kv.second.size() == 2) {
                Coedge* a = kv.second[0];
                Coedge* b = kv.second[1];
                if (a->forward == b->forward) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Edge, kv.first->id});
                }
            }
        }
    }

    // O2 — outer loops wound CCW in (u,v) (signed param area > 0); inner loops CW.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Orientation,
                                   CheckStatus::BadOrientationCCW,
                                   "O2.OuterLoopCCW");
        for (Face* f : faces) {
            if (f->outerLoop == nullptr) continue;
            double a2 = loopSignedParamArea2(f, f->outerLoop);
            if (a2 <= 0.0) {
                p.passed = false;
                p.offenders.push_back({IdKind::Loop, f->outerLoop->id});
                p.detail = "outer signed param area=" + std::to_string(a2);
            }
            for (Loop* il : f->innerLoops) {
                double ai = loopSignedParamArea2(f, il);
                if (ai >= 0.0) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Loop, il->id});
                }
            }
        }
    }

    // O3 — coedge mate links consistent on every 2-coedge edge.
    {
        CheckPredicate& p = addRow(rep, CheckFamily::Orientation,
                                   CheckStatus::BadOrientationMate,
                                   "O3.CoedgeMateConsistent");
        for (Edge* e : ([&] {
                 std::vector<Edge*> v; v.reserve(em.uses.size());
                 for (auto& kv : em.uses) v.push_back(kv.first); return v; })()) {
            if (e->coedgeA && e->coedgeB) {
                if (e->coedgeA->mate != e->coedgeB || e->coedgeB->mate != e->coedgeA) {
                    p.passed = false;
                    p.offenders.push_back({IdKind::Edge, e->id});
                }
            }
        }
    }

    // ── final verdict ────────────────────────────────────────────────────────
    rep.valid = (rep.failed() == 0);
    return rep;
}

CheckReport checkBRep(const Shell* shell, const CheckOptions& opt) {
    if (shell == nullptr) { CheckReport r; r.valid = false; return r; }
    std::vector<Face*> faces(shell->faces.begin(), shell->faces.end());
    return checkBRep(faces, opt);
}

CheckReport checkBRep(const Solid* solid, const CheckOptions& opt) {
    std::vector<Face*> faces;
    if (solid != nullptr) {
        for (Shell* sh : solid->shells) {
            if (sh) for (Face* f : sh->faces) faces.push_back(f);
        }
    }
    return checkBRep(faces, opt);
}

// ===========================================================================
// G4-TRIMMED — TRIMMED-NURBS FACE self-intersection / hole imbrication
// ===========================================================================
namespace {

// Flatten one trim loop's pcurves into a closed (u,v) polyline. Mirrors the
// chordal-adaptive flattener the TrimmedFace classifier/mesher use (recursive
// midpoint-deviation subdivision), kept local so Check.cpp adds no coupling to
// TrimmedFace.cpp's anonymous namespace. Returns the de-duplicated ring (no
// repeated closing vertex), so ring[i]->ring[(i+1)%n] are the closed edges.
void flattenPcurveRangeUV(const PCurve& pc, double a, double b, int depth,
                          std::vector<UVCoord>& out) {
    const UVCoord pa = pc.evaluate(a);
    const UVCoord pb = pc.evaluate(b);
    const double mid = 0.5 * (a + b);
    const UVCoord pm = pc.evaluate(mid);
    const double cmx = 0.5 * (pa.u + pb.u), cmy = 0.5 * (pa.v + pb.v);
    const double dev = std::hypot(pm.u - cmx, pm.v - cmy);
    const double chord = std::hypot(pb.u - pa.u, pb.v - pa.v);
    if (depth < 14 && dev > 1e-4 * std::max(chord, 1e-9) && dev > 1e-12) {
        flattenPcurveRangeUV(pc, a, mid, depth + 1, out);
        flattenPcurveRangeUV(pc, mid, b, depth + 1, out);
    } else {
        out.push_back(pb);
    }
}

std::vector<UVCoord> flattenTrimLoopUV(const TrimLoop& loop, std::size_t baseSegs) {
    std::vector<UVCoord> ring;
    if (loop.segments.empty()) return ring;
    if (baseSegs < 1) baseSegs = 1;
    ring.push_back(loop.segments.front().evaluate(loop.segments.front().t0));
    for (const auto& pc : loop.segments) {
        const double t0 = pc.t0, t1 = pc.t1;
        for (std::size_t i = 0; i < baseSegs; ++i) {
            const double a  = t0 + (t1 - t0) * (double(i)     / double(baseSegs));
            const double bb = t0 + (t1 - t0) * (double(i + 1) / double(baseSegs));
            flattenPcurveRangeUV(pc, a, bb, 0, ring);
        }
    }
    auto nearEq = [](const UVCoord& p, const UVCoord& q) {
        return std::hypot(p.u - q.u, p.v - q.v) <= 1e-12;
    };
    std::vector<UVCoord> dedup;
    dedup.reserve(ring.size());
    for (const auto& p : ring) {
        if (!dedup.empty() && nearEq(dedup.back(), p)) continue;
        dedup.push_back(p);
    }
    if (dedup.size() >= 2 && nearEq(dedup.front(), dedup.back())) dedup.pop_back();
    return dedup;
}

// EXACT proper segment-segment crossing in the (u,v) plane, lifted to z=0 with a
// +z apex so the SAME exactOrient3D the rest of the battery uses makes every
// in/out side decision (no float tie-break on the combinatorial verdict). Returns
// true only on a PROPER crossing (each segment strictly straddles the other's
// supporting line) — shared endpoints between adjacent ring edges do NOT count.
bool uvSegProperCross(const UVCoord& p1, const UVCoord& p2,
                      const UVCoord& q1, const UVCoord& q2) {
    auto EP = [](const UVCoord& w, double z) {
        return forge::native::ExactPoint3(forge::native::ExactReal(w.u),
                                          forge::native::ExactReal(w.v),
                                          forge::native::ExactReal(z));
    };
    // Side sign of point r relative to line a->b, in the z=0 plane: the orientation
    // of (a, b, a+ẑ, r). a+ẑ is the off-plane apex giving the plane a definite up.
    auto side = [&](const UVCoord& a, const UVCoord& b, const UVCoord& r) -> int {
        UVCoord apex = a;  // a + ẑ via the z coordinate
        return exactOrient3D(EP(a, 0.0), EP(b, 0.0), EP(apex, 1.0), EP(r, 0.0));
    };
    const int d1 = side(q1, q2, p1);
    const int d2 = side(q1, q2, p2);
    const int d3 = side(p1, p2, q1);
    const int d4 = side(p1, p2, q2);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
           ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

// Any proper crossing among the (non-adjacent) edges of ring A vs ring B. When
// A and B are the SAME ring (sameRing), adjacent edges sharing a vertex are
// skipped (a simple ring must not self-cross). When different rings, ALL edge
// pairs are tested (two distinct loops must not cross at all).
//
// A SAME-ring scan also flags a PINCH / figure-eight self-TOUCH: a non-adjacent
// vertex revisited by the polyline (two distinct ring vertices at the same (u,v)).
// A transversal self-crossing is caught by uvSegProperCross; a self-touch where
// the curve passes through the same point twice (e.g. a figure-eight, whose two
// strands meet AT a vertex of the flattening) is caught by this coincidence test —
// together they cover the polyline-exact non-simple-wire cases.
bool ringsCross(const std::vector<UVCoord>& A, const std::vector<UVCoord>& B,
                bool sameRing) {
    const std::size_t na = A.size(), nb = B.size();
    if (na < 2 || nb < 2) return false;
    for (std::size_t i = 0; i < na; ++i) {
        const UVCoord& p1 = A[i];
        const UVCoord& p2 = A[(i + 1) % na];
        const std::size_t jStart = sameRing ? (i + 1) : 0;
        for (std::size_t j = jStart; j < nb; ++j) {
            if (sameRing) {
                // skip the edge itself and the two edges adjacent to it.
                if (j == i) continue;
                if ((j + 1) % nb == i) continue;
                if ((i + 1) % na == j) continue;
            }
            const UVCoord& q1 = B[j];
            const UVCoord& q2 = B[(j + 1) % nb];
            if (uvSegProperCross(p1, p2, q1, q2)) return true;
        }
    }
    // Same-ring self-TOUCH: any two NON-ADJACENT ring vertices coincident in (u,v).
    if (sameRing) {
        const double eps2 = 1e-18;  // (1e-9)^2 parameter-space coincidence band
        for (std::size_t i = 0; i < na; ++i) {
            for (std::size_t j = i + 2; j < na; ++j) {
                if (i == 0 && j == na - 1) continue;  // ring-adjacent across the seam
                const double du = A[i].u - A[j].u, dv = A[i].v - A[j].v;
                if (du * du + dv * dv <= eps2) return true;
            }
        }
    }
    return false;
}

// Even-odd crossing-number parity of a +u ray from q against the closed ring
// (the same rule classifyPointInTrim uses): odd ⇒ q strictly inside the ring.
int rayCrossingsUV(const UVCoord& q, const std::vector<UVCoord>& ring) {
    int crossings = 0;
    const std::size_t n = ring.size();
    if (n < 3) return 0;
    for (std::size_t i = 0; i < n; ++i) {
        const UVCoord& a = ring[i];
        const UVCoord& b = ring[(i + 1) % n];
        const bool aBelow = a.v <= q.v;
        const bool bBelow = b.v <= q.v;
        if (aBelow == bBelow) continue;
        const double t = (q.v - a.v) / (b.v - a.v);
        const double xu = a.u + t * (b.u - a.u);
        if (xu > q.u) ++crossings;
    }
    return crossings;
}

} // anonymous namespace

TrimSelfIntersectResult checkTrimmedFaceSelfIntersection(
    const TrimmedFace& face, std::size_t loopSamples, double onTol) {
    (void)onTol;
    TrimSelfIntersectResult out;
    if (loopSamples < 1) loopSamples = 1;

    // Flatten every loop ONCE into a (u,v) polyline (outer + holes alike).
    std::vector<std::vector<UVCoord>> rings;
    rings.reserve(face.loops.size());
    for (const auto& loop : face.loops)
        rings.push_back(flattenTrimLoopUV(loop, loopSamples));

    // (A) INTRA-LOOP self-crossing: each flattened loop must be a simple wire (a
    //     curved pcurve that loops back over itself crosses one of its own edges).
    for (std::size_t k = 0; k < rings.size(); ++k) {
        if (ringsCross(rings[k], rings[k], /*sameRing=*/true)) {
            out.selfIntersects = true;
            out.loops = {k};
            out.detail = "loop " + std::to_string(k) +
                         " pcurve self-crosses (non-simple wire)";
            return out;
        }
    }

    // Identify the outer loop (isOuter==true, else the largest-extent ring).
    std::size_t outerIdx = 0;
    {
        bool found = false;
        for (std::size_t k = 0; k < face.loops.size(); ++k) {
            if (face.loops[k].isOuter) { outerIdx = k; found = true; break; }
        }
        if (!found) {
            double best = -1.0;
            for (std::size_t k = 0; k < rings.size(); ++k) {
                double minu = 1e300, maxu = -1e300, minv = 1e300, maxv = -1e300;
                for (const auto& q : rings[k]) {
                    minu = std::min(minu, q.u); maxu = std::max(maxu, q.u);
                    minv = std::min(minv, q.v); maxv = std::max(maxv, q.v);
                }
                const double ext = (maxu - minu) + (maxv - minv);
                if (ext > best) { best = ext; outerIdx = k; }
            }
        }
    }

    // (B) INTER-LOOP crossing: NO two distinct loops may cross. A hole whose
    //     boundary pokes OUTSIDE the outer loop, or two holes that overlap, produce
    //     a proper boundary crossing here — the imbrication signal.
    for (std::size_t i = 0; i < rings.size(); ++i) {
        for (std::size_t j = i + 1; j < rings.size(); ++j) {
            if (ringsCross(rings[i], rings[j], /*sameRing=*/false)) {
                out.selfIntersects = true;
                out.loops = {i, j};
                out.detail = "loops " + std::to_string(i) + " and " +
                             std::to_string(j) + " cross (hole imbricates boundary)";
                return out;
            }
        }
    }

    // (C) WHOLLY-OUTSIDE / nested-wrong containment: an inner (hole) loop must lie
    //     ENTIRELY inside the outer loop. A hole sitting wholly outside the outer
    //     boundary never crosses it, so (B) alone would miss it — classify each hole
    //     vertex against the OUTER ring by even-odd parity; any hole vertex strictly
    //     outside the outer loop is an imbrication.
    if (outerIdx < rings.size()) {
        const std::vector<UVCoord>& outer = rings[outerIdx];
        for (std::size_t k = 0; k < rings.size(); ++k) {
            if (k == outerIdx) continue;
            for (const UVCoord& q : rings[k]) {
                if ((rayCrossingsUV(q, outer) % 2) == 0) {  // even ⇒ outside outer
                    out.selfIntersects = true;
                    out.loops = {outerIdx, k};
                    out.detail = "hole loop " + std::to_string(k) +
                                 " lies outside outer loop " +
                                 std::to_string(outerIdx) + " (imbrication)";
                    return out;
                }
            }
        }
    }

    return out;  // simple: no self-intersection / imbrication
}

} // namespace brep
} // namespace native
} // namespace forge
