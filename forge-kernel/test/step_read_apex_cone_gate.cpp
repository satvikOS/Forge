// step_read_apex_cone_gate.cpp — T-272. readForeignStep must read an APEX cone
// as the cone it is, or not hand it to importStep at all.
//
// THE DEFECT THIS PINS (measured at b609b41d and at work/T-158 ed241f37):
// SolidFactory::buildCone(3, 0, 5) written by StepAnalytic::write and read back
// by readForeignStep came back ok=1 closed=1 unsupported=0 with volume
// 35.342917353 vs 47.123889804 (rel 2.500e-01) -- and the same 25 % loss at every
// size and aspect (0.03 x 0.05, 300 x 500, 1 x 20, 20 x 1). importStep's ladder
// accepts a readForeignStep result when ok && closed && unsupported.empty(), so a
// native apex cone re-imported through that rung is silently a quarter light.
// Cause (diagnosed): the apex is one 3D point but a whole row v = v_apex in the
// cone's (u,v) chart; readForeignStep's region polygon (buildRegionPolygon) maps
// it to ONE (u,v) point, so every apex sector [u_i,u_i+1] x [0,1] is integrated as
// a triangle missing the row.
//
// THE ORACLE IS CLOSED FORM: volume pi r^2 h / 3 and conical (lateral) area
// pi r sqrt(r^2 + h^2), compared to 1e-9 relative. The lateral area is summed
// over the CONE faces only: the base cap is a planar face bounded by arcs, which
// readForeignStep integrates as a chord polygon (a separate, documented limit);
// the cones here stand on z = const caps, whose flux is zero in MassProps'
// x n_x volume form, so the volume is not polluted by it either.
//
// RULE per fixture: if importStep's ladder would ACCEPT the read (ok && closed &&
// unsupported.empty()), volume and lateral area must be EXACT; otherwise the
// fixture is REFUSED (honest -- importStep falls through) and passes, printed as
// such. The native-builder cases must additionally be ACCEPTED (Forge's own
// primitive must re-import natively; base accepts them -- wrongly).
//
// FIXTURES
//   native: buildCone(r, 0, h) for (3,5) (the ledger case), (0.03,0.05),
//           (300,500), (1,20), (20,1), written by StepAnalytic::write
//   hand-written analytic STEP (own emitter, no Forge writer):
//     sectors  4 conical sector faces meeting at the apex vertex + a disk cap
//     seam     one conical face: base circle (4 arcs), a seam generator up to the
//              apex and back down (the AP214 single-face form)
//     apex-down the seam form with the apex BELOW the base, translated far off
//              the origin
//
// usage: step_read_apex_cone_gate   (exit 0 = pass, 1 = fail)
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/Primitives.hpp"
#include "forge/native/brep/StepAnalytic.hpp"
#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/Topology.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <map>
#include <string>
#include <utility>
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
// A minimal analytic STEP emitter (independent of StepAnalytic::write). Every
// point is offset by `shift`.
// ---------------------------------------------------------------------------
struct Step {
    std::string d;
    int id = 0;
    Vec3 shift{0, 0, 0};
    std::map<int, Vec3> vpos;
    struct E { int vs, ve; };
    std::map<int, E> edges;
    std::vector<int> faces;

