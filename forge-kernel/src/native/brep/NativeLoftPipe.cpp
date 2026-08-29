// src/native/brep/NativeLoftPipe.cpp — TKOffset-free LOFT (family D) and
// PIPE-SHELL (family F) on OCCT TopoDS types.
//
// Read include/forge/native/brep/NativeLoftPipe.hpp first: it carries the scope,
// the complete HONEST-DEFER list, the drop hygiene and the gate. This file
// carries the derivations.
//
// ===========================================================================
// PART 1 — why the lateral quad must be PLANAR (family D and F both)
// ===========================================================================
// The ruled surface OCCT's BRepFill_Generator lays between two straight edges
// A_i A_i+1 and B_i B_i+1 is the BILINEAR patch
//     S(u,v) = (1-v)[(1-u)A_i + u A_i+1] + v[(1-u)B_i + u B_i+1].
// Its contribution to the enclosed volume, by the divergence theorem, is
//     (1/3) ∮ S · (S_u × S_v) du dv,
// which for a bilinear patch evaluates to the MEAN of the two triangulations
// (split on A_i B_i+1 versus A_i+1 B_i). Those two triangulations differ from
// each other whenever the four corners are non-coplanar, so a triangulated
// answer is NOT the ruled answer — it is off by half the diagonal defect. This
// engine therefore refuses the non-planar quad rather than approximate it:
// coplanar within `tol` and it is a single exact planar face; otherwise a null
// TopoDS_Shape (honest defer). Every shape this engine DOES build is exact.
//
// The planar-quad family is not a toy: it is exactly the set of section pairs
// related by a translation and/or a homothety about a common axis — prisms,
// frustums, pyramids, wedges, tapered bosses — which is what CAD loft trees
// actually contain.
//
// ===========================================================================
// PART 2 — the ruled=false (SMOOTHED) case
// ===========================================================================
// MEASURED on OCCT 7.9 (this machine, 2026-08-28): for exactly TWO sections the
// smoothed skin and the ruled skin are the SAME surface —
//     BRepOffsetAPI_ThruSections(solid=1, ruled=0) over the 20-square at z=0 and
//     the 10-square at z=12 gives vol=2800, com=(0,0,4.714285714), F/E/V/S=6/12/8/1,
//     byte-identical to the ruled build.
// There is nothing to smooth in v with two sections. With THREE OR MORE the
// smoothed build interpolates a B-spline through the sections and is a genuinely
// different surface from the piecewise-ruled one (the 3-section ruled build
// measures 3178.666667, the prismatoid sum 2336 + 842.667 — a smoothed skin does
// not equal that sum). So: ruled=false is accepted ONLY for N == 2, and is an
// honest defer for N >= 3. The A/B asserts the N==2 identity directly rather
// than assuming it.
//
// ===========================================================================
// PART 3 — family F, and the measured fact that OCCT is not an oracle on a bend
// ===========================================================================
// MEASURED on OCCT 7.9 (this machine, 2026-08-28), profile = the 10x10 square
// centred on the origin in z=0:
//
//   spine (0,0,0)->(0,0,30)            vol=3000  F/E/V/S=6/12/8/1  VALID
//   spine (50,0,0)->(50,0,30)          vol=3000  bb=(-5,-5,0)-(5,5,30)  VALID
//   spine (0,0,0)->(40,0,0), prof ⟂    vol=4000  F/E/V/S=6/12/8/1  VALID
//   spine (0,0,0)->(0,0,30)->(20,0,30) vol=2400  F/E/V/S=10/20/12/1  **INVALID**
//
// Two things follow, and both are load-bearing:
//
//  (a) THE SWEEP LAW IS PURE TRANSLATION BY THE SPINE DISPLACEMENT. Moving the
//      spine 50 mm away in x left the result in exactly the same place —
//      BRepOffsetAPI_MakePipeShell does NOT relocate the profile onto the spine;
//      it carries it by spine(t) - spine(0). For a single-segment spine that is
//      precisely the prism over the profile face along (end - start), and this
//      engine reproduces it exactly, face for face.
//
//  (b) ON A BENT SPINE OCCT IS NOT A VALID ORACLE. Its own answer fails
//      BRepCheck_Analyzer (valid=0) and its volume, 2400, is not the volume of
//      any mitred elbow with that section: the section area is 100 and the spine
//      is 50 long, so a rigid mitred sweep encloses 5000. This is the same
//      situation reports/TKOFFSET_DECOMPOSITION.md §4.2 measured for
//      MakeThickSolid on a plain box (it returned the cavity with IsDone()==true).
//      So the bent-spine path here is proved against a CLOSED FORM, not against
//      OCCT, and the A/B asserts OCCT's invalidity so the claim is on the record
//      rather than asserted.
//
// THE MITRE, derived. Spine vertices A_0..A_k, unit leg directions d_1..d_k. At
// an interior vertex A_j the transition plane is the one bisecting the incoming
// and outgoing legs: normal n_j = normalize(d_j + d_j+1), through A_j. A section
// point p is carried along d_j until it meets that plane, at
//     t = ((A_j - p) · n_j) / (d_j · n_j),
// which is well defined iff d_j · n_j > 0, i.e. the turn is not a reversal. The
// map p -> p + t(p) d_j is AFFINE in p, so each lateral quad
// (p_i, p_i+1, m_i+1, m_i) lies in span{p_i+1 - p_i, d_j} — PLANAR by
// construction, which is why the mitre is the transition that keeps this engine
// exact. The final section is carried to the plane through A_k with normal d_k.
//
// CLOSED FORM. With the profile plane perpendicular to d_1 and the profile
// centroid ON the spine start, the mitred sweep encloses exactly
//     V = area(profile) * (total spine length),
// because each leg contributes ∫∫ t(p) dA = L_j * area - area * (centroid offset
// along the leg normal), and the centroid offset is zero. That identity is the
// independent oracle the A/B uses.
//
// ===========================================================================
// DROP HYGIENE — see the header. No BRepOffset*, BRepOffsetAPI*, BRepFill* or
// GeomFill_* symbol appears below; test/run_ab_native_loftpipe.sh asserts it on
// this file's own object file.

