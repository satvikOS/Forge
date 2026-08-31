// ===========================================================================
// PATH C — ONE CYLINDRICAL FACE, trimmed to its FULL parametric rectangle.
// ===========================================================================
// WHY THIS PATH EXISTS, AND WHY IT IS EXACTLY THIS SHAPE. The corpus coverage
// A/B (test/corpus_ab_coverage.cpp, 600 parts) measured this engine at 67.8%
// against OCCT's 100.0%, a deletion bucket of 193 parts. Instrumenting the
// native arm with thickenLastDeferReason() attributed ALL 193 to ONE reason,
// "a face is not a Geom_Plane" — and a surface census of the picked face over
// the same 600 parts found all 193 of them to be a CYLINDER (407 Plane / 193
// Cylinder, no third type anywhere in the corpus). So the whole deletion
// bucket was one missing surface type, not a scatter of causes.
//
// THE CLOSED FORM. A cylindrical patch of radius R over the parametric
// rectangle [u0,u1] x [v0,v1] has outward normal +e_r, so offsetting it by a
// signed t gives the COAXIAL cylinder of radius R' = R + s*t, where s = +1 if
// the face's outward normal points away from the axis and -1 if it points at
// it. The body between the two patches, closed by the two annular end rings
// (and, when du < 2pi, by the two planar side walls), is a solid of REVOLUTION:
// revolve the axial-section rectangle [Rlo,Rhi] x [v0,v1] about the axis
// through du. Its volume is exactly
//         V = 0.5 * du * (Rhi^2 - Rlo^2) * dv
// and its area exactly
//         A = (Rlo + Rhi)*du*dv + du*(Rhi^2 - Rlo^2) + (du<2pi ? 2*(Rhi-Rlo)*dv : 0).
//
// ★ MEASURED AGAINST LIVE OCCT, NOT ASSERTED. The same BRepOffset_MakeOffset
//   call src/Features.cpp makes was run on the picked face of all 193 corpus
//   parts and its volume compared with BOTH candidate closed forms:
//       face REVERSED (119 parts) -> OCCT's volume == the R-t form, rel < 1e-9
//       face FORWARD   (51 parts) -> OCCT's volume == the R+t form, rel < 1e-9
//       the remaining  (23 parts) -> NEITHER form, rel 2e-2 .. 9e-2
//   The 170 that match are exactly the parts that pass the RECTANGLE
//   CERTIFICATE below; the 23 that do not are exactly the ones that fail it.
//   So the certificate is not a heuristic guard — it is the precise predicate
//   separating the inputs on which this closed form IS OCCT's answer from the
//   ones on which it is not, and the sign rule was READ OFF that measurement
//   rather than reasoned about.
//
// THE RECTANGLE CERTIFICATE, and why it is exact rather than approximate. A
// cylindrical face trims the surface to some UV region D contained in the
// adaptor's box [u0,u1] x [v0,v1], and its area is exactly R * area(D). So
//         area(face) == R * du * dv   <=>   D IS the whole rectangle,
// with strict inequality otherwise — a face with an inner loop (a hole cut in
// the tube wall), or any non-rectangular trim, has strictly less area. One
// area comparison therefore proves the trim is the full rectangle, which is the
// precondition the closed form needs. This is the same style of certificate the
// coplanar path uses (prism volume == area * thickness).
//
// HONEST DEFER, as everywhere else in this file: a non-rectangular trim, a
// non-positive or axis-touching offset radius, a degenerate frame, a revolve
// that fails, or a result that misses either closed form or leaves the
// [Rlo,Rhi] x [v0,v1] envelope.
//
// DROP HYGIENE unchanged: gp_/Geom_ (TKMath/TKG3d), BRepBuilderAPI_MakePolygon
// + MakeFace (TKTopAlgo), and forge::occtRevol (OcctPrimBuilder.cpp, itself
// TKPrim-free). NO BRepOffset*, NO BRepOffsetAPI*, NO BRepPrimAPI* symbol.
TopoDS_Shape thickenSingleCylinder(const TopoDS_Face& f, double t) {
    const Handle(Geom_Surface) s = basisSurface(BRep_Tool::Surface(f));
    Handle(Geom_CylindricalSurface) cs = Handle(Geom_CylindricalSurface)::DownCast(s);
    if (cs.IsNull()) return defer("a face is not a Geom_Plane");   // not this path

    const gp_Cylinder cy = cs->Cylinder();
    const double R = cy.Radius();
    if (!(R > 1.0e-12)) return defer("cylindrical path: the radius is not positive");

    double u0 = 0.0, u1 = 0.0, v0 = 0.0, v1 = 0.0;
    BRepTools::UVBounds(f, u0, u1, v0, v1);
    const double du = u1 - u0, dv = v1 - v0;
    if (!(du > 1.0e-12) || !(dv > 1.0e-12))
        return defer("cylindrical path: the UV box is degenerate");
    if (du > kTwoPi + 1.0e-9)
        return defer("cylindrical path: the u-span exceeds one full turn");

    // ---- the RECTANGLE CERTIFICATE ---------------------------------------
    const double want = R * du * dv;
    const double got = faceArea(f);
    if (!(std::fabs(got - want) <= 1.0e-6 * want))
        return defer("cylindrical path: the face is not the full parametric "
                     "rectangle (a trimmed or holed patch)");

    // ---- which side is OUT: derived from the surface, not assumed --------
    const gp_Ax3 pos = cy.Position();
    const gp_Dir Zd = pos.Direction();
    const gp_Dir Xd = pos.XDirection();
    const gp_Dir Yd = pos.YDirection();
    const gp_Pnt loc = pos.Location();
    const double uc = 0.5 * (u0 + u1), vc = 0.5 * (v0 + v1);
    gp_Pnt pc;
    gp_Vec dU, dV;
    cs->D1(uc, vc, pc, dU, dV);
    const gp_Vec nv = dU.Crossed(dV);
    if (nv.Magnitude() < 1.0e-12)
        return defer("cylindrical path: the parametrisation is degenerate");
    gp_Dir n(nv);
    if (f.Orientation() == TopAbs_REVERSED) n.Reverse();
    // e_r at the patch centre, from the surface point itself (no handedness
    // assumption): the component of (pc - loc) orthogonal to the axis.
    gp_Vec rad(loc, pc);
    rad -= gp_Vec(Zd) * rad.Dot(gp_Vec(Zd));
    if (rad.Magnitude() < 1.0e-12)
        return defer("cylindrical path: the patch centre lies on the axis");
    const double side = gp_Vec(n).Dot(rad) > 0.0 ? 1.0 : -1.0;

    const double Rp = R + side * t;
    const double Rlo = std::min(R, Rp), Rhi = std::max(R, Rp);
    if (!(Rlo > 1.0e-9 * Rhi))
        return defer("cylindrical path: the offset radius reaches the axis");

    // ---- the axial-section rectangle, revolved ---------------------------
    // The section is taken in the half-plane at u = u0 so a PARTIAL sweep starts
    // where the face starts. The revolve axis is +Z for a right-handed frame and
    // -Z for a left-handed one, because u increases from Xd toward Yd in BOTH
    // cases while occtRevol always sweeps right-handed about the axis it is
    // given; for the full-turn case the two agree and the choice is inert.
    const gp_Vec er0 = gp_Vec(Xd) * std::cos(u0) + gp_Vec(Yd) * std::sin(u0);
    if (std::fabs(er0.Magnitude() - 1.0) > 1.0e-9)
        return defer("cylindrical path: the reference frame is not orthonormal");
    const bool rightHanded = gp_Vec(Zd).Dot(gp_Vec(Xd).Crossed(gp_Vec(Yd))) > 0.0;
    const gp_Ax1 axis(loc, rightHanded ? Zd : gp_Dir(gp_Vec(Zd) * -1.0));

    const gp_Vec az = gp_Vec(Zd);
    const gp_Pnt pA = loc.Translated(er0 * Rlo + az * v0);
    const gp_Pnt pB = loc.Translated(er0 * Rhi + az * v0);
    const gp_Pnt pC = loc.Translated(er0 * Rhi + az * v1);
    const gp_Pnt pD = loc.Translated(er0 * Rlo + az * v1);
    BRepBuilderAPI_MakePolygon mp(pA, pB, pC, pD, Standard_True);
    if (!mp.IsDone()) return defer("cylindrical path: the section wire did not close");
    BRepBuilderAPI_MakeFace mkf(mp.Wire(), Standard_True);
    if (!mkf.IsDone()) return defer("cylindrical path: the section face could not be built");

    TopoDS_Shape out;
    try {
        out = ::forge::occtRevol(mkf.Face(), axis, std::min(du, kTwoPi));
    } catch (const std::exception&) {
        return defer("cylindrical path: the revolve failed");
    }
    if (out.IsNull()) return defer("cylindrical path: the revolve produced a null shape");

    // ---- self-checks: a VECTOR of observables, never volume alone --------
    int nSolid = 0, nShell = 0;
    for (TopExp_Explorer ex(out, TopAbs_SOLID); ex.More(); ex.Next()) ++nSolid;
    for (TopExp_Explorer ex(out, TopAbs_SHELL); ex.More(); ex.Next()) ++nShell;
    if (nSolid != 1 || nShell != 1)
        return defer("cylindrical path: the revolve is not exactly one solid with one shell");

    const bool full = du >= kTwoPi - 1.0e-9;
    const double wantVol = 0.5 * du * (Rhi * Rhi - Rlo * Rlo) * dv;
    const double wantArea = (Rlo + Rhi) * du * dv + du * (Rhi * Rhi - Rlo * Rlo)
                          + (full ? 0.0 : 2.0 * (Rhi - Rlo) * dv);
    GProp_GProps vp, ap;
    BRepGProp::VolumeProperties(out, vp);
    BRepGProp::SurfaceProperties(out, ap);
    if (!(std::fabs(std::fabs(vp.Mass()) - wantVol) <= 1.0e-6 * wantVol))
        return defer("cylindrical path: volume != the annulus closed form");
    if (!(std::fabs(ap.Mass() - wantArea) <= 1.0e-6 * wantArea))
        return defer("cylindrical path: area != the annulus closed form");

    // CONTAINMENT. Volume and area are two numbers and this repo has four
    // measured cases where a wrong solid matched the right number, so the third
    // observable is geometric: every vertex must sit in the [Rlo,Rhi] annulus
    // and inside the axial band. No coincidence of two masses can fake this.
    const double rTol = 1.0e-6 * std::max(1.0, Rhi);
    const double zTol = 1.0e-6 * std::max(1.0, std::fabs(v0) + dv);
    for (TopExp_Explorer ex(out, TopAbs_VERTEX); ex.More(); ex.Next()) {
        const gp_Pnt p = BRep_Tool::Pnt(TopoDS::Vertex(ex.Current()));
        gp_Vec q(loc, p);
        const double z = q.Dot(az);
        const double rr = (q - az * z).Magnitude();
        if (rr < Rlo - rTol || rr > Rhi + rTol || z < v0 - zTol || z > v1 + zTol)
            return defer("cylindrical path: a vertex left the annulus envelope");
    }
    return out;
}
