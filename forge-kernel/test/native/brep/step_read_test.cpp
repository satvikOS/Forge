// forge/native/brep/step_read_test.cpp
//
// Native (OCCT-free) gate for K6-core — the FOREIGN STEP READER
// forge::native::brep::readForeignStep (StepRead.hpp). Auto-discovered by
// run_native.sh (the `brep` class). This is the keystone "ingest a real-world
// part, not just round-trip our own dialect" reader: it parses an ARBITRARY
// external ISO-10303-21 (AP203/AP214/AP242) instance file into the native B-rep
// (the K1 trimmed-NURBS faces + the K1.4 native sew), so OCCT is not needed to
// read a foreign STEP.
//
// Build + run (run_native.sh discovers this automatically; manual line below —
// the same whole-object-set link run_native.sh uses, narrowed to the deps):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     forge-kernel/src/native/brep/StepRead.cpp \
//     forge-kernel/src/native/brep/Surface.cpp \
//     forge-kernel/src/native/brep/Topology.cpp \
//     forge-kernel/src/native/brep/MassProps.cpp \
//     forge-kernel/src/native/brep/Sew.cpp \
//     forge-kernel/src/native/brep/TrimmedFace.cpp \
//     forge-kernel/src/native/brep/Nurbs.cpp \
//     forge-kernel/src/native/brep/NurbsSurface.cpp \
//     forge-kernel/src/native/brep/NurbsCalculus.cpp \
//     forge-kernel/src/native/brep/NurbsAlgebra.cpp \
//     forge-kernel/src/native/brep/Curve.cpp \
//     forge-kernel/src/native/geom/ConstrainedDelaunay2D.cpp \
//     forge-kernel/src/native/geom/Geom.cpp \
//     forge-kernel/src/native/geom/Delaunay.cpp \
//     forge-kernel/src/native/Predicates.cpp \
//     forge-kernel/test/native/brep/step_read_test.cpp \
//     -o /tmp/step_read_test && /tmp/step_read_test
//
// VALIDATION GATES (asserted below):
//   (1) PLANAR BOX SOLID (mm). A 6-face MANIFOLD_SOLID_BREP whose faces are
//       INDEPENDENT ADVANCED_FACE records (private vertices, as in a real file) is
//       read, the native sew welds the coincident boundaries into a CLOSED 2-
//       manifold shell, the face count is 6, and the solid VOLUME equals the known
//       L_x·L_y·L_z to <= 1e-6 (planar-exact divergence integral).
//   (2) UNIT SCALING. The same box geometry declared in INCH units imports with
//       every coordinate scaled by 25.4, so the reported volume is the mm volume
//       (inch³ × 25.4³). Confirms the length-unit context is honoured.
//   (3) B-SPLINE FACE + HOLE. An ADVANCED_FACE backed by a
//       B_SPLINE_SURFACE_WITH_KNOTS (a planar bilinear patch S(u,v)=(L·u,L·v,0))
//       with an OUTER bound + an inner FACE_BOUND (hole) reads into a native
//       TrimmedFace whose trim loops are the FILE's LITERAL boundary edges
//       (inverted onto the surface (u,v)) — the inner FACE_BOUND is the file's
//       actual SQUARE hole (side 0.2·L), NOT a synthesized round hole. Its
//       trimmed-patch AREA round-trips L² − (0.2·L)² (planar-exact Green path) to
//       <= 1e-6, matching OCCT's literal trim of the same file.
//   (4) HONEST UNSUPPORTED REPORT. A face whose surface is a SURFACE_OF_REVOLUTION
//       (not in the supported zoo) is RECORDED in `unsupported` — NOT silently
//       dropped — and the read still succeeds for the supported remainder.
//   (5) HONEST FAILURE. Garbage / a dangling shell ref -> ok=false (no fake).
//
// Pure C++20, no external deps, no test framework.

#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/TrimmedFace.hpp"
#include "forge/native/brep/StepAnalytic.hpp"   // generate a quadric body to ingest
#include "forge/native/brep/Primitives.hpp"      // SolidFactory (cylinder)

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <string>
#include <vector>

using namespace forge::native::brep;

static int g_pass = 0, g_total = 0;
static void check(bool cond, const std::string& name) {
    ++g_total;
    std::printf(cond ? "  [PASS] %s\n" : "  [FAIL] %s\n", name.c_str());
    if (cond) ++g_pass;
}
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double scale = std::max(1.0, std::fabs(exp));
    return d <= tol * scale;
}
static constexpr double kPi = 3.14159265358979323846;

