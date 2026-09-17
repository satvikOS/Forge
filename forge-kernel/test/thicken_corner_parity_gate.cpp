// ─────────────────────────────────────────────────────────────────────────────
// thicken_corner_parity_gate.cpp — THICKEN at a 3+-plate CORNER: correct, or refused.
//
// WHY THIS GATE EXISTS. TKOffset family I deleted OCCT's skin offset from the
// kernel on a "600/600 parity" corpus result. The 600-part corpus derivation
// thickens ONE face per part, so it never contained a vertex where three or more
// plates meet. The shipped app does. The OCCT kernel smoke on PR #245 (job
// 104231406331) went red on four app operations that stopped building:
//     part.thicken   THICKEN(%surface, 2)          %surface = UNFOLD(BOX(60,40,2))
//     part.thicken   THICKEN(%surface, 2, OUT)
//     UNFOLD -> THICKEN                            (5524.631241 mm^3, 32 f, 60 e)
//     part.surf_trim SURFTRIM(%surface, %toolSheet) -> THICKEN
// all with "a convex fold ends at a 3-or-more-plate corner (the spherical vertex
// wedge is not built)". Parity measured on a corpus without the case that matters
// is not parity.
//
// WHAT IT REQUIRES, section by section
//   1. THE EXACT SMOKE PROGRAMS, run through forge::ft::compileText exactly as the
//      app path probe writes them. Each must BUILD, be valid, and equal its closed
//      form on volume, area, centroid and all six bbox bounds.
//   2. OUTWARD (the convex side) on 3-, 4- and 5-plate convex corners (kite fans
//      with free edges perpendicular to the folds, and triangle fans: a regular
//      tetrahedron corner and a square pyramid, the A/B harness's case12/case11
//      geometry), for t in {0.01, 0.1, 1, 5, 50}, through part::thickenSurface
//      with side OUT (+1) and side default (0). Every answer must BUILD and match
//      a CLOSED FORM on the full vector, independent of both engines. The sources:
//        * the offset body of a sheet lying on the boundary of a convex body splits
//          into pieces with disjoint nearest-point sets — a face slab, a cylindrical
//          sector along each convex fold, a spherical sector at each convex vertex
//          (Rossignac & Requicha, "Offsetting operations in solid modelling",
//          CAGD 3(2):129-148, 1986). So
//            V(t) = sum(A_f) t + sum(theta_e L_e / 2) t^2 + (Omega / 3) t^3
//          which for a closed convex polyhedron is Steiner's formula for the
//          parallel body (Schneider, "Convex Bodies: The Brunn-Minkowski Theory",
//          sec. 4.2);
//        * Omega, the solid angle of the corner's normal cone, from the angle
//          defect 2*pi - sum(face angles at the apex) (Descartes), cross-checked
//          against Girard's spherical excess of the normals' polygon — a fixture
//          whose two disagree is not a convex corner and aborts the gate;
//        * the sector centroid from  int_S r dA = 1/2 oint r x dr  (Stokes) over
//          the great-circle boundary, the cylindrical sector centroid at
//          4 t sin(theta/2) / (3 theta) from the axis.
//   3. INWARD (the concave side) — CORRECT OR REFUSED. The A/B harness measured
//      native returning a WRONG solid as success here (case12 tetrahedral apex
//      t=-1: 102.414 vs 92.096, bbox.lo.y -0.471 vs 0; case11 square pyramid t=-1:
//      527.100 vs 526.628). No closed form is used for the fans; a success must
//      (a) stay inside the convex cone of the corner — every vertex and edge
//      midpoint on the inner side of every face plane — and (b) agree with the OCCT
//      oracle (test/OcctThickenOracle.hpp) on the full vector. A success with NO
//      valid OCCT answer to check it against is a FAIL: an unverifiable success in
//      a class already shown to return wrong geometry is not evidence. The cube
//      corner and the closed box sheet have exact inward closed forms and use them.
//   4. THE CLOSED BOX SHEET (UNFOLD(BOX(60,40,2)) built through the kernel the way
//      THICKEN receives it): outward = Steiner, two shells; inward t < 1 =
//      4800 - (60-2t)(40-2t)(2-2t), two shells; inward t >= 1 has no skin (the
//      2 mm wall is consumed) and must be REFUSED.
//   5. DECLINES THAT MUST STAY DECLINES (a SADDLE corner and an OPEN fan): no
//      handle, a named reason.
//
// Tolerances: volume and area 1e-6 relative; centroid and bbox 1e-6 * (size + t)
// absolute. Validity is BRepCheck_Analyzer on the returned solid; the topology
// must be one solid, the expected shell count, and Euler V - E + F = 2 per shell.
//
// usage: thicken_corner_parity_gate [-v]      exit 0 iff every check holds
// ─────────────────────────────────────────────────────────────────────────────
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

#include "forge/Features.hpp"
#include "forge/Healing.hpp"
#include "forge/Primitives.hpp"
#include "forge/ShapeRegistry.hpp"
#include "forge/SurfaceValue.hpp"
#include "forge/ft/FeatureTree.hpp"
#include "OcctThickenOracle.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Plane.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