#ifdef FORGE_NATIVE_BREP

#include "forge/native/brep/NativeLoftPipe.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdlib>
#include <vector>

#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include "forge/OcctPrimBuilder.hpp"  // TKPrim-free analytic cylinder
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Type.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include "forge/native/brep/NativeShapeHeal.hpp"  // occtheal::solidFromShell

namespace forge {
namespace occtloft {
namespace {

const TopoDS_Shape kNull;

// ---------------------------------------------------------------- geometry
gp_Vec vec(const gp_Pnt& a, const gp_Pnt& b) { return gp_Vec(a, b); }

// Newell normal of an ordered ring — robust for any planar polygon, and its
// magnitude is twice the polygon's area.
gp_Vec newell(const std::vector<gp_Pnt>& r) {
    double nx = 0.0, ny = 0.0, nz = 0.0;
    const std::size_t n = r.size();
    for (std::size_t i = 0; i < n; ++i) {
        const gp_Pnt& a = r[i];
        const gp_Pnt& b = r[(i + 1) % n];
        nx += (a.Y() - b.Y()) * (a.Z() + b.Z());
        ny += (a.Z() - b.Z()) * (a.X() + b.X());
        nz += (a.X() - b.X()) * (a.Y() + b.Y());
    }
    return gp_Vec(0.5 * nx, 0.5 * ny, 0.5 * nz);
}

// True iff every point of `r` lies within `tol` of the plane through r[0] with
// the Newell normal. `area2` returns the Newell magnitude (== the area).
bool ringPlanar(const std::vector<gp_Pnt>& r, double tol, double& area) {
    if (r.size() < 3) return false;
    const gp_Vec nv = newell(r);
    area = nv.Magnitude();
    if (area <= tol * tol) return false;              // degenerate ring
    const gp_Vec u = nv / area;                       // unit normal
    for (const gp_Pnt& p : r) {
        if (std::fabs(vec(r[0], p).Dot(u)) > tol) return false;
    }
    return true;
}

bool quadPlanar(const gp_Pnt& a, const gp_Pnt& b, const gp_Pnt& c,
                const gp_Pnt& d, double tol) {
    const std::vector<gp_Pnt> q{a, b, c, d};
    double area = 0.0;
    return ringPlanar(q, tol, area);
}

// ---------------------------------------------------------------- extraction
// Unwrap Geom_TrimmedCurve and report whether the edge's support is a LINE.
bool isLineEdge(const TopoDS_Edge& e) {
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) c = BRep_Tool::Curve(e, f, l);
    while (!c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_TrimmedCurve))) {
        c = Handle(Geom_TrimmedCurve)::DownCast(c)->BasisCurve();
    }
    return !c.IsNull() && c->IsKind(STANDARD_TYPE(Geom_Line));
}

// Ordered vertex ring of a CLOSED polygon wire (every edge a line segment).
// Consecutive duplicate points are collapsed. Returns false on any non-line
// edge, an open wire, or fewer than three distinct points — all honest defers.
bool polygonRing(const TopoDS_Wire& w, std::vector<gp_Pnt>& out, double tol) {
    out.clear();
    if (w.IsNull()) return false;
    int nEdge = 0;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (!isLineEdge(e)) return false;
        ++nEdge;
        const gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (out.empty() || p.Distance(out.back()) > tol) out.push_back(p);
    }
    if (nEdge < 3 || out.size() < 3) return false;
    // Closed? BRepTools_WireExplorer emits each edge's FIRST vertex, so a closed
    // wire's ring is already complete; an OPEN wire's last edge contributes its
    // start only and the ring would silently lose the free end. Reject openness
    // explicitly rather than infer it.
    if (!BRep_Tool::IsClosed(w)) return false;
    if (out.front().Distance(out.back()) <= tol) out.pop_back();
    return out.size() >= 3;
}

