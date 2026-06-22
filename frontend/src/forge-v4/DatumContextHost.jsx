// Task #21 (Enterprise CAD UI/UX) — DatumContext + SelectionFilter API
// host. Pure side-effect host (renders nothing): installs the imperative
// window APIs and removes them on unmount, per the CommandPaletteHost
// lifecycle. NO React state, NO setState — every API mutates a plain
// module store (datumContextStore / selectionFilterApi) and dispatches a
// CustomEvent; the StatusBar + strip subscribe and read.

import { useEffect } from 'react';
import {
  setActiveDatum, setSnapTarget, clearDatumContext, getActiveDatum,
  getSnapTarget,
} from './datumContextStore.js';
import { installSelectionFilterApi } from './selectionFilterApi.js';

export function DatumContextHost() {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    // Active datum / CSYS (NX WCS, Creo coordinate system).
    window.__forgeSetActiveDatum = (d) => setActiveDatum(d);
    window.__forgeGetActiveDatum = () => getActiveDatum();
    // Live snap-target (Creo snap reference).
    window.__forgeSetSnapTarget = (s) => setSnapTarget(s);
    window.__forgeGetSnapTarget = () => getSnapTarget();
    window.__forgeClearDatumContext = () => clearDatumContext();

    // Imperative selection-filter namespace (.set / .get / .cycle).
    const uninstallFilter = installSelectionFilterApi();

    return () => {
      try { delete window.__forgeSetActiveDatum; } catch { /* ignore */ }
      try { delete window.__forgeGetActiveDatum; } catch { /* ignore */ }
      try { delete window.__forgeSetSnapTarget; } catch { /* ignore */ }
      try { delete window.__forgeGetSnapTarget; } catch { /* ignore */ }
      try { delete window.__forgeClearDatumContext; } catch { /* ignore */ }
      try { uninstallFilter(); } catch { /* ignore */ }
    };
  }, []);

  return null;
}

export default DatumContextHost;
