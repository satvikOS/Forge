// Forge v3 — always-on natural-language command bar.
//
// This is the PRIMARY text input of the entire application. Cmd+K
// focuses it from anywhere. Submission (Enter) fires onSubmit(text)
// — Forge-49 wires this into ForgeRunner. For the scaffold slice we
// just bubble the text up; ForgeShellV3 echoes back into the thread.
//
// Refs are forwarded so the shell can focus the input on Cmd+K.

import React, { forwardRef, useEffect, useRef, useState } from 'react';

export const CommandBar = forwardRef(function CommandBar(
  { onSubmit, placeholder, running = false }, externalRef
) {
  const [value, setValue] = useState('');
  const inputRef = useRef(null);

  // Forward our internal ref while also exposing the input via the
  // external ref so the shell can call .focus() AND .value = ... from
  // verb-rail clicks. The shell mutates input.value + dispatches 'input'
  // — we listen and sync state back.
  useEffect(() => {
    if (!externalRef) return;
    if (typeof externalRef === 'function') externalRef(inputRef.current);
    else externalRef.current = inputRef.current;
  }, [externalRef]);

  function submit() {
    const text = value.trim();
    if (!text) return;
    onSubmit?.(text);
    setValue('');
  }

  return (
    <footer className="forge-v3-cmdbar"
            role="form"
            aria-label="Forge command bar"
            data-testid="forge-v3-cmdbar">
      <span className="forge-v3-cmdbar-prompt" aria-hidden="true">
        {running ? '◐' : '⌘'}
      </span>
      <input
        ref={inputRef}
        className="forge-v3-cmdbar-input"
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            setValue('');
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder || (running
          ? 'Archie is working…'
          : 'Tell Archie what to build — e.g. “a 10mm cube, fillet 2mm”')}
        disabled={running}
        aria-label="Natural-language command"
        aria-busy={running}
        spellCheck="false"
        autoComplete="off"
      />
      <span className="forge-v3-cmdbar-hint">
        <kbd>⌘K</kbd> focus &nbsp; <kbd>↵</kbd> send
      </span>
    </footer>
  );
});
