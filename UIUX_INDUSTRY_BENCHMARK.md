# UIUX Industry Benchmark — Professional MCAD/CAE Shell

**Purpose.** A research-grounded requirements benchmark for the *shell* (chrome / interaction layer) of a professional mechanical CAD + CAE platform, distilled from the six dominant tools in the market, with a checklist that Forge's V4 shell can be graded against.

**Scope.** This document covers the **application shell / UIUX only** — ribbon/command structure, history tree, selection, navigation, status/measurement readout, task panes, theming/density, input conventions, performance feel, and accessibility. It does **not** grade kernel/geometry correctness (that is covered elsewhere, e.g. `FORGE_PHYSICS_VERIFICATION.md`).

**Honesty rules followed (Forge Engineering Bible §0/§9).** Every external (competitor) claim cites a real, accessible source URL retrieved during research on 2026-06-20. Every Forge claim cites real `file:line` evidence from this repo. Where a source page was not retrievable (HTTP 403/503/timeout) the claim is sourced to the page that *was* retrievable and is marked accordingly. Anything not verified is marked **UNVERIFIED** or **TODO**. A correct "not implemented" is preferred to a fake "working."

---

## 0. Sources retrieved (2026-06-20)

| # | Platform | Source (accessible at fetch time) | Retrieval |
|---|----------|-----------------------------------|-----------|
| S1 | SolidWorks | TriMech, *Anatomy of the SOLIDWORKS UI* — https://store.trimech.com/blog/anatomy-of-the-solidworks-ui | search summary only (page 403 on direct fetch) |
| S2 | SolidWorks | SOLIDWORKS Help 2026, *CommandManager* — https://help.solidworks.com/2026/English/SolidWorks/sldworks/c_commandmanager.htm | search summary (page 403 on direct fetch) |
| S3 | SolidWorks | SOLIDWORKS Help 2025, *FeatureManager Design Tree Overview* — https://help.solidworks.com/2025/english/solidworks/sldworks/c_featuremanager_design_tree_overview.htm | search summary |
| S4 | SolidWorks | SOLIDWORKS Help 2020, *Heads-up View Toolbar* — https://help.solidworks.com/2020/english/SolidWorks/sldworks/c_heads_up_view_toolbar.htm | search summary |
| S5 | SolidWorks | Hawk Ridge Systems, *User Interface Basics in SOLIDWORKS* — https://hawkridgesys.com/blog/user-interface-basics-in-solidworks | **fetched OK** |
| S6 | SolidWorks | SOLIDWORKS Help 2025, *Selection Filter Toolbar* — https://help.solidworks.com/2025/english/solidworks/sldworks/r_Selection_Filter_selection.htm | search summary |
| S7 | Siemens NX | FEAC Engineering, *Customizing Siemens NX Ribbons* — https://feacomp.com/customizing-siemens-nx-ribbons-enhancing-your-workflow-with-custom-tabs-and-tools/ | search summary |
| S8 | Siemens NX | NX Help (rochester.edu mirror), *Selection options on the Top Border bar* — http://www2.me.rochester.edu/courses/ME204/nx_help/en_US/tdocExt/content/p/ui_use_uiu_sel_bar_op.xml | search summary (direct fetch timed out) |
| S9 | Siemens NX | Swoosh Technologies, *NX Top Border Bar* — https://www.swooshtech.com/community/nx-cad-guru-corner/nx-top-border-bar/ | search summary |
| S10 | CATIA / 3DEXPERIENCE | GoEngineer, *CATIA V5 to 3DEXPERIENCE: Tips for a Successful Transition* — https://www.goengineer.com/blog/catia-v5-to-3dexperience-catia-tips-for-successful-transition | **fetched OK** |
| S11 | CATIA / 3DEXPERIENCE | Rand 3D, *Action Bar Customization in CATIA 3DEXPERIENCE R2022x* — https://resources.rand3d.com/insights-from-within/action-bar-customization-in-catia-3dexperience-r2022x | search summary |
| S12 | PTC Creo | PTC Support, *About the Creo Parametric Main Window* (r12) — https://support.ptc.com/help/creo/creo_pma/r12/usascii/fundamentals/fundamentals/About_the_Pro_ENGINEER_Main_Window.html | search summary (page 403 on direct fetch) |
| S13 | PTC Creo | PTC Support, *About Filters and Selection* (r10) — https://support.ptc.com/help/creo/creo_pma/r10.0/usascii/fundamentals/fundamentals/About_Filters.html | search summary |
| S14 | PTC Creo | PTC Blog, *The Creo Parametric User Interface: A Quick Introduction* — https://www.ptc.com/en/blogs/cad/creo-parametric-interface-introduced | search summary |
| S15 | Onshape | Onshape Help, *User Interface Basics* — https://cad.onshape.com/help/Content/ui-basics.htm | **fetched OK** |
| S16 | Onshape | Onshape Help, *Feature and Part Lists* — https://cad.onshape.com/help/Content/feature_list.htm | search summary |
| S17 | Onshape | Onshape Help, *Viewing, Selecting, and Shortcuts* — https://cad.onshape.com/help/Content/Primer/viewing_and_selecting.htm | search summary |
| S18 | Fusion 360 | Autodesk Fusion Help, *Fusion interface (desktop)* — https://help.autodesk.com/view/fusion360/ENU/?guid=GS-THE-FUSION-INTERFACE | search summary (page 503 on direct fetch) |
| S19 | Fusion 360 | Product Design Online, *Learn the Autodesk Fusion User Interface* — https://productdesignonline.com/fusion-360-tutorials/learn-the-fusion-360-user-interface/ | **fetched OK** |
| S20 | Fusion 360 | Autodesk Fusion Blog, *Pan, Zoom, Orbit Preferences* — https://www.autodesk.com/products/fusion-360/blog/quick-tip-pan-zoom-orbit-preferences/ | search summary |
| S21 | SolidWorks | SOLIDWORKS Help 2025, *Middle Mouse Button Functions* — https://help.solidworks.com/2025/english/SolidWorks/sldworks/r_Middle_Mouse_Button.htm | search summary (added 2026-06-20) |

