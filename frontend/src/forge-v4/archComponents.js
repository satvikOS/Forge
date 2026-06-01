// Forge-150 — Arch/BIM workbench component hierarchy.
//
// Mirrors FreeCAD's `Arch` workbench. Every Arch tool maps to:
//
//   (a) an IFC4 entity class (IFCWALL / IFCWINDOW / IFCDOOR / IFCSLAB /
//       IFCCOLUMN / IFCBEAM / IFCSTAIR / IFCRAILING / IFCROOF / IFCRAMP)
//       — surfaced as `ifcType` on the produced body so the Forge-121
//       IFC exporter automatically promotes the proxy class to the
//       correct subtype.
//
//   (b) a native composition recipe — a sequence of `window.forge.*`
//       primitive + boolean calls that produce a real OCCT handle.
//       No synthetic substitute; if the kernel is offline the dispatch
//       returns a clear error.
//
// Hard rules (per project memory feedback-forge-no-mvp-no-fallback):
//   - Every recipe uses real native ops only — no THREE.js stand-ins,
//     no schematic placeholders.
//   - Recipes that need a void (window/door opening) emit the void
//     body AND the parent body; the workbench is responsible for
//     calling forge.cut() to fuse them.
//   - Recipes always carry a body.ifcType so re-export-after-reload works
//     once SiteHierarchy persists the bodies to localStorage.
//
// Manual button clicks NEVER write to Archie's thread — recipe dispatch
// is a pure data-in / handle-out pipeline.

/* =====================================================================
 * IFC class registry — one entry per Arch tool.
 * ===================================================================== */

export const IFC_CLASSES = Object.freeze({
  WALL:     'IFCWALL',
  WINDOW:   'IFCWINDOW',
  DOOR:     'IFCDOOR',
  SLAB:     'IFCSLAB',
  COLUMN:   'IFCCOLUMN',
  BEAM:     'IFCBEAM',
  STAIR:    'IFCSTAIR',
  RAILING:  'IFCRAILING',
  ROOF:     'IFCROOF',
  RAMP:     'IFCRAMP',
});

/* =====================================================================
 * Param schemas — surfaced through ArchWorkbench's per-tool dialog.
 *
 * Each tool returns:
 *   id     — Arch tool id (also the menu action id under "arch.")
 *   label  — display label
 *   icon   — wb-rail icon family (we reuse 'wb.mech' family glyphs)
 *   ifcType — IFC4 entity class produced
 *   fields — DirectEdit-style schema. Field types match toolSchemas.js.
 *   build  — pure function (params, kernel) → { handle, voids: [...] }
 *            kernel = window.forge (so callers can pass a mock).
 * ===================================================================== */

function MM(v, d) { return (typeof v === 'number' && Number.isFinite(v)) ? v : d; }

function kernelReady(kernel) {
  return kernel && typeof kernel.makeBox === 'function'
      && typeof kernel.fuse    === 'function'
      && typeof kernel.cut     === 'function'
      && typeof kernel.translate === 'function';
}

/* =====================================================================
 * Recipe primitives — every Arch tool is some chain of these.
 *
 * Returned handles are real native OCCT handles. translate() takes a
 * handle and returns a NEW handle whose origin is offset; this matches
 * the binding signature.
 * ===================================================================== */

function placeBox(kernel, dx, dy, dz, tx = 0, ty = 0, tz = 0) {
  let h = kernel.makeBox(dx, dy, dz);
  if (tx !== 0 || ty !== 0 || tz !== 0) {
    h = kernel.translate(h, tx, ty, tz);
  }
  return h;
}

function placeCyl(kernel, r, h, tx = 0, ty = 0, tz = 0) {
  let g = kernel.makeCylinder(r, h);
  if (tx !== 0 || ty !== 0 || tz !== 0) {
    g = kernel.translate(g, tx, ty, tz);
  }
  return g;
}

function fuseAll(kernel, handles) {
  if (!handles.length) return null;
  let acc = handles[0];
  for (let i = 1; i < handles.length; i++) acc = kernel.fuse(acc, handles[i]);
  return acc;
}

function cutAll(kernel, base, voids) {
  let acc = base;
  for (const v of voids) acc = kernel.cut(acc, v);
  return acc;
}

