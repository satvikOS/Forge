// forge/native/geom/PolygonBoolean2D.cpp
//
// Implementation of forge::native::geom::PolygonBoolean2D — see the header for
// the contract, the four ops, and the honest robustness posture.
//
// Pure C++20, standard library only. The COMBINATORIAL core (which sub-edges
// bound the result region; the winding parity that decides in/out) is driven by
// forge::native::orient2d so a near-grazing edge can never flip the
// classification; only the COORDINATES of intersection vertices are plain
// IEEE-754 double, the same honest ceiling Clipper ships.
//
// ALGORITHM (planar-arrangement + winding extraction, generalised from
// PolygonOffset2D::cleanRawLoop to two operands A and B):
//
//   1. Validate each operand (simple polygon-with-holes: >=3 verts/contour,
//      finite, nonzero area, no self/mutual PROPER crossing among its contours).
//      Self-intersecting input -> ok=false (no fake).
//   2. Build the directed edge list of A and of B (each contour in its given
//      orientation). Split every edge at all PROPER crossings with edges of the
//      OTHER operand (and, for completeness, any crossing among the same
//      operand's contours — for a valid input there are none). Crossings come
//      from the exact segmentIntersect; the split-parameter guard excludes
//      near-endpoint hits so shared vertices do not spawn zero-length edges.
//   3. Snap split points to shared nodes -> a DCEL of directed half-edges, each
//      tagged with its owner (A / B).
//   4. For each directed sub-edge, probe a point a robust eps to its LEFT and to
//      its RIGHT. Evaluate winding(A) and winding(B) at each flank (exact
//      orient2d ray test) -> (inA,inB) -> inside via the op predicate. The edge
//      bounds the result iff exactly one flank is inside; orient it so the inside
//      lies on its LEFT (CCW outer / CW holes fall out directly).
//   5. Chain kept directed edges into closed loops (sharp-left tie-break), drop
//      slivers, return with the natural orientation.
//
// DEGENERACY POLICY (honest): if A and B share a COLLINEAR boundary overlap, or
// touch only at an isolated vertex (measure-zero contact), the flank-probe of an
// on-boundary sub-edge becomes ambiguous (its midpoint lies on the OTHER
// operand's boundary too). We DETECT that — a kept sub-edge whose midpoint lies
// exactly on an edge of the other operand — and return ok=false with a reason,
// rather than emit a fake. The full generic envelope (transversal crossings or
// disjoint) is handled exactly.

#include "forge/native/geom/PolygonBoolean2D.hpp"

// Explicit standard-header hygiene. libstdc++ on CI does NOT transitively pull
// these the way the Mac's libc++ does — name EVERY standard header we use.
#include <algorithm>      // std::sort, std::min, std::max, std::reverse
#include <array>          // std::array (kernel-wide vocabulary)
#include <cmath>          // std::fabs, std::hypot, std::isfinite, std::atan2
#include <cstddef>        // std::size_t
#include <cstdint>        // std::int64_t (node/edge counting)
#include <cstring>        // std::memcpy-style hygiene (vocabulary parity)
#include <functional>     // std::function-free, included for predicate vocabulary
#include <limits>         // std::numeric_limits
#include <map>            // std::map (deterministic node keys)
#include <numeric>        // std::accumulate-style hygiene (area sums)
#include <queue>          // std::queue (vocabulary parity with arrangement code)
#include <set>            // std::set (deterministic crossing bookkeeping)
#include <string>         // std::string
#include <unordered_map>  // std::unordered_map (node de-dup acceleration)
#include <unordered_set>  // std::unordered_set (edge bookkeeping)
#include <utility>        // std::pair, std::move, std::swap
#include <vector>         // std::vector

