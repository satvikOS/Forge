    // ================================================================= case 6
    // A CYLINDRICAL face — the surface type that WAS the entire deletion bucket.
    //
    // WHY THIS CASE EXISTS. test/corpus_ab_coverage.cpp measured this engine at
    // 67.8% against OCCT's 100.0% over 600 real parts, a deletion bucket of 193.
    // Instrumenting the native arm with thickenLastDeferReason() attributed ALL
    // 193 to the single reason "a face is not a Geom_Plane", and a surface census
    // of the picked face found every one of the 193 to be a CYLINDER (the corpus
    // contains no third surface type in that slot: 407 Plane, 193 Cylinder). So
    // the deletion bucket was one missing surface type, and this is the case that
    // pins the engine that closes it.
    //
    // CLOSED FORM. Skinning the full lateral face of a cylinder of radius R and
    // height h by |t| gives the coaxial annular tube between R and R + s*t, where
    // s is +1 when the face's outward normal points away from the axis and -1
    // when it points at it. BRepPrimAPI_MakeCylinder's lateral face is FORWARD
    // with the outward normal, so t = +2 GROWS it:
    //     V = pi*((R+t)^2 - R^2)*h = pi*(49 - 25)*10 = 240 pi
    //     V = pi*(R^2 - (R-t)^2)*h = pi*(25 -  9)*10 = 160 pi
    // Both are asserted against live OCCT AND against the closed form, so a
    // kernel and a formula would both have to be wrong in the same direction.
    {
        const TopoDS_Shape cyl = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        TopoDS_Face lateral;
        for (TopExp_Explorer ex(cyl, TopAbs_FACE); ex.More(); ex.Next()) {
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            GProp_GProps gp;
            BRepGProp::SurfaceProperties(f, gp);
            if (std::fabs(gp.Mass() - 2.0 * kPi * 5.0 * 10.0) < 1.0e-6) lateral = f;
        }
        ok(!lateral.IsNull(), "case6 : found the cylinder's lateral face");
        if (!lateral.IsNull()) {
            const double vPlus = abCase("case6 cylinder lateral t=+2", lateral, T);
            if (vPlus > 0.0)
                okNear(vPlus, kPi * (49.0 - 25.0) * 10.0, 1.0e-7 * kPi * 240.0,
                       "case6 : CLOSED FORM pi*((R+t)^2-R^2)*h = 240 pi");
            const double vMinus = abCase("case6 cylinder lateral t=-2", lateral, -T);
            if (vMinus > 0.0)
                okNear(vMinus, kPi * (25.0 - 9.0) * 10.0, 1.0e-7 * kPi * 160.0,
                       "case6 : CLOSED FORM pi*(R^2-(R-t)^2)*h = 160 pi");

            // SURFACE INVENTORY, as an explicit claim about each side. The whole
            // reason the engine builds this body out of canonical primitives
            // rather than revolving its axial section is that a revolve emits
            // Geom_SurfaceOfRevolution everywhere: MEASURED on corpus part
            // ho1002 that came back 4F/8E where OCCT returns 4F/6E. Pinning the
            // inventory is what stops that regression coming back silently.
            TopoDS_Shape occt6;
            if (occtThicken(lateral, T, occt6)) {
                const Obs na = observe(forge::occtthicken::thickenShell(lateral, T));
                const Obs ob = observe(occt6);
                std::printf("  [case6] surface types  native plane/cyl/other = %d/%d/%d ;"
                            "  OCCT = %d/%d/%d\n",
                            na.nPlane, na.nCyl, na.nOther, ob.nPlane, ob.nCyl, ob.nOther);
                okInt(na.nCyl, 2, "case6 : native emits exactly TWO cylindrical walls");
                okInt(na.nPlane, 2, "case6 : native emits exactly TWO planar annular caps");
                okInt(na.nOther, 0, "case6 : native emits NO non-analytic face");
                okInt(ob.nCyl, 2, "case6 : OCCT emits exactly TWO cylindrical walls");
                okInt(ob.nPlane, 2, "case6 : OCCT emits exactly TWO planar annular caps");
                okInt(ob.nOther, 0, "case6 : OCCT emits NO non-analytic face");
            }
        }
    }