// The outer polygon ring of a profile given as a WIRE or a FACE.
bool profileRing(const TopoDS_Shape& s, std::vector<gp_Pnt>& out, double tol) {
    if (s.IsNull()) return false;
    if (s.ShapeType() == TopAbs_WIRE) return polygonRing(TopoDS::Wire(s), out, tol);
    if (s.ShapeType() == TopAbs_FACE) {
        int nw = 0;
        TopoDS_Wire outer;
        for (TopExp_Explorer ex(s, TopAbs_WIRE); ex.More(); ex.Next()) {
            outer = TopoDS::Wire(ex.Current());
            ++nw;
        }
        if (nw != 1) return false;   // a face with a hole needs a real 2-D trim
        return polygonRing(outer, out, tol);
    }
    return false;
}

// ---------------------------------------------------------------- assembly
bool addPolyFace(BRepBuilderAPI_Sewing& sew, const std::vector<gp_Pnt>& r) {
    BRepBuilderAPI_MakePolygon poly;
    for (const gp_Pnt& p : r) poly.Add(p);
    poly.Close();
    if (!poly.IsDone()) return false;
    BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
    if (!mkf.IsDone()) return false;
    sew.Add(mkf.Face());
    return true;
}

bool addQuad(BRepBuilderAPI_Sewing& sew, const gp_Pnt& a, const gp_Pnt& b,
             const gp_Pnt& c, const gp_Pnt& d, double tol) {
    if (!quadPlanar(a, b, c, d, tol)) return false;
    return addPolyFace(sew, std::vector<gp_Pnt>{a, b, c, d});
}

bool addTri(BRepBuilderAPI_Sewing& sew, const gp_Pnt& a, const gp_Pnt& b,
            const gp_Pnt& c, double tol) {
    const std::vector<gp_Pnt> t{a, b, c};
    double area = 0.0;
    if (!ringPlanar(t, tol, area)) return false;   // rejects a degenerate sliver
    return addPolyFace(sew, t);
}

// Sew, then either return the open SHELL (solid == false, matching OCCT's
// ThruSections(isSolid=false)) or close it into a positive-volume SOLID.
TopoDS_Shape sewAndClose(BRepBuilderAPI_Sewing& sew, bool solid) {
    sew.Perform();
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) return kNull;

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) return kNull;

    if (!solid) {
        // An open skin is the deliverable here; free edges are its rim, not a
        // fault. Only the "one connected shell" invariant is asserted.
        return shell;
    }
    if (sew.NbFreeEdges() != 0) return kNull;      // not watertight -> defer

    const TopoDS_Solid sol = forge::occtheal::solidFromShell(shell);
    if (sol.IsNull()) return kNull;
    GProp_GProps props;
    BRepGProp::VolumeProperties(sol, props);
    if (std::fabs(props.Mass()) < 1.0e-12) return kNull;
    return sol;   // solidFromShell already oriented it to positive volume
}

// ---------------------------------------------------------------- sections
struct Section {
    std::vector<gp_Pnt> ring;   // size 1 == a point section (AddVertex)
    bool isPoint = false;
};

bool envOn(const char* name) {
    const char* v = std::getenv(name);
    return v && (*v == '1' || *v == 'y' || *v == 'Y' || *v == 't' || *v == 'T');
}

}  // namespace

// =========================================================== routing
bool loftNativeEnabled() {
#ifdef FORGE_THRUSECTIONS_DROP_NATIVE
    return true;   // the OCCT fallback is compiled out; this is the only path
#else
    static const bool on = envOn("FORGE_LOFT_NATIVE");
    return on;
#endif
}

bool pipeShellNativeEnabled() {
#ifdef FORGE_PIPESHELL_DROP_NATIVE
    return true;
#else
    static const bool on = envOn("FORGE_PIPESHELL_NATIVE");
    return on;
#endif
}

