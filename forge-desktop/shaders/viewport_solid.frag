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
layout(location = 3) in vec3 vViewPos;

layout(push_constant) uniform PushConstants {
    mat4 mvp;
    mat4 nrm;
    uint hoverFace;
    uint shadingMode;   // 0 = solid shaded, 1 = edge overlay pass: dark CAD line
    uint pad0;
    uint pad1;
} pc;

layout(location = 0) out vec4 outColor;

void main() {
    // ── Edge overlay pass: crisp dark CAD ink ──────────────────────────────
    if (pc.shadingMode == 1u) {
        outColor = vec4(0.10, 0.11, 0.14, 1.0);   // CAD edge line color
        return;
    }

    vec3 N = normalize(vNormal);
    if (!gl_FrontFacing) {
        N = -N;
    }

    // View direction in view-space (camera is at origin)
    vec3 V = normalize(-vViewPos);

    // Studio CAD lighting rig (camera-relative)
    vec3 keyDir  = normalize(vec3(0.38, 0.65, 0.65));
    vec3 fillDir = normalize(vec3(-0.45, -0.30, 0.50));
    vec3 backDir = normalize(vec3(0.0, 0.85, -0.52));

    float diffKey  = max(dot(N, keyDir), 0.0);
    float diffFill = max(dot(N, fillDir), 0.0);
    float diffBack = max(dot(N, backDir), 0.0);

    // Blinn-Phong specular highlights
    vec3 H = normalize(keyDir + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0) * 0.35;

    vec3 Hfill = normalize(fillDir + V);
    float specFill = pow(max(dot(N, Hfill), 0.0), 16.0) * 0.10;

    // Fresnel rim highlight
    float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.18;

    // Material colours: precision machined alloy steel
    vec3 base = vec3(0.68, 0.72, 0.78);
    if ((vFlags & 1u) != 0u) {
        base = vec3(0.96, 0.62, 0.12);   // selected: Forge amber
    } else if (vFaceId == pc.hoverFace && pc.hoverFace != 0u) {
        base = vec3(0.35, 0.75, 0.98);   // preselected: cyan
    }

    float diffuse = diffKey * 0.65 + diffFill * 0.22 + diffBack * 0.12 + 0.25;
    vec3 rgb = base * diffuse + vec3(0.95, 0.97, 1.0) * (spec + specFill) + base * rim;

    outColor = vec4(rgb, 1.0);
}

