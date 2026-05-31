import { useState, useRef, useEffect, useCallback } from 'react';
import './DimensionInput.css';

/**
 * DimensionInput — Floating dimension entry that appears when tools need numeric input.
 * User types exact values (e.g., "50mm", "2.5in", "30°") and presses Enter.
 * Supports: mm, cm, m, in, ft, deg, rad — auto-converts to meters/radians.
 */
export default function DimensionInput({ visible, label, defaultValue, unit, position, onSubmit, onCancel }) {
  const [value, setValue] = useState(defaultValue?.toString() || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [visible]);

  useEffect(() => {
    setValue(defaultValue?.toString() || '');
  }, [defaultValue]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      const parsed = parseInput(value, unit);
      if (parsed !== null) {
        onSubmit?.(parsed);
      }
    }
    if (e.key === 'Escape') {
      onCancel?.();
    }
  }, [value, unit, onSubmit, onCancel]);

  if (!visible) return null;

  const style = position ? { left: position.x, top: position.y } : {};

  return (
    <div className="dimension-input-overlay" style={style}>
      <div className="dimension-input-container">
        <label className="dimension-label">{label || 'Value'}</label>
        <div className="dimension-input-row">
          <input
            ref={inputRef}
            type="text"
            className="dimension-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`e.g. 50${unit || 'mm'}`}
          />
          <span className="dimension-unit">{unit || 'mm'}</span>
        </div>
        <div className="dimension-hint">Enter to confirm, Esc to cancel</div>
      </div>
    </div>
  );
}

/**
 * Parse user input with unit conversion.
 * Returns value in SI base unit (meters for length, radians for angle).
 */
export function parseInput(input, expectedUnit = 'mm') {
  if (!input || input.trim() === '') return null;

  const str = input.trim().toLowerCase();

  // Try to extract number and unit
  const match = str.match(/^([+-]?\d*\.?\d+)\s*(mm|cm|m|in|ft|deg|°|rad)?$/);
  if (!match) {
    // Try pure number
    const num = parseFloat(str);
    if (isNaN(num)) return null;
    // Apply default unit conversion
    return convertToSI(num, expectedUnit);
  }

  const num = parseFloat(match[1]);
  const unit = match[2] || expectedUnit;
  return convertToSI(num, unit);
}

function convertToSI(value, unit) {
  switch (unit) {
    case 'mm': return value * 0.001;
    case 'cm': return value * 0.01;
    case 'm': return value;
    case 'in': return value * 0.0254;
    case 'ft': return value * 0.3048;
    case 'deg': case '°': return value * (Math.PI / 180);
    case 'rad': return value;
    default: return value * 0.001; // default mm
  }
}

/**
 * Format a SI value for display.
 */
export function formatSI(meters, unit = 'mm') {
  switch (unit) {
    case 'mm': return `${(meters * 1000).toFixed(3)} mm`;
    case 'cm': return `${(meters * 100).toFixed(2)} cm`;
    case 'm': return `${meters.toFixed(6)} m`;
    case 'in': return `${(meters / 0.0254).toFixed(4)} in`;
    case 'ft': return `${(meters / 0.3048).toFixed(4)} ft`;
    case 'deg': return `${(meters * 180 / Math.PI).toFixed(2)}°`;
    case 'rad': return `${meters.toFixed(4)} rad`;
    default: return `${(meters * 1000).toFixed(3)} mm`;
  }
}