// =========================================================== family D
TopoDS_Shape thruSections(const std::vector<TopoDS_Shape>& sections,
                          bool solid, bool ruled, double tol) {
    if (sections.size() < 2) return kNull;
    const double t = std::max(tol, 1.0e-9);

    // ruled == false is only the same surface as ruled == true for TWO sections
    // (PART 2). Three or more smoothed sections is a different skin: defer.
    if (!ruled && sections.size() != 2) return kNull;

    std::vector<Section> sec;
    sec.reserve(sections.size());
    for (std::size_t k = 0; k < sections.size(); ++k) {
        const TopoDS_Shape& s = sections[k];
        Section cur;
        if (!s.IsNull() && s.ShapeType() == TopAbs_VERTEX) {
            // A point section is only meaningful as an apex at an end.
            if (k != 0 && k + 1 != sections.size()) return kNull;
            cur.isPoint = true;
            cur.ring.push_back(BRep_Tool::Pnt(TopoDS::Vertex(s)));
        } else if (!s.IsNull() && s.ShapeType() == TopAbs_WIRE) {
            if (!polygonRing(TopoDS::Wire(s), cur.ring, t)) return kNull;
        } else {
            return kNull;
        }
        sec.push_back(std::move(cur));
    }

    // Two adjacent point sections have no lateral surface at all.
    for (std::size_t k = 0; k + 1 < sec.size(); ++k) {
        if (sec[k].isPoint && sec[k + 1].isPoint) return kNull;
    }

    // Every polygon section must carry the SAME vertex count: correspondence is
    // by wire-explorer index, exactly as BRepFill_Generator pairs them. OCCT
    // auto-reparametrises mismatched sections; this engine does NOT and says so.
    std::size_t n = 0;
    for (const Section& s : sec) {
        if (s.isPoint) continue;
        if (n == 0) n = s.ring.size();
        else if (s.ring.size() != n) return kNull;
    }
    if (n < 3) return kNull;

    BRepBuilderAPI_Sewing sew(std::max(t, 1.0e-6));

    for (std::size_t k = 0; k + 1 < sec.size(); ++k) {
        const Section& A = sec[k];
        const Section& B = sec[k + 1];
        if (A.isPoint) {
            const gp_Pnt& apex = A.ring[0];
            for (std::size_t i = 0; i < n; ++i) {
                if (!addTri(sew, apex, B.ring[(i + 1) % n], B.ring[i], t)) return kNull;
            }
        } else if (B.isPoint) {
            const gp_Pnt& apex = B.ring[0];
            for (std::size_t i = 0; i < n; ++i) {
                if (!addTri(sew, A.ring[i], A.ring[(i + 1) % n], apex, t)) return kNull;
            }
        } else {
            for (std::size_t i = 0; i < n; ++i) {
                const std::size_t j = (i + 1) % n;
                if (!addQuad(sew, A.ring[i], A.ring[j], B.ring[j], B.ring[i], t))
                    return kNull;
            }
        }
    }

    if (solid) {
        for (std::size_t k : {std::size_t(0), sec.size() - 1}) {
            if (sec[k].isPoint) continue;             // an apex needs no cap
            double area = 0.0;
            if (!ringPlanar(sec[k].ring, t, area)) return kNull;
            if (!addPolyFace(sew, sec[k].ring)) return kNull;
        }
    }

    return sewAndClose(sew, solid);
}

// =========================================================== family F
namespace {

// ---------------------------------------------------------------- spine
// The shared POLYLINE-SPINE parser for families E and F. On success `node` holds
// the ordered spine vertices (consecutive duplicates collapsed, the free end
// appended) and `leg` the unit direction of each segment. A closed spine, a
// curved edge, or a zero-length spine is an HONEST DEFER (false).
bool spinePolyline(const TopoDS_Wire& spine, double t,
                   std::vector<gp_Pnt>& node, std::vector<gp_Dir>& leg) {
    node.clear();
    leg.clear();
    if (spine.IsNull()) return false;
    if (BRep_Tool::IsClosed(spine)) return false;     // a closed spine has no ends
    for (BRepTools_WireExplorer ex(spine); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (!isLineEdge(e)) return false;
        const gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (node.empty() || p.Distance(node.back()) > t) node.push_back(p);
    }
    // BRepTools_WireExplorer yields each edge's FIRST vertex, so the spine's own
    // end point is ALWAYS still missing — including for a single-segment spine,
    // where `node` holds exactly one point here. Append it before any size test.
    if (node.empty()) return false;
    {
        int nEdge = 0;
        TopoDS_Edge last;
        for (TopExp_Explorer ex(spine, TopAbs_EDGE); ex.More(); ex.Next()) {
            last = TopoDS::Edge(ex.Current());
            ++nEdge;
        }
        if (nEdge == 0) return false;
        gp_Pnt best;
        double bestD = -1.0;
        for (TopExp_Explorer vx(last, TopAbs_VERTEX); vx.More(); vx.Next()) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
            const double d = p.Distance(node.back());
            if (d > bestD) { bestD = d; best = p; }
        }
        if (bestD <= t) return false;
        node.push_back(best);
    }
    for (std::size_t j = 0; j + 1 < node.size(); ++j) {
        const gp_Vec d = vec(node[j], node[j + 1]);
        if (d.Magnitude() <= t) return false;
        leg.push_back(gp_Dir(d));
    }
    return !leg.empty();
}

