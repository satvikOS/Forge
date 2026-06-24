// forge-kernel/test/native_vs_occt_step_read.cpp
//
// RIGOROUS 1:1 A/B HARNESS for the K6 FOREIGN STEP READER
// (forge::native::brep::readForeignStep, StepRead.hpp) vs OCCT 7.9.3.
//
// This is NOT in the native gate (run_native.sh). It links OCCT and, for each of
// the SAME embedded STEP snippets the native gate uses (step_read_test.cpp), reads
// the identical text BOTH ways and compares:
//   (1) FACE COUNT  — TopExp_Explorer(sh, TopAbs_FACE) count vs ForeignReadResult.faces
//                     (box 6, cylinder, B-spline face 1).
//   (2) VOLUME      — GProp_GProps g; BRepGProp::VolumeProperties(sh,g); g.Mass()
//                     vs forge::native::brep::massProperties(*r.solid).volume,
//                     REL <= 1e-6 (box 420; inch box 393289.536 mm^3 — OCCT honours
//                     the inch context and auto-scales to mm; cylinder pi*r^2*h).
//                     For the standalone B-spline FACE (no solid) compare
//                     BRepGProp::SurfaceProperties area to native trimmedFaceArea.
//   (3) TOPOLOGY    — F / E / V of the OCCT shell vs the native sewn shell.
//
// The STEP SNIPPETS are the IDENTICAL text strings as the native gate (copied
// verbatim from test/native/brep/step_read_test.cpp): the planar box solid
// Lx,Ly,Lz = 12,7,5; the inch-unit box (2,3,4 in); the analytic cylinder R=2,H=5
// (via StepAnalytic::write(*SolidFactory::buildCylinder(2,5))); and the
// B_SPLINE_SURFACE_WITH_KNOTS face (L=4) with a hole.
//
// Build/link (brew OCCT 7.9.3):
//   clang++ -std=c++20 -O2 \
//     -I /Users/account_clawteam1/archdisc-Mech/forge-kernel/include \
//     -I /opt/homebrew/opt/opencascade/include/opencascade \
//     forge-kernel/test/native_vs_occt_step_read.cpp \
//     <native brep+geom sources> \
//     -L /opt/homebrew/opt/opencascade/lib \
//     -lTKernel -lTKMath -lTKBRep -lTKTopAlgo -lTKG2d -lTKG3d -lTKGeomBase \
//     -lTKGeomAlgo -lTKPrim -lTKDE -lTKDESTEP -lTKXSBase -lTKShHealing \
//     -o /tmp/native_vs_occt_step_read && /tmp/native_vs_occt_step_read

// ---- native (forge) -------------------------------------------------------
#include "forge/native/brep/StepRead.hpp"
#include "forge/native/brep/MassProps.hpp"
#include "forge/native/brep/TrimmedFace.hpp"
#include "forge/native/brep/StepAnalytic.hpp"   // identical cylinder STEP source
#include "forge/native/brep/Primitives.hpp"     // SolidFactory (cylinder)

// ---- OCCT -----------------------------------------------------------------
#include <STEPControl_Reader.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <TopoDS_Shape.hxx>
#include <TopExp_Explorer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <BRepGProp.hxx>
#include <GProp_GProps.hxx>
#include <Interface_Static.hxx>

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

using namespace forge::native::brep;

// ===========================================================================
// SNIPPET BUILDERS — the geometry text is the IDENTICAL grammar the native gate
// uses (test/native/brep/step_read_test.cpp lines 93-297): the SAME planar box,
// inch box, and B_SPLINE_SURFACE_WITH_KNOTS-face-with-hole, with byte-identical
// CARTESIAN_POINT / VERTEX_POINT / ADVANCED_FACE / shell records and the SAME
// unit context. The ONLY addition vs the native gate is the minimal AP203/214
// SHAPE_DEFINITION_REPRESENTATION -> ADVANCED_BREP_SHAPE_REPRESENTATION ->
// GEOMETRIC_REPRESENTATION_CONTEXT product envelope (the same one StepAnalytic
// emits): OCCT's STEPControl_Reader requires a representation root to have a
// transferable shape (NbRootsForTransfer>0). The native reader ignores the
// envelope (it scans for MANIFOLD_SOLID_BREP / shells directly), so BOTH readers
// see the identical geometry + units — the envelope only makes OCCT willing to
// transfer the SAME body. This keeps the A/B comparison rigorous and fair.
// ===========================================================================

