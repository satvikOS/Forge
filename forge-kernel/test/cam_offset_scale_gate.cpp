// cam_offset_scale_gate.cpp — does forge::cam::profile / pocket keep the tool-radius
// standoff at EVERY scale, from 1e-3 mm to 1e3 mm?
//
// WHY THIS GATE EXISTS. TKOffset family A replaced BRepOffsetAPI_MakeOffset in
// src/Cam.cpp with forge::native::geom::PolygonOffset2D and guarded the engine's
// answer with a clearance post-condition. An adversarial review then refuted that
// post-condition BY SCALE: its slack was an ABSOLUTE 0.0125 mm, so on a 0.008 mm
// square with a 0.012 mm tool radius the shipped function returned ok=true with ZERO
// standoff (every vertex on the boundary), and 0.010/0.0105 and 0.010/0.013 came back
// 57% and 85% short. The family-A gate could not see it: all four of its ghost cases
// used a 10 mm square, where the slack is 0.1% of the radius. A CAM toolpath that
// gouges is physical damage, so the property is gated here at every scale, through
// the PUBLIC operations whose Moves reach the G-code.
//
// THE PROPERTY IS THE DEFINITION, NOT THE ENGINE. The inward offset of a region P at
// distance r is { x in P : dist(x, boundary P) >= r }. Every check below measures the
// emitted cutter-centre path against the EXACT source boundary this file constructed
// (a polygon, a disc, or a stadium, each with a closed-form distance function), never
// against anything src/Cam.cpp computed. Four things are asserted:
//   1. LEGIT inputs SUCCEED — a gate that "passes" by refusing everything is vacuous.
//   2. Every cutting segment lies INSIDE P and stands at least r - lowBound clear of
//      its boundary. For a polygon boundary that minimum is EXACT (segment-segment
//      distance); for the disc and the stadium the clearance r(x) is concave along a
//      segment inside them, so its minimum is at an endpoint and the endpoints are
//      exact too.
//   3. The profile trace IS the offset: no point stands more than r + highBound clear
//      (sampled 33 points per segment), and its signed area, perimeter, centroid and
//      four XY bounds match the closed-form offset, with the SAME orientation sign as
//      the source boundary. Volume-style single observables have passed wrong shapes in
//      this repository four times; this is the vector.
//   4. INFEASIBLE inputs REFUSE (throw), including the adversary's three cases at their
//      exact sizes.
//
// THE CONTRACT the bounds encode (stated in src/Cam.cpp, restated here from the spec,
// not read from the implementation):
//     tol(r, L)   = min(3.125e-3 mm, min(r, L) / 256)       L = source extent
//     lowBound    = 3 tol + rounding                        (sagitta + retry + input)
//     highBound   = 3 tol + min(0.05 mm, extent_of_offset / 256) + rounding
// rounding = 4096 * DBL_EPSILON * (|coordinates| + r), the same stated floor.
//
// usage: cam_offset_scale_gate            (exit 0 = green)
//        cam_offset_scale_gate --verbose  (print every case)
#include "forge/Cam.hpp"
#include "forge/ShapeRegistry.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepTools.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Vertex.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>

#include <algorithm>
#include <cmath>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

constexpr double kPi = 3.14159265358979323846;
bool gVerbose = false;
int gChecks = 0;
int gFails = 0;

void check(bool ok, const char* tag, const std::string& what) {
    ++gChecks;
    if (!ok) {
        ++gFails;
        std::printf("[FAIL] %s  %s\n", tag, what.c_str());
    } else if (gVerbose) {
        std::printf("[ ok ] %s  %s\n", tag, what.c_str());
    }
}

std::string fmt(const char* f, ...) __attribute__((format(printf, 1, 2)));
std::string fmt(const char* f, ...) {
    char buf[1024];
    va_list ap;
    va_start(ap, f);
    std::vsnprintf(buf, sizeof(buf), f, ap);
    va_end(ap);
    return buf;
}

struct P2 { double x, y; };

double distPointSeg(P2 p, P2 a, P2 b) {
    const double vx = b.x - a.x, vy = b.y - a.y;
    const double wx = p.x - a.x, wy = p.y - a.y;
    const double vv = vx * vx + vy * vy;
    double t = vv > 0.0 ? (wx * vx + wy * vy) / vv : 0.0;
    t = std::max(0.0, std::min(1.0, t));
    return std::hypot(wx - t * vx, wy - t * vy);
}

