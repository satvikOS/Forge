# RESUME — Autonomous OCCT → Parasolid-style Pure Engine (read this first, every session)

**MISSION:** reimplement OCCT's full scope (3–4M LOC / 10k classes: Foundation math, Modeling Data B-Rep,
Modeling Algorithms, Mesh, Data Exchange) as a **native, dependency-free, Parasolid-style encapsulated engine**
(opaque-handle C-API black box), with CGAL + libfive + PicoGK + Manifold unified in (those 4 already native,
0 linkage). This runs CONTINUOUSLY across sessions — the cron dies with a session, but this file + the roadmap
+ the progress log make any new session resume instantly.

## To resume (do this at the start of any session, or when the hourly cron fires)
1. `cd /Users/account_clawteam1/archdisc-Mech/forge-kernel`
2. `otool -L build/Release/forge-kernel.node | grep -c opencascade`  → current dylib count (NORTH-STAR = 0).
3. Read `OCCT_REPLACEMENT_ROADMAP.md` (keystones K0-K7 + "Done so far") + `OCCT_PROGRESS.log` (per-cycle log).
4. Cherry-pick any GREEN native fixes from recent occt-replace worktree branches onto `archdisc`
   (`git log --all --since='2 hours ago'` for Boolean/Fillet/Offset/Step/Hlr/Nurbs/Mesh/native commits),
   rebuild `cmake --build build --config Release -j5`, re-measure. If a keystone fully landed native + verified,
   delete its OCCT libs from `CMakeLists.txt` OCCT_LIBS, rebuild, confirm the dylib count dropped.
5. Launch the next `occt-replace-cycle-N` Workflow: parallel worktree agents on the next open keystone(s),
   each verifying native vs OCCT to MACHINE PRECISION and DELETING the OCCT fallback where native passes.
   NEVER fake native — a `kind=occt` that still shows is an honest FAIL to log, not a pass.
6. Append the cycle result + new dylib count to `OCCT_PROGRESS.log`, update the roadmap "Done so far", commit.
7. Re-arm: if the cron job (CronCreate, hourly :37) is gone (new session), recreate it with the same prompt.

## Keystone order (biggest OCCT surface first)
K0 flip gate defaults+measure · K1 native trimmed-NURBS STEP reader (drops TKDESTEP/TKXSBase/TKDE) ·
K2 curved/fuzzy booleans+splitter (TKBO/TKBool) · K3 general fillet/shell/offset (TKFillet/TKOffset) ·
K4 perspective HLR + sew/heal (TKHLR/TKShHealing) · K5 native mesh (TKMesh) · K6 migrate modules'
gp_/Geom_ → native Vec3/Matrix/Nurbs (unpins TKernel/TKMath/TKG*/TKGeomBase/TKBRep/TKTopAlgo/TKPrim) ·
K7 Parasolid-style opaque-handle C-API. FINAL: drop OCCT_LIBS → otool 0.

## Rules
- Machine-precision A/B vs OCCT for every flip; no faked passes; bound every build/test (macOS has no timeout).
- Worktree isolation for parallel C++; cherry-pick green to archdisc; keep the build green.
- The dylib count is the only truth. 19 now (was 22). Ship it to 0.