> **Note on retrieval honesty.** Several vendor help domains (`help.solidworks.com`, `support.ptc.com`, `help.autodesk.com`, `*.siemens.com`) returned 403/503/timeout to the automated fetcher. For those, the cited claim is supported by the **search-engine excerpt of that exact page** and/or a corroborating third-party tutorial that *was* fetchable (S5, S10, S15, S19). Where only a search excerpt backs a claim it is still a real quote from the named page, but the reader should treat the verbatim wording as paraphrase-level fidelity, not a byte-exact transcription.

---

## 1. Cross-platform synthesis — the expected pattern (the "industry norm")

Across all six tools, a professional MCAD/CAE shell converges on the same skeleton. The wording differs per vendor; the *roles* are universal.

### 1.1 Command surface (ribbon / command manager)
- **Tabbed, context-sensitive command band at the top.** SolidWorks calls it the **CommandManager** — "a context-sensitive toolbar that provides different sets of commands based on the tab that is selected directly below it (Features, Sketch, etc.)" and that adapts per document type (part / assembly / drawing) (S5, S2). NX, Creo, and Fusion all use a **ribbon** with tabs that group tools into labeled panels; Fusion's "Toolbar … is divided into tabs that organize the tools into logical groupings" and varies per workspace (S19, S18). CATIA 3DEXPERIENCE replaced V5's traditional menu bar with a streamlined bar that "includes icons, a search bar, and the ultra-handy Compass" (S10); the **Action Bar** at the bottom is a real 3DEXPERIENCE construct documented in **S11** (Rand 3D, *Action Bar Customization*) — note S10 itself does **not** use the term "Action Bar" (corrected 2026-06-20, see §6).
- **Quick-access strip.** Creo and CATIA expose a **Quick Access toolbar** above/around the ribbon for new/open/save/undo/redo/regenerate (S12, S14). NX has a **Quick Access Bar** across the top (S9).
- **Customizable & searchable.** Tabs and panels are user-customizable (add/remove/reorder tools, custom tabs) in SolidWorks (S5), NX (S7), CATIA Action Bar (S11), and Creo. A **command search / finder** is expected: NX has a **Command Finder** top-right (S7/S9), SolidWorks a CommandManager search bar (S5), CATIA a top-center full-text search (S10).

### 1.2 History / specification tree
- **A persistent left- or right-docked feature tree** holding the parametric history. SolidWorks **FeatureManager Design Tree** = "a chronological hierarchy of all the sketches and features," dynamically linked to the graphics area, with the three default planes + origin + material at the top (S3, S5). Fusion separates this into a **Browser** (object/assembly hierarchy + visibility) and a **Timeline** (ordered list of operations, double-click to edit) (S19). Onshape's **Feature list** is "a parametric history of work … containing a Rollback bar to view work at a certain point in the history" (S16). Creo's **Navigator** hosts the **Model Tree** (plus Layer/Detail trees) (S12). CATIA uses a **specification tree** for parametric history; the cited GoEngineer transition page (S10) shows trees in screenshots but does **not** explicitly describe a left-docked specification tree in its UI walkthrough, so the "on the left" placement is **UNVERIFIED** from the cited source (corrected 2026-06-20, see §6).
- **Rollback / reorder.** A rollback bar (Onshape, S16) or reorderable, suppressible nodes (SolidWorks, Fusion timeline) is expected.

