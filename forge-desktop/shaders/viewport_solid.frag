#version 450
// forge-desktop — viewport solid-shading fragment shader.
//
// Two-light hemispheric + Lambert diffuse: a key light over the shoulder and a
// dim fill from below, so a downward-facing face is dark but never black. This
// is the standard CAD "studio" setup (the same two-light rig NX, CATIA and
// SolidWorks ship as their default shaded style).
//
// Selection wins over preselection, matching every CAD system: what you picked
// outranks what you are merely hovering.
layout(location = 0) in vec3 vNormal;
layout(location = 1) flat in uint vFaceId;
layout(location = 2) flat in uint vFlags;

layout(push_constant) uniform PushConstants {
    mat4 mvp;
    mat4 nrm;
    uint hoverFace;
    uint shadingMode;   // 1 = edge overlay pass: constant dark line colour
    uint pad0;
    uint pad1;
} pc;

layout(location = 0) out vec4 outColor;

void main() {
    if (pc.shadingMode == 1u) {
        outColor = vec4(0.09, 0.10, 0.12, 1.0);   // edge overlay
        return;
    }

    vec3 N = normalize(vNormal);
    vec3 key  = normalize(vec3(0.35, 0.75, 0.55));
    vec3 fill = normalize(vec3(-0.4, -0.6, 0.2));
    float d = max(dot(N, key), 0.0) * 0.85 + max(dot(N, fill), 0.0) * 0.18;

    vec3 base = vec3(0.62, 0.65, 0.70);                            // steel: the body colour
    if ((vFlags & 1u) != 0u)      base = vec3(0.95, 0.62, 0.15);   // selected: Forge amber
    else if (vFaceId == pc.hoverFace && pc.hoverFace != 0u)
                                  base = vec3(0.35, 0.72, 0.95);   // preselected: cyan

    float amb = 0.28;
    outColor = vec4(base * (amb + d), 1.0);
}