double cross3(P2 a, P2 b, P2 c) { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }

// Exact-enough 2D segment distance for a gate: zero on a proper crossing, else the
// minimum of the four endpoint-to-segment distances (where the minimum between two
// non-intersecting segments is always attained).
double segSeg(P2 a, P2 b, P2 c, P2 d) {
    const double o1 = cross3(a, b, c), o2 = cross3(a, b, d);
    const double o3 = cross3(c, d, a), o4 = cross3(c, d, b);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
        ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0.0;
    return std::min({distPointSeg(a, c, d), distPointSeg(b, c, d),
                     distPointSeg(c, a, b), distPointSeg(d, a, b)});
}

// ─────────────────────────────────────────────── exact source regions

struct Region {
    enum Kind { Poly, Disc, Stadium } kind{Poly};
    std::vector<P2> poly;   // Poly: vertices in order (either winding)
    P2 c{0, 0};             // Disc: centre
    double R{0};            // Disc: radius
    P2 a{0, 0}, b{0, 0};    // Stadium: core segment
    double rho{0};          // Stadium: radius

    bool inside(P2 p) const {
        switch (kind) {
        case Disc:    return std::hypot(p.x - c.x, p.y - c.y) < R;
        case Stadium: return distPointSeg(p, a, b) < rho;
        case Poly: {
            bool in = false;
            for (std::size_t i = 0, j = poly.size() - 1; i < poly.size(); j = i++) {
                const P2& u = poly[i];
                const P2& v = poly[j];
                if ((u.y > p.y) != (v.y > p.y) &&
                    p.x < (v.x - u.x) * (p.y - u.y) / (v.y - u.y) + u.x) in = !in;
            }
            return in;
        }
        }
        return false;
    }
    // Unsigned distance from p to the boundary.
    double clearance(P2 p) const {
        switch (kind) {
        case Disc:    return std::fabs(R - std::hypot(p.x - c.x, p.y - c.y));
        case Stadium: return std::fabs(rho - distPointSeg(p, a, b));
        case Poly: {
            double m = std::numeric_limits<double>::infinity();
            for (std::size_t i = 0; i < poly.size(); ++i)
                m = std::min(m, distPointSeg(p, poly[i], poly[(i + 1) % poly.size()]));
            return m;
        }
        }
        return 0.0;
    }
    // Minimum clearance along segment pq, both endpoints known to be inside.
    double minClearanceSeg(P2 p, P2 q) const {
        if (kind == Poly) {
            double m = std::numeric_limits<double>::infinity();
            for (std::size_t i = 0; i < poly.size(); ++i)
                m = std::min(m, segSeg(p, q, poly[i], poly[(i + 1) % poly.size()]));
            return m;
        }
        // Disc / stadium: clearance = radius - dist(x, convex core) is CONCAVE along a
        // segment inside the region, so the minimum is at an endpoint.
        return std::min(clearance(p), clearance(q));
    }
    double extent() const {
        switch (kind) {
        case Disc:    return 2.0 * R;
        case Stadium: return std::max(std::fabs(b.x - a.x) + 2.0 * rho, std::fabs(b.y - a.y) + 2.0 * rho);
        case Poly: {
            double x0 = 1e300, x1 = -1e300, y0 = 1e300, y1 = -1e300;
            for (const P2& p : poly) {
                x0 = std::min(x0, p.x); x1 = std::max(x1, p.x);
                y0 = std::min(y0, p.y); y1 = std::max(y1, p.y);
            }
            return std::max(x1 - x0, y1 - y0);
        }
        }
        return 0.0;
    }
    double magnitude() const {
        double m = 0.0;
        auto acc = [&](P2 p) { m = std::max({m, std::fabs(p.x), std::fabs(p.y)}); };
        switch (kind) {
        case Disc:    acc({c.x - R, c.y - R}); acc({c.x + R, c.y + R}); break;
        case Stadium: acc({a.x - rho, a.y - rho}); acc({b.x + rho, b.y + rho}); break;
        case Poly:    for (const P2& p : poly) acc(p); break;
        }
        return m;
    }
};

// The closed-form inward offset of each region, as the observables the trace is
// compared with.
struct Expected {
    double area;          // |signed area|
    double perimeter;
    double cx, cy;        // area centroid (NaN = do not check, see L-shape)
    double minX, minY, maxX, maxY;
    double extent;        // of the offset itself, for the consumer's trace budget
    int    exactVertices; // >0: the trace must have exactly this many distinct vertices
    int    minVertices;   // otherwise: at least this many
};