    static std::string num(double x) {
        char b[40];
        std::snprintf(b, sizeof b, "%.17g", x);
        std::string s = b;
        if (s.find_first_of(".eEn") == std::string::npos) s += '.';
        return s;
    }
    static std::string ref(int i) { return "#" + std::to_string(i); }
    int add(const std::string& body) { ++id; d += ref(id) + "=" + body + ";\n"; return id; }
    int pt(const Vec3& p0) {
        const Vec3 p = vadd(p0, shift);
        return add("CARTESIAN_POINT('',(" + num(p.x) + "," + num(p.y) + "," + num(p.z) + "))");
    }
    int dir(const Vec3& v0) {
        const Vec3 v = vnorm(v0);
        return add("DIRECTION('',(" + num(v.x) + "," + num(v.y) + "," + num(v.z) + "))");
    }
    int ax2(const Vec3& o, const Vec3& z, const Vec3& x) {
        const int a = pt(o), b = dir(z), c = dir(x);
        return add("AXIS2_PLACEMENT_3D(''," + ref(a) + "," + ref(b) + "," + ref(c) + ")");
    }
    int vertex(const Vec3& p) { const int v = add("VERTEX_POINT(''," + ref(pt(p)) + ")"); vpos[v] = p; return v; }
    int edge(int vs, int ve, int curve) {
        const int e = add("EDGE_CURVE(''," + ref(vs) + "," + ref(ve) + "," + ref(curve) + ",.T.)");
        edges[e] = {vs, ve};
        return e;
    }
    int line(int vs, int ve) {
        const Vec3 A = vpos.at(vs), B = vpos.at(ve);
        const int p = pt(A), dr = dir(vsub(B, A));
        const int vec = add("VECTOR(''," + ref(dr) + "," + num(vlen(vsub(B, A))) + ")");
        return edge(vs, ve, add("LINE(''," + ref(p) + "," + ref(vec) + ")"));
    }
    int arc(int vs, int ve, const Vec3& c, const Vec3& n, const Vec3& x, double r) {
        return edge(vs, ve, add("CIRCLE(''," + ref(ax2(c, n, x)) + "," + num(r) + ")"));
    }
    int loop(const std::vector<std::pair<int, int>>& uses) {
        std::string oes = "(";
        for (std::size_t i = 0; i < uses.size(); ++i) {
            const bool fwd = edges.at(uses[i].first).vs == uses[i].second;
            const int oe = add("ORIENTED_EDGE('',*,*," + ref(uses[i].first) + (fwd ? ",.T.)" : ",.F.)"));
            oes += (i ? "," : "") + ref(oe);
        }
        const int el = add("EDGE_LOOP(''," + oes + "))");
        return add("FACE_OUTER_BOUND(''," + ref(el) + ",.T.)");
    }
    int plane(const Vec3& o, const Vec3& n, const Vec3& x) { return add("PLANE(''," + ref(ax2(o, n, x)) + ")"); }
    int cone(const Vec3& o, const Vec3& n, const Vec3& x, double r, double semi) {
        return add("CONICAL_SURFACE(''," + ref(ax2(o, n, x)) + "," + num(r) + "," + num(semi) + ")");
    }
    void face(int bound, int surf) { faces.push_back(add("ADVANCED_FACE(''," + std::string("(") + ref(bound) + ")," + ref(surf) + ",.T.)")); }
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

const Vec3 X{1, 0, 0}, Z{0, 0, 1};
Vec3 ring(double r, double th, double z) { return Vec3{r * std::cos(th), r * std::sin(th), z}; }

// Apex cone of base radius r at z = 0 and apex at z = h, tiled into 4 sector faces.
std::string sectorsCone(double r, double h) {
    Step s;
    const int A = s.vertex({0, 0, h});
    int B[4];
    for (int k = 0; k < 4; ++k) B[k] = s.vertex(ring(r, k * PI / 2, 0));
    int arcs[4], gen[4];
    for (int k = 0; k < 4; ++k) {
        arcs[k] = s.arc(B[k], B[(k + 1) % 4], {0, 0, 0}, Z, X, r);
        gen[k] = s.line(B[k], A);
    }
    // the cone: apex at +h above the placement, opening DOWN -> place it at the
    // apex with axis -z and radius 0 there, semi-angle atan(r/h)
    for (int k = 0; k < 4; ++k) {
        const int n = (k + 1) % 4;
        s.face(s.loop({{arcs[k], B[k]}, {gen[n], B[n]}, {gen[k], A}}), s.cone({0, 0, h}, {0, 0, -1}, X, 0.0, std::atan(r / h)));
    }
    s.face(s.loop({{arcs[3], B[0]}, {arcs[2], B[3]}, {arcs[1], B[2]}, {arcs[0], B[1]}}), s.plane({0, 0, 0}, {0, 0, -1}, X));
    return s.doc();
}

// One conical face with a seam: base circle (4 arcs), seam up to the apex and
// back. apexUp: apex at z = h above the base at z = 0; else apex at z = -h.
std::string seamCone(double r, double h, bool apexUp, const Vec3& shift) {
    Step s;
    s.shift = shift;
    const double za = apexUp ? h : -h;
    const int A = s.vertex({0, 0, za});
    int B[4];
    for (int k = 0; k < 4; ++k) B[k] = s.vertex(ring(r, k * PI / 2, 0));
    int arcs[4];
    for (int k = 0; k < 4; ++k) arcs[k] = s.arc(B[k], B[(k + 1) % 4], {0, 0, 0}, Z, X, r);
    const int seam = s.line(B[0], A);
    const Vec3 axis = apexUp ? Vec3{0, 0, -1} : Vec3{0, 0, 1};   // from the apex toward the base
    s.face(s.loop({{arcs[0], B[0]}, {arcs[1], B[1]}, {arcs[2], B[2]}, {arcs[3], B[3]}, {seam, B[0]}, {seam, A}}),
           s.cone({0, 0, za}, axis, X, 0.0, std::atan(r / h)));
    const Vec3 capN = apexUp ? Vec3{0, 0, -1} : Vec3{0, 0, 1};
    if (apexUp)
        s.face(s.loop({{arcs[3], B[0]}, {arcs[2], B[3]}, {arcs[1], B[2]}, {arcs[0], B[1]}}), s.plane({0, 0, 0}, capN, X));
    else
        s.face(s.loop({{arcs[0], B[0]}, {arcs[1], B[1]}, {arcs[2], B[2]}, {arcs[3], B[3]}}), s.plane({0, 0, 0}, capN, X));
    return s.doc();
}

MassProps faceProps(Face* f) {
    Shell sh; sh.faces.push_back(f);
    Solid s; s.shells.push_back(&sh);
    return massProperties(s);
}

// mustAccept: the import ladder must take the read (Forge's own primitive).
void judge(const std::string& name, const std::string& text, double r, double h, bool mustAccept) {
    const double V = PI * r * r * h / 3.0, L = PI * r * std::sqrt(r * r + h * h);
    const ForeignReadResult fr = readForeignStep(text);
    std::size_t unsup = 0;
    for (const auto& kv : fr.unsupported) unsup += kv.second;
    const bool accepted = fr.ok && fr.solid && fr.closed && unsup == 0;
    char b[400];
    if (!accepted) {
        std::snprintf(b, sizeof b, " REFUSED by the import ladder (ok=%d closed=%d unsupported=%zu%s%s)",
                      fr.ok ? 1 : 0, fr.closed ? 1 : 0, unsup, fr.reason.empty() ? "" : ": ", fr.reason.c_str());
        check(!mustAccept, name + b + (mustAccept ? " -- Forge's own apex cone must re-import" : ""));
        return;
    }
    const MassProps m = massProperties(*fr.solid);
    double lat = 0.0;
    std::size_t nCone = 0;
    for (Shell* sh : fr.solid->shells)
        for (Face* f : sh->faces)
            if (f->surface && f->surface->kind == SurfaceKind::Cone) { lat += faceProps(f).area; ++nCone; }
    std::snprintf(b, sizeof b,
                  ": ACCEPTED, volume %.12g (closed form %.12g, rel %.3e), conical area %.12g over %zu faces "
                  "(closed form %.12g, rel %.3e)",
                  m.volume, V, rel(m.volume, V), lat, nCone, L, rel(lat, L));
    check(rel(m.volume, V) <= 1e-9 && rel(lat, L) <= 1e-9, name + b);
}

} // namespace

