
## COMPLETION MERGE (2026-07-06) — GAP fixes on archdisc, rebuilt + verified
Cherry-picked to archdisc + rebuilt build/Release: GAP1 (54340ddf) native shell/rib/holeWizard/pattern,
GAP2 (af73c5b7) viewport tessellator holed-faces, GAP3 (017164eb) mesh-boolean exact escalation.
VERIFIED on build/Release: native_vs_occt_features_gap1.mjs = 9/9 PASS (shell/rib/holeWizard/pattern all
NATIVE-VERIFIED, nativeSolid/nativeMesh vs OCCT to machine precision); native_vs_occt_core bore cases now
genus-1 native PASS. These 4 op families were SILENTLY riding OCCT before — now genuinely native.
NOTE: tests default to build-native/Release (stale Jun-27) — point FORGE_KERNEL at build/Release, or resync
build-native. native_compile.mjs (Models) loads build/Release; its shell/fillet calls need call-pattern
alignment to hit the native path (follow-up, not a kernel gap — kernel is native-verified).