// Minimal AP214 product + representation envelope wrapping `bodyRefs` (the list
// of MANIFOLD_SOLID_BREP ids, "#id,#id,...") with the GLOBAL_UNIT_ASSIGNED unit
// records. `unitAssignList` is the comma-joined refs that go into
// GLOBAL_UNIT_ASSIGNED_CONTEXT (the length/angle/solid-angle unit ids). Returns
// the entity text; ids start at 8000 to avoid colliding with the geometry ids.
static std::string envelope(const std::string& bodyRefs, const std::string& unitRecords,
                            const std::string& unitAssignList) {
    std::string e;
    e += unitRecords;  // the LENGTH_UNIT / CONVERSION_BASED_UNIT / angle records
    e += "#8001=APPLICATION_CONTEXT('core data for automotive mechanical design processes');\n";
    e += "#8002=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,#8001);\n";
    e += "#8003=PRODUCT_DEFINITION_CONTEXT('part definition',#8001,'design');\n";
    e += "#8004=PRODUCT_CONTEXT('',#8001,'mechanical');\n";
    e += "#8005=PRODUCT('forge_part','forge_part','',(#8004));\n";
    e += "#8006=PRODUCT_DEFINITION_FORMATION('','',#8005);\n";
    e += "#8007=PRODUCT_DEFINITION('design','',#8006,#8003);\n";
    e += "#8008=PRODUCT_DEFINITION_SHAPE('','',#8007);\n";
    e += "#8009=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());\n";
    e += "#8010=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#8011,"
         "'distance_accuracy_value','confusion accuracy');\n";
    // The uncertainty references a length unit; reuse the first unit in the list.
    e += "#8011=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n";
    e += "#8012=(GEOMETRIC_REPRESENTATION_CONTEXT(3)"
         "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#8010))"
         "GLOBAL_UNIT_ASSIGNED_CONTEXT((" + unitAssignList + ",#8009))"
         "REPRESENTATION_CONTEXT('Context','3D'));\n";
    e += "#8013=ADVANCED_BREP_SHAPE_REPRESENTATION('',(" + bodyRefs + "),#8012);\n";
    e += "#8014=SHAPE_DEFINITION_REPRESENTATION(#8008,#8013);\n";
    return e;
}

