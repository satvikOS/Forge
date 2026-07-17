#version 450
// forge-desktop UI probe — 3D viewport vertex shader.
// Transforms the kernel box by a fixed MVP (column-major mat4 push constant) and
// rotates the per-vertex normal by the model rotation so the fragment stage can
// shade the box, making it read as a real 3D model inside the viewport panel.
layout(location = 0) in vec3 inPos;
layout(location = 1) in vec3 inNormal;
layout(push_constant) uniform PushConstants {
    mat4 mvp;   // model-view-projection
    mat4 nrm;   // model rotation (for the normal)
} pc;
layout(location = 0) out vec3 vNormal;
void main() {
    gl_Position = pc.mvp * vec4(inPos, 1.0);
    vNormal = mat3(pc.nrm) * inNormal;
}