namespace {

const double kPi = 3.14159265358979323846;
bool g_verbose = false;
int g_pass = 0, g_fail = 0;

void ck(bool ok, const std::string& what) {
    if (ok) {
        ++g_pass;
        if (g_verbose) std::printf("  ok    %s\n", what.c_str());
    } else {
        ++g_fail;
        std::printf("  FAIL  %s\n", what.c_str());
    }
}

// ─── the observable vector ──────────────────────────────────────────────────
struct Obs {
    bool built = false;
    std::string reason;
    double V = 0, A = 0, c[3] = {0, 0, 0}, bb[6] = {0, 0, 0, 0, 0, 0};
    int nF = 0, nE = 0, nV = 0, nW = 0, solids = 0, shells = 0;
    bool valid = false;
    std::vector<gp_Pnt> probe;   // vertices + edge midpoints, for containment
};

Obs observe(const TopoDS_Shape& s) {
    Obs o;
    if (s.IsNull()) return o;
    o.built = true;
    GProp_GProps gv, gs;
    BRepGProp::VolumeProperties(s, gv);
    BRepGProp::SurfaceProperties(s, gs);
    o.V = gv.Mass();
    o.A = gs.Mass();
    o.c[0] = gv.CentreOfMass().X(); o.c[1] = gv.CentreOfMass().Y(); o.c[2] = gv.CentreOfMass().Z();
    Bnd_Box b;
    BRepBndLib::AddOptimal(s, b, Standard_False, Standard_False);
    b.Get(o.bb[0], o.bb[1], o.bb[2], o.bb[3], o.bb[4], o.bb[5]);
    TopTools_IndexedMapOfShape mf, me, mv;
    TopExp::MapShapes(s, TopAbs_FACE, mf);
    TopExp::MapShapes(s, TopAbs_EDGE, me);
    TopExp::MapShapes(s, TopAbs_VERTEX, mv);
    o.nF = mf.Extent(); o.nE = me.Extent(); o.nV = mv.Extent();
    for (int i = 1; i <= mf.Extent(); ++i)
        for (TopExp_Explorer w(mf(i), TopAbs_WIRE); w.More(); w.Next()) ++o.nW;
    for (TopExp_Explorer e(s, TopAbs_SOLID); e.More(); e.Next()) ++o.solids;
    for (TopExp_Explorer e(s, TopAbs_SHELL); e.More(); e.Next()) ++o.shells;
    o.valid = BRepCheck_Analyzer(s).IsValid();
    for (int i = 1; i <= mv.Extent(); ++i) o.probe.push_back(BRep_Tool::Pnt(TopoDS::Vertex(mv(i))));
    for (int i = 1; i <= me.Extent(); ++i) {
        const TopoDS_Edge ed = TopoDS::Edge(me(i));
        if (BRep_Tool::Degenerated(ed)) continue;
        BRepAdaptor_Curve cu(ed);
        o.probe.push_back(cu.Value(0.5 * (cu.FirstParameter() + cu.LastParameter())));
    }
    return o;
}

std::string vecStr(const Obs& o) {
    if (!o.built) return "DECLINED \"" + o.reason + "\"";
    char b[512];
    std::snprintf(b, sizeof b,
                  "V=%.9g A=%.9g com=(%.6g,%.6g,%.6g) bb=[%.6g %.6g %.6g]..[%.6g %.6g %.6g] "
                  "F/E/V=%d/%d/%d solids=%d shells=%d valid=%d",
                  o.V, o.A, o.c[0], o.c[1], o.c[2], o.bb[0], o.bb[1], o.bb[2], o.bb[3], o.bb[4],
                  o.bb[5], o.nF, o.nE, o.nV, o.solids, o.shells, o.valid ? 1 : 0);
    return b;
}

struct Truth {           // a closed-form (or oracle) vector
    double V, A, c[3], bb[6];
};

bool nearRel(double a, double b, double rel) {
    return std::fabs(a - b) <= rel * std::max(1.0e-300, std::max(std::fabs(a), std::fabs(b)));
}

// Returns the list of legs that disagree ("" when all agree).
std::string diffLegs(const Obs& o, const Truth& t, double size) {
    std::string legs;
    auto add = [&](const char* s) { legs += legs.empty() ? s : std::string(",") + s; };
    const double abs = 1.0e-6 * size;
    if (!nearRel(o.V, t.V, 1.0e-6)) add("volume");
    if (!nearRel(o.A, t.A, 1.0e-6)) add("area");
    for (int k = 0; k < 3; ++k)
        if (std::fabs(o.c[k] - t.c[k]) > abs) { add("centroid"); break; }
    for (int k = 0; k < 6; ++k)
        if (std::fabs(o.bb[k] - t.bb[k]) > abs) { add("bbox"); break; }
    return legs;
}

std::string truthStr(const Truth& t) {
    char b[400];
    std::snprintf(b, sizeof b, "V=%.9g A=%.9g com=(%.6g,%.6g,%.6g) bb=[%.6g %.6g %.6g]..[%.6g %.6g %.6g]",
                  t.V, t.A, t.c[0], t.c[1], t.c[2], t.bb[0], t.bb[1], t.bb[2], t.bb[3], t.bb[4], t.bb[5]);
    return b;
}

// Full-vector check of a SUCCESS against a closed form, plus validity and topology.
void checkBuiltAgainst(const std::string& lab, const Obs& o, const Truth& t, double size,
                       int wantShells) {
    ck(o.built, lab + " BUILDS" + (o.built ? "" : " — " + vecStr(o)));
    if (!o.built) return;
    const std::string legs = diffLegs(o, t, size);
    ck(legs.empty(), lab + " equals its closed form on the full vector" +
                         (legs.empty() ? "" : " — disagrees on [" + legs + "]\n        native " +
                                                  vecStr(o) + "\n        closed " + truthStr(t)));
    ck(o.valid, lab + " is BRepCheck-valid");
    ck(o.solids == 1 && o.shells == wantShells,
       lab + " is one solid with " + std::to_string(wantShells) + " shell(s) (got " +
           std::to_string(o.solids) + "/" + std::to_string(o.shells) + ")");
    // Euler-Poincare for a genus-0 boundary whose faces may carry holes: each
    // inner loop (wires beyond one per face) adds one to V - E + F, so the
    // invariant is V - E + 2F - W == 2 per shell. The first version of this gate
    // asserted V - E + F == 2 and failed the SURFTRIM skin (a ring face on each
    // side of the 20 x 20 hole: 40 - 72 + 36 = 4, W = 38, so 40 - 72 + 72 - 38 = 2).
    ck(o.nV - o.nE + 2 * o.nF - o.nW == 2 * o.shells,
       lab + " Euler-Poincare V-E+2F-W == 2 per shell (got " +
           std::to_string(o.nV - o.nE + 2 * o.nF - o.nW) + ")");
}

// ─── fans ───────────────────────────────────────────────────────────────────
// A convex corner: apex P and k faces in cyclic order; face i is a planar convex
// polygon whose first vertex is P, second the far end of fold i, last the far end
// of fold i+1. Folds run from P along e_i to A_i. Everything else is a free rim.
struct Fan {
    std::string name;
    gp_Pnt P;
    std::vector<std::vector<gp_Pnt>> faces;
};

gp_Vec V3(const gp_Pnt& a, const gp_Pnt& b) { return gp_Vec(a, b); }

Fan kiteFan(const std::string& name, const gp_Pnt& P, const std::vector<gp_Vec>& dirs, double L) {
    Fan f;
    f.name = name;
    f.P = P;
    const std::size_t k = dirs.size();
    for (std::size_t i = 0; i < k; ++i) {
        const gp_Vec ei = dirs[i].Normalized(), ej = dirs[(i + 1) % k].Normalized();
        const gp_Pnt A = P.Translated(ei * L), B = P.Translated(ej * L);
        const gp_Pnt X = P.Translated((ei + ej) * (L / (1.0 + ei.Dot(ej))));
        f.faces.push_back({P, A, X, B});
    }
    return f;
}

Fan triFan(const std::string& name, const gp_Pnt& P, const std::vector<gp_Pnt>& base) {
    Fan f;
    f.name = name;
    f.P = P;
    for (std::size_t i = 0; i < base.size(); ++i) f.faces.push_back({P, base[i], base[(i + 1) % base.size()]});
    return f;
}

struct FanGeom {
    bool ok = false;
    std::string why;
    std::size_t k = 0;
    std::vector<gp_Dir> n;         // outward unit normal per face
    std::vector<double> area;
    std::vector<gp_Pnt> cen;
    std::vector<gp_Dir> e;         // fold i direction
    std::vector<double> L;         // fold i length
    std::vector<double> theta;     // exterior dihedral at fold i (between n[i-1], n[i])
    double omega = 0.0;
    double size = 0.0;
    gp_Dir inward;                 // mean fold direction (into the cone)
};

double polyArea(const std::vector<gp_Pnt>& p, gp_Pnt& cen) {
    double a = 0.0;
    gp_Vec m(0, 0, 0);
    for (std::size_t i = 1; i + 1 < p.size(); ++i) {
        const double t = 0.5 * V3(p[0], p[i]).Crossed(V3(p[0], p[i + 1])).Magnitude();
        a += t;
        m += (gp_Vec(p[0].XYZ()) + gp_Vec(p[i].XYZ()) + gp_Vec(p[i + 1].XYZ())) * (t / 3.0);
    }
    cen = gp_Pnt((m / a).XYZ());
    return a;
}

FanGeom analyse(const Fan& f) {
    FanGeom g;
    g.k = f.faces.size();
    gp_Vec sum(0, 0, 0);
    for (std::size_t i = 0; i < g.k; ++i) {
        const gp_Vec d = V3(f.P, f.faces[i][1]);
        g.e.push_back(gp_Dir(d));
        g.L.push_back(d.Magnitude());
        sum += gp_Vec(g.e.back());
        g.size = std::max(g.size, d.Magnitude());
    }
    g.inward = gp_Dir(sum);
    double sumAlpha = 0.0;
    for (std::size_t i = 0; i < g.k; ++i) {
        const gp_Dir ei = g.e[i], ej = g.e[(i + 1) % g.k];
        gp_Vec nv = gp_Vec(ei).Crossed(gp_Vec(ej));
        if (nv.Dot(gp_Vec(g.inward)) > 0.0) nv.Reverse();
        g.n.push_back(gp_Dir(nv));
        gp_Pnt c;
        g.area.push_back(polyArea(f.faces[i], c));
        g.cen.push_back(c);
        sumAlpha += std::acos(std::max(-1.0, std::min(1.0, ei.Dot(ej))));
        for (const gp_Pnt& q : f.faces[i])
            if (std::fabs(gp_Vec(f.P, q).Dot(gp_Vec(g.n.back()))) > 1.0e-9 * g.size) {
                g.why = "a fixture face is not planar";
                return g;
            }
    }
    for (std::size_t i = 0; i < g.k; ++i) {
        const double d = g.n[(i + g.k - 1) % g.k].Dot(g.n[i]);
        g.theta.push_back(std::acos(std::max(-1.0, std::min(1.0, d))));
        // convex fold: the neighbour's interior lies BELOW this face's plane
        const gp_Vec intoNext = V3(f.P, f.faces[i].back());
        if (!(intoNext.Dot(gp_Vec(g.n[(i + g.k - 1) % g.k])) < 0.0) && g.theta[i] > 1e-12) {
            g.why = "a fixture fold is not convex";
            return g;
        }
    }
    const double defect = 2.0 * kPi - sumAlpha;
    // Girard: spherical excess of the normals' polygon
    double sumAng = 0.0;
    for (std::size_t i = 0; i < g.k; ++i) {
        const gp_Vec a(g.n[i]), p(g.n[(i + g.k - 1) % g.k]), q(g.n[(i + 1) % g.k]);
        const gp_Vec tp = p - a * a.Dot(p), tq = q - a * a.Dot(q);
        sumAng += std::atan2(tp.Crossed(tq).Magnitude(), tp.Dot(tq));
    }
    const double girard = sumAng - (static_cast<double>(g.k) - 2.0) * kPi;
    if (!(defect > 0.0) || std::fabs(defect - girard) > 1.0e-9) {
        char b[160];
        std::snprintf(b, sizeof b, "fixture is not a convex corner: defect %.12g vs Girard %.12g", defect, girard);
        g.why = b;
        return g;
    }
    g.omega = defect;
    g.ok = true;
    return g;
}

// max over s in [0, theta] of (a cos s + w sin s) . u, the arc a -> b
double arcMax(const gp_Dir& a, const gp_Dir& b, const gp_Vec& u) {
    const double th = std::acos(std::max(-1.0, std::min(1.0, a.Dot(b))));
    gp_Vec w = gp_Vec(b) - gp_Vec(a) * a.Dot(b);
    if (w.Magnitude() < 1e-15) return gp_Vec(a).Dot(u);
    w.Normalize();
    const double au = gp_Vec(a).Dot(u), wu = w.Dot(u);
    double best = std::max(au, au * std::cos(th) + wu * std::sin(th));
    double s = std::atan2(wu, au);
    if (s < 0.0) s += 2.0 * kPi;
    if (s <= th) best = std::max(best, std::hypot(au, wu));
    return best;
}

// The OUTWARD closed form of a convex fan: volume, area, centroid, bbox.
Truth outwardTruth(const Fan& f, const FanGeom& g, double t) {
    Truth tr{};
    const std::size_t k = g.k;
    double V = 0.0, A = 0.0;
    gp_Vec mom(0, 0, 0);
    // face slabs
    for (std::size_t i = 0; i < k; ++i) {
        const double v = g.area[i] * t;
        V += v;
        mom += gp_Vec(g.cen[i].XYZ()) * v + gp_Vec(g.n[i]) * (0.5 * t * v);
        A += 2.0 * g.area[i];
        // free rim edges of face i: every polygon edge except the two folds
        const auto& p = f.faces[i];
        for (std::size_t j = 1; j + 1 < p.size(); ++j) A += p[j].Distance(p[j + 1]) * t;
    }
    // fold wedges
    for (std::size_t i = 0; i < k; ++i) {
        const double th = g.theta[i];
        if (th < 1e-15) continue;
        const double v = 0.5 * th * t * t * g.L[i];
        V += v;
        const gp_Dir bis(gp_Vec(g.n[(i + k - 1) % k]) + gp_Vec(g.n[i]));
        const gp_Vec c = gp_Vec(f.P.XYZ()) + gp_Vec(g.e[i]) * (0.5 * g.L[i]) +
                         gp_Vec(bis) * (4.0 * t * std::sin(0.5 * th) / (3.0 * th));
        mom += c * v;
        A += th * g.L[i] * t;         // cylindrical side
        A += 0.5 * th * t * t;         // end cap at the free far end of the fold
    }
    // apex sector
    {
        const double v = g.omega * t * t * t / 3.0;
        V += v;
        gp_Vec S(0, 0, 0);
        gp_Vec meanN(0, 0, 0);
        for (std::size_t i = 0; i < k; ++i) {
            const gp_Dir a = g.n[i], b = g.n[(i + 1) % k];
            meanN += gp_Vec(a);
            gp_Vec nu = gp_Vec(a).Crossed(gp_Vec(b));
            const double phi = std::atan2(nu.Magnitude(), gp_Vec(a).Dot(gp_Vec(b)));
            if (nu.Magnitude() > 1e-15) S += nu.Normalized() * phi;
        }
        S *= 0.5;
        if (S.Dot(meanN) < 0.0) S.Reverse();
        mom += (gp_Vec(f.P.XYZ()) + S * (0.75 * t / g.omega)) * v;
        A += g.omega * t * t;
    }
    tr.V = V;
    tr.A = A;
    const gp_Vec c = mom / V;
    tr.c[0] = c.X(); tr.c[1] = c.Y(); tr.c[2] = c.Z();
    // bbox: the max of u.x over each piece, for u = +-x, +-y, +-z
    const gp_Vec axes[3] = {gp_Vec(1, 0, 0), gp_Vec(0, 1, 0), gp_Vec(0, 0, 1)};
    for (int ax = 0; ax < 3; ++ax) {
        for (int sgn = -1; sgn <= 1; sgn += 2) {
            const gp_Vec u = axes[ax] * sgn;
            double m = -1e300;
            for (std::size_t i = 0; i < k; ++i) {
                for (const gp_Pnt& q : f.faces[i])
                    m = std::max(m, gp_Vec(q.XYZ()).Dot(u) + std::max(0.0, t * gp_Vec(g.n[i]).Dot(u)));
                const double am = std::max(0.0, arcMax(g.n[(i + k - 1) % k], g.n[i], u));
                for (const gp_Pnt& q : {f.P, f.faces[i][1]}) m = std::max(m, gp_Vec(q.XYZ()).Dot(u) + t * am);
            }
            // sector: inside the normals' convex polygon?
            {
                int sign = 0;
                bool inside = true;
                for (std::size_t i = 0; i < k; ++i) {
                    const double d = gp_Vec(g.n[i]).Crossed(gp_Vec(g.n[(i + 1) % k])).Dot(u);
                    const double o = gp_Vec(g.n[i]).Crossed(gp_Vec(g.n[(i + 1) % k])).Dot(gp_Vec(g.n[(i + 2) % k]));
                    const int so = o > 0 ? 1 : -1;
                    if (sign == 0) sign = so;
                    if (d * sign < 0.0) inside = false;
                }
                double pm = -1.0;
                if (inside) pm = 1.0;
                else
                    for (std::size_t i = 0; i < k; ++i) pm = std::max(pm, arcMax(g.n[i], g.n[(i + 1) % k], u));
                m = std::max(m, gp_Vec(f.P.XYZ()).Dot(u) + t * std::max(0.0, pm));
            }
            if (sgn > 0) tr.bb[3 + ax] = m;
            else tr.bb[ax] = -m;
        }
    }
    return tr;
}

TopoDS_Face planarFace(const std::vector<gp_Pnt>& p, const gp_Dir& wantN) {
    BRepBuilderAPI_MakePolygon poly;
    for (const gp_Pnt& q : p) poly.Add(q);
    poly.Close();
    TopoDS_Face face = BRepBuilderAPI_MakeFace(poly.Wire(), Standard_True).Face();
    const Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(face));
    gp_Dir d = pl->Pln().Axis().Direction();
    if (face.Orientation() == TopAbs_REVERSED) d.Reverse();
    if (d.Dot(wantN) < 0.0) face.Reverse();
    return face;
}