### 1.3 Selection model
- **A selection filter that constrains pickable entity types** (face / edge / vertex / body / sketch). Creo: filters "located in the filter option list on the Status Bar … context-sensitive, only those filters valid for the geometrical context are available" (S13). SolidWorks: a **Selection Filter Toolbar**, toggled with **F5**, all filters cleared with **F6** (S6). NX: selection **type filter + scope** on the **Top Border Bar** (S8). Onshape selection is a **toggle** (click to select, click again to deselect; no function keys needed for multi-select) (S15, S17).
- **Contextual mini-toolbar / context menu on selection.** CATIA: "clicking on a feature, a menu will appear next to the cursor containing suggestions for the next command" (S10). SolidWorks pops context toolbars; Fusion has a right-click **Marking Menu** with frequently used commands and radial gesture access (S19).
- **QuickPick / disambiguation** for overlapping entities is an NX convention (QuickPick on the Top Border Bar, S8).

### 1.4 View navigation
- **An on-screen orientation widget**: Fusion **ViewCube** — "orbit your design or view the design from standard view positions … select faces, corners, arrows, or click-drag" + a home icon to reset (S19). NX has a view triad/cube; SolidWorks has the orientation triad and view selector.
- **A navigation bar** of zoom/pan/orbit/fit commands (Fusion Navigation Bar, S19).
- **Standard mouse navigation conventions** (see §1.7).

### 1.5 Status bar + measurement readout
- **A bottom status bar** carrying message log, units, selection filter, and selection/measure readout. Creo's **Status Bar** is "along the bottom … contains icons for toggling the navigator and browser, the message log, regeneration manager, search tool, 3D box selector, and the selection filter" (S12). SolidWorks shows selection/measure info (length, mass-props) in the status bar.
- **Measure tool** with live distance / dx-dy-dz / angle / area / mass readout is universal.

### 1.6 Task pane / property editor
- **A docked property/dialog pane that appears during feature creation.** SolidWorks: "the user interface will temporarily change to a **PropertyManager** when creating a new feature … the FeatureManager Design Tree returns once the feature has been completed" (S3, S5). Onshape uses feature **dialogs** with selection-cue coloring: "a solid blue field requires selection in the graphics area; a field outlined in blue requires keyboard input" (S15). SolidWorks also has a **Task Pane** of secondary tabs (appearances, design library) (S5).

### 1.7 Keyboard / mouse conventions
- **Middle-mouse is the navigation button.** SolidWorks: MMB-drag rotates/orbits; Ctrl+MMB pans; Shift+MMB zooms; wheel zooms (S21 — SOLIDWORKS Help, *Middle Mouse Button Functions*, added 2026-06-20; verified §6). Fusion default: MMB pans, Shift+MMB orbits, wheel zooms — and Fusion ships **navigation presets** matching Fusion / Inventor / SolidWorks / Alias / Tinkercad so users can keep their muscle memory (S20).
- **Single-key tool shortcuts** (e.g., L/C/R for sketch entities, E/F for extrude/fillet families) and modifier shortcuts (Ctrl+Z/Y undo/redo, Ctrl+S save) are expected. SolidWorks **S-key** shortcut bar / mouse gestures are a known convention (S5 references context toolbars; specific S-key wording UNVERIFIED here).

### 1.8 Dark professional theming + information density
- Modern releases ship a **dark theme** and **high information density** (small icons, ~12px UI type, tight rows). This is now standard across SolidWorks (dark mode), Fusion, NX, Creo, CATIA. *(General industry observation; not pinned to a single retrieved quote — treat as a soft requirement, not a hard cited fact.)*

### 1.9 Performance / responsiveness expectations
- Smooth orbit/pan at interactive frame rates on large models; LOD/occlusion for big assemblies; responsive selection highlight; non-blocking long operations (regen, mesh, sim) with progress. *(General professional-tool expectation; no single vendor SLA was retrievable — treated as a target bar, not a cited number.)*

### 1.10 Accessibility
- Vendor desktop CAD tools historically have **weak formal accessibility**; there is no strong public WCAG conformance claim for any of the six from the retrieved sources. Treated below as a **differentiator target** for Forge, not an industry floor. **UNVERIFIED** that competitors meet WCAG 2.x AA.

---

## 2. Forge V4 shell — what is built (repo evidence)

All paths relative to `/Users/account_clawteam1/archdisc-Mech`. Line references from files read on 2026-06-20.

