// step_rational_weights_gate.cpp — T-158. StepAnalytic must write what Forge MEANT.
//
// THE DEFECTS THIS PINS (measured at HEAD b609b41d before the fix, see the run
// script for the failing-first transcript):
//   1. StepAnalytic::write emitted every B-spline surface with the rational flag
//      dropped and NO weights, so the exact rational quarter-circle blend of the
//      variable fillet was written as a polynomial Bezier. Read back by the
//      independent foreign reader, a 1.5 mm blend measured 1.590990 mm at mid-arc
//      (sqrt(2)*3/4 * R, a 6.07 % radial error) -- a wrong answer that read as ok.
//   2. StepAnalytic::read could not read its own output: a Nurbs face came back
//      ok=0, "unsupported analytic surface entity 'B_SPLINE_SURFACE_WITH_KNOTS'",
//      falsifying the round-trip guarantee its header states.
//   3. An edge carrying an exact Edge::curve that is not a quadric latitude arc was
//      written as a straight LINE chord between its endpoints.
//
// THE ORACLE IS CLOSED FORM, NOT ANOTHER WRITER. The variable-radius fillet of a
// box edge is a quarter circle of radius R(t) = R0 + (R1-R0) t/L swept along the
// spine F(t) = F0 + (t/L)(F1-F0). Every point S of the blend at station
// t = (S-F0).e must sit at |S - F(t)| == R(t). The filleted volume is
//     V = L^3 - (1 - pi/4) * L * (R0^2 + R0 R1 + R1^2) / 3.
// Those two facts are checked on the solid READ BACK, by two different readers:
//   * readForeignStep (StepRead.cpp) -- an independently written reader, and
//   * StepAnalytic::read            -- the codec's own reader (the round trip).
// The edge check decodes the written file with its own small decoder below (no
// StepAnalytic code) and asks whether each exact arc edge's written geometry lies
// on the closed-form circle, inside the arc's own angular span.
//
// FOREIGN B-SPLINE FACES. read() integrates a B-spline face over a (u,v)
// rectangle, so a face that is not one must be refused, never read as a wrong
// rectangle: trimmed / holed open patches ([foreign-bspline]) and, since the
// validator's round 1 (2026-10-09), faces of a CLOSED B-spline surface
// ([closed-bspline]): a split rational B-spline cylinder whose 270->360 deg wall
// face read back as u[0,0.75] (ok=1, volume 1182.519 vs 785.398, +50.6 %).
//
// NO-REGRESSION SET. Every analytic builder the codec already handled (box,
// cylinder, cone, sphere, torus, tube, prism, wedge, pyramid, constant-radius
// fillet, torus fillet, chamfer) must still round-trip through StepAnalytic with
// the SAME face count and volume to 1e-9 relative.
//
// usage:
//   step_rational_weights_gate                   run the gate (exit 0/1/2)
//   step_rational_weights_gate --census [--step-list FILE]
//                                                A1 slot census (always exit 0
//                                                unless I/O fails)
#include "forge/native/brep/ChamferAnalytic.hpp"
#include "forge/native/brep/Check.hpp"
#include "forge/native/brep/Curve.hpp"
#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepPart21.hpp"
#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/Topology.hpp"

#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <set>
#include <sstream>
#include <string>
#include <unordered_map>
#include <vector>

using namespace forge::native::brep;

