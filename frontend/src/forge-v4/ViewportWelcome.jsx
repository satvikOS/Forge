// Forge v4 — viewport welcome (RETIRED).
//
// The blank-document start-designing welcome modal that floated over the
// viewport has been removed: it gated the canvas on load and sat over the
// model whenever Archie was invoked, so the user could see a dialog instead
// of a clear viewport. The viewport now starts clean (origin triad + grid
// only) and stays clear when a model is generated.
//
// This host is intentionally a no-op so any stale mount renders nothing —
// the canonical mount in App.jsx has been deleted. Kept as an exported
// no-op (rather than a hard file delete) so no import anywhere can dangle.

export function ViewportWelcomeHost() {
  return null;
}

export default ViewportWelcomeHost;