// ─────────────────────────────────────────────── shape construction

// A planar face bounded by the polygon, on the plane whose normal makes the given
// vertex order the face's OUTER (counter-clockwise-about-the-normal) boundary. A CW
// vertex list therefore gets a -Z plane: that is what a real CW-presenting outer wire
// is (the underside of a part seen from +Z). Building a CW wire on a +Z plane does NOT
// present CW — BRepLib_MakeFace flips the wire so the domain is finite, which the
// control CONTROL_CW_SQUARE_PRESENTS_CW measured on the first run of this gate.
TopoDS_Face polygonFace(const std::vector<P2>& pts) {
    std::vector<TopoDS_Vertex> vs;
    for (const P2& p : pts) vs.push_back(BRepBuilderAPI_MakeVertex(gp_Pnt(p.x, p.y, 0.0)).Vertex());
    BRepBuilderAPI_MakeWire mw;
    for (std::size_t i = 0; i < vs.size(); ++i)
        mw.Add(BRepBuilderAPI_MakeEdge(vs[i], vs[(i + 1) % vs.size()]).Edge());
    double a2 = 0.0;
    for (std::size_t i = 0; i < pts.size(); ++i) {
        const P2& u = pts[i];
        const P2& v = pts[(i + 1) % pts.size()];
        a2 += u.x * v.y - v.x * u.y;
    }
    const gp_Pln pln(gp_Pnt(pts[0].x, pts[0].y, 0.0), gp_Dir(0, 0, a2 >= 0.0 ? 1.0 : -1.0));
    return BRepBuilderAPI_MakeFace(pln, mw.Wire(), /*Inside=*/true).Face();
}

// A full circle. axisDown and reverseEdge are the two ways a circle presents CW.
TopoDS_Face circleFace(P2 c, double R, bool axisDown, bool reverseEdge) {
    gp_Circ circ(gp_Ax2(gp_Pnt(c.x, c.y, 0.0), gp_Dir(0, 0, axisDown ? -1.0 : 1.0)), R);
    TopoDS_Edge e = BRepBuilderAPI_MakeEdge(circ).Edge();
    if (reverseEdge) e.Reverse();
    BRepBuilderAPI_MakeWire mw(e);
    return BRepBuilderAPI_MakeFace(mw.Wire(), /*OnlyPlane=*/true).Face();
}

// Stadium: core segment (cx - s/2, cy) .. (cx + s/2, cy), radius s/2 -> 2s x s.
// Lines + two half circles, so the offset takes the CURVED-INPUT polygon path.
TopoDS_Face stadiumFace(P2 c, double s) {
    const double h = 0.5 * s, rho = 0.5 * s;
    const gp_Pnt A(c.x - h, c.y - rho, 0), B(c.x + h, c.y - rho, 0);
    const gp_Pnt C(c.x + h, c.y + rho, 0), D(c.x - h, c.y + rho, 0);
    TopoDS_Vertex vA = BRepBuilderAPI_MakeVertex(A).Vertex();
    TopoDS_Vertex vB = BRepBuilderAPI_MakeVertex(B).Vertex();
    TopoDS_Vertex vC = BRepBuilderAPI_MakeVertex(C).Vertex();
    TopoDS_Vertex vD = BRepBuilderAPI_MakeVertex(D).Vertex();
    gp_Circ right(gp_Ax2(gp_Pnt(c.x + h, c.y, 0), gp_Dir(0, 0, 1)), rho);
    gp_Circ left (gp_Ax2(gp_Pnt(c.x - h, c.y, 0), gp_Dir(0, 0, 1)), rho);
    BRepBuilderAPI_MakeWire mw;
    mw.Add(BRepBuilderAPI_MakeEdge(vA, vB).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(right, vB, vC).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(vC, vD).Edge());
    mw.Add(BRepBuilderAPI_MakeEdge(left, vD, vA).Edge());
    return BRepBuilderAPI_MakeFace(mw.Wire(), /*OnlyPlane=*/true).Face();
}

