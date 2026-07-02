// Forge-65 — always-on Archie command bar (48 px).
// Spans the full width above the bottom screen edge. Cmd+K focuses.

import React, { forwardRef, useEffect, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

// Demo prompt-preset library. Clicking a chip INJECTS the preset text and
// submits it through the SAME path a typed+Enter prompt uses (onSubmit →
// runArchie → ForgeRunner), so Archie genuinely performs it via CUA — no
// scripted shortcut. Each chip carries data-forge-v4-prompt-preset="<id>".
export const FORGE_PROMPT_PRESETS = [
  {
    id: 'ge9x-turbofan',
    label: 'GE9X turbofan',
    text: 'Design a GE9X-class high-bypass turbofan.',
  },
  {
    id: 'planetary-gearbox',
    label: 'Planetary gearbox 4.3:1',
    text: 'Design a planetary gearbox with a ~4.3:1 ratio.',
  },
  {
    id: 'lox-rp1-turbopump',
    label: 'LOX/RP-1 turbopump',
    text: 'Design a LOX/RP-1 rocket turbopump.',
  },
  {
    id: 'mounting-flange',
    label: 'Ø120 8-bolt flange',
    text: 'Model a Ø120 mounting flange with an 8-bolt circle and a central bore.',
  },
];

// Attachable file kinds. CAD bodies import straight into the scene through the
// same io bridge File ▸ Import uses; images ride the prompt as drawing context
// (vision-captioned when the local caption server is up — Forge-162 pattern).
const ATTACH_ACCEPT = '.png,.jpg,.jpeg,.webp,.step,.stp,.iges,.igs,.brep,.brp,.stl,.dxf';
const CAD_EXTS = ['step','stp','iges','igs','brep','brp','stl'];
export function classifyAttachment(name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (CAD_EXTS.includes(ext)) return 'cad';
  if (['png','jpg','jpeg','webp'].includes(ext)) return 'image';
  if (ext === 'dxf') return 'drawing';
  return 'file';
}

export const CommandBar = forwardRef(function CommandBar(
  { onSubmit, running = false, dockOpen = false, onToggleDock }, externalRef
) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState([]);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  useEffect(() => {
    if (!externalRef) return;
    if (typeof externalRef === 'function') externalRef(inputRef.current);
    else externalRef.current = inputRef.current;
  }, [externalRef]);

  // File-picker → attachment chips. Electron's renderer exposes .path on the
  // File object, which the io bridge needs for real CAD imports; browser dev
  // shells fall back to an object URL (image captioning still works).
  function onPickFiles(e) {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setAttachments((prev) => [...prev, ...files.map((f) => ({
        name: f.name,
        path: f.path || '',
        url: f.path ? '' : URL.createObjectURL(f),
        kind: classifyAttachment(f.name),
      }))]);
    }
    e.target.value = '';           // same file can be re-picked later
  }
  function removeAttachment(i) {
    setAttachments((prev) => prev.filter((_, ix) => ix !== i));
  }

  function submit() {
    const t = value.trim();
    if (!t && attachments.length === 0) return;
    onSubmit?.(t || 'Use the attached file(s).', attachments);
    setValue('');
    setAttachments([]);
  }

  // Inject a preset prompt visibly into the input, then submit it through
  // the EXACT same onSubmit path a typed+Enter prompt uses.
  function submitText(text) {
    const t = String(text || '').trim();
    if (!t || running) return;
    setValue(t);
    onSubmit?.(t);
    setValue('');
  }

  return (
    <footer className="forge-cmdbar"
            role="form"
            aria-label="Archie command bar"
            data-testid="forge-cmdbar">
      <span className="forge-cmdbar-presets"
            data-forge-v4-prompt-presets
            aria-label="Prompt presets">
        <span className="forge-cmdbar-presets-label">Try:</span>
        {FORGE_PROMPT_PRESETS.map((p) => (
          <button key={p.id}
                  type="button"
                  className="forge-cmdbar-preset-chip"
                  data-forge-v4-prompt-preset={p.id}
                  title={p.text}
                  disabled={running}
                  onClick={() => submitText(p.text)}>
            {p.label}
          </button>
        ))}
      </span>
      <span className="forge-cmdbar-glyph" aria-hidden="true">
        {running ? <Icon name="archie.spark" size={16} /> : <Icon name="archie.spark" size={16} />}
      </span>
      <input ref={fileRef}
             type="file"
             multiple
             accept={ATTACH_ACCEPT}
             style={{ display: 'none' }}
             onChange={onPickFiles}
             data-testid="forge-cmdbar-file-input"
             aria-hidden="true"
             tabIndex={-1} />
      <button type="button"
              className="forge-cmdbar-attach"
              title="Attach a drawing (PNG/JPG/DXF) or CAD file (STEP/IGES/STL) to this prompt"
              disabled={running}
              onClick={() => fileRef.current?.click()}
              aria-label="Attach file"
              data-testid="forge-cmdbar-attach">
        <Icon name="archie.attach" size={14} />
      </button>
      {attachments.length > 0 && (
        <span className="forge-cmdbar-attachments" data-testid="forge-cmdbar-attachments">
          {attachments.map((a, i) => (
            <span key={`${a.name}-${i}`}
                  className="forge-cmdbar-attachment-chip"
                  data-kind={a.kind}
                  data-testid="forge-cmdbar-attachment-chip"
                  title={a.path || a.name}>
              {a.name}
              <button type="button"
                      className="forge-cmdbar-attachment-x"
                      onClick={() => removeAttachment(i)}
                      aria-label={`Remove attachment ${a.name}`}>×</button>
            </span>
          ))}
        </span>
      )}
      <input
        ref={inputRef}
        className="forge-cmdbar-input"
        data-testid="forge-cmdbar-input"
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
