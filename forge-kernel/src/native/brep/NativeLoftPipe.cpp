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
#include <cstdio>
#include <cstring>
#include <vector>

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include "forge/OcctPrimBuilder.hpp"  // TKPrim-free analytic cylinder
#include <Bnd_Box.hxx>
#include <BRepBndLib.hxx>
#include <BRepTools_WireExplorer.hxx>
#include <BRep_Tool.hxx>
#include <GProp_GProps.hxx>
#include <Geom_Circle.hxx>
#include <Standard_Type.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include "forge/native/brep/NativeShapeHeal.hpp"  // occtheal::solidFromShell

namespace forge {
namespace occtloft {
namespace {

const TopoDS_Shape kNull;

// ---------------- DIAGNOSTIC-ONLY DEFER-REASON CHANNEL (behaviour-neutral) ---
// Every FK_DEFER below expands to "record a label, then do EXACTLY what the
// bare `return kNull` / `return false` did". No predicate, no tolerance and no
// branch changes. It exists because the corpus A/B (reports/corpus_ab) measured
// this engine covering 2 of 600 PIPE inputs, and a bare null shape says nothing
// about WHICH precondition declined -- which made the largest deletion bucket
// in the whole drop plan unattributable.
// Samples per edge for the translated-section test below. Five is the smallest
// count that pins a circular arc (endpoints plus three interior points cannot be
// satisfied by a different radius through the same corners) while keeping an
// edge start at a multiple of it under ring reversal.
const int kSamplesPerEdge = 5;

thread_local char g_reason[192] = {0};
void reasonClear() { g_reason[0] = '\0'; }
void reasonAdd(const char* label) {
    const std::size_t n = std::strlen(g_reason);
    // Collapse an immediately repeated label: a face with eleven wires that all
    // fail the same test says the same thing eleven times and then overflows the
    // buffer, hiding the label that actually differs.
    const std::size_t k = std::strlen(label);
    if (n >= k && std::strcmp(g_reason + n - k, label) == 0 &&
        (n == k || g_reason[n - k - 1] == '|')) return;
    if (n + 2 >= sizeof g_reason) return;
    std::snprintf(g_reason + n, sizeof g_reason - n, "%s%s", n ? "|" : "", label);
}
#define FK_DEFER(label)   do { reasonAdd(label); return kNull; } while (0)
#define FK_DEFER_F(label) do { reasonAdd(label); return false; } while (0)

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

// Every lateral quad between two equal-count rings planar within `tol`?
bool allQuadsPlanar(const std::vector<gp_Pnt>& a, const std::vector<gp_Pnt>& b,
                    double tol) {
    const std::size_t n = a.size();
    if (n < 3 || b.size() != n) return false;
    for (std::size_t i = 0; i < n; ++i) {
        const std::size_t j = (i + 1) % n;
        if (!quadPlanar(a[i], a[j], b[j], b[i], tol)) return false;
    }
    return true;
}

// ---------------------------------------------------- ring correspondence
// ★ WHY THIS EXISTS. BRepOffsetAPI_ThruSections does NOT hand its wires to
// BRepFill_Generator in the order they were added: with myWCheck (the ctor
// default, and what CheckCompatibility toggles) it first runs
// BRepFill_CompatibleWires, which REORIENTS each wire to a common sense and
// RE-ORIGINS it before the index pairing happens. This engine implemented the
// pairing and omitted the step before it, so it paired A.ring[i] with B.ring[i]
// by raw BRepTools_WireExplorer index.
//
// That is not a neutral choice. The two outer wires of two OPPOSITE faces of a
// solid wind in OPPOSITE senses in world space, because a face's outer wire is
// CCW about its OUTWARD normal and those two normals oppose. Pairing them by
// raw index therefore twists every lateral quad out of plane, and the engine
// declined its own most common input — MEASURED at 309 of 600 reference solids,
// every one of which has a correspondence under which all four quads are planar.
//
// `canonicalRing` applies the two BRepFill_CompatibleWires steps in their
// principled form and NOTHING ELSE:
//   1. ORIENT — reverse `b` when its Newell normal opposes `a`'s.
//   2. ORIGIN — rotate `b` so its first vertex is the one nearest a[0].
// It is a single deterministic re-indexing, NOT a search over the n rotations
// for one that happens to be planar: the planarity check that follows is still
// the gate, and a ring pair that fails it is still an HONEST DEFER.
void canonicalRing(const std::vector<gp_Pnt>& a, std::vector<gp_Pnt>& b) {
    const std::size_t n = b.size();
    if (a.size() < 3 || n != a.size()) return;
    if (newell(a).Dot(newell(b)) < 0.0) std::reverse(b.begin(), b.end());
    std::size_t best = 0;
    double bestD = -1.0;
    for (std::size_t s = 0; s < n; ++s) {
        const double d = a[0].Distance(b[s]);
        if (bestD < 0.0 || d < bestD) { bestD = d; best = s; }
    }
    if (best != 0) std::rotate(b.begin(), b.begin() + static_cast<long>(best), b.end());
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
    if (w.IsNull()) FK_DEFER_F("prof_wire_null");
    int nEdge = 0;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (!isLineEdge(e)) FK_DEFER_F("prof_edge_not_line");
        ++nEdge;
        const gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (out.empty() || p.Distance(out.back()) > tol) out.push_back(p);
    }
    if (nEdge < 3 || out.size() < 3) FK_DEFER_F("prof_lt3_edges");
    // Closed? BRepTools_WireExplorer emits each edge's FIRST vertex, so a closed
    // wire's ring is already complete; an OPEN wire's last edge contributes its
    // start only and the ring would silently lose the free end. Reject openness
    // explicitly rather than infer it.
    if (!BRep_Tool::IsClosed(w)) FK_DEFER_F("prof_wire_open");
    if (out.front().Distance(out.back()) <= tol) out.pop_back();
    if (out.size() < 3) FK_DEFER_F("prof_lt3_pts");
    return true;
}

// EVERY polygon ring of a profile given as a WIRE or a FACE: rings[0] is the
// OUTER boundary and rings[1..] are its HOLES, largest Newell area first.
//
// ★ WHY THE HOLES ARE CARRIED RATHER THAN DECLINED. This function used to
// reject any face with more than one wire ("a face with a hole needs a real 2-D
// trim"). Measured on the 600-part corpus A/B, that single line was 581 of the
// 598 PIPE defers — 97.2% — and for 307 of those parts the SAME outer wire,
// handed to the SAME transport as a bare TopoDS_Wire by the PIPESHELL family,
// swept without complaint. So the rejection was never about the sweep: it was
// about the cap.
//
// No 2-D trim is needed, because the per-leg mitre map p -> p + s(p)d is AFFINE
// and INVERTIBLE whenever its denominator is positive (the same condition the
// engine already enforces). An affine bijection carries nested disjoint rings to
// nested disjoint rings, so the hole stays a hole and no new self-intersection
// can appear. The cap is then a planar face with the transported holes added as
// inner wires — exactly the region OCCT's MakePipe sweeps for the same face.
//
// The rings are area-sorted and the outer must be STRICTLY the largest: a tie
// means the outer boundary is not identifiable from the rings alone, and a
// guess there would silently swap material for void.
bool profileRings(const TopoDS_Shape& s,
                  std::vector<std::vector<gp_Pnt> >& rings, double tol) {
    rings.clear();
    if (s.IsNull()) FK_DEFER_F("prof_null");

    if (s.ShapeType() == TopAbs_WIRE) {
        std::vector<gp_Pnt> r;
        if (!polygonRing(TopoDS::Wire(s), r, tol)) return false;   // reason set
        rings.push_back(r);
        return true;
    }
    if (s.ShapeType() != TopAbs_FACE) FK_DEFER_F("prof_bad_shape_type");

    std::vector<std::vector<gp_Pnt> > got;
    for (TopExp_Explorer ex(s, TopAbs_WIRE); ex.More(); ex.Next()) {
        std::vector<gp_Pnt> r;
        if (!polygonRing(TopoDS::Wire(ex.Current()), r, tol)) return false;  // reason set
        got.push_back(r);
    }
    if (got.empty()) FK_DEFER_F("prof_face_no_wire");

    // Largest Newell area first. Every ring is already known planar (polygonRing
    // does not check that, ringPlanar below does), so the magnitude is the area.
    std::vector<std::size_t> order(got.size());
    for (std::size_t i = 0; i < got.size(); ++i) order[i] = i;
    std::vector<double> a(got.size(), 0.0);
    for (std::size_t i = 0; i < got.size(); ++i) a[i] = newell(got[i]).Magnitude();
    std::sort(order.begin(), order.end(),
              [&](std::size_t x, std::size_t y) { return a[x] > a[y]; });
    for (std::size_t i = 1; i < order.size(); ++i) {
        if (!(a[order[0]] > a[order[i]])) FK_DEFER_F("prof_rings_area_tie");
    }
    for (std::size_t i = 0; i < order.size(); ++i) rings.push_back(got[order[i]]);
    return true;
}

// ---------------------------------------------------------------- assembly
bool addPolyFace(BRepBuilderAPI_Sewing& sew, const std::vector<gp_Pnt>& r) {
    BRepBuilderAPI_MakePolygon poly;
    for (const gp_Pnt& p : r) poly.Add(p);
    poly.Close();
    if (!poly.IsDone()) FK_DEFER_F("face_polygon_fail");
    BRepBuilderAPI_MakeFace mkf(poly.Wire(), Standard_True);
    if (!mkf.IsDone()) FK_DEFER_F("face_makeface_fail");
    sew.Add(mkf.Face());
    return true;
}

bool addQuad(BRepBuilderAPI_Sewing& sew, const gp_Pnt& a, const gp_Pnt& b,
             const gp_Pnt& c, const gp_Pnt& d, double tol) {
    if (!quadPlanar(a, b, c, d, tol)) FK_DEFER_F("quad_nonplanar");
    return addPolyFace(sew, std::vector<gp_Pnt>{a, b, c, d});
}

bool addTri(BRepBuilderAPI_Sewing& sew, const gp_Pnt& a, const gp_Pnt& b,
            const gp_Pnt& c, double tol) {
    const std::vector<gp_Pnt> t{a, b, c};
    double area = 0.0;
    if (!ringPlanar(t, tol, area)) FK_DEFER_F("tri_degenerate");
    return addPolyFace(sew, t);
}

// One planar CAP face: `rings[0]` is the outer boundary, `rings[1..]` its holes.
// A hole wire is added with the winding OPPOSITE to the outer — that is what
// makes it a hole rather than a second outer boundary — and the winding is read
// from the ring's own Newell normal rather than assumed from the input order.
// With a single ring this is byte-for-byte the old addPolyFace path.
bool addCapFace(BRepBuilderAPI_Sewing& sew,
                const std::vector<std::vector<gp_Pnt> >& rings) {
    if (rings.empty()) FK_DEFER_F("cap_no_ring");
    if (rings.size() == 1) return addPolyFace(sew, rings[0]);

    BRepBuilderAPI_MakePolygon op;
    for (const gp_Pnt& p : rings[0]) op.Add(p);
    op.Close();
    if (!op.IsDone()) FK_DEFER_F("cap_outer_polygon_fail");
    BRepBuilderAPI_MakeFace mkf(op.Wire(), Standard_True);
    if (!mkf.IsDone()) FK_DEFER_F("cap_outer_face_fail");

    const gp_Vec no = newell(rings[0]);
    for (std::size_t i = 1; i < rings.size(); ++i) {
        BRepBuilderAPI_MakePolygon ip;
        for (const gp_Pnt& p : rings[i]) ip.Add(p);
        ip.Close();
        if (!ip.IsDone()) FK_DEFER_F("cap_hole_polygon_fail");
        TopoDS_Wire hw = ip.Wire();
        if (newell(rings[i]).Dot(no) > 0.0) hw.Reverse();
        mkf.Add(hw);
        if (!mkf.IsDone()) FK_DEFER_F("cap_hole_add_fail");
    }
    sew.Add(mkf.Face());
    return true;
}

// Sew, then either return the open SHELL (solid == false, matching OCCT's
// ThruSections(isSolid=false)) or close it into a positive-volume SOLID.
TopoDS_Shape sewAndClose(BRepBuilderAPI_Sewing& sew, bool solid) {
    sew.Perform();
    const TopoDS_Shape sewed = sew.SewedShape();
    if (sewed.IsNull()) FK_DEFER("sew_null");

    TopoDS_Shell shell;
    int nShells = 0;
    for (TopExp_Explorer ex(sewed, TopAbs_SHELL); ex.More(); ex.Next()) {
        shell = TopoDS::Shell(ex.Current());
        ++nShells;
    }
    if (nShells != 1 || shell.IsNull()) FK_DEFER(nShells == 0 ? "sew_no_shell" : "sew_multi_shell");

    if (!solid) {
        // An open skin is the deliverable here; free edges are its rim, not a
        // fault. Only the "one connected shell" invariant is asserted.
        return shell;
    }
    if (sew.NbFreeEdges() != 0) FK_DEFER("sew_free_edges");   // not watertight

    const TopoDS_Solid sol = forge::occtheal::solidFromShell(shell);
    if (sol.IsNull()) FK_DEFER("sew_solid_from_shell_fail");
    GProp_GProps props;
    BRepGProp::VolumeProperties(sol, props);
    if (std::fabs(props.Mass()) < 1.0e-12) FK_DEFER("sew_zero_volume");
    return sol;   // solidFromShell already oriented it to positive volume
}

// ------------------------------------------- TRANSLATED-SECTION RULED LOFT
// ★ WHY THIS PATH EXISTS, and why it runs only AFTER the polygonal one declines.
//
// The polygonal path above represents a section as a ring of VERTICES, so it
// requires every section edge to be supported by a LINE. Instrumented on the
// 600-part corpus A/B (test/run_thrusections_engine_census.sh, the engine's own
// FK_DEFER labels) that ONE precondition is 291 of 291 native THRUSECTIONS
// deferrals — 100%, not a tail — and 258 of those are inputs OCCT builds. The
// sections it turns away are rounded rectangles (four lines + four arcs, 65
// parts), whole circles (33), and spline boundaries (31). Faceting their arcs
// would answer with the WRONG solid, so approximation is not the fix.
//
// The fix is an IDENTITY, not an approximation. When section B is section A
// translated by a vector T, every ruled line of the loft joins p to p + T, so
// the ruled loft between them IS the linear extrusion of A along T — exactly,
// for any edge geometry, arcs and splines alike, with nothing faceted. Measured
// on the same corpus, 189 of the 258 deletion-bucket parts (73.3%) are exact
// translates: two parallel faces of an extruded part are the corpus's single
// most common pair, and they are congruent by construction.
//
// forge::occtPrism is that extrusion and is ALREADY linked into this file (the
// circular pipe legs build with it). Its two profile cases line up exactly with
// the distinction BRepOffsetAPI_ThruSections draws: a FACE gives laterals plus
// both caps (isSolid=true) and a WIRE gives the open lateral shell
// (isSolid=false). Its laterals are surfaces of linear extrusion of the EXACT
// edge curve, so no arc is ever approximated.
//
// STRICTLY ADDITIVE. thruSections runs the polygonal path first and only reaches
// here when that returned null, so no input the engine covered before this
// change can answer differently. A pair that is not a translate is still an
// HONEST DEFER and keeps the polygonal path's label, with this path's own label
// appended after it.

// Ordered sample of a closed wire: for each edge in BRepTools_WireExplorer order,
// its start point plus four interior points of the ORIENTED parameter range.
// Endpoints alone would call two arcs of different radius "the same"; the
// interior samples are what make the test below a statement about the CURVES.
bool sampleWireRing(const TopoDS_Wire& w, std::vector<gp_Pnt>& out, std::size_t& nEdge) {
    out.clear();
    nEdge = 0;
    if (w.IsNull()) FK_DEFER_F("xlate_wire_null");
    if (!BRep_Tool::IsClosed(w)) FK_DEFER_F("xlate_wire_open");
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        BRepAdaptor_Curve ac(e);
        const double a = ac.FirstParameter(), b = ac.LastParameter();
        if (!(b > a) && !(a > b)) FK_DEFER_F("xlate_edge_degenerate_param");
        const bool rev = (e.Orientation() == TopAbs_REVERSED);
        for (int k = 0; k < kSamplesPerEdge; ++k) {
            const double u = static_cast<double>(k) / kSamplesPerEdge;
            const double t = rev ? (b + (a - b) * u) : (a + (b - a) * u);
            out.push_back(ac.Value(t));
        }
        ++nEdge;
    }
    if (nEdge == 0) FK_DEFER_F("xlate_wire_no_edge");
    return true;
}

// Is ring `b` ring `a` rigidly TRANSLATED, under some edge-aligned rotation and
// either orientation? `b` is REVERSED by index, not re-sampled: sample i of the
// forward ring is sample (n-i) mod n of the reversed one because both rings carry
// the same points, so an edge start stays at a multiple of kSamplesPerEdge in
// both and the rotation search stays edge-aligned.
//
// BOTH orientations are searched because the two outer wires of two OPPOSITE
// faces of a solid wind in OPPOSITE senses in world space (the same fact
// canonicalRing exists for), so the reversed match is the COMMON case here, not
// the exotic one.
bool ringTranslate(const std::vector<gp_Pnt>& a, const std::vector<gp_Pnt>& b,
                   double tol, gp_Vec& outT) {
    const std::size_t n = a.size();
    if (n == 0 || b.size() != n || (n % kSamplesPerEdge) != 0) return false;
    const std::size_t nEdge = n / kSamplesPerEdge;
    std::vector<gp_Pnt> c(n);
    for (int rev = 0; rev < 2; ++rev) {
        if (rev) { for (std::size_t i = 0; i < n; ++i) c[i] = b[(n - i) % n]; }
        else     { c = b; }
        for (std::size_t e = 0; e < nEdge; ++e) {
            const std::size_t s = e * kSamplesPerEdge;
            const gp_Vec T(a[0], c[s]);
            bool ok = true;
            for (std::size_t i = 0; i < n && ok; ++i) {
                if (gp_Vec(a[i], c[(i + s) % n]).Subtracted(T).Magnitude() > tol) ok = false;
            }
            if (ok) { outT = T; return true; }
        }
    }
    return false;
}

// The ruled loft of two sections related by a translation, built as the exact
// linear extrusion. Returns a null shape (with a label) when the pair is not a
// translate or the extrusion is degenerate.
TopoDS_Shape thruSectionsTranslate(const std::vector<TopoDS_Shape>& sections,
                                   bool solid, double tol) {
    if (sections.size() != 2) FK_DEFER("xlate_not_two_sections");
    if (sections[0].IsNull() || sections[1].IsNull()) FK_DEFER("xlate_section_null");
    if (sections[0].ShapeType() != TopAbs_WIRE || sections[1].ShapeType() != TopAbs_WIRE)
        FK_DEFER("xlate_section_not_wire");

    const TopoDS_Wire w0 = TopoDS::Wire(sections[0]);
    const TopoDS_Wire w1 = TopoDS::Wire(sections[1]);
    std::vector<gp_Pnt> r0, r1;
    std::size_t n0 = 0, n1 = 0;
    if (!sampleWireRing(w0, r0, n0)) return kNull;   // reason set
    if (!sampleWireRing(w1, r1, n1)) return kNull;   // reason set
    if (n0 != n1) FK_DEFER("xlate_edge_count_mismatch");

    // The samples come off imported STEP solids, whose coordinates already carry
    // the reader's own rounding, so a fixed 1e-6 would be a statement about the
    // importer rather than about the geometry on a 500 mm part. The test scales
    // with the sections' own size and NEVER tightens below the caller's tol.
    double lo[3] = {r0[0].X(), r0[0].Y(), r0[0].Z()};
    double hi[3] = {r0[0].X(), r0[0].Y(), r0[0].Z()};
    for (const gp_Pnt& p : r0) {
        lo[0] = std::min(lo[0], p.X()); hi[0] = std::max(hi[0], p.X());
        lo[1] = std::min(lo[1], p.Y()); hi[1] = std::max(hi[1], p.Y());
        lo[2] = std::min(lo[2], p.Z()); hi[2] = std::max(hi[2], p.Z());
    }
    const double dx = hi[0] - lo[0], dy = hi[1] - lo[1], dz = hi[2] - lo[2];
    const double secDiag = std::sqrt(dx * dx + dy * dy + dz * dz);
    const double xt = std::max(tol, 1.0e-7 * std::max(1.0, secDiag));

    gp_Vec T(0.0, 0.0, 0.0);
    if (!ringTranslate(r0, r1, xt, T)) FK_DEFER("xlate_not_a_translate");
    if (T.Magnitude() <= xt) FK_DEFER("xlate_zero_vector");

    TopoDS_Shape out;
    if (solid) {
        // The cap face is the caller's own wire, so the cap boundary is the exact
        // input curve set and not a rebuilt approximation of it.
        BRepBuilderAPI_MakeFace mkf(w0, Standard_True);
        if (!mkf.IsDone()) FK_DEFER("xlate_base_wire_not_planar");
        try { out = forge::occtPrism(mkf.Face(), T, false); } catch (...) { out = kNull; }
        if (out.IsNull()) FK_DEFER("xlate_prism_failed");
        // occtPrism already self-checks a planar profile against area*|vec.n|;
        // this asserts the piece that check cannot see — that the extrusion is
        // not edge-on to the section plane, which would sweep zero volume.
        GProp_GProps vp;
        try { BRepGProp::VolumeProperties(out, vp); } catch (...) { FK_DEFER("xlate_volume_threw"); }
        if (std::fabs(vp.Mass()) < 1.0e-12) FK_DEFER("xlate_zero_volume");
    } else {
        // isSolid == false is the OPEN lateral skin, which is what occtPrism
        // returns for a WIRE profile — no caps, by construction.
        try { out = forge::occtPrism(w0, T, false); } catch (...) { out = kNull; }
        if (out.IsNull()) FK_DEFER("xlate_prism_shell_failed");
        int nf = 0;
        for (TopExp_Explorer ex(out, TopAbs_FACE); ex.More(); ex.Next()) ++nf;
        if (nf == 0) FK_DEFER("xlate_shell_no_face");
    }
    return out;
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

// Diagnostic-only. See the FK_DEFER banner above.
const char* lastDeferReason() { return g_reason; }

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
namespace {

// The ORIGINAL engine: sections as rings of vertices, lateral faces as planar
// quads. Unchanged by the translated-section work below except that it no longer
// clears the reason channel itself (thruSections does that once, for both paths).
TopoDS_Shape thruSectionsPolygonal(const std::vector<TopoDS_Shape>& sections,
                                   bool solid, bool ruled, double tol) {
    if (sections.size() < 2) FK_DEFER("loft_lt2_sections");
    const double t = std::max(tol, 1.0e-9);

    // ruled == false is only the same surface as ruled == true for TWO sections
    // (PART 2). Three or more smoothed sections is a different skin: defer.
    if (!ruled && sections.size() != 2) FK_DEFER("loft_smooth_gt2_sections");

    std::vector<Section> sec;
    sec.reserve(sections.size());
    for (std::size_t k = 0; k < sections.size(); ++k) {
        const TopoDS_Shape& s = sections[k];
        Section cur;
        if (!s.IsNull() && s.ShapeType() == TopAbs_VERTEX) {
            // A point section is only meaningful as an apex at an end.
            if (k != 0 && k + 1 != sections.size()) FK_DEFER("loft_interior_point_section");
            cur.isPoint = true;
            cur.ring.push_back(BRep_Tool::Pnt(TopoDS::Vertex(s)));
        } else if (!s.IsNull() && s.ShapeType() == TopAbs_WIRE) {
            if (!polygonRing(TopoDS::Wire(s), cur.ring, t)) return kNull;
        } else {
            FK_DEFER("loft_section_not_wire_or_vertex");
        }
        sec.push_back(std::move(cur));
    }

    // Two adjacent point sections have no lateral surface at all.
    for (std::size_t k = 0; k + 1 < sec.size(); ++k) {
        if (sec[k].isPoint && sec[k + 1].isPoint) FK_DEFER("loft_adjacent_point_sections");
    }

    // Every polygon section must carry the SAME vertex count: correspondence is
    // an INDEX pairing, exactly as BRepFill_Generator pairs them (which index,
    // i.e. each ring's orientation and origin, is settled just below by
    // canonicalRing). OCCT auto-reparametrises sections of DIFFERING count;
    // this engine does NOT and says so.
    std::size_t n = 0;
    for (const Section& s : sec) {
        if (s.isPoint) continue;
        if (n == 0) n = s.ring.size();
        else if (s.ring.size() != n) FK_DEFER("loft_vertex_count_mismatch");
    }
    if (n < 3) FK_DEFER("loft_lt3_vertices");

    // ---------------------------------------------------- correspondence
    // Fix each consecutive polygon pair's index correspondence before any face
    // is built (see canonicalRing). The raw wire-explorer order is TRIED FIRST
    // and kept whenever it already yields planar quads, so this is STRICTLY
    // ADDITIVE: no input this engine covered before changes answer, and the
    // canonical retry can only turn a defer into a build. If the canonical
    // correspondence is not planar either, the pair is still declined.
    // Rewriting sec[k+1] in place is deliberate: section k+1 is then the
    // reference for pair k+1, so a chain of sections is canonicalised
    // progressively rather than each pair independently.
    for (std::size_t k = 0; k + 1 < sec.size(); ++k) {
        if (sec[k].isPoint || sec[k + 1].isPoint) continue;
        if (allQuadsPlanar(sec[k].ring, sec[k + 1].ring, t)) continue;
        canonicalRing(sec[k].ring, sec[k + 1].ring);
    }

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
            if (!ringPlanar(sec[k].ring, t, area)) FK_DEFER("loft_cap_ring_nonplanar");
            if (!addPolyFace(sew, sec[k].ring)) return kNull;
        }
    }

    return sewAndClose(sew, solid);
}

}  // namespace

