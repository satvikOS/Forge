// forge-kernel/test/native_vs_occt_import_surfaces.cpp
//
// A/B GATE — importOcctSolid ANALYTIC-SURFACE ATTACHMENT (K6 native-Solid-everywhere).
//
// Proves that the OCCT -> native importer (src/OcctImport.cpp) attaches a native
// analytic brep::Surface (Plane / Cylinder / Cone / Sphere / Torus) to EVERY imported
// quadric face — NOT a surface-less faceted bag — so the imported solid reports the
// SAME CANONICAL analytic faces (native analyticFaceInventory) as OCCT's own face query,
// with the curved face's radius / axis / origin matching OCCT's Geom_Surface parameters
// to ~1e-9. This is the property the native HLR silhouette pass and every G1 analytic
// query on an OCCT-bridged input depend on (the K4/TKHLR curved-drop keystone): a
// re-imported cylinder MUST be a cylinder with radius R and axis A, not 256 facets.
//
// It is a SIBLING of native_occt_import_test.cpp (which A/B's volume/area/bbox/Betti/
// validity) — this one A/B's the ANALYTIC FACE IDENTITY that neither that gate nor the
// native-STEP-path native_analytic_face_inventory.mjs covers for the raw-TopoDS
// importOcctSolid path.
//
// LINKS OCCT (the bridge oracle) => NOT a run_native.sh pure-native gate. Build+run:
//   bash test/build_import_surfaces_gate.sh
//
// Assertions per fixture:
//   (1) native analyticFaceInventory count + kind histogram == the expected canonical
//       faces (cylinder=3{cyl,2 planes}, cone-frustum=3, cone-apex=2, sphere=1, torus=1,
//       box=6, box-through-cyl=7{cyl,6 planes}).
//   (2) the CURVED face's parameters A/B vs OCCT's Geom_Surface (BRepAdaptor_Surface):
//       cylinder radius / axis / origin-on-axis; cone axis + radii at the face's v-window;
//       sphere radius / centre; torus major / minor / centre / axis — all to ~1e-9.

#include "forge/OcctImport.hpp"
#include "forge/native/brep/Query.hpp"
#include "forge/native/brep/Topology.hpp"
#include "forge/native/brep/Surface.hpp"   // Vec3 helpers

// --- OCCT (the oracle) -----------------------------------------------------
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepTools.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopExp_Explorer.hxx>
#include <gp_Ax2.hxx>
#include <gp_Pnt.hxx>
#include <gp_Dir.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Cone.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>

#include <cmath>
#include <cstdio>
#include <map>
#include <string>
#include <vector>

using namespace forge;
namespace nb = native::brep;
using nb::Vec3;

