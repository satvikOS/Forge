// Forge-65 — always-on Archie command bar (48 px).
// Spans the full width above the bottom screen edge. Cmd+K focuses.

import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

export const CommandBar = forwardRef(function CommandBar(
  { onSubmit, running = false, dockOpen = false, onToggleDock }, externalRef
) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (!externalRef) return;
    if (typeof externalRef === 'function') externalRef(inputRef.current);
    else externalRef.current = inputRef.current;
  }, [externalRef]);

  function submit() {
    const t = value.trim();
    if (!t) return;
    onSubmit?.(t);
    setValue('');
  }

  return (
    <footer className="forge-cmdbar"
            role="form"
            aria-label="Archie command bar"
            data-testid="forge-cmdbar">
      <span className="forge-cmdbar-glyph" aria-hidden="true">
        {running ? <Icon name="archie.spark" size={16} /> : <Icon name="archie.spark" size={16} />}
      </span>
      <input
        ref={inputRef}
        className="forge-cmdbar-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') { setValue(''); e.currentTarget.blur(); }
        }}
        placeholder={running
          ? 'Archie is working…'
          : 'Tell Archie what to build — e.g. “a 10mm cube, fillet 2mm”'}
        disabled={running}
        aria-label="Natural-language command"
        aria-busy={running}
        spellCheck="false"
        autoComplete="off"
      />
      <span className="forge-cmdbar-hint">
        <kbd>⌘K</kbd> focus &nbsp; <kbd>↵</kbd> send
      </span>
      <button type="button"
              className="forge-cmdbar-toggle"
              data-active={String(dockOpen)}
              onClick={onToggleDock}
              aria-label={dockOpen ? 'Close Archie dock' : 'Open Archie dock'}
              data-testid="forge-cmdbar-toggle">
        <Icon name="archie.thread" size={12} style={{ marginRight: 4 }} />
        {dockOpen ? 'Close' : 'Open'} thread
      </button>
    </footer>
  );
});
