import React from 'react';
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';
import { DirectEditPanelHost } from './forge-v4/DirectEditPanel.jsx';
import { HealPanelHost } from './forge-v4/HealPanel.jsx';
import { SurfacingPanelHost } from './forge-v4/SurfacingPanel.jsx';
import { SurfaceAnalysisOverlayHost } from './forge-v4/SurfaceAnalysisOverlay.jsx';
import { ManufacturingWorkbenchHost } from './forge-v4/ManufacturingWorkbench.jsx';
import { WeldmentsWorkbenchHost } from './forge-v4/WeldmentsWorkbench.jsx';
import { StandardPartsLibraryHost } from './forge-v4/StandardPartsLibrary.jsx';
import { ProjectBundlePanelHost } from './forge-v4/ProjectBundlePanel.jsx';
import { ProjectFilePanelHost } from './forge-v4/ProjectFilePanel.jsx';
import { IfcExportPanelHost } from './forge-v4/IfcExportPanel.jsx';
import { ViewportEnvironmentProvider } from './forge-v4/ViewportEnvironment.jsx';
import { PerfStatsHUD } from './forge-v4/PerfStatsHUD.jsx';
import { HoverTooltip } from './forge-v4/HoverTooltip.jsx';
import { SectionControlHost } from './forge-v4/SectionControl.jsx';
import { AssemblyTreePanelHost } from './forge-v4/AssemblyTreePanel.jsx';
import { AssemblyPanelHost } from './forge-v4/AssemblyPanel.jsx';
import { BomPanelHost } from './forge-v4/BomPanel.jsx';
import { PdmPanelHost } from './forge-v4/PdmPanel.jsx';
import { ScenarioRunnerHost } from './forge-v4/ScenarioRunner.jsx';
import { VideoCaptureHUD } from './forge-v4/VideoCaptureHUD.jsx';
import { StressTestPanelHost } from './forge-v4/StressTestPanel.jsx';
import { ProgressStripPortal } from './forge-v4/ProgressStrip.jsx';
import SnapStatusChip from './forge-v4/SnapStatusChip.jsx';
import { ConvergenceChartHost } from './forge-v4/ConvergenceChart.jsx';
import { SkeletonPanelHost } from './forge-v4/SkeletonPanel.jsx';
import { ActionWheelHost } from './forge-v4/ActionWheel.jsx';
import { DemoProjectHost } from './forge-v4/DemoProject.jsx';
import { ShipWorkbenchHost } from './forge-v4/ShipWorkbench.jsx';
import { SheetMetalWorkbenchHost } from './forge-v4/SheetMetalWorkbench.jsx';
import { PluginManagerPanelHost } from './forge-v4/PluginManagerPanel.jsx';
import { installForgeAPI } from './forge-v4/forgeAPI.js';
// Forge-135 / 137 / 139 — render room + role switcher + ribbon
// customiser + universal command palette.
import { PathTracedRenderHost } from './forge-v4/PathTracedRender.jsx';
import { RoleSwitcherHost } from './forge-v4/RoleSwitcher.jsx';
import { RibbonCustomiserHost } from './forge-v4/RibbonCustomiser.jsx';
import { CommandPaletteHost } from './forge-v4/CommandPalette.jsx';

// Forge-134 — install the public plugin API surface as `window.Forge`
// at app-bootstrap time, BEFORE the React tree mounts. PluginManagerPanelHost
// calls installForgeAPI again on mount (idempotent), but doing it up here
// means modules that probe `window.Forge` synchronously during the first
// render (e.g. Menus.jsx's usePluginMenuExtras) find the surface ready.
if (typeof window !== 'undefined') {
  try { installForgeAPI(); }
  catch (err) { console.warn('[forge.app] installForgeAPI failed:', err.message); }
}

// Forge-65: v4 shell is the only entry. App.jsx is one line — no hash
// routes, no legacy fallback. Per user mandate: "Full rewrite of
// App.jsx, retire WorkbenchContainer entirely".
//
// Forge-93: direct-edit / heal / surfacing panel hosts mounted as
// siblings to the shell so they can self-show via the
// `forge:open-direct-heal-surf-panel` custom event (or the imperative
// window.__forgeOpen{DirectEdit,Heal,Surfacing}() entry points) without
// modifying ForgeShellV4.jsx.
function App() {
  return (
    <ViewportEnvironmentProvider>
      <ForgeShellV4 />
      <DirectEditPanelHost />
      <HealPanelHost />
      <SurfacingPanelHost />
      <SurfaceAnalysisOverlayHost />
      <ManufacturingWorkbenchHost />
      <WeldmentsWorkbenchHost />
      <StandardPartsLibraryHost />
      <ProjectBundlePanelHost />
      <ProjectFilePanelHost />
      <IfcExportPanelHost />
      <AssemblyTreePanelHost />
      <AssemblyPanelHost />
      <BomPanelHost />
      <PdmPanelHost />
      <ScenarioRunnerHost />
      <VideoCaptureHUD />
      <PerfStatsHUD />
      <HoverTooltip />
      <SectionControlHost />
      <StressTestPanelHost />
      <ProgressStripPortal />
      <SnapStatusChip />
      <ConvergenceChartHost />
      <SkeletonPanelHost />
      <ActionWheelHost />
      <DemoProjectHost />
      <ShipWorkbenchHost />
      <SheetMetalWorkbenchHost />
      <PluginManagerPanelHost />
      <PathTracedRenderHost />
      <RoleSwitcherHost />
      <RibbonCustomiserHost />
      <CommandPaletteHost />
    </ViewportEnvironmentProvider>
  );
}

export default App;
