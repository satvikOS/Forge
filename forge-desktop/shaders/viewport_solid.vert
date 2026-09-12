#version 450
// forge-desktop — viewport solid-shading vertex shader.
//
// The vertex stream is DE-INDEXED (three vertices per triangle) so every vertex
// can carry the per-TRIANGLE OCCT face id that forge::Mesh::faceIds supplies.
// That id is what makes face preselection and face selection possible at all:
// the fragment stage compares it against the hovered id, and `inFlags` bit 0 is
// written by the CPU when the typed SelectionService changes.
layout(location = 0) in vec3 inPos;
layout(location = 1) in vec3 inNormal;
layout(location = 2) in uint inFaceId;
layout(location = 3) in uint inFlags;    // bit0 = selected

layout(push_constant) uniform PushConstants {
    mat4 mvp;         // model-view-projection (column-major)
    mat4 nrm;         // model rotation, for the normal
    uint hoverFace;   // 1-based OCCT face id under the cursor, 0 = none
    uint shadingMode; // 0 = shaded, 1 = edge/wireframe overlay pass
    uint pad0;
    uint pad1;
} pc;

layout(location = 0) out vec3 vNormal;
layout(location = 1) flat out uint vFaceId;
layout(location = 2) flat out uint vFlags;
layout(location = 3) out vec3 vViewPos;

// ── THE EDGE DEPTH OFFSET ───────────────────────────────────────────────────
// A feature edge lies EXACTLY ON the surface it bounds, so the edge pass and the
// solid pass compute the same depth there -- and the rasterizer does not compute
// it the same way twice. A line's depth is interpolated along the line; a
// triangle's is interpolated across the face. Where the two disagree by a
// fraction of an ULP the LESS_OR_EQUAL test loses, and the line comes out
// DASHED. Measured on the default bracket before this existed: 6 of 36
// judgeable segments broken at the framed isometric, the fillet's tangent edges
// chopped into dashes with gaps up to 6 px, and 2 of the 16 bore-rim segments
// missing.
//
// The usual remedy -- VkPipelineRasterizationStateCreateInfo::depthBiasEnable --
// is INERT for a line topology (see the comment in ViewportRenderer.cpp, where
// putting the deleted state back produces a byte-identical frame). Offsetting
// gl_Position.z is the remedy that a line primitive can actually receive.
//
// SIZE: NOT guessed, and RE-MEASURED after the first table here was found to be
// wrong. Swept with forge_desktop_render_gate on the default bracket, deleting
// the generated .spv.h before every build so glslang cannot be skipped, and
// checking the built header's md5 against a fresh direct glslangValidator run on
// the same source -- because an incremental build silently reused a stale
// shader once during this sweep and reported the previous row's numbers.
//
// THAT PROCEDURE IS NOW A GUARD, NOT AN INSTRUCTION. Telling the next person to
// delete the header first is worth nothing if they do not read this comment, and
// the failure is silent: with kEdgeDepthBias set to 0.0 and the generated header
// touched, this gate reported "36 checks, 0 failed. RENDER GATE PASS" -- green on
// the exact defect it exists for. Each generated .spv.h now carries the bytes
// glslang was handed (cmake/embed_shader_source.cmake) and the gate compares them
// against this file, so a stale header is RED.
//
//   bias   framed: drawn/hid/BROKEN  gap px   16-cam BROKEN/743  gapped  gate
//   0             20 / 10 / 6          6          83 (11.17%)      38    RED
//   1e-6          24 / 10 / 2          3          35 ( 4.71%)      14    RED
//   2e-6          26 / 10 / 0          0          16 ( 2.15%)       7    green
//   3e-6          26 / 10 / 0          0          13 ( 1.75%)       4    green
//   5e-6          26 / 10 / 0          0          12 ( 1.62%)       2    green
//   1e-5          26 /  9 / 1          0          12 ( 1.62%)       1    green
//   2e-5          26 /  8 / 2          0          27 ( 3.63%)       1    RED
//   1e-4          27 /  6 / 3          0          79 (10.63%)       2    RED
//   1e-3          36 /  0 / 0          0           8 ( 1.08%)       0    RED
//
// THE FIRST TABLE WRITTEN HERE CLAIMED "0 and 1e-6 leave all 6 broken". That is
// false: 1e-6 leaves 2 broken framed, not 6, and the gate as it then stood went
// GREEN on it. The row is corrected above and the plateau is narrower than it
// was made to look -- which is the point of re-running a table rather than
// trusting one.
//
// THE LOWER WALL IS ONE SEGMENT WIDE, and that is the same fragility this gate
// removed once already. What rejects 1e-6 is the FRAMED camera's dashing ratio:
// 2 broken of 36 classified = 5.556% against the 5% threshold. One segment either
// way moves it (1 of 36 is 2.78%, and green), and the sixteen-camera aggregate
// does NOT reject 1e-6 at all -- 4.71% is under 5%. So the wall below the plateau
// rests on a single segment at a single camera, where the wall above it is held
// by a 743-segment aggregate. Named, not fixed: see the commit.
//
// The plateau the gate accepts is 2e-6 .. 1e-5 and 3e-6 is inside it, one step
// above the lower wall and with two steps above. Both walls are real and both
// are now RED in the gate rather than merely noted in prose: below 2e-6 the
// offset is smaller than the depth disagreement it has to beat and edges stay
// dashed; from 2e-5 upward the offset starts lifting OCCLUDED edges through the
// material, which the gate's hidden-edge check and the sweep's dashing
// aggregate both catch, and 1e-3 is an outright wireframe (13 of 16 cameras
// occlude nothing).
//
// In world terms: Camera pins near = 0.002 * distance, so 3e-6 of NDC depth is
// about 0.15% of the EYE DISTANCE at any zoom -- roughly 0.22 mm on this 48 mm
// radius bracket, against a 20 mm plate. It scales with the camera, which is why
// the zoomed camera and the wheel positions in the sweep do not need their own
// value.
//
// ACROSS SIXTEEN CAMERAS, and this is where the fix is HONESTLY INCOMPLETE:
// 13 of 743 classified segments are still broken with the offset in place,
// against 83 without it. Six of the sixteen cameras keep between 2 and 3 broken
// segments -- iso wheel-2 and five orbits -- and they are the views where the
// part is smallest on screen, where a segment is a handful of pixels long and
// one pixel of gap is a large fraction of it. The gate bounds the AGGREGATE
// (section 7 of render_gate.cpp) rather than asserting zero per camera, because
// zero per camera is not true today and writing it down would be writing down a
// wish.
const float kEdgeDepthBias = 3.0e-6;

void main() {
    gl_Position = pc.mvp * vec4(inPos, 1.0);
    if (pc.shadingMode == 1u) {
        gl_Position.z -= kEdgeDepthBias * gl_Position.w;
    }
    vec4 vp = pc.nrm * vec4(inPos, 1.0);
    vViewPos = vp.xyz;
    vNormal = mat3(pc.nrm) * inNormal;
    vFaceId = inFaceId;
    vFlags  = inFlags;
}

