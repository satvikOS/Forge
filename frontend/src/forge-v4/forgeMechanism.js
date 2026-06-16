// Forge Mechanism Director — full mechanics with real kinematics.
//
// Builds a working mechanism's parts via the OCCT kernel (window.forge) and returns a
// pose(driveAngle) function giving each part's planar transform from the actual
// kinematics — piston-crank (slider-crank), four-bar linkage, gear pair, robot arm.
// Not a canned spin: the conrod angle + piston stroke + coupler path are SOLVED each
// step, so the assembly moves the way the mechanism really would. The e2e/render queue
// tessellates the part handles once and applies pose() per frame → an animated mechanism.
//
// window.__forgeMechanism(type) → { parts:[{handle,color,pose(theta)->{pos:[x,y,z],rotZ}}], dof, label }

function F() { return (typeof window !== 'undefined' && window.forge) || null; }

// slider-crank: crank (radius rc) drives a conrod (length L) → piston slides on +X.
function pistonCrank(forge, { rc = 18, L = 60, pistonR = 16, shaftR = 6 } = {}) {
  const shaft = forge.makeCylinder(shaftR, 24);                          // crankshaft (spins about Z@origin)
  const web = forge.makeBox(rc + 10, 14, 10);                           // crank web
  const pin = forge.makeCylinder(5, 28);                                 // crank pin
  const rod = forge.makeBox(L, 9, 9);                                    // connecting rod (length along X)
  const piston = forge.makeCylinder(pistonR, 30);                        // piston (slides on X)
  const block = forge.makeBox(50, pistonR * 2 + 12, 40);                 // static cylinder block
  const crankPin = (th) => [Math.cos(th) * rc, Math.sin(th) * rc];
  const pistonX = (th) => { const x = Math.cos(th) * rc; const y = Math.sin(th) * rc; return x + Math.sqrt(Math.max(0, L * L - y * y)); };
  return { dof: 'crank angle', label: 'slider-crank (piston engine)', parts: [
    { handle: block, color: 0x556070, pose: () => ({ pos: [Math.max(0, rc + L) + 25, 0, 0], rotZ: 0 }) },
    { handle: shaft, color: 0x9aa0a8, pose: () => ({ pos: [0, 0, 0], rotZ: 0, axis: 'z' }) },
    { handle: web, color: 0xc85a26, pose: (th) => ({ pos: [Math.cos(th) * rc / 2, Math.sin(th) * rc / 2, 0], rotZ: th }) },
    { handle: pin, color: 0xc0c6cf, pose: (th) => { const [x, y] = crankPin(th); return { pos: [x, y, 0], rotZ: 0 }; } },
    { handle: rod, color: 0x2f5fa6, pose: (th) => { const [x, y] = crankPin(th); const px = pistonX(th); const cx = (x + px) / 2, cy = y / 2; const ang = Math.atan2(0 - y, px - x); return { pos: [cx, cy, 0], rotZ: ang }; } },
    { handle: piston, color: 0xb8bcc2, pose: (th) => ({ pos: [pistonX(th), 0, 0], rotZ: Math.PI / 2 }) },
  ] };
}

// four-bar linkage: crank + coupler + rocker on a fixed ground link.
function fourBar(forge, { ground = 80, crank = 24, coupler = 78, rocker = 50 } = {}) {
  const mk = (len) => forge.makeBox(len, 7, 7);
  const A = [0, 0], D = [ground, 0];
  const solve = (th) => {
    const B = [crank * Math.cos(th), crank * Math.sin(th)];
    const dx = D[0] - B[0], dy = D[1] - B[1]; const d = Math.hypot(dx, dy);
    const a = (coupler * coupler - rocker * rocker + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, coupler * coupler - a * a));
    const mx = B[0] + a * dx / d, my = B[1] + a * dy / d;
    const C = [mx - h * dy / d, my + h * dx / d];
    return { B, C };
  };
  const link = (p, q, h, color) => ({ handle: h, color, pose: (th) => { const s = solve(th); const P = p === 'A' ? A : (p === 'B' ? s.B : (p === 'D' ? D : s.C)); const Q = q === 'A' ? A : (q === 'B' ? s.B : (q === 'D' ? D : s.C)); const cx = (P[0] + Q[0]) / 2, cy = (P[1] + Q[1]) / 2; return { pos: [cx, cy, 0], rotZ: Math.atan2(Q[1] - P[1], Q[0] - P[0]) }; } });
  return { dof: 'crank angle', label: 'four-bar linkage', parts: [
    { handle: forge.makeBox(ground, 9, 9), color: 0x556070, pose: () => ({ pos: [ground / 2, 0, -6], rotZ: 0 }) },
    link('A', 'B', mk(crank), 0xc85a26),
    link('B', 'C', mk(coupler), 0x2f5fa6),
    link('D', 'C', mk(rocker), 0x9ad17f),
  ] };
}

// meshing gear pair (two spur gears rotating opposite, ratio by tooth count).
function gearPair(forge, { od1 = 70, od2 = 46, t1 = 18, t2 = 12 } = {}) {
  const g1 = forge.makeCylinder(od1 / 2, 14);
  const g2 = forge.makeCylinder(od2 / 2, 14);
  const cd = (od1 + od2) / 2;
  return { dof: 'gear angle', label: 'meshing gear pair', parts: [
    { handle: g1, color: 0x9aa0a8, pose: (th) => ({ pos: [0, 0, 0], rotZ: th }) },
    { handle: g2, color: 0xc85a26, pose: (th) => ({ pos: [cd, 0, 0], rotZ: -th * (t1 / t2) }) },
  ] };
}

const TYPES = { 'piston-crank': pistonCrank, 'four-bar': fourBar, 'gear-pair': gearPair };
export const MECHANISM_TYPES = Object.keys(TYPES);

export function forgeMechanism(type = 'piston-crank', opts = {}) {
  const forge = F();
  if (!forge) throw new Error('forgeMechanism: window.forge unavailable');
  const fn = TYPES[type] || TYPES['piston-crank'];
  return fn(forge, opts);
}

export function installForgeMechanism() {
  if (typeof window === 'undefined') return;
  window.__forgeMechanism = (type, opts) => forgeMechanism(type, opts || {});
  window.__forgeMechanismTypes = MECHANISM_TYPES;
}

export default installForgeMechanism;