// ---------------------------------------------------------------- transport
// THE MITRE / ROTATION-MINIMIZING TRANSPORT — the shared core of families E and
// F. `node`/`leg` come from spinePolyline, `ring` is the ordered section.
//
// METHOD, NAMED: this is the DOUBLE-REFLECTION rotation-minimizing frame of
// Wang, Juttler, Zheng & Liu, "Computation of Rotation Minimizing Frames",
// ACM TOG 27(1), 2008, specialised to a polyline spine. Double reflection
// transports the frame from x_j to x_j+1 by reflecting it in two planes; for a
// polyline the two reflections compose to a SINGLE reflection in the plane that
// bisects the incoming and outgoing legs — the MITRE plane, normal
// n_j = normalize(d_j + d_j+1) through A_j. So on a polyline the mitre IS the
// RMF, and it is exact rather than sampled: no Frenet frame is formed anywhere,
// which matters because the Frenet normal is undefined on a straight leg (zero
// curvature) and flips through an inflection.
//
// A section point p is carried along d_j until it meets that plane, at
//     s = ((A_j+1 - p) . n_j) / (d_j . n_j),
// well defined iff d_j . n_j > 0 (the turn is not a reversal). The map
// p -> p + s(p) d_j is AFFINE in p, so each lateral quad
// (p_i, p_i+1, m_i+1, m_i) lies in span{p_i+1 - p_i, d_j} — PLANAR by
// construction, which is what keeps this engine exact.
TopoDS_Shape sweepPolygonMitre(const std::vector<gp_Pnt>& node,
                               const std::vector<gp_Dir>& leg,
                               const std::vector<gp_Pnt>& ring,
                               bool makeSolid, double t) {
    const std::size_t n = ring.size();
    BRepBuilderAPI_Sewing sew(std::max(t, 1.0e-6));

    // Carry the ring leg by leg. `cur` is the section at the start of leg j.
    std::vector<gp_Pnt> cur = ring;
    const std::vector<gp_Pnt> startRing = ring;

    for (std::size_t j = 0; j < leg.size(); ++j) {
        std::vector<gp_Pnt> nxt(n);
        if (j + 1 < leg.size()) {
            // Interior node: carry to the MITRE plane at node[j+1].
            const gp_Vec nvv = gp_Vec(leg[j]) + gp_Vec(leg[j + 1]);
            if (nvv.Magnitude() <= 1.0e-12) return kNull;   // 180-degree reversal
            const gp_Dir mn(nvv);
            const double denom = gp_Vec(leg[j]).Dot(gp_Vec(mn));
            if (denom <= 1.0e-12) return kNull;
            for (std::size_t i = 0; i < n; ++i) {
                const double s = vec(cur[i], node[j + 1]).Dot(gp_Vec(mn)) / denom;
                nxt[i] = cur[i].Translated(s * gp_Vec(leg[j]));
            }
        } else {
            // Final leg: carry to the plane through the spine end, normal d_j.
            // For a SINGLE-segment spine this is exactly the translation by the
            // spine displacement that OCCT was measured to apply (PART 3a).
            for (std::size_t i = 0; i < n; ++i) {
                const double s = vec(cur[i], node[j + 1]).Dot(gp_Vec(leg[j]));
                nxt[i] = cur[i].Translated(s * gp_Vec(leg[j]));
            }
        }
        for (std::size_t i = 0; i < n; ++i) {
            const std::size_t k = (i + 1) % n;
            if (!addQuad(sew, cur[i], cur[k], nxt[k], nxt[i], t)) return kNull;
        }
        cur = nxt;
    }

    if (makeSolid) {
        double a0 = 0.0, a1 = 0.0;
        if (!ringPlanar(startRing, t, a0)) return kNull;
        if (!ringPlanar(cur, t, a1)) return kNull;
        if (!addPolyFace(sew, startRing)) return kNull;
        if (!addPolyFace(sew, cur)) return kNull;
    }

    return sewAndClose(sew, makeSolid);
}

// Shared front half of families E and F for a POLYGON profile: parse the spine,
// extract and validate the section, enforce the perpendicularity precondition,
// then transport. Returns kNull on any defer.
TopoDS_Shape sweepPolygonProfile(const TopoDS_Wire& spine,
                                 const TopoDS_Shape& profile,
                                 bool makeSolid, double t) {
    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;

    std::vector<gp_Pnt> ring;
    if (!profileRing(profile, ring, t)) return kNull;
    double area = 0.0;
    if (!ringPlanar(ring, t, area)) return kNull;

    // A multi-segment spine needs the profile plane PERPENDICULAR to the first
    // leg, otherwise the mitre map is not the rigid transport this engine
    // derives and the answer would be a guess.
    if (leg.size() > 1) {
        const gp_Dir pn(newell(ring));
        if (std::fabs(std::fabs(pn.Dot(leg[0])) - 1.0) > 1.0e-9) return kNull;
    }
    return sweepPolygonMitre(node, leg, ring, makeSolid, t);
}

}  // namespace

