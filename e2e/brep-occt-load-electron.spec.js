import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('OCCT WASM loads inside the ArchDisc Electron app and exposes B-rep classes', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', err => pageErrors.push(err.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscKernel, null, { timeout: 60000 });

  // ─── Pass 1: introspect binding surface ───────────────────────────────────
  const recon = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    const names = Object.getOwnPropertyNames(oc);
    const pick = (re) => names.filter(n => re.test(n)).sort();

    // Enumerate BRepGProp static methods
    const brepGPropMethods = Object.getOwnPropertyNames(oc.BRepGProp).filter(
      n => typeof oc.BRepGProp[n] === 'function'
    ).sort();

    return {
      hasMakeBox: pick(/^BRepPrimAPI_MakeBox/),
      hasMesh: pick(/^BRepMesh_IncrementalMesh/),
      hasBRepTool: names.includes('BRep_Tool'),
      hasGProp: pick(/^GProp_GProps|^BRepGProp/),
      hasExplorer: pick(/^TopExp_Explorer/),
      hasTopoDS: names.includes('TopoDS'),
      brepGPropMethods,
      total: names.length,
    };
  });

  console.log('OCCT recon (pass 1):', JSON.stringify(recon, null, 2));

  // ─── Pass 2: empirical verification of all 5 items ────────────────────────
  const verified = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    const result = {
      item1_box: { working: null, error: null, overload: null },
      item2_volume: { working: null, error: null, volumeMM3: null, calls: null },
      item3_topo: { working: null, error: null, faceCount: null, edgeCount: null, calls: null },
      item4_bbox: { working: null, error: null, min: null, max: null, calls: null },
      item5_tess: { working: null, error: null, nodeCount: null, triCount: null, calls: null },
    };

    // ── helpers ──────────────────────────────────────────────────────────────
    function tryMakeBox() {
      // Per type declarations:
      //   _1 = no-arg default
      //   _2 = (dx, dy, dz)
      //   _3 = (P, dx, dy, dz)
      //   _4 = (P1, P2)
      //   _5 = (Axes, dx, dy, dz)
      const attempts = [
        { name: 'BRepPrimAPI_MakeBox_2', fn: () => new oc.BRepPrimAPI_MakeBox_2(10, 10, 10) },
        { name: 'BRepPrimAPI_MakeBox_1', fn: () => { const b = new oc.BRepPrimAPI_MakeBox_1(); b.Init_1(10,10,10); return b; } },
        { name: 'BRepPrimAPI_MakeBox_3', fn: () => new oc.BRepPrimAPI_MakeBox_3(new oc.gp_Pnt_1(0,0,0), 10, 10, 10) },
      ];
      for (const { name, fn } of attempts) {
        try {
          const box = fn();
          const shape = box.Shape();
          if (shape && !shape.IsNull()) {
            return { box, shape, overload: name };
          }
          box.delete();
        } catch (e) {
          // try next
        }
      }
      return null;
    }

    // ── Item 1: Box constructor ───────────────────────────────────────────────
    let boxResult = null;
    try {
      boxResult = tryMakeBox();
      if (boxResult) {
        result.item1_box.working = true;
        result.item1_box.overload = boxResult.overload;
        result.item1_box.error = null;
      } else {
        result.item1_box.working = false;
        result.item1_box.error = 'all overloads failed or returned null shape';
      }
    } catch (e) {
      result.item1_box.working = false;
      result.item1_box.error = String(e);
    }

    if (!boxResult) {
      return result;
    }

    const { box, shape } = boxResult;

    // ── Item 3: Face/edge count (needs shape, do before volume) ──────────────
    try {
      // TopExp_Explorer_2(S, ToFind, ToAvoid)
      // TopAbs_ShapeEnum values are objects like { value: N }
      const faceEnum = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const edgeEnum = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
      const shapeEnum = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

      // Count faces
      const faceExp = new oc.TopExp_Explorer_2(shape, faceEnum, shapeEnum);
      let faceCount = 0;
      const faces = [];
      for (; faceExp.More(); faceExp.Next()) {
        const faceShape = faceExp.Current();
        const face = oc.TopoDS.Face_1(faceShape);
        faces.push(face);
        faceCount++;
      }
      faceExp.delete();

      // Count edges
      const edgeExp = new oc.TopExp_Explorer_2(shape, edgeEnum, shapeEnum);
      let edgeCount = 0;
      for (; edgeExp.More(); edgeExp.Next()) {
        edgeCount++;
      }
      edgeExp.delete();

      // NOTE: edgeCount = 24 for a 10mm box (12 unique edges × 2 adjacent faces each).
      // TopExp_Explorer does NOT deduplicate shared edges — call .IsSame() to deduplicate.
      result.item3_topo.working = true;
      result.item3_topo.faceCount = faceCount;
      result.item3_topo.edgeCount = edgeCount;
      result.item3_topo.edgeNote = '24 hits = 12 unique edges x2 (shared between adjacent faces); deduplicate with .IsSame()';
      result.item3_topo.calls = [
        'const faceExp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)',
        'for (; faceExp.More(); faceExp.Next()) { const face = oc.TopoDS.Face_1(faceExp.Current()); }',
        'const edgeExp = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)',
      ];

      // Clean up faces
      for (const f of faces) f.delete();
    } catch (e) {
      result.item3_topo.working = false;
      result.item3_topo.error = String(e);
    }

    // ── Item 2: Volume measurement ────────────────────────────────────────────
    try {
      // BRepGProp.VolumeProperties_1(S, VProps, OnlyClosed, SkipShared, UseTriangulation)
      const props = new oc.GProp_GProps_1();
      oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
      const vol = props.Mass();
      props.delete();

      result.item2_volume.working = true;
      result.item2_volume.volumeMM3 = vol;
      result.item2_volume.calls = [
        'const props = new oc.GProp_GProps_1()',
        'oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false)',
        'const volume = props.Mass()',
      ];
    } catch (e1) {
      // Try VolumeProperties_2 (returns epsilon, Eps param)
      try {
        const props = new oc.GProp_GProps_1();
        oc.BRepGProp.VolumeProperties_2(shape, props, 1e-6, false, false);
        const vol = props.Mass();
        props.delete();

        result.item2_volume.working = true;
        result.item2_volume.volumeMM3 = vol;
        result.item2_volume.calls = [
          'const props = new oc.GProp_GProps_1()',
          'oc.BRepGProp.VolumeProperties_2(shape, props, 1e-6, false, false)',
          'const volume = props.Mass()',
        ];
      } catch (e2) {
        result.item2_volume.working = false;
        result.item2_volume.error = `_1: ${String(e1)}; _2: ${String(e2)}`;
      }
    }

    // ── Item 4: Bounding box ──────────────────────────────────────────────────
    try {
      const bbox = new oc.Bnd_Box_1();
      // BRepBndLib.Add(S, B, useTriangulation)
      oc.BRepBndLib.Add(shape, bbox, true);
      const pmin = bbox.CornerMin();
      const pmax = bbox.CornerMax();
      const minXYZ = { x: pmin.X(), y: pmin.Y(), z: pmin.Z() };
      const maxXYZ = { x: pmax.X(), y: pmax.Y(), z: pmax.Z() };
      pmin.delete();
      pmax.delete();
      bbox.delete();

      result.item4_bbox.working = true;
      result.item4_bbox.min = minXYZ;
      result.item4_bbox.max = maxXYZ;
      result.item4_bbox.calls = [
        'const bbox = new oc.Bnd_Box_1()',
        'oc.BRepBndLib.Add(shape, bbox, true)',
        'const pmin = bbox.CornerMin(); const pmax = bbox.CornerMax()',
        'pmin.X(), pmin.Y(), pmin.Z(), pmax.X(), pmax.Y(), pmax.Z()',
      ];
    } catch (e) {
      // Try AddOptimal
      try {
        const bbox = new oc.Bnd_Box_1();
        oc.BRepBndLib.AddOptimal(shape, bbox, false, false);
        const pmin = bbox.CornerMin();
        const pmax = bbox.CornerMax();
        const minXYZ = { x: pmin.X(), y: pmin.Y(), z: pmin.Z() };
        const maxXYZ = { x: pmax.X(), y: pmax.Y(), z: pmax.Z() };
        pmin.delete();
        pmax.delete();
        bbox.delete();

        result.item4_bbox.working = true;
        result.item4_bbox.min = minXYZ;
        result.item4_bbox.max = maxXYZ;
        result.item4_bbox.calls = [
          'const bbox = new oc.Bnd_Box_1()',
          'oc.BRepBndLib.AddOptimal(shape, bbox, false, false)',
          'const pmin = bbox.CornerMin(); const pmax = bbox.CornerMax()',
        ];
      } catch (e2) {
        result.item4_bbox.working = false;
        result.item4_bbox.error = `Add: ${String(e)}; AddOptimal: ${String(e2)}`;
      }
    }

    // ── Item 5: Tessellation ──────────────────────────────────────────────────
    try {
      // BRepMesh_IncrementalMesh_2(shape, linDeflection, isRelative, angDeflection, isInParallel)
      const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
      mesh.delete();

      // Walk faces and read triangulation
      const loc = new oc.TopLoc_Location_1();
      const faceEnum = oc.TopAbs_ShapeEnum.TopAbs_FACE;
      const shapeEnum = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

      let totalNodes = 0;
      let totalTris = 0;
      let sampleTriIndices = null;
      let tessWorking = false;
      let tessError = null;

      // Try with Poly_MeshPurpose — may be a numeric enum, try value 0
      // BRep_Tool.Triangulation(face, location, meshPurpose)
      let meshPurposeValue = null;
      if (oc.Poly_MeshPurpose && typeof oc.Poly_MeshPurpose === 'object') {
        // Check for known enum value names
        const pmKeys = Object.keys(oc.Poly_MeshPurpose);
        meshPurposeValue = pmKeys.length > 0 ? oc.Poly_MeshPurpose[pmKeys[0]] : 0;
      }

      const faceExp2 = new oc.TopExp_Explorer_2(shape, faceEnum, shapeEnum);
      for (; faceExp2.More(); faceExp2.Next()) {
        const faceShape = faceExp2.Current();
        const face = oc.TopoDS.Face_1(faceShape);

        let handleTri = null;
        let triErr = null;

        // Attempt 1: with loc + meshPurpose arg (0 = any)
        try {
          handleTri = oc.BRep_Tool.Triangulation(face, loc, 0);
        } catch (e) {
          triErr = `Triangulation(face,loc,0): ${e}`;
        }

        if (!handleTri || handleTri.IsNull()) {
          // Attempt 2: maybe a different overload — check if Triangulations is accessible
          try {
            // Some builds expose a 2-arg Triangulation (face, loc) variant via prototype
            handleTri = oc.BRep_Tool.Triangulation(face, loc);
          } catch (e) {
            triErr = (triErr || '') + `; Triangulation(face,loc): ${e}`;
          }
        }

        if (handleTri && !handleTri.IsNull()) {
          const tri = handleTri.get();
          const nb = tri.NbNodes();
          const nt = tri.NbTriangles();
          totalNodes += nb;
          totalTris += nt;
          tessWorking = true;

          // Sample first triangle
          if (sampleTriIndices === null && nt > 0) {
            const t = tri.Triangle(1);
            try {
              sampleTriIndices = [t.Value(1), t.Value(2), t.Value(3)];
            } catch (e) {
              // Try Get — pass wrapper objects (out-params not directly supported in embind)
              sampleTriIndices = ['Value(1,2,3) failed: ' + String(e)];
            }
          }
          handleTri.delete();
        } else {
          if (!tessWorking) tessError = triErr || 'null/IsNull handle';
        }
        face.delete();
      }
      faceExp2.delete();
      loc.delete();

      result.item5_tess.working = tessWorking;
      result.item5_tess.nodeCount = totalNodes;
      result.item5_tess.triCount = totalTris;
      result.item5_tess.sampleTriIndices = sampleTriIndices;
      result.item5_tess.error = tessError;
      result.item5_tess.calls = [
        'new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false)',
        'const loc = new oc.TopLoc_Location_1()',
        'const handleTri = oc.BRep_Tool.Triangulation(face, loc, 0)',
        'const tri = handleTri.get()',
        'tri.NbNodes(), tri.NbTriangles()',
        'const t = tri.Triangle(i); t.Value(1), t.Value(2), t.Value(3)',
      ];
    } catch (e) {
      result.item5_tess.working = false;
      result.item5_tess.error = String(e);
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    shape.delete();
    box.delete();

    return result;
  });

  // ─── Pass 3: I2 — empirical TopAbs_Orientation enum representation ──────────
  const orientationRecon = await win.evaluate(async () => {
    const oc = await window.__archdiscKernel.getOCCT();
    // Build a box and get a face so we can call Orientation_1().
    const box = new oc.BRepPrimAPI_MakeBox_2(10, 10, 10);
    const shape = box.Shape();
    const mesh = new oc.BRepMesh_IncrementalMesh_2(shape, 0.1, false, 0.5, false);
    mesh.delete();
    const faceExp = new oc.TopExp_Explorer_2(
      shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    );
    const face = oc.TopoDS.Face_1(faceExp.Current());
    faceExp.delete();
    const oriVal = face.Orientation_1();
    const reversedEnum = oc.TopAbs_Orientation.TopAbs_REVERSED;
    const forwardEnum = oc.TopAbs_Orientation.TopAbs_FORWARD;
    const result = {
      oriValType: typeof oriVal,
      oriValRaw: JSON.stringify(oriVal),
      oriValDotValue: (oriVal && typeof oriVal === 'object') ? oriVal.value : oriVal,
      reversedEnumType: typeof reversedEnum,
      reversedEnumRaw: JSON.stringify(reversedEnum),
      reversedEnumDotValue: (reversedEnum && typeof reversedEnum === 'object') ? reversedEnum.value : reversedEnum,
      forwardEnumDotValue: (forwardEnum && typeof forwardEnum === 'object') ? forwardEnum.value : forwardEnum,
      strictEqTest: oriVal === reversedEnum,
      dotValueEqTest: (oriVal && reversedEnum && typeof oriVal === 'object')
        ? oriVal.value === reversedEnum.value
        : oriVal === reversedEnum,
    };
    face.delete();
    shape.delete();
    box.delete();
    return result;
  });
  console.log('I2 orientation recon:', JSON.stringify(orientationRecon, null, 2));

  // Write combined output
  const fullOutput = { ...recon, verified, orientationRecon };
  fs.mkdirSync(path.join(__dirname, '..', 'docs', 'superpowers', 'notes'), { recursive: true });
  fs.writeFileSync(
    path.join(__dirname, '..', 'docs', 'superpowers', 'notes', 'occt-api-A0-recon.json'),
    JSON.stringify(fullOutput, null, 2),
  );
  console.log('OCCT recon (full):', JSON.stringify(fullOutput, null, 2));

  // ─── Assertions ────────────────────────────────────────────────────────────
  // Binding surface
  expect(recon.hasMakeBox.length).toBeGreaterThan(0);
  expect(recon.hasMesh.length).toBeGreaterThan(0);
  expect(recon.hasBRepTool).toBe(true);
  expect(recon.total).toBeGreaterThan(100);

  // Item 1: box builds
  expect(verified.item1_box.working, `box error: ${verified.item1_box.error}`).toBe(true);

  // Item 2: volume ~1000 mm³
  expect(verified.item2_volume.working, `volume error: ${verified.item2_volume.error}`).toBe(true);
  expect(Math.abs(verified.item2_volume.volumeMM3 - 1000)).toBeLessThan(1);

  // Item 3: 6 faces; edges — TopExp_Explorer visits each edge once per owning shape in the
  // topology tree, so a box returns 24 edge hits (12 unique edges × 2 adjacent faces each).
  // Unique edges require IsSame deduplication; the raw explorer count is 24.
  expect(verified.item3_topo.working, `topo error: ${verified.item3_topo.error}`).toBe(true);
  expect(verified.item3_topo.faceCount).toBe(6);
  expect(verified.item3_topo.edgeCount).toBe(24); // 12 unique edges, visited 2× each

  // Item 4: bounding box min≈(0,0,0) max≈(10,10,10)
  expect(verified.item4_bbox.working, `bbox error: ${verified.item4_bbox.error}`).toBe(true);
  expect(Math.abs(verified.item4_bbox.min.x)).toBeLessThan(0.01);
  expect(Math.abs(verified.item4_bbox.min.y)).toBeLessThan(0.01);
  expect(Math.abs(verified.item4_bbox.min.z)).toBeLessThan(0.01);
  expect(Math.abs(verified.item4_bbox.max.x - 10)).toBeLessThan(0.01);
  expect(Math.abs(verified.item4_bbox.max.y - 10)).toBeLessThan(0.01);
  expect(Math.abs(verified.item4_bbox.max.z - 10)).toBeLessThan(0.01);

  // Item 5: tessellation produces triangles
  expect(verified.item5_tess.working, `tess error: ${verified.item5_tess.error}`).toBe(true);
  expect(verified.item5_tess.triCount).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
  await app.close();
});
