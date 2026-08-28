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

#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepGProp.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <Standard_Type.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Vertex.hxx>
#include <gp_Dir.hxx>
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
TopoDS_Shape pipeShell(const TopoDS_Wire& spine,
                       const TopoDS_Shape& profile,
                       const std::vector<TopoDS_Wire>& guides,
                       bool makeSolid, double tol) {
    // There is no native guided pipe-shell anywhere in the tree. Say so.
    if (!guides.empty()) return kNull;
    const double t = std::max(tol, 1.0e-9);

    // ---- spine: an OPEN polyline of line segments -> ordered vertices ----
    if (spine.IsNull()) return kNull;
    if (BRep_Tool::IsClosed(spine)) return kNull;     // a closed spine has no ends
    std::vector<gp_Pnt> node;
    TopoDS_Vertex lastV;
    for (BRepTools_WireExplorer ex(spine); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (!isLineEdge(e)) return kNull;
        const gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (node.empty() || p.Distance(node.back()) > t) node.push_back(p);
        lastV = ex.CurrentVertex();
    }
    // BRepTools_WireExplorer yields each edge's FIRST vertex, so the spine's own
    // end point is ALWAYS still missing — including for a single-segment spine,
    // where `node` holds exactly one point at this line. Append it before any
    // size test.
    if (node.empty()) return kNull;
    {
        TopoDS_Vertex v1, v2;
        int nEdge = 0;
        TopoDS_Edge last;
        for (TopExp_Explorer ex(spine, TopAbs_EDGE); ex.More(); ex.Next()) {
            last = TopoDS::Edge(ex.Current());
            ++nEdge;
        }
        if (nEdge == 0) return kNull;
        TopExp_Explorer vx(last, TopAbs_VERTEX);
        gp_Pnt best;
        double bestD = -1.0;
        for (; vx.More(); vx.Next()) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
            const double d = p.Distance(node.back());
            if (d > bestD) { bestD = d; best = p; }
        }
        if (bestD <= t) return kNull;
        node.push_back(best);
        (void)lastV;
    }
    const std::size_t nNode = node.size();

    std::vector<gp_Dir> leg;
    leg.reserve(nNode - 1);
    for (std::size_t j = 0; j + 1 < nNode; ++j) {
        gp_Vec d = vec(node[j], node[j + 1]);
        if (d.Magnitude() <= t) return kNull;
        leg.push_back(gp_Dir(d));
    }

    // ---- profile: a closed planar polygon ----
    std::vector<gp_Pnt> ring;
    if (!profileRing(profile, ring, t)) return kNull;
    double area = 0.0;
    if (!ringPlanar(ring, t, area)) return kNull;
    const std::size_t n = ring.size();

    // A multi-segment spine needs the profile plane PERPENDICULAR to the first
    // leg, otherwise the mitre map is not the rigid transport this engine
    // derives (PART 3) and the answer would be a guess.
    if (leg.size() > 1) {
        const gp_Vec nv = newell(ring);
        const gp_Dir pn(nv);
        if (std::fabs(std::fabs(pn.Dot(leg[0])) - 1.0) > 1.0e-9) return kNull;
    }

    BRepBuilderAPI_Sewing sew(std::max(t, 1.0e-6));

    // Carry the ring leg by leg. `cur` is the section at the start of leg j.
    std::vector<gp_Pnt> cur = ring;
    const std::vector<gp_Pnt> startRing = ring;

    for (std::size_t j = 0; j < leg.size(); ++j) {
        std::vector<gp_Pnt> nxt(n);
        if (j + 1 < leg.size()) {
            // Interior node: carry to the MITRE plane at node[j+1].
            gp_Vec nvv = gp_Vec(leg[j]) + gp_Vec(leg[j + 1]);
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

}  // namespace occtloft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
