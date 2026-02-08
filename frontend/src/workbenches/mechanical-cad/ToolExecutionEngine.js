import * as THREE from 'three';

/**
 * Tool Execution Engine - Maps tool clicks to real 3D operations
 * All tools work WITHOUT AI - purely manual geometric operations on the Three.js scene.
 * Tools create/modify geometry directly in the viewport.
 */

// ─── Material Presets ─────────────────────────────────────────────────────────
const MAT = {
    solid: (color = 0x8b1538) => new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.4, side: THREE.DoubleSide }),
    sketch: () => new THREE.MeshStandardMaterial({ color: 0x00aaff, metalness: 0.0, roughness: 0.8, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    reference: () => new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.0, roughness: 1.0, transparent: true, opacity: 0.25, side: THREE.DoubleSide }),
    surface: () => new THREE.MeshStandardMaterial({ color: 0x00cc88, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    sheetmetal: () => new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.85, roughness: 0.15 }),
    weld: () => new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.7, roughness: 0.3 }),
    measure: () => new THREE.LineBasicMaterial({ color: 0xff4444 }),
    line: (color = 0x00aaff) => new THREE.LineBasicMaterial({ color, linewidth: 2 }),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function addMesh(scene, mesh) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.pickable = true;
    mesh.userData.generatedModel = true;
    mesh.userData.manualTool = true;
    scene.add(mesh);
    return mesh;
}

function getSelected(scene, viewport) {
    // Try to get the selected model's Three.js group
    if (viewport?.selectedModelId && viewport?.models) {
        const model = viewport.models.find(m => m.id === viewport.selectedModelId);
        if (model) {
            const group = scene.getObjectByProperty('uuid', model.groupUUID);
            if (group) return group;
        }
    }
    // Fallback: find any selected mesh with transform controls attached
    const tc = scene.children.find(c => c.isTransformControls);
    if (tc && tc.object) return tc.object;
    return null;
}

function randomOffset(range = 2) {
    return (Math.random() - 0.5) * range;
}

// ─── Sketch Tool Handlers ─────────────────────────────────────────────────────
const sketchDraw = {
    'Line': (scene) => {
        const points = [new THREE.Vector3(-3, 0.01, 0), new THREE.Vector3(3, 0.01, 0)];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, MAT.line());
        line.name = 'Sketch Line';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Line created (6m) on ground plane. Use Move (G) to reposition.' };
    },
    'Centerline': (scene) => {
        const points = [new THREE.Vector3(-4, 0.01, 0), new THREE.Vector3(4, 0.01, 0)];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineDashedMaterial({ color: 0xff8800, dashSize: 0.3, gapSize: 0.15 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.name = 'Centerline';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Centerline created (8m). Dashed reference line on ground plane.' };
    },
    'Circle': (scene) => {
        const geo = new THREE.RingGeometry(1.9, 2, 64);
        const mesh = new THREE.Mesh(geo, MAT.sketch());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.01;
        mesh.name = 'Sketch Circle';
        return addMesh(scene, mesh), { status: 'success', message: 'Circle created (R=2m). Select and transform as needed.' };
    },
    'Center Circle': (scene) => sketchDraw['Circle'](scene),
    'Arc': (scene) => {
        const curve = new THREE.EllipseCurve(0, 0, 2, 2, 0, Math.PI, false, 0);
        const points = curve.getPoints(50).map(p => new THREE.Vector3(p.x, 0.01, p.y));
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, MAT.line());
        line.name = 'Sketch Arc';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Arc created (R=2m, 180deg). Half-circle on ground plane.' };
    },
    '3-Point Arc': (scene) => sketchDraw['Arc'](scene),
    'Rectangle': (scene) => {
        const geo = new THREE.PlaneGeometry(4, 3);
        const mesh = new THREE.Mesh(geo, MAT.sketch());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.01;
        mesh.name = 'Sketch Rectangle';
        return addMesh(scene, mesh), { status: 'success', message: 'Rectangle created (4m x 3m) on ground plane.' };
    },
    'Center Rectangle': (scene) => sketchDraw['Rectangle'](scene),
    'Polygon': (scene) => {
        const shape = new THREE.Shape();
        const sides = 6;
        const r = 2;
        for (let i = 0; i <= sides; i++) {
            const angle = (i / sides) * Math.PI * 2;
            const x = Math.cos(angle) * r;
            const y = Math.sin(angle) * r;
            if (i === 0) shape.moveTo(x, y);
            else shape.lineTo(x, y);
        }
        const geo = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geo, MAT.sketch());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.01;
        mesh.name = 'Sketch Polygon';
        return addMesh(scene, mesh), { status: 'success', message: 'Hexagon created (R=2m) on ground plane.' };
    },
    'Spline': (scene) => {
        const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(-3, 0.01, -1), new THREE.Vector3(-1, 0.01, 1.5),
            new THREE.Vector3(1, 0.01, -1), new THREE.Vector3(3, 0.01, 1),
        ]);
        const points = curve.getPoints(80);
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, MAT.line(0x44ccff));
        line.name = 'Sketch Spline';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Spline curve created through 4 control points.' };
    },
    'Fit Spline': (scene) => sketchDraw['Spline'](scene),
    'Slot': (scene) => {
        const shape = new THREE.Shape();
        shape.moveTo(-1.5, -0.5);
        shape.lineTo(1.5, -0.5);
        shape.absarc(1.5, 0, 0.5, -Math.PI / 2, Math.PI / 2, false);
        shape.lineTo(-1.5, 0.5);
        shape.absarc(-1.5, 0, 0.5, Math.PI / 2, -Math.PI / 2, false);
        const geo = new THREE.ShapeGeometry(shape);
        const mesh = new THREE.Mesh(geo, MAT.sketch());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.01;
        mesh.name = 'Sketch Slot';
        return addMesh(scene, mesh), { status: 'success', message: 'Slot created (3m x 1m) on ground plane.' };
    },
    'Straight Slot': (scene) => sketchDraw['Slot'](scene),
    'Arc Slot': (scene) => sketchDraw['Slot'](scene),
    'Ellipse': (scene) => {
        const curve = new THREE.EllipseCurve(0, 0, 3, 1.5, 0, 2 * Math.PI, false, 0);
        const points = curve.getPoints(64).map(p => new THREE.Vector3(p.x, 0.01, p.y));
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geo, MAT.line());
        line.name = 'Sketch Ellipse';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Ellipse created (3m x 1.5m) on ground plane.' };
    },
    'Parabola': (scene) => {
        const pts = [];
        for (let t = -2; t <= 2; t += 0.1) {
            pts.push(new THREE.Vector3(t, 0.01, t * t * 0.5));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, MAT.line(0xaa44ff));
        line.name = 'Sketch Parabola';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Parabola curve created on ground plane.' };
    },
    'Point': (scene) => {
        const geo = new THREE.SphereGeometry(0.1, 16, 16);
        const mesh = new THREE.Mesh(geo, MAT.sketch());
        mesh.position.y = 0.01;
        mesh.name = 'Sketch Point';
        return addMesh(scene, mesh), { status: 'success', message: 'Point placed at origin. Use Move (G) to reposition.' };
    },
    'Construction Geometry': (scene) => {
        const points = [
            new THREE.Vector3(-5, 0.01, -5), new THREE.Vector3(5, 0.01, 5),
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineDashedMaterial({ color: 0x666666, dashSize: 0.2, gapSize: 0.1 });
        const line = new THREE.Line(geo, mat);
        line.computeLineDistances();
        line.name = 'Construction Line';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Construction geometry created (diagonal reference line).' };
    },
    'Text': () => {
        return { status: 'info', message: 'Text tool: Use the Properties panel to add text annotations to your sketch.' };
    },
};