// Signed area of the face's outer wire as it PRESENTS in XY (edge orientation
// honoured), from this file's own uniform sampler. This is the orientation the trace
// must preserve.
double presentedSignedArea(const TopoDS_Face& f) {
    TopoDS_Wire w = BRepTools::OuterWire(f);
    std::vector<P2> pts;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        TopoDS_Edge e = ex.Current();
        BRepAdaptor_Curve ad(e);
        const double u0 = ad.FirstParameter(), u1 = ad.LastParameter();
        const int n = (ad.GetType() == GeomAbs_Line) ? 1 : 64;
        const bool rev = (e.Orientation() == TopAbs_REVERSED);
        for (int k = 0; k < n; ++k) {
            const double t = static_cast<double>(k) / n;
            const gp_Pnt p = ad.Value(rev ? (u1 - t * (u1 - u0)) : (u0 + t * (u1 - u0)));
            pts.push_back({p.X(), p.Y()});
        }
    }
    double s = 0.0;
    const P2 o = pts.empty() ? P2{0.0, 0.0} : pts.front();   // relative, as for the trace
    for (std::size_t i = 0; i < pts.size(); ++i) {
        const P2& a = pts[i];
        const P2& b = pts[(i + 1) % pts.size()];
        s += (a.x - o.x) * (b.y - o.y) - (b.x - o.x) * (a.y - o.y);
    }
    return 0.5 * s;
}

// ─────────────────────────────────────────────── the contract's bounds

struct Bounds { double tol, rounding, low, high; };

Bounds contractBounds(const Region& reg, double r, double offsetExtent) {
    Bounds b;
    b.tol = std::min(3.125e-3, std::min(r, reg.extent()) / 256.0);
    b.rounding = 4096.0 * std::numeric_limits<double>::epsilon() * (reg.magnitude() + r);
    b.low = 3.0 * b.tol + b.rounding;
    b.high = 3.0 * b.tol + std::min(0.05, offsetExtent / 256.0) + b.rounding;
    return b;
}

forge::cam::Tool toolFor(double r) {
    return forge::cam::Tool{1, "gate", 2.0 * r, 10.0, 30.0, 2, forge::cam::Tool::EndMill};
}
forge::cam::CuttingParams paramsFor(double r) {
    // stepover = r/10: every feasible case below leaves an offset region at least
    // 0.2 r across, so at least one raster row fits at every scale. One Z level.
    return forge::cam::CuttingParams{600.0, 200.0, 12000.0, 0.1 * r, 1.0, 0.0};
}
constexpr double kZTop = 0.0, kZBottom = -1.0;

struct CutSeg { P2 p, q; };

std::vector<CutSeg> cuttingSegments(const forge::cam::Toolpath& tp) {
    std::vector<CutSeg> out;
    for (std::size_t i = 1; i < tp.moves.size(); ++i) {
        if (!tp.moves[i].cutting) continue;
        out.push_back({{tp.moves[i - 1].x, tp.moves[i - 1].y}, {tp.moves[i].x, tp.moves[i].y}});
    }
    return out;
}

// The first level's perimeter trace of a profile: the plunge point then every cutting
// move until the next non-cutting move.
std::vector<P2> firstTrace(const forge::cam::Toolpath& tp) {
    std::vector<P2> t;
    std::size_t i = 0;
    while (i < tp.moves.size() && !tp.moves[i].cutting) ++i;
    for (; i < tp.moves.size() && tp.moves[i].cutting; ++i) {
        P2 p{tp.moves[i].x, tp.moves[i].y};
        if (!t.empty() && t.back().x == p.x && t.back().y == p.y) continue;
        t.push_back(p);
    }
    if (t.size() >= 2 && t.front().x == t.back().x && t.front().y == t.back().y) t.pop_back();
    return t;
}

// ─────────────────────────────────────────────── one case

struct Case {
    std::string   name;
    TopoDS_Face   face;
    Region        region;
    double        r;
    bool          feasible;
    Expected      exp;      // feasible only
};

std::string describe(const Case& c) {
    return fmt("%s r=%.6g extent=%.6g", c.name.c_str(), c.r, c.region.extent());
}