TopoDS_Shape pipeShell(const TopoDS_Wire& spine,
                       const TopoDS_Shape& profile,
                       const std::vector<TopoDS_Wire>& guides,
                       bool makeSolid, double tol) {
    // There is no native guided pipe-shell anywhere in the tree. Say so.
    if (!guides.empty()) return kNull;
    return sweepPolygonProfile(spine, profile, makeSolid, std::max(tol, 1.0e-9));
}

// =========================================================== family E
//
// BRepOffsetAPI_MakePipe(spine, profileFace) — sweep a FACE along a spine and
// return the SOLID.
//
// ── WHAT OCCT ACTUALLY DOES HERE, MEASURED 2026-08-28 (probe in the A/B) ─────
// MakePipe is a TRUSTWORTHY ORACLE ON A SINGLE-SEGMENT SPINE ONLY. Measured on
// a 10x10 square profile and a 4-radius circle:
//     spine                       OCCT volume     closed form     OCCT valid
//     (0,0,0)->(0,0,25)              2500            2500             1
//     circle, ->(0,0,30)          1507.96447      1507.96447          1
//     (0,0,0)->(0,0,25)->(30,0,25)   2500            5500             0   <-- INVALID
//     3-leg Z spine                  2000            5500             0   <-- INVALID
//     circle, 2-leg L spine       1256.63706      2764.60154          1   <-- WRONG VOLUME
// On every BENT polyline spine OCCT either fails BRepCheck_Analyzer outright or
// returns a shape whose volume is only the FIRST leg's contribution
// (2500 = 100*25, 2000 = 100*20, 1256.637 = pi*16*25) while its bounding box
// spans the whole spine. So the bent-spine path here is proved against a CLOSED
// FORM, and the A/B ASSERTS OCCT's invalidity / volume error so the claim is on
// the record rather than merely asserted. This is the same situation the prior
// wave measured for MakePipeShell and reports/TKOFFSET_DECOMPOSITION.md §4.2
// measured for MakeThickSolid.
//
// ── THE TWO PROFILE KINDS ───────────────────────────────────────────────────
// POLYGON: the mitre / double-reflection RMF transport above, shared with
//   family F. Exact for any number of legs.
// CIRCLE: a chain of mitre-trimmed right circular cylinders. Needed because
//   forge::part::pipeFromPolyline feeds a CIRCLE profile, so a polygon-only
//   engine would leave that entry point permanently deferring — i.e. dead under
//   the drop. Each leg is a Geom_CylindricalSurface cylinder cut by the two
//   station half-spaces (start cap plane, interior MITRE planes, end cap plane)
//   and the legs are fused. Every surface stays ANALYTIC: no tessellation, no
//   spline fitting, no polygonal approximation of the circle anywhere.
//
// CLOSED FORM. With the profile plane perpendicular to the first leg and the
// section centroid ON the spine, the mitred sweep encloses exactly
//     V = area(profile) * (total spine length),
// for BOTH profile kinds. That identity is the independent oracle.
//
// DROP HYGIENE. TKPrim (MakeCylinder / MakeHalfSpace) and TKBO/TKBool
// (Common / Fuse) are used here. Both are ALREADY in the load closure and are
// already called directly by the binary; neither is TKOffset. The A/B asserts
// this file's object imports ZERO TKOffset symbols.

namespace {

// A CIRCULAR profile: one wire, one edge, a Geom_Circle. Reports its centre,
// axis and radius. Anything else is not this kind (false, not an error).
bool circleProfile(const TopoDS_Shape& s, gp_Pnt& c, gp_Dir& ax, double& r) {
    if (s.IsNull()) return false;
    TopoDS_Wire w;
    if (s.ShapeType() == TopAbs_WIRE) {
        w = TopoDS::Wire(s);
    } else if (s.ShapeType() == TopAbs_FACE) {
        int nw = 0;
        for (TopExp_Explorer ex(s, TopAbs_WIRE); ex.More(); ex.Next()) {
            w = TopoDS::Wire(ex.Current());
            ++nw;
        }
        if (nw != 1) return false;      // a face with a hole is not this kind
    } else {
        return false;
    }
    if (w.IsNull()) return false;
    int ne = 0;
    TopoDS_Edge e;
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
        e = TopoDS::Edge(ex.Current());
        ++ne;
    }
    if (ne != 1) return false;
    Standard_Real f = 0.0, l = 0.0;
    Handle(Geom_Curve) cv = BRep_Tool::Curve(e, f, l);
    while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve))) {
        cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
    }
    if (cv.IsNull() || !cv->IsKind(STANDARD_TYPE(Geom_Circle))) return false;
    const gp_Circ ci = Handle(Geom_Circle)::DownCast(cv)->Circ();
    c = ci.Location();
    ax = ci.Axis().Direction();
    r = ci.Radius();
    return r > 0.0;
}

