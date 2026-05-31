// Forge v3 — always-on natural-language command bar.
//
// This is the PRIMARY text input of the entire application. Cmd+K
// focuses it from anywhere. Submission (Enter) fires onSubmit(text)
// — Forge-49 wires this into ForgeRunner. For the scaffold slice we
// just bubble the text up; ForgeShellV3 echoes back into the thread.
//
// Refs are forwarded so the shell can focus the input on Cmd+K.

import React, { forwardRef, useState } from 'react';

export const CommandBar = forwardRef(function CommandBar({ onSubmit, placeholder }, ref) {
  const [value, setValue] = useState('');

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
      <span className="forge-v3-cmdbar-prompt" aria-hidden="true">⌘</span>
      <input
        ref={ref}
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
        placeholder={placeholder || 'Tell Archie what to build — e.g. “a 10mm cube, fillet 2mm”'}
        aria-label="Natural-language command"
        spellCheck="false"
        autoComplete="off"
      />
      <span className="forge-v3-cmdbar-hint">
        <kbd>⌘K</kbd> focus &nbsp; <kbd>↵</kbd> send
      </span>
    </footer>
  );
});
