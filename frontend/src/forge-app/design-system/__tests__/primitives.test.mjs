import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, IconButton } from '../primitives/Button.jsx';
import { Switch, Checkbox } from '../primitives/Switch.jsx';
import { Field } from '../primitives/Field.jsx';
import { KeyHint } from '../primitives/KeyHint.jsx';
import { EmptyState } from '../primitives/EmptyState.jsx';
import { ProgressBar } from '../primitives/Spinner.jsx';

// Button — variant + size emit class names; aria-busy when loading.
{
  const html = renderToStaticMarkup(React.createElement(Button, { variant: 'primary', size: 'md' }, 'Save'));
  assert.ok(html.includes('forge-btn-primary'));
  assert.ok(html.includes('forge-btn-md'));
  assert.ok(html.includes('Save'));

  const loading = renderToStaticMarkup(React.createElement(Button, { loading: true }, 'Saving'));
  assert.ok(loading.includes('aria-busy="true"'));

  const disabled = renderToStaticMarkup(React.createElement(Button, { disabled: true }, 'x'));
  assert.ok(disabled.includes('aria-disabled="true"'));
}

// IconButton — aria-label required, aria-pressed when selected.
{
  const html = renderToStaticMarkup(React.createElement(IconButton, {
    icon: React.createElement('span'), label: 'Settings', selected: true,
  }));
  assert.ok(html.includes('aria-label="Settings"'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.ok(html.includes('is-selected'));
}

// Switch — role=switch + aria-checked.
{
  const html = renderToStaticMarkup(React.createElement(Switch, { checked: true, label: 'Hidden lines' }));
  assert.ok(html.includes('role="switch"'));
  assert.ok(html.includes('aria-checked="true"'));
  assert.ok(html.includes('Hidden lines'));
}

// Checkbox — supports indeterminate via aria-checked="mixed".
{
  const html = renderToStaticMarkup(React.createElement(Checkbox, { indeterminate: true, label: 'All' }));
  assert.ok(html.includes('aria-checked="mixed"'));
}

// Field — label, required indicator, helper text, error text with role=alert.
{
  const ok = renderToStaticMarkup(React.createElement(Field, {
    label: 'Project name', required: true, helperText: 'Short name.',
  }, React.createElement('input')));
  assert.ok(ok.includes('Project name'));
  assert.ok(ok.includes('Short name.'));
  assert.ok(ok.includes('*'));

  const err = renderToStaticMarkup(React.createElement(Field, {
    label: 'Width', errorText: 'Required',
  }, React.createElement('input')));
  assert.ok(err.includes('role="alert"'));
  assert.ok(err.includes('Required'));
}

// KeyHint — parses both array and string forms; symbol substitutions.
{
  const arr = renderToStaticMarkup(React.createElement(KeyHint, { keys: ['Cmd', 'K'] }));
  assert.ok(arr.includes('⌘'));
  assert.ok(arr.includes('K'));

  const str = renderToStaticMarkup(React.createElement(KeyHint, { keys: 'Shift+Enter' }));
  assert.ok(str.includes('⇧'));
  assert.ok(str.includes('↵'));
}

// EmptyState — renders title + description; action slot survives.
{
  const html = renderToStaticMarkup(React.createElement(EmptyState, {
    title: 'Nothing here', description: 'Pick something.',
    action: React.createElement(Button, null, 'Tour'),
  }));
  assert.ok(html.includes('Nothing here'));
  assert.ok(html.includes('Pick something.'));
  assert.ok(html.includes('Tour'));
}

// ProgressBar — determinate + indeterminate + aria attributes.
{
  const det = renderToStaticMarkup(React.createElement(ProgressBar, { value: 30, max: 100, label: 'Loading' }));
  assert.ok(det.includes('role="progressbar"'));
  assert.ok(det.includes('aria-valuenow="30"'));
  assert.ok(det.includes('30%'));

  const indet = renderToStaticMarkup(React.createElement(ProgressBar, { label: 'Solving…' }));
  assert.ok(indet.includes('role="progressbar"'));
  // Indeterminate omits aria-valuenow.
  assert.ok(!indet.includes('aria-valuenow'));
}

console.log('[design-system.primitives] all tests passed');