void runProfile(const Case& c, forge::ShapeHandle h) {
    const std::string who = describe(c);
    forge::cam::Toolpath tp;
    bool threw = false;
    std::string msg;
    try {
        tp = forge::cam::profile(h, 0, toolFor(c.r), paramsFor(c.r), kZTop, kZBottom, 0.0);
    } catch (const std::exception& e) {
        threw = true;
        msg = e.what();
    }
    if (!c.feasible) {
        check(threw, "INFEASIBLE_PROFILE_REFUSES",
              who + (threw ? fmt(" refused: %.160s", msg.c_str())
                           : " RETURNED A TOOLPATH — a gouge reported as success"));
        if (!threw) {
            double worst = std::numeric_limits<double>::infinity();
            for (const CutSeg& s : cuttingSegments(tp))
                worst = std::min(worst, c.region.inside(s.p) && c.region.inside(s.q)
                                            ? c.region.minClearanceSeg(s.p, s.q) : 0.0);
            std::printf("       delivered standoff %.6g of %.6g required (%.1f%% short)\n",
                        worst, c.r, 100.0 * (1.0 - worst / c.r));
        }
        return;
    }
    check(!threw, "FEASIBLE_PROFILE_SUCCEEDS", who + (threw ? " REFUSED: " + msg : ""));
    if (threw) return;

    const Bounds bd = contractBounds(c.region, c.r, c.exp.extent);
    const std::vector<CutSeg> segs = cuttingSegments(tp);
    check(!segs.empty(), "PROFILE_HAS_CUTS", who);

    // 2. inside + standoff, exact.
    double worst = std::numeric_limits<double>::infinity();
    bool allInside = true;
    for (const CutSeg& s : segs) {
        if (!c.region.inside(s.p) || !c.region.inside(s.q)) { allInside = false; continue; }
        worst = std::min(worst, c.region.minClearanceSeg(s.p, s.q));
    }
    check(allInside, "PROFILE_INSIDE_PART", who);
    check(worst >= c.r - bd.low, "PROFILE_STANDOFF",
          who + fmt(" worst clearance %.9g, required >= %.9g (r - %.3g)", worst, c.r - bd.low, bd.low));

    // 3. fidelity: the path is the offset, not merely clear of the part.
    double worstHigh = 0.0;
    const std::vector<P2> tr = firstTrace(tp);
    for (std::size_t i = 0; i < tr.size(); ++i) {
        const P2& p = tr[i];
        const P2& q = tr[(i + 1) % tr.size()];
        for (int k = 0; k <= 32; ++k) {
            const double t = k / 32.0;
            worstHigh = std::max(worstHigh, c.region.clearance({p.x + t * (q.x - p.x), p.y + t * (q.y - p.y)}));
        }
    }
    check(worstHigh <= c.r + bd.high, "PROFILE_FIDELITY",
          who + fmt(" max clearance %.9g, allowed <= %.9g (r + %.3g), trace vertices %zu",
                    worstHigh, c.r + bd.high, bd.high, tr.size()));

    // The observable vector of the trace.
    // Shoelace and centroid are taken RELATIVE TO THE FIRST VERTEX: a 1e-3 mm trace
    // at (250, -125) has cross products of order 3e4 cancelling to an area of order
    // 1e-6, which in absolute coordinates put 3e-3 mm of rounding into the centroid
    // (measured on this gate's first run). Translation does not change either.
    double a2 = 0.0, per = 0.0, gx = 0.0, gy = 0.0;
    double x0 = 1e300, y0 = 1e300, x1 = -1e300, y1 = -1e300;
    const P2 o = tr.empty() ? P2{0.0, 0.0} : tr.front();
    for (std::size_t i = 0; i < tr.size(); ++i) {
        const P2& p = tr[i];
        const P2& q = tr[(i + 1) % tr.size()];
        const double px = p.x - o.x, py = p.y - o.y, qx = q.x - o.x, qy = q.y - o.y;
        const double cr = px * qy - qx * py;
        a2 += cr;
        gx += (px + qx) * cr;
        gy += (py + qy) * cr;
        per += std::hypot(q.x - p.x, q.y - p.y);
        x0 = std::min(x0, p.x); x1 = std::max(x1, p.x);
        y0 = std::min(y0, p.y); y1 = std::max(y1, p.y);
    }
    const double area = 0.5 * a2;
    const double cx = o.x + ((a2 != 0.0) ? gx / (3.0 * a2) : 0.0);
    const double cy = o.y + ((a2 != 0.0) ? gy / (3.0 * a2) : 0.0);
    const double srcSigned = presentedSignedArea(c.face);
    const double band = std::max(bd.low, bd.high);

    check((area > 0) == (srcSigned > 0) && area != 0.0, "TRACE_ORIENTATION",
          who + fmt(" source signed area %.6g, trace signed area %.6g", srcSigned, area));
    check(std::fabs(std::fabs(area) - c.exp.area) <= c.exp.perimeter * band + c.exp.area / 128.0,
          "TRACE_AREA", who + fmt(" |area| %.9g, closed form %.9g", std::fabs(area), c.exp.area));
    check(std::fabs(per - c.exp.perimeter) <= c.exp.perimeter / 128.0 + 8.0 * band,
          "TRACE_PERIMETER", who + fmt(" %.9g, closed form %.9g", per, c.exp.perimeter));
    const double bbTol = band + c.exp.extent * 1e-9;
    check(std::fabs(x0 - c.exp.minX) <= bbTol && std::fabs(x1 - c.exp.maxX) <= bbTol &&
          std::fabs(y0 - c.exp.minY) <= bbTol && std::fabs(y1 - c.exp.maxY) <= bbTol,
          "TRACE_BOUNDS", who + fmt(" [%.9g,%.9g]x[%.9g,%.9g] vs [%.9g,%.9g]x[%.9g,%.9g]",
                                    x0, x1, y0, y1, c.exp.minX, c.exp.maxX, c.exp.minY, c.exp.maxY));
    if (!std::isnan(c.exp.cx)) {
        const double cTol = 8.0 * band + c.exp.extent * 1e-9;
        check(std::fabs(cx - c.exp.cx) <= cTol && std::fabs(cy - c.exp.cy) <= cTol, "TRACE_CENTROID",
              who + fmt(" (%.9g, %.9g) vs (%.9g, %.9g)", cx, cy, c.exp.cx, c.exp.cy));
    } else {
        // L-shape: symmetric about the diagonal through its corner.
        const double cTol = 8.0 * band + c.exp.extent * 1e-9;
        const double ox = c.exp.minX - c.r, oy = c.exp.minY - c.r;   // the L's own corner
        check(std::fabs((cx - ox) - (cy - oy)) <= cTol, "TRACE_CENTROID",
              who + fmt(" (%.9g, %.9g) not symmetric about the L's diagonal", cx - ox, cy - oy));
    }
    if (c.exp.exactVertices > 0)
        check(static_cast<int>(tr.size()) == c.exp.exactVertices, "TRACE_VERTEX_COUNT",
              who + fmt(" %zu, expected %d", tr.size(), c.exp.exactVertices));
    else
        check(static_cast<int>(tr.size()) >= c.exp.minVertices, "TRACE_VERTEX_COUNT",
              who + fmt(" %zu vertices, expected at least %d", tr.size(), c.exp.minVertices));
    if (gVerbose)
        std::printf("       worst standoff %.9g (need >= %.9g), max %.9g, vertices %zu\n",
                    worst, c.r - bd.low, worstHigh, tr.size());
}