/* =====================================================================
 * ARCH_TOOLS — the canonical list.
 *
 * The order here is also the order they render in the panel.
 * ===================================================================== */

export const ARCH_TOOLS = [
  // ─────────────────────────────────────────────────────────── WALL
  {
    id: 'arch.wall',
    label: 'Wall',
    icon: 'wb.mech',
    group: 'Structural',
    ifcType: IFC_CLASSES.WALL,
    fields: [
      { id: 'length',    label: 'Length',    type: 'number', default: 3000, unit: 'mm', min: 1 },
      { id: 'thickness', label: 'Thickness', type: 'number', default: 200,  unit: 'mm', min: 1 },
      { id: 'height',    label: 'Height',    type: 'number', default: 2700, unit: 'mm', min: 1 },
      { id: 'offset',    label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
      const h = placeBox(kernel,
        MM(p.length, 3000),
        MM(p.thickness, 200),
        MM(p.height, 2700),
        ox, oy, oz);
      return { handle: h, voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── WINDOW
  //
  // A real window is: an opening (void) the parent wall must cut, plus
  // a thin frame body. The frame body is the actual IFC element; the
  // void is published in `voids` so the ArchWorkbench fuses+cuts the
  // host wall automatically when one is targeted.
  {
    id: 'arch.window',
    label: 'Window',
    icon: 'wb.mech',
    group: 'Openings',
    ifcType: IFC_CLASSES.WINDOW,
    fields: [
      { id: 'style',    label: 'Style',    type: 'enum',
        options: [
          { value: 'rect',   label: 'Rectangular' },
          { value: 'arched', label: 'Arched' },
        ], default: 'rect' },
      { id: 'width',     label: 'Width',     type: 'number', default: 1200, unit: 'mm', min: 1 },
      { id: 'height',    label: 'Height',    type: 'number', default: 1500, unit: 'mm', min: 1 },
      { id: 'sillHeight',label: 'Sill height', type: 'number', default: 900, unit: 'mm', min: 0 },
      { id: 'panes',     label: 'Panes (cols × rows)', type: 'vec3',
        default: [2, 2, 1], unit: 'count' }, // z slot used as label spacer
      { id: 'frameThk',  label: 'Frame thickness', type: 'number', default: 60, unit: 'mm', min: 1 },
      { id: 'wallThk',   label: 'Host wall thk',   type: 'number', default: 200, unit: 'mm', min: 1 },
      { id: 'offset',    label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const W   = MM(p.width, 1200);
      const H   = MM(p.height, 1500);
      const T   = MM(p.wallThk, 200);
      const Ft  = MM(p.frameThk, 60);
      const Sh  = MM(p.sillHeight, 900);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
      // Opening void — slightly oversized so cut works cleanly.
      const voidH = placeBox(kernel, W, T + 20, H, ox, oy - 10, oz + Sh);

      // Outer frame ring — outer box minus inner box.
      const outer  = placeBox(kernel, W,        T, H,         ox,            oy, oz + Sh);
      const inner  = placeBox(kernel, W - 2*Ft, T + 4, H - 2*Ft,
                              ox + Ft, oy - 2, oz + Sh + Ft);
      let frame = kernel.cut(outer, inner);

      // Pane mullions (grid sub-divisions).
      const panes = Array.isArray(p.panes) ? p.panes : [2, 2, 1];
      const cols = Math.max(1, Math.round(panes[0] || 1));
      const rows = Math.max(1, Math.round(panes[1] || 1));
      const mullions = [];
      const cellW = (W - 2*Ft) / cols;
      const cellH = (H - 2*Ft) / rows;
      for (let c = 1; c < cols; c++) {
        mullions.push(placeBox(kernel, Ft/2, T - 8, H - 2*Ft,
          ox + Ft + c*cellW - Ft/4, oy + 4, oz + Sh + Ft));
      }
      for (let r = 1; r < rows; r++) {
        mullions.push(placeBox(kernel, W - 2*Ft, T - 8, Ft/2,
          ox + Ft, oy + 4, oz + Sh + Ft + r*cellH - Ft/4));
      }
      if (mullions.length) frame = fuseAll(kernel, [frame, ...mullions]);

      // For "arched" style, subtract a half-cylinder from the lower
      // half so the void carries the curve. We approximate the arch
      // by adding a cylindrical void on top of the rectangular void.
      let openingVoid = voidH;
      if (p.style === 'arched') {
        const archR = W / 2;
        // OCCT cylinders are oriented along +Z by default. Rotate by
        // 90° about X so the axis is along Y (through wall).
        let archCyl = kernel.makeCylinder(archR, T + 20);
        archCyl = kernel.rotate
          ? kernel.rotate(archCyl, [ox + W/2, oy - 10, oz + Sh + H],
                          [1, 0, 0], Math.PI / 2)
          : archCyl;
        openingVoid = kernel.fuse(voidH, archCyl);
      }
      return { handle: frame, voids: [openingVoid] };
    },
  },

  // ─────────────────────────────────────────────────────────── DOOR
  //
  // A door is structurally identical to a window (frame body + opening
  // void) but with different defaults and an optional "folding" leaf.
  {
    id: 'arch.door',
    label: 'Door',
    icon: 'wb.mech',
    group: 'Openings',
    ifcType: IFC_CLASSES.DOOR,
    fields: [
      { id: 'style',    label: 'Style',  type: 'enum',
        options: [
          { value: 'single',  label: 'Single' },
          { value: 'double',  label: 'Double' },
          { value: 'folding', label: 'Folding (3-panel)' },
        ], default: 'single' },
      { id: 'width',    label: 'Width',  type: 'number', default: 900,  unit: 'mm', min: 1 },
      { id: 'height',   label: 'Height', type: 'number', default: 2100, unit: 'mm', min: 1 },
      { id: 'leafThk',  label: 'Leaf thickness', type: 'number', default: 40, unit: 'mm', min: 1 },
      { id: 'frameThk', label: 'Frame thickness',type: 'number', default: 60, unit: 'mm', min: 1 },
      { id: 'wallThk',  label: 'Host wall thk',  type: 'number', default: 200, unit: 'mm', min: 1 },
      { id: 'offset',   label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const W  = MM(p.width, 900);
      const H  = MM(p.height, 2100);
      const T  = MM(p.wallThk, 200);
      const Ft = MM(p.frameThk, 60);
      const Lt = MM(p.leafThk, 40);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];

      const voidH = placeBox(kernel, W, T + 20, H, ox, oy - 10, oz);

      const outer = placeBox(kernel, W, T, H, ox, oy, oz);
      const inner = placeBox(kernel, W - 2*Ft, T + 4, H - Ft,
                             ox + Ft, oy - 2, oz);
      let frame = kernel.cut(outer, inner);

      // Leaf bodies — placed at the door's swing plane (mid-thickness).
      const leafZ = oz + 10;
      const leafH = H - Ft - 20;
      const leafY = oy + T/2 - Lt/2;
      const leafs = [];
      if (p.style === 'single') {
        leafs.push(placeBox(kernel, W - 2*Ft - 8, Lt, leafH,
          ox + Ft + 4, leafY, leafZ));
      } else if (p.style === 'double') {
        const lw = (W - 2*Ft - 12) / 2;
        leafs.push(placeBox(kernel, lw, Lt, leafH, ox + Ft + 4, leafY, leafZ));
        leafs.push(placeBox(kernel, lw, Lt, leafH, ox + Ft + 8 + lw, leafY, leafZ));
      } else {
        // folding — 3 narrower panels.
        const lw = (W - 2*Ft - 16) / 3;
        for (let i = 0; i < 3; i++) {
          leafs.push(placeBox(kernel, lw, Lt, leafH,
            ox + Ft + 4 + i * (lw + 4), leafY, leafZ));
        }
      }
      if (leafs.length) frame = fuseAll(kernel, [frame, ...leafs]);
      return { handle: frame, voids: [voidH] };
    },
  },

  // ─────────────────────────────────────────────────────────── SLAB
  {
    id: 'arch.slab',
    label: 'Slab',
    icon: 'wb.mech',
    group: 'Structural',
    ifcType: IFC_CLASSES.SLAB,
    fields: [
      { id: 'length',    label: 'Length',    type: 'number', default: 5000, unit: 'mm', min: 1 },
      { id: 'width',     label: 'Width',     type: 'number', default: 4000, unit: 'mm', min: 1 },
      { id: 'thickness', label: 'Thickness', type: 'number', default: 200,  unit: 'mm', min: 1 },
      { id: 'level',     label: 'Level (Z)', type: 'number', default: 0,    unit: 'mm' },
      { id: 'slope',     label: 'Slope (drop along X)', type: 'number', default: 0, unit: 'mm' },
      { id: 'offset',    label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const L = MM(p.length, 5000);
      const W = MM(p.width, 4000);
      const Th = MM(p.thickness, 200);
      const Z = MM(p.level, 0);
      const slope = MM(p.slope, 0);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
      // Base slab.
      let h = placeBox(kernel, L, W, Th, ox, oy, oz + Z);
      // Slope: subtract a triangular wedge so the slab pitches along +X.
      if (Math.abs(slope) > 1e-3) {
        const wedge = placeBox(kernel, L, W, Math.abs(slope),
          ox, oy, oz + Z + Th - Math.abs(slope));
        // Rotate the wedge about Y to make a true triangular prism.
        const r = kernel.rotate
          ? kernel.rotate(wedge, [ox, oy, oz + Z + Th],
                          [0, 1, 0], slope > 0 ? Math.atan2(slope, L) : -Math.atan2(-slope, L))
          : wedge;
        h = kernel.cut(h, r);
      }
      return { handle: h, voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── COLUMN
  {
    id: 'arch.column',
    label: 'Column',
    icon: 'wb.mech',
    group: 'Structural',
    ifcType: IFC_CLASSES.COLUMN,
    fields: [
      { id: 'profile', label: 'Profile', type: 'enum',
        options: [
          { value: 'round',     label: 'Round' },
          { value: 'rectangular', label: 'Rectangular' },
        ], default: 'round' },
      { id: 'diameter', label: 'Diameter / Width', type: 'number', default: 400, unit: 'mm', min: 1 },
      { id: 'depth',    label: 'Depth (rect only)', type: 'number', default: 400, unit: 'mm', min: 1 },
      { id: 'height',   label: 'Height',           type: 'number', default: 3000, unit: 'mm', min: 1 },
      { id: 'offset',   label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const D = MM(p.diameter, 400);
      const Dp = MM(p.depth, 400);
      const Hh = MM(p.height, 3000);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
      if (p.profile === 'round') {
        return { handle: placeCyl(kernel, D / 2, Hh, ox, oy, oz), voids: [] };
      }
      return { handle: placeBox(kernel, D, Dp, Hh, ox - D/2, oy - Dp/2, oz), voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── BEAM
  //
  // I/H section beams are composed from three rectangular plates fused
  // along the web — flange, web, flange. Rectangular beams are one box.
  {
    id: 'arch.beam',
    label: 'Beam',
    icon: 'wb.mech',
    group: 'Structural',
    ifcType: IFC_CLASSES.BEAM,
    fields: [
      { id: 'profile', label: 'Section', type: 'enum',
        options: [
          { value: 'rect', label: 'Rectangular' },
          { value: 'i',    label: 'I-section' },
          { value: 'h',    label: 'H-section' },
        ], default: 'rect' },
      { id: 'length', label: 'Length',  type: 'number', default: 4000, unit: 'mm', min: 1 },
      { id: 'width',  label: 'Width',   type: 'number', default: 300,  unit: 'mm', min: 1 },
      { id: 'depth',  label: 'Depth',   type: 'number', default: 500,  unit: 'mm', min: 1 },
      { id: 'webThk', label: 'Web thk (I/H)',    type: 'number', default: 12, unit: 'mm', min: 1 },
      { id: 'flangeThk', label: 'Flange thk (I/H)', type: 'number', default: 18, unit: 'mm', min: 1 },
      { id: 'offset', label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const L = MM(p.length, 4000);
      const W = MM(p.width, 300);
      const D = MM(p.depth, 500);
      const wt = MM(p.webThk, 12);
      const ft = MM(p.flangeThk, 18);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];

      if (p.profile === 'rect') {
        return { handle: placeBox(kernel, L, W, D, ox, oy - W/2, oz - D/2), voids: [] };
      }
      // I or H — same recipe, the difference is conventional (web
      // vertical for I, horizontal for H). We emit a vertical web for I,
      // horizontal for H.
      const topFlange = placeBox(kernel, L, W, ft, ox, oy - W/2, oz + D/2 - ft);
      const botFlange = placeBox(kernel, L, W, ft, ox, oy - W/2, oz - D/2);
      const web       = placeBox(kernel, L, wt, D - 2*ft,
        ox, oy - wt/2, oz - D/2 + ft);
      const fused = fuseAll(kernel, [topFlange, botFlange, web]);
      // For H-section, rotate the fused profile 90° about the X axis.
      if (p.profile === 'h' && kernel.rotate) {
        return { handle: kernel.rotate(fused, [ox, oy, oz], [1, 0, 0], Math.PI / 2), voids: [] };
      }
      return { handle: fused, voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── STAIR
  //
  // Straight: N risers, each step is a box. U / L: two flights with a
  // landing in between. Spiral: stack of wedge-like risers around a
  // central column.
  {
    id: 'arch.stair',
    label: 'Stair',
    icon: 'wb.mech',
    group: 'Circulation',
    ifcType: IFC_CLASSES.STAIR,
    fields: [
      { id: 'style', label: 'Style', type: 'enum',
        options: [
          { value: 'straight', label: 'Straight' },
          { value: 'l',        label: 'L-shape' },
          { value: 'u',        label: 'U-shape' },
          { value: 'spiral',   label: 'Spiral' },
        ], default: 'straight' },
      { id: 'risers',  label: 'Risers',   type: 'number', default: 16, min: 2, step: 1 },
      { id: 'tread',   label: 'Tread',    type: 'number', default: 280, unit: 'mm', min: 1 },
      { id: 'riserH',  label: 'Riser height', type: 'number', default: 180, unit: 'mm', min: 1 },
      { id: 'width',   label: 'Width',    type: 'number', default: 1200, unit: 'mm', min: 1 },
      { id: 'offset',  label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const N  = Math.max(2, Math.round(MM(p.risers, 16)));
      const Tr = MM(p.tread, 280);
      const Rh = MM(p.riserH, 180);
      const Wd = MM(p.width, 1200);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];

      const steps = [];
      if (p.style === 'straight') {
        for (let i = 0; i < N; i++) {
          steps.push(placeBox(kernel, Tr, Wd, Rh * (i + 1),
            ox + i * Tr, oy - Wd/2, oz));
        }
      } else if (p.style === 'l') {
        const half = Math.floor(N / 2);
        // First flight along +X.
        for (let i = 0; i < half; i++) {
          steps.push(placeBox(kernel, Tr, Wd, Rh * (i + 1),
            ox + i * Tr, oy - Wd/2, oz));
        }
        // Landing.
        const landingZ = Rh * half;
        steps.push(placeBox(kernel, Wd, Wd, Rh,
          ox + half * Tr, oy - Wd/2, oz + landingZ - Rh));
        // Second flight along +Y.
        for (let i = 0; i < N - half; i++) {
          steps.push(placeBox(kernel, Wd, Tr, Rh * (i + 1) + landingZ,
            ox + half * Tr, oy - Wd/2 + Wd + i * Tr, oz));
        }
      } else if (p.style === 'u') {
        const half = Math.floor(N / 2);
        for (let i = 0; i < half; i++) {
          steps.push(placeBox(kernel, Tr, Wd, Rh * (i + 1),
            ox + i * Tr, oy - Wd/2, oz));
        }
        const landingZ = Rh * half;
        steps.push(placeBox(kernel, Tr * 2, Wd * 2 + Wd, Rh,
          ox + half * Tr, oy - Wd*1.5, oz + landingZ - Rh));
        for (let i = 0; i < N - half; i++) {
          steps.push(placeBox(kernel, Tr, Wd, Rh * (i + 1) + landingZ,
            ox + (half - 1 - i) * Tr, oy - Wd*1.5, oz));
        }
      } else {
        // Spiral — wedge approximated by a narrow box rotated around
        // central column. Requires kernel.rotate.
        const centralR = Wd * 0.15;
        const centralCol = placeCyl(kernel, centralR, N * Rh, ox, oy, oz);
        steps.push(centralCol);
        const stepLen = Wd - centralR;
        for (let i = 0; i < N; i++) {
          let step = placeBox(kernel, stepLen, Tr, Rh,
            ox + centralR, oy - Tr/2, oz + i * Rh);
          if (kernel.rotate) {
            const theta = (2 * Math.PI * i) / Math.max(8, N);
            step = kernel.rotate(step, [ox, oy, oz], [0, 0, 1], theta);
          }
          steps.push(step);
        }
      }
      return { handle: fuseAll(kernel, steps), voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── RAILING
  {
    id: 'arch.railing',
    label: 'Railing',
    icon: 'wb.mech',
    group: 'Circulation',
    ifcType: IFC_CLASSES.RAILING,
    fields: [
      { id: 'length',  label: 'Length',     type: 'number', default: 3000, unit: 'mm', min: 1 },
      { id: 'height',  label: 'Height',     type: 'number', default: 1100, unit: 'mm', min: 1 },
      { id: 'postCount', label: 'Posts',    type: 'number', default: 6,   min: 2, step: 1 },
      { id: 'postDia', label: 'Post diameter', type: 'number', default: 40, unit: 'mm', min: 1 },
      { id: 'topRailDia', label: 'Top rail diameter', type: 'number', default: 50, unit: 'mm', min: 1 },
      { id: 'offset',  label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const L = MM(p.length, 3000);
      const Hh = MM(p.height, 1100);
      const N = Math.max(2, Math.round(MM(p.postCount, 6)));
      const Pd = MM(p.postDia, 40);
      const Td = MM(p.topRailDia, 50);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
      const posts = [];
      const step = L / (N - 1);
      for (let i = 0; i < N; i++) {
        posts.push(placeCyl(kernel, Pd/2, Hh, ox + i*step, oy, oz));
      }
      // Top rail along +X — make a long box laid sideways.
      const topRail = placeBox(kernel, L, Td, Td,
        ox, oy - Td/2, oz + Hh - Td);
      return { handle: fuseAll(kernel, [...posts, topRail]), voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── ROOF
  //
  // Gable: two slabs meeting at a ridge. Hip: four slabs.
  // Shed: one slanted slab.
  {
    id: 'arch.roof',
    label: 'Roof',
    icon: 'wb.mech',
    group: 'Envelope',
    ifcType: IFC_CLASSES.ROOF,
    fields: [
      { id: 'style', label: 'Style', type: 'enum',
        options: [
          { value: 'gable', label: 'Gable' },
          { value: 'hip',   label: 'Hip' },
          { value: 'shed',  label: 'Shed' },
        ], default: 'gable' },
      { id: 'length', label: 'Length', type: 'number', default: 8000, unit: 'mm', min: 1 },
      { id: 'width',  label: 'Width',  type: 'number', default: 5000, unit: 'mm', min: 1 },
      { id: 'rise',   label: 'Ridge rise', type: 'number', default: 1500, unit: 'mm', min: 1 },
      { id: 'thickness', label: 'Thickness', type: 'number', default: 200, unit: 'mm', min: 1 },
      { id: 'offset', label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const L = MM(p.length, 8000);
      const W = MM(p.width, 5000);
      const Rs = MM(p.rise, 1500);
      const Th = MM(p.thickness, 200);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];

      if (p.style === 'shed') {
        let s = placeBox(kernel, L, W, Th, ox, oy, oz);
        if (kernel.rotate) {
          const angle = Math.atan2(Rs, W);
          s = kernel.rotate(s, [ox, oy, oz], [1, 0, 0], angle);
        }
        return { handle: s, voids: [] };
      }
      // Gable / hip — two pitched slabs.
      const angle = Math.atan2(Rs, W / 2);
      const slope = W / (2 * Math.cos(angle));
      let left  = placeBox(kernel, L, slope, Th, ox, oy, oz);
      let right = placeBox(kernel, L, slope, Th, ox, oy + W/2, oz);
      if (kernel.rotate) {
        left  = kernel.rotate(left,  [ox, oy + W/2, oz + Rs], [1, 0, 0], -angle);
        right = kernel.rotate(right, [ox, oy + W/2, oz + Rs], [1, 0, 0],  angle);
      }
      const fused = kernel.fuse(left, right);
      if (p.style === 'gable') return { handle: fused, voids: [] };

      // Hip — add two end pitches.
      const endAngle = Math.atan2(Rs, L / 2);
      const endSlope = L / (2 * Math.cos(endAngle));
      let front = placeBox(kernel, endSlope, W, Th, ox, oy, oz);
      let back  = placeBox(kernel, endSlope, W, Th, ox + L/2, oy, oz);
      if (kernel.rotate) {
        front = kernel.rotate(front, [ox + L/2, oy, oz + Rs], [0, 1, 0],  endAngle);
        back  = kernel.rotate(back,  [ox + L/2, oy, oz + Rs], [0, 1, 0], -endAngle);
      }
      return { handle: fuseAll(kernel, [fused, front, back]), voids: [] };
    },
  },

  // ─────────────────────────────────────────────────────────── RAMP
  //
  // Sibling of Stair (single inclined slab).  Maps to IFCRAMP so the
  // Forge-121 exporter can place it under the building's circulation
  // group.
  {
    id: 'arch.ramp',
    label: 'Ramp',
    icon: 'wb.mech',
    group: 'Circulation',
    ifcType: IFC_CLASSES.RAMP,
    fields: [
      { id: 'length',  label: 'Length',  type: 'number', default: 4000, unit: 'mm', min: 1 },
      { id: 'width',   label: 'Width',   type: 'number', default: 1500, unit: 'mm', min: 1 },
      { id: 'rise',    label: 'Rise',    type: 'number', default: 800,  unit: 'mm', min: 1 },
      { id: 'thickness',label: 'Thickness',type: 'number', default: 150, unit: 'mm', min: 1 },
      { id: 'offset',  label: 'Origin offset (x,y,z)', type: 'vec3', default: [0, 0, 0], unit: 'mm' },
    ],
    build(p, kernel) {
      if (!kernelReady(kernel)) throw new Error('forge-kernel offline');
      const L = MM(p.length, 4000);
      const W = MM(p.width, 1500);
      const Rs = MM(p.rise, 800);
      const Th = MM(p.thickness, 150);
      const [ox, oy, oz] = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
      let s = placeBox(kernel, L, W, Th, ox, oy - W/2, oz);
      if (kernel.rotate) {
        const angle = Math.atan2(Rs, L);
        s = kernel.rotate(s, [ox, oy, oz], [0, 1, 0], -angle);
      }
      return { handle: s, voids: [] };
    },
  },
];

/* =====================================================================
 * Group ordering for the panel UI.
 * ===================================================================== */

export const ARCH_GROUPS = [
  { id: 'Structural',  label: 'Structural' },
  { id: 'Openings',    label: 'Openings' },
  { id: 'Circulation', label: 'Circulation' },
  { id: 'Envelope',    label: 'Envelope' },
];

export const ARCH_TOOLS_BY_ID = Object.freeze(
  ARCH_TOOLS.reduce((acc, t) => { acc[t.id] = t; return acc; }, {})
);

/* =====================================================================
 * Dispatch — builds an Arch tool against the live kernel and returns
 * { ok, handle, ifcType, voids, error }.
 *
 * `hostBodyHandle` — optional host wall handle to subtract the opening
 * voids from. When provided, the dispatcher returns BOTH the modified
 * host handle and the inserted frame handle so the caller can replace
 * the host body in the shell registry in one step.
 * ===================================================================== */

export function dispatchArchTool(toolId, params, opts = {}) {
  const tool = ARCH_TOOLS_BY_ID[toolId];
  if (!tool) {
    return { ok: false, error: `Unknown arch tool: ${toolId}` };
  }
  const kernel = opts.kernel
    || (typeof window !== 'undefined' ? window.forge : null);
  if (!kernelReady(kernel)) {
    return {
      ok: false,
      error: 'forge-kernel.node is not loaded — native OCCT kernel required for Arch tools',
      toolId, ifcType: tool.ifcType,
    };
  }
  try {
    const { handle, voids } = tool.build(params || {}, kernel);
    let cutHostHandle = null;
    if (typeof opts.hostBodyHandle === 'number' && Array.isArray(voids) && voids.length) {
      cutHostHandle = cutAll(kernel, opts.hostBodyHandle, voids);
    }
    return {
      ok: true,
      handle,
      voids,
      ifcType: tool.ifcType,
      toolId,
      cutHostHandle,
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      toolId, ifcType: tool.ifcType,
    };
  }
}

/* =====================================================================
 * Test re-exports — every helper the e2e + unit tests need.
 * ===================================================================== */

export const __test = {
  kernelReady, fuseAll, cutAll, placeBox, placeCyl, MM,
};
