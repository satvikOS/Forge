/**
 * ArchDisc Kernel — History & Rollback barrel.
 *
 * SP-3a. The single import surface for the kernel-grade history log and the
 * delta-recording shim that gives an op its forward / inverse pair.
 *
 * Surface today (SP-3a, mechanism + makeBox hook):
 *   - HistoryLog          — the bulletin-board / undo-redo timeline.
 *   - getHistoryLog       — module-level singleton accessor (one log per
 *                           kernel session; ToolExecutionEngine + the e2e
 *                           use the same instance).
 *   - recordBodyCreate    — the standard "an op produced a fresh spine body"
 *                           delta shape, used by the makeBox wrapper and
 *                           every SP-3b op once it lands.
 *   - _resetEntryOrdinal  — test-only reset for the monotonic entry id.
 *
 * SP-3b will widen the surface to cover boolean / feature / local-op /
 * surfacing deltas; SP-3c will wire the timeline scrubber UI.
 */

export {
  default as HistoryLog,
  _resetEntryOrdinal,
  getHistoryLog,
  setHistoryLogForTest,
  recordBodyCreate,
  recordBodyDerive,
  recordBodyDeriveMulti,
  standardSceneRegister,
  standardSceneRemove,
  findLiveBodyByPersistentId,
  setRecordingSuppressed,
  isRecordingSuppressed,
} from './HistoryLog.js';