// The family-D entry point. The polygonal engine answers first; the translated-
// section identity is tried ONLY on its defer, so this is strictly additive —
// every input the polygonal path covered still takes the polygonal path and
// returns the shape it always returned.
TopoDS_Shape thruSections(const std::vector<TopoDS_Shape>& sections,
                          bool solid, bool ruled, double tol) {
    reasonClear();
    const TopoDS_Shape poly = thruSectionsPolygonal(sections, solid, ruled, tol);
    if (!poly.IsNull()) return poly;
    // The polygonal reason is KEPT and this path's label is appended after it, so
    // the census still reads why the first engine declined as well as the second.
    return thruSectionsTranslate(sections, solid, std::max(tol, 1.0e-9));
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
    if (spine.IsNull()) FK_DEFER_F("spine_null");
    if (BRep_Tool::IsClosed(spine)) FK_DEFER_F("spine_closed");
    for (BRepTools_WireExplorer ex(spine); ex.More(); ex.Next()) {
        const TopoDS_Edge& e = ex.Current();
        if (!isLineEdge(e)) FK_DEFER_F("spine_edge_not_line");
        const gp_Pnt p = BRep_Tool::Pnt(ex.CurrentVertex());
        if (node.empty() || p.Distance(node.back()) > t) node.push_back(p);
    }
    // BRepTools_WireExplorer yields each edge's FIRST vertex, so the spine's own
    // end point is ALWAYS still missing — including for a single-segment spine,
    // where `node` holds exactly one point here. Append it before any size test.
    if (node.empty()) FK_DEFER_F("spine_no_nodes");
    {
        int nEdge = 0;
        TopoDS_Edge last;
        for (TopExp_Explorer ex(spine, TopAbs_EDGE); ex.More(); ex.Next()) {
            last = TopoDS::Edge(ex.Current());
            ++nEdge;
        }
        if (nEdge == 0) FK_DEFER_F("spine_no_edges");
        gp_Pnt best;
        double bestD = -1.0;
        for (TopExp_Explorer vx(last, TopAbs_VERTEX); vx.More(); vx.Next()) {
            const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(vx.Current()));
            const double d = p.Distance(node.back());
            if (d > bestD) { bestD = d; best = p; }
        }
        if (bestD <= t) FK_DEFER_F("spine_end_degenerate");
        node.push_back(best);
    }
    for (std::size_t j = 0; j + 1 < node.size(); ++j) {
        const gp_Vec d = vec(node[j], node[j + 1]);
        if (d.Magnitude() <= t) FK_DEFER_F("spine_zero_leg");
        leg.push_back(gp_Dir(d));
    }
    if (leg.empty()) FK_DEFER_F("spine_no_legs");
    return true;
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
//
// ★ MULTIPLE RINGS. `rings[0]` is the outer boundary and `rings[1..]` its holes.
// EVERY ring is carried by the SAME per-leg affine map, which is what makes the
// holed sweep exact rather than an approximation: an affine bijection preserves
// nesting and disjointness, so hole stays hole and the lateral surfaces of two
// different rings can never cross. The lateral faces are emitted for every ring;
// the caps carry the holes as inner wires.
TopoDS_Shape sweepPolygonMitre(const std::vector<gp_Pnt>& node,
                               const std::vector<gp_Dir>& leg,
                               const std::vector<std::vector<gp_Pnt> >& rings,
                               bool makeSolid, double t) {
    if (rings.empty()) FK_DEFER("no_ring");
    // An OPEN skin (ThruSections(isSolid=false) semantics) of a holed profile is
    // two disconnected tubes, not one shell. Say so here rather than let it fall
    // out of the shell count as a mystery.
    if (rings.size() > 1 && !makeSolid) FK_DEFER("open_skin_with_holes");

    BRepBuilderAPI_Sewing sew(std::max(t, 1.0e-6));

    // Carry the rings leg by leg. `cur` is the section at the start of leg j.
    std::vector<std::vector<gp_Pnt> > cur = rings;
    const std::vector<std::vector<gp_Pnt> > startRings = rings;

    for (std::size_t j = 0; j < leg.size(); ++j) {
        std::vector<std::vector<gp_Pnt> > nxt(cur.size());
        if (j + 1 < leg.size()) {
            // Interior node: carry to the MITRE plane at node[j+1].
            const gp_Vec nvv = gp_Vec(leg[j]) + gp_Vec(leg[j + 1]);
            if (nvv.Magnitude() <= 1.0e-12) FK_DEFER("mitre_reversal");
            const gp_Dir mn(nvv);
            const double denom = gp_Vec(leg[j]).Dot(gp_Vec(mn));
            if (denom <= 1.0e-12) FK_DEFER("mitre_denom");
            for (std::size_t g = 0; g < cur.size(); ++g) {
                nxt[g].resize(cur[g].size());
                for (std::size_t i = 0; i < cur[g].size(); ++i) {
                    const double sN = vec(cur[g][i], node[j + 1]).Dot(gp_Vec(mn)) / denom;
                    nxt[g][i] = cur[g][i].Translated(sN * gp_Vec(leg[j]));
                }
            }
        } else {
            // Final leg: carry to the plane through the spine end, normal d_j.
            // For a SINGLE-segment spine this is exactly the translation by the
            // spine displacement that OCCT was measured to apply (PART 3a).
            for (std::size_t g = 0; g < cur.size(); ++g) {
                nxt[g].resize(cur[g].size());
                for (std::size_t i = 0; i < cur[g].size(); ++i) {
                    const double sN = vec(cur[g][i], node[j + 1]).Dot(gp_Vec(leg[j]));
                    nxt[g][i] = cur[g][i].Translated(sN * gp_Vec(leg[j]));
                }
            }
        }
        for (std::size_t g = 0; g < cur.size(); ++g) {
            const std::size_t n = cur[g].size();
            for (std::size_t i = 0; i < n; ++i) {
                const std::size_t k = (i + 1) % n;
                if (!addQuad(sew, cur[g][i], cur[g][k], nxt[g][k], nxt[g][i], t))
                    return kNull;  // reason set
            }
        }
        cur = nxt;
    }

    if (makeSolid) {
        for (std::size_t g = 0; g < startRings.size(); ++g) {
            double a0 = 0.0, a1 = 0.0;
            if (!ringPlanar(startRings[g], t, a0)) FK_DEFER("cap_start_nonplanar");
            if (!ringPlanar(cur[g], t, a1)) FK_DEFER("cap_end_nonplanar");
        }
        if (!addCapFace(sew, startRings)) return kNull;   // reason set
        if (!addCapFace(sew, cur)) return kNull;          // reason set
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
    if (!spinePolyline(spine, t, node, leg)) return kNull;   // reason already set

    std::vector<std::vector<gp_Pnt> > rings;
    if (!profileRings(profile, rings, t)) return kNull;       // reason already set
    double area = 0.0;
    if (!ringPlanar(rings[0], t, area)) FK_DEFER("prof_ring_nonplanar");

    // Every hole must be planar AND lie in the OUTER ring's plane. A face read
    // from STEP can carry a wire that is planar on its own but tilted out of the
    // face plane by a healing artefact; sweeping that would cap a solid whose
    // start face is not flat, so it is a defer rather than a repair.
    const gp_Dir pn(newell(rings[0]));
    for (std::size_t g = 1; g < rings.size(); ++g) {
        double ah = 0.0;
        if (!ringPlanar(rings[g], t, ah)) FK_DEFER("prof_hole_nonplanar");
        if (std::fabs(gp_Dir(newell(rings[g])).Dot(pn)) < 1.0 - 1.0e-9)
            FK_DEFER("prof_hole_not_parallel");
        for (const gp_Pnt& q : rings[g]) {
            if (std::fabs(vec(rings[0][0], q).Dot(gp_Vec(pn))) > t)
                FK_DEFER("prof_hole_off_plane");
        }
    }

    // A multi-segment spine needs the profile plane PERPENDICULAR to the first
    // leg, otherwise the mitre map is not the rigid transport this engine
    // derives and the answer would be a guess.
    if (leg.size() > 1) {
        if (std::fabs(std::fabs(pn.Dot(leg[0])) - 1.0) > 1.0e-9)
            FK_DEFER("prof_not_perp_to_leg0");
    }
    return sweepPolygonMitre(node, leg, rings, makeSolid, t);
}

// ★ THE ARC-SWEPT LATERAL FACE SERVES BOTH FAMILIES, and its definition sits
// with family E further down this file. Declared here so family F, which is
// written above it, can reach the same engine rather than grow a second one.
// (Same anonymous namespace, so this is the same internal-linkage function.)
TopoDS_Shape pipeArcChainProfile(const TopoDS_Wire& spine,
                                 const TopoDS_Shape& profile, double t);
// ── A PROFILE THAT IS NOT A POLYGON — the two predicates, and the engine ─────
//
// ★ WHY THIS PATH EXISTS, MEASURED NOT GUESSED. On the 600-part corpus A/B the
// native PIPESHELL engine covered 309 parts and declined 291, and every single
// one of the 291 carried ONE FK_DEFER label: `prof_edge_not_line`. One label
// over a whole deletion bucket is not yet an attribution — "an edge that is not
// a line" is equally consistent with "these are free-form blobs no bounded
// engine will sweep" and with "these are rounded outlines". A per-part curve
// census of the SAME profiles the A/B hands the engine
// (test/pipeshell_defer_census.cpp, run by test/run_pipeshell_defer_census.sh)
// settles it:
//     141  the outer boundary is LINES AND CIRCULAR ARCS   (mean 10.3 edges)
//     106  it contains B-SPLINE edges                      (mean 31.7 edges)
//      44  it is a SINGLE full circle                      (exactly 1 edge)
//     ---
//     291  and ALL 291 close into a planar face — measured, the census's
//          `planar_face_ok` column, 291/291.
// So the bucket was never "sections that are not planar regions". It was ONE
// precondition — polygonRing() reading VERTICES — applied to sections whose
// boundary happens to be curved.
//
// ★ THE CONSTRUCTION, and why it is EXACT rather than a fit. Write Prism_j for
// the INFINITE prism of leg j: the section at station j swept along d_j in both
// senses. The mitre plane M_j bisects d_{j-1} and d_j, so the reflection R_j in
// M_j maps d_{j-1} to -d_j (with |d|=1 and c = d_{j-1}·d_j,
//   R_j(d_{j-1}) = d_{j-1} - 2((1+c)/(2+2c))(d_{j-1}+d_j) = -d_j)
// and it FIXES M_j pointwise, hence fixes the section lying in it. An infinite
// prism is the section swept in BOTH senses, so
//     R_j(Prism_{j-1}) = Prism_j   EXACTLY,
// and therefore Prism_j = g_j(Prism_0) with g_j = R_j∘…∘R_1 a RIGID MOTION. A
// rigid motion carries a circle to a circle and a B-spline to a congruent
// B-spline: there is nothing to approximate. The leg's solid is then that prism
// cut by its two station planes, exactly as pipeCircleMitre already does for a
// circular section, and the legs are fused.
//
// ★ WHY EVERY TRANSFORM APPLIED IS PROPER. g_j is a composition of j
// reflections, so for odd j it is orientation-REVERSING, and a mirrored solid
// handed to BRepAlgoAPI_Common is a silently wrong operand (the complement
// survives the cut). It does not have to be: let sigma be the reflection in the
// SECTION'S OWN plane. Prism_0 is invariant under sigma (it is the section swept
// in both senses along the plane's normal), so g_j∘sigma maps Prism_0 to Prism_j
// just as g_j does — and it is PROPER whenever g_j is not. sigma maps the
// section face onto ITSELF as a point set, so this changes the geometry by
// nothing at all and the handedness by everything. The volume sign is then
// checked anyway before any boolean, because "should be proper" is not a
// measurement.
//
// ★ THE ORACLE. Over leg j the axial thickness between the two station planes is
// AFFINE on the right cross-section (each station's crossing parameter is affine
// and their difference is too), so its integral is area × its value at the
// section CENTROID — that is, area × the length of the centroid's own
// mitre-transported path. The result is accepted only if its measured volume
// meets that to 1e-6 relative. A leg trimmed on the wrong side of a station, a
// dropped fuse operand or an inverted boolean operand are all percent-level
// effects and none can hide under that bound.
//
// ★★ AND THAT ORACLE IS SELF-REFERENTIAL, so it is not the only one. It checks the
// construction against the identity the construction was derived from, and cannot
// separate "built the mitred sweep" from "built some other solid of the same
// volume" — this repository has four measured cases where volume alone ratified a
// wrong solid. The INDEPENDENT check is
// reports/corpus_ab/pipeshell_defer_audit/mitre_ratio_check.py. OCCT's
// MakePipeShell at its DEFAULT transition mode does NOT carry the section through
// the corner, so it encloses A*(L1 + L2 cos theta) where the mitre encloses
// A*(L1 + L2). The corpus A/B's spine is two EQUAL legs at exactly 30 degrees, so
// native / OCCT-default must be 2/(1 + cos 30) = 1.0717967697 for EVERY part,
// whatever its section's shape, area or edge types — a number nothing in this file
// computes, measured against a separate implementation. Per class median over the
// 600-part corpus:
//     LINE_ONLY   (already proven)   1.0717967697   off by 1.2e-11
//     LINE_ARC    (new here)         1.0717967697   off by 7.4e-11
//     HAS_BSPLINE (new here)         1.0717967695   off by 2.2e-10
//     ARC_ONLY    (new here)         1.0717967579   off by 1.2e-08
// The new coverage lands on the closed form to the same precision as the polygon
// path already proved exact against OCCT(RightCorner) on all 309 of its parts.
//
// Defined below, next to halfSpaceThrough, which it uses.
TopoDS_Shape sweepFaceMitre(const std::vector<gp_Pnt>& node,
                            const std::vector<gp_Dir>& leg,
                            const TopoDS_Face& sec, double t);

// Is every edge of the profile a straight line? That is the precondition of the
// vertex-ring transport above. It is asked EXPLICITLY, rather than by sniffing
// the defer label, so the curved path can never absorb a polygon profile that
// declined on some OTHER precondition (a non-planar ring, a tilted hole): those
// stay honest defers and the 309 parts the polygon path already covers stay on
// a byte-identical code path.
bool allLineEdges(const TopoDS_Shape& s) {
    if (s.IsNull()) return false;
    int n = 0;
    for (TopExp_Explorer ex(s, TopAbs_EDGE); ex.More(); ex.Next()) {
        if (!isLineEdge(TopoDS::Edge(ex.Current()))) return false;
        ++n;
    }
    return n > 0;
}

// The profile as a FACE. A FACE is taken as it stands — its holes come along and
// occtPrism carries them. A closed WIRE is capped into a planar face. Anything
// else, or a wire that will not close, yields a null face (an honest defer at
// the caller).
TopoDS_Face planarProfileFace(const TopoDS_Shape& s) {
    if (s.IsNull()) return TopoDS_Face();
    if (s.ShapeType() == TopAbs_FACE) return TopoDS::Face(s);
    if (s.ShapeType() != TopAbs_WIRE) return TopoDS_Face();
    const TopoDS_Wire w = TopoDS::Wire(s);
    if (!BRep_Tool::IsClosed(w)) return TopoDS_Face();
    try {
        BRepBuilderAPI_MakeFace mkf(w, Standard_True);
        if (!mkf.IsDone()) return TopoDS_Face();
        return mkf.Face();
    } catch (const Standard_Failure&) {
        return TopoDS_Face();
    }
}
}  // namespace