int main() {
    std::printf("[apex-cone] readForeignStep reads an apex cone exactly, or the import ladder refuses it\n");
    const double native[][2] = {{3, 5}, {0.03, 0.05}, {300, 500}, {1, 20}, {20, 1}};
    for (const auto& c : native) {
        SolidFactory fac;
        const Solid* s = fac.buildCone(c[0], 0.0, c[1]);
        char name[80];
        std::snprintf(name, sizeof name, "native buildCone(%g,0,%g)", c[0], c[1]);
        if (!s) { check(false, std::string(name) + ": builder returned null"); continue; }
        const AnalyticWriteResult w = StepAnalytic::write(*s);
        if (!w.ok) { check(false, std::string(name) + ": StepAnalytic::write failed: " + w.reason); continue; }
        judge(name, w.text, c[0], c[1], /*mustAccept=*/true);
    }
    judge("hand-written 4 sectors r3 h5", sectorsCone(3, 5), 3, 5, false);
    judge("hand-written seam r3 h5 apex up", seamCone(3, 5, true, {0, 0, 0}), 3, 5, false);
    judge("hand-written seam r4 h2 apex down, shifted far", seamCone(4, 2, false, {1500.25, -2750.5, 900.75}), 4, 2, false);
    std::printf("[apex-cone] %d checks, %d failed\n", g_checks, g_fail);
    return g_fail == 0 ? 0 : 1;
}