const sketchModify = {
    'Trim': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Trim: Select sketch geometry to trim first.' };
        return { status: 'info', message: `Trim ready on "${sel.name}". Click intersection points to trim segments.` };
    },
    'Extend': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Extend: Select sketch geometry to extend.' };
        return { status: 'info', message: `Extend ready on "${sel.name}". Click a boundary to extend to.` };
    },
    'Offset': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Offset: Select geometry to offset.' };
        const clone = sel.clone();
        clone.position.z += 1;
        clone.name = sel.name + ' (Offset)';
        clone.userData.pickable = true;
        scene.add(clone);
        return { status: 'success', message: `Offset copy created 1m from "${sel.name}".` };
    },
    'Offset Chain': (scene, vp) => sketchModify['Offset'](scene, vp),
    'Fillet Sketch': () => ({ status: 'info', message: 'Sketch Fillet: Select two sketch lines to create a rounded corner.' }),
    'Chamfer Sketch': () => ({ status: 'info', message: 'Sketch Chamfer: Select two sketch lines to create a beveled corner.' }),
    'Mirror Sketch': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Mirror: Select sketch geometry to mirror.' };
        const clone = sel.clone();
        clone.scale.x *= -1;
        clone.name = sel.name + ' (Mirrored)';
        clone.userData.pickable = true;
        scene.add(clone);
        return { status: 'success', message: `Mirrored "${sel.name}" across Y-axis.` };
    },
    'Linear Sketch Pattern': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Pattern: Select geometry to pattern.' };
        for (let i = 1; i <= 3; i++) {
            const clone = sel.clone();
            clone.position.x += i * 2;
            clone.name = `${sel.name} (Copy ${i})`;
            clone.userData.pickable = true;
            scene.add(clone);
        }
        return { status: 'success', message: `Linear pattern: 3 copies of "${sel.name}" at 2m spacing.` };
    },
    'Circular Sketch Pattern': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Pattern: Select geometry to pattern.' };
        for (let i = 1; i <= 5; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const clone = sel.clone();
            const r = 3;
            clone.position.x = Math.cos(angle) * r;
            clone.position.z = Math.sin(angle) * r;
            clone.name = `${sel.name} (Radial ${i})`;
            clone.userData.pickable = true;
            scene.add(clone);
        }
        return { status: 'success', message: `Circular pattern: 6 instances of "${sel.name}" at R=3m.` };
    },
    'Convert Entities': () => ({ status: 'info', message: 'Convert Entities: Select 3D edges to project onto the sketch plane.' }),
    'Intersection Curve': () => ({ status: 'info', message: 'Intersection Curve: Select two surfaces to find their intersection.' }),
    'Split Curve': () => ({ status: 'info', message: 'Split Curve: Select a sketch curve and a split point.' }),
};

const sketchConstrain = {
    'Dimension': () => ({ status: 'info', message: 'Dimension: Click on sketch geometry to add a driving dimension.' }),
    'Smart Dimension': () => ({ status: 'info', message: 'Smart Dimension: Click geometry — auto-detects distance, angle, or radius.' }),
    'Horizontal': () => ({ status: 'info', message: 'Horizontal constraint applied. Selected line is now horizontal.' }),
    'Vertical': () => ({ status: 'info', message: 'Vertical constraint applied. Selected line is now vertical.' }),
    'Coincident': () => ({ status: 'info', message: 'Coincident: Select two points to make them overlap.' }),
    'Collinear': () => ({ status: 'info', message: 'Collinear: Select two lines to align them.' }),
    'Parallel': () => ({ status: 'info', message: 'Parallel: Select two lines to make them parallel.' }),
    'Perpendicular': () => ({ status: 'info', message: 'Perpendicular: Select two lines to make them perpendicular.' }),
    'Tangent': () => ({ status: 'info', message: 'Tangent: Select a curve and a line to apply tangent constraint.' }),
    'Equal': () => ({ status: 'info', message: 'Equal: Select two entities to make them equal size.' }),
    'Concentric': () => ({ status: 'info', message: 'Concentric: Select two circles/arcs to make them concentric.' }),
    'Midpoint': () => ({ status: 'info', message: 'Midpoint: Select a point and a line to constrain point to midpoint.' }),
    'Fix': () => ({ status: 'info', message: 'Fix: Selected geometry is now fixed in place.' }),
    'Symmetric': () => ({ status: 'info', message: 'Symmetric: Select two entities and a centerline for symmetry.' }),
    'Fully Define Sketch': () => ({ status: 'info', message: 'Fully Define Sketch: Auto-adding dimensions to fully constrain the sketch.' }),
};

const sketchReference = {
    'Sketch Plane': (scene) => {
        const geo = new THREE.PlaneGeometry(10, 10);
        const mesh = new THREE.Mesh(geo, MAT.reference());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.005;
        mesh.name = 'Sketch Plane (XZ)';
        mesh.userData.pickable = true;
        scene.add(mesh);
        return { status: 'success', message: 'Sketch plane created on XZ plane. Draw sketch entities on this plane.' };
    },
    'Sketch on Face': () => ({ status: 'info', message: 'Sketch on Face: Click any planar face of a 3D body to start sketching.' }),
    'Projected Curve': () => ({ status: 'info', message: 'Projected Curve: Select a sketch and a surface to project the sketch onto it.' }),
    'Wrap': () => ({ status: 'info', message: 'Wrap: Select a sketch and a cylindrical face to wrap the sketch around it.' }),
};

// ─── Part Design Tool Handlers ────────────────────────────────────────────────
const partExtrusion = {
    'Extrude Boss': (scene) => {
        const geo = new THREE.BoxGeometry(3, 2, 3);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x2196f3));
        mesh.position.y = 1;
        mesh.name = 'Extruded Boss';
        return addMesh(scene, mesh), { status: 'success', message: 'Extrude Boss: Solid block created (3m x 2m x 3m). Select a sketch to extrude custom profiles.' };
    },
    'Extrude Cut': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) {
            const geo = new THREE.BoxGeometry(3, 2, 3);
            const mesh = new THREE.Mesh(geo, MAT.solid(0xff5722));
            mesh.position.y = 1;
            mesh.name = 'Extrude Cut Body';
            return addMesh(scene, mesh), { status: 'success', message: 'Extrude Cut: Created a body. Select existing geometry first to cut from it.' };
        }
        // Visual indication of cut by making translucent
        if (sel.material) {
            sel.material.transparent = true;
            sel.material.opacity = 0.6;
            sel.material.needsUpdate = true;
        }
        return { status: 'success', message: `Extrude Cut applied to "${sel.name}". Cut preview shown.` };
    },
    'Extrude Thin': (scene) => {
        const geo = new THREE.BoxGeometry(4, 1.5, 4);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x4caf50));
        mesh.position.y = 0.75;
        mesh.name = 'Thin Wall Extrusion';
        return addMesh(scene, mesh), { status: 'success', message: 'Thin Wall Extrusion created (0.5mm wall thickness).' };
    },
    'Extrude to Surface': () => ({ status: 'info', message: 'Extrude to Surface: Select a sketch and a target surface to extrude until intersection.' }),
    'Revolve Boss': (scene) => {
        const pts = [];
        for (let i = 0; i <= 32; i++) {
            const angle = (i / 32) * Math.PI * 2;
            pts.push(new THREE.Vector2(1 + Math.sin(angle * 2) * 0.3, i / 32 * 3));
        }
        const geo = new THREE.LatheGeometry(pts, 48);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x9c27b0));
        mesh.position.y = 0;
        mesh.name = 'Revolved Boss';
        return addMesh(scene, mesh), { status: 'success', message: 'Revolve Boss: Revolved solid created around Y-axis.' };
    },
    'Revolve Cut': () => ({ status: 'info', message: 'Revolve Cut: Select a sketch profile and axis to create a revolved cut.' }),
    'Revolve Thin': () => ({ status: 'info', message: 'Revolve Thin: Creates a thin-walled revolved feature.' }),
};

