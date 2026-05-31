import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useAppState } from './state/AppState.js';

/**
 * CommandPalette modal — VS-Code-style Cmd+K palette.
 *
 * Reads from the shared CommandRegistry on AppState; renders a ranked
 * list as the user types; arrow keys move the active row; Enter invokes
 * the active command and closes; Esc just closes. The palette is opened
 * by the AppState reducer (`paletteOpen` flag) which we bind to Cmd/Ctrl+K
 * at the top-level shell, but we also export the bare component so tests
 * can mount it without wiring keyboard handlers.
 */

export function CommandPaletteView({ registry, onClose, onInvoke, context = {}, autoFocus = true }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  // Re-query whenever the typed text changes. We do a fresh registry
  // query rather than caching across renders so usage/recency boosts
  // applied via invoke() between keystrokes show up immediately.
  const results = useMemo(() => {
    try {
      return registry.query(query, context, { limit: 20 });
    } catch {
      return [];
    }
  }, [registry, query, context]);

  // Clamp active index whenever the result list changes.
  useEffect(() => {
    if (activeIdx >= results.length) setActiveIdx(0);
  }, [results.length, activeIdx]);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = results[activeIdx];
      if (hit) {
        try {
          registry.invoke(hit.command.id, context);
          if (onInvoke) onInvoke(hit.command);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[forge.palette]', err);
        }
        if (onClose) onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (onClose) onClose();
    }
  }

  return (
    <div
      className="forge-modal-shade"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => {
        // Click outside the palette closes it.
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div className="forge-palette">
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Command query"
        />
        <div className="forge-palette-results" role="listbox">
          {results.length === 0 && (
            <div className="forge-palette-row" style={{ color: 'var(--muted)' }}>
              No matches
            </div>
          )}
          {results.map((hit, i) => (
            <div
              key={hit.command.id}
              role="option"
              aria-selected={i === activeIdx}
              className={`forge-palette-row${i === activeIdx ? ' active' : ''}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => {
                try {
                  registry.invoke(hit.command.id, context);
                  if (onInvoke) onInvoke(hit.command);
                } catch (err) {
                  // eslint-disable-next-line no-console
                  console.error('[forge.palette]', err);
                }
                if (onClose) onClose();
              }}
            >
              <span className="category">{hit.command.category || 'General'}</span>
              <span className="title">{hit.command.title}</span>
              {hit.command.shortcut
                ? <span className="shortcut">{hit.command.shortcut}</span>
                : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

CommandPaletteView.propTypes = {
  registry: PropTypes.object.isRequired,
  onClose: PropTypes.func,
  onInvoke: PropTypes.func,
  context: PropTypes.object,
  autoFocus: PropTypes.bool,
};

/**
 * Default container — wires the view to AppState. Conditional on
 * `state.paletteOpen` so it doesn't even render when closed.
 */
export default function CommandPalette() {
  const { state, closePalette, commandRegistry } = useAppState();
  if (!state.paletteOpen) return null;
  return (
    <CommandPaletteView
      registry={commandRegistry}
      onClose={closePalette}
    />
  );
}
