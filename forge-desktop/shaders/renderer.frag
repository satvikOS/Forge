#version 450
// forge-desktop renderer probe — flat-color fragment shader.
// A single opaque colour so the rasterized box is unambiguously distinguishable
// from the known clear colour when the offscreen image is read back.
layout(location = 0) out vec4 outColor;
void main() {
    outColor = vec4(0.85, 0.55, 0.15, 1.0);
}
