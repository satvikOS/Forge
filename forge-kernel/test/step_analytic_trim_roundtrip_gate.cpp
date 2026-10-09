// step_analytic_trim_roundtrip_gate.cpp — T-270. StepAnalytic::read must read a
// CURVED quadric face as the face it is, or refuse it -- never as the (u,v) box
// of its loop vertices.
//
// THE DEFECT THIS PINS (measured at ed241f37 = work/T-158, identical at b609b41d):
// StepAnalytic::read gave every cylinder / cone / sphere / torus face the (u,v)
// box of its loop VERTICES (attachTrim), and massProperties() integrated that
// box. The box is the face only for a primitive's iso-parameter tiling. On the
// 126-file in-tree corpus, 35 of the 42 solids the import ladder reads via
// readForeignStep came back from StepAnalytic::write -> StepAnalytic::read with
// ok=1 and the WRONG volume (worst +111.9 %): a sector with a notch read as its
// whole box, a full ring split by a seam read with one sub-arc dropped and the
// box shifted, a wall with holes read with the holes filled. Consumers that trust
// that read: FgCopyBody (deep copy = write -> read), FgImportStep, importStep's
// first rung. A planar disk face WITH holes was also read as the whole disk.
//
// THE ORACLE IS CLOSED FORM. Each fixture is a hand-written analytic STEP solid
// (its own emitter below -- no Forge writer) whose volume and area are known in
// closed form:
//   L-sector    a cylinder sector whose curved face is an L in (theta,z)
//   window-tube a tube with a rectangular window through its wall: both walls
//               are full rings with a SEAM and a HOLE; caps are annular sectors
//   frustum     a full cone frustum, seam edge, disk caps
//   torus-quarter  a quarter torus: the torus face wraps its minor angle (seam)
//   L-sector-ap214  the L-sector with every 3D edge wrapped in SURFACE_CURVE
//               (the AP214 / OCCT dialect) -- must still be READ, exactly
//   oblique-cut a cylinder cut by an inclined plane: its wall's top edge is an
//               ellipse, curved in (theta,z) -- must be REFUSED
// and two readings must each be EXACT (volume and area within 1e-9 relative of
// closed form) or REFUSED (ok=0):
//   rung-1      StepAnalytic::read(fixture text)
//   round trip  readForeignStep(fixture) -> StepAnalytic::write ->
//               StepAnalytic::read (the FgCopyBody path for an imported part)
// "positive" fixtures must additionally NOT be refused (the reader must keep
// reading what it can read exactly).
//
// HOLED DISK (holed-disk): a cylinder with an off-axis square prism hole; its two
// caps are disks with a square hole. The polar disk integral has no holes, so
// read() must not annotate such a face as a disk: the round trip must reproduce
// the SOURCE solid's area (both integrate the same boundary polygon) and the
// hole must be cut out (area below the solid's full-disk area by >= 90 % of the
// two hole areas). A planar face bounded by non-concentric arcs integrates as its
// vertex polygon everywhere in Forge (MassProps), so this fixture is compared to
// the source, not to closed form (stated, not hidden).
//
// NO-REGRESSION: the analytic builders (box, cylinder, cone, apex cone, sphere,
// torus, tube, prism, wedge, pyramid, fillets, chamfer) must still round-trip
// through StepAnalytic exactly and not be refused (their faces are the iso-
// parameter rectangles the guard keeps untouched).
//
// usage:
//   step_analytic_trim_roundtrip_gate                     run the gate (0/1)
//   step_analytic_trim_roundtrip_gate --corpus LIST       A1/A2 corpus tally
//       for every file: the import ladder, then write -> read; prints EXACT /
//       WRONG / REFUSED per file (vs the source solid, vol and area 1e-9) and a
//       summary; exits 1 if any round trip is WRONG in VOLUME.
#include "forge/native/brep/ChamferAnalytic.hpp"
#include "forge/native/brep/FilletAnalytic.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/Topology.hpp"

#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <map>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

using namespace forge::native::brep;

namespace {

const double PI = 3.14159265358979323846;
int g_checks = 0, g_fail = 0;

void check(bool ok, const std::string& what) {
    ++g_checks;
    if (!ok) ++g_fail;
    std::printf("  %s  %s\n", ok ? "pass" : "FAIL", what.c_str());
}

double rel(double a, double b) { return std::fabs(a - b) / std::max(1e-300, std::fabs(b)); }

// ---------------------------------------------------------------------------
// METAMORPHIC frame: every fixture is emitted under a similarity transform
// p -> sc * Rot * p + T (closed-form volume scales by sc^3, area by sc^2). The
// identity is the base run; the others move the part far from the origin in an
// oblique frame, and shrink it, so no tolerance or frame assumption can hide.
// ---------------------------------------------------------------------------
struct Xf {
    std::string tag;
    double R[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
    Vec3 T{0, 0, 0};
    double sc = 1.0;
    Vec3 rot(const Vec3& v) const {
        return {R[0][0] * v.x + R[0][1] * v.y + R[0][2] * v.z, R[1][0] * v.x + R[1][1] * v.y + R[1][2] * v.z,
                R[2][0] * v.x + R[2][1] * v.y + R[2][2] * v.z};
    }
    Vec3 apply(const Vec3& p) const { return vadd(vscale(rot(p), sc), T); }
};
Xf g_xf;

Xf makeXf(const char* tag, Vec3 axis, double ang, Vec3 T, double sc) {
    Xf x; x.tag = tag; x.T = T; x.sc = sc;
    const Vec3 k = vnorm(axis);
    const double c = std::cos(ang), s = std::sin(ang), t = 1 - c;
    const double K[3] = {k.x, k.y, k.z};
    for (int i = 0; i < 3; ++i)
        for (int j = 0; j < 3; ++j) x.R[i][j] = t * K[i] * K[j] + (i == j ? c : 0.0);
    x.R[0][1] -= s * k.z; x.R[0][2] += s * k.y;
    x.R[1][0] += s * k.z; x.R[1][2] -= s * k.x;
    x.R[2][0] -= s * k.y; x.R[2][1] += s * k.x;
    return x;
}

// ---------------------------------------------------------------------------
// A minimal analytic STEP emitter (independent of StepAnalytic::write).
// ---------------------------------------------------------------------------
struct Step {
    std::string d;
    int id = 0;
    std::map<int, Vec3> vpos;               // VERTEX_POINT id -> point
    struct E { int vs, ve; };
    std::map<int, E> edges;                 // EDGE_CURVE id -> endpoints
    bool ap214 = false;                     // wrap every 3D edge curve in SURFACE_CURVE