// A BOUNDED stand-in for the closed half-space bounded by the plane (q, n) that
// contains `inside`, sized to swallow `bounds` completely on the material side.
//
// TKPrim IS NOT ON THE LINK LINE (removed 2026-08-07), so BRepPrimAPI_MakeHalfSpace
// left this translation unit with two undefined symbols and the dylib did not link.
// The ONLY consumer intersects the result with a BOUNDED shape --
// BRepAlgoAPI_Common(piece, h) -- and for a bounded operand a box that strictly
// contains that operand on the inside of the plane gives an IDENTICAL result to a
// true half-space. So this is exact for the use, not an approximation of it, and the
// `bounds` argument is what makes that guarantee checkable rather than assumed.
TopoDS_Shape halfSpaceThrough(const gp_Pnt& q, const gp_Dir& n,
                              const gp_Pnt& inside, const TopoDS_Shape& bounds) {
    Bnd_Box bb;
    BRepBndLib::Add(bounds, bb);
    if (bb.IsVoid()) return kNull;
    Standard_Real xa, ya, za, xb, yb, zb;
    bb.Get(xa, ya, za, xb, yb, zb);
    const gp_Pnt lo(xa, ya, za), hi(xb, yb, zb);
    const double diag = lo.Distance(hi);
    if (!(diag > 0.0)) return kNull;
    // Four diagonals of slack in every direction: the slab is far larger than the
    // operand in-plane, and reaches far past it along the normal.
    const double half = 4.0 * diag;

    // Orient the normal so the slab grows TOWARDS `inside`.
    gp_Dir nn = n;
    if (gp_Vec(q, inside).Dot(gp_Vec(nn)) < 0.0) nn.Reverse();

    // Centre the square face on the operand's centre projected onto the plane, so
    // the slack is spent around the operand rather than around `q`.
    const gp_Pnt c((xa + xb) * 0.5, (ya + yb) * 0.5, (za + zb) * 0.5);
    const gp_Vec qc(q, c);
    const gp_Pnt cp = q.Translated(qc - gp_Vec(nn) * qc.Dot(gp_Vec(nn)));

    const gp_Ax2 ax(cp, nn);
    const gp_Dir u = ax.XDirection(), v = ax.YDirection();
    BRepBuilderAPI_MakePolygon poly;
    poly.Add(cp.Translated(-half * gp_Vec(u) - half * gp_Vec(v)));
    poly.Add(cp.Translated(half * gp_Vec(u) - half * gp_Vec(v)));
    poly.Add(cp.Translated(half * gp_Vec(u) + half * gp_Vec(v)));
    poly.Add(cp.Translated(-half * gp_Vec(u) + half * gp_Vec(v)));
    poly.Close();
    if (!poly.IsDone()) return kNull;
    BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
    if (!mkf.IsDone()) return kNull;

    // occtPrism is the in-house TKPrim-free linear sweep.
    try {
        return ::forge::occtPrism(mkf.Face(), gp_Vec(nn) * (2.0 * half));
    } catch (const std::exception&) {
        return kNull;
    }
}

