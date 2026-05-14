import { useEffect, useState } from 'react';
import { getHistory, clearHistory } from '../foundation/DesignHistory.js';

/**
 * Design History timeline. Appears in the right aside above the
 * Feature Tree. Lists every foundation tool run in chronological
 * order with a one-line headline ("Brayton Cycle — 380 kN, SFC 0.55").
 *
 * Click a row to log its payload to the console (debug surface);
 * the headline metric is the at-a-glance value an engineer cares
 * about right after they click the tool.
 */
export default function DesignHistoryPanel() {
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    const h = getHistory();
    setEntries([...h.entries]);
    const unsub = h.onChange((next) => setEntries([...next]));
    return unsub;
  }, []);

  const handleRowClick = (entry) => {
    if (entry.payloadKey && typeof window !== 'undefined') {
      console.log(`[DesignHistory] ${entry.tool} →`, window[entry.payloadKey]);
    }
  };

  return (
    <div className="design-history-panel">
      <div className="dh-header">
        <span className="dh-title">Design History</span>
        <span className="dh-count">{entries.length}</span>
        {entries.length > 0 && (
          <button className="dh-clear-btn" onClick={() => clearHistory()} title="Clear history">
            ×
          </button>
        )}
      </div>
      <div className="dh-list">
        {entries.length === 0 && (
          <div className="dh-empty">No tools run yet.</div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="dh-row" onClick={() => handleRowClick(e)}>
            <div className="dh-row-head">
              <span className="dh-tool">{e.tool}</span>
              <span className="dh-time">{formatTime(e.when)}</span>
            </div>
            {e.headline && <div className="dh-headline">{e.headline}</div>}
            {e.tab && <div className="dh-tab">{e.tab}{e.category ? ` · ${e.category}` : ''}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return ''; }
}
