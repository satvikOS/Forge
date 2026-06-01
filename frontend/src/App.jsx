import React from 'react';
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';
import { DirectEditPanelHost } from './forge-v4/DirectEditPanel.jsx';
import { HealPanelHost } from './forge-v4/HealPanel.jsx';
import { SurfacingPanelHost } from './forge-v4/SurfacingPanel.jsx';
import { ManufacturingWorkbenchHost } from './forge-v4/ManufacturingWorkbench.jsx';
import { StandardPartsLibraryHost } from './forge-v4/StandardPartsLibrary.jsx';
import { ViewportEnvironmentProvider } from './forge-v4/ViewportEnvironment.jsx';

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
    </ViewportEnvironmentProvider>
  );
}

export default App;
