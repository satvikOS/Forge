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

void main() {
    gl_Position = pc.mvp * vec4(inPos, 1.0);
    vec4 vp = pc.nrm * vec4(inPos, 1.0);
    vViewPos = vp.xyz;
    vNormal = mat3(pc.nrm) * inNormal;
    vFaceId = inFaceId;
    vFlags  = inFlags;
}