    static std::string num(double x) {
        char b[40];
        std::snprintf(b, sizeof b, "%.17g", x);
        std::string s = b;
        if (s.find_first_of(".eEn") == std::string::npos) s += '.';
        return s;
    }
    static std::string ref(int i) { return "#" + std::to_string(i); }
    int add(const std::string& body) {
        ++id;
        d += ref(id) + "=" + body + ";\n";
        return id;
    }
    static std::string len(double x) { return num(x * g_xf.sc); }
    int pt(const Vec3& p0) {
        const Vec3 p = g_xf.apply(p0);
        return add("CARTESIAN_POINT('',(" + num(p.x) + "," + num(p.y) + "," + num(p.z) + "))");
    }
    int dir(const Vec3& v0) {
        const Vec3 v = vnorm(g_xf.rot(v0));
        return add("DIRECTION('',(" + num(v.x) + "," + num(v.y) + "," + num(v.z) + "))");
    }
    int ax2(const Vec3& o, const Vec3& z, const Vec3& x) {
        const int a = pt(o), b = dir(z), c = dir(x);
        return add("AXIS2_PLACEMENT_3D(''," + ref(a) + "," + ref(b) + "," + ref(c) + ")");
    }
    int vertex(const Vec3& p) {
        const int v = add("VERTEX_POINT(''," + ref(pt(p)) + ")");
        vpos[v] = p;
        return v;
    }
    int wrap(int curve) {
        return ap214 ? add("SURFACE_CURVE(''," + ref(curve) + ",(),.PCURVE_S1.)") : curve;
    }
    int edge(int vs, int ve, int curve, bool sense = true) {
        const int e = add("EDGE_CURVE(''," + ref(vs) + "," + ref(ve) + "," + ref(wrap(curve)) + "," +
                          (sense ? ".T." : ".F.") + ")");
        edges[e] = {vs, ve};
        return e;
    }
    int line(int vs, int ve) {
        const Vec3 A = vpos.at(vs), B = vpos.at(ve);
        const int p = pt(A), dr = dir(vsub(B, A));
        const int vec = add("VECTOR(''," + ref(dr) + "," + len(vlen(vsub(B, A))) + ")");
        return edge(vs, ve, add("LINE(''," + ref(p) + "," + ref(vec) + ")"));
    }
    // Circle (centre c, plane normal n, x-axis x, radius r); the edge runs vs->ve
    // with INCREASING angle about n when sense is true.
    int arc(int vs, int ve, const Vec3& c, const Vec3& n, const Vec3& x, double r, bool sense = true) {
        return edge(vs, ve, add("CIRCLE(''," + ref(ax2(c, n, x)) + "," + len(r) + ")"), sense);
    }
    int ellipseArc(int vs, int ve, const Vec3& c, const Vec3& n, const Vec3& x, double a, double b, bool sense = true) {
        return edge(vs, ve, add("ELLIPSE(''," + ref(ax2(c, n, x)) + "," + len(a) + "," + len(b) + ")"), sense);
    }
    // A loop as (edge, start vertex) uses in traversal order.
    int loop(const std::vector<std::pair<int, int>>& uses, bool outer) {
        std::string oes = "(";
        for (std::size_t i = 0; i < uses.size(); ++i) {
            const E& e = edges.at(uses[i].first);
            const bool fwd = (e.vs == uses[i].second);
            const int oe = add("ORIENTED_EDGE('',*,*," + ref(uses[i].first) + (fwd ? ",.T.)" : ",.F.)"));
            oes += (i ? "," : "") + ref(oe);
        }
        const int el = add("EDGE_LOOP(''," + oes + "))");
        return add(std::string(outer ? "FACE_OUTER_BOUND(''," : "FACE_BOUND(''," ) + ref(el) + ",.T.)");
    }
    int plane(const Vec3& o, const Vec3& n, const Vec3& x) { return add("PLANE(''," + ref(ax2(o, n, x)) + ")"); }
    int cylinder(const Vec3& o, const Vec3& n, const Vec3& x, double r) {
        return add("CYLINDRICAL_SURFACE(''," + ref(ax2(o, n, x)) + "," + len(r) + ")");
    }
    int cone(const Vec3& o, const Vec3& n, const Vec3& x, double r, double semi) {
        return add("CONICAL_SURFACE(''," + ref(ax2(o, n, x)) + "," + len(r) + "," + num(semi) + ")");
    }
    int torus(const Vec3& o, const Vec3& n, const Vec3& x, double R, double r) {
        return add("TOROIDAL_SURFACE(''," + ref(ax2(o, n, x)) + "," + len(R) + "," + len(r) + ")");
    }
    std::vector<int> faces;
    void face(int outer, const std::vector<int>& holes, int surf, bool sameSense = true) {
        std::string b = "(" + ref(outer);
        for (int h : holes) b += "," + ref(h);
        b += ")";
        faces.push_back(add("ADVANCED_FACE(''," + b + "," + ref(surf) + (sameSense ? ",.T.)" : ",.F.)")));
    }
    std::string doc() {
        std::string fl = "(";
        for (std::size_t i = 0; i < faces.size(); ++i) fl += (i ? "," : "") + ref(faces[i]);
        const int sh = add("CLOSED_SHELL(''," + fl + "))");
        add("MANIFOLD_SOLID_BREP('fixture'," + ref(sh) + ")");
        return "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\n"
               "FILE_NAME('fixture.step','',(''),(''),'','','');\n"
               "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n" + d + "ENDSEC;\nEND-ISO-10303-21;\n";
    }
};

Vec3 cyl(double r, double th, double z) { return Vec3{r * std::cos(th), r * std::sin(th), z}; }
const Vec3 X{1, 0, 0}, Y{0, 1, 0}, Z{0, 0, 1}, O{0, 0, 0};

struct Fixture {
    std::string name;
    std::string text;
    double vol = 0, area = 0;
    bool mustRead = true;      // false: the exact read is not representable -> must be refused
};

// L-sector: theta in [0, a1] for z in [0,h1], theta in [0, a2] for z in [h1,h2].
Fixture lSector(bool ap214) {
    const double R = 10, h1 = 4, h2 = 10, a1 = PI / 2, a2 = PI / 4;
    Step s; s.ap214 = ap214;
    const int A0 = s.vertex({0, 0, 0}), A1 = s.vertex({0, 0, h1}), A2 = s.vertex({0, 0, h2});
    const int B0 = s.vertex(cyl(R, 0, 0)), B2 = s.vertex(cyl(R, 0, h2));
    const int C0 = s.vertex(cyl(R, a1, 0)), C1 = s.vertex(cyl(R, a1, h1));
    const int D1 = s.vertex(cyl(R, a2, h1)), D2 = s.vertex(cyl(R, a2, h2));
    const int eA01 = s.line(A0, A1), eA12 = s.line(A1, A2);
    const int eB = s.line(B0, B2), eC = s.line(C0, C1), eD = s.line(D1, D2);
    const int rA0B0 = s.line(A0, B0), rA0C0 = s.line(A0, C0), rA2B2 = s.line(A2, B2);
    const int rA2D2 = s.line(A2, D2), rA1D1 = s.line(A1, D1), rA1C1 = s.line(A1, C1);
    const int arc0 = s.arc(B0, C0, {0, 0, 0}, Z, X, R);
    const int arc1 = s.arc(D1, C1, {0, 0, h1}, Z, X, R);
    const int arc2 = s.arc(B2, D2, {0, 0, h2}, Z, X, R);
    // cylinder L face, CCW in (theta,z)
    s.face(s.loop({{arc0, B0}, {eC, C0}, {arc1, C1}, {eD, D1}, {arc2, D2}, {eB, B2}}, true),
           {}, s.cylinder(O, Z, X, R));
    s.face(s.loop({{rA0C0, A0}, {arc0, C0}, {rA0B0, B0}}, true), {}, s.plane(O, {0, 0, -1}, X));
    s.face(s.loop({{rA2B2, A2}, {arc2, B2}, {rA2D2, D2}}, true), {}, s.plane({0, 0, h2}, Z, X));
    s.face(s.loop({{rA1D1, A1}, {arc1, D1}, {rA1C1, C1}}, true), {}, s.plane({0, 0, h1}, Z, X));
    s.face(s.loop({{rA0B0, A0}, {eB, B0}, {rA2B2, B2}, {eA12, A2}, {eA01, A1}}, true), {},
           s.plane(O, {0, -1, 0}, X));
    s.face(s.loop({{eA01, A0}, {rA1C1, A1}, {eC, C1}, {rA0C0, C0}}, true), {}, s.plane(O, {-1, 0, 0}, Y));
    s.face(s.loop({{eA12, A1}, {rA2D2, A2}, {eD, D2}, {rA1D1, D1}}, true), {},
           s.plane({0, 0, h1}, {-std::sin(a2), std::cos(a2), 0}, Z));
    Fixture f;
    f.name = ap214 ? "L-sector-ap214" : "L-sector";
    f.text = s.doc();
    f.vol = R * R / 2 * (a1 * h1 + a2 * (h2 - h1));
    f.area = R * (a1 * h1 + a2 * (h2 - h1)) + a1 * R * R / 2 + a2 * R * R / 2 + (a1 - a2) * R * R / 2 +
             R * h2 + R * h1 + R * (h2 - h1);
    return f;
}

// Tube Ro/Ri, height H, with a window theta in [ta,tb], z in [za,zb] through the wall.
Fixture windowTube() {
    const double Ro = 10, Ri = 6, H = 12, ta = PI / 6, tb = PI / 3, za = 4, zb = 8;
    Step s;
    // ring vertices at theta = k*pi/2 on both radii, bottom and top
    int Bo[4], To[4], Bi[4], Ti[4];
    for (int k = 0; k < 4; ++k) {
        Bo[k] = s.vertex(cyl(Ro, k * PI / 2, 0)); To[k] = s.vertex(cyl(Ro, k * PI / 2, H));
        Bi[k] = s.vertex(cyl(Ri, k * PI / 2, 0)); Ti[k] = s.vertex(cyl(Ri, k * PI / 2, H));
    }
    int bo[4], to[4], bi[4], ti[4];   // arc k: theta k*pi/2 -> (k+1)*pi/2
    for (int k = 0; k < 4; ++k) {
        const int n = (k + 1) % 4;
        bo[k] = s.arc(Bo[k], Bo[n], {0, 0, 0}, Z, X, Ro);
        to[k] = s.arc(To[k], To[n], {0, 0, H}, Z, X, Ro);
        bi[k] = s.arc(Bi[k], Bi[n], {0, 0, 0}, Z, X, Ri);
        ti[k] = s.arc(Ti[k], Ti[n], {0, 0, H}, Z, X, Ri);
    }
    const int seamO = s.line(Bo[0], To[0]), seamI = s.line(Bi[0], Ti[0]);
    const int rb0 = s.line(Bo[0], Bi[0]), rb2 = s.line(Bo[2], Bi[2]);
    const int rt0 = s.line(To[0], Ti[0]), rt2 = s.line(To[2], Ti[2]);
    // window corners
    const int Woa = s.vertex(cyl(Ro, ta, za)), WoA = s.vertex(cyl(Ro, ta, zb));
    const int Wob = s.vertex(cyl(Ro, tb, za)), WoB = s.vertex(cyl(Ro, tb, zb));
    const int Wia = s.vertex(cyl(Ri, ta, za)), WiA = s.vertex(cyl(Ri, ta, zb));
    const int Wib = s.vertex(cyl(Ri, tb, za)), WiB = s.vertex(cyl(Ri, tb, zb));
    const int goa = s.line(Woa, WoA), gob = s.line(Wob, WoB), gia = s.line(Wia, WiA), gib = s.line(Wib, WiB);
    const int oza = s.arc(Woa, Wob, {0, 0, za}, Z, X, Ro), ozb = s.arc(WoA, WoB, {0, 0, zb}, Z, X, Ro);
    const int iza = s.arc(Wia, Wib, {0, 0, za}, Z, X, Ri), izb = s.arc(WiA, WiB, {0, 0, zb}, Z, X, Ri);
    const int raa = s.line(Woa, Wia), raA = s.line(WoA, WiA), rba = s.line(Wob, Wib), rbA = s.line(WoB, WiB);
    // outer wall: CCW (theta,z), seam at theta 0; window hole CW
    s.face(s.loop({{bo[0], Bo[0]}, {bo[1], Bo[1]}, {bo[2], Bo[2]}, {bo[3], Bo[3]}, {seamO, Bo[0]},
                   {to[3], To[0]}, {to[2], To[3]}, {to[1], To[2]}, {to[0], To[1]}, {seamO, To[0]}}, true),
           {s.loop({{goa, Woa}, {ozb, WoA}, {gob, WoB}, {oza, Wob}}, false)},
           s.cylinder(O, Z, X, Ro), true);
    // inner wall (normal toward the axis): same traversal, reversed surface sense
    s.face(s.loop({{seamI, Bi[0]}, {ti[0], Ti[0]}, {ti[1], Ti[1]}, {ti[2], Ti[2]}, {ti[3], Ti[3]},
                   {seamI, Ti[0]}, {bi[3], Bi[0]}, {bi[2], Bi[3]}, {bi[1], Bi[2]}, {bi[0], Bi[1]}}, true),
           {s.loop({{iza, Wia}, {gib, Wib}, {izb, WiB}, {gia, WiA}}, false)},
           s.cylinder(O, Z, X, Ri), false);
    // caps: two annular sectors each
    s.face(s.loop({{rb0, Bo[0]}, {bi[0], Bi[0]}, {bi[1], Bi[1]}, {rb2, Bi[2]}, {bo[1], Bo[2]}, {bo[0], Bo[1]}}, true),
           {}, s.plane(O, {0, 0, -1}, X));
    s.face(s.loop({{rb2, Bo[2]}, {bi[2], Bi[2]}, {bi[3], Bi[3]}, {rb0, Bi[0]}, {bo[3], Bo[0]}, {bo[2], Bo[3]}}, true),
           {}, s.plane(O, {0, 0, -1}, X));
    s.face(s.loop({{to[0], To[0]}, {to[1], To[1]}, {rt2, To[2]}, {ti[1], Ti[2]}, {ti[0], Ti[1]}, {rt0, Ti[0]}}, true),
           {}, s.plane({0, 0, H}, Z, X));
    s.face(s.loop({{to[2], To[2]}, {to[3], To[3]}, {rt0, To[0]}, {ti[3], Ti[0]}, {ti[2], Ti[3]}, {rt2, Ti[2]}}, true),
           {}, s.plane({0, 0, H}, Z, X));
    // window sides
    s.face(s.loop({{raa, Woa}, {gia, Wia}, {raA, WiA}, {goa, WoA}}, true), {},
           s.plane(cyl(Ri, ta, za), {-std::sin(ta), std::cos(ta), 0}, Z));
    s.face(s.loop({{gob, Wob}, {rbA, WoB}, {gib, WiB}, {rba, Wib}}, true), {},
           s.plane(cyl(Ri, tb, za), {std::sin(tb), -std::cos(tb), 0}, Z));
    s.face(s.loop({{oza, Woa}, {rba, Wob}, {iza, Wib}, {raa, Wia}}, true), {}, s.plane({0, 0, za}, Z, X));
    s.face(s.loop({{raA, WoA}, {izb, WiA}, {rbA, WiB}, {ozb, WoB}}, true), {}, s.plane({0, 0, zb}, {0, 0, -1}, X));
    Fixture f;
    f.name = "window-tube";
    f.text = s.doc();
    const double dA = Ro * Ro - Ri * Ri, w = tb - ta, h = zb - za;
    f.vol = PI * dA * H - w / 2 * dA * h;
    f.area = 2 * PI * Ro * H - Ro * w * h + 2 * PI * Ri * H - Ri * w * h + 2 * PI * dA + 2 * (Ro - Ri) * h + w * dA;
    return f;
}

// Cone frustum r1 at z=0, r2 at z=H (r2 > r1), seam at theta 0, disk caps.
Fixture frustum() {
    const double r1 = 3, r2 = 8, H = 10;
    Step s;
    int B[4], T[4];
    for (int k = 0; k < 4; ++k) { B[k] = s.vertex(cyl(r1, k * PI / 2, 0)); T[k] = s.vertex(cyl(r2, k * PI / 2, H)); }
    int b[4], t[4];
    for (int k = 0; k < 4; ++k) {
        b[k] = s.arc(B[k], B[(k + 1) % 4], {0, 0, 0}, Z, X, r1);
        t[k] = s.arc(T[k], T[(k + 1) % 4], {0, 0, H}, Z, X, r2);
    }
    const int seam = s.line(B[0], T[0]);
    s.face(s.loop({{b[0], B[0]}, {b[1], B[1]}, {b[2], B[2]}, {b[3], B[3]}, {seam, B[0]},
                   {t[3], T[0]}, {t[2], T[3]}, {t[1], T[2]}, {t[0], T[1]}, {seam, T[0]}}, true),
           {}, s.cone(O, Z, X, r1, std::atan((r2 - r1) / H)));
    s.face(s.loop({{b[3], B[0]}, {b[2], B[3]}, {b[1], B[2]}, {b[0], B[1]}}, true), {}, s.plane(O, {0, 0, -1}, X));
    s.face(s.loop({{t[0], T[0]}, {t[1], T[1]}, {t[2], T[2]}, {t[3], T[3]}}, true), {}, s.plane({0, 0, H}, Z, X));
    Fixture f;
    f.name = "frustum";
    f.text = s.doc();
    f.vol = PI * H / 3 * (r1 * r1 + r1 * r2 + r2 * r2);
    f.area = PI * (r1 + r2) * std::sqrt((r2 - r1) * (r2 - r1) + H * H) + PI * (r1 * r1 + r2 * r2);
    return f;
}

// Quarter torus (major R about z, minor r), theta in [0, pi/2]; disk caps.
Fixture torusQuarter() {
    const double R = 10, r = 3;
    Step s;
    // minor circles at theta 0 (plane y=0) and theta pi/2 (plane x=0); phi = k*pi/2
    auto P = [&](double th, double ph) {
        return Vec3{(R + r * std::cos(ph)) * std::cos(th), (R + r * std::cos(ph)) * std::sin(th), r * std::sin(ph)};
    };
    int U[4], V[4];
    for (int k = 0; k < 4; ++k) { U[k] = s.vertex(P(0, k * PI / 2)); V[k] = s.vertex(P(PI / 2, k * PI / 2)); }
    int u[4], v[4];   // minor arcs, phi k*pi/2 -> (k+1)*pi/2
    for (int k = 0; k < 4; ++k) {
        u[k] = s.arc(U[k], U[(k + 1) % 4], {R, 0, 0}, {0, -1, 0}, X, r);   // (-y) x (+x) = +z
        v[k] = s.arc(V[k], V[(k + 1) % 4], {0, R, 0}, X, Y, r);           // (+x) x (+y) = +z
    }
    const int seam = s.arc(U[0], V[0], O, Z, X, R + r);                       // phi = 0, theta 0 -> pi/2
    // torus face: minor circle at theta 0 (phi 0 -> 2pi), seam, minor circle at pi/2 back, seam back
    s.face(s.loop({{u[0], U[0]}, {u[1], U[1]}, {u[2], U[2]}, {u[3], U[3]}, {seam, U[0]},
                   {v[3], V[0]}, {v[2], V[3]}, {v[1], V[2]}, {v[0], V[1]}, {seam, V[0]}}, true),
           {}, s.torus(O, Z, X, R, r));
    s.face(s.loop({{u[3], U[0]}, {u[2], U[3]}, {u[1], U[2]}, {u[0], U[1]}}, true), {}, s.plane({R, 0, 0}, {0, -1, 0}, X));
    s.face(s.loop({{v[0], V[0]}, {v[1], V[1]}, {v[2], V[2]}, {v[3], V[3]}}, true), {}, s.plane({0, R, 0}, {-1, 0, 0}, Y));
    Fixture f;
    f.name = "torus-quarter";
    f.text = s.doc();
    f.vol = (PI / 2) * R * PI * r * r;
    f.area = (PI / 2) * R * 2 * PI * r + 2 * PI * r * r;
    return f;
}

// Cylinder R, bottom z=0, top cut by the plane z = h + t*x (an ellipse rim).
Fixture obliqueCut() {
    const double R = 5, h = 8, t = 0.5;
    Step s;
    int B[4], T[4];
    for (int k = 0; k < 4; ++k) {
        const Vec3 p = cyl(R, k * PI / 2, 0);
        B[k] = s.vertex(p);
        T[k] = s.vertex({p.x, p.y, h + t * p.x});
    }
    const Vec3 n = vnorm(Vec3{-t, 0, 1}), xe = vnorm(Vec3{1, 0, t});
    int b[4], e[4];
    for (int k = 0; k < 4; ++k) {
        b[k] = s.arc(B[k], B[(k + 1) % 4], O, Z, X, R);
        e[k] = s.ellipseArc(T[k], T[(k + 1) % 4], {0, 0, h}, n, xe, R * std::sqrt(1 + t * t), R);
    }
    const int seam = s.line(B[0], T[0]);
    s.face(s.loop({{b[0], B[0]}, {b[1], B[1]}, {b[2], B[2]}, {b[3], B[3]}, {seam, B[0]},
                   {e[3], T[0]}, {e[2], T[3]}, {e[1], T[2]}, {e[0], T[1]}, {seam, T[0]}}, true),
           {}, s.cylinder(O, Z, X, R));
    s.face(s.loop({{b[3], B[0]}, {b[2], B[3]}, {b[1], B[2]}, {b[0], B[1]}}, true), {}, s.plane(O, {0, 0, -1}, X));
    s.face(s.loop({{e[0], T[0]}, {e[1], T[1]}, {e[2], T[2]}, {e[3], T[3]}}, true), {}, s.plane({0, 0, h}, n, xe));
    Fixture f;
    f.name = "oblique-cut";
    f.text = s.doc();
    f.vol = PI * R * R * h;
    f.area = 2 * PI * R * h + PI * R * R + PI * R * R * std::sqrt(1 + t * t);
    f.mustRead = false;
    return f;
}

// Cylinder R, height H, with a square prism hole (side a, centred at (c,0)) along z.
Fixture holedDisk() {
    const double R = 10, H = 6, a = 4, c = 3;
    Step s;
    int B[4], T[4];
    for (int k = 0; k < 4; ++k) { B[k] = s.vertex(cyl(R, k * PI / 2, 0)); T[k] = s.vertex(cyl(R, k * PI / 2, H)); }
    int b[4], t[4];
    for (int k = 0; k < 4; ++k) {
        b[k] = s.arc(B[k], B[(k + 1) % 4], O, Z, X, R);
        t[k] = s.arc(T[k], T[(k + 1) % 4], {0, 0, H}, Z, X, R);
    }
    const int seam = s.line(B[0], T[0]);
    const double sx[4] = {c - a / 2, c + a / 2, c + a / 2, c - a / 2}, sy[4] = {-a / 2, -a / 2, a / 2, a / 2};
    int Q[4], W[4];
    for (int k = 0; k < 4; ++k) { Q[k] = s.vertex({sx[k], sy[k], 0}); W[k] = s.vertex({sx[k], sy[k], H}); }
    int q[4], w[4], g[4];
    for (int k = 0; k < 4; ++k) {
        q[k] = s.line(Q[k], Q[(k + 1) % 4]);
        w[k] = s.line(W[k], W[(k + 1) % 4]);
        g[k] = s.line(Q[k], W[k]);
    }
    s.face(s.loop({{b[0], B[0]}, {b[1], B[1]}, {b[2], B[2]}, {b[3], B[3]}, {seam, B[0]},
                   {t[3], T[0]}, {t[2], T[3]}, {t[1], T[2]}, {t[0], T[1]}, {seam, T[0]}}, true),
           {}, s.cylinder(O, Z, X, R));
    s.face(s.loop({{b[3], B[0]}, {b[2], B[3]}, {b[1], B[2]}, {b[0], B[1]}}, true),
           {s.loop({{q[0], Q[0]}, {q[1], Q[1]}, {q[2], Q[2]}, {q[3], Q[3]}}, false)}, s.plane(O, {0, 0, -1}, X));
    s.face(s.loop({{t[0], T[0]}, {t[1], T[1]}, {t[2], T[2]}, {t[3], T[3]}}, true),
           {s.loop({{w[3], W[0]}, {w[2], W[3]}, {w[1], W[2]}, {w[0], W[1]}}, false)}, s.plane({0, 0, H}, Z, X));
    // hole walls, outward normal pointing INTO the hole
    const Vec3 nrm[4] = {{0, 1, 0}, {-1, 0, 0}, {0, -1, 0}, {1, 0, 0}};
    for (int k = 0; k < 4; ++k) {
        const int n = (k + 1) % 4;
        s.face(s.loop({{q[k], Q[k]}, {g[n], Q[n]}, {w[k], W[n]}, {g[k], W[k]}}, true), {},
               s.plane({sx[k], sy[k], 0}, nrm[k], vnorm(vsub(Vec3{sx[n], sy[n], 0}, Vec3{sx[k], sy[k], 0}))));
    }
    Fixture f;
    f.name = "holed-disk";
    f.text = s.doc();
    f.vol = (PI * R * R - a * a) * H;
    f.area = 2 * PI * R * H + 2 * (PI * R * R - a * a) + 4 * a * H;
    return f;
}

// ---------------------------------------------------------------------------
std::string readVerdict(const AnalyticReadResult& r, const Fixture& f, bool& exact, bool& refused,
                        double& vrel, double& arel) {
    refused = !(r.ok && r.solid);
    exact = false; vrel = arel = -1;
    if (refused) return "REFUSED (" + r.reason.substr(0, 110) + ")";
    const MassProps m = massProperties(*r.solid);
    vrel = rel(m.volume, f.vol); arel = rel(m.area, f.area);
    exact = vrel <= 1e-9 && arel <= 1e-9;
    char b[200];
    std::snprintf(b, sizeof b, "ok vol %.12g (closed form %.12g, rel %.2e) area %.12g (closed form %.12g, rel %.2e)",
                  m.volume, f.vol, vrel, m.area, f.area, arel);
    return b;
}

void runFixture(Fixture f) {
    const double s3 = g_xf.sc * g_xf.sc * g_xf.sc, s2 = g_xf.sc * g_xf.sc;
    f.vol *= s3; f.area *= s2;
    if (!g_xf.tag.empty()) f.name += "@" + g_xf.tag;
    std::printf("[%s] closed form: volume %.12g, area %.12g%s\n", f.name.c_str(), f.vol, f.area,
                f.mustRead ? "" : "  (an exact read is not representable: must be REFUSED)");
    bool exact, refused; double vr, ar;
    // rung 1: StepAnalytic::read on the fixture text itself
    const AnalyticReadResult r1 = StepAnalytic::read(f.text);
    const std::string v1 = readVerdict(r1, f, exact, refused, vr, ar);
    if (f.mustRead) check(exact, f.name + " rung-1 StepAnalytic::read EXACT: " + v1);
    else            check(refused, f.name + " rung-1 StepAnalytic::read REFUSED: " + v1);
    // round trip: readForeignStep (the import) -> write -> read (FgCopyBody's path)
    const ForeignReadResult fr = readForeignStep(f.text);
    if (!(fr.ok && fr.solid && fr.unsupported.empty() && fr.closed)) {
        check(false, f.name + " readForeignStep did not import the fixture: " + fr.reason);
        return;
    }
    const MassProps ms = massProperties(*fr.solid);
    std::printf("        source (readForeignStep): vol %.12g (rel %.2e) area %.12g (rel %.2e)\n",
                ms.volume, rel(ms.volume, f.vol), ms.area, rel(ms.area, f.area));
    const AnalyticWriteResult w = StepAnalytic::write(*fr.solid, f.name);
    if (!w.ok) { check(false, f.name + " StepAnalytic::write failed: " + w.reason); return; }
    const AnalyticReadResult r2 = StepAnalytic::read(w.text);
    const std::string v2 = readVerdict(r2, f, exact, refused, vr, ar);
    char prov[160];
    std::snprintf(prov, sizeof prov, " [written edges: curve=%zu arc=%zu line=%zu CHORD=%zu]",
                  w.edgesFromCurve, w.edgesInferredArc, w.edgesLine, w.edgesChord);
    // An exact file (no chord edges) must be read exactly; a file whose writer had
    // to emit chords for curved edges (edgesChord > 0: the imported source carries
    // no Edge::curve, T-271) is inexact, and then REFUSED is the honest answer.
    if (!f.mustRead)          check(refused, f.name + " round trip REFUSED: " + v2 + prov);
    else if (w.edgesChord == 0) check(exact, f.name + " round trip EXACT (an exact file): " + v2 + prov);
    else                      check(exact || refused, f.name + " round trip EXACT or REFUSED (chords written): " + v2 + prov);
}

// Holed disk caps: the round trip must reproduce the source and cut the holes.
void runHoledDisk() {
    const Fixture f = holedDisk();
    std::printf("[%s] closed form: volume %.12g, area %.12g (a planar arc face integrates as its polygon)\n",
                f.name.c_str(), f.vol, f.area);
    const ForeignReadResult fr = readForeignStep(f.text);
    if (!(fr.ok && fr.solid && fr.unsupported.empty() && fr.closed)) {
        check(false, f.name + " readForeignStep did not import the fixture: " + fr.reason);
        return;
    }
    const MassProps ms = massProperties(*fr.solid);
    const AnalyticWriteResult w = StepAnalytic::write(*fr.solid, f.name);
    if (!w.ok) { check(false, f.name + " StepAnalytic::write failed: " + w.reason); return; }
    const AnalyticReadResult r = StepAnalytic::read(w.text);
    if (!(r.ok && r.solid)) { check(true, f.name + " round trip REFUSED: " + r.reason); return; }
    const MassProps m = massProperties(*r.solid);
    char b[260];
    std::snprintf(b, sizeof b, ": source vol %.12g area %.12g | read vol %.12g (rel %.2e) area %.12g (rel %.2e)",
                  ms.volume, ms.area, m.volume, rel(m.volume, ms.volume), m.area, rel(m.area, ms.area));
    check(rel(m.volume, ms.volume) <= 1e-9 && rel(m.area, ms.area) <= 1e-9, f.name + " round trip == source" + b);
    // the full-disk solid's area minus the read area must be the two holes (2 a^2 = 32)
    const double fullDiskArea = f.area + 2 * 16.0;   // same solid with the caps' holes filled
    const double cut = fullDiskArea - m.area;
    std::snprintf(b, sizeof b, ": area deficit vs the unholed caps %.6f (holes 32, >= 28.8 required)", cut);
    check(cut >= 0.9 * 32.0, f.name + " the caps' holes are cut out" + b);
}

// ---------------------------------------------------------------------------
struct Built { std::string name; std::shared_ptr<TopologyBuilder> keep; std::unique_ptr<SolidFactory> fac; Solid* s = nullptr; };

void runNoRegression() {
    std::printf("[no-regression] analytic builders round-trip exactly and are not refused\n");
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
    op("varfillet_R1_R2",       [](TopologyBuilder& tb) {
        auto r = filletBoxEdgeVariable(tb, 10.0, 1.0, 2.0, 4); return r.ok ? r.solid : nullptr; });
    for (Built& b : out) {
        if (!b.s) { check(false, b.name + ": builder returned null"); continue; }
        const AnalyticWriteResult w = StepAnalytic::write(*b.s);
        if (!w.ok) { check(false, b.name + ": write failed — " + w.reason); continue; }
        const AnalyticReadResult r = StepAnalytic::read(w.text);
        if (!r.ok || !r.solid) { check(false, b.name + ": REFUSED — " + r.reason); continue; }
        const MassProps a = massProperties(*b.s), c = massProperties(*r.solid);
        char buf[220];
        std::snprintf(buf, sizeof buf, ": volume %.9f -> %.9f (rel %.2e), area %.9f -> %.9f (rel %.2e)",
                      a.volume, c.volume, rel(c.volume, a.volume), a.area, c.area, rel(c.area, a.area));
        check(rel(c.volume, a.volume) <= 1e-9 && rel(c.area, a.area) <= 1e-9, b.name + buf);
    }
}

// ---------------------------------------------------------------------------
// --corpus LIST: A1 / A2 tally. One fork per file (a crash is reported).
int runCorpus(const char* list) {
    std::ifstream lf(list);
    if (!lf) { std::fprintf(stderr, "cannot open %s\n", list); return 2; }
    std::vector<std::string> files;
    for (std::string l; std::getline(lf, l);) if (!l.empty()) files.push_back(l);
    std::map<std::string, int> tally;
    for (const std::string& path : files) {
        int fd[2];
        if (pipe(fd)) return 2;
        const pid_t pid = fork();
        if (pid == 0) {
            close(fd[0]);
            alarm(120);
            std::ifstream in(path, std::ios::binary);
            std::stringstream ss; ss << in.rdbuf();
            const std::string text = ss.str();
            std::string out;
            char b[400];
            const AnalyticReadResult a = StepAnalytic::read(text);
            ForeignReadResult fr;
            const Solid* s = nullptr; const char* via = "DECLINED";
            if (a.ok && a.solid) { s = a.solid; via = "SA"; }
            else {
                fr = readForeignStep(text);
                if (fr.ok && fr.solid && fr.unsupported.empty() && fr.closed) { s = fr.solid; via = "RF"; }
            }
            if (!s) out = std::string(via) + " -\n";
            else {
                const MassProps m0 = massProperties(*s);
                const AnalyticWriteResult w = StepAnalytic::write(*s);
                if (!w.ok) std::snprintf(b, sizeof b, "%s WRITE_FAIL\n", via);
                else {
                    const AnalyticReadResult r = StepAnalytic::read(w.text);
                    if (!(r.ok && r.solid)) std::snprintf(b, sizeof b, "%s REFUSED (%.90s)\n", via, r.reason.c_str());
                    else {
                        const MassProps m1 = massProperties(*r.solid);
                        const double vr = rel(m1.volume, m0.volume), ar = rel(m1.area, m0.area);
                        std::snprintf(b, sizeof b, "%s %s vrel=%.3e arel=%.3e\n", via,
                                      vr <= 1e-9 ? (ar <= 1e-9 ? "EXACT" : "VOL_EXACT_AREA_DIFF") : "WRONG", vr, ar);
                    }
                }
                out = b;
            }
            const ssize_t wr = write(fd[1], out.data(), out.size());
            (void)wr;
            _exit(0);
        }
        close(fd[1]);
        std::string got; char bb[512]; ssize_t n;
        while ((n = read(fd[0], bb, sizeof bb)) > 0) got.append(bb, static_cast<std::size_t>(n));
        close(fd[0]);
        int st = 0; waitpid(pid, &st, 0);
        if (got.empty()) got = "CRASH -\n";
        std::printf("%-90s %s", path.c_str(), got.c_str());
        std::istringstream gs(got);
        std::string via, verdict;
        gs >> via >> verdict;
        ++tally[via + " " + verdict];
    }
    int wrong = 0;
    for (const auto& kv : tally) {
        std::printf("[corpus] %-32s %d\n", kv.first.c_str(), kv.second);
        if (kv.first.find("WRONG") != std::string::npos || kv.first.find("CRASH") != std::string::npos) wrong += kv.second;
    }
    std::printf("[corpus] %zu files, %d round trips WRONG in volume (or crashed)\n", files.size(), wrong);
    return wrong == 0 ? 0 : 1;
}

} // namespace

int main(int argc, char** argv) {
    for (int i = 1; i + 1 < argc; ++i)
        if (std::strcmp(argv[i], "--corpus") == 0) return runCorpus(argv[i + 1]);
    for (int i = 1; i + 1 < argc; ++i)
        if (std::strcmp(argv[i], "--dump") == 0) {   // write the fixtures for inspection
            const std::string dir = argv[i + 1];
            for (const Fixture& f : {lSector(false), lSector(true), windowTube(), frustum(), torusQuarter(),
                                     obliqueCut(), holedDisk()}) {
                std::ofstream o(dir + "/" + f.name + ".step");
                o << f.text;
            }
            return 0;
        }

    std::printf("[step-trim] a curved face is read as the face it is (closed form), or refused\n");
    runFixture(lSector(false));
    runFixture(lSector(true));
    runFixture(windowTube());
    runFixture(frustum());
    runFixture(torusQuarter());
    runFixture(obliqueCut());
    // metamorphic: the same closed forms far from the origin in an oblique frame,
    // and shrunk to a 0.05 scale part
    for (const Xf& x : {makeXf("far-oblique", {1, 2, 3}, 0.7, {1234.5, -2345.25, 3456.75}, 1.0),
                        makeXf("small", {-2, 1, 0.5}, 2.1, {3.5, 1.25, -7.0}, 0.05)}) {
        g_xf = x;
        runFixture(lSector(false));
        runFixture(windowTube());
        runFixture(frustum());
        runFixture(torusQuarter());
        runFixture(obliqueCut());
    }
    g_xf = Xf{};
    runHoledDisk();
    runNoRegression();
    std::printf("[step-trim] %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
