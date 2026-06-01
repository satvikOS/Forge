import React from 'react';
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';
import { DirectEditPanelHost } from './forge-v4/DirectEditPanel.jsx';
import { HealPanelHost } from './forge-v4/HealPanel.jsx';
import { SurfacingPanelHost } from './forge-v4/SurfacingPanel.jsx';
import { ManufacturingWorkbenchHost } from './forge-v4/ManufacturingWorkbench.jsx';
import { StandardPartsLibraryHost } from './forge-v4/StandardPartsLibrary.jsx';
import { ProjectBundlePanelHost } from './forge-v4/ProjectBundlePanel.jsx';
import { ViewportEnvironmentProvider } from './forge-v4/ViewportEnvironment.jsx';
import { PerfStatsHUD } from './forge-v4/PerfStatsHUD.jsx';
import { AssemblyTreePanelHost } from './forge-v4/AssemblyTreePanel.jsx';
import { BomPanelHost } from './forge-v4/BomPanel.jsx';
import { ScenarioRunnerHost } from './forge-v4/ScenarioRunner.jsx';
import { VideoCaptureHUD } from './forge-v4/VideoCaptureHUD.jsx';

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
      <ManufacturingWorkbenchHost />
      <StandardPartsLibraryHost />
      <ProjectBundlePanelHost />
      <AssemblyTreePanelHost />
      <BomPanelHost />
      <ScenarioRunnerHost />
      <VideoCaptureHUD />
      <PerfStatsHUD />
    </ViewportEnvironmentProvider>
  );
}

export default App;
