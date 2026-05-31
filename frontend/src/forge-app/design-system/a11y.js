/**
 * Focus + keyboard helpers for the Forge design system.
 *
 * All hooks are headless — no DOM-specific assumptions beyond the ref's
 * `.current` being an HTMLElement. Every modal-class component in the
 * library uses these to stay WCAG-compliant.
 */

import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE = [
  'a[href]', 'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]', 'video[controls]',
  '[contenteditable=""]', '[contenteditable="true"]',
].join(',');

function focusables(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE))
    .filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
}

/**
 * Trap focus inside `containerRef` while `active`. Restores focus to the
 * element that owned it before activation on cleanup.
 */
export function useFocusTrap(containerRef, active) {
  const returnTo = useRef(null);

  useEffect(() => {
    if (!active) return undefined;
    returnTo.current = document.activeElement;
    const container = containerRef.current;
    if (!container) return undefined;

    // Move focus into the container on activation.
    const first = focusables(container)[0];
    if (first) first.focus();

    const onKey = (e) => {
      if (e.key !== 'Tab') return;
      const list = focusables(container);
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const idx = list.indexOf(document.activeElement);
      const last = list.length - 1;
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); list[last].focus(); }
      } else if (idx === last) {
        e.preventDefault(); list[0].focus();
      }
    };
    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      if (returnTo.current && document.contains(returnTo.current)) {
        returnTo.current.focus?.();
      }
    };
  }, [active, containerRef]);
}

/** Fire `onEscape` on Escape while `active`. */
export function useEscapeKey(onEscape, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onEscape?.(e); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, active]);
}

/**
 * Manage roving tabindex for grids / tabs. Returns `{onKeyDown, ref}` —
 * mount the ref on the parent, spread the handler. Arrow keys move within
 * the linear list of focusables; Home/End jump.
 */
export function useRoving(orientation = 'horizontal') {
  const ref = useRef(null);
  const onKeyDown = useCallback((e) => {
    const list = focusables(ref.current);
    if (!list.length) return;
    const idx = list.indexOf(document.activeElement);
    const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    const prev = orientation === 'horizontal' ? 'ArrowLeft'  : 'ArrowUp';
    if (e.key === next) {
      e.preventDefault();
      list[(idx + 1) % list.length].focus();
    } else if (e.key === prev) {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1].focus();
    }
  }, [orientation]);
  return { ref, onKeyDown };
}

/**
 * Imperative announce helper for live regions. Mount `<Announcer />` once
 * at the app root; call `announce(text)` to push a polite update.
 */
let liveRegion = null;
export function announce(text, priority = 'polite') {
  if (typeof document === 'undefined') return;
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.style.cssText =
      'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);';
    document.body.appendChild(liveRegion);
  }
  liveRegion.setAttribute('aria-live', priority);
  liveRegion.textContent = '';
  // 50 ms tick so screen readers don't coalesce identical consecutive lines.
  setTimeout(() => { liveRegion.textContent = text; }, 50);
}

/** Returns a unique-per-instance id usable for aria-* references. */
let idCounter = 0;
export function useUniqueId(prefix = 'forge') {
  const ref = useRef(null);
  if (!ref.current) ref.current = `${prefix}-${++idCounter}`;
  return ref.current;
}