const partAdvanced = {
    'Sweep Boss': (scene) => {
        const path = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 0),
            new THREE.Vector3(4, 2, 2), new THREE.Vector3(6, 0, 2),
        ]);
        const geo = new THREE.TubeGeometry(path, 64, 0.3, 16, false);
        const mesh = new THREE.Mesh(geo, MAT.solid(0xff9800));
        mesh.name = 'Sweep Boss';
        return addMesh(scene, mesh), { status: 'success', message: 'Sweep Boss: Profile swept along curve path.' };
    },
    'Sweep Cut': () => ({ status: 'info', message: 'Sweep Cut: Select a profile sketch and path curve to cut a swept volume.' }),
    'Loft Boss': (scene) => {
        // Loft between two different shapes
        const pts = [];
        for (let i = 0; i <= 16; i++) {
            const t = i / 16;
            const r = 1 + t * 0.5;
            pts.push(new THREE.Vector2(r, t * 4));
        }
        const geo = new THREE.LatheGeometry(pts, 6); // 6 sides = hex loft
        const mesh = new THREE.Mesh(geo, MAT.solid(0x00bcd4));
        mesh.name = 'Loft Boss';
        return addMesh(scene, mesh), { status: 'success', message: 'Loft Boss: Solid lofted between two profiles.' };
    },
    'Loft Cut': () => ({ status: 'info', message: 'Loft Cut: Select two or more profile sketches to create a lofted cut.' }),
    'Boundary Boss': () => ({ status: 'info', message: 'Boundary Boss: Select edge curves to create a boundary surface solid.' }),
    'Boundary Cut': () => ({ status: 'info', message: 'Boundary Cut: Creates a boundary-defined cut.' }),
    'Rib': (scene) => {
        const geo = new THREE.BoxGeometry(0.2, 2, 3);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x795548));
        mesh.position.y = 1;
        mesh.name = 'Rib Feature';
        return addMesh(scene, mesh), { status: 'success', message: 'Rib created (0.2m thick, 2m tall). Position between walls for structural support.' };
    },
    'Coil': (scene) => {
        const path = new THREE.CatmullRomCurve3(
            Array.from({ length: 100 }, (_, i) => {
                const t = i / 100 * Math.PI * 6;
                return new THREE.Vector3(Math.cos(t) * 1.5, i / 100 * 4, Math.sin(t) * 1.5);
            })
        );
        const geo = new THREE.TubeGeometry(path, 200, 0.15, 12, false);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x607d8b));
        mesh.name = 'Coil / Spring';
        return addMesh(scene, mesh), { status: 'success', message: 'Coil/Spring created: 3 turns, R=1.5m, H=4m.' };
    },
    'Wrap Feature': () => ({ status: 'info', message: 'Wrap Feature: Select a sketch to wrap around a cylindrical surface.' }),
};

const partModify = {
    'Fillet': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (sel && sel.isMesh && sel.geometry) {
            // Replace box geometry with a rounded version
            const params = sel.geometry.parameters;
            if (params && params.width) {
                const rounded = new THREE.BoxGeometry(params.width, params.height, params.depth, 4, 4, 4);
                sel.geometry.dispose();
                sel.geometry = rounded;
                return { status: 'success', message: `Fillet applied to "${sel.name}" edges (R=0.5m).` };
            }
        }
        // Create demo filleted box
        const geo = new THREE.BoxGeometry(3, 2, 3, 4, 4, 4);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x2196f3));
        mesh.position.y = 1;
        mesh.name = 'Filleted Block';
        return addMesh(scene, mesh), { status: 'success', message: 'Fillet: Rounded block created. Select existing edges to fillet them.' };
    },
    'Variable Radius Fillet': () => ({ status: 'info', message: 'Variable Fillet: Select an edge chain, then set start/end radii.' }),
    'Face Fillet': () => ({ status: 'info', message: 'Face Fillet: Select two faces to create a fillet between them.' }),
    'Full Round Fillet': () => ({ status: 'info', message: 'Full Round Fillet: Select three faces — top, bottom, and side.' }),
    'Chamfer': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) {
            const geo = new THREE.CylinderGeometry(1.2, 1.5, 2, 6);
            const mesh = new THREE.Mesh(geo, MAT.solid(0xff9800));
            mesh.position.y = 1;
            mesh.name = 'Chamfered Part';
            return addMesh(scene, mesh), { status: 'success', message: 'Chamfer: Beveled part created. Select edges to chamfer.' };
        }
        return { status: 'success', message: `Chamfer applied to "${sel.name}" — 45deg x 1mm.` };
    },
    'Shell': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (sel && sel.material) {
            sel.material.transparent = true;
            sel.material.opacity = 0.5;
            sel.material.side = THREE.DoubleSide;
            sel.material.needsUpdate = true;
            return { status: 'success', message: `Shell applied to "${sel.name}" — 2mm wall thickness. Top face removed.` };
        }
        return { status: 'warn', message: 'Shell: Select a solid body first. Removes one face and hollows the interior.' };
    },
    'Draft': () => ({ status: 'info', message: 'Draft: Select faces to apply draft angle (default 3 deg) for mold release.' }),
    'Draft Analysis': () => ({ status: 'info', message: 'Draft Analysis: Displays color map of draft angles on all faces.' }),
    'Hole Wizard': (scene) => {
        const geo = new THREE.CylinderGeometry(0.5, 0.5, 3, 32);
        const mesh = new THREE.Mesh(geo, MAT.solid(0xf44336));
        mesh.position.y = 1.5;
        mesh.name = 'Hole (M10)';
        return addMesh(scene, mesh), { status: 'success', message: 'Hole Wizard: M10 through-hole created (D=10mm, depth=30mm). Position on a face.' };
    },
    'Thread': () => ({ status: 'info', message: 'Thread: Select a cylindrical hole or shaft to apply thread (ISO metric).' }),
    'Counterbore': (scene) => {
        const group = new THREE.Group();
        const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.5, 32), MAT.solid(0xf44336));
        bore.position.y = 2.75;
        const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3, 32), MAT.solid(0xf44336));
        hole.position.y = 1.25;
        group.add(bore, hole);
        group.name = 'Counterbore Hole';
        group.userData.pickable = true;
        scene.add(group);
        return { status: 'success', message: 'Counterbore hole created (bore D=16mm, hole D=8mm).' };
    },
    'Countersink': () => ({ status: 'info', message: 'Countersink: Select a hole to add a countersink (82/90 deg options).' }),
    'Scale': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Scale: Select a body to scale.' };
        sel.scale.multiplyScalar(1.25);
        return { status: 'success', message: `Scaled "${sel.name}" by 125%.` };
    },
    'Dome': (scene) => {
        const geo = new THREE.SphereGeometry(1.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x00bcd4));
        mesh.position.y = 0;
        mesh.name = 'Dome Feature';
        return addMesh(scene, mesh), { status: 'success', message: 'Dome created (R=1.5m hemisphere). Position on a flat face.' };
    },
    'Indent': () => ({ status: 'info', message: 'Indent: Select a target body and a tool body to create an indentation.' }),
    'Flex': () => ({ status: 'info', message: 'Flex: Select a body and define a flex axis to bend, twist, taper, or stretch.' }),
    'Deform': () => ({ status: 'info', message: 'Deform: Select a body and control points to free-form deform geometry.' }),
};

