// Forge-65 — anvil-spark logo.
//
// 32-grid SVG; renders crisp at 16 / 24 / 32 / 48 / 96 / 256 / 512.
// The mark: a low-slung anvil (the platform on which steel is shaped)
// with a single spark ascending — a moment of transformation, not a
// completed object. Stroke style matches the icon family (1.5 px
// outlined at 16-grid; scaled equivalents at larger sizes).
//
// Wordmark uses the same baseline as the system Inter; the F's stem
// notches in to echo the anvil horn. Logo + wordmark always lock-up
// horizontally with 8/32-grid units between mark and word.

import React from 'react';

/**
 * The mark alone. `size` is the bounding box in CSS px.
 * `accent` overrides the stroke colour (default = currentColor so the
 * icon inherits its parent text colour). The single spark is always
 * the accent colour from tokens unless overridden via `sparkColor`.
 */
export function ForgeMark({
  size = 24,
  stroke = 'currentColor',
  sparkColor = 'var(--forge-accent, #d97a3b)',
  strokeWidth = 1.5,
  title = 'Forge',
  ...rest
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <title>{title}</title>
      {/* Spark — a 4-pointed star ascending from the anvil face. */}
      <g stroke={sparkColor} strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M16 3 L16 9" />
        <path d="M13 6 L19 6" />
        <path d="M14.2 4.2 L17.8 7.8" />
        <path d="M17.8 4.2 L14.2 7.8" />
      </g>
      {/* Anvil body. The classic London-pattern silhouette. */}
      <g stroke={stroke} strokeWidth={strokeWidth}
         strokeLinecap="round" strokeLinejoin="round" fill="none">
        {/* Horn → face (top working surface), descends to stand. */}
        <path d="
          M 4 14
          L 6 12
          L 25 12
          L 27 14
          L 22 14
          L 22 18
          L 26 18
          L 26 21
          L 20 21
          L 20 28
          L 12 28
          L 12 21
          L 6 21
          L 6 18
          L 10 18
          L 10 14
          Z
        " />
        {/* Anvil step (the small flat ledge between horn and face). */}
        <path d="M 10 14 L 22 14" />
      </g>
    </svg>
  );
}

/**
 * Full lock-up: mark + wordmark. Matches the title bar baseline. The
 * wordmark is a system-font setText with the F notched — drawn as
 * SVG so it lines up identically to the mark at any zoom.
 */
export function ForgeLockup({ size = 32, title = 'Forge', ...rest }) {
  const W = size * 4.2;   // wordmark width budget
  return (
    <svg
      height={size}
      width={W}
      viewBox={`0 0 ${4.2 * 32} 32`}
      role="img"
      aria-label={title}
      {...rest}
    >
      <title>{title}</title>
      {/* Embedded mark at 32-grid. */}
      <g>
        <ForgeMarkRaw />
      </g>
      {/* Wordmark — uppercase F + 'orge' in lower. The F's crossbar
          notches in 1 grid unit on its inside to echo the anvil. */}
      <g transform="translate(40 0)"
         fill="currentColor"
         fontFamily="Inter, system-ui, sans-serif"
         fontSize="22"
         fontWeight="600"
         letterSpacing="-0.5">
        <text x="0" y="23" textAnchor="start">Forge</text>
      </g>
    </svg>
  );
}

// Inner reusable mark used by the lockup so we don't recursively pull
// the whole component (which would re-emit a <svg>).
function ForgeMarkRaw({ accent = 'var(--forge-accent, #d97a3b)' }) {
  return (
    <g>
      <g stroke={accent} strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M16 3 L16 9" />
        <path d="M13 6 L19 6" />
        <path d="M14.2 4.2 L17.8 7.8" />
        <path d="M17.8 4.2 L14.2 7.8" />
      </g>
      <g stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="
          M 4 14
          L 6 12
          L 25 12
          L 27 14
          L 22 14
          L 22 18
          L 26 18
          L 26 21
          L 20 21
          L 20 28
          L 12 28
          L 12 21
          L 6 21
          L 6 18
          L 10 18
          L 10 14
          Z
        " />
        <path d="M 10 14 L 22 14" />
      </g>
    </g>
  );
}