gp_Dir faceNormal(const TopoDS_Face& face) {
    const Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(BRep_Tool::Surface(face));
    gp_Dir d = pl->Pln().Axis().Direction();
    if (face.Orientation() == TopAbs_REVERSED) d.Reverse();
    return d;
}

// Builds the fan as ONE sewn sheet with every face's normal OUTWARD; verifies it.
TopoDS_Shape buildFan(const Fan& f, const FanGeom& g, std::string& why, int skip = -1) {
    BRepBuilderAPI_Sewing sew(1.0e-6);
    for (std::size_t i = 0; i < g.k; ++i)
        if (static_cast<int>(i) != skip) sew.Add(planarFace(f.faces[i], g.n[i]));
    sew.Perform();
    TopoDS_Shape s = sew.SewedShape();
    int nsh = 0;
    for (TopExp_Explorer e(s, TopAbs_SHELL); e.More(); e.Next()) ++nsh;
    if (nsh != 1) { why = "fixture did not sew into one shell"; return TopoDS_Shape(); }
    for (TopExp_Explorer e(s, TopAbs_FACE); e.More(); e.Next()) {
        const TopoDS_Face face = TopoDS::Face(e.Current());
        GProp_GProps gp;
        BRepGProp::SurfaceProperties(face, gp);
        const gp_Vec rel(f.P, gp.CentreOfMass());
        // every face must have its normal pointing away from the cone interior
        if (gp_Vec(faceNormal(face)).Dot(gp_Vec(g.inward)) > 0.0 &&
            rel.Magnitude() > 0.0) {
            why = "fixture face is not oriented outward after sewing";
            return TopoDS_Shape();
        }
    }
    return s;
}