namespace forge {
namespace native {
namespace geom {

namespace {

constexpr double kPi = 3.14159265358979323846264338327950288;

// --- tiny 2D vector helpers (local; no dependency on any other TU) ----------
struct V2 { double x{0.0}; double y{0.0}; };
inline V2 sub(const Point2& a, const Point2& b) { return {a.x - b.x, a.y - b.y}; }
inline double dot(const V2& a, const V2& b) { return a.x * b.x + a.y * b.y; }
inline double len(const V2& a) { return std::hypot(a.x, a.y); }

inline bool finite2(const Point2& p) {
    return std::isfinite(p.x) && std::isfinite(p.y);
}

inline double dist2(const Point2& a, const Point2& b) {
    const double dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
}

// Robust orientation sign of (a,b,c) via the kernel's exact predicate.
inline int orientSign(const Point2& a, const Point2& b, const Point2& c) {
    return signValue(orient2d(a.x, a.y, b.x, b.y, c.x, c.y));
}

// Twice the signed (shoelace) area of a ring (first vertex NOT repeated).
double shoelace2(const std::vector<Point2>& p) {
    const std::size_t n = p.size();
    if (n < 3) return 0.0;
    double s = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = p[i];
        const Point2& b = p[(i + 1) % n];
        s += a.x * b.y - b.x * a.y;
    }
    return s;
}

// Strip consecutive duplicate / near-duplicate vertices from a ring; also drops
// a closing duplicate of the first. `tol2` is a squared-distance threshold.
std::vector<Point2> dedupRing(const std::vector<Point2>& in, double tol2) {
    std::vector<Point2> out;
    out.reserve(in.size());
    for (const Point2& q : in) {
        if (!out.empty() && dist2(out.back(), q) <= tol2) continue;
        out.push_back(q);
    }
    while (out.size() >= 2 && dist2(out.front(), out.back()) <= tol2)
        out.pop_back();
    return out;
}

// Winding number of a single ring about q, ray-crossing decided via orient2d
// (Dan Sunday's wn_PnPoly with the parity test taken from the exact sign so it
// can never flip on a near-grazing edge).
int ringWinding(const std::vector<Point2>& p, const Point2& q) {
    const std::size_t n = p.size();
    if (n < 3) return 0;
    int wn = 0;
    for (std::size_t i = 0; i < n; ++i) {
        const Point2& a = p[i];
        const Point2& b = p[(i + 1) % n];
        if (a.y <= q.y) {
            if (b.y > q.y) {                        // upward crossing
                if (orientSign(a, b, q) > 0) ++wn;  // q strictly left of a->b
            }
        } else {
            if (b.y <= q.y) {                       // downward crossing
                if (orientSign(a, b, q) < 0) --wn;  // q strictly right of a->b
            }
        }
    }
    return wn;
}

// Parameter of q along segment a->b (q assumed on the line), 0 at a, 1 at b.
inline double paramOnSeg(const Point2& a, const Point2& b, const Point2& q) {
    V2 ab = sub(b, a);
    double L2 = dot(ab, ab);
    if (L2 <= 0.0) return 0.0;
    V2 aq = sub(q, a);
    return dot(aq, ab) / L2;
}

// Is q strictly in the interior of segment a->b (collinear AND between)? Used to
// detect degenerate boundary contact. The collinearity is the EXACT orient2d
// sign; the betweenness is a coordinate comparison (safe: q is a flank midpoint).
bool strictlyOnSegInterior(const Point2& a, const Point2& b, const Point2& q,
                           double tol2) {
    if (orientSign(a, b, q) != 0) return false;
    if (dist2(a, q) <= tol2 || dist2(b, q) <= tol2) return false;  // at an endpoint
    double t = paramOnSeg(a, b, q);
    return t > 0.0 && t < 1.0;
}

// All directed boundary edges of a polygon-with-holes (each contour in its given
// orientation). The owner tag is filled by the caller.
struct DEdge { Point2 a, b; };

void collectEdges(const BoolPolygon& poly, std::vector<DEdge>& out) {
    auto add = [&](const std::vector<Point2>& r) {
        const std::size_t n = r.size();
        for (std::size_t i = 0; i < n; ++i)
            out.push_back({r[i], r[(i + 1) % n]});
    };
    add(poly.outer.pts);
    for (const BoolContour& h : poly.holes) add(h.pts);
}

// Does polygon-with-holes `poly` self-intersect? (Any PROPER crossing between
// two of its directed edges that are not the same edge.) Exact via
// segmentIntersect. Adjacent edges sharing a vertex classify as ENDPOINT_TOUCH,
// not PROPER_CROSS, so they are not flagged. A collinear overlap (a contour
// doubling back on itself) IS flagged via COLLINEAR_OVERLAP.
bool selfIntersects(const BoolPolygon& poly) {
    std::vector<DEdge> e;
    collectEdges(poly, e);
    const std::size_t m = e.size();
    for (std::size_t i = 0; i < m; ++i) {
        for (std::size_t j = i + 1; j < m; ++j) {
            SegIntersection si =
                segmentIntersect(e[i].a, e[i].b, e[j].a, e[j].b);
            if (si.relation == SegRelation::PROPER_CROSS) return true;
            if (si.relation == SegRelation::COLLINEAR_OVERLAP) return true;
        }
    }
    return false;
}

// Extent (max span over x/y) of all contours of a polygon — for tolerances.
double polyExtent(const BoolPolygon& poly) {
    bool any = false;
    double minx = 0, maxx = 0, miny = 0, maxy = 0;
    auto acc = [&](const std::vector<Point2>& r) {
        for (const Point2& q : r) {
            if (!any) { minx = maxx = q.x; miny = maxy = q.y; any = true; }
            else {
                minx = std::min(minx, q.x); maxx = std::max(maxx, q.x);
                miny = std::min(miny, q.y); maxy = std::max(maxy, q.y);
            }
        }
    };
    acc(poly.outer.pts);
    for (const BoolContour& h : poly.holes) acc(h.pts);
    if (!any) return 0.0;
    return std::max(maxx - minx, maxy - miny);
}

}  // namespace

// ---------------------------------------------------------------------------
// Small members.
// ---------------------------------------------------------------------------
double BoolContour::signedArea2() const { return shoelace2(pts); }

double BoolPolygon::netArea() const {
    double a = outer.signedArea();
    for (const BoolContour& h : holes) a += h.signedArea();
    return a;
}

double BoolResult::netArea() const {
    double a = 0.0;
    for (const BoolContour& c : contours) a += c.signedArea();
    return a;
}

double PolygonBoolean2D::netAreaOf(const std::vector<BoolContour>& cs) {
    double a = 0.0;
    for (const BoolContour& c : cs) a += c.signedArea();
    return a;
}

// ---------------------------------------------------------------------------
// Winding helpers (public).
// ---------------------------------------------------------------------------
int PolygonBoolean2D::contourWinding(const BoolContour& c, const Point2& q) {
    return ringWinding(c.pts, q);
}

int PolygonBoolean2D::windingNumber(const BoolPolygon& poly, const Point2& q) {
    int w = ringWinding(poly.outer.pts, q);
    for (const BoolContour& h : poly.holes) w += ringWinding(h.pts, q);
    return w;
}

// ---------------------------------------------------------------------------
// Validity: simple polygon-with-holes.
// ---------------------------------------------------------------------------
bool PolygonBoolean2D::isValid(const BoolPolygon& poly, std::string& reason) {
    auto checkContour = [&](const BoolContour& c, const char* what) -> bool {
        if (c.pts.size() < 3) { reason = std::string(what) + ": fewer than 3 vertices"; return false; }
        for (const Point2& q : c.pts)
            if (!finite2(q)) { reason = std::string(what) + ": non-finite vertex"; return false; }
        if (shoelace2(c.pts) == 0.0) { reason = std::string(what) + ": zero area (degenerate/collinear)"; return false; }
        return true;
    };
    if (!checkContour(poly.outer, "outer")) return false;
    for (const BoolContour& h : poly.holes)
        if (!checkContour(h, "hole")) return false;

    if (selfIntersects(poly)) {
        reason = "polygon self-intersects (or a contour doubles back)";
        return false;
    }
    reason.clear();
    return true;
}

// ---------------------------------------------------------------------------
// compute — the general boolean.
// ---------------------------------------------------------------------------
BoolResult PolygonBoolean2D::compute(const BoolPolygon& A, const BoolPolygon& B,
                                     BoolOp op) {
    BoolResult res;

    // --- 1. Validate both operands (0 FAKES: refuse the dishonest cases). ----
    std::string why;
    if (!isValid(A, why)) { res.reason = "subject invalid: " + why; return res; }
    if (!isValid(B, why)) { res.reason = "clip invalid: " + why; return res; }

    // The boolean predicate: given winding(A) and winding(B) at a probe, is the
    // probe INSIDE the result region? "Inside operand" means nonzero winding
    // (CCW outer / CW holes makes the solid have winding +1, holes 0).
    auto inAFn = [](int wA) { return wA != 0; };
    auto inBFn = [](int wB) { return wB != 0; };
    auto insideFn = [op, &inAFn, &inBFn](int wA, int wB) -> bool {
        const bool a = inAFn(wA), b = inBFn(wB);
        switch (op) {
            case BoolOp::Union:        return a || b;
            case BoolOp::Intersection: return a && b;
            case BoolOp::Difference:   return a && !b;
            case BoolOp::Xor:          return a != b;
        }
        return false;
    };

    // --- 2. Gather every directed boundary edge of A and of B. ---------------
    struct OEdge { Point2 a, b; int owner; };  // owner 0=A, 1=B
    std::vector<OEdge> edges;
    {
        std::vector<DEdge> ea, eb;
        collectEdges(A, ea);
        collectEdges(B, eb);
        edges.reserve(ea.size() + eb.size());
        for (const DEdge& e : ea) edges.push_back({e.a, e.b, 0});
        for (const DEdge& e : eb) edges.push_back({e.a, e.b, 1});
    }
    const std::size_t E = edges.size();
    if (E < 6) { res.reason = "degenerate input (too few edges)"; return res; }

    // Tolerances from the combined extent.
    double ext = std::max(polyExtent(A), polyExtent(B));
    if (!(ext > 0.0)) ext = 1.0;
    const double snapDist = std::max(1e-12, ext * 1e-9);
    const double snap2 = snapDist * snapDist;

    // --- 3. Split every edge at all PROPER crossings with every OTHER edge. ---
    // For a valid input the only crossings are between A and B (each operand is
    // self-simple), but we test all pairs for completeness and to catch a shared
    // boundary as a COLLINEAR_OVERLAP (degenerate -> refuse below).
    std::vector<std::vector<std::pair<double, Point2>>> splits(E);
    for (std::size_t i = 0; i < E; ++i) {
        for (std::size_t j = i + 1; j < E; ++j) {
            SegIntersection si =
                segmentIntersect(edges[i].a, edges[i].b, edges[j].a, edges[j].b);
            if (si.relation == SegRelation::COLLINEAR_OVERLAP) {
                // A and B share a collinear boundary stretch (or one operand
                // doubles back — already caught). Refuse: degenerate contact.
                res.reason = "operands share a collinear boundary overlap "
                             "(degenerate; outside the validated envelope)";
                return res;
            }
            if (si.relation == SegRelation::PROPER_CROSS) {
                const Point2& X = si.point;
                double ti = paramOnSeg(edges[i].a, edges[i].b, X);
                double tj = paramOnSeg(edges[j].a, edges[j].b, X);
                if (ti > 1e-9 && ti < 1.0 - 1e-9) splits[i].push_back({ti, X});
                if (tj > 1e-9 && tj < 1.0 - 1e-9) splits[j].push_back({tj, X});
            }
            // ENDPOINT_TOUCH / DISJOINT: nothing to split. (An isolated-vertex
            // contact is caught later by the on-other-boundary midpoint guard.)
        }
    }

    // Refined directed sub-edges (owner preserved).
    struct SubEdge { Point2 a, b; int owner; };
    std::vector<SubEdge> subs;
    subs.reserve(E * 2);
    for (std::size_t i = 0; i < E; ++i) {
        auto& sp = splits[i];
        std::sort(sp.begin(), sp.end(),
                  [](const std::pair<double, Point2>& X,
                     const std::pair<double, Point2>& Y) { return X.first < Y.first; });
        Point2 cur = edges[i].a;
        for (auto& s : sp) {
            if (dist2(cur, s.second) > snap2)
                subs.push_back({cur, s.second, edges[i].owner});
            cur = s.second;
        }
        if (dist2(cur, edges[i].b) > snap2)
            subs.push_back({cur, edges[i].b, edges[i].owner});
    }
    if (subs.size() < 3) { res.reason = "degenerate after splitting"; return res; }

    // --- 4. Snap endpoints to shared nodes (a small spatial-hash de-dup). -----
    std::vector<Point2> nodes;
    // Bucket key on a coarse grid (cell = snapDist) so de-dup is near-O(1).
    std::unordered_map<long long, std::vector<int>> grid;
    auto cellKey = [&](double x, double y) -> long long {
        long long ix = static_cast<long long>(std::floor(x / snapDist));
        long long iy = static_cast<long long>(std::floor(y / snapDist));
        return (ix * 73856093LL) ^ (iy * 19349663LL);
    };
    auto nodeOf = [&](const Point2& q) -> int {
        // search the 3x3 neighbourhood of cells for an existing node within snap.
        long long ix = static_cast<long long>(std::floor(q.x / snapDist));
        long long iy = static_cast<long long>(std::floor(q.y / snapDist));
        for (long long dx = -1; dx <= 1; ++dx)
            for (long long dy = -1; dy <= 1; ++dy) {
                long long k = ((ix + dx) * 73856093LL) ^ ((iy + dy) * 19349663LL);
                auto it = grid.find(k);
                if (it == grid.end()) continue;
                for (int id : it->second)
                    if (dist2(nodes[static_cast<std::size_t>(id)], q) <= snap2) return id;
            }
        int id = static_cast<int>(nodes.size());
        nodes.push_back(q);
        grid[cellKey(q.x, q.y)].push_back(id);
        return id;
    };

    struct HEdge { int from, to, owner; };
    std::vector<HEdge> he;
    he.reserve(subs.size());
    for (const SubEdge& s : subs) {
        int a = nodeOf(s.a);
        int b = nodeOf(s.b);
        if (a == b) continue;                 // snapped to zero length
        he.push_back({a, b, s.owner});
    }
    const std::size_t H = he.size();
    if (H < 3) { res.reason = "degenerate after snapping"; return res; }

    // --- 5. Classify each directed sub-edge by the winding on its two flanks. -
    // The kept region is { x : insideFn(windA(x), windB(x)) }. A directed
    // sub-edge a->b bounds that region iff exactly one of its flanks is inside;
    // we emit it so the INSIDE lies on its LEFT (=> CCW outer / CW holes).
    //
    // Degeneracy guard: if a sub-edge's midpoint lies exactly on a boundary edge
    // of the OTHER operand (isolated-vertex / shared-boundary contact that slipped
    // past the collinear test), the flank winding of that operand is ambiguous —
    // we refuse honestly rather than emit a fake.
    struct KEdge { int from, to; };
    std::vector<KEdge> kept;
    kept.reserve(H);

    // Quick access to A's and B's raw edges for the midpoint-on-boundary guard.
    std::vector<DEdge> aEdges, bEdges;
    collectEdges(A, aEdges);
    collectEdges(B, bEdges);

    auto windPolyAt = [](const BoolPolygon& P, const Point2& q) -> int {
        int w = ringWinding(P.outer.pts, q);
        for (const BoolContour& h : P.holes) w += ringWinding(h.pts, q);
        return w;
    };

    for (std::size_t k = 0; k < H; ++k) {
        const Point2& Ap = nodes[static_cast<std::size_t>(he[k].from)];
        const Point2& Bp = nodes[static_cast<std::size_t>(he[k].to)];
        V2 e = sub(Bp, Ap);
        double L = len(e);
        if (L <= 0.0) continue;
        Point2 mid{(Ap.x + Bp.x) * 0.5, (Ap.y + Bp.y) * 0.5};

        // The owning operand's boundary passes through `mid` exactly (this edge
        // IS part of it). Only the OTHER operand's boundary passing through mid
        // is a degeneracy. Detect it.
        const std::vector<DEdge>& other = (he[k].owner == 0) ? bEdges : aEdges;
        for (const DEdge& oe : other) {
            if (strictlyOnSegInterior(oe.a, oe.b, mid, snap2)) {
                res.reason = "boundaries touch along a sub-edge "
                             "(degenerate contact; outside the validated envelope)";
                return res;
            }
        }

        V2 leftN = {-e.y / L, e.x / L};                  // left normal of a->b
        double eps = std::max(snapDist, L * 1e-6);
        Point2 pl{mid.x + leftN.x * eps, mid.y + leftN.y * eps};
        Point2 pr{mid.x - leftN.x * eps, mid.y - leftN.y * eps};

        int wAl = windPolyAt(A, pl), wBl = windPolyAt(B, pl);
        int wAr = windPolyAt(A, pr), wBr = windPolyAt(B, pr);
        bool inL = insideFn(wAl, wBl);
        bool inR = insideFn(wAr, wBr);
        if (inL == inR) continue;                        // not a region boundary
        if (inL) kept.push_back({he[k].from, he[k].to}); // inside already on left
        else     kept.push_back({he[k].to, he[k].from}); // flip so inside is left
    }

    if (kept.empty()) {
        // Empty result region is honest (e.g. intersection of disjoint inputs).
        res.ok = true;
        return res;
    }

    // --- 6. Chain kept directed edges into closed loops. ---------------------
    // Each result-boundary node has matched in/out degree; walk consuming one
    // out-edge per visit. The sharp-left tie-break keeps nested boundaries from
    // cross-linking at a node where several boundary curves meet.
    std::vector<std::vector<int>> outAt(nodes.size());
    for (std::size_t k = 0; k < kept.size(); ++k)
        outAt[static_cast<std::size_t>(kept[k].from)].push_back(static_cast<int>(k));
    std::vector<char> used(kept.size(), 0);

    auto edgeAngle = [&](int ke) {
        V2 d = sub(nodes[static_cast<std::size_t>(kept[static_cast<std::size_t>(ke)].to)],
                   nodes[static_cast<std::size_t>(kept[static_cast<std::size_t>(ke)].from)]);
        return std::atan2(d.y, d.x);
    };

    std::vector<BoolContour> outContours;
    for (std::size_t s = 0; s < kept.size(); ++s) {
        if (used[s]) continue;
        std::vector<Point2> loop;
        const int startNode = kept[s].from;
        int cur = static_cast<int>(s);
        std::size_t guard = 0;
        bool ok = true;
        for (;;) {
            used[static_cast<std::size_t>(cur)] = 1;
            loop.push_back(nodes[static_cast<std::size_t>(kept[static_cast<std::size_t>(cur)].from)]);
            int v = kept[static_cast<std::size_t>(cur)].to;
            if (v == startNode) break;                   // loop closed cleanly
            double inAng = edgeAngle(cur);
            int pick = -1; double bestTurn = -1e300;
            for (int oe : outAt[static_cast<std::size_t>(v)]) {
                if (used[static_cast<std::size_t>(oe)]) continue;
                double outAng = edgeAngle(oe);
                double turn = outAng - (inAng + kPi);    // 0 == straight through
                while (turn <= -kPi) turn += 2.0 * kPi;
                while (turn > kPi)   turn -= 2.0 * kPi;
                if (turn > bestTurn) { bestTurn = turn; pick = oe; }
            }
            if (pick < 0) { ok = false; break; }
            cur = pick;
            if (++guard > kept.size() + 4) { ok = false; break; }
        }
        if (ok && loop.size() >= 3) {
            BoolContour c;
            c.pts = dedupRing(loop, snap2);
            if (c.pts.size() < 3) continue;
            double a2 = shoelace2(c.pts);
            if (std::fabs(a2) < snap2 * 4.0) continue;   // sliver
            outContours.push_back(std::move(c));
        }
    }

    res.ok = true;
    res.contours = std::move(outContours);
    return res;
}

}  // namespace geom
}  // namespace native
}  // namespace forge