void runPocket(const Case& c, forge::ShapeHandle h) {
    const std::string who = describe(c);
    forge::cam::Toolpath tp;
    bool threw = false;
    std::string msg;
    try {
        tp = forge::cam::pocket(h, 0, toolFor(c.r), paramsFor(c.r), kZTop, kZBottom);
    } catch (const std::exception& e) {
        threw = true;
        msg = e.what();
    }
    if (!c.feasible) {
        check(threw, "INFEASIBLE_POCKET_REFUSES",
              who + (threw ? "" : " RETURNED A TOOLPATH — a gouge reported as success"));
        return;
    }
    check(!threw, "FEASIBLE_POCKET_SUCCEEDS", who + (threw ? " REFUSED: " + msg : ""));
    if (threw) return;
    const Bounds bd = contractBounds(c.region, c.r, c.exp.extent);
    double worst = std::numeric_limits<double>::infinity();
    bool allInside = true;
    for (const CutSeg& s : cuttingSegments(tp)) {
        if (!c.region.inside(s.p) || !c.region.inside(s.q)) { allInside = false; continue; }
        worst = std::min(worst, c.region.minClearanceSeg(s.p, s.q));
    }
    // Plunges: a cutting move at the XY of the move before it but a different Z.
    // pocket() plunges once per level for the perimeter and once per raster span.
    int plunges = 0;
    for (std::size_t i = 1; i < tp.moves.size(); ++i) {
        const auto& m = tp.moves[i];
        const auto& p = tp.moves[i - 1];
        if (m.cutting && m.x == p.x && m.y == p.y && m.z != p.z) ++plunges;
    }
    const int rasters = plunges - 1;   // one Z level
    check(allInside, "POCKET_INSIDE_PART", who);
    check(worst >= c.r - bd.low, "POCKET_STANDOFF",
          who + fmt(" worst clearance %.9g, required >= %.9g", worst, c.r - bd.low));
    // The zigzag must exist: the offset region is at least 2r across in y, the
    // raster spacing is r, so at least one row is inside. A pocket that emits only
    // its perimeter leaves the interior uncut while reporting success.
    check(rasters >= 1, "POCKET_RASTERS_PRESENT", who + fmt(" %d raster rows", rasters));
}