Obs thickenVia(const TopoDS_Shape& sheet, double t, int side) {
    Obs o;
    try {
        const forge::ShapeHandle h = forge::part::thickenSurface(
            forge::ShapeRegistry::instance().add(sheet), t, side);
        o = observe(forge::ShapeRegistry::instance().get(h));
    } catch (const std::exception& e) {
        o = Obs();
        o.reason = e.what();
    }
    return o;
}

Obs oracle(const TopoDS_Shape& sheet, double signedT) {
    try {
        const TopoDS_Shape s = forge::testoracle::occtThickenOracle(sheet, signedT, 1.0e-4);
        Obs o = observe(s);
        return o;
    } catch (const std::exception& e) {
        Obs o;
        o.reason = e.what();
        return o;
    }
}

Truth truthOf(const Obs& o) {
    Truth t{};
    t.V = o.V; t.A = o.A;
    for (int k = 0; k < 3; ++k) t.c[k] = o.c[k];
    for (int k = 0; k < 6; ++k) t.bb[k] = o.bb[k];
    return t;
}

int g_oracleAgree = 0, g_oracleNone = 0, g_inwardRefused = 0, g_inwardVerified = 0;

// INWARD: correct (inside the cone AND equal to a valid OCCT answer) or refused.
void inwardCorrectOrRefused(const std::string& lab, const Fan& f, const FanGeom& g,
                            const TopoDS_Shape& sheet, double t) {
    const Obs nat = thickenVia(sheet, t, -1);
    if (!nat.built) {
        ++g_inwardRefused;
        ck(!nat.reason.empty(), lab + " refused, with a named reason");
        if (g_verbose) std::printf("        refused: %s\n", nat.reason.c_str());
        return;
    }
    double worst = -1e300;
    for (const gp_Pnt& x : nat.probe)
        for (std::size_t j = 0; j < g.k; ++j) worst = std::max(worst, gp_Vec(f.P, x).Dot(gp_Vec(g.n[j])));
    ck(worst <= 1.0e-6 * (g.size + t),
       lab + " success stays inside the corner's convex cone (worst excursion " +
           std::to_string(worst) + ")");
    const Obs occ = oracle(sheet, -t);
    const bool oracleOk = occ.built && occ.valid && occ.solids == 1 && occ.V > 0.0;
    if (!oracleOk) {
        ++g_oracleNone;
        ck(false, lab + " SUCCESS WITH NO VALID OCCT ANSWER TO CHECK IT AGAINST — an unverifiable "
                        "success in a class that has returned wrong geometry\n        native " +
                      vecStr(nat));
        return;
    }
    const std::string legs = diffLegs(nat, truthOf(occ), g.size + t);
    ck(legs.empty(), lab + " success equals the OCCT oracle on the full vector" +
                         (legs.empty() ? "" : " — disagrees on [" + legs + "]\n        native " +
                                                  vecStr(nat) + "\n        OCCT   " + vecStr(occ)));
    ck(nat.valid, lab + " success is BRepCheck-valid");
    if (legs.empty()) ++g_inwardVerified;
}

