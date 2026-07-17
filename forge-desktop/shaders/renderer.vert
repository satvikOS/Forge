#version 450
// forge-desktop renderer probe — trivial vertex shader.
// Applies a fixed model-view-projection (pushed as a column-major mat4) that
// frames the kernel box in the 256x256 offscreen viewport.
layout(location = 0) in vec3 inPos;
layout(push_constant) uniform PushConstants {
    mat4 mvp;
} pc;
void main() {
    gl_Position = pc.mvp * vec4(inPos, 1.0);
}
