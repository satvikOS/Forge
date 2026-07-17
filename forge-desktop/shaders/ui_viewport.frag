#version 450
// forge-desktop UI probe — 3D viewport fragment shader.
// Simple hemispheric + diffuse shading in the Forge accent (amber) so the box
// looks like a shaded solid in the viewport rather than a flat silhouette.
layout(location = 0) in vec3 vNormal;
layout(location = 0) out vec4 outColor;
void main() {
    vec3 N = normalize(vNormal);
    vec3 L = normalize(vec3(0.35, 0.75, 0.55));
    float diff = max(dot(N, L), 0.0);
    float amb  = 0.30;                         // ambient floor
    vec3 base  = vec3(0.90, 0.58, 0.20);       // Forge amber accent
    vec3 col   = base * (amb + 0.85 * diff);
    outColor = vec4(col, 1.0);
}