// ===========================================================================
// SNIPPET BUILDERS — hand-written, valid ISO-10303-21 instance documents. Built
// programmatically (with an id allocator) so the box's 8 vertices / 6 faces are
// laid out exactly, with INDEPENDENT vertices per face (the real foreign case:
// each ADVANCED_FACE owns its own VERTEX_POINTs, so closure is a genuine test of
// the sew, not an artefact of shared topology).
// ===========================================================================

// Build a closed box [0,Lx]x[0,Ly]x[0,Lz] STEP with each of the 6 faces emitting
// its OWN 4 VERTEX_POINTs (independent), planes, edges, loops. `unitBlock` is the
// pre-built unit-context complex record + GEOMETRIC_REPRESENTATION_CONTEXT.
static std::string makeBox(double Lx, double Ly, double Lz, const std::string& unit) {
    std::string s;
    std::uint64_t id = 1;
    auto A = [&]() { return id++; };
    std::string data;
    auto emit = [&](std::uint64_t i, const std::string& body) {
        data += "#"; data += std::to_string(i); data += "="; data += body; data += ";\n";
    };
    auto P = [&](double x, double y, double z) -> std::uint64_t {
        std::uint64_t i = A();
        char buf[128];
        std::snprintf(buf, sizeof(buf), "CARTESIAN_POINT('',(%.17g,%.17g,%.17g))", x, y, z);
        emit(i, buf); return i;
    };
    auto DIR = [&](double x, double y, double z) -> std::uint64_t {
        std::uint64_t i = A();
        char buf[128];
        std::snprintf(buf, sizeof(buf), "DIRECTION('',(%.17g,%.17g,%.17g))", x, y, z);
        emit(i, buf); return i;
    };
    auto VP = [&](std::uint64_t pt) -> std::uint64_t {
        std::uint64_t i = A();
        emit(i, "VERTEX_POINT('',#" + std::to_string(pt) + ")"); return i;
    };
    auto AX2 = [&](std::uint64_t o, std::uint64_t a, std::uint64_t r) -> std::uint64_t {
        std::uint64_t i = A();
        emit(i, "AXIS2_PLACEMENT_3D('',#" + std::to_string(o) + ",#" +
                std::to_string(a) + ",#" + std::to_string(r) + ")"); return i;
    };

    // One ADVANCED_FACE for a planar quad given its 4 corner coordinates (CCW as
    // seen from OUTSIDE) and the outward normal + an in-plane ref direction.
    std::vector<std::uint64_t> faceIds;
    auto quadFace = [&](double c[4][3], double nx, double ny, double nz,
                        double rx, double ry, double rz) {
        std::uint64_t vp[4], pt[4];
        for (int k = 0; k < 4; ++k) { pt[k] = P(c[k][0], c[k][1], c[k][2]); vp[k] = VP(pt[k]); }
        // EDGE_CURVEs (LINE geometry) + ORIENTED_EDGEs around the quad.
        std::uint64_t oe[4];
        for (int k = 0; k < 4; ++k) {
            int a = k, b = (k + 1) % 4;
            // LINE through corner a in direction (b-a).
            double dx = c[b][0]-c[a][0], dy = c[b][1]-c[a][1], dz = c[b][2]-c[a][2];
            double L = std::sqrt(dx*dx+dy*dy+dz*dz);
            std::uint64_t lp = P(c[a][0], c[a][1], c[a][2]);
            std::uint64_t ld = DIR(dx/L, dy/L, dz/L);
            std::uint64_t vec = A();
            emit(vec, "VECTOR('',#" + std::to_string(ld) + "," + std::to_string(L) + ")");
            std::uint64_t line = A();
            emit(line, "LINE('',#" + std::to_string(lp) + ",#" + std::to_string(vec) + ")");
            std::uint64_t ec = A();
            emit(ec, "EDGE_CURVE('',#" + std::to_string(vp[a]) + ",#" + std::to_string(vp[b]) +
                     ",#" + std::to_string(line) + ",.T.)");
            std::uint64_t o = A();
            emit(o, "ORIENTED_EDGE('',*,*,#" + std::to_string(ec) + ",.T.)");
            oe[k] = o;
        }
        std::uint64_t loop = A();
        emit(loop, "EDGE_LOOP('',(#" + std::to_string(oe[0]) + ",#" + std::to_string(oe[1]) +
                   ",#" + std::to_string(oe[2]) + ",#" + std::to_string(oe[3]) + "))");
        std::uint64_t bound = A();
        emit(bound, "FACE_OUTER_BOUND('',#" + std::to_string(loop) + ",.T.)");
        std::uint64_t org = P(c[0][0], c[0][1], c[0][2]);
        std::uint64_t ax = DIR(nx, ny, nz);
        std::uint64_t rf = DIR(rx, ry, rz);
        std::uint64_t pl3 = AX2(org, ax, rf);
        std::uint64_t plane = A();
        emit(plane, "PLANE('',#" + std::to_string(pl3) + ")");
        std::uint64_t face = A();
        emit(face, "ADVANCED_FACE('',(#" + std::to_string(bound) + "),#" +
                   std::to_string(plane) + ",.T.)");
        faceIds.push_back(face);
    };

    // 8 corners.
    double X0=0,Y0=0,Z0=0,X1=Lx,Y1=Ly,Z1=Lz;
    // bottom (z=Z0), outward normal -Z, CCW seen from below
    { double c[4][3]={{X0,Y0,Z0},{X0,Y1,Z0},{X1,Y1,Z0},{X1,Y0,Z0}}; quadFace(c, 0,0,-1, 0,1,0); }
    // top (z=Z1), outward +Z, CCW seen from above
    { double c[4][3]={{X0,Y0,Z1},{X1,Y0,Z1},{X1,Y1,Z1},{X0,Y1,Z1}}; quadFace(c, 0,0,1, 1,0,0); }
    // front (y=Y0), outward -Y
    { double c[4][3]={{X0,Y0,Z0},{X1,Y0,Z0},{X1,Y0,Z1},{X0,Y0,Z1}}; quadFace(c, 0,-1,0, 1,0,0); }
    // back (y=Y1), outward +Y
    { double c[4][3]={{X0,Y1,Z0},{X0,Y1,Z1},{X1,Y1,Z1},{X1,Y1,Z0}}; quadFace(c, 0,1,0, 0,0,1); }
    // left (x=X0), outward -X
    { double c[4][3]={{X0,Y0,Z0},{X0,Y0,Z1},{X0,Y1,Z1},{X0,Y1,Z0}}; quadFace(c, -1,0,0, 0,0,1); }
    // right (x=X1), outward +X
    { double c[4][3]={{X1,Y0,Z0},{X1,Y1,Z0},{X1,Y1,Z1},{X1,Y0,Z1}}; quadFace(c, 1,0,0, 0,1,0); }

    std::uint64_t shell = A();
    {
        std::string sb = "CLOSED_SHELL('',(";
        for (std::size_t k = 0; k < faceIds.size(); ++k) {
            if (k) sb += ",";
            sb += "#" + std::to_string(faceIds[k]);
        }
        sb += "))";
        emit(shell, sb);
    }
    std::uint64_t msb = A();
    emit(msb, "MANIFOLD_SOLID_BREP('box',#" + std::to_string(shell) + ")");
    // unit context (kept simple — referenced by no one but resolveLengthScaleMm
    // scans the whole table, so the standalone unit record is enough).
    data += unit;

    s += "ISO-10303-21;\n";
    s += "HEADER;\nFILE_DESCRIPTION(('foreign box'),'2;1');\n";
    s += "FILE_NAME('box','2026-01-01T00:00:00',(''),(''),'test','test','');\n";
    s += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\n";
    s += "DATA;\n";
    s += data;
    s += "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}

// SI millimetre unit context record.
static std::string unitMm() {
    return
      "#9001=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n"
      "#9002=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n";
}
// INCH unit context: CONVERSION_BASED_UNIT('inch',...) over a millimetre base.
static std::string unitInch() {
    return
      "#9101=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n"
      "#9102=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
      "#9103=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#9101);\n"
      "#9104=CONVERSION_BASED_UNIT('inch',#9103);\n";
}

// ===========================================================================
// B-SPLINE FACE + HOLE. A planar bilinear (degree-1) B-spline surface
//   S(u,v) = (L*u, L*v, 0)  over the clamped knot domain [0,1]x[0,1]
// (4 control points (0,0,0),(0,L,0),(L,0,0),(L,L,0)) so the trimmed-patch area is
// L^2 for the full-domain outer loop. The inner FACE_BOUND is a SQUARE ring of
// side 2h = 0.2*L; the reader inverts its literal LINE edges onto the surface
// (u,v) and trims the actual square hole, so the material area is L^2 - (0.2*L)^2.
// ===========================================================================
static std::string makeBSplineFaceWithHole(double L) {
    std::string s;
    char buf[256];
    s += "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('bspline face'),'2;1');\n";
    s += "FILE_NAME('bsp','2026-01-01T00:00:00',(''),(''),'test','test','');\n";
    s += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
    // control points
    std::snprintf(buf, sizeof(buf), "#1=CARTESIAN_POINT('',(0.,0.,0.));\n"); s += buf;
    std::snprintf(buf, sizeof(buf), "#2=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += buf;
    std::snprintf(buf, sizeof(buf), "#3=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += buf;
    std::snprintf(buf, sizeof(buf), "#4=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L); s += buf;
    // B_SPLINE_SURFACE_WITH_KNOTS: uDeg=1,vDeg=1, grid ((#1,#2),(#3,#4)), form
    // .UNSPECIFIED., uClosed .F., vClosed .F., selfInt .F., uMult (2,2), vMult (2,2),
    // uKnots (0.,1.), vKnots (0.,1.), knotSpec .UNSPECIFIED.
    s += "#10=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#1,#2),(#3,#4)),"
         ".UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);\n";
    // four corner vertices of the outer loop (physical square corners).
    std::snprintf(buf, sizeof(buf), "#21=CARTESIAN_POINT('',(0.,0.,0.));\n"); s += buf;
    std::snprintf(buf, sizeof(buf), "#22=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += buf;
    std::snprintf(buf, sizeof(buf), "#23=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L); s += buf;
    std::snprintf(buf, sizeof(buf), "#24=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += buf;
    s += "#31=VERTEX_POINT('',#21);\n#32=VERTEX_POINT('',#22);\n";
    s += "#33=VERTEX_POINT('',#23);\n#34=VERTEX_POINT('',#24);\n";
    // outer edges (LINE geometry; only endpoints matter to the reader).
    auto edge = [&](int idEC, int va, int vb, int idLP, double ax, double ay,
                    int idDir, int idVec, int idLine, double dx, double dy, double Llen) {
        char b2[256];
        std::snprintf(b2, sizeof(b2), "#%d=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", idLP, ax, ay); s += b2;
        std::snprintf(b2, sizeof(b2), "#%d=DIRECTION('',(%.17g,%.17g,0.));\n", idDir, dx, dy); s += b2;
        std::snprintf(b2, sizeof(b2), "#%d=VECTOR('',#%d,%.17g);\n", idVec, idDir, Llen); s += b2;
        std::snprintf(b2, sizeof(b2), "#%d=LINE('',#%d,#%d);\n", idLine, idLP, idVec); s += b2;
        std::snprintf(b2, sizeof(b2), "#%d=EDGE_CURVE('',#%d,#%d,#%d,.T.);\n", idEC, va, vb, idLine); s += b2;
    };
    edge(41, 31, 32, 51, 0., 0.,   61, 71, 81, 1., 0., L);
    edge(42, 32, 33, 52, L, 0.,    62, 72, 82, 0., 1., L);
    edge(43, 33, 34, 53, L, L,     63, 73, 83, -1.,0., L);
    edge(44, 34, 31, 54, 0., L,    64, 74, 84, 0.,-1., L);
    s += "#91=ORIENTED_EDGE('',*,*,#41,.T.);\n#92=ORIENTED_EDGE('',*,*,#42,.T.);\n";
    s += "#93=ORIENTED_EDGE('',*,*,#43,.T.);\n#94=ORIENTED_EDGE('',*,*,#44,.T.);\n";
    s += "#100=EDGE_LOOP('',(#91,#92,#93,#94));\n";
    s += "#101=FACE_OUTER_BOUND('',#100,.T.);\n";
    // an inner FACE_BOUND (hole). We give it a small square ring near the centre;
    // the reader maps a centred parametric hole — the exact hole geometry below is
    // only needed so the bound is structurally present and read as an inner loop.
    double cx = 0.5*L, cy = 0.5*L, h = 0.1*L;
    std::snprintf(buf, sizeof(buf), "#121=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", cx-h, cy-h); s += buf;
    std::snprintf(buf, sizeof(buf), "#122=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", cx+h, cy-h); s += buf;
    std::snprintf(buf, sizeof(buf), "#123=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", cx+h, cy+h); s += buf;
    std::snprintf(buf, sizeof(buf), "#124=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", cx-h, cy+h); s += buf;
    s += "#131=VERTEX_POINT('',#121);\n#132=VERTEX_POINT('',#122);\n";
    s += "#133=VERTEX_POINT('',#123);\n#134=VERTEX_POINT('',#124);\n";
    edge(141, 131, 132, 151, cx-h, cy-h, 161, 171, 181, 1.,0., 2*h);
    edge(142, 132, 133, 152, cx+h, cy-h, 162, 172, 182, 0.,1., 2*h);
    edge(143, 133, 134, 153, cx+h, cy+h, 163, 173, 183, -1.,0., 2*h);
    edge(144, 134, 131, 154, cx-h, cy+h, 164, 174, 184, 0.,-1., 2*h);
    s += "#191=ORIENTED_EDGE('',*,*,#141,.T.);\n#192=ORIENTED_EDGE('',*,*,#142,.T.);\n";
    s += "#193=ORIENTED_EDGE('',*,*,#143,.T.);\n#194=ORIENTED_EDGE('',*,*,#144,.T.);\n";
    s += "#200=EDGE_LOOP('',(#191,#192,#193,#194));\n";
    s += "#201=FACE_BOUND('',#200,.T.);\n";
    s += "#300=ADVANCED_FACE('',(#101,#201),#10,.T.);\n";
    // surface model so the face is reachable (a single open shell).
    s += "#310=OPEN_SHELL('',(#300));\n";
    s += "#320=SHELL_BASED_SURFACE_MODEL('',(#310));\n";
    s += unitMm();
    s += "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}

// A box where ONE face's surface is a SURFACE_OF_REVOLUTION (unsupported) so the
// reader must RECORD it (not drop it) and still build the supported 5 faces.
static std::string makeBoxWithUnsupportedFace() {
    // Start from the mm box and append an extra ADVANCED_FACE on a
    // SURFACE_OF_REVOLUTION referenced by an extra OPEN_SHELL so it is reachable
    // but does not break the closed box. Simpler: take a 1-face open shell whose
    // single face is unsupported, alongside the closed box shell. We just verify
    // the unsupported entity is reported.
    std::string s;
    s += "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('unsupported'),'2;1');\n";
    s += "FILE_NAME('u','2026-01-01T00:00:00',(''),(''),'test','test','');\n";
    s += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
    // a tiny planar quad face (supported) ...
    s += "#1=CARTESIAN_POINT('',(0.,0.,0.));\n#2=CARTESIAN_POINT('',(1.,0.,0.));\n";
    s += "#3=CARTESIAN_POINT('',(1.,1.,0.));\n#4=CARTESIAN_POINT('',(0.,1.,0.));\n";
    s += "#11=VERTEX_POINT('',#1);\n#12=VERTEX_POINT('',#2);\n#13=VERTEX_POINT('',#3);\n#14=VERTEX_POINT('',#4);\n";
    auto ec = [&](int id,int a,int b){ s += "#"+std::to_string(id)+"=EDGE_CURVE('',#"+std::to_string(a)+",#"+std::to_string(b)+",*,.T.);\n"; };
    ec(21,11,12); ec(22,12,13); ec(23,13,14); ec(24,14,11);
    s += "#31=ORIENTED_EDGE('',*,*,#21,.T.);\n#32=ORIENTED_EDGE('',*,*,#22,.T.);\n";
    s += "#33=ORIENTED_EDGE('',*,*,#23,.T.);\n#34=ORIENTED_EDGE('',*,*,#24,.T.);\n";
    s += "#40=EDGE_LOOP('',(#31,#32,#33,#34));\n#41=FACE_OUTER_BOUND('',#40,.T.);\n";
    s += "#42=CARTESIAN_POINT('',(0.,0.,0.));\n#43=DIRECTION('',(0.,0.,1.));\n#44=DIRECTION('',(1.,0.,0.));\n";
    s += "#45=AXIS2_PLACEMENT_3D('',#42,#43,#44);\n#46=PLANE('',#45);\n";
    s += "#47=ADVANCED_FACE('',(#41),#46,.T.);\n";
    // ... and an UNSUPPORTED face on a SURFACE_OF_REVOLUTION.
    s += "#51=CARTESIAN_POINT('',(0.,0.,0.));\n#52=DIRECTION('',(0.,0.,1.));\n#53=DIRECTION('',(1.,0.,0.));\n";
    s += "#54=AXIS1_PLACEMENT('',#51,#52);\n";
    s += "#55=CARTESIAN_POINT('',(1.,0.,0.));\n#56=VECTOR('',#53,1.);\n#57=LINE('',#55,#56);\n";
    s += "#58=SURFACE_OF_REVOLUTION('',#57,#54);\n";
    s += "#60=VERTEX_POINT('',#1);\n";
    s += "#61=EDGE_CURVE('',#11,#12,*,.T.);\n#62=ORIENTED_EDGE('',*,*,#61,.T.);\n";
    s += "#63=ORIENTED_EDGE('',*,*,#61,.F.);\n#64=ORIENTED_EDGE('',*,*,#61,.T.);\n";
    s += "#65=EDGE_LOOP('',(#62,#63,#64));\n#66=FACE_OUTER_BOUND('',#65,.T.);\n";
    s += "#67=ADVANCED_FACE('',(#66),#58,.T.);\n";
    s += "#70=OPEN_SHELL('',(#47,#67));\n#71=SHELL_BASED_SURFACE_MODEL('',(#70));\n";
    s += unitMm();
    s += "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}

int main() {
    std::printf("step_read_test — K6 FOREIGN STEP READ (native ingest, no OCCT)\n");

    // ---- (1) PLANAR BOX SOLID (mm) ---------------------------------------
    {
        const double Lx = 12.0, Ly = 7.0, Lz = 5.0;
        std::string step = makeBox(Lx, Ly, Lz, unitMm());
        ForeignReadResult r = readForeignStep(step);
        check(r.ok && r.solid, std::string("box(mm): read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok && r.solid) {
            check(r.faces == 6, "box(mm): 6 faces (got " + std::to_string(r.faces) + ")");
            check(r.closed, "box(mm): sewn shell is CLOSED (watertight 2-manifold)");
            check(r.unsupported.empty(), "box(mm): no unsupported faces");
            check(rel(r.lengthScaleToMm, 1.0, 1e-12), "box(mm): unit scale 1.0");
            MassProps mp = massProperties(*r.solid);
            double expVol = Lx * Ly * Lz;   // 420
            std::printf("        box(mm) volume = %.10g (expected %.10g)\n", mp.volume, expVol);
            check(rel(mp.volume, expVol, 1e-6), "box(mm): volume == Lx*Ly*Lz (<=1e-6)");
            // Euler signature for a genus-0 box: V-E+F = 2.
            check(r.eulerCharacteristic == 2,
                  "box(mm): Euler V-E+F == 2 (got " + std::to_string(r.eulerCharacteristic) + ")");
        }
    }

    // ---- (2) UNIT SCALING (inch) -----------------------------------------
    {
        const double Lx = 2.0, Ly = 3.0, Lz = 4.0;   // inches
        std::string step = makeBox(Lx, Ly, Lz, unitInch());
        ForeignReadResult r = readForeignStep(step);
        check(r.ok && r.solid, std::string("box(inch): read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok && r.solid) {
            check(rel(r.lengthScaleToMm, 25.4, 1e-9),
                  "box(inch): unit scale 25.4 (got " + std::to_string(r.lengthScaleToMm) + ")");
            check(r.closed, "box(inch): sewn shell is CLOSED");
            MassProps mp = massProperties(*r.solid);
            double expVol = (Lx * 25.4) * (Ly * 25.4) * (Lz * 25.4);  // mm^3
            std::printf("        box(inch) volume = %.10g mm^3 (expected %.10g)\n", mp.volume, expVol);
            check(rel(mp.volume, expVol, 1e-6), "box(inch): volume scaled by 25.4^3 (<=1e-6)");
        }
    }

    // ---- (2b) QUADRIC SOLID: a real cylinder (CYLINDRICAL_SURFACE + CIRCLE
    //          edges + disk caps), independent faces, sewn closed, volume pi*r^2*h.
    //          The STEP text is an analytic AP242 cylinder (the dialect a real
    //          analytic exporter emits) — proving the reader ingests genuine
    //          quadric geometry, not just planar boxes.
    {
        const double Rc = 2.0, Hc = 5.0;
        SolidFactory fac;
        auto wr = StepAnalytic::write(*fac.buildCylinder(Rc, Hc), "cyl");
        check(wr.ok, "cylinder: source STEP written");
        if (wr.ok) {
            ForeignReadResult r = readForeignStep(wr.text);
            check(r.ok && r.solid, std::string("cylinder: foreign read ok") +
                  (r.ok ? "" : " — " + r.reason));
            if (r.ok && r.solid) {
                check(r.closed, "cylinder: sewn shell is CLOSED");
                check(r.unsupported.empty(), "cylinder: no unsupported faces");
                MassProps mp = massProperties(*r.solid);
                double expVol = kPi * Rc * Rc * Hc;   // ~62.831853
                std::printf("        cylinder volume = %.10g (expected %.10g)\n", mp.volume, expVol);
                check(rel(mp.volume, expVol, 1e-6), "cylinder: volume == pi*r^2*h (<=1e-6)");
            }
        }
    }

    // ---- (3) B-SPLINE FACE + HOLE: area round-trip -----------------------
    {
        const double L = 4.0;
        std::string step = makeBSplineFaceWithHole(L);
        ForeignReadResult r = readForeignStep(step);
        check(r.ok, std::string("bspline+hole: read ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok) {
            check(r.trimmedFaces.size() == 1,
                  "bspline+hole: one TrimmedFace built (got " + std::to_string(r.trimmedFaces.size()) + ")");
            // find the B-spline face info.
            long ti = -1; std::size_t holes = 0;
            for (const auto& fi : r.faceInfos)
                if (fi.trimmedIndex >= 0) { ti = fi.trimmedIndex; holes = fi.innerLoopCount; }
            check(ti == 0, "bspline+hole: face reports a trimmed-NURBS surface");
            check(holes == 1, "bspline+hole: one hole loop read (got " + std::to_string(holes) + ")");
            if (ti >= 0) {
                const TrimmedFace& tf = r.trimmedFaces[ti];
                TrimmedMassProps a = trimmedFaceArea(tf, /*quadRefine=*/2);
                // The reader builds the FILE's LITERAL trim loops: the inner
                // FACE_BOUND is a SQUARE hole of side 2h = 0.2*L (corners at
                // (cx±h, cy±h), h=0.1*L), so the trimmed material area is the
                // EXACT square-hole area L^2 - (0.2*L)^2 — NOT a synthesized round
                // hole. Matches OCCT's literal trim of the same file (15.36 for L=4).
                double side = 0.2 * L;                 // 0.8 for L=4
                double expArea = L * L - side * side;  // 15.36
                std::printf("        bspline trimmed area = %.10g (expected %.10g, planarExact=%d)\n",
                            a.area, expArea, (int)a.planarExact);
                check(a.ok, "bspline+hole: trimmedFaceArea ok");
                check(rel(a.area, expArea, 1e-6),
                      "bspline+hole: area == L^2 - (0.2L)^2 (literal square hole, <=1e-6)");
            }
        }
    }

    // ---- (4) HONEST UNSUPPORTED REPORT -----------------------------------
    {
        std::string step = makeBoxWithUnsupportedFace();
        ForeignReadResult r = readForeignStep(step);
        check(r.ok, std::string("unsupported-report: read still ok") + (r.ok ? "" : " — " + r.reason));
        if (r.ok) {
            bool reportedSOR = r.unsupported.count("SURFACE_OF_REVOLUTION") > 0;
            check(reportedSOR,
                  "unsupported-report: SURFACE_OF_REVOLUTION recorded honestly (not dropped)");
            check(r.faces >= 1, "unsupported-report: the supported face was still built");
        }
    }

    // ---- (5) HONEST FAILURE ----------------------------------------------
    {
        auto g = readForeignStep("not a step file");
        check(!g.ok, "failure: garbage -> ok=false");
        auto d = readForeignStep(
            "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n"
            "#1=MANIFOLD_SOLID_BREP('',#999);\nENDSEC;\nEND-ISO-10303-21;\n");
        check(!d.ok, "failure: dangling shell ref -> ok=false");
    }

    std::printf("step_read_test RESULT: %d/%d passed\n", g_pass, g_total);
    return (g_pass == g_total) ? 0 : 1;
}