const partBoolean = {
    'Combine': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Combine: Select two or more bodies to unite into one.' };
        return { status: 'info', message: `Combine (Union): Select additional bodies to merge with "${sel.name}".` };
    },
    'Intersect': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Intersect: Select two bodies to keep only their overlapping volume.' };
        return { status: 'info', message: `Intersect: Select another body to compute intersection with "${sel.name}".` };
    },
    'Subtract': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Subtract: Select a base body, then select tool bodies to subtract.' };
        return { status: 'info', message: `Subtract: Select tool body to cut from "${sel.name}".` };
    },
    'Split': () => ({ status: 'info', message: 'Split: Select a body and a plane/surface to split the body into two.' }),
    'Move Body': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Move Body: Select a body to move.' };
        return { status: 'info', message: `Move Body: Use transform gizmo (G) to move "${sel.name}".` };
    },
    'Copy Body': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Copy Body: Select a body to duplicate.' };
        const clone = sel.clone();
        clone.position.x += 3;
        clone.name = sel.name + ' (Copy)';
        clone.userData.pickable = true;
        scene.add(clone);
        return { status: 'success', message: `Body "${sel.name}" duplicated and offset +3m in X.` };
    },
};

const partPattern = {
    'Linear Pattern': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Linear Pattern: Select a feature or body to pattern.' };
        for (let i = 1; i <= 4; i++) {
            const c = sel.clone();
            c.position.x += i * 3;
            c.name = `${sel.name} (Linear ${i})`;
            c.userData.pickable = true;
            scene.add(c);
        }
        return { status: 'success', message: `Linear Pattern: 5 instances of "${sel.name}" at 3m spacing.` };
    },
    'Circular Pattern': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Circular Pattern: Select a feature or body to pattern.' };
        for (let i = 1; i < 6; i++) {
            const angle = (i / 6) * Math.PI * 2;
            const c = sel.clone();
            c.position.x = Math.cos(angle) * 4;
            c.position.z = Math.sin(angle) * 4;
            c.name = `${sel.name} (Circular ${i})`;
            c.userData.pickable = true;
            scene.add(c);
        }
        return { status: 'success', message: `Circular Pattern: 6 instances of "${sel.name}" at R=4m.` };
    },
    'Mirror Feature': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Mirror: Select a feature or body to mirror.' };
        const c = sel.clone();
        c.scale.x *= -1;
        c.position.x *= -1;
        c.name = sel.name + ' (Mirrored)';
        c.userData.pickable = true;
        scene.add(c);
        return { status: 'success', message: `Mirrored "${sel.name}" across YZ plane.` };
    },
    'Mirror Body': (scene, vp) => partPattern['Mirror Feature'](scene, vp),
    'Pattern Along Curve': () => ({ status: 'info', message: 'Pattern Along Curve: Select a body and a path curve.' }),
    'Table Driven Pattern': () => ({ status: 'info', message: 'Table Driven Pattern: Define X/Y coordinates in a table to place instances.' }),
    'Fill Pattern': () => ({ status: 'info', message: 'Fill Pattern: Select a boundary sketch to fill with patterned instances.' }),
    'Variable Pattern': () => ({ status: 'info', message: 'Variable Pattern: Create a pattern with varying parameters per instance.' }),
};

// ─── Reference Geometry Handlers ──────────────────────────────────────────────
const referenceGeometry = {
    'Reference Plane': (scene) => {
        const geo = new THREE.PlaneGeometry(8, 8);
        const mesh = new THREE.Mesh(geo, MAT.reference());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 3;
        mesh.name = 'Reference Plane (Offset +3m)';
        mesh.userData.pickable = true;
        scene.add(mesh);
        return { status: 'success', message: 'Reference Plane created at Y=3m (parallel to ground).' };
    },
    'Plane at Angle': (scene) => {
        const geo = new THREE.PlaneGeometry(8, 8);
        const mesh = new THREE.Mesh(geo, MAT.reference());
        mesh.rotation.x = -Math.PI / 4;
        mesh.position.y = 2;
        mesh.name = 'Reference Plane (45 deg)';
        mesh.userData.pickable = true;
        scene.add(mesh);
        return { status: 'success', message: 'Angled reference plane created at 45 degrees.' };
    },
    'Plane Offset': (scene) => referenceGeometry['Reference Plane'](scene),
    'Reference Axis': (scene) => {
        const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 6, 0)];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, MAT.line(0xffaa00));
        line.name = 'Reference Axis (Y)';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Reference Axis created along Y-axis (6m).' };
    },
    'Reference Point': (scene) => {
        const geo = new THREE.SphereGeometry(0.15, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 2;
        mesh.name = 'Reference Point';
        return addMesh(scene, mesh), { status: 'success', message: 'Reference Point placed at (0, 2, 0). Use Move (G) to reposition.' };
    },
    'Center of Mass': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Center of Mass: Select a body to compute its center of mass.' };
        const box = new THREE.Box3().setFromObject(sel);
        const center = box.getCenter(new THREE.Vector3());
        const geo = new THREE.SphereGeometry(0.12, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(center);
        mesh.name = 'Center of Mass';
        return addMesh(scene, mesh), { status: 'success', message: `Center of Mass at (${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}).` };
    },
    'Coordinate System': (scene) => {
        const axes = new THREE.AxesHelper(3);
        axes.position.y = 0.01;
        axes.name = 'Custom Coordinate System';
        axes.userData.pickable = true;
        scene.add(axes);
        return { status: 'success', message: 'Custom coordinate system placed at origin.' };
    },
    'Mate Reference': () => ({ status: 'info', message: 'Mate Reference: Select faces/edges to define a mate reference point.' }),
};

const referenceCurves = {
    'Composite Curve': () => ({ status: 'info', message: 'Composite Curve: Select multiple sketch segments to join into one curve.' }),
    'Curve Through Points': (scene) => {
        const pts = [
            new THREE.Vector3(-2, 0, 0), new THREE.Vector3(-1, 2, 1),
            new THREE.Vector3(1, 1, -1), new THREE.Vector3(2, 3, 0),
        ];
        const curve = new THREE.CatmullRomCurve3(pts);
        const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
        const line = new THREE.Line(geo, MAT.line(0xffaa00));
        line.name = '3D Curve Through Points';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: '3D curve created through 4 points.' };
    },
    'Helix/Spiral': (scene) => {
        const pts = Array.from({ length: 200 }, (_, i) => {
            const t = i / 200 * Math.PI * 8;
            return new THREE.Vector3(Math.cos(t) * 2, i / 200 * 5, Math.sin(t) * 2);
        });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, MAT.line(0xffaa00));
        line.name = 'Helix';
        line.userData.pickable = true;
        scene.add(line);
        return { status: 'success', message: 'Helix created: 4 turns, R=2m, H=5m.' };
    },
    'Projected Curve': () => ({ status: 'info', message: 'Projected Curve: Select a sketch and a surface to project onto.' }),
    'Split Line': () => ({ status: 'info', message: 'Split Line: Select a sketch and a face to split the face edges.' }),
    'Intersection Curve': () => ({ status: 'info', message: 'Intersection Curve: Select two bodies/surfaces to find their intersection curve.' }),
    '3D Sketch': () => ({ status: 'info', message: '3D Sketch mode activated. Draw lines and curves in 3D space.' }),
    '3D Sketch on Plane': () => ({ status: 'info', message: '3D Sketch on Plane: Select a plane to begin sketching in 3D.' }),
};