// ─── closed box sheet ───────────────────────────────────────────────────────
Truth boxOutward(double a, double b, double c, const gp_Pnt& lo, double t) {
    const double Asheet = 2.0 * (a * b + b * c + c * a);
    const double M = kPi * (a + b + c);
    Truth tr{};
    tr.V = Asheet * t + M * t * t + 4.0 / 3.0 * kPi * t * t * t;
    tr.A = Asheet + (Asheet + 2.0 * M * t + 4.0 * kPi * t * t);
    tr.c[0] = lo.X() + a / 2; tr.c[1] = lo.Y() + b / 2; tr.c[2] = lo.Z() + c / 2;
    tr.bb[0] = lo.X() - t; tr.bb[1] = lo.Y() - t; tr.bb[2] = lo.Z() - t;
    tr.bb[3] = lo.X() + a + t; tr.bb[4] = lo.Y() + b + t; tr.bb[5] = lo.Z() + c + t;
    return tr;
}

Truth boxInward(double a, double b, double c, const gp_Pnt& lo, double t) {
    Truth tr{};
    const double ia = a - 2 * t, ib = b - 2 * t, ic = c - 2 * t;
    tr.V = a * b * c - ia * ib * ic;
    tr.A = 2.0 * (a * b + b * c + c * a) + 2.0 * (ia * ib + ib * ic + ic * ia);
    tr.c[0] = lo.X() + a / 2; tr.c[1] = lo.Y() + b / 2; tr.c[2] = lo.Z() + c / 2;
    tr.bb[0] = lo.X(); tr.bb[1] = lo.Y(); tr.bb[2] = lo.Z();
    tr.bb[3] = lo.X() + a; tr.bb[4] = lo.Y() + b; tr.bb[5] = lo.Z() + c;
    return tr;
}