namespace {

int g_pass = 0, g_fail = 0;
void check(bool cond, const std::string& label) {
    if (cond) { ++g_pass; std::printf("  [PASS] %s\n", label.c_str()); }
    else      { ++g_fail; std::printf("  [FAIL] %s\n", label.c_str()); }
}

constexpr double TOL = 1e-9;   // A/B band for the analytic parameters (native = OCCT gp)

Vec3 toV(const gp_Pnt& p) { return Vec3{p.X(), p.Y(), p.Z()}; }
Vec3 toV(const gp_Dir& d) { return Vec3{d.X(), d.Y(), d.Z()}; }

// distance from point P to the infinite line (L0, unit dir U).
double ptLineDist(const Vec3& P, const Vec3& L0, const Vec3& U) {
    Vec3 d = nb::vsub(P, L0);
    Vec3 perp = nb::vsub(d, nb::vscale(U, nb::vdot(d, U)));
    return nb::vlen(perp);
}
// two directions parallel (either sense) to `tol`.
bool parallel(const Vec3& a, const Vec3& b, double tol) {
    Vec3 ua = nb::vnorm(a), ub = nb::vnorm(b);
    return std::fabs(std::fabs(nb::vdot(ua, ub)) - 1.0) <= tol;
}

std::map<std::string,int> hist(const std::vector<nb::AnalyticFaceInfo>& inv) {
    std::map<std::string,int> h;
    for (const auto& f : inv) h[f.kind]++;
    return h;
}
std::string histStr(const std::map<std::string,int>& h) {
    std::string s = "{";
    for (const auto& kv : h) { s += " " + kv.first + ":" + std::to_string(kv.second); }
    return s + " }";
}
bool histEq(const std::map<std::string,int>& a, const std::map<std::string,int>& b) {
    return a == b;
}

// The native curved (non-plane) face of an imported quadric primitive.
const nb::AnalyticFaceInfo* curvedFace(const std::vector<nb::AnalyticFaceInfo>& inv,
                                       const std::string& kind) {
    for (const auto& f : inv) if (f.kind == kind) return &f;
    return nullptr;
}

// Find the FIRST OCCT face of `type` in `shape` (the oracle geometry).
bool firstFaceOfType(const TopoDS_Shape& shape, GeomAbs_SurfaceType type, TopoDS_Face& out) {
    for (TopExp_Explorer fe(shape, TopAbs_FACE); fe.More(); fe.Next()) {
        TopoDS_Face f = TopoDS::Face(fe.Current());
        BRepAdaptor_Surface ad(f, Standard_False);
        if (ad.GetType() == type) { out = f; return true; }
    }
    return false;
}

// Import + assert the native analytic inventory count/histogram vs an expected set.
// Returns the inventory so per-fixture curved-face A/B can follow.
std::vector<nb::AnalyticFaceInfo> importInv(const char* name, const TopoDS_Shape& shape,
                                            std::size_t expN,
                                            const std::map<std::string,int>& expHist,
                                            bool& okOut) {
    std::printf("[%s]\n", name);
    okOut = false;
    ImportResult ir = importOcctSolid(shape);
    if (!ir.ok) { ++g_fail; std::printf("  [FAIL] import ok (reason: %s)\n", ir.reason.c_str());
        return {}; }
    check(true, "import ok");
    std::vector<nb::AnalyticFaceInfo> inv = nb::analyticFaceInventory(*ir.solid);
    auto h = hist(inv);
    check(inv.size() == expN && histEq(h, expHist),
          "analytic faces == canonical  got " + std::to_string(inv.size()) + " " + histStr(h) +
          "  want " + std::to_string(expN) + " " + histStr(expHist));
    okOut = (inv.size() == expN && histEq(h, expHist));
    return inv;
}

} // namespace

