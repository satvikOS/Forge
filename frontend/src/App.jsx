import React from 'react';
import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';

// Forge-65: v4 shell is the only entry. App.jsx is one line — no hash
// routes, no legacy fallback. Per user mandate: "Full rewrite of
// App.jsx, retire WorkbenchContainer entirely".
function App() {
  return <ForgeShellV4 />;
}

export default App;