// ─────────────────────────────────────────────── case families

std::vector<Case> gCases;

void addSquare(const std::string& tag, P2 c, double s, double r, bool ccw) {
    Case k;
    k.name = fmt("%s square s=%.6g at (%.6g,%.6g) %s", tag.c_str(), s, c.x, c.y, ccw ? "CCW" : "CW");
    const double h = 0.5 * s;
    std::vector<P2> v = {{c.x - h, c.y - h}, {c.x + h, c.y - h}, {c.x + h, c.y + h}, {c.x - h, c.y + h}};
    if (!ccw) std::reverse(v.begin(), v.end());
    k.face = polygonFace(v);
    k.region.kind = Region::Poly;
    k.region.poly = v;
    k.r = r;
    k.feasible = r < 0.5 * s;   // callers only pass r <= 0.45 s or r >= 0.55 s
    const double a = s - 2.0 * r;
    k.exp = {a * a, 4.0 * a, c.x, c.y, c.x - 0.5 * a, c.y - 0.5 * a, c.x + 0.5 * a, c.y + 0.5 * a, a, 4, 4};
    gCases.push_back(k);
}

void addL(P2 o, double s, double r) {
    Case k;
    k.name = fmt("L s=%.6g at (%.6g,%.6g)", s, o.x, o.y);
    std::vector<P2> v = {{o.x, o.y}, {o.x + s, o.y}, {o.x + s, o.y + 0.5 * s},
                         {o.x + 0.5 * s, o.y + 0.5 * s}, {o.x + 0.5 * s, o.y + s}, {o.x, o.y + s}};
    k.face = polygonFace(v);
    k.region.kind = Region::Poly;
    k.region.poly = v;
    k.r = r;
    // Largest inscribed disc of this L is 0.2929 s (centre on the diagonal).
    k.feasible = r <= 0.2 * s;
    // E = [r, s-r]^2 minus (quadrant dilated by r): the rounded reflex corner is a
    // quarter circle of radius r about (s/2, s/2). Valid for r < s/4.
    const double area = (s - 2 * r) * (s - 2 * r) - 0.25 * s * s + r * r * (1.0 - kPi / 4.0);
    const double per = 4.0 * s - 10.0 * r + 0.5 * kPi * r;
    k.exp = {area, per, std::nan(""), std::nan(""), o.x + r, o.y + r, o.x + s - r, o.y + s - r,
             s - 2 * r, 0, 8};
    gCases.push_back(k);
}

void addCircle(P2 c, double R, double r, bool axisDown, bool reverseEdge) {
    Case k;
    k.name = fmt("circle R=%.6g at (%.6g,%.6g)%s%s", R, c.x, c.y, axisDown ? " axis-Z" : "",
                 reverseEdge ? " edge-reversed" : "");
    k.face = circleFace(c, R, axisDown, reverseEdge);
    k.region.kind = Region::Disc;
    k.region.c = c;
    k.region.R = R;
    k.r = r;
    k.feasible = r <= 0.9 * R;
    const double r1 = R - r;
    k.exp = {kPi * r1 * r1, 2.0 * kPi * r1, c.x, c.y, c.x - r1, c.y - r1, c.x + r1, c.y + r1, 2.0 * r1, 0, 16};
    gCases.push_back(k);
}