namespace {

constexpr double kPi = 3.14159265358979323846;
int g_checks = 0, g_fail = 0;
void check(bool ok, const std::string& what) {
    ++g_checks;
    std::printf("  %s  %s\n", ok ? "pass" : "FAIL", what.c_str());
    if (!ok) ++g_fail;
}

Vec3 PV(const Point3& p) { return Vec3{p.x, p.y, p.z}; }

std::vector<const Face*> facesOf(const Solid& s) {
    std::vector<const Face*> out;
    for (const Shell* sh : s.shells)
        if (sh) for (const Face* f : sh->faces) if (f) out.push_back(f);
    return out;
}

std::vector<const Coedge*> coedgesOf(const Loop* lp) {
    std::vector<const Coedge*> out;
    if (!lp || !lp->first) return out;
    const Coedge* c = lp->first;
    std::size_t guard = 0;
    do { out.push_back(c); c = c->next; } while (c && c != lp->first && ++guard < 100000);
    return out;
}

struct SlotCount {
    std::size_t faces = 0, edges = 0, edgesWithCurve = 0, coedges = 0, coedgesWithPcurve = 0;
    std::map<std::string, std::size_t> curveKinds;
};

const char* curveKindName(GeomCurveKind k) {
    switch (k) {
    case GeomCurveKind::Line: return "Line";
    case GeomCurveKind::Circle: return "Circle";
    case GeomCurveKind::Ellipse: return "Ellipse";
    case GeomCurveKind::BSpline: return "BSpline";
    case GeomCurveKind::Parabola: return "Parabola";
    case GeomCurveKind::Hyperbola: return "Hyperbola";
    }
    return "?";
}

SlotCount countSlots(const Solid& s) {
    SlotCount c;
    std::set<const Edge*> edges;
    for (const Face* f : facesOf(s)) {
        ++c.faces;
        std::vector<const Loop*> loops{f->outerLoop};
        for (const Loop* h : f->innerLoops) loops.push_back(h);
        for (const Loop* lp : loops)
            for (const Coedge* ce : coedgesOf(lp)) {
                ++c.coedges;
                if (ce->pcurve) ++c.coedgesWithPcurve;
                if (ce->edge) edges.insert(ce->edge);
            }
    }
    c.edges = edges.size();
    for (const Edge* e : edges)
        if (e->curve) { ++c.edgesWithCurve; ++c.curveKinds[curveKindName(e->curve->kind)]; }
    return c;
}

// ---------------------------------------------------------------------------
// The closed-form blend oracle.
// ---------------------------------------------------------------------------
struct BlendTruth {
    Vec3 F0{}, F1{}, e{};
    double L = 0, R0 = 0, R1 = 0;
    double stationOf(const Vec3& p) const { return vdot(vsub(p, F0), e); }
    double radiusAt(double t) const { return R0 + (R1 - R0) * (t / L); }
    Vec3 centreAt(double t) const { return vadd(F0, vscale(vsub(F1, F0), t / L)); }
    double deviation(const Vec3& p) const {
        const double t = stationOf(p);
        return std::fabs(vlen(vsub(p, centreAt(t))) - radiusAt(t));
    }
};

struct RadialReport { bool ok = false; double maxDev = 1e300; double midRadius = 0; double midExpected = 0; };

// Sample a NURBS face's surface on a 9x9 grid over its own knot domain.
RadialReport radialReport(const Surface& s, const BlendTruth& T) {
    RadialReport r;
    if (s.kind != SurfaceKind::Nurbs || !s.nurbs.valid()) return r;
    const NurbsSurface& n = s.nurbs;
    const double u0 = n.knotsU.front(), u1 = n.knotsU.back();
    const double v0 = n.knotsV.front(), v1 = n.knotsV.back();
    r.maxDev = 0.0;
    for (int i = 0; i <= 8; ++i)
        for (int j = 0; j <= 8; ++j) {
            const Vec3 p = n.evaluate(u0 + (u1 - u0) * i / 8.0, v0 + (v1 - v0) * j / 8.0);
            r.maxDev = std::max(r.maxDev, T.deviation(p));
        }
    const Vec3 mid = n.evaluate(0.5 * (u0 + u1), 0.5 * (v0 + v1));
    const double t = T.stationOf(mid);
    r.midRadius = vlen(vsub(mid, T.centreAt(t)));
    r.midExpected = T.radiusAt(t);
    r.ok = true;
    return r;
}

const Surface* firstNurbsSurface(const Solid& s) {
    for (const Face* f : facesOf(s))
        if (f->surface && f->surface->kind == SurfaceKind::Nurbs) return f->surface;
    return nullptr;
}

// Independent validity observable (Check.cpp, the kernel's BRepCheck analogue):
// no predicate that PASSES on the source may FAIL on the solid read back.
std::string g_validityNote;
bool noNewInvalidity(const Solid& src, const Solid& back) {
    const CheckReport a = checkBRep(&src), b = checkBRep(&back);
    std::string broke;
    for (const CheckPredicate& p : a.predicates)
        if (p.passed && b.failedPredicate(p.name)) broke += " " + p.name + "(" + b.find(p.name)->detail + ")";
    g_validityNote = "source " + std::to_string(a.passed()) + "/" + std::to_string(a.total()) +
                     " predicates pass, read-back " + std::to_string(b.passed()) + "/" +
                     std::to_string(b.total()) + (broke.empty() ? "; none newly failing" : "; NEWLY FAILING:" + broke);
    return broke.empty();
}

std::size_t countNurbsFaces(const Solid& s) {
    std::size_t n = 0;
    for (const Face* f : facesOf(s))
        if (f->surface && f->surface->kind == SurfaceKind::Nurbs) ++n;
    return n;
}

// ---------------------------------------------------------------------------
// A small, gate-own decoder for the EDGE geometry of a Part-21 document. It
// shares only the lexer (StepPart21.hpp) with the codec; the meaning of LINE /
// CIRCLE / B_SPLINE_CURVE_WITH_KNOTS (simple and rational complex) is decoded
// here, independently, so a writer bug cannot be mirrored by a reader bug.
// ---------------------------------------------------------------------------
using Table = std::unordered_map<std::uint64_t, p21::Instance>;

bool decPoint(const Table& t, std::uint64_t id, Vec3& out) {
    auto it = t.find(id);
    if (it == t.end() || it->second.type != "CARTESIAN_POINT") return false;
    auto p = p21::splitTopLevel(it->second.params);
    std::vector<std::string> c;
    return p.size() == 2 && p21::parseList(p[1], c) && c.size() == 3 &&
           p21::stepNum(c[0], out.x) && p21::stepNum(c[1], out.y) && p21::stepNum(c[2], out.z);
}
bool decDir(const Table& t, std::uint64_t id, Vec3& out) {
    auto it = t.find(id);
    if (it == t.end() || it->second.type != "DIRECTION") return false;
    auto p = p21::splitTopLevel(it->second.params);
    std::vector<std::string> c;
    return p.size() == 2 && p21::parseList(p[1], c) && c.size() == 3 &&
           p21::stepNum(c[0], out.x) && p21::stepNum(c[1], out.y) && p21::stepNum(c[2], out.z);
}

// Split "A(..)B(..)" (the lexer's params of a complex instance) into records.
std::vector<std::pair<std::string, std::string>> decComplex(const std::string& s) {
    std::vector<std::pair<std::string, std::string>> out;
    std::size_t i = 0, n = s.size();
    while (i < n) {
        while (i < n && std::isspace(static_cast<unsigned char>(s[i]))) ++i;
        std::size_t tb = i;
        while (i < n && (s[i] == '_' || std::isupper(static_cast<unsigned char>(s[i])) ||
                         std::isdigit(static_cast<unsigned char>(s[i])))) ++i;
        if (i == tb || i >= n || s[i] != '(') break;
        int depth = 0; std::size_t j = i;
        for (; j < n; ++j) {
            if (s[j] == '(') ++depth;
            else if (s[j] == ')' && --depth == 0) break;
        }
        if (j >= n) break;
        out.emplace_back(s.substr(tb, i - tb), s.substr(i + 1, j - i - 1));
        i = j + 1;
    }
    return out;
}

bool decRealList(const std::string& tok, std::vector<double>& out) {
    std::vector<std::string> f;
    if (!p21::parseList(tok, f)) return false;
    out.clear();
    for (auto& x : f) { double v; if (!p21::stepNum(x, v)) return false; out.push_back(v); }
    return true;
}

// Sample the written geometry of an EDGE_CURVE strictly inside the edge.
// Returns false if the geometry kind is not decodable here.
bool sampleEdgeCurve(const Table& t, std::uint64_t ecId, std::vector<Vec3>& samples,
                     std::string& kind) {
    auto eit = t.find(ecId);
    if (eit == t.end() || eit->second.type != "EDGE_CURVE") return false;
    auto ep = p21::splitTopLevel(eit->second.params);
    if (ep.size() != 5) return false;
    std::uint64_t vs = 0, ve = 0, cid = 0;
    if (!p21::parseRef(ep[1], vs) || !p21::parseRef(ep[2], ve) || !p21::parseRef(ep[3], cid)) return false;
    const bool sense = (ep[4] == ".T.");
    auto vpPoint = [&](std::uint64_t vp, Vec3& out) {
        auto it = t.find(vp);
        if (it == t.end()) return false;
        auto p = p21::splitTopLevel(it->second.params);
        std::uint64_t cp = 0;
        return p.size() == 2 && p21::parseRef(p[1], cp) && decPoint(t, cp, out);
    };
    Vec3 A, B;
    if (!vpPoint(vs, A) || !vpPoint(ve, B)) return false;
    auto cit = t.find(cid);
    if (cit == t.end()) return false;
    samples.clear();
    const std::string& ty = cit->second.type;
    if (ty == "LINE") {
        kind = "LINE";
        for (double f : {0.25, 0.5, 0.75}) samples.push_back(vadd(A, vscale(vsub(B, A), f)));
        return true;
    }
    if (ty == "CIRCLE") {
        kind = "CIRCLE";
        auto cp = p21::splitTopLevel(cit->second.params);
        std::uint64_t ax = 0; double r = 0;
        if (cp.size() != 3 || !p21::parseRef(cp[1], ax) || !p21::stepNum(cp[2], r)) return false;
        auto ait = t.find(ax);
        if (ait == t.end()) return false;
        auto ap = p21::splitTopLevel(ait->second.params);
        std::uint64_t o = 0, a = 0, x = 0;
        Vec3 C, N, X;
        if (ap.size() != 4 || !p21::parseRef(ap[1], o) || !p21::parseRef(ap[2], a) ||
            !p21::parseRef(ap[3], x) || !decPoint(t, o, C) || !decDir(t, a, N) || !decDir(t, x, X))
            return false;
        N = vnorm(N); X = vnorm(vsub(X, vscale(N, vdot(X, N)))); const Vec3 Y = vcross(N, X);
        auto ang = [&](const Vec3& p) { Vec3 q = vsub(p, C); return std::atan2(vdot(q, Y), vdot(q, X)); };
        double a0 = ang(A), a1 = ang(B);
        // .T.: counter-clockwise (increasing angle) from A to B; .F.: the reverse.
        double span = sense ? a1 - a0 : a0 - a1;
        while (span <= 0) span += 2 * kPi;
        while (span > 2 * kPi) span -= 2 * kPi;
        for (double f : {0.25, 0.5, 0.75}) {
            const double th = sense ? a0 + f * span : a0 - f * span;
            samples.push_back(vadd(C, vadd(vscale(X, r * std::cos(th)), vscale(Y, r * std::sin(th)))));
        }
        return true;
    }
    // B-spline curve: simple B_SPLINE_CURVE_WITH_KNOTS, or the rational complex.
    std::string base, knots, rational;
    if (ty == "B_SPLINE_CURVE_WITH_KNOTS") {
        auto f = p21::splitTopLevel(cit->second.params);
        // name, degree, ctrl, form, closed, selfint, mults, knots, spec
        if (f.size() < 9) return false;
        base = f[1] + "," + f[2] + "," + f[3] + "," + f[4] + "," + f[5];
        knots = f[6] + "," + f[7] + "," + f[8];
        kind = "B_SPLINE_CURVE_WITH_KNOTS";
    } else if (ty.empty()) {
        for (auto& sr : decComplex(cit->second.params)) {
            if (sr.first == "B_SPLINE_CURVE") base = sr.second;
            else if (sr.first == "B_SPLINE_CURVE_WITH_KNOTS") knots = sr.second;
            else if (sr.first == "RATIONAL_B_SPLINE_CURVE") rational = sr.second;
        }
        if (base.empty() || knots.empty()) return false;
        kind = rational.empty() ? "B_SPLINE_CURVE(complex)" : "RATIONAL_B_SPLINE_CURVE";
    } else {
        kind = ty;
        return false;
    }
    auto bf = p21::splitTopLevel(base);
    auto kf = p21::splitTopLevel(knots);
    if (bf.size() < 2 || kf.size() < 2) return false;
    NurbsCurve nc;
    double deg = 0;
    if (!p21::stepNum(bf[0], deg)) return false;
    nc.degree = static_cast<std::size_t>(deg);
    std::vector<std::string> refs;
    if (!p21::parseList(bf[1], refs)) return false;
    for (auto& rf : refs) {
        std::uint64_t id = 0; Vec3 P;
        if (!p21::parseRef(rf, id) || !decPoint(t, id, P)) return false;
        nc.controlPoints.push_back(P);
    }
    nc.weights.assign(nc.controlPoints.size(), 1.0);
    if (!rational.empty()) {
        auto rf = p21::splitTopLevel(rational);
        if (rf.empty() || !decRealList(rf[0], nc.weights)) return false;
    }
    std::vector<double> mult, kv;
    if (!decRealList(kf[0], mult) || !decRealList(kf[1], kv) || mult.size() != kv.size()) return false;
    for (std::size_t k = 0; k < kv.size(); ++k)
        for (int m = 0; m < static_cast<int>(mult[k]); ++m) nc.knots.push_back(kv[k]);
    if (!nc.valid()) return false;
    const double lo = nc.knots.front(), hi = nc.knots.back();
    for (double f : {0.25, 0.5, 0.75}) samples.push_back(nc.evaluate(lo + f * (hi - lo)));
    return true;
}

// Find the EDGE_CURVE whose two VERTEX_POINTs sit at a and b (either order).
std::uint64_t findEdgeCurve(const Table& t, const Vec3& a, const Vec3& b) {
    auto vpPoint = [&](const std::string& ref, Vec3& out) {
        std::uint64_t vp = 0;
        if (!p21::parseRef(ref, vp)) return false;
        auto it = t.find(vp);
        if (it == t.end() || it->second.type != "VERTEX_POINT") return false;
        auto p = p21::splitTopLevel(it->second.params);
        std::uint64_t cp = 0;
        return p.size() == 2 && p21::parseRef(p[1], cp) && decPoint(t, cp, out);
    };
    for (const auto& kv : t) {
        if (kv.second.type != "EDGE_CURVE") continue;
        auto ep = p21::splitTopLevel(kv.second.params);
        if (ep.size() != 5) continue;
        Vec3 P, Q;
        if (!vpPoint(ep[1], P) || !vpPoint(ep[2], Q)) continue;
        const double d1 = vlen(vsub(P, a)) + vlen(vsub(Q, b));
        const double d2 = vlen(vsub(P, b)) + vlen(vsub(Q, a));
        if (std::min(d1, d2) < 1e-9) return kv.first;
    }
    return 0;
}

// A closed-form arc: centre, unit normal, unit ref toward the start, radius,
// and the signed angular span from the start (positive = CCW about normal).
struct ArcTruth { Vec3 c{}, n{}, x{}; double r = 0, span = 0; Vec3 a{}, b{}; };

ArcTruth arcFromCurve(const Curve& cv) {
    ArcTruth T;
    T.c = cv.origin; T.n = vnorm(cv.normal); T.x = vnorm(cv.refDir); T.r = cv.r;
    // re-base so the arc starts at angle 0 of `x`
    const Vec3 y = vcross(T.n, T.x);
    const Vec3 s = cv.evaluate(cv.t0);
    const Vec3 q = vsub(s, T.c);
    const Vec3 xs = vnorm(q);
    (void)y;
    T.x = xs;
    T.span = cv.t1 - cv.t0;
    T.a = cv.evaluate(cv.t0); T.b = cv.evaluate(cv.t1);
    return T;
}

// Deviation of p from the closed-form arc (radius error + out-of-plane + outside
// the arc's own angular span).
double arcDeviation(const ArcTruth& T, const Vec3& p) {
    const Vec3 q = vsub(p, T.c);
    const double h = vdot(q, T.n);
    const Vec3 inPlane = vsub(q, vscale(T.n, h));
    const double radial = std::fabs(vlen(inPlane) - T.r);
    const Vec3 y = vcross(T.n, T.x);
    double th = std::atan2(vdot(inPlane, y), vdot(inPlane, T.x));   // (-pi, pi]
    double outside = 0.0;
    const double lo = std::min(0.0, T.span), hi = std::max(0.0, T.span);
    if (th < lo - 1e-9 || th > hi + 1e-9) {
        // distance measured along the circle to the nearer arc end
        const double d = std::min(std::fabs(th - lo), std::fabs(th - hi));
        outside = d * T.r;
    }
    return radial + std::fabs(h) + outside;
}

// ---------------------------------------------------------------------------
// The variable-fillet fixture.
// ---------------------------------------------------------------------------
struct BlendFixture {
    std::unique_ptr<TopologyBuilder> tb;
    AnalyticVariableFilletResult vf;
    BlendTruth truth;
    double volumeTruth = 0;
};

BlendFixture makeBlend(double L, double R0, double R1) {
    BlendFixture F;
    F.tb = std::make_unique<TopologyBuilder>();
    F.vf = filletBoxEdgeVariable(*F.tb, L, R0, R1, /*edgeIndex=*/4);
    F.truth.F0 = F.vf.axisStart; F.truth.F1 = F.vf.axisEnd; F.truth.e = vnorm(F.vf.axisDir);
    F.truth.L = L; F.truth.R0 = R0; F.truth.R1 = R1;
    F.volumeTruth = L * L * L - (1.0 - kPi / 4.0) * L * (R0 * R0 + R0 * R1 + R1 * R1) / 3.0;
    return F;
}

// The exact arc edges of a solid: every Edge whose Edge::curve is a Circle.
std::vector<std::pair<const Edge*, ArcTruth>> arcEdges(const Solid& s) {
    std::vector<std::pair<const Edge*, ArcTruth>> out;
    std::set<const Edge*> seen;
    for (const Face* f : facesOf(s))
        for (const Coedge* ce : coedgesOf(f->outerLoop))
            if (ce->edge && ce->edge->curve && ce->edge->curve->kind == GeomCurveKind::Circle &&
                seen.insert(ce->edge).second)
                out.emplace_back(ce->edge, arcFromCurve(*ce->edge->curve));
    return out;
}

// File-level edge check: each exact arc edge's WRITTEN geometry lies on its arc.
double writtenArcDeviation(const std::string& text,
                           const std::vector<std::pair<const Edge*, ArcTruth>>& arcs,
                           std::string& kinds) {
    std::size_t dB = 0, dE = 0; std::string why;
    Table tab;
    if (!p21::locateSections(text, dB, dE, why) || !p21::parseInstances(text, dB, dE, tab, why))
        return 1e300;
    double worst = 0.0;
    kinds.clear();
    for (const auto& ea : arcs) {
        const std::uint64_t ec = findEdgeCurve(tab, PV(ea.first->start->point), PV(ea.first->end->point));
        if (ec == 0) return 1e300;
        std::vector<Vec3> smp; std::string kind;
        if (!sampleEdgeCurve(tab, ec, smp, kind)) { kinds += kind + "(undecodable) "; return 1e300; }
        kinds += kind + " ";
        for (const Vec3& p : smp) worst = std::max(worst, arcDeviation(ea.second, p));
    }
    return worst;
}

// Read-back edge check: the edge between the arc's endpoints in the READ solid
// carries a curve, and that curve's interior lies on the closed-form arc.
double readBackArcDeviation(const Solid& rs,
                            const std::vector<std::pair<const Edge*, ArcTruth>>& arcs,
                            std::string& kinds) {
    std::set<const Edge*> edges;
    for (const Face* f : facesOf(rs)) {
        std::vector<const Loop*> loops{f->outerLoop};
        for (const Loop* h : f->innerLoops) loops.push_back(h);
        for (const Loop* lp : loops) for (const Coedge* ce : coedgesOf(lp)) if (ce->edge) edges.insert(ce->edge);
    }
    double worst = 0.0;
    kinds.clear();
    for (const auto& ea : arcs) {
        const Vec3 a = ea.second.a, b = ea.second.b;
        const Edge* hit = nullptr;
        for (const Edge* e : edges) {
            const Vec3 s = PV(e->start->point), t = PV(e->end->point);
            if (std::min(vlen(vsub(s, a)) + vlen(vsub(t, b)), vlen(vsub(s, b)) + vlen(vsub(t, a))) < 1e-9) { hit = e; break; }
        }
        if (!hit) { kinds += "missing "; return 1e300; }
        if (!hit->curve) { kinds += "no-curve "; return 1e300; }
        kinds += std::string(curveKindName(hit->curve->kind)) + " ";
        const Curve& c = *hit->curve;
        for (double f : {0.25, 0.5, 0.75})
            worst = std::max(worst, arcDeviation(ea.second, c.evaluate(c.t0 + f * (c.t1 - c.t0))));
        // the curve must also run from the edge's start to its end
        worst = std::max(worst, vlen(vsub(c.evaluate(c.t0), PV(hit->start->point))));
        worst = std::max(worst, vlen(vsub(c.evaluate(c.t1), PV(hit->end->point))));
    }
    return worst;
}

// ---------------------------------------------------------------------------
// One blend case: write, read back two ways, compare to closed form.
// ---------------------------------------------------------------------------
void runBlendCase(const char* tag, double L, double R0, double R1, bool splineEdge) {
    std::printf("[%s] variable fillet L=%.3f R0=%.6f R1=%.6f%s\n", tag, L, R0, R1,
                splineEdge ? "  (end arc re-bound as an exact RATIONAL B-spline edge)" : "");
    BlendFixture F = makeBlend(L, R0, R1);
    if (!F.vf.ok || !F.vf.solid) {
        std::printf("  FATAL: fixture did not build: %s\n", F.vf.reason);
        ++g_fail; return;
    }
    const Solid& src = *F.vf.solid;
    const Surface* ns = firstNurbsSurface(src);
    bool rational = false;
    if (ns) for (auto& row : ns->nurbs.weights) for (double w : row) if (w != 1.0) rational = true;
    check(ns && rational, std::string(tag) + " fixture: the blend is a Nurbs surface with non-unit weights");
    const auto arcs0 = arcEdges(src);
    check(arcs0.size() >= 2, std::string(tag) + " fixture: the blend's end arcs carry exact Circle Edge::curve (" +
          std::to_string(arcs0.size()) + " edges)");
    {
        RadialReport rr = ns ? radialReport(*ns, F.truth) : RadialReport{};
        check(rr.ok && rr.maxDev <= 1e-12,
              std::string(tag) + " oracle self-check: the IN-MEMORY blend is exact (max dev " +
              std::to_string(rr.maxDev) + ")");
        const MassProps mp = massProperties(src);
        const double rel = std::fabs(mp.volume - F.volumeTruth) / F.volumeTruth;
        char buf[160];
        std::snprintf(buf, sizeof buf, " oracle self-check: in-memory volume %.9f vs closed form %.9f (rel %.2e)",
                      mp.volume, F.volumeTruth, rel);
        check(rel <= 1e-9, std::string(tag) + buf);
    }

    // Optional: replace one exact Circle edge by the SAME arc as a rational B-spline.
    std::vector<std::pair<const Edge*, ArcTruth>> arcs = arcs0;
    if (splineEdge && !arcs.empty()) {
        Edge* e = const_cast<Edge*>(arcs.front().first);
        const ArcTruth& T = arcs.front().second;
        const Curve& c = *e->curve;
        // Quarter (or general <= pi/2) arc as a rational quadratic Bezier.
        const double half = 0.5 * (c.t1 - c.t0);
        const Vec3 P0 = c.evaluate(c.t0), P2 = c.evaluate(c.t1);
        const Vec3 mid = c.evaluate(0.5 * (c.t0 + c.t1));
        const Vec3 dirM = vnorm(vsub(mid, c.origin));
        const Vec3 P1 = vadd(c.origin, vscale(dirM, c.r / std::cos(half)));
        NurbsCurve nc;
        nc.degree = 2;
        nc.controlPoints = {P0, P1, P2};
        nc.weights = {1.0, std::cos(half), 1.0};
        nc.knots = {0, 0, 0, 1, 1, 1};
        Curve b = Curve::makeBSpline(nc);
        b.t0 = 0.0; b.t1 = 1.0;
        // keep Edge::curve's start->end convention
        if (vlen(vsub(P0, PV(e->start->point))) > 1e-9) { std::swap(b.t0, b.t1); }
        e->curve = F.tb->makeCurve(b);
        (void)T;
        check(e->curve->kind == GeomCurveKind::BSpline &&
              arcDeviation(T, e->curve->evaluate(0.5)) <= 1e-12,
              std::string(tag) + " fixture: the re-bound B-spline edge is exactly the arc");
    }

    const AnalyticWriteResult w = StepAnalytic::write(src);
    check(w.ok, std::string(tag) + " StepAnalytic::write ok" + (w.ok ? "" : (" — " + w.reason)));
    if (!w.ok) return;
    std::printf("        written: rationalSurfaces=%zu edges fromCurve=%zu inferredArc=%zu line=%zu CHORD=%zu\n",
                w.rationalSurfaces, w.edgesFromCurve, w.edgesInferredArc, w.edgesLine, w.edgesChord);
    check(w.edgesChord == 0, std::string(tag) + " no edge of the blend solid is written as an unverified chord");

    // ---- E: the written EDGE geometry (decoded by this gate) ----------------
    {
        std::string kinds;
        const double dev = writtenArcDeviation(w.text, arcs, kinds);
        char buf[200];
        std::snprintf(buf, sizeof buf, " WRITTEN arc edges lie on their closed-form arcs: max dev %.3e mm  [%s]",
                      dev, kinds.c_str());
        check(dev <= 1e-9, std::string(tag) + buf);
    }

    // ---- R1: the INDEPENDENT reader ----------------------------------------
    {
        const ForeignReadResult fr = readForeignStep(w.text);
        const bool usable = fr.ok && fr.solid && fr.unsupported.empty();
        std::string unsup;
        for (const auto& kv : fr.unsupported) unsup += " " + kv.first + "x" + std::to_string(kv.second);
        check(usable, std::string(tag) + " readForeignStep reads the written file" +
              (!fr.ok ? (" — " + fr.reason) : (unsup.empty() ? "" : (" — unsupported:" + unsup))));
        // Sample the surface whenever a solid came back (even with unsupported
        // edges), so a wrong surface is MEASURED, not merely flagged unreadable.
        if (fr.ok && fr.solid) {
            const Surface* rs = firstNurbsSurface(*fr.solid);
            RadialReport rr = rs ? radialReport(*rs, F.truth) : RadialReport{};
            char buf[240];
            std::snprintf(buf, sizeof buf,
                          " [independent reader] blend radius at mid-arc %.6f mm (expected %.6f, err %.4f %%); "
                          "max |dev| over 9x9 grid %.3e mm",
                          rr.midRadius, rr.midExpected,
                          rr.midExpected > 0 ? 100.0 * (rr.midRadius - rr.midExpected) / rr.midExpected : 0.0,
                          rr.maxDev);
            check(rr.ok && rr.maxDev <= 1e-9, std::string(tag) + buf);
        }
    }

    // ---- R2: the codec's OWN reader (the round-trip guarantee) -------------
    {
        const AnalyticReadResult r = StepAnalytic::read(w.text);
        check(r.ok && r.solid, std::string(tag) + " StepAnalytic::read reads its own output" +
              (r.ok ? "" : (" — " + r.reason)));
        if (!(r.ok && r.solid)) return;
        const Solid& rs = *r.solid;
        const Surface* s = firstNurbsSurface(rs);
        RadialReport rr = s ? radialReport(*s, F.truth) : RadialReport{};
        char buf[240];
        std::snprintf(buf, sizeof buf,
                      " [StepAnalytic::read] blend radius at mid-arc %.6f mm (expected %.6f); max |dev| %.3e mm",
                      rr.midRadius, rr.midExpected, rr.maxDev);
        check(rr.ok && rr.maxDev <= 1e-9, std::string(tag) + buf);

        const SlotCount a = countSlots(src), b = countSlots(rs);
        check(a.faces == b.faces && a.edges == b.edges && countNurbsFaces(src) == countNurbsFaces(rs),
              std::string(tag) + " topology round-trips: faces " + std::to_string(a.faces) + "->" +
              std::to_string(b.faces) + ", edges " + std::to_string(a.edges) + "->" + std::to_string(b.edges) +
              ", nurbs faces " + std::to_string(countNurbsFaces(src)) + "->" + std::to_string(countNurbsFaces(rs)));

        check(noNewInvalidity(src, rs), std::string(tag) + " checkBRep: " + g_validityNote);

        const MassProps mp = massProperties(rs);
        const double rel = std::fabs(mp.volume - F.volumeTruth) / F.volumeTruth;
        std::snprintf(buf, sizeof buf, " read-back volume %.9f vs closed form %.9f (rel %.2e)",
                      mp.volume, F.volumeTruth, rel);
        check(rel <= 1e-9, std::string(tag) + buf);

        std::string kinds;
        const double dev = readBackArcDeviation(rs, arcs, kinds);
        std::snprintf(buf, sizeof buf, " READ-BACK arc edges carry their exact curve: max dev %.3e mm  [%s]",
                      dev, kinds.c_str());
        check(dev <= 1e-9, std::string(tag) + buf);
    }
}

// ---------------------------------------------------------------------------
// FOREIGN B-SPLINE FACES. Reading B-spline faces made StepAnalytic::read accept
// files it used to refuse -- and importStep() tries it FIRST, before the foreign
// reader. A B-spline face is read back as the (u,v) rectangle of its loop
// vertices, so a file whose B-spline face is TRIMMED (or holed) must be refused
// (the ladder then falls through to readForeignStep, as before) -- never read as
// the whole rectangle. These files are generated here, independently of the
// codec's writer, from planar polyhedra with closed-form volumes; one face is
// re-expressed as a bilinear B-spline patch S(u,v) = P0 + u(Pu-P0) + v(Pv-P0).
// ---------------------------------------------------------------------------
struct PolyFace {
    std::vector<int> outer;                 // vertex indices
    std::vector<std::vector<int>> holes;
    Vec3 n{};                               // outward unit normal
    bool bspline = false;                   // write as a bilinear B-spline patch
    Vec3 P0{}, Pu{}, Pv{};                  // patch corners (S_u x S_v must be outward)
};

std::string polyhedronStep(const std::vector<Vec3>& V, const std::vector<PolyFace>& F) {
    std::string d;
    int id = 0;
    auto num = [](double x) { char b[40]; std::snprintf(b, sizeof b, "%.17g", x);
                              std::string s = b; if (s.find_first_of(".eE") == std::string::npos) s += '.'; return s; };
    auto pt = [&](const Vec3& p) { ++id; d += "#" + std::to_string(id) + "=CARTESIAN_POINT('',(" + num(p.x) + "," +
                                   num(p.y) + "," + num(p.z) + "));\n"; return id; };
    auto dir = [&](const Vec3& p) { ++id; d += "#" + std::to_string(id) + "=DIRECTION('',(" + num(p.x) + "," +
                                    num(p.y) + "," + num(p.z) + "));\n"; return id; };
    std::vector<int> vp(V.size());
    for (std::size_t i = 0; i < V.size(); ++i) {
        const int p = pt(V[i]);
        ++id; d += "#" + std::to_string(id) + "=VERTEX_POINT('',#" + std::to_string(p) + ");\n";
        vp[i] = id;
    }
    std::map<std::pair<int, int>, int> edge;   // (lo,hi) -> EDGE_CURVE id, start = lo
    auto edgeOf = [&](int a, int b) {
        const auto key = std::make_pair(std::min(a, b), std::max(a, b));
        auto it = edge.find(key);
        if (it != edge.end()) return it->second;
        const Vec3 A = V[key.first], B = V[key.second];
        const int p = pt(A), dr = dir(vnorm(vsub(B, A)));
        ++id; d += "#" + std::to_string(id) + "=VECTOR('',#" + std::to_string(dr) + "," + num(vlen(vsub(B, A))) + ");\n";
        const int vec = id;
        ++id; d += "#" + std::to_string(id) + "=LINE('',#" + std::to_string(p) + ",#" + std::to_string(vec) + ");\n";
        const int ln = id;
        ++id; d += "#" + std::to_string(id) + "=EDGE_CURVE('',#" + std::to_string(vp[key.first]) + ",#" +
                   std::to_string(vp[key.second]) + ",#" + std::to_string(ln) + ",.T.);\n";
        edge.emplace(key, id);
        return id;
    };
    auto newell = [&](const std::vector<int>& L) {
        Vec3 nn{0, 0, 0};
        for (std::size_t i = 0; i < L.size(); ++i) nn = vadd(nn, vcross(V[L[i]], V[L[(i + 1) % L.size()]]));
        return nn;
    };
    auto loop = [&](std::vector<int> L, bool outer, const Vec3& n) {
        const bool ccw = vdot(newell(L), n) > 0;
        if (ccw != outer) std::reverse(L.begin(), L.end());   // outer CCW, holes CW about n
        std::string oes = "(";
        for (std::size_t i = 0; i < L.size(); ++i) {
            const int a = L[i], b = L[(i + 1) % L.size()];
            const int ec = edgeOf(a, b);
            ++id; d += "#" + std::to_string(id) + "=ORIENTED_EDGE('',*,*,#" + std::to_string(ec) +
                       (a < b ? ",.T.);\n" : ",.F.);\n");
            if (i) oes += ",";
            oes += "#" + std::to_string(id);
        }
        ++id; d += "#" + std::to_string(id) + "=EDGE_LOOP(''," + oes + "));\n";
        const int el = id;
        ++id; d += "#" + std::to_string(id) + (outer ? "=FACE_OUTER_BOUND('',#" : "=FACE_BOUND('',#") +
                   std::to_string(el) + ",.T.);\n";
        return id;
    };
    std::string faces = "(";
    for (std::size_t k = 0; k < F.size(); ++k) {
        const PolyFace& f = F[k];
        std::string bounds = "(#" + std::to_string(loop(f.outer, true, f.n));
        for (const auto& h : f.holes) bounds += ",#" + std::to_string(loop(h, false, f.n));
        bounds += ")";
        int surf = 0;
        if (f.bspline) {
            const Vec3 P11 = vadd(f.Pu, vsub(f.Pv, f.P0));
            const int a = pt(f.P0), b = pt(f.Pv), c = pt(f.Pu), e = pt(P11);
            ++id; d += "#" + std::to_string(id) + "=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#" + std::to_string(a) + ",#" +
                       std::to_string(b) + "),(#" + std::to_string(c) + ",#" + std::to_string(e) +
                       ")),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);\n";
            surf = id;
        } else {
            Vec3 ref = vcross(f.n, Vec3{0, 0, 1});
            if (vlen(ref) < 1e-9) ref = vcross(f.n, Vec3{1, 0, 0});
            const int o = pt(V[f.outer[0]]), z = dir(f.n), x = dir(vnorm(ref));
            ++id; d += "#" + std::to_string(id) + "=AXIS2_PLACEMENT_3D('',#" + std::to_string(o) + ",#" +
                       std::to_string(z) + ",#" + std::to_string(x) + ");\n";
            const int ax = id;
            ++id; d += "#" + std::to_string(id) + "=PLANE('',#" + std::to_string(ax) + ");\n";
            surf = id;
        }
        ++id; d += "#" + std::to_string(id) + "=ADVANCED_FACE(''," + bounds + ",#" + std::to_string(surf) + ",.T.);\n";
        if (k) faces += ",";
        faces += "#" + std::to_string(id);
    }
    ++id; d += "#" + std::to_string(id) + "=CLOSED_SHELL(''," + faces + "));\n";
    const int sh = id;
    ++id; d += "#" + std::to_string(id) + "=MANIFOLD_SOLID_BREP('foreign',#" + std::to_string(sh) + ");\n";
    return "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('foreign.step','',(''),(''),'','','');\n"
           "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n" + d + "ENDSEC;\nEND-ISO-10303-21;\n";
}

// Tetrahedron O,A,B,C (edge 10): the slanted face ABC is the half of the patch
// A + u(B-A) + v(C-A) cut by the diagonal -- a TRIMMED B-spline face.
std::string tetraStep(bool bsplineFace) {
    const std::vector<Vec3> V{{0, 0, 0}, {10, 0, 0}, {0, 10, 0}, {0, 0, 10}};
    std::vector<PolyFace> F(4);
    F[0].outer = {0, 1, 2}; F[0].n = {0, 0, -1};
    F[1].outer = {0, 1, 3}; F[1].n = {0, -1, 0};
    F[2].outer = {0, 2, 3}; F[2].n = {-1, 0, 0};
    F[3].outer = {1, 2, 3}; F[3].n = vnorm(Vec3{1, 1, 1});
    if (bsplineFace) { F[3].bspline = true; F[3].P0 = V[1]; F[3].Pu = V[2]; F[3].Pv = V[3]; }
    return polyhedronStep(V, F);
}

// Box [0,10]^3, optionally with a [4,6]x[4,6] through-hole along z; the top face
// (z = 10) optionally a B-spline patch over the whole [0,10]^2 square.
std::string boxStep(bool hole, bool bsplineTop) {
    std::vector<Vec3> V{{0, 0, 0}, {10, 0, 0}, {10, 10, 0}, {0, 10, 0},
                        {0, 0, 10}, {10, 0, 10}, {10, 10, 10}, {0, 10, 10}};
    if (hole) {
        for (double z : {0.0, 10.0}) {
            V.push_back({4, 4, z}); V.push_back({6, 4, z}); V.push_back({6, 6, z}); V.push_back({4, 6, z});
        }
    }
    std::vector<PolyFace> F;
    auto quad = [&](std::vector<int> q, Vec3 n) { PolyFace f; f.outer = std::move(q); f.n = n; F.push_back(f); };
    quad({0, 1, 2, 3}, {0, 0, -1});
    quad({4, 5, 6, 7}, {0, 0, 1});
    quad({0, 1, 5, 4}, {0, -1, 0});
    quad({1, 2, 6, 5}, {1, 0, 0});
    quad({2, 3, 7, 6}, {0, 1, 0});
    quad({3, 0, 4, 7}, {-1, 0, 0});
    if (hole) {
        F[0].holes.push_back({8, 9, 10, 11});
        F[1].holes.push_back({12, 13, 14, 15});
        quad({8, 9, 13, 12}, {0, 1, 0});     // y = 4 wall, material at y < 4
        quad({9, 10, 14, 13}, {-1, 0, 0});   // x = 6 wall
        quad({10, 11, 15, 14}, {0, -1, 0});  // y = 6 wall
        quad({11, 8, 12, 15}, {1, 0, 0});    // x = 4 wall
    }
    if (bsplineTop) {
        F[1].bspline = true;
        F[1].P0 = V[4]; F[1].Pu = V[5]; F[1].Pv = V[7];      // (10,0,0)x(0,10,0) = +z
    }
    return polyhedronStep(V, F);
}

// A CLOSED B-spline surface (validator round 1, 2026-10-09). The exact rational
// quadratic circle -- 9 control points, knots (0,.25,.5,.75,1), weights
// 1,sqrt(1/2),1,... -- extruded to a cylinder r = 5, h = 10, whose first and last
// control rows COINCIDE: the knot domain closes on itself at u = 0 == u = 1 (the
// SEAM). The lateral wall is split along the axis into one face per pair of
// consecutive angles in `splitsDeg` (ascending, in [0,360)); the caps are planes
// bounded by the circle arcs. A loop vertex ON the seam inverts to u = 0 or u = 1
// indistinguishably, so the face ending at 360 deg was read back as the box
// u[0,0.75] instead of u[0.75,1] -- ok=1, volume +50.6 %. A face whose arc
// crosses the seam (e.g. 315 -> 45) has NO rectangle inside the knot domain at
// all. With `circleAlongV` the circle runs along v instead (control order
// reversed, so S_u x S_v stays outward; the seam is v = 0 == v = 1). A non-empty
// `wallSplitsDeg` (a subset of `splitsDeg`, which still splits the cap arcs)
// cuts the wall only there, so one wall face can run over several arcs.
// Closed form: volume pi r^2 h, area 2 pi r h + 2 pi r^2.
std::string splitCylinderStep(const std::vector<double>& splitsDeg, bool circleAlongV,
                              const std::vector<double>& wallSplitsDeg = {}) {
    const double R = 5.0, H = 10.0;
    std::string d;
    int id = 0;
    auto num = [](double x) { char b[40]; std::snprintf(b, sizeof b, "%.17g", x);
                              std::string s = b; if (s.find_first_of(".eE") == std::string::npos) s += '.'; return s; };
    auto ent = [&](const std::string& body) { ++id; d += "#" + std::to_string(id) + "=" + body + ";\n"; return id; };
    auto ref = [](int i) { return "#" + std::to_string(i); };
    auto pt = [&](double x, double y, double z) {
        return ent("CARTESIAN_POINT('',(" + num(x) + "," + num(y) + "," + num(z) + "))"); };
    auto at = [&](double deg, double z, int& out) {
        const double a = deg * kPi / 180.0;
        out = pt(R * std::cos(a), R * std::sin(a), z);
    };
    const std::size_t k = splitsDeg.size();
    std::map<std::pair<std::size_t, int>, int> V;            // (split index, z level) -> VERTEX_POINT
    for (int lv = 0; lv < 2; ++lv)
        for (std::size_t i = 0; i < k; ++i) { int p; at(splitsDeg[i], lv * H, p); V[{i, lv}] = ent("VERTEX_POINT(''," + ref(p) + ")"); }
    const int zd = ent("DIRECTION('',(0.,0.,1.))"), xd = ent("DIRECTION('',(1.,0.,0.))");
    int ax[2], circ[2];
    for (int lv = 0; lv < 2; ++lv) {
        ax[lv] = ent("AXIS2_PLACEMENT_3D(''," + ref(pt(0, 0, lv * H)) + "," + ref(zd) + "," + ref(xd) + ")");
        circ[lv] = ent("CIRCLE(''," + ref(ax[lv]) + "," + num(R) + ")");
    }
    std::map<std::pair<std::size_t, int>, int> arc;          // arc from split i to split i+1 (CCW)
    for (int lv = 0; lv < 2; ++lv)
        for (std::size_t i = 0; i < k; ++i)
            arc[{i, lv}] = ent("EDGE_CURVE(''," + ref(V[{i, lv}]) + "," + ref(V[{(i + 1) % k, lv}]) + "," +
                               ref(circ[lv]) + ",.T.)");
    const int vec = ent("VECTOR(''," + ref(zd) + "," + num(H) + ")");
    std::vector<std::size_t> wall;                           // indices of the splits the wall is cut at
    for (std::size_t i = 0; i < k; ++i)
        if (wallSplitsDeg.empty() ||
            std::find(wallSplitsDeg.begin(), wallSplitsDeg.end(), splitsDeg[i]) != wallSplitsDeg.end())
            wall.push_back(i);
    std::vector<int> seam(k, 0);                             // the axial edge at wall split i, bottom -> top
    for (std::size_t i : wall) {
        int p; at(splitsDeg[i], 0.0, p);
        const int ln = ent("LINE(''," + ref(p) + "," + ref(vec) + ")");
        seam[i] = ent("EDGE_CURVE(''," + ref(V[{i, 0}]) + "," + ref(V[{i, 1}]) + "," + ref(ln) + ",.T.)");
    }
    std::vector<std::pair<double, double>> cp{{5, 0}, {5, 5}, {0, 5}, {-5, 5}, {-5, 0}, {-5, -5}, {0, -5}, {5, -5}, {5, 0}};
    if (circleAlongV) std::reverse(cp.begin(), cp.end());
    const double w = std::sqrt(0.5);
    std::string surf;
    if (!circleAlongV) {   // u = around the circle (degree 2), v = along the axis (degree 1)
        std::string rows, ws;
        for (std::size_t i = 0; i < cp.size(); ++i) {
            rows += (i ? ",(" : "(") + ref(pt(cp[i].first, cp[i].second, 0)) + "," + ref(pt(cp[i].first, cp[i].second, H)) + ")";
            const std::string wi = num(i % 2 ? w : 1.0);
            ws += (i ? ",(" : "(") + wi + "," + wi + ")";
        }
        surf = "(BOUNDED_SURFACE()B_SPLINE_SURFACE(2,1,(" + rows + "),.UNSPECIFIED.,.F.,.F.,.F.)"
               "B_SPLINE_SURFACE_WITH_KNOTS((3,2,2,2,3),(2,2),(0.,0.25,0.5,0.75,1.),(0.,1.),.UNSPECIFIED.)"
               "GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((" + ws + "))REPRESENTATION_ITEM('')SURFACE())";
    } else {               // u = along the axis (degree 1), v = around the circle (degree 2)
        std::string rows = "(", ws = "(";
        for (int lv = 0; lv < 2; ++lv) {
            if (lv) { rows += "),("; ws += "),("; }
            for (std::size_t i = 0; i < cp.size(); ++i) {
                rows += (i ? "," : "") + ref(pt(cp[i].first, cp[i].second, lv * H));
                ws += (i ? "," : "") + num(i % 2 ? w : 1.0);
            }
        }
        rows += ")"; ws += ")";
        surf = "(BOUNDED_SURFACE()B_SPLINE_SURFACE(1,2,(" + rows + "),.UNSPECIFIED.,.F.,.F.,.F.)"
               "B_SPLINE_SURFACE_WITH_KNOTS((2,2),(3,2,2,2,3),(0.,1.),(0.,0.25,0.5,0.75,1.),.UNSPECIFIED.)"
               "GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((" + ws + "))REPRESENTATION_ITEM('')SURFACE())";
    }
    const int sf = ent(surf);
    auto face = [&](const std::vector<std::pair<int, bool>>& oes, int s) {
        std::string l = "(";
        for (std::size_t i = 0; i < oes.size(); ++i)
            l += (i ? "," : "") + ref(ent("ORIENTED_EDGE('',*,*," + ref(oes[i].first) + (oes[i].second ? ",.T.)" : ",.F.)")));
        const int lp = ent("EDGE_LOOP(''," + l + "))");
        return ent("ADVANCED_FACE('',(" + ref(ent("FACE_OUTER_BOUND(''," + ref(lp) + ",.T.)")) + ")," + ref(s) + ",.T.)");
    };
    const int mz = ent("DIRECTION('',(0.,0.,-1.))");
    const int bot = ent("PLANE(''," + ref(ent("AXIS2_PLACEMENT_3D(''," + ref(pt(0, 0, 0)) + "," + ref(mz) + "," + ref(xd) + ")")) + ")");
    const int top = ent("PLANE(''," + ref(ax[1]) + ")");
    std::vector<std::pair<int, bool>> botLoop, topLoop;
    for (std::size_t i = k; i-- > 0;) botLoop.push_back({arc[{i, 0}], false});
    for (std::size_t i = 0; i < k; ++i) topLoop.push_back({arc[{i, 1}], true});
    std::vector<int> F{face(botLoop, bot), face(topLoop, top)};
    for (std::size_t j = 0; j < wall.size(); ++j) {   // wall face from wall split a to the next one, b
        const std::size_t a = wall[j], b = wall[(j + 1) % wall.size()];
        std::vector<std::pair<int, bool>> lp;
        std::size_t i = a;
        do { lp.push_back({arc[{i, 0}], true}); i = (i + 1) % k; } while (i != b);
        lp.push_back({seam[b], true});
        do { i = (i + k - 1) % k; lp.push_back({arc[{i, 1}], false}); } while (i != a);
        lp.push_back({seam[a], false});
        F.push_back(face(lp, sf));
    }
    std::string fl = "(";
    for (std::size_t i = 0; i < F.size(); ++i) fl += (i ? "," : "") + ref(F[i]);
    ent("MANIFOLD_SOLID_BREP('split_cyl'," + ref(ent("CLOSED_SHELL(''," + fl + "))")) + ")");
    return "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('split_cyl.step','',(''),(''),'','','');\n"
           "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n" + d + "ENDSEC;\nEND-ISO-10303-21;\n";
}

void runForeignBspline() {
    std::printf("[foreign-bspline] a B-spline face StepAnalytic::read cannot reconstruct exactly is refused, never mis-trimmed\n");
    // Two observables, because each alone is blind somewhere: MassProps' volume is
    // the x-flux divergence integral (a face whose normal is +-z contributes 0 to
    // it), while AREA is orientation-free and sees every face.
    struct Case { const char* name; std::string text; double vol, area; bool mustRead; };
    const double tetraArea = 150.0 + 50.0 * std::sqrt(3.0);
    const std::vector<Case> cases{
        {"control tetra, all planar",             tetraStep(false),     1000.0 / 6.0, tetraArea, true},
        {"control holed box, all planar",         boxStep(true, false), 960.0,        672.0,     true},
        {"box, top = UNTRIMMED B-spline patch",   boxStep(false, true), 1000.0,       600.0,     true},
        {"tetra, slanted face = TRIMMED patch",   tetraStep(true),      1000.0 / 6.0, tetraArea, false},
        {"holed box, top = HOLED B-spline patch", boxStep(true, true),  960.0,        672.0,     false},
    };
    for (const Case& c : cases) {
        const AnalyticReadResult r = StepAnalytic::read(c.text);
        MassProps mp;
        if (r.ok && r.solid) mp = massProperties(*r.solid);
        const double rv = std::fabs(mp.volume - c.vol) / c.vol;
        const double ra = std::fabs(mp.area - c.area) / c.area;
        char buf[480];
        std::snprintf(buf, sizeof buf,
                      "%s: read ok=%d volume %.9f (closed form %.9f, rel %.2e) area %.9f (closed form %.9f, rel %.2e)%s%s",
                      c.name, r.ok ? 1 : 0, mp.volume, c.vol, rv, mp.area, c.area, ra,
                      r.ok ? "" : " -- ", r.ok ? "" : r.reason.c_str());
        // Either the read is EXACT, or it is refused. A read that succeeds with the
        // wrong geometry is the defect. A case marked mustRead must also succeed.
        const bool exact = r.ok && r.solid && rv <= 1e-9 && ra <= 1e-9;
        check(exact || (!c.mustRead && !r.ok), buf);
    }
}

// Gauss-Legendre nodes/weights on [0,1] by Newton on P_n -- the gate's own rule,
// not MassProps' table.
void gaussLegendre01(int n, std::vector<double>& x, std::vector<double>& w) {
    x.assign(n, 0.0); w.assign(n, 0.0);
    for (int i = 0; i < n; ++i) {
        double z = std::cos(kPi * (i + 0.75) / (n + 0.5)), dp = 1.0;
        for (int it = 0; it < 100; ++it) {
            double p1 = 1.0, p0 = 0.0;
            for (int j = 0; j < n; ++j) { const double pm = p0; p0 = p1; p1 = ((2 * j + 1) * z * p0 - j * pm) / (j + 1); }
            dp = n * (z * p1 - p0) / (z * z - 1.0);
            const double dz = p1 / dp;
            z -= dz;
            if (std::fabs(dz) < 1e-16) break;
        }
        x[i] = 0.5 * (1.0 - z);
        w[i] = 1.0 / ((1.0 - z * z) * dp * dp);
    }
}

// The B-spline faces of a read-back solid integrated INDEPENDENTLY of MassProps:
// every face's (u,v) box is cut at the surface's interior knots and each cell gets
// its own 12-point tensor rule (a rational B-spline is smooth only between knots).
// Returns {area, x-flux}; the x-flux is MassProps' own volume form, x n_x dA.
std::array<double, 2> nurbsKnotSplitIntegrals(const Solid& s) {
    std::vector<double> gx, gw;
    gaussLegendre01(12, gx, gw);
    auto cuts = [](double a, double b, const std::vector<double>& knots) {
        std::vector<double> c{a};
        for (double k : knots) if (k > c.back() && k < b) c.push_back(k);
        c.push_back(b);
        return c;
    };
    std::array<double, 2> out{0.0, 0.0};
    for (const Face* f : facesOf(s)) {
        if (!f->surface || f->surface->kind != SurfaceKind::Nurbs) continue;
        const std::vector<double> cu = cuts(f->u0, f->u1, f->surface->nurbs.knotsU);
        const std::vector<double> cv = cuts(f->v0, f->v1, f->surface->nurbs.knotsV);
        for (std::size_t i = 0; i + 1 < cu.size(); ++i)
            for (std::size_t j = 0; j + 1 < cv.size(); ++j)
                for (std::size_t a = 0; a < gx.size(); ++a)
                    for (std::size_t b = 0; b < gx.size(); ++b) {
                        const double du = cu[i + 1] - cu[i], dv = cv[j + 1] - cv[j];
                        const double u = cu[i] + du * gx[a], v = cv[j] + dv * gx[b];
                        Vec3 p, su, sv;
                        f->surface->evaluateDeriv(u, v, p, su, sv);
                        const double wt = vlen(vcross(su, sv)) * gw[a] * gw[b] * du * dv;
                        out[0] += wt;
                        out[1] += p.x * f->surface->normalAt(u, v).x * wt;
                    }
    }
    return out;
}

void runClosedBspline() {
    std::printf("[closed-bspline] a B-spline face on a CLOSED surface reads as ITS OWN rectangle, or is refused\n");
    // Validator round 1 (2026-10-09): on a closed B-spline cylinder a loop vertex
    // ON the seam inverts to u = 0 or u = 1 indistinguishably, and the 270->360 deg
    // quarter came back as u[0,0.75] -- read ok=1 at volume 1182.519 vs 785.398
    // (+50.6 %). Two observables per accepted file:
    //   READER   the B-spline faces' area and x-flux, integrated by the gate's own
    //            knot-split quadrature, against the closed-form lateral area 2 pi r h
    //            and volume pi r^2 h (the caps' normals are +-z, so they carry no
    //            x-flux: the solid's whole volume is the wall's x-flux).
    //   END TO END  massProperties() volume and area against closed form. MassProps
    //            integrates a B-spline face with ONE 8-point rule over its whole
    //            box, which is exact only when no interior knot lies inside the box
    //            (MEASURED: the 120 deg faces span the C0 knot u = 0.5 and give
    //            786.524110981, rel 1.43e-3, while the same read-back faces cut at
    //            the knot give 785.398163393). Required where `mpExact`; otherwise
    //            printed as a known MassProps limitation, not a reader defect.
    struct Case { const char* name; std::string text; bool mustRead, mpExact; };
    const double R = 5.0, H = 10.0;
    const double vol = kPi * R * R * H, wallArea = 2.0 * kPi * R * H, area = wallArea + 2.0 * kPi * R * R;
    const std::vector<Case> cases{
        // A face ENDING at the seam must read as its own box ...
        {"split B-spline cylinder, faces 0/90/180/270 (seam vertices)",
         splitCylinderStep({0, 90, 180, 270}, false), true, true},
        {"split B-spline cylinder, circle along v, faces 0/90/180/270 (seam vertices)",
         splitCylinderStep({0, 90, 180, 270}, true), true, true},
        {"split B-spline cylinder, faces 0/120/240 (seam vertices; boxes span interior knots)",
         splitCylinderStep({0, 120, 240}, false), true, false},
        {"split B-spline cylinder, wall faces 0/90, caps 0/90/180 (90->360 face: 2 bottom arcs, 3 knot spans)",
         splitCylinderStep({0, 90, 180}, false, {0, 90}), true, false},
        // ... a face whose arc CROSSES the seam has no rectangle in the knot domain
        // (its vertex box is the face's COMPLEMENT): refused, or exact ...
        {"split B-spline cylinder, faces 45/135/225/315 (315->45 straddles the seam)",
         splitCylinderStep({45, 135, 225, 315}, false), false, true},
        {"split B-spline cylinder, circle along v, faces 45/135/225/315 (straddles the seam)",
         splitCylinderStep({45, 135, 225, 315}, true), false, true},
        // ... and one face round the whole wall (its seam edge used twice).
        {"B-spline cylinder, ONE wall face (seam edge used twice)",
         splitCylinderStep({0}, false), false, false},
    };
    for (const Case& c : cases) {
        const AnalyticReadResult r = StepAnalytic::read(c.text);
        if (!r.ok || !r.solid) {
            check(!c.mustRead, std::string(c.name) + ": read ok=0 -- " + r.reason);
            continue;
        }
        const std::array<double, 2> ks = nurbsKnotSplitIntegrals(*r.solid);
        const double rWall = std::fabs(ks[0] - wallArea) / wallArea, rFlux = std::fabs(ks[1] - vol) / vol;
        char buf[480];
        std::snprintf(buf, sizeof buf,
                      "%s: read ok=1; READER: B-spline wall area %.9f (closed form %.9f, rel %.2e), "
                      "x-flux %.9f (closed form volume %.9f, rel %.2e)",
                      c.name, ks[0], wallArea, rWall, ks[1], vol, rFlux);
        check(rWall <= 1e-9 && rFlux <= 1e-9, buf);
        const MassProps mp = massProperties(*r.solid);
        const double rv = std::fabs(mp.volume - vol) / vol, ra = std::fabs(mp.area - area) / area;
        std::snprintf(buf, sizeof buf, "%s: END TO END massProperties volume %.9f (rel %.2e) area %.9f (rel %.2e)",
                      c.name, mp.volume, rv, mp.area, ra);
        if (c.mpExact) check(rv <= 1e-9 && ra <= 1e-9, buf);
        else std::printf("  info  %s -- KNOWN MassProps limitation (one Gauss rule across interior knots), not checked here\n", buf);
        for (const Face* f : facesOf(*r.solid))
            if (f->surface && f->surface->kind == SurfaceKind::Nurbs)
                std::printf("        B-spline face read as box u[%.6f,%.6f] v[%.6f,%.6f]\n", f->u0, f->u1, f->v0, f->v1);
    }
}

// ---------------------------------------------------------------------------
// No-regression set: the analytic builders the codec already handled.
// ---------------------------------------------------------------------------
struct Built { std::string name; std::shared_ptr<TopologyBuilder> keep; std::unique_ptr<SolidFactory> fac; Solid* s = nullptr; };

std::vector<Built> builderCorpus() {
    std::vector<Built> out;
    auto prim = [&](const char* name, std::function<Solid*(SolidFactory&)> mk) {
        Built b; b.name = name; b.fac = std::make_unique<SolidFactory>(); b.s = mk(*b.fac);
        out.push_back(std::move(b));
    };
    prim("box_10x6x4",       [](SolidFactory& f) { return f.buildBox(10, 6, 4); });
    prim("cylinder_r3_h8",   [](SolidFactory& f) { return f.buildCylinder(3, 8); });
    prim("cone_r4_r1_h6",    [](SolidFactory& f) { return f.buildCone(4, 1, 6); });
    prim("cone_apex_r3_h5",  [](SolidFactory& f) { return f.buildCone(3, 0, 5); });
    prim("sphere_r5",        [](SolidFactory& f) { return f.buildSphere(5); });
    prim("torus_R6_r2",      [](SolidFactory& f) { return f.buildTorus(6, 2); });
    prim("tube_5_3_h7",      [](SolidFactory& f) { return f.buildTube(5, 3, 7); });
    prim("prism_hex_R4_h3",  [](SolidFactory& f) { return f.buildPrism(6, 4, 3); });
    prim("wedge_8_5_4_2",    [](SolidFactory& f) { return f.buildWedge(8, 5, 4, 2); });
    prim("pyramid_6_4_h5",   [](SolidFactory& f) { return f.buildPyramid(6, 4, 5); });
    auto op = [&](const char* name, std::function<Solid*(TopologyBuilder&)> mk) {
        Built b; b.name = name; b.keep = std::make_shared<TopologyBuilder>(); b.s = mk(*b.keep);
        out.push_back(std::move(b));
    };
    op("fillet_box_const_R1.5", [](TopologyBuilder& tb) {
        auto r = filletBoxEdgeAnalytic(tb, 10.0, 1.5, 4); return r.ok ? r.solid : nullptr; });
    op("fillet_cyl_top_torus",  [](TopologyBuilder& tb) {
        auto r = filletCylinderTopEdgeAnalytic(tb, 5.0, 8.0, 1.0); return r.ok ? r.solid : nullptr; });
    op("chamfer_box_1.5",       [](TopologyBuilder& tb) {
        auto r = chamferBoxEdgeAnalytic(tb, 10.0, 1.5, 4); return r.ok ? r.solid : nullptr; });
    op("varfillet_R1.5_R1.5",   [](TopologyBuilder& tb) {
        auto r = filletBoxEdgeVariable(tb, 10.0, 1.5, 1.5, 4); return r.ok ? r.solid : nullptr; });
    op("varfillet_R1_R2",       [](TopologyBuilder& tb) {
        auto r = filletBoxEdgeVariable(tb, 10.0, 1.0, 2.0, 4); return r.ok ? r.solid : nullptr; });
    return out;
}

void runNoRegression() {
    std::printf("[no-regression] analytic builders round-trip through StepAnalytic\n");
    for (Built& b : builderCorpus()) {
        if (b.name.rfind("varfillet", 0) == 0) continue;   // the blend cases above own these
        if (!b.s) { check(false, b.name + ": builder returned null"); continue; }
        const AnalyticWriteResult w = StepAnalytic::write(*b.s);
        if (!w.ok) { check(false, b.name + ": write failed — " + w.reason); continue; }
        const AnalyticReadResult r = StepAnalytic::read(w.text);
        if (!r.ok || !r.solid) { check(false, b.name + ": read failed — " + r.reason); continue; }
        const MassProps a = massProperties(*b.s), c = massProperties(*r.solid);
        const double rel = std::fabs(a.volume - c.volume) / std::max(1e-300, std::fabs(a.volume));
        const std::size_t fa = facesOf(*b.s).size(), fc = facesOf(*r.solid).size();
        char buf[200];
        std::snprintf(buf, sizeof buf, ": volume %.9f -> %.9f (rel %.2e), faces %zu -> %zu",
                      a.volume, c.volume, rel, fa, fc);
        // A closed sphere is written in its compact one-face form and re-faceted on
        // read, so its face count legitimately changes; its volume may not.
        const bool facesOk = (b.name.rfind("sphere", 0) == 0) || fa == fc;
        check(rel <= 1e-9 && facesOk, b.name + buf);
        // The read-back now carries the exact Edge::curve the file wrote, which
        // the validator samples: it must not make a valid solid invalid. (The
        // sphere comes back re-tiled, so its predicates are not comparable.)
        if (b.name.rfind("sphere", 0) != 0)
            check(noNewInvalidity(*b.s, *r.solid), b.name + " checkBRep: " + g_validityNote);
        // Provenance of every written edge, and the INDEPENDENT reader's volume.
        const ForeignReadResult fr = readForeignStep(w.text);
        double frel = -1.0;
        if (fr.ok && fr.solid && fr.unsupported.empty())
            frel = std::fabs(massProperties(*fr.solid).volume - a.volume) / std::fabs(a.volume);
        std::printf("        edges: fromCurve=%zu inferredArc=%zu line=%zu CHORD=%zu | readForeignStep: %s closed=%d vol rel %.2e\n",
                    w.edgesFromCurve, w.edgesInferredArc, w.edgesLine, w.edgesChord,
                    fr.ok ? "ok" : fr.reason.c_str(), fr.closed ? 1 : 0, frel);
    }
}

// ---------------------------------------------------------------------------
// --census: A1, the slot census with its denominators.
// ---------------------------------------------------------------------------
int runCensus(const char* stepList) {
    std::printf("[census] corpus 1: native analytic BUILDERS (in-process, %s)\n", "SolidFactory + FilletAnalytic + ChamferAnalytic");
    std::printf("  %-26s %6s %8s %10s %8s %12s  curve kinds\n", "solid", "faces", "edges", "w/ curve", "coedges", "w/ pcurve");
    SlotCount tot;
    for (Built& b : builderCorpus()) {
        if (!b.s) { std::printf("  %-26s  (builder returned null)\n", b.name.c_str()); continue; }
        const SlotCount c = countSlots(*b.s);
        std::string kinds;
        for (auto& kv : c.curveKinds) kinds += kv.first + "=" + std::to_string(kv.second) + " ";
        std::printf("  %-26s %6zu %8zu %10zu %8zu %12zu  %s\n", b.name.c_str(), c.faces, c.edges,
                    c.edgesWithCurve, c.coedges, c.coedgesWithPcurve, kinds.c_str());
        tot.faces += c.faces; tot.edges += c.edges; tot.edgesWithCurve += c.edgesWithCurve;
        tot.coedges += c.coedges; tot.coedgesWithPcurve += c.coedgesWithPcurve;
    }
    std::printf("  %-26s %6zu %8zu %10zu %8zu %12zu\n", "TOTAL(builders)", tot.faces, tot.edges,
                tot.edgesWithCurve, tot.coedges, tot.coedgesWithPcurve);
    std::printf("  CENSUS builders: edges-with-curve %zu / %zu edges ; coedges-with-pcurve %zu / %zu coedges\n",
                tot.edgesWithCurve, tot.edges, tot.coedgesWithPcurve, tot.coedges);

    if (!stepList) return 0;
    std::ifstream lf(stepList);
    if (!lf) { std::printf("  FATAL: cannot open --step-list %s\n", stepList); return 2; }
    std::vector<std::string> files;
    for (std::string line; std::getline(lf, line);) if (!line.empty()) files.push_back(line);
    std::printf("[census] corpus 2: STEP files read by the shipped NATIVE ladder (StepAnalytic::read, "
                "else readForeignStep accepted iff ok && unsupported.empty() && closed): %zu files from %s\n",
                files.size(), stepList);
    SlotCount t2; std::size_t nNative = 0, nDeclined = 0, nCrash = 0;
    for (const std::string& path : files) {
        int fd[2];
        if (pipe(fd) != 0) return 2;
        pid_t pid = fork();
        if (pid == 0) {
            close(fd[0]);
            std::ifstream in(path, std::ios::binary);
            std::stringstream ss; ss << in.rdbuf();
            const std::string text = ss.str();
            char line[512];
            const AnalyticReadResult a = StepAnalytic::read(text);
            const Solid* s = nullptr; const char* via = "none";
            ForeignReadResult fr;
            if (a.ok && a.solid) { s = a.solid; via = "StepAnalytic"; }
            else {
                fr = readForeignStep(text);
                if (fr.ok && fr.solid && fr.unsupported.empty() && fr.closed) { s = fr.solid; via = "readForeignStep"; }
            }
            if (s) {
                const SlotCount c = countSlots(*s);
                std::snprintf(line, sizeof line, "OK %s %zu %zu %zu %zu %zu\n", via, c.faces, c.edges,
                              c.edgesWithCurve, c.coedges, c.coedgesWithPcurve);
            } else {
                std::snprintf(line, sizeof line, "DECLINED\n");
            }
            ssize_t wr = write(fd[1], line, std::strlen(line)); (void)wr;
            close(fd[1]);
            _exit(0);
        }
        close(fd[1]);
        std::string got; char buf[512]; ssize_t n;
        while ((n = read(fd[0], buf, sizeof buf)) > 0) got.append(buf, static_cast<std::size_t>(n));
        close(fd[0]);
        int st = 0; waitpid(pid, &st, 0);
        // the last three path components name a corpus row unambiguously
        std::string base = path;
        for (int k = 0, cut = static_cast<int>(path.size()); k < 3; ++k) {
            const std::size_t at = path.find_last_of('/', static_cast<std::size_t>(cut - 1));
            if (at == std::string::npos || cut <= 0) break;
            base = path.substr(at + 1);
            cut = static_cast<int>(at);
        }
        if (got.rfind("OK", 0) == 0) {
            char via[32]; SlotCount c;
            std::sscanf(got.c_str(), "OK %31s %zu %zu %zu %zu %zu", via, &c.faces, &c.edges,
                        &c.edgesWithCurve, &c.coedges, &c.coedgesWithPcurve);
            ++nNative;
            t2.faces += c.faces; t2.edges += c.edges; t2.edgesWithCurve += c.edgesWithCurve;
            t2.coedges += c.coedges; t2.coedgesWithPcurve += c.coedgesWithPcurve;
            std::printf("  %-64.64s %-15s F=%zu E=%zu Ecurve=%zu C=%zu Cpcurve=%zu\n", base.c_str(), via,
                        c.faces, c.edges, c.edgesWithCurve, c.coedges, c.coedgesWithPcurve);
        } else if (got.rfind("DECLINED", 0) == 0) {
            ++nDeclined;
        } else {
            ++nCrash;
            std::printf("  %-64.64s CRASH/NO-OUTPUT (status %d)\n", base.c_str(), st);
        }
    }
    std::printf("  STEP corpus: %zu files -> %zu native solids, %zu declined by the native ladder, %zu crashed\n",
                files.size(), nNative, nDeclined, nCrash);
    std::printf("  CENSUS step-corpus: edges-with-curve %zu / %zu edges ; coedges-with-pcurve %zu / %zu coedges "
                "(over the %zu natively-read solids)\n",
                t2.edgesWithCurve, t2.edges, t2.coedgesWithPcurve, t2.coedges, nNative);
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "--census") == 0) {
            const char* list = nullptr;
            for (int j = 1; j + 1 < argc; ++j) if (std::strcmp(argv[j], "--step-list") == 0) list = argv[j + 1];
            return runCensus(list);
        }

    std::printf("[step-rational] StepAnalytic must carry rational weights and exact edges through a round trip\n");
    runBlendCase("blend-1.5", 10.0, 1.5, 1.5, /*splineEdge=*/false);
    runBlendCase("blend-law-1-2", 10.0, 1.0, 2.0, /*splineEdge=*/false);
    runBlendCase("blend-1.5-spline-edge", 10.0, 1.5, 1.5, /*splineEdge=*/true);
    runForeignBspline();
    runClosedBspline();
    runNoRegression();
    std::printf("[step-rational] %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