TopoDS_Shape kernelBoxSheet(double a, double b, double c) {
    const forge::ShapeHandle sheet = forge::surf::boundaryOf(forge::makeBox(a, b, c));
    const forge::heal::SewResult r = forge::heal::sewShape(sheet, 1.0e-3);
    return forge::ShapeRegistry::instance().get(
        r.handle != forge::kInvalidHandle ? r.handle : sheet);
}

}  // namespace

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i)
        if (std::strcmp(argv[i], "-v") == 0) g_verbose = true;
    std::printf("thicken_corner_parity_gate — THICKEN at 3+-plate corners: correct, or refused\n");

    const double kTs[] = {0.01, 0.1, 1.0, 5.0, 50.0};

    // ── 1. THE EXACT SMOKE PROGRAMS ──────────────────────────────────────────
    std::printf("== 1. the four app operations the OCCT kernel smoke found broken ==\n");
    {
        const gp_Pnt lo(-30, -20, 0);   // FT's BOX(60,40,2) is centred in x and y
        struct Prog { const char* lab; const char* ir; double t; bool hole; int wantF, wantE; };
        // WHERE THE HOLE IS, and why it is not assumed. The first version of this
        // gate put the SURFTRIM hole in the TOP face (z = 2) and reported native
        // WRONG on the centroid (1.117 against 0.883). Measured instead, on the
        // trimmed sheet itself (the compile's intermediate handle): its four free
        // edges are the square |x|,|y| = 10 at z = 0 — the tool cube's BOTTOM face
        // is COPLANAR with the plate's bottom face, and cutting a sheet by a sheet
        // removes their common coplanar region; the top face is only imprinted
        // (ring + 400 mm^2 square, both kept). OCCT's thicken of that sheet agrees
        // with native on V, A, centroid and bbox. So the closed form below is
        // written for the hole on the BOTTOM face, slab z in [-t, 0].
        const Prog progs[] = {
            {"UNFOLD -> THICKEN(%2, 1)",
             "%1 = BOX(60,40,2)\n%2 = UNFOLD(%1, 0.44)\n%3 = THICKEN(%2, 1)\nRESULT(%3)\n", 1.0, false, 32, 60},
            {"part.thicken THICKEN(%surface, 2)",
             "%1 = BOX(60,40,2)\n%2 = UNFOLD(%1, 0.44)\n%3 = THICKEN(%2, 2)\nRESULT(%3)\n", 2.0, false, -1, -1},
            {"part.thicken THICKEN(%surface, 2, OUT)",
             "%1 = BOX(60,40,2)\n%2 = UNFOLD(%1, 0.44)\n%3 = THICKEN(%2, 2, OUT)\nRESULT(%3)\n", 2.0, false, -1, -1},
            {"part.surf_trim SURFTRIM(%surface, %toolSheet) -> THICKEN(1)",
             "%1 = BOX(60,40,2)\n%2 = UNFOLD(%1, 0.44)\n%3 = BOX(20,20,20)\n%4 = UNFOLD(%3, 0.44)\n"
             "%5 = SURFTRIM(%2, %4)\n%6 = THICKEN(%5, 1)\nRESULT(%6)\n", 1.0, true, -1, -1},
        };
        for (const Prog& p : progs) {
            const forge::ft::CompileResult r = forge::ft::compileText(p.ir, "", "");
            const std::string lab = std::string("[smoke] ") + p.lab;
            ck(r.ok, lab + " BUILDS" + (r.ok ? "" : " — " + r.error));
            if (!r.ok) continue;
            ck(r.valid, lab + " is valid (compileText's own check)");
            Obs o = observe(forge::ShapeRegistry::instance().get(r.handle));
            Truth tr = boxOutward(60, 40, 2, lo, p.t);
            int shells = 2;
            if (p.hole) {
                // a 20 x 20 hole through the BOTTOM face (z = 0): minus that
                // outward slab z in [-t, 0] (centroid z = -t/2), minus the 400 mm^2
                // of sheet and 400 of offset face, plus the hole's four walls of
                // height t
                const double t = p.t;
                const double V0 = tr.V;
                tr.V = V0 - 400.0 * t;
                tr.A = tr.A - 800.0 + 80.0 * t;
                tr.c[2] = (V0 * tr.c[2] - 400.0 * t * (-t / 2.0)) / tr.V;
                shells = 1;
            }
            checkBuiltAgainst(lab, o, tr, 60.0 + p.t, shells);
            ck(std::fabs(r.volume - tr.V) <= 1.0e-6 * tr.V,
               lab + " compileText's reported volume equals the closed form");
            if (p.wantF > 0)
                ck(r.faceCount == p.wantF && r.edgeCount == p.wantE,
                   lab + " F/E == " + std::to_string(p.wantF) + "/" + std::to_string(p.wantE) +
                       " (what ft_silent_noop_gate asserts; got " + std::to_string(r.faceCount) + "/" +
                       std::to_string(r.edgeCount) + ")");
            std::printf("  %-60s %s\n", p.lab, vecStr(o).c_str());
        }
    }

    // ── 2 + 3. convex corners: outward exact, inward correct-or-refused ─────
    std::printf("== 2. convex 3/4/5-plate corners OUTWARD (side OUT and default) against closed forms ==\n");
    std::printf("== 3. the same corners INWARD: correct (cone + OCCT) or refused ==\n");
    std::vector<Fan> fans;
    // the cube corner: kites with a right angle ARE squares
    fans.push_back(kiteFan("3-plate cube corner", gp_Pnt(10, 10, 10),
                           {gp_Vec(-1, 0, 0), gp_Vec(0, -1, 0), gp_Vec(0, 0, -1)}, 10.0));
    {
        const double s = 10.0;
        const gp_Pnt v0(0, 0, 0), v1(s, 0, 0), v2(s / 2, s * std::sqrt(3.0) / 2, 0),
                     v3(s / 2, s * std::sqrt(3.0) / 6, s * std::sqrt(2.0 / 3.0));
        fans.push_back(triFan("3-plate regular tetrahedron corner (A/B case12)", v3, {v0, v1, v2}));
    }
    fans.push_back(kiteFan("3-plate irregular kite corner", gp_Pnt(1, 2, 3),
                           {gp_Vec(1.0, 0.1, -0.9), gp_Vec(-0.4, 1.0, -1.3), gp_Vec(-0.8, -0.9, -0.6)}, 9.0));
    fans.push_back(triFan("4-plate square pyramid apex (A/B case11)", gp_Pnt(0, 0, 10),
                          {gp_Pnt(-10, -10, 0), gp_Pnt(10, -10, 0), gp_Pnt(10, 10, 0), gp_Pnt(-10, 10, 0)}));
    fans.push_back(kiteFan("4-plate irregular kite corner", gp_Pnt(-2, 1, 0),
                           {gp_Vec(1.0, 0.2, -0.7), gp_Vec(0.1, 1.0, -1.1), gp_Vec(-1.0, 0.3, -0.8),
                            gp_Vec(0.0, -1.0, -0.9)}, 10.0));
    {
        std::vector<gp_Pnt> base;
        const double rads[] = {10.0, 12.0, 9.0, 11.0, 10.5};
        const double angs[] = {0.0, 80.0, 150.0, 220.0, 290.0};
        for (int i = 0; i < 5; ++i)
            base.emplace_back(rads[i] * std::cos(angs[i] * kPi / 180.0), rads[i] * std::sin(angs[i] * kPi / 180.0),
                              0.3 * i);
        fans.push_back(triFan("5-plate irregular pentagonal apex", gp_Pnt(0.5, -0.4, 9.0), base));
    }
    {
        std::vector<gp_Vec> d;
        const double angs[] = {10.0, 85.0, 160.0, 215.0, 290.0};
        const double drop[] = {0.9, 1.2, 0.8, 1.0, 1.1};
        for (int i = 0; i < 5; ++i)
            d.emplace_back(std::cos(angs[i] * kPi / 180.0), std::sin(angs[i] * kPi / 180.0), -drop[i]);
        fans.push_back(kiteFan("5-plate irregular kite corner", gp_Pnt(0, 0, 0), d, 10.0));
    }

    for (const Fan& f : fans) {
        const FanGeom g = analyse(f);
        ck(g.ok, "[fixture] " + f.name + " is a convex corner (" + g.why + ")");
        if (!g.ok) continue;
        std::string why;
        const TopoDS_Shape sheet = buildFan(f, g, why);
        ck(!sheet.IsNull(), "[fixture] " + f.name + " sews into one outward-oriented sheet " + why);
        if (sheet.IsNull()) continue;
        std::printf("  %s: k=%zu Omega=%.9f sr\n", f.name.c_str(), g.k, g.omega);
        for (double t : kTs) {
            const Truth tr = outwardTruth(f, g, t);
            char lb[160];
            std::snprintf(lb, sizeof lb, "[out] %s t=%g", f.name.c_str(), t);
            const Obs out = thickenVia(sheet, t, +1);
            checkBuiltAgainst(std::string(lb) + " side OUT", out, tr, g.size + t, 1);
            const Obs def = thickenVia(sheet, t, 0);
            checkBuiltAgainst(std::string(lb) + " side default", def, tr, g.size + t, 1);
            // the oracle, recorded (the closed form is the judge)
            const Obs occ = oracle(sheet, t);
            if (occ.built && occ.valid && diffLegs(occ, tr, g.size + t).empty()) ++g_oracleAgree;
            if (g_verbose)
                std::printf("        %s\n        OCCT   %s\n        closed %s\n", vecStr(out).c_str(),
                            vecStr(occ).c_str(), truthStr(tr).c_str());
        }
        for (double t : kTs) {
            char lb[160];
            std::snprintf(lb, sizeof lb, "[in]  %s t=%g", f.name.c_str(), t);
            if (f.name.rfind("3-plate cube corner", 0) == 0) {
                // exact: [0,s]^3 minus [0,s-t]^3; area 6 s^2 for every t < s
                const double s = 10.0;
                if (t < s) {
                    const double u = s - t;
                    Truth tr{};
                    tr.V = s * s * s - u * u * u;
                    tr.A = 6.0 * s * s;
                    const double cc = (s * s * s * (s / 2) - u * u * u * (u / 2)) / tr.V;
                    tr.c[0] = tr.c[1] = tr.c[2] = cc;
                    for (int k = 0; k < 3; ++k) { tr.bb[k] = 0.0; tr.bb[3 + k] = s; }
                    const Obs nat = thickenVia(sheet, t, -1);
                    if (nat.built) checkBuiltAgainst(std::string(lb), nat, tr, s + t, 1);
                    else {
                        ++g_inwardRefused;
                        ck(!nat.reason.empty(), std::string(lb) + " refused, with a named reason");
                    }
                } else {
                    const Obs nat = thickenVia(sheet, t, -1);
                    ck(!nat.built, std::string(lb) + " (t >= the plate size: nothing left to skin) is REFUSED" +
                                       (nat.built ? " — returned " + vecStr(nat) : ""));
                }
                continue;
            }
            inwardCorrectOrRefused(lb, f, g, sheet, t);
        }
    }

    // ── 4. the closed box sheet ──────────────────────────────────────────────
    std::printf("== 4. the closed box sheet (what UNFOLD(BOX(60,40,2)) hands THICKEN) ==\n");
    {
        const TopoDS_Shape box = kernelBoxSheet(60, 40, 2);
        const gp_Pnt lo(0, 0, 0);
        for (double t : kTs) {
            char lb[96];
            std::snprintf(lb, sizeof lb, "[box] OUT t=%g", t);
            checkBuiltAgainst(lb, thickenVia(box, t, +1), boxOutward(60, 40, 2, lo, t), 60 + t, 2);
            std::snprintf(lb, sizeof lb, "[box] default t=%g", t);
            checkBuiltAgainst(lb, thickenVia(box, t, 0), boxOutward(60, 40, 2, lo, t), 60 + t, 2);
        }
        for (double t : {0.01, 0.1, 0.5, 0.9}) {
            char lb[96];
            std::snprintf(lb, sizeof lb, "[box] IN t=%g", t);
            checkBuiltAgainst(lb, thickenVia(box, t, -1), boxInward(60, 40, 2, lo, t), 60 + t, 2);
        }
        for (double t : {1.0, 5.0, 50.0}) {
            char lb[96];
            std::snprintf(lb, sizeof lb, "[box] IN t=%g (the 2 mm wall is consumed)", t);
            const Obs o = thickenVia(box, t, -1);
            ck(!o.built, std::string(lb) + " is REFUSED" + (o.built ? " — returned " + vecStr(o) : ""));
            ck(o.built || !o.reason.empty(), std::string(lb) + " and the refusal names a reason");
        }
    }

    // ── 5. declines that must stay declines ─────────────────────────────────
    std::printf("== 5. corners nothing is built for must be REFUSED, not answered ==\n");
    {
        // an L-block boundary: two SADDLE corners (one concave + two convex folds)
        const gp_Pnt Lp[6] = {gp_Pnt(0, 0, 0), gp_Pnt(20, 0, 0), gp_Pnt(20, 0, 10),
                              gp_Pnt(10, 0, 10), gp_Pnt(10, 0, 20), gp_Pnt(0, 0, 20)};
        const double depth = 10.0;
        BRepBuilderAPI_Sewing sew(1.0e-6);
        {
            BRepBuilderAPI_MakePolygon front, back;
            for (const gp_Pnt& p : Lp) { front.Add(p); back.Add(p.Translated(gp_Vec(0, depth, 0))); }
            front.Close(); back.Close();
            sew.Add(BRepBuilderAPI_MakeFace(front.Wire(), Standard_True).Face());
            sew.Add(BRepBuilderAPI_MakeFace(back.Wire(), Standard_True).Face());
            for (int i = 0; i < 6; ++i) {
                const gp_Pnt& p0 = Lp[i];
                const gp_Pnt& p1 = Lp[(i + 1) % 6];
                BRepBuilderAPI_MakePolygon q(p0, p1, p1.Translated(gp_Vec(0, depth, 0)),
                                             p0.Translated(gp_Vec(0, depth, 0)), Standard_True);
                sew.Add(BRepBuilderAPI_MakeFace(q.Wire(), Standard_True).Face());
            }
        }
        sew.Perform();
        const TopoDS_Shape lblock = sew.SewedShape();
        for (int side : {+1, -1}) {
            const Obs o = thickenVia(lblock, 2.0, side);
            const std::string lab = std::string("[decline] L-block SADDLE corners side ") + (side > 0 ? "+" : "-");
            ck(!o.built, lab + " is REFUSED" + (o.built ? " — returned " + vecStr(o) : ""));
            ck(o.built || !o.reason.empty(), lab + " with a named reason");
        }
        // an OPEN fan: three plates at a vertex that do not close around it
        BRepBuilderAPI_Sewing sw2(1.0e-6);
        auto quad = [](const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c, const gp_Pnt& d) {
            return BRepBuilderAPI_MakeFace(BRepBuilderAPI_MakePolygon(a, b, c, d, Standard_True).Wire(),
                                           Standard_True).Face();
        };
        sw2.Add(quad(gp_Pnt(0, 0, 0), gp_Pnt(10, 0, 0), gp_Pnt(10, 10, 0), gp_Pnt(0, 10, 0)));
        sw2.Add(quad(gp_Pnt(0, 0, 0), gp_Pnt(0, 10, 0), gp_Pnt(0, 10, 10), gp_Pnt(0, 0, 10)));
        sw2.Add(quad(gp_Pnt(0, 0, 0), gp_Pnt(0, 0, -10), gp_Pnt(10, 0, -10), gp_Pnt(10, 0, 0)));
        sw2.Perform();
        const TopoDS_Shape fan = sw2.SewedShape();
        for (int side : {+1, -1}) {
            const Obs o = thickenVia(fan, 2.0, side);
            const std::string lab = std::string("[decline] OPEN 3-plate fan side ") + (side > 0 ? "+" : "-");
            // an open fan may legitimately be answered only if correct; nothing here
            // can check it, so a success is not admitted
            ck(!o.built, lab + " is REFUSED" + (o.built ? " — returned " + vecStr(o) : ""));
            ck(o.built || !o.reason.empty(), lab + " with a named reason");
        }
    }

    std::printf("[corner-parity] inward: %d verified against OCCT, %d refused, %d unverifiable; "
                "outward rows where OCCT also matched the closed form: %d\n",
                g_inwardVerified, g_inwardRefused, g_oracleNone, g_oracleAgree);
    std::printf("[corner-parity] %d checks, %d failed\n", g_pass + g_fail, g_fail);
    return g_fail ? 1 : 0;
}