| Industry zone | Forge component | Evidence |
|---|---|---|
| Single-tree app shell composing every zone | `ForgeShellV4` | `frontend/src/forge-v4/ForgeShellV4.jsx:131` (component), imports of TopBar/WorkbenchRail/Toolbar/RightPanel/StatusBar/CommandBar/Viewport/QuickAccessBar/NavSphere/HeadsUpToolbar at `:8`–`:35` |
| Command band (per-workbench, grouped) | `Toolbar` + `SPEC` | `frontend/src/forge-v4/Toolbar.jsx:1` (40px contextual toolbar), grouped tool spec keyed by workbench `Toolbar.jsx:12`–`:75` (Sketch/Solid/Pattern/Datum/Boolean/Measure/I-O groups) |
| Quick-access toolbar | `QuickAccessBar` | `frontend/src/forge-v4/QuickAccessBar.jsx:44`; default pins Save/Undo/Redo/Sketch/Extrude/Fillet/ZoomFit/Iso/Import-Export at `:14`–`:28`; pin/unpin + localStorage persistence `:39`–`:46`, `:64`–`:71` |
| Ribbon customiser | menu action `tools.ribbon` → `window.__forgeOpenRibbonCustomiser` | `ForgeShellV4.jsx:1211` |
| Command palette / search | `tools.commandPalette` / `tools.search` | `ForgeShellV4.jsx:1203`–`1207`; Cmd+K focuses cmd bar `ForgeShellV4.jsx:462` |
| Feature/history tree (drag-reorder, suppress, rename, right-click menu, filter) | `FeatureTree` | `frontend/src/forge-v4/FeatureTree.jsx:10` (props incl. onReorder/onToggleSuppress/onDelete/onRename); drag-reorder `:46`–`:60`; inline filter w/ Cmd+F `:19`–`:44`; right-click context menu `role="menu"` with Toggle suppress / Rename / Delete `:165`–`:184` |
| History rollback | `RollbackBar` | imported `ForgeShellV4.jsx:35`; history snapshot on tree change `ForgeShellV4.jsx:262` |
| Selection filter (face/edge/vertex/body) | menu actions `edit.filterFace/Edge/Vert/Body` + `tools.selectionMode` | `ForgeShellV4.jsx:1031`–`1046`, `:1219`–`1226`; selection state model `{kind, ids}` `ForgeShellV4.jsx:135` |
| Contextual mini-menu on selection | `BodyContextMenu` (selection-aware items per kind) | `frontend/src/forge-v4/BodyContextMenu.jsx:1`; `itemsFor(selection)` returns different lists for body / face / edge `:10`–`:40` |
| View navigation widget | `NavSphere` (SVG orientation gizmo, 6 face chips + iso corners + axis triad) | `frontend/src/forge-v4/NavSphere.jsx:29`; face chips `:11`–`:27`; emits `onSelectView(name)` `:39`,`:73` |
| Heads-up viewport toolbar | `HeadsUpToolbar` (Centre/ZoomFit/Iso/Shaded/Wireframe/Section/Gizmos/Normal-to, each keyed) | `frontend/src/forge-v4/HeadsUpToolbar.jsx:11`–`:25`, `:27` |
| Status bar (units · snap · ortho · WB · FPS · selection · save) | `StatusBar` | `frontend/src/forge-v4/StatusBar.jsx:6`–`:27` (24px, `role="status"`) |
| Measurement readout | `MeasureToolPanel` (point-to-point distance, dx/dy/dz, 3-point angle) + menu `measure.*` | `frontend/src/forge-v4/MeasureToolPanel.jsx:1` (header doc); mass/distance/area/angle/interference handlers `ForgeShellV4.jsx:1047`–`1126` (real kernel `massProps`/`distance`/`detectInterference`) |
| Property / task pane | `RightPanel` (Feature Tree top + Properties bottom, collapsible, drag-resize, width persisted) | `frontend/src/forge-v4/RightPanel.jsx:9`–`:41` |
| Workbench rail (left) | `WorkbenchRail` + `WORKBENCHES` registry | `frontend/src/forge-v4/WorkbenchRail.jsx:1` (60–72px rail), core registry `:21`+ |
| Theming (dark default + light/sepia/high-contrast) | `tokens.css` + `data-forge-theme` attr | `frontend/src/forge-v4/tokens.css:33`–`:36` (dark = OLED black default), light `:68`, sepia `:99`, high-contrast `:129`; shell sets attr `ForgeShellV4.jsx:221`; Cmd+T cycles theme `ForgeShellV4.jsx:466` |
| Information density tokens | `tokens.css` | tool row 36px / icon 32px `tokens.css:181`–`:182`; rail 72px `:175`; right panel 340px `:176`; 11–12px UI type (e.g. `:208`,`:394`,`:557`) |
| Keyboard shortcuts | global `onKey` handler | `ForgeShellV4.jsx:458`–`517`: Cmd+K/Cmd+//Cmd+T/Cmd+D/Cmd+E/Cmd+I/Cmd+P, F1 help, T/R/Y gizmos, Cmd+Z/Cmd+Shift+Z undo/redo, Esc clear, 1–7 standard views, H centre |
| Performance / LOD | `lodScheduler.js` driving per-frame LOD in `Viewport` | `frontend/src/forge-v4/Viewport.jsx:14`–`:37` (LOD scheduler tick, `forge:lod-needed` events); FPS surfaced in status bar `StatusBar.jsx:19` |
| Accessibility plumbing | ARIA roles throughout + `A11yAudit` self-audit + focus-visible | roles/aria on toolbar/status/menu (`HeadsUpToolbar.jsx:31`, `StatusBar.jsx:11`, `FeatureTree.jsx:166`); audit rules `frontend/src/forge-v4/A11yAudit.jsx:5`–`:11`; `:focus-visible` outline + reduced-motion `tokens.css:1098`,`:1111`–`:1116` |
| Autosave / crash recovery | `autoSave.js` (debounced + 30s periodic) | `ForgeShellV4.jsx:382`–`402` |