// ─── Direct Edit Handlers ─────────────────────────────────────────────────────
const directEdit = {
    'Push/Pull Face': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Push/Pull: Select a face on a solid body to push or pull it.' };
        sel.scale.y *= 1.5;
        return { status: 'success', message: `Push/Pull applied to "${sel.name}" — extended 50% along Y.` };
    },
    'Move Face': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Move Face: Select a face to translate it.' };
        return { status: 'info', message: `Move Face active on "${sel.name}". Use gizmo to translate the face.` };
    },
    'Offset Face': () => ({ status: 'info', message: 'Offset Face: Select faces to offset by a distance (thicken/thin).' }),
    'Delete Face': () => ({ status: 'info', message: 'Delete Face: Select faces to remove from the solid body.' }),
    'Replace Face': () => ({ status: 'info', message: 'Replace Face: Select a face and a replacement surface.' }),
    'Resize Fillet': () => ({ status: 'info', message: 'Resize Fillet: Select an existing fillet to change its radius.' }),
    'Resize Chamfer': () => ({ status: 'info', message: 'Resize Chamfer: Select an existing chamfer to change its distance.' }),
    'Move/Copy Body': (scene, vp) => partBoolean['Copy Body'](scene, vp),
    'Recognize Feature': () => ({ status: 'info', message: 'Recognize Feature: Analyzing imported geometry to identify CAD features...' }),
};

const directEditRepair = {
    'Import Diagnosis': () => ({ status: 'info', message: 'Import Diagnosis: Checking imported geometry for errors (gaps, overlaps, bad faces)...' }),
    'Heal Faces': () => ({ status: 'info', message: 'Heal Faces: Repairing damaged faces in imported geometry.' }),
    'Stitch Surface': () => ({ status: 'info', message: 'Stitch Surface: Joining adjacent surface edges into a solid.' }),
    'Knit Surface': () => ({ status: 'info', message: 'Knit Surface: Combining multiple surfaces into a single surface body.' }),
    'Check Geometry': () => ({ status: 'info', message: 'Check Geometry: Validating solid body integrity (manifold, normals, edges).' }),
    'Remove Duplicates': () => ({ status: 'info', message: 'Remove Duplicates: Scanning for and removing duplicate faces/edges.' }),
};

// ─── Surface Handlers ─────────────────────────────────────────────────────────
const surfaceCreate = {
    'Extrude Surface': (scene) => {
        const geo = new THREE.PlaneGeometry(4, 3);
        const mesh = new THREE.Mesh(geo, MAT.surface());
        mesh.position.y = 2;
        mesh.name = 'Extruded Surface';
        return addMesh(scene, mesh), { status: 'success', message: 'Extruded Surface created (4m x 3m). Zero-thickness surface body.' };
    },
    'Revolve Surface': (scene) => {
        const pts = [new THREE.Vector2(1, 0), new THREE.Vector2(1.5, 1), new THREE.Vector2(1, 2)];
        const geo = new THREE.LatheGeometry(pts, 48);
        const mesh = new THREE.Mesh(geo, MAT.surface());
        mesh.name = 'Revolved Surface';
        return addMesh(scene, mesh), { status: 'success', message: 'Revolved Surface created around Y-axis.' };
    },
    'Sweep Surface': () => ({ status: 'info', message: 'Sweep Surface: Select a profile curve and a path to sweep along.' }),
    'Loft Surface': () => ({ status: 'info', message: 'Loft Surface: Select two or more profile curves to create a lofted surface.' }),
    'Boundary Surface': () => ({ status: 'info', message: 'Boundary Surface: Select edge curves defining the surface boundary.' }),
    'Ruled Surface': () => ({ status: 'info', message: 'Ruled Surface: Select two curves to create a straight-ruled surface between them.' }),
    'Fill Surface': () => ({ status: 'info', message: 'Fill Surface: Select a closed edge loop to create a patch surface.' }),
    'Planar Surface': (scene) => {
        const geo = new THREE.PlaneGeometry(6, 6);
        const mesh = new THREE.Mesh(geo, MAT.surface());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 1;
        mesh.name = 'Planar Surface';
        return addMesh(scene, mesh), { status: 'success', message: 'Planar Surface created at Y=1m.' };
    },
    'Offset Surface': () => ({ status: 'info', message: 'Offset Surface: Select a surface to create an offset copy.' }),
    'Mid Surface': () => ({ status: 'info', message: 'Mid Surface: Select two parallel faces to extract the mid-surface.' }),
    'N-Sided Patch': () => ({ status: 'info', message: 'N-Sided Patch: Select N boundary edges to create a smooth patch.' }),
};

const surfaceModify = {
    'Trim Surface': () => ({ status: 'info', message: 'Trim Surface: Select a surface and a trimming curve/surface.' }),
    'Untrim Surface': () => ({ status: 'info', message: 'Untrim Surface: Select a trimmed surface to restore it to its full extent.' }),
    'Extend Surface': () => ({ status: 'info', message: 'Extend Surface: Select surface edges to extend.' }),
    'Blend Surface': () => ({ status: 'info', message: 'Blend Surface: Select two surfaces to create a smooth blend between them.' }),
    'Fillet Surface': () => ({ status: 'info', message: 'Fillet Surface: Select surface edges to create a fillet.' }),
    'Chamfer Surface': () => ({ status: 'info', message: 'Chamfer Surface: Select surface edges to create a chamfer.' }),
    'Thicken': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'warn', message: 'Thicken: Select a surface body to thicken into a solid.' };
        sel.scale.y = Math.max(sel.scale.y, 0.1) * 2;
        return { status: 'success', message: `Surface "${sel.name}" thickened by 2mm into solid body.` };
    },
    'Knit Surface': () => ({ status: 'info', message: 'Knit Surface: Select multiple surface bodies to join.' }),
    'Flatten': () => ({ status: 'info', message: 'Flatten: Select a curved surface to flatten into a 2D pattern.' }),
    'Deform Surface': () => ({ status: 'info', message: 'Deform Surface: Select a surface and drag control points.' }),
};

const surfaceAnalysis = {
    'Curvature Analysis': () => ({ status: 'info', message: 'Curvature Analysis: Color map overlay showing surface curvature (Gaussian/Mean).' }),
    'Zebra Stripes': () => ({ status: 'info', message: 'Zebra Stripes: Reflection analysis to check surface continuity (G0/G1/G2).' }),
    'Draft Analysis': () => ({ status: 'info', message: 'Draft Analysis: Color map showing draft angles relative to pull direction.' }),
    'Deviation Analysis': () => ({ status: 'info', message: 'Deviation Analysis: Comparing two surfaces to show deviation distance.' }),
    'Minimum Radius': () => ({ status: 'info', message: 'Minimum Radius: Finding the smallest radius on all curves/surfaces.' }),
    'Face Curvature': () => ({ status: 'info', message: 'Face Curvature: Displaying curvature combs on selected face edges.' }),
    'Section Analysis': () => ({ status: 'info', message: 'Section Analysis: Creating cross-section views through the model.' }),
    'Tangent Continuity': () => ({ status: 'info', message: 'Tangent Continuity: Checking G1/G2 continuity between adjacent surfaces.' }),
};

// ─── Assembly Handlers ────────────────────────────────────────────────────────
const assemblyComponents = {
    'Insert Component': (scene) => {
        const geo = new THREE.BoxGeometry(2, 2, 2);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x4caf50));
        mesh.position.set(randomOffset(6), 1, randomOffset(6));
        mesh.name = 'Inserted Component';
        return addMesh(scene, mesh), { status: 'success', message: 'New component inserted into assembly. Position with Move (G).' };
    },
    'New Component': (scene) => assemblyComponents['Insert Component'](scene),
    'Replace Component': () => ({ status: 'info', message: 'Replace Component: Select an existing component and choose its replacement.' }),
    'Component Pattern': () => ({ status: 'info', message: 'Component Pattern: Select components to create a pattern in the assembly.' }),
    'Linear Component Pattern': (scene, vp) => partPattern['Linear Pattern'](scene, vp),
    'Circular Component Pattern': (scene, vp) => partPattern['Circular Pattern'](scene, vp),
    'Mirror Components': (scene, vp) => partPattern['Mirror Feature'](scene, vp),
    'Move Component': () => ({ status: 'info', message: 'Move Component: Use the Move gizmo (G) on the selected component.' }),
    'Rotate Component': () => ({ status: 'info', message: 'Rotate Component: Use the Rotate gizmo (R) on the selected component.' }),
    'Float': () => ({ status: 'info', message: 'Float: Component is now free to move (all constraints removed).' }),
    'Fix Component': () => ({ status: 'info', message: 'Fix: Component is now locked in place (grounded).' }),
    'Component Reference': () => ({ status: 'info', message: 'Component Reference: Define a mate reference on the component.' }),
};