void addStadium(P2 c, double s, double r) {
    Case k;
    k.name = fmt("stadium s=%.6g at (%.6g,%.6g)", s, c.x, c.y);
    k.face = stadiumFace(c, s);
    k.region.kind = Region::Stadium;
    k.region.a = {c.x - 0.5 * s, c.y};
    k.region.b = {c.x + 0.5 * s, c.y};
    k.region.rho = 0.5 * s;
    k.r = r;
    k.feasible = r <= 0.4 * s;
    const double r1 = 0.5 * s - r;
    k.exp = {2.0 * r1 * s + kPi * r1 * r1, 2.0 * s + 2.0 * kPi * r1, c.x, c.y,
             c.x - 0.5 * s - r1, c.y - r1, c.x + 0.5 * s + r1, c.y + r1, s + 2.0 * r1, 0, 16};
    gCases.push_back(k);
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--verbose") == 0) gVerbose = true;

    // 1. THE ADVERSARY'S THREE CASES, at their exact sizes. Each must refuse.
    addSquare("ADVERSARY", {0.004, 0.004}, 0.008, 0.012, true);
    addSquare("ADVERSARY", {0.005, 0.005}, 0.010, 0.0105, true);
    addSquare("ADVERSARY", {0.005, 0.005}, 0.010, 0.0130, true);

    // 2. THE SWEEP, 1e-3 mm .. 1e3 mm in half decades. The same shapes at every
    //    scale, once at the origin and once far from it (250, -125 mm), so the
    //    rounding floor is exercised where the coordinates are large and the
    //    feature is small.
    const double scales[] = {1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 3e-1, 1.0, 3.0, 10.0, 30.0, 100.0, 300.0, 1e3};
    for (double s : scales) {
        for (P2 at : {P2{0.0, 0.0}, P2{250.0, -125.0}}) {
            for (double f : {0.05, 0.25, 0.45}) addSquare("SWEEP", at, s, f * s, true);
            addSquare("SWEEP", at, s, 0.25 * s, false);
            // infeasible: the adversary's ratios (1.05, 1.3, 1.5) plus the collapse
            // band and far beyond it.
            for (double f : {0.55, 0.75, 1.05, 1.2, 1.3, 1.5, 2.0, 5.0}) addSquare("SWEEP", at, s, f * s, true);

            addL(at, s, 0.05 * s);
            addL(at, s, 0.2 * s);
            for (double f : {0.35, 0.6, 1.2}) addL(at, s, f * s);

            const double R = 0.5 * s;
            for (double f : {0.1, 0.5, 0.9}) addCircle(at, R, f * R, false, false);
            addCircle(at, R, 0.5 * R, true, false);
            addCircle(at, R, 0.5 * R, false, true);
            for (double f : {1.0, 1.2, 3.0}) addCircle(at, R, f * R, false, false);

            addStadium(at, s, 0.1 * s);
            addStadium(at, s, 0.4 * s);
            for (double f : {0.55, 1.2}) addStadium(at, s, f * s);
        }
    }

    // CONTROLS: the CW constructions must really present CW, or the orientation
    // checks above prove nothing.
    {
        const double sq = presentedSignedArea(polygonFace({{0, 0}, {0, 1}, {1, 1}, {1, 0}}));
        check(sq < 0, "CONTROL_CW_SQUARE_PRESENTS_CW", fmt("signed area %.6g", sq));
        const double c1 = presentedSignedArea(circleFace({0, 0}, 1.0, true, false));
        check(c1 < 0, "CONTROL_AXIS_DOWN_CIRCLE_PRESENTS_CW", fmt("signed area %.6g", c1));
        const double c2 = presentedSignedArea(circleFace({0, 0}, 1.0, false, true));
        check(c2 < 0, "CONTROL_REVERSED_CIRCLE_PRESENTS_CW", fmt("signed area %.6g", c2));
        const double c3 = presentedSignedArea(circleFace({0, 0}, 1.0, false, false));
        check(c3 > 0, "CONTROL_PLAIN_CIRCLE_PRESENTS_CCW", fmt("signed area %.6g", c3));
    }

    int feasible = 0, infeasible = 0;
    for (const Case& c : gCases) {
        forge::ShapeHandle h = forge::ShapeRegistry::instance().add(c.face);
        runProfile(c, h);
        runPocket(c, h);
        (c.feasible ? feasible : infeasible)++;
        forge::ShapeRegistry::instance().release(h);
    }

    std::printf("[cam-offset-scale] %zu cases (%d feasible, %d infeasible) x {profile, pocket}, "
                "%d checks, %d failed\n", gCases.size(), feasible, infeasible, gChecks, gFails);
    std::printf("[cam-offset-scale] %s\n", gFails == 0 ? "GREEN" : "RED");
    return gFails == 0 ? 0 : 1;
}