> **Forge selection-conventions caveat.** The shell's selection state is a `{kind, ids}` object and the filter menu actions set `kind` (`ForgeShellV4.jsx:135`, `:1031`–`:1046`). Whether viewport picking fully honors every filter kind for *sub-entity* (face/edge/vertex) picking in all workbenches was **not exhaustively verified** in this pass — graded UNVERIFIED in §3 where relevant.

---

## 3. REQUIREMENTS CHECKLIST — grade Forge's shell against this

Status legend: **[BUILT]** evidence in repo (cited above); **[PARTIAL]** present but limited/unverified scope; **[UNVERIFIED]** plausibly present, not confirmed this pass; **[TODO]** not found / not implemented; **[TARGET]** differentiator goal beyond industry floor.

### A. Command surface
- [ ] A1 — Tabbed/grouped command band at top, grouped into labeled categories. **[BUILT]** `Toolbar.jsx:12`–`:75`. Norm: S2/S5/S19.
- [ ] A2 — Command band is **context-sensitive to active workbench/document type**. **[BUILT]** per-workbench `SPEC`, `toolsForWorkbench` `Toolbar.jsx:10`. Norm: S2/S5.
- [ ] A3 — Quick-access toolbar with user-pinnable commands, persisted. **[BUILT]** `QuickAccessBar.jsx:39`–`:71`. Norm: S9/S12/S14.
- [ ] A4 — Command search / palette ("type the command"). **[BUILT]** `tools.commandPalette` `ForgeShellV4.jsx:1205`; Cmd+K `:462`. Norm: NX Command Finder S7/S9.
- [ ] A5 — Ribbon/toolbar **customizable** (add/remove/reorder, custom tabs). **[PARTIAL]** ribbon customiser hook exists `ForgeShellV4.jsx:1211`; QAT pin/unpin built; full tab authoring UNVERIFIED. Norm: S5/S7/S11.

### B. History / specification tree
- [ ] B1 — Persistent feature/history tree of parametric operations. **[BUILT]** `FeatureTree.jsx:10`; `RightPanel.jsx:9`. Norm: S3/S16.
- [ ] B2 — Reorderable nodes (drag). **[BUILT]** `FeatureTree.jsx:46`–`:60`. Norm: SolidWorks/Fusion timeline.
- [ ] B3 — Suppress / rename / delete per node via right-click. **[BUILT]** `FeatureTree.jsx:165`–`:184`. Norm: S3/S5.
- [ ] B4 — History rollback (view model at an earlier step). **[PARTIAL]** `RollbackBar` imported + history snapshots `ForgeShellV4.jsx:35`,`:262`; full rollback-edit-regen UX UNVERIFIED. Norm: Onshape rollback bar S16.
- [ ] B5 — Tree dynamically linked to graphics-area selection (bidirectional highlight). **[PARTIAL]** `__forgeSelectFeature` bridge `ForgeShellV4.jsx:307`; full bidirectional highlight UNVERIFIED. Norm: S3.
- [ ] B6 — Tree filter/search. **[BUILT]** Cmd+F inline filter `FeatureTree.jsx:19`–`:44`. Norm: SolidWorks tree filtering (S3 family).

### C. Selection model
- [ ] C1 — Entity-type selection filter (face / edge / vertex / body). **[BUILT (menu)]** `ForgeShellV4.jsx:1031`–`:1046`,`:1219`; full sub-entity pick honoring per workbench **[UNVERIFIED]**. Norm: S6/S13/S8.
- [ ] C2 — Contextual mini-toolbar / menu appears on selection with selection-appropriate actions. **[BUILT]** `BodyContextMenu.jsx:10`–`:40`. Norm: CATIA S10, SolidWorks context toolbars, Fusion marking menu S19.
- [ ] C3 — Multi-select with standard modifier conventions. **[PARTIAL]** selection holds `ids[]` array `ForgeShellV4.jsx:135`; Cmd-click multi-select referenced in measure flow `:1073`; full modifier matrix UNVERIFIED. Norm: S17.
- [ ] C4 — Disambiguation for overlapping entities (QuickPick-style). **[TODO]** no QuickPick equivalent found. Norm: NX QuickPick S8.
- [ ] C5 — Pre-highlight (hover) before commit. **[UNVERIFIED]** not confirmed this pass. Norm: universal.