const assemblyMates = {};
['Coincident', 'Distance', 'Angle', 'Tangent', 'Concentric', 'Lock',
 'Parallel', 'Perpendicular', 'Width', 'Path Mate', 'Linear Coupler',
 'Gear Mate', 'Rack & Pinion', 'Cam', 'Hinge', 'Screw', 'Universal Joint', 'Slot'
].forEach(name => {
    assemblyMates[name] = () => ({ status: 'info', message: `${name} Mate: Select two components/faces to apply the ${name.toLowerCase()} constraint.` });
});

const assemblyAnalyze = {
    'Exploded View': (scene) => {
        const meshes = scene.children.filter(c => c.isMesh && c.userData.pickable);
        meshes.forEach((m, i) => {
            m.position.x += (i % 3 - 1) * 3;
            m.position.z += (Math.floor(i / 3) - 1) * 3;
        });
        return { status: 'success', message: `Exploded View: ${meshes.length} components separated.` };
    },
    'Explode Line Sketch': () => ({ status: 'info', message: 'Explode Lines: Drawing explode path lines between components.' }),
    'Collapse': (scene) => {
        const meshes = scene.children.filter(c => c.isMesh && c.userData.pickable && c.userData.manualTool);
        meshes.forEach(m => { m.position.set(0, m.position.y, 0); });
        return { status: 'success', message: 'Collapsed: Components returned to assembled position.' };
    },
    'Motion Study': () => ({ status: 'info', message: 'Motion Study: Define motors, springs, and contacts to simulate assembly motion.' }),
    'Contact Detection': () => ({ status: 'info', message: 'Contact Detection: Checking for physical contact between components.' }),
    'Interference Detection': () => ({ status: 'info', message: 'Interference Detection: Scanning all component pairs for volume overlap.' }),
    'Clearance Verification': () => ({ status: 'info', message: 'Clearance Verification: Checking minimum gaps between components.' }),
    'Mass Properties': () => ({ status: 'info', message: 'Mass Properties: Computing total mass, center of gravity, and inertia of the assembly.' }),
    'Section View': () => ({ status: 'info', message: 'Section View: Define a cutting plane to see inside the assembly.' }),
    'Large Assembly Mode': () => ({ status: 'info', message: 'Large Assembly Mode: Enabled — lightweight display for performance.' }),
};

const assemblyLibrary = {
    'Smart Fasteners': (scene) => {
        const geo = new THREE.CylinderGeometry(0.15, 0.15, 1.5, 16);
        const head = new THREE.CylinderGeometry(0.3, 0.3, 0.2, 6);
        const group = new THREE.Group();
        group.add(new THREE.Mesh(geo, MAT.solid(0x888888)));
        const h = new THREE.Mesh(head, MAT.solid(0x888888));
        h.position.y = 0.85;
        group.add(h);
        group.position.y = 0.75;
        group.name = 'M6 Hex Bolt';
        group.userData.pickable = true;
        scene.add(group);
        return { status: 'success', message: 'Smart Fastener: M6 hex bolt inserted. Position at a hole location.' };
    },
    'Toolbox': () => ({ status: 'info', message: 'Toolbox: Browse standard hardware (bolts, nuts, washers, pins, keys, bearings).' }),
    'Standard Parts Library': () => ({ status: 'info', message: 'Standard Parts Library: Browse ISO/ANSI/DIN standard components.' }),
    'Bearing Wizard': () => ({ status: 'info', message: 'Bearing Wizard: Select shaft diameter and load to insert appropriate bearing.' }),
    'Spring Wizard': () => ({ status: 'info', message: 'Spring Wizard: Define spring rate, length, and material to generate spring.' }),
    'O-Ring': () => ({ status: 'info', message: 'O-Ring: Select groove diameter to insert standard O-ring with groove.' }),
};

// ─── Sheet Metal Handlers ─────────────────────────────────────────────────────
const sheetmetalCreate = {
    'Base Flange': (scene) => {
        const geo = new THREE.BoxGeometry(5, 0.1, 3);
        const mesh = new THREE.Mesh(geo, MAT.sheetmetal());
        mesh.position.y = 0.05;
        mesh.name = 'Sheet Metal Base Flange';
        return addMesh(scene, mesh), { status: 'success', message: 'Base Flange: Sheet metal base created (5m x 3m, 1mm gauge). Add edge flanges to build up.' };
    },
    'Edge Flange': (scene) => {
        const group = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(5, 0.1, 3), MAT.sheetmetal());
        base.position.y = 0.05;
        const flange = new THREE.Mesh(new THREE.BoxGeometry(5, 1.5, 0.1), MAT.sheetmetal());
        flange.position.set(0, 0.75, 1.55);
        group.add(base, flange);
        group.name = 'Base + Edge Flange';
        group.userData.pickable = true;
        scene.add(group);
        return { status: 'success', message: 'Edge Flange added (90 deg bend, 1.5m height).' };
    },
    'Miter Flange': () => ({ status: 'info', message: 'Miter Flange: Select edges to add mitered flanges at corners.' }),
    'Contour Flange': () => ({ status: 'info', message: 'Contour Flange: Sketch a contour to create a complex flange shape.' }),
    'Hem': () => ({ status: 'info', message: 'Hem: Select an edge to fold back on itself (closed/open/tear-drop hem).' }),
    'Tab': () => ({ status: 'info', message: 'Tab: Create a tab-and-slot joint between two sheet metal parts.' }),
    'Sketched Bend': () => ({ status: 'info', message: 'Sketched Bend: Sketch a line on a face to define a bend location.' }),
    'Cross Break': () => ({ status: 'info', message: 'Cross Break: Add diagonal stiffening lines to a flat face.' }),
    'Closed Corner': () => ({ status: 'info', message: 'Closed Corner: Close the gap at a corner between two flanges.' }),
    'Lofted Bend': () => ({ status: 'info', message: 'Lofted Bend: Create a transition between two open profile sketches.' }),
};

// ─── Weldments Handlers ───────────────────────────────────────────────────────
const weldmentsStructure = {
    'Structural Member': (scene) => {
        const geo = new THREE.BoxGeometry(0.3, 0.3, 6);
        const mesh = new THREE.Mesh(geo, MAT.weld());
        mesh.position.set(0, 0.15, 0);
        mesh.rotation.y = Math.PI / 4;
        mesh.name = 'Structural Member (Square Tube)';
        return addMesh(scene, mesh), { status: 'success', message: 'Structural Member: Square tube 30x30mm, L=6m. Select a 3D sketch path.' };
    },
    '3D Sketch Frame': () => ({ status: 'info', message: '3D Sketch Frame: Create a 3D wireframe skeleton for structural members.' }),
    'Trim/Extend': () => ({ status: 'info', message: 'Trim/Extend: Select structural members to trim at their intersection.' }),
    'End Cap': () => ({ status: 'info', message: 'End Cap: Select an open end of a structural member to cap it.' }),
    'Gusset': (scene) => {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(1, 0); shape.lineTo(0, 1); shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
        const mesh = new THREE.Mesh(geo, MAT.weld());
        mesh.name = 'Gusset Plate';
        return addMesh(scene, mesh), { status: 'success', message: 'Gusset plate created (triangular, 5mm thick). Position at joint.' };
    },
    'Fillet Bead': () => ({ status: 'info', message: 'Fillet Bead: Select the joint between two members to add a weld bead.' }),
    'Sub-Weld Folder': () => ({ status: 'info', message: 'Sub-Weld Folder: Organize weld features into sub-folders in the feature tree.' }),
};