int main() {
    std::printf("=== importOcctSolid analytic-surface attachment A/B gate ===\n");

    // (1) BOX 10x6x4 -> 6 planes (the no-curved control: every face carries a Plane).
    {
        TopoDS_Shape s = BRepPrimAPI_MakeBox(10.0, 6.0, 4.0).Shape();
        bool ok; auto inv = importInv("box 10x6x4", s, 6, {{"plane",6}}, ok);
        // every plane axis must be a finite unit normal.
        bool unit = !inv.empty();
        for (const auto& f : inv) unit = unit && std::fabs(nb::vlen(f.axis) - 1.0) <= TOL;
        check(unit, "every box plane carries a unit normal");
    }

    // (2) CYLINDER r5 h10 -> cyl 3 {cylinder, 2 planes}; A/B radius/axis/origin vs gp_Cylinder.
    {
        TopoDS_Shape s = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        bool ok; auto inv = importInv("cylinder r5 h10", s, 3, {{"cylinder",1},{"plane",2}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "cylinder");
        TopoDS_Face of;
        if (c && firstFaceOfType(s, GeomAbs_Cylinder, of)) {
            gp_Cylinder cy = BRepAdaptor_Surface(of).Cylinder();
            Vec3 oaxis = toV(cy.Axis().Direction()), oloc = toV(cy.Position().Location());
            check(std::fabs(c->radius - cy.Radius()) <= TOL,
                  "cylinder radius native=" + std::to_string(c->radius) +
                  " occt=" + std::to_string(cy.Radius()));
            check(parallel(c->axis, oaxis, TOL), "cylinder axis native||occt");
            check(ptLineDist(c->origin, oloc, nb::vnorm(oaxis)) <= TOL,
                  "cylinder origin lies on OCCT axis");
        } else check(false, "cylinder curved face + OCCT oracle found");
    }

    // (3) PLACED CYLINDER r2.5 h9 on a rotated/translated axis — the frame-match A/B.
    {
        gp_Ax2 ax(gp_Pnt(2, 3, 1), gp_Dir(0, 1, 0), gp_Dir(1, 0, 0));
        TopoDS_Shape s = BRepPrimAPI_MakeCylinder(ax, 2.5, 9.0).Shape();
        bool ok; auto inv = importInv("placed cylinder r2.5 h9", s, 3, {{"cylinder",1},{"plane",2}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "cylinder");
        TopoDS_Face of;
        if (c && firstFaceOfType(s, GeomAbs_Cylinder, of)) {
            gp_Cylinder cy = BRepAdaptor_Surface(of).Cylinder();
            Vec3 oaxis = toV(cy.Axis().Direction()), oloc = toV(cy.Position().Location());
            check(std::fabs(c->radius - cy.Radius()) <= TOL,
                  "placed cylinder radius native=" + std::to_string(c->radius) +
                  " occt=" + std::to_string(cy.Radius()));
            check(parallel(c->axis, oaxis, TOL), "placed cylinder axis native||occt (0,1,0)");
            check(ptLineDist(c->origin, oloc, nb::vnorm(oaxis)) <= TOL,
                  "placed cylinder origin lies on OCCT axis");
        } else check(false, "placed cylinder curved face + OCCT oracle found");
    }

    // (4) CONE FRUSTUM rB4 rT2 h7 -> cone 3; A/B axis + radii at the face's v-window.
    {
        TopoDS_Shape s = BRepPrimAPI_MakeCone(4.0, 2.0, 7.0).Shape();
        bool ok; auto inv = importInv("cone frustum 4->2 h7", s, 3, {{"cone",1},{"plane",2}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "cone");
        TopoDS_Face of;
        if (c && firstFaceOfType(s, GeomAbs_Cone, of)) {
            gp_Cone co = BRepAdaptor_Surface(of).Cone();
            double u0,u1,v0,v1; BRepTools::UVBounds(of, u0,u1,v0,v1);
            // OCCT cone radius at parameter v: |RefRadius + v*sin(semiAngle)|.
            double rA = std::fabs(co.RefRadius() + v0 * std::sin(co.SemiAngle()));
            double rB = std::fabs(co.RefRadius() + v1 * std::sin(co.SemiAngle()));
            double lo = std::min(rA, rB), hi = std::max(rA, rB);
            double nlo = std::min(c->radius, c->minorRadius), nhi = std::max(c->radius, c->minorRadius);
            check(std::fabs(nlo - lo) <= TOL && std::fabs(nhi - hi) <= TOL,
                  "cone radii native{" + std::to_string(nlo) + "," + std::to_string(nhi) +
                  "} == occt{" + std::to_string(lo) + "," + std::to_string(hi) + "}");
            check(parallel(c->axis, toV(co.Axis().Direction()), TOL), "cone axis native||occt");
        } else check(false, "cone curved face + OCCT oracle found");
    }

    // (5) CONE TO APEX rB4 rT0 h6 -> cone 1 + plane 1 (no top cap): degenerate-radius attach.
    {
        TopoDS_Shape s = BRepPrimAPI_MakeCone(4.0, 0.0, 6.0).Shape();
        bool ok; auto inv = importInv("cone to apex 4->0 h6", s, 2, {{"cone",1},{"plane",1}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "cone");
        TopoDS_Face of;
        if (c && firstFaceOfType(s, GeomAbs_Cone, of)) {
            gp_Cone co = BRepAdaptor_Surface(of).Cone();
            double u0,u1,v0,v1; BRepTools::UVBounds(of, u0,u1,v0,v1);
            double rA = std::fabs(co.RefRadius() + v0 * std::sin(co.SemiAngle()));
            double rB = std::fabs(co.RefRadius() + v1 * std::sin(co.SemiAngle()));
            double lo = std::min(rA, rB), hi = std::max(rA, rB);
            double nlo = std::min(c->radius, c->minorRadius), nhi = std::max(c->radius, c->minorRadius);
            check(std::fabs(nlo - lo) <= TOL && std::fabs(nhi - hi) <= TOL,
                  "cone-apex radii native{" + std::to_string(nlo) + "," + std::to_string(nhi) +
                  "} == occt{" + std::to_string(lo) + "," + std::to_string(hi) + "}");
            check(parallel(c->axis, toV(co.Axis().Direction()), TOL), "cone-apex axis native||occt");
        } else check(false, "cone-apex curved face + OCCT oracle found");
    }

    // (6) SPHERE r5 -> sphere 1; A/B radius + centre vs gp_Sphere.
    {
        TopoDS_Shape s = BRepPrimAPI_MakeSphere(5.0).Shape();
        bool ok; auto inv = importInv("sphere r5", s, 1, {{"sphere",1}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "sphere");
        TopoDS_Face of;
        if (c && firstFaceOfType(s, GeomAbs_Sphere, of)) {
            gp_Sphere sp = BRepAdaptor_Surface(of).Sphere();
            check(std::fabs(c->radius - sp.Radius()) <= TOL,
                  "sphere radius native=" + std::to_string(c->radius) +
                  " occt=" + std::to_string(sp.Radius()));
            check(nb::vlen(nb::vsub(c->origin, toV(sp.Location()))) <= TOL, "sphere centre native==occt");
        } else check(false, "sphere curved face + OCCT oracle found");
    }

    // (7) TORUS R8 r2 -> torus 1; A/B major/minor/centre/axis vs gp_Torus (1:1 parameterization).
    {
        TopoDS_Shape s = BRepPrimAPI_MakeTorus(8.0, 2.0).Shape();
        bool ok; auto inv = importInv("torus R8 r2", s, 1, {{"torus",1}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "torus");
        TopoDS_Face of;
        if (c && firstFaceOfType(s, GeomAbs_Torus, of)) {
            gp_Torus to = BRepAdaptor_Surface(of).Torus();
            check(std::fabs(c->radius - to.MajorRadius()) <= TOL,
                  "torus major native=" + std::to_string(c->radius) +
                  " occt=" + std::to_string(to.MajorRadius()));
            check(std::fabs(c->minorRadius - to.MinorRadius()) <= TOL,
                  "torus minor native=" + std::to_string(c->minorRadius) +
                  " occt=" + std::to_string(to.MinorRadius()));
            check(nb::vlen(nb::vsub(c->origin, toV(to.Location()))) <= TOL, "torus centre native==occt");
            check(parallel(c->axis, toV(to.Axis().Direction()), TOL), "torus axis native||occt");
        } else check(false, "torus curved face + OCCT oracle found");
    }

    // (8) BOX - THROUGH CYLINDER -> {cylinder, 6 planes}: a TRIMMED (boolean-cut) cylinder
    // BORE (radius 2) still attaches its exact Cylinder surface — the drilled-hole scenario.
    {
        TopoDS_Shape box = BRepPrimAPI_MakeBox(gp_Pnt(-5,-5,-5), gp_Pnt(5,5,5)).Shape();
        gp_Ax2 ax(gp_Pnt(0,0,-6), gp_Dir(0,0,1));
        TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(ax, 2.0, 12.0).Shape();
        TopoDS_Shape cut = BRepAlgoAPI_Cut(box, cyl).Shape();
        bool ok; auto inv = importInv("box - through cylinder (trimmed bore r2)", cut, 7,
                                      {{"cylinder",1},{"plane",6}}, ok);
        const nb::AnalyticFaceInfo* c = curvedFace(inv, "cylinder");
        TopoDS_Face of;
        if (c && firstFaceOfType(cut, GeomAbs_Cylinder, of)) {
            gp_Cylinder cy = BRepAdaptor_Surface(of).Cylinder();
            Vec3 oaxis = toV(cy.Axis().Direction()), oloc = toV(cy.Position().Location());
            check(std::fabs(c->radius - cy.Radius()) <= TOL,
                  "bore radius native=" + std::to_string(c->radius) +
                  " occt=" + std::to_string(cy.Radius()));
            check(parallel(c->axis, oaxis, TOL), "bore axis native||occt");
            check(ptLineDist(c->origin, oloc, nb::vnorm(oaxis)) <= TOL, "bore origin lies on OCCT axis");
        } else check(false, "bore curved face + OCCT oracle found");
    }

    std::printf("\n=== RESULT: %d passed, %d failed ===\n", g_pass, g_fail);
    return g_fail == 0 ? 0 : 1;
}