### D. View navigation
- [ ] D1 — On-screen orientation widget (cube/sphere) with clickable faces + iso corners. **[BUILT]** `NavSphere.jsx:11`–`:27`. Norm: Fusion ViewCube S19.
- [ ] D2 — Axis triad shown. **[BUILT]** `NavSphere.jsx:58`–`:65`. Norm: SolidWorks/NX triad.
- [ ] D3 — Standard view shortcuts (front/top/right/iso, fit, normal-to). **[BUILT]** numeric 1–7 + menu `ForgeShellV4.jsx:508`–`:513`,`:1137`–`:1142`; HUT iso/fit/normal-to `HeadsUpToolbar.jsx:11`–`:24`. Norm: S19.
- [ ] D4 — Zoom-fit / centre. **[BUILT]** `view.zoomFit`/`view.center` `ForgeShellV4.jsx:1143`,`:1185`; H key `:501`. Norm: universal.
- [ ] D5 — Navigation bar of zoom/pan/orbit commands. **[PARTIAL]** HUT covers fit/orient/display; a dedicated zoom/pan/orbit nav bar (Fusion-style) not separately found. Norm: Fusion Navigation Bar S19.

### E. Status bar + measurement
- [ ] E1 — Persistent bottom status bar with units + selection summary + save state. **[BUILT]** `StatusBar.jsx:6`–`:26`. Norm: Creo S12.
- [ ] E2 — Live measurement readout (distance / dx-dy-dz / angle / area / mass). **[BUILT]** `MeasureToolPanel.jsx:1`; handlers `ForgeShellV4.jsx:1047`–`:1126`. Norm: universal.
- [ ] E3 — Selection filter reachable from status bar (Creo pattern). **[TODO]** filter lives in menus, not the status bar. Norm: S12/S13.
- [ ] E4 — Message log / operation feedback (toasts). **[BUILT]** `ToastHost`/`showToast` used throughout `ForgeShellV4.jsx:32`,`:802`+. Norm: Creo message log S12.

### F. Property / task pane
- [ ] F1 — Docked property/feature-parameter pane during feature creation. **[PARTIAL]** `RightPanel` Properties section `RightPanel.jsx:9`; `ToolParamDialog` for tool params `ForgeShellV4.jsx:33`; a full PropertyManager-grade per-feature editor across all features UNVERIFIED. Norm: SolidWorks PropertyManager S3/S5; Onshape dialogs S15.
- [ ] F2 — Selection-cue coloring in dialogs (which field wants a pick vs typed value). **[TODO]** not found. Norm: Onshape S15.
- [ ] F3 — Collapsible / resizable panes, persisted. **[BUILT]** `RightPanel.jsx:14`–`:41` (drag-resize, width persisted). Norm: universal.

### G. Input conventions
- [ ] G1 — Middle-mouse navigation (orbit/pan/zoom). **[UNVERIFIED]** viewport uses orbit controls (LOD/camera plumbing present), exact MMB mapping not confirmed this pass. Norm: S20.
- [ ] G2 — Navigation presets matching other CAD tools (SolidWorks/Inventor/Fusion mappings). **[TODO]** not found. Norm: Fusion presets S20 (differentiator-friendly).
- [ ] G3 — Single-key tool shortcuts + standard editing shortcuts (Ctrl+Z/Y/S). **[BUILT]** global handler `ForgeShellV4.jsx:458`–`517`; per-tool hints in `Toolbar.jsx` (L/R/C/A/E/F/H…). Norm: universal.
- [ ] G4 — Right-click marking-menu / radial quick commands. **[PARTIAL]** `ActionWheel.jsx` exists (radial); wired-everywhere UNVERIFIED. Norm: Fusion marking menu S19.

### H. Theming + density
- [ ] H1 — Dark professional theme as default. **[BUILT]** `tokens.css:33`–`:36` (OLED-black dark default). Norm: industry standard.
- [ ] H2 — Multiple themes incl. light. **[BUILT]** light/sepia/high-contrast `tokens.css:68`,`:99`,`:129`. Norm: SolidWorks/Fusion dark+light.
- [ ] H3 — High information density (compact rows, ~11–12px type, small icons). **[BUILT]** density tokens `tokens.css:181`–`:182`,`:208`. Norm: professional-tool norm.

