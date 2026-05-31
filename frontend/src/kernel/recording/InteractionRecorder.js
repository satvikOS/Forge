/**
 * ArchDisc — Interaction Recorder
 *
 * Captures every user action with high-resolution timestamps so the entire
 * session can be replayed, audited, or diffed. Records:
 *   - Tool invocations (which tool, with what args)
 *   - Selection events (which partID was selected)
 *   - Camera movements (position + target snapshots)
 *   - Geometry mutations (added, removed, modified parts)
 *   - Test/analysis runs
 *   - File exports
 *
 * Format: JSONL (one JSON event per line) — append-only, streamable.
 *
 * Usage:
 *   InteractionRecorder.start({ project: 'GE9X' });
 *   InteractionRecorder.record('tool.invoke', { tool: 'extrude', depth: 0.05 });
 *   const log = InteractionRecorder.export();   // returns JSONL string
 *   InteractionRecorder.stop();
 */

let _events = [];
let _started = false;
let _startTime = 0;
let _session = null;
const _listeners = new Set();

const MAX_EVENTS = 100000; // hard cap to prevent memory blow-up

function _now() {
  return (typeof performance !== 'undefined') ? performance.now() : Date.now();
}

function _wallClock() {
  return new Date().toISOString();
}

export default class InteractionRecorder {

  /** Begin a new recording session. */
  static start(meta = {}) {
    _events = [];
    _started = true;
    _startTime = _now();
    _session = {
      sessionID: meta.sessionID || `S-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      project: meta.project || 'unknown',
      user: meta.user || 'anonymous',
      startedAt: _wallClock(),
      startTimeMs: _startTime,
      meta,
    };
    InteractionRecorder.record('session.start', { ..._session });
    return _session;
  }

  /** Stop recording. Returns the session summary. */
  static stop() {
    if (!_started) return null;
    InteractionRecorder.record('session.end', {
      durationMs: _now() - _startTime,
      eventCount: _events.length,
    });
    _started = false;
    return {
      ..._session,
      endedAt: _wallClock(),
      durationMs: _now() - _startTime,
      eventCount: _events.length,
    };
  }

  /** Currently recording? */
  static isRecording() {
    return _started;
  }

  /**
   * Record an event.
   * @param {string} type - dotted name e.g. 'tool.invoke', 'select.part', 'camera.move'
   * @param {object} data - arbitrary payload
   */
  static record(type, data = {}) {
    if (!_started) return null;
    if (_events.length >= MAX_EVENTS) return null;

    const evt = {
      seq: _events.length,
      type,
      tMs: +(_now() - _startTime).toFixed(3),
      wall: _wallClock(),
      data,
    };
    _events.push(evt);
    for (const cb of _listeners) {
      try { cb(evt); } catch (e) { /* ignore */ }
    }
    return evt;
  }

  // --- Specialized convenience methods ---

  static recordToolInvoke(toolName, args = {}) {
    return InteractionRecorder.record('tool.invoke', { tool: toolName, args });
  }

  static recordSelect(partID, source = 'viewport') {
    return InteractionRecorder.record('select.part', { partID, source });
  }

  static recordFocus(partID) {
    return InteractionRecorder.record('focus.part', { partID });
  }

  static recordCamera(camera) {
    if (!camera) return null;
    return InteractionRecorder.record('camera.move', {
      pos: camera.position?.toArray?.() || null,
      quat: camera.quaternion?.toArray?.() || null,
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    });
  }

  static recordPartAdded(partID, info = {}) {
    return InteractionRecorder.record('part.added', { partID, ...info });
  }

  static recordPartRemoved(partID) {
    return InteractionRecorder.record('part.removed', { partID });
  }

  static recordTestRun(scenario, partID, result = {}) {
    return InteractionRecorder.record('test.run', { scenario, partID, result });
  }

  static recordAnalysisRun(type, partID, result = {}) {
    return InteractionRecorder.record('analysis.run', { type, partID, result });
  }

  static recordExport(format, target, summary = {}) {
    return InteractionRecorder.record('export', { format, target, summary });
  }

  static recordError(source, message, details = {}) {
    return InteractionRecorder.record('error', { source, message, details });
  }

  // --- Query / Export ---

  /** Total events. */
  static count() {
    return _events.length;
  }

  /** All events as array. */
  static getAll() {
    return [...events()];
  }

  /** Filter events by type prefix or exact type. */
  static byType(typeOrPrefix) {
    return _events.filter(e => e.type === typeOrPrefix || e.type.startsWith(typeOrPrefix + '.'));
  }

  /** Events within a time window (start/end ms relative to session start). */
  static inRange(startMs, endMs) {
    return _events.filter(e => e.tMs >= startMs && e.tMs <= endMs);
  }

  /** Get session metadata. */
  static getSession() {
    return _session;
  }

  /** Subscribe to events as they happen. */
  static onEvent(cb) {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  }

  /** Export as JSONL string (one event per line). */
  static toJSONL() {
    const lines = [];
    if (_session) lines.push(JSON.stringify({ type: '__session__', ..._session }));
    for (const e of _events) lines.push(JSON.stringify(e));
    return lines.join('\n');
  }

  /** Export as full JSON object. */
  static toJSON() {
    return {
      session: _session,
      events: [..._events],
    };
  }

  /** Reset everything (does not auto-stop a running session). */
  static reset() {
    _events = [];
    _started = false;
    _session = null;
    _startTime = 0;
  }

  /**
   * Replay recorded events through a callback. Useful for diagnostics
   * or producing a session animation.
   * @param {function} cb - (event, idx, total) => void
   * @param {object} [options] - { realTime = false } if true, delays match real timing
   */
  static async replay(cb, options = {}) {
    const { realTime = false } = options;
    let last = 0;
    for (let i = 0; i < _events.length; i++) {
      const e = _events[i];
      if (realTime && i > 0) {
        const dt = e.tMs - last;
        if (dt > 0) await new Promise(r => setTimeout(r, dt));
      }
      cb(e, i, _events.length);
      last = e.tMs;
    }
  }
}

function events() { return _events; }