// The mitre-trimmed cylinder chain (family E, CIRCLE profile).
TopoDS_Shape pipeCircleMitre(const std::vector<gp_Pnt>& node,
                             const std::vector<gp_Dir>& leg,
                             const gp_Pnt& c0, const gp_Dir& ax0, double r,
                             double t) {
    // Preconditions, mirroring the polygon path: the section plane is
    // perpendicular to the first leg and its centre sits ON the spine start.
    // Without both, the mitre map is not the rigid transport derived above.
    if (std::fabs(std::fabs(gp_Vec(ax0).Dot(gp_Vec(leg[0]))) - 1.0) > 1.0e-9) return kNull;
    if (c0.Distance(node[0]) > std::max(t, 1.0e-9)) return kNull;

    const std::size_t k = leg.size();

    // ---- station planes: 0 = start cap, 1..k-1 = MITRE, k = end cap --------
    std::vector<gp_Dir> sn;   // station normal, oriented along the travel sense
    sn.reserve(k + 1);
    sn.push_back(leg[0]);
    for (std::size_t j = 1; j < k; ++j) {
        const gp_Vec b = gp_Vec(leg[j - 1]) + gp_Vec(leg[j]);
        if (b.Magnitude() <= 1.0e-12) return kNull;          // 180-degree reversal
        const gp_Dir mn(b);
        if (gp_Vec(leg[j - 1]).Dot(gp_Vec(mn)) <= 1.0e-12) return kNull;
        sn.push_back(mn);
    }
    sn.push_back(leg[k - 1]);

    // ---- one trimmed cylinder per leg -------------------------------------
    TopoDS_Shape acc;
    for (std::size_t j = 0; j < k; ++j) {
        // Axial margin needed so the raw cylinder fully spans each oblique cut:
        // the plane's extreme axial excursion over a circle of radius r is
        // r*tan(theta), theta the angle between the leg and the station normal.
        auto margin = [&](std::size_t st) -> double {
            const double m = std::fabs(gp_Vec(leg[j]).Dot(gp_Vec(sn[st])));
            if (m <= 1.0e-9) return -1.0;                    // grazing — defer
            return r * std::sqrt(std::max(0.0, 1.0 - m * m)) / m;
        };
        const double m0 = margin(j), m1 = margin(j + 1);
        if (m0 < 0.0 || m1 < 0.0) return kNull;
        const double pad = 1.0e-6 + 1.0e-6 * r;
        const double len = node[j].Distance(node[j + 1]) + m0 + m1 + 2.0 * pad;
        const gp_Pnt base = node[j].Translated(-(m0 + pad) * gp_Vec(leg[j]));

        // TKPrim-free: occtCylinderSolid is the in-house analytic cylinder and
        // references no BRepPrimAPI symbol. TKPrim is not on the link line.
        TopoDS_Shape piece;
        try {
            piece = ::forge::occtCylinderSolid(gp_Ax2(base, leg[j]), r, len);
        } catch (const std::exception&) {
            return kNull;
        }
        if (piece.IsNull()) return kNull;

        // Trim to the two station planes. The material side is the one holding
        // the leg midpoint, which is interior to this leg by construction.
        const gp_Pnt mid((node[j].X() + node[j + 1].X()) * 0.5,
                         (node[j].Y() + node[j + 1].Y()) * 0.5,
                         (node[j].Z() + node[j + 1].Z()) * 0.5);
        for (std::size_t st : {j, j + 1}) {
            const TopoDS_Shape h = halfSpaceThrough(node[st], sn[st], mid, piece);
            if (h.IsNull()) return kNull;
            BRepAlgoAPI_Common cut(piece, h);
            cut.Build();
            if (!cut.IsDone()) return kNull;
            piece = cut.Shape();
            if (piece.IsNull()) return kNull;
        }
        if (acc.IsNull()) {
            acc = piece;
        } else {
            BRepAlgoAPI_Fuse fu(acc, piece);
            fu.Build();
            if (!fu.IsDone()) return kNull;
            acc = fu.Shape();
            if (acc.IsNull()) return kNull;
        }
    }
    if (acc.IsNull()) return kNull;

    // The legs meet exactly on their shared mitre plane, so the fuse leaves a
    // seam face pair; unify it away so the answer carries the same face count a
    // one-piece sweep would. A failure here is a defer, never a shipped seam.
    ShapeUpgrade_UnifySameDomain uni(acc, Standard_True, Standard_True, Standard_True);
    uni.Build();
    const TopoDS_Shape out = uni.Shape();
    if (out.IsNull()) return kNull;

    GProp_GProps props;
    BRepGProp::VolumeProperties(out, props);
    if (props.Mass() <= 1.0e-12) return kNull;
    return out;
}

}  // namespace

bool pipeNativeEnabled() {
#ifdef FORGE_PIPE_DROP_NATIVE
    return true;   // the OCCT fallback is compiled out; this is the only path
#else
    static const bool on = envOn("FORGE_PIPE_NATIVE");
    return on;
#endif
}

TopoDS_Shape pipe(const TopoDS_Wire& spine, const TopoDS_Shape& profile,
                  double tol) {
    const double t = std::max(tol, 1.0e-9);

    // POLYGON profile — the proven mitre transport, always a SOLID (MakePipe
    // fed a FACE returns a solid).
    const TopoDS_Shape poly = sweepPolygonProfile(spine, profile, /*makeSolid*/ true, t);
    if (!poly.IsNull()) return poly;

    // CIRCLE profile — the mitre-trimmed cylinder chain.
    gp_Pnt c0;
    gp_Dir ax0;
    double r = 0.0;
    if (!circleProfile(profile, c0, ax0, r)) return kNull;
    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;
    return pipeCircleMitre(node, leg, c0, ax0, r, t);
}

}  // namespace occtloft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