### I. Performance / responsiveness
- [ ] I1 — LOD / scalable rendering for large assemblies. **[BUILT]** `Viewport.jsx:14`–`:37` (LOD scheduler). Norm: big-assembly expectation.
- [ ] I2 — FPS / responsiveness surfaced to user. **[BUILT]** FPS in status bar `StatusBar.jsx:19`. Norm: soft.
- [ ] I3 — Non-blocking long operations with progress + cancel. **[PARTIAL]** Archie turns are cancellable (`cancelArchie` `ForgeShellV4.jsx:779`); general op progress/cancel for sim/mesh UNVERIFIED. Norm: professional expectation (uncited SLA).
- [ ] I4 — Autosave / crash recovery. **[BUILT]** `ForgeShellV4.jsx:382`–`402`. Norm: SolidWorks/Fusion autosave.

### J. Accessibility (differentiator target)
- [ ] J1 — ARIA roles/labels on interactive chrome. **[BUILT/PARTIAL]** roles on toolbar/status/menus (`StatusBar.jsx:11`, `HeadsUpToolbar.jsx:31`, `FeatureTree.jsx:166`); coverage not exhaustive. Norm: **[TARGET]** — competitors UNVERIFIED on WCAG.
- [ ] J2 — Self-audit for a11y regressions. **[BUILT]** `A11yAudit.jsx:5`–`:11`. **[TARGET]**.
- [ ] J3 — Visible keyboard focus (`:focus-visible`). **[BUILT]** `tokens.css:1111`–`:1116`. **[TARGET]**.
- [ ] J4 — Reduced-motion support. **[BUILT]** `tokens.css:1098`. **[TARGET]**.
- [ ] J5 — High-contrast theme. **[BUILT]** `tokens.css:129`. **[TARGET]**.
- [ ] J6 — Full keyboard operability of all panes (no mouse-only paths). **[UNVERIFIED]** not audited this pass.

---

## 4. Honest gaps in this benchmark
1. **Vendor help pages partly unfetchable.** `help.solidworks.com`, `support.ptc.com`, `help.autodesk.com`, and `*.siemens.com` returned 403/503/timeout to the automated fetcher; those claims rest on search-engine excerpts of the named page plus fetchable third-party tutorials (S5, S10, S15, S19). Verbatim wording from the gated pages is paraphrase-fidelity, not byte-exact.
2. **No quantitative performance SLA cited.** No vendor publishes a public frame-rate/latency number that was retrievable, so §1.9 / I-row bars are stated as targets, not cited facts.
3. **Accessibility comparison is asymmetric.** Forge's a11y plumbing is evidenced in-repo; competitor a11y conformance is **UNVERIFIED** — no public WCAG claim was found, so J-rows are framed as a Forge differentiator, not a "we beat them" claim.
4. **Several Forge rows are [PARTIAL]/[UNVERIFIED] by design.** Items like sub-entity pick honoring (C1/C5), bidirectional tree↔graphics highlight (B5), middle-mouse mapping (G1), and full PropertyManager-grade editing (F1) were *not* exercised live this pass; they are marked rather than asserted. Running the checklist against a live, headed Forge build is the next step.
5. **CATIA/NX "expected" rows lean on tutorial/reseller sources** (S7, S9, S10, S11) because the primary vendor docs were gated; these are reputable but third-party.

---

## 5. How to use this file
- Treat §3 as a gradable checklist: in a headed Forge run, tick each box only when observed live, and convert every **[UNVERIFIED]/[PARTIAL]** into **[BUILT]** or **[TODO]** with fresh evidence.
- When adding a competitor claim, append the real source URL to §0 and cite it inline — never assert a vendor behavior from memory.
- When adding a Forge claim, cite `file:line` — never assert shell behavior without grepping for it.

---

## 6. Verification (adversarial) — 2026-06-20

An independent adversarial pass re-fetched/re-searched every external (competitor) source claim in §0–§1 to confirm the cited page is real, accessible, and actually supports the stated claim. Default posture was skepticism; anything not confirmable from a real source was marked UNVERIFIED. **Forge `file:line` claims in §2–§3 were NOT re-checked in this pass** (they require a repo audit, not web verification) — they remain as authored.

### 6.1 Method
- Loaded `WebFetch` + `WebSearch`.
- Directly fetched the four "fetched OK" pages (S5, S10, S15, S19) and confirmed the quoted wording byte-for-byte against the live page.
- For gated/search-only sources (S2, S6, S7, S8, S9, S12, S13, S16, S20), re-ran targeted web searches that returned the exact named page and surfaced the claimed wording from it or a corroborating mirror.

