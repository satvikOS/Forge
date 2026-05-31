/**
 * displayStateMaterial — material factory for the 5 display states.
 *
 * Each display state corresponds to a SolidWorks-style render mode the
 * user picks from the viewport toolbar:
 *
 *   shaded            — opaque MeshStandardMaterial; flat metallic look.
 *   shaded-with-edges — same as shaded + a `wantsEdges` flag the
 *                       renderer reads to overlay `<Edges>` lines.
 *   wireframe         — MeshBasicMaterial with `wireframe: true`.
 *   hidden-line       — flat white opaque material, paired with the
 *                       HLR polylines emitted by Forge-10's Drawings
 *                       projection (`wantsHLR` flag).
 *   transparent       — shaded but with `transparent: true, opacity:
 *                       0.5` so users can see through to interior
 *                       features.
 *
 * The DisplayStates UI swaps the `userData.displayMaterial` reference
 * on every rendered mesh; this factory keeps the swap deterministic
 * and headless-testable.
 *
 * THREE is injected so the unit test can pass a stub.
 */

export const DISPLAY_STATES = Object.freeze([
  'shaded',
  'shaded-with-edges',
  'wireframe',
  'hidden-line',
  'transparent',
]);

export const DEFAULT_DISPLAY_STATE = 'shaded';

/**
 * Build a material descriptor for a display state. Returns
 * `{ material, wantsEdges, wantsHLR }` so the renderer knows whether
 * to mount the `<Edges>` overlay or call into the Forge-10 HLR
 * pipeline.
 *
 * `themeBg` (the canvas background as a HEX number) is passed in so
 * the hidden-line material can match it on light themes.
 */
export function buildDisplayMaterial(THREE, state, opts = {}) {
  const color   = opts.color   ?? 0xc4ccd6;
  const themeBg = opts.themeBg ?? 0x101216;

  switch (state) {
    case 'wireframe':
      return {
        material: new THREE.MeshBasicMaterial({
          color, wireframe: true,
        }),
        wantsEdges: false,
        wantsHLR: false,
      };

    case 'hidden-line':
      return {
        material: new THREE.MeshBasicMaterial({
          color: themeBg, polygonOffset: true, polygonOffsetFactor: 1,
        }),
        wantsEdges: false,
        wantsHLR: true,
      };

    case 'transparent':
      return {
        material: new THREE.MeshStandardMaterial({
          color, metalness: 0.05, roughness: 0.45,
          transparent: true, opacity: 0.5, depthWrite: false,
        }),
        wantsEdges: false,
        wantsHLR: false,
      };

    case 'shaded-with-edges':
      return {
        material: new THREE.MeshStandardMaterial({
          color, metalness: 0.05, roughness: 0.45,
        }),
        wantsEdges: true,
        wantsHLR: false,
      };

    case 'shaded':
    default:
      return {
        material: new THREE.MeshStandardMaterial({
          color, metalness: 0.05, roughness: 0.45,
        }),
        wantsEdges: false,
        wantsHLR: false,
      };
  }
}

/**
 * Apply a display state across a list of meshes in one pass. Keeps the
 * original material as `mesh.userData.baseMaterial` on first call so
 * the user can revert.
 */
export function applyDisplayState(THREE, meshes, state, opts = {}) {
  const desc = buildDisplayMaterial(THREE, state, opts);
  for (const mesh of meshes || []) {
    if (!mesh) continue;
    if (!mesh.userData.baseMaterial) {
      mesh.userData.baseMaterial = mesh.material;
    }
    mesh.material = desc.material;
    mesh.userData.displayState = state;
    mesh.userData.wantsEdges = desc.wantsEdges;
    mesh.userData.wantsHLR   = desc.wantsHLR;
  }
  return desc;
}