TopoDS_Shape pipeShell(const TopoDS_Wire& spine,
                       const TopoDS_Shape& profile,
                       const std::vector<TopoDS_Wire>& guides,
                       bool makeSolid, double tol) {
    // There is no native guided pipe-shell anywhere in the tree. Say so.
    reasonClear();
    if (!guides.empty()) FK_DEFER("guides_present");
    const double t = std::max(tol, 1.0e-9);

    const TopoDS_Shape poly = sweepPolygonProfile(spine, profile, makeSolid, t);
    if (!poly.IsNull()) return poly;

    // A CURVED section is still a planar region and the mitre transport is a
    // RIGID motion, so it carries one exactly. See the derivation above.
    if (allLineEdges(profile)) return kNull;   // the polygon path was the right
                                               // one; its decline stands

    // An OPEN skin (makeSolid=false) is a different construction -- there is no
    // prism to trim, and the arc region is assembled as a BOOLEAN of swept atoms,
    // which hands back a solid. An honest defer rather than a solid returned where
    // a skin was asked for. Base's label is kept because it is the one the corpus
    // census and the A/B harness already attribute against.
    if (!makeSolid) FK_DEFER("arc_open_skin_not_supported");

    // ARC CHAIN FIRST, and NON-TERMINAL. Base returned this directly; leaving it
    // terminal would make the general engine below dead code. It is tried first
    // because it is the narrower, longer-established path -- every input it accepts
    // takes exactly the route it took before, and only what it DECLINES falls
    // through to the general transport.
    {
        const TopoDS_Shape arc = pipeArcChainProfile(spine, profile, t);
        if (!arc.IsNull()) return arc;
    }

    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;   // reason already set
    const TopoDS_Face sec = planarProfileFace(profile);
    if (sec.IsNull()) FK_DEFER("gen_no_planar_section");
    return sweepFaceMitre(node, leg, sec, t);
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

// ── THE CURVED-SECTION MITRE TRANSPORT (families E and F) ────────────────────
// Declared next to sweepPolygonProfile, where the derivation, the measured
// census that motivates it and the correctness oracle are all written out.
// Defined here because it is built from halfSpaceThrough above.
//
// EVERY OCCT CALL BELOW IS WRAPPED. Under the drop option a throw out of this
// engine is a hard failure at the call site, so an OCCT exception must surface
// as a LABELLED DEFER and never as a throw.
TopoDS_Shape sweepFaceMitre(const std::vector<gp_Pnt>& node,
                            const std::vector<gp_Dir>& leg,
                            const TopoDS_Face& sec, double t) {
    const std::size_t k = leg.size();
    if (k == 0 || node.size() != k + 1) FK_DEFER("gen_bad_spine");
    if (sec.IsNull()) FK_DEFER("gen_null_section");

    // ★ THE SECTION MUST BE A VALID FACE, and this is the load-bearing
    // precondition of the whole path — not a formality. Extruding a face is only
    // a sweep of a REGION if the face bounds one, and BRepGProp will hand back an
    // area for a face that bounds nothing, so the volume oracle below would then
    // be checking a wrong answer against a wrong expectation and agreeing. The
    // three ways the family-E A/B constructs a malformed section are all caught
    // here and by nothing else downstream (measured, this machine, all with a
    // 40x40 outer square):
    //     an OPEN half-circle inner wire      BRepCheck 0, area 1574.87 (a lie)
    //     two OVERLAPPING circular holes      BRepCheck 0, area 1373.81 (double-
    //                                         counted overlap)
    //     a hole POKING THROUGH the wall      BRepCheck 0, area -363.50
    //     CONTROL one legal circular hole     BRepCheck 1, area 1549.73
    //     CONTROL no hole                     BRepCheck 1, area 1600
    // The first two were swept into plausible-looking solids before this gate
    // existed. A section this engine cannot vouch for is an honest defer.
    {
        bool ok = false;
        try { ok = BRepCheck_Analyzer(sec).IsValid() == Standard_True; }
        catch (const Standard_Failure&) { ok = false; }
        if (!ok) FK_DEFER("gen_section_invalid");
    }

    // ---- the section: plane, area, centroid --------------------------------
    gp_Pln pln;
    double area = 0.0;
    gp_Pnt com;
    try {
        BRepAdaptor_Surface as(sec);
        if (as.GetType() != GeomAbs_Plane) FK_DEFER("gen_section_not_planar");
        pln = as.Plane();
        GProp_GProps props;
        BRepGProp::SurfaceProperties(sec, props);
        area = props.Mass();
        com = props.CentreOfMass();
    } catch (const Standard_Failure&) {
        FK_DEFER("gen_section_read_threw");
    }
    if (!(area > 1.0e-12)) FK_DEFER("gen_section_zero_area");
    const gp_Dir pn = pln.Axis().Direction();
    // The same precondition the polygon path enforces: the mitre map is the
    // rigid transport derived above only if the section is perpendicular to the
    // first leg. Anything else would be a guess.
    if (std::fabs(std::fabs(pn.Dot(leg[0])) - 1.0) > 1.0e-9)
        FK_DEFER("gen_not_perp_to_leg0");

    // ---- the station planes ------------------------------------------------
    // ★ STATION 0 IS THE SECTION'S OWN PLANE, not a plane through node[0].
    // MakePipeShell carries the profile by spine(t) - spine(0) and does NOT
    // relocate it onto the spine (PART 3a, measured), and sweepPolygonMitre
    // above starts from `rings` exactly as given for that reason. A plane
    // through node[0] here would silently shift the answer by the section's
    // offset along the first leg.
    std::vector<gp_Pnt> stPt;
    std::vector<gp_Dir> stN;
    stPt.push_back(pln.Location());
    stN.push_back(leg[0]);
    for (std::size_t j = 1; j < k; ++j) {
        const gp_Vec b = gp_Vec(leg[j - 1]) + gp_Vec(leg[j]);
        if (b.Magnitude() <= 1.0e-12) FK_DEFER("gen_mitre_reversal");
        const gp_Dir mn(b);
        if (gp_Vec(leg[j - 1]).Dot(gp_Vec(mn)) <= 1.0e-12) FK_DEFER("gen_mitre_denom");
        stPt.push_back(node[j]);
        stN.push_back(mn);
    }
    stPt.push_back(node[k]);
    stN.push_back(leg[k - 1]);

    // ---- the centroid's own transported path: the volume oracle ------------
    // This is the SAME point map sweepPolygonMitre applies to every ring vertex,
    // applied to one point. Its total length times the section area is the
    // enclosed volume; see the derivation next to sweepPolygonProfile.
    std::vector<gp_Pnt> cpath;
    cpath.push_back(com);
    double pathLen = 0.0;
    for (std::size_t j = 0; j < k; ++j) {
        const gp_Pnt c = cpath[j];
        const double den = gp_Vec(leg[j]).Dot(gp_Vec(stN[j + 1]));
        if (den <= 1.0e-12) FK_DEFER("gen_centroid_grazing");
        const double s = vec(c, stPt[j + 1]).Dot(gp_Vec(stN[j + 1])) / den;
        if (!(s > 0.0)) FK_DEFER("gen_centroid_backtrack");
        cpath.push_back(c.Translated(s * gp_Vec(leg[j])));
        pathLen += s;
    }
    if (!(pathLen > 0.0)) FK_DEFER("gen_zero_path");

    // ---- one trimmed prism per leg, fused ----------------------------------
    gp_Trsf sigma;
    sigma.SetMirror(gp_Ax2(pln.Location(), pn));   // the section's OWN plane
    gp_Trsf g;                                      // g_0 = identity
    bool improper = false;

    TopoDS_Shape acc;
    for (std::size_t j = 0; j < k; ++j) {
        const gp_Dir d = leg[j];

        // The right cross-section of leg j is g_j(sec), pre-composed with sigma
        // whenever g_j is improper. sigma maps the section onto itself, so the
        // FACE is identical and only the transform's handedness changes.
        TopoDS_Face fj = sec;
        if (j > 0) {
            const gp_Trsf h = improper ? g.Multiplied(sigma) : g;
            try {
                BRepBuilderAPI_Transform tr(sec, h, Standard_True);
                if (!tr.IsDone() || tr.Shape().IsNull()) FK_DEFER("gen_transform_fail");
                if (tr.Shape().ShapeType() != TopAbs_FACE) FK_DEFER("gen_transform_not_face");
                fj = TopoDS::Face(tr.Shape());
            } catch (const Standard_Failure&) {
                FK_DEFER("gen_transform_threw");
            }
        }

        // The radial reach of the section about this leg's axis, over-estimated
        // from the bounding box corners. An over-estimate only makes the raw
        // prism longer before it is trimmed, so it costs nothing and cannot
        // truncate the answer; an under-estimate would.
        Bnd_Box bb;
        try { BRepBndLib::Add(fj, bb); } catch (const Standard_Failure&) { FK_DEFER("gen_bbox_threw"); }
        if (bb.IsVoid()) FK_DEFER("gen_bbox_void");
        Standard_Real xa, ya, za, xb, yb, zb;
        bb.Get(xa, ya, za, xb, yb, zb);
        double rmax = 0.0;
        for (int cx = 0; cx < 2; ++cx)
            for (int cy = 0; cy < 2; ++cy)
                for (int cz = 0; cz < 2; ++cz) {
                    const gp_Pnt q(cx ? xb : xa, cy ? yb : ya, cz ? zb : za);
                    const gp_Vec v = vec(node[j], q);
                    const gp_Vec radial = v - gp_Vec(d) * v.Dot(gp_Vec(d));
                    rmax = std::max(rmax, radial.Magnitude());
                }

        // Where each station plane crosses this leg's axis, how far the OBLIQUE
        // cut can excurse axially over a section of reach rmax, and — the point
        // of the `oblique` flag — WHETHER A CUT IS NEEDED AT ALL.
        //
        // ★ A PERPENDICULAR STATION IS NOT CUT, IT IS THE PRISM'S OWN END.
        // Station 0 is the section's plane and station k is normal to the last
        // leg, so BOTH are perpendicular to their leg by construction, and only
        // the interior MITRE stations are oblique. Measured on an elliptical
        // section: the raw occtPrism volume equals the closed form to rel=0,
        // while trimming it with two redundant perpendicular half-space Commons
        // moved it by 2e-5 relative — OCCT's boolean re-approximates a
        // Geom_SurfaceOfLinearExtrusion section curve. So a straight spine now
        // costs ZERO booleans and is exact, and a k-leg spine costs one cut per
        // leg-end that is genuinely mitred instead of two.
        double axial[2] = {0.0, 0.0}, margin[2] = {0.0, 0.0};
        bool oblique[2] = {false, false};
        for (int e = 0; e < 2; ++e) {
            const std::size_t st = j + static_cast<std::size_t>(e);
            const double c = gp_Vec(d).Dot(gp_Vec(stN[st]));
            if (std::fabs(c) <= 1.0e-9) FK_DEFER("gen_grazing_station");
            axial[e] = vec(node[j], stPt[st]).Dot(gp_Vec(stN[st])) / c;
            oblique[e] = std::fabs(std::fabs(c) - 1.0) > 1.0e-12;
            margin[e] = rmax * std::sqrt(std::max(0.0, 1.0 - c * c)) / std::fabs(c);
        }
        // The pad only lengthens the RAW prism before it is trimmed, so it costs
        // nothing and cannot truncate the answer. It takes the caller's tolerance
        // with 1e-6 as a FLOOR: a caller asking for 1e-9 wants a tighter answer,
        // not a raw prism that might fall short of its own oblique cut.
        const double padU = std::max(t, 1.0e-6);
        const double pad = padU + padU * std::max(rmax, 1.0);
        const double lo = axial[0] - (oblique[0] ? margin[0] + pad : 0.0);
        const double len = (axial[1] + (oblique[1] ? margin[1] + pad : 0.0)) - lo;
        if (!(len > 0.0)) FK_DEFER("gen_leg_span_nonpositive");

        // Slide the section along the leg to the base of the raw prism.
        double af = 0.0;
        try {
            BRepAdaptor_Surface asf(fj);
            if (asf.GetType() != GeomAbs_Plane) FK_DEFER("gen_leg_section_not_planar");
            af = vec(node[j], asf.Plane().Location()).Dot(gp_Vec(d));
        } catch (const Standard_Failure&) {
            FK_DEFER("gen_leg_section_threw");
        }
        TopoDS_Face base;
        try {
            gp_Trsf mv;
            mv.SetTranslation(gp_Vec(d) * (lo - af));
            BRepBuilderAPI_Transform mvt(fj, mv, Standard_True);
            if (!mvt.IsDone() || mvt.Shape().IsNull()) FK_DEFER("gen_base_move_fail");
            base = TopoDS::Face(mvt.Shape());
        } catch (const Standard_Failure&) {
            FK_DEFER("gen_base_move_threw");
        }

        // occtPrism is the in-house TKPrim-free linear sweep: one
        // Geom_SurfaceOfLinearExtrusion lateral face per profile edge — LINE,
        // CIRCLE and B-SPLINE alike — plus the two caps. Nothing is tessellated
        // and nothing is fitted. It carries its own V = area*|vec.n| self-check.
        TopoDS_Shape piece;
        try {
            piece = ::forge::occtPrism(base, gp_Vec(d) * len);
        } catch (const Standard_Failure&) {
            FK_DEFER("gen_prism_threw");
        } catch (const std::exception&) {
            FK_DEFER("gen_prism_fail");
        }
        if (piece.IsNull()) FK_DEFER("gen_prism_null");

        // An INVERTED solid is a silently wrong boolean operand — Common would
        // keep the complement. The transform above is constructed to be proper,
        // but "constructed to be" is not a measurement, so the sign is read.
        {
            GProp_GProps vp;
            try { BRepGProp::VolumeProperties(piece, vp); }
            catch (const Standard_Failure&) { FK_DEFER("gen_prism_volume_threw"); }
            if (vp.Mass() < 0.0) piece.Reverse();
            else if (!(vp.Mass() > 0.0)) FK_DEFER("gen_prism_zero_volume");
        }

        // Trim to the two station planes. The material side is the one holding
        // the midpoint of the CENTROID PATH's segment for this leg — which lies
        // strictly between the two station planes by construction. (The leg
        // midpoint would be wrong for leg 0, whose start station is the
        // section's own plane and not a plane through node[0].)
        const gp_Pnt mid((cpath[j].X() + cpath[j + 1].X()) * 0.5,
                         (cpath[j].Y() + cpath[j + 1].Y()) * 0.5,
                         (cpath[j].Z() + cpath[j + 1].Z()) * 0.5);
        for (int e = 0; e < 2; ++e) {
            if (!oblique[e]) continue;   // the prism already ends on that plane
            const std::size_t st = j + static_cast<std::size_t>(e);
            const TopoDS_Shape h = halfSpaceThrough(stPt[st], stN[st], mid, piece);
            if (h.IsNull()) FK_DEFER("gen_halfspace_fail");
            try {
                BRepAlgoAPI_Common cut(piece, h);
                cut.Build();
                if (!cut.IsDone()) FK_DEFER("gen_trim_fail");
                piece = cut.Shape();
            } catch (const Standard_Failure&) {
                FK_DEFER("gen_trim_threw");
            }
            if (piece.IsNull()) FK_DEFER("gen_trim_null");
        }

        if (acc.IsNull()) {
            acc = piece;
        } else {
            try {
                BRepAlgoAPI_Fuse fu(acc, piece);
                fu.Build();
                if (!fu.IsDone()) FK_DEFER("gen_fuse_fail");
                acc = fu.Shape();
            } catch (const Standard_Failure&) {
                FK_DEFER("gen_fuse_threw");
            }
            if (acc.IsNull()) FK_DEFER("gen_fuse_null");
        }

        // g_{j+1} = R_{j+1} o g_j, and one more reflection flips the handedness.
        if (j + 1 < k) {
            gp_Trsf R;
            R.SetMirror(gp_Ax2(stPt[j + 1], stN[j + 1]));
            g = R.Multiplied(g);
            improper = !improper;
        }
    }
    if (acc.IsNull()) FK_DEFER("gen_empty");

    // The legs meet exactly on their shared mitre plane, so the fuse leaves a
    // seam face pair; unify it away so the answer carries the same face count a
    // one-piece sweep would. A failure here is a defer, never a shipped seam.
    TopoDS_Shape out;
    try {
        ShapeUpgrade_UnifySameDomain uni(acc, Standard_True, Standard_True, Standard_True);
        uni.Build();
        out = uni.Shape();
    } catch (const Standard_Failure&) {
        FK_DEFER("gen_unify_threw");
    }
    if (out.IsNull()) FK_DEFER("gen_unify_null");

    // ---- THE ORACLE --------------------------------------------------------
    // V = area(section) * (length of the centroid's transported path). Derived
    // next to sweepPolygonProfile; independent of OCCT, and tight enough that a
    // mis-trimmed leg, a dropped fuse operand or an inverted operand cannot pass.
    GProp_GProps vp;
    try { BRepGProp::VolumeProperties(out, vp); }
    catch (const Standard_Failure&) { FK_DEFER("gen_out_volume_threw"); }
    const double actual = std::fabs(vp.Mass());
    const double expected = area * pathLen;
    if (!(expected > 0.0)) FK_DEFER("gen_zero_expected");
    const double rel = std::fabs(actual - expected) / expected;
    // ★ WHERE 1e-6 COMES FROM. It is ANCHORED, not chosen: it is exactly the
    // relative volume tolerance the corpus A/B's own comparator uses to declare
    // two solids to AGREE (test/corpus_ab_coverage.cpp, close_()). Accepting a
    // build whose volume misses its closed form by more than that would be
    // accepting a build the A/B could not then call correct.
    //
    // And it is MEASURED against the distribution it has to separate. With
    // FORGE_GEN_ORACLE_REPORT set this ratio is printed for every build, accepted
    // or rejected, so the number can be re-derived rather than re-argued. Over
    // the 291 curved sections of the 600-part corpus:
    //     min 0   p50 1.5e-10   p90 1.0e-8   p99 1.4e-7   max 1.46e-6
    // 108 of 291 sit above 1e-9 and only 3 above 1e-7. The entire spread is OCCT's
    // boolean re-approximating a MITRE section curve — a straight spine, which
    // needs no boolean at all, measures rel = 0 exactly. ONE part (ho1190, an
    // 8-edge all-B-spline outline) lands at 1.46e-6 and is declined. That is a
    // close call and it is left as a decline rather than tuned away: a tolerance
    // widened until the last part fits is not a tolerance.
    if (std::getenv("FORGE_GEN_ORACLE_REPORT") != nullptr)
        std::fprintf(stderr, "gen_oracle rel=%.6g actual=%.12g expected=%.12g\n",
                     rel, actual, expected);
    if (rel > 1.0e-6) FK_DEFER("gen_volume_oracle");

    // ★ THE RESULT MUST BE A VALID SOLID, and the volume oracle above CANNOT
    // establish that. BRepGProp integrates the divergence theorem, so a shell that
    // SELF-INTERSECTS still reports the signed volume area*length and sails straight
    // through `rel <= 1e-6`. That is not a hypothesis: base measured three folded
    // solids at vol = 11634.42469 / 18788.07069 / 28326.26536, every one of them
    // BRepCheck valid=0, every one of them PASSING the A*L gate.
    //
    // pipeArcChainProfile blocks those inputs with an explicit station preflight
    // (`arc_section_folds_at_mitre`, NativeLoftPipe.cpp) — but this engine is now
    // reached precisely BECAUSE that path declined, so relying on it would be relying
    // on the check that just said no. This engine also cannot reuse the preflight: it
    // carries an ARBITRARY planar face, which has no per-point radius to test.
    //
    // So it validates the RESULT instead, which is strictly more general than the
    // preflight it stands in for — it catches a self-intersection whatever produced
    // it, not only the sharp-mitre fold that motivated the check.
    {
        bool ok = false;
        try { ok = BRepCheck_Analyzer(out).IsValid() == Standard_True; }
        catch (const Standard_Failure&) { ok = false; }
        if (!ok) FK_DEFER("gen_result_folds_or_self_intersects");
    }
    return out;
}

// The mitre-trimmed cylinder chain (family E, CIRCLE profile).
TopoDS_Shape pipeCircleMitre(const std::vector<gp_Pnt>& node,
                             const std::vector<gp_Dir>& leg,
                             const gp_Pnt& c0, const gp_Dir& ax0, double r,
                             double t) {
    // Preconditions, mirroring the polygon path: the section plane is
    // perpendicular to the first leg and its centre sits ON the spine start.
    // Without both, the mitre map is not the rigid transport derived above.
    if (std::fabs(std::fabs(gp_Vec(ax0).Dot(gp_Vec(leg[0]))) - 1.0) > 1.0e-9)
        FK_DEFER("circ_not_perp_to_leg0");
    if (c0.Distance(node[0]) > std::max(t, 1.0e-9)) FK_DEFER("circ_centre_off_spine");

    const std::size_t k = leg.size();

    // ---- station planes: 0 = start cap, 1..k-1 = MITRE, k = end cap --------
    std::vector<gp_Dir> sn;   // station normal, oriented along the travel sense
    sn.reserve(k + 1);
    sn.push_back(leg[0]);
    for (std::size_t j = 1; j < k; ++j) {
        const gp_Vec b = gp_Vec(leg[j - 1]) + gp_Vec(leg[j]);
        if (b.Magnitude() <= 1.0e-12) FK_DEFER("circ_mitre_reversal");
        const gp_Dir mn(b);
        if (gp_Vec(leg[j - 1]).Dot(gp_Vec(mn)) <= 1.0e-12) FK_DEFER("circ_mitre_denom");
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
        if (m0 < 0.0 || m1 < 0.0) FK_DEFER("circ_grazing_station");
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

// ── FAMILY E, THIRD PROFILE KIND: a POLYGON outer boundary with CIRCULAR holes.
//
// WHY THIS KIND EXISTS, measured not guessed. On the 600-part corpus A/B the
// native PIPE engine covered 2 parts. Instrumenting every defer predicate (see
// the FK_DEFER channel) attributed them exactly:
//     581  the profile face had more than one wire        <- removed above
//      17  the profile's outer wire was not a polygon
// and after the multi-wire rejection was removed the whole 598 moved to ONE
// label, "an edge that is not a line". A per-wire curve census of the same 600
// profile faces then showed why: of 3426 hole wires in the corpus, 3426 are
// FULL CIRCLES and none is a polygon. Removing the multi-wire gate alone
// therefore bought ZERO coverage -- the bucket behind it was 100% co-occurrent.
// The parts split cleanly:
//     307  outer POLYGON, every hole a CIRCLE   <- this function
//     274  outer NOT a polygon, holes circles   <- needs a curved outer boundary
//      17  outer NOT a polygon, no holes        <- same
//       2  outer POLYGON, no holes              <- the two that already built
//
// CONSTRUCTION, exact and analytic throughout. The outer boundary is the same
// mitre / double-reflection transport as everywhere else in this file. Each hole
// is a chain of mitre-trimmed right circular cylinders: the hole's CENTRE is
// carried by the SAME affine per-leg map as the polygon vertices, so over leg j
// the hole's lateral surface is a Geom_CylindricalSurface of the hole's own
// radius about the axis (c_j, d_j), trimmed by the two station planes. This is
// pipeCircleMitre's construction with the on-spine restriction lifted: nothing
// in it needs the circle centre to sit on the spine except the station planes,
// and those are properties of the SPINE, not of the section.
//
// THE CORRECTNESS GATE, universal and cheap. The tubes are cut from the outer
// solid, and the answer is accepted only if
//     vol(outer) - vol(result) == sum of vol(tube_i)
// to 1e-7 relative. That identity holds IFF every tube lies entirely inside the
// outer solid and no two tubes overlap -- exactly the two ways a hole could
// silently carve material it should not. A hole poking through the outer wall
// is a percent-level effect and cannot hide under that bound.
// A CLOSED wire that is EXACTLY ONE FULL CIRCLE -- whether the STEP writer
// stored it as a single edge or split it into several arcs of the SAME circle.
// circleProfile() above requires a single edge, which is the right rule for a
// PROFILE (an arc there is a genuinely different shape); for a HOLE the split is
// pure representation, and rejecting it cost 60 of the corpus's 600 parts.
//
// The three things checked are the three that make it a circle and not an arc
// fan: every edge lies on the SAME circle (centre, axis, radius), the wire is
// CLOSED, and the arc parameter spans SUM to exactly one turn -- so a wire that
// doubles back over the same arc twice, or leaves a gap, is not accepted.
bool fullCircleWire(const TopoDS_Wire& w, gp_Pnt& c, gp_Dir& ax, double& r,
                    double tol) {
    if (w.IsNull()) return false;
    if (!BRep_Tool::IsClosed(w)) return false;
    const double kTwoPi = 6.283185307179586476925286766559;
    bool first = true;
    double span = 0.0;
    int ne = 0;
    for (TopExp_Explorer ex(w, TopAbs_EDGE); ex.More(); ex.Next()) {
        const TopoDS_Edge e = TopoDS::Edge(ex.Current());
        Standard_Real f = 0.0, l = 0.0;
        Handle(Geom_Curve) cv = BRep_Tool::Curve(e, f, l);
        while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
            cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
        if (cv.IsNull() || !cv->IsKind(STANDARD_TYPE(Geom_Circle))) return false;
        const gp_Circ ci = Handle(Geom_Circle)::DownCast(cv)->Circ();
        if (first) {
            c = ci.Location(); ax = ci.Axis().Direction(); r = ci.Radius();
            first = false;
        } else {
            const double ct = std::max(tol, 1.0e-7 * std::max(1.0, r));
            if (ci.Location().Distance(c) > ct) return false;
            if (!ci.Axis().Direction().IsParallel(ax, 1.0e-9)) return false;
            if (std::fabs(ci.Radius() - r) > ct) return false;
        }
        span += std::fabs(l - f);
        ++ne;
    }
    if (ne == 0 || !(r > 0.0)) return false;
    return std::fabs(span - kTwoPi) <= 1.0e-7;
}

TopoDS_Shape pipePolygonWithCircularHoles(const TopoDS_Wire& spine,
                                          const TopoDS_Shape& profile, double t) {
    if (profile.IsNull() || profile.ShapeType() != TopAbs_FACE)
        FK_DEFER("holes_profile_not_face");

    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;   // reason already set
    const std::size_t k = leg.size();

    // ---- split the face's wires into ONE polygon outer and N circle holes ---
    struct Hole { gp_Pnt c; double r; };
    std::vector<std::vector<gp_Pnt> > polys;
    std::vector<Hole> holes;
    for (TopExp_Explorer wx(profile, TopAbs_WIRE); wx.More(); wx.Next()) {
        const TopoDS_Wire w = TopoDS::Wire(wx.Current());
        std::vector<gp_Pnt> ring;
        if (polygonRing(w, ring, t)) { polys.push_back(ring); continue; }
        gp_Pnt c; gp_Dir ax; double r = 0.0;
        if (!fullCircleWire(w, c, ax, r, t))
            FK_DEFER("holes_wire_neither_poly_nor_circle");
        // The circle must lie IN the profile plane, i.e. its axis is the sweep
        // direction. Otherwise its swept surface is an elliptic cylinder and
        // this construction would be a guess.
        if (std::fabs(std::fabs(gp_Vec(ax).Dot(gp_Vec(leg[0]))) - 1.0) > 1.0e-9)
            FK_DEFER("holes_circle_not_perp_to_leg0");
        holes.push_back(Hole{c, r});
    }
    if (polys.size() != 1) FK_DEFER(polys.empty() ? "holes_no_polygon_outer"
                                                  : "holes_multiple_polygon_wires");
    if (holes.empty()) FK_DEFER("holes_none");   // the plain polygon path owns this

    const std::vector<gp_Pnt>& outerRing = polys[0];
    double outerArea = 0.0;
    if (!ringPlanar(outerRing, t, outerArea)) FK_DEFER("holes_outer_nonplanar");
    const gp_Dir pn(newell(outerRing));

    // The outer boundary and every hole centre must share ONE plane, and that
    // plane must be perpendicular to the first leg (the cylinders' axis).
    if (std::fabs(std::fabs(pn.Dot(leg[0])) - 1.0) > 1.0e-9)
        FK_DEFER("holes_outer_not_perp_to_leg0");
    for (const Hole& h : holes) {
        if (std::fabs(vec(outerRing[0], h.c).Dot(gp_Vec(pn))) > std::max(t, 1.0e-7))
            FK_DEFER("holes_circle_off_profile_plane");
        if (!(h.r > 0.0)) FK_DEFER("holes_zero_radius");
    }

    // ---- station planes, identical to pipeCircleMitre's ---------------------
    std::vector<gp_Dir> sn;
    sn.reserve(k + 1);
    sn.push_back(leg[0]);
    for (std::size_t j = 1; j < k; ++j) {
        const gp_Vec b = gp_Vec(leg[j - 1]) + gp_Vec(leg[j]);
        if (b.Magnitude() <= 1.0e-12) FK_DEFER("holes_mitre_reversal");
        const gp_Dir mn(b);
        if (gp_Vec(leg[j - 1]).Dot(gp_Vec(mn)) <= 1.0e-12) FK_DEFER("holes_mitre_denom");
        sn.push_back(mn);
    }
    sn.push_back(leg[k - 1]);

    // ---- the OUTER solid ----------------------------------------------------
    std::vector<std::vector<gp_Pnt> > justOuter;
    justOuter.push_back(outerRing);
    TopoDS_Shape solid = sweepPolygonMitre(node, leg, justOuter, /*makeSolid*/ true, t);
    if (solid.IsNull()) return kNull;   // reason already set
    GProp_GProps gp0;
    BRepGProp::VolumeProperties(solid, gp0);
    const double volOuter = std::fabs(gp0.Mass());
    if (!(volOuter > 0.0)) FK_DEFER("holes_outer_zero_volume");

    // ---- one mitre-trimmed cylinder chain per hole, then CUT ----------------
    double volTubes = 0.0;
    for (const Hole& h : holes) {
        gp_Pnt cj = h.c;
        TopoDS_Shape tube;
        for (std::size_t j = 0; j < k; ++j) {
            // Carry the centre to the next station plane by the SAME affine map
            // the polygon vertices use.
            gp_Pnt cn;
            if (j + 1 < k) {
                const double denom = gp_Vec(leg[j]).Dot(gp_Vec(sn[j + 1]));
                if (denom <= 1.0e-12) FK_DEFER("holes_mitre_denom");
                const double sMove = vec(cj, node[j + 1]).Dot(gp_Vec(sn[j + 1])) / denom;
                cn = cj.Translated(sMove * gp_Vec(leg[j]));
            } else {
                const double sMove = vec(cj, node[j + 1]).Dot(gp_Vec(leg[j]));
                cn = cj.Translated(sMove * gp_Vec(leg[j]));
            }
            const double travel = cj.Distance(cn);
            if (!(travel > std::max(t, 1.0e-9))) FK_DEFER("holes_zero_travel_leg");

            auto margin = [&](std::size_t st) -> double {
                const double m = std::fabs(gp_Vec(leg[j]).Dot(gp_Vec(sn[st])));
                if (m <= 1.0e-9) return -1.0;
                return h.r * std::sqrt(std::max(0.0, 1.0 - m * m)) / m;
            };
            const double m0 = margin(j), m1 = margin(j + 1);
            if (m0 < 0.0 || m1 < 0.0) FK_DEFER("holes_grazing_station");
            const double pad = 1.0e-6 + 1.0e-6 * h.r;
            const double len = travel + m0 + m1 + 2.0 * pad;
            const gp_Pnt base = cj.Translated(-(m0 + pad) * gp_Vec(leg[j]));

            TopoDS_Shape piece;
            try {
                piece = ::forge::occtCylinderSolid(gp_Ax2(base, leg[j]), h.r, len);
            } catch (const std::exception&) {
                FK_DEFER("holes_cylinder_throw");
            }
            if (piece.IsNull()) FK_DEFER("holes_cylinder_null");

            // The material side of each station plane is the one holding the
            // midpoint of THIS hole's own leg segment: its two ends lie exactly
            // ON the two station planes, so the midpoint is strictly between.
            const gp_Pnt mid((cj.X() + cn.X()) * 0.5, (cj.Y() + cn.Y()) * 0.5,
                             (cj.Z() + cn.Z()) * 0.5);
            for (std::size_t st : {j, j + 1}) {
                const TopoDS_Shape hs = halfSpaceThrough(node[st], sn[st], mid, piece);
                if (hs.IsNull()) FK_DEFER("holes_halfspace_null");
                BRepAlgoAPI_Common cut(piece, hs);
                cut.Build();
                if (!cut.IsDone()) FK_DEFER("holes_station_trim_fail");
                piece = cut.Shape();
                if (piece.IsNull()) FK_DEFER("holes_station_trim_null");
            }

            if (tube.IsNull()) {
                tube = piece;
            } else {
                BRepAlgoAPI_Fuse fu(tube, piece);
                fu.Build();
                if (!fu.IsDone()) FK_DEFER("holes_tube_fuse_fail");
                tube = fu.Shape();
                if (tube.IsNull()) FK_DEFER("holes_tube_fuse_null");
            }
            cj = cn;
        }
        if (tube.IsNull()) FK_DEFER("holes_tube_null");

        GProp_GProps gt;
        BRepGProp::VolumeProperties(tube, gt);
        const double vt = std::fabs(gt.Mass());
        if (!(vt > 0.0)) FK_DEFER("holes_tube_zero_volume");
        volTubes += vt;

        BRepAlgoAPI_Cut cutter(solid, tube);
        cutter.Build();
        if (!cutter.IsDone()) FK_DEFER("holes_cut_fail");
        solid = cutter.Shape();
        if (solid.IsNull()) FK_DEFER("holes_cut_null");
    }

    // The fuse/cut seams leave co-planar and co-cylindrical face pairs; unify
    // them so the answer carries the face count a one-piece sweep would.
    ShapeUpgrade_UnifySameDomain uni(solid, Standard_True, Standard_True, Standard_True);
    uni.Build();
    TopoDS_Shape out = uni.Shape();
    if (out.IsNull()) FK_DEFER("holes_unify_null");

    int nSolid = 0, nShell = 0;
    for (TopExp_Explorer ex(out, TopAbs_SOLID); ex.More(); ex.Next()) ++nSolid;
    for (TopExp_Explorer ex(out, TopAbs_SHELL); ex.More(); ex.Next()) ++nShell;
    if (nSolid != 1) FK_DEFER("holes_not_one_solid");
    if (nShell != 1) FK_DEFER("holes_not_one_shell");

    GProp_GProps gr;
    BRepGProp::VolumeProperties(out, gr);
    const double volOut = std::fabs(gr.Mass());
    if (!(volOut > 0.0)) FK_DEFER("holes_result_zero_volume");

    // ★ THE GATE. Every tube must have removed exactly its own volume: that is
    // true iff all tubes are inside the outer solid and pairwise disjoint.
    if (std::fabs((volOuter - volOut) - volTubes) > 1.0e-7 * volOuter)
        FK_DEFER("holes_removed_volume_mismatch");

    return out;
}


// ═══════════════════════════════════════════════════════════════════════════
// THE EXACT ARC-SWEPT LATERAL FACE — family E's FOURTH profile kind
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY THIS EXISTS, measured not guessed. After the third profile kind (polygon
// outer + circular holes) the corpus A/B read PIPE native 249 / 600, and the 351
// deferrals split into exactly four shapes -- reports/corpus_ab/pipe_arc_census:
//
//     141  outer is an ARC CHAIN (lines and circular arcs), holes full circles
//     106  outer contains a B-SPLINE edge                  <- OUT OF REACH
//      60  outer is a POLYGON, one hole is an ARC CHAIN (a slot / kidney pocket)
//      44  outer is ONE FULL CIRCLE and the face has holes
//
// The three arc buckets -- 245 parts -- all need the same missing capability and
// nothing else: the lateral surface swept by a CIRCULAR ARC. The fourth is a
// hard wall: a B-spline boundary has no exact arc-swept answer and this engine
// says so rather than fitting one.
//
// ── THE CONSTRUCTION, and why it is EXACT ───────────────────────────────────
//
// (1) THE SECTION IS TRANSPORTED RIGIDLY. Over leg j the mitre map carries a
//     section point p to p + s(p) d_j on the station plane; composing that with
//     the projection along d_j+1 back onto the plane normal to d_j+1 gives, in
//     closed form, the ROTATION by the turn angle about d_j x d_j+1. (Set the
//     node at the origin, the bisector along x, d_j = (cos a, -sin a, 0),
//     d_j+1 = (cos a, sin a, 0); a section point y*u_j + z*w lands on
//     y*ROT(u_j) + z*w with ROT the rotation by 2a about w.) So the section is
//     CONGRUENT on every leg: a circle stays a circle OF THE SAME RADIUS, and an
//     arc stays an arc of the same radius and the same subtended angle. That is
//     the fact that makes an arc-swept lateral face a right circular cylinder on
//     EVERY leg rather than only on the first.
//
// (2) A REGION BOUNDED BY AN ARC CHAIN IS A BOOLEAN OF DISCS AND HALF-PLANES.
//     Write the ring's CHORD POLYGON P (every arc replaced by its chord). Then
//         region = P  (+) every arc that bulges AWAY from P
//                     (-) every arc that bulges INTO P,
//     and each such circular segment is exactly  disc  (intersect)  half-plane
//     -- the half-plane on the arc's side of its own chord. This holds for an
//     arc of ANY subtended angle in (0, 2*pi): under pi the intersection is the
//     minor segment, over pi the major one.
//
// (3) THE MITRED SWEEP IS A BOOLEAN HOMOMORPHISM. Over leg j the sweep is
//     "apply the affine station map, extrude along d_j, clip to the slab", and
//     every one of those three commutes with union, intersection and difference
//     (an affine bijection preserves them; a cylinder over R1 op R2 is the
//     cylinder over R1 op the cylinder over R2; the slab is a common clip). The
//     legs are glued along the station planes, so the whole sweep commutes too.
//     THEREFORE the swept solid can be assembled with the SAME boolean
//     expression as the 2-D region, over swept atoms:
//         S(region) = S(P)  (+) S(disc_i) (int) S(halfplane_i)  (-) ...
//     S(P) is the mitre polygon transport already in this file; S(disc) is the
//     mitre-trimmed cylinder chain already in this file; and S(half-plane) is
//     ONE PLANE PER LEG -- because the chord is a straight segment and the sweep
//     over a leg is a translation along d_j, the chord sweeps to the PLANE
//     through the transported chord spanned by (b-a) and d_j. (A first draft
//     clipped with a swept RECTANGLE instead and it was wrong for a sharp
//     elbow: a rectangle sized to swallow the disc reaches far enough out that
//     a 90-degree mitre carries its far corners BACKWARDS through the station
//     plane. The per-leg plane has no size to get wrong. The per-segment gate
//     below is what caught it.) NO NEW SURFACE KIND IS FITTED: every lateral face of the
//     answer is a plane or an analytic Geom_CylindricalSurface, and the arc's
//     own lateral face is that cylinder trimmed by two station planes and two
//     rulings -- the exact arc-swept face, obtained as a boolean rather than as
//     a hand-built pcurve, because the pcurve of a plane/cylinder intersection
//     on the cylinder is a SINUSOID in (u,v) and no Geom2d curve represents one
//     exactly. Building it by hand would mean approximating; letting the
//     boolean engine own that pcurve keeps the SURFACES exact, which is what
//     the volume, the centre of mass and the face census are read from.
//
// ── THE GATE, and why it is stronger than the one it joins ──────────────────
//
// The answer is accepted only if
//         vol(result) == A * L      to 1e-7 relative,
// where BOTH sides are independent of the B-rep:
//   * A is the CLOSED-FORM area of the profile region -- chord-polygon shoelace
//     plus (r^2/2)(D - sin D) per circular segment, signed by the bulge test;
//   * L is the length of the MITRED PATH OF THE AREA CENTROID, the centroid
//     itself in closed form (polygon first moment plus the segment centroid
//     4 r sin^3(D/2) / (3 (D - sin D)) along each bisector).
// V = A * L is exact for a mitred sweep whose profile plane is perpendicular to
// the first leg: leg j contributes A * s_j(g_j) because s_j is AFFINE and an
// affine function integrates to its value at the centroid times the area, and
// g_j+1 = g_j + s_j(g_j) d_j is that same centroid carried by the same map. The
// perpendicularity is therefore REQUIRED here (an oblique single-leg profile
// would need A projected, and this engine declines it rather than guess).
//
// That gate is strictly stronger than the sum-of-tubes gate above it: it fires
// on a wrong bulge decision, on a segment that crosses the polygon, on a hole
// outside the boundary, on two overlapping holes, AND on a boolean that silently
// dropped or kept material -- because the right-hand side never touches the
// shape. The closed form was validated against OCCT's own BRepGProp on all 494
// arc-chain profile faces of the 600-part corpus before a single solid was
// built: worst relative area disagreement 2.59e-14, worst centroid disagreement
// 1.11e-12 mm (reports/corpus_ab/pipe_arc_census/README.md).

const double kArcPi = 3.14159265358979323846;
const double kArcTwoPi = 6.28318530717958647692;

// Rodrigues rotation of `v` about the unit axis `ax` by `ang` radians.
gp_Vec rotAbout(const gp_Vec& v, const gp_Dir& ax, double ang) {
    const gp_Vec k(ax);
    const double c = std::cos(ang), s = std::sin(ang);
    return v * c + k.Crossed(v) * s + k * (k.Dot(v) * (1.0 - c));
}

// One segment of a profile ring: a LINE a->b, or a circular ARC a->b about `c`
// of radius `r` sweeping `dth` radians SIGNED about the profile normal.
struct RingSeg {
    bool   arc = false;
    gp_Pnt a, b, c;
    double r   = 0.0;
    double dth = 0.0;
    bool   add = false;   // set by ringAreaCentroid: does it ADD area to P?
};

// The station planes of a mitred polyline sweep: 0 = the start cap (normal
// leg[0]), 1..k-1 = the MITRE planes, k = the end cap (normal leg[k-1]). Written
// once here for the arc path; the two older engines above keep their own inline
// copies so that their 249 measured corpus successes cannot move.
bool stationNormals(const std::vector<gp_Dir>& leg, std::vector<gp_Dir>& sn) {
    sn.clear();
    const std::size_t k = leg.size();
    if (k == 0) FK_DEFER_F("arc_no_legs");
    sn.push_back(leg[0]);
    for (std::size_t j = 1; j < k; ++j) {
        const gp_Vec b = gp_Vec(leg[j - 1]) + gp_Vec(leg[j]);
        if (b.Magnitude() <= 1.0e-12) FK_DEFER_F("arc_mitre_reversal");
        const gp_Dir mn(b);
        if (gp_Vec(leg[j - 1]).Dot(gp_Vec(mn)) <= 1.0e-12) FK_DEFER_F("arc_mitre_denom");
        sn.push_back(mn);
    }
    sn.push_back(leg[k - 1]);
    return true;
}

// Parse a CLOSED wire into an ordered LINE / ARC chain in the plane of normal
// `pn`. HONEST DEFER on any other curve kind, an open wire, an arc whose axis is
// not the profile normal (its swept surface would be an ELLIPTIC cylinder, a
// genuinely different surface), or an arc whose stated sweep does not carry its
// own start point onto its own end point.
bool arcChainRing(const TopoDS_Wire& w, const gp_Dir& pn,
                  std::vector<RingSeg>& out, double tol) {
    out.clear();
    if (w.IsNull()) FK_DEFER_F("arc_wire_null");
    if (!BRep_Tool::IsClosed(w)) FK_DEFER_F("arc_wire_open");
    std::vector<RingSeg> got;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        const TopoDS_Edge e = ex.Current();
        Standard_Real f = 0.0, l = 0.0;
        Handle(Geom_Curve) cv = BRep_Tool::Curve(e, f, l);
        while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
            cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
        if (cv.IsNull()) FK_DEFER_F("arc_edge_no_curve");
        RingSeg s;
        s.a = BRep_Tool::Pnt(ex.CurrentVertex());
        if (cv->IsKind(STANDARD_TYPE(Geom_Line))) {
            s.arc = false;
        } else if (cv->IsKind(STANDARD_TYPE(Geom_Circle))) {
            const gp_Circ ci = Handle(Geom_Circle)::DownCast(cv)->Circ();
            const gp_Dir ax = ci.Axis().Direction();
            if (!ax.IsParallel(pn, 1.0e-7)) FK_DEFER_F("arc_axis_not_profile_normal");
            s.arc = true;
            s.c = ci.Location();
            s.r = ci.Radius();
            if (!(s.r > 0.0)) FK_DEFER_F("arc_zero_radius");
            const double mag = std::fabs(l - f);
            if (!(mag > 1.0e-12)) FK_DEFER_F("arc_zero_span");
            if (mag > kArcTwoPi + 1.0e-9) FK_DEFER_F("arc_span_over_turn");
            // The circle parameter runs CCW about the circle's OWN axis; the
            // edge's orientation says which way the wire traverses it, and the
            // axis sign says how that reads about the PROFILE normal.
            double sgn = (e.Orientation() == TopAbs_REVERSED) ? -1.0 : 1.0;
            if (ax.Dot(pn) < 0.0) sgn = -sgn;
            s.dth = sgn * mag;
        } else {
            FK_DEFER_F("arc_edge_not_line_or_circle");
        }
        got.push_back(s);
    }
    if (got.size() < 3) FK_DEFER_F("arc_lt3_segments");
    // BRepTools_WireExplorer emits each edge's FIRST vertex in traversal order,
    // so a closed wire's end points are its successors' start points.
    for (std::size_t i = 0; i < got.size(); ++i)
        got[i].b = got[(i + 1) % got.size()].a;
    for (const RingSeg& s : got) {
        if (s.a.Distance(s.b) <= tol) FK_DEFER_F("arc_zero_length_segment");
        if (!s.arc) continue;
        const double rt = std::max(tol, 1.0e-7 * s.r);
        if (std::fabs(s.a.Distance(s.c) - s.r) > rt) FK_DEFER_F("arc_start_off_circle");
        if (std::fabs(s.b.Distance(s.c) - s.r) > rt) FK_DEFER_F("arc_end_off_circle");
        // ★ THE SELF-CHECK that makes the signed sweep an OBSERVATION and not a
        // convention: rotating (a - c) by dth about pn must land on (b - c).
        if (s.c.Translated(rotAbout(vec(s.c, s.a), pn, s.dth)).Distance(s.b) > rt)
            FK_DEFER_F("arc_sweep_does_not_close");
    }
    out.swap(got);
    return true;
}

// EXACT area, centroid and per-arc ADD/SUB decision of the region bounded by an
// arc chain — the whole decomposition of PART (2) above, in closed form and
// without touching a B-rep. `sArea` is SIGNED (positive when the ring winds CCW
// about `pn`); `centroid` is the true area centroid either way.
bool ringAreaCentroid(std::vector<RingSeg>& sg, const gp_Dir& pn,
                      const gp_Pnt& org, double& sArea, gp_Pnt& centroid,
                      double tol) {
    const gp_Ax2 fr(org, pn);
    const gp_Vec e1(fr.XDirection()), e2(fr.YDirection());
    auto uv = [&](const gp_Pnt& p, double& x, double& y) {
        const gp_Vec d = vec(org, p);
        x = d.Dot(e1);
        y = d.Dot(e2);
    };
    const std::size_t m = sg.size();
    std::vector<double> px(m), py(m);
    for (std::size_t i = 0; i < m; ++i) uv(sg[i].a, px[i], py[i]);
    double a2 = 0.0, m1x = 0.0, m1y = 0.0;
    for (std::size_t i = 0; i < m; ++i) {
        const std::size_t k = (i + 1) % m;
        const double cr = px[i] * py[k] - px[k] * py[i];
        a2 += cr;
        m1x += (px[i] + px[k]) * cr;
        m1y += (py[i] + py[k]) * cr;
    }
    const double polyA = 0.5 * a2;
    if (std::fabs(polyA) <= std::max(tol * tol, 1.0e-18))
        FK_DEFER_F("arc_chord_polygon_degenerate");
    const double wind = (polyA >= 0.0) ? 1.0 : -1.0;
    double area = polyA, mx = m1x / 6.0, my = m1y / 6.0;
    for (std::size_t i = 0; i < m; ++i) {
        RingSeg& s = sg[i];
        s.add = false;
        if (!s.arc) continue;
        const double d = std::fabs(s.dth);
        const double segA = 0.5 * s.r * s.r * (d - std::sin(d));
        if (!(segA > 0.0)) FK_DEFER_F("arc_segment_zero_area");
        double ax, ay, bx, by, cx, cy;
        uv(s.a, ax, ay);
        uv(s.b, bx, by);
        uv(s.c, cx, cy);
        // OUTWARD normal of the chord a->b: the interior of a CCW ring is on the
        // LEFT of a->b, so outward is the right-hand side, flipped by the ring's
        // own winding so the test is orientation-independent.
        double ox = wind * (by - ay), oy = -wind * (bx - ax);
        const double on = std::sqrt(ox * ox + oy * oy);
        if (!(on > 0.0)) FK_DEFER_F("arc_zero_chord");
        ox /= on;
        oy /= on;
        double hx = 0.0, hy = 0.0;
        uv(s.c.Translated(rotAbout(vec(s.c, s.a), pn, 0.5 * s.dth)), hx, hy);
        const double side = (hx - 0.5 * (ax + bx)) * ox + (hy - 0.5 * (ay + by)) * oy;
        if (std::fabs(side) <= 1.0e-12 * s.r) FK_DEFER_F("arc_bulge_undecidable");
        s.add = side > 0.0;
        // Segment centroid: 4 r sin^3(D/2) / (3 (D - sin D)) from the circle
        // centre, along the bisector towards the arc midpoint.
        const double dg = 4.0 * s.r * std::pow(std::sin(0.5 * d), 3.0) /
                          (3.0 * (d - std::sin(d)));
        const double ux = (hx - cx) / s.r, uy = (hy - cy) / s.r;
        const double sw = (s.add ? 1.0 : -1.0) * wind * segA;
        area += sw;
        mx += sw * (cx + dg * ux);
        my += sw * (cy + dg * uy);
    }
    if (std::fabs(area) <= std::max(tol * tol, 1.0e-18)) FK_DEFER_F("arc_region_zero_area");
    sArea = area;
    centroid = org.Translated((mx / area) * e1 + (my / area) * e2);
    return true;
}

// Carry one point to the NEXT station plane along leg j, and report how far it
// travelled. This is the single affine map every ring, hole centre, chord end
// and centroid in this engine rides — writing it once is what makes "the same
// affine per-leg map" a fact about the code and not only about the comment.
// For the LAST leg sn[k] == leg[k-1], so the denominator is 1 and it degenerates
// to the plain projection onto the end cap.
bool stationStep(const std::vector<gp_Pnt>& node, const std::vector<gp_Dir>& leg,
                 const std::vector<gp_Dir>& sn, std::size_t j, const gp_Pnt& p,
                 gp_Pnt& out, double& travel) {
    const double denom = gp_Vec(leg[j]).Dot(gp_Vec(sn[j + 1]));
    if (denom <= 1.0e-12) return false;
    travel = vec(p, node[j + 1]).Dot(gp_Vec(sn[j + 1])) / denom;
    out = p.Translated(travel * gp_Vec(leg[j]));
    return true;
}

// A DISC swept along the mitred spine: one right circular cylinder per leg,
// about that leg's own direction through the transported centre, trimmed to the
// two station planes and fused. Nothing here needs the centre to sit ON the
// spine — the station planes are properties of the SPINE, not of the section.
//
// ★ THIS IS THE HOLE-TUBE LOOP OF pipePolygonWithCircularHoles, lifted with its
// own labels. It is a SEPARATE body and not a shared one on purpose: that
// function's 249 measured corpus successes are the baseline this change must
// leave untouched, and re-pointing it at a shared body would put them at risk
// for a cosmetic gain. Whoever unifies them owes a re-run of the corpus A/B.
TopoDS_Shape sweptDiscSolid(const std::vector<gp_Pnt>& node,
                            const std::vector<gp_Dir>& leg,
                            const std::vector<gp_Dir>& sn,
                            const gp_Pnt& c0, double r, double t) {
    if (!(r > 0.0)) FK_DEFER("arc_tube_zero_radius");
    const std::size_t k = leg.size();
    gp_Pnt cj = c0;
    TopoDS_Shape tube;
    for (std::size_t j = 0; j < k; ++j) {
        // Carry the centre to the next station by the SAME affine map the
        // polygon vertices use. For the LAST leg sn[k] == leg[k-1], so the
        // denominator is 1 and this is the plain projection onto the end cap.
        const double denom = gp_Vec(leg[j]).Dot(gp_Vec(sn[j + 1]));
        if (denom <= 1.0e-12) FK_DEFER("arc_tube_mitre_denom");
        const double move = vec(cj, node[j + 1]).Dot(gp_Vec(sn[j + 1])) / denom;
        const gp_Pnt cn = cj.Translated(move * gp_Vec(leg[j]));
        const double travel = cj.Distance(cn);
        if (!(travel > std::max(t, 1.0e-9))) FK_DEFER("arc_tube_zero_travel");

        // Axial margin so the raw cylinder fully spans each oblique cut: the
        // plane's extreme axial excursion over a circle of radius r is r*tan(a).
        auto margin = [&](std::size_t st) -> double {
            const double m = std::fabs(gp_Vec(leg[j]).Dot(gp_Vec(sn[st])));
            if (m <= 1.0e-9) return -1.0;
            return r * std::sqrt(std::max(0.0, 1.0 - m * m)) / m;
        };
        const double m0 = margin(j), m1 = margin(j + 1);
        if (m0 < 0.0 || m1 < 0.0) FK_DEFER("arc_tube_grazing_station");
        const double pad = 1.0e-6 + 1.0e-6 * r;
        const double len = travel + m0 + m1 + 2.0 * pad;
        const gp_Pnt base = cj.Translated(-(m0 + pad) * gp_Vec(leg[j]));

        TopoDS_Shape piece;
        try {
            piece = ::forge::occtCylinderSolid(gp_Ax2(base, leg[j]), r, len);
        } catch (const std::exception&) {
            FK_DEFER("arc_tube_cylinder_throw");
        }
        if (piece.IsNull()) FK_DEFER("arc_tube_cylinder_null");

        const gp_Pnt mid((cj.X() + cn.X()) * 0.5, (cj.Y() + cn.Y()) * 0.5,
                         (cj.Z() + cn.Z()) * 0.5);
        for (std::size_t st : {j, j + 1}) {
            const TopoDS_Shape hs = halfSpaceThrough(node[st], sn[st], mid, piece);
            if (hs.IsNull()) FK_DEFER("arc_tube_halfspace_null");
            BRepAlgoAPI_Common trim(piece, hs);
            trim.Build();
            if (!trim.IsDone()) FK_DEFER("arc_tube_station_trim_fail");
            piece = trim.Shape();
            if (piece.IsNull()) FK_DEFER("arc_tube_station_trim_null");
        }
        if (tube.IsNull()) {
            tube = piece;
        } else {
            BRepAlgoAPI_Fuse fu(tube, piece);
            fu.Build();
            if (!fu.IsDone()) FK_DEFER("arc_tube_fuse_fail");
            tube = fu.Shape();
            if (tube.IsNull()) FK_DEFER("arc_tube_fuse_null");
        }
        cj = cn;
    }
    if (tube.IsNull()) FK_DEFER("arc_tube_null");
    return tube;
}

// The mitred sweep of ONE CIRCULAR SEGMENT: leg by leg, the leg's own right
// circular cylinder about the transported arc centre, trimmed to the two station
// planes AND to the chord plane — the plane through the transported chord
// spanned by (b - a) and the leg direction, which is exactly what the straight
// chord sweeps to over a leg. Every trim is a plane against an analytic
// cylinder, so the arc's lateral face is that cylinder and nothing else.
//
// ★ A LOCAL GATE, so a bad clip is attributed HERE and not at the end: the piece
// must enclose exactly segArea * (its own centroid's mitred path length). It is
// this gate that caught the swept-rectangle draft folding through a 90-degree
// mitre, on a case whose final volume was still within a percent of right.
TopoDS_Shape sweptSegmentSolid(const std::vector<gp_Pnt>& node,
                               const std::vector<gp_Dir>& leg,
                               const std::vector<gp_Dir>& sn,
                               const RingSeg& s, const gp_Dir& pn, double t) {
    if (!s.arc) FK_DEFER("arc_seg_not_arc");
    const double d = std::fabs(s.dth);
    const double segA = 0.5 * s.r * s.r * (d - std::sin(d));
    if (!(segA > 0.0)) FK_DEFER("arc_seg_zero_area");
    const double dg = 4.0 * s.r * std::pow(std::sin(0.5 * d), 3.0) /
                      (3.0 * (d - std::sin(d)));
    const gp_Pnt am = s.c.Translated(rotAbout(vec(s.c, s.a), pn, 0.5 * s.dth));
    if (am.Distance(s.c) <= 1.0e-12) FK_DEFER("arc_seg_degenerate_midpoint");
    const gp_Pnt g0 = s.c.Translated(dg * gp_Vec(gp_Dir(vec(s.c, am))));

    gp_Pnt cj = s.c, aj = s.a, bj = s.b, mj = am, gj = g0;
    double lPath = 0.0;
    TopoDS_Shape acc;
    for (std::size_t j = 0; j < leg.size(); ++j) {
        gp_Pnt cn, an, bn, mn, gn;
        double tc = 0.0, ta = 0.0, tb = 0.0, tm = 0.0, tg = 0.0;
        if (!stationStep(node, leg, sn, j, cj, cn, tc) ||
            !stationStep(node, leg, sn, j, aj, an, ta) ||
            !stationStep(node, leg, sn, j, bj, bn, tb) ||
            !stationStep(node, leg, sn, j, mj, mn, tm) ||
            !stationStep(node, leg, sn, j, gj, gn, tg))
            FK_DEFER("arc_seg_mitre_denom");
        // ★ EVERY point of the piece must travel FORWARD. A section that reaches
        // far enough out for a sharp mitre to carry part of it BACKWARDS through
        // the station plane is not a simple prism at all, and is declined rather
        // than swept into a self-intersecting solid.
        const double fwd = std::max(t, 1.0e-9);
        if (!(tc > fwd) || !(ta > fwd) || !(tb > fwd) || !(tm > fwd) || !(tg > fwd))
            FK_DEFER("arc_seg_folds_at_mitre");

        auto margin = [&](std::size_t st) -> double {
            const double m = std::fabs(gp_Vec(leg[j]).Dot(gp_Vec(sn[st])));
            if (m <= 1.0e-9) return -1.0;
            return s.r * std::sqrt(std::max(0.0, 1.0 - m * m)) / m;
        };
        const double m0 = margin(j), m1 = margin(j + 1);
        if (m0 < 0.0 || m1 < 0.0) FK_DEFER("arc_seg_grazing_station");
        const double pad = 1.0e-6 + 1.0e-6 * s.r;
        const double len = cj.Distance(cn) + m0 + m1 + 2.0 * pad;
        const gp_Pnt base = cj.Translated(-(m0 + pad) * gp_Vec(leg[j]));

        TopoDS_Shape piece;
        try {
            piece = ::forge::occtCylinderSolid(gp_Ax2(base, leg[j]), s.r, len);
        } catch (const std::exception&) {
            FK_DEFER("arc_seg_cylinder_throw");
        }
        if (piece.IsNull()) FK_DEFER("arc_seg_cylinder_null");

        const gp_Pnt mid((cj.X() + cn.X()) * 0.5, (cj.Y() + cn.Y()) * 0.5,
                         (cj.Z() + cn.Z()) * 0.5);
        for (std::size_t st : {j, j + 1}) {
            const TopoDS_Shape hs = halfSpaceThrough(node[st], sn[st], mid, piece);
            if (hs.IsNull()) FK_DEFER("arc_seg_halfspace_null");
            BRepAlgoAPI_Common trim(piece, hs);
            trim.Build();
            if (!trim.IsDone()) FK_DEFER("arc_seg_station_trim_fail");
            piece = trim.Shape();
            if (piece.IsNull()) FK_DEFER("arc_seg_station_trim_null");
        }

        // THE CHORD PLANE of this leg: through the transported chord, spanned by
        // (b - a) and the leg direction. The material side is the one holding the
        // transported ARC MIDPOINT, the farthest point of the segment from the
        // chord and therefore the most robust witness of which side it is.
        const gp_Vec ch = vec(aj, bj);
        if (ch.Magnitude() <= std::max(t, 1.0e-12)) FK_DEFER("arc_seg_zero_chord");
        const gp_Vec cn2 = gp_Vec(leg[j]).Crossed(gp_Vec(gp_Dir(ch)));
        if (cn2.Magnitude() <= 1.0e-9) FK_DEFER("arc_seg_chord_along_leg");
        const gp_Dir cnd(cn2);
        if (std::fabs(vec(aj, mj).Dot(gp_Vec(cnd))) <= 1.0e-12 * std::max(1.0, s.r))
            FK_DEFER("arc_seg_chord_side_undecidable");
        {
            const TopoDS_Shape hs = halfSpaceThrough(aj, cnd, mj, piece);
            if (hs.IsNull()) FK_DEFER("arc_seg_chord_halfspace_null");
            BRepAlgoAPI_Common trim(piece, hs);
            trim.Build();
            if (!trim.IsDone()) FK_DEFER("arc_seg_chord_trim_fail");
            piece = trim.Shape();
            if (piece.IsNull()) FK_DEFER("arc_seg_chord_trim_null");
        }

        if (acc.IsNull()) {
            acc = piece;
        } else {
            BRepAlgoAPI_Fuse fu(acc, piece);
            fu.Build();
            if (!fu.IsDone()) FK_DEFER("arc_seg_fuse_fail");
            acc = fu.Shape();
            if (acc.IsNull()) FK_DEFER("arc_seg_fuse_null");
        }
        lPath += tg;
        cj = cn; aj = an; bj = bn; mj = mn; gj = gn;
    }
    if (acc.IsNull()) FK_DEFER("arc_seg_null");

    GProp_GProps gp1;
    BRepGProp::VolumeProperties(acc, gp1);
    const double got = std::fabs(gp1.Mass());
    const double want = segA * lPath;
    if (!(want > 0.0)) FK_DEFER("arc_seg_zero_expected_volume");
    if (std::fabs(got - want) > 1.0e-7 * want) FK_DEFER("arc_seg_volume_mismatch");
    return acc;
}

// The mitred sweep of the closed region bounded by ONE arc-chain ring: the swept
// chord polygon, plus every outward segment, minus every inward one. This is
// PART (3) applied literally.
TopoDS_Shape sweptChainSolid(const std::vector<gp_Pnt>& node,
                             const std::vector<gp_Dir>& leg,
                             const std::vector<gp_Dir>& sn,
                             const std::vector<RingSeg>& sg, const gp_Dir& pn,
                             double t) {
    std::vector<std::vector<gp_Pnt> > chord(1);
    for (const RingSeg& s : sg) chord[0].push_back(s.a);
    TopoDS_Shape acc = sweepPolygonMitre(node, leg, chord, /*makeSolid*/ true, t);
    if (acc.IsNull()) return kNull;                        // reason already set
    for (const RingSeg& s : sg) {
        if (!s.arc) continue;
        const TopoDS_Shape seg = sweptSegmentSolid(node, leg, sn, s, pn, t);
        if (seg.IsNull()) return kNull;                    // reason already set
        if (s.add) {
            BRepAlgoAPI_Fuse fu(acc, seg);
            fu.Build();
            if (!fu.IsDone()) FK_DEFER("arc_ring_fuse_fail");
            acc = fu.Shape();
        } else {
            BRepAlgoAPI_Cut cu(acc, seg);
            cu.Build();
            if (!cu.IsDone()) FK_DEFER("arc_ring_cut_fail");
            acc = cu.Shape();
        }
        if (acc.IsNull()) FK_DEFER("arc_ring_null");
    }
    return acc;
}

// The PLANE the profile lives in, and the origin the closed-form frame is taken
// about. A FACE carries its own surface and that is the exact answer; family F
// is handed a bare WIRE instead, so its plane is read from a supporting circle's
// axis when there is one (exact, and the very thing the arc-axis test compares
// against) and from the vertex ring's Newell normal otherwise. Every ring point
// is checked against the result later, so a wrong guess here DECLINES rather
// than sweeps.
bool profileFrame(const TopoDS_Shape& profile, gp_Dir& pn, gp_Pnt& org, double tol) {
    if (profile.IsNull()) FK_DEFER_F("arc_profile_null");
    if (profile.ShapeType() == TopAbs_FACE) {
        Handle(Geom_Surface) su = BRep_Tool::Surface(TopoDS::Face(profile));
        Handle(Geom_Plane) pl = Handle(Geom_Plane)::DownCast(su);
        if (pl.IsNull()) FK_DEFER_F("arc_profile_surface_not_plane");
        pn = pl->Pln().Axis().Direction();
        org = pl->Pln().Location();
        return true;
    }
    if (profile.ShapeType() != TopAbs_WIRE) FK_DEFER_F("arc_profile_not_face_or_wire");
    const TopoDS_Wire w = TopoDS::Wire(profile);
    std::vector<gp_Pnt> pts;
    bool haveAxis = false;
    for (BRepTools_WireExplorer ex(w); ex.More(); ex.Next()) {
        pts.push_back(BRep_Tool::Pnt(ex.CurrentVertex()));
        if (haveAxis) continue;
        Standard_Real f = 0.0, l = 0.0;
        Handle(Geom_Curve) cv = BRep_Tool::Curve(ex.Current(), f, l);
        while (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_TrimmedCurve)))
            cv = Handle(Geom_TrimmedCurve)::DownCast(cv)->BasisCurve();
        if (!cv.IsNull() && cv->IsKind(STANDARD_TYPE(Geom_Circle))) {
            pn = Handle(Geom_Circle)::DownCast(cv)->Circ().Axis().Direction();
            haveAxis = true;
        }
    }
    if (pts.empty()) FK_DEFER_F("arc_profile_no_vertices");
    org = pts[0];
    if (haveAxis) return true;
    if (pts.size() < 3) FK_DEFER_F("arc_profile_lt3_pts");
    const gp_Vec nv = newell(pts);
    if (nv.Magnitude() <= std::max(tol * tol, 1.0e-18)) FK_DEFER_F("arc_profile_degenerate_ring");
    pn = gp_Dir(nv);
    return true;
}

// FAMILY E, FOURTH PROFILE KIND — a face whose every ring is a full circle or an
// ordered chain of LINE and CIRCULAR-ARC edges, in any combination, swept along
// a mitred polyline spine.
TopoDS_Shape pipeArcChainProfile(const TopoDS_Wire& spine,
                                 const TopoDS_Shape& profile, double t) {
    if (profile.IsNull()) FK_DEFER("arc_profile_null");
    gp_Dir pn;
    gp_Pnt org;
    if (!profileFrame(profile, pn, org, t)) return kNull;   // reason already set

    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;  // reason already set
    std::vector<gp_Dir> sn;
    if (!stationNormals(leg, sn)) return kNull;             // reason already set

    // REQUIRED, not merely for multi-leg spines: the closed-form gate below is
    // V = A * L with A the PERPENDICULAR section area, which is the face area
    // only when the profile plane is normal to the first leg. An oblique
    // single-leg profile is an honest defer here (the polygon path above owns
    // the cases it can take).
    if (std::fabs(std::fabs(gp_Vec(pn).Dot(gp_Vec(leg[0]))) - 1.0) > 1.0e-9)
        FK_DEFER("arc_profile_not_perp_to_leg0");

    struct Ring {
        bool circle = false;
        gp_Pnt c;
        double r = 0.0;
        std::vector<RingSeg> sg;
        double area = 0.0;      // ABSOLUTE
        gp_Pnt g;
    };
    std::vector<Ring> rings;
    for (TopExp_Explorer wx(profile, TopAbs_WIRE); wx.More(); wx.Next()) {
        const TopoDS_Wire w = TopoDS::Wire(wx.Current());
        Ring r;
        gp_Pnt cc;
        gp_Dir ax;
        double rr = 0.0;
        if (fullCircleWire(w, cc, ax, rr, t)) {
            if (!ax.IsParallel(pn, 1.0e-7)) FK_DEFER("arc_circle_axis_not_normal");
            r.circle = true;
            r.c = cc;
            r.r = rr;
            r.area = kArcPi * rr * rr;
            r.g = cc;
        } else {
            if (!arcChainRing(w, pn, r.sg, t)) return kNull;      // reason set
            double sa = 0.0;
            if (!ringAreaCentroid(r.sg, pn, org, sa, r.g, t)) return kNull;
            r.area = std::fabs(sa);
        }
        rings.push_back(r);
    }
    if (rings.empty()) FK_DEFER("arc_no_rings");

    // Every ring must lie IN the profile plane — a wire that is planar on its
    // own but tilted out of the face plane by a healing artefact would cap a
    // solid whose start face is not flat.
    const double planeTol = std::max(t, 1.0e-7);
    for (const Ring& r : rings) {
        if (r.circle) {
            if (std::fabs(vec(org, r.c).Dot(gp_Vec(pn))) > planeTol)
                FK_DEFER("arc_ring_off_profile_plane");
            continue;
        }
        for (const RingSeg& s : r.sg) {
            if (std::fabs(vec(org, s.a).Dot(gp_Vec(pn))) > planeTol)
                FK_DEFER("arc_ring_off_profile_plane");
            if (s.arc && std::fabs(vec(org, s.c).Dot(gp_Vec(pn))) > planeTol)
                FK_DEFER("arc_centre_off_profile_plane");
        }
    }

    // The OUTER ring is the one of greatest area — an EXACT closed form here, so
    // this needs neither a pcurve nor BRepTools::OuterWire. A tie is a defer.
    std::size_t oi = 0;
    for (std::size_t i = 1; i < rings.size(); ++i)
        if (rings[i].area > rings[oi].area) oi = i;
    for (std::size_t i = 0; i < rings.size(); ++i)
        if (i != oi && !(rings[oi].area > rings[i].area)) FK_DEFER("arc_ring_area_tie");

    // ★ THE FOLD PREFLIGHT, and the ONE THING THE A*L GATE CANNOT SEE.
    // BRepGProp::VolumeProperties integrates the divergence theorem over the
    // faces, so a shell that has folded through itself still reports exactly the
    // SIGNED volume — which is exactly A * L, the number the gate below compares
    // against. A section that a sharp mitre carries BACKWARDS through a station
    // plane would therefore pass that gate while being a self-intersecting
    // solid, i.e. precisely the plausible-wrong-shape this engine's contract
    // forbids. So it is refused HERE, before anything is built.
    //
    // travel(p) = ((A_j+1 - p) . n_j+1) / (d_j . n_j+1) is AFFINE, and over the
    // entry station plane (normal n_j) its gradient has magnitude
    //     |n_j x n_j+1| / (d_j . n_j+1)   ==   sin(turn/2) / cos(turn/2)
    // so the least-travelling point of a disc of radius r about c is bounded
    // below by travel(c) - r * that. For a straight-through leg the two station
    // normals coincide, the bound is zero and the test is exactly travel > 0.
    {
        std::vector<gp_Pnt> pt;
        std::vector<double> rad;
        for (const Ring& r : rings) {
            if (r.circle) { pt.push_back(r.c); rad.push_back(r.r); continue; }
            for (const RingSeg& sg : r.sg) {
                pt.push_back(sg.a);
                rad.push_back(0.0);
                if (sg.arc) { pt.push_back(sg.c); rad.push_back(sg.r); }
            }
        }
        const double fwd = std::max(t, 1.0e-9);
        for (std::size_t j = 0; j < leg.size(); ++j) {
            const double denom = gp_Vec(leg[j]).Dot(gp_Vec(sn[j + 1]));
            if (denom <= 1.0e-12) FK_DEFER("arc_preflight_denom");
            const double slope =
                gp_Vec(sn[j]).Crossed(gp_Vec(sn[j + 1])).Magnitude() / denom;
            for (std::size_t i = 0; i < pt.size(); ++i) {
                gp_Pnt nxt;
                double tr = 0.0;
                if (!stationStep(node, leg, sn, j, pt[i], nxt, tr))
                    FK_DEFER("arc_preflight_denom");
                if (!(tr - rad[i] * slope > fwd)) FK_DEFER("arc_section_folds_at_mitre");
                pt[i] = nxt;
            }
        }
    }

    auto build = [&](const Ring& r) -> TopoDS_Shape {
        return r.circle ? sweptDiscSolid(node, leg, sn, r.c, r.r, t)
                        : sweptChainSolid(node, leg, sn, r.sg, pn, t);
    };

    TopoDS_Shape solid = build(rings[oi]);
    if (solid.IsNull()) return kNull;                        // reason already set
    for (std::size_t i = 0; i < rings.size(); ++i) {
        if (i == oi) continue;
        const TopoDS_Shape hole = build(rings[i]);
        if (hole.IsNull()) return kNull;                     // reason already set
        BRepAlgoAPI_Cut cut(solid, hole);
        cut.Build();
        if (!cut.IsDone()) FK_DEFER("arc_hole_cut_fail");
        solid = cut.Shape();
        if (solid.IsNull()) FK_DEFER("arc_hole_cut_null");
    }

    // The fuse/cut seams leave co-planar and co-cylindrical face pairs; unify
    // them so the answer carries the face count a one-piece sweep would.
    ShapeUpgrade_UnifySameDomain uni(solid, Standard_True, Standard_True, Standard_True);
    uni.Build();
    const TopoDS_Shape out = uni.Shape();
    if (out.IsNull()) FK_DEFER("arc_unify_null");

    int nSolid = 0, nShell = 0;
    for (TopExp_Explorer ex(out, TopAbs_SOLID); ex.More(); ex.Next()) ++nSolid;
    for (TopExp_Explorer ex(out, TopAbs_SHELL); ex.More(); ex.Next()) ++nShell;
    if (nSolid != 1) FK_DEFER("arc_not_one_solid");
    if (nShell != 1) FK_DEFER("arc_not_one_shell");

    // ★ THE GATE — vol == A * L, both sides closed form, neither reading the
    // B-rep it is judging. See the banner for the derivation.
    double area = rings[oi].area;
    gp_XYZ mom = rings[oi].g.XYZ() * rings[oi].area;
    for (std::size_t i = 0; i < rings.size(); ++i) {
        if (i == oi) continue;
        area -= rings[i].area;
        mom -= rings[i].g.XYZ() * rings[i].area;
    }
    if (!(area > 0.0)) FK_DEFER("arc_gate_nonpositive_area");
    gp_Pnt g(mom / area);
    double lPath = 0.0;
    for (std::size_t j = 0; j < leg.size(); ++j) {
        const double denom = gp_Vec(leg[j]).Dot(gp_Vec(sn[j + 1]));
        if (denom <= 1.0e-12) FK_DEFER("arc_gate_path_denom");
        const double move = vec(g, node[j + 1]).Dot(gp_Vec(sn[j + 1])) / denom;
        if (!(move > 0.0)) FK_DEFER("arc_gate_path_backwards");
        lPath += move;
        g = g.Translated(move * gp_Vec(leg[j]));
    }
    GProp_GProps gr;
    BRepGProp::VolumeProperties(out, gr);
    const double got = std::fabs(gr.Mass());
    const double want = area * lPath;
    if (!(want > 0.0)) FK_DEFER("arc_gate_zero_expected_volume");
    if (std::fabs(got - want) > 1.0e-7 * want) FK_DEFER("arc_volume_mismatch");
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
    reasonClear();

    // POLYGON profile — the proven mitre transport, always a SOLID (MakePipe
    // fed a FACE returns a solid).
    const TopoDS_Shape poly = sweepPolygonProfile(spine, profile, /*makeSolid*/ true, t);
    if (!poly.IsNull()) return poly;

    // POLYGON outer boundary with CIRCULAR holes — the dominant real-part shape
    // (measured: 307 of the corpus's 600 profile faces).
    const TopoDS_Shape holed = pipePolygonWithCircularHoles(spine, profile, t);
    if (!holed.IsNull()) return holed;

    // CIRCLE profile — the mitre-trimmed cylinder chain. The label is recorded
    // rather than returned on, because the curved-section transport below is a
    // further chance for exactly the profiles that are not circles.
    gp_Pnt c0;
    gp_Dir ax0;
    double r = 0.0;
    const bool isCircle = circleProfile(profile, c0, ax0, r);
    if (!isCircle) reasonAdd("circ_not_circle");
    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;   // reason already set
    if (isCircle) {
        const TopoDS_Shape circ = pipeCircleMitre(node, leg, c0, ax0, r, t);
        if (!circ.IsNull()) return circ;
    }

    // ARC CHAIN, NON-TERMINAL for the same reason as in pipeShell().
    {
        const TopoDS_Shape arc = pipeArcChainProfile(spine, profile, t);
        if (!arc.IsNull()) return arc;
    }

    // ANY OTHER planar section with a curved boundary -- lines and arcs, a spline
    // outline, a circle that is not centred on the spine.
    if (allLineEdges(profile)) return kNull;   // the polygon path already had it
    const TopoDS_Face sec = planarProfileFace(profile);
    if (sec.IsNull()) FK_DEFER("gen_no_planar_section");
    return sweepFaceMitre(node, leg, sec, t);
}

}  // namespace occtloft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