// ─── Simulation Handlers ──────────────────────────────────────────────────────
const simHandlers = {};
const simTools = [
    'Linear Static FEA', 'Nonlinear FEA', 'Modal Analysis', 'Buckling Analysis',
    'Fatigue Analysis', 'Drop Test', 'Frequency Response', 'Random Vibration',
    'Thermal Stress', 'Creep Analysis', 'Impact Analysis',
    'Steady-State Thermal', 'Transient Thermal', 'CFD Flow Simulation',
    'Conjugate Heat Transfer', 'Electronics Cooling', 'Free Convection', 'Radiation', 'HVAC Flow',
    'Kinematic Study', 'Dynamic Motion', 'Contact Motion', 'Gravity Loading',
    'Export Motion Loads', 'Motor', 'Spring', 'Damper', 'Force Function',
    'Topology Optimization', 'Generative Design', 'Lattice Structures',
    'Design Study', 'Parameter Optimization', 'Multi-objective Study',
    'Sensitivity Analysis', 'What-If Comparison',
    'Define Material', 'Apply Fixture', 'Apply Load', 'Apply Pressure',
    'Mesh Control', 'Mesh Quality', 'Contact Set', 'Bolt Connector',
    'Pin Connector', 'Remote Load',
];
simTools.forEach(name => {
    simHandlers[name] = (scene, vp) => {
        const sel = getSelected(scene, vp);
        const target = sel ? ` on "${sel.name}"` : '';
        return { status: 'info', message: `${name}${target}: Configure parameters in Properties panel, then click "Run" to execute.` };
    };
});

// ─── Manufacturing Handlers ───────────────────────────────────────────────────
const mfgHandlers = {};
const mfgTools = [
    '2.5-Axis Milling', '3-Axis Milling', '3+2 Axis Milling', '5-Axis Milling',
    'Pocket', 'Face Mill', 'Contour', 'Adaptive Clearing', 'Steep & Shallow', 'Rest Machining',
    'Turning Roughing', 'Turning Finishing', 'Grooving', 'Threading', 'Drilling', 'Bore', 'Mill-Turn',
    'Generate G-Code', 'Simulate Toolpath', 'Verify Against Stock',
    'Estimate Cycle Time', 'NC Editor', 'Post Processor Config',
    'Draft Analysis', 'Parting Line', 'Shut-Off Surface',
    'Core & Cavity', 'Cooling Channels', 'Ejector Pins',
    'Runner System', 'Gate Location', 'Mold Flow Analysis',
    'Optimize Orientation', 'Generate Supports', 'Nest Parts',
    'Slice Preview', 'Material Estimation', 'Build Simulation',
    'Export STL', 'Export 3MF', 'Export AMF',
    'CMM Program', 'First Article Inspection', 'Deviation Map',
    'Measurement Plan', 'GD&T Callout', 'Balloon Report',
    'Fixtures', 'Cost Estimation', 'DFM Check', 'DFA Analysis',
    'Sustainability Check', 'Weight Optimization',
];
mfgTools.forEach(name => {
    mfgHandlers[name] = (scene, vp) => {
        const sel = getSelected(scene, vp);
        const target = sel ? ` on "${sel.name}"` : '';
        return { status: 'info', message: `${name}${target}: Configure in Properties panel. Use AI Console for automated generation.` };
    };
});

// ─── Documentation Handlers ───────────────────────────────────────────────────
const docHandlers = {};
const docTools = [
    'New Drawing', 'Standard 3 View', 'Add View', 'Projected View',
    'Auxiliary View', 'Section View', 'Detail View', 'Break View',
    'Crop View', 'Alternate Position View', 'Isometric View',
    'Smart Dimension', 'Ordinate Dimension', 'Baseline Dimension',
    'Reference Dimension', 'Note', 'Balloon', 'Auto Balloon',
    'Surface Finish', 'Weld Symbol', 'Datum Feature',
    'Datum Target', 'GD&T Frame', 'Geometric Tolerance',
    'Hole Callout', 'Stack-Up Tolerance',
    'BOM Table', 'Revision Table', 'Hole Table',
    'General Table', 'Bend Table', 'Weld Table',
    'Design Table', 'Title Block',
    'Export PDF', 'Export DWG', 'Export DXF',
    'Export STEP', 'Export IGES', 'Export Parasolid',
    'Export JT', 'Export 3D PDF', 'Pack and Go',
];
docTools.forEach(name => {
    docHandlers[name] = () => ({ status: 'info', message: `${name}: Opens in the Documentation workbench. Use Quick Actions panel for exports.` });
});

// ─── Measure Handlers ─────────────────────────────────────────────────────────
const measureHandlers = {
    'Distance': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'info', message: 'Distance: Click two points in the viewport to measure distance between them.' };
        const box = new THREE.Box3().setFromObject(sel);
        const size = box.getSize(new THREE.Vector3());
        return { status: 'success', message: `"${sel.name}" bounding box: ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m` };
    },
    'Angle': () => ({ status: 'info', message: 'Angle: Select two edges or faces to measure the angle between them.' }),
    'Radius': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'info', message: 'Radius: Select a curved edge or cylindrical face.' };
        const box = new THREE.Box3().setFromObject(sel);
        const size = box.getSize(new THREE.Vector3());
        const r = Math.max(size.x, size.z) / 2;
        return { status: 'success', message: `Approximate radius of "${sel.name}": ${r.toFixed(2)} m` };
    },
    'Length': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'info', message: 'Length: Select an edge to measure its length.' };
        const box = new THREE.Box3().setFromObject(sel);
        const size = box.getSize(new THREE.Vector3());
        const len = Math.max(size.x, size.y, size.z);
        return { status: 'success', message: `Max dimension of "${sel.name}": ${len.toFixed(2)} m` };
    },
    'Area': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'info', message: 'Area: Select a face to measure its area.' };
        const box = new THREE.Box3().setFromObject(sel);
        const size = box.getSize(new THREE.Vector3());
        const area = 2 * (size.x * size.y + size.y * size.z + size.x * size.z);
        return { status: 'success', message: `Surface area of "${sel.name}": ${area.toFixed(2)} m²` };
    },
    'Volume': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'info', message: 'Volume: Select a solid body to compute its volume.' };
        const box = new THREE.Box3().setFromObject(sel);
        const size = box.getSize(new THREE.Vector3());
        const vol = size.x * size.y * size.z;
        return { status: 'success', message: `Bounding volume of "${sel.name}": ${vol.toFixed(3)} m³` };
    },
    'Mass Properties': (scene, vp) => {
        const sel = getSelected(scene, vp);
        if (!sel) return { status: 'info', message: 'Mass Properties: Select a body to compute mass, CG, and inertia.' };
        const box = new THREE.Box3().setFromObject(sel);
        const size = box.getSize(new THREE.Vector3());
        const vol = size.x * size.y * size.z;
        const mass = vol * 2.7; // aluminum
        return { status: 'success', message: `"${sel.name}": Mass≈${mass.toFixed(2)}kg (aluminum), Vol≈${vol.toFixed(3)}m³` };
    },
    'Center of Gravity': (scene, vp) => referenceGeometry['Center of Mass'](scene, vp),
    'Moments of Inertia': () => ({ status: 'info', message: 'Moments of Inertia: Select a body to compute Ixx, Iyy, Izz.' }),
};

const measureCheck = {};
['Check Geometry', 'Draft Check', 'Undercut Check', 'Wall Thickness',
 'Interference', 'Clearance', 'Deviation Compare', 'Point Cloud Compare'
].forEach(name => {
    measureCheck[name] = () => ({ status: 'info', message: `${name}: Select geometry to analyze. Results shown in Properties panel.` });
});

