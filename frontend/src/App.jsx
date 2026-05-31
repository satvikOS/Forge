import React from 'react';
import { ForgeShellV3 } from './forge-app/v3/ForgeShellV3.jsx';
import './styles/index.css';
import './styles/fonts.css';

// Forge-48: v3 Archie-first shell is the only entry point. The v1
// ForgeApp ribbon-clone and the v2 SolidWorks-mimicry layout have been
// retired — the application IS the command bar + verb rail + viewport
// + Archie sidebar + timeline. There is no separate legacy route.
function App() {
  return <ForgeShellV3 />;
}

export default App;
