// Forge v4 — blank-document viewport welcome (empty-state).
//
// When the scene has no model, a calm centred welcome floats over the
// viewport — the "what do I do on a blank document" affordance pro MCAD
// apps show (Fusion / Onshape start screens). It is part of the shared
// empty-state family (theme/forge-base.css §12, `.fds-empty--viewport`) so
// it matches the feature-tree / Properties empty-states exactly.
//
// Self-mounting host (like HoverTooltip / OnboardingTourHost): rendered once
// from App.jsx, portals over the live `[data-testid="forge-viewport"]` node,
// and subscribes to the existing read-only body channel
// (window.__forgeBodies + the `forge:bodies-changed` event). It NEVER mutates
// model state — its buttons dispatch the SAME verified `forge:menu-action`
// events the menus fire (tools.demoProject, tools.commandPalette) and call the
// existing window.__forgeStartTour hook. Pointer-events pass through the
// backdrop so orbit / canvas interaction is never blocked.

import React from 'react';
import { createPortal } from 'react-dom';
import { EmptyState } from './EmptyState.jsx';

function liveBodyCount() {
  try {
    const reg = window.__forgeBodies;
    if (!Array.isArray(reg)) return 0;
    // Count only real, visible model bodies — ignore synthetic helpers.
    return reg.filter((b) => b && b.kind !== 'helper').length;
  } catch { return 0; }
}

function tourActive() {
  try { return !!window.__forgeTourActive?.(); } catch { return false; }
}

const fire = (id) => window.dispatchEvent(
  new CustomEvent('forge:menu-action', { detail: { id } }),
);

export function ViewportWelcomeHost() {
  const [count, setCount] = React.useState(liveBodyCount);
  const [tour, setTour] = React.useState(tourActive);
  const [dismissed, setDismissed] = React.useState(false);
  const [host, setHost] = React.useState(null);

  // Subscribe to the read-only body channel + locate the viewport node.
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => { setCount(liveBodyCount()); setTour(tourActive()); };
    const findHost = () => setHost(
      document.querySelector('[data-testid="forge-viewport"]'),
    );
    sync();
    findHost();
    window.addEventListener('forge:bodies-changed', sync);
    window.addEventListener('forge:wb-changed', sync);
    // The body registry can also be set imperatively without an event; poll
    // gently so the welcome appears/disappears promptly either way.
    const id = setInterval(() => { sync(); if (!host) findHost(); }, 600);
    return () => {
      window.removeEventListener('forge:bodies-changed', sync);
      window.removeEventListener('forge:wb-changed', sync);
      clearInterval(id);
    };
  }, [host]);

  // Re-show on a fresh blank document (count returns to 0).
  React.useEffect(() => { if (count > 0) setDismissed(false); }, [count]);

  if (typeof document === 'undefined') return null;
  if (count > 0 || tour || dismissed || !host) return null;

  return createPortal(
    <EmptyState
      variant="viewport"
      testId="forge-viewport-welcome"
      icon="wb.part"
      title="Start a new design"
      hint="Sketch a profile and pull it into a solid, build the sample bracket, or just tell Forge what to make in the command bar below."
      actions={[
        { id: 'sample', label: 'Build sample part', icon: 'archie.spark',
          primary: true, testId: 'forge-welcome-sample',
          onClick: () => { fire('tools.demoProject'); } },
        { id: 'browse', label: 'Browse all tools', icon: 'misc.search',
          testId: 'forge-welcome-browse',
          onClick: () => { fire('tools.commandPalette'); } },
        { id: 'tour', label: 'Take a tour', icon: 'menu.help',
          testId: 'forge-welcome-tour',
          onClick: () => { try { window.__forgeStartTour?.(); } catch { /* noop */ } } },
        { id: 'dismiss', label: 'Dismiss', testId: 'forge-welcome-dismiss',
          onClick: () => setDismissed(true) },
      ]}
    />,
    host,
  );
}

export default ViewportWelcomeHost;