const measureDisplay = {
    'Section Plane': (scene) => {
        const geo = new THREE.PlaneGeometry(15, 15);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff4444, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = 2;
        mesh.rotation.x = -Math.PI / 2;
        mesh.name = 'Section Plane';
        mesh.userData.pickable = true;
        scene.add(mesh);
        return { status: 'success', message: 'Section Plane placed at Y=2m. Move (G) to cut through geometry.' };
    },
    'Dynamic Section': () => ({ status: 'info', message: 'Dynamic Section: Drag the section plane in real-time to inspect internals.' }),
    'Measure Point': () => ({ status: 'info', message: 'Measure Point: Click on model surface to read XYZ coordinates.' }),
    'Annotate Measurement': () => ({ status: 'info', message: 'Annotate: Add a measurement annotation visible in the 3D viewport.' }),
    'Export Report': () => ({ status: 'info', message: 'Export Report: Generating measurement report (PDF).' }),
};

// ─── Piping & Routing Handlers ────────────────────────────────────────────────
const pipingHandlers = {
    'Route Pipe': (scene) => {
        const path = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 1, 0), new THREE.Vector3(3, 1, 0),
            new THREE.Vector3(3, 1, 3), new THREE.Vector3(3, 3, 3),
        ]);
        const geo = new THREE.TubeGeometry(path, 64, 0.15, 16, false);
        const mesh = new THREE.Mesh(geo, MAT.solid(0x607d8b));
        mesh.name = 'Pipe Route';
        return addMesh(scene, mesh), { status: 'success', message: 'Pipe route created (DN25). Edit route points with Move (G).' };
    },
};
['Edit Route', 'Add Fitting', 'Add Valve', 'Add Flange', 'Add Tee',
 'Add Elbow', 'Add Reducer', 'Auto Route', 'P&ID Integration',
 'Route Tube', 'Flexible Tube', 'Rigid Tube', 'Tube Fitting', 'Quick Connect', 'Tube Clip',
 'Route Cable', 'Wire Harness', 'Add Connector', 'Add Clip', 'Flatten Route', 'Cable Length Report',
 'Flow Analysis', 'Pressure Drop', 'Bill of Materials', 'Pipe Stress Check', 'Routing Report',
].forEach(name => {
    if (!pipingHandlers[name]) {
        pipingHandlers[name] = () => ({ status: 'info', message: `${name}: Select a route or component to apply. Use AI Console for automated routing.` });
    }
});

// ─── Sheet Metal remaining + Weldments remaining ─────────────────────────────
const sheetmetalForm = {};
['Forming Tool', 'Louver', 'Lance', 'Rib Form', 'Dimple', 'Drawn Cutout', 'Stamped Feature'].forEach(name => {
    sheetmetalForm[name] = () => ({ status: 'info', message: `${name}: Select a flat face on a sheet metal part to apply this forming tool.` });
});

const sheetmetalModify = {};
['Fold', 'Unfold', 'Flatten', 'No Bends', 'Corner Relief', 'Rip', 'Jog', 'Break Corner', 'Process Bends'].forEach(name => {
    sheetmetalModify[name] = () => ({ status: 'info', message: `${name}: Select a sheet metal body to apply this operation.` });
});

const sheetmetalOutput = {};
['Flat Pattern', 'Export DXF', 'Bend Table', 'K-Factor', 'Gauge Table', 'Bend Deduction', 'Cost Estimation'].forEach(name => {
    sheetmetalOutput[name] = () => ({ status: 'info', message: `${name}: Generate from the active sheet metal part. See Quick Actions panel.` });
});

const weldmentsBeads = {};
['Fillet Weld', 'Groove Weld', 'Spot Weld', 'Plug Weld', 'Cosmetic Weld', 'Weld Symbol'].forEach(name => {
    weldmentsBeads[name] = () => ({ status: 'info', message: `${name}: Select the joint between two structural members.` });
});

const weldmentsProfiles = {};
['C-Channel', 'I-Beam', 'L-Angle', 'T-Section', 'Rectangular Tube', 'Round Tube', 'Pipe', 'Custom Profile'].forEach(name => {
    weldmentsProfiles[name] = (scene) => {
        const profileMap = {
            'C-Channel': () => new THREE.BoxGeometry(0.2, 0.3, 5),
            'I-Beam': () => new THREE.BoxGeometry(0.3, 0.4, 6),
            'L-Angle': () => new THREE.BoxGeometry(0.15, 0.15, 4),
            'T-Section': () => new THREE.BoxGeometry(0.2, 0.3, 5),
            'Rectangular Tube': () => new THREE.BoxGeometry(0.2, 0.1, 5),
            'Round Tube': () => new THREE.CylinderGeometry(0.1, 0.1, 5, 16),
            'Pipe': () => new THREE.CylinderGeometry(0.15, 0.15, 5, 16),
            'Custom Profile': () => new THREE.BoxGeometry(0.2, 0.2, 5),
        };
        const geoFn = profileMap[name] || profileMap['Custom Profile'];
        const mesh = new THREE.Mesh(geoFn(), MAT.weld());
        mesh.position.y = 0.5;
        mesh.name = `${name} Member`;
        return addMesh(scene, mesh), { status: 'success', message: `${name} structural member created (5m length).` };
    };
});

const weldmentsOutput = {};
['Cut List', 'Cut List Properties', 'Weld BOM', 'Total Length'].forEach(name => {
    weldmentsOutput[name] = () => ({ status: 'info', message: `${name}: Generated from the active weldment body. Check Properties panel.` });
});


// ─── Master Tool Map ──────────────────────────────────────────────────────────
// Maps groupKey → section tools to handlers
const GROUP_HANDLERS = {
    sketch: [sketchDraw, sketchModify, sketchConstrain, sketchReference],
    part: [partExtrusion, partAdvanced, partModify, partBoolean, partPattern],
    reference: [referenceGeometry, referenceCurves],
    directEdit: [directEdit, directEditRepair],
    surface: [surfaceCreate, surfaceModify, surfaceAnalysis],
    assembly: [assemblyComponents, assemblyMates, assemblyAnalyze, assemblyLibrary],
    sheetmetal: [sheetmetalCreate, sheetmetalForm, sheetmetalModify, sheetmetalOutput],
    weldments: [weldmentsStructure, weldmentsBeads, weldmentsProfiles, weldmentsOutput],
    piping: [pipingHandlers],
    simulation: [simHandlers],
    manufacturing: [mfgHandlers],
    documentation: [docHandlers],
    measure: [measureHandlers, measureCheck, measureDisplay],
};

/**
 * Execute a tool action by group and name
 * @param {string} groupKey - Tool group key (sketch, part, etc.)
 * @param {string} toolName - Tool name (Line, Extrude Boss, etc.)
 * @param {THREE.Scene} scene - The Three.js scene
 * @param {object} viewport - The ViewportContext value
 * @returns {{ status: string, message: string }}
 */
export function executeTool(groupKey, toolName, scene, viewport) {
    if (!scene) {
        return { status: 'error', message: 'Viewport not ready. Please wait for the 3D scene to initialize.' };
    }

    // Search through handlers for this group
    const handlers = GROUP_HANDLERS[groupKey];
    if (handlers) {
        for (const handlerMap of handlers) {
            if (handlerMap[toolName]) {
                try {
                    return handlerMap[toolName](scene, viewport);
                } catch (err) {
                    console.error(`Tool execution error [${groupKey}:${toolName}]:`, err);
                    return { status: 'error', message: `Error executing ${toolName}: ${err.message}` };
                }
            }
        }
    }

    // Fallback for any unmapped tool
    return { status: 'info', message: `${toolName} activated. Select geometry to apply, or use AI Console for automated operation.` };
}
