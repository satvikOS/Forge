import React, { useEffect, useState } from 'react';
import WorkbenchContainer from './components/Workbench';
import ForgeApp from './forge-app/ForgeApp.jsx';
import { Showcase as ForgeShowcase } from './forge-app/design-system/Showcase.jsx';
import './styles/index.css';
import './styles/fonts.css';

/**
 * ArchDisc - Professional AI-Powered Design Platform
 * Main application component that renders the workbench container.
 *
 * Forge-26: `#forge` (or any hash starting with `forge`) mounts the
 * new ForgeApp shell instead of the legacy workbench. Lets us iterate
 * on the new UI behind a route without disturbing the production path.
 */
function App() {
  const [hash, setHash] = useState(() => (typeof window !== 'undefined' ? window.location.hash : ''));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (hash && hash.replace(/^#\/?/, '').startsWith('forge')) {
    const path = hash.replace(/^#\/?/, '');
    if (path === 'forge/design-showcase') return <ForgeShowcase />;
    return <ForgeApp />;
  }
  return <WorkbenchContainer />;
}

export default App;
