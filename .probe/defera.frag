    {
        // (a) a cylindrical face that is NOT the full parametric rectangle.
        //
        // THIS CONTROL REPLACES, AND DOES NOT RELAX, THE ONE THAT WAS HERE. It
        // used to feed the lateral face of a cylinder and require a DECLINE with
        // the reason "a face is not a Geom_Plane". That face is now BUILT — case 6
        // asserts the result against live OCCT and against the closed form — so
        // the old assertion is not a weakened test but an obsolete one, and the
        // capability it guarded (a curved face must never be silently approximated)
        // is guarded here instead, on the input the engine still declines.
        //
        // WHY THIS INPUT. The closed form the cylindrical path uses is exact only
        // when the face is trimmed to its WHOLE parametric rectangle. MEASURED on
        // the corpus: over the 193 cylindrical parts, the 170 that pass the
        // rectangle certificate match OCCT's volume to rel < 1e-9, and the 23 that
        // fail it miss BOTH candidate closed forms by 2e-2 .. 9e-2. So a holed
        // patch is exactly the input on which the formula stops being OCCT's
        // answer, and it must decline rather than return a plausible wrong solid.
        // A window cut out of the wall reduces the area below R*du*dv, which is
        // precisely what the certificate detects.
        const TopoDS_Shape tube = BRepPrimAPI_MakeCylinder(5.0, 10.0).Shape();
        TopoDS_Face lateral;
        for (TopExp_Explorer ex(tube, TopAbs_FACE); ex.More(); ex.Next()) {
            const TopoDS_Face f = TopoDS::Face(ex.Current());
            GProp_GProps gp;
            BRepGProp::SurfaceProperties(f, gp);
            if (std::fabs(gp.Mass() - 2.0 * kPi * 5.0 * 10.0) < 1.0e-6) lateral = f;
        }
        ok(!lateral.IsNull(), "defer(a) : found the cylinder's lateral face");
        // Cut a window out of the wall: the same lateral surface, trimmed to a
        // sub-rectangle in v. Its area is strictly less than R * du * dv over the
        // ORIGINAL v range, so the certificate must reject it... except that a
        // sub-rectangle IS a rectangle. So the window is punched as an inner loop
        // instead: build the face from the surface with an added hole wire.
        Handle(Geom_CylindricalSurface) cs =
            new Geom_CylindricalSurface(gp_Ax3(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1),
                                               gp_Dir(1, 0, 0)), 5.0);
        BRepBuilderAPI_MakeFace mkOuter(cs, 0.0, 2.0 * kPi, 0.0, 10.0, 1.0e-7);
        ok(mkOuter.IsDone(), "defer(a) : the untrimmed lateral face rebuilt");
        if (mkOuter.IsDone()) {
            // A rectangular hole in (u,v): u in [0.5, 1.5], v in [3, 7].
            BRepBuilderAPI_MakePolygon holeUV;
            const double uu[4] = {0.5, 1.5, 1.5, 0.5};
            const double vv[4] = {3.0, 3.0, 7.0, 7.0};
            for (int i = 0; i < 4; ++i)
                holeUV.Add(gp_Pnt(5.0 * std::cos(uu[i]), 5.0 * std::sin(uu[i]), vv[i]));
            holeUV.Close();
            ok(holeUV.IsDone(), "defer(a) : the hole wire closed");
            if (holeUV.IsDone()) {
                BRepBuilderAPI_MakeFace mkHoled(mkOuter.Face());
                mkHoled.Add(TopoDS::Wire(holeUV.Wire().Reversed()));
                if (mkHoled.IsDone()) {
                    BRepLib::BuildCurves3d(mkHoled.Face());
                    const TopoDS_Shape got =
                        forge::occtthicken::thickenShell(mkHoled.Face(), T);
                    ok(got.IsNull(),
                       "defer(a) : a HOLED cylindrical patch is DECLINED");
                    okReason("cylindrical path: the face is not the full parametric "
                             "rectangle (a trimmed or holed patch)", "defer(a)");
                }
            }
        }
    }
    {
        // (a2) a curved face that is NEITHER a plane NOR a cylinder still declines
        // with the original reason — the engine gained ONE surface type, not a
        // licence to approximate every one. A sphere's face is the control.
        const TopoDS_Shape sph = BRepPrimAPI_MakeSphere(5.0).Shape();
        TopoDS_Face sf;
        for (TopExp_Explorer ex(sph, TopAbs_FACE); ex.More(); ex.Next())
            sf = TopoDS::Face(ex.Current());
        ok(!sf.IsNull(), "defer(a2) : found the sphere's face");
        if (!sf.IsNull()) {
            ok(forge::occtthicken::thickenShell(sf, T).IsNull(),
               "defer(a2) : a SPHERICAL face is DECLINED");
            okReason("a face is not a Geom_Plane", "defer(a2)");
        }
    }