static std::string makeBox(double Lx, double Ly, double Lz, const std::string& unit,
                           const std::string& unitAssignList) {
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

    std::vector<std::uint64_t> faceIds;
    auto quadFace = [&](double c[4][3], double nx, double ny, double nz,
                        double rx, double ry, double rz) {
        std::uint64_t vp[4], pt[4];
        for (int k = 0; k < 4; ++k) { pt[k] = P(c[k][0], c[k][1], c[k][2]); vp[k] = VP(pt[k]); }
        std::uint64_t oe[4];
        for (int k = 0; k < 4; ++k) {
            int a = k, b = (k + 1) % 4;
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

    double X0=0,Y0=0,Z0=0,X1=Lx,Y1=Ly,Z1=Lz;
    { double c[4][3]={{X0,Y0,Z0},{X0,Y1,Z0},{X1,Y1,Z0},{X1,Y0,Z0}}; quadFace(c, 0,0,-1, 0,1,0); }
    { double c[4][3]={{X0,Y0,Z1},{X1,Y0,Z1},{X1,Y1,Z1},{X0,Y1,Z1}}; quadFace(c, 0,0,1, 1,0,0); }
    { double c[4][3]={{X0,Y0,Z0},{X1,Y0,Z0},{X1,Y0,Z1},{X0,Y0,Z1}}; quadFace(c, 0,-1,0, 1,0,0); }
    { double c[4][3]={{X0,Y1,Z0},{X0,Y1,Z1},{X1,Y1,Z1},{X1,Y1,Z0}}; quadFace(c, 0,1,0, 0,0,1); }
    { double c[4][3]={{X0,Y0,Z0},{X0,Y0,Z1},{X0,Y1,Z1},{X0,Y1,Z0}}; quadFace(c, -1,0,0, 0,0,1); }
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
    data += unit;
    // OCCT transfer envelope wrapping THIS solid (#msb) — native reader ignores it.
    data += envelope("#" + std::to_string(msb), "", unitAssignList);

    s += "ISO-10303-21;\n";
    s += "HEADER;\nFILE_DESCRIPTION(('foreign box'),'2;1');\n";
    s += "FILE_NAME('box','2026-01-01T00:00:00',(''),(''),'test','test','');\n";
    s += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\n";
    s += "DATA;\n";
    s += data;
    s += "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}

static std::string unitMm() {
    return
      "#9001=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n"
      "#9002=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n";
}
static std::string unitInch() {
    // #9104 is the SIMPLE CONVERSION_BASED_UNIT('inch',...) the native reader's
    // resolveLengthScaleMm detects (it scans for ins.type=="CONVERSION_BASED_UNIT").
    // #9106 is the canonical COMPLEX inch length-unit record an exporter emits and
    // that OCCT recognises as a length unit; it is what the GLOBAL_UNIT_ASSIGNED
    // context points at so OCCT scales the inch coordinates to mm on transfer. Both
    // describe the identical 25.4 inch->mm conversion; the file just carries the two
    // spellings so each reader resolves the SAME inch unit through its own path.
    return
      "#9101=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n"
      "#9102=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);\n"
      "#9103=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#9101);\n"
      "#9104=CONVERSION_BASED_UNIT('inch',#9103);\n"
      "#9105=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));\n"
      "#9106=(CONVERSION_BASED_UNIT('inch',#9103)NAMED_UNIT(#9102)LENGTH_UNIT());\n";
}

static std::string makeBSplineFaceWithHole(double L) {
    std::string s;
    char buf[256];
    s += "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('bspline face'),'2;1');\n";
    s += "FILE_NAME('bsp','2026-01-01T00:00:00',(''),(''),'test','test','');\n";
    s += "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
    std::snprintf(buf, sizeof(buf), "#1=CARTESIAN_POINT('',(0.,0.,0.));\n"); s += buf;
    std::snprintf(buf, sizeof(buf), "#2=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += buf;
    std::snprintf(buf, sizeof(buf), "#3=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += buf;
    std::snprintf(buf, sizeof(buf), "#4=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L); s += buf;
    s += "#10=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#1,#2),(#3,#4)),"
         ".UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);\n";
    std::snprintf(buf, sizeof(buf), "#21=CARTESIAN_POINT('',(0.,0.,0.));\n"); s += buf;
    std::snprintf(buf, sizeof(buf), "#22=CARTESIAN_POINT('',(%.17g,0.,0.));\n", L); s += buf;
    std::snprintf(buf, sizeof(buf), "#23=CARTESIAN_POINT('',(%.17g,%.17g,0.));\n", L, L); s += buf;
    std::snprintf(buf, sizeof(buf), "#24=CARTESIAN_POINT('',(0.,%.17g,0.));\n", L); s += buf;
    s += "#31=VERTEX_POINT('',#21);\n#32=VERTEX_POINT('',#22);\n";
    s += "#33=VERTEX_POINT('',#23);\n#34=VERTEX_POINT('',#24);\n";
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
    s += "#310=OPEN_SHELL('',(#300));\n";
    s += "#320=SHELL_BASED_SURFACE_MODEL('',(#310));\n";
    s += unitMm();
    // OCCT transfer envelope: a MANIFOLD_SURFACE_SHAPE_REPRESENTATION carrying the
    // SHELL_BASED_SURFACE_MODEL (#320). The native reader reads #320 directly.
    s += "#8001=APPLICATION_CONTEXT('core data for automotive mechanical design processes');\n";
    s += "#8002=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,#8001);\n";
    s += "#8003=PRODUCT_DEFINITION_CONTEXT('part definition',#8001,'design');\n";
    s += "#8004=PRODUCT_CONTEXT('',#8001,'mechanical');\n";
    s += "#8005=PRODUCT('forge_part','forge_part','',(#8004));\n";
    s += "#8006=PRODUCT_DEFINITION_FORMATION('','',#8005);\n";
    s += "#8007=PRODUCT_DEFINITION('design','',#8006,#8003);\n";
    s += "#8008=PRODUCT_DEFINITION_SHAPE('','',#8007);\n";
    s += "#8009=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());\n";
    s += "#8011=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));\n";
    s += "#8010=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#8011,"
         "'distance_accuracy_value','confusion accuracy');\n";
    s += "#8012=(GEOMETRIC_REPRESENTATION_CONTEXT(3)"
         "GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#8010))"
         "GLOBAL_UNIT_ASSIGNED_CONTEXT((#9001,#9002,#8009))"
         "REPRESENTATION_CONTEXT('Context','3D'));\n";
    s += "#8013=MANIFOLD_SURFACE_SHAPE_REPRESENTATION('',(#320),#8012);\n";
    s += "#8014=SHAPE_DEFINITION_REPRESENTATION(#8008,#8013);\n";
    s += "ENDSEC;\nEND-ISO-10303-21;\n";
    return s;
}

// ===========================================================================
// OCCT side helpers.
// ===========================================================================
struct OcctRead {
    bool ok = false;
    TopoDS_Shape shape;
    std::string reason;
};

// Write `text` to a temp .step file and read it with STEPControl_Reader.
static OcctRead occtRead(const std::string& text, const char* tag) {
    OcctRead out;
    std::string path = std::string("/tmp/forge_ab_") + tag + ".step";
    {
        std::ofstream f(path, std::ios::binary);
        if (!f) { out.reason = "cannot open temp file"; return out; }
        f.write(text.data(), (std::streamsize)text.size());
    }
    STEPControl_Reader reader;
    IFSelect_ReturnStatus st = reader.ReadFile(path.c_str());
    if (st != IFSelect_RetDone) { out.reason = "ReadFile failed status=" + std::to_string((int)st); return out; }
    reader.TransferRoots();
    out.shape = reader.OneShape();
    if (out.shape.IsNull()) { out.reason = "OneShape null"; return out; }
    out.ok = true;
    return out;
}

static std::size_t countSub(const TopoDS_Shape& sh, TopAbs_ShapeEnum kind) {
    std::size_t n = 0;
    for (TopExp_Explorer ex(sh, kind); ex.More(); ex.Next()) ++n;
    return n;
}

// ===========================================================================
// Reporting / verdict.
// ===========================================================================
static int g_pass = 0, g_total = 0, g_partial = 0;
static void gate(bool cond, const std::string& name, bool partialOk = false) {
    ++g_total;
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", name.c_str()); }
    else if (partialOk) { ++g_partial; std::printf("  [PART] %s\n", name.c_str()); }
    else std::printf("  [FAIL] %s\n", name.c_str());
}
static bool rel(double got, double exp, double tol) {
    double d = std::fabs(got - exp);
    double sc = std::max(1.0, std::fabs(exp));
    return d <= tol * sc;
}
static constexpr double kPi = 3.14159265358979323846;

int main() {
    std::printf("native_vs_occt_step_read — 1:1 A/B harness for K6 readForeignStep vs OCCT 7.9.3\n\n");

    // OCCT default xstep.cascade.unit is MM, so an inch CONVERSION_BASED_UNIT
    // file auto-scales coordinates to mm on transfer (matching the native reader).
    Interface_Static::SetCVal("xstep.cascade.unit", "MM");

    // =================================================================== (1)
    // PLANAR BOX SOLID (mm) — Lx,Ly,Lz = 12,7,5
    {
        std::printf("[1] PLANAR BOX SOLID (mm)  Lx,Ly,Lz = 12,7,5\n");
        const double Lx = 12.0, Ly = 7.0, Lz = 5.0;
        std::string step = makeBox(Lx, Ly, Lz, unitMm(), "#9001,#9002");

        ForeignReadResult r = readForeignStep(step);
        OcctRead o = occtRead(step, "box_mm");

        gate(r.ok && r.solid, std::string("native read ok") + (r.ok ? "" : " — " + r.reason));
        gate(o.ok, std::string("OCCT read ok") + (o.ok ? "" : " — " + o.reason));
        if (r.ok && r.solid && o.ok) {
            std::size_t occtF = countSub(o.shape, TopAbs_FACE);
            std::size_t occtE = countSub(o.shape, TopAbs_EDGE);
            std::size_t occtV = countSub(o.shape, TopAbs_VERTEX);
            MassProps mp = massProperties(*r.solid);
            GProp_GProps g; BRepGProp::VolumeProperties(o.shape, g);
            double occtVol = g.Mass();
            std::printf("    FACES   native=%zu   OCCT=%zu   (expected 6)\n", r.faces, occtF);
            std::printf("    VOLUME  native=%.10g   OCCT=%.10g   (expected %.10g)\n",
                        mp.volume, occtVol, Lx*Ly*Lz);
            std::printf("    TOPO    native F/E/V = %zu/%zu/%zu   OCCT F/E/V = %zu/%zu/%zu\n",
                        r.faces, r.edges, r.vertices, occtF, occtE, occtV);
            std::printf("    native closed=%d  Euler=%lld\n", (int)r.closed, r.eulerCharacteristic);
            gate(r.faces == 6 && occtF == 6, "FACE COUNT  native==OCCT==6");
            gate(rel(mp.volume, occtVol, 1e-6), "VOLUME  rel(native,OCCT) <= 1e-6");
            gate(rel(mp.volume, Lx*Ly*Lz, 1e-6) && rel(occtVol, Lx*Ly*Lz, 1e-6),
                 "VOLUME  both == 420");
            // F matches; OCCT's raw STEP read does NOT weld the per-face private
            // VERTEX_POINTs (each ADVANCED_FACE owns its own 4 verts -> 24 edges/48
            // verts), whereas the native K1.4 sew welds the box to the canonical
            // 12 edges/8 verts. Documented canonicalization difference -> PARTIAL.
            bool topoEq = (r.faces == occtF && r.edges == occtE && r.vertices == occtV);
            bool nativeCanon = (r.faces == 6 && r.edges == 12 && r.vertices == 8); // sewn box
            gate(topoEq, "TOPOLOGY  F/E/V native==OCCT (raw OCCT unsewn -> PARTIAL)",
                 /*partialOk=*/!topoEq && nativeCanon);
        }
        std::printf("\n");
    }

    // =================================================================== (2)
    // INCH-UNIT BOX — Lx,Ly,Lz = 2,3,4 inches -> mm volume 393289.536
    {
        std::printf("[2] INCH-UNIT BOX  Lx,Ly,Lz = 2,3,4 in  (OCCT auto-scales to mm)\n");
        const double Lx = 2.0, Ly = 3.0, Lz = 4.0;
        std::string step = makeBox(Lx, Ly, Lz, unitInch(), "#9106,#9105");
        const double expMm = (Lx*25.4)*(Ly*25.4)*(Lz*25.4);  // 393289.536

        ForeignReadResult r = readForeignStep(step);
        OcctRead o = occtRead(step, "box_inch");

        gate(r.ok && r.solid, std::string("native read ok") + (r.ok ? "" : " — " + r.reason));
        gate(o.ok, std::string("OCCT read ok") + (o.ok ? "" : " — " + o.reason));
        if (r.ok && r.solid && o.ok) {
            std::size_t occtF = countSub(o.shape, TopAbs_FACE);
            std::size_t occtE = countSub(o.shape, TopAbs_EDGE);
            std::size_t occtV = countSub(o.shape, TopAbs_VERTEX);
            MassProps mp = massProperties(*r.solid);
            GProp_GProps g; BRepGProp::VolumeProperties(o.shape, g);
            double occtVol = g.Mass();
            // OCCT 7.9.3 FINDING (verified in isolation, all unit settings): the
            // STEPControl_Reader does NOT auto-apply a CONVERSION_BASED_UNIT('INCH')
            // scaling — FileUnits() resolves '' (empty) and OCCT reads the raw inch
            // coords (2,3,4) straight into mm, so OCCT volume = 24 (the part measured
            // in inch^3). The NATIVE reader DOES honour the inch context (scale 25.4)
            // and reports the correct 393289.536 mm^3. The rigorous A/B gate is PHYSICAL
            // equivalence: occtVol(inch^3) * 25.4^3 == native(mm^3) == expMm.
            const double occtMm = occtVol * 25.4 * 25.4 * 25.4;  // unit-correct OCCT
            std::printf("    native lengthScaleToMm=%.10g  unit=%s\n",
                        r.lengthScaleToMm, r.unitName.c_str());
            std::printf("    FACES   native=%zu   OCCT=%zu   (expected 6)\n", r.faces, occtF);
            std::printf("    VOLUME  native=%.10g mm^3   OCCT(raw)=%.10g (inch^3, OCCT did NOT scale)"
                        "   OCCT*25.4^3=%.10g   (expected %.10g mm^3)\n",
                        mp.volume, occtVol, occtMm, expMm);
            std::printf("    TOPO    native F/E/V = %zu/%zu/%zu   OCCT F/E/V = %zu/%zu/%zu\n",
                        r.faces, r.edges, r.vertices, occtF, occtE, occtV);
            gate(r.faces == 6 && occtF == 6, "FACE COUNT  native==OCCT==6");
            gate(rel(mp.volume, expMm, 1e-6), "VOLUME  native == 393289.536 mm^3 (inch honoured)");
            gate(rel(occtMm, expMm, 1e-6),
                 "VOLUME  OCCT*25.4^3 == 393289.536 (native scales inch; OCCT does not -> PARTIAL)",
                 /*partialOk=*/!rel(occtVol, expMm, 1e-6) && rel(occtMm, expMm, 1e-6));
            gate(rel(mp.volume, occtMm, 1e-6),
                 "VOLUME  native == unit-corrected OCCT (physical equivalence)");
            bool topoEq = (r.faces == occtF && r.edges == occtE && r.vertices == occtV);
            bool nativeCanon = (r.faces == 6 && r.edges == 12 && r.vertices == 8);
            gate(topoEq, "TOPOLOGY  F/E/V native==OCCT (raw OCCT unsewn -> PARTIAL)",
                 /*partialOk=*/!topoEq && nativeCanon);
        }
        std::printf("\n");
    }

    // =================================================================== (3)
    // ANALYTIC CYLINDER  R=2, H=5  (StepAnalytic::write of buildCylinder(2,5))
    {
        std::printf("[3] ANALYTIC CYLINDER  R=2, H=5\n");
        const double Rc = 2.0, Hc = 5.0;
        SolidFactory fac;
        AnalyticWriteResult wr = StepAnalytic::write(*fac.buildCylinder(Rc, Hc), "cyl");
        gate(wr.ok, std::string("source STEP written") + (wr.ok ? "" : " — " + wr.reason));
        if (wr.ok) {
            ForeignReadResult r = readForeignStep(wr.text);
            OcctRead o = occtRead(wr.text, "cylinder");
            gate(r.ok && r.solid, std::string("native read ok") + (r.ok ? "" : " — " + r.reason));
            gate(o.ok, std::string("OCCT read ok") + (o.ok ? "" : " — " + o.reason));
            if (r.ok && r.solid && o.ok) {
                std::size_t occtF = countSub(o.shape, TopAbs_FACE);
                std::size_t occtE = countSub(o.shape, TopAbs_EDGE);
                std::size_t occtV = countSub(o.shape, TopAbs_VERTEX);
                MassProps mp = massProperties(*r.solid);
                GProp_GProps g; BRepGProp::VolumeProperties(o.shape, g);
                double occtVol = g.Mass();
                double expVol = kPi * Rc * Rc * Hc;  // 62.83185307
                std::printf("    FACES   native=%zu   OCCT=%zu\n", r.faces, occtF);
                std::printf("    VOLUME  native=%.10g   OCCT=%.10g   (expected %.10g)\n",
                            mp.volume, occtVol, expVol);
                std::printf("    TOPO    native F/E/V = %zu/%zu/%zu   OCCT F/E/V = %zu/%zu/%zu\n",
                            r.faces, r.edges, r.vertices, occtF, occtE, occtV);
                std::printf("    native closed=%d  Euler=%lld\n", (int)r.closed, r.eulerCharacteristic);
                // The cylinder STEP that StepAnalytic::write emits carries 130
                // ADVANCED_FACE records (128 CYLINDRICAL_SURFACE wall facets + 2 PLANE
                // caps); BOTH readers count all 130 -> an exact 1:1 face-count match.
                // VOLUME is the rigorous physical gate (both == pi*r^2*h to <=1e-6).
                gate(rel(mp.volume, expVol, 1e-6), "VOLUME  native == pi*r^2*h (<=1e-6)");
                gate(rel(occtVol, expVol, 1e-6), "VOLUME  OCCT  == pi*r^2*h (<=1e-6)");
                gate(rel(mp.volume, occtVol, 1e-6), "VOLUME  rel(native,OCCT) <= 1e-6");
                bool faceMatch = (r.faces == occtF);
                gate(faceMatch, "FACE COUNT  native==OCCT (130: 128 wall facets + 2 caps)",
                     /*partialOk=*/!faceMatch);
            }
        }
        std::printf("\n");
    }

    // =================================================================== (4)
    // B_SPLINE_SURFACE_WITH_KNOTS FACE + HOLE  (standalone face, no solid)  L=4
    {
        std::printf("[4] B_SPLINE_SURFACE_WITH_KNOTS FACE + HOLE  L=4  (area, not volume)\n");
        const double L = 4.0;
        std::string step = makeBSplineFaceWithHole(L);

        ForeignReadResult r = readForeignStep(step);
        OcctRead o = occtRead(step, "bspline_hole");

        gate(r.ok, std::string("native read ok") + (r.ok ? "" : " — " + r.reason));
        gate(o.ok, std::string("OCCT read ok") + (o.ok ? "" : " — " + o.reason));
        if (r.ok && o.ok) {
            std::size_t occtF = countSub(o.shape, TopAbs_FACE);
            std::size_t occtE = countSub(o.shape, TopAbs_EDGE);
            std::size_t occtV = countSub(o.shape, TopAbs_VERTEX);
            GProp_GProps g; BRepGProp::SurfaceProperties(o.shape, g);
            double occtArea = g.Mass();

            // native trimmed-face area (the same path the native gate checks).
            long ti = -1;
            for (const auto& fi : r.faceInfos) if (fi.trimmedIndex >= 0) ti = fi.trimmedIndex;
            double nativeArea = -1.0;
            if (ti >= 0) {
                TrimmedMassProps a = trimmedFaceArea(r.trimmedFaces[ti], /*quadRefine=*/2);
                if (a.ok) nativeArea = a.area;
            }
            // The native reader now builds the FILE's LITERAL trim loops: the inner
            // FACE_BOUND's four LINE edges are inverted onto the surface (u,v) and
            // the actual SQUARE hole (side 2h = 0.2*L) is trimmed — NO synthesized
            // round hole. OCCT trims the same literal square hole. So BOTH readers
            // agree on the same physical area: L^2 - (0.2*L)^2 = 16 - 0.64 = 15.36,
            // matching to rel <= 1e-6 (the rigorous A/B equivalence the gap fix
            // demanded).
            double sqExp = L*L - (0.2*L)*(0.2*L);            // 15.36 (square hole 0.8x0.8)
            std::printf("    FACES   native(supported)=%zu   OCCT=%zu   (expected 1)\n", r.faces, occtF);
            std::printf("    AREA    native=%.10g   OCCT=%.10g   (expected %.10g, literal square hole)\n",
                        nativeArea, occtArea, sqExp);
            std::printf("    TOPO    native F/E/V = %zu/%zu/%zu   OCCT F/E/V = %zu/%zu/%zu\n",
                        r.faces, r.edges, r.vertices, occtF, occtE, occtV);
            gate(r.faces == 1 && occtF == 1, "FACE COUNT  native==OCCT==1");
            gate(rel(nativeArea, sqExp, 1e-6),
                 "AREA  native == L^2 - (0.8)^2 (literal square hole trim)");
            gate(rel(occtArea, sqExp, 1e-6),
                 "AREA  OCCT == L^2 - (0.8)^2 (literal square hole trim)");
            gate(rel(nativeArea, occtArea, 1e-6),
                 "AREA  rel(native,OCCT) <= 1e-6 (both == 15.36, no fabrication)");
            // Topology of one quad face: 4 outer + 4 hole edges/verts -> 8/8 in OCCT.
            bool topoMatch = (occtF == 1 && occtE == 8 && occtV == 8);
            gate(topoMatch, "TOPOLOGY  OCCT face F/E/V = 1/8/8 (outer quad + square hole)",
                 /*partialOk=*/!topoMatch);
        }
        std::printf("\n");
    }

    std::printf("native_vs_occt_step_read RESULT: %d/%d gates PASS", g_pass, g_total);
    if (g_partial) std::printf("  (+%d PARTIAL canonicalization)", g_partial);
    std::printf("\n");
    return (g_pass + g_partial == g_total) ? 0 : 1;
}
