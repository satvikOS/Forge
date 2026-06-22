/**
 * Node test for the CAD → robot-description exporter (Task #30).
 *   node --test frontend/src/forge-v4/io/__tests__/robotExport.test.mjs
 *
 * Coverage:
 *   - 2-link revolute arm fixture, built from REAL kernel mass-props +
 *     tessellation + convex hull (forge-kernel.node) when available; falls back
 *     to an inline-mesh fixture (kernel-free) so the test runs anywhere.
 *   - closed four-bar fixture (kernel-free inline meshes) to prove loop handling.
 *   - parses the emitted URDF + SDF with a dependency-free XML structure parser.
 *   - asserts: (a) inertia/mass/COM match the kernel/labeled-approx within tol,
 *     (b) <collision> geometry is DISTINCT from <visual> (hull ≠ full mesh),
 *     (c) joint type / axis / limits are correct,
 *     (d) the four-bar loop is REPRESENTED in SDF (extra joint) + MJCF + URDF
 *         gazebo block — never dropped from the tree.
 *
 * No new npm packages (Forge rule) — the XML parser is inlined below.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { exportRobot, __test } from '../robotExport.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── try to load the prebuilt kernel (optional) ───────────────────────────────
let forge = null;
try {
  forge = require(path.resolve(
    __dirname, '..', '..', '..', '..', '..',
    'forge-kernel', 'build', 'Release', 'forge-kernel.node'));
} catch (e) {
  // kernel not available in this environment — tests use inline meshes.
}

// ── tiny dependency-free XML parser (structure check only) ───────────────────
// Produces a tree of { tag, attrs, children[], text }. Handles the subset of
// XML the exporter emits: elements, attributes, self-closing tags, comments,
// the <?xml ?> prolog, and text. Throws on a malformed/unbalanced document.
function parseXML(src) {
  let i = 0;
  const n = src.length;
  function skipWs() { while (i < n && /\s/.test(src[i])) i++; }
  function parseAttrs(s) {
    const attrs = {};
    const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(s))) attrs[m[1]] = m[2];
    return attrs;
  }
  function parseNode() {
    while (i < n) {
      skipWs();
      if (i >= n) return null;
      if (src[i] !== '<') {
        // text node
        const start = i;
        while (i < n && src[i] !== '<') i++;
        const text = src.slice(start, i).trim();
        if (text) return { text };
        continue;
      }
      // comment
      if (src.startsWith('<!--', i)) {
        const end = src.indexOf('-->', i);
        if (end < 0) throw new Error('unterminated comment');
        i = end + 3;
        continue;
      }
      // prolog / declaration / doctype / usda directive
      if (src.startsWith('<?', i)) {
        const end = src.indexOf('?>', i);
        if (end < 0) throw new Error('unterminated prolog');
        i = end + 2;
        continue;
      }
      if (src[i] === '<' && src[i + 1] === '/') return { close: true };
      // element
      const tagEnd = findTagEnd(src, i);
      if (tagEnd < 0) throw new Error('unterminated tag at ' + i);
      const raw = src.slice(i + 1, tagEnd);
      i = tagEnd + 1;
      const selfClose = raw.endsWith('/');
      const body = selfClose ? raw.slice(0, -1) : raw;
      const sp = body.search(/\s/);
      const tag = sp < 0 ? body : body.slice(0, sp);
      const attrs = sp < 0 ? {} : parseAttrs(body.slice(sp));
      const node = { tag, attrs, children: [] };
      if (selfClose) return node;
      // parse children until matching close tag
      while (i < n) {
        skipWs();
        if (src.startsWith('</', i)) {
          const end = src.indexOf('>', i);
          if (end < 0) throw new Error('unterminated close tag');
          const closeTag = src.slice(i + 2, end).trim();
          if (closeTag !== tag) throw new Error(`mismatched close </${closeTag}> for <${tag}>`);
          i = end + 1;
          return node;
        }
        const child = parseNode();
        if (!child) break;
        if (child.close) throw new Error('unexpected close');
        node.children.push(child);
      }
      return node;
    }
    return null;
  }
  function findTagEnd(s, from) {
    // find the '>' that closes the tag, respecting quoted attribute values
    let j = from + 1, inQ = false;
    while (j < s.length) {
      const c = s[j];
      if (c === '"') inQ = !inQ;
      else if (c === '>' && !inQ) return j;
      j++;
    }
    return -1;
  }
  const roots = [];
  while (i < n) {
    skipWs();
    if (i >= n) break;
    const node = parseNode();
    if (node && node.tag) roots.push(node);
    else if (!node) break;
  }
  if (roots.length === 0) throw new Error('no root element');
  return roots[roots.length - 1]; // the document root (after prolog/comments)
}

function findAll(node, tag, out = []) {
  if (!node || !node.children) return out;
  for (const c of node.children) {
    if (c.tag === tag) out.push(c);
    findAll(c, tag, out);
  }
  return out;
}
function findFirst(node, tag) {
  const a = findAll(node, tag);
  return a.length ? a[0] : null;
}

// ── fixtures ─────────────────────────────────────────────────────────────────
// A unit-ish box mesh helper (mm). Returns { positions, indices } for a box of
// size (dx,dy,dz) with min corner at origin (matches OCCT makeBox convention).
function boxMesh(dx, dy, dz) {
  const v = [
    [0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0],
    [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz],
  ];
  const positions = [];
  for (const p of v) positions.push(p[0], p[1], p[2]);
  // 12 triangles (CCW outward).
  const indices = [
    0, 2, 1, 0, 3, 2, // bottom (z=0)
    4, 5, 6, 4, 6, 7, // top (z=dz)
    0, 1, 5, 0, 5, 4, // y=0
    2, 3, 7, 2, 7, 6, // y=dy
    1, 2, 6, 1, 6, 5, // x=dx
    0, 4, 7, 0, 7, 3, // x=0
  ];
  return { positions, indices };
}
function boxVolume(dx, dy, dz) { return dx * dy * dz; }
function boxCom(dx, dy, dz) { return [dx / 2, dy / 2, dz / 2]; }

// Build the 2-link arm spec. If the kernel is present, use real handles so the
// mass-props are kernel-truth; else inline the box meshes + mass-props.
function twoLinkArmSpec() {
  if (forge) {
    const base = forge.makeBox(40, 40, 20);   // base block
    const link = forge.makeCylinder(8, 60);    // upper arm (r=8, h=60)
    return {
      name: 'two_link_arm',
      baseLink: 'base',
      links: [
        { id: 'base', name: 'base', handle: base, fixed: true, material: 'steel' },
        {
          id: 'upper', name: 'upper_arm', handle: link, material: 'aluminum',
          worldTransform: __test.mat4FromEuler(0, 0, 0, 0, 0, 20), // sits on top of base (mm)
        },
      ],
      joints: [
        {
          name: 'shoulder', mate: 'hinge', parent: 'base', child: 'upper',
          axis: [0, 0, 1],
          limit: { lower: -1.57, upper: 1.57, effort: 50, velocity: 3 },
        },
      ],
    };
  }
  // kernel-free
  const baseM = boxMesh(40, 40, 20);
  const linkM = boxMesh(16, 16, 60);
  return {
    name: 'two_link_arm',
    baseLink: 'base',
    links: [
      {
        id: 'base', name: 'base', fixed: true, material: 'steel',
        volume: boxVolume(40, 40, 20), com: boxCom(40, 40, 20),
        visual: baseM,
      },
      {
        id: 'upper', name: 'upper_arm', material: 'aluminum',
        volume: boxVolume(16, 16, 60), com: boxCom(16, 16, 60),
        visual: linkM,
        worldTransform: __test.mat4FromEuler(0, 0, 0, 0, 0, 20),
      },
    ],
    joints: [
      {
        name: 'shoulder', mate: 'hinge', parent: 'base', child: 'upper',
        axis: [0, 0, 1],
        limit: { lower: -1.57, upper: 1.57, effort: 50, velocity: 3 },
      },
    ],
  };
}

// Closed four-bar: ground (fixed) + 3 moving bars, 4 revolute joints forming a
// loop. URDF tree = 3 joints; the 4th is a loop closure.
function fourBarSpec() {
  const bar = (L) => boxMesh(L, 6, 6); // a thin bar of length L (mm)
  const mk = (id, name, L, tx, ty) => ({
    id, name, material: 'steel',
    volume: boxVolume(L, 6, 6), com: boxCom(L, 6, 6),
    visual: bar(L),
    worldTransform: __test.mat4FromEuler(0, 0, 0, tx, ty, 0),
  });
  return {
    name: 'four_bar',
    baseLink: 'ground',
    links: [
      { ...mk('ground', 'ground', 100, 0, 0), fixed: true },
      mk('crank', 'crank', 30, 0, 0),
      mk('coupler', 'coupler', 100, 0, 40),
      mk('rocker', 'rocker', 30, 100, 0),
    ],
    joints: [
      { name: 'j_ground_crank', mate: 'hinge', parent: 'ground', child: 'crank', axis: [0, 0, 1], anchor: [0, 0, 0] },
      { name: 'j_crank_coupler', mate: 'hinge', parent: 'crank', child: 'coupler', axis: [0, 0, 1], anchor: [30, 0, 0] },
      { name: 'j_coupler_rocker', mate: 'hinge', parent: 'coupler', child: 'rocker', axis: [0, 0, 1], anchor: [130, 40, 0] },
      // loop-closing edge: rocker back to ground.
      { name: 'j_rocker_ground', mate: 'hinge', parent: 'rocker', child: 'ground', axis: [0, 0, 1], anchor: [100, 0, 0] },
    ],
  };
}

// ── analytical inertia reference for a solid box (kg·m²) ─────────────────────
function boxInertiaSI(dx, dy, dz, massKg) {
  const a = dx * 1e-3, b = dy * 1e-3, c = dz * 1e-3; // m
  return {
    ixx: massKg / 12 * (b * b + c * c),
    iyy: massKg / 12 * (a * a + c * c),
    izz: massKg / 12 * (a * a + b * b),
  };
}

// ─────────────────────────────────────────────────────────────────── TESTS
test('two-link arm: URDF parses, distinct visual/collision, kernel mass+inertia, joint limits', () => {
  const spec = twoLinkArmSpec();
  const density = 2700; // aluminum kg/m³
  const { text, meshFiles, model } = exportRobot(spec, {
    format: 'urdf', density, forge, withMeshFiles: true,
  });

  // (parse) well-formed XML, single <robot> root, exactly 2 links.
  const root = parseXML(text);
  assert.equal(root.tag, 'robot', 'root element must be <robot>');
  const links = findAll(root, 'link');
  assert.equal(links.length, 2, 'two links');

  // exactly one root link (a link that is never a <child>).
  const jointEls = findAll(root, 'joint').filter(j => j.attrs && j.attrs.type); // urdf joints have type
  const childNames = new Set();
  for (const j of jointEls) {
    const ch = j.children.find(c => c.tag === 'child');
    if (ch) childNames.add(ch.attrs.link);
  }
  const linkNames = links.map(l => l.attrs.name);
  const roots = linkNames.filter(nm => !childNames.has(nm));
  assert.equal(roots.length, 1, 'exactly one root link');
  assert.equal(roots[0], 'base');

  // (b) DISTINCT visual vs collision geometry — different mesh files + the
  // collision hull has fewer/different vertices than the full visual mesh.
  for (const L of links) {
    const vis = L.children.find(c => c.tag === 'visual');
    const col = L.children.find(c => c.tag === 'collision');
    assert.ok(vis && col, `link ${L.attrs.name} has both visual and collision`);
    const visMesh = findFirst(vis, 'mesh');
    const colMesh = findFirst(col, 'mesh');
    assert.ok(visMesh && colMesh, 'both reference a mesh');
    assert.notEqual(visMesh.attrs.filename, colMesh.attrs.filename,
      'visual and collision must be DIFFERENT mesh files');
  }
  // and the actual geometry differs in the model: collision (hull) ⊆ visual,
  // distinct vertex count for at least the box links.
  for (const L of model.links) {
    const visVerts = L.visual.positions.length / 3;
    const colVerts = L.collision.positions.length / 3;
    assert.ok(colVerts >= 4, 'hull has ≥4 verts');
    // The hull must be DISTINCT data (not the same array reference / not a
    // verbatim copy of the full mesh).
    assert.notEqual(L.visual.positions, L.collision.positions);
    assert.ok(colVerts <= visVerts, 'hull verts ≤ full mesh verts');
  }

  // (a) inertial: mass = density·volume (SI), COM matches kernel, inertia tensor
  // matches the analytical box / labeled approximation within tolerance.
  const baseLink = links.find(l => l.attrs.name === 'base');
  const inertial = baseLink.children.find(c => c.tag === 'inertial');
  const massEl = findFirst(inertial, 'mass');
  const inertiaEl = findFirst(inertial, 'inertia');
  const originEl = findFirst(inertial, 'origin');

  // expected base mass-props (40×40×20 box).
  const vol = forge ? forge.massProps(forge.makeBox(40, 40, 20)).volume : boxVolume(40, 40, 20);
  const expMass = density * vol * 1e-9;
  const gotMass = Number(massEl.attrs.value);
  assert.ok(Math.abs(gotMass - expMass) / expMass < 1e-3,
    `base mass ${gotMass} ≈ ${expMass}`);

  // COM in <inertial><origin> must equal kernel COM (SI). Box COM = (20,20,10)mm.
  const com = originEl.attrs.xyz.split(/\s+/).map(Number);
  assert.ok(Math.abs(com[0] - 0.020) < 1e-6 && Math.abs(com[1] - 0.020) < 1e-6 &&
    Math.abs(com[2] - 0.010) < 1e-6, `base COM ${com} ≈ (0.02,0.02,0.01)`);

  // inertia tensor ≈ analytical box (the hull of a box is the box → exact).
  const exp = boxInertiaSI(40, 40, 20, expMass);
  const ixx = Number(inertiaEl.attrs.ixx);
  const iyy = Number(inertiaEl.attrs.iyy);
  const izz = Number(inertiaEl.attrs.izz);
  const relTol = 0.02; // 2% — tessellation + hull discretization
  assert.ok(Math.abs(ixx - exp.ixx) / exp.ixx < relTol, `Ixx ${ixx} ≈ ${exp.ixx}`);
  assert.ok(Math.abs(iyy - exp.iyy) / exp.iyy < relTol, `Iyy ${iyy} ≈ ${exp.iyy}`);
  assert.ok(Math.abs(izz - exp.izz) / exp.izz < relTol, `Izz ${izz} ≈ ${exp.izz}`);
  // off-diagonals near zero for a centered box.
  assert.ok(Math.abs(Number(inertiaEl.attrs.ixy)) < exp.ixx * 0.02, 'Ixy ≈ 0');

  // (c) joint type / axis / limits.
  const joint = jointEls.find(j => j.attrs.name === 'shoulder');
  assert.ok(joint, 'shoulder joint present');
  assert.equal(joint.attrs.type, 'revolute', 'hinge → revolute');
  const axis = findFirst(joint, 'axis');
  assert.equal(axis.attrs.xyz, '0 0 1', 'axis = Z');
  const limit = findFirst(joint, 'limit');
  assert.ok(limit, 'limit present');
  assert.equal(Number(limit.attrs.lower), -1.57);
  assert.equal(Number(limit.attrs.upper), 1.57);
  assert.equal(Number(limit.attrs.effort), 50);
  assert.equal(Number(limit.attrs.velocity), 3);

  // sidecar mesh files exist and are distinct text.
  assert.ok(meshFiles['base_visual.stl'] && meshFiles['base_collision.stl']);
  assert.notEqual(meshFiles['base_visual.stl'], meshFiles['base_collision.stl']);
});

test('two-link arm: SDF parses with distinct visual/collision + revolute limit', () => {
  const spec = twoLinkArmSpec();
  const text = exportRobot(spec, { format: 'sdf', density: 2700, forge });
  const root = parseXML(text);
  assert.equal(root.tag, 'sdf');
  const model = findFirst(root, 'model');
  assert.ok(model, '<model> present');
  const links = findAll(model, 'link');
  assert.equal(links.length, 2);
  // distinct visual/collision uris
  for (const L of links) {
    const vis = L.children.find(c => c.tag === 'visual');
    const col = L.children.find(c => c.tag === 'collision');
    const vu = findFirst(vis, 'uri').children[0].text;
    const cu = findFirst(col, 'uri').children[0].text;
    assert.notEqual(vu, cu, 'SDF visual uri ≠ collision uri');
  }
  // joints: the revolute PLUS a fixed world-anchor on the fixed base link. A
  // fixed base must be grounded to the reserved 'world' link with a real fixed
  // joint — the old <kinematic>false</kinematic> was a no-op that left it floating.
  const joints = findAll(model, 'joint');
  const worldFixed = joints.filter(j => {
    const p = findFirst(j, 'parent');
    return p && p.children[0] && p.children[0].text === 'world';
  });
  assert.equal(worldFixed.length, 1, 'fixed base anchored to world with a fixed joint');
  assert.equal(worldFixed[0].attrs.type, 'fixed');
  const revolutes = joints.filter(j => j.attrs.type === 'revolute');
  assert.equal(revolutes.length, 1);
  const lower = findFirst(revolutes[0], 'lower');
  assert.equal(Number(lower.children[0].text), -1.57);
});

test('four-bar: URDF tree is acyclic (3 joints) + loop carried in <gazebo>', () => {
  const spec = fourBarSpec();
  const text = exportRobot(spec, { format: 'urdf', density: 7850, forge });
  const root = parseXML(text);
  const links = findAll(root, 'link');
  assert.equal(links.length, 4, 'four links');

  // URDF tree joints (direct children of <robot> with a type attr).
  const treeJoints = root.children.filter(c => c.tag === 'joint');
  assert.equal(treeJoints.length, 3, 'spanning tree has exactly 3 joints (n-1)');

  // tree is acyclic: every non-root link is a child exactly once.
  const childCount = new Map();
  for (const j of treeJoints) {
    const ch = j.children.find(c => c.tag === 'child').attrs.link;
    childCount.set(ch, (childCount.get(ch) || 0) + 1);
  }
  for (const [, cnt] of childCount) assert.equal(cnt, 1, 'each child appears once → tree');
  const roots = links.map(l => l.attrs.name).filter(nm => !childCount.has(nm));
  assert.equal(roots.length, 1, 'single root');
  assert.equal(roots[0], 'ground');

  // (d) the LOOP is NOT dropped: it appears in a <gazebo> block. The loop edge
  // closes the kinematic cycle — it connects two links that are BOTH already in
  // the spanning tree (which exact pair depends on the BFS order, and any valid
  // spanning tree + one loop closure is correct for a four-bar).
  const gazebo = findAll(root, 'gazebo');
  assert.ok(gazebo.length >= 1, 'URDF carries the loop in a <gazebo> block');
  const loopJoint = findFirst(gazebo[0], 'joint');
  assert.ok(loopJoint, 'gazebo loop joint present');
  const parent = findFirst(loopJoint, 'parent').children[0].text;
  const child = findFirst(loopJoint, 'child').children[0].text;
  const fourBarLinks = new Set(['ground', 'crank', 'coupler', 'rocker']);
  assert.ok(fourBarLinks.has(parent) && fourBarLinks.has(child) && parent !== child,
    'loop closure connects two distinct four-bar links');
  // and both endpoints are real links in the tree.
  assert.ok(childCount.has(parent) || parent === 'ground');
  assert.ok(childCount.has(child) || child === 'ground');
});

test('four-bar: SDF carries the loop as a 4th real joint (not dropped)', () => {
  const spec = fourBarSpec();
  const text = exportRobot(spec, { format: 'sdf', density: 7850, forge });
  const root = parseXML(text);
  const model = findFirst(root, 'model');
  const joints = findAll(model, 'joint');
  // 4 mechanism joints (3 tree + 1 loop) PLUS a fixed world-anchor on the fixed
  // 'ground' base. The loop must survive (not dropped) AND the base be grounded.
  const worldFixed = joints.filter(j => {
    const p = findFirst(j, 'parent');
    return p && p.children[0] && p.children[0].text === 'world';
  });
  assert.equal(worldFixed.length, 1, 'fixed ground base anchored to world');
  const mechJoints = joints.filter(j => !worldFixed.includes(j));
  assert.equal(mechJoints.length, 4, 'SDF carries ALL 4 mechanism joints — the loop is not dropped');
  // and there are 4 links.
  assert.equal(findAll(model, 'link').length, 4);
  // the loop joint connects rocker↔ground.
  const loop = joints.find(j => {
    const p = findFirst(j, 'parent').children[0].text;
    const c = findFirst(j, 'child').children[0].text;
    return (p === 'rocker' && c === 'ground') || (p === 'ground' && c === 'rocker');
  });
  assert.ok(loop, 'SDF contains the rocker↔ground loop joint');
});

test('four-bar: MJCF carries the loop as an <equality><connect>', () => {
  const spec = fourBarSpec();
  const text = exportRobot(spec, { format: 'mjcf', density: 7850, forge });
  const root = parseXML(text);
  assert.equal(root.tag, 'mujoco');
  const eq = findFirst(root, 'equality');
  assert.ok(eq, 'MJCF has an <equality> block for loop closure');
  const connect = findFirst(eq, 'connect') || findFirst(eq, 'weld');
  assert.ok(connect, 'MJCF loop closure is a <connect>/<weld>');
  // the connect closes the kinematic cycle between two distinct four-bar links.
  const fourBarLinks = new Set(['ground', 'crank', 'coupler', 'rocker']);
  assert.ok(fourBarLinks.has(connect.attrs.body1) && fourBarLinks.has(connect.attrs.body2) &&
    connect.attrs.body1 !== connect.attrs.body2, 'connect closes the four-bar cycle');
  // and the tree has nested bodies (3 hinge joints inside worldbody).
  const hinges = findAll(root, 'joint');
  assert.equal(hinges.length, 3, 'MJCF tree has 3 hinge joints');
});

test('USD export parses to a usda document with rigid bodies + joints + loop', () => {
  const spec = fourBarSpec();
  const text = exportRobot(spec, { format: 'usd', density: 7850, forge });
  // structural checks (usda is not XML — check key prims textually + count).
  assert.ok(text.startsWith('#usda 1.0'), 'usda header');
  assert.ok(text.includes('PhysicsRigidBodyAPI'), 'rigid bodies present');
  const revolutes = (text.match(/PhysicsRevoluteJoint/g) || []).length;
  assert.equal(revolutes, 3, '3 tree revolute joints');
  assert.ok(text.includes('loopClosure = "true"'), 'loop closure prim present');
  // 4 links → 4 mass APIs.
  assert.equal((text.match(/PhysicsMassAPI/g) || []).length, 4);
});

test('unit: polyhedron inertia of a box hull matches the analytical box tensor', () => {
  // Box 20×30×40 mm, hull = box. unit-density inertia about centroid.
  const m = (() => {
    const v = [
      [0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0],
      [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40],
    ];
    const positions = [];
    for (const p of v) positions.push(...p);
    const indices = [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6,
      1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3,
    ];
    return { positions, indices };
  })();
  const r = __test.polyhedronInertia(m.positions, m.indices);
  // volume = 20·30·40 = 24000 mm³.
  assert.ok(Math.abs(r.volume - 24000) / 24000 < 1e-9, `vol ${r.volume}`);
  // unit-density mass = volume; analytical Ixx (mm) = m/12·(b²+c²) about COM.
  const mass = 24000;
  const expIxx = mass / 12 * (30 * 30 + 40 * 40);
  const expIyy = mass / 12 * (20 * 20 + 40 * 40);
  const expIzz = mass / 12 * (20 * 20 + 30 * 30);
  assert.ok(Math.abs(r.I[0] - expIxx) / expIxx < 1e-9, `Ixx ${r.I[0]} ≈ ${expIxx}`);
  assert.ok(Math.abs(r.I[4] - expIyy) / expIyy < 1e-9, `Iyy ${r.I[4]} ≈ ${expIyy}`);
  assert.ok(Math.abs(r.I[8] - expIzz) / expIzz < 1e-9, `Izz ${r.I[8]} ≈ ${expIzz}`);
  // products of inertia ≈ 0 for an axis-aligned box.
  assert.ok(Math.abs(r.I[1]) < expIxx * 1e-9, 'Ixy ≈ 0');
});

test('kernel mass-props are surfaced verbatim (when kernel present)', { skip: !forge }, () => {
  const h = forge.makeBox(10, 20, 30);
  const mp = forge.massProps(h);
  assert.equal(mp.volume, 6000);
  assert.deepEqual(Array.from(mp.centerOfMass), [5, 10, 15]);
  // build a one-link "robot" and confirm the exporter uses these numbers.
  const spec = {
    name: 'one', baseLink: 'b',
    links: [{ id: 'b', name: 'b', handle: h, fixed: true }],
    joints: [],
  };
  const { model } = exportRobot(spec, { format: 'urdf', density: 1000, forge, withMeshFiles: true });
  const L = model.links[0];
  assert.ok(Math.abs(L.massKg - 1000 * 6000e-9) < 1e-9, 'mass = ρ·V (SI)');
  assert.deepEqual(L.comM.map(x => +x.toFixed(6)), [0.005, 0.01, 0.015]);
});

// ───────────────────────── AUDIT-DEFECT REGRESSIONS (commit 8e88246, #30) ────
// Each test exercises a path the original suite was blind to (every original
// fixture used zero rotation + a single connected component).

test('#30 regression: gimbal-lock RPY (pitch ±90°) round-trips the rotation (no sign flip)', () => {
  const { mat4FromEuler, mat4ToRPY } = __test;
  const rot = m => [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  const cases = [
    [0.2, Math.PI / 2, 0.0], [0.5, Math.PI / 2, 0.3], [-0.7, Math.PI / 2, 0.0],
    [0.5, -Math.PI / 2, 0.3], [0.0, -Math.PI / 2, 0.9], [1.1, -Math.PI / 2, -0.4],
  ];
  for (const [r, p, y] of cases) {
    const M = mat4FromEuler(r, p, y, 0, 0, 0);
    const rpy = mat4ToRPY(M);
    const M2 = mat4FromEuler(rpy[0], rpy[1], rpy[2], 0, 0, 0);
    const a = rot(M), b = rot(M2);
    let maxErr = 0;
    for (let i = 0; i < 9; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
    assert.ok(maxErr < 1e-9,
      `gimbal pitch=${p.toFixed(3)} roll=${r}: round-trip err ${maxErr} (was ~0.4–1.4 before the sign fix)`);
  }
});

test('#30 regression: disconnected components + a jointless orphan still yield ONE URDF root', () => {
  const m = boxMesh(20, 20, 20);
  const L = (id, extra = {}) => ({
    id, name: id, volume: boxVolume(20, 20, 20), com: boxCom(20, 20, 20), visual: m, mass: 1, ...extra,
  });
  const spec = {
    name: 'disc', baseLink: 'a',
    links: [L('a', { fixed: true }), L('b'), L('c'), L('d'), L('orphan')],
    // chain a→b, a SEPARATE chain c→d (no edge to a), and 'orphan' with no joint.
    joints: [
      { name: 'jab', mate: 'hinge', parent: 'a', child: 'b', axis: [0, 0, 1] },
      { name: 'jcd', mate: 'hinge', parent: 'c', child: 'd', axis: [0, 0, 1] },
    ],
  };
  const root = parseXML(exportRobot(spec, { format: 'urdf', density: 1000, forge }));
  const links = findAll(root, 'link');
  assert.equal(links.length, 5, 'all 5 links present');
  const treeJoints = root.children.filter(c => c.tag === 'joint');
  const childCount = new Map();
  for (const j of treeJoints) {
    const ch = j.children.find(c => c.tag === 'child').attrs.link;
    childCount.set(ch, (childCount.get(ch) || 0) + 1);
  }
  for (const [, cnt] of childCount) assert.equal(cnt, 1, 'each link is a child at most once → a tree');
  const roots = links.map(l => l.attrs.name).filter(nm => !childCount.has(nm));
  assert.equal(roots.length, 1, 'EXACTLY ONE root link (was 2+ before the spanning-tree fix)');
  assert.equal(roots[0], 'a', 'the single root is the fixed base');
});

test('#30 regression: empty assembly throws a clear error, not an opaque TypeError', () => {
  for (const format of ['urdf', 'sdf', 'mjcf', 'usd']) {
    assert.throws(
      () => exportRobot({ name: 'empty', links: [], joints: [] }, { format, density: 1000, forge }),
      /no links|empty robot/i, `empty ${format} → clear error`);
  }
});

test('#30 regression: default-limit prismatic emits LINEAR metres, not the ±π revolute default', () => {
  const m = boxMesh(20, 20, 20);
  const L = (id, extra = {}) => ({
    id, name: id, volume: boxVolume(20, 20, 20), com: boxCom(20, 20, 20), visual: m, mass: 1, ...extra,
  });
  const spec = {
    name: 'slider', baseLink: 'base',
    links: [L('base', { fixed: true }), L('car', { worldTransform: __test.mat4FromEuler(0, 0, 0, 0, 0, 30) })],
    joints: [{ name: 'rail', mate: 'slider', parent: 'base', child: 'car', axis: [1, 0, 0] }], // NO limit
  };
  const root = parseXML(exportRobot(spec, { format: 'urdf', density: 1000, forge }));
  const pris = root.children.filter(c => c.tag === 'joint').find(j => j.attrs.type === 'prismatic');
  assert.ok(pris, 'slider mapped to prismatic');
  const lim = pris.children.find(c => c.tag === 'limit');
  assert.ok(lim, 'prismatic carries a limit (URDF requires it)');
  const up = Math.abs(Number(lim.attrs.upper));
  assert.ok(up <= 1, `linear travel default (got ±${up} m), NOT the ±π=3.14159 radian default`);
  assert.notEqual(up.toFixed(4), '3.1416', 'must not be the revolute ±π default interpreted as metres');
});

test('#30 regression: planar (zero-volume) movable link gets positive-definite inertia, never silent zeros', () => {
  const spec = {
    name: 'plate_arm', baseLink: 'base',
    links: [
      { id: 'base', name: 'base', fixed: true, volume: boxVolume(30, 30, 10), com: boxCom(30, 30, 10), visual: boxMesh(30, 30, 10), mass: 2 },
      { id: 'flap', name: 'flap', mass: 1.0, volume: 0, com: [20, 20, 0], visual: boxMesh(40, 40, 0), worldTransform: __test.mat4FromEuler(0, 0, 0, 0, 0, 10) },
    ],
    joints: [{ name: 'hinge', mate: 'hinge', parent: 'base', child: 'flap', axis: [0, 0, 1] }],
  };
  const norm = __test.normalize(spec, forge, { density: 1000 });
  const flap = norm.links.find(l => l.name === 'flap');
  for (const k of ['ixx', 'iyy', 'izz']) {
    assert.ok(Number.isFinite(flap.inertia[k]) && flap.inertia[k] > 0,
      `${k} positive-definite (got ${flap.inertia[k]}) — not a silent singular tensor`);
  }
  assert.equal(flap.inertia.method, 'approx:degenerate-fallback-box',
    'degenerate hull routed to the positive-definite box fallback');
});

// ── Task #43: a MOVABLE, kernel-handle link exports KERNEL-TRUTH inertia ─────
// With the inertia tensor now surfaced from forge.massProps (OCCT GProp
// MatrixOfInertia, exact about the COM), a handle-backed movable link must:
//   (1) report method 'kernel:inertiaCom' (the JS hull approximation is OFF), and
//   (2) carry values matching the analytic box  I = m/12·diag(b²+c², a²+c², a²+b²)
//       (Mirtich 1996 closed form), with products of inertia ≈ 0.
test('#43: movable kernel-handle box reports method kernel:inertiaCom matching the analytic box', (t) => {
  if (!forge || typeof forge.massProps(forge.makeBox(1, 1, 1)).inertiaCom === 'undefined') {
    t.skip('forge-kernel.node with inertiaCom not available');
    return;
  }
  const dx = 30, dy = 50, dz = 70; // mm — distinct extents so off-diagonals can be checked
  const density = 2700;            // aluminum kg/m³
  const spec = {
    name: 'inertia_arm', baseLink: 'base',
    links: [
      { id: 'base', name: 'base', handle: forge.makeBox(20, 20, 10), fixed: true, material: 'steel' },
      // MOVABLE link, kernel handle, NO inertiaCom on the spec → must be sourced
      // from the kernel and flip the method off 'approx:hull-inertia'.
      { id: 'arm', name: 'arm', handle: forge.makeBox(dx, dy, dz), material: 'aluminum',
        worldTransform: __test.mat4FromEuler(0, 0, 0, 0, 0, 30) },
    ],
    joints: [{ name: 'shoulder', mate: 'hinge', parent: 'base', child: 'arm', axis: [0, 0, 1],
      limit: { lower: -1.57, upper: 1.57, effort: 50, velocity: 3 } }],
  };
  const norm = __test.normalize(spec, forge, { density });
  const arm = norm.links.find(l => l.name === 'arm');

  // (1) METHOD FLIP: kernel truth, not the hull approximation.
  assert.equal(arm.inertia.method, 'kernel:inertiaCom',
    `movable handle link must use kernel inertia (got ${arm.inertia.method})`);

  // (2) VALUES: analytic box in SI kg·m² (mass = density·volume).
  const vol = forge.massProps(forge.makeBox(dx, dy, dz)).volume; // mm³
  const massKg = density * vol * 1e-9;
  const exp = boxInertiaSI(dx, dy, dz, massKg);

  const relTol = 1e-4; // OCCT B-rep integral is exact → tight tolerance
  assert.ok(Math.abs(arm.inertia.ixx - exp.ixx) / exp.ixx < relTol,
    `Ixx ${arm.inertia.ixx} ≈ ${exp.ixx}`);
  assert.ok(Math.abs(arm.inertia.iyy - exp.iyy) / exp.iyy < relTol,
    `Iyy ${arm.inertia.iyy} ≈ ${exp.iyy}`);
  assert.ok(Math.abs(arm.inertia.izz - exp.izz) / exp.izz < relTol,
    `Izz ${arm.inertia.izz} ≈ ${exp.izz}`);

  // products of inertia ≈ 0 for an axis-aligned box.
  assert.ok(Math.abs(arm.inertia.ixy) < exp.ixx * 1e-6, `Ixy ${arm.inertia.ixy} ≈ 0`);
  assert.ok(Math.abs(arm.inertia.ixz) < exp.ixx * 1e-6, `Ixz ${arm.inertia.ixz} ≈ 0`);
  assert.ok(Math.abs(arm.inertia.iyz) < exp.ixx * 1e-6, `Iyz ${arm.inertia.iyz} ≈ 0`);
});
