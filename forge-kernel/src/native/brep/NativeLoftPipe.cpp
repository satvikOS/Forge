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
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
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
#include <Standard_Type.hxx>
#include <Geom_Curve.hxx>
#include <Geom_Line.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Shell.hxx>
#include <TopoDS_Solid.hxx>
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

}  // namespace

TopoDS_Shape pipeShell(const TopoDS_Wire& spine,
                       const TopoDS_Shape& profile,
                       const std::vector<TopoDS_Wire>& guides,
                       bool makeSolid, double tol) {
    // There is no native guided pipe-shell anywhere in the tree. Say so.
    reasonClear();
    if (!guides.empty()) FK_DEFER("guides_present");
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

    // CIRCLE profile — the mitre-trimmed cylinder chain.
    gp_Pnt c0;
    gp_Dir ax0;
    double r = 0.0;
    if (!circleProfile(profile, c0, ax0, r)) FK_DEFER("circ_not_circle");
    std::vector<gp_Pnt> node;
    std::vector<gp_Dir> leg;
    if (!spinePolyline(spine, t, node, leg)) return kNull;   // reason already set
    return pipeCircleMitre(node, leg, c0, ax0, r, t);
}

}  // namespace occtloft
}  // namespace forge

#endif  // FORGE_NATIVE_BREP