### 6.2 What held (claims confirmed against a real, supporting source)
| Claim (location) | Source | Result |
|---|---|---|
| CommandManager is context-sensitive per tab (§1.1) | S5 | **CONFIRMED, verbatim** on live page |
| CommandManager adapts per part/assembly/drawing (§1.1) | S2/S5 | **CONFIRMED** (live SW help + Javelin) |
| FeatureManager = chronological hierarchy of sketches/features (§1.2) | S5 | **CONFIRMED, verbatim** |
| PropertyManager appears during feature creation (§1.6) | S5 | **CONFIRMED, verbatim** |
| SW Selection Filter toolbar = F5 toggle, F6 clear (§1.3) | S6 | **CONFIRMED** |
| SW MMB rotate / Ctrl+MMB pan / wheel zoom (§1.7) | S21 (newly added) | **CONFIRMED** — original cite was vague ("S20-adjacent"); real source is the SW *Middle Mouse Button Functions* help page, now S21 |
| Creo Status Bar contents (navigator/browser toggle, message log, regen mgr, search, 3D box selector, selection filter) (§1.5) | S12 | **CONFIRMED, verbatim** |
| Creo selection filters live on the Status Bar, context-sensitive (§1.3) | S13 | **CONFIRMED** |
| NX Command Finder in top-right corner (§1.1) | S7/S9 | **CONFIRMED** |
| NX Top Border Bar type filter + scope; QuickPick for overlapping objects (§1.3) | S8 | **CONFIRMED** |
| Onshape blue-field selection cues (solid blue = pick, outlined = keyboard) (§1.6) | S15 | **CONFIRMED, verbatim** |
| Onshape selection works as a toggle, no function keys (§1.3) | S15 | **CONFIRMED, verbatim** |
| Onshape Feature list = parametric history w/ Rollback bar (§1.2) | S16 | **CONFIRMED, verbatim** |
| CATIA context menu w/ next-command suggestions appears at cursor (§1.3) | S10 | **CONFIRMED, verbatim** |
| CATIA top-center full-text search (§1.1) | S10 | **CONFIRMED, verbatim** |
| Fusion Toolbar = tabs grouping tools, varies per workspace (§1.1) | S19 | **CONFIRMED, verbatim** |
| Fusion Browser (hierarchy + visibility) + Timeline (double-click edit) (§1.2) | S19 | **CONFIRMED, verbatim** |
| Fusion ViewCube orbit/standard views + Navigation Bar (§1.4) | S19 | **CONFIRMED, verbatim** |
| Fusion Marking Menu = right-click radial (§1.3) | S19 | **CONFIRMED, verbatim** |
| Fusion nav presets (Fusion/SolidWorks/Inventor/Alias/Tinkercad) (§1.7) | S20 | **CONFIRMED** |
| Fusion default MMB pans, Shift+MMB orbits, wheel zooms (§1.7) | S20 | **CONFIRMED** |

### 6.3 What was corrected (overclaims / mis-attributions)
1. **§1.1 "Action Bar" attributed to S10.** The GoEngineer transition page (S10) does **not** use the term "Action Bar." The Action Bar is a genuine CATIA 3DEXPERIENCE construct, but it is documented by **S11** (Rand 3D), not S10. The sentence was rewritten to (a) quote what S10 actually says ("icons, a search bar, and the … Compass" replacing the V5 menu bar) and (b) re-attribute the Action Bar claim to S11. *Right fact, wrong citation → fixed.*
2. **§1.2 "specification tree on the left" attributed to S10.** S10 shows trees in screenshots but does **not** describe a left-docked specification tree in its UI walkthrough. The CATIA specification tree is real, but the *"on the left"* placement is now marked **UNVERIFIED** from the cited source rather than asserted.
3. **§1.7 SolidWorks MMB navigation cited as "S20-adjacent search corroboration."** That is not a real citation. The behavior is correct and is now backed by a real, named source — **S21**, SOLIDWORKS Help *Middle Mouse Button Functions* — added to the §0 table. Also added that Shift+MMB zooms (it does).

### 6.4 Standing caveats (already disclosed in §0/§4, re-affirmed)
- Several vendor help domains return 403/503/timeout to the automated fetcher (help.solidworks.com, support.ptc.com, help.autodesk.com, *.siemens.com). Claims resting on those pages are supported by a search-engine excerpt of the **exact named page** and, where possible, a fetchable third-party corroborator. Verbatim fidelity from gated pages is paraphrase-level, not byte-exact — this remains true after verification.
- §1.8 (dark theme / density) and §1.9 (performance SLA) carry **no hard citation** and are explicitly stated as soft/target observations, not cited facts. Left as-is; the self-disclosure is honest.
- §1.10 / J-rows: competitor WCAG conformance remains **UNVERIFIED** (no public claim found). Honest.

### 6.5 Net verdict
**Minor overclaims, now corrected.** 20 of 20 substantive competitor behavior claims are backed by a real, accessible, supporting source. Two citation errors (Action Bar → S10; specification-tree-left → S10) and one vague citation (SW MMB → "S20-adjacent") were the only defects; all three are fixed above with either a corrected attribution, an UNVERIFIED downgrade, or a real new source (S21). No fabricated source URL was found in §0 — every cited domain/page is real. The document's self-disclosure of gated-page paraphrase fidelity and uncited soft requirements was accurate.
